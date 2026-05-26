import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function CtaBand() {
  return (
    <section className="border-b" style={{ backgroundColor: '#0d1f34' }}>
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-balance text-white sm:text-4xl">
            Your stable is doing the work. Cavaliq does the paperwork.
          </h2>
          <p className="mt-4 text-lg text-balance text-white/70">
            Start a free trial today — no credit card, no salesperson, no
            commitments. If it doesn’t fit, you walk away.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" variant="secondary" className="w-full sm:w-auto">
              <Link href="/sign-up?as=stable">
                Start free trial
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="ghost"
              className="w-full text-white hover:bg-white/10 hover:text-white sm:w-auto"
            >
              <Link href="/support">Talk to us</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
