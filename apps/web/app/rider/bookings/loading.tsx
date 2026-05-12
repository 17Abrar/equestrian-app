import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function RiderBookingsLoading() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-1 h-4 w-56" />
      </div>
      <div className="flex gap-2 border-b pb-2">
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-16" />
        <Skeleton className="h-7 w-20" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="flex items-center gap-3 p-4">
              <Skeleton className="h-5 w-5 rounded-full" />
              <div className="flex-1">
                <Skeleton className="mb-2 h-4 w-2/5" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-3 w-10" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
