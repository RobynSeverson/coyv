import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Extension, Node, type JSONContent } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { FONT_FAMILIES, FONT_SIZES, isRichContent, isWebLink, richPlainText, type RichContent } from "../../server/src/lib/richContent";
import { editorDocument } from "../lib/editorContent";
import { RichText, hasImageToken, type RichTextImage } from "../lib/richText";
import "./RichTextEditor.css";

const AttachedImage = Node.create({
  name: "attachedImage",
  group: "block",
  atom: true,
  addAttributes: () => ({ position: { default: 1 } }),
  parseHTML: () => [{ tag: "figure[data-upload-position]", getAttrs: (element) => ({ position: Number(element.getAttribute("data-upload-position")) }) }],
  renderHTML: ({ node }) => ["figure", { "data-upload-position": node.attrs.position }, `uploaded image ${node.attrs.position}`],
});

const SafeContent = Extension.create<{ maxLength: number; onInvalid: () => void }>({
  name: "safeContent",
  addOptions: () => ({ maxLength: 20000, onInvalid: () => {} }),
  addProseMirrorPlugins() {
    const options = this.options;
    return [new Plugin({
      filterTransaction(transaction) {
        if (!transaction.docChanged) return true;
        const json: unknown = transaction.doc.toJSON();
        if (!isRichContent(json) || richPlainText(json).length > options.maxLength) {
          options.onInvalid();
          return false;
        }
        return true;
      },
    })];
  },
});

type Props = {
  value: RichContent;
  onChange: (value: RichContent) => void;
  rows?: number;
  label?: string;
  images?: RichTextImage[];
  maxLength?: number;
  disabled?: boolean;
};

