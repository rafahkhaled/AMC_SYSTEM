# Working on the AMC System

Read this before changing anything. It is the short version of what took a
long time to learn here, kept beside the code so it does not have to be learnt
twice.

| File | What is in it |
|---|---|
| [architecture.md](architecture.md) | The layers, the modules, and the rules the linter enforces |
| [conventions.md](conventions.md) | How money, time, errors, tests and names work here |
| [bugs.md](bugs.md) | Every bug found so far, with the symptom and the cause |
| [environment.md](environment.md) | This machine: no Docker, where Postgres lives, how to run things |

## The five rules that matter most

1. **Money is whole fils and time is whole seconds.** No floating point ever
   touches the billing path. One rounding rule, in one function, in the kernel.

2. **Every read that touches a client takes a scope, and it is not optional.**
   A query that forgets to restrict itself cannot be written, because there is
   nothing sensible to pass. Out of scope reads as *not found*, never
   forbidden.

3. **The database enforces what the code believes.** Append-only audit,
   invoiced time frozen by trigger, one timer per person by primary key, one
   task per period by unique index. "The application will not do that" is a
   weaker promise than "it cannot happen".

4. **Everything that repeats carries a natural key.** Period keys on tasks,
   subject-and-stage on alerts, unique keys on jobs. Nothing assumes a sweep
   runs exactly once, because nothing ever does.

5. **Fakes prove logic and nothing else.** Every adapter needs at least one
   test against the real thing. Three of the worst bugs in `bugs.md` passed
   their unit tests comfortably.

## Before you say something works

Run it. The gate is `pnpm verify` — lint, typecheck, every test, and the
dependency rules. Then, for anything with a runtime, actually start it and
exercise it. The recurrence bug, the outbox bug and the day-one trigger bug all
passed their tests and failed the moment a real process ran.

When a test and the database disagree, ask the database directly with `psql`
before changing code. It answers in seconds and it is never wrong about its own
behaviour.
