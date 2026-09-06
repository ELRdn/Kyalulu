import type { ReactNode } from "react";
import "./ui.css";

export default function Badge({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "accent" | "pink" | "mint" }) {
  const cls = tone === "default" ? "k-badge" : `k-badge k-badge--${tone}`;
  return <span className={cls}>{children}</span>;
}
