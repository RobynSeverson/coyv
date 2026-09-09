import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { env, isProduction } from '../env.ts'
import { HttpError } from '../lib/httpError.ts'
import { AdminUserModel } from '../models/AdminUser.ts'

export const SESSION_COOKIE = 'coyv_admin'

/* Both the admin session and the subscriber "manage" session are signed with
   JWT_SECRET, so they must be distinguishable by more than their cookie name —
   otherwise a subscriber token presented as an admin cookie would verify.
   The audience claim is what keeps them apart, and it is enforced on both
   sides. */
export const ADMIN_AUDIENCE = 'coyv:admin'

type SessionClaims = {
  sub: string
  email: string
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: SessionClaims
    }
  }
}

export function issueSession(res: Response, claims: SessionClaims): void {
  const maxAgeMs = env.SESSION_TTL_HOURS * 60 * 60 * 1000
  const token = jwt.sign(claims, env.JWT_SECRET, {
    expiresIn: `${env.SESSION_TTL_HOURS}h`,
    audience: ADMIN_AUDIENCE,
  })

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    /* Not readable from JS, and not sent on cross-site navigations, which is
       what makes the admin API safe from CSRF without a separate token. */
    sameSite: 'strict',
    secure: isProduction,
    path: '/',
    maxAge: maxAgeMs,
  })
}

export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProduction,
    path: '/',
  })
}

function readSession(req: Request): SessionClaims | null {
  const token = req.cookies?.[SESSION_COOKIE]
  if (typeof token !== 'string' || token.length === 0) return null

  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { audience: ADMIN_AUDIENCE })
    if (typeof payload === 'string' || typeof payload.sub !== 'string') return null
    return { sub: payload.sub, email: String(payload.email ?? '') }
  } catch {
    return null
  }
}

/* Verifying the signature is not enough: an account deleted since the token
   was issued must stop working immediately, so the user is re-read each time. */
export async function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const claims = readSession(req)
  if (!claims) {
    next(HttpError.unauthorized())
    return
  }

  const exists = await AdminUserModel.exists({ _id: claims.sub })
  if (!exists) {
    next(HttpError.unauthorized())
    return
  }

  req.admin = claims
  next()
}

export function currentAdmin(req: Request): SessionClaims | null {
  return readSession(req)
}
