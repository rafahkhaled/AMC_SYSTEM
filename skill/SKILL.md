---
name: amc-system
description: How to work on the AMC System, a practice management application for a UAE accounting firm. Read this before changing anything in this repository. Covers the layered architecture and the rules the linter enforces, the conventions for money, time, scoping and errors, a log of every bug found so far with its cause, and what this machine can and cannot verify. Use when adding a feature, fixing a bug, changing the schema, or reviewing a change here.
---

# Working on the AMC System

The short version of what took a long time to learn here, kept beside the code
so it does not have to be learnt twice.

| File | What is in it |
|---|---|
| [architecture.md](architecture.md) | The layers, the modules, the HTTP surface, and the rules the linter enforces |
| [conventions.md](conventions.md) | How money, time, scoping, errors, tests and names work here |
| [bugs.md](bugs.md) | Every bug found so far, with the symptom, the cause and the lesson |
| [environment.md](environment.md) | This machine: no Docker, where Postgres lives, how to run things, what cannot be checked |

## How to work here

**Read before writing.** `bugs.md` in particular. Several entries there are
traps that are invisible until you hit them, and two of them have been hit
twice because the first fix was too specific.

**Change the smallest thing that can be true.** A rule belongs in one place. If
you find yourself writing the same check twice, that is the signal to move it,
not to write it carefully. Four copies of the caller shape and three of the
scoping predicate are in the git history for exactly this reason.

**Put the rule where it cannot be skipped.** A scope derived inside a
repository cannot be forgotten by a caller. An audit row written inside the
vault cannot be omitted by whoever reads a password. A constraint in the
database holds whatever the application believes.

**Then prove it three ways, in this order:**

1. `pnpm verify` — lint, typecheck, every test, and the dependency rules.
2. Start the thing and exercise it. The recurrence bug, the outbox bug, the
   day-one trigger bug and both WhatsApp wording bugs all passed their tests
   and failed the moment a real process ran. If the change has a screen and
   any Arabic on it, that includes opening it in a browser in Arabic — jsdom
   does not reorder bidirectional text, so no test there can see it.
3. For anything that matters, break it on purpose and check the test fails.
   A test that passes both ways is not testing anything.

**When a test and the database disagree, ask the database.** `psql` answers in
seconds and is never wrong about its own behaviour. Four guesses were wasted
before that was tried once.

**Write the bug down.** Symptom, cause, fix, and the lesson in one sentence.
If the same shape could exist elsewhere, search for it in the same breath.

**If the fix could live on a utility, put it there.** Twice now a layout bug
has been fixed on the one screen that showed it and found again months later
on a screen that used the same utility. The phone-number bidi bug was fixed on
`.u-ltr` and that repaired the leads board, which nobody had reported.

## The five rules that matter most

1. **Money is whole fils and time is whole seconds.** No floating point ever
   touches the billing path. One rounding rule, in one function, in the kernel.

2. **Every read that touches a client takes a scope, and it is not optional.**
   A query that forgets to restrict itself cannot be written, because there is
   nothing sensible to pass. Out of scope reads as *not found*, never
   forbidden. The predicate is defined once, in `@amc/database`.

3. **The database enforces what the code believes.** Append-only audit,
   invoiced time frozen by trigger, one timer per person by primary key, one
   task per period by unique index. "The application will not do that" is a
   weaker promise than "it cannot happen".

4. **Everything that repeats carries a natural key.** Period keys on tasks,
   subject-and-stage on alerts, unique keys on jobs, one notification per
   person per thing. Nothing assumes a sweep runs exactly once, because
   nothing ever does.

5. **Fakes prove logic and nothing else.** Every adapter needs at least one
   test against the real thing. Three of the worst bugs in `bugs.md` passed
   their unit tests comfortably.

6. **Both languages, including the parts that are not words.** Dates, numbers
   and currency read differently in Arabic and none of them look like strings
   to translate. A bilingual message is not done until a test asserts the
   English form is *absent* from the Arabic one — asserting the Arabic form is
   present passes even when both are there.

## The commands

```bash
pnpm verify                      # the gate: lint, typecheck, tests, dependency rules
./scripts/dev.sh                 # Postgres, migrations, API, worker, web
node scripts/acceptance-p1.mjs   # walks the whole Phase 1 journey against a running API
node scripts/schema-audit.mjs    # asks the database what is wrong with itself
WHATSAPP_DRIVER=log              # default: the bot runs in full, into the log
./scripts/mirror-push.sh         # pushes to every remote, non-zero if any failed
```

## What "done" means for a task

Taken from `docs/task-breakdown.md`, unchanged since the first phase:

domain tests, use-case tests against fake ports, at least one integration test
on a real Postgres, UI wired where the task has a screen, audit rows verified,
Arabic and English strings present, CI green.

Add to that: anything you could not verify goes in `environment.md` rather than
being assumed.
