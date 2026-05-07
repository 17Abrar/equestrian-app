'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus, Search, Trash2, Crown } from 'lucide-react';
import { createOwnerSchema, type CreateOwnerInput } from '@equestrian/shared/schemas';
import { useOwners, useCreateOwner, useDeactivateOwner } from '@/hooks/use-staff';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ErrorState } from '@/components/shared/error-state';
import { EmptyState } from '@/components/shared/empty-state';
import { reportMutationError } from '@/components/shared/report-mutation-error';
import { DEFAULT_PAGE_SIZE } from '@equestrian/shared/constants';

function OwnersSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i}><CardContent className="p-4"><Skeleton className="h-20" /></CardContent></Card>
      ))}
    </div>
  );
}

interface OwnersListProps {
  /** Audit MED (2026-05-05 pass 2): server-side `owners:create` (or
   *  the wildcard equivalent) gate. */
  canCreate?: boolean;
}

export function OwnersList({ canCreate = true }: OwnersListProps = {}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // Audit F-20 (2026-05-07 r4): lift dialog open state for EmptyState CTA.
  const [addOpen, setAddOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useOwners({
    search: search || undefined,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const deactivateOwner = useDeactivateOwner();

  if (isLoading) return <OwnersSkeleton />;
  if (isError) return <ErrorState message={error instanceof Error ? error.message : 'Failed to load owners'} onRetry={() => refetch()} />;

  const owners = data?.data ?? [];
  const pagination = data?.pagination;

  async function handleDeactivate(memberId: string) {
    try {
      await deactivateOwner.mutateAsync(memberId);
      toast.success('Owner deactivated');
    } catch (err) {
      reportMutationError('owner.deactivate', err, { memberId });
      // Audit LOW (2026-05-05 pass 2): surface the server's message
      // (e.g. "Cannot deactivate owner with active horses") instead of
      // the generic placeholder.
      toast.error(err instanceof Error ? err.message : 'Failed to deactivate owner');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Private Owners</h1>
          <p className="mt-1 text-muted-foreground">Manage horse owners and their profiles</p>
        </div>
        {canCreate && <AddOwnerDialog open={addOpen} onOpenChange={setAddOpen} />}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search owners..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="pl-10" />
      </div>

      {owners.length === 0 && (
        <EmptyState
          title="No horse owners yet"
          description="Add private horse owners to manage their horses and livery."
          action={
            canCreate
              ? { label: 'Add Owner', onClick: () => setAddOpen(true) }
              : undefined
          }
        />
      )}

      {owners.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {owners.map((owner) => (
            <Card key={owner.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
                      <Crown className="h-5 w-5 text-amber-700" />
                    </div>
                    <div>
                      <p className="font-semibold">{owner.displayName ?? 'Unnamed'}</p>
                      <p className="text-sm text-muted-foreground">{owner.email}</p>
                    </div>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label={`Remove ${owner.displayName}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove {owner.displayName}?</AlertDialogTitle>
                        <AlertDialogDescription>This will deactivate their account. Their horses will remain in the system.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDeactivate(owner.id)}>Remove</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
                {owner.phone && (
                  <p className="mt-2 text-sm text-muted-foreground">{owner.phone}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Previous</Button>
          <span className="text-sm text-muted-foreground">Page {page} of {pagination.totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page >= pagination.totalPages}>Next</Button>
        </div>
      )}
    </div>
  );
}

function AddOwnerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createOwner = useCreateOwner();

  const form = useForm<CreateOwnerInput>({
    resolver: zodResolver(createOwnerSchema),
    defaultValues: { displayName: '', email: '' },
  });

  async function onSubmit(data: CreateOwnerInput) {
    try {
      await createOwner.mutateAsync(data);
      toast.success('Owner added');
      form.reset();
      onOpenChange(false);
    } catch (err) {
      reportMutationError('owner.create', err);
      toast.error(err instanceof Error ? err.message : 'Failed to add owner');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button><Plus className="mr-2 h-4 w-4" />Add Owner</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Horse Owner</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="displayName" render={({ field }) => (
              <FormItem><FormLabel>Name *</FormLabel><FormControl><Input placeholder="Full name" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem><FormLabel>Email *</FormLabel><FormControl><Input type="email" placeholder="owner@example.com" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="phone" render={({ field }) => (
              <FormItem><FormLabel>Phone</FormLabel><FormControl><Input placeholder="+971..." {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <Button type="submit" className="w-full" disabled={createOwner.isPending}>
              {createOwner.isPending ? 'Adding...' : 'Add Owner'}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
