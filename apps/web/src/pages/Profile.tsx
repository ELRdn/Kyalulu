import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { fetchCharacters, fetchSessions, type CharacterInfo, type SessionInfo } from "../lib/api";
import CharacterCard from "../components/ui/CharacterCard";
import { useSavedCharacters } from "../lib/saved";
import { Input } from "../components/ui/Input";
import Avatar from "../components/ui/Avatar";
import Card from "../components/ui/Card";
import EmptyState from "../components/ui/EmptyState";
import Icon, { type IconName } from "../components/ui/Icon";
import Switch from "../components/ui/Switch";
import { useConfirm } from "../components/ui/Dialog";
import { useAdultContent } from "../lib/adult";
import { useDocumentTitle } from "../lib/title";
import { useDisplayName, setDisplayName } from "../lib/profile";
import { useTheme } from "../lib/theme";
import { useResearcherMode } from "../lib/mode";
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
import { ExecutionPicker } from '../components/UnifiedEntry';
import MobileAppStatus from '../components/MobileAppStatus';
import CloudLogin from '../components/CloudLogin';
import { isCloudGuest } from '../lib/cloudGuest';
import { executionTarget, isUnifiedEntry, preferences, savePreferences, useLanguage } from '../lib/appContext';

/** Order and contents follow docs/MOBILE_UX_SPEC.md §5.6; connection and sync settings sit under Settings › Advanced. */
export default function Profile() {
  const en = useLanguage() === 'en';
  useDocumentTitle(en ? 'My page' : 'マイページ');
  return isCloudGuest(useRuntimeAccess()) ? <GuestProfile /> : <MemberProfile />;
}

function GuestProfile() {
  const en = useLanguage() === 'en';
  const [loginOpen, setLoginOpen] = useState(false);
  return (
    <div className="k-page k-profile" style={{ maxWidth: 780 }}>
      <section className="k-profile-card k-profile-card--guest">
        <Avatar name={en ? 'Guest' : 'ゲスト'} size="xl" mascot />
        <div className="k-profile-card__main">
          <h1 className="k-page-title">{en ? 'My page' : 'マイページ'}</h1>
          <p className="k-profile-card__note">{en ? 'Sign in to keep your conversations and characters.' : 'ログインすると、会話と作ったキャラが保存されます。'}</p>
          <div><Button onClick={() => setLoginOpen(true)}>{en ? 'Sign in / Sign up' : 'ログイン / 新規登録'}</Button></div>
        </div>
      </section>
      {loginOpen && <CloudLogin returnTo="/profile" onClose={() => setLoginOpen(false)} />}
      <Settings />
    </div>
  );
}

export function MemberProfile() {
  const language=useLanguage(),en=language==='en';
  const {cloud_mode} = useRuntimeAccess();
  const displayName = useDisplayName();
  const accountSync = useAccountProfile();
  const [nameDraft, setNameDraft] = useState(displayName);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [adult] = useAdultContent();
  const savedIds = useSavedCharacters();
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [loadError, setLoadError] = useState<{cause:unknown}|null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const navigate = useNavigate();

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
  const created = characters.filter((c) => !c.official);
  const talked = sessions.filter((s) => s.count > 0);
  const characterCount = new Set(talked.map((s) => s.character_id).filter(Boolean)).size;
  const card = (c: CharacterInfo) => <CharacterCard key={c.id} id={c.id} displayName={c.display_name} hook={c.hook || c.description} creator={c.official ? "Kyalulu Official" : (en?'My library':'マイライブラリ')} tags={c.tags ?? []} portraitUrl={c.portrait_url} />;

  return (
    <div className="k-page k-profile" style={{ maxWidth: 780 }}>
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
          <Stat value={characterCount} label={en?'Met':'出会った'} />
          <Stat value={talked.length} label={en?'Conversations':'会話'} />
          <Stat value={created.length} label={en?'Created':'作った'} />
        </div>}
      </section>
      {loadError && <p role="alert">{friendlyMessage(loadError.cause,language)}<Button size="sm" variant="secondary" onClick={() => setRetry(value => value + 1)}>{en?'Reload':'再読込'}</Button></p>}

      {!loading && !loadError && <>
        <section className="k-section">
          <h2 className="k-section__title">{en?'Saved characters':'保存したキャラ'}</h2>
          {savedCharacters.length ? <div className="k-grid k-grid--characters">{savedCharacters.map(card)}</div>
            : <EmptyState mascot="wink" title={en?'Characters you save appear here.':'気になる子を保存すると、ここに並ぶよ'} action={<Button variant="secondary" onClick={() => navigate('/discover')}>{en?'Find characters':'キャラをさがす'}</Button>} />}
        </section>
        <section className="k-section">
          <h2 className="k-section__title">{en?'Characters you made':'作ったキャラ'}</h2>
          {created.length ? <div className="k-grid k-grid--characters">{created.map(card)}</div>
            : <EmptyState mascot="excited" title={en?"You haven't made a character yet.":'まだ自分のキャラはいないね'} action={<Button variant="secondary" onClick={() => navigate('/create?edit=new')}>{en?'Make one in 3 steps':'3つ決めて作る'}</Button>} />}
        </section>
      </>}

      <div className="k-profile-links">
        <AdvancedLink to="/create/settings" icon="user" label={en?'Personas':'ペルソナ'} desc={en?'Who you are in conversations':'会話でのあなたの設定'} />
      </div>
      <CloudSettings />
      <Settings member />
    </div>
  );
}

