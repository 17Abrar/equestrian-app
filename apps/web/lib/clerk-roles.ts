import { type UserRole } from '@equestrian/shared/types';
import { logger } from './logger';

/**
 * Maps Clerk organization roles to application-level roles.
 * Single source of truth — used by both tenant resolution and webhook handling.
 *
 * Audit pass-7 integration LOW (2026-05-25): log unknown roles at warn
 * level. A typo in the Clerk dashboard (e.g. `org:cohach` instead of
 * `org:coach`) silently assigned rider permissions, leaving the operator
 * with no signal until a coach complained they'd lost their write
 * access. Logging here surfaces the misconfiguration in Sentry so it
 * can be caught at first occurrence.
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
      logger.warn('clerk_role_unknown_fallback_to_rider', {
        clerkRole,
        note: 'Unknown Clerk organization role — check dashboard for typos or unmapped role. Defaulting to rider.',
      });
      return 'rider';
  }
}
