import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { fetchCharacters, fetchSessions, type CharacterInfo, type SessionInfo } from "../lib/api";
import CharacterCard from "../components/ui/CharacterCard";
import { useSavedCharacters } from "../lib/saved";
import { Input } from "../components/ui/Input";
import Avatar from "../components/ui/Avatar";
import Card from "../components/ui/Card";
import Icon, { type IconName } from "../components/ui/Icon";
import SessionRow from "../components/ui/SessionRow";
import Switch from "../components/ui/Switch";
import { useConfirm } from "../components/ui/Dialog";
import { useAdultContent } from "../lib/adult";
import { useDocumentTitle } from "../lib/title";
import { useDisplayName, setDisplayName } from "../lib/profile";
import { useTheme } from "../lib/theme";
import { useResearcherMode } from "../lib/mode";
import { usePinnedSessions, togglePin } from "../lib/pins";
import "./pages.css";

export default function Profile() {
  const displayName = useDisplayName();
  const [nameDraft, setNameDraft] = useState(displayName);
  const { theme, setTheme } = useTheme();
  const [researcher, setResearcher] = useResearcherMode();
  const pinned = usePinnedSessions();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [adult, setAdult] = useAdultContent();
  const savedIds = useSavedCharacters();
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [confirmDialog, confirm] = useConfirm();
  const location = useLocation();
  useDocumentTitle("プロフィール");

  useEffect(() => {
    if (location.hash !== "#adult") return;
    const el = document.getElementById("adult");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.classList.add("is-highlight");
    const t = window.setTimeout(() => el?.classList.remove("is-highlight"), 1800);
    return () => window.clearTimeout(t);
  }, [location.hash]);

  const toggleAdult = async (next: boolean) => {
    if (next) {
      const ok = await confirm({
        title: "あなたは18歳以上ですか？",
        description: "成人向けのキャラクターや会話が表示されるようになります。いつでもここからOFFにできます。",
        confirmLabel: "18歳以上です",
        cancelLabel: "いいえ",
      });
      if (!ok) return;
    }
    setAdult(next);
  };

  useEffect(() => {
    setNameDraft(displayName);
  }, [displayName]);

  useEffect(() => {
    fetchSessions()
      .then(setSessions)
      .catch(() => setSessions([]));
  }, []);

  useEffect(() => {
    fetchCharacters(adult)
      .then(setCharacters)
      .catch(() => setCharacters([]));
  }, [adult]);

  const savedCharacters = savedIds.map((id) => characters.find((c) => c.id === id)).filter((c): c is CharacterInfo => !!c);
  const pinnedSessions = sessions.filter((s) => pinned.includes(s.session_id));
  const talked = sessions.filter((s) => s.count > 0);
  const messageCount = talked.reduce((n, s) => n + s.count, 0);
  const characterCount = new Set(talked.map((s) => s.character_id).filter(Boolean)).size;

  return (
    <div className="k-page" style={{ maxWidth: 780 }}>
      {confirmDialog}
      <section className="k-profile-card">
        <Avatar name={displayName} size="xl" />
        <div className="k-profile-card__main">
          <label className="k-profile-card__label" htmlFor="k-profile-name">
            表示名
          </label>
          <Input
            id="k-profile-name"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => setDisplayName(nameDraft)}
            onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
            placeholder="表示名"
            className="k-profile-card__name"
          />
          <div className="k-profile-card__note">このデバイスにだけ保存されます（アカウント同期は未対応）</div>
        </div>
        <div className="k-profile-stats">
          <Stat value={talked.length} label="会話" />
          <Stat value={characterCount} label="出会ったキャラ" />
          <Stat value={messageCount} label="メッセージ" />
        </div>
      </section>

      <section className="k-section">
        <h2 className="k-section__title">
          <span className="k-section__mark">✦</span> 表示
        </h2>
        <Card>
          <div style={{ display: "grid", gap: 16 }}>
            <Row label="テーマ" desc="昼のやわらかな光か、月夜の紫か。">
              <div className="k-segmented" role="radiogroup" aria-label="テーマ">
                <button role="radio" aria-checked={theme === "light"} className={theme === "light" ? "is-active" : ""} onClick={() => setTheme("light")}>
                  <Icon name="sun" size={14} /> ライト
                </button>
                <button role="radio" aria-checked={theme === "dark"} className={theme === "dark" ? "is-active" : ""} onClick={() => setTheme("dark")}>
                  <Icon name="moon" size={14} /> ダーク
                </button>
              </div>
            </Row>
            <div id="adult" className="k-setting-anchor">
              <Row label="成人向けコンテンツ" desc="18歳以上の方のみ。成人向けのキャラクターと会話を表示します。">
                <Switch checked={adult} onChange={(v) => void toggleAdult(v)} label="成人向けコンテンツを表示" />
              </Row>
            </div>
          </div>
        </Card>
      </section>

      {savedCharacters.length > 0 && (
        <section className="k-section">
          <h2 className="k-section__title">
            <span className="k-section__mark">✦</span> 保存したキャラクター
          </h2>
          <div className="k-grid k-grid--characters">
            {savedCharacters.map((c) => (
              <CharacterCard key={c.id} id={c.id} displayName={c.display_name} hook={c.description} creator={c.official ? "Kyalulu Official" : "マイライブラリ"} tags={c.tags ?? []} portraitUrl={c.portrait_url} />
            ))}
          </div>
        </section>
      )}

      {pinnedSessions.length > 0 && (
        <section className="k-section">
          <h2 className="k-section__title">
            <span className="k-section__mark">✦</span> ピン留めしたチャット
          </h2>
          <div className="k-chat-list">
            {pinnedSessions.map((s) => (
              <SessionRow key={s.session_id} session={s} pinned onTogglePin={() => togglePin(s.session_id)} />
            ))}
          </div>
        </section>
      )}

      <section className="k-section">
        <h2 className="k-section__title">
          <span className="k-section__mark">✦</span> 上級者向け
        </h2>
        <Card>
          <div style={{ display: "grid", gap: 16 }}>
            <Row label="Researcherモード" desc="チャット画面にモデル選択・プロンプト確認・デバッグを表示します。">
              <Switch checked={researcher} onChange={setResearcher} label="Researcherモード" />
            </Row>
            <div className="k-advanced-links">
              <AdvancedLink to="/studio" icon="sparkle" label="スタジオ" desc="会話エンジン・詳細設定" />
              <AdvancedLink to="/research" icon="flask" label="Research" desc="A/B/C比較・評価" />
              <AdvancedLink to="/status" icon="globe" label="Status" desc="接続状況" />
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="k-profile-stat">
      <span className="k-profile-stat__value">{value}</span>
      <span className="k-profile-stat__label">{label}</span>
    </div>
  );
}

function AdvancedLink({ to, icon, label, desc }: { to: string; icon: IconName; label: string; desc: string }) {
  return (
    <Link to={to} className="k-advanced-link">
      <span className="k-advanced-link__icon">
        <Icon name={icon} size={16} />
      </span>
      <span>
        <span className="k-advanced-link__label">{label}</span>
        <span className="k-advanced-link__desc">{desc}</span>
      </span>
    </Link>
  );
}

function Row({ label, desc, children }: { label: string; desc: string; children: ReactNode }) {
  return (
    <div className="k-setting-row">
      <div>
        <div className="k-setting-row__label">{label}</div>
        <div className="k-setting-row__desc">{desc}</div>
      </div>
      {children}
    </div>
  );
}
