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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUpdateSettings, type ClubSettings } from '@/hooks/use-settings';

export function DiscoveryForm({ settings }: { settings: ClubSettings }) {
  const updateSettings = useUpdateSettings();
  const [isPublicListing, setIsPublicListing] = useState(settings.isPublicListing ?? false);
  const [joinPolicy, setJoinPolicy] = useState<'open' | 'approval' | 'invite_only'>(
    (settings.joinPolicy as 'open' | 'approval' | 'invite_only' | undefined) ?? 'invite_only',
  );
  const [shortDescription, setShortDescription] = useState(settings.shortDescription ?? '');

  async function onSave() {
    try {
      await updateSettings.mutateAsync({
        isPublicListing,
        joinPolicy,
        shortDescription: shortDescription.trim() || null,
      });
      toast.success('Discovery settings updated');
    } catch (err) {
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
              <Label htmlFor="is-public">List on the public directory</Label>
              <p className="text-xs text-muted-foreground">
                Shows your club on the /discover page, visible to everyone (including non-members).
              </p>
            </div>
            <Switch
              id="is-public"
              checked={isPublicListing}
              onCheckedChange={setIsPublicListing}
            />
          </div>

          <div className="space-y-2">
            <Label>Join policy</Label>
            <p className="text-xs text-muted-foreground">
              How riders become members when they tap &ldquo;Join&rdquo; on your public profile.
            </p>
            <Select
              value={joinPolicy}
              onValueChange={(v) => setJoinPolicy(v as typeof joinPolicy)}
            >
              <SelectTrigger className="w-full sm:w-80">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">
                  Open — riders join instantly
                </SelectItem>
                <SelectItem value="approval">
                  Approval — you review requests before admitting
                </SelectItem>
                <SelectItem value="invite_only">
                  Invite only — only club-sent invites can join
                </SelectItem>
              </SelectContent>
            </Select>
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
              <Link href={publicUrl} target="_blank" rel="noopener noreferrer">
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
            Use <span className="font-medium">Open</span> join policy while you&apos;re launching
            — friction kills conversion. Switch to <span className="font-medium">Approval</span>{' '}
            once you have a waitlist you need to manage.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
