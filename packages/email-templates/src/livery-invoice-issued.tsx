import {
  Html, Head, Body, Container, Heading, Text, Hr, Button, Section,
} from '@react-email/components';
import { formatCurrency } from '@equestrian/shared/utils';
import { safeHref } from './util/safe-href';

interface LiveryInvoiceIssuedProps {
  ownerName: string;
  horseName: string;
  clubName: string;
  invoiceNumber: string;
  periodStart: string;
  periodEnd: string;
  amountMinorUnits: number;
  currency: string;
  dueDate: string;
  payLink?: string;
}

export function LiveryInvoiceIssued({
  ownerName,
  horseName,
  clubName,
  invoiceNumber,
  periodStart,
  periodEnd,
  amountMinorUnits,
  currency,
  dueDate,
  payLink,
}: LiveryInvoiceIssuedProps) {
  return (
    <Html>
      <Head />
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>Livery invoice for {horseName}</Heading>

          <Text style={styles.greeting}>Hi {ownerName},</Text>

          <Text style={styles.text}>
            Your monthly livery invoice from {clubName} is ready.
          </Text>

          <Section style={styles.card}>
            <Text style={styles.label}>Invoice</Text>
            <Text style={styles.value}>{invoiceNumber}</Text>

            <Text style={styles.label}>Period</Text>
            <Text style={styles.value}>{periodStart} → {periodEnd}</Text>

            <Text style={styles.label}>Amount due</Text>
            <Text style={styles.valueLarge}>{formatCurrency(amountMinorUnits, currency)}</Text>

            <Text style={styles.label}>Due by</Text>
            <Text style={styles.value}>{dueDate}</Text>
          </Section>

          {payLink && (
            <Section style={{ textAlign: 'center' as const, margin: '24px 0' }}>
              <Button href={safeHref(payLink)} style={styles.button}>
                Pay now
              </Button>
            </Section>
          )}

          {!payLink && (
            <Text style={styles.text}>
              {clubName} will follow up with payment instructions directly.
            </Text>
          )}

          <Hr style={styles.hr} />

          <Text style={styles.footer}>
            Questions about this invoice? Reach out to {clubName} directly.
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
  heading: { fontSize: '24px', fontWeight: '700' as const, color: '#111827', marginBottom: '8px' },
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
  valueLarge: { fontSize: '20px', color: '#8b5cf6', fontWeight: '700' as const, margin: '0 0 12px' },
  button: {
    backgroundColor: '#8b5cf6',
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
