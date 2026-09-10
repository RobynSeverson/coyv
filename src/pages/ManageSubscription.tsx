import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type ManagedSubscription,
  type ShippingAddress,
} from "../lib/api";
import "./Checkout.css";
import "./ManageSubscription.css";

const EMPTY_ADDRESS: ShippingAddress = {
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "US",
};

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "—";
}

export default function ManageSubscription() {
  const [email, setEmail] = useState("");
  const [requested, setRequested] = useState(false);
  const [subscriptions, setSubscriptions] = useState<ManagedSubscription[] | null>(null);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftAddress, setDraftAddress] = useState<ShippingAddress>(EMPTY_ADDRESS);

  const load = useCallback(async () => {
    try {
      const result = await api.manage.list();
      setSignedInAs(result.email);
      setSubscriptions(result.subscriptions);
      return true;
    } catch {
      /* No valid session yet — the sign-in form stays up. */
      setSubscriptions(null);
      setSignedInAs(null);
      return false;
    }
  }, []);

  /* A token in the URL is spent immediately and then stripped from the address
     bar, so a single-use link is not left sitting in history or in a screenshot.
     The ref makes this run once: the token is single use, so a repeated effect
     (as StrictMode does in development) would spend it and then report failure. */
  const redeemed = useRef(false);

  useEffect(() => {
    if (redeemed.current) return;
    redeemed.current = true;

    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    if (!token) {
      void load();
      return;
    }

    (async () => {
      setBusy(true);
      try {
        await api.manage.redeem(token);
        window.history.replaceState(null, "", window.location.pathname);
        await load();
      } catch (cause: unknown) {
        window.history.replaceState(null, "", window.location.pathname);
        /* A spent link should not hide a session that is still good. */
        const signedIn = await load();
        if (!signedIn) {
          setError(
            cause instanceof Error ? cause.message : "That link has expired or was already used",
          );
        }
      } finally {
        setBusy(false);
      }
    })();
  }, [load]);

  async function requestLink(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.manage.requestLink(email);
      setRequested(true);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not send the link");
    } finally {
      setBusy(false);
    }
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function startEditing(subscription: ManagedSubscription) {
    setEditing(subscription.id);
    setDraftName(subscription.shippingName ?? "");
    setDraftAddress(subscription.shippingAddress ?? EMPTY_ADDRESS);
    setNotice(null);
  }

  function saveAddress(subscription: ManagedSubscription) {
    void run(async () => {
      const result = await api.manage.updateAddress(subscription.id, {
        shippingName: draftName,
        shippingAddress: draftAddress,
      });
      setSubscriptions((current) =>
        (current ?? []).map((entry) =>
          entry.id === subscription.id ? result.subscription : entry,
        ),
      );
      setEditing(null);
      setNotice(
        result.pendingParcelsUpdated > 0
          ? `Address saved — this month's print has not gone out yet, so it will go to the new address.`
          : "Address saved.",
      );
    });
  }

  function setCancelled(subscription: ManagedSubscription, cancel: boolean) {
    void run(async () => {
      const result = cancel
        ? await api.manage.cancel(subscription.id)
        : await api.manage.resume(subscription.id);

      setSubscriptions((current) =>
        (current ?? []).map((entry) =>
          entry.id === subscription.id ? { ...entry, ...result.subscription } : entry,
        ),
      );
      setNotice(
        cancel
          ? "Cancelled. You will still get the month you have already paid for."
          : "Your subscription is running again.",
      );
    });
  }

  if (signedInAs && subscriptions) {
    return (
      <main className="checkout manage">
        <h1 className="checkout__title">your subscription</h1>
        <p className="checkout__muted">signed in as {signedInAs}</p>

        {error ? (
          <p className="checkout__error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? <p className="manage__notice">{notice}</p> : null}

        {subscriptions.length === 0 ? (
          <p className="checkout__muted">Nothing here yet.</p>
        ) : (
          subscriptions.map((subscription) => (
            <section key={subscription.id} className="manage__card">
              <header className="manage__head">
                <h2 className="manage__title">{subscription.title}</h2>
                <span className="manage__badge">{subscription.status}</span>
              </header>

              <p className="checkout__muted">
                {formatMoney(subscription.unitAmountCents, subscription.currency)} /{" "}
                {subscription.interval}
              </p>

              {subscription.cancelAtPeriodEnd ? (
                <p className="manage__warn">
                  Ending on {formatDate(subscription.currentPeriodEnd)} — you will still receive
                  the month you have paid for.
                </p>
              ) : subscription.manageable ? (
                <p className="checkout__muted">
                  Next charge {formatDate(subscription.currentPeriodEnd)}
                </p>
              ) : (
                <p className="checkout__muted">This subscription has ended.</p>
              )}

              {editing === subscription.id ? (
                <div className="manage__form">
                  <label className="checkout__field">
                    <span>name</span>
                    <input
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                    />
                  </label>
                  <label className="checkout__field">
                    <span>address</span>
                    <input
                      value={draftAddress.line1}
                      onChange={(event) =>
                        setDraftAddress({ ...draftAddress, line1: event.target.value })
                      }
                    />
                  </label>
                  <label className="checkout__field">
                    <span>apartment, suite (optional)</span>
                    <input
                      value={draftAddress.line2 ?? ""}
                      onChange={(event) =>
                        setDraftAddress({ ...draftAddress, line2: event.target.value })
                      }
                    />
                  </label>
                  <div className="checkout__fieldRow">
                    <label className="checkout__field">
                      <span>city</span>
                      <input
                        value={draftAddress.city}
                        onChange={(event) =>
                          setDraftAddress({ ...draftAddress, city: event.target.value })
                        }
                      />
                    </label>
                    <label className="checkout__field">
                      <span>state</span>
                      <input
                        value={draftAddress.state ?? ""}
                        onChange={(event) =>
                          setDraftAddress({ ...draftAddress, state: event.target.value })
                        }
                      />
                    </label>
                  </div>
                  <div className="checkout__fieldRow">
                    <label className="checkout__field">
                      <span>postal code</span>
                      <input
                        value={draftAddress.postalCode}
                        onChange={(event) =>
                          setDraftAddress({ ...draftAddress, postalCode: event.target.value })
                        }
                      />
                    </label>
                    <label className="checkout__field">
                      <span>country</span>
                      <input
                        maxLength={2}
                        value={draftAddress.country}
                        onChange={(event) =>
                          setDraftAddress({
                            ...draftAddress,
                            country: event.target.value.toUpperCase(),
                          })
                        }
                      />
                    </label>
                  </div>

                  <div className="manage__actions">
                    <button
                      type="button"
                      className="checkout__pay"
                      disabled={busy}
                      onClick={() => saveAddress(subscription)}
                    >
                      {busy ? "saving…" : "save address"}
                    </button>
                    <button
                      type="button"
                      className="manage__link"
                      onClick={() => setEditing(null)}
                    >
                      cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="manage__label">posting to</p>
                  <address className="manage__address">
                    {subscription.shippingName ? <strong>{subscription.shippingName}</strong> : null}
                    {[
                      subscription.shippingAddress?.line1,
                      subscription.shippingAddress?.line2,
                      [subscription.shippingAddress?.city, subscription.shippingAddress?.state]
                        .filter(Boolean)
                        .join(", "),
                      subscription.shippingAddress?.postalCode,
                      subscription.shippingAddress?.country,
                    ]
                      .filter((line) => (line ?? "").trim().length > 0)
                      .map((line) => (
                        <span key={line}>{line}</span>
                      ))}
                  </address>

                  {subscription.manageable ? (
                    <div className="manage__actions">
                      <button
                        type="button"
                        className="checkout__pay"
                        onClick={() => startEditing(subscription)}
                      >
                        update address
                      </button>
                      {subscription.cancelAtPeriodEnd ? (
                        <button
                          type="button"
                          className="manage__link"
                          disabled={busy}
                          onClick={() => setCancelled(subscription, false)}
                        >
                          keep it going
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="manage__link manage__link--danger"
                          disabled={busy}
                          onClick={() => setCancelled(subscription, true)}
                        >
                          cancel subscription
                        </button>
                      )}
                    </div>
                  ) : null}
                </>
              )}
            </section>
          ))
        )}

        <button
          type="button"
          className="manage__link"
          onClick={async () => {
            await api.manage.signOut().catch(() => undefined);
            setSignedInAs(null);
            setSubscriptions(null);
            setRequested(false);
          }}
        >
          sign out
        </button>
      </main>
    );
  }

  return (
    <main className="checkout manage">
      <h1 className="checkout__title">manage your subscription</h1>

      {error ? (
        <p className="checkout__error" role="alert">
          {error}
        </p>
      ) : null}

      {requested ? (
        <>
          <p>
            If that address has a subscription, a sign-in link is on its way. It works once and
            expires in 20 minutes.
          </p>
          <button type="button" className="manage__link" onClick={() => setRequested(false)}>
            use a different address
          </button>
        </>
      ) : (
        <form onSubmit={requestLink} className="manage__form">
          <p className="checkout__muted">
            Enter the email you subscribed with and we will send you a link to update your address
            or cancel.
          </p>
          <label className="checkout__field">
            <span>email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <button type="submit" className="checkout__pay" disabled={busy}>
            {busy ? "sending…" : "email me a link"}
          </button>
        </form>
      )}
    </main>
  );
}
