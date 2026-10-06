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

**Happened twice.** Once for tasks, then again for clients a few commits
later, because the first fix was applied only where it had bitten.

**Symptom:** `expected 3 to be 2`, intermittently, and only when other
packages happen to be running.

**Cause:** packages run in parallel and share one test database. Tests using
the rollback harness are isolated; tests that commit are not, and the worker's
integration tests commit. A test that counts every open task, or every visible
client, passes or fails depending on what else is running at that moment.

**Fix:** filter to your own rows by prefix. Never assert on a global count.

**Lesson:** when a test is fixed for this reason, search for the same shape
elsewhere in the same breath. The second occurrence cost more than the first,
because by then it looked like a new problem.

### Two refusals in one transaction

**Symptom:** a test expecting a trigger message got "Failed query" instead.

**Cause:** a failed statement aborts the whole Postgres transaction. The second
attempt reported *transaction aborted*, not the rule that refused it. The test
would have passed or failed for the wrong reason.

**Fix:** one refusal per transaction, one per test.

### Two test suites, one database, the same fixture names

**Symptom:** an integration test that had passed for weeks failed with
`duplicate key value violates unique constraint "client_documents_pkey"` on
`doc-1` — in a suite that had not been touched.

**Cause:** vitest keeps files sequential inside a package, but the build runs
packages in parallel, and fixtures across packages use the same names: `doc-1`,
`c-1`, `user-a`. Two suites inserting the same primary key at the same instant
is a race, and it stayed hidden only because the suites had never overlapped
for long enough. Adding tests to one package was all it took.

A second, quieter version of the same thing: a suite that writes committed rows
cleaned up in `beforeEach` and not `afterAll`, so the last test's rows sat in
the shared database until something collided with them.

**Fix:** `createTestDatabase` takes a session advisory lock on a reserved
connection and holds it for the life of the handle, so one suite runs at a
time. Reserved rather than pooled, because a session lock belongs to its
connection; Postgres releases it on its own if a test process dies. The
committing suite now clears up on the way out as well as on the way in.

**Lesson:** a shared database makes every suite's fixture names part of one
namespace. Either the names are unique or the suites are serialised, and
serialising is one change in one file rather than a convention everybody has to
remember. Three consecutive green runs is the check that it took.

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

### A whole layer of tests that never ran

**Symptom:** none. That is the point.

**Cause:** the deadlines module's vitest config listed
`{domain,infrastructure}` because it had no application layer when it was
written. Adding one meant every test in it was skipped — and a suite that runs
no tests from a directory reports success, not a warning.

**Fix:** all six modules now list `{domain,application,infrastructure}`, and
the config says why leaving a directory out is dangerous rather than merely
incomplete.

**Lesson:** when adding a layer or a directory to a package, check the test
config includes it. A missing path is invisible: the only signal is a test
count that nobody had a reason to expect.

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

### An old server kept answering

**Symptom:** a route that had just been written returned 404, and the worker
logged "No handler registered for schedule.daily" for a handler that plainly
existed.

**Cause:** the cleanup between runs was `pkill -f "api/dist/main.js"`, and it
never matched anything. The process is started from inside its own directory,
so its command line is `node dist/main.js` — a relative path that contains no
`api/`. Every restart left the previous build listening, and every check was
answered by code written some time ago.

**Fix:** kill by port, not by path: `lsof -ti tcp:3000 | xargs kill`. A port is
what is actually contended, and it cannot be spelled two ways.

**Lesson:** a `pkill` that matches nothing exits quietly. Before trusting a
cleanup step, run it and confirm the port is free — the two questions to ask of
any negative result are whether the thing is absent or whether the search was
wrong.

## The ones the schema caused

### A renewal that could not be written in either order

**Symptom:** inserting a replacement document violated the unique index;
superseding the old one first violated the foreign key.

**Cause:** the foreign key wanted the replacement to exist; the partial unique
index on live documents wanted the old row superseded. Both correct, and
together no order worked.

**Fix:** `DEFERRABLE INITIALLY DEFERRED` on the link. Supersede first, insert
second, both checked at commit.

### A schema fix the use case did not know about

**Symptom:** uploading a renewed trade licence returned a 500. Underneath:
`duplicate key value violates unique constraint client_documents_current_idx`.

