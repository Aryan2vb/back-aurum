import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BankStatementLineStatus,
  FinancialAccountType,
  InvoiceStatus,
  PaymentMethod,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { CurrentUserData } from '../auth/current-user.decorator';
import { InvoicesService } from '../invoices/invoices.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  inferPaymentMethodFromNarration,
  parseHdfcDelimited,
} from './hdfc-statement.parser';

const AMOUNT_TOLERANCE = 1;

type OpenInvoice = {
  id: string;
  invoiceNumber: string;
  totalAmount: Decimal;
  paidAmount: Decimal;
  invoiceDate: Date;
  customer: { id: string; fullName: string };
};

@Injectable()
export class BankStatementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoicesService,
  ) {}

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

    const openInvoices = await this.loadOpenInvoices(organizationId);

    return lines.map((line) => {
      const suggestions = this.suggestInvoices(line, openInvoices);
      return {
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
        suggestions,
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

  async confirmMatch(lineId: string, invoiceId: string, user: CurrentUserData) {
    const line = await this.requireLine(lineId, user.organizationId);
    if (line.status !== BankStatementLineStatus.UNMATCHED) {
      throw new BadRequestException('Line is already matched or ignored');
    }
    const credit = Number(line.credit);
    if (!(credit > 0)) {
      throw new BadRequestException('Only credit lines can be matched to invoices');
    }

    const paymentMethod = inferPaymentMethodFromNarration(line.narration) as PaymentMethod;
    const updatedInvoice = await this.invoices.recordPayment(
      invoiceId,
      {
        amount: credit,
        paymentMethod,
        reference: line.refNumber || undefined,
        notes: `Bank statement: ${line.narration.slice(0, 180)}`,
        accountId: line.accountId,
      },
      user,
    );

    const payment = await this.prisma.invoicePayment.findFirst({
      where: {
        invoiceId,
        organizationId: user.organizationId,
        amount: new Decimal(credit),
        ...(line.refNumber ? { reference: line.refNumber } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    const updated = await this.prisma.bankStatementLine.update({
      where: { id: line.id },
      data: {
        status: BankStatementLineStatus.MATCHED,
        matchedInvoiceId: invoiceId,
        invoicePaymentId: payment?.id || null,
      },
    });

    return { line: updated, invoice: updatedInvoice, payment };
  }

  private async requireLine(lineId: string, organizationId: string) {
    const line = await this.prisma.bankStatementLine.findFirst({
      where: { id: lineId, organizationId },
    });
    if (!line) throw new NotFoundException('Statement line not found');
    return line;
  }

  private async loadOpenInvoices(organizationId: string): Promise<OpenInvoice[]> {
    return this.prisma.invoice.findMany({
      where: {
        organizationId,
        deletedAt: null,
        status: { in: [InvoiceStatus.UNPAID, InvoiceStatus.PARTIAL] },
      },
      select: {
        id: true,
        invoiceNumber: true,
        totalAmount: true,
        paidAmount: true,
        invoiceDate: true,
        customer: { select: { id: true, fullName: true } },
      },
      orderBy: { invoiceDate: 'desc' },
      take: 500,
    });
  }

  private suggestInvoices(
    line: { credit: Decimal; narration: string; refNumber: string | null; txnDate: Date },
    invoices: OpenInvoice[],
  ) {
    const credit = Number(line.credit);
    const narration = (line.narration || '').toUpperCase();
    const scored = invoices
      .map((invoice) => {
        const remaining = new Decimal(invoice.totalAmount).minus(new Decimal(invoice.paidAmount)).toNumber();
        if (remaining <= 0) return null;

        let score = 0;
        const amountDiff = Math.abs(remaining - credit);
        if (amountDiff <= AMOUNT_TOLERANCE) score += 100 - amountDiff;
        else if (credit <= remaining + AMOUNT_TOLERANCE) score += Math.max(0, 40 - Math.abs(remaining - credit) / 100);

        const invNo = (invoice.invoiceNumber || '').toUpperCase();
        if (invNo && narration.includes(invNo)) score += 80;
        const invTail = invNo.split('/').filter(Boolean).pop();
        if (invTail && invTail.length >= 3 && narration.includes(invTail)) score += 40;

        const name = (invoice.customer?.fullName || '').toUpperCase().trim();
        if (name.length >= 4) {
          const tokens = name.split(/\s+/).filter((t) => t.length >= 4);
          if (tokens.some((t) => narration.includes(t))) score += 30;
        }

        if (line.refNumber && narration.includes(String(line.refNumber).toUpperCase())) {
          // ref already on the bank line; mild boost only if also on invoice side later
        }

        if (score <= 0) return null;
        return {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          customerName: invoice.customer?.fullName || '',
          remainingBalance: remaining,
          invoiceDate: invoice.invoiceDate,
          score,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b!.score - a!.score)
      .slice(0, 5);

    return scored;
  }
}
