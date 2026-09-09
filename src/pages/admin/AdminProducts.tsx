import { useCallback, useEffect, useRef, useState } from "react";
import { api, type AdminProduct, type ProductKind } from "../../lib/api";
import { formatMoney, parseMoneyToCents } from "../../lib/money";
import "./admin.css";

const KIND_LABELS: Record<ProductKind, string> = {
  print: "print",
  subscription: "monthly print subscription",
};

type Draft = {
  title: string;
  description: string;
  price: string;
  stock: string;
  published: boolean;
  sortOrder: string;
};

function toDraft(product: AdminProduct): Draft {
  return {
    title: product.title,
    description: product.description,
    price: (product.priceCents / 100).toFixed(2),
    stock: product.stock === null ? "" : String(product.stock),
    published: product.published,
    sortOrder: String(product.sortOrder),
  };
}

const EMPTY_DRAFT: Draft = {
  title: "",
  description: "",
  price: "",
  stock: "",
  published: false,
  sortOrder: "0",
};

/* An empty stock box means "made to order"; zero means "sold out". They are
   different states, so the empty string cannot collapse to 0. A subscription
   has no stock at all — the server rejects one, so never send it. */
function draftToPayload(draft: Draft, kind: ProductKind) {
  const priceCents = parseMoneyToCents(draft.price);
  if (priceCents === null) throw new Error("Enter a valid price");
  if (!draft.title.trim()) throw new Error("Title is required");

  const stock = draft.stock.trim() === "" ? null : Number.parseInt(draft.stock, 10);
  if (stock !== null && (!Number.isInteger(stock) || stock < 0)) {
    throw new Error("Stock must be a whole number, or blank for unlimited");
  }

  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    priceCents,
    stock: kind === "subscription" ? null : stock,
    published: draft.published,
    sortOrder: Number.parseInt(draft.sortOrder, 10) || 0,
  };
}

