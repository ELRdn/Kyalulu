import { useEffect, useReducer, type Ref } from 'react';
import Button from './ui/Button';
import './firstChatTutorial.css';
import type { Language } from '../lib/appContext';

export const FIRST_CHAT_TUTORIAL_KEY = 'kyalulu-first-chat-tutorial-v1';
export type TutorialReceipt = 'completed' | 'skipped';
type ReceiptStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type TutorialState = { open: boolean; step: number; receipt: TutorialReceipt | null };
export type TutorialAction = 'auto-open' | 'reopen' | 'next' | 'back' | TutorialReceipt;

// Store only the versioned completion status, never conversation or account data.
export function readTutorialReceipt(storage?: ReceiptStorage): TutorialReceipt | null {
  try {
    const value = (storage ?? localStorage).getItem(FIRST_CHAT_TUTORIAL_KEY);
    return value === 'completed' || value === 'skipped' ? value : null;
  } catch { return null; }
}

export function writeTutorialReceipt(receipt: TutorialReceipt, storage?: ReceiptStorage): boolean {
  try {
    (storage ?? localStorage).setItem(FIRST_CHAT_TUTORIAL_KEY, receipt);
    return true;
  } catch { return false; }
}

export function tutorialReducer(state: TutorialState, action: TutorialAction): TutorialState {
  switch (action) {
    case 'auto-open': return state.receipt || state.open ? state : { ...state, open: true, step: 0 };
    case 'reopen': return { ...state, open: true, step: 0 };
    case 'next': return { ...state, step: Math.min(3, state.step + 1) };
    case 'back': return { ...state, step: Math.max(0, state.step - 1) };
    default: return { ...state, open: false, receipt: action };
  }
}

export function useFirstChatTutorial(firstTalkReady: boolean) {
  const [state, dispatch] = useReducer(tutorialReducer, undefined,
    () => ({ open: false, step: 0, receipt: readTutorialReceipt() }));
  const [storageFailed, setStorageFailed] = useReducer(() => true, false);
  useEffect(() => { if (firstTalkReady) dispatch('auto-open'); }, [firstTalkReady]);
  return {
    ...state, storageFailed,
    reopen: () => dispatch('reopen'),
    next: () => dispatch('next'),
    back: () => dispatch('back'),
    dismiss: (receipt: TutorialReceipt) => {
      if (!writeTutorialReceipt(receipt)) setStorageFailed();
      dispatch(receipt);
    },
  };
}

export type FirstChatTutorialProps = {
  language?: Language;
  device?: boolean;
  step: number;
  cloud: boolean;
  inspectorAvailable: boolean;
  storageFailed: boolean;
  panelRef?: Ref<HTMLElement>;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onComplete: () => void;
  onFocusComposer: () => void;
  onOpenModels: () => void;
  onOpenMemory: () => void;
  onOpenInspector: () => void;
};

