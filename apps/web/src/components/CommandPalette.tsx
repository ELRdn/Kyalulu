import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { fetchCharacters, fetchSessions, fetchWorlds, sessionTitle, type CharacterInfo, type SessionInfo, type WorldInfo } from "../lib/api";
import { cleanPreview } from "../lib/text";
import { moodsOf } from "../lib/moodTaxonomy";
import { useTheme } from "../lib/theme";
import { newSessionId } from "../lib/session";
import Avatar from "./ui/Avatar";
import Icon, { type IconName } from "./ui/Icon";
import Dialog from "./ui/Dialog";
import "./commandPalette.css";
import { useAdministrative } from './RuntimeGate';
import { useLanguage } from '../lib/appContext';

type Item = { id: string; group: string; label: string; hint?: string; keywords: string; leading: ReactNode; run: () => void };

/** ⌘K / Ctrl+K で開く横断検索。キャラクター・会話・ワールド・画面・操作を1か所から呼び出す。 */
export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const language = useLanguage(), en = language === 'en';
  const administrative = useAdministrative();
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    fetchCharacters().then(setCharacters).catch(() => {});
    fetchSessions().then(setSessions).catch(() => {});
    fetchWorlds().then(setWorlds).catch(() => {});
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const go = (to: string) => () => {
      onClose();
      navigate(to);
    };
    const icon = (name: IconName) => (
      <span className="k-cmd__glyph">
        <Icon name={name} size={16} />
      </span>
    );
    const q = query.trim();
    const list: Item[] = [];
    if (q) {
      list.push({ id: "search", group: en ? 'Search' : '検索', label: en ? `Search Explore for “${q}”` : `「${q}」をディスカバーで探す`, keywords: q, leading: icon("search"), run: go(`/discover?q=${encodeURIComponent(q)}`) });
    }
    for (const c of q ? characters : characters.slice(0, 6)) {
      const moods = [...moodsOf(c.tags, 'ja'), ...moodsOf(c.tags, 'en')].map(m => m.label);
      list.push({
        id: `c:${c.id}`,
        group: en ? 'Characters' : 'キャラクター',
        label: c.display_name,
        hint: c.description,
        keywords: [c.display_name, c.description, ...moods].join(" "),
        leading: <Avatar name={c.display_name} seed={c.id} size="sm" src={c.portrait_url} />,
        run: go(`/characters/${encodeURIComponent(c.id)}`),
      });
    }
    for (const s of sessions.filter((x) => x.count > 0).slice(0, q ? 30 : 4)) {
      const name = sessionTitle(s, language);
      const preview = cleanPreview(s.last_preview, 60);
      list.push({
        id: `s:${s.session_id}`,
        group: en ? 'Conversations' : '会話',
        label: name,
        hint: preview,
        keywords: `${sessionTitle(s, 'ja')} ${sessionTitle(s, 'en')} ${preview}`,
        leading: <Avatar name={name} seed={s.character_id ?? s.session_id} size="sm" src={s.portrait_url} mascot={!s.character_name} />,
        run: go(`/chats/${encodeURIComponent(s.session_id)}`),
      });
    }
    for (const w of worlds) {
      list.push({ id: `w:${w.id}`, group: en ? 'Worlds' : 'ワールド', label: w.display_name, hint: w.description, keywords: `${w.display_name} ${w.description}`, leading: icon("globe"), run: go(`/discover?world=${encodeURIComponent(w.id)}`) });
    }
    const pages: [string, string, string, IconName, string][] = [
      ["ホーム", 'Home', "/", "home", "home"],
      ["ディスカバー", 'Explore', "/discover", "compass", "discover"],
      ["チャット", 'Chats', "/chats", "chat", "chats"],
      ["クリエイト（取り込み・編集）", 'Create (import & edit)', "/create", "pen", "create import"],
      ["プロフィール", 'Settings', "/profile", "user", "profile settings"],
      ["スタジオ（上級者向け）", 'Studio (advanced)', "/studio", "settings", "studio research status"],
    ];
    for (const [ja, english, to, name, kw] of pages) {
      if (to === '/studio' && !administrative) continue;
      list.push({ id: `p:${to}`, group: en ? 'Navigate' : '移動', label: en ? english : ja, keywords: `${ja} ${english} ${kw}`, leading: icon(name), run: go(to) });
    }
    list.push({
      id: "a:theme",
      group: en ? 'Actions' : '操作',
      label: theme === "dark" ? (en ? 'Switch to light mode' : 'ライトモードに切り替える') : (en ? 'Switch to dark mode' : 'ダークモードに切り替える'),
      keywords: "theme dark light テーマ ダーク ライト",
      leading: icon(theme === "dark" ? "sun" : "moon"),
      run: () => {
        toggle();
        onClose();
      },
    });
    list.push({ id: "a:new", group: en ? 'Actions' : '操作', label: en ? 'Start a new chat' : '新しいチャットをはじめる', keywords: "new chat 新規 チャット", leading: icon("plus"), run: () => { onClose(); navigate(`/chats/${encodeURIComponent(newSessionId())}`); } });

    if (!q) return list;
    const needle = q.toLowerCase();
    return list.filter((i) => i.id === "search" || i.keywords.toLowerCase().includes(needle));
  }, [query, characters, sessions, worlds, theme, toggle, navigate, onClose, administrative, language]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[active]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  let lastGroup = "";
  return (
    <Dialog open={open} onClose={onClose} label={en ? 'Search and commands' : '検索とコマンド'} contentClassName="k-cmd" overlayClassName="k-cmd-overlay">
        <div className="k-cmd__search">
          <Icon name="search" size={18} />
          <input
            data-autofocus
            onKeyDown={onKeyDown}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={en ? 'Search characters, conversations, worlds and pages…' : 'キャラクター、会話、ワールド、画面を検索…'}
            aria-label={en ? 'Search' : '検索'}
            role="combobox"
            aria-expanded="true"
            aria-controls="k-cmd-list"
            aria-activedescendant={items[active] ? `k-cmd-${active}` : undefined}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="k-cmd__list" id="k-cmd-list" role="listbox" tabIndex={-1} ref={listRef}>
          {items.length === 0 && (
            <div className="k-cmd__empty">
              <img src={`${import.meta.env.BASE_URL}mascot/v1.2/face-curious.png`} alt="" />
              {en ? 'No results found…' : '見つからなかったみたい…'}
            </div>
          )}
          {items.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {header && <div className="k-cmd__group">{header}</div>}
                <div
                  id={`k-cmd-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  className={`k-cmd__item ${i === active ? "is-active" : ""}`}
                  onMouseMove={() => setActive(i)}
                  onClick={item.run}
                >
                  {item.leading}
                  <div className="k-cmd__text">
                    <span className="k-cmd__label">{item.label}</span>
                    {item.hint && <span className="k-cmd__hint">{item.hint}</span>}
                  </div>
                  {i === active && <Icon name="arrow" size={15} className="k-cmd__enter" />}
                </div>
              </div>
            );
          })}
        </div>
        <div className="k-cmd__foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> {en ? 'Select' : '選択'}
          </span>
          <span>
            <kbd>Enter</kbd> {en ? 'Open' : '開く'}
          </span>
          <span className="k-cmd__brand">✦ Kyalulu</span>
        </div>
    </Dialog>
  );
}
