# AMC System — Work Breakdown

Companion to AMC-Development-Plan.md · SRS v1.2 · prepared 2026-09-14

Each row is **one mergeable unit of work** — one branch, one pull request, reviewable in a sitting. Nothing is larger than three days; anything that grew past that got split. Estimates are working days for you and Claude together, and they are planning numbers, not promises.

**Definition of done, every task without exception:** domain tests, use-case tests against fake ports, at least one integration test on a real Postgres, UI wired where the task has a screen, audit rows verified, Arabic and English strings present, CI green.

Legend: **FR** = requirement covered · **Dep** = must land first · **d** = estimated days

---

## P0 — Foundation (20 tasks, ~11 days)

Nothing here is visible to a user, and all of it is unaffordable to retrofit. This is the phase that decides whether the architecture survives contact with the deadline.

| ID | Task | FR | Dep | d |
|---|---|---|---|---|
| P0-01 | Monorepo and toolchain: pnpm workspaces, Turborepo, strict TS, Biome, commit hooks | — | — | 0.5 |
| P0-02 | ESLint boundaries and dependency-cruiser rules that fail CI on a layer violation | — | P0-01 | 0.5 |
| P0-03 | `kernel` package: Result, Money (fils), Duration, Rate, ULID, Clock port, UnitOfWork port, DomainEvent, AggregateRoot | — | P0-01 | 1 |
| P0-04 | API skeleton: Nest bootstrap, Zod-validated env config, pino with request ids, health endpoints, global error filter | — | P0-01 | 0.5 |
| P0-05 | Postgres and Drizzle: docker-compose dev, migration pipeline, seed runner | — | P0-04 | 0.5 |
| P0-06 | Integration test harness with Testcontainers and per-test transaction rollback | — | P0-05 | 0.5 |
| P0-07 | `contracts` package: shared Zod schemas, error envelope, pagination, generated types | — | P0-03 | 0.5 |
| P0-08 | Identity domain and application: User, Role, Permission, Session, argon2id hashing | 2.2 | P0-03 | 1 |
| P0-09 | Identity HTTP: login, logout, session refresh, me, guards, permission decorator | 2.2 | P0-08 | 0.5 |
| P0-10 | TOTP two-factor, mandatory for Manager | NFR-04 | P0-09 | 0.5 |
| P0-11 | Audit module: append-only table, revoked UPDATE and DELETE grants, UnitOfWork hook, interceptor, before/after JSONB | NFR-05 | P0-08 | 1 |
| P0-12 | Outbox table, in-process event bus, worker app skeleton on BullMQ and Redis | — | P0-05 | 1 |
| P0-13 | `FileStorage` port with S3 adapter and MinIO for local, presigned upload and download | — | P0-04 | 0.5 |
| P0-14 | `SecretVault` port: KMS envelope encryption, AES-256-GCM data keys, audit row on every read | FR-05, NFR-04 | P0-11 | 1 |
| P0-15 | Web skeleton: Vite, React 19, TanStack Router and Query, auth flow, app shell | — | P0-09 | 1 |
| P0-16 | Internationalisation and right-to-left: i18next ar/en, direction switching, Intl formatting, CSS logical properties | NFR-07 | P0-15 | 1 |
| P0-17 | Design system base: Tailwind tokens, shadcn primitives, form components bound to Zod | NFR-07 | P0-16 | 1 |
| P0-18 | Production infrastructure: docker-compose, Caddy with automatic TLS, environment and secret handling | — | P0-04 | 0.5 |
| P0-19 | Backups: nightly encrypted dump plus WAL archiving to S3, restore script, scheduled restore test | NFR-08 | P0-18 | 1 |
| P0-20 | CI/CD and docs: lint, typecheck, test, build, image push, deploy; ADRs 001 to 005; README | — | P0-02 | 1 |

**Phase exit:** you can log in as each of the four roles in Arabic and English, every write lands in the audit log, and a restore from last night's backup has actually been performed once.

---

## P1 — Clients, tasks, timer, deadlines (33 tasks, ~30 days)

The largest phase and the one that earns money, because it is the one that captures hours.

### Clients and documents

