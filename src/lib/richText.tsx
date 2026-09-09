import type { ReactNode } from "react";

/* A deliberately small formatting language for product descriptions:
   blank line = new paragraph, single newline = line break, plus **bold**,
   *italic* and [text](url).

   It is parsed into React elements rather than HTML, so there is no
   dangerouslySetInnerHTML anywhere and no amount of admin-authored text — or
   text written by someone who got hold of an admin session — can inject
   markup or script into the shop. */

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)\s]+\))/g;

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

export function renderRichText(value: string): ReactNode[] {
  return value
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block, blockIndex) => (
      <p key={`b-${blockIndex}`}>
        {block.split("\n").flatMap((line, lineIndex) => [
          ...(lineIndex > 0 ? [<br key={`br-${blockIndex}-${lineIndex}`} />] : []),
          ...renderInline(line, `i-${blockIndex}-${lineIndex}`),
        ])}
      </p>
    ));
}

export function RichText({ value, className }: { value: string; className?: string }) {
  if (!value.trim()) return null;
  return <div className={className}>{renderRichText(value)}</div>;
}
