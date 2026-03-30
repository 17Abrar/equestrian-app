'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus, Search, Trash2, Pencil, UserCog, Users2, Wrench } from 'lucide-react';
import { createStaffSchema, type CreateStaffInput } from '@equestrian/shared/schemas';
import { useStaff, useCreateStaff, useDeactivateStaff, type ClubMember } from '@/hooks/use-staff';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ErrorState } from '@/components/shared/error-state';
import { EmptyState } from '@/components/shared/empty-state';

const ROLE_COLORS: Record<string, string> = {
  club_manager: 'bg-purple-100 text-purple-800',
  coach: 'bg-blue-100 text-blue-800',
  groom: 'bg-green-100 text-green-800',
};

const ROLE_ICONS: Record<string, typeof UserCog> = {
  club_manager: UserCog,
  coach: Users2,
  groom: Wrench,
};

const ROLE_LABELS: Record<string, string> = {
  club_manager: 'Manager',
  coach: 'Coach',
  groom: 'Groom',
};

function StaffSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i}><CardContent className="p-4"><Skeleton className="h-20" /></CardContent></Card>
      ))}
    </div>
  );
}

export function StaffList() {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string | undefined>();
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error, refetch } = useStaff({
    search: search || undefined,
    role: roleFilter,
    page,
    pageSize: 25,
  });
  const deactivateStaff = useDeactivateStaff();

  if (isLoading) return <StaffSkeleton />;
  if (isError) return <ErrorState message={error instanceof Error ? error.message : 'Failed to load staff'} onRetry={() => refetch()} />;

  const staff = data?.data ?? [];
  const pagination = data?.pagination;

  async function handleDeactivate(memberId: string) {
    try {
      await deactivateStaff.mutateAsync(memberId);
      toast.success('Staff member deactivated');
    } catch {
      toast.error('Failed to deactivate staff member');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Staff & Coaches</h1>
          <p className="mt-1 text-muted-foreground">Manage your team members</p>
        </div>
        <AddStaffDialog />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search staff..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="pl-10" />
        </div>
        <Tabs value={roleFilter ?? 'all'} onValueChange={(v) => { setRoleFilter(v === 'all' ? undefined : v); setPage(1); }}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="club_manager">Managers</TabsTrigger>
            <TabsTrigger value="coach">Coaches</TabsTrigger>
            <TabsTrigger value="groom">Grooms</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {staff.length === 0 && (
        <EmptyState title="No staff members yet" description="Add your first staff member to get started." />
      )}

      {staff.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {staff.map((member) => {
            const RoleIcon = ROLE_ICONS[member.role] ?? UserCog;
            return (
              <Card key={member.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                        <RoleIcon className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="font-semibold">{member.displayName ?? 'Unnamed'}</p>
                        <p className="text-sm text-muted-foreground">{member.email}</p>
                      </div>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label={`Remove ${member.displayName}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove {member.displayName}?</AlertDialogTitle>
                          <AlertDialogDescription>This will deactivate their account. They can be reactivated later.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDeactivate(member.id)}>Remove</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Badge className={ROLE_COLORS[member.role] ?? ''}>
                      {ROLE_LABELS[member.role] ?? member.role}
                    </Badge>
                    {member.phone && <span className="text-sm text-muted-foreground">{member.phone}</span>}
                  </div>
                </CardContent>
              </Card>
            );
          })}
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

function AddStaffDialog() {
  const [open, setOpen] = useState(false);
  const createStaff = useCreateStaff();

  const form = useForm<CreateStaffInput>({
    resolver: zodResolver(createStaffSchema),
    defaultValues: { displayName: '', email: '', role: 'coach' },
  });

  async function onSubmit(data: CreateStaffInput) {
    try {
      await createStaff.mutateAsync(data);
      toast.success('Staff member added');
      form.reset();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add staff member');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="mr-2 h-4 w-4" />Add Staff</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Staff Member</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="displayName" render={({ field }) => (
              <FormItem><FormLabel>Name *</FormLabel><FormControl><Input placeholder="Full name" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem><FormLabel>Email *</FormLabel><FormControl><Input type="email" placeholder="staff@example.com" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="phone" render={({ field }) => (
              <FormItem><FormLabel>Phone</FormLabel><FormControl><Input placeholder="+971..." {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="role" render={({ field }) => (
              <FormItem>
                <FormLabel>Role *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="coach">Coach</SelectItem>
                    <SelectItem value="groom">Groom</SelectItem>
                    <SelectItem value="club_manager">Manager</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <Button type="submit" className="w-full" disabled={createStaff.isPending}>
              {createStaff.isPending ? 'Adding...' : 'Add Staff Member'}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
