import type { ProductDocument } from '../models/Product.ts'
import type { OrderDocument } from '../models/Order.ts'
import type { SubscriptionDocument } from '../models/Subscription.ts'
import type { MemoryDocument } from '../models/Memory.ts'
import { getSignedObjectUrl } from '../services/s3.ts'

export type SerializedImage = {
  id: string
  url: string
  alt: string
  width: number | null
  height: number | null
}

export type SerializedProduct = {
  id: string
  kind: 'print' | 'subscription'
  slug: string
  title: string
  description: string
  priceCents: number
  currency: string
  /* Null for a one-off print; "month" for a subscription. */
  interval: string | null
  stock: number | null
  soldOut: boolean
  /* A subscription cannot be bought until Stripe has a price for it. */
  available: boolean
  images: SerializedImage[]
}

async function serializeImages(product: ProductDocument): Promise<SerializedImage[]> {
  return Promise.all(
    product.images.map(async (image) => ({
      id: String(image._id),
      url: await getSignedObjectUrl(image.key),
      alt: image.alt || product.title,
      width: image.width ?? null,
      height: image.height ?? null,
    })),
  )
}

export async function serializeProduct(product: ProductDocument): Promise<SerializedProduct> {
  const isSubscription = product.kind === 'subscription'

  return {
    id: String(product._id),
    kind: isSubscription ? 'subscription' : 'print',
    slug: product.slug,
    title: product.title,
    description: product.description,
    priceCents: product.priceCents,
    currency: product.currency,
    interval: isSubscription ? 'month' : null,
    /* Stock is a print idea; a subscription is never sold out. */
    stock: isSubscription ? null : (product.stock ?? null),
    soldOut:
      !isSubscription &&
      product.stock !== null &&
      product.stock !== undefined &&
      product.stock <= 0,
    available: !isSubscription || Boolean(product.stripePriceId),
    images: await serializeImages(product),
  }
}

export function serializeProducts(products: ProductDocument[]): Promise<SerializedProduct[]> {
  return Promise.all(products.map(serializeProduct))
}

/* The admin view adds the fields the shop front has no business knowing. */
export async function serializeProductForAdmin(product: ProductDocument) {
  return {
    ...(await serializeProduct(product)),
    published: product.published,
    sortOrder: product.sortOrder,
    imageKeys: product.images.map((image) => image.key),
    stripePriceId: product.stripePriceId ?? null,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  }
}

export function serializeSubscription(subscription: SubscriptionDocument) {
  return {
    id: String(subscription._id),
    productId: String(subscription.product),
    slug: subscription.slug,
    title: subscription.title,
    status: subscription.status,
    unitAmountCents: subscription.unitAmountCents,
    currency: subscription.currency,
    interval: subscription.interval,
    email: subscription.email,
    name: subscription.name,
    currentPeriodEnd: subscription.currentPeriodEnd,
    canceledAt: subscription.canceledAt,
    lastPaymentError: subscription.lastPaymentError,
    createdAt: subscription.createdAt,
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
      productId: String(item.print),
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
