import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { fetchCharacters, fetchSessions, type CharacterInfo, type SessionInfo } from "../lib/api";
import CharacterCard from "../components/ui/CharacterCard";
import { useSavedCharacters } from "../lib/saved";
import { Input } from "../components/ui/Input";
import EmptyState from "../components/ui/EmptyState";
import Icon, { type IconName } from "../components/ui/Icon";
import Switch from "../components/ui/Switch";
import Dialog, { useConfirm } from "../components/ui/Dialog";
import { useAdultContent } from "../lib/adult";
import { useDocumentTitle } from "../lib/title";
import { avatarFromFile, setProfileExtras, useDisplayName, useProfileExtras, setDisplayName } from "../lib/profile";
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
import { ExecutionPicker, Interests } from '../components/UnifiedEntry';
import MobileAppStatus from '../components/MobileAppStatus';
import packageInfo from '../../package.json';
import { AnalyticsConsentChoices } from '../components/AnalyticsConsent';
import { analyticsConsent, subscribeAnalyticsConsent, syncAppAnalytics } from '../lib/analytics';
import { cloudJson } from '../lib/cloud';
import CloudLogin from '../components/CloudLogin';
import { isCloudGuest } from '../lib/cloudGuest';
import { executionTarget, isUnifiedEntry, preferences, savePreferences, useLanguage } from '../lib/appContext';
import { useMediaQuery } from '../lib/useMediaQuery';
import { applyPwaUpdate, checkPwaUpdate, installPwa, startPwa, usePwa } from '../lib/pwa';
import { declareAdult, fetchAgeStatus, finishFaceCheck, startFaceCheck, type AgeStatus } from '../lib/ageCheck';
import { fetchPublicationViewer, publicationAdultConsent } from '../lib/publications';

const mascot = (name: string) => `${import.meta.env.BASE_URL}mascot/v2/${name}.webp`;

/** My page (designs 08 / 27–35, P7 / P8 / P31–38): a summary page and one subpage per topic. */
export default function Profile() {
  const en = useLanguage() === 'en';
  const { section } = useParams();
  const guest = isCloudGuest(useRuntimeAccess());
  useDocumentTitle(en ? 'My page' : 'マイページ');
  if (section === 'settings') return <SettingsPage member={!guest} />;
  if (section === 'advanced') return <AdvancedPage member={!guest} />;
  if (section === 'interests' && !guest) return <InterestsPage />;
  if (guest) return <GuestProfile />;
  if (section === 'age' && !guest) return <AgeRoute />;
  if (section === 'edit') return <WideDialog label={en ? 'Edit profile' : 'プロフィール編集'}><ProfileEdit /></WideDialog>;
  if (section === 'saved') return <SavedPage />;
  if (section === 'credits') return <CreditsPage />;
  if (section === 'account') return <SubPage title={en ? 'Account & data' : 'アカウントとデータ'}><CloudSettings /></SubPage>;
  if (section === 'connection') return <ConnectionPage member />;
  if (section === 'pairing') return <PairingPage member />;
  if (section === 'devices') return <DevicesPage member />;
  return <MemberProfile />;
}

function GuestProfile() {
  const en = useLanguage() === 'en';
  const [loginOpen, setLoginOpen] = useState(false);
  return (
    <div className="k-page k-me k-me--guest">
      <h1 className="k-page-title">{en ? 'My page' : 'マイページ'}</h1>
      <section className="k-me-login">
        <img src={mascot('pose-wave')} alt="" width={88} height={88} />
        <p>{en ? 'Sign in to keep your conversations and saved characters.' : 'ログインすると会話と保存したキャラが残ります'}</p>
        <Button size="lg" onClick={() => setLoginOpen(true)}>{en ? 'Sign in / Sign up' : 'ログイン・新規登録'}</Button>
      </section>
      {loginOpen && <CloudLogin returnTo="/profile" onClose={() => setLoginOpen(false)} />}
      <Group><LanguageRow /></Group>
      <Group><HelpRows sales={false} /></Group>
    </div>
  );
}

