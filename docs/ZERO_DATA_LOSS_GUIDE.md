# 🔒 Zero Data Loss — Production Database Guide

> **Scope:** `back-aurum` — NestJS + Prisma + Supabase (PostgreSQL)  
> **Status:** Production live with active users and organizations  
> **Last Updated:** April 2026

---

## ⚠️ Why This Document Exists

The product is **live**. Real organizations, real customers, real invoices, real ledger
entries, and real financial data (`LedgerEntry`, `UdharEntry`, `Invoice`, `InvoicePayment`)
are committed to the database.

**Any careless schema change, query, or migration can permanently destroy user data.**
This guide is the mandatory playbook for every database operation from this point forward.

---

## 🗺️ Production Schema At-a-Glance

Understanding the relationships is the first step to understanding risk.

```
Organization (root tenant)
├── OrganizationMember  ──→ User
├── OrganizationInvitation
├── Session
├── OrgInvoiceSettings
├── Customer
│   ├── ContactDetail
│   ├── Location
│   ├── SocialContext
│   ├── Document
│   ├── Account
│   ├── MetaTracking
│   ├── Invoice
│   │   ├── InvoiceItem
│   │   ├── InvoicePayment
│   │   └── UdharEntry ──→ LedgerEntry
│   └── LedgerEntry
├── InvoiceSequence
├── AuditLog
└── SystemConfig
```

### 🔑 Critical / Financial Tables (Highest Risk)

| Table | Why It's Critical |
|---|---|
| `Invoice` | Denormalized financial totals, snapshots, negotiation audit trail |
| `InvoiceItem` | Line-item pricing with metal rates, purity, making charges |
| `InvoicePayment` | Payment records — loss = missing money trail |
| `LedgerEntry` | Double-entry-style ledger — `UDHAR / PAYMENT / ADJUSTMENT / RETURN` |
| `UdharEntry` | Credit tracking linked 1:1 to a `LedgerEntry` via `@unique` |
| `Customer` | Soft-deleted only via `deletedAt` — base of all financial data |
| `Organization` | Root of every tenant — cascade deletes **everything** |

### ⚡ Cascade Delete Map (Danger Zones)

Deleting a parent **will cascade-destroy** all children:

```
Organization (DELETE) → destroys ALL data for that org
Customer    (DELETE) → destroys Account, Invoice, LedgerEntry, UdharEntry, ContactDetail, etc.
Invoice     (DELETE) → destroys InvoiceItem, InvoicePayment, UdharEntry
LedgerEntry (DELETE) → destroys UdharEntry (via onDelete: Cascade)
```

> **Rule:** Hard deletes on these tables are **forbidden in production**.
> Always use `deletedAt` (soft delete) and confirm with backup before any hard DELETE.

---

## 🛑 Forbidden Operations (Without Explicit Approval + Backup)

You are **BLOCKED** from doing any of the following unless:
1. A verified backup exists
2. A rollback plan is written
3. This checklist is signed off

| Operation | Risk Level | Notes |
|---|---|---|
| `DROP TABLE` | ☠️ CRITICAL | Destroys all rows permanently |
| `ALTER TABLE DROP COLUMN` | ☠️ CRITICAL | All column data lost |
| `ALTER COLUMN TYPE` without migration | 🔴 HIGH | May truncate/corrupt data |
| `DELETE FROM ... WHERE` on financial tables | 🔴 HIGH | No undo without backup |
| `UPDATE ... SET` without WHERE | ☠️ CRITICAL | Overwrites every row |
| `TRUNCATE` | ☠️ CRITICAL | Equivalent to DROP + recreate |
| Removing Prisma enum values in use | 🔴 HIGH | Will fail or corrupt existing rows |
| Changing FK `onDelete` from Cascade → Restrict | 🟡 MEDIUM | May block existing deletes |
| `prisma migrate dev` on production without review | 🔴 HIGH | Can auto-apply destructive diffs |
| Hard-deleting `Organization` record | ☠️ CRITICAL | Cascades to every table |

---

## ✅ The Safe Migration Protocol (Expand → Migrate → Verify → Contract)

Every schema change **must** follow this 4-phase process.

---

### Phase 0: Backup (Mandatory First Step)

Before **any** migration, run:

```bash
# Supabase managed DB — use the connection string from .env
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-acl \
  --no-owner \
  --file="backup_$(date +%Y%m%d_%H%M%S).dump"
```

Or via Supabase Dashboard → **Project → Database → Backups → Download**.

