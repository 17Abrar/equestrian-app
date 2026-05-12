import { Html, Head, Body, Container, Heading, Text, Hr, Section } from '@react-email/components';

interface HorseRegistrationDeclinedProps {
  ownerName: string;
  horseName: string;
  clubName: string;
  reason: string;
}

export function HorseRegistrationDeclined({
  ownerName,
  horseName,
  clubName,
  reason,
}: HorseRegistrationDeclinedProps) {
  return (
    <Html>
      <Head />
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>Registration update for {horseName}</Heading>

          <Text style={styles.greeting}>Hi {ownerName},</Text>

          <Text style={styles.text}>
            We wanted to let you know that {clubName} wasn&apos;t able to accept {horseName}&apos;s
            registration at this time.
          </Text>

          <Section style={styles.card}>
            <Text style={styles.label}>Reason from {clubName}</Text>
            <Text style={styles.reason}>{reason}</Text>
          </Section>

          <Text style={styles.text}>
            If you have questions or think this was a mistake, please reach out to {clubName}{' '}
            directly. You&apos;re welcome to submit a new registration once any issues are resolved.
          </Text>

          <Hr style={styles.hr} />

          <Text style={styles.footer}>Cavaliq</Text>
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
    backgroundColor: '#fffbeb',
    border: '1px solid #fde68a',
    borderRadius: '8px',
    padding: '20px',
    margin: '16px 0',
  },
  label: {
    fontSize: '11px',
    color: '#92400e',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    margin: '0 0 6px',
    fontWeight: '600' as const,
  },
  reason: {
    fontSize: '14px',
    color: '#78350f',
    lineHeight: '22px',
    margin: '0',
    whiteSpace: 'pre-wrap' as const,
  },
  hr: { borderColor: '#e5e7eb', margin: '24px 0' },
  footer: { fontSize: '12px', color: '#9ca3af', lineHeight: '20px' },
};
