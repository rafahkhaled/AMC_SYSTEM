# ADR-0005 — AWS in me-central-1, starting small

- **Status:** accepted
- **Date:** 2026-09-12

## Context
The system holds UAE client tax registration numbers, EmaraTax credentials and
financial records. Clients will ask where their data lives. The SRS budgets
roughly AED 60 to 225 a month for hosting, storage and backup.

## Decision
AWS, in the UAE region, me-central-1, so the answer to that question is "in the
country". The starting shape is deliberately small: a single instance running
the API, worker, Redis, Postgres and Caddy under Docker Compose, with S3 for
documents, KMS for the vault master key, SES for email, and nightly encrypted
dumps plus continuous write-ahead log archiving to S3.

That lands near USD 25 to 45 a month, inside the SRS budget.

## Consequences
Data residency is satisfied and the running cost fits. A single instance is a
single point of failure, which is acceptable for an internal tool used by ten
people during office hours, provided the restore path is tested rather than
assumed — hence the scheduled restore test.

Growth is a configuration change, not a rewrite: Postgres moves to RDS and the
containers to ECS Fargate, because the application is containerised and reads
all configuration from the environment.

## Alternatives considered
Kubernetes and a multi-availability-zone posture were rejected as costing more,
in money and in attention, than ten users can justify. Hosting outside the UAE
was rejected on residency grounds alone.
