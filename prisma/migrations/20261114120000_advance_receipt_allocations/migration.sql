-- Receipt-level advance allocation on invoices

CREATE TYPE "PaymentSource" AS ENUM ('DIRECT', 'ADVANCE');

ALTER TABLE "InvoicePayment"
  ADD COLUMN "source" "PaymentSource" NOT NULL DEFAULT 'DIRECT',
  ADD COLUMN "sourceCustomerId" TEXT,
  ADD COLUMN "advanceEntryId" TEXT,
  ADD COLUMN "advanceLedgerEntryId" TEXT;

CREATE INDEX "InvoicePayment_advanceEntryId_idx" ON "InvoicePayment"("advanceEntryId");

ALTER TABLE "Invoice" ADD COLUMN "draftAdvanceAllocations" JSONB;

-- Backfill legacy lump-sum advance payments: applyAdvanceToInvoice stored the
-- ADVANCE_APPLIED ledger id in InvoicePayment.reference.
UPDATE "InvoicePayment" p
SET "source" = 'ADVANCE',
    "advanceLedgerEntryId" = l."id",
    "sourceCustomerId" = l."customerId"
FROM "LedgerEntry" l
WHERE p."reference" = l."id"
  AND l."type" = 'ADVANCE_APPLIED';
