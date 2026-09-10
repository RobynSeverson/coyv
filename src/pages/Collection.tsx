import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import gatesArtwork from "../assets/landingDesktop.jpg";
import PageHeader from "../components/PageHeader";
import "./Collection.css";

export type Artwork = {
  /* lightweight webp shown in the grid */
  preview: string;
  /* original file, loaded only when opened */
  full: string;
  /* original again, but as a link that saves rather than navigates */
  download: string;
  downloadName: string;
};

type CollectionProps = {
  title: string;
  /* Shown under the wordmark only when there is something the visitor needs
     to know — a load failure, say. The decorative subheading it replaced now
     lives in the header artwork. */
  notice?: string | null;
  /* when omitted the page falls back to crops of the landing artwork */
  images?: Artwork[];
  /* Stem for the viewer's file-slug overlay: "memory" reads as memory_001. */
  slug?: string;
};

/* Dressing for the viewer, which is styled after an in-game archive terminal.
   None of it is content — it is chrome that happens to be lettering — so every
   element carrying it is hidden from assistive technology, and the entry is
   picked by index rather than at random so it stays put across re-renders and
   matches on the way back to an image you have already seen.

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

const PLACEHOLDER_POSITIONS = [
  "10% 20%",
  "35% 60%",
  "60% 30%",
  "85% 70%",
  "25% 85%",
  "70% 10%",
];

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

export default function Collection({
  title,
  notice,
  images,
  slug = "file",
}: CollectionProps) {
  const items = images?.length ? images : null;
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const close = useCallback(() => setOpenIndex(null), []);

  const step = useCallback(
    (delta: number) =>
      setOpenIndex((current) => {
        if (current === null || !items) return current;
        return (current + delta + items.length) % items.length;
      }),
    [items],
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

  const openItem = openIndex === null ? null : (items?.[openIndex] ?? null);

  const hud = HUD_ENTRIES[(openIndex ?? 0) % HUD_ENTRIES.length];

  /* The lightbox shows the grid's preview straight away and swaps in the
     original once it has loaded, so opening never waits on a large file.
     Holding the last loaded src (rather than clearing it on close) means
     reopening an image already in cache skips the preview entirely. */
  const [fullSrc, setFullSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!openItem) return;

    let cancelled = false;
    const target = openItem.full;
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
  }, [openItem]);

  return (
    <main className="collection">
      <PageHeader title={title} />
      {notice ? (
        <p className="collection__notice" role="status">
          {notice}
        </p>
      ) : null}

      <ul className="collection__grid">
        {items
          ? items.map((item, index) => (
              <li key={item.full} className="collection__item">
                <button
                  type="button"
                  className="collection__open"
                  onClick={() => setOpenIndex(index)}
                  aria-label={`View ${title} ${index + 1} full screen`}
                >
                  <img
                    className="collection__image"
                    src={item.preview}
                    alt={`${title} ${index + 1}`}
                    loading="lazy"
                    decoding="async"
                  />
                </button>
                <a
                  className="collection__download"
                  href={item.download}
                  download={item.downloadName}
                  aria-label={`Download ${title} ${index + 1}`}
                >
                  <DownloadIcon />
                </a>
              </li>
            ))
          : PLACEHOLDER_POSITIONS.map((position) => (
              <li key={position} className="collection__item">
                <img
                  className="collection__image"
                  src={gatesArtwork}
                  alt=""
                  style={{ objectPosition: position }}
                />
              </li>
            ))}
      </ul>

      {/* Portalled to the body: .collection runs a transform animation, which
          makes it a containing block for fixed-position descendants. */}
      {openItem && items
        ? createPortal(
            <div
              className="lightbox"
              role="dialog"
              aria-modal="true"
              aria-label={`${title} ${(openIndex ?? 0) + 1} of ${items.length}`}
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

              {items.length > 1 ? (
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
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      focusable="false"
                    >
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
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      focusable="false"
                    >
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
                    {slug}_{String((openIndex ?? 0) + 1).padStart(3, "0")}
                  </span>
                  <span className="lightbox__slugTag" lang={hud.lang}>
                    {hud.tag}
                  </span>
                </figcaption>

                <img
                  key={openItem.full}
                  className={`lightbox__image${
                    fullSrc === openItem.full ? "" : " is-loading"
                  }`}
                  src={
                    fullSrc === openItem.full ? openItem.full : openItem.preview
                  }
                  alt={`${title} ${(openIndex ?? 0) + 1}`}
                />

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
                    {String(items.length).padStart(3, "0")}
                  </span>
                </p>

                <a
                  className="lightbox__download"
                  href={openItem.download}
                  download={openItem.downloadName}
                  aria-label={`Download ${title} ${(openIndex ?? 0) + 1}`}
                >
                  <DownloadIcon />
                  <span className="lightbox__downloadLabel">
                    <span aria-hidden="true">保存</span> save
                  </span>
                </a>
              </div>
            </div>,
            document.body,
          )
        : null}
    </main>
  );
}
