-- Add per-organization customer counter to support deterministic customer codes
ALTER TABLE "Organization"
ADD COLUMN "nextCustomerNumber" INTEGER NOT NULL DEFAULT 1;

