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
  database/   Connection pool, migration runner, seeds, integration harness
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

## Repository

Hosted privately at https://gitlab.com/rafahkhaled7118/amc-system. Every merge
request runs the same `pnpm verify` gate that runs locally, so a red pipeline is
always reproducible on your own machine.

### Mirroring

One host has already refused this account once, so the repository is set up to
live on more than one. Adding a mirror is two commands:

```bash
git remote add <name> <url>
./scripts/mirror-push.sh
```

The script pushes the current branch to every configured remote and keeps going
when one fails, then exits non-zero so an incomplete mirror is never mistaken
for a successful push. Pass `--tags` to include tags.

### Credentials

Git talks to GitLab through the GitLab CLI's own credential helper, so the
token stays in the system keyring and nothing is written to a file:

```bash
git config --global credential."https://gitlab.com".helper '!"$HOME/.local/bin/glab" auth git-credential'
```

Without this, pushes work only while the macOS keychain happens to hold a
matching entry, and fail with "could not read Username" as soon as it does not.

## Getting started

Requires Node 22, pnpm 10, and a Postgres 17 server.

```bash
pnpm install
pnpm db:migrate
pnpm verify     # lint, typecheck, test, architecture rules
```

### Postgres with Docker

```bash
docker compose -f infra/docker-compose.dev.yml up -d
```

That gives you Postgres on 5433, Redis, and MinIO standing in for S3.

### Running without Docker

Once the cluster exists, use the helper:

```bash
./scripts/pg.sh start     # or stop, status, log
```

It checks whether the server is already up first. Running `pg_ctl start` twice
prints an alarming "could not start server", which is only Postgres refusing to
take over a data directory another process owns. The helper says so plainly
instead.

To create the cluster the first time, the project needs nothing more than a
server on port 5433 with an `amc` role and two databases, `amc` and `amc_test`.
Any Postgres 17 will do. With the binaries from
[Postgres.app](https://postgresapp.com) unpacked under `~/.local/opt/postgres`:

```bash
initdb -D ~/.local/var/amc-pg -U amc --auth=trust
createdb -h 127.0.0.1 -p 5433 -U amc amc
createdb -h 127.0.0.1 -p 5433 -U amc amc_test
```

Trust authentication is fine for a local cluster on the loopback interface and
nowhere else.

Useful individually:

```bash
pnpm test           # unit and integration tests
pnpm test:watch     # while working
pnpm arch:check     # dependency rules only
pnpm lint:fix       # format and autofix
pnpm db:migrate     # apply pending migrations
pnpm db:seed        # load reference data
pnpm db:generate    # generate a migration from schema changes
```

## Creating the first user

Nothing can be done in the application until a user exists, and the only screen
that creates users sits behind the sign-in that needs one. So the first one is
made from the command line:

```bash
AMC_PASSWORD='a long passphrase' pnpm create-user wael@activemanagement.ae "Wael Ajam" manager
```

The password comes from the environment rather than an argument, because an
argument is visible in the process list and is kept in shell history.

## Migrations

Each file in `packages/database/migrations` runs once, in its own transaction,
in filename order, under an advisory lock so two processes starting together
cannot both migrate. Applied files are recorded with a checksum: editing one
that has already run stops the next migration rather than letting the database
drift from the code. Add a new file instead.

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
