import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BankStatementLineStatus,
  FinancialAccountType,
  FinancialTransactionType,
  PaymentMethod,
  Prisma,
  PurchaseStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { CurrentUserData } from '../auth/current-user.decorator';
import { FinanceService } from '../finance/finance.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdvanceService } from '../credits/advance.service';
import { CreateAndMatchBankStatementDto } from './dto/bank-statement.dto';
import { inferPaymentMethodFromNarration, parseHdfcDelimited } from './hdfc-statement.parser';
import {
  AMOUNT_TOLERANCE,
  BANKISH_PAYMENT_MODES,
  calendarDayKey,
  indexPaymentsByCalendarDay,
  PaymentCandidate,
  PaymentCandidateKind,
  sameCalendarDay,
  suggestPaymentsForCredit,
  suggestPaymentsForDebit,
} from './suggest-payments';

type MatchKind = 'INVOICE_PAYMENT' | 'FINANCIAL_TRANSACTION' | 'PURCHASE_PAYMENT';

const STATEMENT_CREATED = {
  sourceParentType: 'BANK_STATEMENT_LINE',
} as const;

const CANDIDATE_TAKE = 500;

async function runSerializable<T>(
  prisma: PrismaService,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      lastError = error;
      if ((error as { code?: string }).code !== 'P2034') throw error;
    }
  }
  throw lastError;
}

/** Statement narration → bank ledger particulars; prefix keeps kind identifiable in reconcile. */
function createMatchDescription(
  kind: 'LOAN' | 'CASH_DEPOSIT' | 'CASH_WITHDRAWAL' | 'ADVANCE' | 'MONEY_OUT',
  narration: string,
): string {
  const text = narration.trim();
  if (kind === 'LOAN') {
    if (!text) return 'Loan';
    if (/^loan\b/i.test(text)) return text;
    return `Loan — ${text}`;
  }
  if (kind === 'ADVANCE') {
    if (!text) return 'Advance';
    if (/^advance\b/i.test(text)) return text;
    return `Advance — ${text}`;
  }
  if (kind === 'MONEY_OUT') {
    if (!text) return 'Money Out';
    if (/^money out\b/i.test(text)) return text;
    return text;
  }
  if (kind === 'CASH_WITHDRAWAL') {
    if (!text) return 'Cash withdrawal';
    if (/^cash withdrawal\b/i.test(text)) return text;
    return `Cash withdrawal — ${text}`;
  }
  return text || 'Cash deposit';
}

