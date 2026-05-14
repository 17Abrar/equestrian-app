// Audit 2026-05-13 (P1): wire up ESLint for the db workspace — the
// highest-risk surface for forgotten `await` on Drizzle thenable builders
// (CLAUDE.md known pitfall #1). The carve-out file list at the bottom
// permits the structured-console fallbacks documented in
// `packages/db/src/queries/audit-log.ts` and similar.
const baseConfig = require('@equestrian/eslint-config/base');

module.exports = [
  ...baseConfig,
  {
    files: [
      'src/queries/audit-log.ts',
      'src/queries/payment-accounts.ts',
      'src/queries/horse-health.ts',
    ],
    rules: {
      // CLAUDE.md carve-out: structured console.warn/error in package-side
      // files is intentional — they can't import the app-side logger
      // without creating a circular dep, and the audit-log fallback is the
      // "audit trail of last resort."
      'no-console': 'off',
    },
  },
  {
    ignores: ['node_modules/**', 'dist/**', '*.tsbuildinfo', 'migrations/**'],
  },
];
