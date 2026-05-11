import { Html, Head, Body, Container, Heading, Text, Hr, Img } from '@react-email/components';

interface WelcomeRiderProps {
  riderName: string;
  clubName: string;
  clubLogo?: string;
}

export function WelcomeRider({ riderName, clubName, clubLogo }: WelcomeRiderProps) {
  return (
    <Html>
      <Head />
      <Body style={styles.body}>
        <Container style={styles.container}>
          {clubLogo && <Img src={clubLogo} alt={clubName} width={120} style={styles.logo} />}

          <Heading style={styles.heading}>Welcome to {clubName}!</Heading>

          <Text style={styles.greeting}>Hi {riderName},</Text>

          <Text style={styles.text}>
            You&apos;ve been added as a rider at {clubName}. We&apos;re excited to have you!
          </Text>

          <Text style={styles.text}>Here&apos;s what you can do:</Text>

          <Text style={styles.listItem}>🐴 Browse available lessons and book your first ride</Text>
          <Text style={styles.listItem}>📅 Check the schedule for upcoming classes</Text>
          <Text style={styles.listItem}>📊 Track your progress and skill development</Text>
          <Text style={styles.listItem}>👥 Connect with coaches and fellow riders</Text>

          <Hr style={styles.hr} />

          <Text style={styles.footer}>
            If you have any questions, don&apos;t hesitate to reach out to {clubName}. We look
            forward to seeing you at the stable!
          </Text>

          <Text style={styles.clubName}>{clubName}</Text>
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
  logo: { marginBottom: '24px' },
  heading: { fontSize: '24px', fontWeight: '700' as const, color: '#111827', marginBottom: '8px' },
  greeting: { fontSize: '16px', color: '#374151', marginBottom: '4px' },
  text: { fontSize: '14px', color: '#6b7280', marginBottom: '16px', lineHeight: '22px' },
  listItem: { fontSize: '14px', color: '#374151', margin: '8px 0', lineHeight: '22px' },
  hr: { borderColor: '#e5e7eb', margin: '24px 0' },
  footer: { fontSize: '12px', color: '#9ca3af', lineHeight: '20px' },
  clubName: { fontSize: '12px', color: '#9ca3af', fontWeight: '600' as const, marginTop: '16px' },
};
