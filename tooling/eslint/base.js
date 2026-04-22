const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const eslintConfigPrettier = require('eslint-config-prettier');

/** @type {import("eslint").Linter.Config[]} */
module.exports = [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    rules: {
      'no-console': 'warn',
      'no-var': 'error',
      'prefer-const': 'error',
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
    ignores: [
      'node_modules/',
      'dist/',
      '.next/',
      '.open-next/',
      '.expo/',
      '.turbo/',
      'coverage/',
      '**/*.config.js',
      '**/next-env.d.ts',
      '**/cloudflare-env.d.ts',
    ],
  },
];
