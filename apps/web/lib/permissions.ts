import 'server-only';

// audit P-1 (2026-05-05) — server-side facet of the permissions
// surface. The pure matrix + `hasPermission` live in
// `permissions-shared.ts` (no `'server-only'` guard) so client
// components like the dashboard sidebar can read it for nav gating.
// This module re-exports `hasPermission` so existing server callers
// (api routes, withAuth) keep their import path, behind the guard.
//
// Why split: `'server-only'` is a build-time signal that throws if a
// module reaches the client bundle. Adding it to the original file
// would have broken the sidebar; not adding it left the guard
// inconsistent with every sibling in `lib/` (`tenant.ts`, `email.ts`,
// `storage.ts`, `billing/platform-ziina.ts`). Splitting keeps both
// invariants: client code can read the matrix, server-only helpers
// stay protected from accidental client import.
//
// Audit sweep (2026-06-10): the throw-on-miss `assertPermission`
// helper and its `PermissionError` class were deleted. Repo-wide, no
// route ever adopted them — every caller gates via `hasPermission` +
// an explicit `errorResponse` — which left the `instanceof
// PermissionError` catch arm in `withAuth` permanently unreachable.
// The trio (helper, class, catch arm) went together; if a future
// throw-on-miss pattern is wanted, reintroduce all three at once.

import { hasPermission } from './permissions-shared';

export { hasPermission };
