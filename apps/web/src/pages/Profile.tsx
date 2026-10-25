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
import ConnectionSettings from '../components/ConnectionSettings';
import RemoteHostSettings from '../components/RemoteHostSettings';
import { DeviceRegistration, useAdministrative, useRuntimeAccess } from '../components/RuntimeGate';
import CloudSettings from '../components/CloudSettings';
import LocalCloudSync from '../components/LocalCloudSync';
import NativeSyncSettings from '../components/NativeSyncSettings';
import Button from '../components/ui/Button';
import { useAccountProfile, refreshAccountProfile } from '../lib/accountProfile';
import { friendlyMessage } from '../lib/errors';
import DeviceSettings from '../components/DeviceSettings';
import { executionTarget, isUnifiedEntry, useLanguage } from '../lib/appContext';

export default function Profile() {
  const language=useLanguage(),en=language==='en';
  const administrative = useAdministrative();
  const {cloud_mode,remote_mode} = useRuntimeAccess();
  const displayName = useDisplayName();
  const accountSync = useAccountProfile();
  const [nameDraft, setNameDraft] = useState(displayName);
  const { theme, setTheme } = useTheme();
  const [researcher, setResearcher] = useResearcherMode();
  const pinned = usePinnedSessions();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [adult, setAdult] = useAdultContent();
  const savedIds = useSavedCharacters();
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [loadError, setLoadError] = useState<{cause:unknown}|null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [confirmDialog, confirm] = useConfirm();
  const location = useLocation();
  useDocumentTitle(en ? 'Profile' : 'プロフィール');

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
        title: en ? 'Are you at least 18?' : 'あなたは18歳以上ですか？',
        description: en ? 'Adult characters and conversations will be shown. You can turn this off here at any time.' : '成人向けのキャラクターや会話が表示されるようになります。いつでもここからOFFにできます。',
        confirmLabel: en ? 'I am at least 18' : '18歳以上です',
        cancelLabel: en ? 'No' : 'いいえ',
      });
      if (!ok) return;
    }
    setAdult(next);
  };

  useEffect(() => {
    setNameDraft(displayName);
  }, [displayName]);

  useEffect(() => {
    let active = true; setLoadError(null); setLoading(true);
    Promise.all([fetchSessions(), fetchCharacters(adult)]).then(([sessions, characters]) => {
      if (active) { setSessions(sessions); setCharacters(characters); }
    }).catch(error => { if (active) setLoadError({cause:error}); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [adult, retry]);

  const savedCharacters = savedIds.map((id) => characters.find((c) => c.id === id)).filter((c): c is CharacterInfo => !!c);
  const pinnedSessions = sessions.filter((s) => pinned.includes(s.session_id));
  const talked = sessions.filter((s) => s.count > 0);
  const messageCount = talked.reduce((n, s) => n + s.count, 0);
  const characterCount = new Set(talked.map((s) => s.character_id).filter(Boolean)).size;

  return (
    <div className="k-page" style={{ maxWidth: 780 }}>
      {confirmDialog}
      <DeviceSettings />
      {isUnifiedEntry()&&<p><Link to="/publications">{en?'Publication review and appeals':'公開作品の審査・異議申立て'}</Link> · <Link to="/published">{en?'Approved works':'承認済み作品'}</Link></p>}
      {loadError && <p role="alert">{friendlyMessage(loadError.cause,language)}<Button size="sm" variant="secondary" onClick={() => setRetry(value => value + 1)}>{en?'Reload':'再読込'}</Button></p>}
      {!cloud_mode && <ConnectionSettings />}
      {administrative && executionTarget() === 'local' && <RemoteHostSettings />}
      <DeviceRegistration />
      <section className={`k-profile-card ${cloud_mode?'k-profile-card--cloud':''}`}>
        <Avatar name={displayName} size="xl" />
        <div className="k-profile-card__main">
          <label className="k-profile-card__label" htmlFor="k-profile-name">
            {en ? 'Display name' : '表示名'}
          </label>
          <Input
            id="k-profile-name"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {if(!cloud_mode) setDisplayName(nameDraft);}}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229 && e.currentTarget.blur()}
            placeholder={en ? 'Display name' : '表示名'}
            className="k-profile-card__name"
            maxLength={80}
            disabled={cloud_mode && !accountSync.profile}
          />
          {cloud_mode && <Button size="sm" variant="secondary" disabled={!accountSync.profile || accountSync.pending>0 || nameDraft.trim()===displayName}
            onClick={()=>void Promise.resolve(setDisplayName(nameDraft)).catch(()=>{})}>{accountSync.pending?(en?'Saving…':'保存中…'):(en?'Save display name':'表示名を保存')}</Button>}
          <div className="k-profile-card__note" role="status">{cloud_mode
            ? accountSync.pending?(en?'Saving to your account…':'アカウントに保存しています…'):(en?'Your display name, saved characters and pins are shared across devices using the same account.':'表示名・保存したキャラ・ピン留めは、同じアカウントの端末で共有されます。')
            : (en?'Your display name is saved on this device.':'表示名はこのデバイスに保存されます。')}</div>
          {cloud_mode && accountSync.error && <div className="k-profile-card__note" role="alert">{friendlyMessage(accountSync.error,language)}
            <Button size="sm" variant="ghost" onClick={()=>void refreshAccountProfile()}>{en?'Reload':'再読み込み'}</Button></div>}
        </div>
        {loading ? <p role="status">{en?'Loading conversation counts…':'会話の集計を読み込んでいます…'}</p> : !loadError && <div className="k-profile-stats">
          <Stat value={talked.length} label={en?'Conversations':'会話'} />
          <Stat value={characterCount} label={en?'Characters met':'出会ったキャラ'} />
          <Stat value={messageCount} label={en?'Messages':'メッセージ'} />
        </div>}
      </section>

      <CloudSettings />

      <section className="k-section">
        <h2 className="k-section__title">
          <span className="k-section__mark">✦</span> {en?'Appearance':'表示'}
        </h2>
        <Card>
          <div style={{ display: "grid", gap: 16 }}>
            <Row label={en?'Theme':'テーマ'} desc={en?'Soft daylight or moonlit purple.':'昼のやわらかな光か、月夜の紫か。'}>
              <div className="k-segmented" role="radiogroup" aria-label={en?'Theme':'テーマ'}>
                <button role="radio" aria-checked={theme === "light"} className={theme === "light" ? "is-active" : ""} onClick={() => setTheme("light")}>
                  <Icon name="sun" size={14} /> {en?'Light':'ライト'}
                </button>
                <button role="radio" aria-checked={theme === "dark"} className={theme === "dark" ? "is-active" : ""} onClick={() => setTheme("dark")}>
                  <Icon name="moon" size={14} /> {en?'Dark':'ダーク'}
                </button>
              </div>
            </Row>
            {!cloud_mode && !isUnifiedEntry() && <div id="adult" className="k-setting-anchor">
              <Row label={en?'Adult content':'成人向けコンテンツ'} desc={en?'For adults aged 18 and over. Shows adult characters and conversations.':'18歳以上の方のみ。成人向けのキャラクターと会話を表示します。'}>
                <Switch checked={adult} onChange={(v) => void toggleAdult(v)} label={en?'Show adult content':'成人向けコンテンツを表示'} />
              </Row>
            </div>}
          </div>
        </Card>
      </section>

      {administrative && !remote_mode && executionTarget()==='local' && <><NativeSyncSettings/><details><summary>{en?'Legacy backup sync':'以前のバックアップ同期'}</summary><LocalCloudSync/></details></>}

      {savedCharacters.length > 0 && (
        <section className="k-section">
          <h2 className="k-section__title">
            <span className="k-section__mark">✦</span> {en?'Saved characters':'保存したキャラクター'}
          </h2>
          <div className="k-grid k-grid--characters">
            {savedCharacters.map((c) => (
              <CharacterCard key={c.id} id={c.id} displayName={c.display_name} hook={c.description} creator={c.official ? "Kyalulu Official" : (en?'My library':'マイライブラリ')} tags={c.tags ?? []} portraitUrl={c.portrait_url} />
            ))}
          </div>
        </section>
      )}

      {pinnedSessions.length > 0 && (
        <section className="k-section">
          <h2 className="k-section__title">
            <span className="k-section__mark">✦</span> {en?'Pinned chats':'ピン留めしたチャット'}
          </h2>
          <div className="k-chat-list">
            {pinnedSessions.map((s) => (
              <SessionRow key={s.session_id} session={s} pinned onTogglePin={() => togglePin(s.session_id)} />
            ))}
          </div>
        </section>
      )}

      {administrative && <section className="k-section">
        <h2 className="k-section__title">
          <span className="k-section__mark">✦</span> {en?'Advanced':'上級者向け'}
        </h2>
        <Card>
          <div style={{ display: "grid", gap: 16 }}>
            <Row label={en?'Researcher mode':'Researcherモード'} desc={en?'Show model selection, prompt inspection and debugging in chats.':'チャット画面にモデル選択・プロンプト確認・デバッグを表示します。'}>
              <Switch checked={researcher} onChange={setResearcher} label={en?'Researcher mode':'Researcherモード'} />
            </Row>
            <div className="k-advanced-links">
              <AdvancedLink to="/studio" icon="sparkle" label={en?'Studio':'スタジオ'} desc={en?'Conversation models and advanced settings':'会話エンジン・詳細設定'} />
              <AdvancedLink to="/research" icon="flask" label="Research" desc={en?'A/B/C comparison and ratings':'A/B/C比較・評価'} />
              <AdvancedLink to="/status" icon="globe" label="Status" desc={en?'Connection status':'接続状況'} />
            </div>
          </div>
        </Card>
      </section>}
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
