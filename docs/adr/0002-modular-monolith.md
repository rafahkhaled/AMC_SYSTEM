# ADR-0002 — A modular monolith with hexagonal modules

- **Status:** accepted
- **Date:** 2026-09-12

## Context
Ten internal users and five hundred clients (NFR-09). Thirteen clearly separable
business areas. One developer. The temptation in 2026 is to reach for services;
the reality is that distributed transactions across billing and time tracking
would cost more than the entire system is worth.

## Decision
One deployable unit, running as two processes: the HTTP API and the background
worker, both assembled from the same modules. Each module is internally
hexagonal, with four layers:

    http ─┐
          ├─> application ─> domain ─> kernel
    infra ─┘

The domain layer is pure TypeScript and imports no framework, no database
client, and nothing from Node. The application layer holds use cases and
declares ports. Adapters live in infrastructure and are wired only by the app
entrypoints.

Modules never import each other's domain and never read each other's tables.
They talk through a published application facade, or through domain events
written to an outbox inside the same transaction as the change.

## Consequences
Business rules are testable in milliseconds with no database. Swapping the AI
provider, the messaging channel or the accounting system is one adapter. If the
firm ever outgrows one process, a module lifts out along its existing seam,
because the seam is already real.

The cost is ceremony: a use case that could have been four lines in a controller
is a class, an interface and a mapper. That is the price of being able to change
one thing without discovering what else it broke.

## Consequences that are enforced, not hoped for
Layer rules are checked by eslint-plugin-boundaries and dependency-cruiser, and
CI fails on a violation. An architecture document nobody can violate is an
architecture; one that depends on discipline is a wish.
