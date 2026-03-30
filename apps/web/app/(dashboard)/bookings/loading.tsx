import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function BookingsLoading() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-9 w-40" />
        <Skeleton className="mt-1 h-5 w-64" />
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-10 w-[180px]" />
        <Skeleton className="h-10 w-[160px]" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="flex items-center gap-4">
                <Skeleton className="h-12 w-12 rounded-lg" />
                <div className="flex-1">
                  <Skeleton className="mb-2 h-5 w-1/3" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
                <Skeleton className="h-6 w-20" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
