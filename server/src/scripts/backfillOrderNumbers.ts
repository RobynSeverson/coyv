import { connectToDatabase, disconnectFromDatabase } from '../db.ts'
import {
  formatIncompleteNumber,
  formatOrderNumber,
  INCOMPLETE_NUMBER_SEQUENCE,
  ORDER_NUMBER_SEQUENCE,
} from '../lib/orderNumber.ts'
import { CounterModel } from '../models/Counter.ts'
import { isSettledStatus, OrderModel } from '../models/Order.ts'
import { SubscriptionPaymentModel } from '../models/SubscriptionPayment.ts'

/* Puts every existing record on the right track: CV for money that moved, INC
   for baskets that never paid. Both sequences are rebuilt from scratch in the
   order the records were created, and the counters are left pointing at the
   next free number on each.

   This renumbers, so it must not be run once CV numbers have been quoted to
   customers who could still be holding them. It was safe the first time
   because only one record had ever settled. */

async function main(): Promise<void> {
  await connectToDatabase()

  const [orders, payments] = await Promise.all([
    OrderModel.find().select('_id number status createdAt').lean().exec(),
    SubscriptionPaymentModel.find().select('_id number paidAt createdAt').lean().exec(),
  ])

  /* Orders and subscription charges share the CV sequence, so they are
     numbered as one list in the order the money came in. */
  const rows = [
    ...orders.map((order) => ({
      kind: 'order' as const,
      id: order._id,
      settled: isSettledStatus(order.status),
      at: order.createdAt ?? new Date(0),
    })),
    ...payments.map((payment) => ({
      kind: 'payment' as const,
      id: payment._id,
      /* A recorded subscription charge exists only because an invoice was
         paid, so there is no unsettled case here. */
      settled: true,
      at: payment.paidAt ?? payment.createdAt ?? new Date(0),
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime())

  let settledSeq = 0
  let incompleteSeq = 0

  for (const row of rows) {
    const number = row.settled
      ? formatOrderNumber(++settledSeq)
      : formatIncompleteNumber(++incompleteSeq)

    if (row.kind === 'order') {
      await OrderModel.updateOne({ _id: row.id }, { $set: { number } }).exec()
    } else {
      await SubscriptionPaymentModel.updateOne({ _id: row.id }, { $set: { number } }).exec()
    }
  }

  /* $max rather than a plain set: a checkout that happened while this was
     running has already taken a number, and that one must not be handed out
     to anybody else. */
  await Promise.all([
    CounterModel.updateOne(
      { _id: ORDER_NUMBER_SEQUENCE },
      { $max: { seq: settledSeq } },
      { upsert: true },
    ).exec(),
    CounterModel.updateOne(
      { _id: INCOMPLETE_NUMBER_SEQUENCE },
      { $max: { seq: incompleteSeq } },
      { upsert: true },
    ).exec(),
  ])

  console.log(
    `${rows.length} records: ${settledSeq} settled (CV), ${incompleteSeq} incomplete (INC)`,
  )

  await disconnectFromDatabase()
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
