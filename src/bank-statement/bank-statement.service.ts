import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BankStatementLineStatus,
  FinancialAccountType,
  FinancialTransactionType,
  PaymentMethod,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { CurrentUserData } from '../auth/current-user.decorator';
import { FinanceService } from '../finance/finance.service';
import { PrismaService } from '../prisma/prisma.service';
import { parseHdfcDelimited } from './hdfc-statement.parser';
import {
  AMOUNT_TOLERANCE,
  BANKISH_PAYMENT_MODES,
  calendarDayKey,
  indexPaymentsByCalendarDay,
  PaymentCandidate,
  sameCalendarDay,
  suggestPaymentsForCredit,
} from './suggest-payments';

@Injectable()
export class BankStatementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financeService: FinanceService = new FinanceService(prisma),
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
        await tx.bankStatementLine.createMany({
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
        });
      }

      return imp;
    });

    return {
      import: result,
      parsed: parsed.length,
      imported: fresh.length,
      skipped: parsed.length - fresh.length,
      credits: creditCount,
      debits: debitCount,
    };
  }

  /** One round-trip for the reconcile tab: unmatched credits, open payments, linked history. */
  async listInbox(organizationId: string, accountId?: string) {
    const [lines, payments, matched] = await Promise.all([
      this.findUnmatchedCredits(organizationId, accountId),
      this.loadUnlinkedBankishPayments(organizationId, accountId),
      this.listMatched(organizationId, accountId),
    ]);
    return {
      unmatched: this.withSuggestions(lines, payments),
      payments: this.serializeUnlinkedPayments(payments),
      matched,
    };
  }

  async listUnmatched(organizationId: string, accountId?: string) {
    const [lines, payments] = await Promise.all([
      this.findUnmatchedCredits(organizationId, accountId),
      this.loadUnlinkedBankishPayments(organizationId, accountId),
    ]);
    return this.withSuggestions(lines, payments);
  }

  /** Booked non-cash payments not yet fully covered by statement credits. */
  async listUnmatchedPayments(organizationId: string, accountId?: string) {
    const payments = await this.loadUnlinkedBankishPayments(organizationId, accountId);
    return this.serializeUnlinkedPayments(payments);
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

    return lines.map((line) => {
      const payment = line.invoicePaymentId ? paymentById.get(line.invoicePaymentId) : undefined;
      return {
        id: line.id,
        accountId: line.accountId,
        txnDate: line.txnDate,
        narration: line.narration,
        refNumber: line.refNumber,
        credit: Number(line.credit),
        matchedAt: line.updatedAt,
        paymentId: line.invoicePaymentId,
        invoiceId: payment?.invoice.id || line.matchedInvoiceId,
        invoiceNumber: payment?.invoice.invoiceNumber || null,
        invoiceStatus: payment?.invoice.status || null,
        customerName: payment?.invoice.customer?.fullName || '',
        mode: payment?.mode || null,
        paidAt: payment?.paidAt || null,
        paymentReference: payment?.reference || null,
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
    return this.prisma.bankStatementLine.update({
      where: { id: line.id },
      data: {
        status: BankStatementLineStatus.UNMATCHED,
        matchedInvoiceId: null,
        invoicePaymentId: null,
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
      where: { organizationId: user.organizationId, id: { in: uniqueIds } },
    });
    return { count: deleted.count, deleted: lines[0] };
  }

  async confirmMatch(lineId: string, paymentId: string, user: CurrentUserData) {
    return this.confirmMatchMany([lineId], paymentId, user);
  }

  /**
   * Link one or more statement credits to one booked payment.
   * Credits may be splits (10+20+5+15 → ₹50 payment) as long as sum ≤ remaining
   * and each credit is same calendar day as payment.paidAt.
   */
  async confirmMatchMany(lineIds: string[], paymentId: string, user: CurrentUserData) {
    const uniqueIds = [...new Set(lineIds.filter(Boolean))];
    if (!uniqueIds.length) {
      throw new BadRequestException('Select at least one statement credit');
    }

    const lines = await this.prisma.bankStatementLine.findMany({
      where: { organizationId: user.organizationId, id: { in: uniqueIds } },
    });
    if (lines.length !== uniqueIds.length) {
      throw new NotFoundException('One or more statement lines were not found');
    }

    for (const line of lines) {
      if (line.status !== BankStatementLineStatus.UNMATCHED) {
        throw new BadRequestException('Only unmatched credits can be linked');
      }
      if (!(Number(line.credit) > 0)) {
        throw new BadRequestException('Only credit lines can be matched to payments');
      }
    }

    const payment = await this.prisma.invoicePayment.findFirst({
      where: { id: paymentId, organizationId: user.organizationId },
      include: {
        invoice: { select: { id: true, invoiceNumber: true, status: true } },
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    if (!BANKISH_PAYMENT_MODES.includes(payment.mode as (typeof BANKISH_PAYMENT_MODES)[number])) {
      throw new BadRequestException(
        'Cash / credit / old-gold payments are not bank-reconciled here',
      );
    }

    const creditSum = lines.reduce((sum, line) => sum + Number(line.credit), 0);
    const linkedAgg = await this.prisma.bankStatementLine.aggregate({
      where: {
        organizationId: user.organizationId,
        invoicePaymentId: payment.id,
        status: BankStatementLineStatus.MATCHED,
      },
      _sum: { credit: true },
    });
    const alreadyLinked = Number(linkedAgg._sum.credit || 0);
    const remaining = Number(payment.amount) - alreadyLinked;
    if (creditSum > remaining + AMOUNT_TOLERANCE) {
      throw new BadRequestException(
        `Selected credits (₹${creditSum.toFixed(2)}) exceed remaining payment capacity (₹${remaining.toFixed(2)})`,
      );
    }

    for (const line of lines) {
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

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.bankStatementLine.updateMany({
        where: { organizationId: user.organizationId, id: { in: uniqueIds } },
        data: {
          status: BankStatementLineStatus.MATCHED,
          matchedInvoiceId: payment.invoiceId,
          invoicePaymentId: payment.id,
        },
      });
      const updatedRows = await tx.bankStatementLine.findMany({
        where: { organizationId: user.organizationId, id: { in: uniqueIds } },
      });
      const byId = new Map(updatedRows.map((row) => [row.id, row]));
      const rows = uniqueIds.map((id) => byId.get(id)).filter(Boolean);
      const accountId = payment.accountId || lines[0].accountId;
      if (!payment.accountId) {
        await tx.invoicePayment.update({
          where: { id: payment.id },
          data: { accountId },
        });
      }
      // Upsert once for the booked payment amount (not per credit).
      await this.financeService.syncAutomaticPayment(tx, {
        organizationId: user.organizationId,
        sourceType: 'INVOICE_PAYMENT',
        sourceId: payment.id,
        sourceParentType: 'INVOICE',
        sourceParentId: payment.invoiceId,
        transactionType: FinancialTransactionType.SALE_RECEIPT,
        paymentMethod: payment.mode,
        accountId,
        amount: payment.amount,
        occurredAt: payment.paidAt,
        description: payment.notes ?? 'Invoice payment',
        createdById: user.userId,
      });
      return rows;
    });

    const linkedAfter = alreadyLinked + creditSum;
    return {
      lines: updated,
      payment: {
        id: payment.id,
        invoiceId: payment.invoiceId,
        invoiceNumber: payment.invoice.invoiceNumber,
        amount: Number(payment.amount),
        mode: payment.mode,
        linkedCredits: linkedAfter,
        remaining: Math.max(0, Number(payment.amount) - linkedAfter),
        complete: Number(payment.amount) - linkedAfter <= AMOUNT_TOLERANCE,
      },
    };
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

  private withSuggestions(
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

  private serializeUnlinkedPayments(payments: PaymentCandidate[]) {
    return payments.map((payment) => ({
      paymentId: payment.id,
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

    const since = new Date();
    since.setDate(since.getDate() - 120);

    const rows = await this.prisma.invoicePayment.findMany({
      where: {
        organizationId,
        mode: { in: [...BANKISH_PAYMENT_MODES] as PaymentMethod[] },
        paidAt: { gte: since },
        ...(accountId ? { OR: [{ accountId }, { accountId: null }] } : {}),
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
      take: 800,
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
        };
      })
      .filter((row) => row.remaining > AMOUNT_TOLERANCE);
  }
}
