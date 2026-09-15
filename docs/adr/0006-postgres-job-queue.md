# ADR-0006 — The job queue runs on Postgres, not Redis

- **Status:** accepted
- **Date:** 2026-09-15
- **Supersedes:** the "BullMQ + Redis" line in the development plan

## Context
Background work is unavoidable: extracting a batch of two hundred invoices,
computing deadlines, firing escalations at seven and fourteen days, renewing
recurring tasks, sending reminders. The plan named BullMQ on Redis, which is
the usual answer in this ecosystem.

Two things make it the wrong answer here.

The volume is tiny. Ten users, five hundred clients, a few thousand jobs a
month at the outside. Redis is built for a throughput problem this system does
not have, and it would be a second stateful service to run, back up, monitor
and restore, against an ADR-0005 deployment that is deliberately one small
instance.

More importantly, an event cannot be enqueued to Redis inside a Postgres
transaction. That is the whole reason the outbox pattern exists: write the
event to a table with the change, deliver it afterwards. With Redis the outbox
is a workaround. With Postgres it is simply the queue.

## Decision
Jobs live in a Postgres table, claimed with `SELECT ... FOR UPDATE SKIP
LOCKED`, which is the mechanism Postgres provides for exactly this and has had
since version 9.5.

This buys a property worth more here than throughput: enqueueing is part of the
transaction that caused it. A task that creates a job either commits with that
job or does not happen at all. There is no window in which the database says
one thing and the queue says another, and no reconciliation code to write for
when they disagree.

Retries use exponential backoff. A job that exhausts its attempts is kept and
marked failed rather than discarded, because in an accounting system the
question "what happened to that invoice batch?" must always have an answer.
Claims carry a lease, so a worker that dies mid-job releases its work instead
of holding it for ever.

## Consequences
One fewer service to operate, and a queue that shares the database's backups,
its restore procedure and its transactional guarantees. Job state is
inspectable with ordinary SQL, which matters at three in the morning.

The cost is a ceiling on throughput, in the low thousands of jobs per second
rather than the hundreds of thousands. That is three orders of magnitude above
what this system will ever ask. If it were ever approached, the queue sits
behind a port and Redis can be put back without the calling code noticing.

We also carry a little code we would otherwise have imported: claiming,
backoff, leases and reaping come to a few hundred lines. They are covered by
tests against a real database, including the concurrent case, which is the one
that matters.

## Alternatives considered
**pg-boss** does this well and is mature. It was rejected only because it
manages its own schema and migration lifecycle alongside ours, and because the
part we need is small enough to own outright and test properly.

**Doing the work inline in the request** was rejected immediately: two hundred
invoices cannot be extracted while a browser waits, and NFR-02 requires one
failure not to stop the batch.
