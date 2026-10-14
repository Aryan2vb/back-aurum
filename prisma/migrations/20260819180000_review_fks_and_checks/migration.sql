-- Dangling match refs would block FKs.
UPDATE "BankStatementLine" b
SET "matchedInvoiceId" = NULL
WHERE b."matchedInvoiceId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Invoice" i WHERE i.id = b."matchedInvoiceId");

UPDATE "BankStatementLine" b
SET "invoicePaymentId" = NULL
WHERE b."invoicePaymentId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "InvoicePayment" p WHERE p.id = b."invoicePaymentId");

UPDATE "BankStatementLine" b
SET "purchasePaymentId" = NULL
WHERE b."purchasePaymentId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "PurchasePayment" p WHERE p.id = b."purchasePaymentId");

UPDATE "BankStatementLine" b
SET "financialTransactionId" = NULL
WHERE b."financialTransactionId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "FinancialTransaction" t WHERE t.id = b."financialTransactionId");

ALTER TABLE "UdharEntry"
  ADD CONSTRAINT "UdharEntry_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BankStatementLine"
  ADD CONSTRAINT "BankStatementLine_matchedInvoiceId_fkey"
  FOREIGN KEY ("matchedInvoiceId") REFERENCES "Invoice"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BankStatementLine"
  ADD CONSTRAINT "BankStatementLine_invoicePaymentId_fkey"
  FOREIGN KEY ("invoicePaymentId") REFERENCES "InvoicePayment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BankStatementLine"
  ADD CONSTRAINT "BankStatementLine_purchasePaymentId_fkey"
  FOREIGN KEY ("purchasePaymentId") REFERENCES "PurchasePayment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BankStatementLine"
  ADD CONSTRAINT "BankStatementLine_financialTransactionId_fkey"
  FOREIGN KEY ("financialTransactionId") REFERENCES "FinancialTransaction"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION bank_statement_line_reset_unmatched()
RETURNS trigger AS $$
BEGIN
  IF NEW."matchedInvoiceId" IS NULL
     AND NEW."invoicePaymentId" IS NULL
     AND NEW."purchasePaymentId" IS NULL
     AND NEW."financialTransactionId" IS NULL
     AND NEW.status = 'MATCHED' THEN
    NEW.status := 'UNMATCHED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bank_statement_line_reset_unmatched ON "BankStatementLine";
CREATE TRIGGER bank_statement_line_reset_unmatched
  BEFORE UPDATE ON "BankStatementLine"
  FOR EACH ROW
  EXECUTE PROCEDURE bank_statement_line_reset_unmatched();

ALTER TABLE "PurchasePayment"
  ADD CONSTRAINT "PurchasePayment_amount_positive"
  CHECK (amount > 0) NOT VALID;

ALTER TABLE "PurchaseInvoice"
  ADD CONSTRAINT "PurchaseInvoice_paidAmount_nonneg"
  CHECK ("paidAmount" >= 0) NOT VALID;

ALTER TABLE "PurchasePayment" VALIDATE CONSTRAINT "PurchasePayment_amount_positive";
ALTER TABLE "PurchaseInvoice" VALIDATE CONSTRAINT "PurchaseInvoice_paidAmount_nonneg";
