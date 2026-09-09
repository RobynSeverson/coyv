import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

/* Everything for sale is a product. A print is bought once; a subscription is
   billed every month by Stripe until it is cancelled. */
export const PRODUCT_KINDS = ['print', 'subscription'] as const
export type ProductKind = (typeof PRODUCT_KINDS)[number]

/* An image lives in S3; only the object key is persisted. Public URLs are
   minted on demand as presigned GETs so the bucket can stay private. */
const productImageSchema = new Schema(
  {
    key: { type: String, required: true, trim: true },
    /* A downscaled webp. This is the only version the public API hands out,
       so the print-resolution original never leaves the bucket. */
    displayKey: { type: String, default: null },
    alt: { type: String, default: '', trim: true },
    width: { type: Number },
    height: { type: Number },
    contentType: { type: String, required: true },
    bytes: { type: Number, required: true },
  },
  { _id: true, timestamps: false },
)

const productSchema = new Schema(
  {
    /* Documents written before subscriptions existed have no kind, and the
       default fills it in on read, so nothing had to be migrated. */
    kind: { type: String, enum: PRODUCT_KINDS, default: 'print', index: true },

    title: { type: String, required: true, trim: true, maxlength: 160 },
    /* Stable, human-readable id used in URLs. */
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    },
    description: { type: String, default: '', trim: true, maxlength: 4000 },

    /* Money is always an integer count of the currency's minor unit; storing
       dollars as floats is how rounding bugs get into ledgers. */
    priceCents: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, lowercase: true, minlength: 3, maxlength: 3 },

    /* null means "made to order", i.e. unlimited. Meaningless for a
       subscription, which is never stocked. */
    stock: { type: Number, default: null, min: 0 },

    /* Subscriptions only. Stripe prices are immutable, so changing the amount
       mints a new price and archives the old one; existing subscribers keep
       billing against the price they signed up on. */
    stripeProductId: { type: String, default: null },
    stripePriceId: { type: String, default: null },

    images: { type: [productImageSchema], default: [] },

    /* Unpublished prints are invisible to the public API. */
    published: { type: Boolean, default: false, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
)

productSchema.index({ published: 1, sortOrder: 1, createdAt: -1 })

export type Product = InferSchemaType<typeof productSchema>
export type ProductDocument = HydratedDocument<Product>
export type ProductImage = Product['images'][number]

/* The collection is still called `prints`: this was a rename in the code, not
   a change to the data. */
export const ProductModel = model('Product', productSchema, 'prints')
