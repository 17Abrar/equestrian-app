interface Step {
  number: string;
  title: string;
  description: string;
}

const STEPS: Step[] = [
  {
    number: '01',
    title: 'Sign up your stable',
    description:
      'Five-minute setup wizard. Add your arenas, lesson types, and pricing. Connect your payment processor with your own keys.',
  },
  {
    number: '02',
    title: 'Invite your team and your riders',
    description:
      'Coaches, grooms, owners, and riders each get the view that fits their role. Riders can also self-join by finding your club on Discover.',
  },
  {
    number: '03',
    title: 'Run your week',
    description:
      'Bookings, payments, horse care, and emails flow through one place. You spend Sunday planning, not reconciling spreadsheets.',
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-b py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
            How it works
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            Up and running in an afternoon.
          </h2>
          <p className="text-muted-foreground mt-4 text-lg text-balance">
            Most stables finish setup the same day they sign up. We don’t make you talk to a
            salesperson to try us.
          </p>
        </div>

        <ol className="mt-14 grid gap-8 sm:grid-cols-3">
          {STEPS.map((step) => (
            <li key={step.number} className="relative">
              <div className="text-brand text-4xl font-bold tracking-tight" aria-hidden>
                {step.number}
              </div>
              <h3 className="mt-3 text-lg font-semibold">{step.title}</h3>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                {step.description}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
