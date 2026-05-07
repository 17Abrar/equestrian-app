// Audit F-5 (2026-05-07 r5): per-list content-shape skeletons for the
// horse-management subtabs. These replace the previous bare
// `<Skeleton className="h-N" />` rectangles which read as "still
// fetching the entire panel" and caused a visible layout shift when
// real rows arrived. Each helper mirrors the Card/Row/Table shell the
// real content uses (cf. HorseCardSkeleton in apps/web/app/rider/horses
// and FinanceRowListSkeleton in components/finances/finances-page).
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface SkeletonCountProps {
  rows?: number;
}

// Health-records table skeleton: matches the 7-column table (Date, Type,
// Title, Vet, Cost, Follow-up, action) inside the same Card+CardHeader
// shell so the title + add button stay anchored while rows fade in.
export function HealthRecordsTableSkeleton({ rows = 4 }: SkeletonCountProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-9 w-32" />
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead><Skeleton className="h-3 w-12" /></TableHead>
              <TableHead><Skeleton className="h-3 w-12" /></TableHead>
              <TableHead><Skeleton className="h-3 w-12" /></TableHead>
              <TableHead><Skeleton className="h-3 w-12" /></TableHead>
              <TableHead><Skeleton className="h-3 w-12" /></TableHead>
              <TableHead><Skeleton className="h-3 w-16" /></TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: rows }).map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                <TableCell><Skeleton className="h-8 w-8 rounded-md" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// Medication card-list skeleton: matches the medication "row card"
// shape (name + dosage line + times-of-day badges, action buttons on
// the right).
export function MedicationListSkeleton({ rows = 3 }: SkeletonCountProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <Skeleton className="h-5 w-32" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-36" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {Array.from({ length: rows }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
                <Skeleton className="h-4 w-24" />
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-8 w-16" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// Feeding-plan list skeleton.
export function FeedingPlanListSkeleton({ rows = 3 }: SkeletonCountProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-9 w-28" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {Array.from({ length: rows }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-12 rounded-full" />
                </div>
                <Skeleton className="h-3 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-8 w-8 rounded-md" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// Exercise-schedule grid skeleton: 7 day-column cards (Sun-Sat) with
// 1-2 placeholder rows each. Mirrors the real grid's responsive layout.
export function ExerciseScheduleSkeleton() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-9 w-32" />
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="rounded-lg border p-3">
              <Skeleton className="mb-2 h-4 w-20" />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                  <Skeleton className="h-6 w-6 rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// Documents row-list skeleton.
export function DocumentsListSkeleton({ rows = 4 }: SkeletonCountProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <Skeleton className="h-5 w-32" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-32" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {Array.from({ length: rows }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
              </div>
              <Skeleton className="h-8 w-8 rounded-md" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// Livery invoices table skeleton (6-column table inside the InvoicesCard).
export function LiveryInvoicesTableSkeleton({ rows = 4 }: SkeletonCountProps) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead><Skeleton className="h-3 w-16" /></TableHead>
            <TableHead><Skeleton className="h-3 w-16" /></TableHead>
            <TableHead><Skeleton className="h-3 w-16" /></TableHead>
            <TableHead><Skeleton className="h-3 w-16" /></TableHead>
            <TableHead><Skeleton className="h-3 w-12" /></TableHead>
            <TableHead className="text-right">
              <Skeleton className="ml-auto h-3 w-16" />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }).map((_, i) => (
            <TableRow key={i}>
              <TableCell><Skeleton className="h-4 w-24" /></TableCell>
              <TableCell><Skeleton className="h-4 w-32" /></TableCell>
              <TableCell><Skeleton className="h-4 w-16" /></TableCell>
              <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
              <TableCell><Skeleton className="h-4 w-20" /></TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Skeleton className="h-7 w-7 rounded" />
                  <Skeleton className="h-7 w-7 rounded" />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
