import { API_BASE_URL } from "../config";

export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  /* FormData is sent as-is so the browser can set the multipart boundary. */
  formData?: FormData;
  signal?: AbortSignal;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, formData, signal } = options;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api${path}`, {
      method,
      /* The admin session is an httpOnly cookie, so every call must carry it. */
      credentials: "include",
      signal,
      ...(formData
        ? { body: formData }
        : body !== undefined
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
    });
  } catch (cause) {
    /* An aborted request is the caller unmounting, not a failure to report. */
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError(0, "Could not reach the server. Please try again.", cause);
  }

  if (response.status === 204) return undefined as T;

  /* A proxy or load balancer that cannot reach the API answers with HTML or
     plain text, so the body is only trusted as JSON when it parses as JSON. */
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : response.status >= 502 && response.status <= 504
          ? "The gallery is offline for a moment. Please try again shortly."
          : response.statusText || `Request failed (${response.status})`;
    const details =
      payload && typeof payload === "object" && "details" in payload
        ? (payload as { details: unknown }).details
        : undefined;
    throw new ApiError(response.status, message, details);
  }

  /* A 2xx that is not JSON means something other than the API answered. */
  if (text && payload === null) {
    throw new ApiError(response.status, "Unexpected response from the server.");
  }

  return payload as T;
}

export type ProductImage = {
  id: string;
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
};

export type ProductKind = "print" | "subscription";

export type Product = {
  id: string;
  kind: ProductKind;
  slug: string;
  title: string;
  description: string;
  priceCents: number;
  currency: string;
  /* null for a one-off print, "month" for a subscription */
  interval: string | null;
  stock: number | null;
  soldOut: boolean;
  /* false while a subscription is still waiting on its Stripe price */
  available: boolean;
  images: ProductImage[];
};

export type AdminProduct = Product & {
  published: boolean;
  sortOrder: number;
  stripePriceId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused";

export type Subscription = {
  id: string;
  productId: string;
  slug: string;
  title: string;
  status: SubscriptionStatus;
  unitAmountCents: number;
  currency: string;
  interval: string;
  email: string | null;
  name: string | null;
  currentPeriodEnd: string | null;
  canceledAt: string | null;
  lastPaymentError: string | null;
  createdAt: string;
};

export type OrderItem = {
  productId: string;
  slug: string;
  title: string;
  unitAmountCents: number;
  quantity: number;
};

export type OrderStatus =
  | "pending"
  | "processing"
  | "paid"
  | "failed"
  | "canceled"
  | "refunded";

export type Order = {
  id: string;
  status: OrderStatus;
  currency: string;
  amountTotalCents: number;
  email: string | null;
  shippingName: string | null;
  shippingAddress: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  } | null;
  items: OrderItem[];
  lastPaymentError: string | null;
  createdAt: string;
  paidAt: string | null;
};

export type Memory = {
  id: string;
  title: string;
  alt: string;
  /* small webp for the grid */
  previewUrl: string;
  /* untouched original, only fetched when the lightbox opens */
  url: string;
  /* the original signed to come back as a file save */
  downloadUrl: string;
  width: number | null;
  height: number | null;
  downloadName: string;
};

export type AdminMemory = Memory & {
  published: boolean;
  sortOrder: number;
  bytes: number;
  contentType: string;
  createdAt: string;
  updatedAt: string;
};

type MemoryInput = {
  title: string;
  alt: string;
  published: boolean;
  sortOrder: number;
};

export type Admin = { id: string; email: string; displayName: string };

type ProductInput = {
  title: string;
  description: string;
  priceCents: number;
  stock: number | null;
  published: boolean;
  sortOrder: number;
};

type NewProductInput = ProductInput & { kind: ProductKind };

export const api = {
  listProducts: () => request<{ products: Product[] }>("/products"),

  getProduct: (slug: string) =>
    request<{ product: Product }>(`/products/${encodeURIComponent(slug)}`),

  createPaymentIntent: (payload: {
    items: { productId: string; quantity: number }[];
    orderId?: string;
  }) =>
    request<{
      orderId: string;
      clientSecret: string;
      amountTotalCents: number;
      currency: string;
    }>("/checkout/intent", { method: "POST", body: payload }),

  /* Subscriptions are confirmed by the same Payment Element as the cart: the
     secret this returns belongs to the first invoice's PaymentIntent. */
  startSubscription: (payload: { productId: string; email: string; name?: string }) =>
    request<{
      clientSecret: string;
      amountTotalCents: number;
      currency: string;
      interval: string;
    }>("/checkout/subscription", { method: "POST", body: payload }),

  lookupSubscription: (paymentIntent: string, clientSecret: string) =>
    request<{ subscription: Subscription; paymentStatus: string }>(
      `/checkout/subscriptions/lookup?payment_intent=${encodeURIComponent(paymentIntent)}` +
        `&payment_intent_client_secret=${encodeURIComponent(clientSecret)}`,
    ),

  lookupOrder: (paymentIntent: string, clientSecret: string) =>
    request<{ order: Order; paymentStatus: string }>(
      `/checkout/orders/lookup?payment_intent=${encodeURIComponent(paymentIntent)}` +
        `&payment_intent_client_secret=${encodeURIComponent(clientSecret)}`,
    ),

  listMemories: (signal?: AbortSignal) =>
    request<{ memories: Memory[] }>("/memories", { signal }),

  admin: {
    me: () => request<{ admin: Admin | null }>("/admin/auth/me"),

    login: (email: string, password: string) =>
      request<{ admin: Admin }>("/admin/auth/login", {
        method: "POST",
        body: { email, password },
      }),

    logout: () => request<{ ok: true }>("/admin/auth/logout", { method: "POST" }),

    listProducts: () => request<{ products: AdminProduct[] }>("/admin/products"),

    createProduct: (payload: NewProductInput) =>
      request<{ product: AdminProduct }>("/admin/products", {
        method: "POST",
        body: payload,
      }),

    updateProduct: (id: string, payload: Partial<ProductInput>) =>
      request<{ product: AdminProduct }>(`/admin/products/${id}`, {
        method: "PATCH",
        body: payload,
      }),

    deleteProduct: (id: string) =>
      request<{ deleted?: boolean; archived?: boolean; product?: AdminProduct }>(
        `/admin/products/${id}`,
        { method: "DELETE" },
      ),

    uploadImages: (id: string, files: File[]) => {
      const formData = new FormData();
      for (const file of files) formData.append("images", file);
      return request<{ product: AdminProduct }>(`/admin/products/${id}/images`, {
        method: "POST",
        formData,
      });
    },

    deleteImage: (id: string, imageId: string) =>
      request<{ product: AdminProduct }>(`/admin/products/${id}/images/${imageId}`, {
        method: "DELETE",
      }),

    listOrders: () => request<{ orders: Order[]; total: number }>("/admin/orders"),

    listSubscriptions: () =>
      request<{ subscriptions: Subscription[]; total: number }>("/admin/subscriptions"),

    listMemories: () => request<{ memories: AdminMemory[] }>("/admin/memories"),

    /* Every memory mutation answers with the whole list, so the panel never
       has to guess how a change reordered things. */
    uploadMemories: (files: File[]) => {
      const formData = new FormData();
      for (const file of files) formData.append("images", file);
      return request<{ memories: AdminMemory[] }>("/admin/memories", {
        method: "POST",
        formData,
      });
    },

    updateMemory: (id: string, payload: Partial<MemoryInput>) =>
      request<{ memories: AdminMemory[] }>(`/admin/memories/${id}`, {
        method: "PATCH",
        body: payload,
      }),

    deleteMemory: (id: string) =>
      request<{ deleted: boolean; memories: AdminMemory[] }>(
        `/admin/memories/${id}`,
        { method: "DELETE" },
      ),

    reorderMemories: (memoryIds: string[]) =>
      request<{ memories: AdminMemory[] }>("/admin/memories/order/all", {
        method: "PATCH",
        body: { memoryIds },
      }),
  },
};
