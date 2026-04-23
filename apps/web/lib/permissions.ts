import { type UserRole } from '@equestrian/shared/types';

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

export function assertPermission(role: UserRole, requiredPermission: Permission): void {
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
