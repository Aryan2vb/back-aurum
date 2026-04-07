import { Injectable, NotFoundException, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCreditDto } from './dto/create-credit.dto';
import { UpdateCreditDto } from './dto/update-credit.dto';
import { CreateCreditTransactionDto } from './dto/create-credit-transaction.dto';
import { UpdateCreditTransactionDto } from './dto/update-credit-transaction.dto';
import { QueryCreditsDto } from './dto/query-credits.dto';
import { CurrentUserData } from '../auth/current-user.decorator';
import { CreditStatus, LedgerType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);

  constructor(private prisma: PrismaService) {
    this.logger.log('CreditsService initialized in Pure Ledger mode');
  }

  // ===========================
  // UDHAR CRUD (PURE LEDGER)
  // ===========================

  async create(createCreditDto: CreateCreditDto, user: CurrentUserData) {
    this.logger.log(`Creating udhar for customer ${createCreditDto.customerId}`);
    const { customerId, totalAmount, initialPayment, creditDate, invoiceId, ...rest } =
      createCreditDto;

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId: user.organizationId, deletedAt: null },
    });

    if (!customer) throw new NotFoundException('Customer not found');

    const paidAmount = initialPayment || 0;
    const status = paidAmount >= totalAmount ? CreditStatus.PAID : CreditStatus.ACTIVE;

    let nextReminderDate: Date | null = null;
    if (rest.reminderFrequency && status !== CreditStatus.PAID) {
      nextReminderDate = this.calculateNextReminderDate(new Date(), rest.reminderFrequency);
    }

    const createdAt = creditDate ? new Date(creditDate) : new Date();

    return this.prisma.$transaction(async (tx) => {
      const ledgerEntry = await tx.ledgerEntry.create({
        data: {
          organizationId: user.organizationId,
          customerId,
          amount: new Decimal(totalAmount),
          type: LedgerType.UDHAR,
          description: rest.description || rest.itemSummary || 'Direct Udhar',
          createdById: user.userId,
          createdAt,
          udharEntry: {
            create: {
              organizationId: user.organizationId,
              customerId,
              amount: new Decimal(totalAmount),
              paidAmount: new Decimal(paidAmount),
              status,
              dueDate: rest.expectedDueDate ? new Date(rest.expectedDueDate) : null,
              notes: rest.notes,
              reminderFrequency: rest.reminderFrequency,
              nextReminderDate,
              createdAt,
              invoiceId,
            },
          },
        },
        include: {
          udharEntry: true,
          customer: { select: { id: true, fullName: true, customerCode: true } },
        },
      });

      return ledgerEntry;
    });
  }

  async findAll(queryDto: QueryCreditsDto, organizationId: string) {
    const {
      customerId,
      status,
      overdueOnly,
      dueBefore,
      dueAfter,
      search,
      page = 1,
      limit = 20,
      sortOrder = 'desc',
    } = queryDto;

    const where: any = { organizationId, deletedAt: null };
    if (customerId) where.customerId = customerId;
    if (status) where.status = status;
    if (overdueOnly) where.status = CreditStatus.OVERDUE;
    if (dueBefore) where.dueDate = { lte: new Date(dueBefore) };
    if (dueAfter) where.dueDate = { ...where.dueDate, gte: new Date(dueAfter) };

    if (search) {
      where.OR = [
        { notes: { contains: search, mode: 'insensitive' } },
        { ledgerEntry: { description: { contains: search, mode: 'insensitive' } } },
        { customer: { fullName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.udharEntry.findMany({
        where,
        include: {
          ledgerEntry: true,
          customer: { select: { id: true, fullName: true, customerCode: true } },
        },
        orderBy: { createdAt: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.udharEntry.count({ where }),
    ]);

    const mapped = data.map((u) => ({
      id: u.id,
      customerId: u.customerId,
      itemSummary: u.ledgerEntry?.description || 'Udhar',
      description: u.ledgerEntry?.description || 'Udhar',
      totalAmount: u.amount,
      paidAmount: u.paidAmount,
      creditDate: u.createdAt,
      expectedDueDate: u.dueDate,
      status: u.status,
      customer: u.customer,
      isNewSystem: true,
      remainingBalance: Number(u.amount) - Number(u.paidAmount),
    }));

    return { data: mapped, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string, organizationId: string) {
    const udhar = await this.prisma.udharEntry.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: {
        ledgerEntry: {
          include: { createdBy: { select: { id: true, fullName: true, email: true } } },
        },
        customer: { select: { id: true, fullName: true, customerCode: true } },
      },
    });

    if (!udhar) throw new NotFoundException('Udhar not found');

    const payments = await this.getUdharPayments(id, organizationId);
    return {
      id: udhar.id,
      customerId: udhar.customerId,
      itemSummary: udhar.ledgerEntry.description,
      totalAmount: udhar.amount,
      paidAmount: udhar.paidAmount,
      remainingBalance: Number(udhar.amount) - Number(udhar.paidAmount),
      creditDate: udhar.createdAt,
      expectedDueDate: udhar.dueDate,
      status: udhar.status,
      customer: udhar.customer,
      transactions: payments.map((p: any) => ({
        id: p.id,
        amount: p.amount,
        transactionDate: p.createdAt,
        notes: p.description,
        paymentMethod: p.paymentMethod || 'OTHER',
      })),
      createdBy: udhar.ledgerEntry.createdBy,
      isNewSystem: true,
    };
  }

  async update(id: string, dto: UpdateCreditDto, user: CurrentUserData) {
    const udhar = await this.prisma.udharEntry.findFirst({
      where: { id, organizationId: user.organizationId },
      include: { ledgerEntry: true },
    });
    if (!udhar) throw new NotFoundException('Udhar not found');

    const updateData: any = {
      notes: dto.notes,
      dueDate: dto.expectedDueDate ? new Date(dto.expectedDueDate) : undefined,
    };

    // Robust editing: if amount, description or date changes, update ledger too
    return this.prisma.$transaction(async (tx) => {
      const ledgerUpdate: any = {};
      if (dto.description) ledgerUpdate.description = dto.description;
      if (dto.totalAmount) {
        const newTotal = new Decimal(dto.totalAmount);
        if (newTotal.lessThan(udhar.paidAmount)) {
          throw new BadRequestException(
            `Cannot set total amount (${dto.totalAmount}) below already paid amount (${udhar.paidAmount})`,
          );
        }
        ledgerUpdate.amount = newTotal;
        updateData.amount = newTotal;
      }
      if (dto.creditDate) {
        ledgerUpdate.createdAt = new Date(dto.creditDate);
        updateData.createdAt = new Date(dto.creditDate);
      }

      if (Object.keys(ledgerUpdate).length > 0) {
        await tx.ledgerEntry.update({
          where: { id: udhar.ledgerEntryId, organizationId: user.organizationId },
          data: ledgerUpdate,
        });
      }

      // Sync status if amount changed and now matches paid
      if (dto.totalAmount) {
        const newTotal = new Decimal(dto.totalAmount);
        updateData.status = udhar.paidAmount.gte(newTotal)
          ? CreditStatus.PAID
          : CreditStatus.ACTIVE;
      }

      if (dto.status) updateData.status = dto.status;

      return tx.udharEntry.update({
        where: { id, organizationId: user.organizationId },
        data: updateData,
      });
    });
  }

  async softDelete(id: string, user: CurrentUserData, forceDelete: boolean = false) {
    const udhar = await this.prisma.udharEntry.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!udhar) throw new NotFoundException('Udhar not found');

    if (forceDelete) {
      return this.prisma.$transaction([
        this.prisma.udharEntry.delete({ where: { id, organizationId: user.organizationId } }),
        this.prisma.ledgerEntry.delete({
          where: { id: udhar.ledgerEntryId, organizationId: user.organizationId },
        }),
      ]);
    }

    return this.prisma.$transaction([
      this.prisma.udharEntry.update({
        where: { id, organizationId: user.organizationId },
        data: { deletedAt: new Date(), status: CreditStatus.CANCELLED },
      }),
      this.prisma.ledgerEntry.update({
        where: { id: udhar.ledgerEntryId, organizationId: user.organizationId },
        data: { deletedAt: new Date() },
      }),
    ]);
  }

  // ===========================
  // TRANSACTIONS
  // ===========================

  async addTransaction(udharId: string, dto: CreateCreditTransactionDto, user: CurrentUserData) {
    return this.addUdharPayment(udharId, dto, user);
  }

  async getTransactions(udharId: string, organizationId: string) {
    return this.getUdharPayments(udharId, organizationId);
  }

  async updateTransaction(
    udharId: string,
    transactionId: string,
    dto: UpdateCreditTransactionDto,
    user: CurrentUserData,
  ) {
    const payment = await this.prisma.ledgerEntry.findFirst({
      where: {
        id: transactionId,
        entityId: udharId,
        organizationId: user.organizationId,
        type: LedgerType.PAYMENT,
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    const newAmount = dto.amount ? new Decimal(dto.amount) : payment.amount;
    const diff = newAmount.sub(payment.amount);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.ledgerEntry.update({
        where: { id: transactionId, organizationId: user.organizationId },
        data: {
          amount: newAmount,
          description: dto.notes || payment.description,
          createdAt: dto.transactionDate ? new Date(dto.transactionDate) : undefined,
        },
      });

      const udhar = await tx.udharEntry.findUnique({
        where: { id: udharId, organizationId: user.organizationId },
      });
      const newPaid = udhar.paidAmount.add(diff);

      await tx.udharEntry.update({
        where: { id: udharId, organizationId: user.organizationId },
        data: {
          paidAmount: newPaid,
          status: newPaid.gte(udhar.amount) ? CreditStatus.PAID : CreditStatus.ACTIVE,
        },
      });

      return updated;
    });
  }

  async deleteTransaction(udharId: string, transactionId: string, user: CurrentUserData) {
    const payment = await this.prisma.ledgerEntry.findFirst({
      where: {
        id: transactionId,
        entityId: udharId,
        organizationId: user.organizationId,
        type: LedgerType.PAYMENT,
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    return this.prisma.$transaction(async (tx) => {
      const udhar = await tx.udharEntry.findUnique({
        where: { id: udharId, organizationId: user.organizationId },
      });
      if (!udhar) throw new NotFoundException('Udhar not found');

      const newPaid = udhar.paidAmount.sub(payment.amount);
      if (newPaid.lessThan(0)) {
        throw new BadRequestException(
          'Cannot delete payment: would result in negative paid amount',
        );
      }

      await tx.ledgerEntry.delete({
        where: { id: transactionId, organizationId: user.organizationId },
      });

      const newStatus = newPaid.greaterThanOrEqualTo(udhar.amount)
        ? CreditStatus.PAID
        : udhar.status === CreditStatus.OVERDUE
          ? CreditStatus.OVERDUE
          : CreditStatus.ACTIVE;

      await tx.udharEntry.update({
        where: { id: udharId, organizationId: user.organizationId },
        data: {
          paidAmount: newPaid,
          status: newStatus,
        },
      });
    });
  }

  // ===========================
  // HELPERS & STATS
  // ===========================

  async getDueReminders(organizationId: string, daysAhead: number = 7) {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);

    return this.prisma.udharEntry.findMany({
      where: {
        organizationId,
        deletedAt: null,
        status: { in: [CreditStatus.ACTIVE, CreditStatus.OVERDUE] },
        OR: [
          { dueDate: { lte: futureDate } },
          { nextReminderDate: { lte: futureDate, not: null } },
        ],
      },
      include: { ledgerEntry: true, customer: { select: { id: true, fullName: true } } },
    });
  }

  async getStats(organizationId: string) {
    const stats = await this.prisma.udharEntry.aggregate({
      where: { organizationId, deletedAt: null },
      _sum: { amount: true, paidAmount: true },
      _count: true,
    });

    const activeCount = await this.prisma.udharEntry.count({
      where: {
        organizationId,
        deletedAt: null,
        status: { in: [CreditStatus.ACTIVE, CreditStatus.OVERDUE] },
      },
    });

    const totalIssued = Number(stats._sum.amount || 0);
    const totalPaid = Number(stats._sum.paidAmount || 0);

    return {
      exposure: {
        totalCreditsIssued: totalIssued,
        totalOutstanding: totalIssued - totalPaid,
      },
      risk: {
        activeCreditsCount: activeCount,
      },
    };
  }

  async getCustomerCreditSummary(customerId: string, organizationId: string) {
    const udhars = await this.prisma.udharEntry.findMany({
      where: { customerId, organizationId, deletedAt: null },
    });
    const outstanding = udhars.reduce((s, u) => s + Number(u.amount) - Number(u.paidAmount), 0);
    return {
      totalActiveUdhar: outstanding,
      riskLevel: outstanding > 50000 ? 'HIGH' : 'LOW',
    };
  }

  async getCustomerLedger(customerId: string, organizationId: string) {
    return this.prisma.ledgerEntry.findMany({
      where: { customerId, organizationId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { udharEntry: true },
    });
  }

  async getCustomerUdharEntries(customerId: string, organizationId: string) {
    return this.prisma.udharEntry.findMany({
      where: { customerId, organizationId, deletedAt: null },
      include: { ledgerEntry: true },
    });
  }

  async addUdharPayment(udharId: string, dto: CreateCreditTransactionDto, user: CurrentUserData) {
    const udhar = await this.prisma.udharEntry.findFirst({
      where: {
        id: udharId,
        organizationId: user.organizationId,
        status: { not: CreditStatus.CANCELLED },
        deletedAt: null,
      },
    });
    if (!udhar) throw new NotFoundException('Udhar not found or inactive');

    const amount = new Decimal(dto.amount);
    const totalPaid = udhar.paidAmount.add(amount);

    return this.prisma.$transaction(async (tx) => {
      await tx.udharEntry.update({
        where: { id: udharId, organizationId: user.organizationId },
        data: {
          paidAmount: totalPaid,
          status: totalPaid.gte(udhar.amount) ? CreditStatus.PAID : CreditStatus.ACTIVE,
        },
      });

      return tx.ledgerEntry.create({
        data: {
          organizationId: user.organizationId,
          customerId: udhar.customerId,
          amount,
          type: LedgerType.PAYMENT,
          description: dto.notes || 'Payment',
          entityId: udharId,
          createdById: user.userId,
        },
      });
    });
  }

  async getUdharPayments(udharId: string, organizationId: string) {
    return this.prisma.ledgerEntry.findMany({
      where: { organizationId, entityId: udharId, type: LedgerType.PAYMENT, deletedAt: null },
    });
  }

  private calculateNextReminderDate(fromDate: Date, frequency: string): Date {
    const next = new Date(fromDate);
    if (frequency === 'WEEKLY') next.setDate(next.getDate() + 7);
    else if (frequency === 'MONTHLY') next.setMonth(next.getMonth() + 1);
    else next.setDate(next.getDate() + 7);
    return next;
  }

  async updateOverdueStatuses(organizationId?: string) {
    const where: any = { status: CreditStatus.ACTIVE, dueDate: { lt: new Date() } };
    if (organizationId) where.organizationId = organizationId;
    return this.prisma.udharEntry.updateMany({ where, data: { status: CreditStatus.OVERDUE } });
  }
}
