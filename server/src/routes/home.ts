import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { env } from '../env.ts'
import { HttpError } from '../lib/httpError.ts'
import { requireAdmin } from '../middleware/auth.ts'
import { HomeModel, HomeImageModel, type HomeDocument, type HomeImageDocument } from '../models/Home.ts'
import { buildPreview, readDimensions } from '../services/images.ts'
import { ALLOWED_IMAGE_TYPES, buildObjectKey, uploadObject, deleteObject, getSignedObjectUrl } from '../services/s3.ts'

export const homeRouter: Router = Router()
export const adminHomeRouter: Router = Router()
adminHomeRouter.use(requireAdmin)

const imageId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid uploaded image')
const webUrl = z.string().trim().max(2048).url().refine((value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}, 'Use an http or https link')
const showcaseInput = z.object({
  imageId,
  title: z.string().trim().max(160),
  url: z.union([z.literal(''), webUrl]),
})
const newsInput = z.object({
  id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(`${value}T00:00:00Z`)
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  }, 'Enter a valid date'),
  preview: z.string().trim().min(1).max(1000),
  previewImageId: imageId.nullable(),
  body: z.string().trim().min(1).max(20000),
  imageIds: z.array(imageId),
})
const contactInput = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(100),
  url: webUrl,
})
const homeInput = z.object({
  revision: z.number().int().nonnegative(),
  aboutMe: z.string().max(20000),
  projects: z.array(showcaseInput).max(4),
  artwork: z.array(showcaseInput).max(4),
  news: z.array(newsInput).refine((items) => new Set(items.map((item) => item.id)).size === items.length, 'Duplicate news ids'),
  contacts: z.array(contactInput).refine((items) => new Set(items.map((item) => item.id)).size === items.length, 'Duplicate contact ids'),
}).strict()

async function loadHome() {
  return await HomeModel.findById('home').exec() ?? new HomeModel()
}

async function imageMap(ids: string[]) {
  const images = await HomeImageModel.find({ _id: { $in: [...new Set(ids)] } }).exec()
  return new Map(await Promise.all(images.map(async (image) => [
    String(image._id),
    await serializeImage(image),
  ] as const)))
}

async function serializeImage(image: HomeImageDocument) {
  return {
    id: String(image._id),
    url: await getSignedObjectUrl(image.previewKey),
    width: image.width,
    height: image.height,
  }
}

function referencedIds(home: HomeDocument, full: boolean) {
  return [
    ...home.projects.map((item) => String(item.imageId)),
    ...home.artwork.map((item) => String(item.imageId)),
    ...home.news.flatMap((item) => [
      ...(item.previewImageId ? [String(item.previewImageId)] : []),
      ...(full ? item.imageIds.map(String) : []),
    ]),
  ]
}

async function serializeHome(home: HomeDocument, full: boolean) {
  const images = await imageMap(referencedIds(home, full))
  const resolve = (id: string) => {
    const image = images.get(id)
    if (!image) throw new Error(`Missing home image: ${id}`)
    return image
  }
  const showcase = (items: HomeDocument['projects']) => items.map((item) => ({
    image: resolve(String(item.imageId)), title: item.title, url: item.url,
  }))
  return {
    revision: home.revision,
    aboutMe: home.aboutMe,
    projects: showcase(home.projects),
    artwork: showcase(home.artwork),
    news: home.news.map((item) => ({
      id: item.id,
      date: item.date,
      preview: item.preview,
      previewImage: item.previewImageId ? resolve(String(item.previewImageId)) : null,
      ...(full ? { body: item.body, images: item.imageIds.map((id) => resolve(String(id))) } : {}),
    })),
    contacts: home.contacts.map((item) => ({ id: item.id, title: item.title, url: item.url })),
  }
}

homeRouter.get('/', async (_req, res) => {
  res.set('Cache-Control', 'no-store').json({ home: await serializeHome(await loadHome(), false) })
})

homeRouter.get('/news/:id', async (req, res) => {
  const home = await loadHome()
  const news = home.news.find((item) => item.id === req.params.id)
  if (!news) throw HttpError.notFound('This news entry is no longer available')
  const images = await imageMap(news.imageIds.map(String))
  res.set('Cache-Control', 'no-store').json({
    news: {
      id: news.id, date: news.date, preview: news.preview, body: news.body,
      images: news.imageIds.map((id) => {
        const image = images.get(String(id))
        if (!image) throw new Error(`Missing news image: ${id}`)
        return image
      }),
    },
  })
})

adminHomeRouter.get('/', async (_req, res) => {
  res.set('Cache-Control', 'no-store').json({ home: await serializeHome(await loadHome(), true) })
})

adminHomeRouter.put('/', async (req, res) => {
  const { revision, ...content } = homeInput.parse(req.body)
  const ids = new Set([
    ...content.projects.map((item) => item.imageId),
    ...content.artwork.map((item) => item.imageId),
    ...content.news.flatMap((item) => [
      ...(item.previewImageId ? [item.previewImageId] : []), ...item.imageIds,
    ]),
  ])
  const count = await HomeImageModel.countDocuments({ _id: { $in: [...ids] } }).exec()
  if (count !== ids.size) throw HttpError.badRequest('One of these uploads no longer exists. Reload before saving.')

  await HomeModel.updateOne({ _id: 'home' }, { $setOnInsert: { revision: 0 } }, { upsert: true }).exec()
  const home = await HomeModel.findOneAndUpdate(
    { _id: 'home', revision },
    { $set: content, $inc: { revision: 1 } },
    { new: true, runValidators: true },
  ).exec()
  if (!home) throw HttpError.conflict('Home was changed in another session. Reload before saving.')
  res.json({ home: await serializeHome(home, true) })
})

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      callback(HttpError.badRequest(`Unsupported image type: ${file.mimetype}`))
      return
    }
    callback(null, true)
  },
})

adminHomeRouter.post('/images', upload.single('image'), async (req, res) => {
  const file = req.file
  if (!file) throw HttpError.badRequest('Choose an image to upload')
  const [preview, dimensions] = await Promise.all([buildPreview(file.buffer), readDimensions(file.buffer)])
  if (!preview || !dimensions.width || !dimensions.height) {
    throw HttpError.badRequest('This file could not be decoded as an image')
  }
  const key = buildObjectKey('home', file.mimetype, file.originalname)
  const previewKey = `${key.replace(/\.[^./]+$/, '')}-preview.webp`
  let image: HomeImageDocument
  try {
    await uploadObject({ key, body: file.buffer, contentType: file.mimetype })
    await uploadObject({ key: previewKey, body: preview, contentType: 'image/webp' })
    image = await HomeImageModel.create({
      key, previewKey, contentType: file.mimetype, bytes: file.size,
      width: dimensions.width, height: dimensions.height,
    })
  } catch (error) {
    await Promise.all([key, previewKey].map((objectKey) =>
      deleteObject(objectKey).catch((cause) => console.warn(`[s3] failed to clean up ${objectKey}`, cause)),
    ))
    throw error
  }
  res.status(201).json({ image: await serializeImage(image) })
})
