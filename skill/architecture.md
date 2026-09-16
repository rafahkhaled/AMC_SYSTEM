# Architecture

One deployable, two processes, thirteen modules. Not microservices: ten users
and five hundred clients do not justify distributed transactions across billing
and time tracking.

## Shape

```
apps/
  api/        HTTP entrypoint. Wires modules together. No business logic
  worker/     Background jobs and outbox delivery. Composes across modules
  web/        React progressive web app, Arabic first
packages/
  kernel/     Money, Duration, Rate, Result, Clock, UnitOfWork, AggregateRoot
  contracts/  Zod schemas shared by the API and the browser
  http-kit/   Access decorators and the caller shape, shared by all modules
  database/   Connection pool, migration runner, seeds, integration harness
  queue/      Postgres-backed job queue and runner
  storage/    Document storage: a folder locally, S3 in production
  vault/      Envelope encryption and the audited credential vault
  modules/
    identity/       users, roles, sessions, two-factor
    audit/          the append-only log, the outbox, the unit of work
    clients/        clients, leads, contacts, documents, access scoping
    services/       service templates, subscriptions, tasks, recurrence
    time-tracking/  time entries and the running timer
    deadlines/      the UAE calendar and statutory filing dates
```

## Layers

Every module has the same four, and dependencies only point inward:

```
http ─┐
      ├─> application ─> domain ─> kernel
infra ─┘
```

- **domain** holds the rules. Pure TypeScript. No framework, no database, no
  Node. Tested in milliseconds.
- **application** holds use cases and *declares ports*. It depends on
  interfaces, never on adapters.
- **infrastructure** implements those ports.
- **http** holds controllers and guards.

A module never imports another module's domain and never reads its tables.
Cross-module work goes through a published application facade, or a domain
event on the outbox. The **worker and the API are the exceptions**: they are
composition roots and may know about everything, which is why the client-cycle
loading for the recurrence sweep lives in the worker.

These rules are enforced by `eslint-plugin-boundaries` and `dependency-cruiser`
and fail CI. An architecture that depends on discipline is a wish.

## Where the decisions are written down

`docs/adr/`. Read these before arguing with a choice:

| ADR | Decision |
|---|---|
| 0001 | TypeScript everywhere |
| 0002 | Modular monolith with hexagonal modules |
| 0003 | Exact money and exact time |
| 0004 | Audit in the foundation, not in phase four |
| 0005 | AWS in me-central-1, starting small |
| 0006 | The job queue runs on Postgres, not Redis |

## The data model rules that are not obvious

- **The task is the hub.** A task links a client to their documents, to the
  staff assigned, and to the invoice lines. Nothing bills without one.
- **Time entries point at an assignment**, not at a task and a person
  separately. Assignments are append-only, so reassigning a task in April
  never rewrites who did March's hours.
- **Registration is three-valued.** Deregistered is not the same as never
  registered: old filings still carry the number.
- **Rates are effective-dated.** The question is "what was the rate on this
  date", never "what is the rate".
- **Documents version rather than overwrite.** A task completed in March used
  the licence valid in March.
