const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const eslintConfigPrettier = require('eslint-config-prettier');

/** @type {import("eslint").Linter.Config[]} */
module.exports = [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    // Type-checked rules: `no-floating-promises` and friends require
    // type information (audit H-4). `projectService: true` auto-discovers
    // each package's tsconfig instead of requiring a single hard-coded
    // `project` path. Apply only to TS source files so JS configs aren't
    // forced through the type-aware parser.
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      // CLAUDE.md pitfall #1 (Drizzle thenable builders) is most often
      // a forgotten `await` — the single highest-leverage lint rule.
      '@typescript-eslint/no-floating-promises': 'error',
      // Catches `setTimeout(asyncFn, 100)` etc. where the Promise's
      // failure path is silently swallowed. `checksVoidReturn.attributes:
      // false` keeps the rule from firing on `<Form onSubmit={asyncFn}/>`
      // — React handles async event handlers correctly, so the rule's
      // default false-positive on JSX attributes would force a wrapper
      // for every async submit/click handler.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      // Fires `await` on a non-thenable (no-op) so misuses of plain
      // values don't compile to silent waits.
      '@typescript-eslint/await-thenable': 'error',
    },
  },
  {
    rules: {
      'no-console': 'warn',
      'no-var': 'error',
      'prefer-const': 'error',
      // ESLint v10 promoted `no-useless-assignment` to recommended-as-error
      // (2026-05-25). It flags the legitimate "hoist with safe default"
      // pattern we use to scope a let across an await boundary so the
      // value survives a transaction:
      //
      //   let providerRefundId: string | null = null;
      //   const result = await writeTransaction(async (tx) => {
      //     providerRefundId = …;  // reassigned inside the tx
      //   });
      //   if (providerRefundId) …; // read outside the tx
      //
      // The rule's CFG analysis treats the initial null as dead because the
      // reassignment is unconditional within the tx callback, but the
      // initial value is what we want if the tx skips that branch. Keep
      // the rule off until/unless we get a smarter narrowing — the manual
      // alternative (`let X: T;` without init) regresses to "used before
      // assigned" TS errors in plenty of these spots.
      'no-useless-assignment': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/eslint.config.js'],
    languageOptions: {
      globals: {
        module: 'readonly',
        require: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    ignores: [
      'node_modules/',
      'dist/',
      '.next/',
      '.open-next/',
      '.expo/',
      '.turbo/',
      'coverage/',
      '**/*.config.js',
      '!**/eslint.config.js',
      '**/next-env.d.ts',
      '**/cloudflare-env.d.ts',
    ],
  },
];
