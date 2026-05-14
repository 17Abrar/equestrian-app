// Audit 2026-05-13 (P1): wire up ESLint for the api-client workspace.
// Previously turbo's `lint` task silently skipped this package because
// no `lint` script was defined — runtime types and floating-promise
// checks never ran against client code shared web + mobile.
const baseConfig = require('@equestrian/eslint-config/base');

module.exports = [
  ...baseConfig,
  {
    ignores: ['node_modules/**', 'dist/**', '*.tsbuildinfo'],
  },
];
