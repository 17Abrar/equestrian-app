'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { toast } from 'sonner';
import { reportMutationError } from '@/components/shared/report-mutation-error';
import { fetchJson } from '@/lib/fetch-json';
import { ArrowLeft, MapPin, Globe, Instagram, Facebook, Users, LogIn, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CavaliqLogo } from '@/components/brand/cavaliq-logo';

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
  joinPolicy: 'open' | 'invite_only';
  brandPrimaryColor: string | null;
  brandSecondaryColor: string | null;
}

export function ClubProfileClient({ club }: { club: PublicClub }) {
  const { isSignedIn, isLoaded } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const primary = club.brandPrimaryColor ?? '#6366f1';

  const [joining, setJoining] = useState(false);

  function openJoinFlow() {
    if (!isLoaded) return;
    if (club.joinPolicy !== 'open') return; // button is disabled already
    if (!isSignedIn) {
      // After sign-up, bounce back here with ?join=1 so we can auto-submit.
      const redirectUrl = `/c/${club.slug}?join=1`;
      router.push(`/sign-up?redirect_url=${encodeURIComponent(redirectUrl)}`);
      return;
    }
    void submitJoin();
  }

  async function submitJoin() {
    setJoining(true);
    try {
      // audit L-2 (2026-05-05) — switched from raw fetch + .json() to
      // fetchJson<T>. The Cloudflare workerd types correctly type
      // `Response.json(): Promise<unknown>` (the prior `Promise<any>`
      // was a lie); fetchJson wraps the validation + cast.
      const json = await fetchJson<{
        success: true;
        data: { status: 'joined' | 'already_member' | string };
      }>(`/api/v1/clubs/${club.slug}/join`, { method: 'POST' });

      if (json.data.status === 'joined' || json.data.status === 'already_member') {
        toast.success(`You're in. Welcome to ${club.name}.`);
        router.push('/rider');
      }
    } catch (err) {
      reportMutationError('public.club.join', err, { slug: club.slug });
      toast.error(err instanceof Error ? err.message : 'Failed to join');
    } finally {
      setJoining(false);
    }
  }

  // Audit 2026-05-13 (P1): post-signup auto-join. `openJoinFlow` redirects
  // unauthenticated visitors through `/sign-up?redirect_url=/c/[slug]?join=1`
  // so they land back here after creating an account. Previously the `?join=1`
  // flag was set but never read — the rider had to manually click Join again.
  // Now: once Clerk finishes loading and confirms the user is signed in, fire
  // submitJoin() automatically and strip the query param so a page refresh
  // doesn't re-trigger.
  const hasAutoJoinedRef = useRef(false);
  useEffect(() => {
    if (hasAutoJoinedRef.current) return;
    if (!isLoaded || !isSignedIn) return;
    if (searchParams.get('join') !== '1') return;
    if (club.joinPolicy !== 'open') return;
    if (joining) return;
    hasAutoJoinedRef.current = true;
    // Clear ?join=1 first so a refresh after the user lands on /rider doesn't
    // re-fire on the back button. Use replace so this doesn't add to history.
    router.replace(pathname);
    void submitJoin();
    // submitJoin is stable for the lifetime of this component; intentionally
    // omitted from deps to avoid re-firing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, searchParams, club.joinPolicy, joining, pathname]);

  const joinCta = club.joinPolicy === 'open' ? 'Join stable' : 'Invite only';

  return (
    <div className="bg-background min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/discover" className="flex items-center gap-2 text-sm font-medium">
            <ArrowLeft className="h-4 w-4" />
            All clubs
          </Link>
          <Link href="/" aria-label="Cavaliq home">
            <CavaliqLogo height={28} />
          </Link>
        </div>
      </header>

      {/*
        Audit 2026-05-13 (P2): cover image now goes through next/image
        (Pitfall 10) instead of an inline `style.backgroundImage`. The
        previous markup fetched the full-resolution R2 object on every
        page view — bad LCP on the public club page. `fill` + `sizes`
        let Next pick a width-appropriate variant and `priority` is
        intentionally omitted (the LCP candidate is the heading below,
        not the cover banner).
      */}
      <section
        className="relative h-64 w-full overflow-hidden sm:h-80"
        style={{ backgroundColor: primary }}
      >
        {club.coverPhotoUrl && (
          <Image
            src={club.coverPhotoUrl}
            alt=""
            fill
            sizes="100vw"
            className="object-cover"
            unoptimized
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/40" />
      </section>

      <main className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="relative -mt-16 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-end gap-4">
            {club.logoUrl ? (
              <div className="border-background bg-background h-24 w-24 shrink-0 overflow-hidden rounded-xl border-4 shadow-md">
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
                className="border-background flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border-4 text-3xl font-bold text-white shadow-md"
                style={{ backgroundColor: primary }}
              >
                {club.name[0]}
              </div>
            )}
            <div className="sm:text-foreground pb-2 text-white drop-shadow-md sm:drop-shadow-none">
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
              style={club.joinPolicy !== 'invite_only' ? { backgroundColor: primary } : undefined}
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
              <p className="text-muted-foreground text-lg">{club.shortDescription}</p>
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
                  <p className="text-muted-foreground text-xs uppercase tracking-wide">Joining</p>
                  <p className="mt-1 font-medium">
                    {club.joinPolicy === 'open' ? 'Open — anyone can join' : 'Invitation only'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs uppercase tracking-wide">Timezone</p>
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
        <div className="text-muted-foreground mx-auto max-w-5xl px-4 py-8 text-sm sm:px-6">
          Powered by{' '}
          <Link href="/" className="text-foreground underline-offset-4 hover:underline">
            Cavaliq
          </Link>
        </div>
      </footer>
    </div>
  );
}
