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

const _MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB

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
 */
export async function getUploadUrl(params: {
  clubId: string;
  folder: string;
  fileName: string;
  contentType: string;
}) {
  const { clubId, folder, fileName, contentType } = params;

  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
    throw new Error(`File type "${contentType}" is not allowed. Allowed: ${ALLOWED_CONTENT_TYPES.join(', ')}`);
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
  });

  const uploadUrl = await getSignedUrl(client, command, { expiresIn: 300 }); // 5 minutes

  return {
    uploadUrl,
    key,
    publicUrl: `${publicUrl}/${key}`,
  };
}