**Cause:** the renewal order had already been worked out once and written into
migration 0008 — supersede the old row first, insert the replacement second,
with the foreign key deferred to commit so that order is possible. The new use
case wrote them the other way round. Both rules then fired exactly as designed.

**Fix:** supersede first. The comment in the use case now names the migration,
because the order is not arbitrary and the next person to write it will
otherwise pick the one that reads more naturally.

**Lesson:** a constraint solved in the schema is only half solved. If the
solution depends on writing in a particular order, the order is part of the
design and belongs in a comment where the writing happens — not only in the
migration that made it possible.

A second thing this showed: a unique-index violation reached the client as
`INTERNAL_ERROR`. It was the right refusal for the wrong reason and unreadable
either way. Constraint violations that represent a real domain rule should be
caught and named.

### Constraints doing their job, mistaken for bugs

Twice a "failure" was a fixture that was wrong: assignments created with
`now()` and then unassigned in the past, and a catch-up test where the
arithmetic ran the wrong way (a missed ninety-day mark means the document
expires in *fewer* than ninety days now, not more).

**Lesson:** when a constraint refuses something, assume the constraint is right
until shown otherwise. It usually is.

### A log of changes attributed to nobody

**Symptom:** task changes appeared in the audit log with an empty actor, while
sign-in rows were correctly named.

**Cause:** `Actor.label` is optional, and the HTTP `Caller` carries the name in
`displayName`. Passing a `Caller` where an `Actor` is expected therefore
typechecks perfectly and silently drops the only field a reader of the log
actually wants.

**Fix:** one function builds the `Actor`, in the application layer, so no
controller can forget the field. Checked against `audit_log` rather than
against the API, since the API happily returned rows either way.

**Lesson:** an optional field on a type that crosses a boundary is a field
that will eventually be absent. When the value matters, make one place
responsible for supplying it.

### Two audit rows for one change

**Symptom:** moving a task wrote both `services.task.moved` and
`services.task.state_changed`, describing the same thing under two names.

**Cause:** the unit of work already turns every recorded domain event into an
audit row. The explicit `context.audit(...)` call in the use case was a second
account of the same change.

**Fix:** removed it. Explicit entries are for what is *not* a domain event —
reading a credential, exporting a file. Where an operation recorded nothing,
the aggregate gained a real event instead, which is better anyway: another
module can act on an event but not on an audit row.

**Lesson:** before writing an audit entry by hand, check whether the aggregate
already says it. Two rows that disagree about the name of one change are worse
than either row alone.

### A module and its controller importing each other

**Symptom:** `ReferenceError: Cannot access 'FILE_STORAGE' before
initialization` at boot. The build was clean.

**Cause:** the injection token was declared in `storage.module.ts`, which
imports its controller, which imports the token back. TypeScript is happy with
a cycle; at runtime the module body runs first and reads a `const` still in its
temporal dead zone.

**Fix:** the token lives alone in `tokens.ts`. It has no dependencies, so
nothing should have to import a module to reach it.

**Lesson:** in a Nest application, tokens and interfaces go in leaf files. A
cycle involving a value — rather than only types — is invisible to the compiler
and fatal at boot.

## The ones only the browser showed

### The stylesheet edit that never landed

**Symptom:** client names rendered as default grey browser buttons, and the
badge tones, fact lists and rows all lost their styling at once.

**Cause:** a block of CSS was being replaced by matching on its existing text,
and the formatter had reflowed that text since it was written. The match found
nothing, so the replacement wrote nothing. No tool reported a failure, because
replacing nothing is not an error.

**Fix:** append the block rather than replace it, then ask the browser whether
the rule exists — the document's stylesheets can be read back, and they are the
only authority on what actually arrived.

**Lesson:** a text replacement that silently matches nothing is the same class
of failure as a `pkill` that matches nothing. Confirm the result, never the
attempt.

### The same grid trap, one level down

**Symptom:** the acceptance run found two screens scrolling sideways on a
phone, months after the identical bug was fixed on `.page`.

**Cause:** `.u-stack` is a grid, and a grid item's automatic minimum size is
its content. Screens that nest a stack inside the page — which most now do,
since a page is a column of cards — hit the same trap one level down. The fix
on `.page` was correct and too specific.

