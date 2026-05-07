'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
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

// Audit F-57 (2026-05-07 r5 PR Sigma): SkillLevel union mirrors the DB
// enum; used by the RiderProfile + UpdateBody interfaces below. PR Rho
// (audit F-30) replaced this page's free-text `onValueChange` with an
// RHF Select bound via `field.onChange`, so the runtime `SKILL_LEVELS`
// tuple + `isSkillLevel` guard Sigma added are no longer needed here.
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

// Audit F-30 (2026-05-07 r5): UI-side form schema for the rider
// profile editor. Replaces the previous 8 separate `useState` calls
// with a single useForm + zodResolver. Inputs are all string-typed
// (HTML form inputs always emit strings); the submit handler converts
// to the server's `UpdateBody` shape (number | null for the numerics,
// `null` for cleared text fields). Keeps the schema-validated contract
// matching the server route at /api/v1/me/profile.
const riderProfileFormSchema = z.object({
  skillLevel: z.enum(['beginner', 'intermediate', 'advanced']),
  dateOfBirth: z.string().max(50),
  weightKg: z
    .string()
    .max(20)
    .refine(
      (v) => v === '' || (Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 500),
      { message: 'Enter a positive weight up to 500 kg' },
    ),
  heightCm: z
    .string()
    .max(20)
    .refine(
      (v) => v === '' || (Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 300),
      { message: 'Enter a positive height up to 300 cm' },
    ),
  emergencyContactName: z.string().max(255),
  emergencyContactPhone: z.string().max(50),
  emergencyContactRelation: z.string().max(100),
  medicalNotes: z.string().max(5000),
});
type RiderProfileFormValues = z.infer<typeof riderProfileFormSchema>;

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

// Audit F-5 (2026-05-07 r5): expanded the profile skeleton to mirror
// the actual two-card layout — Account card (avatar + name + role
// badge) and Riding profile card (header row + 5 info-row placeholders).
function ProfileSkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Skeleton className="h-16 w-16 rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-8 w-16" />
        </CardHeader>
        <CardContent className="space-y-3 divide-y">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-2">
              <Skeleton className="h-4 w-4 rounded" />
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-4 w-32" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export default function RiderProfilePage() {
  const { data: meData, isLoading: meLoading } = useCurrentUser();
  const { data: profileData, isLoading: profileLoading, isError, error, refetch } =
    useRiderProfile();

  const me = meData?.data;
  const profile = profileData?.data ?? null;

  // Audit MED-13 (2026-05-05) + F-64 (2026-05-07 r4): the auto-open
  // effect was popping the editor mid-session whenever `profile`
  // transiently went null on refetch. Replaced — the derived
  // `showEditor` below already covers the visual case (force editor
  // whenever profile is null OR user explicitly clicked Edit).
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

  const form = useForm<RiderProfileFormValues>({
    resolver: zodResolver(riderProfileFormSchema),
    defaultValues: {
      skillLevel: profile?.skillLevel ?? 'beginner',
      dateOfBirth: profile?.dateOfBirth ?? '',
      weightKg: profile?.weightKg ?? '',
      heightCm: profile?.heightCm ?? '',
      emergencyContactName: profile?.emergencyContactName ?? '',
      emergencyContactPhone: profile?.emergencyContactPhone ?? '',
      emergencyContactRelation: profile?.emergencyContactRelation ?? '',
      medicalNotes: profile?.medicalNotes ?? '',
    },
  });

  async function onSave(values: RiderProfileFormValues) {
    const body: UpdateBody = {
      skillLevel: values.skillLevel,
      dateOfBirth: values.dateOfBirth.trim() || null,
      weightKg: values.weightKg ? Number(values.weightKg) : null,
      heightCm: values.heightCm ? Number(values.heightCm) : null,
      emergencyContactName: values.emergencyContactName.trim() || null,
      emergencyContactPhone: values.emergencyContactPhone.trim() || null,
      emergencyContactRelation: values.emergencyContactRelation.trim() || null,
      medicalNotes: values.medicalNotes.trim() || null,
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
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSave)} className="space-y-4">
            <FormField
              control={form.control}
              name="skillLevel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Skill level</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="beginner">Beginner</SelectItem>
                      <SelectItem value="intermediate">Intermediate</SelectItem>
                      <SelectItem value="advanced">Advanced</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="dateOfBirth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date of birth</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="weightKg"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Weight (kg)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        step="0.1"
                        inputMode="decimal"
                        placeholder="e.g. 65"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="heightCm"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Height (cm)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        step="0.1"
                        inputMode="decimal"
                        placeholder="e.g. 170"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="rounded-lg border p-4 space-y-3">
              <p className="text-sm font-medium">Emergency contact</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="emergencyContactName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Parent, spouse, etc." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="emergencyContactPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Phone</FormLabel>
                      <FormControl>
                        <Input
                          type="tel"
                          placeholder="+971 50 123 4567"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="emergencyContactRelation"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel className="text-xs">Relationship</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Mother" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <FormField
              control={form.control}
              name="medicalNotes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Medical notes</FormLabel>
                  <FormDescription>
                    Allergies, medications, injuries, or anything the stable
                    should know. Private — only your stable&apos;s admins and
                    coaches see this.
                  </FormDescription>
                  <FormControl>
                    <Textarea
                      rows={3}
                      placeholder="Optional"
                      maxLength={5000}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2">
              {profile && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onCancel}
                  disabled={update.isPending}
                >
                  Cancel
                </Button>
              )}
              <Button type="submit" disabled={update.isPending}>
                <Check className="mr-2 h-4 w-4" />
                {update.isPending ? 'Saving…' : 'Save profile'}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
