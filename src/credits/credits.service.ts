import { Injectable, NotFoundException, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCreditDto } from './dto/create-credit.dto';
import { UpdateCreditDto } from './dto/update-credit.dto';
import { CreateCreditTransactionDto } from './dto/create-credit-transaction.dto';
import { UpdateCreditTransactionDto } from './dto/update-credit-transaction.dto';
import { QueryCreditsDto } from './dto/query-credits.dto';
import { CurrentUserData } from '../auth/current-user.decorator';
import {
  CreditStatus,
  FinancialTransactionType,
  LedgerType,
  PaymentMethod,
  BankStatementLineStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { FinanceService } from '../finance/finance.service';

@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);

  constructor(
    private prisma: PrismaService,
    private financeService: FinanceService,
  ) {
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
      where: { id, organizationId: user.organizationId, deletedAt: null },
      include: { ledgerEntry: true },
    });
    if (!udhar) throw new NotFoundException('Udhar not found');

    const updateData: any = {
      notes: dto.notes,
      dueDate: dto.expectedDueDate ? new Date(dto.expectedDueDate) : undefined,
    };

    return this.prisma.$transaction(async (tx) => {
      const ledgerUpdate: any = {};
      if (dto.description) ledgerUpdate.description = dto.description;
      if (dto.totalAmount !== undefined) {
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

      // Sync status if amount changed
      if (dto.totalAmount !== undefined) {
        const newTotal = new Decimal(dto.totalAmount);
        updateData.status = udhar.paidAmount.gte(newTotal)
          ? CreditStatus.PAID
          : CreditStatus.ACTIVE;
      }

      // Explicit status override takes priority over derived status
      if (dto.status) updateData.status = dto.status;

      return tx.udharEntry.update({
        where: { id, organizationId: user.organizationId },
        data: updateData,
      });
    });
  }

  async softDelete(id: string, user: CurrentUserData, forceDelete: boolean = false) {
    const udhar = await this.prisma.udharEntry.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
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
    // findFirst enforces organizationId isolation (findUnique ignores extra where clauses)
    const payment = await this.prisma.ledgerEntry.findFirst({
      where: {
        id: transactionId,
        entityId: udharId,
        organizationId: user.organizationId,
        type: LedgerType.PAYMENT,
        deletedAt: null,
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    const newAmount = dto.amount !== undefined ? new Decimal(dto.amount) : payment.amount;
    const diff = newAmount.sub(payment.amount);

    return this.prisma.$transaction(async (tx) => {
      const preserveHistoricalAssignment =
        dto.paymentMethod === undefined && dto.accountId === undefined;
      const method =
        (dto.paymentMethod as PaymentMethod) ?? payment.paymentMethod ?? PaymentMethod.OTHER;
      const account = await this.financeService.resolvePaymentAccount(
        tx,
        user.organizationId,
        method,
        dto.accountId ?? payment.accountId,
        preserveHistoricalAssignment,
      );
      const updated = await tx.ledgerEntry.update({
        where: { id: transactionId, organizationId: user.organizationId },
        data: {
          amount: newAmount,
          description: dto.notes || payment.description,
          createdAt: dto.transactionDate ? new Date(dto.transactionDate) : undefined,
          paymentMethod: method,
          accountId: preserveHistoricalAssignment ? payment.accountId : (account?.id ?? null),
        },
      });

      // findFirst enforces organizationId — findUnique does not since udharId alone is unique
      const udhar = await tx.udharEntry.findFirst({
        where: { id: udharId, organizationId: user.organizationId, deletedAt: null },
      });
      if (!udhar) throw new NotFoundException('Udhar not found');

      const newPaid = udhar.paidAmount.add(diff);
      if (newPaid.lessThan(0)) {
        throw new BadRequestException(
          'Editing this payment would result in a negative paid amount',
        );
      }

      await tx.udharEntry.update({
        where: { id: udharId, organizationId: user.organizationId },
        data: {
          paidAmount: newPaid,
          status: newPaid.gte(udhar.amount) ? CreditStatus.PAID : CreditStatus.ACTIVE,
        },
      });

      // Sync payment change to linked invoice if exists
      if (udhar.invoiceId) {
        const invoice = await tx.invoice.findFirst({
          where: { id: udhar.invoiceId, organizationId: user.organizationId, deletedAt: null },
        });

        if (invoice) {
          const currentPaidAmount = new Decimal(invoice.paidAmount);
          const newInvoicePaidAmount = currentPaidAmount.add(diff);

          // Ensure we don't go negative or over total
          if (newInvoicePaidAmount.lessThan(0)) {
            throw new BadRequestException(
              'Payment adjustment would result in negative invoice paid amount',
            );
          }

          const isFullyPaid = newInvoicePaidAmount.gte(invoice.totalAmount);
          const newStatus = isFullyPaid
            ? 'PAID'
            : newInvoicePaidAmount.gt(0)
              ? 'PARTIAL'
              : 'UNPAID';

          await tx.invoice.update({
            where: { id: invoice.id, organizationId: user.organizationId },
            data: {
              paidAmount: newInvoicePaidAmount,
              status: newStatus as any,
            },
          });
          const invoicePayment = await tx.invoicePayment.findFirst({
            where: {
              invoiceId: invoice.id,
              organizationId: user.organizationId,
              ledgerEntryId: payment.id,
            },
          });
          if (invoicePayment) {
            const syncedPayment = await tx.invoicePayment.update({
              where: { id: invoicePayment.id },
              data: {
                amount: newAmount,
                mode: method,
                accountId: preserveHistoricalAssignment
                  ? invoicePayment.accountId
                  : (account?.id ?? null),
                paidAt: dto.transactionDate ? new Date(dto.transactionDate) : undefined,
                notes: dto.notes,
              },
            });
            await this.financeService.syncAutomaticPayment(
              tx,
              {
                organizationId: user.organizationId,
                sourceType: 'INVOICE_PAYMENT',
                sourceId: syncedPayment.id,
                sourceParentType: 'INVOICE',
                sourceParentId: invoice.id,
                transactionType: FinancialTransactionType.SALE_RECEIPT,
                paymentMethod: syncedPayment.mode,
                accountId: syncedPayment.accountId,
                amount: syncedPayment.amount,
                occurredAt: syncedPayment.paidAt,
                description: syncedPayment.notes,
                createdById: user.userId,
              },
              preserveHistoricalAssignment,
            );
          } else {
            await this.financeService.syncAutomaticPayment(
              tx,
              {
                organizationId: user.organizationId,
                sourceType: 'UDHAR_PAYMENT',
                sourceId: payment.id,
                sourceParentType: 'UDHAR',
                sourceParentId: udharId,
                transactionType: FinancialTransactionType.UDHAR_COLLECTION,
                paymentMethod: method,
                accountId: account?.id,
                amount: newAmount,
                occurredAt: dto.transactionDate ? new Date(dto.transactionDate) : payment.createdAt,
                description: dto.notes,
                createdById: user.userId,
              },
              preserveHistoricalAssignment,
            );
          }
        }
      } else {
        await this.syncUdharPayment(tx, updated, udharId, user, preserveHistoricalAssignment);
      }

      return updated;
    });
  }

  async deleteTransaction(udharId: string, transactionId: string, user: CurrentUserData) {
    // findFirst enforces organizationId isolation (findUnique ignores extra where clauses)
    const payment = await this.prisma.ledgerEntry.findFirst({
      where: {
        id: transactionId,
        entityId: udharId,
        organizationId: user.organizationId,
        type: LedgerType.PAYMENT,
        deletedAt: null,
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    return this.prisma.$transaction(async (tx) => {
      // findFirst enforces organizationId — findUnique does not
      const udhar = await tx.udharEntry.findFirst({
        where: { id: udharId, organizationId: user.organizationId, deletedAt: null },
      });
      if (!udhar) throw new NotFoundException('Udhar not found');

      const newPaid = udhar.paidAmount.sub(payment.amount);
      if (newPaid.lessThan(0)) {
        throw new BadRequestException(
          'Cannot delete payment: would result in negative paid amount',
        );
      }

      // Read the link before the delete: InvoicePayment.ledgerEntryId is SetNull,
      // so after deleting the ledger entry the payment can no longer be found.
      const invoicePayment = await tx.invoicePayment.findFirst({
        where: { organizationId: user.organizationId, ledgerEntryId: transactionId },
      });

      await tx.ledgerEntry.delete({
        where: { id: transactionId, organizationId: user.organizationId },
      });
      await this.financeService.reverseSource(
        tx,
        user.organizationId,
        'UDHAR_PAYMENT',
        transactionId,
      );

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

      // Sync payment deletion to linked invoice if exists
      if (udhar.invoiceId) {
        const invoice = await tx.invoice.findFirst({
          where: { id: udhar.invoiceId, organizationId: user.organizationId, deletedAt: null },
        });

        if (invoice) {
          const currentPaidAmount = new Decimal(invoice.paidAmount);
          const newInvoicePaidAmount = currentPaidAmount.sub(payment.amount);

          // Ensure we don't go negative
          if (newInvoicePaidAmount.lessThan(0)) {
            throw new BadRequestException(
              'Payment deletion would result in negative invoice paid amount',
            );
          }

          const isFullyPaid = newInvoicePaidAmount.gte(invoice.totalAmount);
          const newStatus = isFullyPaid
            ? 'PAID'
            : newInvoicePaidAmount.gt(0)
              ? 'PARTIAL'
              : 'UNPAID';

          await tx.invoice.update({
            where: { id: invoice.id, organizationId: user.organizationId },
            data: {
              paidAmount: newInvoicePaidAmount,
              status: newStatus as any,
            },
          });
          if (invoicePayment) {
            await this.financeService.reverseSource(
              tx,
              user.organizationId,
              'INVOICE_PAYMENT',
              invoicePayment.id,
            );
            await tx.bankStatementLine.updateMany({
              where: {
                organizationId: user.organizationId,
                invoicePaymentId: invoicePayment.id,
              },
              data: {
                status: BankStatementLineStatus.UNMATCHED,
                invoicePaymentId: null,
                matchedInvoiceId: null,
              },
            });
            await tx.invoicePayment.delete({ where: { id: invoicePayment.id } });
          }
        }
      }
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
    if (amount.lte(0)) {
      throw new BadRequestException('Payment amount must be greater than zero');
    }

    const remaining = udhar.amount.sub(udhar.paidAmount);
    if (amount.gt(remaining)) {
      throw new BadRequestException(
        `Payment of ₹${amount} exceeds remaining balance of ₹${remaining.toDecimalPlaces(2)}`,
      );
    }

    const totalPaid = udhar.paidAmount.add(amount);

    return this.prisma.$transaction(async (tx) => {
      const method = (dto.paymentMethod as PaymentMethod) ?? PaymentMethod.OTHER;
      const account = await this.financeService.resolvePaymentAccount(
        tx,
        user.organizationId,
        method,
        dto.accountId,
      );
      await tx.udharEntry.update({
        where: { id: udharId, organizationId: user.organizationId },
        data: {
          paidAmount: totalPaid,
          status: totalPaid.gte(udhar.amount) ? CreditStatus.PAID : CreditStatus.ACTIVE,
        },
      });

      const ledgerEntry = await tx.ledgerEntry.create({
        data: {
          organizationId: user.organizationId,
          customerId: udhar.customerId,
          amount,
          type: LedgerType.PAYMENT,
          description: dto.notes || 'Payment',
          entityId: udharId,
          createdById: user.userId,
          paymentMethod: method,
          accountId: account?.id,
          createdAt: dto.transactionDate ? new Date(dto.transactionDate) : undefined,
        },
      });

      // Sync payment to linked invoice if exists
      if (udhar.invoiceId) {
        this.logger.log(`Syncing udhar payment to invoice ${udhar.invoiceId}`);
        const invoice = await tx.invoice.findFirst({
          where: { id: udhar.invoiceId, organizationId: user.organizationId, deletedAt: null },
        });

        if (invoice) {
          const currentPaidAmount = new Decimal(invoice.paidAmount);
          const newPaidAmount = currentPaidAmount.add(amount);
          const isFullyPaid = newPaidAmount.gte(invoice.totalAmount);
          const newStatus = isFullyPaid ? 'PAID' : 'PARTIAL';

          this.logger.log(
            `Invoice ${invoice.invoiceNumber}: paid ${currentPaidAmount} -> ${newPaidAmount}, status: ${invoice.status} -> ${newStatus}`,
          );

          await tx.invoice.update({
            where: { id: invoice.id, organizationId: user.organizationId },
            data: {
              paidAmount: newPaidAmount,
              status: newStatus as any,
            },
          });

          // Also create an InvoicePayment record for consistency
          const invoicePayment = await tx.invoicePayment.create({
            data: {
              invoiceId: invoice.id,
              organizationId: user.organizationId,
              mode: method,
              accountId: account?.id,
              amount,
              ledgerEntryId: ledgerEntry.id,
              reference: dto.referenceNumber,
              notes: dto.notes,
              paidAt: dto.transactionDate ? new Date(dto.transactionDate) : undefined,
            },
          });
          await this.financeService.syncAutomaticPayment(tx, {
            organizationId: user.organizationId,
            sourceType: 'INVOICE_PAYMENT',
            sourceId: invoicePayment.id,
            sourceParentType: 'INVOICE',
            sourceParentId: invoice.id,
            transactionType: FinancialTransactionType.SALE_RECEIPT,
            paymentMethod: invoicePayment.mode,
            accountId: invoicePayment.accountId,
            amount: invoicePayment.amount,
            occurredAt: invoicePayment.paidAt,
            description: invoicePayment.notes,
            createdById: user.userId,
          });
          this.logger.log(`Invoice ${invoice.id} synced successfully`);
        } else {
          this.logger.warn(`Invoice ${udhar.invoiceId} not found or deleted`);
          // Still a real collection — book it to the bank book as an udhar payment.
          await this.syncUdharPayment(tx, ledgerEntry, udharId, user);
        }
      } else {
        this.logger.log(`No invoice linked to udhar ${udharId}`);
        await this.syncUdharPayment(tx, ledgerEntry, udharId, user);
      }

      return ledgerEntry;
    });
  }

  async getUdharPayments(udharId: string, organizationId: string) {
    return this.prisma.ledgerEntry.findMany({
      where: { organizationId, entityId: udharId, type: LedgerType.PAYMENT, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async syncUdharPayment(
    tx: any,
    payment: {
      id: string;
      amount: Decimal;
      paymentMethod: PaymentMethod | null;
      accountId: string | null;
      createdAt: Date;
      description: string | null;
    },
    udharId: string,
    user: CurrentUserData,
    allowUnassignedNonCash = false,
  ) {
    await this.financeService.syncAutomaticPayment(
      tx,
      {
        organizationId: user.organizationId,
        sourceType: 'UDHAR_PAYMENT',
        sourceId: payment.id,
        sourceParentType: 'UDHAR',
        sourceParentId: udharId,
        transactionType: FinancialTransactionType.UDHAR_COLLECTION,
        paymentMethod: payment.paymentMethod ?? PaymentMethod.OTHER,
        accountId: payment.accountId,
        amount: payment.amount,
        occurredAt: payment.createdAt,
        description: payment.description,
        createdById: user.userId,
      },
      allowUnassignedNonCash,
    );
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
