import Stripe from 'stripe'
import { env } from '../env.ts'

/* No explicit apiVersion: the account's pinned version is used, which keeps
   this in step with the dashboard and with the webhook payloads Stripe sends. */
export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  appInfo: { name: 'coyv', version: '1.0.0' },
})
