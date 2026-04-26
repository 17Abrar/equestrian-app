'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus, Trash2, Stethoscope, Pill, Check, X } from 'lucide-react';
import { type z } from 'zod';
import {
  createHealthRecordSchema,
  createMedicationSchema,
  type CreateHealthRecordFormValues,
  type CreateHealthRecordInput,
  type CreateMedicationInput,
} from '@equestrian/shared/schemas';
import { formatMoney, toMinorUnits } from '@equestrian/shared/utils';
import {
  useHealthRecords,
  useCreateHealthRecord,
  useDeleteHealthRecord,
  useMedications,
  useCreateMedication,
  useCreateMedicationLog,
  type Medication,
} from '@/hooks/use-horse-health';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { ErrorState } from '@/components/shared/error-state';
import { reportMutationError } from '@/components/shared/report-mutation-error';
import { useClubSettings } from '@/hooks/use-settings';

const RECORD_TYPE_COLORS: Record<string, string> = {
  vaccination: 'bg-blue-100 text-blue-800',
  vet_visit: 'bg-green-100 text-green-800',
  dental: 'bg-purple-100 text-purple-800',
  deworming: 'bg-yellow-100 text-yellow-800',
  blood_test: 'bg-red-100 text-red-800',
  injury: 'bg-orange-100 text-orange-800',
  farrier: 'bg-amber-100 text-amber-800',
  other: 'bg-gray-100 text-gray-800',
};

interface HealthTabProps {
  horseId: string;
}

export function HealthTab({ horseId }: HealthTabProps) {
  return (
    <div className="space-y-6">
      <HealthRecordsSection horseId={horseId} />
      <MedicationsSection horseId={horseId} />
    </div>
  );
}

// ─── Health Records ───────────────────────────────────────────────────

