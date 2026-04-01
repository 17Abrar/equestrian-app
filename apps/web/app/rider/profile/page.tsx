'use client';

import { useQuery } from '@tanstack/react-query';
import { UserButton } from '@clerk/nextjs';
import { User, Shield, Scale, Ruler } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/shared/error-state';
import { SKILL_LEVEL_COLORS } from '@/lib/ui-constants';
import { type ApiSuccessResponse } from '@equestrian/shared/types';
import { useCurrentUser } from '@/hooks/use-current-user';

interface RiderProfile {
  id: string;
  clubId: string;
  memberId: string;
  dateOfBirth: string | null;
  weightKg: string | null;
  heightCm: string | null;
  skillLevel: string;
  totalLessonsCompleted: number;
  parentMemberId: string | null;
  displayName: string | null;
}

function useRiderProfile() {
  return useQuery({
    queryKey: ['me', 'profile'],
    queryFn: async () => {
      const res = await fetch('/api/v1/me/profile');
      const data = await res.json();
      if (!res.ok) {
        throw new Error((data as { error?: { message?: string } }).error?.message ?? 'Failed to fetch profile');
      }
      return data as ApiSuccessResponse<RiderProfile | null>;
    },
    staleTime: 5 * 60 * 1000,
  });
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof User; label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-3 py-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  );
}

export default function RiderProfilePage() {
  const { data: meData, isLoading: meLoading } = useCurrentUser();
  const { data: profileData, isLoading: profileLoading, isError, error, refetch } = useRiderProfile();

  const me = meData?.data;
  const profile = profileData?.data;

  if (meLoading || profileLoading) return <ProfileSkeleton />;
  if (isError) return <ErrorState message={error?.message} onRetry={refetch} />;

  return (
    <div className="space-y-6 pb-20 sm:pb-0">
      <div>
        <h1 className="text-2xl font-bold">Profile</h1>
        <p className="text-muted-foreground">Your account and riding details</p>
      </div>

      {/* Account section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-4">
            <UserButton
              appearance={{
                elements: { userButtonAvatarBox: 'h-16 w-16' },
              }}
            />
            <div>
              <p className="font-medium">{profile?.displayName ?? 'Rider'}</p>
              <Badge variant="secondary" className="mt-1">
                {me?.role ?? 'rider'}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Riding profile */}
      {profile && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Riding Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 divide-y">
            <div className="flex items-center gap-3 py-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Skill Level</p>
                <Badge className={SKILL_LEVEL_COLORS[profile.skillLevel] ?? ''} variant="secondary">
                  {profile.skillLevel}
                </Badge>
              </div>
            </div>
            <InfoRow
              icon={Scale}
              label="Weight"
              value={profile.weightKg ? `${profile.weightKg} kg` : null}
            />
            <InfoRow
              icon={Ruler}
              label="Height"
              value={profile.heightCm ? `${profile.heightCm} cm` : null}
            />
            <InfoRow
              icon={User}
              label="Date of Birth"
              value={profile.dateOfBirth ? new Date(profile.dateOfBirth).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : null}
            />
          </CardContent>
        </Card>
      )}

      {!profile && (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Your riding profile hasn&apos;t been set up yet. Ask your club admin to add your details.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Manage account link */}
      <Card>
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">
            To update your email, password, or connected accounts, click your avatar above to open account settings.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
