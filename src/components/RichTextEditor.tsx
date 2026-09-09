import { useRef, useState } from "react";
import { RichText } from "../lib/richText";
import "./RichTextEditor.css";

/* A textarea with a small toolbar rather than a contenteditable surface: the
   stored value stays plain text, so it can never carry markup, and what the
   admin types is exactly what gets saved. The preview renders it through the
   same parser the shop uses, so there is no chance of the two disagreeing. */

type Props = {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  label?: string;
};

export default function RichTextEditor({ value, onChange, rows = 4, label }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  /* Wrapping the selection, and restoring it afterwards, is what makes the
     toolbar feel like an editor instead of a pair of buttons that append
     characters at the end. */
  function wrapSelection(before: string, after: string, placeholder: string) {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end) || placeholder;
    const next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`;

    onChange(next);

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }

  return (
    <div className="rte">
      <div className="rte__bar">
        {label ? <span className="rte__label">{label}</span> : null}

        <div className="rte__tools">
          <button
            type="button"
            title="Bold"
            onClick={() => wrapSelection("**", "**", "bold text")}
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            title="Italic"
            onClick={() => wrapSelection("*", "*", "italic text")}
          >
            <em>I</em>
          </button>
          <button
            type="button"
            title="Link"
            onClick={() => wrapSelection("[", "](https://)", "link text")}
          >
            link
          </button>
          <button
            type="button"
            className={showPreview ? "is-active" : ""}
            onClick={() => setShowPreview((current) => !current)}
          >
            preview
          </button>
        </div>
      </div>

      {showPreview ? (
        <div className="rte__preview">
          {value.trim() ? (
            <RichText value={value} />
          ) : (
            <p className="rte__empty">Nothing to preview yet.</p>
          )}
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          className="rte__input"
          rows={rows}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}

      <p className="rte__hint">
        Blank line starts a paragraph · **bold** · *italic* · [text](https://link)
      </p>
    </div>
  );
}
