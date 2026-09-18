import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { env } from '../env.ts'
import { HttpError } from '../lib/httpError.ts'
import { serializeMemoryForAdmin } from '../lib/serialize.ts'
import { requireAdmin } from '../middleware/auth.ts'
import {
  MEMORY_KINDS,
  MemoryModel,
  memoryImages,
  randomCapturedAt,
  toMemoryImageInput,
  type MemoryDocument,
  type MemoryImageInput,
} from '../models/Memory.ts'
import { buildPreview, readDimensions } from '../services/images.ts'
import {
  ALLOWED_IMAGE_TYPES,
  buildObjectKey,
  deleteObject,
  invalidateSignedUrl,
  uploadObject,
} from '../services/s3.ts'

export const adminMemoriesRouter: Router = Router()

adminMemoriesRouter.use(requireAdmin)

/* Sorted the same way the public gallery sorts, so the admin list is a
   faithful preview of the running order. */
async function listForAdmin() {
  const memories = await MemoryModel.find().sort({ sortOrder: 1, createdAt: 1 }).exec()
  return Promise.all(memories.map((memory, index) => serializeMemoryForAdmin(memory, index)))
}

async function nextSortOrder(): Promise<number> {
  const last = await MemoryModel.findOne().sort({ sortOrder: -1 }).select('sortOrder').exec()
  return (last?.sortOrder ?? -1) + 1
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 12 },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      callback(HttpError.badRequest(`Unsupported image type: ${file.mimetype}`))
      return
    }
    callback(null, true)
  },
})

/* The original is stored untouched for the lightbox and the download link; a
   small webp is derived for the list so the page does not pull several
   megabytes per row. */
async function storeImage(file: Express.Multer.File) {
  const key = buildObjectKey('memories', file.mimetype, file.originalname)
  const [preview, dimensions] = await Promise.all([
    buildPreview(file.buffer),
    readDimensions(file.buffer),
  ])

  await uploadObject({ key, body: file.buffer, contentType: file.mimetype })

  let previewKey: string | undefined
  if (preview) {
    previewKey = `${key.replace(/\.[^./]+$/, '')}-preview.webp`
    await uploadObject({ key: previewKey, body: preview, contentType: 'image/webp' })
  }

  return {
    key,
    previewKey,
    contentType: file.mimetype,
    bytes: file.size,
    width: dimensions.width,
    height: dimensions.height,
  }
}

/* S3 failures are logged rather than fatal: the record is already gone, or
   about to be, and a stray object is cheaper than a broken gallery. */
async function discardImage(key: string | undefined | null) {
  if (!key) return
  invalidateSignedUrl(key)
  await deleteObject(key).catch((error) => console.warn(`[s3] failed to delete ${key}`, error))
}

adminMemoriesRouter.get('/', async (_req, res) => {
  res.json({ memories: await listForAdmin() })
})

/* By default each file becomes its own memory, which is how the gallery has
   always been filled. `grouped` puts them all in one memory instead, for a
   set of images that belong together. */
adminMemoriesRouter.post('/', upload.array('images', 12), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? []
  if (files.length === 0) throw HttpError.badRequest('No files were uploaded')

  const grouped = req.body?.grouped === 'true'
  let sortOrder = await nextSortOrder()

  const stored = await Promise.all(files.map(storeImage))

  if (grouped) {
    await MemoryModel.create({
      kind: 'photo',
      title: '',
      alt: '',
      body: '',
      images: stored,
      capturedAt: randomCapturedAt(),
      published: true,
      sortOrder,
    })
  } else {
    for (const image of stored) {
      await MemoryModel.create({
        kind: 'photo',
        title: '',
        alt: '',
        body: '',
        images: [image],
        capturedAt: randomCapturedAt(),
        published: true,
        sortOrder,
      })
      sortOrder += 1
    }
  }

  res.status(201).json({ memories: await listForAdmin() })
})

const journalInputSchema = z.object({
  title: z.string().trim().max(160).default(''),
  body: z.string().max(20000).default(''),
})

/* A journal entry starts as text alone; images can be attached afterwards
   through the same endpoint a photo memory uses. */
