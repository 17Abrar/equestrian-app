import {
  Html, Head, Body, Container, Heading, Text, Hr, Button, Section,
} from '@react-email/components';
import { formatCurrency } from '@equestrian/shared/utils';
import { safeHref } from './util/safe-href';

interface LiveryInvoiceOverdueProps {
  ownerName: string;
  horseName: string;
  clubName: string;
  invoiceNumber: string;
  amountMinorUnits: number;
  currency: string;
  dueDate: string;
  daysOverdue: number;
  payLink?: string;
}

export function LiveryInvoiceOverdue({
  ownerName,
  horseName,
  clubName,
  invoiceNumber,
  amountMinorUnits,
  currency,
  dueDate,
  daysOverdue,
  payLink,
}: LiveryInvoiceOverdueProps) {
  const headline =
    daysOverdue >= 30
      ? 'Urgent: livery invoice is 30+ days overdue'
      : daysOverdue >= 14
        ? 'Reminder: livery invoice is two weeks overdue'
        : 'Reminder: livery invoice is overdue';

  return (
    <Html>
      <Head />
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>{headline}</Heading>

          <Text style={styles.greeting}>Hi {ownerName},</Text>

          <Text style={styles.text}>
            {horseName}&apos;s livery invoice from {clubName} is past due.
            Please settle it at your earliest convenience.
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

          <Text style={styles.text}>
            If you&apos;ve already paid, please disregard this reminder. For
            any questions, reach out to {clubName} directly.
          </Text>

          <Hr style={styles.hr} />

          <Text style={styles.footer}>Cavaliq — {clubName}</Text>
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
