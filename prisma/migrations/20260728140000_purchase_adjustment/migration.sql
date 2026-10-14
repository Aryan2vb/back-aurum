-- Bill-level signed adjustment on purchase bills (rate diff less/add)
ALTER TABLE "PurchaseInvoice"
  ADD COLUMN IF NOT EXISTS "adjustment" DECIMAL(12,2) NOT NULL DEFAULT 0;
