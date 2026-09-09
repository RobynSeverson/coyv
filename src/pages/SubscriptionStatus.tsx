import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Subscription } from "../lib/api";
import { formatMoney } from "../lib/money";
import "./Checkout.css";
import "./OrderStatus.css";

/* The webhook is what actually activates a subscription, and it can land a
   moment after the browser gets back here, so the page polls briefly. */
const POLL_INTERVAL_MS = 1500;
const POLL_ATTEMPTS = 10;

const COPY: Record<Subscription["status"], { heading: string; blurb: string }> = {
  active: {
    heading: "you're in",
    blurb: "Your subscription is live. A receipt is on its way.",
  },
  trialing: { heading: "you're in", blurb: "Your trial has started." },
  incomplete: {
    heading: "almost there",
    blurb: "Waiting on confirmation from Stripe. This page will update itself.",
  },
  past_due: {
    heading: "payment failed",
    blurb: "We could not take the first payment. You can try again with another card.",
  },
  unpaid: {
    heading: "payment failed",
    blurb: "We could not take the first payment. You can try again with another card.",
  },
  incomplete_expired: {
    heading: "this one expired",
    blurb: "Nothing was charged. Start again whenever you like.",
  },
  canceled: { heading: "canceled", blurb: "This subscription has been canceled." },
  paused: { heading: "paused", blurb: "This subscription is paused." },
};

export default function SubscriptionStatus() {
  const [params] = useSearchParams();
  const paymentIntent = params.get("payment_intent");
  const clientSecret = params.get("payment_intent_client_secret");

  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  /* Derived rather than pushed into state from an effect: a link without a
     payment reference is knowable at render time. */
  const error =
    !paymentIntent || !clientSecret
      ? "This link is missing its payment reference."
      : lookupError;

  useEffect(() => {
    if (!paymentIntent || !clientSecret) return;

    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const { subscription: loaded } = await api.lookupSubscription(
          paymentIntent,
          clientSecret,
        );
        if (cancelled) return;

        setSubscription(loaded);

        const settled = loaded.status !== "incomplete";
        if (!settled && ++attempts < POLL_ATTEMPTS) {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (cause: unknown) {
        if (cancelled) return;
        setLookupError(
          cause instanceof Error ? cause.message : "Could not look up that subscription",
        );
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [paymentIntent, clientSecret]);

  if (error) {
    return (
      <main className="checkout checkout--empty">
        <h1 className="checkout__title">subscription</h1>
        <p className="checkout__error">{error}</p>
        <Link className="checkout__back" to="/vault">
          back to the vault
        </Link>
      </main>
    );
  }

  if (!subscription) {
    return (
      <main className="checkout checkout--empty">
        <h1 className="checkout__title">subscription</h1>
        <p className="checkout__loading">confirming your subscription…</p>
      </main>
    );
  }

  const copy = COPY[subscription.status];
  const renews = subscription.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd).toLocaleDateString()
    : null;

  return (
    <main className="checkout checkout--empty">
      <h1 className="checkout__title">{copy.heading}</h1>
      <p className="orderStatus__blurb">{copy.blurb}</p>

      {subscription.lastPaymentError ? (
        <p className="checkout__error">{subscription.lastPaymentError}</p>
      ) : null}

      <section className="orderStatus__card" aria-label="Subscription details">
        <p className="orderStatus__reference">
          reference <code>{subscription.id}</code>
        </p>

        <ul className="orderStatus__lines">
          <li className="orderStatus__line">
            <span>{subscription.title}</span>
            <span>
              {formatMoney(subscription.unitAmountCents, subscription.currency)} /{" "}
              {subscription.interval}
            </span>
          </li>
        </ul>

        {renews ? (
          <p className="checkout__total">
            <span>renews</span>
            <span>{renews}</span>
          </p>
        ) : null}

        {subscription.email ? (
          <p className="orderStatus__address">Receipts go to {subscription.email}.</p>
        ) : null}
      </section>

      <p className="checkout__fine">
        To change or cancel, reply to your receipt and we will sort it out.
      </p>

      <Link className="checkout__back" to="/vault">
        back to the vault
      </Link>
    </main>
  );
}
