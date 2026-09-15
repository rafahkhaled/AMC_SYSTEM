#!/usr/bin/env bash
# Prove the backups work, by taking one and restoring it.
#
#   DATABASE_URL=... BACKUP_PASSPHRASE=... ./infra/backup/verify-restore.sh
#
# Backs up the source database, restores it into a throwaway one, compares what
# arrived against what was there, and drops the throwaway. This runs in CI on
# every change and should run on a schedule in production, because a backup
# nobody has restored is a hope rather than a backup (NFR-08).

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
SCRATCH="amc_restore_check_$(date +%s)$$"

# The same server, a different database. Restoring somewhere else entirely
# would test less than it appears to.
ADMIN_URL="${DATABASE_URL%/*}/postgres"
SCRATCH_URL="${DATABASE_URL%/*}/${SCRATCH}"

cleanup() {
  psql "$ADMIN_URL" --quiet -c "DROP DATABASE IF EXISTS \"${SCRATCH}\" WITH (FORCE)" > /dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "1. Taking a backup"
BACKUP_DIR="$WORK" "$HERE/backup.sh" "$WORK" > /dev/null
BACKUP=$(ls "$WORK"/amc-*.sql.gz.enc)
echo "   $(basename "$BACKUP"), $(wc -c < "$BACKUP" | tr -d ' ') bytes"

echo "2. Creating a throwaway database"
psql "$ADMIN_URL" --quiet -c "CREATE DATABASE \"${SCRATCH}\"" > /dev/null

echo "3. Restoring into it"
"$HERE/restore.sh" "$BACKUP" "$SCRATCH_URL" > /dev/null

echo "4. Comparing"
# Compare the shape and the contents that matter: every table, and the row
# count in each. A restore that produces empty tables passes a "did it run?"
# check and fails this one.
QUERY="
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name
"
SOURCE_TABLES=$(psql "$DATABASE_URL" -tAc "$QUERY")
RESTORED_TABLES=$(psql "$SCRATCH_URL" -tAc "$QUERY")

if [ "$SOURCE_TABLES" != "$RESTORED_TABLES" ]; then
  echo "   The restored database has different tables:" >&2
  diff <(echo "$SOURCE_TABLES") <(echo "$RESTORED_TABLES") >&2 || true
  exit 1
fi

FAILED=0
for TABLE in $SOURCE_TABLES; do
  BEFORE=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM \"${TABLE}\"")
  AFTER=$(psql "$SCRATCH_URL" -tAc "SELECT count(*) FROM \"${TABLE}\"")
  if [ "$BEFORE" != "$AFTER" ]; then
    echo "   ${TABLE}: ${BEFORE} rows before, ${AFTER} after" >&2
    FAILED=1
  fi
done

[ "$FAILED" -eq 0 ] || exit 1

TABLE_COUNT=$(echo "$SOURCE_TABLES" | wc -w | tr -d ' ')
echo "   ${TABLE_COUNT} tables, row counts identical"

echo "5. Checking the audit log is still append-only after a restore"
# The trigger is part of the schema, so it should come back with it. If it did
# not, the restored database would accept edits to the audit log and nobody
# would notice until it mattered.
if psql "$SCRATCH_URL" --quiet -c "UPDATE audit_log SET action = 'tampered'" > /dev/null 2>&1; then
  echo "   The audit log accepted an update after restore. The trigger was lost." >&2
  exit 1
fi
echo "   Still refuses updates"

echo
echo "Restore verified."
