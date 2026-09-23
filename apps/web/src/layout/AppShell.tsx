import { useCallback, useEffect, useState } from "react";
import { Outlet, Link, NavLink, useLocation } from "react-router-dom";
import NavItem from "../components/ui/NavItem";
import Avatar from "../components/ui/Avatar";
import IconButton from "../components/ui/IconButton";
import Icon, { type IconName } from "../components/ui/Icon";
import CommandPalette from "../components/CommandPalette";
import { useTheme } from "../lib/theme";
import { useDisplayName } from "../lib/profile";
import "./shell.css";

const LS_SIDEBAR_COMPACT = "kyalulu-sidebar-compact";

const CONSUMER_NAV: { to: string; icon: IconName; label: string; end?: boolean }[] = [
  { to: "/", icon: "home", label: "ホーム", end: true },
  { to: "/discover", icon: "compass", label: "ディスカバー" },
  { to: "/chats", icon: "chat", label: "チャット" },
  { to: "/create", icon: "pen", label: "クリエイト" },
  { to: "/profile", icon: "user", label: "プロフィール" },
];

const DAILY_WORDS = [
  "きみの物語が、だれかの世界を照らすかも…？",
  "今日はどんな世界をのぞいてみる？",
  "ちょっと寄り道。それも立派な冒険だよ。",
  "話したいことがあったら、いつでもおいで。",
  "星がきれいな夜は、物語が生まれやすいんだって。",
  "きみの「好き」を、ぼくにも教えてほしいな。",
  "迷ったら、気分でえらんでみよう。",
];

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export default function AppShell() {
  const [compact, setCompact] = useState(() => localStorage.getItem(LS_SIDEBAR_COMPACT) === "1");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const displayName = useDisplayName();
  const location = useLocation();
  const dailyWord = DAILY_WORDS[Math.floor(Date.now() / 86_400_000) % DAILY_WORDS.length];

  useEffect(() => {
    localStorage.setItem(LS_SIDEBAR_COMPACT, compact ? "1" : "0");
  }, [compact]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const inChat = location.pathname.startsWith("/chats/");
  // 会話中は会話リストが左に来るので、メインナビはアイコンだけにして本文の幅を確保する
  const rail = compact || inChat;

  return (
    <div className={`k-shell ${inChat ? "k-shell--chat" : ""}`}>
      <header className="k-shell__header">
        <Link to="/" className="k-shell__logo" aria-label="Kyalulu ホーム">
          <img className="k-shell__logo-mark" src="/apple-touch-icon.png" alt="" aria-hidden="true" />
          <span className="k-shell__wordmark">
            Kyalulu<span aria-hidden="true">✦</span>
          </span>
        </Link>
        <button type="button" className="k-shell__search" onClick={() => setPaletteOpen(true)} aria-label="キャラクターやワールドを検索">
          <Icon name="search" size={16} />
          <span className="k-shell__search-text">キャラクターやワールドを検索…</span>
          <kbd>{isMac ? "⌘" : "Ctrl"} K</kbd>
        </button>
        <div className="k-shell__header-actions">
          <IconButton label="キャラクターやワールドを検索" className="k-shell__search-mobile" onClick={() => setPaletteOpen(true)} size="sm">
            <Icon name="search" size={16} />
          </IconButton>
          <IconButton label={theme === "dark" ? "ライトモードに切替" : "ダークモードに切替"} onClick={toggle} size="sm">
            <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
          </IconButton>
          <Link to="/profile" className="k-shell__profile-chip">
            <Avatar name={displayName} size="sm" />
            <span className="k-shell__profile-name">{displayName}</span>
          </Link>
        </div>
      </header>

      <div className="k-shell__body">
        <nav className={`k-shell__sidebar ${rail ? "k-shell__sidebar--compact" : ""}`} aria-label="メインナビゲーション">
          <div className="k-shell__nav-group">
            {CONSUMER_NAV.map((item) => (
              <NavItem key={item.to} to={item.to} icon={<Icon name={item.icon} size={19} />} label={item.label} compact={rail} end={item.end} />
            ))}
          </div>
          <div className="k-shell__sidebar-divider" />
          <div className="k-shell__nav-group">
            <NavItem to="/studio" icon={<Icon name="sparkle" size={17} />} label="スタジオ" secondary compact={rail} badge={<span className="k-nav-item__badge">上級者向け</span>} />
          </div>

          {!rail && (
            <div className="k-shell__companion">
              <img src="/mascot/nap.webp" alt="" className="k-shell__companion-art" />
              <div className="k-shell__daily">
                <div className="k-shell__daily-title">✦ 今日のひとこと</div>
                <p>{dailyWord}</p>
              </div>
            </div>
          )}

          {!inChat && (<div className="k-shell__sidebar-collapse">
            <IconButton label={compact ? "サイドバーを展開" : "サイドバーを折りたたむ"} onClick={() => setCompact((v) => !v)} size="sm">
              <Icon name="chevron" size={15} style={{ transform: compact ? undefined : "rotate(180deg)" }} />
            </IconButton>
          </div>)}
        </nav>

        <main className="k-shell__main" id="main">
          <Outlet />
        </main>
      </div>

      <nav className="k-shell__bottomnav" aria-label="モバイルナビゲーション">
        <div className="k-shell__bottomnav-row">
          {CONSUMER_NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `k-shell__bottomnav-item ${isActive ? "active" : ""}`}>
              <Icon name={item.icon} size={21} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      <CommandPalette open={paletteOpen} onClose={closePalette} />
    </div>
  );
}
