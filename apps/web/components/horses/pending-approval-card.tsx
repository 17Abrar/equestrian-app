'use client';

import { useState } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import { Check, X, Rabbit } from 'lucide-react';
import { formatDate } from '@equestrian/shared/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  useApproveHorseOwnership,
  useDeclineHorseOwnership,
  type Horse,
} from '@/hooks/use-horses';
import { reportMutationError } from '@/components/shared/report-mutation-error';

interface PendingApprovalCardProps {
  horse: Horse;
}

export function PendingApprovalCard({ horse }: PendingApprovalCardProps) {
  const [approveOpen, setApproveOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);

  return (
    <>
      <Card>
        <CardContent className="flex gap-4 p-4">
          <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-muted">
            {horse.primaryPhotoUrl ? (
              <Image
                src={horse.primaryPhotoUrl}
                alt={horse.name}
                fill
                className="object-cover"
                sizes="96px"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                <Rabbit className="h-10 w-10" />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">{horse.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {[horse.breed, horse.color, horse.gender].filter(Boolean).join(' · ') ||
                    'No details'}
                </p>
                {horse.ownerName && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Submitted by{' '}
                    <span className="font-medium text-foreground">{horse.ownerName}</span>
                  </p>
                )}
              </div>
              <Badge
                variant="secondary"
                className="bg-amber-100 text-amber-800 hover:bg-amber-100"
              >
                Pending
              </Badge>
            </div>

            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
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
                <span className="text-xs">
                  Submitted{' '}
                  {formatDate(horse.ownershipSubmittedAt)}
                </span>
              )}
            </div>

            {horse.notes && (
              <p className="mt-2 rounded-md bg-muted p-2 text-xs text-muted-foreground whitespace-pre-wrap">
                {horse.notes}
              </p>
            )}

            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={() => setApproveOpen(true)}>
                <Check className="mr-1.5 h-3.5 w-3.5" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDeclineOpen(true)}
              >
                <X className="mr-1.5 h-3.5 w-3.5" />
                Decline
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <ApproveDialog
        horse={horse}
        open={approveOpen}
        onOpenChange={setApproveOpen}
      />
      <DeclineDialog
        horse={horse}
        open={declineOpen}
        onOpenChange={setDeclineOpen}
      />
    </>
  );
}

interface DialogProps {
  horse: Horse;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function ApproveDialog({ horse, open, onOpenChange }: DialogProps) {
  const approve = useApproveHorseOwnership(horse.id);
  const [fee, setFee] = useState('');
  // Default start date = today, in the admin's local TZ. ISO YYYY-MM-DD.
  const [startDate, setStartDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const feeNumber = Number(fee);
    if (Number.isNaN(feeNumber) || feeNumber < 0) {
      toast.error('Enter a valid fee (0 or more)');
      return;
    }
    if (!startDate) {
      toast.error('Pick a start date');
      return;
    }
    try {
      await approve.mutateAsync({
        // User enters AED major units; DB stores minor units (fils).
        monthlyLiveryFeeMinor: Math.round(feeNumber * 100),
        liveryStartDate: startDate,
      });
      toast.success(`${horse.name} approved`);
      onOpenChange(false);
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

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="fee">Monthly livery fee</Label>
            <Input
              id="fee"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder="e.g. 2500"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              Enter 0 if you&apos;re housing the horse gratis or billing off-platform.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="start-date">Livery starts</Label>
            <Input
              id="start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
          </div>

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
      </DialogContent>
    </Dialog>
  );
}

function DeclineDialog({ horse, open, onOpenChange }: DialogProps) {
  const decline = useDeclineHorseOwnership(horse.id);
  const [reason, setReason] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      toast.error('Please add a reason — the owner will see this');
      return;
    }
    try {
      await decline.mutateAsync(reason.trim());
      toast.success(`${horse.name} declined`);
      onOpenChange(false);
      setReason('');
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
            The owner will receive an email with this reason. Be specific — it
            helps them understand what, if anything, they can change.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason</Label>
            <Textarea
              id="reason"
              rows={5}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. We&apos;re at capacity this season but can revisit in 2 months. Please resubmit then."
              maxLength={1000}
              required
            />
            <p className="text-xs text-muted-foreground">
              {reason.length} / 1000
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={decline.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={decline.isPending}
            >
              {decline.isPending ? 'Declining…' : 'Decline'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
