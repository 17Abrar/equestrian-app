// Audit 2026-05-13 (P1): wire up ESLint for the shared workspace so
// `no-floating-promises` and the rest of the base rule set run against
// validators, utils, and schema files. Previously turbo lint silently
// skipped this package because no `lint` script was defined.
const baseConfig = require('@equestrian/eslint-config/base');

module.exports = [
  ...baseConfig,
  {
    ignores: ['node_modules/**', 'dist/**', '*.tsbuildinfo'],
  },
];