**Fix:** `grid-template-columns: minmax(0, 1fr)` on the utility itself, which
fixes it everywhere the utility is used rather than everywhere somebody
remembers.

**Lesson:** when a layout bug is fixed on one container, ask whether the same
container shape exists as a utility. Fixing the instance leaves the trap armed
for the next person; fixing the utility disarms it.

### The page scrolled sideways instead of the table

**Symptom:** on a phone the clients table was cut off at the edge and the whole
page slid horizontally, even though the table sat in a wrapper with
`overflow-x: auto`.

**Cause:** a grid item's automatic minimum size is its content. The card holding
the table was a grid item of `.page`, so it grew to the table's intrinsic width
and carried the page past the viewport with it. The wrapper then had more room
than the table needed, so it had nothing to scroll and never did.

**Fix:** `grid-template-columns: minmax(0, 1fr)` on `.page`. The same trap has a
flexbox form, where the cure is `min-width: 0` on the child.

**Lesson:** `overflow-x: auto` only scrolls when its container is genuinely
narrower than its content. When a scroll container refuses to scroll, measure
its `clientWidth` against the viewport before touching the overflow property.
The numbers name the guilty ancestor in one call; guessing does not.

### The plus on a phone number moved to the wrong end

**Symptom:** on Arabic screens `+971 50 123 4567` rendered as
`4567 123 50 971+`. A different number, shown on the row somebody reads to
decide who is calling them.

**Cause:** `.u-ltr` set `direction: ltr` and nothing else. On an inline element
that sets the base direction without starting a new bidi run, so a neutral
character at the edge of the span — the `+` — still belongs to the surrounding
Arabic paragraph and is placed at *its* end. The digits were right; the sign
was not.

**Fix:** `unicode-bidi: isolate` alongside `direction: ltr`, on the utility.
The leads board used `.u-ltr` for the same kind of value and had the same bug
unnoticed, so fixing the utility fixed a screen nobody had reported.

**Lesson:** no test in jsdom can see this. jsdom does not do bidi reordering,
so the DOM is correct and the rendering is not, and every assertion passes.
Any screen that mixes Arabic prose with a Latin identifier — a number, a TRN, a
reference, an amount with a currency sign — has to be looked at in a browser in
Arabic, once, before it is called done.

## The ones a real conversation showed

### The bot answered in Arabic and dated it in English

**Symptom:** the deadline reply came out as
`• الإقرار الضريبي — بتاريخ 28 August 2026`.

**Cause:** `DeadlineLine.label` was a `Wording` with both languages and
`dueOn` was a plain `string`. Everything anybody thought of as *words* was
translated; the date was thought of as data.

**Fix:** `dueOn` is a `Wording` too, filled by the adapter with `en-GB` and
`ar-AE` renderings of the same instant.

**Lesson:** in a bilingual message, ask of every part whether it would be
written differently by an Arabic speaker — not whether it is prose. Dates,
number formats and currency all fail that test and none of them look like
strings to translate. The test that guards it asserts the English form is
**absent** from the Arabic message, not merely that the Arabic form is present:
the original bug would have passed the second check.

### An overdue filing announced as though it were upcoming

**Symptom:** on the 21st of September the bot told a client
`• VAT return — due 28 August 2026`.

**Cause:** the deadline reader selected everything not yet completed within the
horizon, which correctly includes what is already late, and nothing carried
whether the date had passed.

**Fix:** an `overdue` flag on the line, and wording that says `was due … 
(overdue)` in both languages.

**Lesson:** true and useless is still a bug when a client reads it. The
practice's own chasing is what this channel exists to support, and a bot that
reports a late filing in the same tone as a future one undercuts it.

## The ones nothing here could run

### The image had drifted six packages behind the workspace

**Symptom:** none, for months. Found by reading the Dockerfile before the first
deploy.

**Cause:** the dependency stage copies each workspace `package.json` by name so
a source change does not reinstall everything. The list was written during P0
and never revisited; by the time WhatsApp landed it named 12 of 18. pnpm reads
the lockfile against the manifests actually present, so the missing ones would
not have made the install smaller — they would have failed it, with an error
about the lockfile rather than about the package.

