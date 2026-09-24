import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

export const ORDER_STATUSES = [
  'pending',
  'processing',
  'paid',
  'failed',
  'canceled',
  'refunded',
] as const

export type OrderStatus = (typeof ORDER_STATUSES)[number]

/* Money that actually moved. A refund was a real sale once, so it keeps its
   place in the sequence and stays in the books; everything else is a basket
   that never became an order. This is what decides which numbering track a
   record is on and whether the admin list shows it at all. */
export const SETTLED_ORDER_STATUSES = ['paid', 'refunded'] as const satisfies readonly OrderStatus[]

export type SettledOrderStatus = (typeof SETTLED_ORDER_STATUSES)[number]

export function isSettledStatus(status: OrderStatus): status is SettledOrderStatus {
  return (SETTLED_ORDER_STATUSES as readonly OrderStatus[]).includes(status)
}

/* Line items snapshot the title and price at purchase time: editing a print
   later must never rewrite the history of what somebody actually paid. */
const orderItemSchema = new Schema(
  {
    print: { type: Schema.Types.ObjectId, ref: 'Print', required: true },
    slug: { type: String, required: true },
    title: { type: String, required: true },
    unitAmountCents: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    imageKey: { type: String, default: null },
  },
  { _id: false },
)

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

const orderSchema = new Schema(
  {
    /* The reference quoted to the customer. A record starts on the INC track
       and is moved onto CV by the webhook when the payment clears, so this
       changes exactly once in a record's life. */
    number: { type: String, default: null, index: true },

    items: { type: [orderItemSchema], required: true, validate: (v: unknown[]) => v.length > 0 },
    amountTotalCents: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, lowercase: true },

    status: { type: String, enum: ORDER_STATUSES, default: 'pending', index: true },

    email: { type: String, default: null, trim: true, lowercase: true },
    shippingName: { type: String, default: null },
    shippingAddress: { type: addressSchema, default: null },

    stripePaymentIntentId: { type: String, required: true, unique: true },
    stripeChargeId: { type: String, default: null },
    /* Kept so the ops UI can explain a failure without a Stripe login. */
    lastPaymentError: { type: String, default: null },

    /* Set once the succeeded webhook has been applied, so a replayed event
       cannot decrement stock a second time. */
    fulfilledAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true },
)

orderSchema.index({ createdAt: -1 })

export type Order = InferSchemaType<typeof orderSchema>
export type OrderDocument = HydratedDocument<Order>

export const OrderModel = model('Order', orderSchema)
