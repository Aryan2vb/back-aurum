-- Dev cleanup: remove loan accounts/transactions and loan-related enum values.

DROP INDEX IF EXISTS "FinancialAccount_one_default_cash";
DROP INDEX IF EXISTS "FinancialAccount_organizationId_type_status_idx";

DELETE FROM "FinancialMovement"
WHERE "accountId" IN (
  SELECT "id" FROM "FinancialAccount" WHERE "type"::text = 'LOAN'
);

DELETE FROM "FinancialMovement"
WHERE "transactionId" IN (
  SELECT "id" FROM "FinancialTransaction"
  WHERE "type"::text IN ('LOAN_RECEIVED', 'PRINCIPAL_REPAYMENT', 'INTEREST', 'BANK_CHARGES')
);

DELETE FROM "FinancialTransaction"
WHERE "type"::text IN ('LOAN_RECEIVED', 'PRINCIPAL_REPAYMENT', 'INTEREST', 'BANK_CHARGES');

DELETE FROM "FinancialAccount" WHERE "type"::text = 'LOAN';

ALTER TABLE "FinancialAccount" DROP COLUMN IF EXISTS "lenderName";
ALTER TABLE "FinancialAccount" DROP COLUMN IF EXISTS "sanctionAmount";
ALTER TABLE "FinancialAccount" DROP COLUMN IF EXISTS "interestRate";

ALTER TABLE "FinancialAccount" ALTER COLUMN "type" TYPE TEXT USING ("type"::text);
DROP TYPE "FinancialAccountType";
CREATE TYPE "FinancialAccountType" AS ENUM ('CASH', 'BANK');
ALTER TABLE "FinancialAccount"
  ALTER COLUMN "type" TYPE "FinancialAccountType"
  USING ("type"::"FinancialAccountType");

ALTER TABLE "FinancialTransaction" ALTER COLUMN "type" TYPE TEXT USING ("type"::text);
DROP TYPE "FinancialTransactionType";
CREATE TYPE "FinancialTransactionType" AS ENUM (
  'OPENING_BALANCE',
  'SALE_RECEIPT',
  'UDHAR_COLLECTION',
  'ADVANCE_RECEIPT',
  'ADVANCE_REFUND',
  'PURCHASE_PAYMENT',
  'CASH_BANK_TRANSFER',
  'BANK_BANK_TRANSFER',
  'ADJUSTMENT'
);
ALTER TABLE "FinancialTransaction"
  ALTER COLUMN "type" TYPE "FinancialTransactionType"
  USING ("type"::"FinancialTransactionType");

CREATE UNIQUE INDEX "FinancialAccount_one_default_cash"
  ON "FinancialAccount"("organizationId")
  WHERE "type" = 'CASH' AND "isDefault" = true;
CREATE INDEX "FinancialAccount_organizationId_type_status_idx"
  ON "FinancialAccount"("organizationId", "type", "status");