export function MemberProfile() {
  const { avatar } = useProfileExtras();
  const language = useLanguage(), en = language === 'en';
  const { cloud_mode } = useRuntimeAccess();
  const displayName = useDisplayName();
  const accountSync = useAccountProfile();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [adult] = useAdultContent();
  const savedIds = useSavedCharacters();
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [loadError, setLoadError] = useState<{cause:unknown}|null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const navigate = useNavigate();

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
  const card = (c: CharacterInfo) => <CharacterCard key={c.id} id={c.id} displayName={c.display_name} hook={c.hook || c.description} portraitUrl={c.portrait_url} />;

  return (
    <div className="k-page k-me">
      <h1 className="k-page-title k-me__title">{en ? 'My page' : 'マイページ'}</h1>
      <aside className="k-me__side">
        <section className="k-me-profile">
          <span className="k-me-profile__avatar" aria-hidden="true">{avatar ? <img src={avatar} alt="" /> : [...(displayName || '?')][0]}</span>
          <div className="k-me-profile__who">
            <span className="k-me-profile__name">{displayName || (en ? 'No name yet' : '名前未設定')}</span>
            <Link to="/profile/edit" className="k-me-profile__edit">{en ? 'Edit profile' : 'プロフィールを編集'}</Link>
          </div>
          {loading ? <p role="status" className="k-me-profile__note">{en ? 'Loading conversation counts…' : '会話の集計を読み込んでいます…'}</p> : !loadError && <div className="k-profile-stats">
            <Stat value={characterCount} label={en ? 'Met' : '出会った'} />
            <Stat value={talked.length} label={en ? 'Conversations' : '会話'} />
            <Stat value={created.length} label={en ? 'Created' : '作った'} />
          </div>}
        </section>
        {cloud_mode && accountSync.error && <p className="k-me-profile__note" role="alert">{friendlyMessage(accountSync.error, language)}
          <Button size="sm" variant="ghost" onClick={() => void refreshAccountProfile()}>{en ? 'Reload' : '再読み込み'}</Button></p>}
        <Group className="k-me__menu">
          <SetRow to="/create/settings" label={en ? 'Personas & worlds' : '人物像・世界観'} sub={en ? 'How characters know you' : 'あなたの呼ばれ方・設定'} />
          {cloud_mode && <CreditsRow />}
          <SetRow to="/profile/settings" label={en ? 'Settings' : '設定'} sub={en ? 'Display, help, terms, interests, advanced' : '表示・ヘルプ・規約・好み・上級者向け'} />
        </Group>
      </aside>
      {loadError && <p role="alert" className="k-me__error">{friendlyMessage(loadError.cause, language)}<Button size="sm" variant="secondary" onClick={() => setRetry(value => value + 1)}>{en ? 'Reload' : '再読込'}</Button></p>}
      {!loading && !loadError && <div className="k-me__main">
        <section className="k-section">
          <div className="k-me__head">
            <h2 className="k-section__title">{en ? 'Saved characters' : '保存したキャラ'}</h2>
            {savedCharacters.length > 0 && <Link to="/profile/saved" className="k-me__more">{en ? 'All' : 'すべて'}</Link>}
          </div>
          {savedCharacters.length ? <div className="k-me__strip">{savedCharacters.slice(0, 8).map(card)}</div>
            : <EmptyRow text={en ? 'Characters you save appear here.' : '気になる子を保存すると、ここに並びます。'} action={en ? 'Find characters' : 'キャラをさがす'} onAction={() => navigate('/discover')} />}
        </section>
        <section className="k-section">
          <h2 className="k-section__title">{en ? 'Characters you made' : '作ったキャラ'}</h2>
          {created.length ? <div className="k-me__strip">{created.map(card)}</div>
            : <EmptyRow text={en ? "You haven't made a character yet." : 'まだ自分のキャラはいないね'} action={en ? 'Make one in 3 steps' : '3つ決めて作る'} onAction={() => navigate('/create?edit=new')} />}
        </section>
      </div>}
    </div>
  );
}

function EmptyRow({ text, action, onAction }: { text: string; action: string; onAction: () => void }) {
  return (
    <div className="k-me-empty">
      <img src={mascot('face-smile')} alt="" width={64} height={64} />
      <div><p>{text}</p><Button size="sm" onClick={onAction}>{action}</Button></div>
    </div>
  );
}

