# ADR-0004 — Audit in the foundation, not in phase four

- **Status:** accepted
- **Date:** 2026-09-12

## Context
NFR-05 requires that every create, edit, approval, export and access to
sensitive data is recorded, never deleted, and readable as a before and after.
The SRS places audit acceptance in phase four. Building it in phase four would
mean retrofitting it through every write path already shipped.

## Decision
The audit log is built in phase zero, before the first business feature.

Audit rows are written inside the same transaction as the change, through the
unit of work. A committed change therefore cannot exist without its audit entry.
The database role the application uses holds no UPDATE or DELETE grant on the
audit table, so the log is append-only at the database level rather than by
convention. Every read of the EmaraTax credential vault writes a row too.

Phase four then proves the property instead of building it.

## Consequences
A few days of work at the start, against weeks of archaeology later. Every write
path carries a small obligation to describe what it changed. Accepted without
reservation: in a system holding tax credentials and client money, an
untrustworthy audit trail is worse than none, because it invites false
confidence.
