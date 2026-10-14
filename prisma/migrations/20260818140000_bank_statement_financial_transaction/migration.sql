-- AlterTable
ALTER TABLE "BankStatementLine" ADD COLUMN "financialTransactionId" TEXT;

-- CreateIndex
CREATE INDEX "BankStatementLine_organizationId_financialTransactionId_idx" ON "BankStatementLine"("organizationId", "financialTransactionId");