export function ProfileEdit() {
  const language = useLanguage(), en = language === 'en';
  const { cloud_mode } = useRuntimeAccess();
  const navigate = useNavigate();
  const displayName = useDisplayName();
  const extras = useProfileExtras();
  const accountSync = useAccountProfile();
  const [nameDraft, setNameDraft] = useState(displayName);
  const [bioDraft, setBioDraft] = useState(extras.bio);
  const [avatarDraft, setAvatarDraft] = useState(extras.avatar);
  const [error, setError] = useState('');
  const [login, setLogin] = useState<{ provider?: string; email?: string } | null>(null);
  useEffect(() => { setNameDraft(displayName); }, [displayName]);
  useEffect(() => { setBioDraft(extras.bio); setAvatarDraft(extras.avatar); }, [extras.bio, extras.avatar]);
  useEffect(() => { if (cloud_mode) void cloudJson('account').then(value => setLogin(value.identity)).catch(() => {}); }, [cloud_mode]);
  const pick = async (file?: File) => {
    if (!file) return;
    try { setAvatarDraft(await avatarFromFile(file)); setError(''); }
    catch { setError(en ? 'That image could not be read.' : 'この画像は読み込めなかったみたい…'); }
  };
  const save = async () => {
    setError('');
    try {
      if (nameDraft.trim() !== displayName) await setDisplayName(nameDraft);
      if (bioDraft.trim() !== extras.bio) await setProfileExtras({ bio: bioDraft });
      if (avatarDraft !== extras.avatar) await setProfileExtras({ avatar: avatarDraft });
      navigate('/profile', { replace: true });
    } catch (e) { setError(friendlyMessage(e, language)); }
  };
  const email = login?.email ? `${login.email.slice(0, 2)}…@${login.email.split('@')[1]}` : '';
  return (
    <SubPage title={en ? 'Edit profile' : 'プロフィール編集'} action={<Button size="sm" className="k-me-sub__save" disabled={(cloud_mode && !accountSync.profile) || accountSync.pending > 0} onClick={() => void save()}>{en ? 'Save' : '保存'}</Button>}>
      <div className="k-me-edit">
        <div className="k-me-edit__avatar">
          <span className="k-me-profile__avatar k-me-profile__avatar--lg" aria-hidden="true">{avatarDraft ? <img src={avatarDraft} alt="" /> : [...(nameDraft || '?')][0]}</span>
          <label className="k-me-edit__change">{en ? 'Change image' : '画像を変更'}<input type="file" accept="image/*" hidden onChange={e => void pick(e.target.files?.[0])} /></label>
        </div>
        <label className="k-field" htmlFor="k-profile-name">
          <span className="k-field__label">{en ? 'Display name' : '表示名'}</span>
          <Input id="k-profile-name" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder={en ? 'Display name' : '表示名'} maxLength={80} disabled={cloud_mode && !accountSync.profile} />
        </label>
        <label className="k-field" htmlFor="k-profile-bio">
          <span className="k-field__label">{en ? 'About you' : 'ひとこと'}</span>
          <Input id="k-profile-bio" value={bioDraft} onChange={(e) => setBioDraft(e.target.value)} maxLength={160} disabled={cloud_mode && !accountSync.profile} />
          <span className="k-field__hint">{en ? 'Shown on the characters you make.' : '作ったキャラのページに表示します'}</span>
        </label>
        {(error || (cloud_mode && accountSync.error)) && <p className="k-me-profile__note" role="alert">{error || friendlyMessage(accountSync.error, language)}
          {cloud_mode && accountSync.error && <Button size="sm" variant="ghost" onClick={() => void refreshAccountProfile()}>{en ? 'Reload' : '再読み込み'}</Button>}</p>}
        {login && <Group><SetRow label={login.provider === 'google' ? 'Google' : (en ? 'Email' : 'メール')}><span className="k-set-row__value">{email}</span></SetRow></Group>}
      </div>
    </SubPage>
  );
}

