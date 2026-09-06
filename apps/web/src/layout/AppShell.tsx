import { useEffect, useState } from "react";
import { Outlet, useNavigate, Link, NavLink } from "react-router-dom";
import NavItem from "../components/ui/NavItem";
import Avatar from "../components/ui/Avatar";
import IconButton from "../components/ui/IconButton";
import { useTheme } from "../lib/theme";
import { useDisplayName } from "../lib/profile";
import "./shell.css";

const LS_SIDEBAR_COMPACT = "kyalulu-sidebar-compact";

const CONSUMER_NAV = [
  { to: "/", icon: "⌂", label: "Home", end: true },
  { to: "/discover", icon: "✦", label: "Discover" },
  { to: "/chats", icon: "◔", label: "Chats" },
  { to: "/create", icon: "✎", label: "Create" },
  { to: "/profile", icon: "◐", label: "Profile" },
];

const MOBILE_NAV = CONSUMER_NAV;

export default function AppShell() {
  const [compact, setCompact] = useState(() => localStorage.getItem(LS_SIDEBAR_COMPACT) === "1");
  const [query, setQuery] = useState("");
  const { theme, toggle } = useTheme();
  const displayName = useDisplayName();
  const navigate = useNavigate();

  useEffect(() => {
    localStorage.setItem(LS_SIDEBAR_COMPACT, compact ? "1" : "0");
  }, [compact]);

  const submitSearch = () => {
    const q = query.trim();
    navigate(q ? `/discover?q=${encodeURIComponent(q)}` : "/discover");
  };

  return (
    <div className="k-shell">
      <header className="k-shell__header">
        <Link to="/" className="k-shell__logo">
          <img className="k-shell__logo-mark" src="/apple-touch-icon.png" alt="" aria-hidden="true" />
          <span>Kyalulu</span>
        </Link>
        <div className="k-shell__search">
          <span className="k-shell__search-icon" aria-hidden="true">⌕</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitSearch()}
            placeholder="キャラクターやワールドを検索..."
            aria-label="キャラクターやワールドを検索"
          />
        </div>
        <div className="k-shell__header-actions">
          <IconButton label={theme === "dark" ? "ライトモードに切替" : "ダークモードに切替"} onClick={toggle} size="sm">
            {theme === "dark" ? "☀" : "☾"}
          </IconButton>
          <Link to="/profile" className="k-shell__profile-chip">
            <Avatar name={displayName} size="xs" />
            <span>{displayName}</span>
          </Link>
        </div>
      </header>

      <div className="k-shell__body">
        <nav className={`k-shell__sidebar ${compact ? "k-shell__sidebar--compact" : ""}`} aria-label="メインナビゲーション">
          <div className="k-shell__nav-group">
            {CONSUMER_NAV.map((item) => (
              <NavItem key={item.to} to={item.to} icon={item.icon} label={item.label} compact={compact} end={item.end} />
            ))}
          </div>
          <div className="k-shell__sidebar-divider" />
          <div className="k-shell__nav-group">
            <NavItem to="/studio" icon="⚙" label="Studio" secondary compact={compact} />
          </div>
          <div className="k-shell__sidebar-collapse">
            <IconButton label={compact ? "サイドバーを展開" : "サイドバーを折りたたむ"} onClick={() => setCompact((v) => !v)} size="sm">
              {compact ? "»" : "«"}
            </IconButton>
          </div>
        </nav>

        <main className="k-shell__main">
          <Outlet />
        </main>
      </div>

      <nav className="k-shell__bottomnav" aria-label="モバイルナビゲーション">
        <div className="k-shell__bottomnav-row">
          {MOBILE_NAV.map((item) => (
            <MobileNavLink key={item.to} to={item.to} icon={item.icon} label={item.label} end={item.end} />
          ))}
        </div>
      </nav>
    </div>
  );
}

function MobileNavLink({ to, icon, label, end }: { to: string; icon: string; label: string; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `k-shell__bottomnav-item ${isActive ? "active" : ""}`}>
      <span aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </NavLink>
  );
}