adminMemoriesRouter.post('/journal', async (req, res) => {
  const body = journalInputSchema.parse(req.body ?? {})

  await MemoryModel.create({
    kind: 'journal',
    title: body.title,
    alt: '',
    body: body.body,
    images: [],
    capturedAt: randomCapturedAt(),
    published: false,
    sortOrder: await nextSortOrder(),
  })

  res.status(201).json({ memories: await listForAdmin() })
})

/* Reading through memoryImages and writing the result back to `images` is
   what migrates a legacy single-image record the first time it is edited.
   `image` is unset by path: Mongoose's object form of set() skips undefined
   values, so passing it in the same object would silently leave it behind. */
function currentImages(memory: MemoryDocument): MemoryImageInput[] {
  return memoryImages(memory).map(toMemoryImageInput)
}

function adoptImages(memory: MemoryDocument, images: MemoryImageInput[]) {
  memory.set('images', images)
  memory.set('image', undefined)
}

adminMemoriesRouter.post('/:id/images', upload.array('images', 12), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? []
  if (files.length === 0) throw HttpError.badRequest('No files were uploaded')

  const memory = await MemoryModel.findById(req.params.id).exec()
  if (!memory) throw HttpError.notFound('No such memory')

  const stored = await Promise.all(files.map(storeImage))

  adoptImages(memory, [...currentImages(memory), ...stored])
  await memory.save()

  res.status(201).json({ memories: await listForAdmin() })
})

adminMemoriesRouter.delete('/:id/images/:imageId', async (req, res) => {
  const memory = await MemoryModel.findById(req.params.id).exec()
  if (!memory) throw HttpError.notFound('No such memory')

  const images = memoryImages(memory)
  const target = images.find((image) => String(image._id) === req.params.imageId)
  if (!target) throw HttpError.notFound('No such image')

  if (memory.kind !== 'journal' && images.length === 1) {
    throw HttpError.badRequest('A photo memory must keep at least one image')
  }

  adoptImages(
    memory,
    images
      .filter((image) => String(image._id) !== req.params.imageId)
      .map(toMemoryImageInput),
  )
  await memory.save()

  await discardImage(target.key)
  await discardImage(target.previewKey)

  res.json({ memories: await listForAdmin() })
})

const memoryInputSchema = z.object({
  kind: z.enum(MEMORY_KINDS),
  title: z.string().trim().max(160),
  alt: z.string().trim().max(300),
  body: z.string().max(20000),
  published: z.boolean(),
  sortOrder: z.number().int(),
  /* Null clears the date back to "undated" rather than meaning "unchanged",
     which `undefined` already covers. */
  capturedAt: z.coerce.date().nullable(),
})

adminMemoriesRouter.patch('/:id', async (req, res) => {
  const body = memoryInputSchema.partial().parse(req.body)

  const memory = await MemoryModel.findById(req.params.id).exec()
  if (!memory) throw HttpError.notFound('No such memory')

  if (body.kind === 'photo' && memoryImages(memory).length === 0) {
    throw HttpError.badRequest('A photo memory needs at least one image')
  }

  memory.set(body)
  await memory.save()

  res.json({ memories: await listForAdmin() })
})

adminMemoriesRouter.delete('/:id', async (req, res) => {
  const memory = await MemoryModel.findById(req.params.id).exec()
  if (!memory) throw HttpError.notFound('No such memory')

  /* Nothing references a memory the way an order references a print, so this
     is a real delete, images and all. */
  for (const image of memoryImages(memory)) {
    await discardImage(image.key)
    await discardImage(image.previewKey)
  }

  await memory.deleteOne()

  res.json({ deleted: true, memories: await listForAdmin() })
})

/* Whole-array replace so the UI can shuffle the gallery and commit once. */
adminMemoriesRouter.patch('/order/all', async (req, res) => {
  const body = z.object({ memoryIds: z.array(z.string()).min(1) }).parse(req.body)

  const memories = await MemoryModel.find().exec()
  const byId = new Map(memories.map((memory) => [String(memory._id), memory]))

  if (body.memoryIds.length !== byId.size || body.memoryIds.some((id) => !byId.has(id))) {
    throw HttpError.badRequest('memoryIds must list every memory exactly once')
  }

  await Promise.all(
    body.memoryIds.map((id, index) => {
      const memory = byId.get(id)
      if (!memory) return null
      memory.set({ sortOrder: index })
      return memory.save()
    }),
  )

  res.json({ memories: await listForAdmin() })
})