| ID | Task | FR | Dep | d |
|---|---|---|---|---|
| P1-01 | Client aggregate: legal details, TRN value object, CT and VAT registration status, tax period (start month + length) | FR-02 | P0-11 | 1 |
| P1-02 | Rate history: effective-dated `client_rates`, company default fallback, resolution by date | FR-03 | P1-01 | 1 |
| P1-03 | Leads: capture, statuses, conversion to client preserving the source | FR-01 | P1-01 | 1 |
| P1-04 | Client contacts and `client_staff_access`, the accountant-to-client assignment | 2.2 | P1-01 | 0.5 |
| P1-05 | Row-level scoping enforced inside repositories, with tests proving an accountant cannot read an unassigned client | 2.2 | P1-04 | 1 |
| P1-06 | Document types and client documents: storage key, issue and expiry dates, status lifecycle | FR-04 | P0-13 | 1 |
| P1-07 | Document upload UI, drag and drop, renewal, expiry badges, short-lived download links | FR-04 | P1-06 | 1 |
| P1-08 | EmaraTax credential vault: sealed at rest, permission-gated, every read logged with its reason | FR-05 | P0-14 | 0.5 |
| P1-09 | Contact log: what was said, when it happened, with screenshot attachments | FR-06 | P1-06 | 0.5 |
| P1-10 | Clients UI: list with search and filters, client file, lead pipeline board with conversion | FR-01, FR-02 | P1-03, P1-07 | 2 |

### Services and tasks

| ID | Task | FR | Dep | d |
|---|---|---|---|---|
| P1-11 | Service templates: seed the eleven services with steps, required documents, deadline rules | FR-10 | P1-01 | 1.5 |
| P1-12 | Client service subscription, and automatic task creation from the template with its checklist | FR-11 | P1-11 | 1 |
| P1-13 | Task state machine as an explicit transition table, plus the mandatory-documents gate before "in progress" | FR-12 | P1-12 | 1 |
| P1-14 | `task_documents` join and the checklist UI that resolves requirements against the client's own documents | FR-12, ERD 1 | P1-13, P1-06 | 1 |
| P1-15 | Append-only `task_assignments`, reassignment, and the per-person workload view, manager only | FR-13 | P1-13 | 1 |
| P1-16 | Recurrence engine: monthly, quarterly and annual renewal keyed by period, idempotent on replay | FR-14 | P1-13, P0-12 | 1.5 |
| P1-17 | Letter generation from the firm's templates, filled from the client record, bilingual, printable | FR-15 | P1-14 | 1.5 |
| P1-18 | Tasks UI: board by state, task detail with steps, documents and assignment | FR-12, FR-13 | P1-15 | 2 |

### Time tracking

| ID | Task | FR | Dep | d |
|---|---|---|---|---|
| P1-19 | Time domain: TimeEntry bound to a task assignment, Duration arithmetic, billable flag | FR-20, FR-23 | P1-15 | 1 |
| P1-20 | Running timer: start and stop, one active timer per person enforced in the database, auto-stop of the previous task | FR-21 | P1-19 | 1 |
| P1-21 | Manual entry with a mandatory reason, flagged as manual and audited | FR-22 | P1-19 | 0.5 |
| P1-22 | Offline resilience: timer actions queued in IndexedDB before the network, replayed in order on reconnect, replayed instants clamped server-side | NFR-03 | P1-20 | 2 |
| P1-23 | Idle and after-hours detection against each person's working hours, flagged for confirmation rather than discarded | FR-25 | P1-20 | 1 |
| P1-24 | Timesheet: a person's own week day by day, total hours and billable percentage | FR-24 | P1-19 | 1 |
| P1-25 | Timer UI, mobile first: one-tap start, hold and resume, visible running state, works as an installed PWA | FR-20, FR-21, NFR-07 | P1-20 | 2 |

### Deadline engine

