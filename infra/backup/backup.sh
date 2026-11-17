#!/usr/bin/env bash
# Take an encrypted backup of the database.
#
#   DATABASE_URL=... BACKUP_PASSPHRASE=... ./infra/backup/backup.sh [destination]
#
# Writes <destination>/amc-<timestamp>.sql.gz.enc and a .sha256 beside it.
# With S3_BACKUP_BUCKET set it also uploads, then removes the local copy only
# once the upload has been read back and verified.
#
# The passphrase is never a command-line argument, because arguments are
# visible in the process list on a shared machine.

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required. Generate one with: openssl rand -base64 32}"

DESTINATION="${1:-${BACKUP_DIR:-./backups}}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="amc-${STAMP}.sql.gz.enc"
TARGET="${DESTINATION}/${NAME}"

mkdir -p "$DESTINATION"

echo "Backing up to ${TARGET}"

# The dump is taken by the database's own pg_dump when it runs in a container.
# The host's was version 16 against a version 17 server, which pg_dump refuses
# outright, and every nightly backup from 30 September to 16 November was an
# empty file. Inside the container the two versions are the same by
# construction. PG_DUMP_CONTAINER names it; left unset, a running container
# whose name ends in "postgres-1" (docker compose's naming) is used if there is
# one, and the host's pg_dump otherwise.
if [ -z "${PG_DUMP_CONTAINER:-}" ] && command -v docker > /dev/null 2>&1; then
  PG_DUMP_CONTAINER="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -E 'postgres-1$' | head -1 || true)"
fi
dump() {
  if [ -n "${PG_DUMP_CONTAINER:-}" ]; then
    # The database URL names the host's port; inside, the socket is the way in.
    local user db
    user="$(printf '%s' "$DATABASE_URL" | sed -E 's#^[a-z]+://([^:@/]+).*#\1#')"
    db="$(printf '%s' "$DATABASE_URL" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')"
    docker exec -i "$PG_DUMP_CONTAINER" pg_dump --username="$user" --dbname="$db" "$@"
  else
    pg_dump "$DATABASE_URL" "$@"
  fi
}
echo "Dumping with $([ -n "${PG_DUMP_CONTAINER:-}" ] && echo "pg_dump in ${PG_DUMP_CONTAINER}" || echo "the host's pg_dump")"

# --clean --if-exists so the dump can be restored over an existing database.
# --no-owner because the restoring role is rarely the one that created things.
dump \
  --format=plain \
  --clean --if-exists \
  --no-owner --no-privileges \
  --quote-all-identifiers \
  | gzip -9 \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE \
  > "$TARGET"

# A checksum written at the same time as the file, so a truncated upload or a
# corrupted disk is detectable before anyone needs the backup rather than
# during the incident when they do.
if command -v shasum > /dev/null; then
  shasum -a 256 "$TARGET" | awk '{print $1}' > "${TARGET}.sha256"
else
  sha256sum "$TARGET" | awk '{print $1}' > "${TARGET}.sha256"
fi

SIZE=$(wc -c < "$TARGET" | tr -d ' ')
if [ "$SIZE" -lt 1024 ]; then
  echo "The backup is only ${SIZE} bytes. That is not a database." >&2
  exit 1
fi

echo "Wrote ${SIZE} bytes, sha256 $(cat "${TARGET}.sha256")"

if [ -n "${S3_BACKUP_BUCKET:-}" ]; then
  echo "Uploading to s3://${S3_BACKUP_BUCKET}/${NAME}"
  aws s3 cp "$TARGET" "s3://${S3_BACKUP_BUCKET}/${NAME}" --sse aws:kms ${S3_KMS_KEY_ID:+--sse-kms-key-id "$S3_KMS_KEY_ID"}
  aws s3 cp "${TARGET}.sha256" "s3://${S3_BACKUP_BUCKET}/${NAME}.sha256" --sse aws:kms ${S3_KMS_KEY_ID:+--sse-kms-key-id "$S3_KMS_KEY_ID"}

  # Read it back and compare before deleting anything locally. An upload that
  # reports success and stored nothing is the failure this catches.
  VERIFY="$(mktemp)"
  aws s3 cp "s3://${S3_BACKUP_BUCKET}/${NAME}" "$VERIFY" --quiet
  if ! diff -q "$TARGET" "$VERIFY" > /dev/null; then
    echo "What came back from S3 differs from what was sent. Keeping the local copy." >&2
    rm -f "$VERIFY"
    exit 1
  fi
  rm -f "$VERIFY"
  echo "Upload verified"
fi

echo "Done"
