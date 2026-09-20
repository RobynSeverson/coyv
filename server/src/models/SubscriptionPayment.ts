import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

/* One row per subscription invoice that actually charged. The Subscription
   collection answers "who subscribes?"; this one answers "what came in, and
   when?", which a single row per subscriber cannot, because a subscription
   pays again every month at a price that may have changed.

   Everything is snapshotted for the same reason order lines are: repricing
   the product later must not rewrite what was taken in March. */
const subscriptionPaymentSchema = new Schema(
  {
    subscription: { type: Schema.Types.ObjectId, ref: 'Subscription', default: null },

    /* The idempotency key. A replayed invoice.paid, or a backfill racing one,
       finds the row already there. */
    stripeInvoiceId: { type: String, required: true, unique: true },
    stripeSubscriptionId: { type: String, required: true, index: true },

    slug: { type: String, default: '' },
    title: { type: String, required: true },
    /* Human label for the billing period, e.g. "September 2026". */
    periodLabel: { type: String, default: '' },

    amountPaidCents: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, lowercase: true },

    email: { type: String, default: null, trim: true, lowercase: true },
    shippingName: { type: String, default: null },

    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },
    /* When Stripe took the money, not when this row was written — a backfill
       inserts months-old payments and they must land in the right week. */
    paidAt: { type: Date, required: true },
  },
  { timestamps: true },
)

subscriptionPaymentSchema.index({ paidAt: -1 })

export type SubscriptionPayment = InferSchemaType<typeof subscriptionPaymentSchema>
export type SubscriptionPaymentDocument = HydratedDocument<SubscriptionPayment>

export const SubscriptionPaymentModel = model('SubscriptionPayment', subscriptionPaymentSchema)
