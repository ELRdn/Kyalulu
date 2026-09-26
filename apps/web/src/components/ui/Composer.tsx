import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SlashCommand } from "../../lib/api";
import Button from "./Button";
import Icon from "./Icon";
import "./ui.css";

export default function Composer({
  value,
  onChange,
  onSend,
  onStop,
  streaming = false,
  disabled = false,
  disabledText = "準備中…",
  placeholder = "きみの言葉を入力してね…",
  tools,
  commands,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  /** 生成中に表示する停止ボタン */
  onStop?: () => void;
  streaming?: boolean;
  disabled?: boolean;
  disabledText?: string;
  placeholder?: string;
  /** 入力欄の下段、左側に並べる補助ボタン */
  tools?: ReactNode;
  /** 指定すると「/」入力でスラッシュコマンドの候補を出す */
  commands?: SlashCommand[];
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const query = value.toLowerCase();
  const matches =
    commands && !dismissed && query.startsWith("/") && !query.includes("\n")
      ? commands.filter((c) => c.name.startsWith(query.trimEnd()) || query.startsWith(c.name + " "))
      : [];
  const selected = matches[Math.min(active, matches.length - 1)];

  useEffect(() => {
    setActive(0);
    if (!value.startsWith("/")) setDismissed(false);
  }, [value]);

  const complete = (c: SlashCommand) => {
    onChange(c.name + " ");
    requestAnimationFrame(() => ref.current?.focus());
  };

  // 値が外から変わったとき（送信後のクリア・スターター挿入）も高さを追従させる
  useEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight, 200) + "px";
  }, [value]);

  const locked = disabled || streaming;

  // ト書き（動作・描写）を *…* で入れる。選択中の文字があれば囲む
  const insertAsterisk = () => {
    const t = ref.current;
    if (!t) return;
    const { selectionStart: a, selectionEnd: b } = t;
    const selected = value.slice(a, b);
    onChange(value.slice(0, a) + `*${selected}*` + value.slice(b));
    requestAnimationFrame(() => {
      t.focus();
      const caret = selected ? b + 2 : a + 1;
      t.setSelectionRange(caret, caret);
    });
  };
  return (
    <div className="k-composer">
      <div className="k-composer__box">
        {matches.length > 0 && (
          <div className="k-slash" role="listbox" aria-label="コマンド">
            {matches.map((c) => (
              <button
                key={c.name}
                type="button"
                role="option"
                aria-selected={c === selected}
                className={`k-slash__item ${c === selected ? "is-active" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => complete(c)}
              >
                <code className="k-slash__usage">{c.usage}</code>
                <span className="k-slash__desc">{c.description}</span>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={ref}
          className="k-composer__input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (selected && !e.nativeEvent.isComposing) {
              const partial = selected.name !== query.trimEnd() && selected.name.startsWith(query.trimEnd());
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const i = matches.indexOf(selected) + (e.key === "ArrowDown" ? 1 : -1);
                setActive((i + matches.length) % matches.length);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setDismissed(true);
                return;
              }
              if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && partial)) {
                e.preventDefault();
                complete(selected);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!locked) onSend();
            }
          }}
          placeholder={disabled && !streaming ? disabledText : placeholder}
          disabled={disabled && !streaming}
          rows={1}
          aria-label="メッセージ"
        />
        <div className="k-composer__row">
          {tools}
          <button type="button" className="k-composer__tool" onClick={insertAsterisk} disabled={disabled && !streaming} title="ト書きを入れる（*動作*）" aria-label="ト書きを入れる">
            <span aria-hidden="true">＊</span>
          </button>
          <span className="k-composer__hint">
            <kbd>Enter</kbd> 送信 · <kbd>Shift</kbd>+<kbd>Enter</kbd> 改行
          </span>
          {streaming && onStop ? (
            <Button variant="secondary" size="md" className="k-composer__send" onClick={onStop}>
              <Icon name="stop" size={14} /> 停止
            </Button>
          ) : (
            <Button variant="primary" size="md" className="k-composer__send" onClick={onSend} disabled={locked || !value.trim()}>
              <Icon name="send" size={15} /> 送信
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
