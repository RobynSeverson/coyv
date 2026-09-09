import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useCart } from "../cart/CartContext";
import { api, type Order } from "../lib/api";
import { formatMoney } from "../lib/money";
import "./Checkout.css";
import "./OrderStatus.css";

/* The webhook is what actually marks an order paid, and it can land a moment
   after the browser gets back here, so the page polls briefly. */
const POLL_INTERVAL_MS = 1500;
const POLL_ATTEMPTS = 10;

const COPY: Record<Order["status"], { heading: string; blurb: string }> = {
  paid: { heading: "thank you", blurb: "Your order is in. A receipt is on its way." },
  processing: {
    heading: "almost there",
    blurb: "Your bank is still confirming the payment. This page will update itself.",
  },
  pending: {
    heading: "almost there",
    blurb: "Waiting on confirmation from Stripe. This page will update itself.",
  },
  failed: { heading: "payment failed", blurb: "Nothing was charged. You can try again." },
  canceled: { heading: "payment canceled", blurb: "Nothing was charged." },
  refunded: { heading: "refunded", blurb: "This order has been refunded." },
};

export default function OrderStatus() {
  const [params] = useSearchParams();
  const paymentIntent = params.get("payment_intent");
  const clientSecret = params.get("payment_intent_client_secret");

  const [order, setOrder] = useState<Order | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const cart = useCart();

  /* Derived rather than pushed into state from an effect: a link without a
     payment reference is knowable at render time. */
  const error =
    !paymentIntent || !clientSecret
      ? "This link is missing its payment reference."
      : lookupError;

  /* Clearing must happen exactly once, and only after a confirmed success. */
  const clearedRef = useRef(false);
  const { clear } = cart;

  useEffect(() => {
    if (!paymentIntent || !clientSecret) return;

    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const { order: loaded } = await api.lookupOrder(paymentIntent, clientSecret);
        if (cancelled) return;

        setOrder(loaded);

        if (loaded.status === "paid" && !clearedRef.current) {
          clearedRef.current = true;
          clear();
        }

        const settled = loaded.status !== "pending" && loaded.status !== "processing";
        if (!settled && ++attempts < POLL_ATTEMPTS) {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (cause: unknown) {
        if (cancelled) return;
        setLookupError(cause instanceof Error ? cause.message : "Could not look up that order");
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [paymentIntent, clientSecret, clear]);

  if (error) {
    return (
      <main className="checkout checkout--empty">
        <h1 className="checkout__title">order</h1>
        <p className="checkout__error">{error}</p>
        <Link className="checkout__back" to="/vault">
          back to the vault
        </Link>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="checkout checkout--empty">
        <h1 className="checkout__title">order</h1>
        <p className="checkout__loading">looking up your order…</p>
      </main>
    );
  }

  const copy = COPY[order.status];

  return (
    <main className="checkout checkout--empty">
      <h1 className="checkout__title">{copy.heading}</h1>
      <p className="orderStatus__blurb">{copy.blurb}</p>

      {order.lastPaymentError ? (
        <p className="checkout__error">{order.lastPaymentError}</p>
      ) : null}

      <section className="orderStatus__card" aria-label="Order details">
        <p className="orderStatus__reference">
          reference <code>{order.id}</code>
        </p>

        <ul className="orderStatus__lines">
          {order.items.map((item) => (
            <li key={item.productId} className="orderStatus__line">
              <span>
                {item.title} × {item.quantity}
              </span>
              <span>{formatMoney(item.unitAmountCents * item.quantity, order.currency)}</span>
            </li>
          ))}
        </ul>

        <p className="checkout__total">
          <span>total</span>
          <span>{formatMoney(order.amountTotalCents, order.currency)}</span>
        </p>

        {order.shippingAddress?.line1 ? (
          <address className="orderStatus__address">
            {order.shippingName ? <span>{order.shippingName}</span> : null}
            <span>{order.shippingAddress.line1}</span>
            {order.shippingAddress.line2 ? <span>{order.shippingAddress.line2}</span> : null}
            <span>
              {order.shippingAddress.city} {order.shippingAddress.state}{" "}
              {order.shippingAddress.postalCode}
            </span>
            <span>{order.shippingAddress.country}</span>
          </address>
        ) : null}
      </section>

      <Link className="checkout__back" to="/vault">
        back to the vault
      </Link>
    </main>
  );
}
