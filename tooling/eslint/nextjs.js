const base = require('./base');
const reactPlugin = require('eslint-plugin-react');
const reactHooksPlugin = require('eslint-plugin-react-hooks');

/** @type {import("eslint").Linter.Config[]} */
module.exports = [
  ...base,
  {
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    rules: {
      ...reactHooksPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  {
    files: [
      '**/app/**/page.tsx',
      '**/app/**/layout.tsx',
      '**/app/**/loading.tsx',
      '**/app/**/error.tsx',
      '**/app/**/not-found.tsx',
      '**/app/**/default.tsx',
      '**/app/**/template.tsx',
      '**/app/**/route.ts',
      'next.config.ts',
      'postcss.config.js',
      'prettier.config.js',
    ],
    rules: {
      'import/no-default-export': 'off',
    },
  },
];
