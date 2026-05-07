'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { reportMutationError } from '@/components/shared/report-mutation-error';
import { ArrowLeft, Rabbit } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FileUpload } from '@/components/ui/file-upload';
import { ErrorState } from '@/components/shared/error-state';
import { EmptyState } from '@/components/shared/empty-state';
import { type ApiSuccessResponse } from '@equestrian/shared/types';
import { STALE_TIME_MEDIUM } from '@equestrian/shared/constants';
import { fetchJson } from '@/lib/fetch-json';

const SKILL_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
type SkillLevel = (typeof SKILL_LEVELS)[number];

interface MyMembership {
  memberId: string;
  clubId: string;
  clubName: string;
  clubSlug: string;
  role: string;
}

interface MyHorsesResponse {
  horses: unknown[];
  memberships: MyMembership[];
}

function useMemberships() {
  return useQuery({
    queryKey: ['me', 'horses'],
    queryFn: () => fetchJson<ApiSuccessResponse<MyHorsesResponse>>('/api/v1/me/horses'),
    staleTime: STALE_TIME_MEDIUM,
  });
}

// Audit LOW-11 (2026-05-05): convert from manual useState bag to RHF+Zod —
// matches the project-wide form pattern (every other rider form uses
// zodResolver), gives inline validation messages instead of a single
// `toast.error('Please enter a name')`, and locks the input contract to
// the `RegisterBody` shape sent to `/api/v1/horses/register-ownership`.
// Numeric coercion happens in the schema (`z.coerce.number().optional()`)
// so the input strings turn into numbers before they reach the mutation —
// the previous code did the cast inline and silently swallowed
// `Number('abc') = NaN`.
const registerHorseSchema = z.object({
  clubId: z.string().uuid({ message: 'Please select a stable' }),
  name: z.string().trim().min(1, 'Please enter a name').max(120),
  breed: z.string().trim().max(120).optional().or(z.literal('')),
  gender: z
    .enum(['gelding', 'mare', 'stallion', 'filly', 'colt'])
    .optional()
    .or(z.literal('')),
  color: z.string().trim().max(60).optional().or(z.literal('')),
  dateOfBirth: z.string().optional().or(z.literal('')),
  heightHands: z
    .union([z.literal(''), z.coerce.number().positive('Height must be positive')])
    .optional(),
  weightKg: z
    .union([z.literal(''), z.coerce.number().positive('Weight must be positive')])
    .optional(),
  skillLevel: z.enum(SKILL_LEVELS),
  primaryPhotoUrl: z.string().optional().or(z.literal('')),
  notes: z.string().max(2000).optional().or(z.literal('')),
});

type RegisterHorseValues = z.infer<typeof registerHorseSchema>;

interface RegisterBody {
  clubId: string;
  name: string;
  breed?: string;
  gender?: string;
  dateOfBirth?: string;
  color?: string;
  heightHands?: number;
  weightKg?: number;
  skillLevel: SkillLevel;
  primaryPhotoUrl?: string;
  notes?: string;
}

function useRegisterHorse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RegisterBody) =>
      fetchJson<ApiSuccessResponse<{ id: string }>>('/api/v1/horses/register-ownership', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me', 'horses'] });
    },
  });
}

