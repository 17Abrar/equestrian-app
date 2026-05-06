import {
  Html, Head, Body, Container, Heading, Text, Hr, Button, Section,
} from '@react-email/components';
import { formatCurrency } from '@equestrian/shared/utils';
import { safeHref } from './util/safe-href';

/**
 * Round 6.1 — Cavaliq → club admin past-due chase email. Mirrors the
 * livery-invoice-overdue cadence (7/14/30 day) so the platform side
 * doesn't drift from the per-club side. Subject and headline escalate
 * with `daysOverdue`. The day-30 copy explicitly warns about
 * subscription suspension to set expectation; suspension itself is a
 * manual operator decision (Cavaliq-internal admin tool), not auto.
 */
interface SubscriptionInvoiceOverdueProps {
  recipientName: string;
  clubName: string;
  invoiceNumber: string;
  tier: 'starter' | 'growing' | 'professional';
  amountMinorUnits: number;
  currency: string;
  dueDate: string;
  daysOverdue: number;
  payLink?: string;
}

const TIER_LABELS: Record<SubscriptionInvoiceOverdueProps['tier'], string> = {
  starter: 'Starter',
  growing: 'Growing',
  professional: 'Professional',
};

export function SubscriptionInvoiceOverdue({
  recipientName,
  clubName,
  invoiceNumber,
  tier,
  amountMinorUnits,
  currency,
  dueDate,
  daysOverdue,
  payLink,
}: SubscriptionInvoiceOverdueProps) {
  const headline =
    daysOverdue >= 30
      ? 'Final reminder: your Cavaliq subscription is 30+ days overdue'
      : daysOverdue >= 14
        ? 'Cavaliq subscription is two weeks overdue'
        : 'Cavaliq subscription is overdue';

  return (
    <Html>
      <Head />
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>{headline}</Heading>

          <Text style={styles.greeting}>Hi {recipientName},</Text>

          <Text style={styles.text}>
            Your Cavaliq {TIER_LABELS[tier]} subscription invoice for{' '}
            {clubName} is past due. Settle it now to keep your dashboard
            and all rider-facing surfaces (booking, payments, livery
            invoicing, emails) working without interruption.
          </Text>

          <Section style={styles.card}>
            <Text style={styles.label}>Invoice</Text>
            <Text style={styles.value}>{invoiceNumber}</Text>

            <Text style={styles.label}>Amount due</Text>
            <Text style={styles.valueLarge}>{formatCurrency(amountMinorUnits, currency)}</Text>

            <Text style={styles.label}>Was due</Text>
            <Text style={styles.value}>
              {dueDate} · {daysOverdue} day{daysOverdue === 1 ? '' : 's'} ago
            </Text>
          </Section>

          {payLink && (
            <Section style={{ textAlign: 'center' as const, margin: '24px 0' }}>
              <Button href={safeHref(payLink)} style={styles.button}>
                Pay now
              </Button>
            </Section>
          )}

          {daysOverdue >= 30 && (
            <Text style={styles.warning}>
              <strong>Subscription suspension:</strong> accounts that
              remain unpaid past 30 days may be suspended after manual
              review. Reach out to support if you need a payment plan.
            </Text>
          )}

          <Text style={styles.text}>
            Already paid? You can disregard this — the invoice will flip
            to paid automatically once Ziina confirms. If you don&apos;t
            see it update within an hour, refresh Settings → Subscription
            and click the invoice to regenerate the link.
          </Text>

          <Hr style={styles.hr} />

          <Text style={styles.footer}>Cavaliq — equestrian club software</Text>
        </Container>
      </Body>
    </Html>
  );
}

const styles = {
  body: {
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    backgroundColor: '#f9fafb',
    margin: '0',
    padding: '0',
  },
  container: { maxWidth: '600px', margin: '0 auto', padding: '40px 20px' },
  heading: { fontSize: '22px', fontWeight: '700' as const, color: '#b91c1c', marginBottom: '8px' },
  greeting: { fontSize: '16px', color: '#374151', marginBottom: '4px' },
  text: { fontSize: '14px', color: '#6b7280', marginBottom: '16px', lineHeight: '22px' },
  warning: {
    fontSize: '14px',
    color: '#7f1d1d',
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '6px',
    padding: '12px 16px',
    margin: '16px 0',
    lineHeight: '22px',
  },
  card: {
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '8px',
    padding: '20px',
    margin: '16px 0',
  },
  label: { fontSize: '11px', color: '#991b1b', textTransform: 'uppercase' as const, letterSpacing: '0.05em', margin: '0 0 2px', fontWeight: '600' as const },
  value: { fontSize: '14px', color: '#7f1d1d', fontWeight: '500' as const, margin: '0 0 12px' },
  valueLarge: { fontSize: '20px', color: '#b91c1c', fontWeight: '700' as const, margin: '0 0 12px' },
  button: {
    backgroundColor: '#b91c1c',
    color: '#ffffff',
    padding: '12px 24px',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600' as const,
    textDecoration: 'none',
    display: 'inline-block',
  },
  hr: { borderColor: '#e5e7eb', margin: '24px 0' },
  footer: { fontSize: '12px', color: '#9ca3af', lineHeight: '20px' },
};
