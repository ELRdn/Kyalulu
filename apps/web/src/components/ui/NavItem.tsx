import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import "./ui.css";

export default function NavItem({
  to,
  icon,
  label,
  secondary = false,
  compact = false,
  badge,
  active,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  secondary?: boolean;
  compact?: boolean;
  badge?: ReactNode;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={`k-nav-item ${active ? "k-nav-item--active" : ""} ${secondary ? "k-nav-item--secondary" : ""}`}
      title={label}
      aria-label={label}
    >
      <span className="k-nav-item__icon" aria-hidden="true">
        {icon}
      </span>
      {!compact && <span className="k-nav-item__label">{label}</span>}
      {!compact && badge}
    </Link>
  );
}