export default function RegisterHorsePage() {
  const router = useRouter();
  const register = useRegisterHorse();
  const { data, isLoading, isError, error, refetch } = useMemberships();

  const memberships = useMemo(() => data?.data.memberships ?? [], [data]);

  const form = useForm<RegisterHorseValues>({
    resolver: zodResolver(registerHorseSchema),
    defaultValues: {
      clubId: '',
      name: '',
      breed: '',
      gender: '',
      color: '',
      dateOfBirth: '',
      heightHands: '',
      weightKg: '',
      skillLevel: 'beginner',
      primaryPhotoUrl: '',
      notes: '',
    },
  });

  const watchedClubId = form.watch('clubId');
  const watchedPhoto = form.watch('primaryPhotoUrl');

  // Preselect the only membership when there's exactly one — saves a click on
  // the common case of riders belonging to a single stable.
  useEffect(() => {
    if (!form.getValues('clubId') && memberships.length === 1) {
      form.setValue('clubId', memberships[0]!.clubId);
    }
  }, [memberships, form]);

  async function onSubmit(values: RegisterHorseValues) {
    const body: RegisterBody = {
      clubId: values.clubId,
      name: values.name.trim(),
      breed: values.breed?.trim() || undefined,
      gender: values.gender || undefined,
      dateOfBirth: values.dateOfBirth || undefined,
      color: values.color?.trim() || undefined,
      heightHands:
        typeof values.heightHands === 'number' && Number.isFinite(values.heightHands)
          ? values.heightHands
          : undefined,
      weightKg:
        typeof values.weightKg === 'number' && Number.isFinite(values.weightKg)
          ? values.weightKg
          : undefined,
      skillLevel: values.skillLevel,
      primaryPhotoUrl: values.primaryPhotoUrl || undefined,
      notes: values.notes?.trim() || undefined,
    };

    try {
      await register.mutateAsync(body);
      toast.success('Horse submitted for approval');
      router.push('/rider/horses');
    } catch (err) {
      reportMutationError('rider.horse.register', err);
      toast.error(err instanceof Error ? err.message : 'Failed to register');
    }
  }

  if (isLoading) {
    // Audit F-5 (2026-05-07 r5): mirror the real two-Card form
    // structure (Stable card + Your-horse card with photo + 8 inputs +
    // textarea + actions row).
    return (
      <div className="space-y-6">
        <Skeleton className="h-5 w-40" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-24" />
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-3 w-64" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-32 w-full rounded-md" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-20 w-full" />
            </div>
          </CardContent>
        </Card>
        <div className="flex justify-end gap-2">
          <Skeleton className="h-10 w-20" />
          <Skeleton className="h-10 w-40" />
        </div>
      </div>
    );
  }

  if (isError) {
    return <ErrorState message={error instanceof Error ? error.message : undefined} onRetry={refetch} />;
  }

  if (memberships.length === 0) {
    return (
      <div className="space-y-6">
        <BackLink />
        <EmptyState
          title="Join a stable first"
          description="You need to be a member of a stable before you can register a horse there."
          action={{ label: 'Find a stable', href: '/discover' }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20 sm:pb-0">
      <BackLink />

      <div>
        <h1 className="text-2xl font-bold">Register a horse</h1>
        <p className="text-muted-foreground">
          Your stable will review the details and set a monthly livery fee.
        </p>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Stable</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            <Label htmlFor="club">Stable *</Label>
            <Controller
              control={form.control}
              name="clubId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="club">
                    <SelectValue placeholder="Select a stable" />
                  </SelectTrigger>
                  <SelectContent>
                    {memberships.map((m) => (
                      <SelectItem key={m.clubId} value={m.clubId}>
                        {m.clubName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {form.formState.errors.clubId && (
              <p className="text-xs text-destructive">{form.formState.errors.clubId.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              You can register this horse at any stable you&apos;re a member of.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Your horse</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Photo</Label>
              <FileUpload
                value={watchedPhoto || ''}
                onChange={(url) => form.setValue('primaryPhotoUrl', url)}
                folder="horses/photos"
                accept="image/*"
                maxSizeMB={10}
                preview
                label="Add a photo of your horse"
                // Store under the target stable's R2 prefix — not the rider's
                // active tenant — so the file is organized where the horse
                // actually lives. clubId only valid once the rider picks it.
                targetClubId={watchedClubId || undefined}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="name">Name *</Label>
                <Input id="name" placeholder="e.g. Thunder" {...form.register('name')} />
                {form.formState.errors.name && (
                  <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="breed">Breed</Label>
                <Input id="breed" placeholder="e.g. Arabian" {...form.register('breed')} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="gender">Sex</Label>
                <Controller
                  control={form.control}
                  name="gender"
                  render={({ field }) => (
                    <Select value={field.value || ''} onValueChange={field.onChange}>
                      <SelectTrigger id="gender">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gelding">Gelding</SelectItem>
                        <SelectItem value="mare">Mare</SelectItem>
                        <SelectItem value="stallion">Stallion</SelectItem>
                        <SelectItem value="filly">Filly</SelectItem>
                        <SelectItem value="colt">Colt</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="color">Color</Label>
                <Input id="color" placeholder="e.g. Bay" {...form.register('color')} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="dob">Date of birth</Label>
                <Input id="dob" type="date" {...form.register('dateOfBirth')} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="skill">Skill level needed *</Label>
                <Controller
                  control={form.control}
                  name="skillLevel"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={(v) => field.onChange(v as SkillLevel)}>
                      <SelectTrigger id="skill">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="beginner">Beginner</SelectItem>
                        <SelectItem value="intermediate">Intermediate</SelectItem>
                        <SelectItem value="advanced">Advanced</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  Minimum rider level this horse is suitable for.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="height">Height (hands)</Label>
                <Input
                  id="height"
                  type="number"
                  step="0.1"
                  min="0"
                  inputMode="decimal"
                  placeholder="e.g. 15.2"
                  {...form.register('heightHands')}
                />
                {form.formState.errors.heightHands && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.heightHands.message}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="weight">Weight (kg)</Label>
                <Input
                  id="weight"
                  type="number"
                  step="0.1"
                  min="0"
                  inputMode="decimal"
                  placeholder="e.g. 500"
                  {...form.register('weightKg')}
                />
                {form.formState.errors.weightKg && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.weightKg.message}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">Anything else?</Label>
              <Textarea
                id="notes"
                rows={3}
                placeholder="Optional — temperament, special needs, anything your stable should know."
                maxLength={2000}
                {...form.register('notes')}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" asChild disabled={register.isPending}>
            <Link href="/rider/horses">Cancel</Link>
          </Button>
          <Button type="submit" disabled={register.isPending}>
            <Rabbit className="mr-2 h-4 w-4" />
            {register.isPending ? 'Submitting…' : 'Submit for approval'}
          </Button>
        </div>
      </form>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/rider/horses"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to my horses
    </Link>
  );
}