export default function FirstChatTutorial({ step, cloud, device = false, language = 'ja', inspectorAvailable, storageFailed, panelRef,
  onNext, onBack, onSkip, onComplete, onFocusComposer, onOpenModels, onOpenMemory, onOpenInspector,
}: FirstChatTutorialProps) {
  const en = language === 'en';
  const titles = en ? ['Start with a message', 'Check the destination and cost', 'Review and correct memories', 'Inspect how replies use memory']
    : ['ひとことから始めよう', '送信先と料金を確認しよう', '記憶を確認・訂正しよう', '返事の裏側を確認しよう'];
  return <section ref={panelRef} tabIndex={-1} className="k-first-chat-tutorial" aria-label={en ? 'First chat guide' : '初トークの案内'}
    onKeyDown={event => {
      if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
        event.preventDefault(); event.stopPropagation(); onSkip();
      }
    }}>
    <div className="k-first-chat-tutorial__head">
      <span>{en ? 'First chat guide' : '初トークの案内'} · {step + 1} / 4</span>
      <Button type="button" variant="ghost" size="sm" onClick={onSkip}>{en ? 'Skip' : 'スキップ'}</Button>
    </div>
    <div aria-live="polite" aria-atomic="true">
      <h2>{titles[step]}</h2>
      {step === 0 && <p>{en ? 'Write a greeting or topic in the input and press Send. This guide never fills in or sends a message automatically.' : '入力欄に挨拶や話したいことを書き、送信ボタンを押します。この案内は自動で入力・送信しません。'}</p>}
      {step === 1 && (device ? <>
        <p>{en ? 'Prepare a model in Settings, then select it in “Character & preset”. Generation runs in this browser on this device.' : '設定でモデルを準備し、「キャラ・プリセット」で選びます。生成はこのブラウザーの端末内で行います。'}</p>
        <p>{en ? 'Model download and first-time preparation require a connection. Device-only conversations and memory processing are not sent to Cloud or external AI. Switching execution targets never transfers a conversation automatically.' : 'モデルの取得と初回準備には通信が必要です。端末限定の会話・記憶処理をCloudや外部AIへ送りません。実行先を切り替えても会話を自動転送しません。'}</p>
      </> : cloud ? <>
        <p>{en ? 'Cloud shows a quote above the input before every send. Review the destination, model, cost cap and which conversation, settings and memories will be sent before consenting.' : 'Cloudでは送信のたびに、入力欄の上に見積確認が出ます。送信先・モデル・料金上限と、会話や設定・記憶が送られる範囲を確認してから同意します。'}</p>
        <p>{en ? 'Canceling or expiry does not start generation. BYOK uses your own API key; provider charges are separate from K-Credits. Choose an available route in “Character & preset”.' : '取り消しや期限切れでは生成を始めません。BYOKは自分のAPIキーを使い、提供元の料金はK-Creditsとは別に負担します。利用できる送信先は「キャラ・プリセット」で選べます。'}</p>
      </> : <>
        <p>{en ? 'Choose a configured conversation model in “Character & preset”. Local models run on the connected PC. Set up the model connection or API key in Settings first.' : '「キャラ・プリセット」で、接続先に設定済みの会話エンジンを選びます。ローカルモデルは接続先のPCで動きます。初回のモデル接続・APIキー設定は、設定画面で行います。'}</p>
        <p>{en ? 'BYOK sends the conversation to an external provider using your own API key, and provider charges apply. Local connections do not show Cloud’s per-send quote. Check the destination, model and provider costs before sending.' : 'BYOKは自分のAPIキーで外部の提供元へ会話を送り、提供元の料金がかかります。ローカル接続ではCloudの毎回の見積確認は出ません。送信前に接続先・モデルと提供元の料金を確認してください。'}</p>
      </>)}
      {step === 2 && <>
        <p>{en ? 'In the information panel, open “Memories” and enable conversation memory yourself. Review the sources of saved memories, then edit or delete incorrect ones.' : '情報パネルの「覚えていること」で、「会話を覚える」を自分で有効にできます。保存された記憶は出典を確認し、違っていたら編集・削除できます。'}</p>
        <p>{en ? 'Word matches do not prove a fact. Correcting a memory and editing conversation text are separate operations. Sharing across worlds is also your choice after reviewing its scope.' : '語句の一致は事実の証明ではありません。記憶の訂正と会話本文の編集は別の操作です。世界をまたぐ共有も、共有範囲を確認して自分で選びます。'}</p>
      </>}
      {step === 3 && <>
        <p>{en ? 'Inspector shows which memories were candidates or included in a recorded reply. There may be no record before a reply or when memory is disabled.' : 'Inspectorは、記録されたターンでどの記憶が候補になり、返事に採用されたかを調べる詳細画面です。まだ返事がない、または記憶が無効のときは記録がないことがあります。'}</p>
        <p>{inspectorAvailable ? (en ? '“Open Inspector” enables detailed mode. Look for “Memory Inspector” in the debug panel.' : '「Inspectorを開く」で詳細モードを有効にし、デバッグ画面の「Memory Inspector」を確認できます。') : (en ? 'Detailed Inspector is unavailable on this connection. Open “Memories” to review saved memories and their sources.' : 'この接続では詳細Inspectorを利用できません。「覚えていること」で保存された記憶と出典を確認してください。')}</p>
      </>}
    </div>
    <div className="k-first-chat-tutorial__links">
      {step === 0 && <Button type="button" variant="secondary" size="sm" onClick={onFocusComposer}>{en ? 'Focus input' : '入力欄へ'}</Button>}
      {step === 1 && <Button type="button" variant="secondary" size="sm" onClick={onOpenModels}>{en ? 'Open Character & preset' : 'キャラ・プリセットを開く'}</Button>}
      {(step === 2 || (step === 3 && !inspectorAvailable)) && <Button type="button" variant="secondary" size="sm" onClick={onOpenMemory}>{en ? 'Open Memories' : '覚えていることを開く'}</Button>}
      {step === 3 && <Button type="button" variant="secondary" size="sm" disabled={!inspectorAvailable}
        onClick={inspectorAvailable ? onOpenInspector : undefined}>{en ? 'Open Inspector' : 'Inspectorを開く'}</Button>}
    </div>
    <div className="k-first-chat-tutorial__nav">
      <Button type="button" variant="ghost" size="sm" disabled={step === 0} onClick={onBack}>{en ? 'Back' : '戻る'}</Button>
      <Button type="button" variant="primary" size="sm" onClick={step === 3 ? onComplete : onNext}>{step === 3 ? (en ? 'Finish guide' : '案内を完了') : (en ? 'Next' : '次へ')}</Button>
    </div>
    <p className="k-first-chat-tutorial__note">{en ? 'Completion or skipping is recorded in this browser. Reopen the guide anytime using “First chat guide” above.' : '完了・スキップはこのブラウザーに記録します。上部の「初トークの案内」からいつでも再表示できます。'}</p>
    {storageFailed && <p role="status" className="k-first-chat-tutorial__note">{en ? 'Your browser could not save this status, so the guide may appear again next time.' : 'ブラウザーに記録できないため、次回また案内が出る場合があります。'}</p>}
  </section>;
}
