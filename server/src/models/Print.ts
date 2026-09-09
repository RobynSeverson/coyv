import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

/* An image lives in S3; only the object key is persisted. Public URLs are
   minted on demand as presigned GETs so the bucket can stay private. */
const printImageSchema = new Schema(
  {
    key: { type: String, required: true, trim: true },
    alt: { type: String, default: '', trim: true },
    width: { type: Number },
    height: { type: Number },
    contentType: { type: String, required: true },
    bytes: { type: Number, required: true },
  },
  { _id: true, timestamps: false },
)

const printSchema = new Schema(
  {
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

    /* null means "made to order", i.e. unlimited. */
    stock: { type: Number, default: null, min: 0 },

    images: { type: [printImageSchema], default: [] },

    /* Unpublished prints are invisible to the public API. */
    published: { type: Boolean, default: false, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
)

printSchema.index({ published: 1, sortOrder: 1, createdAt: -1 })

export type Print = InferSchemaType<typeof printSchema>
export type PrintDocument = HydratedDocument<Print>
export type PrintImage = Print['images'][number]

export const PrintModel = model('Print', printSchema)
