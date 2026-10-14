-- Remove the invoice document revision (archived PDF history) subsystem.
-- Foreign-key constraints are dropped implicitly when the table is dropped.

DROP TABLE IF EXISTS "InvoiceDocumentRevision";
