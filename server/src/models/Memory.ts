import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

/* Two objects are kept in S3 for each image: the untouched original, which is
   what the lightbox and the download link serve, and a small webp the list
   uses so a page of them stays light. */
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
  { timestamps: false },
)

export const MEMORY_KINDS = ['photo', 'journal'] as const
export type MemoryKind = (typeof MEMORY_KINDS)[number]

const memorySchema = new Schema(
  {
    /* A photo memory is one or more images; a journal entry is written text
       that may also carry images. The distinction only changes how the page
       presents it — both are rows in the same archive. */
    kind: { type: String, enum: MEMORY_KINDS, default: 'photo' },

    /* Shown as the caption and used as the alt text when one is not given. */
    title: { type: String, default: '', trim: true, maxlength: 160 },
    alt: { type: String, default: '', trim: true, maxlength: 300 },

    /* Markdown, rendered through the same reader as product descriptions. */
    body: { type: String, default: '', maxlength: 20000 },

    images: { type: [memoryImageSchema], default: [] },

    /* Memories written before a memory could hold more than one image. The
       serializer still reads it so those records keep working whether or not
       migrateMemoryImages has been run against this database. */
    image: { type: memoryImageSchema, required: false },

    /* Deliberately fictional: the archive presents every memory as a dated
       file, and the date is set once on creation so it never shifts under a
       visitor between renders. Editable in the admin panel. */
    capturedAt: { type: Date, default: null },

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
export type MemoryImage = MemoryDocument['images'][number]

/* The shape a caller writes back. Mongoose assigns `_id` itself, and an
   existing subdocument narrowed to these fields round-trips unchanged. */
export type MemoryImageInput = {
  key: string
  previewKey?: string | null
  contentType: string
  bytes: number
  width?: number | null
  height?: number | null
}

export function toMemoryImageInput(image: MemoryImageInput): MemoryImageInput {
  return {
    key: image.key,
    previewKey: image.previewKey,
    contentType: image.contentType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
  }
}

/* The one place that reconciles the legacy single `image` with the `images`
   array, so no caller has to remember which era a record comes from. */
export function memoryImages(memory: MemoryDocument): MemoryImage[] {
  if (memory.images.length > 0) return memory.images
  return memory.image ? [memory.image as MemoryImage] : []
}

const CAPTURED_FROM = Date.UTC(2005, 0, 1)
const CAPTURED_TO = Date.UTC(2050, 11, 31)

/* The archive is meant to read as one that has been running a long time and
   will keep running, so dates are drawn from either side of now. */
export function randomCapturedAt(): Date {
  return new Date(CAPTURED_FROM + Math.random() * (CAPTURED_TO - CAPTURED_FROM))
}

export const MemoryModel = model('Memory', memorySchema)
