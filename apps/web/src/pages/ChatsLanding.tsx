import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchCharacters, fetchSessions, fetchWorlds, sessionTitle, type CharacterInfo, type SessionInfo, type WorldInfo } from "../lib/api";
import CharacterCard from "../components/ui/CharacterCard";
import CloudLogin from "../components/CloudLogin";
import { useRuntimeAccess } from "../components/RuntimeGate";
import { fetchBrowseCatalog, isCloudGuest } from "../lib/cloudGuest";
import { recommend } from "../lib/recommendations";
import { useAdultContent } from "../lib/adult";
import { Input } from "../components/ui/Input";
import SessionRow from "../components/ui/SessionRow";
import EmptyState from "../components/ui/EmptyState";
import Button from "../components/ui/Button";
import Icon from "../components/ui/Icon";
import { usePinnedSessions, togglePin } from "../lib/pins";
import { newSessionId } from "../lib/session";
import { cleanPreview } from "../lib/text";
import { useDocumentTitle } from "../lib/title";
import "./pages.css";
import { friendlyMessage } from '../lib/errors';
import { useLanguage, usePreferences } from '../lib/appContext';

/** Two picks for someone with nothing (or one chat) in the list (docs/MOBILE_UX_SPEC.md §5.4). */
function Suggestions({ characters, skip = [], title }: { characters: CharacterInfo[]; skip?: (string | null | undefined)[]; title?: string }) {
  const en = useLanguage() === 'en', prefs = usePreferences(), [adult] = useAdultContent();
  const picks = recommend(characters.filter((c) => !skip.includes(c.id)), prefs, adult).slice(0, 2);
  if (!picks.length) return null;
  return (
    <section className="k-section" aria-label={title ?? (en ? 'Suggested characters' : 'おすすめ')}>
      {title && <h2 className="k-section__title k-section__title--sm">{title}</h2>}
      <div className="k-grid k-grid--characters">
        {picks.map((c) => <CharacterCard key={c.id} id={c.id} displayName={c.display_name} hook={c.hook || c.description} tags={c.tags ?? []} creator={c.official ? "Kyalulu Official" : en ? 'My library' : 'マイライブラリ'} portraitUrl={c.portrait_url} />)}
      </div>
    </section>
  );
}

export default function ChatsLanding() {
  const en = useLanguage() === 'en';
  useDocumentTitle(en ? 'Chats' : 'トーク');
  return isCloudGuest(useRuntimeAccess()) ? <GuestChats /> : <MemberChats />;
}

function GuestChats() {
  const language = useLanguage(), en = language === 'en';
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [loginOpen, setLoginOpen] = useState(false);
  const [adult] = useAdultContent();
  useEffect(() => {
    let active = true;
    fetchBrowseCatalog(true, adult).then(([c]) => { if (active) setCharacters(c); }).catch(() => { /* Suggestions are optional. */ });
    return () => { active = false; };
  }, [adult]);
  return (
    <div className="k-page" style={{ maxWidth: 780 }}>
      <h1 className="k-page-title">{en ? 'Chats' : 'トーク'}</h1>
      <EmptyState mascot="default" title={en ? 'The characters you talk with will appear here.' : '話した相手がここに並びます'}
        action={<button type="button" className="k-text-link" onClick={() => setLoginOpen(true)}>{en ? 'Already have an account? Sign in' : 'ログインして続きを見る'}</button>} />
      <Suggestions characters={characters} />
      {loginOpen && <CloudLogin returnTo="/chats" onClose={() => setLoginOpen(false)} />}
    </div>
  );
}

