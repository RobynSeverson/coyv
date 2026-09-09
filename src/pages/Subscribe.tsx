import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import type { StripeElementsOptions } from "@stripe/stripe-js";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type Product } from "../lib/api";
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

function SubscribeForm({ amountCents, currency }: { amountCents: number; currency: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setError(null);

    /* The subscription already exists in Stripe, incomplete. Confirming the
       first invoice's PaymentIntent is what activates it, which is why this
       never has to leave the page. */
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/order?subscription=1` },
      redirect: "if_required",
    });

    if (result.error) {
      setError(result.error.message ?? "Payment could not be completed");
      setSubmitting(false);
      return;
    }

    const intent = result.paymentIntent;
    window.location.assign(
      `/order?subscription=1&payment_intent=${encodeURIComponent(intent.id)}` +
        `&payment_intent_client_secret=${encodeURIComponent(intent.client_secret ?? "")}`,
    );
  }

  return (
    <form className="checkout__form" onSubmit={handleSubmit}>
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
        {submitting
          ? "processing…"
          : `subscribe · ${formatMoney(amountCents, currency)}/mo`}
      </button>

      <p className="checkout__fine">
        Billed monthly until you cancel. Payments are handled by Stripe; card details never
        touch this server.
      </p>
    </form>
  );
}

export default function Subscribe() {
  const { slug } = useParams<{ slug: string }>();

  const [product, setProduct] = useState<Product | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [amountCents, setAmountCents] = useState(0);
  const [currency, setCurrency] = useState("usd");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const stripePromise = useMemo(() => getStripe().catch(() => null), []);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;

    api
      .getProduct(slug)
      .then(({ product: loaded }) => {
        if (cancelled) return;
        if (loaded.kind !== "subscription") {
          setLoadError("That is not a subscription.");
          return;
        }
        setProduct(loaded);
        setAmountCents(loaded.priceCents);
        setCurrency(loaded.currency);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setLoadError(cause instanceof Error ? cause.message : "Could not load this plan");
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  /* Stripe needs a customer before it can hold a subscription, so the email is
     collected first and the Payment Element only appears once the (unpaid)
     subscription exists. */
  async function start(event: React.FormEvent) {
    event.preventDefault();
    if (!product) return;

    setStarting(true);
    setError(null);
    try {
      const result = await api.startSubscription({
        productId: product.id,
        email: email.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      setClientSecret(result.clientSecret);
      setAmountCents(result.amountTotalCents);
      setCurrency(result.currency);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not start the subscription");
    } finally {
      setStarting(false);
    }
  }

  if (loadError) {
    return (
      <main className="checkout checkout--empty">
        <h1 className="checkout__title">subscribe</h1>
        <p className="checkout__empty">{loadError}</p>
        <Link className="checkout__back" to="/vault">
          open the vault
        </Link>
      </main>
    );
  }

  if (!product) {
    return (
      <main className="checkout checkout--empty">
        <h1 className="checkout__title">subscribe</h1>
        <p className="checkout__loading">loading…</p>
      </main>
    );
  }

  const cover = product.images[0];

  return (
    <main className="checkout">
      <h1 className="checkout__title">subscribe</h1>

      <div className="checkout__layout">
        <section className="checkout__summary" aria-label="Plan summary">
          <ul className="checkout__lines">
            <li className="checkout__line">
              {cover ? (
                <img className="checkout__thumb" src={cover.url} alt="" />
              ) : (
                <div className="checkout__thumb checkout__thumb--empty" aria-hidden="true" />
              )}
              <div className="checkout__lineBody">
                <span className="checkout__lineTitle">{product.title}</span>
                <span className="checkout__linePrice">
                  {formatMoney(product.priceCents, product.currency)} / month
                </span>
              </div>
            </li>
          </ul>

          {product.description ? (
            <p className="checkout__fine">{product.description}</p>
          ) : null}

          <p className="checkout__total">
            <span>today</span>
            <span>{formatMoney(amountCents || product.priceCents, currency)}</span>
          </p>

          <Link className="checkout__back" to="/vault">
            keep looking
          </Link>
        </section>

        <section className="checkout__payment" aria-label="Payment">
          {clientSecret ? (
            <Elements
              key={clientSecret}
              stripe={stripePromise}
              options={{ clientSecret, appearance: APPEARANCE }}
            >
              <SubscribeForm amountCents={amountCents} currency={currency} />
            </Elements>
          ) : (
            <form className="checkout__form" onSubmit={start}>
              <fieldset className="checkout__fieldset" disabled={starting}>
                <legend className="checkout__legend">contact</legend>

                <label className="checkout__field">
                  <span>email</span>
                  <input
                    required
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>

                <label className="checkout__field">
                  <span>name (optional)</span>
                  <input
                    type="text"
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
              </fieldset>

              {error ? (
                <p className="checkout__error" role="alert">
                  {error}
                </p>
              ) : null}

              <button className="checkout__pay" type="submit" disabled={starting}>
                {starting ? "preparing…" : "continue to payment"}
              </button>

              <p className="checkout__fine">
                Your receipt and any renewal notices go to this address.
              </p>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