function SavedPage() {
  const en = useLanguage() === 'en';
  const savedIds = useSavedCharacters();
  const [adult] = useAdultContent();
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [failed, setFailed] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    fetchCharacters(adult).then(value => { if (active) setCharacters(value); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [adult]);
  const saved = savedIds.map((id) => characters.find((c) => c.id === id)).filter((c): c is CharacterInfo => !!c);
  return (
    <SubPage title={en ? 'Saved characters' : '保存したキャラ'}>
      {failed ? <p role="alert">{en ? 'Could not load characters.' : 'キャラを読み込めませんでした。'}</p>
        : saved.length ? <div className="k-grid k-grid--characters">{saved.map(c => <CharacterCard key={c.id} id={c.id} displayName={c.display_name} hook={c.hook || c.description} portraitUrl={c.portrait_url} />)}</div>
        : <EmptyState mascot="wink" title={en ? 'Characters you save appear here.' : '気になる子を保存すると、ここに並びます。'} action={<Button onClick={() => navigate('/discover')}>{en ? 'Find characters' : 'キャラをさがす'}</Button>} />}
    </SubPage>
  );
}

/** 28 / P8: display, interests, help, then the door to Advanced. */
function SettingsPage({ member }: { member: boolean }) {
  const en = useLanguage() === 'en';
  const { cloud_mode } = useRuntimeAccess();
  const [adult, setAdult] = useAdultContent();
  const [confirmDialog, confirm] = useConfirm();
  const location = useLocation();
  const wide = useMediaQuery('(min-width: 1200px)');
  // P8: on PC one topic at a time beside the settings nav; phones keep the single list (28).
  const pane = location.hash === '#adult' ? 'interests' : (location.hash.slice(1) || 'display');
  const show = (name: string) => !wide || pane === name;
  const titles: Record<string, string> = { display: en ? 'Display' : '表示', interests: en ? 'Interests' : '好み', help: en ? 'Help & terms' : 'ヘルプ・規約', account: en ? 'Account' : 'アカウント' };

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
    <SettingsFrame current={pane} member={member}><SubPage title={wide ? titles[pane] ?? titles.display : (en ? 'Settings' : '設定')}>
      {confirmDialog}
      {show('display') && <Group title={wide ? undefined : en ? 'Display' : '表示'}><LanguageRow /></Group>}
      {member && show('interests') && <Group title={wide ? undefined : en ? 'Interests' : '好み'}>
        {wide ? <div className="k-set-row k-set-row--block"><Interests page onDone={() => {}} /></div>
          : <SetRow to="/profile/interests" label={en ? 'Your interests' : '好みの設定'} sub={en ? 'Genres and moods used for suggestions' : 'おすすめに使うジャンル・気分'} />}
        {member && !cloud_mode && !isUnifiedEntry() && <div id="adult" className="k-setting-anchor">
          <SetRow label={en ? 'Adult content' : '成人向けの表示'} sub={en ? 'For adults aged 18 and over.' : '18歳以上の方のみ'}>
            <Switch checked={adult} onChange={(v) => void toggleAdult(v)} label={en ? 'Show adult content' : '成人向けコンテンツを表示'} />
          </SetRow>
        </div>}
        {member && cloud_mode && <CloudAdultRow />}
      </Group>}
      {show('help') && <Group title={wide ? undefined : en ? 'Help & terms' : 'ヘルプ・規約'}><HelpRows />{cloud_mode && <AnalyticsRow />}</Group>}
      {!wide && <Group><SetRow to="/profile/advanced" icon="sliders" label={en ? 'Advanced' : '上級者向け'} sub={en ? 'Execution target, connections, sync, research tools' : '実行先・接続先・同期・研究者向けツール'} /></Group>}
      {cloud_mode && show('account') && <Group title={wide ? undefined : en ? 'Account' : 'アカウント'}><AccountRows /></Group>}
      {show('help') && <p className="k-set-version">Kyalulu {packageInfo.version}</p>}
    </SubPage></SettingsFrame>
  );
}

function CreditsRow() {
  const en = useLanguage() === 'en';
  const [credits, setCredits] = useState<number | null>(null);
  useEffect(() => { void cloudJson('account').then(value => { if (typeof value?.wallet?.credits === 'number') setCredits(value.wallet.credits); }).catch(() => {}); }, []);
  return <SetRow to="/profile/credits" label={en ? 'Credits' : 'クレジット'} sub={credits === null ? undefined : `${en ? 'Remaining' : '残り'} ${credits.toLocaleString()}`}>{credits !== null && <span className="k-set-row__value k-set-row__value--wide">{credits.toLocaleString()}</span>}<Icon name="chevron" size={16} className="k-set-row__chev" /></SetRow>;
}

/** 28: the analytics choice, shown only where analytics can actually run. */
function AnalyticsRow() {
  const language = useLanguage(), en = language === 'en';
  const consent = useSyncExternalStore(subscribeAnalyticsConsent, () => analyticsConsent());
  const [ready] = useState(syncAppAnalytics);
  const [open, setOpen] = useState(false);
  if (!ready) return null;
  return <>
    <SetRow label={en ? 'Analytics' : '解析の設定'} onClick={() => setOpen(true)}>
      <span className="k-set-row__value">{consent === 'granted' ? (en ? 'On' : 'オン') : (en ? 'Off' : 'オフ')}</span>
      <Icon name="chevron" size={16} className="k-set-row__chev" />
    </SetRow>
    <Dialog open={open} onClose={() => setOpen(false)} labelledBy="analytics-consent-title">
      <AnalyticsConsentChoices language={language} onChoose={value => { analyticsConsent(value); setOpen(false); }} />
    </Dialog>
  </>;
}

function AccountRows() {
  const en = useLanguage() === 'en';
  const logout = async () => { await cloudJson('auth/logout', { method: 'POST' }).catch(() => {}); window.location.assign('/'); };
  return <>
    <SetRow label={en ? 'Log out' : 'ログアウト'} onClick={() => void logout()}><span /></SetRow>
    <span className="k-set-row__danger"><SetRow to="/profile/account" label={en ? 'Delete account' : 'アカウントを削除'}><span /></SetRow></span>
  </>;
}

