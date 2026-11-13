import { isWebLink, type RichContent, type RichDocument, type RichMark, type RichNode } from "../../server/src/lib/richContent.ts";

function inline(text: string, marks: RichMark[] = []): RichNode[] {
  const pattern = /(\[\[small\]\].*?\[\[\/small\]\]|\[\[large\]\].*?\[\[\/large\]\]|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)\s]+\))/g;
  return text.split(pattern).filter(Boolean).flatMap((part): RichNode[] => {
    for (const [prefix, suffix, mark] of [
      ["[[small]]", "[[/small]]", { type: "textStyle", attrs: { fontSize: "14px" } }],
      ["[[large]]", "[[/large]]", { type: "textStyle", attrs: { fontSize: "24px" } }],
      ["**", "**", { type: "bold" }],
      ["*", "*", { type: "italic" }],
    ] as const) {
      if (part.startsWith(prefix) && part.endsWith(suffix) && part.length > prefix.length + suffix.length) {
        return inline(part.slice(prefix.length, -suffix.length), [...marks.filter((entry) => entry.type !== mark.type), mark]);
      }
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      return inline(link[1], isWebLink(link[2]) ? [...marks, { type: "link", attrs: { href: link[2] } }] : marks);
    }
    return [{ type: "text", text: part, ...(marks.length ? { marks } : {}) }];
  });
}

/* Existing markdown remains readable without a migration. Opening it in the
   editor converts it once; the next save stores a native Tiptap document. */
export function editorDocument(value: RichContent): RichDocument {
  if (typeof value !== "string") return value;
  const content = value.replace(/\r\n/g, "\n").replace(/^\s*\[\[image:\d+\]\]\s*$/gm, "\n$&\n")
    .split(/\n{2,}/).map((block) => block.trim()).filter(Boolean).map((block): RichNode => {
      const image = /^\[\[image:(\d+)\]\]$/.exec(block);
      if (image) return { type: "attachedImage", attrs: { position: Number(image[1]) } };
      return {
        type: "paragraph",
        content: block.split("\n").flatMap((line, index) => [
          ...(index ? [{ type: "hardBreak" }] : []), ...inline(line),
        ]),
      };
    });
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}