**Fix:** the full list, and `scripts/dockerfile-manifests.mjs` in `arch:check`
to compare the Dockerfile against the filesystem.

**Lesson:** a hand-maintained list of things that already exist somewhere else
is a list that drifts, and it drifts fastest where nothing runs it. This
machine has no Docker, so no test, no lint and no pipeline ever touched that
file. Anything unverifiable here needs a check that *is* verifiable here.

### The compose file configured four things nothing reads

**Symptom:** would have been the API refusing to boot on the first deploy with
a complaint about storage, beside a compose file that appeared to configure
storage.

**Cause:** `S3_BUCKET` and `S3_REGION` were written from the deployment plan;
the schema calls them `STORAGE_BUCKET` and `STORAGE_REGION` and additionally
insists `STORAGE_DRIVER=s3` in production. `VAULT_KMS_KEY_ID` and
`ANTHROPIC_API_KEY` are read by nothing at all — they belong to phases not yet
built.

**Fix:** the names the code reads, and `.env.production.example` listing every
one with what it costs if left empty.

**Lesson:** environment variables are the one interface with no typechecker on
either side. When you add one, grep for the name in the code before believing
the file that sets it. A near-miss name is worse than a missing one, because
it looks configured.

## The ones a rehearsal on a throwaway server found

The image had never been built by anybody, so before the first real deploy it
was built on a disposable instance in another region. Five failures, in one
afternoon, every one of which would have landed on the production server with
the domain already pointed at it. They are listed in the order they appeared,
because the order is the point: each was hidden behind the one before.

### bootstrap.sh could not clone the repository

**Symptom:** `curl: (22) ... 403` on the very first command.

**Cause:** the script fetched itself from a raw GitLab URL and cloned over
HTTPS. The project is private; both return 401.

**Fix:** the script is copied up with `scp`, and generates an SSH key on the
instance whose public half is added to GitLab as a read-only deploy key. It
stops and prints the key rather than guessing.

**Lesson:** a deploy script cannot fetch itself from the thing it is arranging
access to. Check the first command of a runbook from a machine that has none
of your credentials.

### The image build was killed by the OOM killer

**Symptom:** `exit=137` two thirds of the way through compiling the workspace.

**Cause:** turbo builds every package it can at once. Eighteen `tsc -b`
processes and a Vite build do not fit in the two gigabytes a t3.small has, and
there was no swap.

**Fix:** `TURBO_CONCURRENCY=2` in the Dockerfile and two gigabytes of swap in
`bootstrap.sh`. Peak memory went from "killed" to 781 MB.

**Lesson:** the machine that builds the image is the machine that runs it, and
it is the smallest one in the system. Parallelism tuned on a laptop is a
memory limit somewhere else.

### `pnpm prune` hung the build instead of failing it

**Symptom:** nothing. Twenty minutes of silence at
`RUN pnpm prune --prod`.

**Cause:** pnpm asks "the modules directories will be removed and reinstalled
from scratch, proceed?" and waits. Nothing inside a build can answer.

**Fix:** `CI=true`.

**Lesson:** a hang is worse than a failure, because there is no error to
search for and no exit code to check. Any build step that could prompt needs
to be told it is not talking to a person.

### `pnpm prune --prod` left the store and removed every symlink

**Symptom:** the image built clean, then the migration container died with
`Cannot find package 'postgres'` — for a package sitting in
`node_modules/.pnpm/postgres@3.4.9`, plainly present.

**Cause:** pruning at the root of a workspace prunes the root project. The
packages stay in the virtual store; the symlinks into it from each workspace
package do not. `packages/database/node_modules` was empty.

**Fix:** `pnpm install --prod --frozen-lockfile`, which relinks across the
whole workspace.

**Lesson:** in a pnpm workspace, "is the package there" and "can this file
import it" are different questions. The store answers the first and the
symlink answers the second.

### An empty environment variable is not an unset one

**Symptom:** the worker crash-looped with `NOTIFICATION_FROM: Invalid email`
while `NOTIFICATION_FROM` was, apparently, not set.

**Cause:** compose writes every optional variable as `FOO: ${FOO:-}`, which
puts `FOO=` into the container rather than leaving it out.
`z.string().email().optional()` accepts `undefined` and rejects `''`.

