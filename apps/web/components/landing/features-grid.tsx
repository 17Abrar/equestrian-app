import {
  Calendar,
  PawPrint,
  Sparkles,
  CreditCard,
  Mail,
  Users,
  Smartphone,
  Building2,
  type LucideIcon,
} from 'lucide-react';

interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
}

const FEATURES: Feature[] = [
  {
    icon: Calendar,
    title: 'Bookings that don’t double-book',
    description:
      'Capacity-aware calendar with atomic slot allocation. Drag-and-drop scheduling, recurring lessons, and waitlists that auto-fill when seats free up.',
  },
  {
    icon: PawPrint,
    title: 'Horse profiles with everything in one place',
    description:
      'Health records, medications, feeding plans, exercise schedules, documents. Vet visits and farrier dates ping the right people automatically.',
  },
  {
    icon: Sparkles,
    title: 'Smart horse matching',
    description:
      'Match riders to horses by skill, weight, history, and temperament. No more guessing who rides Bella today, or stacking your best horse with a beginner.',
  },
  {
    icon: CreditCard,
    title: 'Payments your way',
    description:
      'Use Stripe, Ziina, or N-Genius — paste your own keys, keep your processor relationship. Refunds, invoicing, and per-currency rollups handled for you.',
  },
  {
    icon: Mail,
    title: 'Email that pays attention',
    description:
      'Booking confirmations, payment receipts, vet reminders, and trial-ending nudges send themselves. Compose one-off announcements when something matters.',
  },
  {
    icon: Users,
    title: 'Riders, owners, staff — each with their own view',
    description:
      'Coaches see their lessons. Owners see their horses. Riders see what they’ve booked. Grooms see today’s tasks. One platform, role-aware everywhere.',
  },
  {
    icon: Smartphone,
    title: 'Native mobile app for riders',
    description:
      'Riders book, pay, and track progress from iOS and Android. Their profile follows them — ride at multiple stables, one account, one history.',
  },
  {
    icon: Building2,
    title: 'Multi-stable by design',
    description:
      'Run two or three stables under one login. Each club has its own books, branding, and team — your data never crosses tenants.',
  },
];

export function FeaturesGrid() {
  return (
    <section id="features" className="border-b py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
            What’s inside
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            Everything a working stable actually needs.
          </h2>
          <p className="text-muted-foreground mt-4 text-lg text-balance">
            We built Cavaliq with stables, not for them. Every feature exists
            because a real club asked for it.
          </p>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="bg-card flex flex-col rounded-xl border p-6 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="bg-muted inline-flex h-10 w-10 items-center justify-center rounded-lg">
                <feature.icon className="h-5 w-5" style={{ color: '#0d1f34' }} aria-hidden />
              </div>
              <h3 className="mt-4 text-base font-semibold">{feature.title}</h3>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
