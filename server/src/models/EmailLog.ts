import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

/* One row per email we have committed to sending. The unique dedupeKey is the
   whole point: a replayed Stripe webhook, a retried scheduler invocation and
   two concurrent Lambda instances all try to insert the same key, and only one
   of them wins.

   The key is claimed *before* the send and removed again if the send fails, so
   the guarantee is at-most-once with a retry still possible — the alternative
   (log after sending) would let two concurrent deliveries both send. */
const emailLogSchema = new Schema(
  {
    dedupeKey: { type: String, required: true, unique: true },
    kind: { type: String, required: true },
    to: { type: [String], default: [] },
    subject: { type: String, default: '' },
    sentAt: { type: Date, default: null },
    /* Brevo's message id, kept so a delivery can be traced from a support
       question back to the provider without guessing. */
    providerMessageId: { type: String, default: null },
  },
  { timestamps: true },
)

export type EmailLog = InferSchemaType<typeof emailLogSchema>
export type EmailLogDocument = HydratedDocument<EmailLog>

export const EmailLogModel = model('EmailLog', emailLogSchema)
