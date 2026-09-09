import type { PrintDocument } from '../models/Print.ts'
import type { OrderDocument } from '../models/Order.ts'
import type { MemoryDocument } from '../models/Memory.ts'
import { getSignedObjectUrl } from '../services/s3.ts'

export type SerializedImage = {
  id: string
  url: string
  alt: string
  width: number | null
  height: number | null
}

export type SerializedPrint = {
  id: string
  slug: string
  title: string
  description: string
  priceCents: number
  currency: string
  stock: number | null
  soldOut: boolean
  images: SerializedImage[]
}

async function serializeImages(print: PrintDocument): Promise<SerializedImage[]> {
  return Promise.all(
    print.images.map(async (image) => ({
      id: String(image._id),
      url: await getSignedObjectUrl(image.key),
      alt: image.alt || print.title,
      width: image.width ?? null,
      height: image.height ?? null,
    })),
  )
}

export async function serializePrint(print: PrintDocument): Promise<SerializedPrint> {
  return {
    id: String(print._id),
    slug: print.slug,
    title: print.title,
    description: print.description,
    priceCents: print.priceCents,
    currency: print.currency,
    stock: print.stock ?? null,
    soldOut: print.stock !== null && print.stock !== undefined && print.stock <= 0,
    images: await serializeImages(print),
  }
}

export function serializePrints(prints: PrintDocument[]): Promise<SerializedPrint[]> {
  return Promise.all(prints.map(serializePrint))
}

/* The admin view adds the fields the shop front has no business knowing. */
export async function serializePrintForAdmin(print: PrintDocument) {
  return {
    ...(await serializePrint(print)),
    published: print.published,
    sortOrder: print.sortOrder,
    imageKeys: print.images.map((image) => image.key),
    createdAt: print.createdAt,
    updatedAt: print.updatedAt,
  }
}

export function serializeOrder(order: OrderDocument) {
  return {
    id: String(order._id),
    status: order.status,
    currency: order.currency,
    amountTotalCents: order.amountTotalCents,
    email: order.email,
    shippingName: order.shippingName,
    shippingAddress: order.shippingAddress,
    items: order.items.map((item) => ({
      printId: String(item.print),
      slug: item.slug,
      title: item.title,
      unitAmountCents: item.unitAmountCents,
      quantity: item.quantity,
    })),
    lastPaymentError: order.lastPaymentError,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
  }
}

export type SerializedMemory = {
  id: string
  title: string
  alt: string
  /* Small webp for the grid; falls back to the original when a preview could
     not be generated. */
  previewUrl: string
  /* Untouched original, fetched only when the lightbox opens. */
  url: string
  /* Same object, signed to come back as an attachment under downloadName. */
  downloadUrl: string
  width: number | null
  height: number | null
  downloadName: string
}

export async function serializeMemory(
  memory: MemoryDocument,
  index: number,
): Promise<SerializedMemory> {
  const extension = memory.image.key.split('.').pop()?.toLowerCase() || 'jpg'
  /* Position-based so a saved file is named the way the page presents it. */
  const downloadName = `coyv-memory-${index + 1}.${extension}`

  const [url, downloadUrl, previewUrl] = await Promise.all([
    getSignedObjectUrl(memory.image.key),
    getSignedObjectUrl(memory.image.key, downloadName),
    memory.image.previewKey ? getSignedObjectUrl(memory.image.previewKey) : null,
  ])

  return {
    id: String(memory._id),
    title: memory.title,
    alt: memory.alt || memory.title,
    previewUrl: previewUrl ?? url,
    url,
    downloadUrl,
    width: memory.image.width ?? null,
    height: memory.image.height ?? null,
    downloadName,
  }
}

export function serializeMemories(memories: MemoryDocument[]): Promise<SerializedMemory[]> {
  return Promise.all(memories.map((memory, index) => serializeMemory(memory, index)))
}

export async function serializeMemoryForAdmin(memory: MemoryDocument, index: number) {
  return {
    ...(await serializeMemory(memory, index)),
    published: memory.published,
    sortOrder: memory.sortOrder,
    bytes: memory.image.bytes,
    contentType: memory.image.contentType,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  }
}
