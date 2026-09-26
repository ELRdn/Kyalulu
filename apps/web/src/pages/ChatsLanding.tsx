import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchCharacters, fetchSessions, fetchWorlds, sessionTitle, type CharacterInfo, type SessionInfo, type WorldInfo } from "../lib/api";
import { gradientFor } from "../components/ui/Avatar";
import { useSavedCharacters } from "../lib/saved";
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

export default function ChatsLanding() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [oldestFirst, setOldestFirst] = useState(false);
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [adult] = useAdultContent();
  const savedIds = useSavedCharacters();
  const pinned = usePinnedSessions();
  const navigate = useNavigate();
  useDocumentTitle("チャット");

  useEffect(() => {
    Promise.all([fetchSessions().catch(() => []), fetchWorlds().catch(() => [])])
      .then(([s, w]) => {
        setSessions(s);
        setWorlds(w);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchCharacters(adult).then(setCharacters).catch(() => setCharacters([]));
  }, [adult]);

  const saved = useMemo(() => {
    const byId = new Map(characters.map((c) => [c.id, c]));
    return savedIds.map((id) => byId.get(id)).filter((c): c is CharacterInfo => !!c);
  }, [characters, savedIds]);

  const worldName = (id?: string | null) => worlds.find((w) => w.id === id)?.display_name;

  const { pinnedList, recentList } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const withData = sessions.filter((s) => s.count > 0);
    const matched = q ? withData.filter((s) => `${sessionTitle(s)} ${cleanPreview(s.last_preview, 400)}`.toLowerCase().includes(q)) : withData;
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
          <h1 className="k-page-title">チャット</h1>
          <p className="k-page-sub">これまでの会話を、いつでも続きから。</p>
        </div>
        <Button variant="primary" onClick={handleNew}>
          <Icon name="plus" size={16} /> 新しいチャット
        </Button>
      </div>

      {saved.length > 0 && !query && (
        <section className="k-section k-saved-strip" aria-labelledby="k-saved-title">
          <div className="k-section__head">
            <h2 id="k-saved-title" className="k-section__title k-section__title--sm">
              <Icon name="heart" size={15} /> 保存したキャラクター
            </h2>
            <Link to="/profile" className="k-section__more">
              すべて見る <Icon name="chevron" size={13} />
            </Link>
          </div>
          <div className="k-saved-strip__row">
            {saved.map((c) => (
              <Link key={c.id} to={`/characters/${encodeURIComponent(c.id)}`} className="k-saved-strip__item" title={c.display_name}>
                <span className="k-saved-strip__art" style={c.portrait_url ? undefined : { background: gradientFor(c.id) }}>
                  {c.portrait_url ? <img src={c.portrait_url} alt="" loading="lazy" /> : <span aria-hidden="true">{c.display_name.trim().charAt(0)}</span>}
                </span>
                <span className="k-saved-strip__name">{c.display_name}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="k-chats-tools">
        <div className="k-search-field">
          <Icon name="search" size={17} />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="キャラクター名や会話の内容で探す…" aria-label="チャットを検索" />
        </div>
        <button type="button" className="k-sort-toggle" onClick={() => setOldestFirst((v) => !v)} aria-label={`並び順：${oldestFirst ? "古い順" : "新しい順"}（押すと切り替え）`}>
          <Icon name="refresh" size={14} /> {oldestFirst ? "古い順" : "新しい順"}
        </button>
      </div>

      {loading ? (
        <div className="k-chat-list">
          {[0, 1, 2].map((i) => (
            <div key={i} className="k-skeleton-row" />
          ))}
        </div>
      ) : empty ? (
        <EmptyState
          mascot={query ? "shy" : "default"}
          title={query ? "見つからなかったみたい" : "まだチャットがありません"}
          description={query ? "別のことばで探してみよう。" : "ディスカバーでキャラクターを見つけて、最初の会話を始めよう。"}
          action={
            !query && (
              <Button variant="secondary" onClick={() => navigate("/discover")}>
                キャラクターを探す
              </Button>
            )
          }
        />
      ) : (
        <>
          {pinnedList.length > 0 && (
            <section className="k-section" style={{ gap: 8 }}>
              <h2 className="k-section__title k-section__title--sm">
                <Icon name="pin" size={15} /> ピン留め
              </h2>
              {rows(pinnedList)}
            </section>
          )}
          {recentList.length > 0 && (
            <section className="k-section" style={{ gap: 8 }}>
              <h2 className="k-section__title k-section__title--sm">
                <Icon name="chat" size={15} /> 最近のチャット
              </h2>
              {rows(recentList)}
            </section>
          )}
        </>
      )}
    </div>
  );
}
