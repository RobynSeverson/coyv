import { connectToDatabase, disconnectFromDatabase } from '../db.ts'
import { CounterModel } from '../models/Counter.ts'
import { formatOrderNumber, ORDER_NUMBER_SEQUENCE } from '../lib/orderNumber.ts'
import { OrderModel } from '../models/Order.ts'
import { SubscriptionPaymentModel } from '../models/SubscriptionPayment.ts'

/* Numbers used to be derived from the record's id; they are now drawn from a
   shared counter and read CV00001. This gives every record written before the
   change a number in the order it was actually taken, and leaves the counter
   pointing at the next free one.

   Safe to re-run: anything already numbered is skipped and the counter is set
   to the highest number in use rather than incremented. */

async function main(): Promise<void> {
  await connectToDatabase()

  const [orders, payments] = await Promise.all([
    OrderModel.find().select('_id number createdAt').lean().exec(),
    SubscriptionPaymentModel.find().select('_id number paidAt createdAt').lean().exec(),
  ])

  /* Orders and subscription charges share one sequence, so they are numbered
     as one list in the order the money came in. */
  const rows = [
    ...orders.map((order) => ({
      kind: 'order' as const,
      id: order._id,
      number: order.number ?? null,
      at: order.createdAt ?? new Date(0),
    })),
    ...payments.map((payment) => ({
      kind: 'payment' as const,
      id: payment._id,
      number: payment.number ?? null,
      at: payment.paidAt ?? payment.createdAt ?? new Date(0),
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime())

  let seq = 0
  let numbered = 0

  for (const row of rows) {
    seq += 1
    if (row.number) continue

    const number = formatOrderNumber(seq)
    if (row.kind === 'order') {
      await OrderModel.updateOne({ _id: row.id }, { $set: { number } }).exec()
    } else {
      await SubscriptionPaymentModel.updateOne({ _id: row.id }, { $set: { number } }).exec()
    }
    numbered += 1
  }

  await CounterModel.updateOne(
    { _id: ORDER_NUMBER_SEQUENCE },
    { $max: { seq } },
    { upsert: true },
  ).exec()

  console.log(
    `${rows.length} records (${orders.length} orders, ${payments.length} subscription charges), ` +
      `${numbered} newly numbered, counter at ${seq}`,
  )

  await disconnectFromDatabase()
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
