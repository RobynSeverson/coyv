import { env } from '../../env.ts'
import { referenceNumber } from '../../lib/referenceNumber.ts'
import type { FulfillmentDocument } from '../../models/Fulfillment.ts'
import type { OrderDocument } from '../../models/Order.ts'
import type { SubscriptionDocument } from '../../models/Subscription.ts'

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

export function manageSubscriptionUrl(): string {
  return `${env.PUBLIC_SITE_URL}/manage-subscription`
}

/* Appended to subscriber mail so the way out is always in front of them
   rather than buried in a support address. */
function manageFooterHtml(): string {
  const url = manageSubscriptionUrl()
  return `<p style="margin-top:22px;font-size:13px;color:#55505c">Need to change your address or cancel? <a href="${url}" style="color:#55505c">Manage your subscription</a> — we will email you a sign-in link.</p>`
}

function manageFooterText(): string {
  return [
    '',
    'Need to change your address or cancel? Manage your subscription at',
    manageSubscriptionUrl(),
    'and we will email you a sign-in link.',
  ].join('\n')
}

/* The stack the site itself is set in, so mail reads as the same hand as the
   vault. Single quotes around the font name, not double: this is interpolated
   into a double-quoted style attribute, and a double quote there closes the
   attribute early and drops every declaration after it. */
const FONT_STACK = "'Helvetica Neue',Helvetica,Arial,sans-serif"

const WRAPPER_STYLE =
  `font-family:${FONT_STACK};color:#0d0c10;line-height:1.6;` +
  /* Wide side margins: the paper is drawn with a ruled line down either edge,
     and text set closer than this runs over them. */
  'padding:30px 58px 30px 74px'

/* Bump whenever any of the three pieces is redrawn. Gmail serves mail images
   through a proxy that caches them by URL and ignores both the cache headers
   and a CloudFront invalidation, so replacing the file alone leaves everyone
   who has already been sent an email looking at the old artwork. */
const ART_VERSION = 2

/* Shipped with the site rather than held in the assets bucket: mail clients
   fetch it unauthenticated, and the assets bucket only ever hands out signed
   URLs that would have expired by the time the email was opened. */
function art(name: string): string {
  return `${env.PUBLIC_SITE_URL}/${name}?v=${ART_VERSION}`
}

/* The mail is one drawing in three pieces: a crest at the top, paper that
   tiles down behind however much text there is, and a closing strip. */
const EMAIL_WIDTH = 600

/* Header and footer are <img>, not backgrounds, because a background image has
   to be given a height to show at all and these have to stay in proportion as
   the client narrows them. The middle has to be a background: it is the one
   piece whose height is whatever the text needs.

   The tile is exported at exactly the table width so it repeats at its natural
   size — `background-size` is ignored by Outlook, which would otherwise show it
   at 1200px and crop half the drawing away. */
function edge(name: string): string {
  return `<tr><td style="padding:0;font-size:0;line-height:0"><img src="${art(name)}" width="${EMAIL_WIDTH}" alt="" style="display:block;width:100%;max-width:${EMAIL_WIDTH}px;height:auto;border:0"></td></tr>`
}

function layout(heading: string, body: string): string {
  const tile = art('email-paper.jpg')

  return `<!doctype html><html><body style="margin:0;padding:0;background:#faf7f2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#faf7f2">
<tr><td align="center" style="padding:0">
<table role="presentation" width="${EMAIL_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:${EMAIL_WIDTH}px;max-width:${EMAIL_WIDTH}px">
${edge('email-header.jpg')}
<tr><td background="${tile}" style="background-color:#faf7f2;background-image:url('${tile}');background-repeat:repeat-y;background-position:top center">
<div style="${WRAPPER_STYLE}">
<h1 style="font-size:22px;font-weight:normal;letter-spacing:0.04em;margin:0 0 20px">${escapeHtml(heading)}</h1>
${body}
<hr style="border:none;border-top:1px solid #e3ddd3;margin:28px 0 14px">
<p style="font-size:12px;color:#55505c;margin:0">coyv · <a href="${env.PUBLIC_SITE_URL}" style="color:#55505c">coyvcastle.com</a></p>
</div>
</td></tr>
${edge('email-footer.jpg')}
</table>
</td></tr></table>
</body></html>`
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
  /* The same number the admin orders list shows, so a customer quoting it can
     be found without them having to produce a Mongo id. */
  const number = order.number ?? referenceNumber(order._id)

  const html = layout(
    'thank you',
    `<p>Your order is confirmed and will be packed by hand shortly.</p>
<p style="font-size:13px;color:#55505c;margin:0 0 18px">Order no. <strong style="color:#0d0c10">${escapeHtml(number)}</strong></p>
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
    `Order no. ${number}`,
    '',
    ...items.map((item) => `- ${item.title} x ${item.quantity}`),
    '',
    `Total paid: ${total}`,
    ...(address.length > 0 ? ['', 'Posting to:', order.shippingName ?? '', ...address] : []),
    '',
    'You will get another note from me the day it goes in the post.',
  ].join('\n')

  return { subject: `your coyv order ${number} is confirmed`, html, text }
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
<p>This month's print will be packed and posted to you shortly.</p>
${manageFooterHtml()}`,
  )

  const text = [
    `Your subscription to ${fulfillment.title} has been charged${period ? ` for ${period}` : ''}.`,
    '',
    "This month's print will be packed and posted to you shortly.",
    manageFooterText(),
  ].join('\n')

  return {
    subject: period
      ? `${fulfillment.title} — ${period}`
      : `${fulfillment.title} — subscription renewed`,
    html,
    text,
  }
}

