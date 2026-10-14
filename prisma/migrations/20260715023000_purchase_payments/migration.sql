-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "PurchaseStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable PurchaseInvoice
ALTER TABLE "PurchaseInvoice"
  ADD COLUMN IF NOT EXISTS "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "status" "PurchaseStatus" NOT NULL DEFAULT 'UNPAID';

CREATE INDEX IF NOT EXISTS "PurchaseInvoice_organizationId_status_idx" ON "PurchaseInvoice"("organizationId", "status");

-- CreateTable PurchasePayment
CREATE TABLE IF NOT EXISTS "PurchasePayment" (
    "id" TEXT NOT NULL,
    "purchaseInvoiceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mode" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchasePayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PurchasePayment_purchaseInvoiceId_idx" ON "PurchasePayment"("purchaseInvoiceId");
CREATE INDEX IF NOT EXISTS "PurchasePayment_organizationId_idx" ON "PurchasePayment"("organizationId");
CREATE INDEX IF NOT EXISTS "PurchasePayment_organizationId_mode_idx" ON "PurchasePayment"("organizationId", "mode");
CREATE INDEX IF NOT EXISTS "PurchasePayment_organizationId_paidAt_idx" ON "PurchasePayment"("organizationId", "paidAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurchasePayment_purchaseInvoiceId_fkey') THEN
    ALTER TABLE "PurchasePayment" ADD CONSTRAINT "PurchasePayment_purchaseInvoiceId_fkey"
      FOREIGN KEY ("purchaseInvoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurchasePayment_organizationId_fkey') THEN
    ALTER TABLE "PurchasePayment" ADD CONSTRAINT "PurchasePayment_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
