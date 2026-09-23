import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import "./ui.css";

export default function NavItem({
  to,
  icon,
  label,
  secondary = false,
  compact = false,
  badge,
  end = false,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  secondary?: boolean;
  compact?: boolean;
  badge?: ReactNode;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `k-nav-item ${isActive ? "k-nav-item--active" : ""} ${secondary ? "k-nav-item--secondary" : ""}`}
      title={compact ? label : undefined}
      aria-label={compact ? label : undefined}
    >
      <span className="k-nav-item__icon" aria-hidden="true">
        {icon}
      </span>
      {!compact && <span className="k-nav-item__label">{label}</span>}
      {!compact && badge}
    </NavLink>
  );
}
