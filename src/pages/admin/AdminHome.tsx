import { useCallback, useEffect, useRef, useState } from "react";
import RichTextEditor from "../../components/RichTextEditor";
import { api, type HomeContent, type HomeImage, type HomeNews } from "../../lib/api";
import { homeImageIds, readHomeDraft, refreshHomeImages, writeHomeDraft } from "../../lib/homeDraft";
import { prepareHomeImage } from "../../lib/homeUpload";

function ImagePicker({ label, onUpload }: { label: string; onUpload: (file: File) => void }) {
  return (
    <label className="admin__homeUpload">
      <span aria-hidden="true">+</span>
      <span>{label}</span>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        aria-label={label}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onUpload(file);
          event.target.value = "";
        }}
      />
    </label>
  );
}

function withoutImage(body: string, position: number) {
  return body.split(/\r?\n/).map((line) => {
    const token = /^\s*\[\[image:(\d+)\]\]\s*$/.exec(line);
    if (!token) return line;
    const number = Number(token[1]);
    return number === position ? "" : number > position ? `[[image:${number - 1}]]` : line;
  }).join("\n");
}

export default function AdminHome({ adminId }: { adminId: string }) {
  const [home, setHome] = useState<HomeContent | null>(null);
  const homeRef = useRef<HomeContent | null>(null);
  const uploadController = useRef<AbortController | null>(null);
  const draftKey = `coyv:home-draft:${adminId}`;
  const [busy, setBusy] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [uploadStage, setUploadStage] = useState<string | null>(null);
  const [draftWarning, setDraftWarning] = useState<string | null>(null);

  function replaceHome(next: HomeContent) {
    homeRef.current = next;
    setHome(next);
  }

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(draftKey);
      setDraftWarning(null);
    } catch (cause) {
      console.error("[home] Could not clear recovery draft", cause);
      setDraftWarning("Home is saved, but this browser could not clear its older recovery draft.");
    }
  }, [draftKey]);

  const load = useCallback((recover = true) => {
    return Promise.resolve().then(async () => {
      let draft: HomeContent | null = null;
      if (recover) {
        try {
          const stored = localStorage.getItem(draftKey);
          if (stored) draft = readHomeDraft(stored);
        } catch (cause) {
          console.error("[home] Could not read recovery draft", cause);
          setDraftWarning("The browser recovery draft could not be read. Loading published content instead.");
        }
      }
      if (draft) {
        replaceHome(draft);
        setDirty(true);
        setNotice("Recovered unsaved home changes from this browser.");
      }
      const { home: loaded } = await api.admin.getHome();
      if (draft) {
        const { images } = await api.admin.resolveHomeImages(homeImageIds(draft));
        replaceHome(refreshHomeImages(draft, images));
        setNotice(draft.revision === loaded.revision
          ? "Recovered unsaved home changes. Save home to publish, or reload to discard."
          : "Recovered your draft, but published home changed in another session. Copy your edits before reloading; a stale save will not overwrite it.");
      } else {
        replaceHome(loaded);
        setDirty(false);
        setNotice("");
      }
      if (!recover) clearDraft();
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Could not load home");
    }).finally(() => {
      setBusy(false);
    });
  }, [draftKey, clearDraft]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => {
    uploadController.current?.abort(new DOMException("Upload cancelled. Your draft has been kept.", "AbortError"));
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function edit(update: (current: HomeContent) => HomeContent) {
    const current = homeRef.current;
    if (!current) return;
    const next = update(current);
    replaceHome(next);
    setDirty(true);
    setNotice("");
    try {
      localStorage.setItem(draftKey, writeHomeDraft(next));
      setDraftWarning(null);
    } catch (cause) {
      console.error("[home] Could not keep recovery draft", cause);
      setDraftWarning("This browser could not keep a recovery draft. Save your changes before leaving.");
    }
  }

  function editNews(id: string, patch: Partial<HomeNews>) {
    edit((current) => ({
      ...current,
      news: current.news.map((item) => item.id === id ? { ...item, ...patch } : item),
    }));
  }

  async function upload(file: File, accept: (image: HomeImage) => void) {
    if (uploadController.current) return;
    const controller = new AbortController();
    uploadController.current = controller;
    const timeout = window.setTimeout(() => controller.abort(new DOMException(
      "Image upload timed out. Your other changes are still here; save them, then try the image again.",
      "TimeoutError",
    )), 60_000);
    setBusy(true);
    setError(null);
    setNotice("");
    setUploadStage("preparing image…");
    try {
      const prepared = await prepareHomeImage(file, controller.signal);
      controller.signal.throwIfAborted();
      setUploadStage("uploading image…");
      const { image } = await api.admin.uploadHomeImage(prepared, controller.signal);
      accept(image);
      setNotice("Image uploaded. Save home to publish your changes.");
    } catch (cause) {
      const failure: unknown = controller.signal.aborted ? controller.signal.reason : cause;
      setError(failure instanceof Error ? failure.message : "Could not upload this image. Your other changes are still here.");
    } finally {
      window.clearTimeout(timeout);
      uploadController.current = null;
      setUploadStage(null);
      setBusy(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!home) return;
    if (home.news.some((item) => !item.preview.trim() || !item.body.trim())) {
      setError("Each news entry needs preview text and full entry text before saving.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { home: saved } = await api.admin.saveHome(home);
      replaceHome(saved);
      setDirty(false);
      clearDraft();
      setNotice("Home saved and published.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save home");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="admin__section" onSubmit={(event) => void save(event)}>
      {error ? <p className="admin__error" role="alert">{error}</p> : null}
      {draftWarning ? <p className="admin__error" role="alert">{draftWarning}</p> : null}
      {notice ? <p className="admin__muted" role="status">{notice}</p> : null}
      <div className="admin__actions">
        <button className="admin__primary" disabled={busy || !home || !dirty}>
          {busy ? uploadStage ?? "working…" : "save home"}
        </button>
        <button
          className="admin__logout"
          type="button"
          disabled={busy}
          onClick={() => {
            if (!dirty || window.confirm("Discard unsaved home changes and reload?")) {
              setBusy(true);
              setError(null);
              void load(false);
            }
          }}
        >reload</button>
        <span className="admin__muted">{dirty ? "unsaved changes" : "saved content"}</span>
        {uploadStage ? <button className="admin__logout" type="button" onClick={() =>
          uploadController.current?.abort(new DOMException(
            "Upload cancelled. Your other changes are still here and can be saved.", "AbortError",
          ))
        }>cancel upload</button> : null}
      </div>
      <p className="admin__muted">
        Save home publishes all sections together. Uploads are stored immediately;
        removing a slot only removes it from this page, not from asset storage.
        {" "}Unsaved edits are kept on this browser for recovery. Large home images
        are resized before sending; your original stays on your device.
      </p>
      {!home ? <p className="admin__muted">{busy ? "loading…" : "Home has not loaded. Use reload to try again."}</p> : (
        <fieldset className="admin__homeFields" disabled={busy}>
          <section className="admin__card">
            <h2 className="admin__cardTitle">about me</h2>
            <label className="admin__field">
              <span>about me text</span>
              <textarea rows={6} maxLength={20000} value={home.aboutMe}
                onChange={(event) => edit((current) => ({ ...current, aboutMe: event.target.value }))} />
            </label>
          </section>

          {(["projects", "artwork"] as const).map((section) => (
            <section className="admin__card" key={section}>
              <h2 className="admin__cardTitle">{section} · {home[section].length}/4</h2>
              <div className="admin__grid">
                {home[section].map((item, index) => (
                  <div className="admin__homeTile" key={`${item.image.id}-${index}`}>
                    <img src={item.image.url} alt={item.title || `${section} preview ${index + 1}`} />
                    <label className="admin__field">
                      <span>caption / alt text</span>
                      <input maxLength={160} value={item.title} onChange={(event) => edit((current) => ({
                        ...current, [section]: current[section].map((entry, at) =>
                          at === index ? { ...entry, title: event.target.value } : entry),
                      }))} />
                    </label>
                    <label className="admin__field">
                      <span>destination link (optional)</span>
                      <input type="url" maxLength={2048} placeholder="https://" value={item.url}
                        onChange={(event) => edit((current) => ({
                          ...current, [section]: current[section].map((entry, at) =>
                            at === index ? { ...entry, url: event.target.value } : entry),
                        }))} />
                    </label>
                    <button className="admin__danger" type="button" onClick={() => edit((current) => ({
                      ...current, [section]: current[section].filter((_, at) => at !== index),
                    }))}>remove image {index + 1}</button>
                  </div>
                ))}
                {home[section].length < 4 ? (
                  <ImagePicker label={`add ${section} image`} onUpload={(file) => void upload(file, (image) =>
                    edit((current) => ({
                      ...current, [section]: [...current[section], { image, title: "", url: "" }],
                    })),
                  )} />
                ) : null}
              </div>
            </section>
          ))}

          <section className="admin__card">
            <h2 className="admin__cardTitle">news</h2>
            <button type="button" className="admin__logout" onClick={() => edit((current) => ({
              ...current,
              news: [{
                id: crypto.randomUUID(), date: new Date().toISOString().slice(0, 10),
                preview: "", previewImage: null, body: "", images: [],
              }, ...current.news],
            }))}>+ news entry</button>
            {home.news.map((item) => (
              <article className="admin__card" key={item.id}>
                <label className="admin__field">
                  <span>event date</span>
                  <input type="date" required value={item.date}
                    onChange={(event) => editNews(item.id, { date: event.target.value })} />
                </label>
                <div className="admin__homePreview">
                  <div>
                    {item.previewImage ? (
                      <figure className="admin__thumb">
                        <img src={item.previewImage.url} alt="News preview" />
                        <button type="button" aria-label="Remove news preview image"
                          onClick={() => editNews(item.id, { previewImage: null })}>×</button>
                      </figure>
                    ) : null}
                    <ImagePicker label={item.previewImage ? "replace news preview" : "add news preview"}
                      onUpload={(file) => void upload(file, (image) => editNews(item.id, { previewImage: image }))} />
                  </div>
                  <label className="admin__field">
                    <span>preview text</span>
                    <textarea rows={4} maxLength={1000} required value={item.preview}
                      onChange={(event) => editNews(item.id, { preview: event.target.value })} />
                  </label>
                </div>
                <RichTextEditor label="full news entry" rows={8} value={item.body}
                  images={item.images.map((image) => ({ url: image.url }))}
                  onChange={(body) => editNews(item.id, { body })} />
                <p className="admin__muted">
                  Upload entry images below, then choose them in “place an image” to insert
                  them into the text. The date on home opens this full entry in a new tab.
                </p>
                <div className="admin__thumbs">
                  {item.images.map((image, index) => (
                    <figure className="admin__thumb" key={`${image.id}-${index}`}>
                      <img src={image.url} alt={`Entry image ${index + 1}`} />
                      <button type="button" aria-label={`Remove entry image ${index + 1}`}
                        onClick={() => editNews(item.id, {
                          images: item.images.filter((_, at) => at !== index),
                          body: withoutImage(item.body, index + 1),
                        })}>×</button>
                    </figure>
                  ))}
                  <ImagePicker label="add entry image"
                    onUpload={(file) => void upload(file, (image) => editNews(item.id, { images: [...item.images, image] }))} />
                </div>
                <button className="admin__danger" type="button" onClick={() => edit((current) => ({
                  ...current, news: current.news.filter((entry) => entry.id !== item.id),
                }))}>remove news entry</button>
              </article>
            ))}
          </section>

          <section className="admin__card">
            <h2 className="admin__cardTitle">contact</h2>
            {home.contacts.map((contact) => (
              <div className="admin__homeContact" key={contact.id}>
                <label className="admin__field">
                  <span>contact title</span>
                  <input required maxLength={100} value={contact.title} onChange={(event) => edit((current) => ({
                    ...current, contacts: current.contacts.map((item) =>
                      item.id === contact.id ? { ...item, title: event.target.value } : item),
                  }))} />
                </label>
                <label className="admin__field">
                  <span>contact link</span>
                  <input type="url" required maxLength={2048} placeholder="https://" value={contact.url}
                    onChange={(event) => edit((current) => ({
                      ...current, contacts: current.contacts.map((item) =>
                        item.id === contact.id ? { ...item, url: event.target.value } : item),
                    }))} />
                </label>
                <button className="admin__danger" type="button" onClick={() => edit((current) => ({
                  ...current, contacts: current.contacts.filter((item) => item.id !== contact.id),
                }))}>remove contact</button>
              </div>
            ))}
            <button className="admin__logout" type="button" onClick={() => edit((current) => ({
              ...current, contacts: [...current.contacts, { id: crypto.randomUUID(), title: "", url: "" }],
            }))}>+ contact</button>
          </section>
        </fieldset>
      )}
    </form>
  );
}
