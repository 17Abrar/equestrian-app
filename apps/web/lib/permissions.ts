import 'server-only';

// audit P-1 (2026-05-05) — server-side facet of the permissions
// surface. The pure matrix + `hasPermission` live in
// `permissions-shared.ts` (no `'server-only'` guard) so client
// components like the dashboard sidebar can read it for nav gating.
// This module re-exports `hasPermission` so existing server callers
// (api routes, withAuth) keep their import path; the throw-on-miss
// helper and the `PermissionError` class stay here, behind the guard.
//
// Why split: `'server-only'` is a build-time signal that throws if a
// module reaches the client bundle. Adding it to the original file
// would have broken the sidebar; not adding it left the guard
// inconsistent with every sibling in `lib/` (`tenant.ts`, `email.ts`,
// `storage.ts`, `billing/platform-ziina.ts`). Splitting keeps both
// invariants: client code can read the matrix, server-only helpers
// stay protected from accidental client import.

import { type UserRole } from '@equestrian/shared/types';
import { hasPermission } from './permissions-shared';

export { hasPermission };

export function assertPermission(role: UserRole, requiredPermission: string): void {
  if (!hasPermission(role, requiredPermission)) {
    throw new PermissionError(
      `Role '${role}' does not have permission '${requiredPermission}'`,
    );
  }
}

export class PermissionError extends Error {
  public readonly code = 'FORBIDDEN';

  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
  }
}
