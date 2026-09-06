import { useRef } from "react";
import Button from "./Button";
import "./ui.css";

export default function Composer({
  value,
  onChange,
  onSend,
  disabled = false,
  disabledText = "生成中...",
  placeholder = "メッセージを入力 (Enterで送信, Shift+Enterで改行)",
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
  disabledText?: string;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="k-composer">
      <textarea
        ref={ref}
        className="k-composer__input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        placeholder={disabled ? disabledText : placeholder}
        disabled={disabled}
        rows={1}
        onInput={(e) => {
          const t = e.target as HTMLTextAreaElement;
          t.style.height = "auto";
          t.style.height = Math.min(t.scrollHeight, 180) + "px";
        }}
      />
      <Button variant="primary" size="md" onClick={onSend} disabled={disabled || !value.trim()}>
        {disabled ? "…" : "送信"}
      </Button>
    </div>
  );
}
