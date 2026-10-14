-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseInvoice_organizationId_invoiceNumber_key" ON "PurchaseInvoice"("organizationId", "invoiceNumber");
