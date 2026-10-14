-- Migration: advance_ledger_types
-- Extends LedgerType enum and adds traceability columns to LedgerEntry.
-- Safe to run on live data — all new columns are nullable, no existing rows touched.

-- ── Step 1: Extend LedgerType enum ─────────────────────────────────────────
-- PostgreSQL requires ALTER TYPE … ADD VALUE; these are idempotent via DO blocks.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'ADVANCE_RECEIVED'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'LedgerType')
  ) THEN
    ALTER TYPE "LedgerType" ADD VALUE 'ADVANCE_RECEIVED';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'ADVANCE_APPLIED'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'LedgerType')
  ) THEN
    ALTER TYPE "LedgerType" ADD VALUE 'ADVANCE_APPLIED';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'ADVANCE_TRANSFER_OUT'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'LedgerType')
  ) THEN
    ALTER TYPE "LedgerType" ADD VALUE 'ADVANCE_TRANSFER_OUT';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'ADVANCE_TRANSFER_IN'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'LedgerType')
  ) THEN
    ALTER TYPE "LedgerType" ADD VALUE 'ADVANCE_TRANSFER_IN';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'ADVANCE_REFUND'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'LedgerType')
  ) THEN
    ALTER TYPE "LedgerType" ADD VALUE 'ADVANCE_REFUND';
  END IF;
END $$;

-- ── Step 2: Add nullable traceability columns to LedgerEntry ───────────────

ALTER TABLE "LedgerEntry"
  ADD COLUMN IF NOT EXISTS "referenceLedgerEntryId" TEXT,
  ADD COLUMN IF NOT EXISTS "invoiceId"              TEXT,
  ADD COLUMN IF NOT EXISTS "paymentMethod"          "PaymentMethod";

-- ── Step 3: Indexes ────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "LedgerEntry_organizationId_customerId_type_idx"
  ON "LedgerEntry" ("organizationId", "customerId", "type");

CREATE INDEX IF NOT EXISTS "LedgerEntry_invoiceId_idx"
  ON "LedgerEntry" ("invoiceId");
