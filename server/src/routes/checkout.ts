import { Router } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import { env } from '../env.ts'
import { HttpError } from '../lib/httpError.ts'
import { serializeOrder } from '../lib/serialize.ts'
import { OrderModel } from '../models/Order.ts'
import { PrintModel } from '../models/Print.ts'
import { stripe } from '../services/stripe.ts'

export const checkoutRouter: Router = Router()

const MAX_QUANTITY_PER_ITEM = 10
const MAX_DISTINCT_ITEMS = 20

const cartSchema = z.object({
  /* An existing pending order can be re-priced instead of leaving a trail of
     abandoned intents behind every time the basket changes. */
  orderId: z.string().regex(/^[a-f0-9]{24}$/).optional(),
  items: z
    .array(
      z.object({
        printId: z.string().regex(/^[a-f0-9]{24}$/, 'Invalid print id'),
        quantity: z.number().int().min(1).max(MAX_QUANTITY_PER_ITEM),
      }),
    )
    .min(1)
    .max(MAX_DISTINCT_ITEMS),
})

/* Prices are looked up server-side, always. Whatever amount the client thinks
   something costs is irrelevant — it never reaches Stripe. */
async function priceCart(items: { printId: string; quantity: number }[]) {
  const merged = new Map<string, number>()
  for (const item of items) {
    merged.set(item.printId, (merged.get(item.printId) ?? 0) + item.quantity)
  }

  for (const [printId, quantity] of merged) {
    if (quantity > MAX_QUANTITY_PER_ITEM) {
      throw HttpError.badRequest(`At most ${MAX_QUANTITY_PER_ITEM} of any one print per order`, {
        printId,
      })
    }
  }

  const ids = [...merged.keys()].map((id) => new mongoose.Types.ObjectId(id))
  const prints = await PrintModel.find({ _id: { $in: ids }, published: true }).exec()

  if (prints.length !== merged.size) {
    throw HttpError.badRequest('One or more prints are unavailable')
  }

  const lineItems = prints.map((print) => {
    const quantity = merged.get(String(print._id)) ?? 0

    if (print.stock !== null && print.stock !== undefined && print.stock < quantity) {
      throw HttpError.conflict(`"${print.title}" only has ${print.stock} left`, {
        printId: String(print._id),
        available: print.stock,
      })
    }

    if (print.currency !== env.CURRENCY) {
      throw HttpError.conflict('Cart mixes currencies')
    }

    return {
      print: print._id,
      slug: print.slug,
      title: print.title,
      unitAmountCents: print.priceCents,
      quantity,
      imageKey: print.images[0]?.key ?? null,
    }
  })

  const amountTotalCents = lineItems.reduce(
    (total, item) => total + item.unitAmountCents * item.quantity,
    0,
  )

  if (amountTotalCents <= 0) throw HttpError.badRequest('Cart total must be greater than zero')

  return { lineItems, amountTotalCents }
}

/* Creates (or re-prices) the PaymentIntent that the Payment Element on the
   client confirms. Returns only the client secret and the computed total. */
checkoutRouter.post('/intent', async (req, res) => {
  const body = cartSchema.parse(req.body)
  const { lineItems, amountTotalCents } = await priceCart(body.items)

  if (body.orderId) {
    const existing = await OrderModel.findById(body.orderId).exec()

    /* Only an untouched order may be re-priced; once Stripe has started
       processing it the amount is locked. */
    if (existing && existing.status === 'pending') {
      const intent = await stripe.paymentIntents.update(existing.stripePaymentIntentId, {
        amount: amountTotalCents,
      })

      existing.set({ items: lineItems, amountTotalCents, currency: env.CURRENCY })
      await existing.save()

      res.json({
        orderId: String(existing._id),
        clientSecret: intent.client_secret,
        amountTotalCents,
        currency: env.CURRENCY,
      })
      return
    }
  }

  const orderId = new mongoose.Types.ObjectId()

  const intent = await stripe.paymentIntents.create(
    {
      amount: amountTotalCents,
      currency: env.CURRENCY,
      automatic_payment_methods: { enabled: true },
      /* The webhook is the only thing that marks an order paid, and this is
         how it finds the order it belongs to. */
      metadata: { orderId: String(orderId) },
    },
    /* Retrying a dropped request must not double-charge or double-create. */
    { idempotencyKey: `order_${orderId}` },
  )

  await OrderModel.create({
    _id: orderId,
    items: lineItems,
    amountTotalCents,
    currency: env.CURRENCY,
    status: 'pending',
    stripePaymentIntentId: intent.id,
  })

  res.status(201).json({
    orderId: String(orderId),
    clientSecret: intent.client_secret,
    amountTotalCents,
    currency: env.CURRENCY,
  })
})

/* Order lookup after the redirect back from Stripe. The client secret acts as
   the bearer capability, so knowing an order id alone reveals nothing. */
checkoutRouter.get('/orders/lookup', async (req, res) => {
  const query = z
    .object({
      payment_intent: z.string().min(1),
      payment_intent_client_secret: z.string().min(1),
    })
    .parse(req.query)

  const intent = await stripe.paymentIntents.retrieve(query.payment_intent)
  if (intent.client_secret !== query.payment_intent_client_secret) {
    throw HttpError.forbidden('Invalid payment reference')
  }

  const order = await OrderModel.findOne({ stripePaymentIntentId: intent.id }).exec()
  if (!order) throw HttpError.notFound('No such order')

  res.json({
    order: serializeOrder(order),
    /* The webhook may not have landed yet; the client polls on this. */
    paymentStatus: intent.status,
  })
})
