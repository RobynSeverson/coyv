export const EARNINGS_BUCKETS = ['week', 'month', 'year'] as const
export type EarningsBucket = (typeof EARNINGS_BUCKETS)[number]

export type EarningsEntry = { at: Date; cents: number; kind: 'order' | 'subscription' }

export type EarningsRow = {
  key: string
  label: string
  startsAt: string
  orderCents: number
  subscriptionCents: number
  totalCents: number
}

/* Everything is bucketed in UTC. The studio reads these as "how did this month
   go", not as an accounting close, and a fixed zone is the only way the same
   payment cannot fall in two different weeks depending on where the server
   happens to be running. */
function startOf(bucket: EarningsBucket, at: Date): Date {
  const date = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), 0, 0, 0, 0),
  )

  if (bucket === 'week') {
    /* Weeks run Monday to Sunday; getUTCDay puts Sunday at 0. */
    const weekday = (date.getUTCDay() + 6) % 7
    date.setUTCDate(date.getUTCDate() - weekday)
    return date
  }

  if (bucket === 'month') return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1))
  return new Date(Date.UTC(at.getUTCFullYear(), 0, 1))
}

function step(bucket: EarningsBucket, start: Date, by: number): Date {
  if (bucket === 'week') {
    const next = new Date(start)
    next.setUTCDate(next.getUTCDate() + by * 7)
    return next
  }
  if (bucket === 'month') {
    return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + by, 1))
  }
  return new Date(Date.UTC(start.getUTCFullYear() + by, 0, 1))
}

function label(bucket: EarningsBucket, start: Date): string {
  if (bucket === 'year') return String(start.getUTCFullYear())

  if (bucket === 'month') {
    return start.toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    })
  }

  return start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/* Empty buckets are returned rather than skipped: a month that took nothing is
   a fact about the month, and dropping it would draw a chart of good months
   only. */
export function bucketEarnings(
  entries: EarningsEntry[],
  bucket: EarningsBucket,
  count: number,
  now = new Date(),
): EarningsRow[] {
  const rows: EarningsRow[] = []
  const oldest = step(bucket, startOf(bucket, now), -(count - 1))

  const totals = new Map<string, { orderCents: number; subscriptionCents: number }>()
  for (const entry of entries) {
    if (entry.at < oldest) continue
    const key = startOf(bucket, entry.at).toISOString()
    const found = totals.get(key) ?? { orderCents: 0, subscriptionCents: 0 }
    if (entry.kind === 'order') found.orderCents += entry.cents
    else found.subscriptionCents += entry.cents
    totals.set(key, found)
  }

  for (let index = 0; index < count; index += 1) {
    const start = step(bucket, oldest, index)
    const found = totals.get(start.toISOString()) ?? { orderCents: 0, subscriptionCents: 0 }
    rows.push({
      key: start.toISOString(),
      label: label(bucket, start),
      startsAt: start.toISOString(),
      orderCents: found.orderCents,
      subscriptionCents: found.subscriptionCents,
      totalCents: found.orderCents + found.subscriptionCents,
    })
  }

  return rows
}
