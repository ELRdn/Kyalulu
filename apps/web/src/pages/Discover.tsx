import { scopedKey } from '../lib/remoteStore';
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { type CharacterInfo, type WorldInfo } from "../lib/api";
import { Input } from "../components/ui/Input";
import CharacterCard from "../components/ui/CharacterCard";
import WorldCard from "../components/ui/WorldCard";
import EmptyState from "../components/ui/EmptyState";
import Button from "../components/ui/Button";
import Icon from "../components/ui/Icon";
import { matchesMood, moodsOf } from "../lib/moodTaxonomy";
import { cleanTag, tagKey } from "../lib/authorFields";
import { useAdultContent } from "../lib/adult";
import { useDocumentTitle } from "../lib/title";
import "./pages.css";
import { useRuntimeAccess } from '../components/RuntimeGate';
import { fetchBrowseCatalog, isCloudGuest } from '../lib/cloudGuest';
import { friendlyMessage } from '../lib/errors';
import { useLanguage } from '../lib/appContext';

const LS_RECENT = "kyalulu-recent-searches";
function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(scopedKey(LS_RECENT)) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}
function writeRecent(list: string[]) {
  try {
    localStorage.setItem(scopedKey(LS_RECENT), JSON.stringify(list));
  } catch {
    /* Storage unavailable: recent searches are only a convenience. */
  }
}

