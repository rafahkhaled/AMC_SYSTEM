# Working on this repository

## One task, one branch, one pull request

Tasks come from [docs/task-breakdown.md](docs/task-breakdown.md). Branch names
carry the task identifier:

```
p0-03-kernel-value-objects
p1-20-running-timer
```

Commit subjects carry the requirement they serve, so that at acceptance time a
requirement number leads straight to its code:

```
feat(time): one active timer per staff member (FR-21)
fix(billing): lock entries once invoiced (FR-26)
```

## Definition of done

A pull request is not finished until all of this is true:

- Domain rules covered by unit tests that need no database
- Use cases tested against fake ports
- At least one integration test against a real Postgres
- The screen wired, when the task has a screen
- Audit rows verified for every write
- Arabic and English strings both present
- `pnpm verify` green

## Testing shape

- **Domain tests** are pure and fast. No database, no clock, no network.
- **Use case tests** use fake ports and a `FixedClock`. Set the date and assert.
- **Integration tests** use Testcontainers against real Postgres, one
  transaction per test, rolled back afterwards.
- **Acceptance runs** at the end of each phase follow SRS section 8, with real
  client data.

## Rules that the linter enforces, so do not fight them

- The domain layer imports nothing but the kernel and itself.
- The application layer depends on ports, never on adapters.
- No module imports another module's domain.
- No cycles.

If a rule blocks something you need, that is usually the design talking. Raise
it before adding an exception.
