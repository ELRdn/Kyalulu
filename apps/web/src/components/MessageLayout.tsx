import type { ComponentType, ReactNode } from 'react';
import { splitSegments } from '../lib/text';

export type MessageContentProps = { content: string; isStreaming?: boolean; allowImages?: boolean };

export function MessageLayout({ content, isStreaming = false, allowImages = true, Markdown }: MessageContentProps & {
  Markdown: ComponentType<MessageContentProps>;
}) {
  const segments = splitSegments(content);
  if (segments.length === 0) return null;
  return (
    <div className="k-msg__stack">
      {segments.map((segment, index) => {
        const markdown = <Markdown content={segment.text} isStreaming={isStreaming && index === segments.length - 1} allowImages={allowImages} />;
        return segment.kind === 'narration' ? (
          <Narration key={index}>{markdown}</Narration>
        ) : (
          <div key={index} className="k-bubble k-bubble--character">
            {segment.speaker && <div className="k-msg__meta"><span className="k-msg__name">{segment.speaker}</span></div>}
            {markdown}
          </div>
        );
      })}
    </div>
  );
}

/** The user's own text: only *action* is styled, everything else stays literal. */
export function UserText({ content }: { content: string }) {
  return <>{content.split(/(\*[^*\n]+\*)/).map((part, index) => index % 2 ? <em key={index} className="md-action">{part.slice(1, -1)}</em> : part)}</>;
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
