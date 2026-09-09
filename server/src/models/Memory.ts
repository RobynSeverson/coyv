import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

/* A memory is a single photograph. Two objects are kept in S3 for each one:
   the untouched original, which is what the lightbox and the download link
   serve, and a small webp the grid uses so a page of them stays light. */
const memoryImageSchema = new Schema(
  {
    key: { type: String, required: true, trim: true },
    /* Absent only if the preview could not be generated; readers fall back
       to the original rather than showing a hole. */
    previewKey: { type: String, trim: true },
    contentType: { type: String, required: true },
    bytes: { type: Number, required: true },
    width: { type: Number },
    height: { type: Number },
  },
  { _id: false, timestamps: false },
)

const memorySchema = new Schema(
  {
    /* Shown as the caption and used as the alt text when one is not given. */
    title: { type: String, default: '', trim: true, maxlength: 160 },
    alt: { type: String, default: '', trim: true, maxlength: 300 },

    image: { type: memoryImageSchema, required: true },

    /* Original filename of a memory brought over from the bundled assets.
       Only set by the import script, which uses it to stay idempotent. */
    importedFrom: { type: String, trim: true },

    /* Unpublished memories are invisible to the public API. */
    published: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
)

memorySchema.index({ published: 1, sortOrder: 1, createdAt: 1 })

export type Memory = InferSchemaType<typeof memorySchema>
export type MemoryDocument = HydratedDocument<Memory>

export const MemoryModel = model('Memory', memorySchema)
