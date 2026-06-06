import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

interface FaqItem {
  question: string;
  answer: string;
}

const ITEMS: FaqItem[] = [
  {
    question: 'How long does setup take?',
    answer:
      'Most stables finish setup in under an hour. The wizard walks you through arenas, lesson types, pricing, and your payment processor. You can invite your team and start taking bookings the same day.',
  },
  {
    question: 'Do you charge per-booking fees?',
    answer:
      'No. Cavaliq charges a flat monthly subscription per stable. Your payment processor (Stripe, Ziina, or N-Genius) takes its standard fee on each transaction — that money goes straight from rider to you, not through us.',
  },
  {
    question: 'Which payment processors are supported?',
    answer:
      'Stripe, Ziina, and N-Genius. You paste your own keys, so the processor relationship stays yours: your settlement account, your refunds, your dispute handling. We never touch the money.',
  },
  {
    question: 'Can riders book without signing up first?',
    answer:
      'Riders need a Cavaliq account to book — it’s how their progress, horse history, and invoices follow them. Sign-up is free and takes 30 seconds. They can browse your stable on Discover without an account.',
  },
  {
    question: 'Is there a free trial?',
    answer:
      'Yes — 14 days, no credit card required. You can use every feature during the trial. We only ask for payment if you decide to keep going.',
  },
  {
    question: 'Can I cancel any time?',
    answer:
      'Yes. Monthly plans cancel at the end of the current billing cycle. Annual plans (which save you two months) can be cancelled and refunded pro-rata. Your data export is yours to keep.',
  },
  {
    question: 'Is rider and horse data secure?',
    answer:
      'Medical fields (vet diagnoses, medications, rider medical notes) are encrypted at the application layer before storage. Every database query is scoped to your club — no other stable can see your data, full stop.',
  },
  {
    question: 'Do you support multiple currencies?',
    answer:
      'Yes. Cavaliq runs in AED, USD, SAR, EUR, GBP, and other major currencies. Your finance dashboard rolls up per-currency so multi-region stables can see the full picture.',
  },
  {
    question: 'Can coaches, grooms, and owners use Cavaliq?',
    answer:
      'Yes. We support seven distinct roles — club admin, manager, coach, horse owner, rider, parent, and groom — each with a tailored view and permission scope. Add as many team members as you need.',
  },
  {
    question: 'Where is data hosted?',
    answer:
      'On Cloudflare’s global edge network, with the database hosted on Neon (AWS, Singapore region). Cloudflare is SOC 2 Type II certified. We don’t store payment card data ourselves. That goes directly to your payment processor.',
  },
];

export function Faq() {
  return (
    <section id="faq" className="border-b py-20 sm:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="text-center">
          <p className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
            FAQ
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            Questions stables ask before signing up.
          </h2>
        </div>

        <Accordion type="single" collapsible className="mt-10 w-full">
          {ITEMS.map((item, idx) => (
            <AccordionItem key={item.question} value={`item-${idx}`}>
              <AccordionTrigger className="text-left text-base font-medium">
                {item.question}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-sm leading-relaxed">
                {item.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
