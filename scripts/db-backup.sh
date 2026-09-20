#!/usr/bin/env bash
# ==============================================================================
# Aurum Database Backup Script (CLI / Manual / Cron)
# Compatible with Supabase, AWS RDS, and Bare-Metal PostgreSQL
# ==============================================================================

set -euo pipefail
# Dumps contain full tenant data: keep them private to the current user.
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

# Read a single KEY=VALUE from .env without sourcing/evaluating it.
read_env_var() {
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^${1}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | sed -e "s/^[\"']//" -e "s/[\"']\$//" || true
}

DB_URL="${DIRECT_URL:-${DATABASE_URL:-}}"
[ -n "$DB_URL" ] || DB_URL="$(read_env_var DIRECT_URL)"
[ -n "$DB_URL" ] || DB_URL="$(read_env_var DATABASE_URL)"

if [ -z "$DB_URL" ]; then
  echo "❌ Error: Neither DIRECT_URL nor DATABASE_URL is set."
  echo "Please set DIRECT_URL or DATABASE_URL in your environment or .env file."
  exit 1
fi

# Prisma-only query params (schema, pgbouncer, connection_limit, pool_timeout) are
# rejected by libpq, so strip them before handing the URL to pg_dump.
DB_URL="$(printf '%s' "$DB_URL" | sed -E 's/[?&](schema|pgbouncer|connection_limit|pool_timeout)=[^&]*//g; /\?/! s/&/?/')"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="${ROOT_DIR}/backups"
BACKUP_FILE="${BACKUP_DIR}/aurum_backup_${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# A failed pg_dump must not leave a partial file that looks like a valid backup.
cleanup_partial() { rm -f "$BACKUP_FILE"; }
trap cleanup_partial ERR

# Auto-detect latest pg_dump binary (e.g. PostgreSQL 17 or libpq)
PG_DUMP_BIN="pg_dump"
for candidate in \
  "/opt/homebrew/opt/postgresql@17/bin/pg_dump" \
  "/opt/homebrew/opt/libpq/bin/pg_dump" \
  "/usr/local/opt/postgresql@17/bin/pg_dump" \
  "/usr/local/bin/pg_dump" \
  "$(command -v pg_dump 2>/dev/null || true)"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    PG_DUMP_BIN="$candidate"
    break
  fi
done

echo "📦 Using PostgreSQL tool: $("$PG_DUMP_BIN" --version)"
echo "Target: ${BACKUP_FILE}"

"$PG_DUMP_BIN" "$DB_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$BACKUP_FILE"

trap - ERR
FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "✅ Backup completed successfully: ${BACKUP_FILE} (${FILE_SIZE})"
