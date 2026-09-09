import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { STRIPE_PUBLISHABLE_KEY } from "../config";

/* loadStripe injects a script tag, so it is called once per page load and the
   promise is shared by every component that mounts Elements. */
let cached: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> {
  if (!STRIPE_PUBLISHABLE_KEY) {
    return Promise.reject(
      new Error("VITE_STRIPE_PUBLISHABLE_KEY is not set; payments are disabled"),
    );
  }
  cached ??= loadStripe(STRIPE_PUBLISHABLE_KEY);
  return cached;
}
