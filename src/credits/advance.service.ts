import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUserData } from '../auth/current-user.decorator';
import { AuditAction, CreditStatus, LedgerType, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { ReceiveAdvanceDto } from './dto/receive-advance.dto';
import { RefundAdvanceDto } from './dto/refund-advance.dto';
import { TransferAdvanceDto } from './dto/transfer-advance.dto';

/** Ledger types that INCREASE the customer's advance credit balance. */
const ADVANCE_CREDIT_TYPES = [
  LedgerType.ADVANCE_RECEIVED,
  LedgerType.ADVANCE_TRANSFER_IN,
  LedgerType.ADVANCE_CORRECTION_CREDIT,
] as const;

/** Ledger types that DECREASE the customer's advance credit balance. */
const ADVANCE_DEBIT_TYPES = [
  LedgerType.ADVANCE_APPLIED,
  LedgerType.ADVANCE_TRANSFER_OUT,
  LedgerType.ADVANCE_REFUND,
  LedgerType.ADVANCE_CORRECTION_DEBIT,
] as const;

export const ALL_ADVANCE_TYPES = [...ADVANCE_CREDIT_TYPES, ...ADVANCE_DEBIT_TYPES] as const;
const ADVANCE_KYC_THRESHOLD = new Decimal(200000);

@Injectable()
export class AdvanceService {
  private readonly logger = new Logger(AdvanceService.name);

  constructor(private readonly prisma: PrismaService) {}

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
    asOfDate?: Date,
  ): Promise<Decimal> {
    const rows = await tx.ledgerEntry.groupBy({
      by: ['type'],
      where: {
        customerId,
        organizationId,
        deletedAt: null,
        type: { in: [...ALL_ADVANCE_TYPES] },
        ...(asOfDate && { transactionDate: { lte: asOfDate } }),
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
    const { organizationId, userId } = user;

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId, deletedAt: null },
      include: { documents: { where: { deletedAt: null }, select: { aadharNumber: true, panNumber: true } } },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const amount = new Decimal(dto.amount);

    const entryDate = dto.receivedAt ? this.parsePastDate(dto.receivedAt, 'receivedAt') : new Date();

    return this.prisma.$transaction(async (tx) => {
      const currentBalance = await this._assertSufficientBalance(tx, customerId, organizationId, new Decimal(0));
      this.assertKycForAdvanceBalance(currentBalance, amount, customer.documents);
      const ledger = await tx.ledgerEntry.create({
        data: {
          organizationId,
          customerId,
          amount,
          type: LedgerType.ADVANCE_RECEIVED,
          description: dto.notes ?? `Advance received via ${dto.paymentMethod}`,
          paymentMethod: dto.paymentMethod,
          paymentReference: dto.reference ?? null,
          entityId: null,
          referenceLedgerEntryId: null,
          invoiceId: null,
          createdById: userId,
          transactionDate: entryDate,
        },
      });

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
        transactionDate: ledger.transactionDate,
        createdAt: ledger.createdAt,
      };
    });
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
    const paymentDate = paidAt ? this.parsePastDate(paidAt, 'paidAt') : new Date();

    return this.prisma.$transaction(async (tx) => {
      await this._assertSufficientBalance(tx, invoice.customerId, organizationId, applyAmount, paymentDate);

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
          transactionDate: paymentDate,
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
          reference: ledger.id, // link back to the ledger entry for traceability
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
        include: { documents: { where: { deletedAt: null }, select: { aadharNumber: true, panNumber: true } } },
      }),
      this.prisma.customer.findFirst({
        where: { id: dto.toCustomerId, organizationId, deletedAt: null },
        include: { documents: { where: { deletedAt: null }, select: { aadharNumber: true, panNumber: true } } },
      }),
    ]);
    if (!fromCustomer) throw new NotFoundException('Source customer not found');
    if (!toCustomer) throw new NotFoundException('Destination customer not found');

    const transactionDate = dto.transactionDate ? this.parsePastDate(dto.transactionDate, 'transactionDate') : new Date();

    return this.prisma.$transaction(async (tx) => {
      await this._assertSufficientBalance(tx, fromCustomerId, organizationId, transferAmount, transactionDate);
      const recipientBalance = await this._assertSufficientBalance(tx, dto.toCustomerId, organizationId, new Decimal(0), transactionDate);
      this.assertKycForAdvanceBalance(recipientBalance, transferAmount, toCustomer.documents);

      // Create TRANSFER_OUT first so we have its id for cross-linking
      const outEntry = await tx.ledgerEntry.create({
        data: {
          organizationId,
          customerId: fromCustomerId,
          amount: transferAmount,
          type: LedgerType.ADVANCE_TRANSFER_OUT,
          description: dto.notes ?? `Advance transferred to ${toCustomer.fullName}`,
          transactionDate,
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
          transactionDate,
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
      const transactionDate = dto.transactionDate ? this.parsePastDate(dto.transactionDate, 'transactionDate') : new Date();
      await this._assertSufficientBalance(tx, customerId, organizationId, refundAmount, transactionDate);

      const ledger = await tx.ledgerEntry.create({
        data: {
          organizationId,
          customerId,
          amount: refundAmount,
          type: LedgerType.ADVANCE_REFUND,
          description: dto.notes ?? `Advance refunded via ${dto.paymentMethod}`,
          paymentMethod: dto.paymentMethod,
          paymentReference: dto.reference ?? null,
          transactionDate,
          createdById: userId,
        },
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
        transactionDate: ledger.transactionDate,
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
      orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
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
      const editable = e.type === LedgerType.ADVANCE_RECEIVED && !ascending.some((later) =>
        ((ADVANCE_DEBIT_TYPES as readonly string[]).includes(later.type) && later.transactionDate >= e.transactionDate)
        || later.referenceLedgerEntryId === e.id,
      );
      return { ...e, reference: e.paymentReference, editable, runningBalance: running };
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

    return this.prisma.$transaction(async (tx) => {
      await this.assertReceiptUnused(tx, customerId, organizationId, entry.id, entry.transactionDate);
      const currentBalance = await this._assertSufficientBalance(tx, customerId, organizationId, new Decimal(entry.amount));
      await tx.ledgerEntry.update({ where: { id: ledgerEntryId, organizationId }, data: { deletedAt: new Date() } });
      await tx.auditLog.create({
        data: { organizationId, userId: user.userId, action: AuditAction.SOFT_DELETE, entityType: 'ADVANCE_RECEIPT', entityId: ledgerEntryId, metadata: { amount: entry.amount.toString() } },
      });
      this.logger.warn(`Advance entry deleted: id=${ledgerEntryId} customer=${customerId} amount=${entry.amount} by=${user.userId}`);
      return { deleted: true, ledgerEntryId, amount: entry.amount, remainingBalance: currentBalance.minus(new Decimal(entry.amount)) };
    });
  }

  private async assertReceiptUnused(
    client: Prisma.TransactionClient | PrismaService,
    customerId: string,
    organizationId: string,
    receiptId: string,
    transactionDate: Date,
  ) {
    const usage = await client.ledgerEntry.findFirst({
      where: {
        customerId,
        organizationId,
        deletedAt: null,
        OR: [
          { transactionDate: { gte: transactionDate }, type: { in: [...ADVANCE_DEBIT_TYPES] } },
          { referenceLedgerEntryId: receiptId, type: { in: [LedgerType.ADVANCE_CORRECTION_CREDIT, LedgerType.ADVANCE_CORRECTION_DEBIT] } },
        ],
      },
      select: { id: true },
    });
    if (usage) {
      throw new BadRequestException('This advance has been used. Record a correction instead of editing or deleting it.');
    }
  }

  async updateReceivedAdvance(
    customerId: string,
    ledgerEntryId: string,
    dto: import('./dto/update-advance.dto').UpdateAdvanceDto,
    user: CurrentUserData,
  ) {
    const { organizationId, userId } = user;
    const entry = await this.prisma.ledgerEntry.findFirst({
      where: { id: ledgerEntryId, customerId, organizationId, deletedAt: null, type: LedgerType.ADVANCE_RECEIVED },
    });
    if (!entry) throw new NotFoundException('Advance receipt not found');

    const transactionDate = dto.receivedAt ? this.parsePastDate(dto.receivedAt, 'receivedAt') : entry.transactionDate;

    const data: Prisma.LedgerEntryUpdateInput = {
      ...(dto.amount !== undefined && { amount: new Decimal(dto.amount) }),
      ...(dto.paymentMethod !== undefined && { paymentMethod: dto.paymentMethod }),
      ...(dto.reference !== undefined && { paymentReference: dto.reference || null }),
      ...(dto.notes !== undefined && { description: dto.notes || `Advance received via ${dto.paymentMethod ?? entry.paymentMethod}` }),
      ...(dto.receivedAt !== undefined && { transactionDate }),
    };
    return this.prisma.$transaction(async (tx) => {
      await this.assertReceiptUnused(tx, customerId, organizationId, entry.id, entry.transactionDate);
      if (transactionDate.getTime() !== entry.transactionDate.getTime()) {
        await this.assertReceiptUnused(tx, customerId, organizationId, entry.id, transactionDate);
      }
      const updated = await tx.ledgerEntry.update({ where: { id: ledgerEntryId }, data });
      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: AuditAction.UPDATE,
          entityType: 'ADVANCE_RECEIPT',
          entityId: ledgerEntryId,
          metadata: {
            before: { amount: entry.amount.toString(), paymentMethod: entry.paymentMethod, paymentReference: entry.paymentReference, description: entry.description, transactionDate: entry.transactionDate.toISOString() },
            after: { amount: updated.amount.toString(), paymentMethod: updated.paymentMethod, paymentReference: updated.paymentReference, description: updated.description, transactionDate: updated.transactionDate.toISOString() },
          },
        },
      });
      return updated;
    });
  }

  async correctAdvance(
    customerId: string,
    ledgerEntryId: string,
    dto: import('./dto/correct-advance.dto').CorrectAdvanceDto,
    user: CurrentUserData,
  ) {
    const { organizationId, userId } = user;
    const source = await this.prisma.ledgerEntry.findFirst({
      where: { id: ledgerEntryId, customerId, organizationId, deletedAt: null, type: LedgerType.ADVANCE_RECEIVED },
    });
    if (!source) throw new NotFoundException('Advance receipt not found');
    const usage = await this.prisma.ledgerEntry.findFirst({
      where: {
        customerId,
        organizationId,
        deletedAt: null,
        OR: [
          { transactionDate: { gte: source.transactionDate }, type: { in: [...ADVANCE_DEBIT_TYPES] } },
          { referenceLedgerEntryId: source.id, type: { in: [LedgerType.ADVANCE_CORRECTION_CREDIT, LedgerType.ADVANCE_CORRECTION_DEBIT] } },
        ],
      },
      select: { id: true },
    });
    if (!usage) throw new BadRequestException('This receipt has not been used. Edit it directly instead of recording a correction.');
    const transactionDate = dto.transactionDate ? this.parsePastDate(dto.transactionDate, 'transactionDate') : new Date();
    if (transactionDate < source.transactionDate) {
      throw new BadRequestException('Correction date cannot be earlier than the original receipt date');
    }
    const amount = new Decimal(dto.amount);

    return this.prisma.$transaction(async (tx) => {
      if (dto.direction === 'DEBIT') await this._assertSufficientBalance(tx, customerId, organizationId, amount);
      const ledger = await tx.ledgerEntry.create({
        data: {
          organizationId,
          customerId,
          amount,
          type: dto.direction === 'CREDIT' ? LedgerType.ADVANCE_CORRECTION_CREDIT : LedgerType.ADVANCE_CORRECTION_DEBIT,
          description: dto.notes,
          referenceLedgerEntryId: source.id,
          transactionDate,
          createdById: userId,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: AuditAction.CREATE,
          entityType: 'ADVANCE_CORRECTION',
          entityId: ledger.id,
          metadata: { sourceReceiptId: source.id, direction: dto.direction, amount: amount.toString(), notes: dto.notes },
        },
      });
      return ledger;
    });
  }

  private assertKycForAdvanceBalance(
    currentBalance: Decimal,
    incomingAmount: Decimal,
    documents: Array<{ aadharNumber: string | null; panNumber: string | null }>,
  ) {
    const requiresKyc = currentBalance.plus(incomingAmount).greaterThanOrEqualTo(ADVANCE_KYC_THRESHOLD);
    const hasKyc = documents.some((document) => Boolean(document.aadharNumber && document.panNumber));

    if (requiresKyc && !hasKyc) {
      throw new BadRequestException(
        'Customer Aadhaar and PAN are required before their advance balance can reach ₹2,00,000.',
      );
    }
  }

  private parsePastDate(value: string, field: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`${field} must be in YYYY-MM-DD format`);
    const date = new Date(`${value}T00:00:00.000Z`);
    if (isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException(`${field} is an invalid date`);
    }
    const today = new Date();
    today.setUTCHours(23, 59, 59, 999);
    if (date > today) throw new BadRequestException(`${field} cannot be a future date`);
    return date;
  }
}
