'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserButton } from '@clerk/nextjs';
import { User, Shield, Scale, Ruler, Pencil, Check } from 'lucide-react';
import { toast } from 'sonner';
import { reportMutationError } from '@/components/shared/report-mutation-error';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ErrorState } from '@/components/shared/error-state';
import { SKILL_LEVEL_COLORS } from '@/lib/ui-constants';
import { type ApiSuccessResponse } from '@equestrian/shared/types';
import { STALE_TIME_STABLE } from '@equestrian/shared/constants';
import { useCurrentUser } from '@/hooks/use-current-user';
import { fetchJson } from '@/lib/fetch-json';

type SkillLevel = 'beginner' | 'intermediate' | 'advanced';

interface RiderProfile {
  id: string;
  clubId: string;
  memberId: string;
  dateOfBirth: string | null;
  weightKg: string | null;
  heightCm: string | null;
  skillLevel: SkillLevel;
  totalLessonsCompleted: number;
  parentMemberId: string | null;
  displayName: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelation?: string | null;
  medicalNotes?: string | null;
}

interface UpdateBody {
  skillLevel?: SkillLevel;
  dateOfBirth?: string | null;
  weightKg?: number | null;
  heightCm?: number | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelation?: string | null;
  medicalNotes?: string | null;
}

function useRiderProfile() {
  return useQuery({
    queryKey: ['me', 'profile'],
    queryFn: () => fetchJson<ApiSuccessResponse<RiderProfile | null>>('/api/v1/me/profile'),
    staleTime: STALE_TIME_STABLE,
  });
}

function useUpdateRiderProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateBody) =>
      fetchJson<ApiSuccessResponse<RiderProfile>>('/api/v1/me/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me', 'profile'] });
    },
  });
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
  const { data: profileData, isLoading: profileLoading, isError, error, refetch } =
    useRiderProfile();

  const me = meData?.data;
  const profile = profileData?.data ?? null;

  // Audit MED-13 (2026-05-05): the auto-open effect fired on every
  // refetch where `profile` transiently went null, popping the editor
  // mid-session. Removed — the derived `showEditor` below already
  // covers the visual case (force editor whenever profile is null OR
  // user explicitly clicked Edit).
  const [editing, setEditing] = useState(false);

  if (meLoading || profileLoading) return <ProfileSkeleton />;
  if (isError) return <ErrorState message={error?.message} onRetry={refetch} />;

  const showEditor = editing || !profile;

  return (
    <div className="space-y-6 pb-20 sm:pb-0">
      <div>
        <h1 className="text-2xl font-bold">Profile</h1>
        <p className="text-muted-foreground">Your account and riding details</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-4">
            <UserButton
              appearance={{ elements: { userButtonAvatarBox: 'h-16 w-16' } }}
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

      {showEditor ? (
        <RiderProfileEditor
          profile={profile}
          onCancel={() => {
            if (profile) setEditing(false);
          }}
          onSaved={() => setEditing(false)}
        />
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Riding profile</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="mr-2 h-3.5 w-3.5" />
              Edit
            </Button>
          </CardHeader>
          <CardContent className="space-y-1 divide-y">
            <div className="flex items-center gap-3 py-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Skill level</p>
                <Badge
                  className={SKILL_LEVEL_COLORS[profile.skillLevel] ?? ''}
                  variant="secondary"
                >
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
              label="Date of birth"
              value={
                profile.dateOfBirth
                  ? new Date(profile.dateOfBirth).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })
                  : null
              }
            />
            <InfoRow
              icon={User}
              label="Emergency contact"
              value={
                profile.emergencyContactName
                  ? `${profile.emergencyContactName}${profile.emergencyContactPhone ? ` · ${profile.emergencyContactPhone}` : ''}${profile.emergencyContactRelation ? ` (${profile.emergencyContactRelation})` : ''}`
                  : null
              }
            />
            {profile.medicalNotes && (
              <div className="py-2">
                <p className="text-xs text-muted-foreground">Medical notes</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{profile.medicalNotes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">
            To update your email, password, or connected accounts, click your avatar above to
            open account settings.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof User;
  label: string;
  value: string | null | undefined;
}) {
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

interface EditorProps {
  profile: RiderProfile | null;
  onCancel: () => void;
  onSaved: () => void;
}

function RiderProfileEditor({ profile, onCancel, onSaved }: EditorProps) {
  const update = useUpdateRiderProfile();
  const [skillLevel, setSkillLevel] = useState<SkillLevel>(profile?.skillLevel ?? 'beginner');
  const [dob, setDob] = useState(profile?.dateOfBirth ?? '');
  const [weight, setWeight] = useState(profile?.weightKg ?? '');
  const [height, setHeight] = useState(profile?.heightCm ?? '');
  const [emName, setEmName] = useState(profile?.emergencyContactName ?? '');
  const [emPhone, setEmPhone] = useState(profile?.emergencyContactPhone ?? '');
  const [emRel, setEmRel] = useState(profile?.emergencyContactRelation ?? '');
  const [medical, setMedical] = useState(profile?.medicalNotes ?? '');

  async function onSave() {
    const body: UpdateBody = {
      skillLevel,
      dateOfBirth: dob.trim() || null,
      weightKg: weight ? Number(weight) : null,
      heightCm: height ? Number(height) : null,
      emergencyContactName: emName.trim() || null,
      emergencyContactPhone: emPhone.trim() || null,
      emergencyContactRelation: emRel.trim() || null,
      medicalNotes: medical.trim() || null,
    };

    try {
      await update.mutateAsync(body);
      toast.success('Profile saved');
      onSaved();
    } catch (err) {
      reportMutationError('rider.profile.save', err);
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          {profile ? 'Edit riding profile' : 'Set up your riding profile'}
        </CardTitle>
        {!profile && (
          <p className="mt-1 text-sm text-muted-foreground">
            Your stable uses this to match you to the right horses and handle emergencies.
            You can update it anytime.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>Skill level</Label>
          <Select value={skillLevel} onValueChange={(v) => setSkillLevel(v as SkillLevel)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="beginner">Beginner</SelectItem>
              <SelectItem value="intermediate">Intermediate</SelectItem>
              <SelectItem value="advanced">Advanced</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="dob">Date of birth</Label>
            <Input
              id="dob"
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="weight">Weight (kg)</Label>
            <Input
              id="weight"
              type="number"
              min="0"
              step="0.1"
              inputMode="decimal"
              placeholder="e.g. 65"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="height">Height (cm)</Label>
            <Input
              id="height"
              type="number"
              min="0"
              step="0.1"
              inputMode="decimal"
              placeholder="e.g. 170"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
            />
          </div>
        </div>

        <div className="rounded-lg border p-4">
          <p className="mb-3 text-sm font-medium">Emergency contact</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="em-name" className="text-xs">
                Name
              </Label>
              <Input
                id="em-name"
                value={emName}
                onChange={(e) => setEmName(e.target.value)}
                placeholder="Parent, spouse, etc."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="em-phone" className="text-xs">
                Phone
              </Label>
              <Input
                id="em-phone"
                type="tel"
                value={emPhone}
                onChange={(e) => setEmPhone(e.target.value)}
                placeholder="+971 50 123 4567"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="em-rel" className="text-xs">
                Relationship
              </Label>
              <Input
                id="em-rel"
                value={emRel}
                onChange={(e) => setEmRel(e.target.value)}
                placeholder="e.g. Mother"
              />
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="medical">Medical notes</Label>
          <p className="text-xs text-muted-foreground">
            Allergies, medications, injuries, or anything the stable should know. Private —
            only your stable&apos;s admins and coaches see this.
          </p>
          <Textarea
            id="medical"
            rows={3}
            value={medical}
            onChange={(e) => setMedical(e.target.value)}
            placeholder="Optional"
            maxLength={5000}
          />
        </div>

        <div className="flex justify-end gap-2">
          {profile && (
            <Button variant="ghost" onClick={onCancel} disabled={update.isPending}>
              Cancel
            </Button>
          )}
          <Button onClick={onSave} disabled={update.isPending}>
            <Check className="mr-2 h-4 w-4" />
            {update.isPending ? 'Saving…' : 'Save profile'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
