import {
  Html, Head, Body, Container, Heading, Text, Hr, Button, Section,
} from '@react-email/components';
import { formatCurrency } from '@equestrian/shared/utils';
import { safeHref } from './util/safe-href';

interface HorseRegistrationApprovedProps {
  ownerName: string;
  horseName: string;
  clubName: string;
  clubCurrency: string;
  monthlyLiveryFeeMinor: number;
  liveryStartDate: string;
  portalUrl: string;
}

export function HorseRegistrationApproved({
  ownerName,
  horseName,
  clubName,
  clubCurrency,
  monthlyLiveryFeeMinor,
  liveryStartDate,
  portalUrl,
}: HorseRegistrationApprovedProps) {
  const feeDisplay = monthlyLiveryFeeMinor === 0
    ? 'No livery fee'
    : formatCurrency(monthlyLiveryFeeMinor, clubCurrency);

  return (
    <Html>
      <Head />
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>{horseName} is approved</Heading>

          <Text style={styles.greeting}>Hi {ownerName},</Text>

          <Text style={styles.text}>
            Good news — {clubName} has approved {horseName}&apos;s registration.
            Your horse is now officially stabled with them.
          </Text>

          <Section style={styles.card}>
            <Text style={styles.label}>Monthly livery fee</Text>
            <Text style={styles.valueLarge}>{feeDisplay}</Text>

            <Text style={styles.label}>Livery starts</Text>
            <Text style={styles.value}>{liveryStartDate}</Text>
          </Section>

          {monthlyLiveryFeeMinor > 0 && (
            <Text style={styles.text}>
              You&apos;ll receive a monthly invoice from {clubName} for the
              livery fee starting {liveryStartDate}.
            </Text>
          )}

          <Section style={{ textAlign: 'center' as const, margin: '24px 0' }}>
            <Button href={safeHref(portalUrl)} style={styles.button}>
              View in portal
            </Button>
          </Section>

          <Hr style={styles.hr} />

          <Text style={styles.footer}>
            Any questions? Reach out to {clubName} directly.
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
