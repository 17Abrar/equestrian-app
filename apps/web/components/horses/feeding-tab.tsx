'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus, Trash2, UtensilsCrossed } from 'lucide-react';
import { createFeedingPlanSchema, type CreateFeedingPlanFormValues, type CreateFeedingPlanInput } from '@equestrian/shared/schemas';
import { useFeedingPlans, useCreateFeedingPlan, useDeleteFeedingPlan } from '@/hooks/use-horse-health';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { ErrorState } from '@/components/shared/error-state';
import { EmptyState } from '@/components/shared/empty-state';
import { reportMutationError } from '@/components/shared/report-mutation-error';
import { FeedingPlanListSkeleton } from './horse-tab-skeletons';

interface FeedingTabProps {
  horseId: string;
}

export function FeedingTab({ horseId }: FeedingTabProps) {
  const { data, isLoading, isError, error, refetch } = useFeedingPlans(horseId);
  const deletePlan = useDeleteFeedingPlan(horseId);
  // Audit F-50 (2026-05-08 r6): lift Add-dialog state to section root so
  // the EmptyState's CTA can drive the same dialog the header button
  // mounts. Mirrors the F-20 lift pattern used elsewhere in the
  // dashboard.
  const [addOpen, setAddOpen] = useState(false);

  if (isLoading) return <FeedingPlanListSkeleton />;
  if (isError) return <ErrorState message={error instanceof Error ? error.message : 'Failed to load feeding plans'} onRetry={() => refetch()} />;

  const plans = data?.data ?? [];

  async function handleDelete(planId: string) {
    try {
      await deletePlan.mutateAsync(planId);
      toast.success('Feeding plan removed');
    } catch (err) {
      reportMutationError('feeding.delete', err, { horseId, planId });
      toast.error('Failed to remove feeding plan');
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <UtensilsCrossed className="h-5 w-5 text-muted-foreground" />
          <CardTitle>Feeding Schedule</CardTitle>
        </div>
        <AddFeedingPlanDialog horseId={horseId} open={addOpen} onOpenChange={setAddOpen} />
      </CardHeader>
      <CardContent>
        {plans.length === 0 ? (
          <EmptyState
            title="No feeding plans yet"
            description="Track meals, supplements, and quantities so the groom on duty knows exactly what each horse eats."
            action={{ label: 'Add Meal Plan', onClick: () => setAddOpen(true) }}
          />
        ) : (
          <div className="space-y-3">
            {plans.map((plan) => (
              <div key={plan.id} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{plan.mealName}</p>
                    {plan.timeOfDay && <Badge variant="outline" className="text-xs">{plan.timeOfDay}</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {plan.feedType ?? 'No feed type specified'}
                    {plan.quantityKg ? ` — ${plan.quantityKg} kg` : ''}
                  </p>
                  {plan.supplements && plan.supplements.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {plan.supplements.map((s) => (
                        <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                      ))}
                    </div>
                  )}
                  {plan.notes && <p className="mt-1 text-xs text-muted-foreground">{plan.notes}</p>}
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Delete plan">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove {plan.mealName}?</AlertDialogTitle>
                      <AlertDialogDescription>This will delete this feeding plan entry.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleDelete(plan.id)}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AddFeedingPlanDialog({
  horseId,
  open,
  onOpenChange,
}: {
  horseId: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const createPlan = useCreateFeedingPlan(horseId);

  const form = useForm<CreateFeedingPlanFormValues, unknown, CreateFeedingPlanInput>({
    resolver: zodResolver(createFeedingPlanSchema),
    defaultValues: { mealName: '' },
  });

  async function onSubmit(data: CreateFeedingPlanInput) {
    try {
      await createPlan.mutateAsync(data);
      toast.success('Feeding plan added');
      form.reset();
      onOpenChange(false);
    } catch (err) {
      reportMutationError('feeding.create', err, { horseId });
      toast.error(err instanceof Error ? err.message : 'Failed to add feeding plan');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-2 h-4 w-4" />Add Meal</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Feeding Plan</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="mealName" render={({ field }) => (
                <FormItem><FormLabel>Meal Name *</FormLabel><FormControl><Input placeholder="e.g. Morning Feed" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="timeOfDay" render={({ field }) => (
                <FormItem><FormLabel>Time</FormLabel><FormControl><Input type="time" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="feedType" render={({ field }) => (
                <FormItem><FormLabel>Feed Type</FormLabel><FormControl><Input placeholder="e.g. Hay, Grain mix" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="quantityKg" render={({ field }) => (
                <FormItem><FormLabel>Quantity (kg)</FormLabel><FormControl><NumberInput step="0.1" placeholder="e.g. 2.5" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem><FormLabel>Notes</FormLabel><FormControl><Textarea rows={2} placeholder="e.g. Soaked hay only" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <Button type="submit" className="w-full" disabled={createPlan.isPending}>
              {createPlan.isPending ? 'Adding...' : 'Add Meal Plan'}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
