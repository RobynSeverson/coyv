import { Router } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import { env } from '../env.ts'
import { HttpError } from '../lib/httpError.ts'
import { serializeOrder, serializeSubscription } from '../lib/serialize.ts'
import { OrderModel } from '../models/Order.ts'
import { ProductModel } from '../models/Product.ts'
import { SubscriptionModel } from '../models/Subscription.ts'
import { ensureSubscriptionPrice, stripe } from '../services/stripe.ts'
import { refreshSubscription } from '../services/subscriptions.ts'

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
        productId: z.string().regex(/^[a-f0-9]{24}$/, 'Invalid product id'),
        quantity: z.number().int().min(1).max(MAX_QUANTITY_PER_ITEM),
      }),
    )
    .min(1)
    .max(MAX_DISTINCT_ITEMS),
})

/* Prices are looked up server-side, always. Whatever amount the client thinks
   something costs is irrelevant — it never reaches Stripe. */
async function priceCart(items: { productId: string; quantity: number }[]) {
  const merged = new Map<string, number>()
  for (const item of items) {
    merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.quantity)
  }

  for (const [productId, quantity] of merged) {
    if (quantity > MAX_QUANTITY_PER_ITEM) {
      throw HttpError.badRequest(`At most ${MAX_QUANTITY_PER_ITEM} of any one print per order`, {
        productId,
      })
    }
  }

  const ids = [...merged.keys()].map((id) => new mongoose.Types.ObjectId(id))
  const products = await ProductModel.find({ _id: { $in: ids }, published: true }).exec()

  if (products.length !== merged.size) {
    throw HttpError.badRequest('One or more prints are unavailable')
  }

  const lineItems = products.map((product) => {
    const quantity = merged.get(String(product._id)) ?? 0

    /* A recurring product cannot be charged once through a PaymentIntent, so
       it never belongs in this cart. */
    if (product.kind === 'subscription') {
      throw HttpError.badRequest(`"${product.title}" is a subscription and is bought on its own`, {
        productId: String(product._id),
      })
    }

    if (product.stock !== null && product.stock !== undefined && product.stock < quantity) {
      throw HttpError.conflict(`"${product.title}" only has ${product.stock} left`, {
        productId: String(product._id),
        available: product.stock,
      })
    }

    if (product.currency !== env.CURRENCY) {
      throw HttpError.conflict('Cart mixes currencies')
    }

    return {
      print: product._id,
      slug: product.slug,
      title: product.title,
      unitAmountCents: product.priceCents,
      quantity,
      imageKey: product.images[0]?.key ?? null,
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

/* Subscriptions never leave the site. Stripe needs a Customer and a
   Subscription to exist before anything can be charged, so this creates both
   in an incomplete state and hands back the client secret of the first
   invoice's PaymentIntent — the same kind of secret the one-off cart uses, so
   the same on-page Payment Element confirms it. */
const subscribeSchema = z.object({
  productId: z.string().regex(/^[a-f0-9]{24}$/, 'Invalid product id'),
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().max(160).optional(),
})

/* "pi_123_secret_abc" -> "pi_123". Stripe does not return the id separately
   when the secret comes from an invoice. */
function intentIdFromSecret(clientSecret: string): string {
  return clientSecret.split('_secret_')[0] ?? ''
}

checkoutRouter.post('/subscription', async (req, res) => {
  const body = subscribeSchema.parse(req.body)

  const product = await ProductModel.findOne({
    _id: body.productId,
    published: true,
    kind: 'subscription',
  }).exec()
  if (!product) throw HttpError.badRequest('That subscription is unavailable')

  if (product.currency !== env.CURRENCY) throw HttpError.conflict('Unsupported currency')

  /* Normally already done when the product was saved; repeated here so a
     product that predates its price, or whose price failed to sync, still
     works rather than dead-ending the customer. */
  const { stripeProductId, stripePriceId } = await ensureSubscriptionPrice({
    _id: product._id,
    title: product.title,
    description: product.description,
    priceCents: product.priceCents,
    currency: product.currency,
    stripeProductId: product.stripeProductId,
    stripePriceId: product.stripePriceId,
  })

  if (stripeProductId !== product.stripeProductId || stripePriceId !== product.stripePriceId) {
    product.set({ stripeProductId, stripePriceId })
    await product.save()
  }

  /* One Customer per email keeps a returning subscriber's billing history in
     one place instead of scattering it across duplicates. */
  const found = await stripe.customers.list({ email: body.email, limit: 1 })
  const customer =
    found.data[0] ??
    (await stripe.customers.create({
      email: body.email,
      ...(body.name ? { name: body.name } : {}),
    }))

  const existing = await SubscriptionModel.findOne({
    product: product._id,
    stripeCustomerId: customer.id,
    status: { $in: ['active', 'trialing', 'past_due', 'unpaid'] },
  }).exec()
  if (existing) throw HttpError.conflict('That email is already subscribed to this')

  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: stripePriceId }],
    /* Nothing is charged until the Payment Element confirms, which is what
       lets the whole flow stay on this site. */
    payment_behavior: 'default_incomplete',
    payment_settings: { save_default_payment_method: 'on_subscription' },
    expand: ['latest_invoice.confirmation_secret'],
    metadata: { productId: String(product._id) },
  })

  const invoice = subscription.latest_invoice
  const clientSecret =
    invoice && typeof invoice !== 'string' ? invoice.confirmation_secret?.client_secret : null

  if (!clientSecret) {
    throw HttpError.badGateway('Stripe did not return a payment secret for this subscription')
  }

  await SubscriptionModel.create({
    product: product._id,
    slug: product.slug,
    title: product.title,
    unitAmountCents: product.priceCents,
    currency: product.currency,
    interval: 'month',
    email: body.email,
    name: body.name ?? null,
    status: 'incomplete',
    stripeCustomerId: customer.id,
    stripeSubscriptionId: subscription.id,
    stripePaymentIntentId: intentIdFromSecret(clientSecret),
  })

  res.status(201).json({
    clientSecret,
    amountTotalCents: product.priceCents,
    currency: product.currency,
    interval: 'month',
  })
})

/* Same capability model as the order lookup: the client secret in the URL is
   what authorises reading the subscription. */
checkoutRouter.get('/subscriptions/lookup', async (req, res) => {
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

  const subscription = await SubscriptionModel.findOne({
    stripePaymentIntentId: intent.id,
  }).exec()
  if (!subscription) throw HttpError.notFound('No such subscription')

  /* Don't make the subscriber wait on a webhook to be told they're subscribed:
     once the first payment lands, pull the real state from Stripe. */
  const settled =
    intent.status === 'succeeded' && subscription.status === 'incomplete'
      ? ((await refreshSubscription(subscription.stripeSubscriptionId)) ?? subscription)
      : subscription

  res.json({
    subscription: serializeSubscription(settled),
    /* The webhook may still be in flight; the client polls on this. */
    paymentStatus: intent.status,
  })
})
