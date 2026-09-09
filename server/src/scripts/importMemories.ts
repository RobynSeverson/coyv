import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { connectToDatabase, disconnectFromDatabase } from '../db.ts'
import { MemoryModel } from '../models/Memory.ts'
import { buildPreview, readDimensions } from '../services/images.ts'
import { buildObjectKey, uploadObject } from '../services/s3.ts'

/* One-shot import of the memories that used to be bundled with the frontend.
   Safe to re-run: a file whose contents are already in S3 under the same
   original name is skipped rather than duplicated. */

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { dir: { type: 'string' } } })
  const dir = values.dir
  if (!dir) throw new Error('Pass --dir path/to/images')

  const entries = (await readdir(dir))
    .filter((name) => CONTENT_TYPE_BY_EXTENSION[path.extname(name).toLowerCase()])
    /* Numeric sort so memory-2 lands before memory-10, matching the order
       the bundled gallery used. */
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

  if (entries.length === 0) throw new Error(`No importable images in ${dir}`)

  await connectToDatabase()

  const last = await MemoryModel.findOne().sort({ sortOrder: -1 }).select('sortOrder').exec()
  let sortOrder = (last?.sortOrder ?? -1) + 1

  for (const name of entries) {
    const existing = await MemoryModel.findOne({ importedFrom: name }).exec()
    if (existing) {
      console.log(`skipped ${name} (already imported)`)
      continue
    }

    const contentType = CONTENT_TYPE_BY_EXTENSION[path.extname(name).toLowerCase()]
    if (!contentType) continue

    const body = await readFile(path.join(dir, name))
    const key = buildObjectKey('memories', contentType, name)

    const [preview, dimensions] = await Promise.all([buildPreview(body), readDimensions(body)])

    await uploadObject({ key, body, contentType })

    let previewKey: string | undefined
    if (preview) {
      previewKey = `${key.replace(/\.[^./]+$/, '')}-preview.webp`
      await uploadObject({ key: previewKey, body: preview, contentType: 'image/webp' })
    }

    await MemoryModel.create({
      title: '',
      alt: '',
      importedFrom: name,
      image: {
        key,
        previewKey,
        contentType,
        bytes: body.byteLength,
        width: dimensions.width,
        height: dimensions.height,
      },
      published: true,
      sortOrder,
    })

    console.log(
      `imported ${name} -> ${key}${preview ? ' (+preview)' : ' (no preview)'} [${sortOrder}]`,
    )
    sortOrder += 1
  }

  await disconnectFromDatabase()
}

main().catch(async (error: unknown) => {
  console.error(error)
  await disconnectFromDatabase().catch(() => undefined)
  process.exit(1)
})
