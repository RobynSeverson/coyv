import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { imagetools } from 'vite-imagetools'

/* Production ships live payments, always. `VITE_*` is inlined at build time, so
   a test key baked into the bundle cannot be corrected by any AWS setting, and
   it fails silently: Stripe simply refuses to confirm a live client_secret with
   a test-mode key, with nothing logged anywhere in our infrastructure. That has
   taken checkout down once already, so a production build refuses to start
   rather than let a non-live key through. */
function assertLiveStripeKey(command: string, mode: string) {
  /* Only the build produces a bundle, and only a bundle can carry the wrong
     key into production. `vite preview` also runs in production mode but just
     serves whatever is already in dist/, so gating it there would block a
     local check for no safety gain. */
  if (command !== 'build' || mode !== 'production') return

  const key = loadEnv(mode, process.cwd(), 'VITE_').VITE_STRIPE_PUBLISHABLE_KEY

  if (!key) {
    throw new Error(
      'VITE_STRIPE_PUBLISHABLE_KEY is not set, so the production build would ' +
        'ship without Stripe. See DEPLOYMENT.md for how to recover the live ' +
        'key from the deployed bundle.',
    )
  }

  if (!key.startsWith('pk_live_')) {
    throw new Error(
      `VITE_STRIPE_PUBLISHABLE_KEY is "${key.slice(0, 8)}…", not a pk_live_ ` +
        'key. Production must always be in live mode. The root .env holds a ' +
        'test key for local work; see DEPLOYMENT.md for how to supply the ' +
        'live one.',
    )
  }
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  assertLiveStripeKey(command, mode)

  return {
    plugins: [react(), imagetools()],
    server: {
      /* Same-origin in dev, so the admin session cookie (SameSite=Strict) works
         exactly as it does behind nginx in production. */
      proxy: {
        '/api': {
          target: process.env.VITE_DEV_API_TARGET ?? 'http://localhost:4000',
          changeOrigin: false,
        },
      },
    },
  }
})
