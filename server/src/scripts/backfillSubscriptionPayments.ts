import { connectToDatabase, disconnectFromDatabase } from '../db.ts'
import { SubscriptionModel } from '../models/Subscription.ts'
import { recordSubscriptionPayment } from '../services/subscriptionPayments.ts'
import { stripe } from '../services/stripe.ts'

/* Subscription charges only started being recorded when the earnings view was
   built, so everything billed before that exists in Stripe and nowhere else.
   This walks each known subscription's invoices and writes the ones that took
   money.

   Safe to re-run: recordSubscriptionPayment upserts on the invoice id. */

async function main(): Promise<void> {
  await connectToDatabase()

  const subscriptions = await SubscriptionModel.find().exec()
  let recorded = 0
  let seen = 0

  for (const subscription of subscriptions) {
    const invoices = await stripe.invoices.list({
      subscription: subscription.stripeSubscriptionId,
      limit: 100,
    })

    for (const invoice of invoices.data) {
      seen += 1
      if (await recordSubscriptionPayment(subscription, invoice)) recorded += 1
    }
  }

  console.log(
    `${subscriptions.length} subscriptions, ${seen} invoices seen, ${recorded} newly recorded`,
  )

  await disconnectFromDatabase()
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
