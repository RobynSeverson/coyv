import type Stripe from 'stripe'
import { SubscriptionPaymentModel } from '../models/SubscriptionPayment.ts'
import type { SubscriptionDocument } from '../models/Subscription.ts'

export function billingPeriodLabel(periodStart: number | null): string {
  if (!periodStart) return ''
  return new Date(periodStart * 1000).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

const seconds = (value: number | null | undefined): Date | null =>
  typeof value === 'number' ? new Date(value * 1000) : null

/* Upserting on the invoice id is what makes this safe to call from a webhook,
   a replay of that webhook, and the backfill script racing either: the first
   caller wins and the rest are no-ops, so a month can never be counted twice.

   Only invoices that actually took money are recorded — a £0 invoice is not
   earnings, and an unpaid one is not yet. */
export async function recordSubscriptionPayment(
  subscription: SubscriptionDocument | null,
  invoice: Stripe.Invoice,
): Promise<boolean> {
  const stripeSubscriptionId = subscription?.stripeSubscriptionId ?? null
  const invoiceId = invoice.id
  if (!invoiceId || !stripeSubscriptionId) return false

  const amountPaidCents = invoice.amount_paid ?? 0
  if (amountPaidCents <= 0) return false

  const paidAt =
    seconds(invoice.status_transitions?.paid_at) ?? seconds(invoice.created) ?? new Date()

  const result = await SubscriptionPaymentModel.updateOne(
    { stripeInvoiceId: invoiceId },
    {
      $setOnInsert: {
        stripeInvoiceId: invoiceId,
        stripeSubscriptionId,
        subscription: subscription?._id ?? null,
        slug: subscription?.slug ?? '',
        title: subscription?.title ?? 'Subscription',
        periodLabel: billingPeriodLabel(invoice.period_start ?? null),
        amountPaidCents,
        currency: (invoice.currency ?? 'usd').toLowerCase(),
        email: subscription?.email ?? invoice.customer_email ?? null,
        shippingName: subscription?.shippingName ?? null,
        periodStart: seconds(invoice.period_start),
        periodEnd: seconds(invoice.period_end),
        paidAt,
      },
    },
    { upsert: true },
  ).exec()

  const created = result.upsertedCount > 0
  if (created) {
    console.log(`[payment] recorded invoice ${invoiceId} (${amountPaidCents} ${invoice.currency})`)
  }

  return created
}
