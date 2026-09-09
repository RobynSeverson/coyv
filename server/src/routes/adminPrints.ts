import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { env } from '../env.ts'
import { HttpError } from '../lib/httpError.ts'
import { serializeOrder, serializePrintForAdmin } from '../lib/serialize.ts'
import { requireAdmin } from '../middleware/auth.ts'
import { OrderModel, ORDER_STATUSES } from '../models/Order.ts'
import { PrintModel } from '../models/Print.ts'
import {
  ALLOWED_IMAGE_TYPES,
  buildObjectKey,
  deleteObject,
  invalidateSignedUrl,
  uploadObject,
} from '../services/s3.ts'

export const adminRouter: Router = Router()

/* Every route below is behind the session cookie. */
adminRouter.use(requireAdmin)

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

const printInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  slug: z.string().trim().toLowerCase().regex(slugPattern).optional(),
  description: z.string().trim().max(4000).default(''),
  /* Accepted in cents so the API never has to round a float. */
  priceCents: z.number().int().min(0),
  stock: z.number().int().min(0).nullable().default(null),
  published: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
})

adminRouter.get('/prints', async (_req, res) => {
  const prints = await PrintModel.find().sort({ sortOrder: 1, createdAt: -1 }).exec()
  res.json({ prints: await Promise.all(prints.map(serializePrintForAdmin)) })
})

adminRouter.get('/prints/:id', async (req, res) => {
  const print = await PrintModel.findById(req.params.id).exec()
  if (!print) throw HttpError.notFound('No such print')
  res.json({ print: await serializePrintForAdmin(print) })
})

adminRouter.post('/prints', async (req, res) => {
  const body = printInputSchema.parse(req.body)
  const slug = body.slug ?? slugify(body.title)
  if (!slugPattern.test(slug)) throw HttpError.badRequest('Could not derive a slug from that title')

  const print = await PrintModel.create({
    ...body,
    slug,
    currency: env.CURRENCY,
    images: [],
  })

  res.status(201).json({ print: await serializePrintForAdmin(print) })
})

adminRouter.patch('/prints/:id', async (req, res) => {
  const body = printInputSchema.partial().parse(req.body)

  const print = await PrintModel.findById(req.params.id).exec()
  if (!print) throw HttpError.notFound('No such print')

  /* Publishing a print with no artwork would render an empty tile. */
  if (body.published === true && print.images.length === 0) {
    throw HttpError.badRequest('Add at least one image before publishing')
  }

  print.set(body)
  await print.save()

  res.json({ print: await serializePrintForAdmin(print) })
})

adminRouter.delete('/prints/:id', async (req, res) => {
  const print = await PrintModel.findById(req.params.id).exec()
  if (!print) throw HttpError.notFound('No such print')

  /* A print referenced by a real order is history; hide it instead of
     deleting so past orders keep resolving. */
  const referenced = await OrderModel.exists({
    'items.print': print._id,
    status: { $in: ['paid', 'refunded', 'processing'] },
  })

  if (referenced) {
    print.set({ published: false })
    await print.save()
    res.json({ archived: true, print: await serializePrintForAdmin(print) })
    return
  }

  await Promise.all(
    print.images.map(async (image) => {
      invalidateSignedUrl(image.key)
      await deleteObject(image.key).catch((error) =>
        console.warn(`[s3] failed to delete ${image.key}`, error),
      )
    }),
  )
  await print.deleteOne()

  res.json({ deleted: true })
})

/* Uploads are buffered in memory and forwarded to S3 by the API, so the
   bucket never needs to accept a request from the browser directly. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 8 },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      callback(HttpError.badRequest(`Unsupported image type: ${file.mimetype}`))
      return
    }
    callback(null, true)
  },
})

adminRouter.post('/prints/:id/images', upload.array('images', 8), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? []
  if (files.length === 0) throw HttpError.badRequest('No files were uploaded')

  const print = await PrintModel.findById(req.params.id).exec()
  if (!print) throw HttpError.notFound('No such print')

  for (const file of files) {
    const key = buildObjectKey(`prints/${print.slug}`, file.mimetype, file.originalname)
    await uploadObject({ key, body: file.buffer, contentType: file.mimetype })
    print.images.push({
      key,
      alt: print.title,
      contentType: file.mimetype,
      bytes: file.size,
    })
  }

  await print.save()
  res.status(201).json({ print: await serializePrintForAdmin(print) })
})

adminRouter.delete('/prints/:id/images/:imageId', async (req, res) => {
  const print = await PrintModel.findById(req.params.id).exec()
  if (!print) throw HttpError.notFound('No such print')

  const image = print.images.find((candidate) => String(candidate._id) === req.params.imageId)
  if (!image) throw HttpError.notFound('No such image')

  if (print.published && print.images.length === 1) {
    throw HttpError.badRequest('Unpublish the print before removing its last image')
  }

  invalidateSignedUrl(image.key)
  await deleteObject(image.key).catch((error) =>
    console.warn(`[s3] failed to delete ${image.key}`, error),
  )

  print.images.pull({ _id: image._id })
  await print.save()

  res.json({ print: await serializePrintForAdmin(print) })
})

/* Reordering is a whole-array replace so the UI can drag images around and
   commit once. */
adminRouter.patch('/prints/:id/images/order', async (req, res) => {
  const body = z.object({ imageIds: z.array(z.string()).min(1) }).parse(req.body)

  const print = await PrintModel.findById(req.params.id).exec()
  if (!print) throw HttpError.notFound('No such print')

  const byId = new Map(print.images.map((image) => [String(image._id), image]))
  if (body.imageIds.length !== byId.size || body.imageIds.some((id) => !byId.has(id))) {
    throw HttpError.badRequest('imageIds must list every image on the print exactly once')
  }

  print.set(
    'images',
    body.imageIds.map((id) => byId.get(id)),
  )
  await print.save()

  res.json({ print: await serializePrintForAdmin(print) })
})

adminRouter.get('/orders', async (req, res) => {
  const query = z
    .object({
      status: z.enum(ORDER_STATUSES).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      skip: z.coerce.number().int().min(0).default(0),
    })
    .parse(req.query)

  const filter = query.status ? { status: query.status } : {}

  const [orders, total] = await Promise.all([
    OrderModel.find(filter).sort({ createdAt: -1 }).skip(query.skip).limit(query.limit).exec(),
    OrderModel.countDocuments(filter),
  ])

  res.json({ orders: orders.map(serializeOrder), total })
})

adminRouter.get('/orders/:id', async (req, res) => {
  const order = await OrderModel.findById(req.params.id).exec()
  if (!order) throw HttpError.notFound('No such order')
  res.json({ order: serializeOrder(order) })
})
