import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./ui.css";

export default function IconButton({
  active = false,
  size = "md",
  children,
  label,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; size?: "sm" | "md"; children: ReactNode; label: string }) {
  return (
    <button
      className={`k-icon-btn ${active ? "k-icon-btn--active" : ""} ${size === "sm" ? "k-icon-btn--sm" : ""} ${className}`}
      aria-label={label}
      title={label}
      {...rest}
    >
      {children}
    </button>
  );
}
