import { z } from 'zod'

/* Everything the server needs is read once, at boot, and validated here so a
   missing key fails loudly on startup instead of at the first request. */

const trimmed = z.string().trim()

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  MONGODB_URI: trimmed.min(1, 'MONGODB_URI is required'),
  MONGODB_DB_NAME: trimmed.default('coyv'),

  /* Where the browser app is served from. Used for CORS and for the URLs
     Stripe redirects back to after a redirect-based payment method. */
  PUBLIC_SITE_URL: trimmed.url().default('http://localhost:5173'),

  /* Signs the admin session cookie. Must be long and secret in production. */
  JWT_SECRET: trimmed.min(32, 'JWT_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),

  STRIPE_SECRET_KEY: trimmed.min(1, 'STRIPE_SECRET_KEY is required'),
  STRIPE_WEBHOOK_SECRET: trimmed.min(1, 'STRIPE_WEBHOOK_SECRET is required'),
  CURRENCY: trimmed.toLowerCase().length(3).default('usd'),

  AWS_REGION: trimmed.default('us-east-1'),
  S3_BUCKET: trimmed.min(1, 'S3_BUCKET is required'),
  AWS_ACCESS_KEY_ID: trimmed.optional(),
  AWS_SECRET_ACCESS_KEY: trimmed.optional(),
  /* Present when the credentials come from an assumed role (Lambda, ECS, EC2).
     Omitting it from an explicit credential pair makes every call fail. */
  AWS_SESSION_TOKEN: trimmed.optional(),
  /* Set for MinIO / LocalStack; left blank real S3 is used. */
  S3_ENDPOINT: trimmed.url().optional(),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  /* How long a generated image URL stays valid. */
  S3_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(15 * 1024 * 1024),
})

const parsed = schema.safeParse(
  /* Docker Compose passes unset variables through as empty strings, which is
     not the same thing as absent: `""` would fail a `.url()` and would shadow
     a default. Treating blanks as missing makes both behave as intended. */
  Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== undefined && value.trim() !== ''),
  ),
)

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n')
  throw new Error(`Invalid environment configuration:\n${issues}`)
}

export const env = parsed.data
export const isProduction = env.NODE_ENV === 'production'
