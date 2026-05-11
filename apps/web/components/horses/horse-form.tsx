'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  createHorseSchema,
  type CreateHorseFormValues,
  type CreateHorseInput,
} from '@equestrian/shared/schemas';
import {
  useCreateHorse,
  useUpdateHorse,
  useTransferHorseOwner,
  type Horse,
} from '@/hooks/use-horses';
import { useOwnerMembers } from '@/hooks/use-staff';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { FileUpload } from '@/components/ui/file-upload';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
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
import { reportMutationError } from '@/components/shared/report-mutation-error';

interface HorseFormProps {
  horse?: Horse;
  onSuccess?: () => void;
}

export function HorseForm({ horse, onSuccess }: HorseFormProps) {
  const router = useRouter();
  const createHorse = useCreateHorse();
  const updateHorse = useUpdateHorse(horse?.id ?? '');
  const transferOwner = useTransferHorseOwner(horse?.id ?? '');
  const { data: ownersData } = useOwnerMembers();
  const isEditing = !!horse;

  const owners = ownersData?.data ?? [];

  const form = useForm<CreateHorseFormValues, unknown, CreateHorseInput>({
    resolver: zodResolver(createHorseSchema),
    defaultValues: horse
      ? {
          name: horse.name,
          barnName: horse.barnName ?? undefined,
          breed: horse.breed ?? undefined,
          gender: horse.gender ?? undefined,
          dateOfBirth: horse.dateOfBirth ?? undefined,
          color: horse.color ?? undefined,
          heightHands: horse.heightHands ? Number(horse.heightHands) : undefined,
          weightKg: horse.weightKg ? Number(horse.weightKg) : undefined,
          markings: horse.markings ?? undefined,
          microchipNumber: horse.microchipNumber ?? undefined,
          passportNumber: horse.passportNumber ?? undefined,
          registrationNumber: horse.registrationNumber ?? undefined,
          status: horse.status,
          skillLevel: horse.skillLevel,
          temperament: horse.temperament ?? undefined,
          weightLimitKg: horse.weightLimitKg ? Number(horse.weightLimitKg) : undefined,
          minRiderAge: horse.minRiderAge ?? undefined,
          maxLessonsPerDay: horse.maxLessonsPerDay,
          mandatoryRestDays: horse.mandatoryRestDays,
          saleStatus: horse.saleStatus,
          primaryPhotoUrl: horse.primaryPhotoUrl ?? undefined,
          ownerMemberId: horse.ownerMemberId ?? undefined,
          notes: horse.notes ?? undefined,
        }
      : {
          name: '',
          status: 'available',
          skillLevel: 'beginner',
          saleStatus: 'not_for_sale',
          maxLessonsPerDay: 3,
          mandatoryRestDays: 1,
        },
  });

  async function onSubmit(data: CreateHorseInput) {
    try {
      if (isEditing && horse) {
        // Owner changes must go through the dedicated transfer endpoint so
        // the new owner is validated and the change is audit-logged — the
        // main update schema deliberately omits `ownerMemberId`.
        const nextOwner = data.ownerMemberId ?? null;
        const ownerChanged = (horse.ownerMemberId ?? null) !== nextOwner;

        const { ownerMemberId: _omit, ...rest } = data;
        await updateHorse.mutateAsync(rest);

        if (ownerChanged) {
          await transferOwner.mutateAsync(nextOwner);
        }
        toast.success('Horse updated successfully');
      } else {
        await createHorse.mutateAsync(data);
        toast.success('Horse added successfully');
      }
      if (onSuccess) {
        onSuccess();
      } else {
        router.push('/horses');
      }
    } catch (error) {
      reportMutationError(isEditing ? 'horse.update' : 'horse.create', error, {
        horseId: horse?.id,
      });
      toast.error(
        error instanceof Error
          ? error.message
          : `Failed to ${isEditing ? 'update' : 'create'} horse`,
      );
    }
  }

  const isPending = isEditing
    ? updateHorse.isPending || transferOwner.isPending
    : createHorse.isPending;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Photo & Ownership */}
        <Card>
          <CardHeader>
            <CardTitle>Photo & Ownership</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="primaryPhotoUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Photo</FormLabel>
                  <FormControl>
                    <FileUpload
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      folder="horses/photos"
                      accept="image/*"
                      preview
                      label="Drop horse photo here or click to browse"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="ownerMemberId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Owner</FormLabel>
                  <Select
                    onValueChange={(v) => field.onChange(v === '__none__' ? undefined : v)}
                    value={field.value ?? '__none__'}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="School Horse (no owner)" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="__none__">School Horse (no owner)</SelectItem>
                      {owners.map((owner) => (
                        <SelectItem key={owner.id} value={owner.id}>
                          {owner.displayName ?? owner.email ?? 'Unnamed Owner'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Basic Info */}
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name *</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Thunder" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="barnName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Barn Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Nickname" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="breed"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Breed</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Arabian" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="gender"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Gender</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ''}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select gender" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="stallion">Stallion</SelectItem>
                      <SelectItem value="mare">Mare</SelectItem>
                      <SelectItem value="gelding">Gelding</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="color"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Color</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Bay" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="dateOfBirth"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date of Birth</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="heightHands"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Height (hands)</FormLabel>
                  <FormControl>
                    <NumberInput step="0.1" placeholder="e.g. 15.2" {...field} />
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
                    <NumberInput placeholder="e.g. 500" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Status & Capabilities */}
        <Card>
          <CardHeader>
            <CardTitle>Status & Capabilities</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="available">Available</SelectItem>
                      <SelectItem value="resting">Resting</SelectItem>
                      <SelectItem value="injured">Injured</SelectItem>
                      <SelectItem value="retired">Retired</SelectItem>
                      <SelectItem value="off_site">Off Site</SelectItem>
                      <SelectItem value="sold">Sold</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="skillLevel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Skill Level</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
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
            <FormField
              control={form.control}
              name="weightLimitKg"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Weight Limit (kg)</FormLabel>
                  <FormControl>
                    <NumberInput placeholder="Max rider weight" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="minRiderAge"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Min Rider Age</FormLabel>
                  <FormControl>
                    <NumberInput placeholder="Minimum age" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="maxLessonsPerDay"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Max Lessons/Day</FormLabel>
                  <FormControl>
                    <NumberInput {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Notes */}
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Textarea
                      placeholder="Any additional notes about this horse..."
                      rows={4}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex gap-3">
          <Button type="submit" disabled={isPending}>
            {isPending
              ? isEditing
                ? 'Saving...'
                : 'Adding...'
              : isEditing
                ? 'Save Changes'
                : 'Add Horse'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => (onSuccess ? onSuccess() : router.push('/horses'))}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Form>
  );
}
