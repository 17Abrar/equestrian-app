'use client';

import { Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export default function RiderCommunityPage() {
  return (
    <div className="space-y-6 pb-20 sm:pb-0">
      <div>
        <h1 className="text-2xl font-bold">Community</h1>
        <p className="text-muted-foreground">Connect with fellow riders at your club</p>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent">
            <Users className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="mt-4 text-lg font-semibold">Coming Soon</h3>
          <p className="mt-2 max-w-sm text-center text-sm text-muted-foreground">
            Club discussions, photo sharing, and event updates will be available here.
            Stay tuned!
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
