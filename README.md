# AMC System

Practice management for **Active Management Consultancy**: client files, service
tasks, time tracking, hourly billing, the tax deadline engine, AI invoice
processing, follow-ups, bank reconciliation and QuickBooks integration.

Built to SRS v1.2. Every requirement carries a number, and that number appears
in the branch, the test and the commit that implements it.

## Documents

| Document | What it is |
|---|---|
| [docs/SRS-v1.2-EN.docx](docs/SRS-v1.2-EN.docx) | The requirements. The binding reference at acceptance |
| [docs/development-plan.md](docs/development-plan.md) | Stack, architecture, data model, hosting |
| [docs/task-breakdown.md](docs/task-breakdown.md) | 112 tasks across eight phases, with dependencies |
| [docs/adr/](docs/adr/) | Why each significant decision was made |

## Layout

```
apps/
  api/        HTTP entrypoint. Wires modules. No business logic
  worker/     Background jobs: extraction, deadlines, escalations, recurrence
  web/        React progressive web app, Arabic first
packages/
  kernel/     Money, Duration, Rate, Result, Clock, UnitOfWork, AggregateRoot
  contracts/  Zod schemas shared by the API and the browser
  modules/    One folder per business area, each with four layers
```

Every module has the same shape, and dependencies only ever point inward:

```
http ─┐
      ├─> application ─> domain ─> kernel
infra ─┘
```

- **domain** holds the rules. Pure TypeScript. No framework, no database, no Node.
- **application** holds use cases and declares ports.
- **infrastructure** holds adapters that implement those ports.
- **http** holds controllers and guards.

A module never imports another module's domain. Cross-module communication goes
through a published facade or a domain event on the outbox. These rules are
enforced by the linter and fail CI, which is the only reason they will still be
true in six months.

## Getting started

Requires Node 22 and pnpm 10.

```bash
pnpm install
pnpm verify     # lint, typecheck, test, architecture rules
```

Useful individually:

```bash
pnpm test           # unit and integration tests
pnpm test:watch     # while working
pnpm arch:check     # dependency rules only
pnpm lint:fix       # format and autofix
```

## Conventions

- **Money never floats.** Whole fils through a `Money` value object, rounded half
  away from zero in exactly one place. See ADR-0003.
- **Time is UTC in storage, Asia/Dubai in rules**, read through the `Clock` port
  so deadlines can be tested by setting the date.
- **Expected failures are values**, returned in a `Result`. Exceptions are bugs.
- **Every write runs in a unit of work** that also writes the audit row and the
  outbox entry. See ADR-0004.
- **Every user-visible string exists in Arabic and English.**

## Status

Phase 0, foundation. See the task breakdown for what is done and what is next.