The same cause had a second, silent form: `FIRM_NAME_ARABIC` has a default,
and `z.string().default('...')` accepts `''` as a perfectly good string. The
default never applied, and the only sign was a WhatsApp greeting welcoming
clients to a firm with no name.

**Fix:** `definedOnly` in the kernel, dropping variables that carry nothing
before either schema sees them.

**Lesson:** the loud half of this would have been found in an hour. The silent
half would have gone out over the practice's name to every Arabic-speaking
client. When a variable is optional, test it empty as well as absent — they
are not the same value and only one of them is what compose actually sends.

### A deploy user that could create instances but not terminate them

**Symptom:** the throwaway instance would not tear down.

**Cause:** the scoped policy granted `ec2:RunInstances` and no
`ec2:TerminateInstances`.

**Fix:** lifecycle actions added, limited by condition to instances tagged
`amc*`.

**Lesson:** scope a policy by what the job needs end to end, including the
end. Create without destroy does not fail safe — it leaves something running
that nobody is looking at, on somebody's bill.

## The ones only real money showed

### A client who had paid in full looked like they had overpaid

The profitability report put `invoiced` beside `paid` and subtracted one from
the other. Against the dev database the row read 1,300.00 invoiced, 1,365.00
paid, nothing outstanding.

**Cause:** `invoiced` summed `invoice_lines.amount_minor`, which is net, while
`payments.amount_minor` is what the client actually transferred, which
includes VAT. 1,300.00 at 5 per cent is 1,365.00, so the two columns were
measuring different things and the difference was exactly the VAT.

**Why the tests missed it:** every fixture used `vat_basis_points` of 0, where
net and gross are the same number and the bug cannot appear. Worse, the first
test written for it — an invoice paid in full — still passed against the
broken code, because `Math.max(0, …)` clamps both the right answer and the
wrong one to zero. Only a *partly* paid invoice carrying VAT separates them.

**Fix:** VAT is computed per invoice (rounded once on the invoice's net total,
the way the document itself is drawn up) and the row now names the two figures
apart: `netInvoiced` is what the firm earned, `grossInvoiced` what the client
was asked to pay. Outstanding is gross against gross. The effective hourly
rate stays on the net — VAT is collected for the FTA, and dividing it into
hours credits the practice with money it is only holding.

**Lesson:** two money columns in one row must be on the same basis, and the
names have to say which basis that is. `invoiced` was a true word for either
number, which is why nobody noticed it was being used for both. And a clamp —
`Math.max(0, …)`, `GREATEST(0, …)` — will swallow the evidence of a sign
error; pick the test case where the clamp is not reached.

### Arabic could not count past one

Every counted string in the app — "3 documents need attention", "5 jobs open
without an owner" — rendered in Arabic as its own key: `clients.needsAttention`
printed on the screen where the sentence should be.

**Cause:** Arabic has six plural categories (zero, one, two, few for 3–10, many
for 11–99, other for 100+) and every string had been written with the two
English ones, `_one` and `_other`. i18next does not fall back from a missing
category to `_other`; it returns the key. So `_one` covered exactly the count 1
and `_other` covered 100, 101, … — and every ordinary number in between showed
a key.

**Why nothing caught it:** the key-parity test compared Arabic against English
and both sides had `_one` and `_other`, so the bundles matched perfectly. The
screens were only ever exercised with one document or one message. It surfaced
the first time a fixture happened to hold two of something.

**Fix:** all six forms for all seven strings, and a test that renders every
counted string at ten counts in both languages and fails if the key appears in
its own output. The parity test now compares base names, because English having
two forms and Arabic six is correct, not a mismatch.

**Lesson:** a translation file that looks complete is not evidence, and neither
is a test comparing two bundles that are wrong in the same way. Render the
string. This is also an argument for fixtures with two of something: one is the
number at which a plural bug is invisible.

### Hours could be recorded into a state they could never leave

Statement generation reads `unbilledForClient`, which requires
`approved_at IS NOT NULL`. Nothing in the system could set it.
`TimeEntry.approve()` existed, was tested, and had no caller anywhere outside
its own test file — no route, no use case, no screen.

