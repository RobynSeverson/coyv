import Stripe from 'stripe'
import { env } from '../env.ts'

/* No explicit apiVersion: the account's pinned version is used, which keeps
   this in step with the dashboard and with the webhook payloads Stripe sends. */
export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  appInfo: { name: 'coyv', version: '1.0.0' },
})

/* Every sellable thing needs a Stripe Product before it can carry a price —
   including one-off prints, which get one only when they are billed through an
   invoice alongside a subscription. */
export async function ensureStripeProduct(product: {
  _id: unknown
  title: string
  description?: string
  stripeProductId?: string | null
}): Promise<string> {
  if (product.stripeProductId) {
    /* Keep the Stripe-side name in step, so invoices and the dashboard match
       what the studio shows. */
    await stripe.products.update(product.stripeProductId, {
      name: product.title,
      ...(product.description ? { description: product.description } : {}),
    })
    return product.stripeProductId
  }

  const created = await stripe.products.create({
    name: product.title,
    ...(product.description ? { description: product.description } : {}),
    metadata: { productId: String(product._id) },
  })
  return created.id
}

/* Stripe prices are immutable. Repricing a subscription therefore means
   minting a new price and archiving the old one: everybody already subscribed
   keeps billing on the price they signed up at, which is both what Stripe
   enforces and what a customer would expect.

   Returns the price id new checkouts should use. */
export async function ensureSubscriptionPrice(product: {
  _id: unknown
  title: string
  description?: string
  priceCents: number
  currency: string
  stripeProductId?: string | null
  stripePriceId?: string | null
}): Promise<{ stripeProductId: string; stripePriceId: string }> {
  const stripeProductId = await ensureStripeProduct(product)

  if (product.stripePriceId) {
    const existing = await stripe.prices.retrieve(product.stripePriceId)
    const unchanged =
      existing.active &&
      existing.unit_amount === product.priceCents &&
      existing.currency === product.currency &&
      existing.recurring?.interval === 'month'

    if (unchanged) return { stripeProductId, stripePriceId: existing.id }

    await stripe.prices.update(existing.id, { active: false })
  }

  const price = await stripe.prices.create({
    product: stripeProductId,
    unit_amount: product.priceCents,
    currency: product.currency,
    recurring: { interval: 'month' },
    metadata: { productId: String(product._id) },
  })

  return { stripeProductId, stripePriceId: price.id }
}
