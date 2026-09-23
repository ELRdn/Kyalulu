import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchSessions, fetchWorlds, fetchCharacters, sessionTitle, type SessionInfo, type WorldInfo, type CharacterInfo } from "../lib/api";
import WorldCard from "../components/ui/WorldCard";
import CharacterCard from "../components/ui/CharacterCard";
import Avatar from "../components/ui/Avatar";
import Button from "../components/ui/Button";
import EmptyState from "../components/ui/EmptyState";
import Icon from "../components/ui/Icon";
import { collectMoods } from "../lib/moodTaxonomy";
import { cleanPreview, formatRelative } from "../lib/text";
import { useDisplayName } from "../lib/profile";
import "./pages.css";

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "夜ふかしだね";
  if (h < 11) return "おはよう";
  if (h < 18) return "こんにちは";
  return "こんばんは";
}

export default function Home() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const displayName = useDisplayName();

  useEffect(() => {
    Promise.all([fetchSessions().catch(() => []), fetchWorlds().catch(() => []), fetchCharacters().catch(() => [])])
      .then(([s, w, c]) => {
        setSessions(s);
        setWorlds(w);
        setCharacters(c);
      })
      .finally(() => setLoading(false));
  }, []);

  const recentSessions = sessions.filter((s) => s.count > 0).slice(0, 4);
  const moods = collectMoods(characters.map((c) => c.tags ?? []));
  const worldName = (id?: string | null) => worlds.find((w) => w.id === id)?.display_name;
  const latest = recentSessions[0];

  return (
    <div className="k-page k-page--home">
      <section className="k-hero" aria-labelledby="k-hero-title">
        <div className="k-hero__sky" aria-hidden="true">
          <span className="k-hero__star k-hero__star--1">✦</span>
          <span className="k-hero__star k-hero__star--2">✧</span>
          <span className="k-hero__star k-hero__star--3">✦</span>
          <span className="k-hero__star k-hero__star--4">✧</span>
          <span className="k-hero__moon" />
        </div>
        <div className="k-hero__content">
          <p className="k-hero__eyebrow">
            {greeting()}、{displayName} <span aria-hidden="true">✦</span>
          </p>
          <h1 className="k-hero__title" id="k-hero-title">
            きみの想像が、
            <br />
            <span>物語になる世界へ。</span>
          </h1>
          <p className="k-hero__desc">Kyaluluは、キャラクターと出会い、つながり、あなただけのAIパートナーと物語を紡ぐプラットフォームです。</p>
          <div className="k-hero__actions">
            <Button variant="primary" size="lg" className="k-btn--glow" onClick={() => navigate("/discover")}>
              世界をのぞく <Icon name="sparkle" size={16} />
            </Button>
            {latest && (
              <Button variant="secondary" size="lg" className="k-hero__resume" onClick={() => navigate(`/chats/${encodeURIComponent(latest.session_id)}`)}>
                {sessionTitle(latest)}とのつづき <Icon name="arrow" size={16} />
              </Button>
            )}
          </div>
        </div>
        <div className="k-hero__portal" aria-hidden="true">
          <div className="k-hero__arch">
            <div className="k-hero__arch-glow" />
          </div>
          <img className="k-hero__mascot" src="/mascot/sit.webp" alt="" />
          <span className="k-hero__bubble">ねえねえ、今日は何する？</span>
        </div>
      </section>

      {!loading && recentSessions.length > 0 && (
        <section className="k-section">
          <div className="k-section__head">
            <h2 className="k-section__title">
              <span className="k-section__mark">✦</span> つづきから話す
            </h2>
            <Link to="/chats" className="k-section__more">
              すべて見る <Icon name="chevron" size={13} />
            </Link>
          </div>
          <div className="k-resume-grid">
            {recentSessions.map((s) => {
              const name = sessionTitle(s);
              const world = worldName(s.world_id);
              return (
                <Link key={s.session_id} to={`/chats/${encodeURIComponent(s.session_id)}`} className="k-resume-card">
                  <div className="k-resume-card__top">
                    <Avatar name={name} seed={s.character_id ?? s.session_id} size="lg" src={s.portrait_url} mascot={!s.character_name} />
                    <div className="k-resume-card__who">
                      <span className="k-resume-card__name">{name}</span>
                      <span className="k-resume-card__time">{formatRelative(s.last_at)}</span>
                    </div>
                  </div>
                  <p className="k-resume-card__preview">{cleanPreview(s.last_preview, 90) || "まだメッセージがありません"}</p>
                  <div className="k-resume-card__foot">
                    {world ? <span className="k-resume-card__world">{world}</span> : <span />}
                    <span className="k-resume-card__go">
                      続きから <Icon name="sparkle" size={12} />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {!loading && moods.length > 0 && (
        <section className="k-section">
          <div className="k-section__head">
            <h2 className="k-section__title">
              <span className="k-section__mark">✦</span> 気分でえらぶ
            </h2>
          </div>
          <div className="k-mood-row">
            {moods.map((m) => (
              <button key={m.tag} className="k-mood" onClick={() => navigate(`/discover?mood=${encodeURIComponent(m.tag)}`)}>
                <span className="k-mood__icon" aria-hidden="true">
                  {m.icon ?? "✦"}
                </span>
                {m.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {!loading && worlds.length > 0 && (
        <section className="k-section">
          <div className="k-section__head">
            <h2 className="k-section__title">
              <span className="k-section__mark">✦</span> 注目のワールド
            </h2>
            <Link to="/discover" className="k-section__more">
              すべて見る <Icon name="chevron" size={13} />
            </Link>
          </div>
          <div className="k-grid k-grid--worlds">
            {worlds.map((w) => (
              <WorldCard key={w.id} id={w.id} displayName={w.display_name} description={w.description} onClick={() => navigate(`/discover?world=${encodeURIComponent(w.id)}`)} />
            ))}
          </div>
        </section>
      )}

      <section className="k-section">
        <div className="k-section__head">
          <h2 className="k-section__title">
            <span className="k-section__mark">✦</span> 人気キャラクター
          </h2>
          <Link to="/discover" className="k-section__more">
            すべて見る <Icon name="chevron" size={13} />
          </Link>
        </div>
        {loading ? (
          <div className="k-grid k-grid--characters">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="k-skeleton-card" />
            ))}
          </div>
        ) : characters.length === 0 ? (
          <EmptyState
            mascot="sleep"
            title="まだキャラクターがいません"
            description="クリエイトからキャラクターを取り込むと、ここに並びます。"
            action={
              <Button variant="secondary" onClick={() => navigate("/create")}>
                キャラクターを取り込む
              </Button>
            }
          />
        ) : (
          <div className="k-grid k-grid--characters">
            {characters.map((c) => (
              <CharacterCard key={c.id} id={c.id} displayName={c.display_name} hook={c.description} creator={c.official ? "Kyalulu Official" : "マイライブラリ"} tags={c.tags ?? []} portraitUrl={c.portrait_url} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
