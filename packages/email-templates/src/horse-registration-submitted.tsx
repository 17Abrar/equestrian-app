import {
  Html, Head, Body, Container, Heading, Text, Hr, Button, Section,
} from '@react-email/components';
import { safeHref } from './util/safe-href';

interface HorseRegistrationSubmittedProps {
  adminName: string;
  horseName: string;
  horseBreed?: string;
  ownerName: string;
  clubName: string;
  reviewUrl: string;
}

export function HorseRegistrationSubmitted({
  adminName,
  horseName,
  horseBreed,
  ownerName,
  clubName,
  reviewUrl,
}: HorseRegistrationSubmittedProps) {
  return (
    <Html>
      <Head />
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>New horse registration</Heading>

          <Text style={styles.greeting}>Hi {adminName},</Text>

          <Text style={styles.text}>
            {ownerName} has registered a new horse at {clubName} and is waiting
            for your approval.
          </Text>

          <Section style={styles.card}>
            <Text style={styles.label}>Horse</Text>
            <Text style={styles.value}>{horseName}{horseBreed ? ` · ${horseBreed}` : ''}</Text>
            <Text style={styles.label}>Owner</Text>
            <Text style={styles.value}>{ownerName}</Text>
          </Section>

          <Text style={styles.text}>
            Review the registration to set the monthly livery fee and
            confirm the start date, or decline with a reason.
          </Text>

          <Section style={{ textAlign: 'center' as const, margin: '24px 0' }}>
            <Button href={safeHref(reviewUrl)} style={styles.button}>
              Review registration
            </Button>
          </Section>

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
