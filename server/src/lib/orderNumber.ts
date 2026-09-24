import { CounterModel } from '../models/Counter.ts'

/* Two tracks, because most rows in the orders collection are not sales at
   all. A basket that never paid still has to be written down — Stripe needs
   something to hang the payment intent on — but giving it a CV number meant
   the real sequence advanced every time somebody wandered off, and CV00042
   was as likely to be the forty-second abandoned basket as the forty-second
   sale.

   So a record is born on the INC track and is moved onto CV only when the
   money clears. CV is the only one a customer is ever shown; INC is
   bookkeeping. */
export const ORDER_NUMBER_SEQUENCE = 'orderNumber'
export const INCOMPLETE_NUMBER_SEQUENCE = 'incompleteNumber'

const ORDER_PREFIX = 'CV'
const INCOMPLETE_PREFIX = 'INC'
const WIDTH = 5

/* Past 99999 the number simply grows a digit rather than wrapping, because a
   reference already printed on a packing slip must never be reissued. */
export function formatOrderNumber(seq: number): string {
  return `${ORDER_PREFIX}${String(seq).padStart(WIDTH, '0')}`
}

export function formatIncompleteNumber(seq: number): string {
  return `${INCOMPLETE_PREFIX}${String(seq).padStart(WIDTH, '0')}`
}

export function isOrderNumber(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^CV\d+$/i.test(value.trim())
}

/* $inc on a single document is atomic, so concurrent webhooks and checkouts
   each get a distinct number without a transaction. */
async function nextInSequence(name: string): Promise<number> {
  const counter = await CounterModel.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  ).exec()

  return counter?.seq ?? 1
}

export async function nextOrderNumber(): Promise<string> {
  return formatOrderNumber(await nextInSequence(ORDER_NUMBER_SEQUENCE))
}

export async function nextIncompleteNumber(): Promise<string> {
  return formatIncompleteNumber(await nextInSequence(INCOMPLETE_NUMBER_SEQUENCE))
}
