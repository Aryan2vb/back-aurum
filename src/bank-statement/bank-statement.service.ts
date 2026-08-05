import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BankStatementLineStatus,
  FinancialAccountType,
  PaymentMethod,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { CurrentUserData } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { parseHdfcDelimited } from './hdfc-statement.parser';
import {
  BANKISH_PAYMENT_MODES,
  PaymentCandidate,
  suggestPaymentsForCredit,
} from './suggest-payments';

@Injectable()
export class BankStatementService {
  constructor(private readonly prisma: PrismaService) {}

  async upload(
    accountId: string,
    text: string,
    filename: string,
    user: CurrentUserData,
  ) {
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
      throw new BadRequestException('No statement rows found. Export HDFC Delimited (.txt) and try again.');
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

  async listUnmatched(organizationId: string, accountId?: string) {
    const lines = await this.prisma.bankStatementLine.findMany({
      where: {
        organizationId,
        status: BankStatementLineStatus.UNMATCHED,
        credit: { gt: 0 },
        ...(accountId ? { accountId } : {}),
      },
      orderBy: [{ txnDate: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });

    const payments = await this.loadUnlinkedBankishPayments(organizationId, accountId);

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
        payments,
      ),
    }));
  }

  /** Booked non-cash payments not yet linked to a statement credit. */
  async listUnmatchedPayments(organizationId: string, accountId?: string) {
    const payments = await this.loadUnlinkedBankishPayments(organizationId, accountId);
    return payments.map((payment) => ({
      paymentId: payment.id,
      invoiceId: payment.invoiceId,
      invoiceNumber: payment.invoiceNumber,
      invoiceStatus: payment.invoiceStatus,
      customerName: payment.customerName,
      mode: payment.mode,
      amount: payment.amount,
      paidAt: payment.paidAt,
      reference: payment.reference,
      accountId: payment.accountId,
    }));
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
      const payment = line.invoicePaymentId
        ? paymentById.get(line.invoicePaymentId)
        : undefined;
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
    const line = await this.requireLine(lineId, user.organizationId);
    if (line.status === BankStatementLineStatus.MATCHED) {
      throw new BadRequestException('Unlink matched lines before deleting');
    }
    return this.prisma.bankStatementLine.delete({ where: { id: line.id } });
  }

  async confirmMatch(lineId: string, paymentId: string, user: CurrentUserData) {
    const line = await this.requireLine(lineId, user.organizationId);
    if (line.status !== BankStatementLineStatus.UNMATCHED) {
      throw new BadRequestException('Line is already matched or ignored');
    }
    if (!(Number(line.credit) > 0)) {
      throw new BadRequestException('Only credit lines can be matched to payments');
    }

    const payment = await this.prisma.invoicePayment.findFirst({
      where: { id: paymentId, organizationId: user.organizationId },
      include: {
        invoice: { select: { id: true, invoiceNumber: true, status: true } },
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    if (!BANKISH_PAYMENT_MODES.includes(payment.mode as (typeof BANKISH_PAYMENT_MODES)[number])) {
      throw new BadRequestException('Cash / credit / old-gold payments are not bank-reconciled here');
    }

    const amountDiff = Math.abs(Number(payment.amount) - Number(line.credit));
    if (amountDiff > 1) {
      throw new BadRequestException('Payment amount does not match statement credit');
    }

    const alreadyLinked = await this.prisma.bankStatementLine.findFirst({
      where: {
        organizationId: user.organizationId,
        invoicePaymentId: payment.id,
        status: BankStatementLineStatus.MATCHED,
      },
      select: { id: true },
    });
    if (alreadyLinked) {
      throw new BadRequestException('This payment is already linked to another statement line');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const lineRow = await tx.bankStatementLine.update({
        where: { id: line.id },
        data: {
          status: BankStatementLineStatus.MATCHED,
          matchedInvoiceId: payment.invoiceId,
          invoicePaymentId: payment.id,
        },
      });
      // Fill account on the payment if staff never picked one at booking time.
      if (!payment.accountId) {
        await tx.invoicePayment.update({
          where: { id: payment.id },
          data: { accountId: line.accountId },
        });
      }
      return lineRow;
    });

    return {
      line: updated,
      payment: {
        id: payment.id,
        invoiceId: payment.invoiceId,
        invoiceNumber: payment.invoice.invoiceNumber,
        amount: Number(payment.amount),
        mode: payment.mode,
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

  private async loadUnlinkedBankishPayments(
    organizationId: string,
    accountId?: string,
  ): Promise<PaymentCandidate[]> {
    const linked = await this.prisma.bankStatementLine.findMany({
      where: {
        organizationId,
        status: BankStatementLineStatus.MATCHED,
        invoicePaymentId: { not: null },
      },
      select: { invoicePaymentId: true },
    });
    const linkedIds = linked
      .map((row) => row.invoicePaymentId)
      .filter((id): id is string => Boolean(id));

    const since = new Date();
    since.setDate(since.getDate() - 120);

    const rows = await this.prisma.invoicePayment.findMany({
      where: {
        organizationId,
        mode: { in: [...BANKISH_PAYMENT_MODES] as PaymentMethod[] },
        paidAt: { gte: since },
        ...(linkedIds.length ? { id: { notIn: linkedIds } } : {}),
        ...(accountId
          ? { OR: [{ accountId }, { accountId: null }] }
          : {}),
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

    return rows.map((row) => ({
      id: row.id,
      amount: Number(row.amount),
      mode: row.mode,
      reference: row.reference,
      paidAt: row.paidAt,
      accountId: row.accountId,
      invoiceId: row.invoiceId,
      invoiceNumber: row.invoice.invoiceNumber,
      invoiceStatus: row.invoice.status,
      customerName: row.invoice.customer?.fullName || '',
    }));
  }
}
