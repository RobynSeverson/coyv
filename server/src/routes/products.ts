import { Router } from 'express'
import { HttpError } from '../lib/httpError.ts'
import { serializeProduct, serializeProducts } from '../lib/serialize.ts'
import { ProductModel } from '../models/Product.ts'

export const productsRouter: Router = Router()

/* Public catalogue: unpublished products must never appear here, so the filter
   is part of the query rather than something the caller can influence. */
productsRouter.get('/', async (_req, res) => {
  const products = await ProductModel.find({ published: true })
    .sort({ sortOrder: 1, createdAt: -1 })
    .exec()

  res.json({ products: await serializeProducts(products) })
})

productsRouter.get('/:slug', async (req, res) => {
  const product = await ProductModel.findOne({ slug: req.params.slug, published: true }).exec()
  if (!product) throw HttpError.notFound('No such product')

  res.json({ product: await serializeProduct(product) })
})

/* The catalogue was `/api/prints` before subscriptions existed. Kept so a page
   left open on the old bundle keeps working; it only ever lists prints, and a
   document written before `kind` existed counts as one. */
export const printsRouter: Router = Router()

printsRouter.get('/', async (_req, res) => {
  const prints = await ProductModel.find({ published: true, kind: { $ne: 'subscription' } })
    .sort({ sortOrder: 1, createdAt: -1 })
    .exec()

  res.json({ prints: await serializeProducts(prints) })
})
