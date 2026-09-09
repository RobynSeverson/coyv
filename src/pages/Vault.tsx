import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useCart } from "../cart/CartContext";
import { api, type Print } from "../lib/api";
import { formatMoney } from "../lib/money";
import "./Collection.css";
import "./Vault.css";

export default function Vault() {
  const [prints, setPrints] = useState<Print[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const cart = useCart();

  useEffect(() => {
    const controller = new AbortController();

    api
      .listPrints()
      .then(({ prints: loaded }) => {
        if (!controller.signal.aborted) setPrints(loaded);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Could not load prints");
        setPrints([]);
      });

    return () => controller.abort();
  }, []);

  /* The "added" flash is per-print and self-clearing, so the button can
     confirm the click without needing a toast system. */
  const addToCart = useCallback(
    (print: Print) => {
      cart.add({
        printId: print.id,
        slug: print.slug,
        title: print.title,
        priceCents: print.priceCents,
        currency: print.currency,
        imageUrl: print.images[0]?.url ?? null,
      });
      setJustAdded(print.id);
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
      <header className="collection__header">
        <h1 className="collection__title">vault</h1>
        <p className="collection__blurb">save me from salvation</p>
      </header>

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

      {prints === null ? (
        <ul className="collection__grid">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <li key={index} className="collection__item vault__skeleton" />
          ))}
        </ul>
      ) : prints.length === 0 ? (
        !error ? <p className="vault__notice">Nothing on the wall just yet.</p> : null
      ) : (
        <ul className="vault__grid">
          {prints.map((print) => {
            const cover = print.images[0];
            const inCart = cart.lines.find((line) => line.printId === print.id);

            return (
              <li key={print.id} className="vault__card">
                <div className="vault__frame">
                  {cover ? (
                    <img
                      className="vault__image"
                      src={cover.url}
                      alt={cover.alt}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="vault__imagePlaceholder" aria-hidden="true" />
                  )}
                  {print.soldOut ? <span className="vault__flag">sold out</span> : null}
                </div>

                <div className="vault__body">
                  <h2 className="vault__name">{print.title}</h2>
                  {print.description ? (
                    <p className="vault__description">{print.description}</p>
                  ) : null}

                  <div className="vault__row">
                    <span className="vault__price">
                      {formatMoney(print.priceCents, print.currency)}
                    </span>
                    <button
                      type="button"
                      className="vault__add"
                      disabled={print.soldOut}
                      onClick={() => addToCart(print)}
                    >
                      {print.soldOut
                        ? "sold out"
                        : justAdded === print.id
                          ? "added"
                          : inCart
                            ? `in cart (${inCart.quantity})`
                            : "add to cart"}
                    </button>
                  </div>

                  {print.stock !== null && print.stock > 0 && print.stock <= 5 ? (
                    <p className="vault__stock">only {print.stock} left</p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
