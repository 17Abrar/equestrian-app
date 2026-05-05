import {
  Html, Head, Body, Container, Heading, Text, Hr, Section,
} from '@react-email/components';
import { formatCurrency } from '@equestrian/shared/utils';

interface SubscriptionPaymentReceivedProps {
  recipientName: string;
  clubName: string;
  invoiceNumber: string;
  tier: 'starter' | 'growing' | 'professional';
  amountMinorUnits: number;
  currency: string;
  /** ISO date (YYYY-MM-DD). The cron + webhook both pass `paid_at` as
   *  a string already trimmed to the date portion. */
  paidDate: string;
  /** Inclusive end of the period this payment covers — clubs read this
   *  to confirm what they were charged for. */
  periodEnd: string;
}

const TIER_LABEL = {
  starter: 'Starter',
  growing: 'Growing',
  professional: 'Professional',
} as const;

export function SubscriptionPaymentReceived({
  recipientName,
  clubName,
  invoiceNumber,
  tier,
  amountMinorUnits,
  currency,
  paidDate,
  periodEnd,
}: SubscriptionPaymentReceivedProps) {
  return (
    <Html>
      <Head />
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>Payment received — thank you!</Heading>

          <Text style={styles.greeting}>Hi {recipientName},</Text>

          <Text style={styles.text}>
            We&apos;ve received your Cavaliq subscription payment for{' '}
            <strong>{clubName}</strong>. Your account stays active through{' '}
            {periodEnd}.
          </Text>

          <Section style={styles.card}>
            <Text style={styles.label}>Invoice</Text>
            <Text style={styles.value}>{invoiceNumber}</Text>

            <Text style={styles.label}>Plan</Text>
            <Text style={styles.value}>{TIER_LABEL[tier]}</Text>

            <Text style={styles.label}>Amount paid</Text>
            <Text style={styles.valueLarge}>
              {formatCurrency(amountMinorUnits, currency)}
            </Text>

            <Text style={styles.label}>Paid on</Text>
            <Text style={styles.value}>{paidDate}</Text>
          </Section>

          <Hr style={styles.hr} />

          <Text style={styles.footer}>
            Your next invoice will arrive on the same day next month. You can
            review every invoice in Settings → Subscription.
          </Text>
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
  heading: { fontSize: '24px', fontWeight: '700' as const, color: '#16a34a', marginBottom: '8px' },
  greeting: { fontSize: '16px', color: '#374151', marginBottom: '4px' },
  text: { fontSize: '14px', color: '#6b7280', marginBottom: '16px', lineHeight: '22px' },
  card: {
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    padding: '20px',
    margin: '16px 0',
  },
  label: { fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase' as const, letterSpacing: '0.05em', margin: '0 0 2px' },
  value: { fontSize: '14px', color: '#111827', fontWeight: '500' as const, margin: '0 0 12px' },
  valueLarge: { fontSize: '20px', color: '#16a34a', fontWeight: '700' as const, margin: '0 0 12px' },
  hr: { borderColor: '#e5e7eb', margin: '24px 0' },
  footer: { fontSize: '12px', color: '#9ca3af', lineHeight: '20px' },
};
