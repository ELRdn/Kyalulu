import type { ReactNode } from "react";
import "./ui.css";

/**
 * narration の視覚的強調ブロック。
 * バックエンドに構造化された NARRATION ロールは存在しないため、
 * これは speaking_style 規約上の *斜体テキスト* を MarkdownView 側で
 * 強調表示する際に使う共有スタイルとして提供する（メッセージ分割はしない）。
 */
export default function NarrationBlock({ children }: { children: ReactNode }) {
  return (
    <span className="k-narration" style={{ display: "block" }}>
      <span className="k-narration__mark">✦</span>
      {children}
    </span>
  );
}
