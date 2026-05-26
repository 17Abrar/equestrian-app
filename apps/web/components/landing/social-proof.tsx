import { Shield, MapPin, Clock } from 'lucide-react';

const STATS: Array<{ icon: typeof Shield; label: string; value: string }> = [
  { icon: Shield, label: 'Tenant isolation', value: 'Per-club encrypted at rest' },
  { icon: MapPin, label: 'Region', value: 'GCC-first, multi-currency' },
  { icon: Clock, label: 'Trial', value: '14 days, no card needed' },
];

export function SocialProof() {
  return (
    <section className="border-b py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <p className="text-muted-foreground text-center text-sm font-medium">
          Built with working stables across the region. Designed for the way you
          already run your club — just faster, with fewer mistakes.
        </p>

        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          {STATS.map((stat) => (
            <div
              key={stat.label}
              className="bg-card flex items-center gap-4 rounded-lg border p-5"
            >
              <div className="bg-muted inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                <stat.icon className="h-5 w-5" style={{ color: '#0d1f34' }} aria-hidden />
              </div>
              <div>
                <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {stat.label}
                </p>
                <p className="text-sm font-semibold">{stat.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
