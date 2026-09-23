import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { fetchCharacters, fetchSessions, fetchWorlds, type CharacterInfo, type SessionInfo, type WorldInfo } from "../lib/api";
import Button from "../components/ui/Button";
import EmptyState from "../components/ui/EmptyState";
import Icon from "../components/ui/Icon";
import { gradientFor } from "../components/ui/Avatar";
import SessionRow from "../components/ui/SessionRow";
import ScenePreview from "../components/ScenePreview";
import { moodsOf } from "../lib/moodTaxonomy";
import { startNewSession } from "../lib/session";
import { cleanPreview } from "../lib/text";
import "./pages.css";
import "./characterEntry.css";

type Character = CharacterInfo & { nsfw?: boolean };

export default function CharacterEntry() {
  const { characterId } = useParams<{ characterId: string }>();
  const navigate = useNavigate();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [greetingIndex, setGreetingIndex] = useState(0);

  useEffect(() => {
    Promise.all([fetchCharacters(true).catch(() => []), fetchWorlds().catch(() => []), fetchSessions().catch(() => [])])
      .then(([c, w, s]) => {
        setCharacters(c);
        setWorlds(w);
        setSessions(s);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => setGreetingIndex(0), [characterId]);

  const character = characters.find((c) => c.id === characterId);

  if (loading) {
    return (
      <div className="k-page" style={{ maxWidth: 1080 }}>
        <div className="k-char-entry">
          <div className="k-skeleton-card" style={{ aspectRatio: "3 / 4" }} />
          <div />
        </div>
      </div>
    );
  }

  if (!character) {
    return (
      <div className="k-page">
        <EmptyState
          mascot="shy"
          title="キャラクターが見つかりません"
          description="削除されたか、URLが間違っている可能性があります。"
          action={
            <Button variant="secondary" onClick={() => navigate("/discover")}>
              ディスカバーへ戻る
            </Button>
          }
        />
      </div>
    );
  }

  const greetings = [character.intro ?? "", ...(character.alternate_greetings ?? [])].filter((g) => g.trim());
  const greeting = greetings[greetingIndex] ?? "";
  const moods = moodsOf(character.tags);
  const pastSessions = sessions.filter((s) => s.count > 0 && s.character_id === character.id).slice(0, 3);

  const handleStart = async () => {
    setStarting(true);
    setError(null);
    try {
      const temperature = character.recommended_generation?.temperature;
      const sessionId = await startNewSession({ characterId: character.id, intro: greeting, temperature: typeof temperature === "number" ? temperature : undefined });
      navigate(`/chats/${encodeURIComponent(sessionId)}`);
    } catch (e) {
      setError(`会話を作成できませんでした: ${String(e)}`);
      setStarting(false);
    }
  };

  return (
    <div className="k-page k-page--entry">
      <Link to="/discover" className="k-back-link">
        <Icon name="back" size={15} /> ディスカバー
      </Link>

      <div className="k-char-entry">
        <div className="k-char-entry__art" style={character.portrait_url ? undefined : { background: gradientFor(character.id) }}>
          {character.portrait_url ? (
            <img src={character.portrait_url} alt={character.display_name} />
          ) : (
            <span className="k-char-entry__sigil" aria-hidden="true">
              {character.display_name.trim().charAt(0)}
            </span>
          )}
          <span className="k-char-card__sparkles" aria-hidden="true" />
        </div>

        <div className="k-char-entry__body">
          <div className="k-char-entry__kicker">{character.official ? "✦ Kyalulu Official" : "✦ マイライブラリ"}</div>
          <h1 className="k-char-entry__name">{character.display_name}</h1>
          <p className="k-char-entry__hook">{character.description}</p>
          {moods.length > 0 && (
            <div className="k-char-entry__tags">
              {moods.map((m) => (
                <Link key={m.tag} to={`/discover?mood=${encodeURIComponent(m.tag)}`} className="k-char-entry__tag">
                  <span aria-hidden="true">{m.icon ?? "✦"}</span> {m.label}
                </Link>
              ))}
            </div>
          )}

          {greetings.length > 1 && (
            <div className="k-greeting-picker" role="radiogroup" aria-label="最初の挨拶を選ぶ">
              <div className="k-greeting-picker__label">はじまりのシーンを選ぶ</div>
              <div className="k-greeting-picker__list">
                {greetings.map((g, i) => (
                  <button key={i} type="button" role="radio" aria-checked={i === greetingIndex} className={`k-greeting ${i === greetingIndex ? "is-active" : ""}`} onClick={() => setGreetingIndex(i)}>
                    <span className="k-greeting__no">{i + 1}</span>
                    <span className="k-greeting__text">{cleanPreview(g, 64)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="k-inline-error">
              {error}
            </p>
          )}
          <div className="k-char-entry__actions">
            <Button variant="primary" size="lg" className="k-btn--glow" onClick={handleStart} disabled={starting}>
              {starting ? "準備中…" : "会話をはじめる"} <Icon name="sparkle" size={16} />
            </Button>
            {character.library_revision && (
              <Link to={`/create?edit=${character.id}`} className="k-text-link">
                <Icon name="edit" size={14} /> 設定を編集
              </Link>
            )}
          </div>
        </div>
      </div>

      {greeting && (
        <section className="k-section">
          <h2 className="k-section__title">
            <span className="k-section__mark">✦</span> はじまりのシーン
          </h2>
          <ScenePreview name={character.display_name} seed={character.id} portrait={character.portrait_url} content={greeting} />
        </section>
      )}

      {pastSessions.length > 0 && (
        <section className="k-section">
          <h2 className="k-section__title">
            <span className="k-section__mark">✦</span> {character.display_name}との会話
          </h2>
          <div className="k-chat-list">
            {pastSessions.map((s) => (
              <SessionRow key={s.session_id} session={s} worldName={worlds.find((w) => w.id === s.world_id)?.display_name} />
            ))}
          </div>
        </section>
      )}

      {worlds.length > 0 && (
        <section className="k-section">
          <h2 className="k-section__title">
            <span className="k-section__mark">✦</span> 出会えるワールド
          </h2>
          <div className="k-chip-row">
            {worlds.map((w) => (
              <Link key={w.id} to={`/discover?world=${encodeURIComponent(w.id)}`} className="k-chip">
                <Icon name="globe" size={14} /> {w.display_name}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
