import { Router } from 'express'
import { serializeMemories } from '../lib/serialize.ts'
import { MemoryModel } from '../models/Memory.ts'

export const memoriesRouter: Router = Router()

/* Public gallery. As with prints, the published filter is part of the query
   rather than anything the caller can influence. */
memoriesRouter.get('/', async (_req, res) => {
  const memories = await MemoryModel.find({ published: true })
    .sort({ sortOrder: 1, createdAt: 1 })
    .exec()

  res.json({ memories: await serializeMemories(memories) })
})