| ID | Task | FR | Dep | d |
|---|---|---|---|---|
| P1-26 | Deadline rules: VAT on the 28th after period end, CT nine months after fiscal year end, both from a rule table | FR-40 | P1-11 | 1.5 |
| P1-27 | UAE business-holiday calendar and the next-business-day shift when a due date falls on a weekend or holiday | FR-40 | P1-26 | 1 |
| P1-28 | Day-one trigger: create the preparation task and send the document request on the first day of the filing month | FR-41 | P1-26, P1-16 | 1 |
| P1-29 | Expiry monitoring at 90, 60 and 30 days, with a tax profile update task on renewal | FR-42 | P1-06 | 1 |
| P1-30 | Escalation chain with configurable durations: client at 7 days, accountant at 14, manager 5 days before the deadline | FR-43 | P1-28 | 1 |
| P1-31 | Notifications: in-app inbox, email through SES, per-user preferences, wired to the escalation ladder | FR-43 | P0-12 | 1 |
| P1-32 | Monthly deadline calendar: returns, expiries, overdue work, weekend and holiday shifts shown with their reason | FR-44 | P1-28 | 1.5 |
| P1-33 | **P1 acceptance run** with a real client, on a phone and a desktop, against SRS §8 | — | all P1 | 1 |

**Phase exit:** SRS P1 accepted. A real client is live, their tasks were created from templates, the timer survives a closed browser, and every registered client shows the correct next VAT deadline.

---

## P2 — Billing (13 tasks, ~14 days)

| ID | Task | FR | Dep | d |
|---|---|---|---|---|
| P2-01 | Quotation domain: lines, estimated hours or amount, draft to sent to accepted or declined | FR-30 | P1-01 | 1 |
| P2-02 | Quotation UI and PDF output, bilingual | FR-30 | P2-01 | 1 |
| P2-03 | Statement generation: approved unbilled hours times the client's rate, grouped by service, task, date and person | FR-31 | P1-24, P1-02 | 2 |
| P2-04 | Statement review: exclude or adjust any line, every change recorded with a reason | FR-32 | P2-03 | 1 |
| P2-05 | Conversion to invoice in one click, with `task_id` required on every line and the billable-state check | FR-32, ERD 4 | P2-04 | 1.5 |
| P2-06 | Invoice states and the scheduled job that moves an unpaid invoice to overdue | FR-33 | P2-05 | 1 |
| P2-07 | Entry locking once invoiced, and the manager-only unlink that writes to the audit log | FR-26 | P2-05 | 1 |
| P2-08 | Payments: full and partial, with the resulting state change | FR-33 | P2-06 | 1 |
| P2-09 | Collection-pending treatment so work can start before payment | FR-34 | P2-06 | 0.5 |
| P2-10 | Reports: hours by client, person and service; billed against unbilled | FR-35 | P2-03 | 1.5 |
| P2-11 | Client profitability: the value of their time against what they actually paid | FR-35 | P2-10 | 1 |
| P2-12 | Fixed fee per service and monthly retainer, with hours still recorded for profitability | FR-36 | P2-05 | 1.5 |
| P2-13 | **P2 acceptance run**: a real client's statement reconciled against a manual calculation | — | all P2 | 0.5 |

**Phase exit:** SRS P2 accepted. The figures match a hand calculation, and invoiced hours can no longer be edited.

---

## P3 — AI invoice pipeline (16 tasks, ~19 days)

