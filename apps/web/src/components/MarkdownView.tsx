import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function MarkdownView({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  const display = isStreaming && content ? content + " ▍" : content;

  return (
    <div className="md-view" style={{ fontSize: 14, lineHeight: 1.8, wordBreak: "break-word", overflowWrap: "anywhere" }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (props) => <h1 style={{ fontSize: 18, fontWeight: 700, margin: "12px 0 8px", borderBottom: "1px solid var(--border)", paddingBottom: 4 }} {...props} />,
          h2: (props) => <h2 style={{ fontSize: 16, fontWeight: 700, margin: "10px 0 6px" }} {...props} />,
          h3: (props) => <h3 style={{ fontSize: 14, fontWeight: 700, margin: "8px 0 4px" }} {...props} />,
          p: (props) => {
            let raw = "";
            try {
              const c: any = (props as any).children;
              if (Array.isArray(c)) raw = c.map((x: any) => (typeof x === "string" ? x : x?.props?.children ?? String(x ?? ""))).join("");
              else raw = String(c ?? "");
            } catch { raw = ""; }
            const isNarrator = /^\s*NARRATOR\s*[:：]\s*/.test(raw);
            if (isNarrator) {
              return (
                <p
                  style={{
                    margin: "10px 0",
                    padding: "8px 12px",
                    borderLeft: "3px solid var(--border)",
                    background: "var(--bg-subtle)",
                    color: "var(--text-faint)",
                    fontStyle: "italic",
                    fontWeight: 400,
                    fontSize: 13,
                    lineHeight: 1.7,
                    borderRadius: 6,
                  }}
                  {...props}
                />
              );
            }
            return <p style={{ margin: "6px 0", fontWeight: 500 }} {...props} />;
          },
          ul: (props) => <ul style={{ margin: "6px 0 6px 20px", listStyle: "disc" }} {...props} />,
          ol: (props) => <ol style={{ margin: "6px 0 6px 20px", listStyle: "decimal" }} {...props} />,
          li: (props) => <li style={{ margin: "2px 0", fontWeight: 500 }} {...props} />,
          blockquote: (props) => <blockquote style={{ borderLeft: "3px solid var(--border)", paddingLeft: 10, margin: "8px 0", color: "var(--text-faint)" }} {...props} />,
          code: ({ children, className, ...props }) => {
            const isInline = !className;
            if (isInline) {
              return <code style={{ background: "var(--bg-code)", padding: "2px 6px", borderRadius: 4, fontSize: 12, fontFamily: "ui-monospace, monospace" }} {...props}>{children}</code>;
            }
            return <code style={{ display: "block", background: "var(--bg-code-block)", color: "var(--bg-code-block-text)", padding: 12, borderRadius: 8, overflowX: "auto", fontSize: 12, fontFamily: "ui-monospace, monospace", margin: "8px 0" }} {...props}>{children}</code>;
          },
          pre: (props) => <pre style={{ margin: 0, background: "transparent" }} {...props} />,
          table: (props) => <table style={{ width: "100%", borderCollapse: "collapse", margin: "8px 0", fontSize: 12 }} {...props} />,
          th: (props) => <th style={{ border: "1px solid var(--border)", padding: "6px 8px", background: "var(--bg-subtle)", textAlign: "left", fontWeight: 600 }} {...props} />,
          td: (props) => <td style={{ border: "1px solid var(--border)", padding: "6px 8px" }} {...props} />,
          a: (props) => <a style={{ color: "var(--accent-primary)", textDecoration: "underline" }} target="_blank" rel="noopener noreferrer" {...props} />,
          hr: (props) => <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "12px 0" }} {...props} />,
          // narration表記（*仕草描写*）の視覚的強調。構造化ロールが無いため、あくまでインラインの見た目強化に留める。
          em: (props) => (
            <em
              style={{
                fontStyle: "normal",
                fontWeight: 500,
                color: "var(--accent-secondary)",
                background: "var(--bg-surface-soft)",
                borderRadius: 4,
                padding: "0 3px",
              }}
              {...props}
            />
          ),
          strong: (props) => <strong style={{ fontWeight: 700, color: "var(--text)" }} {...props} />,
        }}
      >
        {display}
      </ReactMarkdown>
    </div>
  );
}
