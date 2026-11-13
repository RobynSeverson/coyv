import { z } from 'zod'
import { isRichContent, type RichContent } from './richContent.ts'

export const richContentSchema = z.custom<RichContent>(isRichContent, 'Invalid or unsupported rich-text content')
