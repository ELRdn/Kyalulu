import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { publishWork, type PublicWork } from '../lib/community';
import type { LibraryItem } from '../lib/library';
import { friendlyMessage } from '../lib/errors';
import { connectionScope } from '../lib/remoteStore';
import { useConfirm } from './ui/Dialog';
import Button from './ui/Button';

export default function PublishWorkButton({ item, enabled }: { item: LibraryItem; enabled: boolean }) {
  const [dialog, confirm] = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [published, setPublished] = useState<PublicWork | null>(null);
  const mounted = useRef(true);
  const busyRef = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const publish = async () => {
    if (busyRef.current || !enabled || item.document.nsfw) return;
    const scope = connectionScope();
    busyRef.current = true; setBusy(true); setError('');
    try {
      const accepted = await confirm({ title: `「${item.document.name}」の版${item.revision}を公開しますか？`,
        description: '名前・キャラ設定・挨拶・会話例・タグ・作者コメント・話し方を公開します。非公開プリセット・会話履歴・記憶・原文ファイル・私的画像は公開しません。SFW検査のAPI費用が発生する場合があります。公開後の変更は別の版として扱います。', confirmLabel: '検査を受けてこの版を公開' });
      if (!accepted || !mounted.current || scope !== connectionScope()) return;
      const result = await publishWork(item.id, item.revision);
      if (mounted.current && scope === connectionScope()) setPublished(result);
    } catch (error) { if (mounted.current && scope === connectionScope()) setError(friendlyMessage(error)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  if (item.document.kind !== 'character') return null;
  return <div>{dialog}<Button size="sm" variant="secondary" disabled={busy || !enabled || item.document.nsfw}
    title={!enabled ? 'この接続先の公開作品機能は未提供です' : item.document.nsfw ? '公開できるのはSFW作品です' : '内容を確認して固定版を公開'} onClick={() => void publish()}>{busy ? '公開を確認中…' : 'この版を公開'}</Button>
    {published && <Link to={`/works/${encodeURIComponent(published.id)}`}>公開した版を確認</Link>}{error && <p role="alert">{error}</p>}
  </div>;
}
