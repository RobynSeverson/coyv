import { Router } from 'express'
import { HttpError } from '../lib/httpError.ts'
import { serializePrint, serializePrints } from '../lib/serialize.ts'
import { PrintModel } from '../models/Print.ts'

export const printsRouter: Router = Router()

/* Public catalogue: unpublished prints must never appear here, so the filter
   is part of the query rather than something the caller can influence. */
printsRouter.get('/', async (_req, res) => {
  const prints = await PrintModel.find({ published: true })
    .sort({ sortOrder: 1, createdAt: -1 })
    .exec()

  res.json({ prints: await serializePrints(prints) })
})

printsRouter.get('/:slug', async (req, res) => {
  const print = await PrintModel.findOne({ slug: req.params.slug, published: true }).exec()
  if (!print) throw HttpError.notFound('No such print')

  res.json({ print: await serializePrint(print) })
})
