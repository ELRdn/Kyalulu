import { useLanguage } from '../lib/appContext';

export default function ImportSource({ value }: { value: unknown }) {
  const en=useLanguage()==='en';
  if (!value || typeof value !== 'object') return null;
  const info = value as Record<string, unknown>;
  return <section><h3>{en?'Source information':'出典情報'}</h3><p>{String(info.source ?? (en?'Unknown':'不明'))} · {en?'Author: ':'作者：'}{String(info.author ?? (en?'Unknown':'不明'))}</p><p>{en?'License: ':'ライセンス：'}{String(info.license ?? (en?'Unknown':'不明'))}</p>
    {typeof info.source_url === 'string' && /^https:\/\/(www\.taverncard\.com|realm\.risuai\.net|github\.com|huggingface\.co)\//.test(info.source_url) && <a href={info.source_url} target="_blank" rel="noopener noreferrer">{en?'Open source':'配布元を開く'} ↗</a>}
    <p>{info.transport === 'browser' ? (en?'Retrieved in the browser. Provenance is supplied by the user.':'ブラウザーから取得。出典は利用者の申告です。') : (en?'The original retrieved from the source is retained.':'配布元から取得した原本を保存します。')}</p></section>;
}
