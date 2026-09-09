import { Router, raw } from 'express'
import type Stripe from 'stripe'
import { env } from '../env.ts'
import { OrderModel, type OrderDocument } from '../models/Order.ts'
import { PrintModel } from '../models/Print.ts'
import { stripe } from '../services/stripe.ts'

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
      PrintModel.updateOne(
        { _id: item.print, stock: { $ne: null } },
        { $inc: { stock: -item.quantity } },
      ).exec(),
    ),
  )

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
