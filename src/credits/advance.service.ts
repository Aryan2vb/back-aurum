import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUserData } from '../auth/current-user.decorator';
import { CreditStatus, FinancialTransactionType, LedgerType, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { ReceiveAdvanceDto } from './dto/receive-advance.dto';
import { RefundAdvanceDto } from './dto/refund-advance.dto';
import { TransferAdvanceDto } from './dto/transfer-advance.dto';
import { FinanceService } from '../finance/finance.service';

/** Ledger types that INCREASE the customer's advance credit balance. */
const ADVANCE_CREDIT_TYPES = [LedgerType.ADVANCE_RECEIVED, LedgerType.ADVANCE_TRANSFER_IN] as const;

/** Ledger types that DECREASE the customer's advance credit balance. */
const ADVANCE_DEBIT_TYPES = [
  LedgerType.ADVANCE_APPLIED,
  LedgerType.ADVANCE_TRANSFER_OUT,
  LedgerType.ADVANCE_REFUND,
] as const;

export const ALL_ADVANCE_TYPES = [...ADVANCE_CREDIT_TYPES, ...ADVANCE_DEBIT_TYPES] as const;

@Injectable()
export class AdvanceService {
  private readonly logger = new Logger(AdvanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly financeService: FinanceService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Balance query
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Returns the available advance balance for a customer.
   * Formula:
   *   balance = SUM(ADVANCE_RECEIVED) + SUM(ADVANCE_TRANSFER_IN)
   *           - SUM(ADVANCE_APPLIED)  - SUM(ADVANCE_TRANSFER_OUT)
   *           - SUM(ADVANCE_REFUND)
   */
  async getCustomerAdvanceBalance(
    customerId: string,
    organizationId: string,
  ): Promise<{ availableAdvance: Decimal }> {
    const rows = await this.prisma.ledgerEntry.groupBy({
      by: ['type'],
      where: {
        customerId,
        organizationId,
        deletedAt: null,
        type: { in: [...ALL_ADVANCE_TYPES] },
      },
      _sum: { amount: true },
    });

    let balance = new Decimal(0);
    for (const row of rows) {
      const sum = new Decimal(row._sum.amount ?? 0);
      if ((ADVANCE_CREDIT_TYPES as readonly string[]).includes(row.type)) {
        balance = balance.plus(sum);
      } else {
        balance = balance.minus(sum);
      }
    }

    return { availableAdvance: balance.lessThan(0) ? new Decimal(0) : balance };
  }

  /**
   * Same as getCustomerAdvanceBalance but runs inside an existing transaction
   * and throws BadRequestException when balance < required amount.
   */
  async _assertSufficientBalance(
    tx: Prisma.TransactionClient,
    customerId: string,
    organizationId: string,
    required: Decimal,
  ): Promise<Decimal> {
    const rows = await tx.ledgerEntry.groupBy({
      by: ['type'],
      where: {
        customerId,
        organizationId,
        deletedAt: null,
        type: { in: [...ALL_ADVANCE_TYPES] },
      },
      _sum: { amount: true },
    });

    let balance = new Decimal(0);
    for (const row of rows) {
      const sum = new Decimal(row._sum.amount ?? 0);
      if ((ADVANCE_CREDIT_TYPES as readonly string[]).includes(row.type)) {
        balance = balance.plus(sum);
      } else {
        balance = balance.minus(sum);
      }
    }

    if (balance.lessThan(required)) {
      throw new BadRequestException(
        `Insufficient advance balance. Available: ₹${balance.toDecimalPlaces(2)}, Required: ₹${required.toDecimalPlaces(2)}`,
      );
    }

    return balance;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Receive Advance
  // ─────────────────────────────────────────────────────────────────────────

  async receiveAdvance(customerId: string, dto: ReceiveAdvanceDto, user: CurrentUserData) {
    return this.prisma.$transaction(async (tx) =>
      this.receiveAdvanceIn(tx, customerId, dto, user),
    );
  }

  /** Same as receiveAdvance but participates in a caller-owned transaction (e.g. bank reconcile). */
  async receiveAdvanceIn(
    tx: Prisma.TransactionClient,
    customerId: string,
    dto: ReceiveAdvanceDto,
    user: CurrentUserData,
  ) {
    const { organizationId, userId } = user;

    const customer = await tx.customer.findFirst({
      where: { id: customerId, organizationId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const amount = new Decimal(dto.amount);
    const entryDate = this.resolveAdvanceDate(dto.receivedAt);

    const account = await this.financeService.resolvePaymentAccount(
      tx,
      organizationId,
      dto.paymentMethod,
      dto.accountId,
    );
    const ledger = await tx.ledgerEntry.create({
      data: {
        organizationId,
        customerId,
        amount,
        type: LedgerType.ADVANCE_RECEIVED,
        description: dto.notes ?? `Advance received via ${dto.paymentMethod}`,
        paymentMethod: dto.paymentMethod,
        entityId: null,
        referenceLedgerEntryId: null,
        invoiceId: null,
        createdById: userId,
        createdAt: entryDate,
        accountId: account?.id,
      },
    });
    const transaction = await this.financeService.syncAutomaticPayment(tx, {
      organizationId,
      sourceType: 'ADVANCE_LEDGER',
      sourceId: ledger.id,
      sourceParentType: 'ADVANCE',
      sourceParentId: ledger.id,
      transactionType: FinancialTransactionType.ADVANCE_RECEIPT,
      paymentMethod: dto.paymentMethod,
      accountId: ledger.accountId,
      amount: ledger.amount,
      occurredAt: ledger.createdAt,
      description: ledger.description,
      createdById: userId,
    });
    if (transaction && dto.reference) {
      await tx.financialTransaction.update({
        where: { id: transaction.id },
        data: { reference: dto.reference },
      });
    }

    this.logger.log(
      `Advance received: customer=${customerId} amount=${amount} date=${entryDate.toISOString().slice(0, 10)} ref=${dto.reference ?? '-'} ledger=${ledger.id}`,
    );

    return {
      id: ledger.id,
      customerId,
      amount: ledger.amount,
      type: ledger.type,
      paymentMethod: dto.paymentMethod,
      reference: dto.reference,
      description: ledger.description,
      createdAt: ledger.createdAt,
      transactionId: transaction?.id ?? null,
      customerName: customer.fullName,
    };
  }

  private resolveAdvanceDate(receivedAt?: string): Date {
    if (!receivedAt) return new Date();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedAt)) {
      throw new BadRequestException('receivedAt must be in YYYY-MM-DD format');
    }
    const parsed = new Date(`${receivedAt}T00:00:00.000Z`);
    if (isNaN(parsed.getTime())) {
      throw new BadRequestException('receivedAt is an invalid date');
    }
    const today = new Date();
    today.setUTCHours(23, 59, 59, 999);
    if (parsed > today) {
      throw new BadRequestException('receivedAt cannot be a future date');
    }
    return parsed;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Apply Advance to Invoice
  // ─────────────────────────────────────────────────────────────────────────

  async applyAdvanceToInvoice(
    invoiceId: string,
    amount: number,
    user: CurrentUserData,
    paidAt?: string,
    notes?: string,
  ) {
    const { organizationId, userId } = user;
    const applyAmount = new Decimal(amount);

    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId, deletedAt: null },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    if (invoice.status === 'CANCELLED') {
      throw new BadRequestException('Cannot apply advance to a cancelled invoice');
    }
    if (invoice.status === 'DRAFT') {
      throw new BadRequestException('Cannot apply advance to a draft invoice');
    }
    if (invoice.status === 'PAID') {
      throw new BadRequestException('Invoice is already fully paid');
    }

    const remaining = new Decimal(invoice.totalAmount).minus(new Decimal(invoice.paidAmount));
    if (applyAmount.greaterThan(remaining)) {
      throw new BadRequestException(
        `Advance of ₹${applyAmount} exceeds invoice remaining balance of ₹${remaining.toDecimalPlaces(2)}`,
      );
    }

    // Resolve and validate paidAt date
    const paymentDate = paidAt
      ? (() => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) {
            throw new BadRequestException('paidAt must be in YYYY-MM-DD format');
          }
          const d = new Date(`${paidAt}T00:00:00.000Z`);
          if (isNaN(d.getTime())) throw new BadRequestException('paidAt is an invalid date');
          return d;
        })()
      : new Date();

    return this.prisma.$transaction(async (tx) => {
      await this._assertSufficientBalance(tx, invoice.customerId, organizationId, applyAmount);

      const udhar = await tx.udharEntry.findFirst({
        where: {
          invoiceId,
          organizationId,
          status: { in: [CreditStatus.ACTIVE, CreditStatus.OVERDUE] },
          deletedAt: null,
        },
      });

      // 1. Create ADVANCE_APPLIED ledger entry
      const ledger = await tx.ledgerEntry.create({
        data: {
          organizationId,
          customerId: invoice.customerId,
          amount: applyAmount,
          type: LedgerType.ADVANCE_APPLIED,
          description: notes ?? `Advance applied to Invoice ${invoice.invoiceNumber ?? invoiceId}`,
          entityId: udhar?.id ?? null,
          invoiceId,
          referenceLedgerEntryId: null,
          createdById: userId,
        },
      });

      // 2. Create InvoicePayment row so the payment breakdown shows the advance
      await tx.invoicePayment.create({
        data: {
          organizationId,
          invoiceId,
          mode: 'CREDIT', // PaymentMethod.CREDIT — "advance credit used"
          amount: applyAmount,
          paidAt: paymentDate,
          notes: notes ?? 'Advance payment',
          ledgerEntryId: ledger.id,
        },
      });

      // 3. Update invoice paidAmount and status
      const newPaidAmount = new Decimal(invoice.paidAmount).plus(applyAmount);
      const isFullyPaid = newPaidAmount.greaterThanOrEqualTo(new Decimal(invoice.totalAmount));
      const newStatus = isFullyPaid ? 'PAID' : 'PARTIAL';

      await tx.invoice.update({
        where: { id: invoiceId, organizationId },
        data: { paidAmount: newPaidAmount, status: newStatus as any },
      });

      // 4. Update UdharEntry if present
      if (udhar) {
        const newUdharPaid = new Decimal(udhar.paidAmount).plus(applyAmount);
        const newUdharBalance = new Decimal(udhar.amount).minus(newUdharPaid);
        const newUdharStatus = newUdharBalance.lte(0)
          ? CreditStatus.PAID
          : udhar.status === CreditStatus.OVERDUE
            ? CreditStatus.OVERDUE
            : CreditStatus.ACTIVE;

        await tx.udharEntry.update({
          where: { id: udhar.id, organizationId },
          data: { paidAmount: newUdharPaid, status: newUdharStatus },
        });
      }

      this.logger.log(
        `Advance applied: invoice=${invoiceId} amount=${applyAmount} status=${newStatus} udhar=${udhar?.id ?? 'none'}`,
      );

      return {
        ledgerId: ledger.id,
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        advanceApplied: applyAmount,
        invoiceTotal: invoice.totalAmount,
        newPaidAmount,
        remainingPayable: new Decimal(invoice.totalAmount).minus(newPaidAmount),
        invoiceStatus: newStatus,
      };
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Transfer Advance
  // ─────────────────────────────────────────────────────────────────────────

  async transferAdvance(fromCustomerId: string, dto: TransferAdvanceDto, user: CurrentUserData) {
    const { organizationId, userId } = user;
    const transferAmount = new Decimal(dto.amount);

    if (fromCustomerId === dto.toCustomerId) {
      throw new BadRequestException('Cannot transfer advance to the same customer');
    }

    const [fromCustomer, toCustomer] = await Promise.all([
      this.prisma.customer.findFirst({
        where: { id: fromCustomerId, organizationId, deletedAt: null },
      }),
      this.prisma.customer.findFirst({
        where: { id: dto.toCustomerId, organizationId, deletedAt: null },
      }),
    ]);
    if (!fromCustomer) throw new NotFoundException('Source customer not found');
    if (!toCustomer) throw new NotFoundException('Destination customer not found');

    return this.prisma.$transaction(async (tx) => {
      await this._assertSufficientBalance(tx, fromCustomerId, organizationId, transferAmount);

      // Create TRANSFER_OUT first so we have its id for cross-linking
      const outEntry = await tx.ledgerEntry.create({
        data: {
          organizationId,
          customerId: fromCustomerId,
          amount: transferAmount,
          type: LedgerType.ADVANCE_TRANSFER_OUT,
          description: dto.notes ?? `Advance transferred to ${toCustomer.fullName}`,
          createdById: userId,
          // referenceLedgerEntryId will be updated after inEntry is created
        },
      });

      const inEntry = await tx.ledgerEntry.create({
        data: {
          organizationId,
          customerId: dto.toCustomerId,
          amount: transferAmount,
          type: LedgerType.ADVANCE_TRANSFER_IN,
          description: dto.notes ?? `Advance received from ${fromCustomer.fullName}`,
          referenceLedgerEntryId: outEntry.id,
          createdById: userId,
        },
      });

      // Back-link the OUT entry to the IN entry
      await tx.ledgerEntry.update({
        where: { id: outEntry.id, organizationId },
        data: { referenceLedgerEntryId: inEntry.id },
      });

      this.logger.log(
        `Advance transferred: from=${fromCustomerId} to=${dto.toCustomerId} amount=${transferAmount} out=${outEntry.id} in=${inEntry.id}`,
      );

      return {
        transferAmount,
        from: { customerId: fromCustomerId, ledgerId: outEntry.id },
        to: { customerId: dto.toCustomerId, ledgerId: inEntry.id },
      };
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Refund Advance
  // ─────────────────────────────────────────────────────────────────────────

  async refundAdvance(customerId: string, dto: RefundAdvanceDto, user: CurrentUserData) {
    const { organizationId, userId } = user;
    const refundAmount = new Decimal(dto.amount);

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    return this.prisma.$transaction(async (tx) => {
      await this._assertSufficientBalance(tx, customerId, organizationId, refundAmount);
      const account = await this.financeService.resolvePaymentAccount(
        tx,
        organizationId,
        dto.paymentMethod,
        dto.accountId,
      );

      const ledger = await tx.ledgerEntry.create({
        data: {
          organizationId,
          customerId,
          amount: refundAmount,
          type: LedgerType.ADVANCE_REFUND,
          description: dto.notes ?? `Advance refunded via ${dto.paymentMethod}`,
          paymentMethod: dto.paymentMethod,
          createdById: userId,
          accountId: account?.id,
        },
      });
      await this.financeService.syncAutomaticPayment(tx, {
        organizationId,
        sourceType: 'ADVANCE_LEDGER',
        sourceId: ledger.id,
        sourceParentType: 'ADVANCE',
        sourceParentId: ledger.id,
        transactionType: FinancialTransactionType.ADVANCE_REFUND,
        paymentMethod: dto.paymentMethod,
        accountId: ledger.accountId,
        amount: ledger.amount,
        occurredAt: ledger.createdAt,
        description: ledger.description,
        createdById: userId,
      });

      this.logger.log(
        `Advance refunded: customer=${customerId} amount=${refundAmount} ledger=${ledger.id}`,
      );

      return {
        id: ledger.id,
        customerId,
        amount: ledger.amount,
        type: ledger.type,
        paymentMethod: dto.paymentMethod,
        reference: dto.reference,
        description: ledger.description,
        createdAt: ledger.createdAt,
      };
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Advance history for a customer
  // ─────────────────────────────────────────────────────────────────────────

  async getCustomerAdvanceLedger(customerId: string, organizationId: string) {
    const entries = await this.prisma.ledgerEntry.findMany({
      where: {
        customerId,
        organizationId,
        deletedAt: null,
        type: { in: [...ALL_ADVANCE_TYPES] },
      },
      orderBy: { createdAt: 'desc' },
    });

    let running = new Decimal(0);
    const ascending = [...entries].reverse();
    const withBalance = ascending.map((e) => {
      const amt = new Decimal(e.amount);
      if ((ADVANCE_CREDIT_TYPES as readonly string[]).includes(e.type)) {
        running = running.plus(amt);
      } else {
        running = running.minus(amt);
      }
      return { ...e, runningBalance: running };
    });

    return withBalance.reverse();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Delete advance entry
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Soft-deletes a single advance ledger entry.
   * The entry must belong to the given customer and organisation.
   * Only ADVANCE_RECEIVED entries can be deleted this way — applied/refunded
   * entries represent transactions that have already happened and should not
   * be deleted individually (use a correcting refund/transfer instead).
   */
  async deleteAdvanceEntry(customerId: string, ledgerEntryId: string, user: CurrentUserData) {
    const { organizationId } = user;

    const entry = await this.prisma.ledgerEntry.findFirst({
      where: {
        id: ledgerEntryId,
        customerId,
        organizationId,
        deletedAt: null,
        type: LedgerType.ADVANCE_RECEIVED,
      },
    });

    if (!entry) {
      throw new NotFoundException(
        'Advance entry not found, already deleted, or cannot be deleted (only received entries can be deleted)',
      );
    }

    // Ensure deleting this entry won't push balance negative
    const currentBalance = await this._assertSufficientBalance(
      this.prisma as any,
      customerId,
      organizationId,
      new Decimal(entry.amount),
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.ledgerEntry.update({
        where: { id: ledgerEntryId, organizationId },
        data: { deletedAt: new Date() },
      });
      await this.financeService.reverseSource(tx, organizationId, 'ADVANCE_LEDGER', ledgerEntryId);
    });

    this.logger.warn(
      `Advance entry deleted: id=${ledgerEntryId} customer=${customerId} amount=${entry.amount} by=${user.userId}`,
    );

    return {
      deleted: true,
      ledgerEntryId,
      amount: entry.amount,
      remainingBalance: currentBalance.minus(new Decimal(entry.amount)),
    };
  }
}
