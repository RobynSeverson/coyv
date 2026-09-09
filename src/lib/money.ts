/* Amounts cross the wire as integer minor units; only the view layer ever
   turns them into something with a decimal point in it. */
export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

/* Parses "45", "45.00" or "$45" into cents, rounding rather than truncating
   so 19.99 does not become 1998. */
export function parseMoneyToCents(value: string): number | null {
  const cleaned = value.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const amount = Number.parseFloat(cleaned);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}
