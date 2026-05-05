import { type UserRole } from '@equestrian/shared/types';

// audit P-1 (2026-05-05) — pure permission matrix + check function. No
// `import 'server-only'` here so client components (sidebar nav gating,
// inline action visibility, etc.) can read it safely. The matrix itself
// isn't a secret — the same data is on the server, and the server is
// the source of truth for authorisation. This module exists so the
// stricter `permissions.ts` (server-only, with audit hooks + the
// PermissionError class) can keep its `import 'server-only'` guard
// without breaking client callers.
//
// If you add a new permission string, add it ONLY here. The server
// module re-exports `hasPermission` so existing server imports keep
// resolving without a churn pass through every API route.

type Permission = string;

const PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  club_admin: ['*'],
  club_manager: [
    'dashboard:read',
    'bookings:*',
    'horses:*',
    'riders:*',
    'staff:*',
    'owners:*',
    'finances:*',
    'emails:*',
    'arenas:*',
    'coupons:*',
    'packages:*',
    'competitions:*',
    'reports:read',
    'settings:*',
  ],
  coach: [
    'dashboard:read',
    'bookings:read',
    'bookings:update_own',
    'horses:read',
    'riders:read',
    'riders:update_notes',
    'competitions:read',
  ],
  horse_owner: [
    'horses:read_own',
    'horses:update_own',
    'horses:delete_own',
    'horses:register_own',
    'bookings:read_own',
    'competitions:read',
  ],
  rider: [
    'bookings:create',
    'bookings:read_own',
    'bookings:cancel_own',
    'profile:*',
    'competitions:read',
    'competitions:register',
    // Round 8 — riders can register horses they own and manage those rows.
    // The `_own` suffix means the resolver inside the handler must still
    // check `owner_member_id == ctx.memberId`; the permission only gates entry.
    'horses:register_own',
    'horses:read_own',
    'horses:update_own',
  ],
  parent: ['bookings:create_child', 'bookings:read_child', 'bookings:cancel_own', 'profile:*', 'payments:*', 'competitions:read', 'competitions:register_child'],
  groom: ['dashboard:read', 'horses:read', 'tasks:*', 'horses:update_care'],
  veterinarian: ['horses:read', 'horses:read_medical', 'horses:update_medical'],
};

export function hasPermission(role: UserRole, requiredPermission: Permission): boolean {
  const rolePermissions = PERMISSIONS[role];

  if (!rolePermissions) {
    return false;
  }

  // Admin has all permissions
  if (rolePermissions.includes('*')) {
    return true;
  }

  // Exact match
  if (rolePermissions.includes(requiredPermission)) {
    return true;
  }

  // Wildcard match (e.g., 'bookings:*' matches 'bookings:create')
  const [resource] = requiredPermission.split(':');
  if (rolePermissions.includes(`${resource}:*`)) {
    return true;
  }

  return false;
}
