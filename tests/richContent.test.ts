import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasRichContent, isRichContent, richPlainText, removeRichImage, type RichDocument } from "../server/src/lib/richContent.ts";
import { editorDocument } from "../src/lib/editorContent.ts";

export const document: RichDocument = {
  type: "doc", content: [
    { type: "heading", attrs: { level: 2, textAlign: "center" }, content: [{ type: "text", text: "Origins" }] },
    { type: "paragraph", attrs: { textAlign: "justify" }, content: [{
      type: "text", text: "Formatted story", marks: [
        { type: "bold" }, { type: "italic" }, { type: "underline" }, { type: "strike" },
        { type: "textStyle", attrs: { color: "#123456", fontSize: "24px", fontFamily: "Georgia" } },
        { type: "highlight", attrs: { color: "#eeeeaa" } },
        { type: "link", attrs: { href: "https://example.com", target: "_blank", rel: "noopener noreferrer", class: null, title: null } },
      ],
    }] },
    { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "A quote" }] }] },
    { type: "bulletList", content: [{ type: "listItem", content: [
      { type: "paragraph", content: [{ type: "text", text: "Outer item" }] },
      { type: "orderedList", attrs: { start: 2, type: null }, content: [{ type: "listItem", content: [
        { type: "paragraph", content: [{ type: "text", text: "Nested item" }] },
      ] }] },
    ] }] },
    { type: "attachedImage", attrs: { position: 1 } },
  ],
};

describe("structured rich content", () => {
  it("round-trips formatting as JSON and projects plain text for external payment metadata", () => {
    assert.ok(isRichContent(document));
    assert.deepEqual(editorDocument(JSON.parse(JSON.stringify(document))), document);
    assert.equal(richPlainText(document), "Origins\nFormatted story\nA quote\nOuter item\nNested item");
  });

  it("converts existing markdown, sizes, safe links and image positions without HTML parsing", () => {
    const converted = editorDocument("**old** and *italic*\n\n[[small]]small[[/small]] [site](https://example.com)\n\n[[image:2]]");
    assert.ok(isRichContent(converted));
    assert.equal(converted.content[2]?.attrs?.position, 2);
    assert.ok(JSON.stringify(converted).includes('"type":"bold"'));
    assert.ok(JSON.stringify(converted).includes('"fontSize":"14px"'));
    assert.equal(richPlainText(editorDocument("<script>not executable</script>")), "<script>not executable</script>");
  });

  it("rejects arbitrary HTML, executable links/styles, external images and excessive nesting", () => {
    for (const bad of [
      { type: "script", content: [] },
      { type: "image", attrs: { src: "https://example.com/tracker" } },
      { type: "paragraph", attrs: { onclick: "alert(1)" } },
      { type: "paragraph", content: [{ type: "text", text: "link", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] },
      { type: "paragraph", content: [{ type: "text", text: "style", marks: [{ type: "textStyle", attrs: { fontFamily: "url(evil)" } }] }] },
      { type: "paragraph", content: [{ type: "text", text: "color", marks: [{ type: "textStyle", attrs: { color: "red;background:url(evil)" } }] }] },
    ]) assert.equal(isRichContent({ type: "doc", content: [bad] }), false);
    let nested: unknown = { type: "paragraph" };
    for (let depth = 0; depth < 20; depth++) nested = { type: "blockquote", content: [nested] };
    assert.equal(isRichContent({ type: "doc", content: [nested] }), false);
  });

  it("removes image nodes and reindexes remaining references while keeping formatting", () => {
    const body: RichDocument = { type: "doc", content: [...document.content, { type: "attachedImage", attrs: { position: 2 } }] };
    const removed = removeRichImage(body, 1);
    assert.ok(isRichContent(removed));
    assert.equal(typeof removed, "object");
    assert.ok(typeof removed !== "string");
    assert.equal(removed.content.filter((node) => node.type === "attachedImage").length, 1);
    assert.equal(removed.content.at(-1)?.attrs?.position, 1);
    assert.deepEqual(removed.content[1], document.content[1]);
  });

  it("allows an image-only news body without treating an empty editor paragraph as content", () => {
    assert.equal(hasRichContent({ type: "doc", content: [{ type: "paragraph" }] }), false);
    assert.equal(hasRichContent({ type: "doc", content: [{ type: "attachedImage", attrs: { position: 1 } }] }), true);
  });
});
