import type { ReactNode } from "react";
import "./richText.css";

/* A deliberately small formatting language for product descriptions and
   journal entries: blank line = new paragraph, single newline = line break,
   plus **bold**, *italic*, [text](url) and [[image:1]].

   An image token names one of the images already attached to the record by
   position rather than by URL. The author never writes a URL, so an entry
   cannot point at anything but its own uploads, and the signed links — which
   expire — are resolved at render time instead of being frozen into the text.

   It is parsed into React elements rather than HTML, so there is no
   dangerouslySetInnerHTML anywhere and no amount of admin-authored text — or
   text written by someone who got hold of an admin session — can inject
   markup or script into the shop. */

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)\s]+\))/g;

/* A line of its own, so an image always breaks the column rather than trying
   to flow inside a sentence. */
const IMAGE_BLOCK = /^\[\[image:(\d+)\]\]$/;

export type RichTextImage = { url: string; alt?: string };

export const imageToken = (position: number): string => `[[image:${position}]]`;

/* Positions are 1-based because the toolbar that writes them counts the way
   the admin's thumbnail strip reads. */
export function hasImageToken(value: string, position: number): boolean {
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

      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        return <strong key={key}>{part.slice(2, -2)}</strong>;
      }

      if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
        return <em key={key}>{part.slice(1, -1)}</em>;
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

export function renderRichText(value: string, images: RichTextImage[] = []): ReactNode[] {
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
  value: string;
  className?: string;
  images?: RichTextImage[];
}) {
  if (!value.trim()) return null;
  /* The base class is always present so links can be styled in one place,
     wherever a caller chooses to mount this. */
  return (
    <div className={className ? `richText ${className}` : "richText"}>
      {renderRichText(value, images)}
    </div>
  );
}