/** Cloud accounts: the switch asks the server; unverified adults go through 35 first. */
function CloudAdultRow() {
  const en = useLanguage() === 'en';
  const navigate = useNavigate();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void publicationAdultConsent().then(setOn).catch(() => {}); }, []);
  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      const { owner_scope } = await fetchPublicationViewer();
      setOn(await publicationAdultConsent(next, owner_scope));
    } catch (error) {
      if ((error as { code?: string }).code === 'adult_verification_required') navigate('/profile/age');
    } finally { setBusy(false); }
  };
  return <div id="adult" className="k-setting-anchor">
    <SetRow label={en ? 'Adult content' : '成人向けの表示'} sub={en ? 'Requires an age check' : '年齢確認が必要です'}>
      <Switch checked={on} disabled={busy} onChange={(v) => void toggle(v)} label={en ? 'Show adult content' : '成人向けコンテンツを表示'} />
    </SetRow>
  </div>;
}

/** 35: declaration where no law requires a check, Yoti facial age estimation where one does. */
/** P38 is a dialog over My page, P47 (the failed check) a page of its own. */
function AgeRoute() {
  const en = useLanguage() === 'en', [failed, setFailed] = useState(false);
  return <WideDialog asPage={failed} label={en ? 'Age check' : '年齢確認'}><AgeCheckPage onFailed={() => setFailed(true)} /></WideDialog>;
}

function AgeCheckPage({ onFailed }: { onFailed?: () => void }) {
  const en = useLanguage() === 'en';
  const navigate = useNavigate();
  const [status, setStatus] = useState<AgeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const done = async () => {
    const { owner_scope } = await fetchPublicationViewer();
    await publicationAdultConsent(true, owner_scope);
    navigate('/profile/settings#adult', { replace: true });
  };
  const run = async (step: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await step(); } catch (e) { setError(friendlyMessage(e)); } finally { setBusy(false); }
  };
  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get('sessionId');
    if (sessionId) history.replaceState(null, '', window.location.pathname);
    void run(async () => {
      const value = sessionId ? await finishFaceCheck(sessionId) : await fetchAgeStatus();
      setStatus(value);
      if (value.verified && sessionId) await done();
    });
  }, []);
  const face = status?.method === 'yoti';
  const failed = status?.result === 'fail';
  useEffect(() => { if (failed) onFailed?.(); }, [failed, onFailed]);
  const retry = status?.result === 'error' || status?.result === 'cancelled' || status?.result === 'expired';
  const unavailable = status && (!status.method || !status.adult_band);
  const steps = face
    ? [en ? 'Estimate your age from a selfie' : '顔写真で年齢を推定', en ? 'If that is not enough, use an ID' : '難しいときは身分証で確認']
    : [en ? 'Confirm you are 18 or over' : '18歳以上であることを確認'];
  return (
    <SubPage title={en ? 'Age check' : '年齢確認'}>
      <div className={`k-age${failed ? ' k-age--failed' : ''}`}>
        <img className="k-age__mascot" src={`${import.meta.env.BASE_URL}mascot/v2/face-smile.webp`} alt="" width={96} height={96} />
        {!status ? <p className="k-age__lead">{error || (en ? 'Loading…' : '読み込み中…')}</p>
          : unavailable ? <p className="k-age__lead">{!status.adult_band
            ? (en ? 'Adult content is for people aged 18 and over.' : '成人向けの表示は18歳以上の方のみです。')
            : (en ? 'Adult content is not offered in your region yet.' : 'お住まいの地域では、まだ成人向けの表示を提供していません。')}</p>
          : <>
            <p className="k-age__lead">{failed ? (en ? 'We could not confirm your age.' : 'うまく確認できなかったみたい…')
              : retry ? (en ? 'The check did not finish. Please try again.' : '確認が完了しませんでした。もう一度お試しください。')
              : (en ? 'To show adult characters, we need to confirm you are 18 or over.' : '成人向けのキャラを表示するには、18歳以上であることの確認が必要です。')}</p>
            {!failed && <Group><ol className="k-age__steps">{steps.map((label, i) => <li key={label} className={status.verified ? 'is-done' : ''}><span aria-hidden="true">{status.verified ? '✓' : i + 1}</span>{label}</li>)}</ol></Group>}
            <p className="k-age__note">{failed ? (en ? 'Characters that are not adult-only stay available.' : '成人向け以外のキャラはそのまま使えます') : face
              ? (en ? 'The check is done by Yoti. Images are used only to confirm your age and deleted right after.' : '確認はYotiが行います。画像は年齢の確認だけに使い、確認後すぐに削除されます。')
              : (en ? 'False statements may lead to your account being suspended.' : '申告が事実と異なる場合、利用を停止することがあります。')}</p>
            {error && <p role="alert" className="k-age__note">{error}</p>}
            {status.verified ? <Button disabled={busy} onClick={() => void run(done)}>{en ? 'Show adult content' : '成人向けを表示する'}</Button>
              : face ? <Button disabled={busy} onClick={() => void run(async () => { window.location.assign(await startFaceCheck()); })}>
                {failed ? (en ? 'Check with an ID' : '身分証で確認') : (en ? 'Check with a selfie' : '顔写真で確認')}</Button>
              : <Button disabled={busy} onClick={() => void run(async () => { setStatus(await declareAdult()); await done(); })}>{en ? 'I am 18 or over' : '18歳以上です'}</Button>}
          </>}
        <button type="button" className="k-age__later" onClick={() => navigate('/profile/settings', { replace: true })}>{en ? 'Later' : 'あとで'}</button>
      </div>
    </SubPage>
  );
}

