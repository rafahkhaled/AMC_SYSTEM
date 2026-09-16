# Bugs found, and what caused them

Every one of these cost time. They are written down so the next one is
recognised rather than rediscovered. The pattern worth noticing: the expensive
ones were not wrong logic, they were **correct logic that never ran**, or tests
that agreed with the code because both used the same wrong assumption.

## The ones that passed their tests

### Dates handed to a raw SQL template are not bound

**Symptom:** `The "string" argument must be of type string... Received an
instance of Date`. The worker failed on every pass; its six unit tests were
green.

**Cause:** the driver binds parameters from a raw `sql` template directly. It
does not know a `Date` is meant to be a timestamp. The publisher's tests used
a fake outbox, so nothing ever reached a database.

**Fix:** use the query builder, which knows the column type, or send
`value.toISOString()` with an explicit `::timestamptz` cast. The queue does the
latter in eleven places.

**Lesson:** a fake proved the logic and nothing else.

### The recurrence sweep looked at the wrong period

**Symptom:** a client whose VAT quarter closed in July never got a return task.
The live worker created nothing; all eleven unit tests passed.

**Cause:** the sweep asked for "the period containing last month". For a client
whose quarter runs August to October, last month sits inside the quarter still
open. The test stub returned the same period whatever date it was given, so it
could not tell the difference.

**Fix:** step back from the period running *today* to the one that has closed.
Correct whether or not the sweep ran last month.

**Lesson:** a stub that ignores its arguments cannot test logic that depends on
them.

### The error filter only existed in one entrypoint

**Symptom:** tests saw a different error body than real clients did.

**Cause:** it was registered in `main.ts`, so every other way of starting the
app ran without it.

**Fix:** register it in the module with `APP_FILTER`.

## The ones only concurrency showed

### Migrations raced on their own bookkeeping table

**Symptom:** CI failed with `duplicate key value violates unique constraint
"pg_type_typname_nsp_index"` — Postgres complaining about its own catalogue.

**Cause:** the runner created `schema_migrations` *before* taking its advisory
lock. `CREATE TABLE IF NOT EXISTS` is not safe concurrently: two sessions both
find it missing and both try. Locally it never appeared, because the database
had been migrated long ago and nothing was being created.

**Fix:** take the lock first, and put the creation inside the guarded section
so a failure still releases it. There is now a test running four connections at
once.

### Tests asserting on every row in a shared database

**Symptom:** `expected 3 to be 2`, intermittently.

**Cause:** packages run in parallel and share one test database. Tests using
the rollback harness are isolated; tests that commit are not. A test counting
every open task passes or fails depending on what else is running.

**Fix:** count only your own rows, by prefix.

### Two refusals in one transaction

**Symptom:** a test expecting a trigger message got "Failed query" instead.

**Cause:** a failed statement aborts the whole Postgres transaction. The second
attempt reported *transaction aborted*, not the rule that refused it. The test
would have passed or failed for the wrong reason.

**Fix:** one refusal per transaction, one per test.

## The ones the toolchain caused

### The formatter broke dependency injection

**Symptom:** `Nest can't resolve dependencies of the SessionGuard (..., ?)`.

**Cause:** Biome's import organiser rewrote `import { Reflector }` as
`import type { Reflector }`. That erases the runtime value, so the emitted
metadata became `Function` and Nest had nothing to resolve.

**Fix:** `style/useImportType` is off. Under NestJS this is not a style
preference; it is the difference between working and silently broken.

### Turborepo hid an environment variable

**Symptom:** CI could not reach Postgres at the address it had been given.

**Cause:** Turborepo hides every variable a task has not declared, so a cached
result cannot depend on something invisible. `TEST_DATABASE_URL` was stripped
before vitest saw it, and the harness fell back to its local default — which is
correct on a developer machine, so it passed locally for the worst possible
reason.

**Fix:** declare it in `turbo.json`. Proven by pointing it at a dead port and
checking the failure names that port.

### Two copies of Vite

**Symptom:** `'test' does not exist in type 'UserConfigExport'`, then plugin
type mismatches.

**Cause:** vitest 2 depends on Vite 5; the web app used Vite 6.

**Fix:** align the workspace on vitest 3.

### Tests were never typechecked

**Cause:** the build config excludes test files, so nothing checked them. A
fixture that had drifted from its aggregate compiled happily.

**Fix:** `tsconfig.typecheck.json` covers everything and runs in the gate. It
found real errors on its first run. The browser half is checked separately, so
only it can see the DOM.

## The ones the schema caused

### A renewal that could not be written in either order

**Symptom:** inserting a replacement document violated the unique index;
superseding the old one first violated the foreign key.

**Cause:** the foreign key wanted the replacement to exist; the partial unique
index on live documents wanted the old row superseded. Both correct, and
together no order worked.

**Fix:** `DEFERRABLE INITIALLY DEFERRED` on the link. Supersede first, insert
second, both checked at commit.

### Constraints doing their job, mistaken for bugs

Twice a "failure" was a fixture that was wrong: assignments created with
`now()` and then unassigned in the past, and a catch-up test where the
arithmetic ran the wrong way (a missed ninety-day mark means the document
expires in *fewer* than ninety days now, not more).

**Lesson:** when a constraint refuses something, assume the constraint is right
until shown otherwise. It usually is.

## Smaller ones worth remembering

- **`classes()` took a union of string and false.** `affix && 'with-affix'`
  yields `0` when `affix` is the number zero, and a stray `"0"` in a class list
  is never found. It takes `unknown` and keeps only real strings.
- **Biome flagged a constructor as useless** where the base constructor is
  `protected` and the subclass widens it. Suppressed with a reason.
- **`role="status"` on a div** should be an `<output>`, which carries the role.
- **dependency-cruiser cruised `dist/`**, producing orphan warnings about
  compiled files. Excluded.
- **eslint-plugin-boundaries could not resolve `./money.js` to `money.ts`**
  under NodeNext, and did not recognise built package entry points. Both needed
  configuration, or every cross-package import looked like an unknown element.
- **`pg_ctl start` on a running server prints "could not start server"**, which
  reads as a fault and is not one. `scripts/pg.sh` checks first.
