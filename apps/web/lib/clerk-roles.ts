import { type UserRole } from '@equestrian/shared/types';

/**
 * Maps Clerk organization roles to application-level roles.
 * Single source of truth — used by both tenant resolution and webhook handling.
 */
export function mapClerkRoleToAppRole(clerkRole: string): UserRole {
  switch (clerkRole) {
    case 'org:admin':
      return 'club_admin';
    case 'org:manager':
      return 'club_manager';
    case 'org:coach':
      return 'coach';
    case 'org:horse_owner':
      return 'horse_owner';
    case 'org:groom':
      return 'groom';
    case 'org:veterinarian':
      return 'veterinarian';
    case 'org:parent':
      return 'parent';
    case 'org:member':
      return 'rider';
    default:
      return 'rider';
  }
}