**Confirmation required:**
> ✅ "Has a backup been taken, downloaded, and verified (spot-checked with `pg_restore --list`)?"
> 
> **DO NOT PROCEED until the answer is YES.**

---

### Phase 1: Expand (Safe — Additive Only)

Add new columns/tables. Never remove or rename anything in this phase.

**Prisma pattern:**

```prisma
model Customer {
  // ... existing fields stay untouched ...
  
  // NEW: safe additive
  tier   String?   // nullable — no backfill required immediately
}
```

**SQL equivalent:**

```sql
-- Always use IF NOT EXISTS and nullable defaults
ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "tier" TEXT;
```

**Rules:**
- New columns MUST be nullable (`?`) OR have a `@default(...)` value
- Never rename a column in this phase — add new, keep old
- Use `IF NOT EXISTS` in all raw SQL
- For new enums, add values to the existing enum BEFORE using them in queries

**Prisma command (dev → review → deploy):**

```bash
# 1. On local/staging — generate migration file, review SQL before applying
npx prisma migrate dev --name add_customer_tier --create-only

# 2. Review the generated SQL in prisma/migrations/
# 3. Apply to production ONLY via:
npx prisma migrate deploy   # never use `migrate dev` on production
```

---

### Phase 2: Backfill (Careful — Batched)

Do NOT run a full-table UPDATE in one shot. Use batched updates.

**Safe batched backfill (SQL):**

```sql
-- Backfill in batches of 500 to avoid locking the table
DO $$
DECLARE
  batch_size INT := 500;
  offset_val INT := 0;
  rows_updated INT;
BEGIN
  LOOP
    UPDATE "Customer"
    SET "tier" = 'STANDARD'
    WHERE id IN (
      SELECT id FROM "Customer"
      WHERE "tier" IS NULL
      LIMIT batch_size
    );

    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    EXIT WHEN rows_updated = 0;

    PERFORM pg_sleep(0.1); -- slight pause to reduce lock pressure
  END LOOP;
END $$;
```

**Rules:**
- Never `UPDATE "Customer" SET tier = 'STANDARD'` (no WHERE = full-table lock)
- Keep old column alive and readable while backfill runs
- Run backfill during off-peak hours

---

### Phase 3: Verify (Non-Negotiable)

After every migration or backfill, run these checks:

```sql
-- 1. Row count sanity — compare before/after
SELECT COUNT(*) FROM "Customer";                      -- should match pre-migration count
SELECT COUNT(*) FROM "Customer" WHERE "tier" IS NULL; -- should be 0 after backfill

-- 2. Financial integrity — LedgerEntry ←→ UdharEntry
SELECT COUNT(*) FROM "LedgerEntry" l
LEFT JOIN "UdharEntry" u ON u."ledgerEntryId" = l.id
WHERE l.type = 'UDHAR' AND u.id IS NULL;
-- Expected: 0 (every UDHAR ledger entry must have a UdharEntry)

-- 3. Invoice payment consistency
SELECT i.id, i."totalAmount", i."paidAmount",
       COALESCE(SUM(p.amount), 0) AS sum_payments
FROM "Invoice" i
LEFT JOIN "InvoicePayment" p ON p."invoiceId" = i.id
GROUP BY i.id, i."totalAmount", i."paidAmount"
HAVING i."paidAmount" != COALESCE(SUM(p.amount), 0)
LIMIT 20;
-- Expected: 0 rows (paidAmount must match sum of InvoicePayments)

-- 4. Orphan check — UdharEntry without a valid Invoice
SELECT COUNT(*) FROM "UdharEntry"
WHERE "invoiceId" IS NOT NULL
  AND "invoiceId" NOT IN (SELECT id FROM "Invoice");
-- Expected: 0

-- 5. InvoiceSequence vs actual invoices
SELECT s."financialYear", s."nextSequence",
       MAX(i.sequence) AS max_actual_sequence
FROM "InvoiceSequence" s
JOIN "Invoice" i ON i."organizationId" = s."organizationId"
  AND i."financialYear" = s."financialYear"
GROUP BY s."financialYear", s."nextSequence"
HAVING s."nextSequence" <= MAX(i.sequence);
-- Expected: 0 rows (nextSequence must always be > max used sequence)
```

---

### Phase 4: Contract (Delayed — Requires Explicit Approval)

Only after:
- ✅ Expand phase running in production for ≥ 1 week
- ✅ All app code has been deployed without using the old column/enum
- ✅ Verification queries pass with 0 anomalies
- ✅ A fresh backup exists

Then and only then:

```sql
-- Remove old column (example: removing deprecated `purity` in favor of `purityLabel`)
ALTER TABLE "InvoiceItem" DROP COLUMN IF EXISTS "purity";
```

