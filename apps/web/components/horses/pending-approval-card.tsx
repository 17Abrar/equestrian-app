'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Check, X, Rabbit } from 'lucide-react';
import { formatDate } from '@equestrian/shared/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  useApproveHorseOwnership,
  useDeclineHorseOwnership,
  type HorseListItem,
} from '@/hooks/use-horses';
import { reportMutationError } from '@/components/shared/report-mutation-error';

// Audit F-30 (2026-05-07 r5): UI-side schema for the Approve dialog.
// The shared `approveHorseOwnershipSchema` expects `monthlyLiveryFeeMinor`
// (server contract = minor units). The dialog inputs major units (AED)
// for human-readability, so the form schema validates that input shape
// and the submit handler converts to minor units before calling the
// mutation. Inline `text-xs text-destructive` errors replace the
// `toast.error('Enter a valid fee')` pattern per CLAUDE.md "Show
// validation errors inline (below the field, in red)."
const approveFormSchema = z.object({
  feeMajorUnits: z
    .union([z.literal(''), z.coerce.number().min(0, 'Enter a valid fee (0 or more)')])
    .refine((v) => v !== '', { message: 'Enter a fee (0 or more)' }),
  liveryStartDate: z.string().min(1, 'Pick a start date').max(50),
});
type ApproveFormValues = z.input<typeof approveFormSchema>;
type ApproveFormOutput = z.output<typeof approveFormSchema>;

const declineFormSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, 'Please add a reason — the owner will see this')
    .max(1000, 'Reason can be at most 1000 characters'),
});
type DeclineFormValues = z.infer<typeof declineFormSchema>;

interface PendingApprovalCardProps {
  horse: HorseListItem;
}

export function PendingApprovalCard({ horse }: PendingApprovalCardProps) {
  const [approveOpen, setApproveOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);

  return (
    <>
      <Card>
        <CardContent className="flex gap-4 p-4">
          <div className="bg-muted relative h-24 w-24 shrink-0 overflow-hidden rounded-lg">
            {horse.primaryPhotoUrl ? (
              <Image
                src={horse.primaryPhotoUrl}
                alt={horse.name}
                fill
                className="object-cover"
                sizes="96px"
              />
            ) : (
              <div className="text-muted-foreground flex h-full w-full items-center justify-center">
                <Rabbit className="h-10 w-10" />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">{horse.name}</h3>
                <p className="text-muted-foreground text-sm">
                  {[horse.breed, horse.color, horse.gender].filter(Boolean).join(' · ') ||
                    'No details'}
                </p>
                {horse.ownerName && (
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    Submitted by{' '}
                    <span className="text-foreground font-medium">{horse.ownerName}</span>
                  </p>
                )}
              </div>
              <Badge variant="secondary" className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                Pending
              </Badge>
            </div>

            <div className="text-muted-foreground mt-2 flex flex-wrap gap-2 text-xs">
              <Badge variant="outline" className="text-xs">
                {horse.skillLevel}
              </Badge>
              {horse.heightHands && (
                <Badge variant="outline" className="text-xs">
                  {horse.heightHands} hh
                </Badge>
              )}
              {horse.weightKg && (
                <Badge variant="outline" className="text-xs">
                  {horse.weightKg} kg
                </Badge>
              )}
              {horse.ownershipSubmittedAt && (
                <span className="text-xs">Submitted {formatDate(horse.ownershipSubmittedAt)}</span>
              )}
            </div>

            {horse.notes && (
              <p className="bg-muted text-muted-foreground mt-2 whitespace-pre-wrap rounded-md p-2 text-xs">
                {horse.notes}
              </p>
            )}

            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={() => setApproveOpen(true)}>
                <Check className="mr-1.5 h-3.5 w-3.5" />
                Approve
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDeclineOpen(true)}>
                <X className="mr-1.5 h-3.5 w-3.5" />
                Decline
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <ApproveDialog horse={horse} open={approveOpen} onOpenChange={setApproveOpen} />
      <DeclineDialog horse={horse} open={declineOpen} onOpenChange={setDeclineOpen} />
    </>
  );
}

interface DialogProps {
  horse: HorseListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function ApproveDialog({ horse, open, onOpenChange }: DialogProps) {
  const approve = useApproveHorseOwnership(horse.id);

  // Default start date = today in the admin's local TZ. ISO YYYY-MM-DD.
  const form = useForm<ApproveFormValues, unknown, ApproveFormOutput>({
    resolver: zodResolver(approveFormSchema),
    defaultValues: {
      feeMajorUnits: '',
      liveryStartDate: new Date().toISOString().slice(0, 10),
    },
  });

  async function onSubmit(values: ApproveFormOutput) {
    // `feeMajorUnits` is `number | ''` post-resolver; the refine above
    // ensures non-empty, so the cast is safe at this point.
    const feeNumber =
      typeof values.feeMajorUnits === 'number'
        ? values.feeMajorUnits
        : Number(values.feeMajorUnits);
    try {
      await approve.mutateAsync({
        // User enters AED major units; DB stores minor units (fils).
        monthlyLiveryFeeMinor: Math.round(feeNumber * 100),
        liveryStartDate: values.liveryStartDate,
      });
      toast.success(`${horse.name} approved`);
      onOpenChange(false);
      form.reset();
    } catch (err) {
      reportMutationError('horse_ownership.approve', err, { horseId: horse.id });
      toast.error(err instanceof Error ? err.message : 'Failed to approve');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Approve {horse.name}</DialogTitle>
          <DialogDescription>
            Set the monthly livery fee and the date billing starts.
            {horse.ownerName && ` ${horse.ownerName} will be notified by email.`}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="feeMajorUnits"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Monthly livery fee</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      placeholder="e.g. 2500"
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormDescription>
                    Enter 0 if you&apos;re housing the horse gratis or billing off-platform.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="liveryStartDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Livery starts</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={approve.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={approve.isPending}>
                {approve.isPending ? 'Approving…' : 'Approve'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function DeclineDialog({ horse, open, onOpenChange }: DialogProps) {
  const decline = useDeclineHorseOwnership(horse.id);
  const form = useForm<DeclineFormValues>({
    resolver: zodResolver(declineFormSchema),
    defaultValues: { reason: '' },
  });
  const reasonValue = form.watch('reason') ?? '';

  async function onSubmit(values: DeclineFormValues) {
    try {
      await decline.mutateAsync(values.reason);
      toast.success(`${horse.name} declined`);
      onOpenChange(false);
      form.reset();
    } catch (err) {
      reportMutationError('horse_ownership.decline', err, { horseId: horse.id });
      toast.error(err instanceof Error ? err.message : 'Failed to decline');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Decline {horse.name}</DialogTitle>
          <DialogDescription>
            The owner will receive an email with this reason. Be specific — it helps them understand
            what, if anything, they can change.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={5}
                      placeholder="e.g. We're at capacity this season but can revisit in 2 months. Please resubmit then."
                      maxLength={1000}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>{reasonValue.length} / 1000</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={decline.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={decline.isPending}>
                {decline.isPending ? 'Declining…' : 'Decline'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
