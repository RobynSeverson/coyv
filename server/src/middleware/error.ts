import type { NextFunction, Request, Response } from 'express'
import { MulterError } from 'multer'
import mongoose from 'mongoose'
import Stripe from 'stripe'
import { ZodError } from 'zod'
import { HttpError } from '../lib/httpError.ts'
import { isProduction } from '../env.ts'

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(HttpError.notFound('No such endpoint'))
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, details: error.details })
    return
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      details: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    })
    return
  }

  if (error instanceof MulterError) {
    res.status(400).json({ error: error.message, details: { code: error.code } })
    return
  }

  if (error instanceof mongoose.Error.ValidationError) {
    res.status(400).json({ error: 'Validation failed', details: error.message })
    return
  }

  /* Duplicate key: the only unique indexes here are print slugs, admin emails
     and payment intent ids, all of which are user-correctable conflicts. */
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: number }).code === 11000
  ) {
    res.status(409).json({ error: 'That value is already taken' })
    return
  }

  /* Stripe distinguishes "the shopper's card was declined" from "this server
     is misconfigured". Only the former is safe to show a customer. */
  if (error instanceof Stripe.errors.StripeError) {
    const shopperFacing =
      error instanceof Stripe.errors.StripeCardError ||
      error instanceof Stripe.errors.StripeInvalidRequestError ||
      error instanceof Stripe.errors.StripeIdempotencyError

    if (shopperFacing) {
      console.warn(`[stripe] ${error.type}: ${error.message}`)
      res.status(400).json({ error: error.message })
      return
    }

    console.error(`[stripe] ${error.type}`, error.message)
    res.status(502).json({ error: 'The payment provider is unavailable right now' })
    return
  }

  console.error('[error]', error)
  res.status(500).json({
    error: 'Internal server error',
    ...(isProduction ? {} : { details: error instanceof Error ? error.stack : String(error) }),
  })
}