> **Note:** In Prisma, removing a field from `schema.prisma` and running `migrate dev`
> will generate a `DROP COLUMN`. Always `--create-only` first and review the SQL.

---

## 🔄 Specific High-Risk Scenarios for This Schema

### 1. Renaming a Column

❌ **Never do this directly:**
```sql
ALTER TABLE "Customer" RENAME COLUMN "fullName" TO "name";
-- This will break every query and the Prisma client immediately
```

✅ **Safe approach:**
```sql
-- Step 1: Add new column
ALTER TABLE "Customer" ADD COLUMN "name" TEXT;

-- Step 2: Backfill
UPDATE "Customer" SET "name" = "fullName" WHERE "name" IS NULL;

-- Step 3: Update Prisma schema + deploy backend that uses new column

-- Step 4 (weeks later, after verification):
ALTER TABLE "Customer" DROP COLUMN "fullName";
```

---

### 2. Adding a New Enum Value

Postgres enums are safe to extend but risky to shrink.

```sql
-- Safe: add new value to existing enum
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'REFUNDED';
```

> ⚠️ **Caution:** You cannot reorder enum values or remove them without recreating the type.
> Removing an enum value that exists in rows will **fail with a constraint error**.

---

### 3. Changing a Column from Nullable to NOT NULL

```sql
-- Step 1: Verify no NULLs exist FIRST
SELECT COUNT(*) FROM "Invoice" WHERE "taxableAmount" IS NULL;

-- Step 2: Backfill NULLs before adding constraint
UPDATE "Invoice" SET "taxableAmount" = subtotal WHERE "taxableAmount" IS NULL;

-- Step 3: Only then add constraint
ALTER TABLE "Invoice" ALTER COLUMN "taxableAmount" SET NOT NULL;
```

---

### 4. Changing a Column Type (e.g., Decimal precision)

This happened before (`increase_purity_precision` migration). Do it safely:

```sql
-- Step 1: Add new column with new type
ALTER TABLE "InvoiceItem" ADD COLUMN "purityValue_new" DECIMAL(10, 4);

-- Step 2: Copy data
UPDATE "InvoiceItem" SET "purityValue_new" = "purityValue"::DECIMAL(10, 4);

-- Step 3: Verify
SELECT COUNT(*) FROM "InvoiceItem" WHERE "purityValue_new" IS NULL AND "purityValue" IS NOT NULL;
-- Expected: 0

-- Step 4: Swap names in Prisma (@map or rename migration)
-- Step 5: Drop old column after full deploy
```

---

### 5. Soft-Delete vs Hard-Delete

Your schema uses `deletedAt` (soft delete). **Never hard-delete these records:**

| Table | Has `deletedAt` | Hard-delete safe? |
|---|---|---|
| `Customer` | ✅ Yes | ❌ No — linked to Invoices, Ledger |
| `Organization` | ✅ Yes | ❌ No — root of all data |
| `Invoice` | ✅ Yes | ❌ No — financial record |
| `LedgerEntry` | ✅ Yes | ❌ No — double-entry ledger |
| `UdharEntry` | ✅ Yes | ❌ No — credit tracking |
| `ContactDetail` | ✅ Yes | ⚠️ Low risk but use soft-delete |
| `Location` | ✅ Yes | ⚠️ Low risk but use soft-delete |
| `Session` | ❌ No | ✅ Safe to hard-delete expired |
| `AuditLog` | ❌ No | ⚠️ Archive instead of delete |

---

### 6. `prisma migrate dev` on Production

**YOU MUST NEVER run `prisma migrate dev` on the production database.**

- `migrate dev` will apply and potentially auto-create shadow databases
- It may interpret schema drift as needing destructive migrations
- Use **`prisma migrate deploy`** in production only

```bash
# ✅ Correct production workflow
npx prisma migrate deploy

# ❌ NEVER on production
npx prisma migrate dev
npx prisma migrate reset   # DESTROYS EVERYTHING
```

---

### 7. Cascade Delete Risk on Organization

Your `Organization` model uses `onDelete: Cascade` on almost every table.

```sql
-- This one query destroys an entire organization's data:
DELETE FROM "Organization" WHERE id = '<org-id>';
```

**Protection:**

1. Never expose a raw org-delete endpoint without:
   - Multi-step confirmation (type org name)
   - Backup triggered before deletion
   - `deletedAt` soft-delete first, hard-delete after 30-day grace period
2. Add a DB-level safety net:

