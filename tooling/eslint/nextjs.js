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
  // Audit F-63 (2026-05-07 r5). `parseRequiredBody` /
  // `parseOptionalBody` in `apps/web/lib/api-utils.ts` combine the
  // Content-Length cap, post-text recheck (defense against an
  // attacker-controlled Content-Length header), malformed-JSON →
  // INVALID_JSON 400 mapping, and Zod parse in one helper. ~50 of the
  // ~80 mutating routes still use raw `await request.json()`, which
  // skips the post-text recheck and surfaces SyntaxError as
  // INTERNAL_ERROR 500 instead of 400. Migrating all 50+ in one PR is
  // high blast radius — every route's error envelope shifts in
  // lockstep — so this rule lands as `warn` rather than `error`. Each
  // unmigrated route surfaces in `pnpm lint` output as a visible
  // reminder that new contributors will see when touching the file
  // (and code-review can require migration on touch). To migrate an
  // existing route: replace
  //   `const body = await request.json(); const data =
  //   validateInput(schema, body);`
  // with
  //   `const data = await parseRequiredBody(request, schema);`
  // The helper handles 413/400 for you. PR Chi (2026-05-07 r5)
  // migrated 8 of the highest-traffic routes as a starter set:
  // bookings/[bookingId], horses/[horseId], me/profile, upload,
  // staff, owners, riders (list+detail), arenas.
  {
    files: ['**/app/api/v1/**/route.ts'],
    rules: {
      'no-restricted-syntax': [
        'warn',
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.object.name='request'][callee.property.name='json']",
          message:
            'Use `parseRequiredBody(request, schema)` (or `parseOptionalBody`) from `@/lib/api-utils` instead of `request.json()`. See audit F-63 (2026-05-07 r5) for rationale.',
        },
      ],
    },
  },
];