/** 29: every technical setting, one row each; the detail lives one level down. */
function AdvancedPage({ member }: { member: boolean }) {
  const en = useLanguage() === 'en';
  const administrative = useAdministrative();
  const { cloud_mode } = useRuntimeAccess();
  const [researcher, setResearcher] = useResearcherMode();
  const pwa = usePwa();
  const wide = useMediaQuery('(min-width: 1200px)');
  useEffect(() => { void startPwa(); }, []);
  const relay = import.meta.env.VITE_RELAY_ORIGIN ? new URL(import.meta.env.VITE_RELAY_ORIGIN).host : '';
  return (
    <SettingsFrame current="advanced" member={member}><SubPage title={en ? 'Advanced' : '上級者向け'}>
      <ExecutionPicker segment />
      {!wide && pwa.enabled && <Group title={en ? 'App' : 'アプリ'}>
        {!pwa.installed && <SetRow label={en ? 'Add to home screen' : 'ホーム画面に追加'} sub={en ? 'Use it like an app' : 'アプリのように使えます'} onClick={() => { if (pwa.installable && !pwa.busy) void installPwa(); }} />}
        <SetRow label={en ? 'Check for updates' : '更新を確認'} onClick={() => { if (pwa.busy || !pwa.online) return; if (pwa.updateAvailable) applyPwaUpdate(); else void checkPwaUpdate(); }}>
          <span className="k-set-row__value">{pwa.busy ? (en ? 'Checking…' : '確認中…') : pwa.updateAvailable ? (en ? 'Update available' : '更新があります') : (en ? 'Up to date' : '最新です')}</span>
        </SetRow>
      </Group>}
      {member && <Group title={en ? 'Connection & sync' : '接続・同期'}>
        {!cloud_mode && <SetRow to="/profile/connection" label={en ? 'Connection' : '接続先'}>{relay ? <><span className="k-set-row__value">{relay}</span><Icon name="chevron" size={16} className="k-set-row__chev" /></> : undefined}</SetRow>}
        <SetRow to="/profile/pairing" label={en ? 'Connect your PC' : '自分のPCとつなぐ'} sub={en ? 'Register with a pairing code' : 'ペアリングコードで登録'} />
        <SetRow to="/profile/devices" label={en ? 'Device sync' : '端末の同期'} />
        {isUnifiedEntry() && <SetRow to="/publications" label={en ? 'Published works' : '公開した作品'} />}
      </Group>}
      {member && administrative && <Group title={en ? 'For researchers' : '研究者向け'}>
        <SetRow label={en ? 'Researcher mode' : '研究者モード'} sub={en ? 'Shows debugging and Studio in chats' : 'チャットにデバッグとStudioを出します'}>
          <Switch checked={researcher} onChange={setResearcher} label={en ? 'Researcher mode' : '研究者モード'} />
        </SetRow>
        <SetRow to="/studio" label="Studio" />
        <SetRow to="/research" label="Research" />
        <SetRow to="/status" label="Status" />
      </Group>}
    </SubPage></SettingsFrame>
  );
}

/** One level under 29: the existing connection forms, unchanged in behavior. */
function ConnectionPage({ member }: { member: boolean }) {
  const en = useLanguage() === 'en';
  return <SettingsFrame current="advanced" member={member}><SubPage title={en ? 'Connection' : '接続先'}><ConnectionSettings showRegisteredPCs={executionTarget() !== 'pc'} /></SubPage></SettingsFrame>;
}

function PairingPage({ member }: { member: boolean }) {
  const en = useLanguage() === 'en';
  const administrative = useAdministrative();
  return <SettingsFrame current="advanced" member={member}><SubPage title={en ? 'Connect your PC' : '自分のPCとつなぐ'}>
    {administrative && executionTarget() === 'local' && <RemoteHostSettings />}
    <DeviceRegistration />
  </SubPage></SettingsFrame>;
}

