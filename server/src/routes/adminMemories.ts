import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { env } from '../env.ts'
import { HttpError } from '../lib/httpError.ts'
import { serializeMemoryForAdmin } from '../lib/serialize.ts'
import { requireAdmin } from '../middleware/auth.ts'
import { MemoryModel } from '../models/Memory.ts'
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

adminMemoriesRouter.get('/', async (_req, res) => {
  res.json({ memories: await listForAdmin() })
})

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

/* Each upload becomes its own memory. The original is stored untouched for
   the lightbox and the download link; a small webp is derived for the grid so
   the page does not pull several megabytes per tile. */
adminMemoriesRouter.post('/', upload.array('images', 12), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? []
  if (files.length === 0) throw HttpError.badRequest('No files were uploaded')

  const last = await MemoryModel.findOne().sort({ sortOrder: -1 }).select('sortOrder').exec()
  let nextSortOrder = (last?.sortOrder ?? -1) + 1

  for (const file of files) {
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

    await MemoryModel.create({
      title: '',
      alt: '',
      image: {
        key,
        previewKey,
        contentType: file.mimetype,
        bytes: file.size,
        width: dimensions.width,
        height: dimensions.height,
      },
      published: true,
      sortOrder: nextSortOrder,
    })
    nextSortOrder += 1
  }

  res.status(201).json({ memories: await listForAdmin() })
})

const memoryInputSchema = z.object({
  title: z.string().trim().max(160),
  alt: z.string().trim().max(300),
  published: z.boolean(),
  sortOrder: z.number().int(),
})

adminMemoriesRouter.patch('/:id', async (req, res) => {
  const body = memoryInputSchema.partial().parse(req.body)

  const memory = await MemoryModel.findById(req.params.id).exec()
  if (!memory) throw HttpError.notFound('No such memory')

  memory.set(body)
  await memory.save()

  res.json({ memories: await listForAdmin() })
})

adminMemoriesRouter.delete('/:id', async (req, res) => {
  const memory = await MemoryModel.findById(req.params.id).exec()
  if (!memory) throw HttpError.notFound('No such memory')

  /* Nothing references a memory the way an order references a print, so this
     is a real delete. S3 failures are logged rather than fatal: the record is
     already gone and a stray object is cheaper than a broken gallery. */
  for (const key of [memory.image.key, memory.image.previewKey]) {
    if (!key) continue
    invalidateSignedUrl(key)
    await deleteObject(key).catch((error) =>
      console.warn(`[s3] failed to delete ${key}`, error),
    )
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
