import { FulfillmentModel } from '../models/Fulfillment.ts'
import type { OrderDocument } from '../models/Order.ts'
import type { SubscriptionDocument } from '../models/Subscription.ts'

/* Upserting on the unique sourceKey is what makes all of this safe to call
   from a webhook, a replay of that webhook, and a reconciliation racing it:
   the first caller wins and the rest are no-ops. Nothing here overwrites an
   existing row, so a parcel already marked sent stays sent. */
async function ensure(sourceKey: string, fields: Record<string, unknown>): Promise<boolean> {
  const result = await FulfillmentModel.updateOne(
    { sourceKey },
    { $setOnInsert: { sourceKey, ...fields } },
    { upsert: true },
  ).exec()

  return result.upsertedCount > 0
}

export async function ensureOrderFulfillment(order: OrderDocument): Promise<void> {
  const created = await ensure(`order:${String(order._id)}`, {
    kind: 'order',
    order: order._id,
    title: order.items.map((item) => item.title).join(', ') || 'Order',
    items: order.items.map((item) => ({ title: item.title, quantity: item.quantity })),
    email: order.email ?? null,
    shippingName: order.shippingName ?? null,
    shippingAddress: order.shippingAddress ?? null,
    status: 'pending',
  })

  if (created) console.log(`[fulfillment] queued order ${String(order._id)}`)
}

function periodLabel(periodStart: number | null): string {
  if (!periodStart) return ''
  return new Date(periodStart * 1000).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/* Keyed on the invoice, so every monthly charge queues its own parcel — the
   first one included, since Stripe bills the signup as an invoice too. */
export async function ensureSubscriptionFulfillment(
  subscription: SubscriptionDocument,
  invoiceId: string,
  periodStart: number | null,
): Promise<void> {
  const created = await ensure(`invoice:${invoiceId}`, {
    kind: 'subscription',
    subscription: subscription._id,
    periodLabel: periodLabel(periodStart),
    title: subscription.title,
    items: [{ title: subscription.title, quantity: 1 }],
    email: subscription.email ?? null,
    shippingName: subscription.shippingName ?? null,
    shippingAddress: subscription.shippingAddress ?? null,
    status: 'pending',
  })

  if (created) {
    console.log(`[fulfillment] queued subscription ${String(subscription._id)} (${invoiceId})`)
  }
}