function DevicesPage({ member }: { member: boolean }) {
  const en = useLanguage() === 'en';
  const administrative = useAdministrative();
  const { remote_mode } = useRuntimeAccess();
  return <SettingsFrame current="advanced" member={member}><SubPage title={en ? 'Device sync' : '端末の同期'}>
    <MobileAppStatus local={executionTarget() === 'device'} />
    <DeviceSettings advanced />
    {administrative && !remote_mode && executionTarget() === 'local' && <><NativeSyncSettings /><details><summary>{en ? 'Legacy backup sync' : '以前のバックアップ同期'}</summary><LocalCloudSync /></details></>}
  </SubPage></SettingsFrame>;
}

type WalletAccount = { private_test?: boolean; billing_available: boolean; wallet: { credits: number; plan: string;
  usage?: { state: string; created: number; charged_credits: number; label?: string }[]; lots: { remaining: number; expires: number; kind: string; created?: number | null; granted?: number | null }[] } };

/** 30: the balance and its history; plans, BYOK and data tools stay on the account page. */
function CreditsPage() {
  const language = useLanguage(), en = language === 'en';
  const navigate = useNavigate();
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void cloudJson('account').then(value => setAccount(value as WalletAccount)).catch(e => setError(friendlyMessage(e, language))); }, [language]);
  const when = (seconds: number) => {
    const date = new Date(seconds * 1000), days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) / 86400000);
    const time = date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });
    return days === 0 ? `${en ? 'Today' : '今日'} ${time}` : days === 1 ? `${en ? 'Yesterday' : '昨日'} ${time}` : date.toLocaleDateString(language, { month: 'long', day: 'numeric' });
  };
  const free = account?.wallet.plan === 'free';
  const usage = (account?.wallet.usage ?? []).filter(item => item.state === 'completed');
  return (
    <SubPage title={en ? 'Credits' : 'クレジット'}>
      {!account ? <p className="k-me-profile__note" role={error ? 'alert' : 'status'}>{error || (en ? 'Loading…' : '読み込み中…')}</p> : <>
        <section className="k-credit-balance">
          <span>{en ? 'Remaining' : '残り'}</span>
          <strong>{account.wallet.credits.toLocaleString()}</strong>
          <small>K-Credits{free ? (en ? ' · Free beta allowance' : ' · 無料βの配布分') : ''}</small>
        </section>
        <Button variant="secondary" className="k-credit-add" disabled={!account.billing_available} onClick={() => navigate('/profile/account')}>{account.billing_available ? (en ? 'Add credits' : 'クレジットを追加') : (en ? 'Add credits (coming soon)' : 'クレジットを追加（準備中）')}</Button>
        <section className="k-set"><div><h2 className="k-set__title">{en ? 'What credits cover' : '使い道の目安'}</h2>
          <p className="k-set__desc">{en ? 'Each reply uses about 2 to 12, depending on its length and the model.' : '1回の返事で約2〜12。返事の長さとモデルで変わります。'}</p></div></section>
        {(usage.length > 0 || account.wallet.lots.length > 0) && <Group title={en ? 'History' : '履歴'}>
          {usage.map((item, i) => <div className="k-credit-row" key={`u${i}`}><span><b>{item.label ? (en ? `Chat with ${item.label}` : `${item.label}との会話`) : (en ? 'Conversation reply' : '会話の返事')}</b><small>{when(item.created)}</small></span><em>-{item.charged_credits.toLocaleString()}</em></div>)}
          {account.wallet.lots.map((lot, i) => <div className="k-credit-row" key={`l${i}`}><span><b>{lot.kind === 'admin' ? (en ? 'Admin grant' : '管理者からの付与') : lot.kind === 'purchase' ? (en ? 'Purchased credits' : '購入分') : (en ? 'Free beta allowance' : '無料β配布')}</b><small>{lot.created ? when(lot.created) : en ? `Expires ${new Date(lot.expires * 1000).toLocaleDateString(language)}` : `${new Date(lot.expires * 1000).toLocaleDateString(language)}まで`}</small></span><em className="is-plus">+{(lot.granted ?? lot.remaining).toLocaleString()}</em></div>)}
        </Group>}
      </>}
    </SubPage>
  );
}

/** P8: the settings nav to the left of the open topic. Hidden on phones, where each topic is a page. */
function SettingsFrame({ current, member, children }: { current: string; member: boolean; children: ReactNode }) {
  const en = useLanguage() === 'en';
  const { cloud_mode } = useRuntimeAccess();
  const items: [string, string, string][] = [
    ['display', '/profile/settings', en ? 'Display' : '表示'],
    ...(member ? [['interests', '/profile/settings#interests', en ? 'Interests' : '好み'] as [string, string, string]] : []),
    ['help', '/profile/settings#help', en ? 'Help & terms' : 'ヘルプ・規約'],
    ['advanced', '/profile/advanced', en ? 'Advanced' : '上級者向け'],
    ...(cloud_mode ? [['account', '/profile/settings#account', en ? 'Account' : 'アカウント'] as [string, string, string]] : []),
  ];
  return (
    <div className="k-settings2">
      <nav className="k-settings2__nav" aria-label={en ? 'Settings' : '設定'}>
        <h2>{en ? 'Settings' : '設定'}</h2>
        {items.map(([key, to, label]) => <Link key={key} to={to} className={`k-settings2__item ${current === key ? 'is-active' : ''}`} aria-current={current === key ? 'page' : undefined}>{label}</Link>)}
      </nav>
      {children}
    </div>
  );
}

