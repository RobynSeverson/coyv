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

export {};
