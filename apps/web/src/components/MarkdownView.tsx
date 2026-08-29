import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function MarkdownView({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  // ストリーミング中は末尾にカーソルを付ける
  const display = isStreaming && content ? content + " ▍" : content;

  return (
    <div className="md-view" style={{ fontSize: 13, lineHeight: 1.7 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 見出し
          h1: (props) => <h1 style={{ fontSize: 18, fontWeight: 700, margin: "12px 0 8px", borderBottom: "1px solid #e5e7eb", paddingBottom: 4 }} {...props} />,
          h2: (props) => <h2 style={{ fontSize: 16, fontWeight: 700, margin: "10px 0 6px" }} {...props} />,
          h3: (props) => <h3 style={{ fontSize: 14, fontWeight: 700, margin: "8px 0 4px" }} {...props} />,
          // 段落
          p: (props) => <p style={{ margin: "6px 0" }} {...props} />,
          // リスト
          ul: (props) => <ul style={{ margin: "6px 0 6px 20px", listStyle: "disc" }} {...props} />,
          ol: (props) => <ol style={{ margin: "6px 0 6px 20px", listStyle: "decimal" }} {...props} />,
          li: (props) => <li style={{ margin: "2px 0" }} {...props} />,
          // 引用
          blockquote: (props) => <blockquote style={{ borderLeft: "3px solid #e5e7eb", paddingLeft: 10, margin: "8px 0", color: "#6b7280" }} {...props} />,
          // コード
          code: ({ children, className, ...props }) => {
            const isInline = !className;
            if (isInline) {
              return <code style={{ background: "#f3f4f6", padding: "2px 6px", borderRadius: 4, fontSize: 12, fontFamily: "ui-monospace, monospace" }} {...props}>{children}</code>;
            }
            return <code style={{ display: "block", background: "#1f2937", color: "#e5e7eb", padding: 12, borderRadius: 8, overflowX: "auto", fontSize: 12, fontFamily: "ui-monospace, monospace", margin: "8px 0" }} {...props}>{children}</code>;
          },
          pre: (props) => <pre style={{ margin: 0, background: "transparent" }} {...props} />,
          // テーブル
          table: (props) => <table style={{ width: "100%", borderCollapse: "collapse", margin: "8px 0", fontSize: 12 }} {...props} />,
          th: (props) => <th style={{ border: "1px solid #e5e7eb", padding: "6px 8px", background: "#f9fafb", textAlign: "left", fontWeight: 600 }} {...props} />,
          td: (props) => <td style={{ border: "1px solid #e5e7eb", padding: "6px 8px" }} {...props} />,
          // リンク
          a: (props) => <a style={{ color: "#2563eb", textDecoration: "underline" }} target="_blank" rel="noopener noreferrer" {...props} />,
          hr: (props) => <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", margin: "12px 0" }} {...props} />,
        }}
      >
        {display}
      </ReactMarkdown>
    </div>
  );
}
