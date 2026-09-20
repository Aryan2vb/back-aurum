#!/bin/bash
# ==============================================================================
# Aurum Database Restore Script (CLI / Disaster Recovery / Migration)
# Restores a .dump file into Supabase, AWS RDS, or Bare-Metal PostgreSQL
# ==============================================================================

set -e

BACKUP_FILE="$1"
TARGET_DB_URL="$2"

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: ./scripts/db-restore.sh <path-to-dump-file> [target-database-url]"
  echo "Example: ./scripts/db-restore.sh ./backups/aurum_backup_20260907.dump postgresql://postgres:pass@aws-rds:5432/aurum"
  exit 1
fi

if [ -z "$TARGET_DB_URL" ]; then
  if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
  fi
  TARGET_DB_URL="${DIRECT_URL:-$DATABASE_URL}"
fi

if [ -z "$TARGET_DB_URL" ]; then
  echo "❌ Error: Target database URL not provided and not found in .env."
  exit 1
fi

# Auto-detect latest pg_restore binary
PG_RESTORE_BIN="pg_restore"
for candidate in \
  "/opt/homebrew/opt/postgresql@17/bin/pg_restore" \
  "/opt/homebrew/Cellar/postgresql@17/17.8/bin/pg_restore" \
  "/opt/homebrew/opt/libpq/bin/pg_restore" \
  "/opt/homebrew/Cellar/libpq/18.2/bin/pg_restore" \
  "/usr/local/opt/postgresql@17/bin/pg_restore" \
  "/usr/local/bin/pg_restore" \
  "$(which pg_restore 2>/dev/null)"; do
  if [ -x "$candidate" ]; then
    PG_RESTORE_BIN="$candidate"
    break
  fi
done

echo "⚠️  Restoring database from: ${BACKUP_FILE}"
echo "Target DB: ${TARGET_DB_URL}"
echo "Using tool: $($PG_RESTORE_BIN --version)"
echo "Starting pg_restore..."

"$PG_RESTORE_BIN" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  -d "$TARGET_DB_URL" \
  "$BACKUP_FILE"

echo "✅ Database restore completed successfully!"
