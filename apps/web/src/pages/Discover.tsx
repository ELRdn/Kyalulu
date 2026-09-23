import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import HubBrowser from "../components/HubBrowser";
import HubLinks from "../components/HubLinks";
import { fetchCharacters, fetchWorlds, type CharacterInfo, type WorldInfo } from "../lib/api";
import { Input } from "../components/ui/Input";
import CharacterCard from "../components/ui/CharacterCard";
import WorldCard from "../components/ui/WorldCard";
import EmptyState from "../components/ui/EmptyState";
import Button from "../components/ui/Button";
import Icon from "../components/ui/Icon";
import { collectMoods, matchesMood, moodsOf } from "../lib/moodTaxonomy";
import "./pages.css";

type Source = "taverncard" | "sillytavern";

export default function Discover() {
  const [params, setParams] = useSearchParams();
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [hubSource, setHubSource] = useState<Source | null>(null);

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

  // ヘッダー検索・コマンドパレットから ?q= で来たときに追従する
  useEffect(() => {
    setQuery(params.get("q") ?? "");
  }, [params]);

  const moods = collectMoods(characters.map((c) => c.tags ?? []));
  const activeMoodLabel = moods.find((m) => m.tag === activeMood)?.label ?? activeMood;
  const activeWorldInfo = worlds.find((w) => w.id === activeWorld);

  const filteredCharacters = useMemo(() => {
    const q = query.trim().toLowerCase();
    return characters.filter((c) => {
      if (activeMood && !matchesMood(c.tags, activeMood)) return false;
      if (!q) return true;
      const hay = [c.display_name, c.description, ...moodsOf(c.tags).map((m) => m.label)].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [characters, query, activeMood]);

  const setParam = (key: "mood" | "world", value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const clearFilters = () => {
    setQuery("");
    setParams({}, { replace: true });
  };

  const hasFilters = !!query || !!activeMood || !!activeWorld;

  return (
    <div className="k-page">
      <div className="k-page-head">
        <div>
          <h1 className="k-page-title">ディスカバー</h1>
          <p className="k-page-sub">気分やワールドから、まだ知らない誰かに出会おう。</p>
        </div>
      </div>

      <div className="k-discover-search">
        <div className="k-search-field">
          <Icon name="search" size={18} />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="名前、性格、雰囲気で探す…" aria-label="キャラクターを検索" />
        </div>
        {moods.length > 0 && (
          <div className="k-chip-row" role="group" aria-label="気分で絞り込む">
            <button className={`k-chip ${!activeMood ? "k-chip--active" : ""}`} onClick={() => setParam("mood", null)} aria-pressed={!activeMood}>
              すべて
            </button>
            {moods.map((m) => (
              <button key={m.tag} className={`k-chip ${activeMood === m.tag ? "k-chip--active" : ""}`} onClick={() => setParam("mood", activeMood === m.tag ? null : m.tag)} aria-pressed={activeMood === m.tag}>
                <span aria-hidden="true">{m.icon ?? "✦"}</span> {m.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {!loading && worlds.length > 0 && !query && (
        <section className="k-section">
          <div className="k-section__head">
            <h2 className="k-section__title">
              <span className="k-section__mark">✦</span> ワールド
            </h2>
            {activeWorld && (
              <button className="k-section__more" onClick={() => setParam("world", null)} style={{ border: "none", background: "none", cursor: "pointer" }}>
                選択を解除 <Icon name="close" size={12} />
              </button>
            )}
          </div>
          <div className="k-grid k-grid--worlds">
            {worlds.map((w) => (
              <WorldCard key={w.id} id={w.id} displayName={w.display_name} description={w.description} active={activeWorld === w.id} onClick={() => setParam("world", activeWorld === w.id ? null : w.id)} />
            ))}
          </div>
          {activeWorldInfo && (
            <p className="k-discover-note">
              <Icon name="globe" size={14} /> 「{activeWorldInfo.display_name}」は、会話をはじめた後に右の情報パネルやスタジオから組み合わせられます。
            </p>
          )}
        </section>
      )}

      <section className="k-section">
        <div className="k-section__head">
          <h2 className="k-section__title">
            <span className="k-section__mark">✦</span> {activeMoodLabel ? `${activeMoodLabel}なキャラクター` : "キャラクター"}
          </h2>
          <span className="k-count">{filteredCharacters.length}人</span>
        </div>
        {loading ? (
          <div className="k-grid k-grid--characters">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="k-skeleton-card" />
            ))}
          </div>
        ) : filteredCharacters.length === 0 ? (
          <EmptyState
            mascot="shy"
            title="見つからなかったみたい"
            description="ことばや気分を変えて、もう一度さがしてみよう。外部Hubから連れてくることもできるよ。"
            action={
              hasFilters ? (
                <Button variant="secondary" onClick={clearFilters}>
                  絞り込みをリセット
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="k-grid k-grid--characters">
            {filteredCharacters.map((c) => (
              <CharacterCard key={c.id} id={c.id} displayName={c.display_name} hook={c.description} creator={c.official ? "Kyalulu Official" : "マイライブラリ"} tags={c.tags ?? []} portraitUrl={c.portrait_url} />
            ))}
          </div>
        )}
      </section>

      <section className="k-section k-hub-section">
        <div className="k-section__head">
          <div>
            <h2 className="k-section__title">
              <span className="k-section__mark">✦</span> 外部Hubから連れてくる
            </h2>
            <p className="k-page-sub">公開されているキャラクターカードを探して、マイライブラリに取り込めます。</p>
          </div>
        </div>
        <div className="k-chip-row" role="tablist" aria-label="Hubを選ぶ">
          {(["taverncard", "sillytavern"] as const).map((value) => (
            <button key={value} role="tab" aria-selected={hubSource === value} className={`k-chip ${hubSource === value ? "k-chip--active" : ""}`} onClick={() => setHubSource(hubSource === value ? null : value)}>
              <Icon name="search" size={13} /> {value === "taverncard" ? "TavernCardを検索" : "SillyTavern Contentを見る"}
            </button>
          ))}
          <Link to="/create?import=url" className="k-chip">
            <Icon name="external" size={13} /> URLから取り込む
          </Link>
          <Link to="/create?import=characterai" className="k-chip">
            <Icon name="arrow" size={13} /> Character.AIから移行
          </Link>
        </div>
        {hubSource && <HubBrowser key={hubSource} source={hubSource} />}
        <details className="k-hub-more">
          <summary>ほかのHubサイトを開く</summary>
          <div className="k-hubs">
            <HubLinks />
          </div>
        </details>
      </section>
    </div>
  );
}
