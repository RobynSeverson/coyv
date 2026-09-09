import type { FulfillmentDocument } from '../../models/Fulfillment.ts'
import type { OrderDocument } from '../../models/Order.ts'
import { sendEmail } from './brevo.ts'
import {
  manageLink,
  orderConfirmation,
  shippedNotice,
  subscriptionCharge,
} from './templates.ts'

/* Customer-facing mail. Every one of these is called from a path that has
   already taken money or already changed state, so none of them may throw:
   sendEmail swallows provider failures, and these wrappers only decide who
   gets what. */

export async function sendOrderConfirmation(order: OrderDocument): Promise<void> {
  if (!order.email) {
    console.warn(`[email] order ${String(order._id)} has no email address`)
    return
  }

  const template = orderConfirmation(order)
  await sendEmail({
    kind: 'order-confirmation',
    dedupeKey: `order-confirmation:${String(order._id)}`,
    to: [{ email: order.email, name: order.shippingName ?? undefined }],
    ...template,
  })
}

/* Keyed on the fulfillment rather than the subscription, so each monthly
   charge gets exactly one note and a replayed invoice.paid gets none. */
export async function sendSubscriptionCharge(fulfillment: FulfillmentDocument): Promise<void> {
  if (!fulfillment.email) return

  const template = subscriptionCharge(fulfillment)
  await sendEmail({
    kind: 'subscription-charge',
    dedupeKey: `subscription-charge:${fulfillment.sourceKey}`,
    to: [{ email: fulfillment.email, name: fulfillment.shippingName ?? undefined }],
    ...template,
  })
}

export async function sendShippedNotice(fulfillment: FulfillmentDocument): Promise<void> {
  if (!fulfillment.email) return

  const template = shippedNotice(fulfillment)
  await sendEmail({
    kind: 'shipped',
    dedupeKey: `shipped:${String(fulfillment._id)}`,
    to: [{ email: fulfillment.email, name: fulfillment.shippingName ?? undefined }],
    ...template,
  })
}

/* Deliberately has no dedupeKey: each request mints a fresh single-use token,
   so suppressing the second one would leave the subscriber holding a link
   they never received. Abuse is handled by the throttle on the route. */
export async function sendManageLink(email: string, link: string): Promise<void> {
  const template = manageLink(link)
  await sendEmail({
    kind: 'manage-link',
    to: [{ email }],
    ...template,
  })
}
