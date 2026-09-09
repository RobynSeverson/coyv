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

export default function AdminApp() {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<Tab>("products");

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
          {(["products", "memories", "fulfillment", "orders", "subscribers"] as Tab[]).map((name) => (
            <button
              key={name}
              type="button"
              className={`admin__tab${tab === name ? " is-active" : ""}`}
              onClick={() => setTab(name)}
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