export default function RichTextEditor({ value, onChange, rows = 4, label = "content", images = [], maxLength = 20000, disabled = false }: Props) {
  const [notice, setNotice] = useState("");
  const [showPreview, setShowPreview] = useState(true);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [preview, setPreview] = useState(value);
  const valueRef = useRef(value);
  const emitted = useRef<RichContent | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({
        code: false, codeBlock: false, heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: false, defaultProtocol: "https", protocols: ["http", "https"] },
      }),
      TextStyle, Color, FontFamily, FontSize,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      AttachedImage,
      SafeContent.configure({
        maxLength,
        onInvalid: () => setNotice("That change exceeds the content limit or uses unsupported formatting. It was not applied."),
      }),
    ],
    content: editorDocument(value) as JSONContent,
    editorProps: { attributes: { class: "rte__input richText", role: "textbox", "aria-label": label, "aria-multiline": "true" } },
    onUpdate: ({ editor: current }) => {
      const json: unknown = current.getJSON();
      if (!isRichContent(json)) throw new Error("Editor emitted invalid content");
      emitted.current = json;
      valueRef.current = json;
      setPreview(json);
      setNotice("");
      onChangeRef.current(json);
    },
  });

  useEffect(() => {
    if (!editor || value === valueRef.current || value === emitted.current) return;
    valueRef.current = value;
    const document = editorDocument(value);
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(document)) {
      editor.commands.setContent(document as JSONContent, { emitUpdate: false });
    }
    setPreview(value);
  }, [value, editor]);
  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);

  if (!editor) return <p role="status">loading editor…</p>;

  function button(text: string, command: () => void, active = false, disabled = false) {
    return <button type="button" aria-pressed={active} disabled={disabled} onClick={command}>{text}</button>;
  }
  const attributes = editor.getAttributes("textStyle");
  return (
    <fieldset className="rte" disabled={disabled}>
      <div className="rte__bar">
        <span className="rte__label">{label}</span>
        <div className="rte__tools" role="group" aria-label={`${label} formatting`}>
          {button("bold", () => { editor.chain().focus().toggleBold().run(); }, editor.isActive("bold"))}
          {button("italic", () => { editor.chain().focus().toggleItalic().run(); }, editor.isActive("italic"))}
          {button("underline", () => { editor.chain().focus().toggleUnderline().run(); }, editor.isActive("underline"))}
          {button("strike", () => { editor.chain().focus().toggleStrike().run(); }, editor.isActive("strike"))}
          <label>color <input type="color" aria-label={`${label} text color`} value={attributes.color ?? "#41443d"}
            onChange={(event) => editor.chain().focus().setColor(event.target.value).run()} /></label>
          <label>highlight <input type="color" aria-label={`${label} highlight color`} value={editor.getAttributes("highlight").color ?? "#fff2a8"}
            onChange={(event) => editor.chain().focus().setHighlight({ color: event.target.value }).run()} /></label>
          <select aria-label={`${label} font family`} value={attributes.fontFamily ?? ""} onChange={(event) => {
            if (event.target.value) editor.chain().focus().setFontFamily(event.target.value).run();
            else editor.chain().focus().unsetFontFamily().run();
          }}>
            <option value="">site font</option>
            {FONT_FAMILIES.map((font) => <option key={font} value={font}>{font}</option>)}
          </select>
          <select aria-label={`${label} font size`} value={attributes.fontSize ?? ""} onChange={(event) => {
            if (event.target.value) editor.chain().focus().setFontSize(event.target.value).run();
            else editor.chain().focus().unsetFontSize().run();
          }}>
            <option value="">site size</option>
            {FONT_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
          <select aria-label={`${label} paragraph style`} value={editor.isActive("heading") ? String(editor.getAttributes("heading").level) : "paragraph"}
            onChange={(event) => {
              const level = Number(event.target.value);
              if (level === 1 || level === 2 || level === 3) editor.chain().focus().setHeading({ level }).run();
              else editor.chain().focus().setParagraph().run();
            }}>
            <option value="paragraph">paragraph</option>
            <option value="1">heading 1</option><option value="2">heading 2</option><option value="3">heading 3</option>
          </select>
          {(["left", "center", "right", "justify"] as const).map((alignment) =>
            <button type="button" key={alignment} aria-pressed={editor.isActive({ textAlign: alignment })}
              onClick={() => editor.chain().focus().setTextAlign(alignment).run()}>{alignment}</button>)}
          {button("bullets", () => { editor.chain().focus().toggleBulletList().run(); }, editor.isActive("bulletList"))}
          {button("numbers", () => { editor.chain().focus().toggleOrderedList().run(); }, editor.isActive("orderedList"))}
          {button("indent", () => { editor.chain().focus().sinkListItem("listItem").run(); }, false, !editor.can().sinkListItem("listItem"))}
          {button("outdent", () => { editor.chain().focus().liftListItem("listItem").run(); }, false, !editor.can().liftListItem("listItem"))}
          {button("quote", () => { editor.chain().focus().toggleBlockquote().run(); }, editor.isActive("blockquote"))}
          {button("link", () => {
            setLinkUrl(editor.getAttributes("link").href ?? "");
            setLinkOpen((open) => !open);
          }, editor.isActive("link"))}
          {button("undo", () => { editor.chain().focus().undo().run(); }, false, !editor.can().undo())}
          {button("redo", () => { editor.chain().focus().redo().run(); }, false, !editor.can().redo())}
          {button("clear style", () => { editor.chain().focus().unsetAllMarks().run(); })}
          {button("live preview", () => setShowPreview((shown) => !shown), showPreview)}
        </div>
      </div>
      {linkOpen ? <div className="rte__tools">
        <input aria-label={`${label} link URL`} type="url" placeholder="https://" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} />
        <button type="button" onClick={() => {
          if (!isWebLink(linkUrl)) { setNotice("Use a full http or https link."); return; }
          editor.chain().focus().extendMarkRange("link").setLink({ href: linkUrl, target: "_blank", rel: "noopener noreferrer" }).run();
          setLinkOpen(false);
          setNotice("");
        }}>apply link</button>
        <button type="button" onClick={() => { editor.chain().focus().extendMarkRange("link").unsetLink().run(); setLinkOpen(false); }}>remove link</button>
      </div> : null}
      {notice ? <p role="alert" className="admin__error">{notice}</p> : null}
      <EditorContent editor={editor} style={{ minHeight: `${rows * 1.5}rem` }} />
      {images.length ? <div className="rte__images">
        <span className="rte__label">place an uploaded image</span>
        <div className="rte__imageStrip">{images.map((image, index) => <button key={`${image.url}-${index}`} type="button"
          className={`rte__image${hasImageToken(value, index + 1) ? " is-used" : ""}`} title={`Insert image ${index + 1}`}
          onClick={() => editor.chain().focus().insertContent({ type: "attachedImage", attrs: { position: index + 1 } }).run()}>
          <img src={image.url} alt="" /><span>{index + 1}</span>
        </button>)}</div>
      </div> : null}
      {showPreview ? <div className="rte__preview" aria-label={`${label} live preview`}><RichText value={preview} images={images} /></div> : null}
    </fieldset>
  );
}
