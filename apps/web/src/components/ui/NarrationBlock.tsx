import type { ReactNode } from "react";
import "./ui.css";

/**
 * narration の視覚的強調ブロック。
 * バックエンドに構造化された NARRATION ロールは存在しないため、
 * 明示的な @: の描写に使う。*動作* や *（内心）* だけでは使用しない。
 */
export default function NarrationBlock({ children }: { children: ReactNode }) {
  return (
    <span className="k-narration" style={{ display: "block" }}>
      <span className="k-narration__mark">✦</span>
      {children}
    </span>
  );
}
