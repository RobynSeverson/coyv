import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import { RichText } from "../lib/richText";
import { api, type Memory, type MemoryImage } from "../lib/api";
import { trackEvent } from "../lib/analytics";
/* The viewer chrome is shared with the vault's grid, which is why these
   styles are not in Memories.css. */
import "./Collection.css";
import "./Memories.css";

/* Dressing for the viewer, which is styled after an in-game archive terminal.
   None of it is content — it is chrome that happens to be lettering — so every
   element carrying it is hidden from assistive technology, and the entry is
   picked by index rather than at random so it stays put across re-renders and
   matches on the way back to a memory you have already seen.

   Tag and line travel together so a single overlay never mixes scripts, and
   the languages are interleaved rather than grouped, so consecutive memories
   land on different ones. */
const HUD_ENTRIES = [
  { lang: "ja", tag: "記録", line: "記憶を選択してください。" },
  { lang: "ru", tag: "ЗАПИСЬ", line: "Выберите воспоминание." },
  { lang: "es", tag: "REGISTRO", line: "Selecciona un recuerdo." },
  { lang: "ja", tag: "断片", line: "この記録は失われていない。" },
  { lang: "ru", tag: "ФРАГМЕНТ", line: "Эта запись не потеряна." },
  { lang: "es", tag: "FRAGMENTO", line: "Este registro no se ha perdido." },
  { lang: "ja", tag: "残像", line: "断片を再生しています。" },
  { lang: "ru", tag: "ОСТАТОК", line: "Воспроизведение фрагмента." },
  { lang: "es", tag: "RESTO", line: "Reproduciendo un fragmento." },
  { lang: "ja", tag: "追憶", line: "夢の跡をたどっています。" },
  { lang: "ru", tag: "ПАМЯТЬ", line: "Следы сна сохранены." },
  { lang: "es", tag: "MEMORIA", line: "Siguiendo el rastro de un sueño." },
  { lang: "ja", tag: "保存", line: "保存された記憶：良好。" },
  { lang: "ru", tag: "АРХИВ", line: "Состояние архива: норма." },
  { lang: "es", tag: "ARCHIVO", line: "Estado del archivo: correcto." },
  { lang: "ja", tag: "接続", line: "接続は安定しています。" },
  { lang: "ru", tag: "СВЯЗЬ", line: "Соединение стабильно." },
  { lang: "es", tag: "ENLACE", line: "La conexión es estable." },
];

/* Rows the list draws before anything has loaded, so the page has its final
   shape immediately instead of collapsing and then pushing the nav down. */
const SKELETON_ROWS = [0, 1, 2, 3, 4, 5];

const DownloadIcon = () => (
  <svg
    className="collection__downloadIcon"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M12 3.5v10.5m0 0 4.25-4.25M12 14l-4.25-4.25" />
    <path d="M4.5 16.5v2.25a1.25 1.25 0 0 0 1.25 1.25h12.5a1.25 1.25 0 0 0 1.25-1.25V16.5" />
  </svg>
);

/* Fixed-width fields, because the column only reads as a file listing if
   every row's date occupies exactly the same space. */
