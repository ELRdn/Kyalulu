import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import NavItem from "../components/ui/NavItem";
import Icon, { type IconName } from "../components/ui/Icon";
import CommandPalette from "../components/CommandPalette";
import { useDisplayName, useProfileExtras } from "../lib/profile";
import { useAccountProfile } from '../lib/accountProfile';
import "./shell.css";
import { useRuntimeAccess } from '../components/RuntimeGate';
import { isCloudGuest } from '../lib/cloudGuest';
import CreditOptions, { AdBanner } from '../components/CreditOptions';
import { labels, useLanguage } from '../lib/appContext';
import { UnifiedSync } from '../components/SessionPolicy';

// Same five tabs, names and order in the sidebar and the bottom bar (docs/MOBILE_UX_SPEC.md §4).
const NAV: { to: string; icon: IconName }[] = [
  { to: "/", icon: "home" },
  { to: "/discover", icon: "search" },
  { to: "/chats", icon: "chat" },
  { to: "/create", icon: "plus" },
  { to: "/profile", icon: "user" },
];

/** Which sidebar tab a page belongs to; pages outside the five tabs fall back to Home. */
function sidebarSection(path: string) {
  const under = (...roots: string[]) => roots.some((root) => path === root || path.startsWith(`${root}/`));
  if (under('/create/settings', '/profile', '/studio', '/status', '/research', '/migration', '/publications', '/legal')) return '/profile';
  if (under('/discover', '/characters', '/authors', '/works', '/published')) return '/discover';
  if (under('/chats')) return '/chats';
  if (under('/create')) return '/create';
  return '/';
}

export default function AppShell() {
  const language=useLanguage(),t=labels[language],en=language==='en';
  const navLabel=(path:string):string=>({'/':t.home,'/chats':t.chats,'/discover':t.discover,'/create':t.create,'/profile':t.profile}[path] ?? path);
  const guest = isCloudGuest(useRuntimeAccess());
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const displayName = useDisplayName();
  const { avatar } = useProfileExtras();
  const accountSync = useAccountProfile();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);

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
  const [talkSplit, setTalkSplit] = useState(false);
  useEffect(() => { const update = (e: Event) => setTalkSplit((e as CustomEvent<boolean>).detail); window.addEventListener('kyalulu-talk-split', update); return () => window.removeEventListener('kyalulu-talk-split', update); }, []);
  const split = talkSplit && location.pathname === '/chats';
  const rail = inChat || split;

  const home = location.pathname === "/";
  const account = guest ? (en ? 'Sign in / Sign up' : 'ログイン / 新規登録') : displayName;
  const openSearch = () => guest ? navigate('/discover') : setPaletteOpen(true);

  return (
    <div className={`k-shell ${inChat ? "k-shell--chat" : ""} ${split ? "k-shell--talk-split" : ""} ${home ? "k-shell--home" : ""} ${/^\/(characters|profile)\/./.test(location.pathname) || location.pathname === "/create/settings" || (location.pathname === "/create" && /[?&](edit|preview)=/.test(location.search)) ? "k-shell--immersive" : ""}`}>
      <nav className={`k-shell__sidebar ${rail ? "k-shell__sidebar--compact" : ""}`} aria-label={en ? 'Main navigation' : 'メインナビゲーション'}>
        <Link to="/" className="k-shell__logo" aria-label={en ? 'Kyalulu Home' : 'Kyalulu ホーム'}>
          <img className="k-shell__logo-mark" src={`${import.meta.env.BASE_URL}mascot/v2/face-default.webp`} alt="" aria-hidden="true" width={32} height={32} />
          <span className="k-shell__wordmark">Kyalulu</span>
        </Link>
        <div className="k-shell__nav-group">
          {NAV.map((item) => (
            <NavItem key={item.to} to={item.to} icon={<Icon name={item.icon} size={22} />} label={navLabel(item.to)} compact={rail} active={sidebarSection(location.pathname) === item.to} />
          ))}
        </div>
      </nav>

      <div className="k-shell__column">
        <header className="k-shell__header">
          <Link to="/" className="k-shell__logo k-shell__logo--mobile" aria-label={en ? 'Kyalulu Home' : 'Kyalulu ホーム'}>
            <img className="k-shell__logo-mark" src={`${import.meta.env.BASE_URL}mascot/v2/face-default.webp`} alt="" aria-hidden="true" width={30} height={30} />
            <span className="k-shell__wordmark">Kyalulu</span>
          </Link>
          <button type="button" className="k-shell__search" onClick={openSearch} aria-label={en ? 'Search by mood, scene or #tag' : '気分・場面・#タグで探す'}>
            <Icon name="search" size={20} />
            <span className="k-shell__search-text">{(location.pathname === '/discover' && new URLSearchParams(location.search).get('q')) || (en ? 'Search by mood, scene or #tag' : '気分・場面・#タグで探す')}</span>
          </button>
          <Link to="/profile" className="k-shell__account" title={account}>
            {guest ? <span className="k-shell__account-label">{account}</span> : <span className="k-shell__account-avatar" aria-hidden="true">{avatar ? <img src={avatar} alt="" /> : displayName.trim().charAt(0)}</span>}
            <span className="k-shell__profile-name">{account}</span>
          </Link>
        </header>

        <main className="k-shell__main" id="main" ref={mainRef}>
          {['/','/discover'].includes(location.pathname)&&<AdBanner/>}
          {accountSync.error && location.pathname!=='/profile' && <div className="k-shell__sync-alert" role="alert">{accountSync.error} <Link to="/profile">{en ? 'Review in My page' : 'マイページで確認'}</Link></div>}
          <Outlet />
        </main>

      <nav className="k-shell__bottomnav" aria-label={en ? 'Mobile navigation' : 'モバイルナビゲーション'}>
        <div className="k-shell__bottomnav-row">
          {NAV.map((item) => {
            const active = location.pathname === item.to || location.pathname.startsWith(`${item.to}/`) ||
              (item.to === "/discover" && location.pathname.startsWith("/characters/"));
            return (
              <Link key={item.to} to={item.to} aria-current={active ? "page" : undefined} className={`k-shell__bottomnav-item ${active ? "active" : ""}`}>
                <span className="k-shell__bottomnav-pill"><Icon name={item.icon} size={22} /></span>
                <span>{navLabel(item.to)}</span>
              </Link>
            );
          })}
        </div>
      </nav>
      </div>

      {guest ? null : <CommandPalette open={paletteOpen} onClose={closePalette} />}
      <CreditOptions/>
      <UnifiedSync/>
    </div>
  );
}
