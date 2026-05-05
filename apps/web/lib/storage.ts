import 'server-only';

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from './logger';

const ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

// Hard cap to block terabyte uploads via a leaked presigned URL. Documents
// per CLAUDE.md go up to 25 MB; images are capped at 15 MB. Anything larger
// is rejected outright at the API boundary, before R2 is even told about
// the request. Audit AI-29.
export const MAX_DOCUMENT_SIZE_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_SIZE_BYTES = 15 * 1024 * 1024;

export function maxUploadSizeFor(contentType: string): number {
  return contentType.startsWith('image/')
    ? MAX_IMAGE_SIZE_BYTES
    : MAX_DOCUMENT_SIZE_BYTES;
}

// Folder names: lowercase letters/numbers/underscores, slash-separated segments.
// Prevents path traversal (`../`) and exotic characters from landing in R2 keys.
const ALLOWED_FOLDER_PATTERN = /^[a-z][a-z0-9_]*(\/[a-z][a-z0-9_]*)*$/;

// Permission required for the top-level folder segment.
// Routes should validate this in addition to generic `withAuth` coverage.
export const UPLOAD_FOLDER_PERMISSIONS: Record<string, string> = {
  horses: 'horses:update',
  profile: 'profile:*',
  finances: 'finances:*',
  expenses: 'finances:*',
  competitions: 'competitions:*',
  emails: 'emails:*',
  invoices: 'finances:*',
};

export function getFolderRoot(folder: string): string | null {
  const root = folder.split('/')[0];
  return root && root in UPLOAD_FOLDER_PERMISSIONS ? root : null;
}

function getR2Client() {
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 storage is not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.');
  }

  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

/**
 * Generates a presigned URL for direct client-side upload to R2.
 * The client uploads the file directly to R2 — never through our server.
 *
 * The declared `fileSizeBytes` is bound into the signature via
 * `ContentLength`, so an R2 PUT that doesn't match the signed length is
 * rejected as a signature mismatch. The API layer also caps the declared
 * size at `maxUploadSizeFor(contentType)` before a URL is even issued.
 */
export async function getUploadUrl(params: {
  clubId: string;
  folder: string;
  fileName: string;
  contentType: string;
  fileSizeBytes: number;
}) {
  const { clubId, folder, fileName, contentType, fileSizeBytes } = params;

  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
    throw new Error(`File type "${contentType}" is not allowed. Allowed: ${ALLOWED_CONTENT_TYPES.join(', ')}`);
  }

  if (folder.length > 100 || !ALLOWED_FOLDER_PATTERN.test(folder)) {
    throw new Error('Invalid folder path. Use lowercase segments separated by "/".');
  }

  if (!getFolderRoot(folder)) {
    throw new Error(`Folder "${folder}" is not a known upload target.`);
  }

  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
    throw new Error('File size must be a positive integer.');
  }

  // Branch the cap by content type (audit AI-29). 15 MB for images,
  // 25 MB for documents — matches CLAUDE.md.
  const maxBytes = maxUploadSizeFor(contentType);
  if (fileSizeBytes > maxBytes) {
    const maxMb = Math.floor(maxBytes / (1024 * 1024));
    throw new Error(`File is too large. Maximum size is ${maxMb} MB.`);
  }

  const bucketName = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL;

  if (!bucketName || !publicUrl) {
    throw new Error('R2 storage is not configured. Set R2_BUCKET_NAME and R2_PUBLIC_URL.');
  }

  // Sanitize filename: remove special chars, keep extension
  const safeName = fileName
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .toLowerCase();

  const key = `${clubId}/${folder}/${Date.now()}-${safeName}`;

  const client = getR2Client();

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: contentType,
    ContentLength: fileSizeBytes,
  });

  const uploadUrl = await getSignedUrl(client, command, { expiresIn: 300 }); // 5 minutes

  return {
    uploadUrl,
    key,
    publicUrl: `${publicUrl}/${key}`,
  };
}

// ─── Post-upload magic-byte verification ─────────────────────────────

