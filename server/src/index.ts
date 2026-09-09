import { createApp } from './app.ts'
import { connectToDatabase, disconnectFromDatabase } from './db.ts'
import { env } from './env.ts'

async function main(): Promise<void> {
  await connectToDatabase()

  const server = createApp().listen(env.PORT, () => {
    console.log(`[api] listening on :${env.PORT} (${env.NODE_ENV})`)
  })

  /* Docker sends SIGTERM on `stop`; draining first means an in-flight
     checkout is not cut off mid-request. */
  const shutdown = (signal: string) => {
    console.log(`[api] ${signal} received, shutting down`)
    server.close(async () => {
      await disconnectFromDatabase()
      process.exit(0)
    })
    setTimeout(() => process.exit(1), 10_000).unref()
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch((error) => {
  console.error('[api] failed to start', error)
  process.exit(1)
})
