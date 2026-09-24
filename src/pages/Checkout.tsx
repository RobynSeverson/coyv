import {
  AddressElement,
  Elements,
  LinkAuthenticationElement,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import type { StripeElementsOptions } from "@stripe/stripe-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CART_MAX_PER_ITEM } from "../cart/constants";
import { useCart, type CartLine } from "../cart/CartContext";
import { SubscriberDetailsForm, type SubscriberDetails } from "../components/SubscriberDetails";
import { analyticsItem, trackEcommerce, type AnalyticsItem } from "../lib/analytics";
import { api } from "../lib/api";
import { formatMoney } from "../lib/money";
import { getStripe } from "../lib/stripe";
import "./Checkout.css";

const APPEARANCE: StripeElementsOptions["appearance"] = {
  theme: "flat",
  variables: {
    colorBackground: "#ffffff",
    colorText: "#121a1c",
    colorPrimary: "#121a1c",
    borderRadius: "3px",
    fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
    spacingUnit: "4px",
  },
};

function PaymentForm({
  amountCents,
  currency,
  items,
  collectContact,
  returnParams,
  payLabel,
  fine,
}: {
  amountCents: number;
  currency: string;
  items: AnalyticsItem[];
  collectContact: boolean;
  returnParams: string;
  payLabel: string;
  fine: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setError(null);

    /* Reported on submit rather than on a completed payment: the point of the
       event is that a card was entered, and a decline is exactly the drop-off
       the funnel needs to show. */
    trackEcommerce("add_payment_info", { currency, valueCents: amountCents, items });

    /* confirmPayment either redirects away (for methods that need it) or
       resolves here with the outcome; `if_required` keeps card payments on
       the page while still supporting redirect methods. */
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/order?${returnParams}`,
      },
      redirect: "if_required",
    });

    if (result.error) {
      setError(result.error.message ?? "Payment could not be completed");
      setSubmitting(false);
      return;
    }

    const intent = result.paymentIntent;
    window.location.assign(
      `/order?${returnParams}payment_intent=${encodeURIComponent(intent.id)}` +
        `&payment_intent_client_secret=${encodeURIComponent(intent.client_secret ?? "")}`,
    );
  }

  return (
    <form className="checkout__form" onSubmit={handleSubmit}>
      {collectContact ? (
        <>
          <fieldset className="checkout__fieldset" disabled={submitting}>
            <legend className="checkout__legend">contact</legend>
            <LinkAuthenticationElement />
          </fieldset>

          <fieldset className="checkout__fieldset" disabled={submitting}>
            <legend className="checkout__legend">shipping</legend>
            <AddressElement options={{ mode: "shipping", fields: { phone: "auto" } }} />
          </fieldset>
        </>
      ) : null}

      <fieldset className="checkout__fieldset" disabled={submitting}>
        <legend className="checkout__legend">payment</legend>
        <PaymentElement options={{ layout: "tabs" }} />
      </fieldset>

      {error ? (
        <p className="checkout__error" role="alert">
          {error}
        </p>
      ) : null}

      <button className="checkout__pay" type="submit" disabled={!stripe || submitting}>
        {submitting ? "processing…" : `${payLabel} ${formatMoney(amountCents, currency)}`}
      </button>

      <p className="checkout__fine">{fine}</p>
    </form>
  );
}

export default function Checkout() {
  const cart = useCart();
  const navigate = useNavigate();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [amountCents, setAmountCents] = useState(0);
  const [recurringCents, setRecurringCents] = useState(0);
  const [currency, setCurrency] = useState("usd");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Held across re-prices so an abandoned cart edit reuses the same intent
     instead of leaving a trail of pending orders in Stripe. */
  const orderIdRef = useRef<string | undefined>(undefined);

  const stripePromise = useMemo(() => getStripe().catch(() => null), []);

  const subscriptionLine = cart.subscriptionLine;
  const printLines = cart.printLines;

  /* Re-priced whenever the basket changes; the amount shown always comes back
     from the server rather than from the local subtotal. */
  const signature = cart.lines.map((line) => `${line.productId}:${line.quantity}`).join(",");

  const analyticsItems = useMemo(
    () =>
      cart.lines.map((line) =>
        analyticsItem({
          productId: line.productId,
          title: line.title,
          priceCents: line.priceCents,
          quantity: line.quantity,
          kind: line.kind,
        }),
      ),
    [cart.lines],
  );

  /* Once per visit to the page, not once per basket: editing a line here is
     still the same checkout, and re-reporting it would count one visitor
     several times over. */
  const reportedRef = useRef(false);

  useEffect(() => {
    if (cart.lines.length === 0 || reportedRef.current) return;
    reportedRef.current = true;

    trackEcommerce("begin_checkout", {
      currency: cart.currency,
      valueCents: cart.subtotalCents,
      items: analyticsItems,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const { setQuantity, remove } = cart;

  /* Dropping a line and counting it down to nothing are the same event to
     GA4, so both report the quantity that actually left the basket. */
  const removeLine = useCallback(
    (line: CartLine) => {
      remove(line.productId);
      trackEcommerce("remove_from_cart", {
        currency: line.currency,
        valueCents: line.priceCents * line.quantity,
        items: [
          analyticsItem({
            productId: line.productId,
            title: line.title,
            priceCents: line.priceCents,
            quantity: line.quantity,
            kind: line.kind,
          }),
        ],
      });
    },
    [remove],
  );

  const changeQuantity = useCallback(
    (line: CartLine, quantity: number) => {
      setQuantity(line.productId, quantity);

      const capped = Math.min(quantity, CART_MAX_PER_ITEM);
      const delta = capped - line.quantity;
      if (delta === 0) return;

      trackEcommerce(delta > 0 ? "add_to_cart" : "remove_from_cart", {
        currency: line.currency,
        valueCents: line.priceCents * Math.abs(delta),
        items: [
          analyticsItem({
            productId: line.productId,
            title: line.title,
            priceCents: line.priceCents,
            quantity: Math.abs(delta),
            kind: line.kind,
          }),
        ],
      });
    },
    [setQuantity],
  );

  useEffect(() => {
    /* A basket holding a subscription cannot be a plain PaymentIntent: it
       becomes a Stripe subscription whose first invoice carries the prints,
       and that needs an email and an address first. Editing the basket throws
       the prepared payment away rather than charging a stale amount. */
    if (subscriptionLine) {
      setClientSecret(null);
      return;
    }

    if (cart.lines.length === 0) {
      setClientSecret(null);
      return;
    }

    let cancelled = false;
    setError(null);

    api
      .createPaymentIntent({
        items: cart.lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
        })),
        orderId: orderIdRef.current,
      })
      .then((result) => {
        if (cancelled) return;
        orderIdRef.current = result.orderId;
        setClientSecret(result.clientSecret);
        setAmountCents(result.amountTotalCents);
        setCurrency(result.currency);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Could not start checkout");
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  async function startSubscriptionCheckout(details: SubscriberDetails) {
    if (!subscriptionLine) return;

    setStarting(true);
    setError(null);
    try {
      const result = await api.startSubscription({
        productId: subscriptionLine.productId,
        ...details,
        ...(printLines.length
          ? {
              items: printLines.map((line) => ({
                productId: line.productId,
                quantity: line.quantity,
              })),
            }
          : {}),
      });
      setClientSecret(result.clientSecret);
      setAmountCents(result.amountTotalCents);
      setRecurringCents(result.recurringAmountCents);
      setCurrency(result.currency);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not start checkout");
    } finally {
      setStarting(false);
    }
  }

  if (cart.lines.length === 0) {
    return (
      <main className="checkout checkout--empty">
        <h1 className="checkout__title">checkout</h1>
        <p className="checkout__empty">Your cart is empty.</p>
        <button type="button" className="checkout__back" onClick={() => navigate("/vault")}>
          open the vault
        </button>
      </main>
    );
  }

  return (
    <main className="checkout">
      <h1 className="checkout__title">checkout</h1>

      <div className="checkout__layout">
        <section className="checkout__summary" aria-label="Order summary">
          <ul className="checkout__lines">
            {cart.lines.map((line) => {
              const isSubscription = line.kind === "subscription";

              return (
                <li key={line.productId} className="checkout__line">
                  {line.imageUrl ? (
                    <img className="checkout__thumb" src={line.imageUrl} alt="" />
                  ) : (
                    <div className="checkout__thumb checkout__thumb--empty" aria-hidden="true" />
                  )}

                  <div className="checkout__lineBody">
                    <span className="checkout__lineTitle">{line.title}</span>
                    <span className="checkout__linePrice">
                      {formatMoney(line.priceCents, line.currency)}
                      {isSubscription ? " / month" : null}
                    </span>
                  </div>

                  <div className="checkout__qty">
                    {/* A subscription is one commitment, so there is nothing to
                        count — only to keep or drop. */}
                    {isSubscription ? null : (
                      <>
                        <label className="checkout__qtyLabel" htmlFor={`qty-${line.productId}`}>
                          qty
                        </label>
                        <input
                          id={`qty-${line.productId}`}
                          className="checkout__qtyInput"
                          type="number"
                          min={1}
                          max={CART_MAX_PER_ITEM}
                          value={line.quantity}
                          onChange={(event) => changeQuantity(line, Number(event.target.value) || 1)}
                        />
                      </>
                    )}
                    <button
                      type="button"
                      className="checkout__remove"
                      onClick={() => removeLine(line)}
                      aria-label={`Remove ${line.title}`}
                    >
                      ×
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          <p className="checkout__total">
            <span>{subscriptionLine ? "today" : "total"}</span>
            <span>{formatMoney(amountCents || cart.subtotalCents, currency)}</span>
          </p>

          {subscriptionLine ? (
            <p className="checkout__fine">
              {formatMoney(recurringCents || subscriptionLine.priceCents, currency)} of that is the
              first month of {subscriptionLine.title}, billed again every month until you cancel.
            </p>
          ) : null}

          <Link className="checkout__back" to="/vault">
            keep looking
          </Link>
        </section>

        <section className="checkout__payment" aria-label="Payment">
          {clientSecret ? (
            <Elements
              /* Remounting on a new secret is required: Elements cannot be
                 re-pointed at a different PaymentIntent after mount. */
              key={clientSecret}
              stripe={stripePromise}
              options={{ clientSecret, appearance: APPEARANCE }}
            >
              <PaymentForm
                amountCents={amountCents}
                currency={currency}
                items={analyticsItems}
                /* With a subscription the email and address were needed before
                   Stripe could hold it, so they are already collected. */
                collectContact={!subscriptionLine}
                returnParams={
                  subscriptionLine
                    ? printLines.length
                      ? "withSubscription=1&"
                      : "subscription=1&"
                    : ""
                }
                payLabel="pay"
                fine={
                  subscriptionLine
                    ? "Payments are handled by Stripe. The subscription renews monthly until you cancel; card details never touch this server."
                    : "Payments are handled by Stripe. Card details never touch this server."
                }
              />
            </Elements>
          ) : subscriptionLine ? (
            <SubscriberDetailsForm
              submitting={starting}
              error={error}
              submitLabel="continue to payment"
              note="Your receipt and any renewal notices go to this email. Everything in this basket is posted to the address above, and a new print follows every month."
              onSubmit={(details) => void startSubscriptionCheckout(details)}
            />
          ) : error ? (
            <p className="checkout__error" role="alert">
              {error}
            </p>
          ) : (
            <p className="checkout__loading">preparing checkout…</p>
          )}
        </section>
      </div>
    </main>
  );
}
