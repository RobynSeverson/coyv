import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

/* One row per named sequence. The counter lives in Mongo rather than in the
   process because the API runs as several Lambdas at once, and two of them
   holding their own idea of "the next number" would hand out the same one. */
const counterSchema = new Schema({
  _id: { type: String },
  seq: { type: Number, required: true, default: 0 },
})

export type Counter = InferSchemaType<typeof counterSchema>
export type CounterDocument = HydratedDocument<Counter>

export const CounterModel = model('Counter', counterSchema)
