import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b">
      <div className="from-background to-muted/40 absolute inset-0 bg-gradient-to-b" />
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, var(--color-brand) 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      />

      <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28 lg:py-32">
        <div className="mx-auto max-w-3xl text-center">
          <div className="bg-muted text-muted-foreground inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium">
            <Sparkles className="h-3.5 w-3.5" />
            Built for equestrian clubs in the GCC
          </div>

          <h1 className="mt-6 text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
            Run your stable from one place.
          </h1>
          <p className="text-muted-foreground mx-auto mt-5 max-w-2xl text-lg text-balance sm:text-xl">
            Bookings, horses, riders, staff, and payments. Cavaliq replaces the spreadsheets, the
            WhatsApp groups, and the paper diary. Built for equestrian clubs that take their riders,
            horses, and books seriously.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href="/sign-up?as=stable">
                Start free trial
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
              <Link href="/discover">Browse stables</Link>
            </Button>
          </div>

          <p className="text-muted-foreground mt-4 text-xs">
            14-day free trial · No credit card required · Unlimited riders
          </p>
        </div>
      </div>
    </section>
  );
}
