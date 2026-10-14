-- AlterTable
ALTER TABLE "BankStatementLine" ADD COLUMN "purchasePaymentId" TEXT;

-- CreateIndex
CREATE INDEX "BankStatementLine_organizationId_purchasePaymentId_idx" ON "BankStatementLine"("organizationId", "purchasePaymentId");

-- CreateIndex
CREATE INDEX "BankStatementLine_organizationId_status_purchasePaymentId_idx" ON "BankStatementLine"("organizationId", "status", "purchasePaymentId");
