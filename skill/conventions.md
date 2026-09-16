# Conventions

## Money and time

Money is a whole number of minor units plus a currency; the dirham carries two
decimals, so 45000 means AED 450.00. Durations are whole seconds. Rates are
money per hour, and converting time to money happens in exactly one method.
Rounding is half away from zero, implemented once, in the kernel. No other file
may round.

Timestamps are stored in UTC. Business rules read `Asia/Dubai` through the
`Clock` port, which is what makes a deadline testable by setting the date.
Timesheets group by the Dubai day, because a person's Tuesday is their Tuesday.

## Failures

Expected failures are values, returned in a `Result`. Exceptions are bugs. A
`DomainError` carries a code that the HTTP layer maps to a status without
catching anything.

Refusals say what was refused and why, and carry the detail a caller needs:
which documents are missing, which statement holds the entry, which dates
clashed.

## Security wording

A wrong password and an unknown address answer identically, in the same words,
in the API and in the browser. Out-of-scope reads return *not found*, never
*forbidden*. A permission failure never names the missing permission. All three
exist so that the system cannot be used to enumerate what it holds.

## Tests

- **Domain tests** are pure and fast. No database, no clock, no network.
- **Use-case tests** use fake ports and a fixed clock. Set the date and assert.
- **Integration tests** run against real Postgres, one transaction per test,
  rolled back. Use `createTestDatabase()` from `@amc/database/testing`.
- **Never assert on global counts.** Packages share one test database and run
  in parallel.
- **Every adapter needs at least one test against the real thing.**

Name the behaviour, not the method: "refuses to start while mandatory documents
are missing", not "start() returns error".

## Comments

Explain why, not what. The comments worth keeping are the ones that say what
would go wrong otherwise: why the default is billable, why expiry is computed
rather than stored, why the lock comes before the create.

## Dates in raw SQL

Drizzle's `sql` template hands parameters straight to the driver, and the
driver refuses a `Date`. Use `at(date)` for a timestamp and `on(date)` for a
calendar day, both from the kernel, and always cast at the other end:

```ts
sql`WHERE run_at <= ${at(now)}::timestamptz`
sql`WHERE expires_on < ${on(today)}::date`
```

The query builder converts dates on its own; only hand-written templates need
this. It has cost three afternoons, which is why the helper is in the kernel
rather than rewritten beside each query.