/* Cancelling stops the next charge but does not end the month already paid
   for, so this has to say both things. Somebody who reads "cancelled" and
   assumes the print they bought is gone will write in asking about it. */
export function subscriptionCanceled(subscription: SubscriptionDocument): Template {
  const endsOn = subscription.cancelAtPeriodEnd ? subscription.currentPeriodEnd : null
  const endsOnLabel = endsOn
    ? endsOn.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : null

  const stillOwed = endsOnLabel
    ? `You will not be charged again. The month you have already paid for still stands, so your subscription runs until <strong>${escapeHtml(endsOnLabel)}</strong> and that print will be packed and posted as usual.`
    : 'You will not be charged again.'

  const resume = endsOnLabel
    ? `<p>Changed your mind? You can start it up again from the <a href="${manageSubscriptionUrl()}" style="color:#0d0c10">manage page</a> any time before then, and nothing will have lapsed.</p>`
    : `<p>You are welcome back whenever you like — a new subscription can be started from <a href="${env.PUBLIC_SITE_URL}/vault" style="color:#0d0c10">the vault</a>.</p>`

  const html = layout(
    'your subscription is cancelled',
    `<p>Your subscription to <strong>${escapeHtml(subscription.title)}</strong> has been cancelled.</p>
<p>${stillOwed}</p>
${resume}
<p style="margin-top:22px">Thank you for having kept it going this long.</p>`,
  )

  const text = [
    `Your subscription to ${subscription.title} has been cancelled.`,
    '',
    endsOnLabel
      ? `You will not be charged again. The month you have already paid for still stands, so your subscription runs until ${endsOnLabel} and that print will be packed and posted as usual.`
      : 'You will not be charged again.',
    '',
    endsOnLabel
      ? `Changed your mind? You can start it up again at ${manageSubscriptionUrl()} any time before then, and nothing will have lapsed.`
      : `You are welcome back whenever you like — a new subscription can be started at ${env.PUBLIC_SITE_URL}/vault`,
    '',
    'Thank you for having kept it going this long.',
  ].join('\n')

  return { subject: `${subscription.title} — subscription cancelled`, html, text }
}

export function shippedNotice(
  fulfillment: FulfillmentDocument,
  orderNumber: string | null = null,
): Template {
  const tracking = fulfillment.trackingNumber?.trim() ?? ''
  /* A month of a subscription is identified by its period, a one-off by the
     number its confirmation quoted — so each carries the reference the
     recipient already has. The caller looks the number up; the derived
     reference is the fallback for orders written before the sequence. */
  const number = fulfillment.order ? (orderNumber ?? referenceNumber(fulfillment.order)) : ''

  const html = layout(
    'it is in the post',
    `<p><strong>${escapeHtml(fulfillment.title)}</strong>${
      fulfillment.periodLabel ? ` (${escapeHtml(fulfillment.periodLabel)})` : ''
    } has been sent.</p>
${number ? `<p style="font-size:13px;color:#55505c;margin:0 0 18px">Order no. <strong style="color:#0d0c10">${escapeHtml(number)}</strong></p>` : ''}
${tracking ? `<p><strong>Tracking:</strong> ${escapeHtml(tracking)}</p>` : ''}
<p>Thank you for giving it a home.</p>`,
  )

  const text = [
    `${fulfillment.title}${fulfillment.periodLabel ? ` (${fulfillment.periodLabel})` : ''} has been sent.`,
    ...(number ? ['', `Order no. ${number}`] : []),
    ...(tracking ? ['', `Tracking: ${tracking}`] : []),
    '',
    'Thank you for giving it a home.',
  ].join('\n')

  return { subject: `${fulfillment.title} is in the post`, html, text }
}

/* The sign-in link for the manage page. Deliberately short-lived and
   single-use, and the copy says so, because a subscriber forwarding this email
   would otherwise be handing over standing access. */
export function manageLink(link: string, minutes = 20): Template {
  const html = layout(
    'manage your subscription',
    `<p>Here is your sign-in link. It works once and expires in ${minutes} minutes.</p>
<p style="margin:24px 0"><a href="${link}" style="font-family:${FONT_STACK};background:#0d0c10;color:#faf7f2;padding:12px 22px;text-decoration:none;border-radius:2px;display:inline-block">manage my subscription</a></p>
<p style="font-size:13px;color:#55505c">From there you can update your postal address or cancel. If you did not ask for this, you can ignore it — nothing has changed.</p>`,
  )

  const text = [
    `Here is your sign-in link. It works once and expires in ${minutes} minutes.`,
    '',
    link,
    '',
    'From there you can update your postal address or cancel.',
    'If you did not ask for this, you can ignore it — nothing has changed.',
  ].join('\n')

  return { subject: 'your link to manage your coyv subscription', html, text }
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
    `style="font-family:${FONT_STACK};background:#0d0c10;color:#faf7f2;padding:12px 22px;text-decoration:none;` +
    'border-radius:2px;display:inline-block">open the fulfillment queue</a></p>'

  const rows = entries
    .map(
      (entry) =>
        `<li style="margin-bottom:6px">${entry.pastDue ? '<strong>' : ''}${escapeHtml(entry.label)}${
          entry.pastDue ? '</strong>' : ''
        } <span style="color:#55505c">— ${escapeHtml(entry.recipient)}, waiting ${
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
