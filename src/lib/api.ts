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

export type PrintImage = {
  id: string;
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
};

export type Print = {
  id: string;
  slug: string;
  title: string;
  description: string;
  priceCents: number;
  currency: string;
  stock: number | null;
  soldOut: boolean;
  images: PrintImage[];
};

export type AdminPrint = Print & {
  published: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type OrderItem = {
  printId: string;
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

export type Admin = { id: string; email: string; displayName: string };

type PrintInput = {
  title: string;
  description: string;
  priceCents: number;
  stock: number | null;
  published: boolean;
  sortOrder: number;
};

export const api = {
  listPrints: () => request<{ prints: Print[] }>("/prints"),

  getPrint: (slug: string) =>
    request<{ print: Print }>(`/prints/${encodeURIComponent(slug)}`),

  createPaymentIntent: (payload: {
    items: { printId: string; quantity: number }[];
    orderId?: string;
  }) =>
    request<{
      orderId: string;
      clientSecret: string;
      amountTotalCents: number;
      currency: string;
    }>("/checkout/intent", { method: "POST", body: payload }),

  lookupOrder: (paymentIntent: string, clientSecret: string) =>
    request<{ order: Order; paymentStatus: string }>(
      `/checkout/orders/lookup?payment_intent=${encodeURIComponent(paymentIntent)}` +
        `&payment_intent_client_secret=${encodeURIComponent(clientSecret)}`,
    ),

  admin: {
    me: () => request<{ admin: Admin | null }>("/admin/auth/me"),

    login: (email: string, password: string) =>
      request<{ admin: Admin }>("/admin/auth/login", {
        method: "POST",
        body: { email, password },
      }),

    logout: () => request<{ ok: true }>("/admin/auth/logout", { method: "POST" }),

    listPrints: () => request<{ prints: AdminPrint[] }>("/admin/prints"),

    createPrint: (payload: PrintInput) =>
      request<{ print: AdminPrint }>("/admin/prints", {
        method: "POST",
        body: payload,
      }),

    updatePrint: (id: string, payload: Partial<PrintInput>) =>
      request<{ print: AdminPrint }>(`/admin/prints/${id}`, {
        method: "PATCH",
        body: payload,
      }),

    deletePrint: (id: string) =>
      request<{ deleted?: boolean; archived?: boolean }>(`/admin/prints/${id}`, {
        method: "DELETE",
      }),

    uploadImages: (id: string, files: File[]) => {
      const formData = new FormData();
      for (const file of files) formData.append("images", file);
      return request<{ print: AdminPrint }>(`/admin/prints/${id}/images`, {
        method: "POST",
        formData,
      });
    },

    deleteImage: (id: string, imageId: string) =>
      request<{ print: AdminPrint }>(`/admin/prints/${id}/images/${imageId}`, {
        method: "DELETE",
      }),

    listOrders: () => request<{ orders: Order[]; total: number }>("/admin/orders"),
  },
};
