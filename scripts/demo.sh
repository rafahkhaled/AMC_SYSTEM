#!/usr/bin/env bash
# Walks the whole system end to end and prints what happens, so you can see
# what is actually working rather than take a test count on trust.
#
#   ./scripts/demo.sh
#
# Starts Postgres if needed, builds, migrates, runs the API and the worker,
# performs a real sign-in, reads the audit trail it produced, and stops again.

set -uo pipefail
cd "$(dirname "$0")/.."

PORT="${DEMO_PORT:-3131}"
DB="${DEMO_DATABASE_URL:-postgres://amc@127.0.0.1:5433/amc}"
EMAIL="${DEMO_EMAIL:-wael@activemanagement.ae}"
PASSWORD="${DEMO_PASSWORD:-correct horse battery staple}"
COOKIE_JAR="$(mktemp)"
API_LOG="$(mktemp)"
WORKER_LOG="$(mktemp)"

blue()  { printf '\n\033[1;34m%s\033[0m\n' "$1"; }
green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
grey()  { printf '\033[0;90m%s\033[0m\n' "$1"; }

cleanup() {
  kill "${API_PID:-}" "${WORKER_PID:-}" 2>/dev/null
  wait "${API_PID:-}" "${WORKER_PID:-}" 2>/dev/null
  rm -f "$COOKIE_JAR"
}
trap cleanup EXIT

blue "1. Postgres"
./scripts/pg.sh start || exit 1

blue "2. Build and migrate"
pnpm build > /dev/null 2>&1 && green "built"
DATABASE_URL="$DB" pnpm db:migrate

blue "3. Make sure there is someone to sign in as"
# Already existing is the normal case on a second run, not a failure.
CREATED=$(DATABASE_URL="$DB" AMC_PASSWORD="$PASSWORD" \
  pnpm create-user "$EMAIL" "Wael Ajam" manager 2>&1)
if printf '%s' "$CREATED" | grep -q "^Created"; then
  green "$(printf '%s' "$CREATED" | grep '^Created')"
elif printf '%s' "$CREATED" | grep -qi "already uses that email"; then
  grey "$EMAIL already exists, carrying on"
else
  printf '%s\n' "$CREATED" | tail -3
  exit 1
fi

blue "4. Start the API and the worker"
(cd apps/api && DATABASE_URL="$DB" PORT="$PORT" node dist/main.js > "$API_LOG" 2>&1) &
API_PID=$!
(cd apps/worker && DATABASE_URL="$DB" node dist/main.js > "$WORKER_LOG" 2>&1) &
WORKER_PID=$!

for _ in $(seq 1 20); do
  curl -sf "http://localhost:$PORT/api/health/live" > /dev/null 2>&1 && break
  sleep 0.5
done
green "both running"

blue "5. Is it ready? (liveness and readiness are separate questions)"
curl -s "http://localhost:$PORT/api/health/ready" | python3 -m json.tool

blue "6. A locked door: /auth/me without signing in"
curl -s "http://localhost:$PORT/api/auth/me" | python3 -m json.tool

blue "7. A wrong password"
curl -s -X POST "http://localhost:$PORT/api/auth/sign-in" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"not the password\"}" | python3 -m json.tool

blue "8. An address that does not exist. Note the identical wording."
curl -s -X POST "http://localhost:$PORT/api/auth/sign-in" \
  -H 'content-type: application/json' \
  -d '{"email":"nobody@nowhere.ae","password":"whatever12345"}' | python3 -m json.tool

blue "9. Signing in properly"
curl -s -i -X POST "http://localhost:$PORT/api/auth/sign-in" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  -c "$COOKIE_JAR" | grep -iE '^HTTP|^set-cookie'
grey "httpOnly keeps it away from scripts; SameSite=Strict stops other sites sending it"

blue "10. Who am I, and what may I do?"
curl -s -b "$COOKIE_JAR" "http://localhost:$PORT/api/auth/me" | python3 -m json.tool

blue "11. The audit trail that sign-in just wrote"
curl -s -b "$COOKIE_JAR" "http://localhost:$PORT/api/audit?limit=6" \
  | python3 -c "
import json,sys
for e in json.load(sys.stdin)['entries']:
    who = e['actorLabel'] or e['actorUserId'] or 'nobody'
    print(f\"  {e['occurredAt'][11:19]}  {e['action']:34} by {who}\")
"

blue "12. Signing out, then trying the same cookie again"
curl -s -o /dev/null -w "  sign-out returned %{http_code}\n" \
  -X POST -b "$COOKIE_JAR" "http://localhost:$PORT/api/auth/sign-out"
curl -s -o /dev/null -w "  reusing the cookie returned %{http_code}\n" \
  -b "$COOKIE_JAR" "http://localhost:$PORT/api/auth/me"

blue "13. What the worker did with the events"
sleep 2
psql -h 127.0.0.1 -p 5433 -U amc -d amc -tAc \
  "select '  published: ' || count(*) filter (where published_at is not null)
        || ', still pending: ' || count(*) filter (where published_at is null)
   from outbox"

blue "Done"
grey "API log:    $API_LOG"
grey "Worker log: $WORKER_LOG"
