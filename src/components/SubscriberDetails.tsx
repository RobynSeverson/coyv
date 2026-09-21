import { useState } from "react";
import type { ShippingAddress } from "../lib/api";

export type SubscriberDetails = {
  email: string;
  name?: string;
  shippingName: string;
  shippingAddress: ShippingAddress;
};

/* Stripe needs a customer, an address and an incomplete subscription before
   anything can be charged, so these are collected before the Payment Element
   exists. The same form serves the standalone subscribe page and a cart that
   happens to hold a subscription. */
export function SubscriberDetailsForm({
  submitting,
  error,
  submitLabel,
  note,
  onSubmit,
}: {
  submitting: boolean;
  error: string | null;
  submitLabel: string;
  note: string;
  onSubmit: (details: SubscriberDetails) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  /* A print subscription posts a physical thing every month, so the address is
     as much a part of signing up as the card is. */
  const [shipping, setShipping] = useState({
    shippingName: "",
    line1: "",
    line2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "US",
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    onSubmit({
      email: email.trim(),
      ...(name.trim() ? { name: name.trim() } : {}),
      shippingName: shipping.shippingName.trim(),
      shippingAddress: {
        line1: shipping.line1.trim(),
        line2: shipping.line2.trim(),
        city: shipping.city.trim(),
        state: shipping.state.trim(),
        postalCode: shipping.postalCode.trim(),
        country: shipping.country.trim().toUpperCase(),
      },
    });
  }

  return (
    <form className="checkout__form" onSubmit={handleSubmit}>
      <fieldset className="checkout__fieldset" disabled={submitting}>
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

      <fieldset className="checkout__fieldset" disabled={submitting}>
        <legend className="checkout__legend">where to post it</legend>

        <label className="checkout__field">
          <span>full name</span>
          <input
            required
            autoComplete="shipping name"
            value={shipping.shippingName}
            onChange={(event) => setShipping({ ...shipping, shippingName: event.target.value })}
          />
        </label>

        <label className="checkout__field">
          <span>address</span>
          <input
            required
            autoComplete="shipping address-line1"
            value={shipping.line1}
            onChange={(event) => setShipping({ ...shipping, line1: event.target.value })}
          />
        </label>

        <label className="checkout__field">
          <span>apartment, suite (optional)</span>
          <input
            autoComplete="shipping address-line2"
            value={shipping.line2}
            onChange={(event) => setShipping({ ...shipping, line2: event.target.value })}
          />
        </label>

        <div className="checkout__fieldRow">
          <label className="checkout__field">
            <span>city</span>
            <input
              required
              autoComplete="shipping address-level2"
              value={shipping.city}
              onChange={(event) => setShipping({ ...shipping, city: event.target.value })}
            />
          </label>

          <label className="checkout__field">
            <span>state / region</span>
            <input
              autoComplete="shipping address-level1"
              value={shipping.state}
              onChange={(event) => setShipping({ ...shipping, state: event.target.value })}
            />
          </label>
        </div>

        <div className="checkout__fieldRow">
          <label className="checkout__field">
            <span>postal code</span>
            <input
              required
              autoComplete="shipping postal-code"
              value={shipping.postalCode}
              onChange={(event) => setShipping({ ...shipping, postalCode: event.target.value })}
            />
          </label>

          <label className="checkout__field">
            <span>country</span>
            <input
              required
              maxLength={2}
              placeholder="US"
              autoComplete="shipping country"
              value={shipping.country}
              onChange={(event) =>
                setShipping({ ...shipping, country: event.target.value.toUpperCase() })
              }
            />
          </label>
        </div>
      </fieldset>

      {error ? (
        <p className="checkout__error" role="alert">
          {error}
        </p>
      ) : null}

      <button className="checkout__pay" type="submit" disabled={submitting}>
        {submitting ? "preparing…" : submitLabel}
      </button>

      <p className="checkout__fine">{note}</p>
    </form>
  );
}
