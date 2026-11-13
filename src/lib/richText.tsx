import { createElement, type CSSProperties, type ReactNode } from "react";
import { readRichContent, type RichContent, type RichNode } from "../../server/src/lib/richContent";
import "./richText.css";

/* Legacy formatting for product descriptions and
   journal entries: blank line = new paragraph, single newline = line break,
   plus **bold**, *italic*, [text](url) and [[image:1]].

   An image token names one of the images already attached to the record by
   position rather than by URL. The author never writes a URL, so an entry
   cannot point at anything but its own uploads, and the signed links — which
   expire — are resolved at render time instead of being frozen into the text.

   Both legacy text and validated editor documents render as React elements rather than HTML, so there is no
   dangerouslySetInnerHTML anywhere and no amount of admin-authored text — or
   text written by someone who got hold of an admin session — can inject
   markup or script into the shop. */

const INLINE = /(\[\[small\]\].*?\[\[\/small\]\]|\[\[large\]\].*?\[\[\/large\]\]|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)\s]+\))/g;

/* A line of its own, so an image always breaks the column rather than trying
   to flow inside a sentence. */
const IMAGE_BLOCK = /^\[\[image:(\d+)\]\]$/;

export type RichTextImage = { url: string; alt?: string };

export const imageToken = (position: number): string => `[[image:${position}]]`;

/* Positions are 1-based because the toolbar that writes them counts the way
   the admin's thumbnail strip reads. */
export function hasImageToken(value: RichContent, position: number): boolean {
  if (typeof value !== "string") {
    const contains = (node: RichNode): boolean => node.type === "attachedImage" && node.attrs?.position === position
      || (node.content ?? []).some(contains);
    return contains(value);
  }
  return value.split(/\r?\n/).some((line) => line.trim() === imageToken(position));
}

function safeHref(url: string): string | null {
  /* Anything that is not plainly http(s) is dropped rather than rendered,
     which is what keeps javascript: and data: URLs out. */
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text
    .split(INLINE)
    .filter((part) => part.length > 0)
    .map((part, index) => {
      const key = `${keyPrefix}-${index}`;

      for (const size of ["small", "large"] as const) {
        const opening = `[[${size}]]`;
        const closing = `[[/${size}]]`;
        if (part.startsWith(opening) && part.endsWith(closing)) {
          return <span key={key} className={`richText__${size}`}>
            {renderInline(part.slice(opening.length, -closing.length), key)}
          </span>;
        }
      }

      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        return <strong key={key}>{renderInline(part.slice(2, -2), key)}</strong>;
      }

      if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
        return <em key={key}>{renderInline(part.slice(1, -1), key)}</em>;
      }

      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
      if (link) {
        const href = safeHref(link[2] ?? "");
        if (!href) return <span key={key}>{link[1]}</span>;
        return (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer">
            {link[1]}
          </a>
        );
      }

      return <span key={key}>{part}</span>;
    });
}

function renderDocument(node: RichNode, images: RichTextImage[], key: string): ReactNode {
  const children = (node.content ?? []).map((child, index) => renderDocument(child, images, `${key}-${index}`));
  if (node.type === "text") {
    return (node.marks ?? []).reduce<ReactNode>((text, mark, index) => {
      const markKey = `${key}-m${index}`;
      const attrs = mark.attrs ?? {};
      if (mark.type === "link") return <a key={markKey} href={attrs.href ?? undefined} title={attrs.title ?? undefined} target="_blank" rel="noopener noreferrer">{text}</a>;
      if (mark.type === "textStyle") {
        const style: CSSProperties = {
          color: attrs.color ?? undefined, fontSize: attrs.fontSize ?? undefined, fontFamily: attrs.fontFamily ?? undefined,
        };
        return <span key={markKey} style={style}>{text}</span>;
      }
      if (mark.type === "highlight") return <mark key={markKey} style={{ backgroundColor: attrs.color ?? "#fff2a8" }}>{text}</mark>;
      const tag = { bold: "strong", italic: "em", underline: "u", strike: "s" }[mark.type];
      return tag ? createElement(tag, { key: markKey }, text) : text;
    }, node.text ?? "");
  }
  if (node.type === "doc") return children;
  if (node.type === "hardBreak") return <br key={key} />;
  if (node.type === "horizontalRule") return <hr key={key} />;
  if (node.type === "attachedImage") {
    const image = images[Number(node.attrs?.position) - 1];
    return image ? <figure key={key} className="richText__figure"><img src={image.url} alt={image.alt ?? ""} loading="lazy" /></figure> : null;
  }
  const tag = node.type === "heading" ? `h${node.attrs?.level}` : {
    paragraph: "p", blockquote: "blockquote", bulletList: "ul", orderedList: "ol", listItem: "li",
  }[node.type];
  return tag ? createElement(tag, {
    key,
    ...(node.attrs?.textAlign ? { style: { textAlign: node.attrs.textAlign } } : {}),
    ...(node.type === "orderedList" ? { start: node.attrs?.start ?? 1, type: node.attrs?.type ?? undefined } : {}),
  }, children) : null;
}

export function renderRichText(value: RichContent, images: RichTextImage[] = []): ReactNode[] {
  readRichContent(value);
  if (typeof value !== "string") return value.content.map((node, index) => renderDocument(node, images, `b-${index}`));
  return value
    .replace(/\r\n/g, "\n")
    /* An image token is pulled out into a paragraph of its own, so it works
       whether or not the author left blank lines around it. */
    .replace(/^\[\[image:\d+\]\]$/gm, "\n$&\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block, blockIndex) => {
      const token = IMAGE_BLOCK.exec(block);

      if (token) {
        const image = images[Number(token[1]) - 1];
        /* A token pointing at an image that has been deleted since renders as
           nothing rather than as its own source text, so a tidied-up archive
           never shows its own markup to a visitor. */
        if (!image) return null;

        return (
          <figure key={`b-${blockIndex}`} className="richText__figure">
            <img src={image.url} alt={image.alt ?? ""} loading="lazy" />
          </figure>
        );
      }

      return (
        <p key={`b-${blockIndex}`}>
          {block.split("\n").flatMap((line, lineIndex) => [
            ...(lineIndex > 0 ? [<br key={`br-${blockIndex}-${lineIndex}`} />] : []),
            ...renderInline(line, `i-${blockIndex}-${lineIndex}`),
          ])}
        </p>
      );
    })
    .filter((node) => node !== null);
}

export function RichText({
  value,
  className,
  images,
}: {
  value: RichContent;
  className?: string;
  images?: RichTextImage[];
}) {
  if (typeof value === "string" && !value.trim()) return null;
  /* The base class is always present so links can be styled in one place,
     wherever a caller chooses to mount this. */
  return (
    <div className={className ? `richText ${className}` : "richText"}>
      {renderRichText(value, images)}
    </div>
  );
}
