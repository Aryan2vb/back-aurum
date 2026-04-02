import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCreditDto } from './dto/create-credit.dto';
import { UpdateCreditDto } from './dto/update-credit.dto';
import { CreateCreditTransactionDto } from './dto/create-credit-transaction.dto';
import { UpdateCreditTransactionDto } from './dto/update-credit-transaction.dto';
import { QueryCreditsDto } from './dto/query-credits.dto';
import { CurrentUserData } from '../auth/current-user.decorator';
import { CreditStatus, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);

  constructor(private prisma: PrismaService) {
    this.logger.log('CreditsService initialized');
  }

  // ===========================
  // CREDIT CRUD
  // ===========================

  async create(createCreditDto: CreateCreditDto, user: CurrentUserData) {
    this.logger.log(
      `Creating credit for customer ${createCreditDto.customerId} by user ${user.userId}`,
    );
    const { customerId, totalAmount, initialPayment, ...rest } = createCreditDto;

    // Verify customer exists and belongs to organization
    const customer = await this.prisma.customer.findFirst({
      where: {
        id: customerId,
        organizationId: user.organizationId,
        deletedAt: null,
      },
    });

    if (!customer) {
      this.logger.warn(`Customer not found: ${customerId} for organization ${user.organizationId}`);
      throw new NotFoundException('Customer not found');
    }

    // Fetch customer credit summary BEFORE creating new credit (decision support)
    this.logger.debug(`Fetching customer credit summary for customer ${customerId}`);
    const customerCreditSummary = await this.getCustomerCreditSummary(
      customerId,
      user.organizationId,
    );
    this.logger.debug(
      `Customer risk level: ${customerCreditSummary.riskLevel}, Active Udhar: ${customerCreditSummary.totalActiveUdhar}`,
    );

    // Validate initial payment doesn't exceed total
    if (initialPayment && initialPayment > totalAmount) {
      this.logger.warn(
        `Initial payment ${initialPayment} exceeds total amount ${totalAmount} for customer ${customerId}`,
      );
      throw new BadRequestException('Initial payment cannot exceed total amount');
    }

    const paidAmount = initialPayment || 0;
    const status = paidAmount >= totalAmount ? CreditStatus.PAID : CreditStatus.ACTIVE;

    // Calculate next reminder date if frequency is set
    let nextReminderDate: Date | null = null;
    if (rest.reminderFrequency && status !== CreditStatus.PAID) {
      nextReminderDate = this.calculateNextReminderDate(new Date(), rest.reminderFrequency);
    }

    const credit = await this.prisma.$transaction(async (tx) => {
      // Create the credit
      const createdCredit = await tx.credit.create({
        data: {
          organizationId: user.organizationId,
          customerId,
          totalAmount: new Decimal(totalAmount),
          paidAmount: new Decimal(paidAmount),
          status,
          nextReminderDate,
          lastPaymentDate: initialPayment ? new Date() : null,
          createdById: user.userId,
          creditDate: rest.creditDate ? new Date(rest.creditDate) : new Date(),
          expectedDueDate: rest.expectedDueDate ? new Date(rest.expectedDueDate) : null,
          saleReference: rest.saleReference,
          itemSummary: rest.itemSummary,
          description: rest.description,
          reminderFrequency: rest.reminderFrequency,
          notes: rest.notes,
        },
        include: {
          customer: {
            select: { id: true, fullName: true, customerCode: true },
          },
        },
      });

      // Create initial payment transaction if provided
      if (initialPayment && initialPayment > 0) {
        await tx.creditTransaction.create({
          data: {
            creditId: createdCredit.id,
            organizationId: user.organizationId,
            amount: new Decimal(initialPayment),
            transactionDate: new Date(),
            notes: 'Initial payment at credit creation',
            createdById: user.userId,
          },
        });
      }

      return createdCredit;
    });

    this.logger.log(
      `Credit created successfully: ${credit.id} for customer ${customerId}, amount: ${totalAmount}, status: ${status}`,
    );

    // Return credit with customer credit summary for decision support
    return {
      ...credit,
      customerCreditSummary: {
        ...customerCreditSummary,
        // Note: This summary is from BEFORE the new credit was created
        // Frontend can call GET /credits/customer/:customerId/summary for updated summary
      },
    };
  }

  async findAll(queryDto: QueryCreditsDto, organizationId: string) {
    const {
      customerId,
      status,
      overdueOnly,
      dueBefore,
      dueAfter,
      creditDateFrom,
      creditDateTo,
      search,
      page = 1,
      limit = 20,
      sortBy = 'creditDate',
      sortOrder = 'desc',
    } = queryDto;

    const where: Prisma.CreditWhereInput = {
      organizationId,
      deletedAt: null,
    };

    if (customerId) {
      where.customerId = customerId;
    }

    if (status) {
      where.status = status;
    }

    if (overdueOnly) {
      where.status = CreditStatus.OVERDUE;
    }

    if (dueBefore || dueAfter) {
      where.expectedDueDate = {};
      if (dueBefore) {
        where.expectedDueDate.lte = new Date(dueBefore);
      }
      if (dueAfter) {
        where.expectedDueDate.gte = new Date(dueAfter);
      }
    }

    if (creditDateFrom || creditDateTo) {
      where.creditDate = {};
      if (creditDateFrom) {
        where.creditDate.gte = new Date(creditDateFrom);
      }
      if (creditDateTo) {
        where.creditDate.lte = new Date(creditDateTo);
      }
    }

    if (search) {
      where.OR = [
        { saleReference: { contains: search, mode: 'insensitive' } },
        { itemSummary: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { customer: { fullName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const skip = (page - 1) * limit;

    const [credits, total] = await Promise.all([
      this.prisma.credit.findMany({
        where,
        include: {
          customer: {
            select: { id: true, fullName: true, customerCode: true },
          },
          _count: { select: { transactions: true } },
        },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: limit,
      }),
      this.prisma.credit.count({ where }),
    ]);

    return {
      data: credits,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string, organizationId: string) {
    const credit = await this.prisma.credit.findFirst({
      where: {
        id,
        organizationId,
        deletedAt: null,
      },
      include: {
        customer: {
          select: { id: true, fullName: true, customerCode: true },
        },
        transactions: {
          orderBy: { transactionDate: 'desc' },
        },
        createdBy: {
          select: { id: true, fullName: true, email: true },
        },
      },
    });

    if (!credit) {
      throw new NotFoundException('Credit not found');
    }

    // Calculate remaining balance
    const remainingBalance = Number(credit.totalAmount) - Number(credit.paidAmount);

    return {
      ...credit,
      remainingBalance,
    };
  }

  async update(id: string, updateCreditDto: UpdateCreditDto, user: CurrentUserData) {
    const credit = await this.prisma.credit.findFirst({
      where: {
        id,
        organizationId: user.organizationId,
        deletedAt: null,
      },
    });

    if (!credit) {
      throw new NotFoundException('Credit not found');
    }

    const updateData: Prisma.CreditUpdateInput = {};

    if (updateCreditDto.saleReference !== undefined) {
      updateData.saleReference = updateCreditDto.saleReference;
    }
    if (updateCreditDto.itemSummary !== undefined) {
      updateData.itemSummary = updateCreditDto.itemSummary;
    }
    if (updateCreditDto.description !== undefined) {
      updateData.description = updateCreditDto.description;
    }
    if (updateCreditDto.creditDate !== undefined) {
      updateData.creditDate = new Date(updateCreditDto.creditDate);
    }
    if (updateCreditDto.expectedDueDate !== undefined) {
      updateData.expectedDueDate = new Date(updateCreditDto.expectedDueDate);
    }
    if (updateCreditDto.reminderFrequency !== undefined) {
      updateData.reminderFrequency = updateCreditDto.reminderFrequency;
      // Recalculate next reminder if status is active/overdue
      if (credit.status !== CreditStatus.PAID && credit.status !== CreditStatus.CANCELLED) {
        updateData.nextReminderDate = this.calculateNextReminderDate(
          new Date(),
          updateCreditDto.reminderFrequency,
        );
      }
    }
    if (updateCreditDto.nextReminderDate !== undefined) {
      updateData.nextReminderDate = new Date(updateCreditDto.nextReminderDate);
    }
    if (updateCreditDto.status !== undefined) {
      updateData.status = updateCreditDto.status;
      // Clear reminder if paid/cancelled
      if (
        updateCreditDto.status === CreditStatus.PAID ||
        updateCreditDto.status === CreditStatus.CANCELLED
      ) {
        updateData.nextReminderDate = null;
      }
    }
    if (updateCreditDto.notes !== undefined) {
      updateData.notes = updateCreditDto.notes;
    }
    if (updateCreditDto.totalAmount !== undefined) {
      updateData.totalAmount = new Decimal(updateCreditDto.totalAmount);
      // Recalculate status if total changed
      const newTotalAmount = updateCreditDto.totalAmount;
      const currentPaid = Number(credit.paidAmount);
      if (currentPaid >= newTotalAmount) {
        updateData.status = CreditStatus.PAID;
        updateData.nextReminderDate = null;
      } else if (credit.status === CreditStatus.PAID) {
        // If was paid but now total increased, reactivate
        updateData.status = CreditStatus.ACTIVE;
      }
    }

    return this.prisma.credit.update({
      where: {
        id,
        organizationId: user.organizationId, // Required for tenant-scoped model
      },
      data: updateData,
      include: {
        customer: {
          select: { id: true, fullName: true, customerCode: true },
        },
      },
    });
  }

  async softDelete(id: string, user: CurrentUserData) {
    const credit = await this.prisma.credit.findFirst({
      where: {
        id,
        organizationId: user.organizationId,
        deletedAt: null,
      },
    });

    if (!credit) {
      throw new NotFoundException('Credit not found');
    }

    return this.prisma.credit.update({
      where: {
        id,
        organizationId: user.organizationId, // Required for tenant-scoped model
      },
      data: { deletedAt: new Date() },
    });
  }

  // ===========================
  // TRANSACTIONS
  // ===========================

  async addTransaction(
    creditId: string,
    createTransactionDto: CreateCreditTransactionDto,
    user: CurrentUserData,
  ) {
    this.logger.log(
      `Adding transaction to credit ${creditId}, amount: ${createTransactionDto.amount}`,
    );

    // Ensure organizationId is present
    if (!user.organizationId) {
      this.logger.error('Organization ID missing in user context');
      throw new ForbiddenException('Organization ID is required');
    }

    const organizationId = user.organizationId;

    const credit = await this.prisma.credit.findFirst({
      where: {
        id: creditId,
        organizationId: organizationId,
        deletedAt: null,
      },
    });

    if (!credit) {
      this.logger.warn(`Credit not found: ${creditId} for organization ${organizationId}`);
      throw new NotFoundException('Credit not found');
    }

    if (credit.status === CreditStatus.CANCELLED) {
      this.logger.warn(`Attempted to add payment to cancelled credit ${creditId}`);
      throw new BadRequestException('Cannot add payment to cancelled credit');
    }

    const paymentAmount = new Decimal(createTransactionDto.amount);
    const newPaidAmount = credit.paidAmount.add(paymentAmount);
    const totalAmount = credit.totalAmount;

    // Check for overpayment
    if (newPaidAmount.greaterThan(totalAmount)) {
      this.logger.warn(
        `Overpayment attempted: ${createTransactionDto.amount} exceeds remaining balance for credit ${creditId}`,
      );
      throw new BadRequestException(
        `Payment of ${createTransactionDto.amount} exceeds remaining balance of ${totalAmount.sub(credit.paidAmount)}`,
      );
    }

    const newStatus = newPaidAmount.greaterThanOrEqualTo(totalAmount)
      ? CreditStatus.PAID
      : CreditStatus.ACTIVE;

    return this.prisma.$transaction(async (tx) => {
      // Create transaction
      const transaction = await tx.creditTransaction.create({
        data: {
          creditId,
          organizationId: organizationId,
          amount: paymentAmount,
          transactionDate: createTransactionDto.transactionDate
            ? new Date(createTransactionDto.transactionDate)
            : new Date(),
          paymentMethod: createTransactionDto.paymentMethod,
          referenceNumber: createTransactionDto.referenceNumber,
          collectedBy: createTransactionDto.collectedBy,
          notes: createTransactionDto.notes,
          createdById: user.userId,
        },
      });

      // Update credit - ensure organizationId is explicitly in where clause
      const updatedCredit = await tx.credit.update({
        where: {
          id: creditId,
          organizationId: organizationId, // Required for tenant-scoped model
        },
        data: {
          paidAmount: newPaidAmount,
          lastPaymentDate: new Date(),
          status: newStatus,
          // Clear reminder if fully paid
          nextReminderDate:
            newStatus === CreditStatus.PAID
              ? null
              : credit.reminderFrequency
                ? this.calculateNextReminderDate(new Date(), credit.reminderFrequency)
                : credit.nextReminderDate,
        },
        include: {
          customer: {
            select: { id: true, fullName: true, customerCode: true },
          },
        },
      });

      const remainingBalance = Number(totalAmount) - Number(newPaidAmount);
      this.logger.log(
        `Transaction added: ${transaction.id} for credit ${creditId}, new status: ${newStatus}, remaining balance: ${remainingBalance}`,
      );

      return {
        transaction,
        credit: updatedCredit,
        remainingBalance,
      };
    });
  }

  async getTransactions(creditId: string, organizationId: string) {
    this.logger.debug(`Fetching transactions for credit ${creditId}`);
    this.logger.debug(`Fetching transactions for credit ${creditId}`);

    const credit = await this.prisma.credit.findFirst({
      where: {
        id: creditId,
        organizationId,
        deletedAt: null,
      },
    });

    if (!credit) {
      this.logger.warn(`Credit not found: ${creditId} for organization ${organizationId}`);
      throw new NotFoundException('Credit not found');
    }

    const transactions = await this.prisma.creditTransaction.findMany({
      where: {
        creditId,
        organizationId, // Required for tenant-scoped model
      },
      orderBy: { transactionDate: 'desc' },
      include: {
        createdBy: {
          select: { id: true, fullName: true, email: true },
        },
      },
    });

    this.logger.debug(`Found ${transactions.length} transactions for credit ${creditId}`);
    return transactions;
  }

  async updateTransaction(
    creditId: string,
    transactionId: string,
    updateDto: UpdateCreditTransactionDto,
    user: CurrentUserData,
  ) {
    const transaction = await this.prisma.creditTransaction.findFirst({
      where: {
        id: transactionId,
        creditId,
        organizationId: user.organizationId,
      },
      include: { credit: true },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    if (transaction.credit.deletedAt) {
      throw new BadRequestException('Cannot update transaction on deleted credit');
    }

    // If amount is being changed, recalculate credit totals
    if (updateDto.amount !== undefined) {
      const oldAmount = transaction.amount;
      const newAmount = new Decimal(updateDto.amount);
      const difference = newAmount.sub(oldAmount);
      const newPaidAmount = transaction.credit.paidAmount.add(difference);

      if (newPaidAmount.greaterThan(transaction.credit.totalAmount)) {
        throw new BadRequestException('Updated amount would exceed total credit amount');
      }

      if (newPaidAmount.lessThan(0)) {
        throw new BadRequestException('Updated amount would result in negative paid amount');
      }

      return this.prisma.$transaction(async (tx) => {
        const updatedTransaction = await tx.creditTransaction.update({
          where: {
            id: transactionId,
            organizationId: user.organizationId, // Required for tenant-scoped model
          },
          data: {
            amount: newAmount,
            transactionDate: updateDto.transactionDate
              ? new Date(updateDto.transactionDate)
              : undefined,
            paymentMethod: updateDto.paymentMethod,
            referenceNumber: updateDto.referenceNumber,
            collectedBy: updateDto.collectedBy,
            notes: updateDto.notes,
          },
        });

        const newStatus = newPaidAmount.greaterThanOrEqualTo(transaction.credit.totalAmount)
          ? CreditStatus.PAID
          : CreditStatus.ACTIVE;

        await tx.credit.update({
          where: {
            id: creditId,
            organizationId: user.organizationId, // Required for tenant-scoped model
          },
          data: {
            paidAmount: newPaidAmount,
            status: newStatus,
            nextReminderDate: newStatus === CreditStatus.PAID ? null : undefined,
          },
        });

        return updatedTransaction;
      });
    }

    // No amount change, simple update
    return this.prisma.creditTransaction.update({
      where: {
        id: transactionId,
        organizationId: user.organizationId, // Required for tenant-scoped model
      },
      data: {
        transactionDate: updateDto.transactionDate
          ? new Date(updateDto.transactionDate)
          : undefined,
        paymentMethod: updateDto.paymentMethod,
        referenceNumber: updateDto.referenceNumber,
        collectedBy: updateDto.collectedBy,
        notes: updateDto.notes,
      },
    });
  }

  async deleteTransaction(creditId: string, transactionId: string, user: CurrentUserData) {
    const transaction = await this.prisma.creditTransaction.findFirst({
      where: {
        id: transactionId,
        creditId,
        organizationId: user.organizationId,
      },
      include: { credit: true },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    if (transaction.credit.deletedAt) {
      throw new BadRequestException('Cannot delete transaction on deleted credit');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.creditTransaction.delete({
        where: {
          id: transactionId,
          organizationId: user.organizationId, // Required for tenant-scoped model
        },
      });

      const newPaidAmount = transaction.credit.paidAmount.sub(transaction.amount);
      const newStatus = newPaidAmount.greaterThanOrEqualTo(transaction.credit.totalAmount)
        ? CreditStatus.PAID
        : CreditStatus.ACTIVE;

      // Find last remaining payment date
      const lastTransaction = await tx.creditTransaction.findFirst({
        where: {
          creditId,
          organizationId: user.organizationId, // Required for tenant-scoped model
        },
        orderBy: { transactionDate: 'desc' },
      });

      await tx.credit.update({
        where: {
          id: creditId,
          organizationId: user.organizationId, // Required for tenant-scoped model
        },
        data: {
          paidAmount: newPaidAmount,
          status: newStatus,
          lastPaymentDate: lastTransaction?.transactionDate || null,
        },
      });
    });
  }

  // ===========================
  // REMINDERS
  // ===========================

  async getDueReminders(organizationId: string, daysAhead: number = 7) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + daysAhead);

    // Skip credits that had a payment very recently (within 2 days)
    // const recentPaymentThreshold = new Date(today);
    // recentPaymentThreshold.setDate(recentPaymentThreshold.getDate() - 2);

    const credits = await this.prisma.credit.findMany({
      where: {
        organizationId,
        deletedAt: null,
        status: { in: [CreditStatus.ACTIVE, CreditStatus.OVERDUE] },
        AND: [
          {
            OR: [
              // Next reminder is due (has reminder date and it's due or past)
              {
                AND: [
                  { nextReminderDate: { not: null } },
                  { nextReminderDate: { lte: futureDate } },
                ],
              },
              // Expected due date passed (overdue) - show even if no reminder date set
              { expectedDueDate: { lte: today, not: null } },
            ],
          },
          // {
          //     // Exclude if paid recently (within 2 days)
          //     // OR: [
          //     //     { lastPaymentDate: null },
          //     //     // { lastPaymentDate: { lt: recentPaymentThreshold } },
          //     // ],
          // },
        ],
      },
      include: {
        customer: {
          select: {
            id: true,
            fullName: true,
            customerCode: true,
            contactDetails: {
              where: { deletedAt: null },
              select: { primaryPhone: true },
              take: 1,
            },
          },
        },
      },
      orderBy: [{ expectedDueDate: 'asc' }, { nextReminderDate: 'asc' }],
    });

    this.logger.log(
      `Found ${credits.length} credits with due reminders for organization ${organizationId}`,
    );

    return credits.map((credit) => ({
      ...credit,
      remainingBalance: Number(credit.totalAmount) - Number(credit.paidAmount),
      daysOverdue: credit.expectedDueDate
        ? Math.max(
            0,
            Math.floor(
              (today.getTime() - credit.expectedDueDate.getTime()) / (1000 * 60 * 60 * 24),
            ),
          )
        : null,
    }));
  }

  // ===========================
  // STATS & REPORTING
  // ===========================

  async getStats(organizationId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startOfYear = new Date(today.getFullYear(), 0, 1);
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sixtyDaysAgo = new Date(today);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const ninetyDaysAgo = new Date(today);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const [
      totalCredits,
      activeCredits,
      overdueCredits,
      paidCredits,
      creditsThisMonth,
      creditsThisYear,
      transactionsThisMonth,
      overdue30,
      overdue60,
      overdue90,
      topDebtors,
    ] = await Promise.all([
      // Total credits
      this.prisma.credit.aggregate({
        where: { organizationId, deletedAt: null },
        _sum: { totalAmount: true, paidAmount: true },
        _count: true,
      }),
      // Active credits
      this.prisma.credit.aggregate({
        where: { organizationId, deletedAt: null, status: CreditStatus.ACTIVE },
        _sum: { totalAmount: true, paidAmount: true },
        _count: true,
      }),
      // Overdue credits
      this.prisma.credit.aggregate({
        where: { organizationId, deletedAt: null, status: CreditStatus.OVERDUE },
        _sum: { totalAmount: true, paidAmount: true },
        _count: true,
      }),
      // Paid credits
      this.prisma.credit.aggregate({
        where: { organizationId, deletedAt: null, status: CreditStatus.PAID },
        _sum: { totalAmount: true, paidAmount: true },
        _count: true,
      }),
      // Credits this month
      this.prisma.credit.aggregate({
        where: {
          organizationId,
          deletedAt: null,
          creditDate: { gte: startOfMonth },
        },
        _sum: { totalAmount: true },
        _count: true,
      }),
      // Credits this year
      this.prisma.credit.aggregate({
        where: {
          organizationId,
          deletedAt: null,
          creditDate: { gte: startOfYear },
        },
        _sum: { totalAmount: true },
        _count: true,
      }),
      // Transactions (recovery) this month
      this.prisma.creditTransaction.aggregate({
        where: {
          organizationId,
          transactionDate: { gte: startOfMonth },
        },
        _sum: { amount: true },
        _count: true,
      }),
      // Overdue by age buckets
      this.prisma.credit.count({
        where: {
          organizationId,
          deletedAt: null,
          status: { in: [CreditStatus.ACTIVE, CreditStatus.OVERDUE] },
          expectedDueDate: { lt: today, gte: thirtyDaysAgo },
        },
      }),
      this.prisma.credit.count({
        where: {
          organizationId,
          deletedAt: null,
          status: { in: [CreditStatus.ACTIVE, CreditStatus.OVERDUE] },
          expectedDueDate: { lt: thirtyDaysAgo, gte: sixtyDaysAgo },
        },
      }),
      this.prisma.credit.count({
        where: {
          organizationId,
          deletedAt: null,
          status: { in: [CreditStatus.ACTIVE, CreditStatus.OVERDUE] },
          expectedDueDate: { lt: sixtyDaysAgo },
        },
      }),
      // Top 10 debtors by outstanding amount
      this.prisma.$queryRaw`
        SELECT 
          c.id as "customerId",
          c."fullName" as "customerName",
          c."customerCode",
          SUM(cr."totalAmount" - cr."paidAmount") as "outstandingAmount",
          COUNT(cr.id) as "activeCreditsCount"
        FROM "Credit" cr
        JOIN "Customer" c ON cr."customerId" = c.id
        WHERE cr."organizationId" = ${organizationId}
          AND cr."deletedAt" IS NULL
          AND cr.status IN ('ACTIVE', 'OVERDUE')
        GROUP BY c.id, c."fullName", c."customerCode"
        HAVING SUM(cr."totalAmount" - cr."paidAmount") > 0
        ORDER BY SUM(cr."totalAmount" - cr."paidAmount") DESC
        LIMIT 10
      `,
    ]);

    const totalOutstanding =
      Number(activeCredits._sum.totalAmount || 0) -
      Number(activeCredits._sum.paidAmount || 0) +
      Number(overdueCredits._sum.totalAmount || 0) -
      Number(overdueCredits._sum.paidAmount || 0);

    const recoveryThisMonth = Number(transactionsThisMonth._sum.amount || 0);
    const issuedThisMonth = Number(creditsThisMonth._sum.totalAmount || 0);
    const recoveryRate = issuedThisMonth > 0 ? (recoveryThisMonth / issuedThisMonth) * 100 : 0;

    const stats = {
      exposure: {
        totalCreditsIssued: Number(totalCredits._sum.totalAmount || 0),
        totalCreditsCount: totalCredits._count,
        creditsIssuedThisMonth: issuedThisMonth,
        creditsCountThisMonth: creditsThisMonth._count,
        creditsIssuedThisYear: Number(creditsThisYear._sum.totalAmount || 0),
        creditsCountThisYear: creditsThisYear._count,
        totalOutstanding,
      },
      recovery: {
        totalRecovered: Number(paidCredits._sum.paidAmount || 0),
        recoveredThisMonth: recoveryThisMonth,
        transactionsThisMonth: transactionsThisMonth._count,
        recoveryRateThisMonth: Math.round(recoveryRate * 100) / 100,
      },
      risk: {
        activeCreditsCount: activeCredits._count,
        overdueCreditsCount: overdueCredits._count,
        overdueAmount:
          Number(overdueCredits._sum.totalAmount || 0) -
          Number(overdueCredits._sum.paidAmount || 0),
        overdueBuckets: {
          '0-30days': overdue30,
          '30-60days': overdue60,
          '60+days': overdue90,
        },
        topDebtors,
      },
    };

    this.logger.debug(
      `Stats calculated for organization ${organizationId}: ${stats.exposure.totalOutstanding} outstanding, ${stats.risk.overdueCreditsCount} overdue`,
    );
    return stats;
  }

  // ===========================
  // CUSTOMER CREDIT SUMMARY
  // ===========================

  async getCustomerCreditSummary(customerId: string, organizationId: string) {
    const credits = await this.prisma.credit.findMany({
      where: {
        customerId,
        organizationId,
        deletedAt: null,
      },
      include: {
        transactions: true,
      },
    });

    if (credits.length === 0) {
      return {
        totalActiveUdhar: 0,
        openCreditsCount: 0,
        totalCreditsEver: 0,
        totalRepaid: 0,
        oldestUnpaidDays: null,
        lastPaymentDate: null,
        overdueCount: 0,
        behaviorTag: 'CLEAR' as const,
        riskLevel: 'LOW' as const,
      };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Active credits: ACTIVE or OVERDUE status, and not fully paid
    const activeCredits = credits.filter((c) => {
      const isActiveStatus = c.status === CreditStatus.ACTIVE || c.status === CreditStatus.OVERDUE;
      const isNotFullyPaid = Number(c.totalAmount) > Number(c.paidAmount);
      return isActiveStatus && isNotFullyPaid;
    });

    // Overdue credits: either status is OVERDUE, OR expectedDueDate has passed and not fully paid
    const overdueCredits = credits.filter((c) => {
      const isOverdueStatus = c.status === CreditStatus.OVERDUE;
      const isPastDueDate = c.expectedDueDate && new Date(c.expectedDueDate) < today;
      const isNotFullyPaid = Number(c.totalAmount) > Number(c.paidAmount);
      return isOverdueStatus || (isPastDueDate && isNotFullyPaid);
    });

    const totalActiveUdhar = activeCredits.reduce(
      (sum, c) => sum + Number(c.totalAmount) - Number(c.paidAmount),
      0,
    );

    const totalRepaid = credits.reduce((sum, c) => sum + Number(c.paidAmount), 0);
    const totalCreditsEver = credits.reduce((sum, c) => sum + Number(c.totalAmount), 0);

    // Find oldest unpaid credit (check both status and due date)
    let oldestUnpaidDays: number | null = null;
    for (const credit of activeCredits) {
      // Check if credit is overdue by due date
      if (credit.expectedDueDate) {
        const dueDate = new Date(credit.expectedDueDate);
        dueDate.setHours(0, 0, 0, 0);
        if (dueDate < today) {
          const days = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
          if (oldestUnpaidDays === null || days > oldestUnpaidDays) {
            oldestUnpaidDays = days;
          }
        }
      }
    }

    // Find last payment date
    let lastPaymentDate: Date | null = null;
    for (const credit of credits) {
      if (credit.lastPaymentDate) {
        if (!lastPaymentDate || credit.lastPaymentDate > lastPaymentDate) {
          lastPaymentDate = credit.lastPaymentDate;
        }
      }
    }

    // Calculate behavior tag
    let behaviorTag: 'CLEAR' | 'REGULAR' | 'DELAYED' | 'RISKY';
    if (activeCredits.length === 0) {
      behaviorTag = 'CLEAR';
    } else if (overdueCredits.length === 0) {
      behaviorTag = 'REGULAR';
    } else if (oldestUnpaidDays && oldestUnpaidDays > 30) {
      behaviorTag = 'RISKY';
    } else {
      behaviorTag = 'DELAYED';
    }

    // Calculate risk level (LOW / MEDIUM / HIGH / VERY_HIGH)
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
    if (activeCredits.length === 0) {
      // No active credits - low risk
      riskLevel = 'LOW';
    } else if (overdueCredits.length === 0) {
      // Active credits but none overdue - low to medium risk
      // Consider multiple open credits as medium risk
      riskLevel = activeCredits.length > 2 ? 'MEDIUM' : 'LOW';
    } else {
      // Has overdue credits - assess severity
      const overdueRatio = overdueCredits.length / activeCredits.length;
      const totalOverdueAmount = overdueCredits.reduce(
        (sum, c) => sum + Number(c.totalAmount) - Number(c.paidAmount),
        0,
      );
      const overdueRatioOfTotal = totalCreditsEver > 0 ? totalOverdueAmount / totalCreditsEver : 0;

      if (oldestUnpaidDays && oldestUnpaidDays > 90) {
        // Very old overdue (>90 days) - very high risk
        riskLevel = 'VERY_HIGH';
      } else if (oldestUnpaidDays && oldestUnpaidDays > 60) {
        // Old overdue (60-90 days) - high risk
        riskLevel = 'HIGH';
      } else if (oldestUnpaidDays && oldestUnpaidDays > 30) {
        // Moderate overdue (30-60 days) - medium to high risk
        riskLevel = overdueRatio > 0.5 || overdueRatioOfTotal > 0.3 ? 'HIGH' : 'MEDIUM';
      } else {
        // Recent overdue (<30 days) - medium risk
        riskLevel = overdueRatio > 0.5 ? 'MEDIUM' : 'LOW';
      }
    }

    const summary = {
      totalActiveUdhar,
      openCreditsCount: activeCredits.length,
      totalCreditsEver,
      totalRepaid,
      oldestUnpaidDays,
      lastPaymentDate,
      overdueCount: overdueCredits.length,
      behaviorTag,
      riskLevel,
    };

    this.logger.debug(
      `Customer credit summary: riskLevel=${summary.riskLevel}, activeUdhar=${summary.totalActiveUdhar}, overdueCount=${summary.overdueCount}`,
    );
    return summary;
  }

  // ===========================
  // HELPERS
  // ===========================

  private calculateNextReminderDate(fromDate: Date, frequency: string): Date {
    const next = new Date(fromDate);
    switch (frequency) {
      case 'WEEKLY':
        next.setDate(next.getDate() + 7);
        break;
      case 'BIWEEKLY':
        next.setDate(next.getDate() + 14);
        break;
      case 'MONTHLY':
        next.setMonth(next.getMonth() + 1);
        break;
      case 'CUSTOM':
      default:
        next.setDate(next.getDate() + 7); // Default to weekly
        break;
    }
    return next;
  }

  // Update overdue statuses (can be called by a cron job)
  async updateOverdueStatuses(organizationId?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const where: Prisma.CreditWhereInput = {
      deletedAt: null,
      status: CreditStatus.ACTIVE,
      expectedDueDate: { lt: today },
    };

    if (organizationId) {
      where.organizationId = organizationId;
    }

    return this.prisma.credit.updateMany({
      where,
      data: { status: CreditStatus.OVERDUE },
    });
  }
}
