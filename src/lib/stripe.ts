import { loadStripe, type Stripe, type StripePaymentElementOptions } from "@stripe/stripe-js";
import { STRIPE_PUBLISHABLE_KEY } from "../config";

/* Apple Pay for a subscription must be declared as recurring: the sheet then
   shows the monthly charge, and Apple issues a merchant token (MPAN) tied to
   the subscriber rather than one tied to the device, so renewals keep working
   after they change phones. Without it a renewal can fail off-session. */
export function applePaySubscription(plan: {
  title: string;
  amountCents: number;
}): NonNullable<StripePaymentElementOptions["applePay"]> {
  return {
    recurringPaymentRequest: {
      paymentDescription: plan.title,
      managementURL: `${window.location.origin}/manage-subscription`,
      regularBilling: {
        label: plan.title,
        amount: plan.amountCents,
        recurringPaymentIntervalUnit: "month",
        recurringPaymentIntervalCount: 1,
      },
    },
  };
}

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
