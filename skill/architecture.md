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
    projects/       service templates, subscriptions, projects, recurrence
    time-tracking/  time entries, the running timer, timesheets
    deadlines/      the UAE calendar, statutory filing dates, the month view
    notifications/  the inbox, delivery preferences
    whatsapp/       conversations, the bot, the Cloud API webhook
```

## The HTTP surface

Every route is under `/api`. Reads are scoped rather than permission-guarded
wherever two view permissions are alternatives — `clients.view.all` and
`clients.view.assigned` are held by different roles, so naming either would
lock the other out. Writes are guarded, because for those there is one
permission and no alternative.

```
identity      /auth/sign-in, /auth/me, /auth/sign-out[-everywhere]
              /auth/two-factor/{verify,enrol,confirm}
clients       GET  /clients, /clients/:id
              POST /clients/:clientId/documents      (multipart, clients.edit)
              GET  /documents/:id/link               (short-lived, expires)
              GET  /files/*key                       (local driver only, signed)
services      GET  /tasks, /tasks/:id
              POST /tasks/:id/move, /tasks/:id/steps/:order, /tasks/:id/documents
              DELETE /tasks/:id/documents/:type
time-tracking GET  /timer, /timer/timesheet
              POST /timer/{start,stop,hold,resume,beat,entries}
deadlines     GET  /calendar?month=YYYY-MM
audit         GET  /audit
whatsapp      GET  /whatsapp/conversations, /whatsapp/conversations/:id
              POST /whatsapp/conversations/:id/messages     (clients.edit)
              POST /whatsapp/conversations/:id/{take-over,hand-back,identify}
              GET  /whatsapp/webhook                        (public, Meta)
              POST /whatsapp/webhook                        (public, signed)
health        GET  /health/{live,ready}
```

The two WhatsApp webhook routes are the only public ones besides sign-in.
Meta has no session and never will, so what stands in for one is an HMAC over
the exact bytes of the body — which is why `rawBody: true` is set at bootstrap
and why a request that reaches the route without those bytes is refused rather
than waved through.

The browser screens map onto these one for one: clients, work, calendar,
timer, home.

## What is shared, and where

Three things are used by every module and defined exactly once. Copying any of
them is how they drift, and two of the three have drifted already.

| What | Where | Why it is not per-module |
|---|---|---|
| The caller, `heldBy`, `actorFrom` | `@amc/kernel` | An `Actor` built without a label logs changes against nobody |
| `scopePredicate` for client visibility | `@amc/database` | Four packages apply it and a drifted scope leaks a client file |
| `at()` and `on()` for dates in raw SQL | `@amc/kernel` | The driver refuses a `Date` and the error names neither column nor value |
| `toE164` for phone numbers | `@amc/kernel` | The same rule is in SQL as `e164`, and a drifted pair silently stops matching a client's messages to them |

Module-owned things stay module-owned. Each module declares its own scope type
(`ClientScope`, `TaskScope`, `CalendarScope`) rather than importing another's,
because a scope means something different in each and the shapes only look
alike.

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

- **The project is the hub.** Named for what the practice calls it: one piece
  of work for one client, "Gulf Trading, VAT return Q3 2026". Migration 0028
  renamed it from `tasks`, and `task_steps` took the freed name because a Task
  here is something to be done *inside* a project. The words on the whiteboard
  and the words in the schema are now the same words, which is worth a day of
  renaming: every conversation that needs translating on the way in is a
  requirement waiting to be built against the wrong entity.

  A project links a client to their documents, to the
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

## The rules that exist twice on purpose

Two, and only two. Both are written in TypeScript *and* in SQL because the
database has to index the answer and the application has to compute it before
it has a row to look at. Both have a test whose only job is to run the same
inputs through both and fail if they ever disagree.

| Rule | Where | Kept honest by |
|---|---|---|
| Client visibility | `scopePredicate` in `@amc/database`, applied by every repository | The integration tests in each module that assert an accountant sees their own clients and not another's |
| Phone numbers reduced to E.164 | `toE164` in `@amc/kernel`, `e164()` in migration 0023 | `packages/database/src/phone-agreement.test.ts`, which builds several hundred numbers from their parts and asks Postgres about all of them |

If you change either one, the test for it tells you about the other. If you
add a third, write its agreement test first: the way these fail is silent, and
the failure looks like a client who has simply stopped writing in.
