import mongoose from 'mongoose'
import { env } from './env.ts'

export async function connectToDatabase(): Promise<void> {
  mongoose.set('strictQuery', true)
  await mongoose.connect(env.MONGODB_URI, { dbName: env.MONGODB_DB_NAME })
  console.log(`[db] connected to ${env.MONGODB_DB_NAME}`)
}

export async function disconnectFromDatabase(): Promise<void> {
  await mongoose.disconnect()
}
