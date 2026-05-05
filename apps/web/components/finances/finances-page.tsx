'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus, TrendingUp, TrendingDown, AlertCircle, Pencil, Trash2 } from 'lucide-react';
import {
  createExpenseSchema, updateExpenseSchema, createCouponSchema,
  type CreateExpenseFormValues, type CreateExpenseInput,
  type UpdateExpenseFormValues, type UpdateExpenseInput,
  type CreateCouponFormValues, type CreateCouponInput,
} from '@equestrian/shared/schemas';
import { formatMoney, toMajorUnits, formatDate } from '@equestrian/shared/utils';
import {
  useFinanceOverview, useExpenses, useCreateExpense, useUpdateExpense, useDeleteExpense,
  usePayments, useInvoices, useCoupons, useCreateCoupon,
  type Expense,
} from '@/hooks/use-finances';
import { useClubSettings } from '@/hooks/use-settings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { PAYMENT_STATUS_COLORS } from '@/lib/ui-constants';
import { ErrorState } from '@/components/shared/error-state';
import { EmptyState } from '@/components/shared/empty-state';
import { reportMutationError } from '@/components/shared/report-mutation-error';
import { DEFAULT_PAGE_SIZE } from '@equestrian/shared/constants';

export function FinancesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Finances</h1>
        <p className="mt-1 text-muted-foreground">Revenue, expenses, invoices, and coupons</p>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="coupons">Coupons</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6"><OverviewTab /></TabsContent>
        <TabsContent value="invoices" className="mt-6"><InvoicesTab /></TabsContent>
        <TabsContent value="payments" className="mt-6"><PaymentsTab /></TabsContent>
        <TabsContent value="expenses" className="mt-6"><ExpensesTab /></TabsContent>
        <TabsContent value="coupons" className="mt-6"><CouponsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function OverviewTab() {
  const { data, isLoading, isError, error, refetch } = useFinanceOverview();
  const { data: settings } = useClubSettings();
  // Finance totals aren't currency-tagged (they're aggregates across mixed
  // payment rows). Display them in the club's configured currency so the
  // overview matches what the rider sees on their booking invoice.
  const currency = settings?.data.currency ?? 'AED';

  if (isLoading) return <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>;
  if (isError) return <ErrorState message={error instanceof Error ? error.message : 'Failed to load overview'} onRetry={() => refetch()} />;

  const overview = data?.data;
  if (!overview) return <ErrorState message="No data" />;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
              <TrendingUp className="h-6 w-6 text-green-700" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Revenue</p>
              <p className="text-2xl font-bold">{formatMoney(overview.totalRevenue, currency)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <TrendingDown className="h-6 w-6 text-red-700" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Expenses</p>
              <p className="text-2xl font-bold">{formatMoney(overview.totalExpenses, currency)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-yellow-100">
              <AlertCircle className="h-6 w-6 text-yellow-700" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Outstanding</p>
              <p className="text-2xl font-bold">{formatMoney(overview.outstandingBalance, currency)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {overview.paymentMethodBreakdown.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Payment Methods</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {overview.paymentMethodBreakdown.map((pm) => (
                <div key={pm.method ?? 'unknown'} className="flex items-center justify-between">
                  <span className="text-sm capitalize">{pm.method?.replace('_', ' ') ?? 'Unknown'}</span>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-muted-foreground">{pm.count} transactions</span>
                    <span className="font-medium">{formatMoney(pm.total, currency)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PaginationControls({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (next: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 pt-4">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Previous
      </Button>
      <span className="text-sm text-muted-foreground">
        Page {page} of {totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        Next
      </Button>
    </div>
  );
}

function InvoicesTab() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error, refetch } = useInvoices({ page, pageSize: DEFAULT_PAGE_SIZE });

  if (isLoading) return <Skeleton className="h-64" />;
  if (isError) return <ErrorState message={error instanceof Error ? error.message : 'Failed'} onRetry={() => refetch()} />;

  const invoices = data?.data ?? [];

  if (invoices.length === 0) return <EmptyState title="No invoices yet" description="Invoices will appear here when created." />;

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Invoice #</TableHead>
            <TableHead>Member</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Due Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((inv) => (
            <TableRow key={inv.id}>
              <TableCell className="font-medium">{inv.invoiceNumber}</TableCell>
              <TableCell>{inv.memberName ?? 'Unknown'}</TableCell>
              <TableCell>{formatMoney(inv.totalAmount, inv.currency)}</TableCell>
              <TableCell><Badge variant="outline">{inv.status}</Badge></TableCell>
              <TableCell className="text-muted-foreground">{inv.dueDate ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <PaginationControls page={page} totalPages={data?.pagination.totalPages ?? 1} onChange={setPage} />
    </div>
  );
}

function PaymentsTab() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error, refetch } = usePayments({ page, pageSize: DEFAULT_PAGE_SIZE });

  if (isLoading) return <Skeleton className="h-64" />;
  if (isError) return <ErrorState message={error instanceof Error ? error.message : 'Failed'} onRetry={() => refetch()} />;

  const payments = data?.data ?? [];

  if (payments.length === 0) return <EmptyState title="No payments yet" description="Payments will appear here when processed." />;

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Method</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">{p.memberName ?? 'Unknown'}</TableCell>
              <TableCell>{formatMoney(p.amount, p.currency)}</TableCell>
              <TableCell className="capitalize">{p.paymentMethod?.replace('_', ' ')}</TableCell>
              <TableCell><Badge className={PAYMENT_STATUS_COLORS[p.status] ?? ''}>{p.status}</Badge></TableCell>
              <TableCell className="text-muted-foreground">{p.paidAt ? formatDate(p.paidAt) : '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <PaginationControls page={page} totalPages={data?.pagination.totalPages ?? 1} onChange={setPage} />
    </div>
  );
}

function ExpensesTab() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error, refetch } = useExpenses({ page, pageSize: DEFAULT_PAGE_SIZE });

  if (isLoading) return <Skeleton className="h-64" />;
  if (isError) return <ErrorState message={error instanceof Error ? error.message : 'Failed'} onRetry={() => refetch()} />;

  const expenses = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <AddExpenseDialog />
      </div>

      {expenses.length === 0 ? (
        <EmptyState title="No expenses yet" description="Track your stable expenses here." />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead className="w-[100px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenses.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{e.date}</TableCell>
                  <TableCell><Badge variant="outline" className="capitalize">{e.category}</Badge></TableCell>
                  <TableCell className="max-w-[200px] truncate">{e.description}</TableCell>
                  <TableCell className="text-muted-foreground">{e.vendorName ?? '—'}</TableCell>
                  <TableCell className="font-medium">{formatMoney(e.amount, e.currency)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <EditExpenseDialog expense={e} />
                      <DeleteExpenseButton expense={e} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PaginationControls page={page} totalPages={data?.pagination.totalPages ?? 1} onChange={setPage} />
        </>
      )}
    </div>
  );
}

function EditExpenseDialog({ expense }: { expense: Expense }) {
  const [open, setOpen] = useState(false);
  const updateExpense = useUpdateExpense();

  const form = useForm<UpdateExpenseFormValues, unknown, UpdateExpenseInput>({
    resolver: zodResolver(updateExpenseSchema),
    defaultValues: {
      category: expense.category,
      description: expense.description,
      amount: toMajorUnits(expense.amount, expense.currency),
      currency: expense.currency,
      date: expense.date,
      vendorName: expense.vendorName ?? undefined,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        category: expense.category,
        description: expense.description,
        amount: toMajorUnits(expense.amount, expense.currency),
        currency: expense.currency,
        date: expense.date,
        vendorName: expense.vendorName ?? undefined,
      });
    }
  }, [open, expense, form]);

  async function onSubmit(data: UpdateExpenseInput) {
    try {
      await updateExpense.mutateAsync({ id: expense.id, data });
      toast.success('Expense updated');
      setOpen(false);
    } catch (err) {
      reportMutationError('expense.update', err, { expenseId: expense.id });
      toast.error(err instanceof Error ? err.message : 'Failed to update expense');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" aria-label="Edit expense">
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Expense</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="category" render={({ field }) => (
              <FormItem>
                <FormLabel>Category</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="feed">Feed</SelectItem>
                    <SelectItem value="vet">Vet</SelectItem>
                    <SelectItem value="farrier">Farrier</SelectItem>
                    <SelectItem value="equipment">Equipment</SelectItem>
                    <SelectItem value="utilities">Utilities</SelectItem>
                    <SelectItem value="wages">Wages</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="amount" render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      {...field}
                      value={(field.value as number | undefined) ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="date" render={({ field }) => (
                <FormItem><FormLabel>Date</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="vendorName" render={({ field }) => (
              <FormItem>
                <FormLabel>Vendor</FormLabel>
                <FormControl><Input {...field} value={field.value ?? ''} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <Button type="submit" className="w-full" disabled={updateExpense.isPending}>
              {updateExpense.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteExpenseButton({ expense }: { expense: Expense }) {
  const deleteExpense = useDeleteExpense();

  async function onConfirm() {
    try {
      await deleteExpense.mutateAsync(expense.id);
      toast.success('Expense deleted');
    } catch (err) {
      reportMutationError('expense.delete', err, { expenseId: expense.id });
      toast.error(err instanceof Error ? err.message : 'Failed to delete expense');
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="icon" variant="ghost" aria-label="Delete expense">
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this expense?</AlertDialogTitle>
          <AlertDialogDescription>
            {formatMoney(expense.amount, expense.currency)} — {expense.description}
            <br />This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={deleteExpense.isPending}>
            {deleteExpense.isPending ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function AddExpenseDialog() {
  const [open, setOpen] = useState(false);
  const createExpense = useCreateExpense();

  const form = useForm<CreateExpenseFormValues, unknown, CreateExpenseInput>({
    resolver: zodResolver(createExpenseSchema),
    defaultValues: { category: 'feed', description: '', date: new Date().toISOString().split('T')[0], currency: 'AED' },
  });

  async function onSubmit(data: CreateExpenseInput) {
    try {
      await createExpense.mutateAsync(data);
      toast.success('Expense added');
      form.reset();
      setOpen(false);
    } catch (err) {
      reportMutationError('expense.create', err);
      toast.error(err instanceof Error ? err.message : 'Failed to add expense');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="mr-2 h-4 w-4" />Add Expense</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Expense</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="category" render={({ field }) => (
              <FormItem>
                <FormLabel>Category</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="feed">Feed</SelectItem>
                    <SelectItem value="vet">Vet</SelectItem>
                    <SelectItem value="farrier">Farrier</SelectItem>
                    <SelectItem value="equipment">Equipment</SelectItem>
                    <SelectItem value="utilities">Utilities</SelectItem>
                    <SelectItem value="wages">Wages</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem><FormLabel>Description *</FormLabel><FormControl><Textarea placeholder="What was this expense for?" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="amount" render={({ field }) => (
                <FormItem><FormLabel>Amount *</FormLabel><FormControl><Input type="number" step="0.01" placeholder="e.g. 500" {...field} value={(field.value as number | undefined) ?? ''} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="date" render={({ field }) => (
                <FormItem><FormLabel>Date *</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="vendorName" render={({ field }) => (
              <FormItem><FormLabel>Vendor</FormLabel><FormControl><Input placeholder="e.g. Farm Supply Co." {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <Button type="submit" className="w-full" disabled={createExpense.isPending}>
              {createExpense.isPending ? 'Adding...' : 'Add Expense'}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function CouponsTab() {
  const { data: settings } = useClubSettings();
  // Coupons don't store a currency column; display fixed-amount discounts
  // in the club's configured currency.
  const currency = settings?.data.currency ?? 'AED';
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error, refetch } = useCoupons({ page, pageSize: DEFAULT_PAGE_SIZE });

  if (isLoading) return <Skeleton className="h-64" />;
  if (isError) return <ErrorState message={error instanceof Error ? error.message : 'Failed'} onRetry={() => refetch()} />;

  const coupons = data?.data ?? [];

  const COUPON_STATUS_COLORS: Record<string, string> = {
    active: 'bg-green-100 text-green-800',
    paused: 'bg-yellow-100 text-yellow-800',
    expired: 'bg-gray-100 text-gray-800',
    exhausted: 'bg-red-100 text-red-800',
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <AddCouponDialog />
      </div>

      {coupons.length === 0 ? (
        <EmptyState title="No coupons yet" description="Create promo codes for your riders." />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Discount</TableHead>
                <TableHead>Usage</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {coupons.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono font-bold">{c.code}</TableCell>
                  <TableCell>
                    {c.discountType === 'percentage' ? `${c.discountValue}%` : formatMoney(c.discountValue, currency)}
                  </TableCell>
                  <TableCell>{c.usageCount}{c.maxUses ? ` / ${c.maxUses}` : ''}</TableCell>
                  <TableCell><Badge className={COUPON_STATUS_COLORS[c.status] ?? ''}>{c.status}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{c.expiresAt ? formatDate(c.expiresAt) : 'Never'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PaginationControls page={page} totalPages={data?.pagination.totalPages ?? 1} onChange={setPage} />
        </>
      )}
    </div>
  );
}

function AddCouponDialog() {
  const [open, setOpen] = useState(false);
  const createCoupon = useCreateCoupon();

  const form = useForm<CreateCouponFormValues, unknown, CreateCouponInput>({
    resolver: zodResolver(createCouponSchema),
    defaultValues: { code: '', discountType: 'percentage', firstTimeOnly: false, isStackable: false },
  });

  async function onSubmit(data: CreateCouponInput) {
    try {
      await createCoupon.mutateAsync(data);
      toast.success('Coupon created');
      form.reset();
      setOpen(false);
    } catch (err) {
      reportMutationError('coupon.create', err);
      toast.error(err instanceof Error ? err.message : 'Failed to create coupon');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="mr-2 h-4 w-4" />Create Coupon</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Create Coupon</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="code" render={({ field }) => (
              <FormItem><FormLabel>Code *</FormLabel><FormControl><Input placeholder="e.g. SUMMER25" className="font-mono uppercase" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="discountType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="percentage">Percentage</SelectItem>
                      <SelectItem value="fixed">Fixed Amount</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="discountValue" render={({ field }) => (
                <FormItem><FormLabel>{form.watch('discountType') === 'percentage' ? 'Percentage *' : 'Amount *'}</FormLabel><FormControl><Input type="number" placeholder={form.watch('discountType') === 'percentage' ? 'e.g. 25' : 'e.g. 50'} {...field} value={(field.value as number | undefined) ?? ''} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="maxUses" render={({ field }) => (
                <FormItem><FormLabel>Max Total Uses</FormLabel><FormControl><Input type="number" placeholder="Unlimited" {...field} value={(field.value as number | undefined) ?? ''} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="maxUsesPerRider" render={({ field }) => (
                <FormItem><FormLabel>Max Per Rider</FormLabel><FormControl><Input type="number" placeholder="Unlimited" {...field} value={(field.value as number | undefined) ?? ''} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="startsAt" render={({ field }) => (
                <FormItem><FormLabel>Starts</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="expiresAt" render={({ field }) => (
                <FormItem><FormLabel>Expires</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="flex gap-6">
              <FormField control={form.control} name="firstTimeOnly" render={({ field }) => (
                <FormItem className="flex items-center gap-2"><FormLabel>First-time riders only</FormLabel><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="isStackable" render={({ field }) => (
                <FormItem className="flex items-center gap-2"><FormLabel>Stackable</FormLabel><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>
              )} />
            </div>
            <Button type="submit" className="w-full" disabled={createCoupon.isPending}>
              {createCoupon.isPending ? 'Creating...' : 'Create Coupon'}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
