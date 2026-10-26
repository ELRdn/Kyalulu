import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import NavItem from "../components/ui/NavItem";
import Avatar from "../components/ui/Avatar";
import IconButton from "../components/ui/IconButton";
import Icon, { type IconName } from "../components/ui/Icon";
import CommandPalette from "../components/CommandPalette";
import { useTheme } from "../lib/theme";
import { useDisplayName } from "../lib/profile";
import { useAccountProfile } from '../lib/accountProfile';
import "./shell.css";
import { useAdministrative, useRuntimeAccess } from '../components/RuntimeGate';
import { isCloudGuest, loginPath } from '../lib/cloudGuest';
import CreditOptions, { AdBanner } from '../components/CreditOptions';
import { labels, useLanguage, useExecutionTarget } from '../lib/appContext';
import { UnifiedSync } from '../components/SessionPolicy';

const LS_SIDEBAR_COMPACT = "kyalulu-sidebar-compact";

const MOBILE_NAV: { to: string; icon: IconName; label: string }[] = [
  { to: "/", icon: "home", label: "ホーム" },
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
  ["きみの物語が、だれかの世界を照らすかも…？", "Your story could light up someone else's world."],
  ["今日はどんな世界をのぞいてみる？", "What world would you like to explore today?"],
  ["ちょっと寄り道。それも立派な冒険だよ。", "A little detour can be an adventure too."],
  ["話したいことがあったら、いつでもおいで。", "Come by whenever you feel like talking."],
  ["星がきれいな夜は、物語が生まれやすいんだって。", "Starry nights are a lovely time for stories."],
  ["きみの「好き」を、ぼくにも教えてほしいな。", "I'd love to hear about the things you enjoy."],
  ["迷ったら、気分でえらんでみよう。", "If you're undecided, follow your mood."],
];

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export default function AppShell() {
  const language=useLanguage(),t=labels[language],en=language==='en';
  const navLabel=(path:string)=>({'/':t.home,'/chats':t.chats,'/discover':t.discover,'/create':t.create,'/profile':t.profile}[path]);
  const administrative = useAdministrative();
  const target = useExecutionTarget();
  const guest = isCloudGuest(useRuntimeAccess());
  const navigate = useNavigate();
  const [compact, setCompact] = useState(() => localStorage.getItem(LS_SIDEBAR_COMPACT) === "1");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const displayName = useDisplayName();
  const accountSync = useAccountProfile();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const dailyWord = DAILY_WORDS[Math.floor(Date.now() / 86_400_000) % DAILY_WORDS.length][en ? 1 : 0];

  useEffect(() => {
    localStorage.setItem(LS_SIDEBAR_COMPACT, compact ? "1" : "0");
  }, [compact]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (guest) navigate('/discover');
        else setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [guest, navigate]);

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
        <Link to="/" className="k-shell__logo" aria-label={en ? 'Kyalulu Home' : 'Kyalulu ホーム'}>
          <img className="k-shell__logo-mark" src={`${import.meta.env.BASE_URL}mascot/v1.2/face-default.png`} alt="" aria-hidden="true" width={34} height={34} />
          <span className="k-shell__wordmark">
            Kyalulu<span aria-hidden="true">✦</span>
          </span>
        </Link>
        <button type="button" className="k-shell__search" onClick={() => guest ? navigate('/discover') : setPaletteOpen(true)} aria-label={en ? 'Search characters and worlds' : 'キャラクターやワールドを検索'}>
          <Icon name="search" size={16} />
          <span className="k-shell__search-text">{en ? 'Search characters and worlds…' : 'キャラクターやワールドを検索…'}</span>
          <kbd>{isMac ? "⌘" : "Ctrl"} K</kbd>
        </button>
        <div className="k-shell__header-actions">
          <IconButton label={en ? 'Search characters and worlds' : 'キャラクターやワールドを検索'} className="k-shell__search-mobile" onClick={() => guest ? navigate('/discover') : setPaletteOpen(true)} size="sm">
            <Icon name="search" size={16} />
          </IconButton>
          <IconButton label={theme === "dark" ? (en ? 'Switch to light mode' : 'ライトモードに切替') : (en ? 'Switch to dark mode' : 'ダークモードに切替')} onClick={toggle} size="sm">
            <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
          </IconButton>
          <Link to={guest ? loginPath(location.pathname + location.search) : '/profile'} className="k-shell__profile-chip">
            <Avatar name={guest ? (en ? 'Guest' : 'ゲスト') : displayName} size="sm" />
            <span className="k-shell__profile-name">{guest ? (en ? 'Sign in / Sign up' : 'ログイン / 新規登録') : displayName}</span>
          </Link>
        </div>
      </header>

      <div className="k-shell__body">
        <nav className={`k-shell__sidebar ${rail ? "k-shell__sidebar--compact" : ""}`} aria-label={en ? 'Main navigation' : 'メインナビゲーション'}>
          <div className="k-shell__nav-group">
            {CONSUMER_NAV.map((item) => (
              <NavItem key={item.to} to={item.to} icon={<Icon name={item.icon} size={19} />} label={navLabel(item.to)||item.label} compact={rail} end={item.end} />
            ))}
          </div>
          {target==='device'&&<div className="k-shell__nav-group"><NavItem to="/research" icon={<Icon name="sparkle" size={17} />} label={language==='en'?'Research':'研究'} secondary compact={rail} /></div>}
          {administrative && <><div className="k-shell__sidebar-divider" />
          <div className="k-shell__nav-group">
            <NavItem to="/studio" icon={<Icon name="sparkle" size={17} />} label={en ? 'Studio' : 'スタジオ'} secondary compact={rail} badge={<span className="k-nav-item__badge">{en ? 'Advanced' : '上級者向け'}</span>} />
          </div></>}

          {!rail && (
            <div className="k-shell__companion">
              <img src={`${import.meta.env.BASE_URL}mascot/v1.2/nap.png`} alt="" className="k-shell__companion-art" width={160} height={160} decoding="async" />
              <div className="k-shell__daily">
                <div className="k-shell__daily-title">✦ {en ? 'A thought for today' : '今日のひとこと'}</div>
                <p>{dailyWord}</p>
              </div>
            </div>
          )}

          {!inChat && (<div className="k-shell__sidebar-collapse">
            <IconButton label={compact ? (en ? 'Expand sidebar' : 'サイドバーを展開') : (en ? 'Collapse sidebar' : 'サイドバーを折りたたむ')} onClick={() => setCompact((v) => !v)} size="sm">
              <Icon name="chevron" size={15} style={{ transform: compact ? undefined : "rotate(180deg)" }} />
            </IconButton>
          </div>)}
        </nav>

        <main className="k-shell__main" id="main" ref={mainRef}>
          {['/','/discover'].includes(location.pathname)&&<AdBanner/>}
          {accountSync.error && location.pathname!=='/profile' && <div className="k-shell__sync-alert" role="alert">{accountSync.error} <Link to="/profile">{en ? 'Review in Settings' : 'プロフィールで確認'}</Link></div>}
          <Outlet />
        </main>
      </div>

      <nav className="k-shell__bottomnav" aria-label={en ? 'Mobile navigation' : 'モバイルナビゲーション'}>
        <div className="k-shell__bottomnav-row">
          {MOBILE_NAV.map((item) => {
            const active = location.pathname === item.to || location.pathname.startsWith(`${item.to}/`) ||
              (item.to === "/discover" && location.pathname.startsWith("/characters/"));
            return (
              <Link key={item.to} to={item.to} aria-current={active ? "page" : undefined} className={`k-shell__bottomnav-item ${active ? "active" : ""}`}>
                <Icon name={item.icon} size={21} />
                <span>{navLabel(item.to)||item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {guest ? null : <CommandPalette open={paletteOpen} onClose={closePalette} />}
      <CreditOptions/>
      <UnifiedSync/>
    </div>
  );
}
