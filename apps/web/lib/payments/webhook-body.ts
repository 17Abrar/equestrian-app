import { logger } from '@/lib/logger';

/**
 * Reads a webhook request body with a size cap (audit B-22). Cloudflare
 * Workers buffer up to 100MB of incoming body by default — far more than
 * any legitimate webhook needs. A malicious POST with a 10MB body burns
 * Worker CPU on JSON.parse + HMAC-SHA256 hashing before any signature
 * check rejects it, providing a DoS amplifier.
 *
 * Returns null if the body is over the cap; the route should reply 413.
 */
export async function readWebhookBody(
  request: Request,
  maxBytes: number,
  source: string,
): Promise<string | null> {
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      logger.warn('webhook_body_too_large', {
        source,
        declaredBytes: declared,
        maxBytes,
      });
      return null;
    }
  }

  const body = await request.text();
  // Audit LOW-3 (2026-05-05): use byte length, not JS `.length`
  // (UTF-16 code units). For ASCII the two match; for non-ASCII
  // bodies a UTF-16-pair character counts as 1 in `.length` but
  // 4 in UTF-8, so the previous check was conservative for ASCII
  // and OPTIMISTIC for emoji/CJK payloads. Use `Buffer.byteLength`
  // for the true UTF-8 size that matters at the network boundary.
  const actualBytes = Buffer.byteLength(body, 'utf8');
  if (actualBytes > maxBytes) {
    logger.warn('webhook_body_too_large', {
      source,
      actualBytes,
      maxBytes,
    });
    return null;
  }
  return body;
}

/**
 * Per-provider body-size caps. Tuned to comfortably accommodate every event
 * shape the providers send today (tested by reading provider docs and
 * historical event sizes), with headroom for new fields. Anything larger
 * is virtually guaranteed to be hostile.
 */
export const WEBHOOK_BODY_CAPS = {
  stripe: 64 * 1024, // 64 KB
  clerk: 256 * 1024, // 256 KB — org events with member arrays trend larger
  n_genius: 16 * 1024, // 16 KB
  ziina: 16 * 1024, // 16 KB
} as const;
