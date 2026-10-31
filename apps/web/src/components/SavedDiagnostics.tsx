import type { DeviceDiagnostics } from '../lib/api';
import { useLanguage } from '../lib/appContext';
import { RuntimeDownload } from './RuntimeMedia';

export function SavedDiagnostics({info}:{info:DeviceDiagnostics}) {
  const en=useLanguage()==='en';
  const messages={
    stored:en?'Complete diagnostics are saved. Export them to inspect the original data.':'完全な診断データは保存済みです。書き出して元データを確認できます。',
    erased:en?'Some original diagnostics were removed when their memory source was erased.':'記憶の消去に伴い、生成時の診断データの一部が消去されています。',
    unavailable:en?'Original diagnostics are unavailable on this device.':'元の診断データは、この端末では利用できません。',
    corrupt:en?'Saved diagnostics could not be verified. The original data is retained.':'保存済み診断データの整合性を確認できません。元データは保持しています。',
  };
  const state=Object.hasOwn(messages,info.state)?info.state:'unavailable';
  return <div role="status"><p>{messages[state]}{Number.isSafeInteger(info.bytes)&&Number(info.bytes)>=0&&` (${info.bytes!.toLocaleString(en?'en-US':'ja-JP')} bytes)`}</p>
    {typeof info.export_url==='string'&&info.export_url.startsWith('/api/')&&<RuntimeDownload href={info.export_url} download="diagnostics.json">{en?'Export diagnostics':'診断データを書き出す'}</RuntimeDownload>}
  </div>;
}
