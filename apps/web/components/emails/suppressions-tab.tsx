'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus, Trash2, ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
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
import { EmptyState } from '@/components/shared/empty-state';
import { reportMutationError } from '@/components/shared/report-mutation-error';
import { fetchJson } from '@/lib/fetch-json';

interface SuppressionRow {
  id: string;
  email: string;
  reason: 'manual' | 'bounced' | 'complained';
  notes: string | null;
  createdAt: string;
}

interface PaginatedEnvelope<T> {
  success: true;
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

const addSuppressionSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Enter a valid email address')
    .max(320),
  notes: z.string().trim().max(500).optional(),
});

type AddSuppressionValues = z.infer<typeof addSuppressionSchema>;

export function SuppressionsTab() {
  const [createOpen, setCreateOpen] = useState(false);
  const queryClient = useQueryClient();

  const listQuery = useQuery<PaginatedEnvelope<SuppressionRow>>({
    queryKey: ['email-suppressions'],
    queryFn: () => fetchJson<PaginatedEnvelope<SuppressionRow>>('/api/v1/emails/suppressions'),
  });

  const retireMutation = useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/v1/emails/suppressions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Suppression removed');
      void queryClient.invalidateQueries({ queryKey: ['email-suppressions'] });
    },
    onError: (err) => {
      reportMutationError('email_suppression.retire', err);
      toast.error(err instanceof Error ? err.message : 'Could not remove suppression');
    },
  });

  if (listQuery.isLoading) {
    return (
      <Card>
        <CardContent className="space-y-2 p-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (listQuery.isError) {
    return (
      <ErrorState
        message={
          listQuery.error instanceof Error ? listQuery.error.message : 'Failed to load suppressions'
        }
        onRetry={() => listQuery.refetch()}
      />
    );
  }

  const rows = listQuery.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Suppressed addresses</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Addresses on this list will not receive any emails sent from your club. Resend-detected
            bounces and spam complaints are handled automatically and aren&apos;t shown here.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add address
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add suppression</DialogTitle>
            </DialogHeader>
            <AddSuppressionForm onSuccess={() => setCreateOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No suppressions yet"
          description="Add an address to stop your club from sending to it."
          action={{ label: 'Add address', onClick: () => setCreateOpen(true) }}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-border divide-y">
              {rows.map((row) => (
                <li key={row.id} className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <ShieldOff className="text-muted-foreground h-4 w-4 shrink-0" />
                      <span className="truncate font-medium">{row.email}</span>
                    </div>
                    {row.notes ? (
                      <p className="text-muted-foreground mt-1 text-sm">{row.notes}</p>
                    ) : null}
                    <p className="text-muted-foreground mt-1 text-xs">
                      Added{' '}
                      {new Date(row.createdAt).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </p>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Remove suppression">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove suppression?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {row.email} will be able to receive emails from your club again.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => retireMutation.mutate(row.id)}
                          disabled={retireMutation.isPending}
                        >
                          Remove
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AddSuppressionForm({ onSuccess }: { onSuccess: () => void }) {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<AddSuppressionValues>({
    resolver: zodResolver(addSuppressionSchema),
    defaultValues: { email: '', notes: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: AddSuppressionValues) =>
      fetchJson('/api/v1/emails/suppressions', {
        method: 'POST',
        body: JSON.stringify(values),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      toast.success('Address suppressed');
      void queryClient.invalidateQueries({ queryKey: ['email-suppressions'] });
      reset();
      onSuccess();
    },
    onError: (err) => {
      reportMutationError('email_suppression.add', err);
      toast.error(err instanceof Error ? err.message : 'Could not save suppression');
    },
  });

  return (
    <form
      className="space-y-3"
      onSubmit={handleSubmit((values) => {
        // Empty `notes` should be undefined, not "".
        const payload: AddSuppressionValues = {
          email: values.email,
          ...(values.notes ? { notes: values.notes } : {}),
        };
        mutation.mutate(payload);
      })}
    >
      <div>
        <Label htmlFor="suppression-email">Email address</Label>
        <Input
          id="suppression-email"
          type="email"
          autoComplete="off"
          placeholder="someone@example.com"
          {...register('email')}
        />
        {errors.email ? (
          <p className="text-destructive mt-1 text-xs">{errors.email.message}</p>
        ) : null}
      </div>
      <div>
        <Label htmlFor="suppression-notes">Notes (optional)</Label>
        <Textarea
          id="suppression-notes"
          rows={3}
          placeholder="Why are we suppressing? (e.g., unsubscribe via WhatsApp 2026-05-26)"
          {...register('notes')}
        />
        {errors.notes ? (
          <p className="text-destructive mt-1 text-xs">{errors.notes.message}</p>
        ) : null}
      </div>
      <DialogFooter>
        <Button type="submit" disabled={isSubmitting || mutation.isPending}>
          Add suppression
        </Button>
      </DialogFooter>
    </form>
  );
}
