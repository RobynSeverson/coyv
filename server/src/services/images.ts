import sharp from 'sharp'

/* Matches what vite-imagetools produced when these images were bundled with
   the app, so the grid keeps loading roughly the same weight it used to. */
const PREVIEW_WIDTH = 900
const PREVIEW_QUALITY = 72

export type ImageDimensions = { width?: number; height?: number }

export async function readDimensions(body: Buffer): Promise<ImageDimensions> {
  try {
    const { width, height } = await sharp(body).metadata()
    return { width, height }
  } catch {
    /* A file we cannot introspect can still be stored and served. */
    return {}
  }
}

/* Returns null when the source cannot be decoded, leaving the caller to fall
   back to the original rather than failing the whole upload. */
export async function buildPreview(body: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(body)
      .rotate()
      .resize({ width: PREVIEW_WIDTH, withoutEnlargement: true })
      .webp({ quality: PREVIEW_QUALITY })
      .toBuffer()
  } catch {
    return null
  }
}
