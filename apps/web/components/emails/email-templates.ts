/**
 * Task #22 (2026-05-28): canned starter templates for the Compose form.
 *
 * Intentionally a static module rather than a DB-backed table — every
 * club starts from the same gallery, edits are local to the compose
 * draft, and there's no operator surface that asks for persistence.
 * If a club requests custom saved templates later, add a `templates`
 * table and merge in DB rows here.
 *
 * Placeholders use `{{double-curly}}` markers that the operator fills
 * in manually before hitting send. We deliberately do NOT do
 * server-side substitution — these are starter prompts, not templated
 * sends. Keeping it dumb avoids accidental leakage of the wrong
 * field.
 */

export interface EmailTemplate {
  id: string;
  /** Short human label shown in the gallery. */
  label: string;
  /** Longer description so admins know what the template is for. */
  description: string;
  /** Pre-fills the Subject input. */
  subject: string;
  /** Pre-fills the Body textarea. Use \n for line breaks. */
  body: string;
}

export const EMAIL_TEMPLATES: ReadonlyArray<EmailTemplate> = [
  {
    id: 'welcome',
    label: 'Welcome',
    description: 'Greet a new rider after their first booking.',
    subject: 'Welcome to {{club name}}',
    body: [
      'Hi {{first name}},',
      '',
      'Welcome to {{club name}}! We are excited to have you join us for your first lesson on {{date}}.',
      '',
      'A few things to know before you arrive:',
      '• Please arrive 15 minutes before your scheduled start.',
      '• Bring closed-toe footwear with a small heel and long trousers.',
      '• Helmets are provided, but bring your own if you have one fitted.',
      '',
      'If you have any questions, just reply to this email and one of our team will get back to you.',
      '',
      'See you soon,',
      'The {{club name}} team',
    ].join('\n'),
  },
  {
    id: 'lesson_reminder',
    label: 'Lesson reminder',
    description: 'Nudge for a rider with a booking tomorrow.',
    subject: 'Reminder: your lesson tomorrow at {{time}}',
    body: [
      'Hi {{first name}},',
      '',
      'This is a friendly reminder that you have a lesson booked with us tomorrow ({{date}}) at {{time}}.',
      '',
      'If you can no longer make it, please reply to this email at least {{cancellation hours}} hours in advance so we can offer the spot to another rider.',
      '',
      'See you in the arena,',
      'The {{club name}} team',
    ].join('\n'),
  },
  {
    id: 'monthly_update',
    label: 'Monthly newsletter',
    description: 'Community newsletter to your active rider list.',
    subject: '{{club name}} — {{month}} news',
    body: [
      'Hi {{first name}},',
      '',
      "Here's what's happening at {{club name}} this month:",
      '',
      "🐎 What's new",
      '• [Add a short highlight here]',
      '',
      '📅 Upcoming events',
      '• [Add upcoming clinics, shows, or club days]',
      '',
      '🎉 Rider shout-outs',
      '• [Add congratulations or milestones]',
      '',
      'See you at the stables,',
      'The {{club name}} team',
    ].join('\n'),
  },
  {
    id: 'invoice_reminder',
    label: 'Invoice reminder',
    description: 'Polite nudge for an outstanding livery or lesson invoice.',
    subject: 'A small reminder about your invoice',
    body: [
      'Hi {{first name}},',
      '',
      'We noticed that invoice #{{invoice number}} for {{amount}} is still showing as unpaid in our system.',
      '',
      "If you've already settled it, please ignore this note. Otherwise, you can pay through your account at {{payment link}}.",
      '',
      "If you have any questions about the invoice, just reply and we'll be happy to help.",
      '',
      'Thanks,',
      'The {{club name}} team',
    ].join('\n'),
  },
  {
    id: 'weather_cancel',
    label: 'Weather cancellation',
    description: 'Cancel scheduled lessons due to weather.',
    subject: 'Lessons cancelled today due to weather',
    body: [
      'Hi {{first name}},',
      '',
      "Because of {{weather condition}}, we've decided to cancel all lessons today for the safety of our horses and riders.",
      '',
      'Your booked lesson at {{time}} will be automatically rescheduled — you should receive a separate confirmation with the new date shortly.',
      '',
      "We're sorry for the disruption. Thank you for understanding!",
      '',
      'The {{club name}} team',
    ].join('\n'),
  },
];
