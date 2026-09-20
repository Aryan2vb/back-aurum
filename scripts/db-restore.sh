#!/usr/bin/env bash
# ==============================================================================
# Aurum Database Restore Script (CLI / Disaster Recovery / Migration)
# Restores a .dump file into Supabase, AWS RDS, or Bare-Metal PostgreSQL
#
# DESTRUCTIVE: existing objects in the target database are dropped and replaced.
# ==============================================================================

set -euo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

FORCE=0
SAFETY_BACKUP=1
POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --no-safety-backup) SAFETY_BACKUP=0 ;;
    *) POSITIONAL+=("$arg") ;;
  esac
done

BACKUP_FILE="${POSITIONAL[0]:-}"
TARGET_DB_URL="${POSITIONAL[1]:-}"

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: ./scripts/db-restore.sh [--force] [--no-safety-backup] <path-to-dump-file> [target-database-url]"
  echo "Example: ./scripts/db-restore.sh ./backups/aurum_backup_20260907.dump postgresql://user:PASSWORD@aws-rds:5432/aurum"
  echo "  --force             skip the interactive confirmation (automation only)"
  echo "  --no-safety-backup  skip the automatic dump of the target before it is overwritten"
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "❌ Error: dump file not found: ${BACKUP_FILE}"
  exit 1
fi

# Read a single KEY=VALUE from .env without sourcing/evaluating it.
read_env_var() {
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^${1}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | sed -e "s/^[\"']//" -e "s/[\"']\$//" || true
}

if [ -z "$TARGET_DB_URL" ]; then
  TARGET_DB_URL="${DIRECT_URL:-${DATABASE_URL:-}}"
  [ -n "$TARGET_DB_URL" ] || TARGET_DB_URL="$(read_env_var DIRECT_URL)"
  [ -n "$TARGET_DB_URL" ] || TARGET_DB_URL="$(read_env_var DATABASE_URL)"
fi

if [ -z "$TARGET_DB_URL" ]; then
  echo "❌ Error: Target database URL not provided and not found in .env."
  exit 1
fi

# Prisma-only query params are rejected by libpq.
TARGET_DB_URL="$(printf '%s' "$TARGET_DB_URL" | sed -E 's/[?&](schema|pgbouncer|connection_limit|pool_timeout)=[^&]*//g; /\?/! s/&/?/')"

# Never print credentials: show host/database only.
DISPLAY_URL="$(printf '%s' "$TARGET_DB_URL" | sed -E 's#^([a-z]+://)[^@/]*@#\1***@#')"
DB_NAME="$(printf '%s' "$TARGET_DB_URL" | sed -E 's#^[a-z]+://[^/]*/([^?]*).*#\1#')"

# Auto-detect latest pg_restore / pg_dump binaries
find_bin() {
  local name="$1"
  for candidate in \
    "/opt/homebrew/opt/postgresql@17/bin/${name}" \
    "/opt/homebrew/opt/libpq/bin/${name}" \
    "/usr/local/opt/postgresql@17/bin/${name}" \
    "/usr/local/bin/${name}" \
    "$(command -v "$name" 2>/dev/null || true)"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      echo "$candidate"
      return
    fi
  done
  echo "$name"
}
PG_RESTORE_BIN="$(find_bin pg_restore)"
PG_DUMP_BIN="$(find_bin pg_dump)"

echo "⚠️  This will DROP and replace existing objects in the target database."
echo "   Dump file : ${BACKUP_FILE}"
echo "   Target DB : ${DISPLAY_URL}"

if [ "$FORCE" -ne 1 ]; then
  if [ ! -t 0 ]; then
    echo "❌ Refusing to run non-interactively without --force."
    exit 1
  fi
  read -r -p "Type the database name (${DB_NAME}) to confirm: " CONFIRM
  if [ "$CONFIRM" != "$DB_NAME" ]; then
    echo "Aborted."
    exit 1
  fi
fi

if [ "$SAFETY_BACKUP" -eq 1 ]; then
  mkdir -p "${ROOT_DIR}/backups"
  chmod 700 "${ROOT_DIR}/backups"
  SAFETY_FILE="${ROOT_DIR}/backups/aurum_pre_restore_$(date +"%Y%m%d_%H%M%S").dump"
  echo "📦 Saving a safety backup of the current target to ${SAFETY_FILE}"
  if ! "$PG_DUMP_BIN" "$TARGET_DB_URL" --format=custom --no-owner --no-privileges --file="$SAFETY_FILE"; then
    rm -f "$SAFETY_FILE"
    echo "❌ Safety backup failed; aborting before anything is changed. Use --no-safety-backup to skip."
    exit 1
  fi
fi

echo "Using tool: $("$PG_RESTORE_BIN" --version)"
echo "Starting pg_restore (single transaction: a failure leaves the database unchanged)..."

"$PG_RESTORE_BIN" \
  --clean \
  --if-exists \
  --single-transaction \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  -d "$TARGET_DB_URL" \
  "$BACKUP_FILE"

echo "✅ Database restore completed successfully!"