```sql
-- Consider a trigger that blocks hard-delete on Organization
-- unless deletedAt is already set and 30 days have passed
CREATE OR REPLACE FUNCTION prevent_org_hard_delete()
RETURNS trigger AS $$
BEGIN
  IF OLD."deletedAt" IS NULL THEN
    RAISE EXCEPTION 'Cannot hard-delete an organization without soft-deleting first';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER org_hard_delete_guard
BEFORE DELETE ON "Organization"
FOR EACH ROW EXECUTE FUNCTION prevent_org_hard_delete();
```

---

## 📋 Pre-Migration Checklist

Copy this for every migration:

```markdown
## Migration: [migration name]
**Date:** YYYY-MM-DD
**Author:** [name]

### Pre-flight
- [ ] Backup taken and verified: `pg_dump ...`
- [ ] Migration SQL reviewed (use `--create-only` first)
- [ ] SQL is idempotent (`IF NOT EXISTS`, `IF EXISTS`)
- [ ] No `DROP`, `TRUNCATE`, or unguarded `UPDATE` in the SQL
- [ ] New columns are nullable or have defaults
- [ ] Tested on local + staging DB first
- [ ] Off-peak deploy window planned

### During
- [ ] `prisma migrate deploy` run (not `dev`)
- [ ] Backfill batched if required
- [ ] Zero downtime ensured (additive-only = no breaking API change)

### Post-flight
- [ ] Row count matches pre-migration
- [ ] Financial integrity checks passed (see verification queries above)
- [ ] App health checks green
- [ ] Rollback plan ready if needed
```

---

## 🔁 Rollback Strategies

### A. Revert a Column Addition

```sql
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "tier";
```
> Safe — column was nullable, no data depended on it.

### B. Revert a Backfill

If you UPDATE'd rows with wrong values:

```sql
-- If you kept the old values in a backup column
UPDATE "Customer" SET "tier" = "tier_old";
ALTER TABLE "Customer" DROP COLUMN "tier_old";
```

### C. Full Restore From Backup

```bash
# 1. Put application in maintenance mode (set env flag)

# 2. Restore from pg_dump backup
pg_restore \
  --dbname="$DATABASE_URL" \
  --clean \
  --if-exists \
  --no-owner \
  backup_20260415_120000.dump

# 3. Verify row counts
# 4. Remove maintenance mode
```

---

## ⚙️ Supabase-Specific Considerations

| Risk | Supabase Context |
|---|---|
| Row-Level Security (RLS) | If you rename a table or column, **RLS policies break silently** — always audit policies after migrations |
| Supabase Auth Users | `User.id` maps to `auth.users.id` — never delete from `auth.users` independently of `User` table |
| Supabase Realtime | Column renames break realtime subscriptions if any are in use |
| Connection Pooling | Use `directUrl` for migrations, `DATABASE_URL` (pooled) for app — already configured correctly in your schema |
| Point-in-Time Recovery | Supabase Pro enables PITR — verify this is enabled for your project in Dashboard → Database → Backups |

---

## 🚨 What Can Lead to Data Loss — Risk Register

| Scenario | Probability | Severity | Mitigation |
|---|---|---|---|
| Running `prisma migrate dev` on prod | Medium | ☠️ Critical | Use `migrate deploy` only |
| `DROP TABLE` without backup | Low | ☠️ Critical | Pre-migration backup mandatory |
| Unguarded `UPDATE` (no WHERE) | Low | ☠️ Critical | Always include `WHERE`, review in SQL editor |
| Hard-deleting `Organization` | Low | ☠️ Critical | Soft-delete gate + trigger |
| Changing `onDelete: Cascade → SetNull` on Invoice→Customer | Low | 🔴 High | Test on staging, verify integrity |
| Adding NOT NULL column without default | Medium | 🔴 High | Backfill before constraint |
| Removing enum value in use | Low | 🔴 High | Check rows, remove value last |
| Concurrent migration + deploy (race condition) | Low | 🟡 Medium | Deploy backend after migration completes |
| InvoiceSequence gap/corruption | Low | 🟡 Medium | Never update sequence manually |
| Supabase Auth user deletion without syncing `User` | Medium | 🔴 High | Use webhooks or triggers for sync |

---

## 🏁 The Golden Rule

> **"When in doubt — don't."**
>
> Every operation that risks data must be:
> 1. Backed up
> 2. Tested on staging
> 3. Reviewed as SQL (not just Prisma schema diff)
> 4. Rolled out during a low-traffic window
> 5. Verified with integrity queries post-deploy
>
> Speed can be recovered. Lost financial data cannot.
