import { connectToDatabase, disconnectFromDatabase } from '../db.ts'
import { MemoryModel, randomCapturedAt, toMemoryImageInput } from '../models/Memory.ts'

/* Memories written before a memory could hold more than one image keep their
   single `image`, and before they carried a date keep none. The serializer
   reads both shapes, so the site works either way — this just settles the
   records onto the current one so the admin panel can edit them.

   Safe to re-run: a memory already holding `images` is only given a date. */

async function main() {
  await connectToDatabase()

  const memories = await MemoryModel.find().exec()
  let moved = 0
  let dated = 0

  for (const memory of memories) {
    let changed = false

    if (memory.images.length === 0 && memory.image) {
      memory.set('images', [toMemoryImageInput(memory.image)])
      memory.set('image', undefined)
      moved += 1
      changed = true
    }

    if (!memory.capturedAt) {
      memory.set('capturedAt', randomCapturedAt())
      dated += 1
      changed = true
    }

    if (!memory.kind) {
      memory.set('kind', 'photo')
      changed = true
    }

    if (changed) await memory.save()
  }

  console.log(`${memories.length} memories: ${moved} moved to images[], ${dated} dated`)

  await disconnectFromDatabase()
}

main().catch(async (error: unknown) => {
  console.error(error)
  await disconnectFromDatabase().catch(() => undefined)
  process.exit(1)
})
