import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { MessageSquare } from 'lucide-react';

export default function CommunityPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Community</h1>
        <p className="mt-1 text-muted-foreground">Connect with riders and club members</p>
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <MessageSquare className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <CardTitle>Community Forum</CardTitle>
              <CardDescription>Discussion topics, posts, and club-specific channels are coming soon.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">This feature will include discussion topics, photo sharing, polls, and stable-specific community channels.</p>
        </CardContent>
      </Card>
    </div>
  );
}
