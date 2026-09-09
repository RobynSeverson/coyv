import type Stripe from 'stripe'
import {
  SubscriptionModel,
  type SubscriptionDocument,
  type SubscriptionStatus,
} from '../models/Subscription.ts'
import { ensureSubscriptionFulfillment } from './fulfillments.ts'
import { sendSubscriptionCharge } from './email/notifications.ts'
import { stripe } from './stripe.ts'

/* Stripe owns subscription state; this mirrors it so the studio can show who
   is subscribed without a Stripe login. Everything here is a straight
   overwrite from Stripe, which makes replays and races harmless. */
export async function applySubscriptionState(
  subscription: Stripe.Subscription,
): Promise<SubscriptionDocument | null> {
  const local = await SubscriptionModel.findOne({
    stripeSubscriptionId: subscription.id,
  }).exec()

  if (!local) {
    /* A subscription created outside this site, or one whose checkout row was
       never written. Stripe still has it; there is nothing to mirror onto. */
    console.warn(`[stripe] no local record for subscription ${subscription.id}`)
    return null
  }

  /* The billing period moved onto the item in recent API versions. */
  const periodEnd = subscription.items.data[0]?.current_period_end ?? null

  local.set({
    status: subscription.status as SubscriptionStatus,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : local.currentPeriodEnd,
    canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
    ...(subscription.status === 'active' ? { lastPaymentError: null } : {}),
  })
  await local.save()
  return local
}

/* Pulls current state for one subscription. The confirmation page uses this so
   a subscriber is never told "pending" just because the webhook is slow, or —
   in local development — because no webhook is being delivered at all. */
export async function refreshSubscription(
  stripeSubscriptionId: string,
): Promise<SubscriptionDocument | null> {
  try {
    const remote = await stripe.subscriptions.retrieve(stripeSubscriptionId)
    const local = await applySubscriptionState(remote)

    /* The invoice.paid webhook normally queues the parcel. Doing it here too
       means a subscriber who has demonstrably paid is never missing from the
       fulfillment queue just because an event was slow, lost, or — in local
       development — never delivered at all. */
    if (local && (remote.status === 'active' || remote.status === 'trialing')) {
      const invoiceId =
        typeof remote.latest_invoice === 'string'
          ? remote.latest_invoice
          : (remote.latest_invoice?.id ?? null)
      const periodStart = remote.items.data[0]?.current_period_start ?? null

      if (invoiceId) {
        const { created, fulfillment } = await ensureSubscriptionFulfillment(
          local,
          invoiceId,
          periodStart,
        )
        /* This path exists for when no webhook arrives, so it has to send the
           subscriber's note too. The email dedupe key is the same one the
           webhook would use, so whichever gets here first wins and the other
           is a no-op. */
        if (created && fulfillment) await sendSubscriptionCharge(fulfillment)
      }
    }

    return local
  } catch (cause: unknown) {
    /* Reconciliation is an optimisation; the webhook is still the backstop. */
    console.warn(`[stripe] could not refresh subscription ${stripeSubscriptionId}`, cause)
    return null
  }
}
