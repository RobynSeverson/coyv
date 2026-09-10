import { useCallback, useEffect, useState } from "react";
import { api, type Fulfillment, type FulfillmentStatus } from "../../lib/api";
import "./admin.css";
import "./fulfillment.css";

function formatAddress(fulfillment: Fulfillment): string[] {
  const address = fulfillment.shippingAddress;
  if (!address) return [];

  return [
    address.line1,
    address.line2,
    [address.city, address.state].filter(Boolean).join(", "),
    address.postalCode,
    address.country,
  ].filter((line) => line.trim().length > 0);
}

export default function AdminFulfillment() {
  const [tab, setTab] = useState<FulfillmentStatus>("pending");
  const [pastDueOnly, setPastDueOnly] = useState(
    () => new URLSearchParams(window.location.search).get("filter") === "past-due",
  );
  const [fulfillments, setFulfillments] = useState<Fulfillment[] | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async (status: FulfillmentStatus) => {
    try {
      const result = await api.admin.listFulfillments(status);
      setFulfillments(result.fulfillments);
      setPendingCount(result.pendingCount);
      setDrafts(
        Object.fromEntries(result.fulfillments.map((entry) => [entry.id, entry.trackingNumber])),
      );
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not load the queue");
      setFulfillments([]);
    }
  }, []);

  useEffect(() => {
    void load(tab);
  }, [load, tab]);

  async function run(id: string, action: () => Promise<void>) {
    setBusyId(id);
    setError(null);
    try {
      await action();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  /* Marking sent moves the row to the other tab, so it is dropped from the
     list rather than patched in place. */
  function setStatus(fulfillment: Fulfillment, status: FulfillmentStatus) {
    void run(fulfillment.id, async () => {
      await api.admin.updateFulfillment(fulfillment.id, {
        status,
        trackingNumber: drafts[fulfillment.id] ?? fulfillment.trackingNumber,
      });
      setFulfillments((current) =>
        current ? current.filter((entry) => entry.id !== fulfillment.id) : current,
      );
      setPendingCount((current) => (status === "sent" ? current - 1 : current + 1));
    });
  }

  /* Keeps the URL matching what is actually on screen, so a reload or a copied
     link shows the same list rather than silently re-applying the filter. */
  function togglePastDue() {
    const next = !pastDueOnly;
    setPastDueOnly(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("filter", "past-due");
    else url.searchParams.delete("filter");
    window.history.replaceState(null, "", url);
  }

  /* Filtering client-side keeps the past-due toggle instant and means the
     count stays truthful while rows are marked sent without a refetch. */
  const pastDueTotal = (fulfillments ?? []).filter((entry) => entry.pastDue).length;
  const visible = (fulfillments ?? []).filter(
    (entry) => !(tab === "pending" && pastDueOnly) || entry.pastDue,
  );

  return (
    <section className="admin__section">
      {error ? (
        <p className="admin__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="fulfil__bar">
        <nav className="admin__tabs" aria-label="Fulfillment status">
          <button
            type="button"
            className={`admin__tab${tab === "pending" ? " is-active" : ""}`}
            onClick={() => setTab("pending")}
          >
            to send{pendingCount > 0 ? ` (${pendingCount})` : ""}
          </button>
          <button
            type="button"
            className={`admin__tab${tab === "sent" ? " is-active" : ""}`}
            onClick={() => setTab("sent")}
          >
            sent
          </button>
        </nav>

        {tab === "pending" && pastDueTotal > 0 ? (
          <button
            type="button"
            className={`admin__tab${pastDueOnly ? " is-active" : ""}`}
            onClick={() => togglePastDue()}
          >
            past due ({pastDueTotal})
          </button>
        ) : null}

        {tab === "pending" && visible.length > 0 ? (
          <button type="button" className="admin__primary" onClick={() => window.print()}>
            print packing slips
          </button>
        ) : null}
      </div>

      {fulfillments === null ? (
        <p className="admin__muted">loading…</p>
      ) : visible.length === 0 ? (
        <p className="admin__muted">
          {tab === "sent"
            ? "Nothing sent yet."
            : pastDueOnly
              ? "Nothing is past due."
              : "Nothing waiting to be sent."}
        </p>
      ) : (
        <div className="fulfil__list">
          {visible.map((fulfillment) => {
            const busy = busyId === fulfillment.id;
            const address = formatAddress(fulfillment);

            return (
              <article key={fulfillment.id} className="admin__card fulfil__slip">
                <header className="admin__cardHeader">
                  <h2 className="admin__cardTitle">{fulfillment.title}</h2>
                  <span className="admin__badge">
                    {fulfillment.kind === "subscription" ? "subscription" : "order"}
                  </span>
                  {fulfillment.periodLabel ? (
                    <span className="admin__badge is-live">{fulfillment.periodLabel}</span>
                  ) : null}
                  {fulfillment.pastDue ? (
                    <span className="admin__badge is-danger">past due</span>
                  ) : null}
                </header>

                <div className="fulfil__body">
                  <div>
                    <p className="fulfil__label">ship to</p>
                    {address.length > 0 ? (
                      <address className="fulfil__address">
                        {fulfillment.shippingName ? (
                          <strong>{fulfillment.shippingName}</strong>
                        ) : null}
                        {address.map((line) => (
                          <span key={line}>{line}</span>
                        ))}
                      </address>
                    ) : (
                      <p className="admin__error">
                        No address on file — contact {fulfillment.email ?? "the buyer"}.
                      </p>
                    )}
                    {fulfillment.email ? (
                      <p className="admin__muted fulfil__email">{fulfillment.email}</p>
                    ) : null}
                  </div>

                  <div>
                    <p className="fulfil__label">contents</p>
                    <ul className="fulfil__items">
                      {fulfillment.items.map((item, index) => (
                        <li key={`${item.title}-${index}`}>
                          {item.title} × {item.quantity}
                        </li>
                      ))}
                    </ul>
                    <p className="admin__muted fulfil__email">
                      {tab === "sent" && fulfillment.sentAt
                        ? `sent ${new Date(fulfillment.sentAt).toLocaleDateString()}`
                        : `due since ${new Date(fulfillment.createdAt).toLocaleDateString()}`}
                    </p>
                  </div>
                </div>

                {fulfillment.notes ? (
                  <p className="admin__muted fulfil__notes">{fulfillment.notes}</p>
                ) : null}

                <div className="admin__actions fulfil__actions">
                  <label className="admin__field fulfil__tracking">
                    <span>tracking (optional)</span>
                    <input
                      value={drafts[fulfillment.id] ?? ""}
                      onChange={(event) =>
                        setDrafts({ ...drafts, [fulfillment.id]: event.target.value })
                      }
                    />
                  </label>

                  {tab === "pending" ? (
                    <button
                      type="button"
                      className="admin__primary"
                      disabled={busy}
                      onClick={() => setStatus(fulfillment, "sent")}
                    >
                      {busy ? "saving…" : "mark as sent"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="admin__danger"
                      disabled={busy}
                      onClick={() => setStatus(fulfillment, "pending")}
                    >
                      {busy ? "saving…" : "move back to queue"}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
