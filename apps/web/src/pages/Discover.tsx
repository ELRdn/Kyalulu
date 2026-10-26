import { scopedKey } from '../lib/remoteStore';
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import HubBrowser from "../components/HubBrowser";
import HubLinks from "../components/HubLinks";
import { type CharacterInfo, type WorldInfo } from "../lib/api";
import { Input } from "../components/ui/Input";
import CharacterCard from "../components/ui/CharacterCard";
import WorldCard from "../components/ui/WorldCard";
import EmptyState from "../components/ui/EmptyState";
import Button from "../components/ui/Button";
import Icon from "../components/ui/Icon";
import { collectMoods, matchesMood, moodsOf } from "../lib/moodTaxonomy";
import { useAdultContent } from "../lib/adult";
import { useDocumentTitle } from "../lib/title";
import "./pages.css";
import { useAdministrative, useRuntimeAccess } from '../components/RuntimeGate';
import { fetchBrowseCatalog, isCloudGuest } from '../lib/cloudGuest';
import CommunityWorks from '../components/CommunityWorks';
import { friendlyMessage } from '../lib/errors';
import { useLanguage } from '../lib/appContext';

type Source = "taverncard" | "sillytavern";

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
  const administrative = useAdministrative();
  const guest = isCloudGuest(useRuntimeAccess());
  const [params, setParams] = useSearchParams();
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [talks, setTalks] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ cause: unknown } | null>(null);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [hubSource, setHubSource] = useState<Source | null>(null);
  const [recent, setRecent] = useState<string[]>(readRecent);

  const [adult] = useAdultContent();
  useDocumentTitle(en ? 'Explore' : 'ディスカバー');
  const activeMood = params.get("mood");
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

  const moods = collectMoods(characters.map((c) => c.tags ?? []), language);
  const activeMoodLabel = moods.find((m) => m.tag === activeMood)?.label ?? activeMood;
  const activeWorldInfo = worlds.find((w) => w.id === activeWorld);

  const filteredCharacters = useMemo(() => {
    const q = query.trim().toLowerCase();
    return characters.filter((c) => {
      if (activeMood && !matchesMood(c.tags, activeMood)) return false;
      if (!q) return true;
      const hay = [c.display_name, c.description, ...moodsOf(c.tags, 'ja').map(m => m.label), ...moodsOf(c.tags, 'en').map(m => m.label)].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [characters, query, activeMood]);

  const setParam = (key: "mood" | "world", value: string | null) => {
    const next = new URLSearchParams(params);
    if (query) next.set("q", query);
    else next.delete("q");
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

  const hasFilters = !!query || !!activeMood || !!activeWorld;

  return (
    <div className="k-page">
      <div className="k-page-head">
        <div>
          <h1 className="k-page-title">{en ? 'Explore' : 'ディスカバー'}</h1>
          <p className="k-page-sub">{en ? 'Find someone new through moods and worlds.' : '気分やワールドから、まだ知らない誰かに出会おう。'}</p>
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
            placeholder={en ? 'Search by name, personality or mood…' : '名前、性格、雰囲気で探す…'}
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
        {moods.length > 0 && (
          <div className="k-chip-row" role="group" aria-label={en ? 'Filter by mood' : '気分で絞り込む'}>
            <button className={`k-chip ${!activeMood ? "k-chip--active" : ""}`} onClick={() => setParam("mood", null)} aria-pressed={!activeMood}>
              {en ? 'All' : 'すべて'}
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
            <span className="k-section__mark">✦</span> {activeMoodLabel ? (en ? `${activeMoodLabel} characters` : `${activeMoodLabel}なキャラクター`) : (en ? 'Characters' : 'キャラクター')}
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
            title={en ? 'No characters found' : '見つからなかったみたい'}
            description={en ? 'Try another search or mood. You can also import characters from an external Hub.' : 'ことばや気分を変えて、もう一度さがしてみよう。外部Hubから連れてくることもできるよ。'}
            action={
              hasFilters ? (
                <Button variant="secondary" onClick={clearFilters}>
                  {en ? 'Reset filters' : '絞り込みをリセット'}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="k-grid k-grid--characters">
            {filteredCharacters.map((c) => (
              <CharacterCard key={c.id} id={c.id} displayName={c.display_name} hook={c.description} creator={c.official ? "Kyalulu Official" : en ? 'My library' : 'マイライブラリ'} tags={c.tags ?? []} portraitUrl={c.portrait_url} talks={talks.get(c.id)} />
            ))}
          </div>
        )}
      </section>

      <CommunityWorks query={query} />
      <section className="k-section k-hub-section">
        <div className="k-section__head">
          <div>
            <h2 className="k-section__title">
              <span className="k-section__mark">✦</span> {en ? 'Import from external Hubs' : '外部Hubから連れてくる'}
            </h2>
            <p className="k-page-sub">{en ? 'Find public character cards and import them into your library.' : '公開されているキャラクターカードを探して、マイライブラリに取り込めます。'}</p>
          </div>
        </div>
        {administrative ? <div className="k-chip-row" role="tablist" aria-label={en ? 'Choose a Hub' : 'Hubを選ぶ'}>
          {(["taverncard", "sillytavern"] as const).map((value) => (
            <button key={value} role="tab" aria-selected={hubSource === value} className={`k-chip ${hubSource === value ? "k-chip--active" : ""}`} onClick={() => setHubSource(hubSource === value ? null : value)}>
              <Icon name="search" size={13} /> {value === "taverncard" ? (en ? 'Search TavernCard' : 'TavernCardを検索') : (en ? 'Browse SillyTavern Content' : 'SillyTavern Contentを見る')}
            </button>
          ))}
          <Link to="/create?import=url" className="k-chip">
            <Icon name="external" size={13} /> {en ? 'Import from URL' : 'URLから取り込む'}
          </Link>
          <Link to="/create?import=characterai" className="k-chip">
            <Icon name="arrow" size={13} /> {en ? 'Import from Character.AI' : 'Character.AIから移行'}
          </Link>
        </div> : <p>{en ? 'Hub search and URL retrieval run on a PC with management access. On this device, import files from Create.' : 'Hubの検索やURLからの取得はサーバー側のPCで行えます。この端末では「つくる」からファイルを取り込めます。'}</p>}
        {administrative && hubSource && <HubBrowser key={hubSource} source={hubSource} />}
        <details className="k-hub-more">
          <summary>{en ? 'Open other Hub sites' : 'ほかのHubサイトを開く'}</summary>
          <div className="k-hubs">
            <HubLinks />
          </div>
        </details>
      </section>
    </div>
  );
}
