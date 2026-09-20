#!/bin/bash
# ==============================================================================
# Aurum Database Backup Script (CLI / Manual / Cron)
# Compatible with Supabase, AWS RDS, and Bare-Metal PostgreSQL
# ==============================================================================

set -e

# Load environment variables from .env if present
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

DB_URL="${DIRECT_URL:-$DATABASE_URL}"

if [ -z "$DB_URL" ]; then
  echo "❌ Error: Neither DIRECT_URL nor DATABASE_URL is set."
  echo "Please set DIRECT_URL or DATABASE_URL in your environment or .env file."
  exit 1
fi

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="./backups"
BACKUP_FILE="${BACKUP_DIR}/aurum_backup_${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR"

# Auto-detect latest pg_dump binary (e.g. PostgreSQL 17 or libpq)
PG_DUMP_BIN="pg_dump"
for candidate in \
  "/opt/homebrew/opt/postgresql@17/bin/pg_dump" \
  "/opt/homebrew/Cellar/postgresql@17/17.8/bin/pg_dump" \
  "/opt/homebrew/opt/libpq/bin/pg_dump" \
  "/opt/homebrew/Cellar/libpq/18.2/bin/pg_dump" \
  "/usr/local/opt/postgresql@17/bin/pg_dump" \
  "/usr/local/bin/pg_dump" \
  "$(which pg_dump 2>/dev/null)"; do
  if [ -x "$candidate" ]; then
    PG_DUMP_BIN="$candidate"
    break
  fi
done

echo "📦 Using PostgreSQL tool: $($PG_DUMP_BIN --version)"
echo "Target: ${BACKUP_FILE}"

"$PG_DUMP_BIN" "$DB_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$BACKUP_FILE"

FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "✅ Backup completed successfully: ${BACKUP_FILE} (${FILE_SIZE})"
