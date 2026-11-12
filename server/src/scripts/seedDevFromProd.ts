import mongoose from 'mongoose'
import { env } from '../env.ts'
import { ensureSubscriptionPrice } from '../services/stripe.ts'

/* Refreshes the dev environment (dev.coyvcastle.com) with production's
   catalogue, memories, home content and admin login, so changes can be tried against real
   content. Orders, subscriptions and customers are deliberately left behind:
   dev runs on Stripe test mode, and those records point at live-mode objects
   that test mode cannot see.

   Run it with the dev Lambda's configuration loaded (DEPLOYMENT.md shows how),
   so MONGODB_DB_NAME is the dev database and STRIPE_SECRET_KEY is the test key.
   Production is only ever read.

   Safe to re-run. The copied collections are replaced wholesale, but each
   subscription product keeps the test-mode Stripe ids it was given last time
   rather than minting a fresh product on every refresh. */

const COPIED_COLLECTIONS = ['prints', 'memories', 'homecontents', 'homeimages', 'adminusers'] as const
const SOURCE_DB_NAME = process.env.SOURCE_MONGODB_DB_NAME ?? 'coyv'

type StripeIds = { stripeProductId?: string | null; stripePriceId?: string | null }

async function main(): Promise<void> {
  if (env.MONGODB_DB_NAME === SOURCE_DB_NAME) {
    throw new Error(
      `MONGODB_DB_NAME is "${SOURCE_DB_NAME}", the production database. This script ` +
        'writes to MONGODB_DB_NAME, so load the dev Lambda configuration first.',
    )
  }
  /* Production's prints carry live-mode price ids. Replacing them with ids
     minted on a live key would put real prices on a test site. */
  if (!env.STRIPE_SECRET_KEY.startsWith('sk_test_')) {
    throw new Error('STRIPE_SECRET_KEY must be a sk_test_ key; dev never takes real payments.')
  }

  const connection = await mongoose.createConnection(env.MONGODB_URI).asPromise()
  const source = connection.useDb(SOURCE_DB_NAME).db!
  const target = connection.useDb(env.MONGODB_DB_NAME).db!

  const previousStripeIds = new Map<string, StripeIds>()
  for (const print of await target.collection('prints').find().toArray()) {
    previousStripeIds.set(String(print._id), {
      stripeProductId: print.stripeProductId,
      stripePriceId: print.stripePriceId,
    })
  }

  for (const name of COPIED_COLLECTIONS) {
    const documents = await source.collection(name).find().toArray()
    await target.collection(name).deleteMany({})
    if (documents.length > 0) await target.collection(name).insertMany(documents)
    console.log(`${name}: ${documents.length} copied from ${SOURCE_DB_NAME}`)
  }

  const prints = target.collection('prints')
  let priced = 0
  for (const print of await prints.find().toArray()) {
    const previous = previousStripeIds.get(String(print._id)) ?? {}

    if (print.kind !== 'subscription') {
      await prints.updateOne(
        { _id: print._id },
        { $set: { stripeProductId: previous.stripeProductId ?? null, stripePriceId: null } },
      )
      continue
    }

    const ids = await ensureSubscriptionPrice({
      _id: print._id,
      title: print.title,
      description: print.description,
      priceCents: print.priceCents,
      currency: print.currency,
      stripeProductId: previous.stripeProductId ?? null,
      stripePriceId: previous.stripePriceId ?? null,
    })
    await prints.updateOne({ _id: print._id }, { $set: ids })
    priced += 1
  }
  console.log(`${priced} subscription products priced in Stripe test mode`)

  await connection.close()
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
