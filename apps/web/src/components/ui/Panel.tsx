import type { HTMLAttributes, ReactNode } from "react";
import "./ui.css";

export default function Panel({ children, className = "", ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={`k-panel ${className}`} {...rest}>
      {children}
    </div>
  );
}
