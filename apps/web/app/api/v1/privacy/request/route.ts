import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { errorResponse, successResponse } from '@/lib/api-utils';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';
import { sendOperationalEmailAsync } from '@/lib/email-support';
import { logger } from '@/lib/logger';

const PRIVACY_INBOX = 'info@cavaliq.com';

const dsarSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(254),
    requestType: z.enum(['access', 'rectification', 'deletion', 'restriction', 'portability', 'objection', 'other']),
    details: z.string().trim().min(20).max(4000),
    relationship: z.enum(['self', 'parent', 'authorized', 'other']).default('self'),
    clubName: z.string().trim().max(200).optional(),
  })
  .strict();

const REQUEST_TYPE_LABEL: Record<z.infer<typeof dsarSchema>['requestType'], string> = {
  access: 'Access (copy of data)',
  rectification: 'Rectification (correction)',
  deletion: 'Deletion / erasure',
  restriction: 'Restriction of processing',
  portability: 'Portability (data export)',
  objection: 'Objection to processing',
  other: 'Other',
};

/**
 * Public DSAR (Data Subject Access Request) intake. Anyone can submit
 * — including people whose data is in Cavaliq but who don't have an
 * account. Rate-limited per IP (5 / 1h) so it can't be used as an email-
 * relay against info@cavaliq.com.
 *
 * Identity verification happens out-of-band: the privacy team replies to
 * the email address and asks for proof before fulfilling. That manual
 * reply is ALSO the first email the requester receives — we deliberately
 * do NOT send an automated acknowledgement to the submitted address,
 * because the address is attacker-controlled and an auto-reply would
 * make this endpoint a low-volume harassment / brand-mediated spam
 * vector. In-browser confirmation is the only feedback returned to the
 * submitter at intake time.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  const rl = await checkRateLimit(`privacy:request:${ip}`, {
    maxRequests: 5,
    windowMs: 60 * 60 * 1000,
    failClosed: true,
  });
  if (!rl.allowed) {
    const retryAfter = Math.ceil((rl.retryAfterMs ?? 1000) / 1000);
    return errorResponse(
      'RATE_LIMITED',
      'Too many requests from this address. Please try again later.',
      429,
      { retryAfter },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('INVALID_JSON', 'Body must be valid JSON', 400);
  }
  const parsed = dsarSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      'VALIDATION_ERROR',
      'Please check the form fields and try again',
      400,
      parsed.error.flatten(),
    );
  }
  const data = parsed.data;

  const opsBody = [
    'Privacy / DSAR request received via the public form.',
    '',
    `Name: ${data.name}`,
    `Email: ${data.email}`,
    `Relationship: ${data.relationship}`,
    `Request type: ${REQUEST_TYPE_LABEL[data.requestType]}`,
    data.clubName ? `Club referenced: ${data.clubName}` : '',
    `IP: ${ip}`,
    `Submitted at: ${new Date().toISOString()}`,
    '',
    '--- Details ---',
    data.details,
    '---',
    '',
    'Action required:',
    '  1. Verify the requester is who they say they are before disclosing or acting on data.',
    '  2. If this is operational data belonging to a club, coordinate with that club',
    '     (the club is the controller; Cavaliq is processor under the DPA).',
    '  3. Respond within 30 days (GDPR) or the applicable timeline.',
  ]
    .filter(Boolean)
    .join('\n');

  sendOperationalEmailAsync({
    to: PRIVACY_INBOX,
    subject: `[Cavaliq] Privacy request — ${REQUEST_TYPE_LABEL[data.requestType]} — ${data.name}`,
    text: opsBody,
    replyTo: data.email,
  });

  // No automated email back to data.email: the submitter address is
  // attacker-controlled at this point (no auth, no prior relationship
  // required) and an auto-reply would turn this endpoint into a low-
  // volume harassment vector for arbitrary "Cavaliq privacy request"
  // emails. The privacy team's manual reply (using replyTo above) is the
  // first email the requester receives. In-browser confirmation
  // (successResponse below) is the only feedback returned at intake.

  logger.info('privacy_request_received', {
    requestType: data.requestType,
    relationship: data.relationship,
    email: data.email,
    ip,
  });

  return successResponse({ received: true });
}
