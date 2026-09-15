#!/usr/bin/env bash
# Everything needed to work on the application, in one command.
#
#   ./scripts/dev.sh
#
# Starts Postgres if needed, migrates, then runs the API, the worker and the
# browser application together. Ctrl-C stops all three.

set -uo pipefail
cd "$(dirname "$0")/.."

DB="${DATABASE_URL:-postgres://amc@127.0.0.1:5433/amc}"

cleanup() { kill 0 2>/dev/null; }
trap cleanup EXIT INT TERM

./scripts/pg.sh start || exit 1
pnpm build > /dev/null 2>&1 || { echo "build failed"; pnpm build; exit 1; }
DATABASE_URL="$DB" pnpm db:migrate

printf '\n  API      http://localhost:3000/api/health/ready\n'
printf '  App      http://localhost:5173\n'
printf '  Worker   running\n\n'

(cd apps/api && DATABASE_URL="$DB" PORT=3000 node dist/main.js) &
(cd apps/worker && DATABASE_URL="$DB" node dist/main.js) &
(cd apps/web && pnpm exec vite --port 5173) &

wait
