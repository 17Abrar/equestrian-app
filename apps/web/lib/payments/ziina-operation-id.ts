import { createHash } from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function toZiinaIdempotencyUuid(idempotencyKey: string): string {
  if (UUID_PATTERN.test(idempotencyKey)) {
    return idempotencyKey.toLowerCase();
  }

  const chars = createHash('sha256')
    .update(`cavaliq:ziina-operation:${idempotencyKey}`)
    .digest('hex')
    .slice(0, 32)
    .split('');
  chars[12] = '5';
  const variantNibble = Number.parseInt(chars[16] ?? '0', 16);
  chars[16] = ((variantNibble & 0x3) | 0x8).toString(16);

  return [
    chars.slice(0, 8).join(''),
    chars.slice(8, 12).join(''),
    chars.slice(12, 16).join(''),
    chars.slice(16, 20).join(''),
    chars.slice(20, 32).join(''),
  ].join('-');
}
