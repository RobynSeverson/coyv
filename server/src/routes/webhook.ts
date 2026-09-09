import { Router, raw } from 'express'
import type Stripe from 'stripe'
import { env } from '../env.ts'
import { OrderModel, type OrderDocument } from '../models/Order.ts'
import { ProductModel } from '../models/Product.ts'
import { SubscriptionModel } from '../models/Subscription.ts'
import { stripe } from '../services/stripe.ts'
import {
  ensureOrderFulfillment,
  ensureSubscriptionFulfillment,
} from '../services/fulfillments.ts'
import { applySubscriptionState } from '../services/subscriptions.ts'
import {
  sendOrderConfirmation,
  sendSubscriptionCharge,
} from '../services/email/notifications.ts'

export const webhookRouter: Router = Router()

function toAddress(address: Stripe.Address | null | undefined) {
  if (!address) return null
  return {
    line1: address.line1 ?? '',
    line2: address.line2 ?? '',
    city: address.city ?? '',
    state: address.state ?? '',
    postalCode: address.postal_code ?? '',
    country: address.country ?? '',
  }
}

async function findOrder(intent: Stripe.PaymentIntent): Promise<OrderDocument | null> {
  const byIntent = await OrderModel.findOne({ stripePaymentIntentId: intent.id }).exec()
  if (byIntent) return byIntent

  const orderId = intent.metadata?.orderId
  return orderId ? OrderModel.findById(orderId).exec() : null
}

/* Stock is only ever decremented here, and only once: `fulfilledAt` is the
   guard that makes a replayed webhook a no-op. */
async function applySuccess(intent: Stripe.PaymentIntent): Promise<void> {
  const order = await findOrder(intent)
  if (!order) {
    console.warn(`[webhook] no order for payment intent ${intent.id}`)
    return
  }
  if (order.fulfilledAt) return

  const shipping = intent.shipping

  order.set({
    status: 'paid',
    paidAt: new Date(),
    fulfilledAt: new Date(),
    lastPaymentError: null,
    email: intent.receipt_email ?? order.email,
    shippingName: shipping?.name ?? order.shippingName,
    shippingAddress: toAddress(shipping?.address) ?? order.shippingAddress,
    stripeChargeId:
      typeof intent.latest_charge === 'string' ? intent.latest_charge : (order.stripeChargeId ?? null),
  })
  await order.save()

  await Promise.all(
    order.items.map((item) =>
      ProductModel.updateOne(
        { _id: item.print, stock: { $ne: null } },
        { $inc: { stock: -item.quantity } },
      ).exec(),
    ),
  )

  /* Only paid orders become parcels, and only once — the fulfilledAt guard
     above already made this branch run a single time per order. */
  await ensureOrderFulfillment(order)

  /* Confirmation is best-effort by design: sendEmail never throws, because a
     Brevo outage must not make this webhook fail and replay the stock
     decrement above. */
  await sendOrderConfirmation(order)

  console.log(`[webhook] order ${order._id} paid (${intent.id})`)
}

async function applyFailure(intent: Stripe.PaymentIntent): Promise<void> {
  const order = await findOrder(intent)
  if (!order || order.fulfilledAt) return

  order.set({
    status: 'failed',
    lastPaymentError: intent.last_payment_error?.message ?? 'Payment failed',
  })
  await order.save()
}

async function applyCancellation(intent: Stripe.PaymentIntent): Promise<void> {
  const order = await findOrder(intent)
  if (!order || order.fulfilledAt) return

  order.set({ status: 'canceled' })
  await order.save()
}

async function applyRefund(charge: Stripe.Charge): Promise<void> {
  const intentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : null
  if (!intentId) return

  const order = await OrderModel.findOne({ stripePaymentIntentId: intentId }).exec()
  if (!order) return

  order.set({ status: 'refunded' })
  await order.save()
}

async function applyInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = subscriptionIdFromInvoice(invoice)
  if (!subscriptionId) return

  /* Re-read from Stripe rather than trusting the invoice's snapshot, so the
     status and period always come from one place. */
  const subscription = await stripe.subscriptions.retrieve(subscriptionId)
  const local = await applySubscriptionState(subscription)
  if (!local) return

  /* Every paid invoice is a print to post, including the very first one. */
  const { created, fulfillment } = await ensureSubscriptionFulfillment(
    local,
    invoice.id ?? `sub:${subscriptionId}:${invoice.period_start}`,
    invoice.period_start ?? null,
  )

  /* Only a genuinely new billing period earns a note; a replayed invoice.paid
     finds the row already there and stays quiet. */
  if (created && fulfillment) await sendSubscriptionCharge(fulfillment)
}

async function applyInvoiceFailure(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = subscriptionIdFromInvoice(invoice)
  if (!subscriptionId) return

  const local = await SubscriptionModel.findOne({
    stripeSubscriptionId: subscriptionId,
  }).exec()
  if (!local) return

  local.set({
    status: 'past_due',
    lastPaymentError: 'The card on file was declined.',
  })
  await local.save()
}

/* The link from invoice to subscription moved into the line items when
   `invoice.subscription` was removed, so both shapes are checked. */
function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const direct = (invoice as unknown as { subscription?: string | { id: string } }).subscription
  if (typeof direct === 'string') return direct
  if (direct && typeof direct === 'object') return direct.id

  for (const line of invoice.lines?.data ?? []) {
    const parent = line.parent
    const fromLine = parent?.subscription_item_details?.subscription
    if (typeof fromLine === 'string') return fromLine
    if (fromLine && typeof fromLine === 'object') return (fromLine as { id: string }).id
  }
  return null
}

/* The raw body is required: the signature is computed over the exact bytes
   Stripe sent, so this route must be mounted before any JSON body parser. */
webhookRouter.post('/', raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['stripe-signature']
  if (typeof signature !== 'string') {
    res.status(400).json({ error: 'Missing stripe-signature header' })
    return
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, env.STRIPE_WEBHOOK_SECRET)
  } catch (error) {
    console.warn('[webhook] signature verification failed', error)
    res.status(400).json({ error: 'Invalid signature' })
    return
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await applySuccess(event.data.object)
        break
      case 'payment_intent.payment_failed':
        await applyFailure(event.data.object)
        break
      case 'payment_intent.canceled':
        await applyCancellation(event.data.object)
        break
      case 'charge.refunded':
        await applyRefund(event.data.object)
        break
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await applySubscriptionState(event.data.object)
        break
      case 'invoice.paid':
        await applyInvoicePaid(event.data.object)
        break
      case 'invoice.payment_failed':
        await applyInvoiceFailure(event.data.object)
        break
      default:
        break
    }
  } catch (error) {
    /* A 500 tells Stripe to retry, which is what we want for a transient
       database failure — the handlers above are all idempotent. */
    console.error(`[webhook] failed handling ${event.type}`, error)
    res.status(500).json({ error: 'Webhook handler failed' })
    return
  }

  res.json({ received: true })
})