| ID | Task | FR | Dep | d |
|---|---|---|---|---|
| P3-01 | **Golden set first**: 50 real invoices with hand-verified fields, and a harness that scores field-level accuracy on every run | NFR-10 | P0-06 | 1.5 |
| P3-02 | Batch upload of up to 200 files through presigned URLs, with resumable progress | FR-50 | P0-13 | 1.5 |
| P3-03 | Batch bound to the client's accounting task for the period, so pages, cost and export are traceable | FR-50, ERD 4 | P3-02, P1-16 | 0.5 |
| P3-04 | `InvoiceExtractor` port and the Claude vision adapter returning the 15 fields with per-field confidence | FR-51 | P3-01 | 2 |
| P3-05 | Per-file job isolation: one failure never stops the batch, retries with backoff, failures routed to exceptions | NFR-02 | P3-04, P0-12 | 1 |
| P3-06 | Chart of accounts import from QuickBooks, with a manual fallback | FR-52 | P0-13 | 1 |
| P3-07 | Ledger suggestion chain: explicit rules, then chart of accounts, then learning from this supplier's approved history | FR-52 | P3-06 | 2 |
| P3-08 | Deterministic checks: net plus VAT equals total, VAT rate sanity, duplicate detection, mandatory fields | FR-53 | P3-04 | 1 |
| P3-09 | Confidence threshold, configurable and defaulting to 90 percent, feeding a mandatory exceptions queue | FR-54 | P3-08 | 1 |
| P3-10 | Review screen: the extracted item beside the original page, low-confidence fields highlighted, approve, edit or reject | FR-55 | P3-09 | 2.5 |
| P3-11 | Bulk approval of clean items, and Excel export in the firm's standard format | FR-56 | P3-10 | 1.5 |
| P3-12 | Permanent link from every approved entry to its source PDF, opened in one click | FR-58 | P3-11 | 0.5 |
| P3-13 | Unified search by number, supplier, date, amount or ledger account | FR-59 | P3-11 | 1 |
| P3-14 | AI usage and cost per page, per batch and per client, with a monthly cap and alert | FR-90 | P3-04 | 1 |
| P3-15 | Performance work until 100 PDFs finish inside 15 minutes with an honest progress bar | NFR-01 | P3-05 | 1 |
| P3-16 | **P3 acceptance run**: 50 real PDFs, at least 90 percent of fields correct, every error in the exceptions queue | — | all P3 | 0.5 |

**Phase exit:** SRS P3 accepted. The accountant reviews the exceptions, not the hundred invoices.

---

## P4 — Approval and audit hardening (5 tasks, ~5 days)

Most of this was built in P0 and P3. This phase proves it.

| ID | Task | FR | Dep | d |
|---|---|---|---|---|
| P4-01 | Approval record per item: who, when, and the before and after of every edit | FR-57 | P3-10 | 1 |
| P4-02 | Export guard: no unapproved item can leave the system by any route, proved by test | FR-54 to 56 | P3-11 | 1 |
| P4-03 | Audit viewer for the Manager: filter by actor, entity, date, and inspect before and after | NFR-05 | P0-11 | 1.5 |
| P4-04 | Security pass: database grants, session expiry, rate limiting, dependency audit, secret rotation drill | NFR-04 | P0-14 | 1 |
| P4-05 | **P4 acceptance run** | — | all P4 | 0.5 |

---

## P5 — Follow-ups (8 tasks, ~10 days)

| ID | Task | FR | Dep | d |
|---|---|---|---|---|
| P5-01 | Receivables list ranked by debt age and amount, drilling into each client's invoices | FR-60 | P2-06 | 1.5 |
| P5-02 | Message templates staged by debt age, bilingual, with variable substitution | FR-61 | P5-01 | 1 |
| P5-03 | Generate, review, then send — never send unreviewed | FR-61 | P5-02 | 1 |
| P5-04 | Follow-up log, replies recorded, and an automatic reminder to the accountant when nobody replies | FR-62 | P5-03 | 1.5 |
| P5-05 | Supplier follow-up: missing invoices and statements, with automatic request messages | FR-63 | P5-02 | 1.5 |
| P5-06 | Supplier statement comparison: in their statement but not ours, and in ours but not theirs | FR-64 | P5-05 | 2 |
| P5-07 | WhatsApp Cloud API adapter behind the existing `Messenger` port | FR-65 | P1-31 | 1.5 |
| P5-08 | **P5 acceptance run** against the real receivables position | — | all P5 | 0.5 |

**Start the WhatsApp Business API application during P1.** Approval takes weeks and P5-07 is blocked until Meta responds. Email is the fallback and it already works from P1-31.

---

## P6 — Bank reconciliation (5 tasks, ~9 days)

| ID | Task | FR | Dep | d |
|---|---|---|---|---|
| P6-01 | Statement import: CSV and Excel parsers, plus PDF extraction reusing the P3 adapter | FR-70 | P3-04 | 2.5 |
| P6-02 | Matching engine scoring amount, date, reference and description, with a confidence per suggestion | FR-71 | P6-01 | 2.5 |
| P6-03 | Confirmation UI: matched, unmatched and possibly duplicated, with bulk confirm | FR-72 | P6-02 | 2 |
| P6-04 | Pending items report | FR-72 | P6-03 | 1 |
| P6-05 | **P6 acceptance run**: a real statement, at least 80 percent matched automatically | — | all P6 | 0.5 |

