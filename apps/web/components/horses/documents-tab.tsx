'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus, Trash2, FileText, ExternalLink } from 'lucide-react';
import { type z } from 'zod';
import { createDocumentSchema, type CreateDocumentInput } from '@equestrian/shared/schemas';
type DocumentFormValues = z.input<typeof createDocumentSchema>;
import { useDocuments, useCreateDocument, useDeleteDocument } from '@/hooks/use-horse-health';
import { FileUpload } from '@/components/ui/file-upload';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { ErrorState } from '@/components/shared/error-state';
import { EmptyState } from '@/components/shared/empty-state';
import { reportMutationError } from '@/components/shared/report-mutation-error';
import { safeHref } from '@/lib/safe-href';
import { DocumentsListSkeleton } from './horse-tab-skeletons';

const CATEGORY_LABELS: Record<string, string> = {
  medical_report: 'Medical Report',
  blood_test: 'Blood Test',
  xray: 'X-Ray',
  competition_result: 'Competition',
  registration: 'Registration',
  insurance: 'Insurance',
  purchase_agreement: 'Purchase',
  vaccination_certificate: 'Vaccination',
  other: 'Other',
};

interface DocumentsTabProps {
  horseId: string;
}

export function DocumentsTab({ horseId }: DocumentsTabProps) {
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();
  const { data, isLoading, isError, error, refetch } = useDocuments(horseId, categoryFilter);
  const deleteDoc = useDeleteDocument(horseId);
  // Audit F-50 (2026-05-08 r6): lift Add-dialog state to section root.
  const [addOpen, setAddOpen] = useState(false);

  if (isLoading) return <DocumentsListSkeleton />;
  if (isError) return <ErrorState message={error instanceof Error ? error.message : 'Failed to load documents'} onRetry={() => refetch()} />;

  const documents = data?.data ?? [];

  async function handleDelete(documentId: string) {
    try {
      await deleteDoc.mutateAsync(documentId);
      toast.success('Document removed');
    } catch (err) {
      reportMutationError('document.delete', err, { horseId, documentId });
      toast.error('Failed to remove document');
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <CardTitle>Documents</CardTitle>
        </div>
        <div className="flex items-center gap-2">
          <Select value={categoryFilter ?? 'all'} onValueChange={(v) => setCategoryFilter(v === 'all' ? undefined : v)}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <AddDocumentDialog horseId={horseId} open={addOpen} onOpenChange={setAddOpen} />
        </div>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <EmptyState
            title="No documents yet"
            description="Upload medical reports, X-rays, registrations, and insurance certs in one searchable place."
            action={{ label: 'Upload Document', onClick: () => setAddOpen(true) }}
          />
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-3">
                  <FileText className="h-8 w-8 text-muted-foreground" />
                  <div>
                    <a href={safeHref(doc.fileUrl)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-medium hover:underline">
                      {doc.fileName}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-[10px]">{CATEGORY_LABELS[doc.category] ?? doc.category}</Badge>
                      {doc.fileType && <span>{doc.fileType}</span>}
                      {doc.description && <span>— {doc.description}</span>}
                    </div>
                  </div>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Delete document">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {doc.fileName}?</AlertDialogTitle>
                      <AlertDialogDescription>This will remove the document record. The file itself will remain at its URL.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleDelete(doc.id)}>Delete</AlertDialogAction>
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

function AddDocumentDialog({
  horseId,
  open,
  onOpenChange,
}: {
  horseId: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const createDocument = useCreateDocument(horseId);

  const form = useForm<DocumentFormValues, unknown, CreateDocumentInput>({
    resolver: zodResolver(createDocumentSchema),
    defaultValues: { fileName: '', fileUrl: '', category: 'other' },
  });

  async function onSubmit(data: CreateDocumentInput) {
    try {
      await createDocument.mutateAsync(data);
      toast.success('Document added');
      form.reset();
      onOpenChange(false);
    } catch (err) {
      reportMutationError('document.create', err, { horseId });
      toast.error(err instanceof Error ? err.message : 'Failed to add document');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-2 h-4 w-4" />Add Document</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Document</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="fileUrl" render={({ field }) => (
              <FormItem>
                <FormLabel>Upload File *</FormLabel>
                <FormControl>
                  <FileUpload
                    value={field.value}
                    onChange={(url) => {
                      field.onChange(url);
                      // Auto-fill file name from URL
                      if (url && !form.getValues('fileName')) {
                        const name = url.split('/').pop()?.split('-').slice(1).join('-') ?? 'document';
                        form.setValue('fileName', name);
                      }
                    }}
                    folder="horses/documents"
                    accept="image/*,.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    label="Drop document here or click to browse"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="fileName" render={({ field }) => (
              <FormItem><FormLabel>File Name</FormLabel><FormControl><Input placeholder="Auto-filled from upload" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="category" render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="fileType" render={({ field }) => (
                <FormItem><FormLabel>File Type</FormLabel><FormControl><Input placeholder="e.g. pdf, jpg" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea rows={2} placeholder="Brief description..." {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <Button type="submit" className="w-full" disabled={createDocument.isPending}>
              {createDocument.isPending ? 'Adding...' : 'Add Document'}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
