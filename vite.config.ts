import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { imagetools } from 'vite-imagetools'

// https://vite.dev/config/
export default defineConfig({
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
})
