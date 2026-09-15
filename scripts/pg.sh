#!/usr/bin/env bash
# Start, stop or inspect the local Postgres used for development.
#
# Only needed on machines without Docker. With Docker, use
# `docker compose -f infra/docker-compose.dev.yml up -d` instead.
#
#   ./scripts/pg.sh start     start it, or say so if it is already up
#   ./scripts/pg.sh stop
#   ./scripts/pg.sh status
#   ./scripts/pg.sh log       tail the server log
#
# Starting an already-running server prints a frightening "could not start
# server" from pg_ctl. That is Postgres refusing to take over a data directory
# another process owns, which is correct and not a fault. This script checks
# first and tells you plainly.

set -uo pipefail

DATA="${AMC_PGDATA:-$HOME/.local/var/amc-pg}"
LOG="${AMC_PGLOG:-$HOME/.local/var/amc-pg.log}"
PORT="${AMC_PGPORT:-5433}"
BIN="${AMC_PGBIN:-$HOME/.local/opt/postgres/bin}"

command="${1:-status}"

if [ ! -x "$BIN/pg_ctl" ]; then
  echo "No Postgres binaries at $BIN. See the README for the no-Docker setup." >&2
  exit 1
fi

running() { "$BIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; }

case "$command" in
  start)
    if running; then
      echo "Already running on port $PORT. Nothing to do."
      exit 0
    fi
    "$BIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp" -l "$LOG" start
    ;;
  stop)
    if ! running; then
      echo "Not running."
      exit 0
    fi
    "$BIN/pg_ctl" -D "$DATA" -m fast stop
    ;;
  status)
    if running; then
      echo "Running on port $PORT."
      "$BIN/psql" -h 127.0.0.1 -p "$PORT" -U amc -d postgres -tAc \
        "select '  database: ' || datname from pg_database where datname like 'amc%' order by 1"
    else
      echo "Not running. Start it with: ./scripts/pg.sh start"
      exit 1
    fi
    ;;
  log)
    tail -f "$LOG"
    ;;
  *)
    echo "Usage: $0 {start|stop|status|log}" >&2
    exit 1
    ;;
esac
