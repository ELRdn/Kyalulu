import { RuntimeImage } from '../components/RuntimeMedia';
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { type CharacterInfo, type SessionInfo, type WorldInfo } from "../lib/api";
import Button from "../components/ui/Button";
import EmptyState from "../components/ui/EmptyState";
import Icon from "../components/ui/Icon";
import Avatar, { gradientFor } from "../components/ui/Avatar";
import CharacterCard from "../components/ui/CharacterCard";
import SessionRow from "../components/ui/SessionRow";
import ScenePreview from "../components/ScenePreview";
import { moodsOf } from "../lib/moodTaxonomy";
import { startNewSession } from "../lib/session";
import { cleanPreview, displayProfileText, formatCount } from "../lib/text";
import { useAdultContent } from "../lib/adult";
import { useSavedCharacters, toggleSaved } from "../lib/saved";
import { friendlyMessage } from "../lib/errors";
import { useDocumentTitle } from "../lib/title";
import "./pages.css";
import "./characterEntry.css";
import { useRuntimeAccess } from '../components/RuntimeGate';
import { fetchBrowseCatalog, isCloudGuest, loginPath } from '../lib/cloudGuest';
import { useLanguage } from '../lib/appContext';

type Character = CharacterInfo & { nsfw?: boolean; species?: string; age?: string; personality?: string; speaking_style?: string; portrait_urls?: string[] };

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
  const [portraitIndex, setPortraitIndex] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [adult] = useAdultContent();
  const saved = useSavedCharacters();
  const heroRef = useRef<HTMLDivElement>(null);

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
    setPortraitIndex(0);
    setProfileOpen(false);
  }, [characterId]);

  // ヒーロー画像が隠れたら、上部バーを不透明にして名前を出す
  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setScrolled(entry.intersectionRatio < 0.25), { threshold: [0, 0.25, 1] });
    io.observe(el);
    return () => io.disconnect();
  }, [loading, characterId]);

  const character = characters.find((c) => c.id === characterId);
  useDocumentTitle(loading ? null : loadError ? (en ? 'Could not load character' : 'キャラクターを読み込めませんでした') : character?.display_name ?? (en ? 'Character not found' : 'キャラクターが見つかりません'));

  const recommendations = useMemo(() => {
    if (!character) return [];
    const mine = new Set(moodsOf(character.tags).map((m) => m.tag));
    return characters
      .filter((c) => c.id !== character.id && (adult || !c.nsfw))
      .map((c) => ({ c, score: moodsOf(c.tags).filter((m) => mine.has(m.tag)).length + (c.official ? 0.5 : 0) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
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
          mascot="shy"
          title={en ? 'Could not load character' : 'キャラクターを読み込めませんでした'}
          description={friendlyMessage(loadError.cause, language)}
          action={<Button variant="secondary" onClick={() => setReload((value) => value + 1)}>{en ? 'Retry' : '再読み込み'}</Button>}
        />
      </div>
    );
  }

  if (!character) {
    return (
      <div className="k-page">
        <EmptyState
          mascot="shy"
          title={en ? 'Character not found' : 'キャラクターが見つかりません'}
          description={en ? 'The character may have been deleted, or the URL may be incorrect.' : '削除されたか、URLが間違っている可能性があります。'}
          action={
            <Button variant="secondary" onClick={() => navigate("/discover")}>
              {en ? 'Back to Explore' : 'ディスカバーへ戻る'}
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
              <Button variant="primary" onClick={() => navigate("/profile#adult")}>
                <Icon name="lock" size={15} /> {en ? 'Open Settings' : '設定をひらく'}
              </Button>
              <Button variant="ghost" onClick={() => navigate("/discover")}>
                {en ? 'Back to Explore' : 'ディスカバーへ戻る'}
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  const name = character.display_name;
  const portraits = [...new Set([character.portrait_url, ...(character.portrait_urls ?? [])].filter((url): url is string => !!url))];
  const portrait = portraits[portraitIndex] ?? portraits[0];
  const greetings = [character.intro ?? "", ...(character.alternate_greetings ?? [])].filter((g) => g.trim());
  const greeting = greetings[greetingIndex] ?? "";
  const moods = moodsOf(character.tags, language);
  const mySessions = sessions.filter((s) => s.count > 0 && s.character_id === character.id);
  const pastSessions = mySessions.slice(0, 3);
  const talkCount = mySessions.reduce((n, s) => n + s.count, 0);
  const isSaved = saved.includes(character.id);
  const [tagline, about] = splitDescription(character.description ?? "");
  const facts = [
    [en ? 'Species' : '種族', character.species],
    [en ? 'Age' : '年齢', character.age],
  ].filter((f): f is [string, string] => !!f[1]?.trim());
  const personality = displayProfileText(character.personality, name, language);
  const speaking = displayProfileText(character.speaking_style, name, language);
  const hasProfile = facts.length > 0 || !!personality || !!speaking;
  const profileLong = (personality + speaking).length > 220;
  const creator = character.official ? "Kyalulu Official" : en ? 'My library' : 'マイライブラリ';

  const handleStart = async () => {
    if (guest) { navigate(loginPath(`/characters/${encodeURIComponent(character.id)}`)); return; }
    setStarting(true);
    setError(null);
    try {
      const temperature = character.recommended_generation?.temperature;
      const sessionId = await startNewSession({ characterId: character.id, intro: greeting, temperature: typeof temperature === "number" ? temperature : undefined });
      navigate(`/chats/${encodeURIComponent(sessionId)}`);
    } catch (e) {
      setError({ cause: e });
      setStarting(false);
    }
  };
  const resume = () => pastSessions[0] && navigate(`/chats/${encodeURIComponent(pastSessions[0].session_id)}`);
  const save = () => toggleSaved(character.id);
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate("/discover"));

  const art = portrait ? (
    <RuntimeImage src={portrait} alt={name} />
  ) : (
    <span className="k-char-entry__sigil" aria-hidden="true">
      {name.trim().charAt(0)}
    </span>
  );

  return (
    <div className="k-plot">
      <div className="k-plot-backdrop" style={{ background: gradientFor(character.id) }} aria-hidden="true">{portrait && <RuntimeImage src={portrait} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}</div>

      <header className={`k-plot-bar ${scrolled ? "is-solid" : ""}`}>
        <button type="button" className="k-plot-bar__btn" onClick={back} aria-label={en ? 'Back' : '戻る'}>
          <Icon name="back" size={20} />
        </button>
        <span className="k-plot-bar__title" aria-hidden={!scrolled}>
          {name}
        </span>
        <button type="button" className={`k-plot-bar__btn ${isSaved ? "is-on" : ""}`} onClick={save} aria-pressed={isSaved} aria-label={isSaved ? (en ? 'Unsave' : '保存を解除') : guest ? (en ? 'Save in this browser' : 'このブラウザに保存する') : (en ? 'Save' : '保存する')}>
          <Icon name="heart" size={19} />
        </button>
      </header>

      <div ref={heroRef} className="k-plot-hero">
        <div className="k-plot-hero__art" style={portrait ? undefined : { background: gradientFor(character.id) }}>
          {art}
          <span className="k-char-card__sparkles" aria-hidden="true" />
        </div>
        {moods[0] && <span className="k-plot-hero__badge">{moods[0].label}</span>}
        {portraits.length > 1 && (
          <div className="k-plot-hero__photos" role="group" aria-label={en ? 'Choose a portrait' : '写真を選択'}>
            {portraits.map((url, index) => (
              <button key={url} type="button" aria-label={en ? `Show portrait ${index + 1}` : `写真 ${index + 1} を表示`} aria-pressed={index === portraitIndex} onClick={() => setPortraitIndex(index)}>
                <RuntimeImage src={url} alt="" />
              </button>
            ))}
          </div>
        )}
        <button type="button" className={`k-plot-hero__save ${isSaved ? "is-on" : ""}`} onClick={save} aria-pressed={isSaved}>
          <Icon name="heart" size={15} /> {isSaved ? (en ? 'Saved' : '保存済み') : (en ? 'Save' : '保存')}
        </button>
      </div>

      <div className="k-plot-body">
        <section className="k-plot-head">
          <h1 className="k-plot-title">{name}</h1>
          {tagline && <p className="k-plot-tagline">{tagline}</p>}
          {moods.length > 0 && (
            <div className="k-plot-hashtags">
              {moods.map((m) => (
                <Link key={m.tag} to={`/discover?mood=${encodeURIComponent(m.tag)}`}>
                  #{m.label}
                </Link>
              ))}
            </div>
          )}
          <div className="k-plot-stats">
            <span className="k-plot-stat" title={en ? 'Total messages' : 'これまでのメッセージ数'}>
              <Icon name="chat" size={13} /> {formatCount(talkCount, language)}
            </span>
            {greetings.length > 1 && (
              <span className="k-plot-stat">
                <Icon name="play" size={12} /> {en ? `${greetings.length} opening scenes` : `はじまり ${greetings.length}種`}
              </span>
            )}
            {worlds.length > 0 && (
              <span className="k-plot-stat">
                <Icon name="globe" size={13} /> {en ? `${worlds.length} worlds` : `ワールド ${worlds.length}`}
              </span>
            )}
            {character.nsfw && <span className="k-plot-stat k-plot-stat--adult">{en ? 'Adult' : '成人向け'}</span>}
          </div>
        </section>

        <div className="k-plot-creator">
          <Avatar name={creator} size="md" mascot={character.official} src={character.official ? undefined : null} seed={creator} />
          <div className="k-plot-creator__who">
            <span className="k-plot-creator__name">{creator}</span>
            <span className="k-plot-creator__sub">{character.official ? "@kyalulu" : en ? 'A character you imported' : 'あなたが取り込んだキャラクター'}</span>
          </div>
          {character.library_revision && (
            <Link to={`/create?edit=${character.id}`} className="k-plot-creator__edit">
              <Icon name="edit" size={14} /> {en ? 'Edit' : '編集'}
            </Link>
          )}
        </div>

        {pastSessions[0] && (
          <button type="button" className="k-plot-notice" onClick={resume}>
            <Icon name="chat" size={16} />
            <span>
              {en ? <>You have a conversation with <strong>{name}</strong>. <em>Resume now</em></> : <><strong>{name}</strong>との会話のつづきがあります。<em>今すぐ再開</em></>}
            </span>
            <Icon name="chevron" size={15} />
          </button>
        )}

        {error && (
          <p role="alert" className="k-inline-error">
            {en ? 'Could not start the conversation. ' : '会話をはじめられませんでした。'}{friendlyMessage(error.cause, language)}
          </p>
        )}

        {about && (
          <section className="k-plot-section">
            <h2 className="k-plot-section__title">{en ? 'About' : '紹介'}</h2>
            <p className="k-plot-text">{about}</p>
          </section>
        )}

        {hasProfile && (
          <section className="k-plot-section">
            <h2 className="k-plot-section__title">{en ? 'Profile' : 'プロフィール'}</h2>
            <div className="k-plot-card">
              <div className="k-plot-profile__top">
                <span className="k-plot-thumb" style={character.portrait_url ? undefined : { background: gradientFor(character.id) }}>
                  {character.portrait_url ? <RuntimeImage src={character.portrait_url} alt="" /> : <span>{name.trim().charAt(0)}</span>}
                </span>
                <div className="k-plot-profile__id">
                  <div className="k-plot-profile__name">{name}</div>
                  {facts.length > 0 && (
                    <dl className="k-plot-facts">
                      {facts.map(([k, v]) => (
                        <div key={k}>
                          <dt>{k}</dt>
                          <dd>{v}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              </div>
              {(personality || speaking) && (
                <div className={`k-plot-profile__body ${profileLong && !profileOpen ? "is-clamped" : ""}`}>
                  {personality && (
                    <>
                      <h3>{en ? 'Personality' : '性格'}</h3>
                      <p className="k-plot-text">{personality}</p>
                    </>
                  )}
                  {speaking && (
                    <>
                      <h3>{en ? 'Speaking style' : '話し方'}</h3>
                      <p className="k-plot-text">{speaking}</p>
                    </>
                  )}
                </div>
              )}
              {profileLong && (
                <button type="button" className="k-plot-more" onClick={() => setProfileOpen((v) => !v)} aria-expanded={profileOpen}>
                  {profileOpen ? (en ? 'Collapse' : '閉じる') : (en ? 'Show all' : 'すべて表示')} <Icon name="chevron" size={13} style={{ transform: profileOpen ? "rotate(-90deg)" : "rotate(90deg)" }} />
                </button>
              )}
            </div>
          </section>
        )}

        {worlds.length > 0 && (
          <section className="k-plot-section">
            <h2 className="k-plot-section__title">{en ? 'Worlds to explore' : '出会えるワールド'}</h2>
            <div className="k-plot-list">
              {worlds.map((w) => (
                <Link key={w.id} to={`/discover?world=${encodeURIComponent(w.id)}`} className="k-plot-list__item">
                  <span className="k-plot-list__body">
                    <span className="k-plot-list__name">{w.display_name}</span>
                    <span className="k-plot-list__desc">{w.description}</span>
                  </span>
                  <Icon name="chevron" size={16} />
                </Link>
              ))}
            </div>
          </section>
        )}

        {greeting && (
          <section className="k-plot-section">
            <h2 className="k-plot-section__title">{en ? 'Opening scene' : 'イントロ'}</h2>
            {greetings.length > 1 && (
              <div className="k-plot-tabs" role="tablist" aria-label={en ? 'Choose an opening scene' : 'はじまりのシーンを選ぶ'}>
                {greetings.map((g, i) => (
                  <button key={i} type="button" role="tab" aria-selected={i === greetingIndex} className={i === greetingIndex ? "is-active" : ""} onClick={() => setGreetingIndex(i)} title={cleanPreview(g, 80)}>
                    {en ? `Scene ${i + 1}` : `シーン${i + 1}`}
                  </button>
                ))}
              </div>
            )}
            <ScenePreview name={name} seed={character.id} portrait={character.portrait_url} content={greeting} />
            <p className="k-plot-hint">{en ? '“Start conversation” begins your story from this scene.' : '「会話をはじめる」と、このシーンから物語がはじまります。'}</p>
          </section>
        )}

        {pastSessions.length > 0 && (
          <section className="k-plot-section">
            <h2 className="k-plot-section__title">{en ? `Conversations with ${name}` : `${name}との会話`}</h2>
            <div className="k-chat-list">
              {pastSessions.map((s) => (
                <SessionRow key={s.session_id} session={s} worldName={worlds.find((w) => w.id === s.world_id)?.display_name} />
              ))}
            </div>
          </section>
        )}

        {recommendations.length > 0 && (
          <section className="k-plot-section">
            <h2 className="k-plot-section__title">{en ? `If you like ${name}` : `${name}が気に入ったなら？`}</h2>
            <div className="k-plot-recs">
              {recommendations.map((c) => (
                <CharacterCard key={c.id} id={c.id} displayName={c.display_name} hook={c.description} creator={c.official ? "Kyalulu Official" : en ? 'My library' : 'マイライブラリ'} tags={c.tags ?? []} portraitUrl={c.portrait_url} />
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="k-plot-cta">
        {pastSessions[0] && (
          <Button variant="secondary" size="lg" onClick={resume} className="k-plot-cta__sub">
            {en ? 'Resume conversation' : 'つづきから'}
          </Button>
        )}
        <Button variant="primary" size="lg" className="k-plot-cta__main k-btn--glow" onClick={handleStart} disabled={starting}>
          {starting ? (en ? 'Preparing…' : '準備中…') : guest ? (en ? 'Sign in to start a conversation' : 'ログインして会話をはじめる') : pastSessions[0] ? (en ? 'Start a new conversation' : '新しくはじめる') : (en ? 'Start conversation' : '会話をはじめる')} <Icon name="sparkle" size={16} />
        </Button>
      </div>
    </div>
  );
}
