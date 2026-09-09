import { useEffect, useState } from "react";
import { api, type Subscription } from "../../lib/api";
import { formatMoney } from "../../lib/money";
import "./admin.css";

/* Stripe owns the billing state; this list is a read-only mirror so the studio
   can see who is subscribed without signing into Stripe. */
export default function AdminSubscriptions() {
  const [subscriptions, setSubscriptions] = useState<Subscription[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    api.admin
      .listSubscriptions()
      .then(({ subscriptions: loaded }) => {
        if (!cancelled) setSubscriptions(loaded);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Could not load subscribers");
        setSubscriptions([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <section className="admin__section">
        <p className="admin__error" role="alert">
          {error}
        </p>
      </section>
    );
  }

  if (subscriptions === null) {
    return (
      <section className="admin__section">
        <p className="admin__muted">loading…</p>
      </section>
    );
  }

  if (subscriptions.length === 0) {
    return (
      <section className="admin__section">
        <p className="admin__muted">No subscribers yet.</p>
      </section>
    );
  }

  const activeCount = subscriptions.filter(
    (entry) => entry.status === "active" || entry.status === "trialing",
  ).length;

  return (
    <section className="admin__section">
      <p className="admin__muted">
        {activeCount} active of {subscriptions.length}
      </p>

      {subscriptions.map((subscription) => (
        <article key={subscription.id} className="admin__card">
          <header className="admin__cardHeader">
            <h2 className="admin__cardTitle">{subscription.email ?? "unknown email"}</h2>
            <span
              className={`admin__badge${
                subscription.status === "active" || subscription.status === "trialing"
                  ? " is-live"
                  : ""
              }`}
            >
              {subscription.status.replace(/_/g, " ")}
            </span>
            <span className="admin__muted">/{subscription.slug}</span>
          </header>

          <p className="admin__muted">
            {subscription.name ? `${subscription.name} · ` : ""}
            {subscription.title} ·{" "}
            {formatMoney(subscription.unitAmountCents, subscription.currency)} /{" "}
            {subscription.interval}
          </p>

          <p className="admin__muted">
            started {new Date(subscription.createdAt).toLocaleDateString()}
            {subscription.currentPeriodEnd
              ? ` · renews ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`
              : ""}
            {subscription.canceledAt
              ? ` · canceled ${new Date(subscription.canceledAt).toLocaleDateString()}`
              : ""}
          </p>

          {subscription.lastPaymentError ? (
            <p className="admin__error">{subscription.lastPaymentError}</p>
          ) : null}
        </article>
      ))}
    </section>
  );
}
