import { env } from '../../env.ts'
import { isPastDue } from '../../lib/serialize.ts'
import { FulfillmentModel, type FulfillmentDocument } from '../../models/Fulfillment.ts'
import { sendEmail } from './brevo.ts'
import { adminDigest, type DigestEntry } from './templates.ts'

const DAY_MS = 24 * 60 * 60 * 1000

/* The digest is a daily summary, so its dedupe key is the day. A retried
   schedule, a double-fire, or a manual run on the same date all collapse onto
   the same key and only the first one sends. */
function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10)
}

function waitingDays(fulfillment: FulfillmentDocument, now: Date): number {
  const created = fulfillment.createdAt as Date | undefined
  if (!created) return 0
  return Math.max(0, Math.floor((now.getTime() - created.getTime()) / DAY_MS))
}

/* A subscription parcel is only meaningful with its month attached: "October
   2026 — heavenly dispatch" says which charge this print is owed against,
   which is the difference between a to-do and a puzzle. One-off orders are
   identified by their contents instead. */
function label(fulfillment: FulfillmentDocument): string {
  if (fulfillment.kind === 'subscription' && fulfillment.periodLabel) {
    return `${fulfillment.periodLabel} — ${fulfillment.title}`
  }
  return fulfillment.title
}

function recipientOf(fulfillment: FulfillmentDocument): string {
  return fulfillment.shippingName?.trim() || fulfillment.email || 'unknown recipient'
}

export type DigestOutcome = {
  status: 'sent' | 'skipped' | 'failed'
  reason?: string
  total: number
  pastDueCount: number
  collapsed: boolean
}

/* Sends the one-a-day "here is what you owe the post office" email.
   Deliberately silent when the queue is empty: an email that says "nothing to
   do" every morning trains you to ignore the ones that matter. */
export async function sendFulfillmentDigest(now = new Date()): Promise<DigestOutcome> {
  const pending = await FulfillmentModel.find({ status: 'pending' })
    .sort({ createdAt: 1 })
    .exec()

  const total = pending.length
  const pastDueCount = pending.filter((entry) => isPastDue(entry, now)).length

  const collapsed = total > env.DIGEST_MAX_ITEMS

  if (total === 0) {
    return { status: 'skipped', reason: 'queue-empty', total, pastDueCount, collapsed: false }
  }

  if (env.ADMIN_NOTIFICATION_EMAILS.length === 0) {
    console.warn('[digest] ADMIN_NOTIFICATION_EMAILS is empty, nothing to notify')
    return { status: 'skipped', reason: 'no-recipients', total, pastDueCount, collapsed }
  }

  const entries: DigestEntry[] = collapsed
    ? []
    : pending.map((fulfillment) => ({
        label: label(fulfillment),
        recipient: recipientOf(fulfillment),
        waitingDays: waitingDays(fulfillment, now),
        pastDue: isPastDue(fulfillment, now),
      }))

  const template = adminDigest({ entries, total, pastDueCount, collapsed })

  const result = await sendEmail({
    kind: 'fulfillment-digest',
    dedupeKey: `fulfillment-digest:${dayKey(now)}`,
    to: env.ADMIN_NOTIFICATION_EMAILS.map((email) => ({ email })),
    ...template,
  })

  return {
    status: result.status === 'sent' ? 'sent' : result.status === 'failed' ? 'failed' : 'skipped',
    reason: result.status === 'skipped' ? result.reason : undefined,
    total,
    pastDueCount,
    collapsed,
  }
}
