import { Router } from 'express'
import { z } from 'zod'
import { env } from '../env.ts'
import { HttpError } from '../lib/httpError.ts'
import { serializeSubscription } from '../lib/serialize.ts'
import { FulfillmentModel } from '../models/Fulfillment.ts'
import { SubscriptionModel, type SubscriptionDocument } from '../models/Subscription.ts'
import { sendManageLink } from '../services/email/notifications.ts'
import {
  MANAGE_COOKIE,
  clearManageSession,
  createManageToken,
  issueManageSession,
  readManageSession,
  redeemManageToken,
} from '../services/manageTokens.ts'
import { stripe } from '../services/stripe.ts'

export const manageRouter: Router = Router()

/* Statuses a subscriber can still act on. A canceled or expired subscription
   is history and is shown read-only. */
const LIVE_STATUSES = ['active', 'trialing', 'past_due', 'unpaid', 'paused'] as const

function isLive(subscription: SubscriptionDocument): boolean {
  return (LIVE_STATUSES as readonly string[]).includes(subscription.status)
}

/* A deliberately small throttle on link requests. Without it this endpoint is
   a free email cannon pointed at any address somebody types in. */
const requests = new Map<string, { count: number; firstAt: number }>()
const WINDOW_MS = 15 * 60 * 1000
const MAX_REQUESTS = 5

function throttle(key: string): void {
  const now = Date.now()
  const record = requests.get(key)

  if (!record || now - record.firstAt > WINDOW_MS) {
    requests.set(key, { count: 1, firstAt: now })
    return
  }

  record.count += 1
  if (record.count > MAX_REQUESTS) {
    throw new HttpError(429, 'Too many requests, try again in a little while')
  }
}

const emailSchema = z.object({ email: z.string().trim().toLowerCase().email() })

/* Always answers the same way whether or not the address has a subscription.
   Saying "no subscription found" would turn this into a way to test which
   email addresses are customers. */
manageRouter.post('/request-link', async (req, res) => {
  const { email } = emailSchema.parse(req.body)

  throttle(req.ip ?? 'unknown')
  throttle(`email:${email}`)

  const subscription = await SubscriptionModel.findOne({
    email,
    status: { $in: LIVE_STATUSES },
  }).exec()

  if (subscription) {
    const token = await createManageToken(email, req.ip ?? null)
    const link = `${env.PUBLIC_SITE_URL}/manage-subscription?token=${encodeURIComponent(token)}`
    await sendManageLink(email, link)
  } else {
    console.log(`[manage] link requested for ${email} with no live subscription`)
  }

  res.json({ ok: true })
})

/* Spends the emailed link and swaps it for a short-lived session cookie. The
   token only ever travels in the URL once; from here on the cookie is the
   credential, so a shared or logged link is not a standing key. */
manageRouter.post('/redeem', async (req, res) => {
  const { token } = z.object({ token: z.string().min(1).max(500) }).parse(req.body)

  const email = await redeemManageToken(token)
  if (!email) throw HttpError.unauthorized('That link has expired or has already been used')

  issueManageSession(res, email)
  res.json({ ok: true, email })
})

manageRouter.post('/signout', (_req, res) => {
  clearManageSession(res)
  res.json({ ok: true })
})

/* Every route below this line requires the redeemed session. */
function requireSubscriber(req: { cookies?: Record<string, unknown> }): string {
  const email = readManageSession(req.cookies?.[MANAGE_COOKIE])
  if (!email) throw HttpError.unauthorized('Please request a new link')
  return email
}

async function ownedSubscription(email: string, id: string): Promise<SubscriptionDocument> {
  /* Scoped by email as well as id, so a session for one subscriber can never
     address another's subscription by guessing an id. */
  const subscription = await SubscriptionModel.findOne({ _id: id, email }).exec()
  if (!subscription) throw HttpError.notFound('No such subscription')
  return subscription
}

