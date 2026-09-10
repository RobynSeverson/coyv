import { useCallback, useEffect, useState } from "react";
import { api, type Admin } from "../../lib/api";
import AdminLogin from "./AdminLogin";
import AdminProducts from "./AdminProducts";
import AdminOrders from "./AdminOrders";
import AdminSubscriptions from "./AdminSubscriptions";
import AdminFulfillment from "./AdminFulfillment";
import AdminMemories from "./AdminMemories";
import "./admin.css";

type Tab = "products" | "memories" | "fulfillment" | "orders" | "subscribers";

const TABS: Tab[] = ["products", "memories", "fulfillment", "orders", "subscribers"];

/* The digest email links straight at ?tab=fulfillment&filter=past-due, so the
   opening tab is read from the URL rather than always starting on products. */
function initialTab(): Tab {
  const requested = new URLSearchParams(window.location.search).get("tab");
  return TABS.includes(requested as Tab) ? (requested as Tab) : "products";
}

export default function AdminApp() {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<Tab>(initialTab);

  /* Keeps the address bar honest so a tab can be linked to or reloaded, without
     pushing history entries for what is really just a view toggle. */
  function selectTab(name: Tab) {
    setTab(name);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", name);
    if (name !== "fulfillment") url.searchParams.delete("filter");
    window.history.replaceState(null, "", url);
  }

  const refresh = useCallback(async () => {
    try {
      const { admin: current } = await api.admin.me();
      setAdmin(current);
    } catch {
      setAdmin(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /* The panel is unlinked, but a search engine that somehow finds it should
     still be told to forget it. */
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    const previousTitle = document.title;
    document.title = "coyv · studio";

    return () => {
      meta.remove();
      document.title = previousTitle;
    };
  }, []);

  if (checking) {
    return (
      <main className="admin admin--centered">
        <p className="admin__muted">checking session…</p>
      </main>
    );
  }

  if (!admin) return <AdminLogin onAuthenticated={setAdmin} />;

  return (
    <main className="admin">
      <header className="admin__header">
        <div>
          <h1 className="admin__title">studio</h1>
          <p className="admin__muted">{admin.email}</p>
        </div>

        <nav className="admin__tabs" aria-label="Admin sections">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              className={`admin__tab${tab === name ? " is-active" : ""}`}
              onClick={() => selectTab(name)}
            >
              {name}
            </button>
          ))}
        </nav>

        <button
          type="button"
          className="admin__logout"
          onClick={async () => {
            await api.admin.logout().catch(() => undefined);
            setAdmin(null);
          }}
        >
          sign out
        </button>
      </header>

      {tab === "products" ? (
        <AdminProducts />
      ) : tab === "memories" ? (
        <AdminMemories />
      ) : tab === "fulfillment" ? (
        <AdminFulfillment />
      ) : tab === "subscribers" ? (
        <AdminSubscriptions />
      ) : (
        <AdminOrders />
      )}
    </main>
  );
}
