import { CounterModel } from '../models/Counter.ts'

/* Orders and subscription charges share one sequence: the admin list shows
   them in a single table, and a customer quoting "CV00042" should never have
   to say which of the two kinds of money it was. */
export const ORDER_NUMBER_SEQUENCE = 'orderNumber'

const PREFIX = 'CV'
const WIDTH = 5

/* Past 99999 the number simply grows a digit rather than wrapping, because a
   reference already printed on a packing slip must never be reissued. */
export function formatOrderNumber(seq: number): string {
  return `${PREFIX}${String(seq).padStart(WIDTH, '0')}`
}

export function parseOrderNumber(value: string): number | null {
  const match = /^CV(\d+)$/i.exec(value.trim())
  return match ? Number(match[1]) : null
}

/* $inc on a single document is atomic, so concurrent webhooks and checkouts
   each get a distinct number without a transaction. Numbers are spent, not
   reserved: an abandoned checkout leaves a gap, which is what every other
   order book does too. */
export async function nextOrderNumber(): Promise<string> {
  const counter = await CounterModel.findByIdAndUpdate(
    ORDER_NUMBER_SEQUENCE,
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  ).exec()

  return formatOrderNumber(counter?.seq ?? 1)
}