---

## P7 — QuickBooks (5 tasks, ~8 days)

| ID | Task | FR | Dep | d |
|---|---|---|---|---|
| P7-01 | OAuth2 connection with tokens held in the encrypted vault and refreshed automatically | FR-56 | P0-14 | 1.5 |
| P7-02 | Account and tax code mapping, editable, validated against the live chart of accounts | FR-56 | P7-01, P3-06 | 1.5 |
| P7-03 | Push approved entries with an idempotency key, so a retry never double-posts | FR-56 | P7-02 | 2 |
| P7-04 | Failure handling, retry queue, and a reconciliation report of what reached QuickBooks | FR-56 | P7-03 | 2 |
| P7-05 | **P7 acceptance run**: an approved entry lands with the right account and the right tax | — | all P7 | 0.5 |

---

## Continuous — dashboard and reporting (7 tasks, ~11 days)

These are not a phase. Each card is built in the phase that produces its data, otherwise the dashboard shows empty boxes for four months.

| ID | Task | FR | Built during | d |
|---|---|---|---|---|
| C-01 | Dashboard shell, role-aware, card registry so each phase adds its own | FR-80 | P1 | 1.5 |
| C-02 | Cards for tasks, deadlines and expiries | FR-80 | P1 | 1 |
| C-03 | Hours this month: hours and value per client, billed against unbilled, for the Manager | FR-81 | P2 | 1.5 |
| C-04 | Cards for receivables and collection pending | FR-80 | P2 | 1 |
| C-05 | Cards for batch status, exceptions and AI spend | FR-80, FR-90 | P3 | 1.5 |
| C-06 | VAT report for the period, taxable separated from non-taxable, unusual treatment flagged, drill-down to the invoice | FR-82 | P3 | 2.5 |
| C-07 | Export any report to Excel and PDF, one shared pipeline | FR-83 | P2 | 1.5 |

---

## Totals

| Phase | Tasks | Days | Calendar at 4 productive days a week |
|---|---|---|---|
| P0 Foundation | 20 | 11 | 3 weeks |
| P1 Clients, tasks, timer, deadlines | 33 | 30 | 7–8 weeks |
| P2 Billing | 13 | 14 | 3–4 weeks |
| P3 AI pipeline | 16 | 19 | 5 weeks |
| P4 Audit hardening | 5 | 5 | 1–2 weeks |
| P5 Follow-ups | 8 | 10 | 2–3 weeks |
| P6 Bank reconciliation | 5 | 9 | 2 weeks |
| P7 QuickBooks | 5 | 8 | 2 weeks |
| Continuous | 7 | 11 | folded into the phases above |
| **Total** | **112** | **117** | **~6 months** |

The earlier estimate of four to five months assumed full-time work. At four productive days a week, six months is the honest number. P1 and P2 together take three months, and that is the point where the system starts paying for itself, because hours stop leaking.

---

## Sequencing rules

1. **Never start a phase before its predecessor's acceptance run passes.** The SRS gives each phase an acceptance test; that is the gate.
2. **P0 is not negotiable and not shortenable.** Audit, roles and backups cost days now and weeks later.
3. **P3-01, the golden set, comes before any extractor code.** Accuracy you cannot measure is accuracy you cannot improve.
4. **Two things start on day one, in parallel with P0:** the WhatsApp Business API application, and the AWS account with the me-central-1 region and a domain.
5. **Blocked work moves aside, it does not stall the phase.** P5-07 waits on Meta, P7 waits on QuickBooks credentials. Everything else keeps moving.
6. **One task in flight at a time.** With a single developer, parallel branches only create merge pain.

## Tracking

The repository is at https://gitlab.com/rafahkhaled7118/amc-system, private. Use GitLab issues, one per row in the tables above, labelled by phase and by requirement number, with a milestone per phase. That keeps the backlog beside the code and the requirement numbers beside the commits, which is what you need at acceptance time when management asks which FR a change belongs to.
