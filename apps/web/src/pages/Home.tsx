import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchSessions, fetchWorlds, fetchCharacters, type SessionInfo, type WorldInfo, type CharacterInfo } from "../lib/api";
import SessionRow from "../components/ui/SessionRow";
import WorldCard from "../components/ui/WorldCard";
import CharacterCard from "../components/ui/CharacterCard";
import Button from "../components/ui/Button";
import EmptyState from "../components/ui/EmptyState";
import { collectMoods } from "../lib/moodTaxonomy";
import "./pages.css";

export default function Home() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([fetchSessions().catch(() => []), fetchWorlds().catch(() => []), fetchCharacters().catch(() => [])])
      .then(([s, w, c]) => {
        setSessions(s);
        setWorlds(w);
        setCharacters(c);
      })
      .finally(() => setLoading(false));
  }, []);

  const recentSessions = sessions.filter((s) => s.count > 0).slice(0, 3);
  const moods = collectMoods(characters.map((c) => c.tags ?? []));

  return (
    <div className="k-page">
      {/* Hero */}
      <section className="k-hero">
        <div className="k-hero__content">
          <h1 className="k-hero__title">
            きみの想像が、
            <br />
            物語になる世界へ。
          </h1>
          <p className="k-hero__desc">Kyaluluは、キャラクターと出会い、つながり、あなただけのAIパートナーと物語を紡ぐプラットフォームです。</p>
          <Button variant="primary" size="lg" onClick={() => navigate("/discover")}>
            世界をのぞく ✦
          </Button>
        </div>
        <div className="k-hero__motif" aria-hidden="true">
          ✦
        </div>
      </section>

      {!loading && recentSessions.length > 0 && (
        <section className="k-section">
          <div className="k-section__head">
            <h2 className="k-section__title">✦ つづきから話す</h2>
            <Link to="/chats" className="k-section__more">
              すべて見る ›
            </Link>
          </div>
          <div className="k-row-scroll">
            {recentSessions.map((s) => (
              <div key={s.session_id} style={{ minWidth: 260 }}>
                <SessionRow sessionId={s.session_id} name={s.session_id === "default" ? "きゃるる" : s.session_id} preview={s.last_preview} time={s.last_at} />
              </div>
            ))}
          </div>
        </section>
      )}

      {!loading && worlds.length > 0 && (
        <section className="k-section">
          <div className="k-section__head">
            <h2 className="k-section__title">✦ 注目のワールド</h2>
          </div>
          <div className="k-grid k-grid--worlds">
            {worlds.map((w) => (
              <WorldCard key={w.id} id={w.id} displayName={w.display_name} description={w.description} onClick={() => navigate(`/discover?world=${encodeURIComponent(w.id)}`)} />
            ))}
          </div>
        </section>
      )}

      {!loading && moods.length > 0 && (
        <section className="k-section">
          <div className="k-section__head">
            <h2 className="k-section__title">✦ 気分でえらぶ</h2>
          </div>
          <div className="k-chip-row">
            {moods.map((m) => (
              <button key={m.tag} className="k-chip" onClick={() => navigate(`/discover?mood=${encodeURIComponent(m.tag)}`)}>
                {m.icon && <span aria-hidden="true">{m.icon}</span>} {m.label}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="k-section">
        <div className="k-section__head">
          <h2 className="k-section__title">✦ 人気キャラクター</h2>
          <Link to="/discover" className="k-section__more">
            すべて見る ›
          </Link>
        </div>
        {loading ? (
          <div className="k-grid k-grid--characters">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="k-skeleton-card" />
            ))}
          </div>
        ) : characters.length === 0 ? (
          <EmptyState motif="✦" title="まだキャラクターがいません" description="characters/*.yaml を追加すると、ここに表示されます。" />
        ) : (
          <div className="k-grid k-grid--characters">
            {characters.map((c) => (
              <CharacterCard key={c.id} id={c.id} displayName={c.display_name} hook={c.description} creator={c.official ? "Kyalulu Official · SFW" : "Local"} tags={c.tags ?? []} portraitUrl={c.portrait_url} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
