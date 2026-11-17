#!/usr/bin/env bash
# Restore an encrypted backup into a database.
#
#   BACKUP_PASSPHRASE=... ./infra/backup/restore.sh <backup file> <target url>
#
# The target is given explicitly and never defaulted. A restore script that
# guesses where to put the data is a script that will one day overwrite
# production because someone forgot an argument.

set -euo pipefail

: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"

BACKUP="${1:?Usage: restore.sh <backup file> <target database url>}"
TARGET_URL="${2:?Usage: restore.sh <backup file> <target database url>}"

[ -f "$BACKUP" ] || { echo "No such backup: $BACKUP" >&2; exit 1; }

# Verify the checksum first when one is present. Restoring a corrupted backup
# and discovering it halfway is worse than not starting.
if [ -f "${BACKUP}.sha256" ]; then
  if command -v shasum > /dev/null; then
    ACTUAL=$(shasum -a 256 "$BACKUP" | awk '{print $1}')
  else
    ACTUAL=$(sha256sum "$BACKUP" | awk '{print $1}')
  fi
  EXPECTED=$(cat "${BACKUP}.sha256")
  if [ "$ACTUAL" != "$EXPECTED" ]; then
    echo "Checksum mismatch. This backup is damaged and will not be restored." >&2
    exit 1
  fi
  echo "Checksum verified"
fi

echo "Restoring ${BACKUP} into the target database"

# Read by the database's own psql when it runs in a container, for the reason
# backup.sh dumps there: a dump from pg_dump 17 carries commands (\restrict)
# that an older psql on the host stops at. The target is still the URL given;
# only its user and database name are used inside, over the container's socket.
if [ -z "${PG_DUMP_CONTAINER:-}" ] && command -v docker > /dev/null 2>&1; then
  PG_DUMP_CONTAINER="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -E 'postgres-1$' | head -1 || true)"
fi
load() {
  if [ -n "${PG_DUMP_CONTAINER:-}" ]; then
    local user db
    user="$(printf '%s' "$TARGET_URL" | sed -E 's#^[a-z]+://([^:@/]+).*#\1#')"
    db="$(printf '%s' "$TARGET_URL" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')"
    docker exec -i "$PG_DUMP_CONTAINER" psql --username="$user" --dbname="$db" "$@"
  else
    psql "$TARGET_URL" "$@"
  fi
}

openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$BACKUP" \
  | gunzip \
  | load --quiet --set ON_ERROR_STOP=on

echo "Restored"
