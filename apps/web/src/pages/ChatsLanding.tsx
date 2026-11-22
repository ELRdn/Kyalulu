import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteSessionData, eraseConversationConfirm, fetchCharacters, fetchSessions, fetchWorlds, type CharacterInfo, type SessionInfo, type WorldInfo } from "../lib/api";
import { useCapabilities } from "../lib/capabilities";
import { ChatRecovery } from "../lib/chatRecovery";
import { eraseReplyVersions } from "../lib/replyVersions";
import { connectionScope } from "../lib/remoteStore";
import { useConfirm } from "../components/ui/Dialog";
import CharacterCard from "../components/ui/CharacterCard";
import CloudLogin from "../components/CloudLogin";
import { useRuntimeAccess } from "../components/RuntimeGate";
import { fetchBrowseCatalog, isCloudGuest } from "../lib/cloudGuest";
import { recommend } from "../lib/recommendations";
import { useAdultContent } from "../lib/adult";
import SessionRow from "../components/ui/SessionRow";
import EmptyState from "../components/ui/EmptyState";
import Button from "../components/ui/Button";
import Icon from "../components/ui/Icon";
import { usePinnedSessions, togglePin } from "../lib/pins";
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
    <div className="k-page k-talk">
      <h1 className="k-page-title">{en ? 'Chats' : 'トーク'}</h1>
      <EmptyState mascot="default" title={en ? 'The characters you talk with will appear here.' : '話した相手が、ここに並ぶよ'}
        action={<button type="button" className="k-text-link k-text-link--accent" onClick={() => setLoginOpen(true)}>{en ? 'Sign in to save conversations' : 'ログインして会話を保存する'}</button>} />
      <Suggestions characters={characters} title={en ? 'Your first one' : '最初の一人に'} />
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
    const time = (s: SessionInfo) => Date.parse(s.last_at ?? "") || 0;
    const list = sessions.filter((s) => s.count > 0).sort((a, b) => time(b) - time(a));
    return {
      pinnedList: list.filter((s) => pinned.includes(s.session_id)),
      recentList: list.filter((s) => !pinned.includes(s.session_id)),
    };
  }, [sessions, pinned]);

  const { capabilities } = useCapabilities();
  const [confirmDialog, confirm] = useConfirm();
  const canDelete = !!capabilities?.features.permanent_delete;
  // 06: deleting from the list always warns first, with the same notice as the chat's erase action.
  const remove = async (session: SessionInfo) => {
    if (!await confirm({ ...eraseConversationConfirm(en), title: en ? `Permanently erase the conversation with ${session.character_name ?? 'this character'}?` : `${session.character_name ?? 'このキャラ'}との会話を完全消去しますか？` })) return;
    const scope = connectionScope();
    try {
      await deleteSessionData(session.session_id);
      if (scope !== connectionScope()) return;
      if (pinned.includes(session.session_id)) togglePin(session.session_id);
      window.localStorage.removeItem(new ChatRecovery(window.localStorage, scope, session.session_id).key);
      eraseReplyVersions(session.session_id);
      window.localStorage.removeItem(`kyalulu-plain-character:${session.session_id}`);
      setSessions(list => list.filter(item => item.session_id !== session.session_id));
    } catch (error) { setCatalogError({ cause: error }); }
  };

  const rows = (list: SessionInfo[]) => (
    <div className="k-chat-list">
      {list.map((s) => (
        <SessionRow key={s.session_id} session={s} worldName={worldName(s.world_id)} pinned={pinned.includes(s.session_id)} onTogglePin={() => togglePin(s.session_id)} onDelete={canDelete ? () => void remove(s) : undefined} />
      ))}
    </div>
  );

  const total = pinnedList.length + recentList.length;
  const empty = !loading && total === 0;
  const split = total > 1;
  useEffect(() => { window.dispatchEvent(new CustomEvent('kyalulu-talk-split', { detail: split })); return () => { window.dispatchEvent(new CustomEvent('kyalulu-talk-split', { detail: false })); }; }, [split]);

  // PC (P6): the list sits in a 288px column and the room to its right waits for a pick.
  return (
    <div className={`k-page k-talk ${total > 1 ? 'k-talk--split' : ''}`}>
      {confirmDialog}
      <div className="k-talk__list">
        <h1 className="k-page-title">{en ? 'Chats' : 'トーク'}</h1>
        {catalogError && <p role="alert">{friendlyMessage(catalogError.cause,language)}<Button size="sm" variant="ghost" onClick={() => setRetry(value => value + 1)}>{en ? 'Reload' : '再読込'}</Button></p>}
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
            <EmptyState mascot="default" title={en ? "You haven't talked with anyone yet." : 'まだ誰ともお話してないね'}
              action={<Button variant="primary" onClick={() => navigate("/discover")}>{en ? 'Find characters' : 'キャラをさがす'}</Button>} />
            <Suggestions characters={characters} title={en ? 'Your first one' : '最初の一人に'} />
          </>
        ) : (
          <>
            {pinnedList.length > 0 && (
              <section className="k-talk__section" aria-label={en ? 'Pinned' : 'ピン留め'}>
                <h2 className="k-talk__label">{en ? 'Pinned' : 'ピン留め'}</h2>
                {rows(pinnedList)}
              </section>
            )}
            {recentList.length > 0 && (
              <section className="k-talk__section" aria-label={en ? 'Recent' : '最近'}>
                {pinnedList.length > 0 && <h2 className="k-talk__label">{en ? 'Recent' : '最近'}</h2>}
                {rows(recentList)}
              </section>
            )}
            {total > 1 && <p className="k-talk__hint"><Icon name="info" size={16} />{canDelete ? (en ? 'Swipe left to pin or delete' : '左にスワイプでピン留め・削除') : (en ? 'Swipe left to pin' : '左にスワイプでピン留め')}</p>}
            {total === 1 && <Suggestions characters={characters} skip={[...pinnedList, ...recentList].map((s) => s.character_id)} title={en ? 'Who to talk to next' : '次に話すなら'} />}
          </>
        )}
      </div>
      {total > 1 && (
        <div className="k-talk__room">
          <EmptyState mascot="default" title={en ? 'Pick someone to talk to' : '話す相手を選んでね'}
            description={en ? 'Open a conversation on the left, or find a new character.' : '左の一覧から会話を開くか、新しいキャラをさがしましょう。'}
            action={<Button variant="primary" onClick={() => navigate("/discover")}>{en ? 'Find characters' : 'キャラをさがす'}</Button>} />
        </div>
      )}
    </div>
  );
}
