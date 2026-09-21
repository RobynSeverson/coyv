import type { ProductDocument } from '../models/Product.ts'
import type { OrderDocument } from '../models/Order.ts'
import type { SubscriptionDocument } from '../models/Subscription.ts'
import type { SubscriptionPaymentDocument } from '../models/SubscriptionPayment.ts'
import { memoryImages, type MemoryDocument, type MemoryKind } from '../models/Memory.ts'
import type { FulfillmentDocument } from '../models/Fulfillment.ts'
import { env } from '../env.ts'
import { referenceNumber } from './referenceNumber.ts'
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

/* Only ever the display copy. Anything the browser can render can be saved,
   so the protection that matters is not handing out the print-resolution file
   in the first place. Images uploaded before display copies existed fall back
   to the original rather than disappearing from the shop. */
async function serializeImages(product: ProductDocument): Promise<SerializedImage[]> {
  return Promise.all(
    product.images.map(async (image) => ({
      id: String(image._id),
      url: await getSignedObjectUrl(image.displayKey ?? image.key),
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
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    canceledAt: subscription.canceledAt,
    lastPaymentError: subscription.lastPaymentError,
    createdAt: subscription.createdAt,
  }
}

/* A parcel is past due once it has sat unsent for longer than the configured
   window. Defined once, here, so the admin list, the digest email and its
   deep link cannot drift apart. */
export function isPastDue(fulfillment: FulfillmentDocument, now = new Date()): boolean {
  if (fulfillment.status !== 'pending') return false
  const created = fulfillment.createdAt as Date | undefined
  if (!created) return false

  const cutoff = now.getTime() - env.FULFILLMENT_PAST_DUE_DAYS * 24 * 60 * 60 * 1000
  return created.getTime() < cutoff
}

export function serializeFulfillment(fulfillment: FulfillmentDocument) {
  return {
    id: String(fulfillment._id),
    kind: fulfillment.kind,
    orderId: fulfillment.order ? String(fulfillment.order) : null,
    subscriptionId: fulfillment.subscription ? String(fulfillment.subscription) : null,
    periodLabel: fulfillment.periodLabel,
    title: fulfillment.title,
    items: fulfillment.items.map((item) => ({
      title: item.title,
      quantity: item.quantity,
    })),
    email: fulfillment.email,
    shippingName: fulfillment.shippingName,
    shippingAddress: fulfillment.shippingAddress,
    status: fulfillment.status,
    sentAt: fulfillment.sentAt,
    trackingNumber: fulfillment.trackingNumber,
    notes: fulfillment.notes,
    createdAt: fulfillment.createdAt,
    /* Computed here so "past due" means one thing everywhere — the admin
       list, the digest email and its deep link all read the same flag. */
    pastDue: isPastDue(fulfillment),
  }
}

export function serializeOrder(order: OrderDocument) {
  return {
    id: String(order._id),
    /* What the confirmation email quotes, so a customer writing in and the
       row in the admin list are talking about the same thing. */
    number: referenceNumber(order._id),
    /* Both a one-off purchase and a month of a subscription are money taken
       in, so the orders list shows them side by side and this is what tells
       them apart. */
    type: 'order' as const,
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
    periodLabel: '',
    lastPaymentError: order.lastPaymentError,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
  }
}

/* Shaped like an order on purpose: the admin list renders one table, and a
   subscription charge has the same five things a buyer's order does — when,
   what, how much, where to, who. */
export function serializeSubscriptionPayment(payment: SubscriptionPaymentDocument) {
  return {
    id: String(payment._id),
    number: referenceNumber(payment._id),
    type: 'subscription' as const,
    status: 'paid' as const,
    currency: payment.currency,
    amountTotalCents: payment.amountPaidCents,
    email: payment.email,
    shippingName: payment.shippingName,
    /* The address lives on the subscription and can change between months, so
       the packing list in Fulfillments is the place that carries it. */
    shippingAddress: null,
    items: [
      {
        productId: payment.subscription ? String(payment.subscription) : '',
        slug: payment.slug,
        title: payment.title,
        unitAmountCents: payment.amountPaidCents,
        quantity: 1,
      },
    ],
    periodLabel: payment.periodLabel,
    lastPaymentError: null,
    createdAt: payment.paidAt,
    paidAt: payment.paidAt,
  }
}

export type SerializedMemoryImage = {
  id: string
  /* Small webp for the list; falls back to the original when a preview could
     not be generated. */
  previewUrl: string
  /* Untouched original, fetched only when the lightbox opens. */
  url: string
  /* Same object, signed to come back as an attachment under downloadName. */
  downloadUrl: string
  downloadName: string
  width: number | null
  height: number | null
}

export type SerializedMemory = {
  id: string
  kind: MemoryKind
  /* The archive's own name for the file — memory_007 — assigned by position
     so the label a visitor sees matches the order they are reading in. */
  slug: string
  /* Extension the list prints in the corner of a row. */
  tag: string
  title: string
  alt: string
  body: string
  capturedAt: string | null
  images: SerializedMemoryImage[]
}

/* A journal entry is text first, so it is tagged as a log even when images
   are attached to it. */
function memoryTag(kind: MemoryKind, images: { key: string }[]): string {
  if (kind === 'journal') return 'log'
  const extension = images[0]?.key.split('.').pop()?.toLowerCase()
  return extension && extension.length <= 4 ? extension : 'jpg'
}

export async function serializeMemory(
  memory: MemoryDocument,
  index: number,
): Promise<SerializedMemory> {
  const images = memoryImages(memory)
  const slug = `memory_${String(index + 1).padStart(3, '0')}`
  const kind = (memory.kind ?? 'photo') as MemoryKind

  const serializedImages = await Promise.all(
    images.map(async (image, imageIndex) => {
      const extension = image.key.split('.').pop()?.toLowerCase() || 'jpg'
      /* Position-based so a saved file is named the way the page presents it,
         and suffixed only past the first so single-image memories keep the
         filename they have always downloaded as. */
      const downloadName =
        imageIndex === 0
          ? `coyv-${slug}.${extension}`
          : `coyv-${slug}-${imageIndex + 1}.${extension}`

      const [url, downloadUrl, previewUrl] = await Promise.all([
        getSignedObjectUrl(image.key),
        getSignedObjectUrl(image.key, downloadName),
        image.previewKey ? getSignedObjectUrl(image.previewKey) : null,
      ])

      return {
        id: String(image._id),
        previewUrl: previewUrl ?? url,
        url,
        downloadUrl,
        downloadName,
        width: image.width ?? null,
        height: image.height ?? null,
      }
    }),
  )

  return {
    id: String(memory._id),
    kind,
    slug,
    tag: memoryTag(kind, images),
    title: memory.title,
    alt: memory.alt || memory.title,
    body: memory.body ?? '',
    capturedAt: memory.capturedAt ? memory.capturedAt.toISOString() : null,
    images: serializedImages,
  }
}

export function serializeMemories(memories: MemoryDocument[]): Promise<SerializedMemory[]> {
  return Promise.all(memories.map((memory, index) => serializeMemory(memory, index)))
}

export async function serializeMemoryForAdmin(memory: MemoryDocument, index: number) {
  const images = memoryImages(memory)

  return {
    ...(await serializeMemory(memory, index)),
    published: memory.published,
    sortOrder: memory.sortOrder,
    bytes: images.reduce((total, image) => total + image.bytes, 0),
    contentType: images[0]?.contentType ?? null,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  }
}
