import { useCallback, useEffect, useRef, useState } from "react";
import RichTextEditor from "../../components/RichTextEditor";
import { api, type AdminMemory } from "../../lib/api";
import "./admin.css";

type Draft = {
  title: string;
  alt: string;
  body: string;
  published: boolean;
  capturedAt: string;
};

/* <input type="datetime-local"> only accepts local wall-clock time with no
   zone, so the ISO string coming back from the API has to be rebased onto the
   admin's own offset on the way in and lifted back off it on the way out. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toDraft(memory: AdminMemory): Draft {
  return {
    title: memory.title,
    alt: memory.alt,
    body: memory.body,
    published: memory.published,
    capturedAt: toLocalInput(memory.capturedAt),
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/avif";

export default function AdminMemories() {
  const [memories, setMemories] = useState<AdminMemory[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grouped, setGrouped] = useState(false);
  const [journalTitle, setJournalTitle] = useState("");
  const [journalBody, setJournalBody] = useState("");
  const uploadInput = useRef<HTMLInputElement | null>(null);
  const imageInputs = useRef<Record<string, HTMLInputElement | null>>({});

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

  function patchDraft(id: string, draft: Draft, patch: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [id]: { ...draft, ...patch } }));
  }

  return (
    <section className="admin__section">
      {error ? (
        <p className="admin__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="admin__card admin__card--new">
        <h2 className="admin__cardTitle">add photographs</h2>

        <div className="admin__thumbs">
          <label className="admin__upload">
            <input
              ref={uploadInput}
              type="file"
              accept={ACCEPT}
              multiple
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                if (files.length === 0) return;
                void run("new", async () => {
                  const { memories: updated } = await api.admin.uploadMemories(
                    files,
                    grouped,
                  );
                  apply(updated);
                  /* Clearing lets the same file be re-picked later. */
                  if (uploadInput.current) uploadInput.current.value = "";
                });
              }}
            />
            <span>{busyId === "new" ? "uploading…" : "+ images"}</span>
          </label>
        </div>

        <label className="admin__checkbox">
          <input
            type="checkbox"
            checked={grouped}
            onChange={(event) => setGrouped(event.target.checked)}
          />
          <span>keep these together as one memory</span>
        </label>

        <p className="admin__muted">
          The original is kept for the lightbox and downloads. A smaller webp is
          made automatically for the list, so large files are fine here. Without
          the box ticked, each file becomes its own memory.
        </p>
      </div>

      <div className="admin__card admin__card--new">
        <h2 className="admin__cardTitle">write a journal entry</h2>

        <label className="admin__field">
          <span>title</span>
          <input
            value={journalTitle}
            onChange={(event) => setJournalTitle(event.target.value)}
          />
        </label>

        <RichTextEditor
          label="entry"
          rows={8}
          value={journalBody}
          onChange={setJournalBody}
        />

        <div className="admin__actions">
          <button
            className="admin__primary"
            type="button"
            disabled={busyId === "journal" || journalBody.trim().length === 0}
            onClick={() =>
              run("journal", async () => {
                const { memories: updated } = await api.admin.createJournalMemory({
                  title: journalTitle.trim(),
                  body: journalBody,
                });
                apply(updated);
                setJournalTitle("");
                setJournalBody("");
              })
            }
          >
            {busyId === "journal" ? "saving…" : "create entry"}
          </button>
        </div>

        <p className="admin__muted">
          Entries are created hidden so they can be read back before anyone else
          sees them. Images can be attached afterwards.
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
          const isJournal = memory.kind === "journal";

          return (
            <article key={memory.id} className="admin__card">
              <header className="admin__cardHeader">
                <h2 className="admin__cardTitle">
                  {memory.slug}
                  {memory.title ? ` · ${memory.title}` : ""}
                </h2>
                <span className={`admin__badge${memory.published ? " is-live" : ""}`}>
                  {memory.published ? "published" : "hidden"}
                </span>
                <span className="admin__badge">{memory.tag}</span>
                <span className="admin__muted">
                  {memory.images.length} image
                  {memory.images.length === 1 ? "" : "s"}
                  {memory.images.length > 0 ? ` · ${formatBytes(memory.bytes)}` : ""}
                </span>
              </header>

              <div className="admin__thumbs">
                {memory.images.map((image) => (
                  <figure key={image.id} className="admin__thumb">
                    <img src={image.previewUrl} alt={memory.alt || memory.title} />
                    <button
                      type="button"
                      aria-label={`Remove image from ${memory.slug}`}
                      onClick={() => {
                        /* The image itself is removed from S3, so there is no
                           undo once this goes through. */
                        if (!window.confirm("Remove this image for good?")) return;
                        void run(memory.id, async () => {
                          const { memories: updated } =
                            await api.admin.deleteMemoryImage(memory.id, image.id);
                          apply(updated);
                        });
                      }}
                    >
                      ×
                    </button>
                  </figure>
                ))}

                <label className="admin__upload">
                  <input
                    ref={(node) => {
                      imageInputs.current[memory.id] = node;
                    }}
                    type="file"
                    accept={ACCEPT}
                    multiple
                    onChange={(event) => {
                      const files = [...(event.target.files ?? [])];
                      if (files.length === 0) return;
                      void run(memory.id, async () => {
                        const { memories: updated } = await api.admin.addMemoryImages(
                          memory.id,
                          files,
                        );
                        apply(updated);
                        const input = imageInputs.current[memory.id];
                        if (input) input.value = "";
                      });
                    }}
                  />
                  <span>{busy ? "…" : "+ images"}</span>
                </label>
              </div>

              <div className="admin__grid">
                <label className="admin__field">
                  <span>{isJournal ? "title" : "caption"}</span>
                  <input
                    value={draft.title}
                    onChange={(event) =>
                      patchDraft(memory.id, draft, { title: event.target.value })
                    }
                  />
                </label>

                <label className="admin__field">
                  <span>alt text</span>
                  <input
                    value={draft.alt}
                    onChange={(event) =>
                      patchDraft(memory.id, draft, { alt: event.target.value })
                    }
                  />
                </label>

                <label className="admin__field">
                  <span>dated</span>
                  <input
                    type="datetime-local"
                    value={draft.capturedAt}
                    onChange={(event) =>
                      patchDraft(memory.id, draft, { capturedAt: event.target.value })
                    }
                  />
                </label>
              </div>

              <RichTextEditor
                label={isJournal ? "entry" : "note"}
                rows={isJournal ? 8 : 3}
                value={draft.body}
                onChange={(value) => patchDraft(memory.id, draft, { body: value })}
                images={memory.images.map((image) => ({
                  url: image.previewUrl,
                  alt: memory.alt || memory.title,
                }))}
              />

              <label className="admin__checkbox">
                <input
                  type="checkbox"
                  checked={draft.published}
                  onChange={(event) =>
                    patchDraft(memory.id, draft, { published: event.target.checked })
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
                      const { memories: updated } = await api.admin.updateMemory(
                        memory.id,
                        {
                          title: draft.title.trim(),
                          alt: draft.alt.trim(),
                          body: draft.body,
                          published: draft.published,
                          capturedAt: fromLocalInput(draft.capturedAt),
                        },
                      );
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
                    /* The images themselves are removed from S3, so there is
                       no undo once this goes through. */
                    if (!window.confirm("Delete this memory for good?")) return;
                    void run(memory.id, async () => {
                      const { memories: updated } = await api.admin.deleteMemory(
                        memory.id,
                      );
                      apply(updated);
                    });
                  }}
                >
                  delete
                </button>

                {memory.images[0] ? (
                  <a
                    className="admin__muted"
                    href={memory.images[0].downloadUrl}
                    download={memory.images[0].downloadName}
                  >
                    original
                  </a>
                ) : null}
              </div>
            </article>
          );
        })
      )}
    </section>
  );
}
