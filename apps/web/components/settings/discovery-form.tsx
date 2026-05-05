'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ExternalLink, Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useUpdateSettings, type ClubSettings } from '@/hooks/use-settings';
import { reportMutationError } from '@/components/shared/report-mutation-error';
import { safeHref } from '@/lib/safe-href';

export function DiscoveryForm({ settings }: { settings: ClubSettings }) {
  const updateSettings = useUpdateSettings();
  const [isPublicListing, setIsPublicListing] = useState(settings.isPublicListing ?? false);
  // Only two modes now: public-listed = open to everyone, private = invite-only.
  // The "approval" policy was removed — the user wants zero gatekeeping on joins.
  const [joinPolicy, setJoinPolicy] = useState<'open' | 'invite_only'>(
    settings.joinPolicy === 'open' ? 'open' : 'invite_only',
  );
  const [shortDescription, setShortDescription] = useState(settings.shortDescription ?? '');

  function handlePublicToggle(next: boolean) {
    setIsPublicListing(next);
    // Turning the public listing on defaults to "open" so riders can join
    // without friction. Turning it off assumes "invite only" (the club isn't
    // advertised anywhere).
    setJoinPolicy(next ? 'open' : 'invite_only');
  }

  async function onSave() {
    try {
      await updateSettings.mutateAsync({
        isPublicListing,
        joinPolicy,
        shortDescription: shortDescription.trim() || null,
      });
      toast.success('Discovery settings updated');
    } catch (err) {
      reportMutationError('settings.discovery.save', err);
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    }
  }

  const publicUrl = `/c/${settings.slug}`;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Compass className="h-5 w-5" />
            Public Discovery
          </CardTitle>
          <CardDescription>
            Let riders find your club on the public directory. When enabled, your club appears on{' '}
            <Link href="/discover" className="underline">
              /discover
            </Link>{' '}
            and has a shareable profile page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="is-public">Let riders discover and join instantly</Label>
              <p className="text-xs text-muted-foreground">
                Your club appears on the public stable directory at{' '}
                <code className="rounded bg-muted px-1">/discover</code>, and any signed-in
                rider can join with one tap — no approval step. Turn this off to keep the club
                invite-only.
              </p>
            </div>
            <Switch
              id="is-public"
              checked={isPublicListing}
              onCheckedChange={handlePublicToggle}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="short-description">Short description</Label>
            <p className="text-xs text-muted-foreground">
              Up to 280 characters. Shown on club cards in the directory.
            </p>
            <Textarea
              id="short-description"
              rows={3}
              maxLength={280}
              placeholder="One line that makes a rider want to join."
              value={shortDescription}
              onChange={(e) => setShortDescription(e.target.value)}
            />
            <p className="text-right text-xs text-muted-foreground">
              {shortDescription.length} / 280
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg bg-muted/30 p-4">
            <div>
              <p className="text-sm font-medium">Your public URL</p>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                cavaliq.com{publicUrl}
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href={safeHref(publicUrl)} target="_blank" rel="noopener noreferrer">
                Preview
                <ExternalLink className="ml-2 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>

          <div className="flex justify-end">
            <Button onClick={onSave} disabled={updateSettings.isPending}>
              {updateSettings.isPending ? 'Saving...' : 'Save discovery settings'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sharing tips</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Turn discovery on before sharing your profile link on Instagram, Facebook, or
            WhatsApp. Posts with your club&apos;s logo and cover photo drive the most joins.
          </p>
          <p>
            Keep public discovery on while you&apos;re launching — friction kills conversion. Turn
            it off to make the club <span className="font-medium">Invite only</span> when you
            want to vet riders manually before they can book.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
