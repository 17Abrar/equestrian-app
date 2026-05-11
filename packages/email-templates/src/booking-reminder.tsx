import {
  Html,
  Head,
  Body,
  Container,
  Heading,
  Text,
  Hr,
  Section,
  Img,
} from '@react-email/components';

interface BookingReminderProps {
  riderName: string;
  lessonType: string;
  date: string;
  time: string;
  horseName?: string;
  coachName?: string;
  arena?: string;
  clubName: string;
  clubLogo?: string;
}

export function BookingReminder({
  riderName,
  lessonType,
  date,
  time,
  horseName,
  coachName,
  arena,
  clubName,
  clubLogo,
}: BookingReminderProps) {
  return (
    <Html>
      <Head />
      <Body style={styles.body}>
        <Container style={styles.container}>
          {clubLogo && <Img src={clubLogo} alt={clubName} width={120} style={styles.logo} />}

          <Heading style={styles.heading}>Lesson Reminder</Heading>

          <Text style={styles.greeting}>Hi {riderName},</Text>
          <Text style={styles.text}>Just a reminder — your lesson is coming up tomorrow!</Text>

          <Section style={styles.detailsBox}>
            <Text style={styles.detailRow}>
              <strong>Lesson:</strong> {lessonType}
            </Text>
            <Text style={styles.detailRow}>
              <strong>Date:</strong> {date}
            </Text>
            <Text style={styles.detailRow}>
              <strong>Time:</strong> {time}
            </Text>
            {horseName && (
              <Text style={styles.detailRow}>
                <strong>Horse:</strong> {horseName}
              </Text>
            )}
            {coachName && (
              <Text style={styles.detailRow}>
                <strong>Coach:</strong> {coachName}
              </Text>
            )}
            {arena && (
              <Text style={styles.detailRow}>
                <strong>Arena:</strong> {arena}
              </Text>
            )}
          </Section>

          <Text style={styles.text}>
            Please arrive 15 minutes early. Wear appropriate riding gear and bring water.
          </Text>

          <Hr style={styles.hr} />

          <Text style={styles.footer}>
            Need to cancel? Please let us know at least 24 hours in advance.
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
  text: { fontSize: '14px', color: '#6b7280', marginBottom: '24px', lineHeight: '22px' },
  detailsBox: {
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '20px',
    marginBottom: '24px',
  },
  detailRow: { fontSize: '14px', color: '#374151', margin: '4px 0' },
  hr: { borderColor: '#e5e7eb', margin: '24px 0' },
  footer: { fontSize: '12px', color: '#9ca3af', lineHeight: '20px' },
  clubName: { fontSize: '12px', color: '#9ca3af', fontWeight: '600' as const, marginTop: '16px' },
};
