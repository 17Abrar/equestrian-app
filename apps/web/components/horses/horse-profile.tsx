'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, Edit, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useHorse, useDeleteHorse, type Horse } from '@/hooks/use-horses';
import { type ApiSuccessResponse } from '@equestrian/shared/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { HorseForm } from './horse-form';
import { HealthTab } from './health-tab';
import { FeedingTab } from './feeding-tab';
import { ExerciseTab } from './exercise-tab';
import { DocumentsTab } from './documents-tab';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ErrorState } from '@/components/shared/error-state';

import { HORSE_STATUS_COLORS } from '@/lib/ui-constants';

interface HorseProfileProps {
  horseId: string;
}

function ProfileSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10" />
        <Skeleton className="h-9 w-64" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardContent className="p-6">
            <Skeleton className="mb-4 h-48 w-full rounded-lg" />
            <Skeleton className="mb-2 h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardContent className="p-6">
            <Skeleton className="mb-4 h-10 w-full" />
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

export function HorseProfile({ horseId }: HorseProfileProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const { data, isLoading, isError, error, refetch } = useHorse(horseId);
  const deleteHorse = useDeleteHorse();

  if (isLoading) return <ProfileSkeleton />;
  if (isError) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'Failed to load horse'}
        onRetry={() => refetch()}
      />
    );
  }

  const horse = data && 'data' in data && data.success ? (data as ApiSuccessResponse<Horse>).data : null;
  if (!horse) {
    return <ErrorState message="Horse not found" />;
  }

  async function handleDelete() {
    try {
      await deleteHorse.mutateAsync(horseId);
      toast.success('Horse archived');
      router.push('/horses');
    } catch {
      toast.error('Failed to archive horse');
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild aria-label="Back to horses">
            <Link href="/horses">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{horse.name}</h1>
            {horse.barnName && (
              <p className="text-muted-foreground">&quot;{horse.barnName}&quot;</p>
            )}
          </div>
          <Badge className={HORSE_STATUS_COLORS[horse.status] ?? ''}>
            {horse.status.replace('_', ' ')}
          </Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Edit className="mr-2 h-4 w-4" />
            Edit
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-destructive">
                <Trash2 className="mr-2 h-4 w-4" />
                Archive
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Archive {horse.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will archive the horse profile. All records will be preserved and can be
                  restored within 90 days.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>Archive</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Content */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Sidebar */}
        <Card className="lg:col-span-1">
          <CardContent className="p-6">
            <div className="relative mb-4 flex h-48 items-center justify-center rounded-lg bg-muted overflow-hidden">
              {horse.primaryPhotoUrl ? (
                <Image
                  src={horse.primaryPhotoUrl}
                  alt={horse.name}
                  fill
                  className="rounded-lg object-cover"
                  sizes="(max-width: 1024px) 100vw, 33vw"
                  priority
                />
              ) : (
                <span className="text-6xl">🐴</span>
              )}
            </div>
            <div className="space-y-3">
              <DetailRow label="Breed" value={horse.breed} />
              <DetailRow label="Gender" value={horse.gender} />
              <DetailRow label="Color" value={horse.color} />
              <DetailRow label="Height" value={horse.heightHands ? `${horse.heightHands} hands` : null} />
              <DetailRow label="Weight" value={horse.weightKg ? `${horse.weightKg} kg` : null} />
              <DetailRow label="Skill Level" value={horse.skillLevel} />
              <DetailRow label="Weight Limit" value={horse.weightLimitKg ? `${horse.weightLimitKg} kg` : null} />
              <DetailRow label="Max Lessons/Day" value={horse.maxLessonsPerDay} />
              <DetailRow label="Ownership" value={horse.ownerName ?? 'School Horse'} />
            </div>
          </CardContent>
        </Card>

        {/* Main Content */}
        <div className="lg:col-span-2">
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="health">Health</TabsTrigger>
              <TabsTrigger value="feeding">Feeding</TabsTrigger>
              <TabsTrigger value="exercise">Exercise</TabsTrigger>
              <TabsTrigger value="documents">Documents</TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-4 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Identification</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <DetailRow label="Microchip" value={horse.microchipNumber} />
                  <DetailRow label="Passport" value={horse.passportNumber} />
                  <DetailRow label="Registration" value={horse.registrationNumber} />
                  <DetailRow label="Date of Birth" value={horse.dateOfBirth} />
                  <DetailRow label="Markings" value={horse.markings} />
                </CardContent>
              </Card>

              {(horse.saddleSize || horse.bridleSize || horse.bitType) && (
                <Card>
                  <CardHeader>
                    <CardTitle>Gear Sizing</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-2">
                    <DetailRow label="Saddle Size" value={horse.saddleSize} />
                    <DetailRow label="Girth Size" value={horse.girthSize} />
                    <DetailRow label="Bridle Size" value={horse.bridleSize} />
                    <DetailRow label="Bit Type" value={horse.bitType} />
                    <DetailRow label="Bit Size" value={horse.bitSize} />
                    <DetailRow label="Blanket Size" value={horse.blanketSize} />
                    <DetailRow label="Boots Size" value={horse.bootsSize} />
                    {horse.gearNotes && <DetailRow label="Notes" value={horse.gearNotes} />}
                  </CardContent>
                </Card>
              )}

              {(horse.insuranceProvider || horse.insurancePolicyNumber) && (
                <Card>
                  <CardHeader>
                    <CardTitle>Insurance</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-2">
                    <DetailRow label="Provider" value={horse.insuranceProvider} />
                    <DetailRow label="Policy Number" value={horse.insurancePolicyNumber} />
                    <DetailRow label="Expiry" value={horse.insuranceExpiry} />
                    {horse.insuranceCoverage && (
                      <div className="sm:col-span-2">
                        <DetailRow label="Coverage" value={horse.insuranceCoverage} />
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="health" className="mt-4">
              <HealthTab horseId={horseId} />
            </TabsContent>

            <TabsContent value="feeding" className="mt-4">
              <FeedingTab horseId={horseId} />
            </TabsContent>

            <TabsContent value="exercise" className="mt-4">
              <ExerciseTab horseId={horseId} />
            </TabsContent>

            <TabsContent value="documents" className="mt-4">
              <DocumentsTab horseId={horseId} />
            </TabsContent>

            <TabsContent value="notes" className="mt-4">
              <Card>
                <CardContent className="p-6">
                  {horse.notes ? (
                    <p className="whitespace-pre-wrap">{horse.notes}</p>
                  ) : (
                    <p className="text-muted-foreground">No notes yet</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit {horse.name}</DialogTitle>
          </DialogHeader>
          <HorseForm
            horse={horse}
            onSuccess={() => {
              setEditOpen(false);
              refetch();
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
