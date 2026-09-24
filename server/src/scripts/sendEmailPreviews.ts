/* Sends one of every email the system can send, filled with sample data, to a
   single address so the whole set can be reviewed and restyled side by side.
   Deliberately sends with no dedupeKey and never touches Mongo, so it can be
   re-run after each styling change. */
import type { FulfillmentDocument } from '../models/Fulfillment.ts'
import type { OrderDocument } from '../models/Order.ts'
import type { SubscriptionDocument } from '../models/Subscription.ts'
import { noreplySender, sendEmail } from '../services/email/brevo.ts'
import {
  adminDigest,
  manageLink,
  orderConfirmation,
  shippedNotice,
  subscriptionCanceled,
  subscriptionCharge,
  type Template,
} from '../services/email/templates.ts'

const to = process.argv[2]

if (!to) {
  console.error('usage: node src/scripts/sendEmailPreviews.ts <email>')
  process.exit(1)
}

const shippingAddress = {
  line1: '14 Hollow Lane',
  line2: 'Flat 2',
  city: 'Providence',
  state: 'RI',
  postalCode: '02906',
  country: 'US',
}

/* Real-looking ObjectIds, so the preview shows the order number the way a
   live email would rather than a reference derived from the word "preview". */
const sampleOrder = {
  _id: '68cf2a1b9d4e7f0012ab34cd',
  number: 'CV00042',
  email: to,
  shippingName: 'Wren Ashby',
  shippingAddress,
  currency: 'usd',
  amountTotalCents: 14800,
  items: [
    { title: 'heavenly dispatch — giclée print', quantity: 1 },
    { title: 'the long quiet — postcard set', quantity: 2 },
  ],
} as unknown as OrderDocument

const sampleSubscriptionFulfillment = {
  _id: '68cf2a1b9d4e7f0012ab7701',
  email: to,
  shippingName: 'Wren Ashby',
  shippingAddress,
  kind: 'subscription',
  title: 'the monthly print',
  periodLabel: 'October 2026',
  sourceKey: 'preview',
  trackingNumber: '9400 1000 0000 0000 0000 00',
} as unknown as FulfillmentDocument

const sampleOrderFulfillment = {
  ...sampleSubscriptionFulfillment,
  kind: 'order',
  order: '68cf2a1b9d4e7f0012ab34cd',
  title: 'heavenly dispatch — giclée print',
  periodLabel: undefined,
  trackingNumber: '',
} as unknown as FulfillmentDocument

const canceledAtPeriodEnd = {
  email: to,
  shippingName: 'Wren Ashby',
  title: 'the monthly print',
  stripeSubscriptionId: 'sub_preview',
  cancelAtPeriodEnd: true,
  currentPeriodEnd: new Date('2026-11-04T00:00:00.000Z'),
} as unknown as SubscriptionDocument

const canceledImmediately = {
  ...canceledAtPeriodEnd,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
} as unknown as SubscriptionDocument

const digestEntries = [
  { label: 'October 2026 — the monthly print', recipient: 'Wren Ashby', waitingDays: 5, pastDue: true },
  { label: 'heavenly dispatch — giclée print', recipient: 'Sol Marchetti', waitingDays: 1, pastDue: false },
  { label: 'the long quiet — postcard set', recipient: 'ren@example.com', waitingDays: 0, pastDue: false },
]

type Preview = { name: string; template: Template; noreply?: boolean }

const previews: Preview[] = [
  { name: 'order-confirmation', template: orderConfirmation(sampleOrder) },
  { name: 'subscription-charge', template: subscriptionCharge(sampleSubscriptionFulfillment) },
  {
    name: 'subscription-charge (no period label)',
    template: subscriptionCharge({
      ...sampleSubscriptionFulfillment,
      periodLabel: undefined,
    } as unknown as FulfillmentDocument),
  },
  {
    name: 'subscription-canceled (runs to period end)',
    template: subscriptionCanceled(canceledAtPeriodEnd),
  },
  {
    name: 'subscription-canceled (ends immediately)',
    template: subscriptionCanceled(canceledImmediately),
  },
  { name: 'shipped (with tracking)', template: shippedNotice(sampleSubscriptionFulfillment) },
  { name: 'shipped (no tracking)', template: shippedNotice(sampleOrderFulfillment, 'CV00042') },
  {
    name: 'manage-link',
    template: manageLink(`${process.env.PUBLIC_SITE_URL ?? ''}/manage-subscription?token=preview-token`),
    noreply: true,
  },
  {
    name: 'fulfillment-digest (listed)',
    template: adminDigest({ entries: digestEntries, total: 3, pastDueCount: 1, collapsed: false }),
    noreply: true,
  },
  {
    name: 'fulfillment-digest (collapsed)',
    template: adminDigest({ entries: [], total: 24, pastDueCount: 6, collapsed: true }),
    noreply: true,
  },
]

for (const preview of previews) {
  const result = await sendEmail({
    kind: `preview:${preview.name}`,
    to: [{ email: to }],
    ...(preview.noreply ? { from: noreplySender() } : {}),
    ...preview.template,
    subject: `[preview] ${preview.template.subject}`,
  })

  console.log(`${preview.name}: ${result.status}${'error' in result ? ` — ${result.error}` : ''}`)

  /* Brevo rate-limits bursts, and a rejected preview looks like a broken
     template rather than a throttle. */
  await new Promise((resolve) => setTimeout(resolve, 600))
}
