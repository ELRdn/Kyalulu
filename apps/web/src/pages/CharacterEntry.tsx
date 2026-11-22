import { useMediaQuery } from '../lib/useMediaQuery';
import { RuntimeImage } from '../components/RuntimeMedia';
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { type CharacterInfo, type SessionInfo, type WorldInfo } from "../lib/api";
import Button from "../components/ui/Button";
import EmptyState from "../components/ui/EmptyState";
import Icon from "../components/ui/Icon";
import Avatar from "../components/ui/Avatar";
import Dialog from "../components/ui/Dialog";
import ScenePreview from "../components/ScenePreview";
import { moodsOf } from "../lib/moodTaxonomy";
import { startNewSession } from "../lib/session";
import { cleanPreview, displayProfileText } from "../lib/text";
import { useAdultContent } from "../lib/adult";
import { useSavedCharacters, toggleSaved } from "../lib/saved";
import { friendlyMessage } from "../lib/errors";
import { useDocumentTitle } from "../lib/title";
import "./pages.css";
import "./characterEntry.css";
import { useRuntimeAccess } from '../components/RuntimeGate';
import { fetchBrowseCatalog, isCloudGuest, PENDING_START } from '../lib/cloudGuest';
import CloudLogin from '../components/CloudLogin';
import { useLanguage } from '../lib/appContext';

type Character = CharacterInfo & { nsfw?: boolean; species?: string; age?: string; personality?: string; speaking_style?: string; portrait_urls?: string[] };

// Survives the OAuth round trip so the same chat starts after login (docs/MOBILE_UX_SPEC.md §2).
const PENDING = PENDING_START;
const readPending = (): { character: string; text: string } | null => {
  try { const value = JSON.parse(sessionStorage.getItem(PENDING) ?? 'null'); return typeof value?.character === 'string' && typeof value.text === 'string' ? value : null; } catch { return null; }
};

/** 最初の一文をキャッチコピー、残りを紹介文として分ける */
function splitDescription(text: string): [string, string] {
  const t = text.trim();
  const m = t.match(/^(.+?[。！？!?])\s*([\s\S]*)$/);
  return m ? [m[1], m[2].trim()] : [t, ""];
}

