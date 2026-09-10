import { Router } from 'express'
import { timingSafeEqual } from 'node:crypto'
import { env } from '../env.ts'
import { HttpError } from '../lib/httpError.ts'
import { sendFulfillmentDigest } from '../services/email/digest.ts'

export const tasksRouter: Router = Router()

/* Constant-time so the secret cannot be recovered by timing the comparison.
   Lengths are compared first because timingSafeEqual throws on a mismatch. */
function matchesSecret(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/* These endpoints are called by a scheduler, not a person, so they carry a
   shared secret rather than the admin session cookie. An unset secret denies
   everything: a scheduled job that silently runs unauthenticated is worse
   than one that does not run. */
tasksRouter.use((req, _res, next) => {
  if (!env.TASKS_SECRET) {
    throw HttpError.notFound('Not found')
  }

  const provided = req.header('x-tasks-secret')
  if (!provided || !matchesSecret(provided, env.TASKS_SECRET)) {
    throw HttpError.unauthorized('Invalid task secret')
  }

  next()
})

/* Safe to call more than once a day: the digest dedupes on the date, so a
   retried schedule reports "already sent" rather than mailing twice. */
tasksRouter.post('/daily-digest', async (_req, res) => {
  const outcome = await sendFulfillmentDigest()
  res.json(outcome)
})