**What it would have looked like in production:** somebody records a week,
generates a statement, and gets "There are no approved unbilled hours for that
period". Nothing is broken, nothing logs an error, and the reason is a column
nobody can write.

**Cause:** the step sits exactly between two phases. P1 built recording, P2
built billing, and approval belongs to neither — no task in the breakdown owns
it, so it was never anybody's to miss.

**Why nothing caught it:** every test that needed approved time approved it
directly, in the fixture or in the domain. The integration tests inserted
`approved_at` in their SQL. The demo seed did the same. Every layer was proved
against data that had already been through a step the system could not perform.

**Lesson:** a green suite proves the pieces work on data shaped the way the
test shaped it. It says nothing about whether anything can produce that shape.
The acceptance run found this in its second section, because it was the first
thing that had to get from an empty timesheet to an invoice using only what a
real user can reach. That is what an acceptance run is for, and it is why it
has to drive the HTTP API rather than call the use cases.

### Billing writes nothing to the audit log

Every other module's writes land in `audit_log`: `clients.*`, `identity.*`,
`services.*` are all there. There is not one `billing.*` row, and there never
has been. A statement approved, an invoice raised, a payment recorded, a
quotation accepted — none of it is in the trail.

**Cause:** the billing repositories do not take an `EventCollector` at all,
and the composition root builds them bare — `new DrizzleStatementRepository(db)`
with no unit of work around them. The aggregates record their events properly
and `pullEvents()` is called when they are saved, so the events are collected
and then dropped on the floor. Nothing fails, nothing warns, and the domain
tests all pass because they assert on the events the aggregate produced rather
than on where they ended up.

**Why nothing caught it:** every test that checks an event checks it at the
aggregate — `expect(event?.name).toBe('billing.statement.approved')` — which is
true and says nothing about persistence. The integration tests assert on the
billing tables, which are correct. No test reads `audit_log` after a billing
operation, and the P2 acceptance run does not either.

**Found by:** looking for a client's acceptance in the log after building the
client link, and finding no billing rows of any kind.

**Fixed.** The repositories take an `EventCollector` and hand over what the
aggregate recorded; every write in the module runs inside `BillingOperations`,
which is one wrapper rather than a method per operation, so a new operation
cannot be added outside the trail by forgetting to wrap it. The client
answering their own quotation is audited too, with a null `actor_user_id` and
a `client` role, because there is no user and the row should say so.

**What proved it:** three integration tests that read `audit_log` rather than
the billing tables, plus a run against the server — a quotation sent by a
manager and accepted by a client produced four rows naming each of them
correctly. Deleting the `collect` call makes two of the three fail with an
empty trail, which is the symptom the original bug had.

**Lesson:** ADR-0004 is only true where something wires it. "Every write lands
in the audit log" was proved for the phase that built the audit log and assumed
for the three phases after it. An acceptance run should read the trail, not
just the tables — the question is not "did it save" but "can the firm say who
did it".

### A check that passed because it could not find anything

`contrast.mjs` split tokens.css by slicing on the literal
`"@media (prefers-color-scheme: dark)"`. Restructuring the theme removed that
media query. `indexOf` returned -1, `slice(-1)` returned the file's last
character, the "dark" palette parsed as empty, and every lookup fell through
to the light one — so the run measured the same palette twice, printed it
under both headings, and passed.

**Why it looked fine:** the output had a `light` section and a `dark` section
with different-looking numbers, because the "light" slice was now
`slice(0, -1)` — nearly the whole file, including the dark block, whose later
declarations overwrote the earlier ones in the Map. Two sections, plausible
figures, no warning.

**Fix:** find each block by matching its braces, and throw if either selector
is missing or declares nothing. Checked both ways: amber-600 back in place
fails on the ratio, and renaming the dark block makes it refuse to run at all.

**Lesson:** a check that cannot find its input must fail, not continue. The
dangerous version of this is not the one that crashes — it is the one that
quietly measures the wrong thing and reports success, because from then on
the suite is evidence for a claim nobody is testing. Any script that locates
its data by string position needs to assert it found it.

### A valid certificate in front of an empty directory