function MemberChats() {
  const language = useLanguage(), en = language === 'en';
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{cause:unknown}|null>(null);
  const [catalogError, setCatalogError] = useState<{cause:unknown}|null>(null);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [oldestFirst, setOldestFirst] = useState(false);
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [adult] = useAdultContent();
  const pinned = usePinnedSessions();
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    Promise.all([fetchSessions(), fetchWorlds()])
      .then(([s, w]) => {
        if (!active) return;
        setSessions(s);
        setWorlds(w);
      })
      .catch(error => { if (active) setLoadError({cause:error}); })
      .finally(() => { if (active) setLoading(false); });
    const refresh = () => { if (document.visibilityState === 'visible') setRetry(n => n + 1); };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return () => { active = false; document.removeEventListener('visibilitychange', refresh); window.removeEventListener('online', refresh); };
  }, [retry]);

  useEffect(() => {
    let active = true; setCatalogError(null);
    fetchCharacters(adult).then(value => { if (active) setCharacters(value); }).catch(error => { if (active) setCatalogError({cause:error}); });
    return () => { active = false; };
  }, [adult, retry]);

  const worldName = (id?: string | null) => worlds.find((w) => w.id === id)?.display_name;

  const { pinnedList, recentList } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const withData = sessions.filter((s) => s.count > 0);
    const matched = q ? withData.filter((s) => `${sessionTitle(s, 'ja')} ${sessionTitle(s, 'en')} ${cleanPreview(s.last_preview, 400)}`.toLowerCase().includes(q)) : withData;
    const time = (s: SessionInfo) => Date.parse(s.last_at ?? "") || 0;
    const list = [...matched].sort((a, b) => (oldestFirst ? time(a) - time(b) : time(b) - time(a)));
    return {
      pinnedList: list.filter((s) => pinned.includes(s.session_id)),
      recentList: list.filter((s) => !pinned.includes(s.session_id)),
    };
  }, [sessions, query, pinned, oldestFirst]);

  const handleNew = () => navigate(`/chats/${encodeURIComponent(newSessionId())}`);

  const rows = (list: SessionInfo[]) => (
    <div className="k-chat-list">
      {list.map((s) => (
        <SessionRow key={s.session_id} session={s} worldName={worldName(s.world_id)} pinned={pinned.includes(s.session_id)} onTogglePin={() => togglePin(s.session_id)} />
      ))}
    </div>
  );

  const empty = !loading && pinnedList.length === 0 && recentList.length === 0;

  return (
    <div className="k-page" style={{ maxWidth: 780 }}>
      <div className="k-page-head">
        <div>
          <h1 className="k-page-title">{en ? 'Chats' : 'トーク'}</h1>
          <p className="k-page-sub">{en ? 'Pick up your conversations where you left off.' : 'これまでの会話を、いつでも続きから。'}</p>
        </div>
        <Button variant="primary" onClick={handleNew}>
          <Icon name="plus" size={16} /> {en ? 'New chat' : '新しいチャット'}
        </Button>
      </div>

      {catalogError && <p role="alert">{friendlyMessage(catalogError.cause,language)}<Button size="sm" variant="ghost" onClick={() => setRetry(value => value + 1)}>{en ? 'Reload' : '再読込'}</Button></p>}
      <div className="k-chats-tools">
        <div className="k-search-field">
          <Icon name="search" size={17} />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={en ? 'Search character names and conversation text…' : 'キャラクター名や会話の内容で探す…'} aria-label={en ? 'Search chats' : 'チャットを検索'} />
        </div>
        <button type="button" className="k-sort-toggle" onClick={() => setOldestFirst((v) => !v)} aria-label={en ? `Sort: ${oldestFirst ? 'oldest first' : 'newest first'} (press to switch)` : `並び順：${oldestFirst ? "古い順" : "新しい順"}（押すと切り替え）`}>
          <Icon name="refresh" size={14} /> {oldestFirst ? (en ? 'Oldest first' : '古い順') : (en ? 'Newest first' : '新しい順')}
        </button>
      </div>

      {loading ? (
        <div className="k-chat-list">
          {[0, 1, 2].map((i) => (
            <div key={i} className="k-skeleton-row" />
          ))}
        </div>
      ) : loadError ? (
        <div role="alert"><EmptyState title={en ? 'Could not load conversations' : '会話を読み込めませんでした'} description={friendlyMessage(loadError.cause,language)} action={<Button variant="secondary" onClick={() => setRetry(n => n + 1)}>{en ? 'Retry' : 'もう一度読み込む'}</Button>} /></div>
      ) : empty ? (
        <>
          <EmptyState
            mascot={query ? "shy" : "default"}
            title={query ? (en ? 'No matching chats' : '見つからなかったみたい') : (en ? "You haven't talked with anyone yet." : 'まだ誰とも話していません。')}
            description={query ? (en ? 'Try another search.' : '別のことばで探してみよう。') : undefined}
            action={
              !query && (
                <Button variant="secondary" onClick={() => navigate("/discover")}>
                  {en ? 'Find characters' : 'キャラをさがす'}
                </Button>
              )
            }
          />
          {!query && <Suggestions characters={characters} />}
        </>
      ) : (
        <>
          {pinnedList.length > 0 && (
            <section className="k-section" style={{ gap: 8 }}>
              <h2 className="k-section__title k-section__title--sm">
                <Icon name="pin" size={15} /> {en ? 'Pinned' : 'ピン留め'}
              </h2>
              {rows(pinnedList)}
            </section>
          )}
          {recentList.length > 0 && (
            <section className="k-section" style={{ gap: 8 }}>
              <h2 className="k-section__title k-section__title--sm">
                <Icon name="chat" size={15} /> {en ? 'Recent chats' : '最近のチャット'}
              </h2>
              {rows(recentList)}
            </section>
          )}
          {!query && pinnedList.length + recentList.length === 1 && <Suggestions characters={characters} skip={[...pinnedList, ...recentList].map((s) => s.character_id)} title={en ? 'Who to talk to next' : '次に話すなら'} />}
        </>
      )}
    </div>
  );
}
