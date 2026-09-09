import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { env } from '../env.ts'
import { HttpError } from '../lib/httpError.ts'
import { serializeOrder, serializeProductForAdmin, serializeSubscription } from '../lib/serialize.ts'
import { requireAdmin } from '../middleware/auth.ts'
import { OrderModel, ORDER_STATUSES } from '../models/Order.ts'
import { ProductModel, PRODUCT_KINDS } from '../models/Product.ts'
import { SubscriptionModel } from '../models/Subscription.ts'
import { ensureSubscriptionPrice, stripe } from '../services/stripe.ts'
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

const productInputSchema = z.object({
  kind: z.enum(PRODUCT_KINDS).default('print'),
  title: z.string().trim().min(1).max(160),
  slug: z.string().trim().toLowerCase().regex(slugPattern).optional(),
  description: z.string().trim().max(4000).default(''),
  /* Accepted in cents so the API never has to round a float. */
  priceCents: z.number().int().min(0),
  stock: z.number().int().min(0).nullable().default(null),
  published: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
})

/* A subscription is only sellable once Stripe has a recurring price for it.
   Doing this on save (rather than at checkout) means a broken Stripe call
   surfaces to the admin who made the change, not to a customer mid-purchase. */
async function syncStripePrice(product: InstanceType<typeof ProductModel>): Promise<void> {
  if (product.kind !== 'subscription') return

  const { stripeProductId, stripePriceId } = await ensureSubscriptionPrice({
    _id: product._id,
    title: product.title,
    description: product.description,
    priceCents: product.priceCents,
    currency: product.currency,
    stripeProductId: product.stripeProductId,
    stripePriceId: product.stripePriceId,
  })

  if (stripeProductId !== product.stripeProductId || stripePriceId !== product.stripePriceId) {
    product.set({ stripeProductId, stripePriceId })
    await product.save()
  }
}

adminRouter.get('/products', async (_req, res) => {
  const products = await ProductModel.find().sort({ sortOrder: 1, createdAt: -1 }).exec()
  res.json({ products: await Promise.all(products.map(serializeProductForAdmin)) })
})

adminRouter.get('/products/:id', async (req, res) => {
  const product = await ProductModel.findById(req.params.id).exec()
  if (!product) throw HttpError.notFound('No such product')
  res.json({ product: await serializeProductForAdmin(product) })
})

adminRouter.post('/products', async (req, res) => {
  const body = productInputSchema.parse(req.body)
  const slug = body.slug ?? slugify(body.title)
  if (!slugPattern.test(slug)) throw HttpError.badRequest('Could not derive a slug from that title')

  const product = await ProductModel.create({
    ...body,
    slug,
    /* Nothing about a subscription is stocked. */
    stock: body.kind === 'subscription' ? null : body.stock,
    currency: env.CURRENCY,
    images: [],
  })

  await syncStripePrice(product)

  res.status(201).json({ product: await serializeProductForAdmin(product) })
})

adminRouter.patch('/products/:id', async (req, res) => {
  /* The kind is fixed at creation: flipping it would leave Stripe holding a
     recurring price for something now sold as a one-off. */
  const body = productInputSchema.omit({ kind: true }).partial().parse(req.body)

  const product = await ProductModel.findById(req.params.id).exec()
  if (!product) throw HttpError.notFound('No such product')

  /* Publishing something with no artwork would render an empty tile. */
  if (body.published === true && product.images.length === 0) {
    throw HttpError.badRequest('Add at least one image before publishing')
  }

  product.set(body)
  if (product.kind === 'subscription') product.set({ stock: null })
  await product.save()

  await syncStripePrice(product)

  res.json({ product: await serializeProductForAdmin(product) })
})