@Injectable()
export class BankStatementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financeService: FinanceService,
    private readonly advanceService: AdvanceService,
  ) {}

  async upload(accountId: string, text: string, filename: string, user: CurrentUserData) {
    const account = await this.prisma.financialAccount.findFirst({
      where: {
        id: accountId,
        organizationId: user.organizationId,
        type: FinancialAccountType.BANK,
        status: 'ACTIVE',
      },
    });
    if (!account) throw new NotFoundException('Bank account not found');

    const parsed = parseHdfcDelimited(text);
    if (!parsed.length) {
      throw new BadRequestException(
        'No statement rows found. Export HDFC Delimited (.txt) and try again.',
      );
    }

    const fingerprints = parsed.map((row) => row.fingerprint);
    const existing = await this.prisma.bankStatementLine.findMany({
      where: {
        organizationId: user.organizationId,
        accountId,
        fingerprint: { in: fingerprints },
      },
      select: { fingerprint: true },
    });
    const existingSet = new Set(existing.map((row) => row.fingerprint));

    const fresh = parsed.filter((row) => !existingSet.has(row.fingerprint));
    const creditCount = parsed.filter((row) => row.credit > 0).length;
    const debitCount = parsed.filter((row) => row.debit > 0).length;

    const result = await this.prisma.$transaction(async (tx) => {
      const imp = await tx.bankStatementImport.create({
        data: {
          organizationId: user.organizationId,
          accountId,
          filename: filename || 'statement.txt',
          rowCount: parsed.length,
          creditCount,
          debitCount,
          newCount: fresh.length,
          skippedCount: parsed.length - fresh.length,
        },
      });

      if (fresh.length) {
        const inserted = await tx.bankStatementLine.createMany({
          data: fresh.map((row) => ({
            organizationId: user.organizationId,
            importId: imp.id,
            accountId,
            txnDate: row.txnDate,
            valueDate: row.valueDate,
            narration: row.narration,
            debit: new Decimal(row.debit),
            credit: new Decimal(row.credit),
            refNumber: row.refNumber,
            closingBalance: row.closingBalance == null ? null : new Decimal(row.closingBalance),
            fingerprint: row.fingerprint,
            status: BankStatementLineStatus.UNMATCHED,
          })),
          skipDuplicates: true,
        });
        await tx.bankStatementImport.update({
          where: { id: imp.id },
          data: {
            newCount: inserted.count,
            skippedCount: parsed.length - inserted.count,
          },
        });
        return { ...imp, newCount: inserted.count, skippedCount: parsed.length - inserted.count };
      }

      return imp;
    });

    return {
      import: result,
      parsed: parsed.length,
      imported: result.newCount,
      skipped: result.skippedCount,
      credits: creditCount,
      debits: debitCount,
    };
  }

  /** One round-trip for the reconcile tab: unmatched lines, open payments, linked history. */
  async listInbox(organizationId: string, accountId?: string) {
    const [creditLines, debitLines, matched, matchedDebits] = await Promise.all([
      this.findUnmatchedCredits(organizationId, accountId),
      this.findUnmatchedDebits(organizationId, accountId),
      this.listMatched(organizationId, accountId),
      this.listMatchedDebits(organizationId, accountId),
    ]);
    const paidAtFrom = this.oldestUnmatchedDate([...creditLines, ...debitLines]);
    const [invoicePayments, treasuryIn, advanceReceipts, purchasePayments, treasuryOut] =
      await Promise.all([
        this.loadUnlinkedBankishPayments(organizationId, accountId, paidAtFrom),
        this.loadUnlinkedTreasuryCredits(organizationId, accountId, paidAtFrom),
        this.loadUnlinkedAdvanceReceipts(organizationId, accountId, paidAtFrom),
        this.loadUnlinkedPurchasePayments(organizationId, accountId, paidAtFrom),
        this.loadUnlinkedTreasuryDebits(organizationId, accountId, paidAtFrom),
      ]);
    const paymentsIn = [...invoicePayments, ...treasuryIn, ...advanceReceipts];
    const paymentsOut = [...purchasePayments, ...treasuryOut];
    return {
      unmatched: this.withCreditSuggestions(creditLines, paymentsIn),
      unmatchedDebits: this.withDebitSuggestions(debitLines, paymentsOut),
      payments: this.serializeUnlinkedPayments(paymentsIn),
      paymentsOut: this.serializeUnlinkedPayments(paymentsOut),
      matched,
      matchedDebits,
    };
  }

  async listUnmatched(organizationId: string, accountId?: string) {
    const [creditLines, debitLines] = await Promise.all([
      this.findUnmatchedCredits(organizationId, accountId),
      this.findUnmatchedDebits(organizationId, accountId),
    ]);
    const paidAtFrom = this.oldestUnmatchedDate([...creditLines, ...debitLines]);
    const [invoicePayments, treasuryIn, advanceReceipts, purchasePayments, treasuryOut] =
      await Promise.all([
        this.loadUnlinkedBankishPayments(organizationId, accountId, paidAtFrom),
        this.loadUnlinkedTreasuryCredits(organizationId, accountId, paidAtFrom),
        this.loadUnlinkedAdvanceReceipts(organizationId, accountId, paidAtFrom),
        this.loadUnlinkedPurchasePayments(organizationId, accountId, paidAtFrom),
        this.loadUnlinkedTreasuryDebits(organizationId, accountId, paidAtFrom),
      ]);
    const paymentsIn = [...invoicePayments, ...treasuryIn, ...advanceReceipts];
    const paymentsOut = [...purchasePayments, ...treasuryOut];
    return {
      unmatched: this.withCreditSuggestions(creditLines, paymentsIn),
      unmatchedDebits: this.withDebitSuggestions(debitLines, paymentsOut),
    };
  }

  /** Booked non-cash payments not yet fully covered by statement lines. */
  async listUnmatchedPayments(organizationId: string, accountId?: string) {
    const [creditLines, debitLines] = await Promise.all([
      this.findUnmatchedCredits(organizationId, accountId),
      this.findUnmatchedDebits(organizationId, accountId),
    ]);
    const paidAtFrom = this.oldestUnmatchedDate([...creditLines, ...debitLines]);
    const [invoicePayments, treasuryIn, advanceReceipts, purchasePayments, treasuryOut] =
      await Promise.all([
        this.loadUnlinkedBankishPayments(organizationId, accountId, paidAtFrom),
        this.loadUnlinkedTreasuryCredits(organizationId, accountId, paidAtFrom),
        this.loadUnlinkedAdvanceReceipts(organizationId, accountId, paidAtFrom),
        this.loadUnlinkedPurchasePayments(organizationId, accountId, paidAtFrom),
        this.loadUnlinkedTreasuryDebits(organizationId, accountId, paidAtFrom),
      ]);
    return {
      payments: this.serializeUnlinkedPayments([
        ...invoicePayments,
        ...treasuryIn,
        ...advanceReceipts,
      ]),
      paymentsOut: this.serializeUnlinkedPayments([...purchasePayments, ...treasuryOut]),
    };
  }

  /** Already-linked statement credits (month-end history). */
  async listMatched(organizationId: string, accountId?: string) {
    const lines = await this.prisma.bankStatementLine.findMany({
      where: {
        organizationId,
        status: BankStatementLineStatus.MATCHED,
        credit: { gt: 0 },
        ...(accountId ? { accountId } : {}),
      },
      orderBy: [{ txnDate: 'desc' }, { updatedAt: 'desc' }],
      take: 200,
    });

    const paymentIds = lines
      .map((line) => line.invoicePaymentId)
      .filter((id): id is string => Boolean(id));
    const transactionIds = lines
      .map((line) => line.financialTransactionId)
      .filter((id): id is string => Boolean(id));

    const payments = paymentIds.length
      ? await this.prisma.invoicePayment.findMany({
          where: { organizationId, id: { in: paymentIds } },
          select: {
            id: true,
            mode: true,
            amount: true,
            paidAt: true,
            reference: true,
            invoice: {
              select: {
                id: true,
                invoiceNumber: true,
                status: true,
                customer: { select: { fullName: true } },
              },
            },
          },
        })
      : [];
    const paymentById = new Map(payments.map((payment) => [payment.id, payment]));

    const transactions = transactionIds.length
      ? await this.prisma.financialTransaction.findMany({
          where: { organizationId, id: { in: transactionIds } },
          select: {
            id: true,
            type: true,
            sourceId: true,
            description: true,
            reference: true,
            occurredAt: true,
          },
        })
      : [];
    const transactionById = new Map(transactions.map((row) => [row.id, row]));
    const advanceLedgerIds = transactions
      .filter((row) => row.type === FinancialTransactionType.ADVANCE_RECEIPT)
      .map((row) => row.sourceId);
    const advanceLedgers = advanceLedgerIds.length
      ? await this.prisma.ledgerEntry.findMany({
          where: { organizationId, id: { in: advanceLedgerIds } },
          select: { id: true, customer: { select: { fullName: true } } },
        })
      : [];
    const customerByLedgerId = new Map(
      advanceLedgers.map((row) => [row.id, row.customer?.fullName || '']),
    );

    return lines.map((line) => {
      const payment = line.invoicePaymentId ? paymentById.get(line.invoicePaymentId) : undefined;
      const transaction = line.financialTransactionId
        ? transactionById.get(line.financialTransactionId)
        : undefined;
      const kind = payment
        ? 'INVOICE'
        : transaction
          ? this.treasuryKind(transaction.type, transaction.description)
          : null;
      const label = kind && kind !== 'INVOICE' ? this.treasuryLabel(kind) : null;
      const advanceCustomer =
        transaction?.type === FinancialTransactionType.ADVANCE_RECEIPT
          ? customerByLedgerId.get(transaction.sourceId) || ''
          : '';
      return {
        id: line.id,
        accountId: line.accountId,
        txnDate: line.txnDate,
        narration: line.narration,
        refNumber: line.refNumber,
        credit: Number(line.credit),
        matchedAt: line.updatedAt,
        kind,
        paymentId: line.invoicePaymentId || line.financialTransactionId,
        invoiceId: payment?.invoice.id || line.matchedInvoiceId,
        invoiceNumber: payment?.invoice.invoiceNumber || label,
        invoiceStatus: payment?.invoice.status || null,
        customerName: payment?.invoice.customer?.fullName || advanceCustomer,
        mode: payment?.mode || label,
        paidAt: payment?.paidAt || transaction?.occurredAt || null,
        paymentReference: payment?.reference || transaction?.reference || null,
        direction: 'credit' as const,
      };
    });
  }

  /** Already-linked statement debits (month-end history). */
  async listMatchedDebits(organizationId: string, accountId?: string) {
    const lines = await this.prisma.bankStatementLine.findMany({
      where: {
        organizationId,
        status: BankStatementLineStatus.MATCHED,
        debit: { gt: 0 },
        ...(accountId ? { accountId } : {}),
      },
      orderBy: [{ txnDate: 'desc' }, { updatedAt: 'desc' }],
      take: 200,
    });

    const paymentIds = lines
      .map((line) => line.purchasePaymentId)
      .filter((id): id is string => Boolean(id));
    const payments = paymentIds.length
      ? await this.prisma.purchasePayment.findMany({
          where: { organizationId, id: { in: paymentIds } },
          select: {
            id: true,
            mode: true,
            amount: true,
            paidAt: true,
            reference: true,
            purchaseInvoice: {
              select: {
                id: true,
                invoiceNumber: true,
                status: true,
                vendorName: true,
              },
            },
          },
        })
      : [];
    const paymentById = new Map(payments.map((payment) => [payment.id, payment]));

    const transactionIds = lines
      .map((line) => line.financialTransactionId)
      .filter((id): id is string => Boolean(id));
    const transactions = transactionIds.length
      ? await this.prisma.financialTransaction.findMany({
          where: { organizationId, id: { in: transactionIds } },
          select: {
            id: true,
            type: true,
            description: true,
            reference: true,
            occurredAt: true,
          },
        })
      : [];
    const transactionById = new Map(transactions.map((t) => [t.id, t]));

    return lines.map((line) => {
      const payment = line.purchasePaymentId ? paymentById.get(line.purchasePaymentId) : undefined;
      const transaction = line.financialTransactionId
        ? transactionById.get(line.financialTransactionId)
        : undefined;

      // Purchase payments already have a dedicated model; treasury debits are represented by FinancialTransaction.
      if (payment) {
        return {
          id: line.id,
          accountId: line.accountId,
          txnDate: line.txnDate,
          narration: line.narration,
          refNumber: line.refNumber,
          debit: Number(line.debit),
          matchedAt: line.updatedAt,
          kind: 'PURCHASE' as const,
          paymentId: line.purchasePaymentId,
          invoiceNumber: payment.purchaseInvoice.invoiceNumber || 'Purchase',
          invoiceStatus: payment.purchaseInvoice.status || null,
          customerName: payment.purchaseInvoice.vendorName || '',
          mode: payment.mode || null,
          paidAt: payment.paidAt || null,
          paymentReference: payment.reference || null,
          direction: 'debit' as const,
        };
      }

      if (transaction) {
        const kind = this.treasuryKind(transaction.type, transaction.description, 'debit');
        const label = this.treasuryLabel(kind);
        return {
          id: line.id,
          accountId: line.accountId,
          txnDate: line.txnDate,
          narration: line.narration,
          refNumber: line.refNumber,
          debit: Number(line.debit),
          matchedAt: line.updatedAt,
          kind,
          paymentId: line.financialTransactionId,
          invoiceNumber: label,
          invoiceStatus: null,
          customerName: '',
          mode: label,
          paidAt: transaction.occurredAt || null,
          paymentReference: transaction.reference || null,
          direction: 'debit' as const,
        };
      }

      return {
        id: line.id,
        accountId: line.accountId,
        txnDate: line.txnDate,
        narration: line.narration,
        refNumber: line.refNumber,
        debit: Number(line.debit),
        matchedAt: line.updatedAt,
        kind: null,
        paymentId: null,
        invoiceNumber: 'Entry',
        invoiceStatus: null,
        customerName: '',
        mode: null,
        paidAt: null,
        paymentReference: null,
        direction: 'debit' as const,
      };
    });
  }

  async ignore(lineId: string, user: CurrentUserData) {
    const line = await this.requireLine(lineId, user.organizationId);
    if (line.status !== BankStatementLineStatus.UNMATCHED) {
      throw new BadRequestException('Only unmatched lines can be ignored');
    }
    return this.prisma.bankStatementLine.update({
      where: { id: line.id },
      data: { status: BankStatementLineStatus.IGNORED },
    });
  }

  async unmatch(lineId: string, user: CurrentUserData) {
    const line = await this.requireLine(lineId, user.organizationId);
    if (line.status !== BankStatementLineStatus.MATCHED) {
      throw new BadRequestException('Only matched lines can be unlinked');
    }
    if (line.financialTransactionId) {
      const createdHere = await this.prisma.financialTransaction.findFirst({
        where: {
          id: line.financialTransactionId,
          organizationId: user.organizationId,
          sourceParentType: STATEMENT_CREATED.sourceParentType,
          sourceParentId: line.id,
          reversedAt: null,
        },
        select: { id: true },
      });
      if (createdHere) {
        await this.financeService.reverseTransaction(createdHere.id, user);
      }
    }
    return this.prisma.bankStatementLine.update({
      where: { id: line.id },
      data: {
        status: BankStatementLineStatus.UNMATCHED,
        matchedInvoiceId: null,
        invoicePaymentId: null,
        purchasePaymentId: null,
        financialTransactionId: null,
      },
    });
  }

  async deleteLine(lineId: string, user: CurrentUserData) {
    const result = await this.deleteLines([lineId], user);
    return result.deleted;
  }

  async deleteLines(lineIds: string[], user: CurrentUserData) {
    const uniqueIds = [...new Set(lineIds.filter(Boolean))];
    if (!uniqueIds.length) {
      throw new BadRequestException('Select at least one statement line');
    }

    const lines = await this.prisma.bankStatementLine.findMany({
      where: { organizationId: user.organizationId, id: { in: uniqueIds } },
    });
    if (lines.length !== uniqueIds.length) {
      throw new NotFoundException('One or more statement lines were not found');
    }
    if (lines.some((line) => line.status === BankStatementLineStatus.MATCHED)) {
      throw new BadRequestException('Unlink matched lines before deleting');
    }

    const deleted = await this.prisma.bankStatementLine.deleteMany({
      where: {
        organizationId: user.organizationId,
        id: { in: uniqueIds },
        status: { not: BankStatementLineStatus.MATCHED },
      },
    });
    if (deleted.count !== uniqueIds.length) {
      throw new BadRequestException('Unlink matched lines before deleting');
    }
    return { count: deleted.count, deleted: lines[0] };
  }

  async confirmMatch(lineId: string, paymentId: string, user: CurrentUserData, kind?: MatchKind) {
    return this.confirmMatchMany([lineId], paymentId, user, kind);
  }

  /**
   * Link one or more statement lines to one booked payment or cashbook entry.
   * Credits or debits may be splits as long as sum ≤ remaining capacity (±₹1)
   * and each line is the same calendar day as the booked payment.
   */
  async confirmMatchMany(
    lineIds: string[],
    paymentId: string,
    user: CurrentUserData,
    kind?: MatchKind,
  ) {
    const uniqueIds = [...new Set(lineIds.filter(Boolean))];
    if (!uniqueIds.length) {
      throw new BadRequestException('Select at least one statement line');
    }

    const lines = await this.prisma.bankStatementLine.findMany({
      where: { organizationId: user.organizationId, id: { in: uniqueIds } },
    });
    if (lines.length !== uniqueIds.length) {
      throw new NotFoundException('One or more statement lines were not found');
    }

    const direction = this.statementDirection(lines);
    if (direction === 'debit') {
      if (kind === 'FINANCIAL_TRANSACTION') {
        return this.confirmTreasuryMatchMany(lines, uniqueIds, paymentId, user, 'debit');
      }
      if (kind === 'INVOICE_PAYMENT') {
        throw new BadRequestException('Bank debits must be matched to purchase payments');
      }
      const purchase = await this.prisma.purchasePayment.findFirst({
        where: { id: paymentId, organizationId: user.organizationId },
        include: {
          purchaseInvoice: {
            select: { id: true, invoiceNumber: true, status: true, vendorName: true },
          },
        },
      });
      if (!purchase) {
        if (!kind) return this.confirmTreasuryMatchMany(lines, uniqueIds, paymentId, user, 'debit');
        throw new NotFoundException('Purchase payment not found');
      }
      return this.confirmPurchaseMatchMany(lines, uniqueIds, purchase, user);
    }

    if (kind === 'PURCHASE_PAYMENT') {
      throw new BadRequestException('Bank credits cannot be matched to purchase payments');
    }

    if (kind === 'FINANCIAL_TRANSACTION') {
      return this.confirmTreasuryMatchMany(lines, uniqueIds, paymentId, user, 'credit');
    }

    const payment = await this.prisma.invoicePayment.findFirst({
      where: { id: paymentId, organizationId: user.organizationId },
      include: {
        invoice: { select: { id: true, invoiceNumber: true, status: true } },
      },
    });
    if (!payment) {
      if (!kind) return this.confirmTreasuryMatchMany(lines, uniqueIds, paymentId, user, 'credit');
      throw new NotFoundException('Payment not found');
    }

    if (!BANKISH_PAYMENT_MODES.includes(payment.mode as (typeof BANKISH_PAYMENT_MODES)[number])) {
      throw new BadRequestException(
        'Cash / credit / old-gold payments are not bank-reconciled here',
      );
    }

    const creditSum = lines.reduce((sum, line) => sum + Number(line.credit), 0);

    for (const line of lines) {
      if (!(Number(line.credit) > 0)) {
        throw new BadRequestException('Only credit lines can be matched to payments');
      }
      if (!sameCalendarDay(payment.paidAt, line.txnDate)) {
        throw new BadRequestException(
          'Payment date must be the same calendar day as each bank credit date',
        );
      }
      if (payment.accountId && payment.accountId !== line.accountId) {
        throw new BadRequestException(
          'Payment is booked to a different bank account than this statement',
        );
      }
    }

    const accountIds = new Set(lines.map((line) => line.accountId));
    if (accountIds.size > 1) {
      throw new BadRequestException('All selected credits must be from the same bank account');
    }

    const updated = await runSerializable(this.prisma, async (tx) => {
      // Re-read inside the transaction: the booked amount / account can change under us.
      const booked = await tx.invoicePayment.findFirst({
        where: { id: paymentId, organizationId: user.organizationId },
      });
      if (!booked) throw new NotFoundException('Payment not found');

      const linkedAgg = await tx.bankStatementLine.aggregate({
        where: {
          organizationId: user.organizationId,
          invoicePaymentId: booked.id,
          status: BankStatementLineStatus.MATCHED,
        },
        _sum: { credit: true },
      });
      const alreadyLinked = Number(linkedAgg._sum.credit || 0);
      const remaining = Number(booked.amount) - alreadyLinked;
      if (creditSum > remaining + AMOUNT_TOLERANCE) {
        throw new BadRequestException(
          `Selected credits (₹${creditSum.toFixed(2)}) exceed remaining payment capacity (₹${remaining.toFixed(2)})`,
        );
      }

      const matched = await tx.bankStatementLine.updateMany({
        where: {
          organizationId: user.organizationId,
          id: { in: uniqueIds },
          status: BankStatementLineStatus.UNMATCHED,
        },
        data: {
          status: BankStatementLineStatus.MATCHED,
          matchedInvoiceId: booked.invoiceId,
          invoicePaymentId: booked.id,
        },
      });
      if (matched.count !== uniqueIds.length) {
        throw new BadRequestException('Only unmatched credits can be linked');
      }
      const updatedRows = await tx.bankStatementLine.findMany({
        where: { organizationId: user.organizationId, id: { in: uniqueIds } },
      });
      const byId = new Map(updatedRows.map((row) => [row.id, row]));
      const rows = uniqueIds.map((id) => byId.get(id)).filter(Boolean);
      const accountId = booked.accountId || lines[0].accountId;
      if (!booked.accountId) {
        await tx.invoicePayment.update({
          where: { id: booked.id },
          data: { accountId },
        });
      }
      // Upsert once for the booked payment amount (not per credit).
      await this.financeService.syncAutomaticPayment(tx, {
        organizationId: user.organizationId,
        sourceType: 'INVOICE_PAYMENT',
        sourceId: booked.id,
        sourceParentType: 'INVOICE',
        sourceParentId: booked.invoiceId,
        transactionType: FinancialTransactionType.SALE_RECEIPT,
        paymentMethod: booked.mode,
        accountId,
        amount: booked.amount,
        occurredAt: booked.paidAt,
        description: booked.notes ?? 'Invoice payment',
        createdById: user.userId,
      });
      return { rows, alreadyLinked, amount: Number(booked.amount) };
    });

    const linkedAfter = updated.alreadyLinked + creditSum;
    return {
      lines: updated.rows,
      payment: {
        id: payment.id,
        invoiceId: payment.invoiceId,
        invoiceNumber: payment.invoice.invoiceNumber,
        amount: updated.amount,
        mode: payment.mode,
        linkedCredits: linkedAfter,
        remaining: Math.max(0, updated.amount - linkedAfter),
        complete: updated.amount - linkedAfter <= AMOUNT_TOLERANCE,
      },
    };
  }

  async createAndMatch(lineId: string, dto: CreateAndMatchBankStatementDto, user: CurrentUserData) {
    const line = await this.requireLine(lineId, user.organizationId);
    if (line.status !== BankStatementLineStatus.UNMATCHED) {
      throw new BadRequestException('Only unmatched statement lines can be linked');
    }

    const credit = Number(line.credit);
    const debit = Number(line.debit);
    const direction: 'credit' | 'debit' =
      credit > 0 ? 'credit' : debit > 0 ? 'debit' : (null as any);
    if (!direction)
      throw new BadRequestException('Statement line must have either credit or debit amount');
    if (direction === 'credit' && debit > 0) {
      // Defensive: statement parser should never produce both credit & debit in the same row.
      throw new BadRequestException('Statement line cannot have both credit and debit amounts');
    }

    if (dto.kind === 'ADVANCE') {
      if (direction !== 'credit') {
        throw new BadRequestException('Advance can only be created from credit lines');
      }
      if (!dto.customerId) throw new BadRequestException('Choose a customer for the advance');
    }
    if (dto.kind === 'MONEY_OUT' && direction !== 'debit') {
      throw new BadRequestException('Money out can only be created from debit lines');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      let transaction: { id: string };
      let customerName: string | undefined;
      if (dto.kind === 'MONEY_OUT' || dto.kind === 'LOAN') {
        transaction = await this.financeService.createManualTransactionIn(
          tx,
          {
            type: FinancialTransactionType.ADJUSTMENT,
            accountId: line.accountId,
            // Loan is a treasury movement; for bank statement "debit" we need money-out => negative movement.
            amount: direction === 'credit' ? credit : -debit,
            occurredAt: line.txnDate,
            description: createMatchDescription(
              dto.kind === 'MONEY_OUT' ? 'MONEY_OUT' : 'LOAN',
              line.narration,
            ),
            reference: line.refNumber || undefined,
            sourceParentType: STATEMENT_CREATED.sourceParentType,
            sourceParentId: line.id,
          },
          user,
        );
      } else if (dto.kind === 'CASH_DEPOSIT') {
        if (direction === 'credit') {
          transaction = await this.createCashDepositFromLine(
            tx,
            line,
            credit,
            dto.fromAccountId,
            user,
          );
        } else {
          transaction = await this.createCashWithdrawalFromLine(
            tx,
            line,
            debit,
            dto.fromAccountId,
            user,
          );
        }
      } else {
        const received = await this.advanceService.receiveAdvanceIn(
          tx,
          dto.customerId!,
          {
            amount: credit,
            paymentMethod: inferPaymentMethodFromNarration(line.narration) as PaymentMethod,
            receivedAt: calendarDayKey(line.txnDate),
            reference: line.refNumber || undefined,
            notes: createMatchDescription('ADVANCE', line.narration),
            accountId: line.accountId,
          },
          user,
        );
        if (!received.transactionId) {
          throw new BadRequestException('Could not post advance to the bank book');
        }
        const posted = await tx.financialTransaction.findFirst({
          where: { id: received.transactionId, organizationId: user.organizationId },
        });
        if (!posted) throw new BadRequestException('Could not post advance to the bank book');
        transaction = await tx.financialTransaction.update({
          where: { id: posted.id },
          data: {
            sourceParentType: STATEMENT_CREATED.sourceParentType,
            sourceParentId: line.id,
          },
        });
        customerName = received.customerName;
      }

      const matched = await tx.bankStatementLine.updateMany({
        where: {
          id: line.id,
          organizationId: user.organizationId,
          status: BankStatementLineStatus.UNMATCHED,
        },
        data: {
          status: BankStatementLineStatus.MATCHED,
          financialTransactionId: transaction.id,
        },
      });
      if (matched.count !== 1) {
        throw new BadRequestException('Only unmatched statement lines can be linked');
      }
      const updated = await tx.bankStatementLine.findFirstOrThrow({ where: { id: line.id } });
      return { transaction, line: updated, customerName };
    });

    const kind =
      dto.kind === 'LOAN'
        ? 'LOAN'
        : dto.kind === 'CASH_DEPOSIT'
          ? direction === 'debit'
            ? 'MONEY_OUT'
            : 'CASH_DEPOSIT'
          : dto.kind === 'MONEY_OUT'
            ? 'MONEY_OUT'
            : 'ADVANCE';
    const label =
      dto.kind === 'CASH_DEPOSIT' && direction === 'debit'
        ? 'Cash withdrawal'
        : this.treasuryLabel(kind);
    const amount = direction === 'credit' ? credit : debit;
    return {
      line: created.line,
      payment: {
        id: created.transaction.id,
        kind,
        invoiceNumber: label,
        amount,
        mode: label,
        linkedCredits: direction === 'credit' ? amount : 0,
        linkedDebits: direction === 'debit' ? amount : 0,
        remaining: 0,
        complete: true,
        customerName: created.customerName || undefined,
      },
    };
  }

  private async confirmTreasuryMatchMany(
    lines: Awaited<ReturnType<BankStatementService['requireLine']>>[],
    uniqueIds: string[],
    transactionId: string,
    user: CurrentUserData,
    direction: 'credit' | 'debit' = 'credit',
  ) {
    const creditTypes = [
      FinancialTransactionType.ADJUSTMENT,
      FinancialTransactionType.CASH_BANK_TRANSFER,
      FinancialTransactionType.ADVANCE_RECEIPT,
    ];
    const debitTypes = [
      FinancialTransactionType.PURCHASE_PAYMENT,
      FinancialTransactionType.ADJUSTMENT,
      FinancialTransactionType.CASH_BANK_TRANSFER,
    ];
    const transaction = await this.prisma.financialTransaction.findFirst({
      where: {
        id: transactionId,
        organizationId: user.organizationId,
        reversedAt: null,
        type: { in: direction === 'credit' ? creditTypes : debitTypes },
      },
      include: { movements: { include: { account: { select: { type: true } } } } },
    });
    if (!transaction) throw new NotFoundException('Cash & Bank entry not found');

    const lineSum = lines.reduce(
      (sum, line) => sum + Number(direction === 'credit' ? line.credit : line.debit),
      0,
    );
    const accountIds = new Set(lines.map((line) => line.accountId));
    if (accountIds.size > 1) {
      throw new BadRequestException('All selected lines must be from the same bank account');
    }
    const bankAccountId = lines[0].accountId;
    const bankMovement = transaction.movements.find(
      (movement) =>
        movement.accountId === bankAccountId &&
        movement.account?.type === FinancialAccountType.BANK &&
        (direction === 'credit' ? Number(movement.amount) > 0 : Number(movement.amount) < 0),
    );
    if (!bankMovement) {
      throw new BadRequestException(
        direction === 'credit'
          ? 'This entry is not money into this bank account'
          : 'This entry is not money out of this bank account',
      );
    }
    const kind = this.treasuryKind(transaction.type, transaction.description, direction);
    if (direction === 'credit' && kind === 'CASH_DEPOSIT') {
      const fromCash = transaction.movements.find(
        (movement) =>
          Number(movement.amount) < 0 && movement.account?.type === FinancialAccountType.CASH,
      );
      if (!fromCash) {
        throw new BadRequestException('Cash deposit must come from a cash account');
      }
    }

    for (const line of lines) {
      const lineAmount = Number(direction === 'credit' ? line.credit : line.debit);
      if (!(lineAmount > 0)) {
        throw new BadRequestException(
          direction === 'credit'
            ? 'Only credit lines can be matched here'
            : 'Only debit lines can be matched here',
        );
      }
      if (!sameCalendarDay(transaction.occurredAt, line.txnDate)) {
        throw new BadRequestException(
          direction === 'credit'
            ? 'Entry date must be the same calendar day as each bank credit date'
            : 'Entry date must be the same calendar day as each bank debit date',
        );
      }
    }

    const amount = Math.abs(Number(bankMovement.amount));
    const updated = await runSerializable(this.prisma, async (tx) => {
      let alreadyLinked = 0;
      if (direction === 'credit') {
        const linkedAgg = await tx.bankStatementLine.aggregate({
          where: {
            organizationId: user.organizationId,
            financialTransactionId: transaction.id,
            status: BankStatementLineStatus.MATCHED,
          },
          _sum: { credit: true },
        });
        alreadyLinked = Number(linkedAgg._sum.credit || 0);
      } else {
        const linkedAgg = await tx.bankStatementLine.aggregate({
          where: {
            organizationId: user.organizationId,
            financialTransactionId: transaction.id,
            status: BankStatementLineStatus.MATCHED,
          },
          _sum: { debit: true },
        });
        alreadyLinked = Number(linkedAgg._sum.debit || 0);
      }
      const remaining = amount - alreadyLinked;
      if (lineSum > remaining + AMOUNT_TOLERANCE) {
        throw new BadRequestException(
          `Selected lines (₹${lineSum.toFixed(2)}) exceed remaining entry capacity (₹${remaining.toFixed(2)})`,
        );
      }

      const matched = await tx.bankStatementLine.updateMany({
        where: {
          organizationId: user.organizationId,
          id: { in: uniqueIds },
          status: BankStatementLineStatus.UNMATCHED,
        },
        data: {
          status: BankStatementLineStatus.MATCHED,
          financialTransactionId: transaction.id,
        },
      });
      if (matched.count !== uniqueIds.length) {
        throw new BadRequestException('Only unmatched lines can be linked');
      }
      const updatedRows = await tx.bankStatementLine.findMany({
        where: { organizationId: user.organizationId, id: { in: uniqueIds } },
      });
      const byId = new Map(updatedRows.map((row) => [row.id, row]));
      return {
        rows: uniqueIds.map((id) => byId.get(id)).filter(Boolean),
        alreadyLinked,
      };
    });

    const linkedAfter = updated.alreadyLinked + lineSum;
    const label = this.treasuryLabel(kind);
    return {
      lines: updated.rows,
      payment: {
        id: transaction.id,
        kind,
        invoiceNumber: label,
        amount,
        mode: label,
        linkedCredits: direction === 'credit' ? linkedAfter : undefined,
        linkedDebits: direction === 'debit' ? linkedAfter : undefined,
        remaining: Math.max(0, amount - linkedAfter),
        complete: amount - linkedAfter <= AMOUNT_TOLERANCE,
      },
    };
  }

  private async confirmPurchaseMatchMany(
    lines: Awaited<ReturnType<BankStatementService['requireLine']>>[],
    uniqueIds: string[],
    payment: {
      id: string;
      amount: Decimal;
      mode: PaymentMethod;
      paidAt: Date;
      accountId: string | null;
      notes: string | null;
      purchaseInvoiceId: string;
      purchaseInvoice: {
        id: string;
        invoiceNumber: string | null;
        status: PurchaseStatus;
        vendorName: string | null;
      };
    },
    user: CurrentUserData,
  ) {
    if (!BANKISH_PAYMENT_MODES.includes(payment.mode as (typeof BANKISH_PAYMENT_MODES)[number])) {
      throw new BadRequestException(
        'Cash / credit / old-gold payments are not bank-reconciled here',
      );
    }

    const debitSum = lines.reduce((sum, line) => sum + Number(line.debit), 0);
    for (const line of lines) {
      if (!(Number(line.debit) > 0)) {
        throw new BadRequestException('Only debit lines can be matched to purchase payments');
      }
      if (!sameCalendarDay(payment.paidAt, line.txnDate)) {
        throw new BadRequestException(
          'Payment date must be the same calendar day as each bank debit date',
        );
      }
      if (payment.accountId && payment.accountId !== line.accountId) {
        throw new BadRequestException(
          'Payment is booked to a different bank account than this statement',
        );
      }
    }

    const accountIds = new Set(lines.map((line) => line.accountId));
    if (accountIds.size > 1) {
      throw new BadRequestException('All selected debits must be from the same bank account');
    }

    const updated = await runSerializable(this.prisma, async (tx) => {
      const linkedAgg = await tx.bankStatementLine.aggregate({
        where: {
          organizationId: user.organizationId,
          purchasePaymentId: payment.id,
          status: BankStatementLineStatus.MATCHED,
        },
        _sum: { debit: true },
      });
      const alreadyLinked = Number(linkedAgg._sum.debit || 0);
      const remaining = Number(payment.amount) - alreadyLinked;
      if (debitSum > remaining + AMOUNT_TOLERANCE) {
        throw new BadRequestException(
          `Selected debits (₹${debitSum.toFixed(2)}) exceed remaining payment capacity (₹${remaining.toFixed(2)})`,
        );
      }

      const matched = await tx.bankStatementLine.updateMany({
        where: {
          organizationId: user.organizationId,
          id: { in: uniqueIds },
          status: BankStatementLineStatus.UNMATCHED,
        },
        data: {
          status: BankStatementLineStatus.MATCHED,
          purchasePaymentId: payment.id,
        },
      });
      if (matched.count !== uniqueIds.length) {
        throw new BadRequestException('Only unmatched debits can be linked');
      }
      const updatedRows = await tx.bankStatementLine.findMany({
        where: { organizationId: user.organizationId, id: { in: uniqueIds } },
      });
      const byId = new Map(updatedRows.map((row) => [row.id, row]));
      const rows = uniqueIds.map((id) => byId.get(id)).filter(Boolean);
      const accountId = payment.accountId || lines[0].accountId;
      if (!payment.accountId) {
        await tx.purchasePayment.update({
          where: { id: payment.id },
          data: { accountId },
        });
      }
      await this.financeService.syncAutomaticPayment(tx, {
        organizationId: user.organizationId,
        sourceType: 'PURCHASE_PAYMENT',
        sourceId: payment.id,
        sourceParentType: 'PURCHASE',
        sourceParentId: payment.purchaseInvoiceId,
        transactionType: FinancialTransactionType.PURCHASE_PAYMENT,
        paymentMethod: payment.mode,
        accountId,
        amount: payment.amount,
        occurredAt: payment.paidAt,
        description: payment.notes ?? 'Purchase payment',
        createdById: user.userId,
      });
      return { rows, alreadyLinked };
    });

    const linkedAfter = updated.alreadyLinked + debitSum;
    const billLabel = payment.purchaseInvoice.invoiceNumber || 'Purchase';
    return {
      lines: updated.rows,
      payment: {
        id: payment.id,
        kind: 'PURCHASE' as const,
        invoiceNumber: billLabel,
        amount: Number(payment.amount),
        mode: payment.mode,
        linkedDebits: linkedAfter,
        remaining: Math.max(0, Number(payment.amount) - linkedAfter),
        complete: Number(payment.amount) - linkedAfter <= AMOUNT_TOLERANCE,
        customerName: payment.purchaseInvoice.vendorName || '',
      },
    };
  }

  private statementDirection(
    lines: Awaited<ReturnType<BankStatementService['requireLine']>>[],
  ): 'credit' | 'debit' {
    const directions = lines.map((line) => {
      const credit = Number(line.credit) > 0;
      const debit = Number(line.debit) > 0;
      if (credit === debit) return null;
      return credit ? ('credit' as const) : ('debit' as const);
    });
    if (directions.some((direction) => direction == null) || new Set(directions).size !== 1) {
      throw new BadRequestException('Selected lines must all be credits or all be debits');
    }
    return directions[0]!;
  }

  private async createCashDepositFromLine(
    tx: Parameters<FinanceService['createManualTransactionIn']>[0],
    line: {
      id: string;
      accountId: string;
      txnDate: Date;
      refNumber: string | null;
      narration: string;
    },
    credit: number,
    fromAccountId: string | undefined,
    user: CurrentUserData,
  ) {
    const cash = fromAccountId
      ? await tx.financialAccount.findFirst({
          where: {
            id: fromAccountId,
            organizationId: user.organizationId,
            type: FinancialAccountType.CASH,
            status: 'ACTIVE',
          },
        })
      : await this.financeService.ensureDefaultCash(tx, user.organizationId);
    if (!cash) throw new BadRequestException('Choose a cash account to deposit from');
    if (cash.id === line.accountId) {
      throw new BadRequestException('Cash deposit must move cash into this bank account');
    }
    return this.financeService.createManualTransactionIn(
      tx,
      {
        type: FinancialTransactionType.CASH_BANK_TRANSFER,
        fromAccountId: cash.id,
        toAccountId: line.accountId,
        amount: credit,
        occurredAt: line.txnDate,
        description: createMatchDescription('CASH_DEPOSIT', line.narration),
        reference: line.refNumber || undefined,
        sourceParentType: STATEMENT_CREATED.sourceParentType,
        sourceParentId: line.id,
      },
      user,
    );
  }

  private async createCashWithdrawalFromLine(
    tx: Parameters<FinanceService['createManualTransactionIn']>[0],
    line: {
      id: string;
      accountId: string;
      txnDate: Date;
      refNumber: string | null;
      narration: string;
    },
    debit: number,
    toAccountId: string | undefined,
    user: CurrentUserData,
  ) {
    const cash = toAccountId
      ? await tx.financialAccount.findFirst({
          where: {
            id: toAccountId,
            organizationId: user.organizationId,
            type: FinancialAccountType.CASH,
            status: 'ACTIVE',
          },
        })
      : await this.financeService.ensureDefaultCash(tx, user.organizationId);
    if (!cash) throw new BadRequestException('Choose a cash account to withdraw to');
    if (cash.id === line.accountId) {
      throw new BadRequestException('Cash withdrawal must move cash from this bank account');
    }
    return this.financeService.createManualTransactionIn(
      tx,
      {
        type: FinancialTransactionType.CASH_BANK_TRANSFER,
        fromAccountId: line.accountId,
        toAccountId: cash.id,
        amount: debit,
        occurredAt: line.txnDate,
        description: createMatchDescription('CASH_WITHDRAWAL', line.narration),
        reference: line.refNumber || undefined,
        sourceParentType: STATEMENT_CREATED.sourceParentType,
        sourceParentId: line.id,
      },
      user,
    );
  }

  private async requireLine(lineId: string, organizationId: string) {
    const line = await this.prisma.bankStatementLine.findFirst({
      where: { id: lineId, organizationId },
    });
    if (!line) throw new NotFoundException('Statement line not found');
    return line;
  }

  private findUnmatchedCredits(organizationId: string, accountId?: string) {
    return this.prisma.bankStatementLine.findMany({
      where: {
        organizationId,
        status: BankStatementLineStatus.UNMATCHED,
        credit: { gt: 0 },
        ...(accountId ? { accountId } : {}),
      },
      orderBy: [{ txnDate: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  private findUnmatchedDebits(organizationId: string, accountId?: string) {
    return this.prisma.bankStatementLine.findMany({
      where: {
        organizationId,
        status: BankStatementLineStatus.UNMATCHED,
        debit: { gt: 0 },
        ...(accountId ? { accountId } : {}),
      },
      orderBy: [{ txnDate: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  private withCreditSuggestions(
    lines: Awaited<ReturnType<BankStatementService['findUnmatchedCredits']>>,
    payments: PaymentCandidate[],
  ) {
    const byDay = indexPaymentsByCalendarDay(payments);
    return lines.map((line) => ({
      id: line.id,
      accountId: line.accountId,
      txnDate: line.txnDate,
      valueDate: line.valueDate,
      narration: line.narration,
      debit: Number(line.debit),
      credit: Number(line.credit),
      refNumber: line.refNumber,
      closingBalance: line.closingBalance == null ? null : Number(line.closingBalance),
      status: line.status,
      direction: 'credit' as const,
      suggestions: suggestPaymentsForCredit(
        {
          credit: Number(line.credit),
          narration: line.narration,
          refNumber: line.refNumber,
          txnDate: line.txnDate,
          accountId: line.accountId,
        },
        byDay.get(calendarDayKey(line.txnDate)) || [],
      ),
    }));
  }

  private withDebitSuggestions(
    lines: Awaited<ReturnType<BankStatementService['findUnmatchedDebits']>>,
    payments: PaymentCandidate[],
  ) {
    const byDay = indexPaymentsByCalendarDay(payments);
    return lines.map((line) => ({
      id: line.id,
      accountId: line.accountId,
      txnDate: line.txnDate,
      valueDate: line.valueDate,
      narration: line.narration,
      debit: Number(line.debit),
      credit: Number(line.credit),
      refNumber: line.refNumber,
      closingBalance: line.closingBalance == null ? null : Number(line.closingBalance),
      status: line.status,
      direction: 'debit' as const,
      suggestions: suggestPaymentsForDebit(
        {
          debit: Number(line.debit),
          narration: line.narration,
          refNumber: line.refNumber,
          txnDate: line.txnDate,
          accountId: line.accountId,
        },
        byDay.get(calendarDayKey(line.txnDate)) || [],
      ),
    }));
  }

  private oldestUnmatchedDate(lines: { txnDate: Date }[]): Date | undefined {
    if (!lines.length) return undefined;
    return lines.reduce(
      (oldest, line) => (line.txnDate < oldest ? line.txnDate : oldest),
      lines[0].txnDate,
    );
  }

  private serializeUnlinkedPayments(payments: PaymentCandidate[]) {
    return payments.map((payment) => ({
      paymentId: payment.id,
      kind: payment.kind || 'INVOICE',
      invoiceId: payment.invoiceId,
      invoiceNumber: payment.invoiceNumber,
      invoiceStatus: payment.invoiceStatus,
      customerName: payment.customerName,
      mode: payment.mode,
      amount: payment.amount,
      remaining: payment.remaining,
      paidAt: payment.paidAt,
      reference: payment.reference,
      accountId: payment.accountId,
    }));
  }

  private async loadUnlinkedBankishPayments(
    organizationId: string,
    accountId?: string,
    paidAtFrom?: Date,
  ): Promise<PaymentCandidate[]> {
    const grouped = await this.prisma.bankStatementLine.groupBy({
      by: ['invoicePaymentId'],
      where: {
        organizationId,
        status: BankStatementLineStatus.MATCHED,
        invoicePaymentId: { not: null },
        credit: { gt: 0 },
      },
      _sum: { credit: true },
    });
    const linkedSumByPayment = new Map<string, number>();
    for (const row of grouped) {
      if (!row.invoicePaymentId) continue;
      linkedSumByPayment.set(row.invoicePaymentId, Number(row._sum.credit || 0));
    }

    const rows = await this.prisma.invoicePayment.findMany({
      where: {
        organizationId,
        mode: { in: [...BANKISH_PAYMENT_MODES] as PaymentMethod[] },
        ...(accountId ? { OR: [{ accountId }, { accountId: null }] } : {}),
        ...(paidAtFrom ? { paidAt: { gte: paidAtFrom } } : {}),
      },
      select: {
        id: true,
        amount: true,
        mode: true,
        reference: true,
        paidAt: true,
        accountId: true,
        invoiceId: true,
        invoice: {
          select: {
            invoiceNumber: true,
            status: true,
            customer: { select: { fullName: true } },
          },
        },
      },
      orderBy: { paidAt: 'desc' },
      take: CANDIDATE_TAKE,
    });

    return rows
      .map((row) => {
        const amount = Number(row.amount);
        const linkedSum = linkedSumByPayment.get(row.id) || 0;
        const remaining = amount - linkedSum;
        return {
          id: row.id,
          amount,
          remaining,
          mode: row.mode,
          reference: row.reference,
          paidAt: row.paidAt,
          accountId: row.accountId,
          invoiceId: row.invoiceId,
          invoiceNumber: row.invoice.invoiceNumber,
          invoiceStatus: row.invoice.status,
          customerName: row.invoice.customer?.fullName || '',
          kind: 'INVOICE' as const,
        };
      })
      .filter((row) => row.remaining > AMOUNT_TOLERANCE);
  }

  private async loadUnlinkedTreasuryCredits(
    organizationId: string,
    accountId?: string,
    paidAtFrom?: Date,
  ): Promise<PaymentCandidate[]> {
    const grouped = await this.prisma.bankStatementLine.groupBy({
      by: ['financialTransactionId'],
      where: {
        organizationId,
        status: BankStatementLineStatus.MATCHED,
        financialTransactionId: { not: null },
        credit: { gt: 0 },
      },
      _sum: { credit: true },
    });
    const linkedSumByTx = new Map<string, number>();
    for (const row of grouped) {
      if (!row.financialTransactionId) continue;
      linkedSumByTx.set(row.financialTransactionId, Number(row._sum.credit || 0));
    }

    const rows = await this.prisma.financialTransaction.findMany({
      where: {
        organizationId,
        reversedAt: null,
        type: {
          in: [FinancialTransactionType.ADJUSTMENT, FinancialTransactionType.CASH_BANK_TRANSFER],
        },
        ...(paidAtFrom ? { occurredAt: { gte: paidAtFrom } } : {}),
        movements: {
          some: {
            amount: { gt: 0 },
            ...(accountId ? { accountId } : { account: { type: FinancialAccountType.BANK } }),
          },
        },
      },
      include: {
        movements: { include: { account: { select: { type: true } } } },
      },
      orderBy: { occurredAt: 'desc' },
      take: CANDIDATE_TAKE,
    });

    return rows
      .map((row) => {
        const bankIn = row.movements.find(
          (movement) =>
            Number(movement.amount) > 0 &&
            movement.account?.type === FinancialAccountType.BANK &&
            (!accountId || movement.accountId === accountId),
        );
        if (!bankIn?.accountId) return null;
        const kind = this.treasuryKind(row.type, row.description);
        if (kind === 'CASH_DEPOSIT') {
          const fromCash = row.movements.find(
            (movement) =>
              Number(movement.amount) < 0 && movement.account?.type === FinancialAccountType.CASH,
          );
          if (!fromCash) return null;
        }
        const amount = Number(bankIn.amount);
        const remaining = amount - (linkedSumByTx.get(row.id) || 0);
        const label = this.treasuryLabel(kind);
        return {
          id: row.id,
          amount,
          remaining,
          mode: label,
          reference: row.reference,
          paidAt: row.occurredAt,
          accountId: bankIn.accountId,
          kind,
          invoiceNumber: label,
          customerName: '',
        } as PaymentCandidate;
      })
      .filter((row): row is PaymentCandidate => Boolean(row) && row.remaining > AMOUNT_TOLERANCE);
  }

  private async loadUnlinkedAdvanceReceipts(
    organizationId: string,
    accountId?: string,
    paidAtFrom?: Date,
  ): Promise<PaymentCandidate[]> {
    const grouped = await this.prisma.bankStatementLine.groupBy({
      by: ['financialTransactionId'],
      where: {
        organizationId,
        status: BankStatementLineStatus.MATCHED,
        financialTransactionId: { not: null },
        credit: { gt: 0 },
      },
      _sum: { credit: true },
    });
    const linkedSumByTx = new Map<string, number>();
    for (const row of grouped) {
      if (!row.financialTransactionId) continue;
      linkedSumByTx.set(row.financialTransactionId, Number(row._sum.credit || 0));
    }

    const rows = await this.prisma.financialTransaction.findMany({
      where: {
        organizationId,
        reversedAt: null,
        type: FinancialTransactionType.ADVANCE_RECEIPT,
        ...(paidAtFrom ? { occurredAt: { gte: paidAtFrom } } : {}),
        movements: {
          some: {
            amount: { gt: 0 },
            ...(accountId ? { accountId } : { account: { type: FinancialAccountType.BANK } }),
          },
        },
      },
      include: {
        movements: { include: { account: { select: { type: true } } } },
      },
      orderBy: { occurredAt: 'desc' },
      take: CANDIDATE_TAKE,
    });

    const ledgerIds = rows.map((row) => row.sourceId);
    const ledgers = ledgerIds.length
      ? await this.prisma.ledgerEntry.findMany({
          where: { organizationId, id: { in: ledgerIds } },
          select: { id: true, customer: { select: { fullName: true } } },
        })
      : [];
    const customerByLedger = new Map(ledgers.map((row) => [row.id, row.customer?.fullName || '']));

    return rows
      .map((row) => {
        const bankIn = row.movements.find(
          (movement) =>
            Number(movement.amount) > 0 &&
            movement.account?.type === FinancialAccountType.BANK &&
            (!accountId || movement.accountId === accountId),
        );
        if (!bankIn?.accountId) return null;
        const amount = Number(bankIn.amount);
        const remaining = amount - (linkedSumByTx.get(row.id) || 0);
        const label = this.treasuryLabel('ADVANCE');
        return {
          id: row.id,
          amount,
          remaining,
          mode: label,
          reference: row.reference,
          paidAt: row.occurredAt,
          accountId: bankIn.accountId,
          kind: 'ADVANCE' as const,
          invoiceNumber: label,
          customerName: customerByLedger.get(row.sourceId) || '',
        } as PaymentCandidate;
      })
      .filter((row): row is PaymentCandidate => Boolean(row) && row.remaining > AMOUNT_TOLERANCE);
  }

  private async loadUnlinkedPurchasePayments(
    organizationId: string,
    accountId?: string,
    paidAtFrom?: Date,
  ): Promise<PaymentCandidate[]> {
    const grouped = await this.prisma.bankStatementLine.groupBy({
      by: ['purchasePaymentId'],
      where: {
        organizationId,
        status: BankStatementLineStatus.MATCHED,
        purchasePaymentId: { not: null },
        debit: { gt: 0 },
      },
      _sum: { debit: true },
    });
    const linkedSumByPayment = new Map<string, number>();
    for (const row of grouped) {
      if (!row.purchasePaymentId) continue;
      linkedSumByPayment.set(row.purchasePaymentId, Number(row._sum.debit || 0));
    }

    const rows = await this.prisma.purchasePayment.findMany({
      where: {
        organizationId,
        mode: { in: [...BANKISH_PAYMENT_MODES] as PaymentMethod[] },
        ...(accountId ? { OR: [{ accountId }, { accountId: null }] } : {}),
        ...(paidAtFrom ? { paidAt: { gte: paidAtFrom } } : {}),
      },
      select: {
        id: true,
        amount: true,
        mode: true,
        reference: true,
        paidAt: true,
        accountId: true,
        purchaseInvoiceId: true,
        purchaseInvoice: {
          select: {
            invoiceNumber: true,
            status: true,
            vendorName: true,
          },
        },
      },
      orderBy: { paidAt: 'desc' },
      take: CANDIDATE_TAKE,
    });

    return rows
      .map((row) => {
        const amount = Number(row.amount);
        const linkedSum = linkedSumByPayment.get(row.id) || 0;
        const remaining = amount - linkedSum;
        return {
          id: row.id,
          amount,
          remaining,
          mode: row.mode,
          reference: row.reference,
          paidAt: row.paidAt,
          accountId: row.accountId,
          invoiceId: row.purchaseInvoiceId,
          invoiceNumber: row.purchaseInvoice.invoiceNumber || 'Purchase',
          invoiceStatus: row.purchaseInvoice.status,
          customerName: row.purchaseInvoice.vendorName || '',
          kind: 'PURCHASE' as const,
        };
      })
      .filter((row) => row.remaining > AMOUNT_TOLERANCE);
  }

  private async loadUnlinkedTreasuryDebits(
    organizationId: string,
    accountId?: string,
    paidAtFrom?: Date,
  ): Promise<PaymentCandidate[]> {
    const grouped = await this.prisma.bankStatementLine.groupBy({
      by: ['financialTransactionId'],
      where: {
        organizationId,
        status: BankStatementLineStatus.MATCHED,
        financialTransactionId: { not: null },
        debit: { gt: 0 },
      },
      _sum: { debit: true },
    });
    const linkedSumByTx = new Map<string, number>();
    for (const row of grouped) {
      if (!row.financialTransactionId) continue;
      linkedSumByTx.set(row.financialTransactionId, Number(row._sum.debit || 0));
    }

    const rows = await this.prisma.financialTransaction.findMany({
      where: {
        organizationId,
        reversedAt: null,
        type: {
          in: [FinancialTransactionType.ADJUSTMENT, FinancialTransactionType.CASH_BANK_TRANSFER],
        },
        ...(paidAtFrom ? { occurredAt: { gte: paidAtFrom } } : {}),
        movements: {
          some: {
            amount: { lt: 0 },
            ...(accountId ? { accountId } : { account: { type: FinancialAccountType.BANK } }),
          },
        },
      },
      include: {
        movements: { include: { account: { select: { type: true } } } },
      },
      orderBy: { occurredAt: 'desc' },
      take: CANDIDATE_TAKE,
    });

    return rows
      .map((row) => {
        const bankOut = row.movements.find(
          (movement) =>
            Number(movement.amount) < 0 &&
            movement.account?.type === FinancialAccountType.BANK &&
            (!accountId || movement.accountId === accountId),
        );
        if (!bankOut?.accountId) return null;
        const kind = this.treasuryKind(row.type, row.description, 'debit');
        const amount = Math.abs(Number(bankOut.amount));
        const remaining = amount - (linkedSumByTx.get(row.id) || 0);
        const label = this.treasuryLabel(kind);
        return {
          id: row.id,
          amount,
          remaining,
          mode: label,
          reference: row.reference,
          paidAt: row.occurredAt,
          accountId: bankOut.accountId,
          kind,
          invoiceNumber: row.description?.trim() || label,
          customerName: '',
        } as PaymentCandidate;
      })
      .filter((row): row is PaymentCandidate => Boolean(row) && row.remaining > AMOUNT_TOLERANCE);
  }

  private treasuryKind(
    type: FinancialTransactionType,
    description?: string | null,
    direction: 'credit' | 'debit' = 'credit',
  ): PaymentCandidateKind {
    if (type === FinancialTransactionType.CASH_BANK_TRANSFER) {
      return direction === 'debit' ? 'MONEY_OUT' : 'CASH_DEPOSIT';
    }
    if (type === FinancialTransactionType.ADVANCE_RECEIPT) return 'ADVANCE';
    if (type === FinancialTransactionType.PURCHASE_PAYMENT) return 'PURCHASE';
    const label = String(description || '').trim();
    if (/^advance(\s|$|[—\-:])/i.test(label)) return 'ADVANCE';
    if (/^loan(\s|$|[—\-:])/i.test(label)) return 'LOAN';
    return direction === 'debit' ? 'MONEY_OUT' : 'MONEY_IN';
  }

  private treasuryLabel(kind: PaymentCandidateKind) {
    if (kind === 'CASH_DEPOSIT') return 'Cash deposit';
    if (kind === 'LOAN') return 'Loan';
    if (kind === 'ADVANCE') return 'Advance';
    if (kind === 'PURCHASE') return 'Purchase';
    if (kind === 'MONEY_IN') return 'Money In';
    if (kind === 'MONEY_OUT') return 'Money Out';
    return 'Invoice';
  }
}
