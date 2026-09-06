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
    >
      <span aria-hidden="true" style={{ fontSize: 17, width: 20, textAlign: "center", flexShrink: 0 }}>
        {icon}
      </span>
      {!compact && <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>}
      {!compact && badge}
    </NavLink>
  );
}
