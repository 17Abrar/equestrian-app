import {
  Html, Head, Body, Container, Heading, Text, Hr, Section,
} from '@react-email/components';
import { formatCurrency } from '@equestrian/shared/utils';

interface LiveryPaymentReceivedProps {
  ownerName: string;
  horseName: string;
  clubName: string;
  invoiceNumber: string;
  amountMinorUnits: number;
  currency: string;
  paidDate: string;
}

export function LiveryPaymentReceived({
  ownerName,
  horseName,
  clubName,
  invoiceNumber,
  amountMinorUnits,
  currency,
  paidDate,
}: LiveryPaymentReceivedProps) {
  return (
    <Html>
      <Head />
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>Payment received</Heading>

          <Text style={styles.greeting}>Hi {ownerName},</Text>

          <Text style={styles.text}>
            {clubName} has received your livery payment for {horseName}. Thanks!
          </Text>

          <Section style={styles.card}>
            <Text style={styles.label}>Invoice</Text>
            <Text style={styles.value}>{invoiceNumber}</Text>

            <Text style={styles.label}>Amount</Text>
            <Text style={styles.value}>{formatCurrency(amountMinorUnits, currency)}</Text>

            <Text style={styles.label}>Paid on</Text>
            <Text style={styles.value}>{paidDate}</Text>
          </Section>

          <Text style={styles.text}>
            Keep this email as your receipt. Your next livery invoice will
            arrive on {horseName}&apos;s regular billing anniversary.
          </Text>

          <Hr style={styles.hr} />

          <Text style={styles.footer}>
            Cavaliq — {clubName}
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
  heading: { fontSize: '24px', fontWeight: '700' as const, color: '#10b981', marginBottom: '8px' },
  greeting: { fontSize: '16px', color: '#374151', marginBottom: '4px' },
  text: { fontSize: '14px', color: '#6b7280', marginBottom: '16px', lineHeight: '22px' },
  card: {
    backgroundColor: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: '8px',
    padding: '20px',
    margin: '16px 0',
  },
  label: { fontSize: '11px', color: '#166534', textTransform: 'uppercase' as const, letterSpacing: '0.05em', margin: '0 0 2px', fontWeight: '600' as const },
  value: { fontSize: '14px', color: '#064e3b', fontWeight: '500' as const, margin: '0 0 12px' },
  hr: { borderColor: '#e5e7eb', margin: '24px 0' },
  footer: { fontSize: '12px', color: '#9ca3af', lineHeight: '20px' },
};
