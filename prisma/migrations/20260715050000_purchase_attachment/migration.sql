-- AlterTable
ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "attachmentUrl" TEXT;
ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "attachmentKey" TEXT;
ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "attachmentName" TEXT;
ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "attachmentMime" TEXT;
