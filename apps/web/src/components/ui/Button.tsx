import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./ui.css";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export default function Button({
  variant = "primary",
  size = "md",
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; children: ReactNode }) {
  return (
    <button className={`k-btn k-btn--${variant} k-btn--${size} ${className}`} {...rest}>
      {children}
    </button>
  );
}
