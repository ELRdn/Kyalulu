import { useEffect, useRef } from "react";
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
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // 値が外から変わったとき（送信後のクリア・スターター挿入）も高さを追従させる
  useEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight, 200) + "px";
  }, [value]);

  const locked = disabled || streaming;
  return (
    <div className="k-composer">
      <div className="k-composer__box">
        <textarea
          ref={ref}
          className="k-composer__input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
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
