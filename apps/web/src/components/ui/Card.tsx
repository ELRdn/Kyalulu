import type { HTMLAttributes, ReactNode } from "react";
import "./ui.css";

export default function Card({
  flush = false,
  children,
  className = "",
  ...rest
}: HTMLAttributes<HTMLDivElement> & { flush?: boolean; children: ReactNode }) {
  return (
    <div className={`k-card ${flush ? "k-card--flush" : ""} ${className}`} {...rest}>
      {children}
    </div>
  );
}
