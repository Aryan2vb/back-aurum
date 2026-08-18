import { PrismaClient } from '@prisma/client';
import { FinanceService } from '../src/finance/finance.service';

const prisma = new PrismaClient();
const finance = new FinanceService(prisma as any);
const dryRun = process.argv.includes('--dry-run');

async function main() {
  const organizations = await prisma.organization.findMany({ select: { id: true } });
  const totals = {
    dryRun,
    organizations: organizations.length,
    invoicePayments: 0,
    purchasePayments: 0,
    advanceEntries: 0,
    udharPayments: 0,
  };

  for (const { id: organizationId } of organizations) {
    const result = await finance.backfillOrganization(organizationId, dryRun);
    totals.invoicePayments += result.invoicePayments;
    totals.purchasePayments += result.purchasePayments;
    totals.advanceEntries += result.advanceEntries;
    totals.udharPayments += result.udharPayments;
  }

  console.log(JSON.stringify(totals, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
