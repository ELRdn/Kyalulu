import type { ReactNode } from "react";
import MarkdownView from "./MarkdownView";
import { splitSegments } from "../lib/text";

/** キャラクターの返答を「地の文（ナレーション）」と「セリフ」に分けて表示する */
export default function MessageContent({ content, isStreaming = false, allowImages = true }: { content: string; isStreaming?: boolean; allowImages?: boolean }) {
  const segments = splitSegments(content);
  if (segments.length === 0) return null;
  return (
    <div className="k-msg__stack">
      {segments.map((seg, i) => {
        const streamingHere = isStreaming && i === segments.length - 1;
        return seg.kind === "narration" ? (
          <Narration key={i}><MarkdownView content={seg.text} isStreaming={streamingHere} allowImages={allowImages} /></Narration>
        ) : (
          <div key={i} className="k-bubble k-bubble--character">
            {seg.speaker && <div className="k-msg__meta"><span className="k-msg__name">{seg.speaker}</span></div>}
            <MarkdownView content={seg.text} isStreaming={streamingHere} allowImages={allowImages} />
          </div>
        );
      })}
    </div>
  );
}

/** The user's own text: only *action* is styled, everything else stays literal. */
export function UserText({ content }: { content: string }) {
  return <>{content.split(/(\*[^*\n]+\*)/).map((part, i) => i % 2 ? <em key={i} className="md-action">{part.slice(1, -1)}</em> : part)}</>;
}

/** Narration (地の文): a lines mark and italic prose, outside any bubble. */
export function Narration({ children }: { children: ReactNode }) {
  return (
    <div className="k-narration">
      <svg className="k-narration__mark" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 5h10M3 8h10M3 11h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" /></svg>
      <div>{children}</div>
    </div>
  );
}
