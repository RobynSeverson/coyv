/* A short reference a customer can quote and the studio can find, derived
   from the record's id rather than stored: every order ever taken already has
   one, and there is no counter to keep in step across Lambdas.

   The last four bytes of an ObjectId are the tail of its random value plus
   its per-process counter, so two orders would have to collide on both to
   share a number — and the full id is still what anything looks up by. */
export function referenceNumber(id: unknown): string {
  const hex = String(id).replace(/[^0-9a-f]/gi, '')
  return hex.slice(-8).toUpperCase()
}
