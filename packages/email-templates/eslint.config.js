// Audit 2026-05-13 (P1): wire up ESLint for the email-templates workspace.
// Same rationale as packages/api-client/eslint.config.js — turbo lint
// was silently skipping this package since no `lint` script existed.
const baseConfig = require('@equestrian/eslint-config/base');
const reactPlugin = require('eslint-plugin-react');

module.exports = [
  ...baseConfig,
  {
    files: ['**/*.tsx'],
    plugins: { react: reactPlugin },
    rules: {
      'react/jsx-uses-react': 'off',
      'react/react-in-jsx-scope': 'off',
    },
  },
  {
    ignores: ['node_modules/**', 'dist/**', '*.tsbuildinfo'],
  },
];
