import MarkdownView from "./MarkdownView";
import { splitSegments } from "../lib/text";

/** キャラクターの返答を「地の文（ナレーション）」と「セリフ」に分けて表示する */
export default function MessageContent({ content, isStreaming = false }: { content: string; isStreaming?: boolean }) {
  const segments = splitSegments(content);
  if (segments.length === 0) return null;
  return (
    <div className="k-msg__stack">
      {segments.map((seg, i) => {
        const streamingHere = isStreaming && i === segments.length - 1;
        return seg.kind === "narration" ? (
          <div key={i} className="k-narration">
            <span className="k-narration__mark" aria-hidden="true">
              ✦
            </span>
            <MarkdownView content={seg.text} isStreaming={streamingHere} />
          </div>
        ) : (
          <div key={i} className="k-bubble k-bubble--character">
            <MarkdownView content={seg.text} isStreaming={streamingHere} />
          </div>
        );
      })}
    </div>
  );
}
