import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose'

export const DEFAULT_ABOUT = 'I make artwork and photographs that wander between the familiar and the imagined. Drawn figures, quiet places, and fragments of memory come together in a world that is always a little unfinished. This castle is a home for those experiments, and an invitation to look closer, get lost, and keep trying something new.'

const homeImageSchema = new Schema({
  key: { type: String, required: true },
  previewKey: { type: String, required: true },
  contentType: { type: String, required: true },
  bytes: { type: Number, required: true },
  width: { type: Number, required: true },
  height: { type: Number, required: true },
}, { timestamps: true })

const showcaseSchema = new Schema({
  imageId: { type: Schema.Types.ObjectId, required: true },
  title: { type: String, default: '' },
  url: { type: String, default: '' },
}, { _id: false })

const newsSchema = new Schema({
  id: { type: String, required: true },
  date: { type: String, required: true },
  preview: { type: String, default: '' },
  previewImageId: { type: Schema.Types.ObjectId, default: null },
  body: { type: String, default: '' },
  imageIds: { type: [Schema.Types.ObjectId], default: [] },
}, { _id: false })

const contactSchema = new Schema({
  id: { type: String, required: true },
  title: { type: String, required: true },
  url: { type: String, required: true },
}, { _id: false })

const homeSchema = new Schema({
  _id: { type: String, default: 'home' },
  revision: { type: Number, default: 0 },
  aboutMe: { type: String, default: DEFAULT_ABOUT },
  projects: { type: [showcaseSchema], default: [] },
  artwork: { type: [showcaseSchema], default: [] },
  news: { type: [newsSchema], default: [] },
  contacts: { type: [contactSchema], default: [] },
}, { timestamps: true })

export type HomeDocument = HydratedDocument<InferSchemaType<typeof homeSchema>>
export type HomeImageDocument = HydratedDocument<InferSchemaType<typeof homeImageSchema>>

export const HomeModel = model('HomeContent', homeSchema)
export const HomeImageModel = model('HomeImage', homeImageSchema)
