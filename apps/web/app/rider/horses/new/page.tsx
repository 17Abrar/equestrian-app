'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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

type SkillLevel = 'beginner' | 'intermediate' | 'advanced';

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
    queryFn: async () => {
      const res = await fetch('/api/v1/me/horses');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          (data as { error?: { message?: string } }).error?.message ??
            'Failed to load memberships',
        );
      }
      return data as ApiSuccessResponse<MyHorsesResponse>;
    },
    staleTime: 60 * 1000,
  });
}

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
    mutationFn: async (body: RegisterBody) => {
      const res = await fetch('/api/v1/horses/register-ownership', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          (data as { error?: { message?: string } }).error?.message ??
            'Failed to register horse',
        );
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me', 'horses'] });
    },
  });
}

export default function RegisterHorsePage() {
  const router = useRouter();
  const register = useRegisterHorse();
  const { data, isLoading, isError, error, refetch } = useMemberships();

  const memberships = useMemo(() => data?.data.memberships ?? [], [data]);

  const [clubId, setClubId] = useState('');
  const [name, setName] = useState('');
  const [breed, setBreed] = useState('');
  const [gender, setGender] = useState('');
  const [color, setColor] = useState('');
  const [dob, setDob] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [skillLevel, setSkillLevel] = useState<SkillLevel>('beginner');
  const [photoUrl, setPhotoUrl] = useState('');
  const [notes, setNotes] = useState('');

  // Preselect the only membership when there's exactly one — saves a click on
  // the common case of riders belonging to a single stable.
  useEffect(() => {
    if (!clubId && memberships.length === 1) {
      setClubId(memberships[0]!.clubId);
    }
  }, [memberships, clubId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!clubId) {
      toast.error('Please select a stable');
      return;
    }
    if (!name.trim()) {
      toast.error('Please enter a name');
      return;
    }

    const body: RegisterBody = {
      clubId,
      name: name.trim(),
      breed: breed.trim() || undefined,
      gender: gender || undefined,
      dateOfBirth: dob || undefined,
      color: color.trim() || undefined,
      heightHands: height ? Number(height) : undefined,
      weightKg: weight ? Number(weight) : undefined,
      skillLevel,
      primaryPhotoUrl: photoUrl || undefined,
      notes: notes.trim() || undefined,
    };

    try {
      await register.mutateAsync(body);
      toast.success('Horse submitted for approval');
      router.push('/rider/horses');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to register');
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-96 w-full rounded-xl" />
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

      <form onSubmit={onSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Stable</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            <Label htmlFor="club">Stable *</Label>
            <Select value={clubId} onValueChange={setClubId}>
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
                value={photoUrl}
                onChange={setPhotoUrl}
                folder="horses/photos"
                accept="image/*"
                maxSizeMB={10}
                preview
                label="Add a photo of your horse"
                // Store under the target stable's R2 prefix — not the rider's
                // active tenant — so the file is organized where the horse
                // actually lives. clubId only valid once the rider picks it.
                targetClubId={clubId || undefined}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Thunder"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="breed">Breed</Label>
                <Input
                  id="breed"
                  value={breed}
                  onChange={(e) => setBreed(e.target.value)}
                  placeholder="e.g. Arabian"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="gender">Sex</Label>
                <Select value={gender} onValueChange={setGender}>
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
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="color">Color</Label>
                <Input
                  id="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="e.g. Bay"
                />
              </div>

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
                <Label htmlFor="skill">Skill level needed *</Label>
                <Select value={skillLevel} onValueChange={(v) => setSkillLevel(v as SkillLevel)}>
                  <SelectTrigger id="skill">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="beginner">Beginner</SelectItem>
                    <SelectItem value="intermediate">Intermediate</SelectItem>
                    <SelectItem value="advanced">Advanced</SelectItem>
                  </SelectContent>
                </Select>
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
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                />
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
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">Anything else?</Label>
              <Textarea
                id="notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional — temperament, special needs, anything your stable should know."
                maxLength={2000}
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
