/**
 * Second line of defence behind eslint-plugin-boundaries: catches framework
 * leakage into the domain, which is the failure mode that quietly ruins a
 * hexagonal codebase. See docs/adr/0002-modular-monolith.md
 */
module.exports = {
  forbidden: [
    {
      name: 'domain-stays-pure',
      comment:
        'A domain layer must not import a framework, a database client, or anything from Node. ' +
        'If a domain rule needs the outside world, express it as a port in the application layer.',
      severity: 'error',
      from: { path: 'packages/modules/[^/]+/domain' },
      to: {
        path: [
          '^node:',
          'node_modules/@nestjs',
          'node_modules/drizzle-orm',
          'node_modules/pg',
          'node_modules/bullmq',
          'node_modules/ioredis',
          'node_modules/@aws-sdk',
          'node_modules/react',
        ],
      },
    },
    {
      name: 'no-database-above-infrastructure',
      comment:
        'Domain and application layers must not know that a database exists. Persistence is a ' +
        'port they declare and infrastructure implements.',
      severity: 'error',
      from: { path: 'packages/modules/[^/]+/(domain|application)' },
      to: { path: '(packages/database|node_modules/(drizzle-orm|postgres))' },
    },
    {
      name: 'application-depends-on-ports-not-adapters',
      comment: 'Use cases depend on interfaces. Adapters are wired by the app entrypoint.',
      severity: 'error',
      from: { path: 'packages/modules/[^/]+/application' },
      to: { path: 'packages/modules/[^/]+/infrastructure' },
    },
    {
      name: 'no-cross-module-domain-access',
      comment:
        "A module never reaches into another module's domain. Cross-module needs go through " +
        'the public application facade or a domain event on the outbox.',
      severity: 'error',
      from: { path: 'packages/modules/([^/]+)/' },
      to: { path: 'packages/modules/(?!$1)[^/]+/domain' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      from: { orphan: true, pathNot: ['\\.d\\.ts$', '(^|/)(eslint|vitest|drizzle)\\.config\\.'] },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    // Build output is not source. Cruising it produces orphan warnings about
    // compiled files that say nothing about the architecture.
    exclude: { path: '(/dist/|\\.(test|spec)\\.ts$)' },
  },
};
