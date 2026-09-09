import {
  AddressElement,
  Elements,
  LinkAuthenticationElement,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import type { StripeElementsOptions } from "@stripe/stripe-js";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CART_MAX_PER_ITEM } from "../cart/constants";
import { useCart } from "../cart/CartContext";
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

function PaymentForm({ amountCents, currency }: { amountCents: number; currency: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setError(null);

    /* confirmPayment either redirects away (for methods that need it) or
       resolves here with the outcome; `if_required` keeps card payments on
       the page while still supporting redirect methods. */
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/order`,
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
      `/order?payment_intent=${encodeURIComponent(intent.id)}` +
        `&payment_intent_client_secret=${encodeURIComponent(intent.client_secret ?? "")}`,
    );
  }

  return (
    <form className="checkout__form" onSubmit={handleSubmit}>
      <fieldset className="checkout__fieldset" disabled={submitting}>
        <legend className="checkout__legend">contact</legend>
        <LinkAuthenticationElement />
      </fieldset>

      <fieldset className="checkout__fieldset" disabled={submitting}>
        <legend className="checkout__legend">shipping</legend>
        <AddressElement options={{ mode: "shipping", fields: { phone: "auto" } }} />
      </fieldset>

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
        {submitting ? "processing…" : `pay ${formatMoney(amountCents, currency)}`}
      </button>

      <p className="checkout__fine">
        Payments are handled by Stripe. Card details never touch this server.
      </p>
    </form>
  );
}

export default function Checkout() {
  const cart = useCart();
  const navigate = useNavigate();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [amountCents, setAmountCents] = useState(0);
  const [currency, setCurrency] = useState("usd");
  const [error, setError] = useState<string | null>(null);

  /* Held across re-prices so an abandoned cart edit reuses the same intent
     instead of leaving a trail of pending orders in Stripe. */
  const orderIdRef = useRef<string | undefined>(undefined);

  const stripePromise = useMemo(() => getStripe().catch(() => null), []);

  /* Re-priced whenever the basket changes; the amount shown always comes back
     from the server rather than from the local subtotal. */
  const signature = cart.lines.map((line) => `${line.printId}:${line.quantity}`).join(",");

  useEffect(() => {
    if (cart.lines.length === 0) {
      setClientSecret(null);
      return;
    }

    let cancelled = false;
    setError(null);

    api
      .createPaymentIntent({
        items: cart.lines.map((line) => ({
          printId: line.printId,
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
            {cart.lines.map((line) => (
              <li key={line.printId} className="checkout__line">
                {line.imageUrl ? (
                  <img className="checkout__thumb" src={line.imageUrl} alt="" />
                ) : (
                  <div className="checkout__thumb checkout__thumb--empty" aria-hidden="true" />
                )}

                <div className="checkout__lineBody">
                  <span className="checkout__lineTitle">{line.title}</span>
                  <span className="checkout__linePrice">
                    {formatMoney(line.priceCents, line.currency)}
                  </span>
                </div>

                <div className="checkout__qty">
                  <label className="checkout__qtyLabel" htmlFor={`qty-${line.printId}`}>
                    qty
                  </label>
                  <input
                    id={`qty-${line.printId}`}
                    className="checkout__qtyInput"
                    type="number"
                    min={1}
                    max={CART_MAX_PER_ITEM}
                    value={line.quantity}
                    onChange={(event) =>
                      cart.setQuantity(line.printId, Number(event.target.value) || 1)
                    }
                  />
                  <button
                    type="button"
                    className="checkout__remove"
                    onClick={() => cart.remove(line.printId)}
                    aria-label={`Remove ${line.title}`}
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <p className="checkout__total">
            <span>total</span>
            <span>{formatMoney(amountCents || cart.subtotalCents, currency)}</span>
          </p>

          <Link className="checkout__back" to="/vault">
            keep looking
          </Link>
        </section>

        <section className="checkout__payment" aria-label="Payment">
          {error ? (
            <p className="checkout__error" role="alert">
              {error}
            </p>
          ) : clientSecret ? (
            <Elements
              /* Remounting on a new secret is required: Elements cannot be
                 re-pointed at a different PaymentIntent after mount. */
              key={clientSecret}
              stripe={stripePromise}
              options={{ clientSecret, appearance: APPEARANCE }}
            >
              <PaymentForm amountCents={amountCents} currency={currency} />
            </Elements>
          ) : (
            <p className="checkout__loading">preparing checkout…</p>
          )}
        </section>
      </div>
    </main>
  );
}
