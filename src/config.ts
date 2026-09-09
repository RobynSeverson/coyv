/* Empty in dev and in the Docker image, where nginx (or the Vite dev proxy)
   forwards /api to the server on the same origin. Set it only when the API
   lives on a different host. */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ""

export const STRIPE_PUBLISHABLE_KEY =
  import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? ""

/* The admin panel is unlinked from anywhere in the UI; you have to know the
   URL. Overridable at build time so the path is not baked into the repo. */
export const ADMIN_PATH = import.meta.env.VITE_ADMIN_PATH ?? "/studio-back-door"
