import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'

async function listen(server: Server, port: number) {
  server.listen(port, '0.0.0.0')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return `http://localhost:${address.port}`
}

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

/* A local object-store double keeps tests off real S3, while exercising the
   real upload, signing, preview generation, Mongo persistence and auth paths. */
export async function startHomeFixture(options: { apiPort?: number; imagePort?: number } = {}) {
  const mongoUri = process.env.HOME_TEST_MONGODB_URI
  assert.ok(mongoUri, 'Set HOME_TEST_MONGODB_URI to an isolated local test Mongo')
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(mongoUri).hostname), 'Tests require local Mongo')
  const database = `coyv-home-test-${randomUUID()}`
  const objects = new Map<string, { bytes: Buffer; type: string }>()
  const imageServer = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    if (req.method === 'PUT') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      objects.set(path, { bytes: Buffer.concat(chunks), type: String(req.headers['content-type'] ?? 'application/octet-stream') })
      res.writeHead(200).end()
    } else if (req.method === 'DELETE') {
      objects.delete(path)
      res.writeHead(204).end()
    } else {
      const object = objects.get(path)
      if (!object) res.writeHead(404).end()
      else res.writeHead(200, { 'Content-Type': object.type }).end(object.bytes)
    }
  })
  const imageUrl = await listen(imageServer, options.imagePort ?? 0)
  const secret = randomBytes(32).toString('hex')
  Object.assign(process.env, {
    NODE_ENV: 'test',
    MONGODB_URI: mongoUri,
    MONGODB_DB_NAME: database,
    JWT_SECRET: secret,
    STRIPE_SECRET_KEY: 'sk_test_local_home_fixture',
    STRIPE_WEBHOOK_SECRET: 'whsec_local_home_fixture',
    S3_BUCKET: 'home-test-assets',
    S3_ENDPOINT: imageUrl,
    S3_FORCE_PATH_STYLE: 'true',
    AWS_ACCESS_KEY_ID: 'home-test-access',
    AWS_SECRET_ACCESS_KEY: 'home-test-secret',
    AWS_REQUEST_CHECKSUM_CALCULATION: 'WHEN_REQUIRED',
  })
  const { createApp } = await import('../app.ts')
  const { AdminUserModel, hashPassword } = await import('../models/AdminUser.ts')
  await mongoose.connect(mongoUri, { dbName: database })
  const email = 'home-preview@example.invalid'
  const password = 'local-home-preview'
  const admin = await AdminUserModel.create({ email, passwordHash: await hashPassword(password) })
  const token = jwt.sign({ sub: String(admin._id), email }, secret, { audience: 'coyv:admin' })
  const server = createServer(createApp())
  const baseUrl = await listen(server, options.apiPort ?? 0)
  return {
    baseUrl,
    imageUrl,
    database,
    cookie: `coyv_admin=${token}`,
    email,
    password,
    objects,
    async close() {
      await closeServer(server)
      await closeServer(imageServer)
      assert.equal(mongoose.connection.name, database)
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
    },
  }
}
