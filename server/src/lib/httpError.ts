/* A single error type the routes can throw; the error middleware turns it into
   a JSON response. Anything else that escapes a handler is a 500. */
export class HttpError extends Error {
  readonly status: number
  readonly details?: unknown

  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.details = details
  }

  static badRequest(message: string, details?: unknown) {
    return new HttpError(400, message, details)
  }

  static unauthorized(message = 'Not authenticated') {
    return new HttpError(401, message)
  }

  static forbidden(message = 'Not allowed') {
    return new HttpError(403, message)
  }

  static notFound(message = 'Not found') {
    return new HttpError(404, message)
  }

  static conflict(message: string, details?: unknown) {
    return new HttpError(409, message, details)
  }

  /* An upstream we depend on (Stripe, S3) answered in a way we cannot use.
     Not the caller's fault, so it must not read as a 400. */
  static badGateway(message: string, details?: unknown) {
    return new HttpError(502, message, details)
  }
}