/**
 * Known magic-byte signatures for the content types we accept. The
 * client declares a content-type at presign time and R2 binds it into
 * the signed headers, but the actual file body isn't inspected. A
 * malicious client can declare `image/jpeg` and PUT arbitrary bytes.
 * `X-Content-Type-Options: nosniff` blocks browser execution, but the
 * object is still hosted at its public R2 URL — this verifier closes
 * that gap by inspecting the first bytes server-side after upload.
 *
 * Entries are ordered longest-prefix-first so a DOCX/ZIP (PK 03 04) is
 * matched before a bare `PK`. Each entry is a concrete byte sequence;
 * wildcards are only used where a format allows variation within a
 * fixed-length header (WebP, WEBP at offset 8).
 */
interface MagicSignature {
  contentType: string;
  /** Sequence of expected bytes; `null` entries match any byte (wildcard). */
  bytes: (number | null)[];
}

const MAGIC_SIGNATURES: MagicSignature[] = [
  { contentType: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  {
    contentType: 'image/png',
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  {
    contentType: 'image/webp',
    // "RIFF" then 4 size bytes (wildcard) then "WEBP"
    bytes: [
      0x52, 0x49, 0x46, 0x46,
      null, null, null, null,
      0x57, 0x45, 0x42, 0x50,
    ],
  },
  // GIF87a / GIF89a share the first 6 bytes only on positions 0-3; the
  // version byte differs. Use the shared prefix "GIF8".
  { contentType: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { contentType: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
  // Legacy .doc (OLE compound document).
  {
    contentType: 'application/msword',
    bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  },
  // .docx is a ZIP container (PK\x03\x04).
  {
    contentType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    bytes: [0x50, 0x4b, 0x03, 0x04],
  },
];

function matchesMagic(bytes: Uint8Array, sig: MagicSignature): boolean {
  if (bytes.length < sig.bytes.length) return false;
  for (let i = 0; i < sig.bytes.length; i++) {
    const expected = sig.bytes[i];
    if (expected === null) continue;
    if (bytes[i] !== expected) return false;
  }
  return true;
}

/** Result of a magic-byte check. `ok === false` means the caller should
 *  delete the R2 object and reject the save operation it was trying to
 *  confirm (e.g. saving the photo URL on a horse record). */
export interface MagicByteResult {
  ok: boolean;
  declaredType: string;
  /** First signature that matched — undefined if nothing matched. */
  detectedType?: string;
}

/**
 * Fetches the first ~16 bytes of a just-uploaded R2 object and confirms
 * they match the declared content type. Non-destructive; the caller
 * decides whether to delete on mismatch (`deleteR2Object`).
 *
 * We intentionally read a tiny range to keep the verifier cheap — R2
 * charges per-GB egress, and a signature check doesn't need more than
 * the header block.
 */
export async function verifyObjectMagicBytes(
  key: string,
  declaredType: string,
): Promise<MagicByteResult> {
  const bucketName = process.env.R2_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('R2_BUCKET_NAME is not configured.');
  }

  const client = getR2Client();
  const response = await client.send(
    new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
      // HTTP range: first 16 bytes is enough to cover every signature above
      // (WebP's is 12 bytes; everything else is ≤8).
      Range: 'bytes=0-15',
    }),
  );

  if (!response.Body) {
    return { ok: false, declaredType };
  }

  // @aws-sdk/client-s3 in Node returns Body with transformToByteArray();
  // on Workers it returns a ReadableStream. Handle both.
  const body = response.Body as {
    transformToByteArray?: () => Promise<Uint8Array>;
  } & ReadableStream;

  let bytes: Uint8Array;
  if (typeof body.transformToByteArray === 'function') {
    bytes = await body.transformToByteArray();
  } else {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
  }

  const match = MAGIC_SIGNATURES.find((sig) => matchesMagic(bytes, sig));
  return {
    ok: match?.contentType === declaredType,
    declaredType,
    detectedType: match?.contentType,
  };
}

/**
 * Removes an object from R2. Used to clean up mis-typed uploads caught by
 * `verifyObjectMagicBytes`. Swallows errors — the object may already be
 * gone, and a failed delete shouldn't block the higher-level operation
 * from returning a clean error to the user. The failure is logged so a
 * sustained R2 outage / permissions regression doesn't leave abuse uploads
 * piling up silently.
 */
export async function deleteR2Object(key: string): Promise<void> {
  const bucketName = process.env.R2_BUCKET_NAME;
  if (!bucketName) return;
  const client = getR2Client();
  try {
    await client.send(
      new DeleteObjectCommand({ Bucket: bucketName, Key: key }),
    );
  } catch (err) {
    logger.warn('r2_delete_failed', {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
