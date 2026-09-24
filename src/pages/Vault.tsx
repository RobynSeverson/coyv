import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useCart } from "../cart/CartContext";
import checkoutButton from "../assets/checkoutButton.png";
import { api, type Product } from "../lib/api";
import { copyText } from "../lib/clipboard";
import { trackEvent } from "../lib/analytics";
import { RichText } from "../lib/richText";
import { formatMoney } from "../lib/money";
import PageHeader from "../components/PageHeader";
import "./Collection.css";
import "./Vault.css";

/* Deterrents, not protection: anything the browser renders can be saved by
   someone determined. The control that actually works is upstream — the API
   only ever serves a downscaled display copy, never the print-resolution
   original. This just stops the artwork walking out by accident. */
function blockCapture(event: React.SyntheticEvent) {
  event.preventDefault();
}

/* How many thumbnails the strip shows at once. Past this the strip becomes a
   window onto the images rather than all of them. */
const STRIP_SLOTS = 3;

/* The images under each slot of the strip. Once there are more than the strip
   can hold it wraps, so the last image is followed by the first again and the
   strip never runs out either way. */
function stripWindow(total: number, start: number) {
  if (total <= STRIP_SLOTS) return Array.from({ length: total }, (_, slot) => slot);
  return Array.from({ length: STRIP_SLOTS }, (_, slot) => (start + slot) % total);
}

const ShareIcon = () => (
  <svg
    className="collection__downloadIcon"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M12 16V4.5m0 0 4.25 4.25M12 4.5 7.75 8.75" />
    <path d="M4.5 16.5v2.25a1.25 1.25 0 0 0 1.25 1.25h12.5a1.25 1.25 0 0 0 1.25-1.25V16.5" />
  </svg>
);