export default function CharacterEntry() {
  const language = useLanguage(), en = language === 'en';
  const guest = isCloudGuest(useRuntimeAccess());
  const { characterId } = useParams<{ characterId: string }>();
  const navigate = useNavigate();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ cause: unknown } | null>(null);
  const [loadError, setLoadError] = useState<{ cause: unknown } | null>(null);
  const [reload, setReload] = useState(0);
  const [starting, setStarting] = useState(false);
  const [greetingIndex, setGreetingIndex] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsTab, setDetailsTab] = useState<'about' | 'profile' | 'worlds'>('about');
  const [loginOpen, setLoginOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [repliesOpen, setRepliesOpen] = useState(true);
  const phone = useMediaQuery('(max-width: 767px)');
  const [adult] = useAdultContent();
  const saved = useSavedCharacters();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    fetchBrowseCatalog(guest, true)
      .then(([c, w, s]) => {
        if (!active) return;
        setCharacters(c);
        setWorlds(w);
        setSessions(s);
      })
      .catch((cause) => { if (active) setLoadError({ cause }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload, guest]);

  useEffect(() => {
    setGreetingIndex(0);
    setDetailsOpen(false);
    setDraft('');
    setRepliesOpen(true);
  }, [characterId]);

  const character = characters.find((c) => c.id === characterId);

  const start = async (text = '') => {
    if (!character) return;
    if (guest) {
      try { sessionStorage.setItem(PENDING, JSON.stringify({ character: character.id, text })); } catch { /* Login still works; the pick is lost. */ }
      setLoginOpen(true);
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const temperature = character.recommended_generation?.temperature;
      const intro = [character.intro ?? "", ...(character.alternate_greetings ?? [])].filter((g) => g.trim())[greetingIndex] ?? "";
      const sessionId = await startNewSession({ characterId: character.id, intro, temperature: typeof temperature === "number" ? temperature : undefined });
      navigate(`/chats/${encodeURIComponent(sessionId)}`, { state: text ? { send: text } : undefined });
    } catch (e) {
      setError({ cause: e });
      setStarting(false);
    }
  };
  // Back from login: start the chat the guest asked for, once.
  useEffect(() => {
    const pending = readPending();
    if (guest || !character || pending?.character !== character.id) return;
    sessionStorage.removeItem(PENDING);
    void start(pending.text);
  }, [guest, character?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useDocumentTitle(loading ? null : loadError ? (en ? 'Could not load character' : 'キャラクターを読み込めませんでした') : character?.display_name ?? (en ? 'Character not found' : 'キャラクターが見つかりません'));

  const recommendations = useMemo(() => {
    if (!character) return [];
    const mine = new Set(moodsOf(character.tags).map((m) => m.tag));
    return characters
      .filter((c) => c.id !== character.id && (adult || !c.nsfw))
      .map((c) => ({ c, score: moodsOf(c.tags).filter((m) => mine.has(m.tag)).length + (c.official ? 0.5 : 0) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((x) => x.c);
  }, [characters, character, adult]);

  if (loading) {
    return (
      <div className="k-plot" aria-busy="true">
        <div className="k-plot-hero k-skeleton-card" />
        <div className="k-plot-body">
          <div className="k-skeleton-line k-skeleton-line--lg" style={{ width: "60%" }} />
          <div className="k-skeleton-line" style={{ width: "85%" }} />
          <div className="k-skeleton-line" style={{ width: "40%" }} />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="k-page">
        <EmptyState
          mascot="cry"
          title={en ? 'Could not load character' : 'キャラクターを読み込めませんでした'}
          description={friendlyMessage(loadError.cause, language)}
          action={<Button variant="secondary" onClick={() => setReload((value) => value + 1)}>{en ? 'Retry' : '再読み込み'}</Button>}
        />
      </div>
    );
  }

  if (!character) {
    return (
      <div className="k-page k-notfound k-notfound--entry">
        <EmptyState
          mascot="cry"
          title={en ? 'Character not found' : 'この子とは、いまは話せないみたい…'}
          action={
            <Button onClick={() => navigate("/discover")}>
              {en ? 'Back to Explore' : '似たキャラを見る'}
            </Button>
          }
        />
      </div>
    );
  }

  if (character.nsfw && !adult) {
    return (
      <div className="k-page">
        <EmptyState
          mascot="shy"
          title={en ? 'Adult character' : '成人向けのキャラクターです'}
          description={en ? 'Sign in and complete the required adult verification before enabling adult content in Settings.' : 'ログインと必要な成人確認を済ませ、設定で成人向けコンテンツを有効にしてください。'}
          action={
            <div className="k-empty__actions">
              <Button variant="primary" onClick={() => navigate("/profile/settings#adult")}>
                <Icon name="lock" size={15} /> {en ? 'Open Settings' : '設定をひらく'}
              </Button>
              <Button variant="ghost" onClick={() => navigate("/discover")}>
                {en ? 'Back to Explore' : 'さがすに戻る'}
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  const name = character.display_name;
  const shortName = name.replace(/[（(].*$/, '').replace(/(執事|先輩|ちゃん|さん|くん)$/, '') || name;
  const portrait = character.portrait_url;
  const greetings = [character.intro ?? "", ...(character.alternate_greetings ?? [])].filter((g) => g.trim());
  const greeting = greetings[greetingIndex] ?? "";
  const moods = moodsOf(character.tags, language);
  const mySessions = sessions.filter((s) => s.count > 0 && s.character_id === character.id);
  const isSaved = saved.includes(character.id);
  const replies = character.opening_replies ?? [];
  const facts = [
    [en ? 'Species' : '種族', character.species],
    [en ? 'Age' : '年齢', character.age],
  ].filter((f): f is [string, string] => !!f[1]?.trim());
  const personality = displayProfileText(character.personality, name, language);
  const speaking = displayProfileText(character.speaking_style, name, language);
  const creator = character.official ? (en ? 'Kyalulu Official' : 'Kyalulu公式') : en ? 'My library' : 'マイライブラリ';

  const resume = () => mySessions[0] && navigate(`/chats/${encodeURIComponent(mySessions[0].session_id)}`);
  const save = () => toggleSaved(character.id);
  const share = () => {
    const url = location.href;
    if (navigator.share) void navigator.share({ title: name, url }).catch(() => {});
    else void navigator.clipboard?.writeText(url);
  };
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate("/discover"));

  return (
    <div className="k-plot">
      <div className="k-plot-hero">
        {portrait ? <RuntimeImage src={portrait} alt={name} /> : <span className="k-char-card__initial" aria-hidden="true">{name.trim().charAt(0)}</span>}
      </div>

      <header className="k-plot-bar">
        <button type="button" className="k-plot-bar__btn k-plot-bar__back" onClick={back} aria-label={en ? 'Back' : '戻る'}><Icon name="back" size={22} /></button>
        <span className="k-plot-bar__space" />
        <button type="button" className={`k-plot-bar__btn ${isSaved ? "is-on" : ""}`} onClick={save} aria-pressed={isSaved} aria-label={isSaved ? (en ? 'Unsave' : '保存を解除') : guest ? (en ? 'Save in this browser' : 'このブラウザに保存する') : (en ? 'Save' : '保存する')}>
          <Icon name="bookmark" size={20} />
        </button>
        <button type="button" className="k-plot-bar__btn" onClick={share} aria-label={en ? 'Share' : '共有'}><Icon name="share" size={20} /></button>
      </header>

      <div className="k-plot-body">
        <section className="k-plot-head">
          <h1 className="k-plot-title">{name}</h1>
          <p className="k-plot-tagline">{character.hook || splitDescription(character.description ?? "")[0]}</p>
          <div className="k-plot-hashtags">
            {moods.slice(0, phone ? 3 : 4).map((m) => <Link key={m.tag} to={`/discover?mood=${encodeURIComponent(m.tag)}`}>#{m.label}</Link>)}
            <button type="button" className="k-plot-profile-link" onClick={() => setDetailsOpen(true)}>{en ? 'View profile' : 'プロフィールを見る'} <Icon name="chevron" size={14} /></button>
          </div>
        </section>

        {mySessions[0] && (
          <button type="button" className="k-plot-notice" onClick={resume}>
            <Icon name="chat" size={16} />
            <span>{en ? <>You have a conversation with <strong>{name}</strong>. <em>Resume</em></> : <><strong>{name}</strong>との会話のつづきがあります。<em>つづきから</em></>}</span>
            <Icon name="chevron" size={15} />
          </button>
        )}

        {greetings.length > 1 && (
          <div className="k-plot-tabs" role="tablist" aria-label={en ? 'Choose an opening scene' : 'はじまりのシーンを選ぶ'}>
            {greetings.map((g, i) => (
              <button key={i} type="button" role="tab" aria-selected={i === greetingIndex} className={i === greetingIndex ? "is-active" : ""} onClick={() => setGreetingIndex(i)} title={cleanPreview(g, 80)}>
                {en ? `Scene ${i + 1}` : `シーン${i + 1}`}
              </button>
            ))}
          </div>
        )}
        {greeting && <ScenePreview name={name} seed={character.id} portrait={portrait} content={greeting} />}

        {error && (
          <p role="alert" className="k-inline-error">
            {en ? 'Could not start the conversation. ' : '会話をはじめられませんでした。'}{friendlyMessage(error.cause, language)}
          </p>
        )}

        <div className="k-plot-cta">
          <form className="k-plot-composer" onSubmit={(e) => { e.preventDefault(); void start(draft.trim()); }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={phone ? (en ? 'Message' : 'メッセージ') : en ? `Say something to ${shortName}` : `${shortName}に話しかける`} aria-label={en ? 'First message' : '最初のメッセージ'} disabled={starting} />
            <button type="submit" className="k-plot-cta__main" disabled={starting} aria-label={starting ? (en ? 'Preparing…' : '準備中…') : (en ? 'Start conversation' : '会話をはじめる')}><Icon name="arrowUp" size={20} strokeWidth={2.2} /></button>
          </form>
          {replies.length > 0 && repliesOpen && (
            <div className="k-plot-replies" role="group" aria-labelledby="k-plot-replies-title">
              <div className="k-plot-replies__head">
                <span id="k-plot-replies-title">{en ? 'Pick a first line' : '最初の一言を選ぶ'}</span>
                <button type="button" className="k-plot-replies__close" onClick={() => setRepliesOpen(false)} aria-label={en ? 'Close' : '閉じる'}><Icon name="close" size={18} /></button>
              </div>
              {replies.map((reply) => <button key={reply} type="button" className="k-starter" onClick={() => void start(reply)} disabled={starting}>{reply}</button>)}
              <p className="k-plot-replies__note">{en ? 'Tap to start the conversation' : 'タップで会話をはじめます'}</p>
            </div>
          )}
        </div>
      </div>

      <Dialog open={detailsOpen} onClose={() => setDetailsOpen(false)} label={en ? `About ${name}` : `${name}の詳細`} sheet width={560}>
        <div className="k-plot-details">
          <div className="k-plot-details__tabs" role="tablist">
            {(['about', 'profile', 'worlds'] as const).map((tab) => (
              <button key={tab} type="button" role="tab" aria-selected={detailsTab === tab} className={detailsTab === tab ? 'is-active' : ''} onClick={() => setDetailsTab(tab)}>
                {tab === 'about' ? (en ? 'About' : '紹介') : tab === 'profile' ? (en ? 'Profile' : 'プロフィール') : (en ? 'Worlds' : 'ワールド')}
              </button>
            ))}
          </div>
          {detailsTab === 'about' && <>
            {character.description && <p className="k-plot-text">{character.description}</p>}
            {moods.length > 0 && <div className="k-chip-row">{moods.map((m) => <Link key={m.tag} className="k-chip" to={`/discover?mood=${encodeURIComponent(m.tag)}`}>#{m.label}</Link>)}</div>}
            <div className="k-plot-creator">
              <Avatar name={creator} size="md" mascot={character.official} src={character.official ? undefined : null} seed={creator} />
              <div className="k-plot-creator__who">
                <span className="k-plot-creator__name">{creator}</span>
                <span className="k-plot-creator__sub">{character.official ? (en ? 'Official character' : '公式キャラ') : en ? 'A character you imported' : 'あなたが取り込んだキャラクター'}</span>
              </div>
              {character.library_revision && <Link to={`/create?edit=${character.id}`} className="k-plot-creator__edit"><Icon name="edit" size={14} /> {en ? 'Edit' : '編集'}</Link>}
            </div>
            {recommendations.length > 0 && <section className="k-plot-section">
              <h2 className="k-plot-section__title">{en ? `If you like ${shortName}` : `${shortName}が気に入ったなら`}</h2>
              <div className="k-plot-recs">
                {recommendations.map((c) => (
                  <Link key={c.id} to={`/characters/${encodeURIComponent(c.id)}`} className="k-plot-rec" onClick={() => setDetailsOpen(false)}>
                    <span className="k-plot-rec__art">{c.portrait_url ? <RuntimeImage src={c.portrait_url} alt="" /> : <span className="k-char-card__initial">{c.display_name.trim().charAt(0)}</span>}</span>
                    <span className="k-plot-rec__name">{c.display_name}</span>
                  </Link>
                ))}
              </div>
            </section>}
          </>}
          {detailsTab === 'profile' && <>
            {facts.length > 0 && <dl className="k-plot-facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
            {personality && <><h3 className="k-plot-section__title">{en ? 'Personality' : '性格'}</h3><p className="k-plot-text">{personality}</p></>}
            {speaking && <><h3 className="k-plot-section__title">{en ? 'Speaking style' : '話し方'}</h3><p className="k-plot-text">{speaking}</p></>}
            {!facts.length && !personality && !speaking && <p className="k-plot-text">{en ? 'No profile yet.' : 'プロフィールはまだありません。'}</p>}
          </>}
          {detailsTab === 'worlds' && (worlds.length ? <div className="k-world-list">{worlds.map((w) => <Link key={w.id} to={`/discover?world=${encodeURIComponent(w.id)}`} className="k-world-row" onClick={() => setDetailsOpen(false)}><span className="k-world-row__text"><span className="k-world-row__name">{w.display_name}</span><span className="k-world-row__desc">{w.description}</span></span></Link>)}</div>
            : <p className="k-plot-text">{en ? 'No worlds yet.' : 'ワールドはまだありません。'}</p>)}
        </div>
      </Dialog>

      {loginOpen && <CloudLogin returnTo={`/characters/${encodeURIComponent(character.id)}`} characterName={shortName} firstLine={readPending()?.text || undefined} onClose={() => { sessionStorage.removeItem(PENDING); setLoginOpen(false); }} />}
    </div>
  );
}
