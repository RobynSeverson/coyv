import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import jwt from 'jsonwebtoken'
import type { Response } from 'express'
import { env, isProduction } from '../env.ts'
import { ManageTokenModel } from '../models/ManageToken.ts'

export const MANAGE_COOKIE = 'coyv_manage'
/* Distinct from ADMIN_AUDIENCE so a subscriber session can never be presented
   as an admin one, even though both are signed with JWT_SECRET. */
export const MANAGE_AUDIENCE = 'coyv:manage'

const TOKEN_TTL_MINUTES = 20
const SESSION_TTL_MINUTES = 30

/* 32 random bytes, base64url. The link *is* the credential, so it has to be
   long enough that guessing is hopeless — which is also why this is a link
   rather than a 6-digit code somebody could brute-force. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createManageToken(
  email: string,
  requestedByIp: string | null,
): Promise<string> {
  const token = generateToken()

  await ManageTokenModel.create({
    tokenHash: hashToken(token),
    email: email.toLowerCase().trim(),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000),
    requestedByIp,
  })

  return token
}

/* Spends the link. Returns the email it was issued to, or null if it is
   unknown, expired or already used — the caller must not distinguish between
   those cases to the client. */
export async function redeemManageToken(token: string): Promise<string | null> {
  if (typeof token !== 'string' || token.length < 20) return null

  /* Atomic: the filter requires the token still be unused, so two concurrent
     redemptions of the same link cannot both succeed. */
  const record = await ManageTokenModel.findOneAndUpdate(
    {
      tokenHash: hashToken(token),
      usedAt: null,
      expiresAt: { $gt: new Date() },
    },
    { $set: { usedAt: new Date() } },
    { new: true },
  ).exec()

  return record?.email ?? null
}

export function issueManageSession(res: Response, email: string): void {
  const token = jwt.sign({ email: email.toLowerCase() }, env.JWT_SECRET, {
    expiresIn: `${SESSION_TTL_MINUTES}m`,
    audience: MANAGE_AUDIENCE,
  })

  res.cookie(MANAGE_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProduction,
    path: '/',
    maxAge: SESSION_TTL_MINUTES * 60 * 1000,
  })
}

export function clearManageSession(res: Response): void {
  res.clearCookie(MANAGE_COOKIE, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProduction,
    path: '/',
  })
}

export function readManageSession(cookie: unknown): string | null {
  if (typeof cookie !== 'string' || cookie.length === 0) return null

  try {
    const payload = jwt.verify(cookie, env.JWT_SECRET, { audience: MANAGE_AUDIENCE })
    if (typeof payload === 'string') return null
    const email = payload.email
    return typeof email === 'string' && email.length > 0 ? email.toLowerCase() : null
  } catch {
    return null
  }
}

/* Constant-time compare, used where a caller supplies a value that is checked
   against a stored one. */
export function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
