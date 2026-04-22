'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { toast } from 'sonner';
import {
  ArrowLeft,
  MapPin,
  Globe,
  Instagram,
  Facebook,
  Compass,
  Users,
  LogIn,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface PublicClub {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  country: string | null;
  timezone: string;
  logoUrl: string | null;
  coverPhotoUrl: string | null;
  shortDescription: string | null;
  description: string | null;
  websiteUrl: string | null;
  socialInstagram: string | null;
  socialFacebook: string | null;
  socialTiktok: string | null;
  joinPolicy: 'open' | 'approval' | 'invite_only';
  brandPrimaryColor: string | null;
  brandSecondaryColor: string | null;
}

export function ClubProfileClient({ club }: { club: PublicClub }) {
  const { isSignedIn, isLoaded } = useUser();
  const router = useRouter();
  const primary = club.brandPrimaryColor ?? '#6366f1';

  const [dialogOpen, setDialogOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [joining, setJoining] = useState(false);

  function openJoinFlow() {
    if (!isLoaded) return;
    if (!isSignedIn) {
      // Clerk handles the return-to redirect automatically when we pass
      // a redirect_url via the sign-up URL.
      const redirectUrl = `/c/${club.slug}?join=1`;
      router.push(`/sign-up?redirect_url=${encodeURIComponent(redirectUrl)}`);
      return;
    }

    if (club.joinPolicy === 'open') {
      void submitJoin(null);
      return;
    }
    // approval — prompt for an optional message
    setDialogOpen(true);
  }

  async function submitJoin(msg: string | null) {
    setJoining(true);
    try {
      const res = await fetch(`/api/v1/clubs/${club.slug}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg ? { message: msg } : {}),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        toast.error(json.error?.message ?? 'Failed to join');
        return;
      }

      if (json.data.status === 'joined' || json.data.status === 'already_member') {
        toast.success(`You're in. Welcome to ${club.name}.`);
        setDialogOpen(false);
        // Send them to the rider dashboard — the layout will route based on role.
        router.push('/rider');
      } else if (json.data.status === 'pending') {
        toast.success(
          'Request sent. The club will review it and email you when they respond.',
        );
        setDialogOpen(false);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error');
    } finally {
      setJoining(false);
    }
  }

  const joinCta =
    club.joinPolicy === 'open'
      ? 'Join instantly'
      : club.joinPolicy === 'approval'
        ? 'Request to join'
        : 'Invite only';

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/discover" className="flex items-center gap-2 text-sm font-medium">
            <ArrowLeft className="h-4 w-4" />
            All clubs
          </Link>
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
            <Compass className="h-4 w-4" />
            Cavaliq
          </Link>
        </div>
      </header>

      <section
        className="relative h-64 w-full overflow-hidden sm:h-80"
        style={{
          backgroundColor: primary,
          backgroundImage: club.coverPhotoUrl ? `url(${club.coverPhotoUrl})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/40" />
      </section>

      <main className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="relative -mt-16 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-end gap-4">
            {club.logoUrl ? (
              <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl border-4 border-background bg-background shadow-md">
                <Image
                  src={club.logoUrl}
                  alt={`${club.name} logo`}
                  width={96}
                  height={96}
                  className="h-full w-full object-cover"
                  unoptimized
                />
              </div>
            ) : (
              <div
                className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border-4 border-background text-3xl font-bold text-white shadow-md"
                style={{ backgroundColor: primary }}
              >
                {club.name[0]}
              </div>
            )}
            <div className="pb-2 text-white drop-shadow-md sm:text-foreground sm:drop-shadow-none">
              <h1 className="text-2xl font-bold sm:text-3xl">{club.name}</h1>
              {(club.city || club.country) && (
                <p className="mt-1 flex items-center gap-1 text-sm">
                  <MapPin className="h-3.5 w-3.5" />
                  {[club.city, club.country].filter(Boolean).join(', ')}
                </p>
              )}
            </div>
          </div>

          <div className="pb-2">
            <Button
              size="lg"
              disabled={club.joinPolicy === 'invite_only' || joining}
              onClick={openJoinFlow}
              style={
                club.joinPolicy !== 'invite_only'
                  ? { backgroundColor: primary }
                  : undefined
              }
            >
              {joining ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Joining…
                </>
              ) : !isLoaded ? (
                'Loading…'
              ) : !isSignedIn && club.joinPolicy !== 'invite_only' ? (
                <>
                  <LogIn className="mr-2 h-4 w-4" />
                  Sign up & {joinCta.toLowerCase()}
                </>
              ) : (
                <>
                  <Users className="mr-2 h-4 w-4" />
                  {joinCta}
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-[1fr_260px]">
          <div className="space-y-4">
            {club.shortDescription && (
              <p className="text-lg text-muted-foreground">{club.shortDescription}</p>
            )}
            {club.description && (
              <Card>
                <CardContent className="whitespace-pre-wrap pt-6 text-sm leading-relaxed">
                  {club.description}
                </CardContent>
              </Card>
            )}
          </div>

          <aside className="space-y-4">
            <Card>
              <CardContent className="space-y-3 pt-6 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Joining policy
                  </p>
                  <p className="mt-1 font-medium">
                    {club.joinPolicy === 'open' && 'Anyone can join instantly'}
                    {club.joinPolicy === 'approval' && 'Membership requires approval'}
                    {club.joinPolicy === 'invite_only' && 'By invitation only'}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Timezone
                  </p>
                  <p className="mt-1 font-medium">{club.timezone}</p>
                </div>

                {(club.websiteUrl ||
                  club.socialInstagram ||
                  club.socialFacebook ||
                  club.socialTiktok) && (
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    {club.websiteUrl && (
                      <a
                        href={club.websiteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Website"
                      >
                        <Badge variant="outline" className="gap-1">
                          <Globe className="h-3 w-3" /> Website
                        </Badge>
                      </a>
                    )}
                    {club.socialInstagram && (
                      <a
                        href={
                          club.socialInstagram.startsWith('http')
                            ? club.socialInstagram
                            : `https://instagram.com/${club.socialInstagram.replace(/^@/, '')}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Instagram"
                      >
                        <Badge variant="outline" className="gap-1">
                          <Instagram className="h-3 w-3" /> Instagram
                        </Badge>
                      </a>
                    )}
                    {club.socialFacebook && (
                      <a
                        href={
                          club.socialFacebook.startsWith('http')
                            ? club.socialFacebook
                            : `https://facebook.com/${club.socialFacebook}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Facebook"
                      >
                        <Badge variant="outline" className="gap-1">
                          <Facebook className="h-3 w-3" /> Facebook
                        </Badge>
                      </a>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      </main>

      <footer className="mt-20 border-t">
        <div className="mx-auto max-w-5xl px-4 py-8 text-sm text-muted-foreground sm:px-6">
          Powered by{' '}
          <Link href="/" className="text-foreground underline-offset-4 hover:underline">
            Cavaliq
          </Link>
        </div>
      </footer>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request to join {club.name}</DialogTitle>
            <DialogDescription>
              A club admin will review your request. You&apos;ll get an email when they
              approve or decline.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">Message (optional)</label>
            <Textarea
              placeholder="Tell them a bit about yourself — experience, goals, why you want to join"
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={1000}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => submitJoin(message.trim() || null)}
              disabled={joining}
              style={{ backgroundColor: primary }}
            >
              {joining ? 'Sending…' : 'Send request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