function LanguageRow() {
  const language = useLanguage(), en = language === 'en';
  return (
    <SetRow label={en ? 'Language' : '言語'}>
      <span className="k-set-row__picker">
        <select className="k-set-row__select" aria-label={en ? 'Language' : '言語'} value={language} onChange={e => savePreferences({ ...preferences(), language: e.target.value as 'ja' | 'en' })}>
          <option value="ja">日本語</option><option value="en">English</option>
        </select>
        <Icon name="chevron" size={16} />
      </span>
    </SetRow>
  );
}

function HelpRows({ sales = true }: { sales?: boolean }) {
  const en = useLanguage() === 'en';
  return <>
    <SetRow href={en ? 'https://kyalulu.com/docs/en/' : 'https://kyalulu.com/docs/'} label={en ? 'Help' : 'ヘルプ'} />
    <SetRow to="/profile/legal/terms" label={en ? 'Terms' : '利用規約'} />
    <SetRow to="/profile/legal/privacy" label={en ? 'Privacy' : 'プライバシーポリシー'} />
    {sales && <SetRow to="/profile/legal/sales" label={en ? 'Commercial disclosure' : '特定商取引法に基づく表記'} />}
  </>;
}

/** P37 / P38: on PC these sub pages open as a 480px dialog over My page. */
function WideDialog({ label, asPage, children }: { label: string; asPage?: boolean; children: ReactNode }) {
  const wide = useMediaQuery('(min-width: 1200px)');
  const navigate = useNavigate();
  if (!wide || asPage) return <>{children}</>;
  return <><MemberProfile /><Dialog open onClose={() => navigate('/profile')} label={label} width={480} wide>{children}</Dialog></>;
}

function InterestsPage() {
  const en = useLanguage() === 'en', wide = useMediaQuery('(min-width: 1200px)');
  return <SettingsFrame current="interests" member><SubPage title={wide ? (en ? 'Interests' : '好み') : en ? 'Your interests' : '好みの設定'}><Interests page onDone={() => history.back()} /></SubPage></SettingsFrame>;
}

export function SubPage({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const en = useLanguage() === 'en';
  const navigate = useNavigate();
  return (
    <div className="k-page k-me-sub">
      <header className="k-me-sub__head">
        <button type="button" className="k-me-sub__back" aria-label={en ? 'Back' : '戻る'} onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/profile'))}>
          <Icon name="back" size={22} />
        </button>
        <h1>{title}</h1>
        {action}
      </header>
      {children}
    </div>
  );
}

export function Group({ title, className = '', children }: { title?: string; className?: string; children: ReactNode }) {
  return (
    <section className={`k-set ${className}`}>
      {title && <h2 className="k-set__title">{title}</h2>}
      <div className="k-set__group">{children}</div>
    </section>
  );
}

export function SetRow({ label, sub, icon, to, href, onClick, children }: { label: string; sub?: string; icon?: IconName; to?: string; href?: string; onClick?: () => void; children?: ReactNode }) {
  // The label names the row; the line under it describes it (so "Your interests" stays an exact accessible name).
  const subId = useId(), described = sub ? { 'aria-label': label, 'aria-describedby': subId } : {};
  const body = <>
    {icon && <Icon name={icon} size={20} className="k-set-row__icon" />}
    <span className="k-set-row__text"><span className="k-set-row__label">{label}</span>{sub && <span className="k-set-row__sub" id={subId}>{sub}</span>}</span>
    {children ?? <Icon name="chevron" size={18} className="k-set-row__chev" />}
  </>;
  if (to) return <Link to={to} className="k-set-row" {...described}>{body}</Link>;
  if (href) return <a href={href} target="_blank" rel="noreferrer" className="k-set-row">{body}</a>;
  if (onClick) return <button type="button" className="k-set-row" onClick={onClick} {...described}>{body}</button>;
  return <div className="k-set-row">{body}</div>;
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="k-profile-stat">
      <span className="k-profile-stat__value">{value}</span>
      <span className="k-profile-stat__label">{label}</span>
    </div>
  );
}
