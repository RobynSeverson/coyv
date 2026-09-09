import { Router } from 'express'
import { z } from 'zod'
import { HttpError } from '../lib/httpError.ts'
import { AdminUserModel, hashPassword, verifyPassword } from '../models/AdminUser.ts'
import { clearSession, currentAdmin, issueSession, requireAdmin } from '../middleware/auth.ts'

export const adminAuthRouter: Router = Router()

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
})

/* A trivial in-memory throttle. It is not a substitute for a WAF, but it does
   stop an unattended script from grinding through a password list. */
const attempts = new Map<string, { count: number; firstAt: number }>()
const WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 10

function throttle(key: string): void {
  const now = Date.now()
  const record = attempts.get(key)

  if (!record || now - record.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now })
    return
  }

  record.count += 1
  if (record.count > MAX_ATTEMPTS) {
    throw new HttpError(429, 'Too many attempts, try again later')
  }
}

adminAuthRouter.post('/login', async (req, res) => {
  const { email, password } = credentialsSchema.parse(req.body)
  throttle(req.ip ?? 'unknown')

  const user = await AdminUserModel.findOne({ email }).select('+passwordHash').exec()

  /* Same message and roughly the same work either way, so the response does
     not reveal which admin emails exist. */
  const ok = user ? await verifyPassword(password, user.passwordHash) : false
  if (!user || !ok) throw HttpError.unauthorized('Invalid email or password')

  attempts.delete(req.ip ?? 'unknown')

  user.set({ lastLoginAt: new Date() })
  await user.save()

  issueSession(res, { sub: String(user._id), email: user.email })
  res.json({ admin: { id: String(user._id), email: user.email, displayName: user.displayName } })
})

adminAuthRouter.post('/logout', (_req, res) => {
  clearSession(res)
  res.json({ ok: true })
})

/* Used by the admin shell on load to decide whether to show the login form.
   Deliberately not behind requireAdmin so it can answer "no" with a 200. */
adminAuthRouter.get('/me', async (req, res) => {
  const claims = currentAdmin(req)
  if (!claims) {
    res.json({ admin: null })
    return
  }

  const user = await AdminUserModel.findById(claims.sub).exec()
  if (!user) {
    clearSession(res)
    res.json({ admin: null })
    return
  }

  res.json({ admin: { id: String(user._id), email: user.email, displayName: user.displayName } })
})

adminAuthRouter.post('/password', requireAdmin, async (req, res) => {
  const body = z
    .object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(12, 'Use at least 12 characters').max(200),
    })
    .parse(req.body)

  const user = await AdminUserModel.findById(req.admin!.sub).select('+passwordHash').exec()
  if (!user) throw HttpError.unauthorized()

  if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
    throw HttpError.unauthorized('Current password is incorrect')
  }

  user.set({ passwordHash: await hashPassword(body.newPassword) })
  await user.save()

  res.json({ ok: true })
})
