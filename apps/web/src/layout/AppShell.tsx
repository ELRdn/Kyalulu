import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import NavItem from "../components/ui/NavItem";
import Avatar from "../components/ui/Avatar";
import IconButton from "../components/ui/IconButton";
import Icon, { type IconName } from "../components/ui/Icon";
import CommandPalette from "../components/CommandPalette";
import { useTheme } from "../lib/theme";
import { useDisplayName } from "../lib/profile";
import { useAccountProfile } from '../lib/accountProfile';
import "./shell.css";
import { useAdministrative } from '../components/RuntimeGate';

const LS_SIDEBAR_COMPACT = "kyalulu-sidebar-compact";

const MOBILE_NAV: { to: string; icon: IconName; label: string }[] = [
  { to: "/chats", icon: "chat", label: "トーク" },
  { to: "/discover", icon: "compass", label: "キャラクター" },
  { to: "/create", icon: "pen", label: "つくる" },
  { to: "/profile", icon: "settings", label: "設定" },
];

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
  const administrative = useAdministrative();
  const [compact, setCompact] = useState(() => localStorage.getItem(LS_SIDEBAR_COMPACT) === "1");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const displayName = useDisplayName();
  const accountSync = useAccountProfile();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
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

  // 画面遷移のたびに本文のスクロール位置を先頭へ戻す（前ページの位置を引き継がない）
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
    setPaletteOpen(false);
  }, [location.pathname]);

  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const inChat = location.pathname.startsWith("/chats/");
  // 会話中は会話リストが左に来るので、メインナビはアイコンだけにして本文の幅を確保する
  const rail = compact || inChat;

  return (
    <div className={`k-shell ${inChat ? "k-shell--chat" : ""} ${location.pathname.startsWith("/characters/") ? "k-shell--immersive" : ""}`}>
      <header className="k-shell__header">
        <Link to="/" className="k-shell__logo" aria-label="Kyalulu ホーム">
          <img className="k-shell__logo-mark" src={`${import.meta.env.BASE_URL}mascot/v1.2/face-default.png`} alt="" aria-hidden="true" width={34} height={34} />
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
          {administrative && <><div className="k-shell__sidebar-divider" />
          <div className="k-shell__nav-group">
            <NavItem to="/studio" icon={<Icon name="sparkle" size={17} />} label="スタジオ" secondary compact={rail} badge={<span className="k-nav-item__badge">上級者向け</span>} />
          </div></>}

          {!rail && (
            <div className="k-shell__companion">
              <img src={`${import.meta.env.BASE_URL}mascot/v1.2/nap.png`} alt="" className="k-shell__companion-art" width={160} height={160} decoding="async" />
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

        <main className="k-shell__main" id="main" ref={mainRef}>
          {accountSync.error && location.pathname!=='/profile' && <div className="k-shell__sync-alert" role="alert">{accountSync.error} <Link to="/profile">プロフィールで確認</Link></div>}
          <Outlet />
        </main>
      </div>

      <nav className="k-shell__bottomnav" aria-label="モバイルナビゲーション">
        <div className="k-shell__bottomnav-row">
          {MOBILE_NAV.map((item) => {
            const active = location.pathname === item.to || location.pathname.startsWith(`${item.to}/`) ||
              (item.to === "/discover" && location.pathname.startsWith("/characters/"));
            return (
              <Link key={item.to} to={item.to} aria-current={active ? "page" : undefined} className={`k-shell__bottomnav-item ${active ? "active" : ""}`}>
                <Icon name={item.icon} size={21} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <CommandPalette open={paletteOpen} onClose={closePalette} />
    </div>
  );
}
