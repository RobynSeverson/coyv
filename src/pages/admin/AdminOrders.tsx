import { useEffect, useMemo, useState } from "react";
import {
  api,
  type Earnings,
  type EarningsBucket,
  type Order,
  type OrderStatus,
  type OrderType,
} from "../../lib/api";
import { formatMoney } from "../../lib/money";
import "./admin.css";

const ORDER_STATUSES: OrderStatus[] = [
  "pending",
  "processing",
  "paid",
  "failed",
  "canceled",
  "refunded",
];

const ORDER_TYPES: OrderType[] = ["order", "subscription"];

/* "successful" is the default view because a failed or abandoned checkout
   leaves a row behind that the studio never has to act on. */
type StatusFilter = OrderStatus | "successful" | "all";
type TypeFilter = OrderType | "all";

function orderHaystack(order: Order): string {
  const address = order.shippingAddress;

  return [
    order.number,
    order.type,
    order.status,
    order.email,
    order.shippingName,
    order.periodLabel,
    ...order.items.map((item) => `${item.title} ${item.slug}`),
    address?.line1,
    address?.line2,
    address?.city,
    address?.state,
    address?.postalCode,
    address?.country,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

const BUCKETS: { value: EarningsBucket; label: string }[] = [
  { value: "week", label: "week" },
  { value: "month", label: "month" },
  { value: "year", label: "year" },
];

function EarningsPanel() {
  const [bucket, setBucket] = useState<EarningsBucket>("month");
  const [earnings, setEarnings] = useState<Earnings | null>(null);

  useEffect(() => {
    /* Switching the toggle twice quickly can land the responses out of order,
       so a stale one is dropped rather than shown. */
    let current = true;

    api.admin
      .earnings(bucket)
      .then((loaded) => {
        if (current) setEarnings(loaded);
      })
      .catch(() => {
        if (current) setEarnings(null);
      });

    return () => {
      current = false;
    };
  }, [bucket]);

  const currency = earnings?.currency ?? "usd";
  const rows = earnings?.rows ?? [];
  /* The last row is the period being lived in, so it is called out rather than
     left as the end of a row of equals. */
  const now = rows.at(-1) ?? null;
  const earlier = rows.slice(0, -1).reverse();

  return (
    <section className="admin__section admin__earnings">
      <header className="admin__earningsHead">
        <h2 className="admin__cardTitle">earnings</h2>
        <div className="admin__toggle" role="group" aria-label="Earnings period">
          {BUCKETS.map((option) => (
            <button
              key={option.value}
              type="button"
              className="admin__toggleButton"
              aria-pressed={bucket === option.value}
              onClick={() => setBucket(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      {now ? (
        <>
          <p className="admin__earningsTotal">
            {formatMoney(now.totalCents, currency)}
            <span className="admin__muted"> this {bucket}</span>
          </p>
          <p className="admin__muted admin__earningsSplit">
            {formatMoney(now.orderCents, currency)} orders ·{" "}
            {formatMoney(now.subscriptionCents, currency)} subscriptions
          </p>

          <ul className="admin__earningsList">
            {earlier.map((row) => (
              <li key={row.key}>
                <span className="admin__muted">{row.label}</span>
                <span>{formatMoney(row.totalCents, currency)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="admin__muted">loading…</p>
      )}
    </section>
  );
}

export default function AdminOrders() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("successful");

  useEffect(() => {
    api.admin
      .listOrders()
      .then(({ orders: loaded }) => setOrders(loaded))
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Could not load orders"),
      );
  }, []);

  const visible = useMemo(() => {
    if (!orders) return [];
    const term = search.trim().toLowerCase();

    return orders.filter((order) => {
      if (typeFilter !== "all" && order.type !== typeFilter) return false;
      if (statusFilter === "successful" && order.status !== "paid") return false;
      if (statusFilter !== "successful" && statusFilter !== "all" && order.status !== statusFilter)
        return false;
      if (term && !orderHaystack(order).includes(term)) return false;
      return true;
    });
  }, [orders, search, typeFilter, statusFilter]);

  if (error) {
    return (
      <p className="admin__error" role="alert">
        {error}
      </p>
    );
  }

  return (
    <>
      <EarningsPanel />

      {orders === null ? (
        <p className="admin__muted">loading…</p>
      ) : orders.length === 0 ? (
        <p className="admin__muted">No orders yet.</p>
      ) : (
        <section className="admin__section">
          <div className="admin__filters">
            <label className="admin__field admin__filter admin__filter--search">
              search
              <input
                type="search"
                value={search}
                placeholder="order no., email, name, item, address"
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>

            <label className="admin__field admin__filter">
              type
              <select
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value as TypeFilter)}
              >
                <option value="all">all</option>
                {ORDER_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
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
                {ORDER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>

            <p className="admin__muted admin__filterCount">
              {visible.length} of {orders.length}
            </p>
          </div>

          {visible.length === 0 ? (
            <p className="admin__muted">No orders match these filters.</p>
          ) : (
            <table className="admin__table">
              <thead>
                <tr>
                  <th>order no.</th>
                  <th>placed</th>
                  <th>type</th>
                  <th>status</th>
                  <th>items</th>
                  <th>total</th>
                  <th>ship to</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((order) => (
                  <tr key={`${order.type}:${order.id}`}>
                    <td>
                      <code className="admin__reference">{order.number}</code>
                    </td>
                    <td>{new Date(order.createdAt).toLocaleString()}</td>
                    <td>
                      <span className={`admin__badge admin__badge--${order.type}`}>
                        {order.type}
                      </span>
                    </td>
                    <td>
                      <span className={`admin__badge admin__badge--${order.status}`}>
                        {order.status}
                      </span>
                    </td>
                    <td>
                      {order.items.map((item) => (
                        <div key={item.productId || item.slug}>
                          {item.title} × {item.quantity}
                        </div>
                      ))}
                      {order.periodLabel ? (
                        <div className="admin__muted">{order.periodLabel}</div>
                      ) : null}
                    </td>
                    <td>{formatMoney(order.amountTotalCents, order.currency)}</td>
                    <td>
                      {order.shippingAddress?.line1 ? (
                        <>
                          <div>{order.shippingName}</div>
                          <div>{order.shippingAddress.line1}</div>
                          {order.shippingAddress.line2 ? (
                            <div>{order.shippingAddress.line2}</div>
                          ) : null}
                          <div>
                            {order.shippingAddress.city} {order.shippingAddress.state}{" "}
                            {order.shippingAddress.postalCode} {order.shippingAddress.country}
                          </div>
                        </>
                      ) : order.shippingName ? (
                        <div>{order.shippingName}</div>
                      ) : (
                        <span className="admin__muted">—</span>
                      )}
                      {order.email ? <div className="admin__muted">{order.email}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </>
  );
}