export default function Vault() {
  const { slug: linkedSlug } = useParams();
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  /* Which card is showing a note, and what it says. Kept as one value so
     only the card that was shared reports back. */
  const [shareNote, setShareNote] = useState<{ id: string; text: string } | null>(null);
  /* Which image each card is showing, and where its thumbnail strip starts.
     Keyed by product rather than held per card so the list stays a single flat
     render with no child component. */
  const [shown, setShown] = useState<Record<string, number>>({});
  const [strip, setStrip] = useState<Record<string, number>>({});
  const gridRef = useRef<HTMLUListElement | null>(null);
  const cart = useCart();

  useEffect(() => {
    const controller = new AbortController();

    api
      .listProducts()
      .then(({ products: loaded }) => {
        if (!controller.signal.aborted) setProducts(loaded);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Could not load the vault");
        setProducts([]);
      });

    return () => controller.abort();
  }, []);

  /* The "added" flash is per-product and self-clearing, so the button can
     confirm the click without needing a toast system. */
  const addToCart = useCallback(
    (product: Product) => {
      cart.add({
        productId: product.id,
        slug: product.slug,
        title: product.title,
        priceCents: product.priceCents,
        currency: product.currency,
        imageUrl: product.images[0]?.url ?? null,
        kind: product.kind,
      });
      setJustAdded(product.id);
    },
    [cart],
  );

  /* Picking a thumbnail promotes it into the main frame. Picking one at either
     end of the strip also walks the window one step that way, so the image
     just chosen lands in the middle and its neighbours on that side come into
     view — the strip keeps moving instead of dead-ending at its own edge. */
  const selectImage = useCallback((product: Product, position: number, slot: number) => {
    const total = product.images.length;

    setShown((current) => ({ ...current, [product.id]: position }));

    if (total <= STRIP_SLOTS) return;

    const step = slot === STRIP_SLOTS - 1 ? 1 : slot === 0 ? -1 : 0;
    if (step === 0) return;

    setStrip((current) => ({
      ...current,
      [product.id]: ((current[product.id] ?? 0) + step + total) % total,
    }));
  }, []);

  useEffect(() => {
    if (!justAdded) return;
    const timer = setTimeout(() => setJustAdded(null), 1600);
    return () => clearTimeout(timer);
  }, [justAdded]);

  useEffect(() => {
    if (!shareNote) return;
    const clear = setTimeout(() => setShareNote(null), 2400);
    return () => clearTimeout(clear);
  }, [shareNote]);

  /* Sharing hands over the deep link rather than the page, so the recipient
     lands on the print itself. Phones and tablets get their own share sheet;
     on desktop the link goes to the clipboard instead, and the button says so,
     because a control that looks like it did nothing reads as broken.

     Both calls are made in the tap's own tick. Safari only allows the sheet
     and the clipboard while the user activation lasts, and awaiting the sheet
     outlives it — a copy attempted after a failed share is always denied. */
  const shareProduct = useCallback(async (product: Product) => {
    const url = `${window.location.origin}/vault/${product.slug}`;
    const handheld = window.matchMedia("(pointer: coarse)").matches;

    const copied = copyText(url);

    /* URL only: a title or text alongside it is pasted in as a second line by
       Messages and Mail, so the recipient gets the product name repeated
       above the link they were sent. */
    const sheet = handheld ? navigator.share?.({ url }) : undefined;

    if (sheet) {
      try {
        await sheet;
        trackEvent("product_share", {
          product_slug: product.slug,
          product_kind: product.kind,
          share_method: "native",
        });
        return;
      } catch (error) {
        /* Dismissing the sheet rejects, and is not a failure. The link is on
           the clipboard either way, so say nothing. */
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    if (await copied) {
      setShareNote({ id: product.id, text: "link copied" });
      trackEvent("product_share", {
        product_slug: product.slug,
        product_kind: product.kind,
        share_method: "clipboard",
      });
    } else {
      setShareNote({ id: product.id, text: "copy failed" });
    }
  }, []);

  /* A deep link lands on the full vault and then travels to the print, so the
     visitor can see what else is on the wall rather than arriving at a card
     with no context. Handled once per slug: re-running on every render would
     drag the page back every time a thumbnail was picked. */
  const linkHandled = useRef<string | null>(null);

  useEffect(() => {
    if (!linkedSlug || !products) return;
    if (linkHandled.current === linkedSlug) return;
    linkHandled.current = linkedSlug;

    const target = products.find(
      (product) => product.slug.toLowerCase() === linkedSlug.toLowerCase(),
    );

    /* A link to something that has since been taken down still lands on the
       vault rather than on an empty page. */
    if (!target) {
      navigate("/vault", { replace: true });
      return;
    }

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    gridRef.current?.querySelector(`[data-product="${target.slug}"]`)?.scrollIntoView({
      block: "center",
      behavior: still ? "auto" : "smooth",
    });
  }, [linkedSlug, products, navigate]);

  return (
    <main className="collection">
      <PageHeader title="vault" />

      {cart.itemCount > 0 ? (
        <div className="vault__cartBar">
          <span>
            {cart.itemCount} {cart.itemCount === 1 ? "fragment" : "fragments"} ·{" "}
            {formatMoney(cart.subtotalCents, cart.currency)}
          </span>
          <Link className="vault__checkoutLink" to="/checkout" aria-label="checkout">
            <img className="vault__checkoutMark" src={checkoutButton} alt="" />
          </Link>
        </div>
      ) : null}

      {error ? <p className="vault__notice">{error}</p> : null}

      {products === null ? (
        <ul className="collection__grid">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <li key={index} className="collection__item vault__skeleton" />
          ))}
        </ul>
      ) : products.length === 0 ? (
        !error ? <p className="vault__notice">Nothing on the wall just yet.</p> : null
      ) : (
        <ul className="vault__grid" ref={gridRef}>
          {products.map((product) => {
            const index = Math.min(shown[product.id] ?? 0, Math.max(product.images.length - 1, 0));
            const cover = product.images[index];
            const isSubscription = product.kind === "subscription";
            const inCart = cart.lines.find((line) => line.productId === product.id);
            const isLinked = product.slug.toLowerCase() === linkedSlug?.toLowerCase();

            return (
              <li
                key={product.id}
                className={`vault__card${isLinked ? " vault__card--linked" : ""}`}
                data-product={product.slug}
              >
                <h2 className="vault__name">{product.title}</h2>

                <div className="vault__frame">
                  {cover ? (
                    <img
                      className="vault__image"
                      src={cover.url}
                      alt={cover.alt}
                      /* The frame is a fixed window, but the intrinsic size
                         still lets the browser decode without a reflow. */
                      width={cover.width ?? undefined}
                      height={cover.height ?? undefined}
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                      onContextMenu={blockCapture}
                      onDragStart={blockCapture}
                    />
                  ) : (
                    <div className="vault__imagePlaceholder" aria-hidden="true" />
                  )}
                  {/* Sits over the artwork so a right-click or a long-press
                      lands on an empty element instead of the image. */}
                  {cover ? <span className="vault__guard" aria-hidden="true" /> : null}
                  {isSubscription ? (
                    <span className="vault__flag vault__flag--plan">monthly</span>
                  ) : product.soldOut ? (
                    <span className="vault__flag">sold out</span>
                  ) : null}
                </div>

                {product.images.length > 1 ? (
                  <>
                    <ul className="vault__thumbs">
                      {stripWindow(product.images.length, strip[product.id] ?? 0).map(
                        (position, slot) => {
                          const image = product.images[position];

                          return (
                            <li key={image.id}>
                              <button
                                type="button"
                                className="vault__thumb"
                                aria-label={`view image ${position + 1} of ${product.images.length}`}
                                aria-current={position === index}
                                onClick={() => selectImage(product, position, slot)}
                              >
                                <img
                                  className="vault__thumbImage"
                                  src={image.url}
                                  alt=""
                                  loading="lazy"
                                  decoding="async"
                                  draggable={false}
                                  onContextMenu={blockCapture}
                                  onDragStart={blockCapture}
                                />
                              </button>
                            </li>
                          );
                        },
                      )}
                    </ul>
                    <p className="vault__counter">
                      {index + 1}/{product.images.length}
                    </p>
                  </>
                ) : null}

                <div className="vault__body">
                  <p className="vault__price">
                    {formatMoney(product.priceCents, product.currency)}
                    {isSubscription ? <span className="vault__interval"> / month</span> : null}
                  </p>

                  <RichText className="vault__description" value={product.description} />

                  {isSubscription ? (
                    <p className="vault__stock">a new print every month · cancel anytime</p>
                  ) : product.stock !== null && product.stock > 0 && product.stock <= 5 ? (
                    <p className="vault__stock">only {product.stock} left</p>
                  ) : null}

                  <div className="vault__row">
                    <button
                      type="button"
                      className="vault__share"
                      aria-label={`Share ${product.title}`}
                      onClick={() => void shareProduct(product)}
                    >
                      <ShareIcon />
                      <span className="vault__shareLabel">
                        {shareNote?.id === product.id ? shareNote.text : "share"}
                      </span>
                    </button>

                    {isSubscription ? (
                      product.available ? (
                        <button
                          type="button"
                          className="vault__add"
                          onClick={() => addToCart(product)}
                        >
                          {justAdded === product.id
                            ? "added"
                            : inCart
                              ? "in cart"
                              : "add to cart"}
                        </button>
                      ) : (
                        <span className="vault__add vault__add--disabled">unavailable</span>
                      )
                    ) : (
                      <button
                        type="button"
                        className="vault__add"
                        disabled={product.soldOut}
                        onClick={() => addToCart(product)}
                      >
                        {product.soldOut
                          ? "sold out"
                          : justAdded === product.id
                            ? "added"
                            : inCart
                              ? `in cart (${inCart.quantity})`
                              : "add to cart"}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Sits outside the catalogue branches so there is a way to write in
          even when the wall is empty or the load failed. */}
      <footer className="vault__footer">
        <a className="vault__contact" href="mailto:contact@coyvcastle.com">
          contact
        </a>
      </footer>
    </main>
  );
}
