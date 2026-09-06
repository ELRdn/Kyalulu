export default function ImportSource({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return null;
  const info = value as Record<string, unknown>;
  return <section><h3>出典情報</h3><p>{String(info.source ?? '不明')} · 作者：{String(info.author ?? '不明')}</p><p>ライセンス：{String(info.license ?? '不明')}</p>
    {typeof info.source_url === 'string' && /^https:\/\/(www\.taverncard\.com|realm\.risuai\.net|github\.com|huggingface\.co)\//.test(info.source_url) && <a href={info.source_url} target="_blank" rel="noopener noreferrer">配布元を開く ↗</a>}
    <p>{info.transport === 'browser' ? 'ブラウザーから取得。出典は利用者の申告です。' : '配布元から取得した原本を保存します。'}</p></section>;
}
