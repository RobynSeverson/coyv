import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

export const FULFILLMENT_KINDS = ['order', 'subscription'] as const
export type FulfillmentKind = (typeof FULFILLMENT_KINDS)[number]

export const FULFILLMENT_STATUSES = ['pending', 'sent'] as const
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number]

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

const itemSchema = new Schema(
  {
    title: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false },
)

/* One row per parcel that has to physically leave the studio. A one-off order
   makes exactly one; a subscription makes a fresh one every time it charges,
   which is what turns "who subscribes?" into "what do I post this month?".

   Everything the packing slip needs is snapshotted, so editing a product or a
   subscriber's address later cannot rewrite what a past parcel was sent as. */
const fulfillmentSchema = new Schema(
  {
    kind: { type: String, enum: FULFILLMENT_KINDS, required: true, index: true },

    order: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    subscription: { type: Schema.Types.ObjectId, ref: 'Subscription', default: null },

    /* The idempotency key. An order id for a one-off, a Stripe invoice id for
       a subscription period — so a replayed webhook, or a reconciliation that
       races one, can never queue the same parcel twice. */
    sourceKey: { type: String, required: true, unique: true },

    /* Human label for the billing period, e.g. "September 2026". Empty for
       one-off orders, which are identified by their reference instead. */
    periodLabel: { type: String, default: '' },

    title: { type: String, required: true },
    items: { type: [itemSchema], default: [] },

    email: { type: String, default: null },
    shippingName: { type: String, default: null },
    shippingAddress: { type: addressSchema, default: null },

    status: { type: String, enum: FULFILLMENT_STATUSES, default: 'pending', index: true },
    sentAt: { type: Date, default: null },
    trackingNumber: { type: String, default: '' },
    notes: { type: String, default: '' },
  },
  { timestamps: true },
)

/* The queue is read as "oldest outstanding first". */
fulfillmentSchema.index({ status: 1, createdAt: 1 })

export type Fulfillment = InferSchemaType<typeof fulfillmentSchema>
export type FulfillmentDocument = HydratedDocument<Fulfillment>

export const FulfillmentModel = model('Fulfillment', fulfillmentSchema)
