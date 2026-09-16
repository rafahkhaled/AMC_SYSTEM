# AMC System

Practice management for Active Management Consultancy, built to SRS v1.2.

**Read [skill/SKILL.md](skill/SKILL.md) before changing anything.** It carries
the architecture, the conventions, and a log of every bug found so far with its
cause, so the same afternoon is not spent twice.

Quick orientation:

- [skill/architecture.md](skill/architecture.md) — layers, modules, enforced rules
- [skill/conventions.md](skill/conventions.md) — money, time, errors, tests
- [skill/bugs.md](skill/bugs.md) — what has already gone wrong and why
- [skill/environment.md](skill/environment.md) — this machine, and what it cannot verify
- [docs/task-breakdown.md](docs/task-breakdown.md) — the 112 tasks and where we are

The gate is `pnpm verify`. Run it before saying anything works, then start the
thing and exercise it: the worst bugs here passed their tests and failed the
moment a real process ran.
