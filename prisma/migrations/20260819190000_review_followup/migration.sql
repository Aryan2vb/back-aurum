-- Login requires exactly one membership; restore userId uniqueness dropped in 20260403085051.
CREATE UNIQUE INDEX "OrganizationMember_userId_key" ON "OrganizationMember"("userId");

-- Preserve ledger/udhar history when a customer row is deleted (match Invoice_customerId_fkey).
ALTER TABLE "LedgerEntry" DROP CONSTRAINT IF EXISTS "LedgerEntry_customerId_fkey";
ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UdharEntry" DROP CONSTRAINT IF EXISTS "UdharEntry_customerId_fkey";
ALTER TABLE "UdharEntry"
  ADD CONSTRAINT "UdharEntry_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InvoicePayment" ADD COLUMN IF NOT EXISTS "ledgerEntryId" TEXT;

UPDATE "InvoicePayment" ip
SET "ledgerEntryId" = ip.reference
WHERE ip."ledgerEntryId" IS NULL
  AND ip.reference IS NOT NULL
  AND EXISTS (SELECT 1 FROM "LedgerEntry" le WHERE le.id = ip.reference);

UPDATE "InvoicePayment"
SET reference = NULL
WHERE "ledgerEntryId" IS NOT NULL AND reference = "ledgerEntryId";

CREATE UNIQUE INDEX IF NOT EXISTS "InvoicePayment_ledgerEntryId_key"
  ON "InvoicePayment"("ledgerEntryId");

ALTER TABLE "InvoicePayment"
  ADD CONSTRAINT "InvoicePayment_ledgerEntryId_fkey"
  FOREIGN KEY ("ledgerEntryId") REFERENCES "LedgerEntry"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
