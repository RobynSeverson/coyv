import { API_BASE_URL } from "../config";
import type { RichContent } from "../../server/src/lib/richContent";
import type { ContactType } from "../../server/src/lib/homeContact";

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
  description: RichContent;
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
  /* True once the subscriber has cancelled but the month they already paid
     for has not run out yet. */
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  lastPaymentError: string | null;
  createdAt: string;
};

/* What the self-service manage page sees: the subscription plus the address
   it ships to, and whether it is still in a state the subscriber can act on. */
export type ManagedSubscription = Subscription & {
  shippingName: string | null;
  shippingAddress: ShippingAddress | null;
  manageable: boolean;
};

export type FulfillmentStatus = "pending" | "sent";
export type FulfillmentKind = "order" | "subscription";

/* One parcel to post: a one-off order, or one month of a subscription. */
export type Fulfillment = {
  id: string;
  kind: FulfillmentKind;
  orderId: string | null;
  subscriptionId: string | null;
  /* e.g. "September 2026" for a subscription; empty for an order */
  periodLabel: string;
  title: string;
  items: { title: string; quantity: number }[];
  email: string | null;
  shippingName: string | null;
  shippingAddress: ShippingAddress | null;
  status: FulfillmentStatus;
  sentAt: string | null;
  trackingNumber: string;
  notes: string;
  createdAt: string;
  /* Computed by the server so the admin list, the digest email and its deep
     link all agree on what "past due" means. */
  pastDue: boolean;
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

export type ShippingAddress = {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export type OrderType = "order" | "subscription";

export type Order = {
  id: string;
  /* The short reference quoted in the confirmation email and shown in the
     admin list, derived from the id rather than stored. */
  number: string;
  /* A one-off purchase, or one month of a subscription. Both are money taken
     in, so the admin list shows them together. */
  type: OrderType;
  status: OrderStatus;
  currency: string;
  amountTotalCents: number;
  email: string | null;
  shippingName: string | null;
  shippingAddress: ShippingAddress | null;
  items: OrderItem[];
  /* e.g. "September 2026" for a subscription charge; empty for an order. */
  periodLabel: string;
  lastPaymentError: string | null;
  createdAt: string;
  paidAt: string | null;
};

export type EarningsBucket = "week" | "month" | "year";

export type EarningsRow = {
  key: string;
  label: string;
  startsAt: string;
  orderCents: number;
  subscriptionCents: number;
  totalCents: number;
};

export type Earnings = {
  bucket: EarningsBucket;
  currency: string;
  rows: EarningsRow[];
};

export type MemoryKind = "photo" | "journal";

export type MemoryImage = {
  id: string;
  /* small webp for the list */
  previewUrl: string;
  /* untouched original, only fetched when the lightbox opens */
  url: string;
  /* the original signed to come back as a file save */
  downloadUrl: string;
  downloadName: string;
  width: number | null;
  height: number | null;
};

export type Memory = {
  id: string;
  kind: MemoryKind;
  /* the archive's own name for the file, memory_007, assigned by position */
  slug: string;
  /* extension printed in the corner of a row */
  tag: string;
  title: string;
  alt: string;
  /* Structured editor JSON or legacy markdown. */
  body: RichContent;
  capturedAt: string | null;
  images: MemoryImage[];
};

export type AdminMemory = Memory & {
  published: boolean;
  sortOrder: number;
  bytes: number;
  contentType: string | null;
  createdAt: string;
  updatedAt: string;
};

type MemoryInput = {
  kind: MemoryKind;
  title: string;
  alt: string;
  body: RichContent;
  published: boolean;
  sortOrder: number;
  capturedAt: string | null;
};

export type Admin = { id: string; email: string; displayName: string };

export type HomeImage = {
  id: string;
  url: string;
  width: number;
  height: number;
};
export type HomeShowcase = { image: HomeImage; title: string; url: string; cropX?: number; cropY?: number };
export type HomeNewsPreview = {
  id: string;
  date: string;
  preview: string;
  previewImage: HomeImage | null;
};
export type HomeNews = HomeNewsPreview & { body: RichContent; images: HomeImage[] };
export type HomeContact = { id: string; type?: ContactType; title: string; url: string; icon?: HomeImage | null };
export type HomeContent = {
  revision: number;
  aboutMe: RichContent;
  projects: HomeShowcase[];
  artwork: HomeShowcase[];
  news: HomeNews[];
  contacts: HomeContact[];
};
export type HomePageContent = Omit<HomeContent, "news"> & { news: HomeNewsPreview[] };
export type HomeNewsArticle = Omit<HomeNews, "previewImage">;

type ProductInput = {
  title: string;
  description: RichContent;
  priceCents: number;
  stock: number | null;
  published: boolean;
  sortOrder: number;
};

type NewProductInput = ProductInput & { kind: ProductKind };

export const api = {
  getHome: () => request<{ home: HomePageContent }>("/home"),

  getHomeNews: (id: string) =>
    request<{ news: HomeNewsArticle }>(`/home/news/${encodeURIComponent(id)}`),

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
     secret this returns belongs to the first invoice's PaymentIntent. Prints
     passed as `items` ride on that same first invoice, so a basket holding
     both is paid for once. */
  startSubscription: (payload: {
    productId: string;
    email: string;
    name?: string;
    shippingName: string;
    shippingAddress: ShippingAddress;
    items?: { productId: string; quantity: number }[];
  }) =>
    request<{
      clientSecret: string;
      amountTotalCents: number;
      recurringAmountCents: number;
      currency: string;
      interval: string;
      orderId: string | null;
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

  manage: {
    /* Always resolves, whether or not the address has a subscription — the
       server refuses to confirm which addresses are customers. */
    requestLink: (email: string) =>
      request<{ ok: true }>("/manage/request-link", { method: "POST", body: { email } }),

    redeem: (token: string) =>
      request<{ ok: true; email: string }>("/manage/redeem", {
        method: "POST",
        body: { token },
      }),

    signOut: () => request<{ ok: true }>("/manage/signout", { method: "POST" }),

    list: () =>
      request<{ email: string; subscriptions: ManagedSubscription[] }>("/manage/subscriptions"),

    updateAddress: (
      id: string,
      payload: { shippingName: string; shippingAddress: ShippingAddress },
    ) =>
      request<{ subscription: ManagedSubscription; pendingParcelsUpdated: number }>(
        `/manage/subscriptions/${encodeURIComponent(id)}/address`,
        { method: "PATCH", body: payload },
      ),

    cancel: (id: string) =>
      request<{ subscription: Subscription }>(
        `/manage/subscriptions/${encodeURIComponent(id)}/cancel`,
        { method: "POST" },
      ),

    resume: (id: string) =>
      request<{ subscription: Subscription }>(
        `/manage/subscriptions/${encodeURIComponent(id)}/resume`,
        { method: "POST" },
      ),
  },

  admin: {
    getHome: () => request<{ home: HomeContent }>("/admin/home"),

    saveHome: (home: HomeContent) =>
      request<{ home: HomeContent }>("/admin/home", {
        method: "PUT",
        body: {
          revision: home.revision,
          aboutMe: home.aboutMe,
          projects: home.projects.map(({ image, title, url, cropX, cropY }) => ({ imageId: image.id, title, url, cropX, cropY })),
          artwork: home.artwork.map(({ image, title, url, cropX, cropY }) => ({ imageId: image.id, title, url, cropX, cropY })),
          news: home.news.map(({ id, date, preview, previewImage, body, images }) => ({
            id, date, preview, previewImageId: previewImage?.id ?? null,
            body, imageIds: images.map((image) => image.id),
          })),
          contacts: home.contacts.map(({ id, type, title, url, icon }) => ({ id, type, title, url, iconId: icon?.id ?? null })),
        },
      }),

    resolveHomeImages: (ids: string[]) =>
      request<{ images: HomeImage[] }>("/admin/home/images/resolve", { method: "POST", body: { ids } }),

    uploadHomeImage: (file: File, signal?: AbortSignal) => {
      const formData = new FormData();
      formData.append("image", file);
      return request<{ image: HomeImage }>("/admin/home/images", { method: "POST", formData, signal });
    },

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

    earnings: (bucket: EarningsBucket, buckets = 6) =>
      request<Earnings>(`/admin/earnings?bucket=${bucket}&buckets=${buckets}`),

    listSubscriptions: () =>
      request<{ subscriptions: Subscription[]; total: number }>("/admin/subscriptions"),

    listFulfillments: (status?: FulfillmentStatus) =>
      request<{ fulfillments: Fulfillment[]; total: number; pendingCount: number }>(
        `/admin/fulfillments${status ? `?status=${status}` : ""}`,
      ),

    updateFulfillment: (
      id: string,
      payload: { status?: FulfillmentStatus; trackingNumber?: string; notes?: string },
    ) =>
      request<{ fulfillment: Fulfillment }>(`/admin/fulfillments/${id}`, {
        method: "PATCH",
        body: payload,
      }),

    listMemories: () => request<{ memories: AdminMemory[] }>("/admin/memories"),

    /* Every memory mutation answers with the whole list, so the panel never
       has to guess how a change reordered things. */
    /* `grouped` puts every file in one memory instead of making one memory
       each. It is appended before the files because multer only exposes text
       fields the route has already parsed past. */
    uploadMemories: (files: File[], grouped = false) => {
      const formData = new FormData();
      formData.append("grouped", String(grouped));
      for (const file of files) formData.append("images", file);
      return request<{ memories: AdminMemory[] }>("/admin/memories", {
        method: "POST",
        formData,
      });
    },

    createJournalMemory: (payload: { title: string; body: RichContent }) =>
      request<{ memories: AdminMemory[] }>("/admin/memories/journal", {
        method: "POST",
        body: payload,
      }),

    addMemoryImages: (id: string, files: File[]) => {
      const formData = new FormData();
      for (const file of files) formData.append("images", file);
      return request<{ memories: AdminMemory[] }>(`/admin/memories/${id}/images`, {
        method: "POST",
        formData,
      });
    },

    deleteMemoryImage: (id: string, imageId: string) =>
      request<{ memories: AdminMemory[] }>(
        `/admin/memories/${id}/images/${imageId}`,
        { method: "DELETE" },
      ),

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