adminRouter.delete('/products/:id', async (req, res) => {
  const product = await ProductModel.findById(req.params.id).exec()
  if (!product) throw HttpError.notFound('No such product')

  /* Anything a customer has actually paid for is history; hide it instead of
     deleting so orders and subscriptions keep resolving. */
  const [orderReferenced, subscribed] = await Promise.all([
    OrderModel.exists({
      'items.print': product._id,
      status: { $in: ['paid', 'refunded', 'processing'] },
    }),
    SubscriptionModel.exists({
      product: product._id,
      status: { $in: ['active', 'trialing', 'past_due', 'unpaid', 'paused'] },
    }),
  ])

  if (orderReferenced || subscribed) {
    product.set({ published: false })
    await product.save()
    res.json({ archived: true, product: await serializeProductForAdmin(product) })
    return
  }

  /* Stripe keeps the product and price records; archiving them stops the
     price being usable without destroying the billing history. */
  if (product.stripePriceId) {
    await stripe.prices.update(product.stripePriceId, { active: false }).catch((error: unknown) =>
      console.warn(`[stripe] failed to archive price ${product.stripePriceId}`, error),
    )
  }
  if (product.stripeProductId) {
    await stripe.products
      .update(product.stripeProductId, { active: false })
      .catch((error: unknown) =>
        console.warn(`[stripe] failed to archive product ${product.stripeProductId}`, error),
      )
  }

  await Promise.all(
    product.images.map(async (image) => {
      invalidateSignedUrl(image.key)
      await deleteObject(image.key).catch((error) =>
        console.warn(`[s3] failed to delete ${image.key}`, error),
      )
    }),
  )
  await product.deleteOne()

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

adminRouter.post('/products/:id/images', upload.array('images', 8), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? []
  if (files.length === 0) throw HttpError.badRequest('No files were uploaded')

  const product = await ProductModel.findById(req.params.id).exec()
  if (!product) throw HttpError.notFound('No such product')

  for (const file of files) {
    const key = buildObjectKey(`products/${product.slug}`, file.mimetype, file.originalname)
    await uploadObject({ key, body: file.buffer, contentType: file.mimetype })
    product.images.push({
      key,
      alt: product.title,
      contentType: file.mimetype,
      bytes: file.size,
    })
  }

  await product.save()
  res.status(201).json({ product: await serializeProductForAdmin(product) })
})

adminRouter.delete('/products/:id/images/:imageId', async (req, res) => {
  const product = await ProductModel.findById(req.params.id).exec()
  if (!product) throw HttpError.notFound('No such product')

  const image = product.images.find((candidate) => String(candidate._id) === req.params.imageId)
  if (!image) throw HttpError.notFound('No such image')

  if (product.published && product.images.length === 1) {
    throw HttpError.badRequest('Unpublish it before removing its last image')
  }

  invalidateSignedUrl(image.key)
  await deleteObject(image.key).catch((error) =>
    console.warn(`[s3] failed to delete ${image.key}`, error),
  )

  product.images.pull({ _id: image._id })
  await product.save()

  res.json({ product: await serializeProductForAdmin(product) })
})

/* Reordering is a whole-array replace so the UI can drag images around and
   commit once. */
adminRouter.patch('/products/:id/images/order', async (req, res) => {
  const body = z.object({ imageIds: z.array(z.string()).min(1) }).parse(req.body)

  const product = await ProductModel.findById(req.params.id).exec()
  if (!product) throw HttpError.notFound('No such product')

  const byId = new Map(product.images.map((image) => [String(image._id), image]))
  if (body.imageIds.length !== byId.size || body.imageIds.some((id) => !byId.has(id))) {
    throw HttpError.badRequest('imageIds must list every image on the product exactly once')
  }

  product.set(
    'images',
    body.imageIds.map((id) => byId.get(id)),
  )
  await product.save()

  res.json({ product: await serializeProductForAdmin(product) })
})


/* Subscribers, so the studio can see who is on a plan without a Stripe login.
   Stripe remains the source of truth; this is a read-only mirror kept up to
   date by the webhook. */
adminRouter.get('/subscriptions', async (req, res) => {
  const query = z
    .object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      skip: z.coerce.number().int().min(0).default(0),
    })
    .parse(req.query)

  /* An incomplete subscription is an abandoned checkout, not a subscriber. */
  const filter = { status: { $ne: 'incomplete' } }

  const [subscriptions, total] = await Promise.all([
    SubscriptionModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(query.skip)
      .limit(query.limit)
      .exec(),
    SubscriptionModel.countDocuments(filter),
  ])

  res.json({ subscriptions: subscriptions.map(serializeSubscription), total })
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