/** Settings fold into one row; everything technical stays under Advanced. */
function Settings({ member = false }: { member?: boolean }) {
  const language=useLanguage(),en=language==='en';
  const administrative = useAdministrative();
  const {cloud_mode,remote_mode} = useRuntimeAccess();
  const { theme, setTheme } = useTheme();
  const [researcher, setResearcher] = useResearcherMode();
  const [adult, setAdult] = useAdultContent();
  const [confirmDialog, confirm] = useConfirm();
  const location = useLocation();

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

  return (
    <details className="k-profile-settings" open={location.hash === '#adult' || undefined}>
      {confirmDialog}
      <summary><Icon name="settings" size={16} /> {en ? 'Settings' : '設定'}</summary>
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
          {!member && <Row label={en?'Language':'表示言語'} desc={en?'Language of the app screens.':'アプリの画面の言語です。'}>
            <select aria-label={en?'Language':'表示言語'} value={language} onChange={e=>savePreferences({...preferences(),language:e.target.value as 'ja'|'en'})}><option value="ja">日本語</option><option value="en">English</option></select>
          </Row>}
          {member && !cloud_mode && !isUnifiedEntry() && <div id="adult" className="k-setting-anchor">
            <Row label={en?'Adult content':'成人向けコンテンツ'} desc={en?'For adults aged 18 and over. Shows adult characters and conversations.':'18歳以上の方のみ。成人向けのキャラクターと会話を表示します。'}>
              <Switch checked={adult} onChange={(v) => void toggleAdult(v)} label={en?'Show adult content':'成人向けコンテンツを表示'} />
            </Row>
          </div>}
          <p className="k-profile-settings__links">
            <a href={en ? 'https://kyalulu.com/docs/en/' : 'https://kyalulu.com/docs/'} target="_blank" rel="noreferrer">{en?'Help':'ヘルプ'}</a>
            <a href={en ? '/legal/en/terms.html' : '/legal/terms.html'} target="_blank" rel="noreferrer">{en?'Terms':'利用規約'}</a>
            <a href={en ? '/legal/en/privacy.html' : '/legal/privacy.html'} target="_blank" rel="noreferrer">{en?'Privacy':'プライバシーポリシー'}</a>
          </p>
        </div>
      </Card>
      {/* Language, interests and on-device models. */}
      {member && <DeviceSettings />}
      <details className="k-profile-settings k-profile-settings--advanced">
        <summary>{en ? 'Advanced' : '上級者向け'}</summary>
        <ExecutionPicker />
        <MobileAppStatus local={executionTarget()==='device'} />
        {member && <>
          {isUnifiedEntry()&&<p><Link to="/publications">{en?'Publication review and appeals':'公開作品の審査・異議申立て'}</Link> · <Link to="/published">{en?'Approved works':'承認済み作品'}</Link></p>}
          {!cloud_mode && <ConnectionSettings showRegisteredPCs={executionTarget()!=='pc'} />}
          {administrative && executionTarget() === 'local' && <RemoteHostSettings />}
          <DeviceRegistration />
          {administrative && !remote_mode && executionTarget()==='local' && <><NativeSyncSettings/><details><summary>{en?'Legacy backup sync':'以前のバックアップ同期'}</summary><LocalCloudSync/></details></>}
          {administrative && <Card>
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
          </Card>}
        </>}
      </details>
    </details>
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
