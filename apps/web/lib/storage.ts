import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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
// per CLAUDE.md go up to 25 MB; anything larger is rejected outright at the
// API boundary, before R2 is even told about the request.
export const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024;

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
 * size at MAX_UPLOAD_SIZE_BYTES before a URL is even issued.
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

  if (fileSizeBytes > MAX_UPLOAD_SIZE_BYTES) {
    const maxMb = Math.floor(MAX_UPLOAD_SIZE_BYTES / (1024 * 1024));
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
