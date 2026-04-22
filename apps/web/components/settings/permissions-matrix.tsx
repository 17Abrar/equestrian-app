'use client';

import { Check, X } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

// Mirror of apps/web/lib/permissions.ts — intentionally duplicated here because
// that module pulls in server-only imports. Keep these in sync when editing
// PERMISSIONS.

interface RoleInfo {
  role: string;
  label: string;
  description: string;
  permissions: readonly string[];
}

const ROLES: readonly RoleInfo[] = [
  {
    role: 'club_admin',
    label: 'Club Admin',
    description: 'Owner-level access. Every permission.',
    permissions: ['*'],
  },
  {
    role: 'club_manager',
    label: 'Club Manager',
    description: 'Operates the club day-to-day without changing billing or shutting the club down.',
    permissions: [
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
  },
  {
    role: 'coach',
    label: 'Coach / Instructor',
    description: 'Runs lessons. Can see their schedule and leave rider notes.',
    permissions: [
      'dashboard:read',
      'bookings:read',
      'bookings:update_own',
      'horses:read',
      'riders:read',
      'riders:update_notes',
      'competitions:read',
    ],
  },
  {
    role: 'horse_owner',
    label: 'Horse Owner',
    description: 'Manages their own horses and sees bookings involving them.',
    permissions: [
      'horses:read_own',
      'horses:update_own',
      'horses:delete_own',
      'bookings:read_own',
      'competitions:read',
    ],
  },
  {
    role: 'rider',
    label: 'Rider',
    description: 'Books lessons and manages their own profile.',
    permissions: [
      'bookings:create',
      'bookings:read_own',
      'bookings:cancel_own',
      'profile:*',
      'competitions:read',
      'competitions:register',
    ],
  },
  {
    role: 'parent',
    label: 'Parent / Guardian',
    description: 'Books and pays on behalf of a child rider.',
    permissions: [
      'bookings:create_child',
      'bookings:read_child',
      'bookings:cancel_own',
      'profile:*',
      'payments:*',
      'competitions:read',
      'competitions:register_child',
    ],
  },
  {
    role: 'groom',
    label: 'Groom',
    description: 'Daily horse care. Reads horses, manages care tasks.',
    permissions: [
      'dashboard:read',
      'horses:read',
      'tasks:*',
      'horses:update_care',
    ],
  },
  {
    role: 'veterinarian',
    label: 'Veterinarian',
    description: 'Reads horses and updates medical records.',
    permissions: [
      'horses:read',
      'horses:read_medical',
      'horses:update_medical',
    ],
  },
];

// Capability areas we display as columns. Each maps to one or more permission
// tokens; a role "has" the capability if any listed token resolves.
interface Capability {
  label: string;
  tokens: readonly string[];
}

const CAPABILITIES: readonly Capability[] = [
  { label: 'Bookings', tokens: ['bookings:*', 'bookings:create', 'bookings:create_child'] },
  { label: 'Horses', tokens: ['horses:*', 'horses:read', 'horses:read_own'] },
  { label: 'Riders', tokens: ['riders:*', 'riders:read'] },
  { label: 'Staff', tokens: ['staff:*'] },
  { label: 'Owners', tokens: ['owners:*'] },
  { label: 'Finances', tokens: ['finances:*', 'payments:*'] },
  { label: 'Competitions', tokens: ['competitions:*', 'competitions:read', 'competitions:register', 'competitions:register_child'] },
  { label: 'Emails', tokens: ['emails:*'] },
  { label: 'Reports', tokens: ['reports:*', 'reports:read'] },
  { label: 'Settings', tokens: ['settings:*'] },
];

function hasCapability(role: RoleInfo, cap: Capability): boolean {
  if (role.permissions.includes('*')) return true;
  for (const token of cap.tokens) {
    if (role.permissions.includes(token)) return true;
    // Wildcard match (e.g. "bookings:*" covers "bookings:create")
    const [resource] = token.split(':');
    if (role.permissions.includes(`${resource}:*`)) return true;
  }
  return false;
}

export function PermissionsMatrix() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Role Permissions</CardTitle>
          <CardDescription>
            What each role can access across your club. Roles are assigned in Clerk when you
            invite a staff member or approve a rider. Custom role editing is on the roadmap.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[220px]">Role</TableHead>
                {CAPABILITIES.map((cap) => (
                  <TableHead key={cap.label} className="text-center">{cap.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROLES.map((role) => (
                <TableRow key={role.role}>
                  <TableCell>
                    <div className="space-y-0.5">
                      <p className="font-medium">{role.label}</p>
                      <p className="text-xs text-muted-foreground">{role.description}</p>
                    </div>
                  </TableCell>
                  {CAPABILITIES.map((cap) => (
                    <TableCell key={cap.label} className="text-center">
                      {hasCapability(role, cap) ? (
                        <Check className="mx-auto h-4 w-4 text-green-600" aria-label="allowed" />
                      ) : (
                        <X className="mx-auto h-4 w-4 text-muted-foreground/40" aria-label="not allowed" />
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How roles are assigned</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Staff roles (Manager, Coach, Groom, Veterinarian) are set when you invite someone from
            the <Badge variant="outline">Staff</Badge> page. Horse Owners are added from the{' '}
            <Badge variant="outline">Owners</Badge> page and get automatic access to the horses
            they own. Riders and Parents self-sign-up and receive the default rider/parent role.
          </p>
          <p>
            To change someone&apos;s role, remove and re-invite them from the relevant page. A
            full role-reassignment UI is planned for a later release.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
