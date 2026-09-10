import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

/* A one-time link for a subscriber to manage their own subscription.

   The token itself is never stored: only its SHA-256 hash, so a leaked
   database backup cannot be replayed into somebody's account. The row is what
   makes the link single-use — redeeming stamps `usedAt`, and a second attempt
   with the same link finds it already spent. */
const manageTokenSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },

    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },

    /* Kept only to make abuse legible in the logs. */
    requestedByIp: { type: String, default: null },
  },
  { timestamps: true },
)

/* Mongo removes the row once it expires, so spent and stale links do not
   accumulate and the collection stays small enough to be uninteresting. */
manageTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export type ManageToken = InferSchemaType<typeof manageTokenSchema>
export type ManageTokenDocument = HydratedDocument<ManageToken>

export const ManageTokenModel = model('ManageToken', manageTokenSchema)
