import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CART_MAX_PER_ITEM } from "./constants";

export type CartLine = {
  productId: string;
  slug: string;
  title: string;
  priceCents: number;
  currency: string;
  imageUrl: string | null;
  quantity: number;
};

/* v2: lines used to be keyed by printId, which no longer exists. Bumping
   the key drops a stale cart instead of trying to migrate one. */
const STORAGE_KEY = "coyv.cart.v2";
const MAX_PER_ITEM = CART_MAX_PER_ITEM;

function readStoredCart(): CartLine[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    /* The cart is only a convenience; the server re-prices everything at
       checkout, so a stale or tampered entry cannot affect what is charged. */
    return parsed.filter(
      (line): line is CartLine =>
        typeof line === "object" &&
        line !== null &&
        typeof (line as CartLine).productId === "string" &&
        typeof (line as CartLine).quantity === "number",
    );
  } catch {
    return [];
  }
}

type CartValue = {
  lines: CartLine[];
  itemCount: number;
  subtotalCents: number;
  currency: string;
  add: (line: Omit<CartLine, "quantity">, quantity?: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
};

const CartContext = createContext<CartValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(readStoredCart);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  }, [lines]);

  const add = useCallback((line: Omit<CartLine, "quantity">, quantity = 1) => {
    setLines((current) => {
      const existing = current.find((entry) => entry.productId === line.productId);
      if (!existing) {
        return [...current, { ...line, quantity: Math.min(quantity, MAX_PER_ITEM) }];
      }
      return current.map((entry) =>
        entry.productId === line.productId
          ? { ...entry, ...line, quantity: Math.min(entry.quantity + quantity, MAX_PER_ITEM) }
          : entry,
      );
    });
  }, []);

  const setQuantity = useCallback((productId: string, quantity: number) => {
    setLines((current) =>
      quantity <= 0
        ? current.filter((entry) => entry.productId !== productId)
        : current.map((entry) =>
            entry.productId === productId
              ? { ...entry, quantity: Math.min(quantity, MAX_PER_ITEM) }
              : entry,
          ),
    );
  }, []);

  const remove = useCallback((productId: string) => {
    setLines((current) => current.filter((entry) => entry.productId !== productId));
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<CartValue>(
    () => ({
      lines,
      itemCount: lines.reduce((total, line) => total + line.quantity, 0),
      subtotalCents: lines.reduce((total, line) => total + line.priceCents * line.quantity, 0),
      currency: lines[0]?.currency ?? "usd",
      add,
      setQuantity,
      remove,
      clear,
    }),
    [lines, add, setQuantity, remove, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartValue {
  const value = useContext(CartContext);
  if (!value) throw new Error("useCart must be used inside a CartProvider");
  return value;
}
