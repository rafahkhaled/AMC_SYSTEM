import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

/**
 * Layer enforcement for the AMC modular monolith.
 *
 * Dependency direction is inward only:
 *
 *   http ─┐
 *         ├─> application ─> domain ─> kernel
 *   infra ─┘
 *
 * A violation fails CI. See docs/adr/0002-modular-monolith.md
 */
export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/.turbo/**', '**/node_modules/**'] },
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { boundaries },
    languageOptions: {
      // Parsing only. The boundary rules work on the import graph, so type
      // information is not needed and would drag test files into the build
      // tsconfig just to satisfy the linter.
      parser: tseslint.parser,
    },
    settings: {
      // NodeNext makes source files import './money.js'. Without this resolver
      // the boundary rules cannot see that it means './money.ts'.
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: [
            'packages/*/tsconfig.json',
            'packages/modules/*/tsconfig.json',
            'apps/*/tsconfig.json',
          ],
        },
        node: { extensions: ['.ts', '.tsx', '.js'] },
      },
      'boundaries/include': ['packages/**/*.ts', 'apps/**/*.ts'],
      'boundaries/elements': [
        { type: 'kernel', pattern: 'packages/kernel/**' },
        { type: 'contracts', pattern: 'packages/contracts/**' },
        { type: 'database', pattern: 'packages/database/**' },
        { type: 'queue', pattern: 'packages/queue/**' },
        { type: 'http-kit', pattern: 'packages/http-kit/**' },
        // Built entry points first: @amc/identity/http resolves to
        // packages/modules/identity/dist/http/index.d.ts, and that file must
        // carry the same element type as the source it was built from.
        { type: 'domain', pattern: 'packages/modules/*/dist/domain/**', capture: ['module'] },
        {
          type: 'application',
          pattern: 'packages/modules/*/dist/application/**',
          capture: ['module'],
        },
        {
          type: 'infrastructure',
          pattern: 'packages/modules/*/dist/infrastructure/**',
          capture: ['module'],
        },
        { type: 'http', pattern: 'packages/modules/*/dist/http/**', capture: ['module'] },

        { type: 'domain', pattern: 'packages/modules/*/domain/**', capture: ['module'] },
        { type: 'application', pattern: 'packages/modules/*/application/**', capture: ['module'] },
        {
          type: 'infrastructure',
          pattern: 'packages/modules/*/infrastructure/**',
          capture: ['module'],
        },
        { type: 'http', pattern: 'packages/modules/*/http/**', capture: ['module'] },
        { type: 'app', pattern: 'apps/*/**', capture: ['app'] },
      ],
    },
    rules: {
      'boundaries/no-unknown': 'error',
      'boundaries/no-private': 'off',
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            // The domain is pure. It sees the kernel and itself. Nothing else.
            { from: 'kernel', allow: ['kernel'] },

            // The database package is an adapter concern. It may use the
            // kernel's value objects when mapping rows, and nothing else.
            { from: 'database', allow: ['kernel', 'database'] },

            // The queue is infrastructure over the database, nothing more.
            { from: 'queue', allow: ['kernel', 'database', 'queue'] },

            // Shared HTTP vocabulary: access decorators and the caller shape.
            // It depends on nothing of ours, which is what makes it safe for
            // every module to import without coupling them to each other.
            { from: 'http-kit', allow: ['http-kit'] },
            { from: 'domain', allow: ['kernel', ['domain', { module: '${from.module}' }]] },

            // The application layer orchestrates its own domain through ports.
            // It must never import an adapter.
            {
              from: 'application',
              allow: [
                'kernel',
                'contracts',
                ['domain', { module: '${from.module}' }],
                ['application', { module: '${from.module}' }],
              ],
            },

            // Adapters and controllers depend inward, and may reach another
            // module only through that module's public application facade.
            {
              from: 'infrastructure',
              allow: [
                'kernel',
                'contracts',
                ['domain', { module: '${from.module}' }],
                ['application', { module: '${from.module}' }],
                'application',
                'database',
                'queue',
              ],
            },
            {
              from: 'http',
              allow: [
                'kernel',
                'contracts',
                ['domain', { module: '${from.module}' }],
                ['application', { module: '${from.module}' }],
                'application',
                'http-kit',
              ],
            },

            // Only the entrypoints are allowed to wire adapters to ports.
            {
              from: 'app',
              allow: [
                'kernel',
                'contracts',
                'database',
                'queue',
                'http-kit',
                'domain',
                'application',
                'infrastructure',
                'http',
                'app',
              ],
            },
          ],
        },
      ],
    },
  },
);
