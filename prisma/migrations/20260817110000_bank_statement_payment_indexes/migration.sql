-- CreateIndex
CREATE INDEX "BankStatementLine_organizationId_invoicePaymentId_idx" ON "BankStatementLine"("organizationId", "invoicePaymentId");

-- CreateIndex
CREATE INDEX "BankStatementLine_organizationId_status_invoicePaymentId_idx" ON "BankStatementLine"("organizationId", "status", "invoicePaymentId");
