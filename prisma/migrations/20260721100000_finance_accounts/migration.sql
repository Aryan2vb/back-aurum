CREATE TYPE "FinancialAccountType" AS ENUM ('CASH', 'BANK', 'LOAN');
CREATE TYPE "FinancialAccountStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "FinancialTransactionType" AS ENUM (
  'OPENING_BALANCE', 'SALE_RECEIPT', 'UDHAR_COLLECTION', 'ADVANCE_RECEIPT',
  'ADVANCE_REFUND', 'PURCHASE_PAYMENT', 'CASH_BANK_TRANSFER', 'BANK_BANK_TRANSFER',
  'LOAN_RECEIVED', 'PRINCIPAL_REPAYMENT', 'INTEREST', 'BANK_CHARGES', 'ADJUSTMENT'
);

CREATE TABLE "FinancialAccount" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "FinancialAccountType" NOT NULL,
  "status" "FinancialAccountStatus" NOT NULL DEFAULT 'ACTIVE',
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "bankName" TEXT,
  "accountNumber" TEXT,
  "ifsc" TEXT,
  "lenderName" TEXT,
  "sanctionAmount" DECIMAL(14,2),
  "interestRate" DECIMAL(5,2),
  "notes" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinancialAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinancialAccount_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "FinancialTransaction" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "type" "FinancialTransactionType" NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceParentType" TEXT,
  "sourceParentId" TEXT,
  "description" TEXT,
  "reference" TEXT,
  "paymentMethod" "PaymentMethod",
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT,
  "reversedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinancialTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinancialTransaction_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "FinancialMovement" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "accountId" TEXT,
  "amount" DECIMAL(14,2) NOT NULL,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancialMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinancialMovement_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FinancialMovement_transactionId_fkey" FOREIGN KEY ("transactionId")
    REFERENCES "FinancialTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FinancialMovement_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "FinancialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

ALTER TABLE "InvoicePayment" ADD COLUMN "accountId" TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN "accountId" TEXT;
ALTER TABLE "PurchasePayment" ADD COLUMN "accountId" TEXT;

ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchasePayment" ADD CONSTRAINT "PurchasePayment_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "FinancialAccount_organizationId_name_key" ON "FinancialAccount"("organizationId", "name");
CREATE UNIQUE INDEX "FinancialAccount_one_default_cash" ON "FinancialAccount"("organizationId")
  WHERE "type" = 'CASH' AND "isDefault" = true;
CREATE INDEX "FinancialAccount_organizationId_type_status_idx" ON "FinancialAccount"("organizationId", "type", "status");
CREATE INDEX "FinancialAccount_organizationId_isDefault_idx" ON "FinancialAccount"("organizationId", "isDefault");
CREATE UNIQUE INDEX "FinancialTransaction_organizationId_sourceType_sourceId_key"
  ON "FinancialTransaction"("organizationId", "sourceType", "sourceId");
CREATE INDEX "FinancialTransaction_organizationId_occurredAt_idx" ON "FinancialTransaction"("organizationId", "occurredAt");
CREATE INDEX "FinancialTransaction_organizationId_sourceParentType_sourceParentId_idx"
  ON "FinancialTransaction"("organizationId", "sourceParentType", "sourceParentId");
CREATE INDEX "FinancialTransaction_organizationId_reversedAt_idx" ON "FinancialTransaction"("organizationId", "reversedAt");
CREATE INDEX "FinancialMovement_organizationId_accountId_idx" ON "FinancialMovement"("organizationId", "accountId");
CREATE INDEX "FinancialMovement_transactionId_idx" ON "FinancialMovement"("transactionId");
CREATE INDEX "InvoicePayment_accountId_idx" ON "InvoicePayment"("accountId");
CREATE INDEX "LedgerEntry_accountId_idx" ON "LedgerEntry"("accountId");
CREATE INDEX "PurchasePayment_accountId_idx" ON "PurchasePayment"("accountId");

-- Every existing organization gets exactly one default cash account.
INSERT INTO "FinancialAccount" (
  "id", "organizationId", "name", "type", "status", "isDefault", "createdAt", "updatedAt"
)
SELECT gen_random_uuid()::text, o."id", 'Cash', 'CASH', 'ACTIVE', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization" o
ON CONFLICT ("organizationId", "name") DO NOTHING;
