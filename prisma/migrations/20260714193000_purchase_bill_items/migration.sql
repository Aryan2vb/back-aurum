-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "StockTransactionType" AS ENUM ('OPENING_BALANCE', 'PURCHASE', 'SALE', 'ADJUSTMENT');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Vendor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "gstin" TEXT,
    "address" TEXT,
    "stateCode" TEXT,
    "stateName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "StockBalance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "metalType" "MetalType" NOT NULL,
    "purity" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "StockLedger" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metalType" "MetalType" NOT NULL,
    "purity" TEXT NOT NULL,
    "transactionType" "StockTransactionType" NOT NULL,
    "quantityIn" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "quantityOut" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "runningBalance" DECIMAL(10,3) NOT NULL,
    "rate" DECIMAL(12,4),
    "totalValue" DECIMAL(14,4),
    "referenceId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PurchaseInvoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vendorId" TEXT,
    "invoiceNumber" TEXT,
    "billSeries" TEXT,
    "vendorName" TEXT,
    "vendorGstin" TEXT,
    "vendorStateCode" TEXT,
    "vendorStateName" TEXT,
    "purchaseDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "metalType" "MetalType" NOT NULL,
    "purity" TEXT NOT NULL,
    "totalWeight" DECIMAL(10,3) NOT NULL,
    "rate" DECIMAL(12,4),
    "totalAmount" DECIMAL(14,2),
    "taxableAmount" DECIMAL(14,2),
    "taxType" "TaxType" NOT NULL DEFAULT 'CGST_SGST',
    "cgstRate" DECIMAL(5,2) NOT NULL DEFAULT 1.5,
    "sgstRate" DECIMAL(5,2) NOT NULL DEFAULT 1.5,
    "igstRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "cgstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sgstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "igstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(14,2),
    "addGst" BOOLEAN NOT NULL DEFAULT false,
    "gstInclusive" BOOLEAN NOT NULL DEFAULT false,
    "totalGoldWeight" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "totalSilverWeight" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "totalMetalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PurchaseInvoiceItem" (
    "id" TEXT NOT NULL,
    "purchaseInvoiceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "slNo" INTEGER NOT NULL,
    "itemName" TEXT,
    "metalType" "MetalType" NOT NULL,
    "purity" TEXT NOT NULL,
    "grossWeight" DECIMAL(10,3) NOT NULL,
    "netWeight" DECIMAL(10,3) NOT NULL,
    "rate" DECIMAL(12,4),
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseInvoiceItem_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "Vendor_organizationId_idx" ON "Vendor"("organizationId");
CREATE INDEX IF NOT EXISTS "StockBalance_organizationId_idx" ON "StockBalance"("organizationId");
CREATE UNIQUE INDEX IF NOT EXISTS "StockBalance_organizationId_metalType_purity_key" ON "StockBalance"("organizationId", "metalType", "purity");
CREATE INDEX IF NOT EXISTS "StockLedger_organizationId_metalType_purity_idx" ON "StockLedger"("organizationId", "metalType", "purity");
CREATE INDEX IF NOT EXISTS "StockLedger_organizationId_date_idx" ON "StockLedger"("organizationId", "date");
CREATE INDEX IF NOT EXISTS "PurchaseInvoice_organizationId_idx" ON "PurchaseInvoice"("organizationId");
CREATE INDEX IF NOT EXISTS "PurchaseInvoiceItem_purchaseInvoiceId_idx" ON "PurchaseInvoiceItem"("purchaseInvoiceId");
CREATE INDEX IF NOT EXISTS "PurchaseInvoiceItem_organizationId_idx" ON "PurchaseInvoiceItem"("organizationId");
CREATE INDEX IF NOT EXISTS "PurchaseInvoiceItem_organizationId_metalType_purity_idx" ON "PurchaseInvoiceItem"("organizationId", "metalType", "purity");

-- ForeignKeys (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Vendor_organizationId_fkey') THEN
    ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockBalance_organizationId_fkey') THEN
    ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockLedger_organizationId_fkey') THEN
    ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseInvoice_vendorId_fkey') THEN
    ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_vendorId_fkey"
      FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseInvoice_organizationId_fkey') THEN
    ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseInvoiceItem_purchaseInvoiceId_fkey') THEN
    ALTER TABLE "PurchaseInvoiceItem" ADD CONSTRAINT "PurchaseInvoiceItem_purchaseInvoiceId_fkey"
      FOREIGN KEY ("purchaseInvoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseInvoiceItem_organizationId_fkey') THEN
    ALTER TABLE "PurchaseInvoiceItem" ADD CONSTRAINT "PurchaseInvoiceItem_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Align existing PurchaseInvoice columns if an older stub table already existed
ALTER TABLE "PurchaseInvoice"
  ADD COLUMN IF NOT EXISTS "billSeries" TEXT,
  ADD COLUMN IF NOT EXISTS "vendorName" TEXT,
  ADD COLUMN IF NOT EXISTS "vendorGstin" TEXT,
  ADD COLUMN IF NOT EXISTS "vendorStateCode" TEXT,
  ADD COLUMN IF NOT EXISTS "vendorStateName" TEXT,
  ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "taxableAmount" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "taxType" "TaxType" NOT NULL DEFAULT 'CGST_SGST',
  ADD COLUMN IF NOT EXISTS "cgstRate" DECIMAL(5,2) NOT NULL DEFAULT 1.5,
  ADD COLUMN IF NOT EXISTS "sgstRate" DECIMAL(5,2) NOT NULL DEFAULT 1.5,
  ADD COLUMN IF NOT EXISTS "igstRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cgstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "sgstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "igstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "grandTotal" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "addGst" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "gstInclusive" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "totalGoldWeight" DECIMAL(10,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "totalSilverWeight" DECIMAL(10,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "totalMetalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "Vendor"
  ADD COLUMN IF NOT EXISTS "stateCode" TEXT,
  ADD COLUMN IF NOT EXISTS "stateName" TEXT;
