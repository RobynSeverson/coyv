export type RichMark = { type: string; attrs?: Record<string, string | null> }
export type RichNode = {
  type: string
  text?: string
  attrs?: Record<string, string | number | null>
  marks?: RichMark[]
  content?: RichNode[]
}
export type RichDocument = RichNode & { type: 'doc'; content: RichNode[] }
export type RichContent = string | RichDocument

export const FONT_FAMILIES = ['Georgia', 'Times New Roman', 'Arial', 'Verdana', 'Courier New'] as const
export const FONT_SIZES = ['12px', '14px', '16px', '18px', '24px', '32px'] as const
export const isColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)
export function isWebLink(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false
  try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/* The same allowlist is used by API validation and the React renderer. No
   HTML, arbitrary CSS, remote image URLs or executable attributes are stored. */
export function isRichContent(value: unknown): value is RichContent {
  if (typeof value === 'string') return value.length <= 20000
  let count = 0
  let characters = 0
  function node(input: unknown, depth: number, parent: string): input is RichNode {
    if (!object(input) || depth > 16 || ++count > 3000 || typeof input.type !== 'string') return false
    if (Object.keys(input).some((key) => !['type', 'text', 'attrs', 'marks', 'content'].includes(key))) return false
    const type = input.type
    const children: Record<string, string[]> = {
      doc: ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'horizontalRule', 'attachedImage'],
      blockquote: ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'horizontalRule', 'attachedImage'],
      listItem: ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'attachedImage'],
      bulletList: ['listItem'], orderedList: ['listItem'],
      paragraph: ['text', 'hardBreak'], heading: ['text', 'hardBreak'],
    }
    if (type === 'doc' ? parent !== '' : !children[parent]?.includes(type)) return false
    if (!['doc', 'paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'horizontalRule', 'attachedImage', 'text', 'hardBreak'].includes(type)) return false
    if (type === 'text') {
      if (typeof input.text !== 'string' || !input.text.length) return false
      characters += input.text.length
      if (characters > 20000) return false
    } else if (input.text !== undefined) return false
    if (input.attrs !== undefined) {
      if (!object(input.attrs)) return false
      for (const [key, attr] of Object.entries(input.attrs)) {
        if (key === 'textAlign' && ['paragraph', 'heading'].includes(type)) {
          if (attr !== null && !['left', 'center', 'right', 'justify'].includes(String(attr))) return false
        } else if (key === 'level' && type === 'heading') {
          if (![1, 2, 3].includes(Number(attr))) return false
        } else if (key === 'start' && type === 'orderedList') {
          if (!Number.isInteger(attr) || Number(attr) < 1 || Number(attr) > 9999) return false
        } else if (key === 'type' && type === 'orderedList') {
          if (attr !== null && !['1', 'a', 'A', 'i', 'I'].includes(String(attr))) return false
        } else if (key === 'position' && type === 'attachedImage') {
          if (!Number.isInteger(attr) || Number(attr) < 1 || Number(attr) > 10000) return false
        } else return false
      }
    }
    if (type === 'heading' && (!object(input.attrs) || ![1, 2, 3].includes(Number(input.attrs.level)))) return false
    if (type === 'attachedImage' && (!object(input.attrs) || !Number.isInteger(input.attrs.position))) return false
    if (input.marks !== undefined) {
      if (type !== 'text' || !Array.isArray(input.marks) || input.marks.length > 8) return false
      const seen = new Set<string>()
      for (const mark of input.marks) {
        if (!object(mark) || typeof mark.type !== 'string' || seen.has(mark.type)) return false
        seen.add(mark.type)
        if (Object.keys(mark).some((key) => !['type', 'attrs'].includes(key))) return false
        if (!['bold', 'italic', 'underline', 'strike', 'link', 'textStyle', 'highlight'].includes(mark.type)) return false
        if (mark.attrs !== undefined) {
          if (!object(mark.attrs)) return false
          for (const [key, attr] of Object.entries(mark.attrs)) {
            if (mark.type === 'link' && key === 'href') { if (!isWebLink(attr)) return false }
            else if (mark.type === 'link' && key === 'target') { if (attr !== null && attr !== '_blank') return false }
            else if (mark.type === 'link' && key === 'rel') { if (attr !== null && attr !== 'noopener noreferrer nofollow' && attr !== 'noopener noreferrer') return false }
            else if (mark.type === 'link' && key === 'class') { if (attr !== null) return false }
            else if (mark.type === 'link' && key === 'title') { if (attr !== null && (typeof attr !== 'string' || attr.length > 256)) return false }
            else if (['textStyle', 'highlight'].includes(mark.type) && key === 'color') { if (attr !== null && !isColor(attr)) return false }
            else if (mark.type === 'textStyle' && key === 'fontFamily') { if (attr !== null && !FONT_FAMILIES.includes(attr as typeof FONT_FAMILIES[number])) return false }
            else if (mark.type === 'textStyle' && key === 'fontSize') { if (attr !== null && !FONT_SIZES.includes(attr as typeof FONT_SIZES[number])) return false }
            else return false
          }
        }
        if (mark.type === 'link' && (!object(mark.attrs) || !isWebLink(mark.attrs.href))) return false
      }
    }
    if (input.content !== undefined) {
      if (!children[type] || !Array.isArray(input.content) || !input.content.every((child) => node(child, depth + 1, type))) return false
    } else if (type === 'doc' || ['bulletList', 'orderedList', 'listItem'].includes(type)) return false
    return true
  }
  return object(value) && value.type === 'doc' && node(value, 0, '')
}

export function readRichContent(value: unknown): RichContent {
  if (!isRichContent(value)) throw new Error('Invalid rich-text content')
  return value
}

export function richPlainText(value: RichContent): string {
  if (typeof value === 'string') return value.replace(/\[\[(?:\/?(?:small|large)|image:\d+)\]\]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*+/g, '').trim()
  function text(node: RichNode): string {
    if (node.type === 'text') return node.text ?? ''
    return (node.content ?? []).map(text).join(['doc', 'blockquote', 'listItem', 'bulletList', 'orderedList'].includes(node.type) ? '\n' : '')
  }
  return text(value).trim()
}

export function hasRichContent(value: RichContent): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  const image = (node: RichNode): boolean => node.type === 'attachedImage' || (node.content ?? []).some(image)
  return richPlainText(value).length > 0 || image(value)
}

export function removeRichImage(value: RichContent, position: number): RichContent {
  if (typeof value === 'string') return value.split(/\r?\n/).map((line) => {
    const token = /^\s*\[\[image:(\d+)\]\]\s*$/.exec(line)
    if (!token) return line
    const number = Number(token[1])
    return number === position ? '' : number > position ? `[[image:${number - 1}]]` : line
  }).join('\n')
  function walk(node: RichNode): RichNode {
    if (node.type === 'attachedImage' && Number(node.attrs?.position) > position) {
      return { ...node, attrs: { position: Number(node.attrs?.position) - 1 } }
    }
    return { ...node, ...(node.content ? {
      content: node.content.filter((child) => child.type !== 'attachedImage' || child.attrs?.position !== position).map(walk),
    } : {}) }
  }
  return { ...value, content: value.content.filter((child) => child.type !== 'attachedImage' || child.attrs?.position !== position).map(walk) }
}
