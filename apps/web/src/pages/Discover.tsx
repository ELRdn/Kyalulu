import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchCharacters, fetchWorlds, type CharacterInfo, type WorldInfo } from "../lib/api";
import { Input } from "../components/ui/Input";
import CharacterCard from "../components/ui/CharacterCard";
import WorldCard from "../components/ui/WorldCard";
import EmptyState from "../components/ui/EmptyState";
import Button from "../components/ui/Button";
import { collectMoods } from "../lib/moodTaxonomy";
import "./pages.css";

export default function Discover() {
  const [params, setParams] = useSearchParams();
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(params.get("q") ?? "");

  const activeMood = params.get("mood");
  const activeWorld = params.get("world");

  useEffect(() => {
    Promise.all([fetchCharacters().catch(() => []), fetchWorlds().catch(() => [])])
      .then(([c, w]) => {
        setCharacters(c);
        setWorlds(w);
      })
      .finally(() => setLoading(false));
  }, []);

  const moods = collectMoods(characters.map((c) => c.tags ?? []));

  const filteredCharacters = useMemo(() => {
    const q = query.trim().toLowerCase();
    return characters.filter((c) => {
      if (activeMood && !(c.tags ?? []).some((t) => t.toLowerCase() === activeMood.toLowerCase())) return false;
      if (q && !(c.display_name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [characters, query, activeMood]);

  const filteredWorlds = useMemo(() => {
    if (!activeWorld) return worlds;
    return worlds.filter((w) => w.id === activeWorld);
  }, [worlds, activeWorld]);

  const setMood = (tag: string | null) => {
    const next = new URLSearchParams(params);
    if (tag) next.set("mood", tag);
    else next.delete("mood");
    setParams(next, { replace: true });
  };

  const clearFilters = () => {
    setQuery("");
    setParams({}, { replace: true });
  };

  const hasFilters = !!query || !!activeMood || !!activeWorld;

  return (
    <div className="k-page">
      <div>
        <h1 className="k-page-title">Discover</h1>
        <p className="k-page-sub">気分やワールドから、新しいキャラクターを見つけよう</p>
      </div>

      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="キャラクターを検索..." aria-label="キャラクターを検索" />

      {moods.length > 0 && (
        <div className="k-chip-row">
          <button className={`k-chip ${!activeMood ? "k-chip--active" : ""}`} onClick={() => setMood(null)}>
            すべて
          </button>
          {moods.map((m) => (
            <button key={m.tag} className={`k-chip ${activeMood?.toLowerCase() === m.tag.toLowerCase() ? "k-chip--active" : ""}`} onClick={() => setMood(m.tag)}>
              {m.icon && <span aria-hidden="true">{m.icon}</span>} {m.label}
            </button>
          ))}
        </div>
      )}

      {!loading && filteredWorlds.length > 0 && !query && (
        <section className="k-section">
          <div className="k-section__head">
            <h2 className="k-section__title">✦ ワールド</h2>
          </div>
          <div className="k-grid k-grid--worlds">
            {filteredWorlds.map((w) => (
              <WorldCard key={w.id} id={w.id} displayName={w.display_name} description={w.description} />
            ))}
          </div>
        </section>
      )}

      <section className="k-section">
        <div className="k-section__head">
          <h2 className="k-section__title">✦ キャラクター</h2>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{filteredCharacters.length}件</span>
        </div>
        {loading ? (
          <div className="k-grid k-grid--characters">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="k-skeleton-card" />
            ))}
          </div>
        ) : filteredCharacters.length === 0 ? (
          <EmptyState
            motif="✧"
            title="キャラクターが見つかりませんでした"
            description="検索条件を変えてもう一度探してみよう。"
            action={hasFilters ? <Button variant="secondary" onClick={clearFilters}>フィルタをリセット</Button> : undefined}
          />
        ) : (
          <div className="k-grid k-grid--characters">
            {filteredCharacters.map((c) => (
              <CharacterCard key={c.id} id={c.id} displayName={c.display_name} hook={c.description} creator={c.official ? "Kyalulu Official · SFW" : "Local"} tags={c.tags ?? []} portraitUrl={c.portrait_url} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
