import { env } from '../../env.ts'
import type { FulfillmentDocument } from '../../models/Fulfillment.ts'
import type { OrderDocument } from '../../models/Order.ts'

/* Product titles, buyer names and addresses are all free text that ends up
   inside an HTML email, so every interpolation goes through this. Nothing in
   here builds markup from unescaped input. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function formatMoney(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100)
}

export function adminFulfillmentUrl(filter: 'due' | 'past-due' = 'due'): string {
  return `${env.PUBLIC_SITE_URL}${env.ADMIN_PATH}?tab=fulfillment&filter=${filter}`
}

const WRAPPER_STYLE =
  'font-family:Georgia,"Times New Roman",serif;color:#1c1a1f;line-height:1.6;' +
  'max-width:560px;margin:0 auto;padding:32px 24px'

function layout(heading: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#faf7f2">
<div style="${WRAPPER_STYLE}">
<h1 style="font-size:22px;font-weight:normal;letter-spacing:0.04em;margin:0 0 20px">${escapeHtml(heading)}</h1>
${body}
<hr style="border:none;border-top:1px solid #e3ddd3;margin:28px 0 14px">
<p style="font-size:12px;color:#7a7280;margin:0">coyv · <a href="${env.PUBLIC_SITE_URL}" style="color:#7a7280">coyvcastle.com</a></p>
</div></body></html>`
}

function addressLines(fulfillment: FulfillmentDocument | OrderDocument): string[] {
  const address = fulfillment.shippingAddress
  if (!address) return []

  return [
    address.line1,
    address.line2,
    [address.city, address.state].filter(Boolean).join(', '),
    address.postalCode,
    address.country,
  ].filter((line) => (line ?? '').trim().length > 0) as string[]
}

function itemList(items: { title: string; quantity: number }[]): string {
  return `<ul style="padding-left:18px;margin:0 0 18px">${items
    .map(
      (item) =>
        `<li style="margin-bottom:4px">${escapeHtml(item.title)} × ${item.quantity}</li>`,
    )
    .join('')}</ul>`
}

export type Template = { subject: string; html: string; text: string }

export function orderConfirmation(order: OrderDocument): Template {
  const items = order.items.map((item) => ({ title: item.title, quantity: item.quantity }))
  const total = formatMoney(order.amountTotalCents, order.currency)
  const address = addressLines(order)

  const html = layout(
    'thank you',
    `<p>Your order is confirmed and will be packed by hand shortly.</p>
${itemList(items)}
<p><strong>Total paid:</strong> ${escapeHtml(total)}</p>
${
  address.length > 0
    ? `<p style="margin-top:18px"><strong>Posting to</strong><br>${[
        order.shippingName ?? '',
        ...address,
      ]
        .filter((line) => line.trim().length > 0)
        .map(escapeHtml)
        .join('<br>')}</p>`
    : ''
}
<p style="margin-top:18px">You will get another note from me the day it goes in the post.</p>`,
  )

  const text = [
    'Thank you — your order is confirmed and will be packed by hand shortly.',
    '',
    ...items.map((item) => `- ${item.title} x ${item.quantity}`),
    '',
    `Total paid: ${total}`,
    ...(address.length > 0 ? ['', 'Posting to:', order.shippingName ?? '', ...address] : []),
    '',
    'You will get another note from me the day it goes in the post.',
  ].join('\n')

  return { subject: 'your coyv order is confirmed', html, text }
}

/* Sent for every monthly charge, including the first. The period label is what
   makes a renewal legible: "October 2026" tells the subscriber which month's
   print this payment bought. */
export function subscriptionCharge(fulfillment: FulfillmentDocument): Template {
  const period = fulfillment.periodLabel
  const heading = period ? `${period.toLowerCase()} is on its way` : 'your subscription renewed'

  const html = layout(
    heading,
    `<p>Your subscription to <strong>${escapeHtml(fulfillment.title)}</strong> has been charged${
      period ? ` for ${escapeHtml(period)}` : ''
    }.</p>
<p>This month's print will be packed and posted to you shortly.</p>`,
  )

  const text = [
    `Your subscription to ${fulfillment.title} has been charged${period ? ` for ${period}` : ''}.`,
    '',
    "This month's print will be packed and posted to you shortly.",
  ].join('\n')

  return {
    subject: period
      ? `${fulfillment.title} — ${period}`
      : `${fulfillment.title} — subscription renewed`,
    html,
    text,
  }
}

