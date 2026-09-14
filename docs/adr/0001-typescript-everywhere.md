# ADR-0001 — TypeScript across the whole system

- **Status:** accepted
- **Date:** 2026-09-12

## Context
The AMC System needs a rich browser application: a timer usable on a phone, a
review screen showing an extracted invoice beside its original page, and a
right-to-left Arabic interface. That front end is not optional, so a browser
language is already required. The question was only what runs on the server.

## Decision
TypeScript everywhere. NestJS on Node 22 for the API and the worker, React with
Vite for the browser, and one shared package of Zod schemas that both sides
import, so a change to a contract breaks the build on both sides at once.

## Consequences
One language, one toolchain, one set of testing conventions. A developer moving
between the timer UI and the billing rules carries their knowledge with them.
Types for an endpoint cannot drift from the endpoint.

The cost is that Node is not the strongest platform for CPU-bound work. This
does not bite here: the heavy work is extracting invoices, which is a network
call to an AI provider, and it runs in a background worker.

## Alternatives considered
**C# and .NET** would have been an equally sound choice and is the canonical
home of this architectural style. It lost only because it would mean two
languages for one developer, with the browser half unavoidable.

**Python with Django** was rejected. Its ORM-first design pulls persistence into
the middle of business rules, which is the opposite of what a finance domain
with strict invariants needs.
