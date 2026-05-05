// Pure pass-through to the shared monorepo ESLint config. Every rule
// (and ignore pattern, and TypeScript-aware setup) lives in
// `tooling/eslint/nextjs.js` so all packages stay in sync.
//
// To add or override a rule, edit the SHARED config. Adding rules here
// would silently NOT compose with the shared exports — overrides set in
// this file are not merged into the upstream config object. If you need
// a web-app-only rule (rare; usually a sign the rule belongs in the
// shared config anyway), copy the shared module's structure here in full.
//
// See audit F-10 (2026-05-05).
module.exports = require('@equestrian/eslint-config/nextjs');
