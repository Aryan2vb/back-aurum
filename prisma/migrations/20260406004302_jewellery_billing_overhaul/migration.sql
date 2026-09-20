-- CreateEnum
CREATE TYPE "MakingChargesType" AS ENUM ('PER_GRAM', 'FLAT_PER_ITEM', 'PERCENTAGE_ON_METAL');

-- AlterEnum
ALTER TYPE "InvoiceStatus" ADD VALUE 'CONFIRMED';

-- AlterEnum
ALTER TYPE "MetalType" ADD VALUE 'PLATINUM';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentMethod" ADD VALUE 'NEFT';
ALTER TYPE "PaymentMethod" ADD VALUE 'RTGS';
ALTER TYPE "PaymentMethod" ADD VALUE 'IMPS';
ALTER TYPE "PaymentMethod" ADD VALUE 'OLD_GOLD';
ALTER TYPE "PaymentMethod" ADD VALUE 'CREDIT';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "discountAmount" DECIMAL(12,2),
ADD COLUMN     "isNegotiated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "metalRateDate" TIMESTAMP(3),
ADD COLUMN     "metalRateSource" TEXT,
ADD COLUMN     "negotiatedBy" TEXT,
ADD COLUMN     "negotiationNote" TEXT,
ADD COLUMN     "originalCgstAmount" DECIMAL(12,2),
ADD COLUMN     "originalGrandTotal" DECIMAL(14,2),
ADD COLUMN     "originalIgstAmount" DECIMAL(12,2),
ADD COLUMN     "originalSgstAmount" DECIMAL(12,2),
ADD COLUMN     "originalSubtotal" DECIMAL(14,4),
ADD COLUMN     "originalTaxableAmount" DECIMAL(14,4),
ADD COLUMN     "placeOfSupply" TEXT,
ADD COLUMN     "taxableAmount" DECIMAL(14,4),
ADD COLUMN     "totalHallmarkingCharges" DECIMAL(12,2) NOT NULL DEFAULT 0,
ALTER COLUMN "subtotal" SET DATA TYPE DECIMAL(14,4),
ALTER COLUMN "totalAmount" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN     "effectiveRate" DECIMAL(12,4),
ADD COLUMN     "hallmarkingCharge" DECIMAL(8,2) NOT NULL DEFAULT 0,
ADD COLUMN     "isHallmarked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "makingChargesAmount" DECIMAL(12,4),
ADD COLUMN     "makingChargesType" "MakingChargesType" DEFAULT 'PER_GRAM',
ADD COLUMN     "metalRate" DECIMAL(12,4),
ADD COLUMN     "originalItemAmount" DECIMAL(12,4),
ADD COLUMN     "originalMakingCharges" DECIMAL(10,4),
ADD COLUMN     "originalMakingChargesAmount" DECIMAL(12,4),
ADD COLUMN     "purityBasis" INTEGER,
ADD COLUMN     "purityLabel" TEXT,
ADD COLUMN     "purityValue" DECIMAL(6,3),
ADD COLUMN     "stoneCharges" DECIMAL(12,4) DEFAULT 0,
ADD COLUMN     "stoneWeight" DECIMAL(10,3) DEFAULT 0,
ALTER COLUMN "unitPrice" SET DATA TYPE DECIMAL(12,4),
ALTER COLUMN "makingCharges" SET DATA TYPE DECIMAL(10,4),
ALTER COLUMN "taxableAmount" SET DATA TYPE DECIMAL(14,4),
ALTER COLUMN "totalAmount" SET DATA TYPE DECIMAL(14,4);

-- CreateTable
CREATE TABLE "InvoicePayment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mode" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoicePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoicePayment_invoiceId_idx" ON "InvoicePayment"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoicePayment_organizationId_idx" ON "InvoicePayment"("organizationId");

-- CreateIndex
CREATE INDEX "InvoicePayment_organizationId_mode_idx" ON "InvoicePayment"("organizationId", "mode");

-- CreateIndex
CREATE INDEX "InvoicePayment_organizationId_paidAt_idx" ON "InvoicePayment"("organizationId", "paidAt");

-- CreateIndex
CREATE INDEX "InvoicePayment_organizationId_mode_paidAt_idx" ON "InvoicePayment"("organizationId", "mode", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "SystemConfig_key_key" ON "SystemConfig"("key");

-- CreateIndex
CREATE INDEX "SystemConfig_key_idx" ON "SystemConfig"("key");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_status_invoiceDate_idx" ON "Invoice"("organizationId", "status", "invoiceDate");

-- CreateIndex
CREATE INDEX "InvoiceItem_organizationId_metalType_idx" ON "InvoiceItem"("organizationId", "metalType");

-- AddForeignKey
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: purityLabel from legacy purity column
UPDATE "InvoiceItem" SET "purityLabel" = "purity" WHERE "purity" IS NOT NULL AND "purityLabel" IS NULL;

-- Backfill: isHallmarked from huid presence
UPDATE "InvoiceItem" SET "isHallmarked" = true WHERE "huid" IS NOT NULL AND "huid" != '' AND "isHallmarked" = false;

-- Backfill: taxableAmount = subtotal for existing rows
UPDATE "Invoice" SET "taxableAmount" = "subtotal" WHERE "taxableAmount" IS NULL;

-- Backfill: totalHallmarkingCharges from items
UPDATE "Invoice" i SET "totalHallmarkingCharges" = (
  SELECT COALESCE(SUM(ii."hallmarkingCharge"), 0)
  FROM "InvoiceItem" ii
  WHERE ii."invoiceId" = i.id
);

-- Seed SystemConfig
INSERT INTO "SystemConfig" (id, key, value) VALUES
  (gen_random_uuid(), 'HALLMARKING_CHARGE_PER_ITEM', '45.00'),
  (gen_random_uuid(), 'GOLD_GST_RATE', '3.00'),
  (gen_random_uuid(), 'SILVER_GST_RATE', '3.00')
ON CONFLICT (key) DO NOTHING;