function HealthRecordsSection({ horseId }: { horseId: string }) {
  const [typeFilter, setTypeFilter] = useState<string | undefined>();
  const { data, isLoading, isError, error, refetch } = useHealthRecords(horseId, typeFilter);
  const deleteRecord = useDeleteHealthRecord(horseId);
  const { data: settings } = useClubSettings();
  // Health records have no currency column; display costs in the club's
  // configured currency so vet invoices render consistently with the rest
  // of the dashboard.
  const currency = settings?.data.currency ?? 'AED';

  if (isLoading) return <Skeleton className="h-64" />;
  if (isError) return <ErrorState message={error instanceof Error ? error.message : 'Failed to load records'} onRetry={() => refetch()} />;

  const records = data?.data ?? [];

  async function handleDelete(recordId: string) {
    try {
      await deleteRecord.mutateAsync(recordId);
      toast.success('Record deleted');
    } catch (err) {
      reportMutationError('health.delete', err, { horseId, recordId });
      toast.error('Failed to delete record');
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Stethoscope className="h-5 w-5 text-muted-foreground" />
          <CardTitle>Health Records</CardTitle>
        </div>
        <div className="flex items-center gap-2">
          <Select value={typeFilter ?? 'all'} onValueChange={(v) => setTypeFilter(v === 'all' ? undefined : v)}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="vaccination">Vaccination</SelectItem>
              <SelectItem value="vet_visit">Vet Visit</SelectItem>
              <SelectItem value="dental">Dental</SelectItem>
              <SelectItem value="deworming">Deworming</SelectItem>
              <SelectItem value="blood_test">Blood Test</SelectItem>
              <SelectItem value="injury">Injury</SelectItem>
              <SelectItem value="farrier">Farrier</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
          <AddHealthRecordDialog horseId={horseId} currency={currency} />
        </div>
      </CardHeader>
      <CardContent>
        {records.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No health records yet. Add the first record above.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Vet</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Follow-up</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.date}</TableCell>
                  <TableCell>
                    <Badge className={RECORD_TYPE_COLORS[r.recordType] ?? RECORD_TYPE_COLORS.other}>
                      {r.recordType.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">{r.title}</TableCell>
                  <TableCell className="text-muted-foreground">{r.vetName ?? '—'}</TableCell>
                  <TableCell>{r.cost != null ? formatMoney(r.cost, currency) : '—'}</TableCell>
                  <TableCell>
                    {r.followUpNeeded ? (
                      <Badge variant="outline" className="text-orange-600">{r.followUpDate ?? 'Needed'}</Badge>
                    ) : '—'}
                  </TableCell>
                  <TableCell>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Delete record">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete this record?</AlertDialogTitle>
                          <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(r.id)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function AddHealthRecordDialog({ horseId, currency }: { horseId: string; currency: string }) {
  const [open, setOpen] = useState(false);
  const createRecord = useCreateHealthRecord(horseId);

  const form = useForm<CreateHealthRecordFormValues, unknown, CreateHealthRecordInput>({
    resolver: zodResolver(createHealthRecordSchema),
    defaultValues: { recordType: 'vet_visit', title: '', date: new Date().toISOString().split('T')[0], followUpNeeded: false },
  });

  async function onSubmit(data: CreateHealthRecordInput) {
    try {
      const apiData = { ...data, cost: data.cost != null ? toMinorUnits(data.cost, currency) : undefined };
      await createRecord.mutateAsync(apiData);
      toast.success('Health record added');
      form.reset();
      setOpen(false);
    } catch (err) {
      reportMutationError('health.create', err, { horseId });
      toast.error(err instanceof Error ? err.message : 'Failed to add record');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-2 h-4 w-4" />Add Record</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Add Health Record</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="recordType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="vaccination">Vaccination</SelectItem>
                      <SelectItem value="vet_visit">Vet Visit</SelectItem>
                      <SelectItem value="dental">Dental</SelectItem>
                      <SelectItem value="deworming">Deworming</SelectItem>
                      <SelectItem value="blood_test">Blood Test</SelectItem>
                      <SelectItem value="injury">Injury</SelectItem>
                      <SelectItem value="farrier">Farrier</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="date" render={({ field }) => (
                <FormItem><FormLabel>Date *</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="title" render={({ field }) => (
              <FormItem><FormLabel>Title *</FormLabel><FormControl><Input placeholder="e.g. Annual vaccination" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea rows={2} placeholder="Details..." {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="vetName" render={({ field }) => (
                <FormItem><FormLabel>Vet Name</FormLabel><FormControl><Input placeholder="Dr. Smith" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="cost" render={({ field }) => (
                <FormItem><FormLabel>Cost (AED)</FormLabel><FormControl><Input type="number" step="0.01" placeholder="e.g. 500" {...field} value={(field.value as number | undefined) ?? ''} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="diagnosis" render={({ field }) => (
                <FormItem><FormLabel>Diagnosis</FormLabel><FormControl><Input placeholder="If applicable" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="treatment" render={({ field }) => (
                <FormItem><FormLabel>Treatment</FormLabel><FormControl><Input placeholder="Treatment given" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="nextDueDate" render={({ field }) => (
                <FormItem><FormLabel>Next Due Date</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="followUpNeeded" render={({ field }) => (
                <FormItem className="flex items-center gap-2 pt-6">
                  <FormLabel>Follow-up Needed</FormLabel>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                </FormItem>
              )} />
            </div>
            <Button type="submit" className="w-full" disabled={createRecord.isPending}>
              {createRecord.isPending ? 'Adding...' : 'Add Record'}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Medications ──────────────────────────────────────────────────────

function MedicationsSection({ horseId }: { horseId: string }) {
  const [showAll, setShowAll] = useState(false);
  const { data, isLoading, isError, error, refetch } = useMedications(horseId, !showAll);

  if (isLoading) return <Skeleton className="h-48" />;
  if (isError) return <ErrorState message={error instanceof Error ? error.message : 'Failed to load medications'} onRetry={() => refetch()} />;

  const medications = data?.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Pill className="h-5 w-5 text-muted-foreground" />
          <CardTitle>Medications</CardTitle>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Active Only' : 'Show All'}
          </Button>
          <AddMedicationDialog horseId={horseId} />
        </div>
      </CardHeader>
      <CardContent>
        {medications.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No {showAll ? '' : 'active '}medications. Add one above.
          </p>
        ) : (
          <div className="space-y-3">
            {medications.map((med) => (
              <MedicationCard key={med.id} horseId={horseId} medication={med} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MedicationCard({ horseId, medication }: { horseId: string; medication: Medication }) {
  const createLog = useCreateMedicationLog(horseId, medication.id);

  async function logAdministration(wasAdministered: boolean, skipReason?: string) {
    try {
      await createLog.mutateAsync({
        medicationId: medication.id,
        administeredAt: new Date().toISOString(),
        wasAdministered,
        skipReason,
      });
      toast.success(wasAdministered ? 'Medication administered' : 'Medication skipped');
    } catch (err) {
      reportMutationError('medication.log', err, { horseId, medicationId: medication.id, wasAdministered });
      toast.error('Failed to log medication');
    }
  }

  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div>
        <p className="font-semibold">{medication.medicationName}</p>
        <p className="text-sm text-muted-foreground">
          {medication.dosage} — {medication.frequency}
        </p>
        {medication.timeOfDay && medication.timeOfDay.length > 0 && (
          <div className="mt-1 flex gap-1">
            {medication.timeOfDay.map((t) => (
              <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
            ))}
          </div>
        )}
        {medication.prescribedBy && (
          <p className="mt-1 text-xs text-muted-foreground">Prescribed by {medication.prescribedBy}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {medication.isActive && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="text-green-600"
              onClick={() => logAdministration(true)}
              disabled={createLog.isPending}
            >
              <Check className="mr-1 h-4 w-4" />
              Given
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-red-600"
              onClick={() => logAdministration(false, 'Skipped by staff')}
              disabled={createLog.isPending}
            >
              <X className="mr-1 h-4 w-4" />
              Skip
            </Button>
          </>
        )}
        {!medication.isActive && (
          <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>
        )}
      </div>
    </div>
  );
}

function AddMedicationDialog({ horseId }: { horseId: string }) {
  const [open, setOpen] = useState(false);
  const createMedication = useCreateMedication(horseId);

  type MedFormValues = z.input<typeof createMedicationSchema>;
  const form = useForm<MedFormValues, unknown, CreateMedicationInput>({
    resolver: zodResolver(createMedicationSchema),
    defaultValues: { medicationName: '', dosage: '', frequency: '', startDate: new Date().toISOString().split('T')[0], isActive: true },
  });

  async function onSubmit(data: CreateMedicationInput) {
    try {
      await createMedication.mutateAsync(data);
      toast.success('Medication added');
      form.reset();
      setOpen(false);
    } catch (err) {
      reportMutationError('medication.create', err, { horseId });
      toast.error(err instanceof Error ? err.message : 'Failed to add medication');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-2 h-4 w-4" />Add Medication</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Medication</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="medicationName" render={({ field }) => (
              <FormItem><FormLabel>Name *</FormLabel><FormControl><Input placeholder="e.g. Bute" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="dosage" render={({ field }) => (
                <FormItem><FormLabel>Dosage *</FormLabel><FormControl><Input placeholder="e.g. 1g" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="frequency" render={({ field }) => (
                <FormItem><FormLabel>Frequency *</FormLabel><FormControl><Input placeholder="e.g. Twice daily" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="startDate" render={({ field }) => (
                <FormItem><FormLabel>Start Date *</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="endDate" render={({ field }) => (
                <FormItem><FormLabel>End Date</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="prescribedBy" render={({ field }) => (
              <FormItem><FormLabel>Prescribed By</FormLabel><FormControl><Input placeholder="Vet name" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem><FormLabel>Notes</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <Button type="submit" className="w-full" disabled={createMedication.isPending}>
              {createMedication.isPending ? 'Adding...' : 'Add Medication'}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
