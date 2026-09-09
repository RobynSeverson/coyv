import bcrypt from 'bcryptjs'
import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

const BCRYPT_ROUNDS = 12

const adminUserSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    /* Never selected by default so a stray `.find()` cannot leak hashes into
       a response body. */
    passwordHash: { type: String, required: true, select: false },
    displayName: { type: String, default: '', trim: true },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
)

export type AdminUser = InferSchemaType<typeof adminUserSchema>
export type AdminUserDocument = HydratedDocument<AdminUser>

export const AdminUserModel = model('AdminUser', adminUserSchema)

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS)
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}
