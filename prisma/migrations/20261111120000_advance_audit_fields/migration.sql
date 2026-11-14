ALTER TABLE "LedgerEntry"
  ADD COLUMN "paymentReference" TEXT,
  ADD COLUMN "transactionDate" TIMESTAMP(3);

UPDATE "LedgerEntry"
SET "transactionDate" = "createdAt"
WHERE "transactionDate" IS NULL;

ALTER TABLE "LedgerEntry"
  ALTER COLUMN "transactionDate" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "transactionDate" SET NOT NULL;

ALTER TYPE "LedgerType" ADD VALUE IF NOT EXISTS 'ADVANCE_CORRECTION_CREDIT';
ALTER TYPE "LedgerType" ADD VALUE IF NOT EXISTS 'ADVANCE_CORRECTION_DEBIT';

CREATE INDEX "LedgerEntry_organizationId_customerId_transactionDate_idx"
  ON "LedgerEntry"("organizationId", "customerId", "transactionDate");
