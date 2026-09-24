declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/* The single place anything talks to GA4. gtag.js is loaded async, so on a
   cold start an event can fire before the script defines window.gtag — the
   inline snippet in index.html defines the queue-backed stub synchronously,
   but this guards anyway rather than throw from inside a click handler. */
export function trackEvent(name: string, params: Record<string, unknown> = {}) {
  window.gtag?.("event", name, params);
}

/* GA4's ecommerce schema is in major units, so every price crosses this
   boundary exactly once. Rounded rather than left as a raw division because
   cents / 100 can land on 19.989999999999998. */
function toMajorUnits(cents: number): number {
  return Math.round(cents) / 100;
}

export type AnalyticsItem = {
  item_id: string;
  item_name: string;
  item_category: "print" | "subscription";
  price: number;
  quantity: number;
};

/* Products, cart lines, order items and subscriptions all describe the same
   thing under different field names; this is where they converge on GA4's. */
export function analyticsItem(source: {
  productId: string;
  title: string;
  priceCents: number;
  quantity?: number;
  kind?: "print" | "subscription";
}): AnalyticsItem {
  return {
    item_id: source.productId,
    item_name: source.title,
    item_category: source.kind === "subscription" ? "subscription" : "print",
    price: toMajorUnits(source.priceCents),
    quantity: source.quantity ?? 1,
  };
}

function itemsValue(items: AnalyticsItem[]): number {
  const cents = items.reduce((total, item) => total + item.price * 100 * item.quantity, 0);
  return toMajorUnits(cents);
}

/* GA4 drops an ecommerce event outright if currency is missing, so it is
   never optional here. `value` falls back to the items' own total but stays
   overridable, because the server is what actually prices an order. */
export function trackEcommerce(
  name: string,
  options: {
    currency: string;
    items: AnalyticsItem[];
    valueCents?: number;
    params?: Record<string, unknown>;
  },
) {
  trackEvent(name, {
    currency: options.currency.toUpperCase(),
    value:
      options.valueCents === undefined ? itemsValue(options.items) : toMajorUnits(options.valueCents),
    items: options.items,
    ...options.params,
  });
}

/* Both post-payment pages poll until a webhook lands, and either can be
   reopened from a bookmark or the receipt email, so a purchase would
   otherwise be counted more than once. GA4 only de-duplicates a
   transaction_id within one session, which a reload the next day is not. */
const ONCE_KEY = "coyv.analytics.once";
const ONCE_LIMIT = 50;

function readOnceKeys(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ONCE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

export function hasTracked(key: string): boolean {
  return readOnceKeys().includes(key);
}

export function markTracked(key: string) {
  try {
    const kept = readOnceKeys().filter((entry) => entry !== key);
    kept.push(key);
    localStorage.setItem(ONCE_KEY, JSON.stringify(kept.slice(-ONCE_LIMIT)));
  } catch {
    /* Private browsing can refuse the write. A duplicated purchase event is a
       better outcome than throwing from the thank-you page. */
  }
}

export {};
