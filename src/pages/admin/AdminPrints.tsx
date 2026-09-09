import { useCallback, useEffect, useRef, useState } from "react";
import { api, type AdminPrint } from "../../lib/api";
import { formatMoney, parseMoneyToCents } from "../../lib/money";
import "./admin.css";

type Draft = {
  title: string;
  description: string;
  price: string;
  stock: string;
  published: boolean;
  sortOrder: string;
};

function toDraft(print: AdminPrint): Draft {
  return {
    title: print.title,
    description: print.description,
    price: (print.priceCents / 100).toFixed(2),
    stock: print.stock === null ? "" : String(print.stock),
    published: print.published,
    sortOrder: String(print.sortOrder),
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
   different states, so the empty string cannot collapse to 0. */
function draftToPayload(draft: Draft) {
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
    stock,
    published: draft.published,
    sortOrder: Number.parseInt(draft.sortOrder, 10) || 0,
  };
}

export default function AdminPrints() {
  const [prints, setPrints] = useState<AdminPrint[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [newDraft, setNewDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    try {
      const { prints: loaded } = await api.admin.listPrints();
      setPrints(loaded);
      setDrafts(Object.fromEntries(loaded.map((print) => [print.id, toDraft(print)])));
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not load prints");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* Every mutation replaces the one print it touched, so the rest of the
     table keeps whatever unsaved edits it had. */
  const replace = useCallback((print: AdminPrint) => {
    setPrints((current) =>
      current ? current.map((entry) => (entry.id === print.id ? print : entry)) : current,
    );
    setDrafts((current) => ({ ...current, [print.id]: toDraft(print) }));
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
            const { print } = await api.admin.createPrint(draftToPayload(newDraft));
            setPrints((current) => (current ? [print, ...current] : [print]));
            setDrafts((current) => ({ ...current, [print.id]: toDraft(print) }));
            setNewDraft(EMPTY_DRAFT);
          });
        }}
      >
        <h2 className="admin__cardTitle">new print</h2>

        <div className="admin__grid">
          <label className="admin__field">
            <span>title</span>
            <input
              required
              value={newDraft.title}
              onChange={(event) => setNewDraft({ ...newDraft, title: event.target.value })}
            />
          </label>

          <label className="admin__field">
            <span>price</span>
            <input
              required
              inputMode="decimal"
              placeholder="45.00"
              value={newDraft.price}
              onChange={(event) => setNewDraft({ ...newDraft, price: event.target.value })}
            />
          </label>

          <label className="admin__field">
            <span>stock (blank = unlimited)</span>
            <input
              inputMode="numeric"
              value={newDraft.stock}
              onChange={(event) => setNewDraft({ ...newDraft, stock: event.target.value })}
            />
          </label>
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
          Add images after creating; a print cannot be published without one.
        </p>
      </form>

      {prints === null ? (
        <p className="admin__muted">loading…</p>
      ) : prints.length === 0 ? (
        <p className="admin__muted">No prints yet.</p>
      ) : (
        prints.map((print) => {
          const draft = drafts[print.id] ?? toDraft(print);
          const busy = busyId === print.id;

          return (
            <article key={print.id} className="admin__card">
              <header className="admin__cardHeader">
                <h2 className="admin__cardTitle">{print.title}</h2>
                <span className={`admin__badge${print.published ? " is-live" : ""}`}>
                  {print.published ? "published" : "draft"}
                </span>
                <span className="admin__muted">/{print.slug}</span>
              </header>

              <div className="admin__thumbs">
                {print.images.map((image) => (
                  <figure key={image.id} className="admin__thumb">
                    <img src={image.url} alt={image.alt} />
                    <button
                      type="button"
                      aria-label={`Remove image from ${print.title}`}
                      onClick={() =>
                        run(print.id, async () => {
                          const { print: updated } = await api.admin.deleteImage(
                            print.id,
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
                      fileInputs.current[print.id] = node;
                    }}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/avif"
                    multiple
                    onChange={(event) => {
                      const files = [...(event.target.files ?? [])];
                      if (files.length === 0) return;
                      void run(print.id, async () => {
                        const { print: updated } = await api.admin.uploadImages(print.id, files);
                        replace(updated);
                        /* Clearing lets the same file be re-picked later. */
                        const input = fileInputs.current[print.id];
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
                      setDrafts({ ...drafts, [print.id]: { ...draft, title: event.target.value } })
                    }
                  />
                </label>

                <label className="admin__field">
                  <span>price ({print.currency.toUpperCase()})</span>
                  <input
                    inputMode="decimal"
                    value={draft.price}
                    onChange={(event) =>
                      setDrafts({ ...drafts, [print.id]: { ...draft, price: event.target.value } })
                    }
                  />
                </label>

                <label className="admin__field">
                  <span>stock</span>
                  <input
                    inputMode="numeric"
                    placeholder="unlimited"
                    value={draft.stock}
                    onChange={(event) =>
                      setDrafts({ ...drafts, [print.id]: { ...draft, stock: event.target.value } })
                    }
                  />
                </label>

                <label className="admin__field">
                  <span>sort order</span>
                  <input
                    inputMode="numeric"
                    value={draft.sortOrder}
                    onChange={(event) =>
                      setDrafts({
                        ...drafts,
                        [print.id]: { ...draft, sortOrder: event.target.value },
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
                      [print.id]: { ...draft, description: event.target.value },
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
                      [print.id]: { ...draft, published: event.target.checked },
                    })
                  }
                />
                <span>visible on the prints page</span>
              </label>

              <div className="admin__actions">
                <button
                  type="button"
                  className="admin__primary"
                  disabled={busy}
                  onClick={() =>
                    run(print.id, async () => {
                      const { print: updated } = await api.admin.updatePrint(
                        print.id,
                        draftToPayload(draft),
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
                    if (!confirm(`Delete "${print.title}"? This cannot be undone.`)) return;
                    void run(print.id, async () => {
                      await api.admin.deletePrint(print.id);
                      await load();
                    });
                  }}
                >
                  delete
                </button>

                <span className="admin__muted">
                  {formatMoney(print.priceCents, print.currency)} ·{" "}
                  {print.stock === null ? "unlimited" : `${print.stock} in stock`}
                </span>
              </div>
            </article>
          );
        })
      )}
    </section>
  );
}
