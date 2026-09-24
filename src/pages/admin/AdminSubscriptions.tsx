import { useEffect, useMemo, useState } from "react";
import { api, type Subscription, type SubscriptionStatus } from "../../lib/api";
import { formatMoney } from "../../lib/money";
import "./admin.css";

const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
];

/* "successful" is the default view: a subscriber who never finished checkout
   or cancelled months ago is not someone the studio has to post to. */
type StatusFilter = SubscriptionStatus | "successful" | "all";

function isLive(subscription: Subscription): boolean {
  return subscription.status === "active" || subscription.status === "trialing";
}

function subscriptionHaystack(subscription: Subscription): string {
  return [
    subscription.email,
    subscription.name,
    subscription.title,
    subscription.slug,
    subscription.status,
    subscription.interval,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/* Stripe owns the billing state; this list is a read-only mirror so the studio
   can see who is subscribed without signing into Stripe. */
export default function AdminSubscriptions() {
  const [subscriptions, setSubscriptions] = useState<Subscription[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("successful");
  const [planFilter, setPlanFilter] = useState("all");

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

  const plans = useMemo(() => {
    const slugs = new Set((subscriptions ?? []).map((entry) => entry.slug));
    return [...slugs].sort();
  }, [subscriptions]);

  const visible = useMemo(() => {
    if (!subscriptions) return [];
    const term = search.trim().toLowerCase();

    return subscriptions.filter((subscription) => {
      if (planFilter !== "all" && subscription.slug !== planFilter) return false;
      if (statusFilter === "successful" && !isLive(subscription)) return false;
      if (
        statusFilter !== "successful" &&
        statusFilter !== "all" &&
        subscription.status !== statusFilter
      )
        return false;
      if (term && !subscriptionHaystack(subscription).includes(term)) return false;
      return true;
    });
  }, [subscriptions, search, statusFilter, planFilter]);

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

  const activeCount = subscriptions.filter(isLive).length;

  return (
    <section className="admin__section">
      <div className="admin__filters">
        <label className="admin__field admin__filter admin__filter--search">
          search
          <input
            type="search"
            value={search}
            placeholder="email, name, plan"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        <label className="admin__field admin__filter">
          plan
          <select value={planFilter} onChange={(event) => setPlanFilter(event.target.value)}>
            <option value="all">all</option>
            {plans.map((slug) => (
              <option key={slug} value={slug}>
                {slug}
              </option>
            ))}
          </select>
        </label>

        <label className="admin__field admin__filter">
          status
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          >
            <option value="successful">successful</option>
            <option value="all">all</option>
            {SUBSCRIPTION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>

        <p className="admin__muted admin__filterCount">
          {visible.length} shown · {activeCount} active of {subscriptions.length}
        </p>
      </div>

      {visible.length === 0 ? (
        <p className="admin__muted">No subscribers match these filters.</p>
      ) : null}

      {visible.map((subscription) => (
        <article key={subscription.id} className="admin__card">
          <header className="admin__cardHeader">
            <h2 className="admin__cardTitle">{subscription.email ?? "unknown email"}</h2>
            <span className={`admin__badge${isLive(subscription) ? " is-live" : ""}`}>
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