function formatStamp(value: string | null): string {
  if (!value) return "----/--/-- --:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "----/--/-- --:--";

  const pad = (part: number) => String(part).padStart(2, "0");
  return (
    `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/* A memory opens as one or more slides. A journal entry leads with its text
   and is followed by whatever images are attached to it, so the arrow keys
   walk the whole archive in the order the list presents it. */
type Slide =
  | { type: "text"; memory: Memory; key: string }
  | { type: "image"; memory: Memory; image: MemoryImage; position: number; key: string };

/* The number inside a memory's name, so a link can carry either form the
   list shows: memory_001, or just the 001 someone copied out of it. Leading
   zeroes are incidental, so 1 and 001 are the same memory. */
function memoryNumber(value: string): number | null {
  const digits = value.trim().replace(/^memory[_-]?/i, "");
  if (!/^\d+$/.test(digits)) return null;
  return Number(digits);
}

function toSlides(memories: Memory[]): Slide[] {
  return memories.flatMap((memory) => {
    const images = memory.images.map<Slide>((image, index) => ({
      type: "image",
      memory,
      image,
      position: index,
      key: image.id,
    }));

    if (memory.kind !== "journal") return images;
    return [{ type: "text", memory, key: `${memory.id}-text` }, ...images];
  });
}

export default function Memories() {
  const { slug: linkedSlug } = useParams();
  const navigate = useNavigate();
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    api
      .listMemories(controller.signal)
      .then(({ memories: loaded }) => setMemories(loaded))
      .catch((error: unknown) => {
        /* An abort is this component unmounting, not a failure to show. */
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
      });

    return () => controller.abort();
  }, []);

  const slides = useMemo(() => toSlides(memories ?? []), [memories]);

  /* The list is meant to read like a console's file browser, where the row
     under the cursor stands proud of the ones running off either end. Each
     row is told how close it is to the middle of the viewport and does the
     rest in CSS, so scrolling only ever writes a custom property and never
     touches layout.

     Measured on every frame rather than through IntersectionObserver: the
     effect needs a continuous distance, and the observer only reports the
     thresholds it was given. */
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;

    const paint = () => {
      frame = 0;
      const middle = window.innerHeight / 2;
      /* Half a viewport out is as small as a row ever gets, so the taper is
         always visible whatever the screen height. */
      const reach = Math.max(middle, 1);

      for (const child of list.children) {
        const row = child as HTMLElement;
        const box = row.getBoundingClientRect();
        const offset = Math.abs(box.top + box.height / 2 - middle);
        row.style.setProperty("--row-focus", String(1 - Math.min(offset / reach, 1)));
      }
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };

    paint();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [memories]);

  /* The row a visitor clicks is a memory, but the viewer walks slides, so the
     list needs to know which slide each row opens on. */
  const firstSlideOf = useMemo(() => {
    const byMemory = new Map<string, number>();
    slides.forEach((slide, index) => {
      if (!byMemory.has(slide.memory.id)) byMemory.set(slide.memory.id, index);
    });
    return byMemory;
  }, [slides]);

  /* Closing returns to the plain list, so a deep link does not leave the URL
     pointing at a memory that is no longer on screen. */
  const close = useCallback(() => {
    setOpenIndex(null);
    if (linkedSlug) navigate("/memories", { replace: true });
  }, [linkedSlug, navigate]);

  /* Opening a memory is the only thing to measure on this page — there is no
     add-to-cart and nothing to sign up for — so the row click reports which
     one was picked and where it sat in the list. `memory_open` is a custom
     event, so its parameters need registering as custom dimensions in GA4
     before they show up as anything other than an event count. */
  const openMemory = useCallback(
    (memory: Memory, position: number) => {
      setOpenIndex(firstSlideOf.get(memory.id) ?? 0);

      trackEvent("memory_open", {
        memory_slug: memory.slug,
        memory_kind: memory.kind,
        memory_tag: memory.tag,
        memory_images: memory.images.length,
        /* One-based so it reads like the list does. */
        list_position: position + 1,
      });
    },
    [firstSlideOf],
  );

  /* A deep link lands on the list, brings its row to the middle of the screen
     and opens it. The scroll is instant rather than smooth because the
     lightbox goes straight up over it and locks the page — the point of the
     scroll is where the row sits once the viewer is closed again. */
  const linkHandled = useRef<string | null>(null);

  useEffect(() => {
    if (!linkedSlug || !memories) return;
    if (linkHandled.current === linkedSlug) return;
    linkHandled.current = linkedSlug;

    const wanted = memoryNumber(linkedSlug);
    const target = memories.find(
      (memory) =>
        memory.slug.toLowerCase() === linkedSlug.toLowerCase() ||
        (wanted !== null && memoryNumber(memory.slug) === wanted),
    );

    /* A link to something that has since been taken down still lands
       somewhere sensible rather than on an empty viewer. */
    if (!target) {
      navigate("/memories", { replace: true });
      return;
    }

    listRef.current
      ?.querySelector(`[data-memory="${target.slug}"]`)
      ?.scrollIntoView({ block: "center" });

    setOpenIndex(firstSlideOf.get(target.id) ?? 0);
  }, [linkedSlug, memories, firstSlideOf, navigate]);

  const step = useCallback(
    (delta: number) =>
      setOpenIndex((current) => {
        if (current === null || slides.length === 0) return current;
        return (current + delta + slides.length) % slides.length;
      }),
    [slides.length],
  );

  /* Escape closes, arrows page through. Also locks body scroll so the page
     behind doesn't move while the lightbox is up. */
  useEffect(() => {
    if (openIndex === null) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openIndex, close, step]);

  const openSlide = openIndex === null ? null : (slides[openIndex] ?? null);
  const hud = HUD_ENTRIES[(openIndex ?? 0) % HUD_ENTRIES.length];

  /* The lightbox shows the list's preview straight away and swaps in the
     original once it has loaded, so opening never waits on a large file.
     Holding the last loaded src (rather than clearing it on close) means
     reopening an image already in cache skips the preview entirely. */
  const [fullSrc, setFullSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!openSlide || openSlide.type !== "image") return;

    let cancelled = false;
    const target = openSlide.image.url;
    const loader = new Image();

    /* onload rather than decode(): decode() can hang indefinitely in Chrome
       for images that were never inserted into the document. */
    const done = () => {
      if (!cancelled) setFullSrc(target);
    };
    loader.onload = done;
    loader.onerror = done;
    loader.src = target;

    return () => {
      cancelled = true;
      loader.onload = null;
      loader.onerror = null;
    };
  }, [openSlide]);

  const notice = failed ? "these are lost for a moment" : null;

  return (
    <main className="archive">
      <PageHeader title="memories" />

      {notice ? (
        <p className="archive__notice" role="status">
          {notice}
        </p>
      ) : null}

      {memories !== null && memories.length === 0 && !failed ? (
        <p className="archive__notice" role="status">
          nothing saved here yet
        </p>
      ) : null}

      <ul className="archive__list" ref={listRef}>
        {memories === null
          ? SKELETON_ROWS.map((row) => (
              <li key={row} className="archive__row is-loading" aria-hidden="true">
                <span className="archive__thumb" />
                <span className="archive__meta">
                  <span className="archive__name" />
                  <span className="archive__stamp" />
                </span>
              </li>
            ))
          : memories.map((memory, position) => {
              const cover = memory.images[0] ?? null;
              const extra = memory.images.length - 1;

              return (
                <li key={memory.id} className="archive__row" data-memory={memory.slug}>
                  <button
                    type="button"
                    className="archive__open"
                    onClick={() => openMemory(memory, position)}
                  >
                    <span className="archive__thumb">
                      {cover ? (
                        <img
                          className="archive__thumbImage"
                          src={cover.previewUrl}
                          alt=""
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        /* A journal entry with nothing attached still needs a
                           tile, or its row loses the grid the list is built
                           on. */
                        <span className="archive__thumbBlank" aria-hidden="true">
                          ▤
                        </span>
                      )}
                      {extra > 0 ? (
                        <span className="archive__count" aria-hidden="true">
                          +{extra}
                        </span>
                      ) : null}
                    </span>

                    <span className="archive__meta">
                      <span className="archive__name">
                        {memory.slug}
                        {memory.title ? (
                          <span className="archive__title"> {memory.title}</span>
                        ) : null}
                      </span>
                      <span className="archive__stamp">
                        {formatStamp(memory.capturedAt)}
                      </span>
                    </span>

                    <span className="archive__tag" aria-hidden="true">
                      {memory.tag}
                    </span>

                    {/* The tag is decoration; this is the same fact said in a
                        way a screen reader can use. */}
                    <span className="archive__srOnly">
                      {memory.kind === "journal" ? "journal entry" : "photograph"},{" "}
                      {memory.images.length || "no"} image
                      {memory.images.length === 1 ? "" : "s"}
                    </span>
                  </button>
                </li>
              );
            })}
      </ul>

      {/* Portalled to the body: .archive runs a transform animation, which
          makes it a containing block for fixed-position descendants. */}
      {openSlide
        ? createPortal(
            <div
              className="lightbox"
              role="dialog"
              aria-modal="true"
              aria-label={`${openSlide.memory.slug}, ${(openIndex ?? 0) + 1} of ${slides.length}`}
              onClick={close}
            >
              {/* Cinematic bars and scanlines, drawn under the controls. */}
              <span className="lightbox__bars" aria-hidden="true" />
              <span className="lightbox__scanlines" aria-hidden="true" />

              <button
                type="button"
                className="lightbox__close"
                onClick={close}
                aria-label="Close"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>

              {slides.length > 1 ? (
                <>
                  <button
                    type="button"
                    className="lightbox__nav lightbox__nav--prev"
                    onClick={(event) => {
                      event.stopPropagation();
                      step(-1);
                    }}
                    aria-label="Previous"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M15 5l-7 7 7 7" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="lightbox__nav lightbox__nav--next"
                    onClick={(event) => {
                      event.stopPropagation();
                      step(1);
                    }}
                    aria-label="Next"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </>
              ) : null}

              {/* Clicks on the artwork itself shouldn't dismiss it. The
                  wrapper hugs the image so the overlays sit against the
                  artwork's real edges rather than the letterboxed stage. */}
              <figure
                className="lightbox__stage"
                onClick={(event) => event.stopPropagation()}
              >
                <figcaption className="lightbox__slug" aria-hidden="true">
                  <span className="lightbox__slugId">
                    {openSlide.memory.slug}
                    {openSlide.type === "image" && openSlide.memory.images.length > 1
                      ? `.${String(openSlide.position + 1).padStart(2, "0")}`
                      : ""}
                  </span>
                  <span className="lightbox__slugTag" lang={hud.lang}>
                    {hud.tag}
                  </span>
                </figcaption>

                {openSlide.type === "text" ? (
                  <div className="lightbox__entry">
                    {openSlide.memory.title ? (
                      <h2 className="lightbox__entryTitle">{openSlide.memory.title}</h2>
                    ) : null}
                    <p className="lightbox__entryStamp" aria-hidden="true">
                      {formatStamp(openSlide.memory.capturedAt)}
                    </p>
                    <RichText
                      className="lightbox__entryBody"
                      value={openSlide.memory.body}
                    />
                  </div>
                ) : (
                  <img
                    key={openSlide.image.id}
                    className={`lightbox__image${
                      fullSrc === openSlide.image.url ? "" : " is-loading"
                    }`}
                    src={
                      fullSrc === openSlide.image.url
                        ? openSlide.image.url
                        : openSlide.image.previewUrl
                    }
                    alt={openSlide.memory.alt || openSlide.memory.slug}
                  />
                )}

                <span className="lightbox__reticle" aria-hidden="true" />
              </figure>

              <div
                className="lightbox__hud"
                onClick={(event) => event.stopPropagation()}
              >
                <p className="lightbox__readout">
                  <span aria-hidden="true" lang={hud.lang}>
                    {hud.line}
                  </span>
                  <span className="lightbox__count">
                    {String((openIndex ?? 0) + 1).padStart(3, "0")} /{" "}
                    {String(slides.length).padStart(3, "0")}
                  </span>
                </p>

                {openSlide.type === "image" ? (
                  <a
                    className="lightbox__download"
                    href={openSlide.image.downloadUrl}
                    download={openSlide.image.downloadName}
                    aria-label={`Download ${openSlide.memory.slug}`}
                    /* The navigation is the browser's, so this only reports
                       the intent — a cancelled or failed save still counts. */
                    onClick={() =>
                      trackEvent("memory_download", {
                        memory_slug: openSlide.memory.slug,
                        memory_kind: openSlide.memory.kind,
                        memory_tag: openSlide.memory.tag,
                        file_name: openSlide.image.downloadName,
                        /* Which image of the memory, for memories holding
                           more than one. */
                        image_position: openSlide.position + 1,
                      })
                    }
                  >
                    <DownloadIcon />
                    <span className="lightbox__downloadLabel">
                      <span aria-hidden="true">保存</span> save
                    </span>
                  </a>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </main>
  );
}
