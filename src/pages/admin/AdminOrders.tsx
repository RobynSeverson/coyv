import { useEffect, useState } from "react";
import { api, type Order } from "../../lib/api";
import { formatMoney } from "../../lib/money";
import "./admin.css";

export default function AdminOrders() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.admin
      .listOrders()
      .then(({ orders: loaded }) => setOrders(loaded))
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Could not load orders"),
      );
  }, []);

  if (error) {
    return (
      <p className="admin__error" role="alert">
        {error}
      </p>
    );
  }

  if (orders === null) return <p className="admin__muted">loading…</p>;
  if (orders.length === 0) return <p className="admin__muted">No orders yet.</p>;

  return (
    <section className="admin__section">
      <table className="admin__table">
        <thead>
          <tr>
            <th>placed</th>
            <th>status</th>
            <th>items</th>
            <th>total</th>
            <th>ship to</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              <td>{new Date(order.createdAt).toLocaleString()}</td>
              <td>
                <span className={`admin__badge admin__badge--${order.status}`}>
                  {order.status}
                </span>
              </td>
              <td>
                {order.items.map((item) => (
                  <div key={item.productId}>
                    {item.title} × {item.quantity}
                  </div>
                ))}
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
                ) : (
                  <span className="admin__muted">—</span>
                )}
                {order.email ? <div className="admin__muted">{order.email}</div> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
