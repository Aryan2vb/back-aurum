-- Per-item hallmarking / other charges on purchase bills
ALTER TABLE "PurchaseInvoiceItem"
  ADD COLUMN IF NOT EXISTS "hallmarkingCharge" DECIMAL(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "otherCharges" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "PurchaseInvoice"
  ADD COLUMN IF NOT EXISTS "totalHallmarkingCharges" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "totalOtherCharges" DECIMAL(12,2) NOT NULL DEFAULT 0;
