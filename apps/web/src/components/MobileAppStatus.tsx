import { useEffect } from "react";
import { applyPwaUpdate, checkPwaUpdate, installPwa, startPwa, usePwa, pwaMessages } from "../lib/pwa";
import { useLanguage } from '../lib/appContext';
import "./MobileAppStatus.css";

export default function MobileAppStatus({ local = false }: { local?: boolean }) {
  const pwa = usePwa();
  const language = useLanguage(), en = language === 'en';
  useEffect(() => { void startPwa(); }, []);
  if (!pwa.enabled) return null;

  return (
    <aside className="k-mobile-status" aria-label={en ? 'App and connection status' : 'アプリと接続の状態'}>
      <details className="k-mobile-status__details">
        <summary>
          <span className={`k-mobile-status__dot ${pwa.online ? "" : "is-offline"}`} aria-hidden="true" />
          <span role="status">{!pwa.online ? local ? (en ? 'Offline · Use prepared models on this device' : 'オフライン · 保存済みモデルで会話できます') : (en ? 'Offline · A connection is needed for generation' : 'オフライン · 生成には接続が必要です') : pwa.updateAvailable ? (en ? 'An update is available' : '新しいバージョンがあります') : (en ? 'Online' : 'オンライン')}</span>
          <span className="k-mobile-status__hint">{en ? 'App info' : 'アプリ情報'}</span>
        </summary>
        <div className="k-mobile-status__panel">
          <p>{local ? (en ? 'AI runs on this device. Downloading and preparing a model for the first time requires a connection.' : 'AIの推論は端末内で行います。モデルのダウンロードと初回準備には通信が必要です。') : (en ? 'Cloud and connected-PC generation require a connection to that server.' : 'Cloud・接続先PCでの生成には、そのサーバーへの接続が必要です。')}</p>
          <p>{pwa.offlineReady ? (en ? 'The app shell is saved.' : 'アプリの外枠を保存済み。') : (en ? 'The app shell is saved after the first online visit.' : 'アプリの外枠はオンラインでの初回起動後に保存されます。')} {local ? (en ? 'Characters, conversations and verified models are stored in this browser on this device.' : 'キャラと会話、検証済みモデルはこのブラウザの端末内に保存します。') : (en ? 'Conversation storage and offline access follow your selected execution target and storage policy.' : '会話の保存先・オフライン利用可否は、選択した実行先と保存方針に従います。')}</p>
          {!pwa.installed && <p>{pwa.installable ? (en ? 'You can add Kyalulu to your home screen.' : 'ホーム画面にKyaluluを追加できます。') : (en ? 'In a supported browser, choose “Install app” or “Add to home screen” from its menu.' : 'インストールに対応したブラウザでは、メニューから「アプリをインストール」または「ホーム画面に追加」を選べます。')}</p>}
          {pwa.installed && <p>{en ? 'Running as a home-screen app' : 'ホーム画面アプリとして利用中'}</p>}
          {pwa.updateAvailable && <p>{en ? 'Updating reloads the app. Stop generation and save your input before continuing.' : '更新すると再読み込みします。会話の生成を止め、入力内容を保存してから操作してください。'}</p>}
          <div className="k-mobile-status__actions">
            {pwa.installable && !pwa.installed && <button type="button" disabled={pwa.busy || !pwa.online} onClick={() => void installPwa()}>{en ? 'Install app' : 'アプリを追加'}</button>}
            {pwa.updateAvailable
              ? <button type="button" disabled={pwa.busy || !pwa.online} onClick={applyPwaUpdate}>{en ? 'Update and reload' : '更新して再読み込み'}</button>
              : <button type="button" disabled={pwa.busy || !pwa.online} onClick={() => void checkPwaUpdate()}>{en ? 'Check for updates' : '更新を確認'}</button>}
          </div>
          {pwa.busy && <p role="status">{en ? 'Working…' : '処理しています…'}</p>}
          {pwa.error && <p role="alert">{pwaMessages[language][pwa.error]}</p>}
        </div>
      </details>
    </aside>
  );
}
