import { GetObjectCommand } from '@aws-sdk/client-s3'
import { connectToDatabase, disconnectFromDatabase } from '../db.ts'
import { env } from '../env.ts'
import { ProductModel } from '../models/Product.ts'
import { buildDisplay, readDimensions } from '../services/images.ts'
import { buildObjectKey, s3, uploadObject } from '../services/s3.ts'

/* Product images uploaded before display copies existed still have their
   print-resolution original as the only file, and serializeImages falls back
   to it — which is exactly the thing we do not want handed out. This builds
   the missing display copy for each one.

   Safe to re-run: an image that already has a displayKey is skipped. */

async function download(key: string): Promise<Buffer> {
  const result = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }))
  const body = result.Body
  if (!body) throw new Error(`empty body for ${key}`)
  return Buffer.from(await body.transformToByteArray())
}

async function main(): Promise<void> {
  await connectToDatabase()

  const products = await ProductModel.find({ 'images.displayKey': null }).exec()
  let built = 0
  let skipped = 0

  for (const product of products) {
    let changed = false

    for (const image of product.images) {
      if (image.displayKey) {
        skipped += 1
        continue
      }

      const original = await download(image.key)
      const display = await buildDisplay(original)
      if (!display) {
        console.warn(`could not decode ${image.key}, leaving it alone`)
        continue
      }

      const displayKey = buildObjectKey(`products/${product.slug}`, 'image/webp', 'display.webp')
      await uploadObject({ key: displayKey, body: display, contentType: 'image/webp' })

      /* Dimensions are read off the display copy because that is what the
         browser is now given; the original's size is no longer public. */
      const { width, height } = await readDimensions(display)
      image.displayKey = displayKey
      if (width) image.width = width
      if (height) image.height = height

      changed = true
      built += 1
      console.log(
        `${product.slug}: ${image.key} -> ${displayKey} ` +
          `(${original.length} -> ${display.length} bytes)`,
      )
    }

    if (changed) await product.save()
  }

  console.log(`done: ${built} display copies built, ${skipped} already had one`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => disconnectFromDatabase())