export default function AdminProducts() {
  const [products, setProducts] = useState<AdminProduct[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [newDraft, setNewDraft] = useState<Draft>(EMPTY_DRAFT);
  const [newKind, setNewKind] = useState<ProductKind>("print");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    try {
      const { products: loaded } = await api.admin.listProducts();
      setProducts(loaded);
      setDrafts(Object.fromEntries(loaded.map((product) => [product.id, toDraft(product)])));
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not load products");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* Every mutation replaces the one product it touched, so the rest of the
     table keeps whatever unsaved edits it had. */
  const replace = useCallback((product: AdminProduct) => {
    setProducts((current) =>
      current ? current.map((entry) => (entry.id === product.id ? product : entry)) : current,
    );
    setDrafts((current) => ({ ...current, [product.id]: toDraft(product) }));
  }, []);

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

  return (
    <section className="admin__section">
      {error ? (
        <p className="admin__error" role="alert">
          {error}
        </p>
      ) : null}

      <form
        className="admin__card admin__card--new"
        onSubmit={(event) => {
          event.preventDefault();
          void run("new", async () => {
            const { product } = await api.admin.createProduct({
              ...draftToPayload(newDraft, newKind),
              kind: newKind,
            });
            setProducts((current) => (current ? [product, ...current] : [product]));
            setDrafts((current) => ({ ...current, [product.id]: toDraft(product) }));
            setNewDraft(EMPTY_DRAFT);
          });
        }}
      >
        <h2 className="admin__cardTitle">new product</h2>

        <div className="admin__grid">
          {/* Kind decides how the thing is billed, so it is fixed at creation
              and cannot be edited afterwards. */}
          <label className="admin__field">
            <span>type</span>
            <select
              value={newKind}
              onChange={(event) => setNewKind(event.target.value as ProductKind)}
            >
              <option value="print">print (one-off)</option>
              <option value="subscription">monthly print subscription</option>
            </select>
          </label>

          <label className="admin__field">
            <span>title</span>
            <input
              required
              value={newDraft.title}
              onChange={(event) => setNewDraft({ ...newDraft, title: event.target.value })}
            />
          </label>

          <label className="admin__field">
            <span>{newKind === "subscription" ? "price per month" : "price"}</span>
            <input
              required
              inputMode="decimal"
              placeholder="45.00"
              value={newDraft.price}
              onChange={(event) => setNewDraft({ ...newDraft, price: event.target.value })}
            />
          </label>

          {newKind === "print" ? (
            <label className="admin__field">
              <span>stock (blank = unlimited)</span>
              <input
                inputMode="numeric"
                value={newDraft.stock}
                onChange={(event) => setNewDraft({ ...newDraft, stock: event.target.value })}
              />
            </label>
          ) : null}
        </div>

        <label className="admin__field">
          <span>description</span>
          <textarea
            rows={2}
            value={newDraft.description}
            onChange={(event) => setNewDraft({ ...newDraft, description: event.target.value })}
          />
        </label>

        <button className="admin__primary" type="submit" disabled={busyId === "new"}>
          {busyId === "new" ? "creating…" : "create"}
        </button>
        <p className="admin__muted">
          Add images after creating; a product cannot be published without one.
          {newKind === "subscription"
            ? " Saving a subscription also creates its recurring price in Stripe."
            : ""}
        </p>
      </form>

      {products === null ? (
        <p className="admin__muted">loading…</p>
      ) : products.length === 0 ? (
        <p className="admin__muted">No products yet.</p>
      ) : (
        products.map((product) => {
          const draft = drafts[product.id] ?? toDraft(product);
          const busy = busyId === product.id;
          const isSubscription = product.kind === "subscription";

          return (
            <article key={product.id} className="admin__card">
              <header className="admin__cardHeader">
                <h2 className="admin__cardTitle">{product.title}</h2>
                <span className={`admin__badge${product.published ? " is-live" : ""}`}>
                  {product.published ? "published" : "draft"}
                </span>
                <span className="admin__badge">{KIND_LABELS[product.kind]}</span>
                <span className="admin__muted">/{product.slug}</span>
              </header>

              {isSubscription && !product.stripePriceId ? (
                <p className="admin__error">
                  Stripe has no price for this plan yet, so nobody can subscribe. Save it
                  again to retry.
                </p>
              ) : null}

              <div className="admin__thumbs">
                {product.images.map((image) => (
                  <figure key={image.id} className="admin__thumb">
                    <img src={image.url} alt={image.alt} />
                    <button
                      type="button"
                      aria-label={`Remove image from ${product.title}`}
                      onClick={() =>
                        run(product.id, async () => {
                          const { product: updated } = await api.admin.deleteImage(
                            product.id,
                            image.id,
                          );
                          replace(updated);
                        })
                      }
                    >
                      ×
                    </button>
                  </figure>
                ))}

                <label className="admin__upload">
                  <input
                    ref={(node) => {
                      fileInputs.current[product.id] = node;
                    }}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/avif"
                    multiple
                    onChange={(event) => {
                      const files = [...(event.target.files ?? [])];
                      if (files.length === 0) return;
                      void run(product.id, async () => {
                        const { product: updated } = await api.admin.uploadImages(
                          product.id,
                          files,
                        );
                        replace(updated);
                        /* Clearing lets the same file be re-picked later. */
                        const input = fileInputs.current[product.id];
                        if (input) input.value = "";
                      });
                    }}
                  />
                  <span>{busy ? "…" : "+ images"}</span>
                </label>
              </div>

              <div className="admin__grid">
                <label className="admin__field">
                  <span>title</span>
                  <input
                    value={draft.title}
                    onChange={(event) =>
                      setDrafts({
                        ...drafts,
                        [product.id]: { ...draft, title: event.target.value },
                      })
                    }
                  />
                </label>

                <label className="admin__field">
                  <span>
                    {isSubscription ? "price per month" : "price"} (
                    {product.currency.toUpperCase()})
                  </span>
                  <input
                    inputMode="decimal"
                    value={draft.price}
                    onChange={(event) =>
                      setDrafts({
                        ...drafts,
                        [product.id]: { ...draft, price: event.target.value },
                      })
                    }
                  />
                </label>

                {isSubscription ? null : (
                  <label className="admin__field">
                    <span>stock</span>
                    <input
                      inputMode="numeric"
                      placeholder="unlimited"
                      value={draft.stock}
                      onChange={(event) =>
                        setDrafts({
                          ...drafts,
                          [product.id]: { ...draft, stock: event.target.value },
                        })
                      }
                    />
                  </label>
                )}

                <label className="admin__field">
                  <span>sort order</span>
                  <input
                    inputMode="numeric"
                    value={draft.sortOrder}
                    onChange={(event) =>
                      setDrafts({
                        ...drafts,
                        [product.id]: { ...draft, sortOrder: event.target.value },
                      })
                    }
                  />
                </label>
              </div>

              <label className="admin__field">
                <span>description</span>
                <textarea
                  rows={2}
                  value={draft.description}
                  onChange={(event) =>
                    setDrafts({
                      ...drafts,
                      [product.id]: { ...draft, description: event.target.value },
                    })
                  }
                />
              </label>

              <label className="admin__checkbox">
                <input
                  type="checkbox"
                  checked={draft.published}
                  onChange={(event) =>
                    setDrafts({
                      ...drafts,
                      [product.id]: { ...draft, published: event.target.checked },
                    })
                  }
                />
                <span>visible in the vault</span>
              </label>

              <div className="admin__actions">
                <button
                  type="button"
                  className="admin__primary"
                  disabled={busy}
                  onClick={() =>
                    run(product.id, async () => {
                      const { product: updated } = await api.admin.updateProduct(
                        product.id,
                        draftToPayload(draft, product.kind),
                      );
                      replace(updated);
                    })
                  }
                >
                  {busy ? "saving…" : "save"}
                </button>

                <button
                  type="button"
                  className="admin__danger"
                  disabled={busy}
                  onClick={() => {
                    if (!confirm(`Delete "${product.title}"? This cannot be undone.`)) return;
                    void run(product.id, async () => {
                      await api.admin.deleteProduct(product.id);
                      await load();
                    });
                  }}
                >
                  delete
                </button>

                <span className="admin__muted">
                  {formatMoney(product.priceCents, product.currency)}
                  {isSubscription
                    ? " / month"
                    : ` · ${product.stock === null ? "unlimited" : `${product.stock} in stock`}`}
                </span>
              </div>
            </article>
          );
        })
      )}
    </section>
  );
}