export default function Discover() {
  const language = useLanguage(), en = language === 'en';
  const guest = isCloudGuest(useRuntimeAccess());
  const [params, setParams] = useSearchParams();
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [talks, setTalks] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ cause: unknown } | null>(null);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [recent, setRecent] = useState<string[]>(readRecent);

  const [adult] = useAdultContent();
  useDocumentTitle(en ? 'Explore' : 'さがす');
  const activeMood = params.get("mood");
  const typedTag = query.trim().startsWith("#") ? cleanTag(query) : "";
  const activeTag = params.get("tag") || typedTag || null;
  const activeWorld = params.get("world");

  useEffect(() => {
    let active = true; setLoading(true); setLoadError(null);
    fetchBrowseCatalog(guest, adult)
      .then(([c, w, sessions]) => {
        if (!active) return;
        setCharacters(c);
        setWorlds(w);
        const counts = new Map<string, number>();
        for (const s of sessions) if (s.character_id) counts.set(s.character_id, (counts.get(s.character_id) ?? 0) + s.count);
        setTalks(counts);
      })
      .catch(error => { if (active) setLoadError({ cause: error }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [adult, guest, retry]);

  // ヘッダー検索・コマンドパレットから ?q= で来たときに追従する
  useEffect(() => {
    setQuery(params.get("q") ?? "");
  }, [params]);

  // Most-used tags first; nobody curates the row (docs/MOBILE_UX_SPEC.md §5.5).
  const popularTags = useMemo(() => {
    const counts = new Map<string, { tag: string; n: number }>();
    for (const c of characters) for (const tag of c.tags ?? []) {
      const clean = cleanTag(tag), entry = counts.get(tagKey(clean));
      if (!clean) continue;
      if (entry) entry.n++; else counts.set(tagKey(clean), { tag: clean, n: 1 });
    }
    return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 12).map((v) => v.tag);
  }, [characters]);
  const activeMoodLabel = activeTag ? `#${cleanTag(activeTag)}` : activeMood && (moodsOf([activeMood], language)[0]?.label ?? activeMood);
  const activeWorldInfo = worlds.find((w) => w.id === activeWorld);

  const filteredCharacters = useMemo(() => {
    const q = query.trim().toLowerCase();
    return characters.filter((c) => {
      if (activeMood && !matchesMood(c.tags, activeMood)) return false;
      if (activeTag) return (c.tags ?? []).some((t) => tagKey(t) === tagKey(activeTag));
      if (!q) return true;
      const hay = [c.display_name, c.description, ...moodsOf(c.tags, 'ja').map(m => m.label), ...moodsOf(c.tags, 'en').map(m => m.label)].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [characters, query, activeMood, activeTag]);

  const setParam = (key: "tag" | "world", value: string | null) => {
    const next = new URLSearchParams(params);
    if (query) next.set("q", query);
    else next.delete("q");
    if (key === "tag") next.delete("mood");
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const rememberQuery = () => {
    const q = query.trim();
    if (!q) return;
    const next = [q, ...recent.filter((x) => x !== q)].slice(0, 8);
    setRecent(next);
    writeRecent(next);
  };
  const clearRecent = () => {
    setRecent([]);
    writeRecent([]);
  };

  const clearFilters = () => {
    setQuery("");
    setParams({}, { replace: true });
  };

  const hasFilters = !!query || !!activeMood || !!activeTag || !!activeWorld;

  return (
    <div className="k-page">
      <div className="k-page-head">
        <div>
          <h1 className="k-page-title">{en ? 'Explore' : 'さがす'}</h1>
        </div>
      </div>

      <div className="k-discover-search">
        <div className="k-search-field">
          <Icon name="search" size={18} />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onBlur={rememberQuery}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) rememberQuery();
            }}
            placeholder={en ? 'Search by name, or #tag' : '名前や #タグ で探す'}
            aria-label={en ? 'Search characters' : 'キャラクターを検索'}
          />
        </div>
        {!query && recent.length > 0 && (
          <div className="k-recent-search">
            <span className="k-recent-search__label">{en ? 'Recent searches' : '最近の検索'}</span>
            {recent.map((r) => (
              <button key={r} type="button" className="k-chip k-chip--sm" onClick={() => setQuery(r)}>
                <Icon name="search" size={12} /> {r}
              </button>
            ))}
            <button type="button" className="k-recent-search__clear" onClick={clearRecent}>
              {en ? 'Clear' : '消去'}
            </button>
          </div>
        )}
        {popularTags.length > 0 && (
          <div className="k-chip-row k-chip-row--scroll" role="group" aria-label={en ? 'Filter by tag' : 'タグで絞り込む'}>
            {popularTags.map((tag) => {
              const on = !!activeTag && tagKey(activeTag) === tagKey(tag);
              return <button key={tag} className={`k-chip ${on ? "k-chip--active" : ""}`} onClick={() => setParam("tag", on ? null : tag)} aria-pressed={on}>#{tag}</button>;
            })}
          </div>
        )}
      </div>

      {!loading && worlds.length > 0 && !query && (
        <section className="k-section">
          <div className="k-section__head">
            <h2 className="k-section__title">
              <span className="k-section__mark">✦</span> {en ? 'Worlds' : 'ワールド'}
            </h2>
            {activeWorld && (
              <button className="k-section__more" onClick={() => setParam("world", null)} style={{ border: "none", background: "none", cursor: "pointer" }}>
                {en ? 'Clear selection' : '選択を解除'} <Icon name="close" size={12} />
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
              <Icon name="globe" size={14} /> {en ? `After starting a conversation, add “${activeWorldInfo.display_name}” from the information panel or Studio.` : `「${activeWorldInfo.display_name}」は、会話をはじめた後に右の情報パネルやスタジオから組み合わせられます。`}
            </p>
          )}
        </section>
      )}

      <section className="k-section">
        <div className="k-section__head">
          <h2 className="k-section__title">
            <span className="k-section__mark">✦</span> {activeMoodLabel ? (en ? `${activeMoodLabel} characters` : `${activeMoodLabel}のキャラ`) : (en ? 'Characters' : 'キャラ')}
          </h2>
          {!loading && !loadError && <span className="k-count">{en ? `${filteredCharacters.length} ${filteredCharacters.length === 1 ? 'character' : 'characters'}` : `${filteredCharacters.length}人`}</span>}
        </div>
        {loadError ? <p role="alert">{friendlyMessage(loadError.cause, language)}<Button size="sm" variant="secondary" onClick={() => setRetry(value => value + 1)}>{en ? 'Retry' : '再読込'}</Button></p> : loading ? (
          <div className="k-grid k-grid--characters">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="k-skeleton-card" />
            ))}
          </div>
        ) : filteredCharacters.length === 0 ? (
          <EmptyState
            mascot="shy"
            title={!hasFilters ? (en ? 'No characters yet.' : 'まだキャラがいません。') : en ? `No characters match “${query.trim() || activeMoodLabel || activeWorldInfo?.display_name}”.` : `「${query.trim() || activeMoodLabel || activeWorldInfo?.display_name}」に合うキャラは見つかりませんでした。`}
            action={
              hasFilters ? (
                <Button variant="secondary" onClick={clearFilters}>
                  {en ? 'Reset filters' : '条件をリセット'}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="k-grid k-grid--characters">
            {filteredCharacters.map((c) => (
              <CharacterCard key={c.id} id={c.id} displayName={c.display_name} hook={c.hook || c.description} creator={c.official ? "Kyalulu Official" : en ? 'My library' : 'マイライブラリ'} tags={c.tags ?? []} portraitUrl={c.portrait_url} talks={talks.get(c.id)} />
            ))}
          </div>
        )}
      </section>

    </div>
  );
}