The first real deploy finished with every container up, all 33 migrations
applied, a healthy API over HTTPS, and `https://app.activemc.ae` answering
**404**. Everything that reports a status reported success.

**Cause:** `web-publish` copies the built browser application into the named
volume Caddy serves. Every other container drops to the unprivileged `amc`
user, and a named volume is created owned by root — so the copy failed with
"permission denied" on every single file and left `/srv` empty. `docker
compose up` runs a one-shot service and carries on regardless of what it
returns, so nothing said a word.

**Why it looked like something else:** a 404 from a correctly configured
reverse proxy reads as a routing fault. The Caddyfile, the certificate and the
API were all checked before anybody looked inside the volume.

**Fixed:** `user: root` on that one service — it writes files and exits,
nothing listens on a port — and bootstrap now runs it explicitly and stops if
it fails, instead of letting `up` swallow the result.

**Lesson:** a one-shot container in a compose file has no supervisor. If its
output matters, run it as its own step and check it. "Every container is up"
and "the deploy worked" are different claims, and only the first one is what
`ps` tells you.

### Caddy does not retry a certificate it has given up on

The server was deployed before its DNS record existed, so the first ACME
attempt failed. Three days later the record was added and resolved correctly
everywhere — and there was still no certificate, with nothing in the log.
Caddy had backed off, and the backoff is hours.

**Fix:** restart it. The certificate issued in about four seconds.

**Lesson:** worth adding the DNS record before the first boot. Where that is
not possible — and it usually is not, since the Elastic IP does not exist
until the instance does — restart Caddy once the name resolves rather than
waiting for a retry that is hours away.

### A test that reported the date

`calendar-page.test.tsx` asserted that pressing "Next" asks the server for
`2026-10`. True in September, when it was written. False on the first of
October, with nothing changed and nobody touching the calendar.

**Cause:** the component derives its starting month from the real clock, and
the test hardcoded where "next" would land.

**Fixed:** `vi.setSystemTime` pins the suite to a fixed day.

**Lesson:** a test that reads the real clock is a test that reports the date.
It passes for a month, fails on a boundary, and the failure arrives attached
to whatever change happened to be in flight — which is how an hour goes into
the wrong diff. Anything asserting on a month, a quarter, a VAT period or an
age wants a frozen clock.

### The database caught what the unit tests could not

"Make a quote" from an enquiry creates the client the quotation belongs to and
marks the lead quoted. Every unit test passed. The first real call returned
500: `leads_converted_is_confirmed`, a check constraint saying a client id may
only exist on a confirmed lead.

**Cause:** `converted_client_id` meant "won the work", written when that was
the only way to get a client. Quoting needs one earlier.

**Why the tests missed it:** they drive in-memory repository doubles, which
hold whatever the aggregate hands them. Constraints live in Postgres, and
nothing in that path touches Postgres.

**Fixed:** the constraint now allows a client on a quoted or confirmed lead
and still refuses one on a new, contacted or declined enquiry. `convertTo`
reuses the client made at quote time rather than onboarding a second — which
was the real bug underneath, and the one that would have put the quotation
against one company and the invoice against another.

**Lesson:** a check constraint is a design review that runs. The in-memory
double is the right tool for aggregate rules and says nothing about the rules
the schema holds, so a use case that writes a new combination of columns
wants one run against a real database before it is believed.

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
- **A timestamp out of raw SQL is a string, not a `Date`.** The driver maps a
  column to a `Date` only when the query builder told it what the column is.
  A row type that claims `Date` over `db.execute(sql\`…\`)` typechecks and then
  throws `getTime is not a function` the first time a real database answers.
  Type those columns as `string` and parse them.
- **`db.execute<T>` refuses an `interface`.** It wants `Record<string, unknown>`,
  and TypeScript gives an implicit index signature to a type alias of an object
  literal but not to an interface. `type Row = { … }`, not `interface Row`.
- **`national` is a reserved word in Postgres.** It expects
  `NATIONAL CHARACTER` after it, so `CREATE FUNCTION f(national text)` reports
  a syntax error against `text` — the word *after* the guilty one.
- **An old server kept answering, again.** A process from a previous session
  was still holding port 3000 with a build that predated the module being
  tested. `ps aux | grep dist/main.js` before believing a 404.
