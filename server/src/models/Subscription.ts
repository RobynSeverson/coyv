import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

/* Mirrors Stripe's own subscription statuses. Stripe is the source of truth;
   this collection exists so the studio can answer "who subscribes?" without a
   Stripe login, and so a subscription can be tied back to the product sold. */
export const SUBSCRIPTION_STATUSES = [
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
] as const

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]

/* A print subscription ships a physical thing every month, so an address is
   as much a part of signing up as the card is. */
const addressSchema = new Schema(
  {
    line1: { type: String, default: '' },
    line2: { type: String, default: '' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    postalCode: { type: String, default: '' },
    country: { type: String, default: '' },
  },
  { _id: false },
)

const subscriptionSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    /* Snapshotted for the same reason order lines are: renaming or repricing
       the product later must not rewrite what somebody signed up for. */
    slug: { type: String, required: true },
    title: { type: String, required: true },
    unitAmountCents: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, lowercase: true },
    interval: { type: String, default: 'month' },

    email: { type: String, default: null, trim: true, lowercase: true },
    name: { type: String, default: null },

    shippingName: { type: String, default: null },
    shippingAddress: { type: addressSchema, default: null },

    status: { type: String, enum: SUBSCRIPTION_STATUSES, default: 'incomplete', index: true },

    stripeCustomerId: { type: String, default: null },
    stripeSubscriptionId: { type: String, required: true, unique: true },
    /* The first invoice's PaymentIntent. The subscriber never gets an account,
       so this — paired with its client secret — is how the browser proves it
       may read this subscription back after paying. */
    stripePaymentIntentId: { type: String, default: null, index: true },

    currentPeriodEnd: { type: Date, default: null },
    /* Set when a subscriber cancels from the manage page. The subscription
       stays active until the period they already paid for runs out, so this
       is what separates "ending" from "ended". */
    cancelAtPeriodEnd: { type: Boolean, default: false },
    canceledAt: { type: Date, default: null },
    lastPaymentError: { type: String, default: null },
  },
  { timestamps: true },
)

subscriptionSchema.index({ createdAt: -1 })

export type Subscription = InferSchemaType<typeof subscriptionSchema>
export type SubscriptionDocument = HydratedDocument<Subscription>

export const SubscriptionModel = model('Subscription', subscriptionSchema)
