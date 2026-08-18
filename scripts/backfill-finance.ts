import {
  FinancialAccountType,
  FinancialTransactionType,
  InvoiceStatus,
  LedgerType,
  PaymentMethod,
  Prisma,
  PrismaClient,
  PurchaseStatus,
} from '@prisma/client';
import { FinanceService } from '../src/finance/finance.service';

const prisma = new PrismaClient();
const finance = new FinanceService(prisma as any);
const dryRun = process.argv.includes('--dry-run');
const BACKFILL_CHUNK = 25;
const BACKFILL_TX = { maxWait: 10_000, timeout: 60_000 };

async function forChunks<T>(
  rows: T[],
  work: (tx: Prisma.TransactionClient, row: T) => Promise<void>,
) {
  for (let i = 0; i < rows.length; i += BACKFILL_CHUNK) {
    const chunk = rows.slice(i, i + BACKFILL_CHUNK);
    await prisma.$transaction(async (tx) => {
      for (const row of chunk) await work(tx, row);
    }, BACKFILL_TX);
  }
}

async function main() {
  const organizations = await prisma.organization.findMany({ select: { id: true } });
  const counts = {
    organizations: organizations.length,
    invoicePayments: 0,
    purchasePayments: 0,
    advanceEntries: 0,
    udharPayments: 0,
  };

  for (const { id: organizationId } of organizations) {
    const cash = dryRun
      ? await prisma.financialAccount.findFirst({
          where: { organizationId, type: FinancialAccountType.CASH, isDefault: true },
        })
      : await finance.ensureDefaultCash(prisma, organizationId);

    const invoicePayments = await prisma.invoicePayment.findMany({
      where: {
        organizationId,
        amount: { gt: 0 },
        invoice: {
          deletedAt: null,
          status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED] },
        },
      },
    });
    counts.invoicePayments += invoicePayments.length;

    const purchasePayments = await prisma.purchasePayment.findMany({
      where: {
        organizationId,
        amount: { gt: 0 },
        purchaseInvoice: { status: { not: PurchaseStatus.CANCELLED } },
      },
    });
    counts.purchasePayments += purchasePayments.length;

    const advanceEntries = await prisma.ledgerEntry.findMany({
      where: {
        organizationId,
        amount: { gt: 0 },
        deletedAt: null,
        type: { in: [LedgerType.ADVANCE_RECEIVED, LedgerType.ADVANCE_REFUND] },
      },
    });
    counts.advanceEntries += advanceEntries.length;

    const directUdhars = await prisma.udharEntry.findMany({
      where: { organizationId, invoiceId: null },
      select: { id: true },
    });
    const udharPayments = await prisma.ledgerEntry.findMany({
      where: {
        organizationId,
        amount: { gt: 0 },
        deletedAt: null,
        type: LedgerType.PAYMENT,
        entityId: { in: directUdhars.map(({ id }) => id) },
      },
    });
    counts.udharPayments += udharPayments.length;

    if (dryRun) continue;

    await forChunks(invoicePayments, async (tx, payment) => {
      const accountId = payment.mode === PaymentMethod.CASH ? cash?.id : payment.accountId;
      if (accountId !== payment.accountId) {
        await tx.invoicePayment.update({ where: { id: payment.id }, data: { accountId } });
      }
      await finance.syncAutomaticPayment(
        tx,
        {
          organizationId,
          sourceType: 'INVOICE_PAYMENT',
          sourceId: payment.id,
          sourceParentType: 'INVOICE',
          sourceParentId: payment.invoiceId,
          transactionType: FinancialTransactionType.SALE_RECEIPT,
          paymentMethod: payment.mode,
          accountId,
          amount: payment.amount,
          occurredAt: payment.paidAt,
          description: payment.notes,
        },
        true,
      );
    });

    await forChunks(purchasePayments, async (tx, payment) => {
      const accountId = payment.mode === PaymentMethod.CASH ? cash?.id : payment.accountId;
      if (accountId !== payment.accountId) {
        await tx.purchasePayment.update({ where: { id: payment.id }, data: { accountId } });
      }
      await finance.syncAutomaticPayment(
        tx,
        {
          organizationId,
          sourceType: 'PURCHASE_PAYMENT',
          sourceId: payment.id,
          sourceParentType: 'PURCHASE',
          sourceParentId: payment.purchaseInvoiceId,
          transactionType: FinancialTransactionType.PURCHASE_PAYMENT,
          paymentMethod: payment.mode,
          accountId,
          amount: payment.amount,
          occurredAt: payment.paidAt,
          description: payment.notes,
        },
        true,
      );
    });

    await forChunks(advanceEntries, async (tx, entry) => {
      const method = entry.paymentMethod ?? PaymentMethod.OTHER;
      const accountId = method === PaymentMethod.CASH ? cash?.id : entry.accountId;
      if (accountId !== entry.accountId) {
        await tx.ledgerEntry.update({ where: { id: entry.id }, data: { accountId } });
      }
      await finance.syncAutomaticPayment(
        tx,
        {
          organizationId,
          sourceType: 'ADVANCE_LEDGER',
          sourceId: entry.id,
          sourceParentType: 'ADVANCE',
          sourceParentId: entry.id,
          transactionType:
            entry.type === LedgerType.ADVANCE_REFUND
              ? FinancialTransactionType.ADVANCE_REFUND
              : FinancialTransactionType.ADVANCE_RECEIPT,
          paymentMethod: method,
          accountId,
          amount: entry.amount,
          occurredAt: entry.createdAt,
          description: entry.description,
        },
        true,
      );
    });

    await forChunks(udharPayments, async (tx, payment) => {
      const method = payment.paymentMethod ?? PaymentMethod.OTHER;
      const accountId = method === PaymentMethod.CASH ? cash?.id : payment.accountId;
      if (accountId !== payment.accountId) {
        await tx.ledgerEntry.update({ where: { id: payment.id }, data: { accountId } });
      }
      await finance.syncAutomaticPayment(
        tx,
        {
          organizationId,
          sourceType: 'UDHAR_PAYMENT',
          sourceId: payment.id,
          sourceParentType: 'UDHAR',
          sourceParentId: payment.entityId!,
          transactionType: FinancialTransactionType.UDHAR_COLLECTION,
          paymentMethod: method,
          accountId,
          amount: payment.amount,
          occurredAt: payment.createdAt,
          description: payment.description,
        },
        true,
      );
    });
  }

  console.log(JSON.stringify({ dryRun, ...counts }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
