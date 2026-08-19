/**
 * One-off: remove stock ledger rows whose referenceId no longer exists
 * (e.g. purchase deleted under old reverse-on-delete behavior).
 * Run: npx ts-node scripts/purge-orphan-stock-ledger.ts [--apply]
 */
import { StockTransactionType } from '@prisma/client';
import { StockService } from '../src/stock/stock.service';
import { PrismaService } from '../src/prisma/prisma.service';

async function main() {
  const prisma = new PrismaService();
  const stockService = new StockService(prisma);
  const dryRun = !process.argv.includes('--apply');

  // Only bill-backed rows carry a purchase/invoice reference; opening balances and
  // adjustments may reuse referenceId for their own notes and must never be purged.
  const refs = await prisma.stockLedger.findMany({
    where: {
      referenceId: { not: null },
      transactionType: { in: [StockTransactionType.PURCHASE, StockTransactionType.SALE] },
    },
    select: { organizationId: true, referenceId: true },
    distinct: ['organizationId', 'referenceId'],
  });

  let purged = 0;
  for (const { organizationId, referenceId } of refs) {
    if (!referenceId) continue;

    const [purchase, invoice] = await Promise.all([
      prisma.purchaseInvoice.findUnique({ where: { id: referenceId }, select: { id: true } }),
      prisma.invoice.findUnique({ where: { id: referenceId }, select: { id: true } }),
    ]);
    if (purchase || invoice) continue;

    if (dryRun) {
      console.log(
        `[dry-run] Would purge orphan ref ${referenceId.slice(0, 8)}… (org ${organizationId.slice(0, 8)}…)`,
      );
      continue;
    }

    await stockService.purgeTransactionsByReference(organizationId, referenceId);
    purged++;
    console.log(
      `Purged orphan ref ${referenceId.slice(0, 8)}… (org ${organizationId.slice(0, 8)}…)`,
    );
  }

  console.log(`Done. Purged ${purged} orphan reference(s).`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