manageRouter.get('/subscriptions', async (req, res) => {
  const email = requireSubscriber(req)

  const subscriptions = await SubscriptionModel.find({ email })
    .sort({ createdAt: -1 })
    .exec()

  res.json({
    email,
    subscriptions: subscriptions.map((subscription) => ({
      ...serializeSubscription(subscription),
      shippingName: subscription.shippingName,
      shippingAddress: subscription.shippingAddress,
      manageable: isLive(subscription),
    })),
  })
})

const addressSchema = z.object({
  shippingName: z.string().trim().min(1).max(120),
  shippingAddress: z.object({
    line1: z.string().trim().min(1).max(200),
    line2: z.string().trim().max(200).default(''),
    city: z.string().trim().min(1).max(120),
    state: z.string().trim().max(120).default(''),
    postalCode: z.string().trim().min(1).max(32),
    country: z.string().trim().length(2).toUpperCase(),
  }),
})

manageRouter.patch('/subscriptions/:id/address', async (req, res) => {
  const email = requireSubscriber(req)
  const body = addressSchema.parse(req.body)
  const subscription = await ownedSubscription(email, req.params.id)

  subscription.set({
    shippingName: body.shippingName,
    shippingAddress: body.shippingAddress,
  })
  await subscription.save()

  /* Keep Stripe's copy in step so receipts and dispute evidence match. */
  if (subscription.stripeCustomerId) {
    await stripe.customers
      .update(subscription.stripeCustomerId, {
        shipping: {
          name: body.shippingName,
          address: {
            line1: body.shippingAddress.line1,
            line2: body.shippingAddress.line2 || undefined,
            city: body.shippingAddress.city,
            state: body.shippingAddress.state || undefined,
            postal_code: body.shippingAddress.postalCode,
            country: body.shippingAddress.country,
          },
        },
      })
      .catch((cause: unknown) => {
        console.warn(`[manage] could not update Stripe customer shipping`, cause)
      })
  }

  /* A parcel that has not gone out yet must follow the new address, otherwise
     the change silently applies only from next month and this month's print
     goes to the old house. Already-sent parcels keep their historical address. */
  const moved = await FulfillmentModel.updateMany(
    { subscription: subscription._id, status: 'pending' },
    { $set: { shippingName: body.shippingName, shippingAddress: body.shippingAddress } },
  ).exec()

  res.json({
    subscription: {
      ...serializeSubscription(subscription),
      shippingName: subscription.shippingName,
      shippingAddress: subscription.shippingAddress,
      manageable: isLive(subscription),
    },
    pendingParcelsUpdated: moved.modifiedCount,
  })
})

/* Cancelling stops the next charge but leaves the month already paid for
   intact — they are owed that print. Stripe stays the source of truth; the
   local mirror is updated from its response. */
manageRouter.post('/subscriptions/:id/cancel', async (req, res) => {
  const email = requireSubscriber(req)
  const subscription = await ownedSubscription(email, req.params.id)

  if (!isLive(subscription)) throw HttpError.badRequest('That subscription has already ended')

  const remote = await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    cancel_at_period_end: true,
  })

  subscription.set({
    cancelAtPeriodEnd: remote.cancel_at_period_end ?? true,
    status: remote.status,
  })
  await subscription.save()

  res.json({ subscription: serializeSubscription(subscription) })
})

/* The mirror image, so a misclick does not cost somebody their subscription
   and an email to the studio to put it back. */
manageRouter.post('/subscriptions/:id/resume', async (req, res) => {
  const email = requireSubscriber(req)
  const subscription = await ownedSubscription(email, req.params.id)

  if (!isLive(subscription)) throw HttpError.badRequest('That subscription has already ended')

  const remote = await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    cancel_at_period_end: false,
  })

  subscription.set({
    cancelAtPeriodEnd: remote.cancel_at_period_end ?? false,
    status: remote.status,
  })
  await subscription.save()

  res.json({ subscription: serializeSubscription(subscription) })
})
