import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useCart } from "../cart/CartContext";
import { api, type Product } from "../lib/api";
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

export default function Vault() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  /* Which image each card is showing. Keyed by product rather than held per
     card so the list stays a single flat render with no child component. */
  const [shown, setShown] = useState<Record<string, number>>({});
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
      });
      setJustAdded(product.id);
    },
    [cart],
  );

  useEffect(() => {
    if (!justAdded) return;
    const timer = setTimeout(() => setJustAdded(null), 1600);
    return () => clearTimeout(timer);
  }, [justAdded]);

  return (
    <main className="collection">
      <PageHeader title="vault" />

      {cart.itemCount > 0 ? (
        <div className="vault__cartBar">
          <span>
            {cart.itemCount} {cart.itemCount === 1 ? "print" : "prints"} ·{" "}
            {formatMoney(cart.subtotalCents, cart.currency)}
          </span>
          <Link className="vault__checkoutLink" to="/checkout">
            checkout
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
        <ul className="vault__grid">
          {products.map((product) => {
            const index = Math.min(shown[product.id] ?? 0, Math.max(product.images.length - 1, 0));
            const cover = product.images[index];
            const isSubscription = product.kind === "subscription";
            const inCart = cart.lines.find((line) => line.productId === product.id);

            return (
              <li key={product.id} className="vault__card">
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
                      {product.images.map((image, position) => (
                        <li key={image.id}>
                          <button
                            type="button"
                            className="vault__thumb"
                            aria-label={`view image ${position + 1} of ${product.images.length}`}
                            aria-current={position === index}
                            onClick={() =>
                              setShown((current) => ({ ...current, [product.id]: position }))
                            }
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
                      ))}
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
                    {isSubscription ? (
                      product.available ? (
                        <Link className="vault__add" to={`/subscribe/${product.slug}`}>
                          subscribe
                        </Link>
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
    </main>
  );
}