export function shippedNotice(fulfillment: FulfillmentDocument): Template {
  const tracking = fulfillment.trackingNumber?.trim() ?? ''

  const html = layout(
    'it is in the post',
    `<p><strong>${escapeHtml(fulfillment.title)}</strong>${
      fulfillment.periodLabel ? ` (${escapeHtml(fulfillment.periodLabel)})` : ''
    } has been sent.</p>
${tracking ? `<p><strong>Tracking:</strong> ${escapeHtml(tracking)}</p>` : ''}
<p>Thank you for giving it a home.</p>`,
  )

  const text = [
    `${fulfillment.title}${fulfillment.periodLabel ? ` (${fulfillment.periodLabel})` : ''} has been sent.`,
    ...(tracking ? ['', `Tracking: ${tracking}`] : []),
    '',
    'Thank you for giving it a home.',
  ].join('\n')

  return { subject: `${fulfillment.title} is in the post`, html, text }
}

export type DigestEntry = {
  label: string
  recipient: string
  waitingDays: number
  pastDue: boolean
}

export type DigestInput = {
  entries: DigestEntry[]
  total: number
  pastDueCount: number
  /* True when the queue is longer than DIGEST_MAX_ITEMS, in which case the
     email deliberately carries a link instead of an unreadable wall of rows. */
  collapsed: boolean
}

export function adminDigest(input: DigestInput): Template {
  const { entries, total, pastDueCount, collapsed } = input
  const url = adminFulfillmentUrl(pastDueCount > 0 ? 'past-due' : 'due')
  const noun = total === 1 ? 'parcel' : 'parcels'

  const summary =
    `<p>There ${total === 1 ? 'is' : 'are'} <strong>${total}</strong> ${noun} waiting to go out` +
    (pastDueCount > 0
      ? `, <strong>${pastDueCount}</strong> of them past due.`
      : '.') +
    '</p>'

  const button =
    `<p style="margin:24px 0"><a href="${url}" ` +
    'style="background:#1c1a1f;color:#faf7f2;padding:12px 22px;text-decoration:none;' +
    'border-radius:2px;display:inline-block">open the fulfillment queue</a></p>'

  const rows = entries
    .map(
      (entry) =>
        `<li style="margin-bottom:6px">${entry.pastDue ? '<strong>' : ''}${escapeHtml(entry.label)}${
          entry.pastDue ? '</strong>' : ''
        } <span style="color:#7a7280">— ${escapeHtml(entry.recipient)}, waiting ${
          entry.waitingDays
        } day${entry.waitingDays === 1 ? '' : 's'}${entry.pastDue ? ', past due' : ''}</span></li>`,
    )
    .join('')

  const html = layout(
    'parcels to send',
    collapsed
      ? `${summary}<p>That is more than fits in an email, so here is the list itself:</p>${button}`
      : `${summary}<ul style="padding-left:18px;margin:0 0 8px">${rows}</ul>${button}`,
  )

  const text = collapsed
    ? [
        `${total} ${noun} waiting to go out${pastDueCount > 0 ? `, ${pastDueCount} past due` : ''}.`,
        '',
        'That is more than fits in an email. Open the queue:',
        url,
      ].join('\n')
    : [
        `${total} ${noun} waiting to go out${pastDueCount > 0 ? `, ${pastDueCount} past due` : ''}.`,
        '',
        ...entries.map(
          (entry) =>
            `- ${entry.label} — ${entry.recipient}, waiting ${entry.waitingDays} day` +
            `${entry.waitingDays === 1 ? '' : 's'}${entry.pastDue ? ', past due' : ''}`,
        ),
        '',
        url,
      ].join('\n')

  return {
    subject:
      pastDueCount > 0
        ? `${total} ${noun} to send (${pastDueCount} past due)`
        : `${total} ${noun} to send`,
    html,
    text,
  }
}
