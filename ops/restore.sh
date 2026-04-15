#!/bin/bash
# -----------------------------------------------------------------------------
# ops/restore.sh
# -----------------------------------------------------------------------------
# Utility script to document and facilitate restoring a database backup
# downloaded from Cloudflare R2.
#
# IMPORTANT: This will OVERWRITE existing data. Use with extreme caution.
# -----------------------------------------------------------------------------

set -e

echo "⚠️  DATABASE RESTORE UTILITY ⚠️"
echo "--------------------------------------------------------------------"
echo "This script will download a backup from R2 and restore it to the DB."
echo "Ensure you have the following environment variables set:"
echo "  - R2_ENDPOINT"
echo "  - R2_BUCKET"
echo "  - R2_ACCESS_KEY_ID"
echo "  - R2_SECRET_ACCESS_KEY"
echo "  - DIRECT_URL (the target database URL)"
echo "--------------------------------------------------------------------"

# Check if required environment variables are set
if [ -z "$R2_ENDPOINT" ] || [ -z "$R2_BUCKET" ] || [ -z "$R2_ACCESS_KEY_ID" ] || [ -z "$R2_SECRET_ACCESS_KEY" ] || [ -z "$DIRECT_URL" ]; then
  echo "Error: One or more required environment variables are missing."
  exit 1
fi

# Configure AWS CLI
aws configure set aws_access_key_id "$R2_ACCESS_KEY_ID"
aws configure set aws_secret_access_key "$R2_SECRET_ACCESS_KEY"
aws configure set default.region auto

# Prompt for the backup filename
read -p "Enter the backup filename in R2 (e.g., db-backups/backup_2026-04-15_2130.dump.gz): " S3_KEY

if [ -z "$S3_KEY" ]; then
    echo "Error: Filename cannot be empty."
    exit 1
fi

LOCAL_FILE=$(basename "$S3_KEY")

echo ""
echo "── Downloading $LOCAL_FILE from R2 ──"
aws s3 cp "s3://${R2_BUCKET}/${S3_KEY}" "$LOCAL_FILE" --endpoint-url "$R2_ENDPOINT"

if [ ! -f "$LOCAL_FILE" ]; then
    echo "Error: Failed to download the backup file."
    exit 1
fi

echo ""
read -p "Are you ABSOLUTELY SURE you want to restore to DIRECT_URL? This will overwrite data. (y/N): " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "Restore cancelled."
  rm -f "$LOCAL_FILE"
  exit 0
fi

echo "── Restoring Database ──"
# The --clean flag drops database objects prior to creating them.
# The --if-exists flag prevents errors if the objects don't exist.
pg_restore --dbname="$DIRECT_URL" --clean --if-exists "$LOCAL_FILE"

echo "── Restore Complete ──"

# Optional: Clean up the downloaded file
read -p "Remove the downloaded backup file ($LOCAL_FILE)? (Y/n): " CLEANUP
if [ "$CLEANUP" != "n" ] && [ "$CLEANUP" != "N" ]; then
    rm -f "$LOCAL_FILE"
    echo "Removed $LOCAL_FILE."
fi
