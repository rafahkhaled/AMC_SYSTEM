# ADR-0003 — Exact money and exact time

- **Status:** accepted
- **Date:** 2026-09-12

## Context
The system turns recorded hours into money a client is asked to pay. A statement
that disagrees with a hand calculation by a single fils is a statement that gets
argued about, and the firm's answer has to be arithmetic, not apology.

## Decision
No floating point anywhere in the billing path.

- **Money** is a whole number of minor units plus a currency code. The dirham
  carries two decimals, so 45000 means AED 450.00. Mixing currencies throws.
- **Duration** is whole seconds.
- **Rate** is Money per hour, and converting time to money happens in exactly
  one method.
- **Rounding is half away from zero**, implemented once, in one function, in the
  kernel. No other file may round.
- Splitting an amount uses the largest remainder method, so the parts always sum
  back to the whole.

Timestamps are stored in UTC. Business rules read Asia/Dubai through the Clock
port, which is what makes a deadline rule testable by setting the date.

## Consequences
The arithmetic is verifiable and the tests read like the accountant's own
worksheet. Values must be constructed through factories rather than written as
numeric literals, which is friction on every line of billing code, and it is
worth it.
