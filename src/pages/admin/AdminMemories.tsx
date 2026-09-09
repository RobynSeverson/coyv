import { useCallback, useEffect, useRef, useState } from "react";
import { api, type AdminMemory } from "../../lib/api";
import "./admin.css";

type Draft = { title: string; alt: string; published: boolean };

function toDraft(memory: AdminMemory): Draft {
  return { title: memory.title, alt: memory.alt, published: memory.published };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AdminMemories() {
  const [memories, setMemories] = useState<AdminMemory[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uploadInput = useRef<HTMLInputElement | null>(null);

  /* Every mutation answers with the whole list. Drafts for memories that are
     still there are kept, so an unsaved caption elsewhere survives an upload
     or a reorder. */
  const apply = useCallback((loaded: AdminMemory[]) => {
    setMemories(loaded);
    setDrafts((current) =>
      Object.fromEntries(
        loaded.map((memory) => [memory.id, current[memory.id] ?? toDraft(memory)]),
      ),
    );
  }, []);

  const load = useCallback(async () => {
    try {
      const { memories: loaded } = await api.admin.listMemories();
      setMemories(loaded);
      setDrafts(Object.fromEntries(loaded.map((memory) => [memory.id, toDraft(memory)])));
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not load memories");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  /* Swaps a memory with its neighbour and commits the whole running order,
     which keeps the sort values contiguous however they got there. */
  function move(id: string, delta: number) {
    if (!memories) return;
    const index = memories.findIndex((memory) => memory.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= memories.length) return;

    const order = memories.map((memory) => memory.id);
    [order[index], order[target]] = [order[target], order[index]];

    void run(id, async () => {
      const { memories: updated } = await api.admin.reorderMemories(order);
      apply(updated);
    });
  }

  return (
    <section className="admin__section">
      {error ? (
        <p className="admin__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="admin__card admin__card--new">
        <h2 className="admin__cardTitle">add memories</h2>

        <div className="admin__thumbs">
          <label className="admin__upload">
            <input
              ref={uploadInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              multiple
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                if (files.length === 0) return;
                void run("new", async () => {
                  const { memories: updated } = await api.admin.uploadMemories(files);
                  apply(updated);
                  /* Clearing lets the same file be re-picked later. */
                  if (uploadInput.current) uploadInput.current.value = "";
                });
              }}
            />
            <span>{busyId === "new" ? "uploading…" : "+ images"}</span>
          </label>
        </div>

        <p className="admin__muted">
          The original is kept for the lightbox and downloads. A smaller webp is
          made automatically for the grid, so large files are fine here.
        </p>
      </div>

      {memories === null ? (
        <p className="admin__muted">loading…</p>
      ) : memories.length === 0 ? (
        <p className="admin__muted">No memories yet.</p>
      ) : (
        memories.map((memory, index) => {
          const draft = drafts[memory.id] ?? toDraft(memory);
          const busy = busyId === memory.id;

          return (
            <article key={memory.id} className="admin__card">
              <header className="admin__cardHeader">
                <h2 className="admin__cardTitle">{memory.title || `memory ${index + 1}`}</h2>
                <span className={`admin__badge${memory.published ? " is-live" : ""}`}>
                  {memory.published ? "published" : "hidden"}
                </span>
                <span className="admin__muted">
                  {memory.width && memory.height
                    ? `${memory.width}×${memory.height} · `
                    : ""}
                  {formatBytes(memory.bytes)}
                </span>
              </header>

              <div className="admin__thumbs">
                <figure className="admin__thumb">
                  <img src={memory.previewUrl} alt={memory.alt || memory.title} />
                </figure>
              </div>

              <div className="admin__grid">
                <label className="admin__field">
                  <span>caption</span>
                  <input
                    value={draft.title}
                    onChange={(event) =>
                      setDrafts({
                        ...drafts,
                        [memory.id]: { ...draft, title: event.target.value },
                      })
                    }
                  />
                </label>

                <label className="admin__field">
                  <span>alt text</span>
                  <input
                    value={draft.alt}
                    onChange={(event) =>
                      setDrafts({
                        ...drafts,
                        [memory.id]: { ...draft, alt: event.target.value },
                      })
                    }
                  />
                </label>
              </div>

              <label className="admin__checkbox">
                <input
                  type="checkbox"
                  checked={draft.published}
                  onChange={(event) =>
                    setDrafts({
                      ...drafts,
                      [memory.id]: { ...draft, published: event.target.checked },
                    })
                  }
                />
                <span>published</span>
              </label>

              <div className="admin__actions">
                <button
                  className="admin__primary"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(memory.id, async () => {
                      const { memories: updated } = await api.admin.updateMemory(memory.id, {
                        title: draft.title.trim(),
                        alt: draft.alt.trim(),
                        published: draft.published,
                      });
                      apply(updated);
                    })
                  }
                >
                  {busy ? "saving…" : "save"}
                </button>

                <button
                  className="admin__tab"
                  type="button"
                  disabled={busy || index === 0}
                  onClick={() => move(memory.id, -1)}
                  aria-label="Move earlier"
                >
                  ↑
                </button>

                <button
                  className="admin__tab"
                  type="button"
                  disabled={busy || index === memories.length - 1}
                  onClick={() => move(memory.id, 1)}
                  aria-label="Move later"
                >
                  ↓
                </button>

                <button
                  className="admin__danger"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    /* The image itself is removed from S3, so there is no
                       undo once this goes through. */
                    if (!window.confirm("Delete this memory for good?")) return;
                    void run(memory.id, async () => {
                      const { memories: updated } = await api.admin.deleteMemory(memory.id);
                      apply(updated);
                    });
                  }}
                >
                  delete
                </button>

                <a
                  className="admin__muted"
                  href={memory.downloadUrl}
                  download={memory.downloadName}
                >
                  original
                </a>
              </div>
            </article>
          );
        })
      )}
    </section>
  );
}
