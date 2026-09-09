import { randomUUID } from 'node:crypto'
import path from 'node:path'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from '../env.ts'

/* Credentials are intentionally left to the default provider chain when the
   explicit pair is absent, so the container can use an instance/task role. */
export const s3 = new S3Client({
  region: env.AWS_REGION,
  ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  ...(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
    ? {
        credentials: {
          accessKeyId: env.AWS_ACCESS_KEY_ID,
          secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
          ...(env.AWS_SESSION_TOKEN ? { sessionToken: env.AWS_SESSION_TOKEN } : {}),
        },
      }
    : {}),
})

export const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
])

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
}

/* Uploads are named by us, never by the client: an attacker-supplied filename
   is a path-traversal and content-type-confusion vector. */
export function buildObjectKey(prefix: string, contentType: string, originalName?: string): string {
  const extension =
    EXTENSION_BY_TYPE[contentType] ??
    (originalName ? path.extname(originalName).toLowerCase().slice(0, 8) : '') ??
    ''
  const safePrefix = prefix.replace(/[^a-z0-9/_-]/gi, '').replace(/^\/+|\/+$/g, '')
  return `${safePrefix}/${randomUUID()}${extension}`
}

export async function uploadObject(params: {
  key: string
  body: Buffer
  contentType: string
}): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      CacheControl: 'private, max-age=31536000, immutable',
    }),
  )
}

export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }))
}

/* Presigning is a signature computation, not a network call, but it is async
   in the SDK. Results are cached until shortly before they expire so a page
   of prints does not redo the work on every request. */
const urlCache = new Map<string, { url: string; expiresAt: number }>()
const CACHE_SAFETY_MARGIN_MS = 60_000

export async function getSignedObjectUrl(key: string): Promise<string> {
  const cached = urlCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.url

  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }), {
    expiresIn: env.S3_SIGNED_URL_TTL_SECONDS,
  })

  urlCache.set(key, {
    url,
    expiresAt: Date.now() + env.S3_SIGNED_URL_TTL_SECONDS * 1000 - CACHE_SAFETY_MARGIN_MS,
  })
  return url
}

export function invalidateSignedUrl(key: string): void {
  urlCache.delete(key)
}
