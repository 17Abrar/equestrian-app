'use client';

import { useState } from 'react';
import { Plus, Trash2, Pencil, Sun, Moon, Lightbulb } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { createArenaSchema, type CreateArenaInput } from '@equestrian/shared/schemas';
import { type z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { useArenas, useCreateArena, useUpdateArena, useDeleteArena, type Arena } from '@/hooks/use-bookings';

type ArenaFormValues = z.input<typeof createArenaSchema>;
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorState } from '@/components/shared/error-state';
import { reportMutationError } from '@/components/shared/report-mutation-error';

function ArenasListSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="p-4">
            <Skeleton className="mb-2 h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function ArenasList() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingArena, setEditingArena] = useState<Arena | null>(null);
  const { data, isLoading, isError, error, refetch } = useArenas();
  const createArena = useCreateArena();
  const deleteArena = useDeleteArena();

  const form = useForm<ArenaFormValues, unknown, CreateArenaInput>({
    resolver: zodResolver(createArenaSchema),
    defaultValues: {
      name: '',
      hasLighting: false,
      isIndoor: false,
    },
  });

  async function onSubmit(formData: CreateArenaInput) {
    try {
      await createArena.mutateAsync(formData);
      toast.success('Arena created');
      setDialogOpen(false);
      form.reset();
    } catch (submitError) {
      reportMutationError('arena.create', submitError);
      toast.error(submitError instanceof Error ? submitError.message : 'Failed to create arena');
    }
  }

  async function handleDelete(arenaId: string) {
    try {
      await deleteArena.mutateAsync(arenaId);
      toast.success('Arena removed');
    } catch (err) {
      reportMutationError('arena.delete', err, { arenaId });
      toast.error('Failed to remove arena');
    }
  }

  const arenas = data?.data ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Arenas</h1>
          <p className="mt-1 text-muted-foreground">Manage your riding arenas and facilities</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Arena
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Arena</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Main Arena" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="capacity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Capacity</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="Max riders" {...field} value={(field.value as number | undefined) ?? ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="surfaceType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Surface Type</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Sand, Grass, Rubber" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex gap-6">
                  <FormField
                    control={form.control}
                    name="isIndoor"
                    render={({ field }) => (
                      <FormItem className="flex items-center gap-2">
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <FormLabel className="!mt-0">Indoor</FormLabel>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="hasLighting"
                    render={({ field }) => (
                      <FormItem className="flex items-center gap-2">
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <FormLabel className="!mt-0">Has Lighting</FormLabel>
                      </FormItem>
                    )}
                  />
                </div>
                <Button type="submit" disabled={createArena.isPending} className="w-full">
                  {createArena.isPending ? 'Creating...' : 'Create Arena'}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Content */}
      {isLoading && <ArenasListSkeleton />}

      {isError && (
        <ErrorState
          message={error instanceof Error ? error.message : 'Failed to load arenas'}
          onRetry={() => refetch()}
        />
      )}

      {!isLoading && !isError && arenas.length === 0 && (
        <EmptyState
          title="No arenas yet"
          description="Add your first arena to start scheduling lessons"
        />
      )}

      {arenas.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {arenas.map((arena) => (
            <Card key={arena.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold">{arena.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {arena.surfaceType ?? 'No surface specified'}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground"
                      aria-label={`Edit ${arena.name}`}
                      onClick={() => setEditingArena(arena)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label={`Delete ${arena.name}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove {arena.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will deactivate the arena. Existing bookings will not be affected.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(arena.id)}>
                          Remove
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {arena.capacity && (
                    <Badge variant="outline" className="text-xs">
                      Cap: {arena.capacity}
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-xs">
                    {arena.isIndoor ? (
                      <><Moon className="mr-1 h-3 w-3" /> Indoor</>
                    ) : (
                      <><Sun className="mr-1 h-3 w-3" /> Outdoor</>
                    )}
                  </Badge>
                  {arena.hasLighting && (
                    <Badge variant="outline" className="text-xs">
                      <Lightbulb className="mr-1 h-3 w-3" /> Lit
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Arena Dialog */}
      {editingArena && (
        <EditArenaDialog
          arena={editingArena}
          open={!!editingArena}
          onOpenChange={(open) => { if (!open) setEditingArena(null); }}
        />
      )}
    </div>
  );
}

function EditArenaDialog({ arena, open, onOpenChange }: { arena: Arena; open: boolean; onOpenChange: (open: boolean) => void }) {
  const updateArena = useUpdateArena(arena.id);
  const queryClient = useQueryClient();

  const editForm = useForm<ArenaFormValues, unknown, CreateArenaInput>({
    resolver: zodResolver(createArenaSchema),
    defaultValues: {
      name: arena.name,
      capacity: arena.capacity ?? undefined,
      surfaceType: arena.surfaceType ?? undefined,
      hasLighting: arena.hasLighting,
      isIndoor: arena.isIndoor,
    },
  });

  async function onEditSubmit(formData: CreateArenaInput) {
    try {
      await updateArena.mutateAsync(formData);
      toast.success('Arena updated');
      void queryClient.invalidateQueries({ queryKey: ['arenas'] });
      onOpenChange(false);
    } catch (err) {
      reportMutationError('arena.update', err);
      toast.error(err instanceof Error ? err.message : 'Failed to update arena');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {arena.name}</DialogTitle>
        </DialogHeader>
        <Form {...editForm}>
          <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
            <FormField
              control={editForm.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Arena Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Main Arena" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={editForm.control}
              name="capacity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Capacity</FormLabel>
                  <FormControl>
                    <Input type="number" placeholder="Max riders" {...field} value={(field.value as number | undefined) ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={editForm.control}
              name="surfaceType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Surface Type</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Sand, Grass" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex gap-6">
              <FormField
                control={editForm.control}
                name="isIndoor"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2">
                    <FormLabel>Indoor</FormLabel>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="hasLighting"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2">
                    <FormLabel>Lighting</FormLabel>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
            <Button type="submit" disabled={updateArena.isPending} className="w-full">
              {updateArena.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
