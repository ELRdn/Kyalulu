import { useEffect } from "react";
import { applyPwaUpdate, checkPwaUpdate, installPwa, startPwa, usePwa } from "../lib/pwa";
import "./MobileAppStatus.css";

export default function MobileAppStatus() {
  const pwa = usePwa();
  useEffect(() => { void startPwa(); }, []);
  if (!pwa.enabled) return null;

  return (
    <aside className="k-mobile-status" aria-label="アプリと接続の状態">
      <details className="k-mobile-status__details">
        <summary>
          <span className={`k-mobile-status__dot ${pwa.online ? "" : "is-offline"}`} aria-hidden="true" />
          <span role="status">{!pwa.online ? "オフライン · 会話には接続が必要です" : pwa.updateAvailable ? "新しいバージョンがあります" : "オンライン"}</span>
          <span className="k-mobile-status__hint">アプリ情報</span>
        </summary>
        <div className="k-mobile-status__panel">
          <p>{pwa.online ? "端末はオンラインです。AIとの会話にはサーバーへの接続も必要です。" : "接続が戻るまで、会話の送受信やキャラクターの取得はできません。"}</p>
          <p>{pwa.offlineReady ? "アプリの外枠を保存済み。" : "アプリの外枠はオンラインでの初回起動後に保存されます。"} 会話やユーザー画像はオフライン用に保存しません。</p>
          {!pwa.installed && <p>{pwa.installable ? "ホーム画面にKyaluluを追加できます。" : "インストールに対応したブラウザでは、メニューから「アプリをインストール」または「ホーム画面に追加」を選べます。"}</p>}
          {pwa.installed && <p>ホーム画面アプリとして利用中</p>}
          {pwa.updateAvailable && <p>更新すると再読み込みします。会話の生成を止め、入力内容を保存してから操作してください。</p>}
          <div className="k-mobile-status__actions">
            {pwa.installable && !pwa.installed && <button type="button" disabled={pwa.busy || !pwa.online} onClick={() => void installPwa()}>アプリを追加</button>}
            {pwa.updateAvailable
              ? <button type="button" disabled={pwa.busy || !pwa.online} onClick={applyPwaUpdate}>更新して再読み込み</button>
              : <button type="button" disabled={pwa.busy || !pwa.online} onClick={() => void checkPwaUpdate()}>更新を確認</button>}
          </div>
          {pwa.busy && <p role="status">処理しています…</p>}
          {pwa.error && <p role="alert">{pwa.error}</p>}
        </div>
      </details>
    </aside>
  );
}
