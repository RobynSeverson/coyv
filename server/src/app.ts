import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { type Express } from 'express'
import helmet from 'helmet'
import mongoose from 'mongoose'
import { env } from './env.ts'
import { errorHandler, notFoundHandler } from './middleware/error.ts'
import { adminAuthRouter } from './routes/adminAuth.ts'
import { adminMemoriesRouter } from './routes/adminMemories.ts'
import { adminRouter } from './routes/adminProducts.ts'
import { checkoutRouter } from './routes/checkout.ts'
import { memoriesRouter } from './routes/memories.ts'
import { printsRouter, productsRouter } from './routes/products.ts'
import { tasksRouter } from './routes/tasks.ts'
import { webhookRouter } from './routes/webhook.ts'

export function createApp(): Express {
  const app = express()

  /* Behind nginx in the compose stack, so req.ip must come from the
     forwarded header for the login throttle to be meaningful. */
  app.set('trust proxy', 1)
  app.disable('x-powered-by')

  app.use(
    helmet({
      /* The API serves JSON only; CSP for the site itself is nginx's job. */
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  )

  app.use(
    cors({
      origin: env.PUBLIC_SITE_URL,
      credentials: true,
    }),
  )

  /* Mounted before the JSON parser: signature verification needs raw bytes. */
  app.use('/api/stripe/webhook', webhookRouter)

  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())

  app.get('/api/health', async (_req, res) => {
    /* `readyState` on its own is misleading on a platform that freezes the
       process between requests: the socket can read as "connecting" while
       queries still succeed, because the driver reconnects and replays them.
       Pinging is the only answer that matches what a request would actually
       get, and the timeout keeps a hung socket from hanging the check. */
    const timer: { id?: NodeJS.Timeout } = {}
    try {
      const { db } = mongoose.connection
      if (!db) throw new Error('no database connection')

      await Promise.race([
        db.admin().command({ ping: 1 }),
        new Promise((_resolve, reject) => {
          timer.id = setTimeout(() => reject(new Error('ping timed out')), 2000)
        }),
      ])
      res.json({ ok: true, db: 'up' })
    } catch {
      res.status(503).json({ ok: false, db: 'down' })
    } finally {
      if (timer.id) clearTimeout(timer.id)
    }
  })

  app.use('/api/products', productsRouter)
  /* Deprecated alias from before subscriptions existed; lists prints only. */
  app.use('/api/prints', printsRouter)
  app.use('/api/memories', memoriesRouter)
  app.use('/api/checkout', checkoutRouter)
  app.use('/api/admin/auth', adminAuthRouter)
  /* Driven by a scheduler with a shared secret, not by the admin session. */
  app.use('/api/tasks', tasksRouter)
  /* Mounted before the catch-all admin router so its own paths win. */
  app.use('/api/admin/memories', adminMemoriesRouter)
  app.use('/api/admin', adminRouter)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
