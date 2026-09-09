import { env } from '../../env.ts'
import { EmailLogModel } from '../../models/EmailLog.ts'

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email'

/* A key that is still the shipped placeholder is treated as "not configured"
   rather than as a real credential, so a deploy that has not had its secrets
   filled in yet logs what it would have sent instead of throwing 401s at
   every paid order. */
const PLACEHOLDER_MARKERS = ['replace_me', 'placeholder', 'changeme', 'todo']

export function isEmailConfigured(): boolean {
  const key = env.BREVO_API_KEY
  if (!key) return false
  return !PLACEHOLDER_MARKERS.some((marker) => key.toLowerCase().includes(marker))
}

export type Recipient = { email: string; name?: string }

export type OutgoingEmail = {
  to: Recipient[]
  subject: string
  html: string
  text: string
  /* Makes the send at-most-once. Omit only for genuinely repeatable mail. */
  dedupeKey?: string
  kind: string
  replyTo?: Recipient
}

export type SendResult =
  | { status: 'sent'; messageId: string | null }
  | { status: 'skipped'; reason: 'not-configured' | 'no-recipients' | 'already-sent' }
  | { status: 'failed'; error: string }

async function postToBrevo(email: OutgoingEmail): Promise<string | null> {
  const response = await fetch(BREVO_ENDPOINT, {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY as string,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { email: env.BREVO_SENDER_EMAIL, name: env.BREVO_SENDER_NAME },
      to: email.to.map((entry) => ({ email: entry.email, name: entry.name })),
      subject: email.subject,
      htmlContent: email.html,
      textContent: email.text,
      ...(email.replyTo ? { replyTo: email.replyTo } : {}),
    }),
  })

  if (!response.ok) {
    /* Brevo puts the useful part in the body, not the status line. */
    const detail = await response.text().catch(() => '')
    throw new Error(`Brevo responded ${response.status}: ${detail.slice(0, 500)}`)
  }

  const payload = (await response.json().catch(() => null)) as { messageId?: string } | null
  return payload?.messageId ?? null
}

/* Claims the dedupe key up front. A duplicate key means somebody else is
   already sending this exact email, so we stand down. */
async function claim(email: OutgoingEmail): Promise<boolean> {
  if (!email.dedupeKey) return true

  try {
    await EmailLogModel.create({
      dedupeKey: email.dedupeKey,
      kind: email.kind,
      to: email.to.map((entry) => entry.email),
      subject: email.subject,
    })
    return true
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return false
    throw error
  }
}

/* Never throws. Email is a side effect of taking money, and a provider outage
   must not fail the webhook that records a payment — the caller would only
   have to swallow it anyway. Failures are logged and, because the claim is
   released, a later retry can still deliver. */
export async function sendEmail(email: OutgoingEmail): Promise<SendResult> {
  const recipients = email.to.filter((entry) => entry.email.trim().length > 0)
  if (recipients.length === 0) {
    console.warn(`[email] ${email.kind}: no recipients, skipped`)
    return { status: 'skipped', reason: 'no-recipients' }
  }

  if (!isEmailConfigured()) {
    console.warn(
      `[email] BREVO_API_KEY is not configured — would have sent "${email.subject}" ` +
        `to ${recipients.map((entry) => entry.email).join(', ')}`,
    )
    return { status: 'skipped', reason: 'not-configured' }
  }

  let claimed: boolean
  try {
    claimed = await claim({ ...email, to: recipients })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[email] could not claim ${email.kind}: ${message}`)
    return { status: 'failed', error: message }
  }

  if (!claimed) {
    console.log(`[email] ${email.kind}: already sent (${email.dedupeKey}), skipped`)
    return { status: 'skipped', reason: 'already-sent' }
  }

  try {
    const messageId = await postToBrevo({ ...email, to: recipients })

    if (email.dedupeKey) {
      await EmailLogModel.updateOne(
        { dedupeKey: email.dedupeKey },
        { $set: { sentAt: new Date(), providerMessageId: messageId } },
      ).exec()
    }

    console.log(`[email] sent ${email.kind} to ${recipients.map((r) => r.email).join(', ')}`)
    return { status: 'sent', messageId }
  } catch (error) {
    /* Releasing the claim is what keeps a provider blip from permanently
       swallowing the email: the next webhook retry gets to try again. */
    if (email.dedupeKey) {
      await EmailLogModel.deleteOne({ dedupeKey: email.dedupeKey })
        .exec()
        .catch(() => undefined)
    }

    const message = error instanceof Error ? error.message : String(error)
    console.error(`[email] failed to send ${email.kind}: ${message}`)
    return { status: 'failed', error: message }
  }
}
