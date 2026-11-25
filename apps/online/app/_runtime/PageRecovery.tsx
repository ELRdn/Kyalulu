'use client';

import { useEffect, useRef, useState } from 'react';

const copy = {
  page: {
    href: '/',
    en: { title: 'Could not load this page', detail: '', label: 'Page recovery', reload: 'Reload page', back: 'Home' },
    ja: { title: 'ページを読み込めませんでした', detail: '', label: 'ページの復旧', reload: '再読み込み', back: 'ホームへ' },
  },
  chat: {
    href: '/chats',
    en: { title: 'Could not open this chat', detail: 'Reload this chat to check for your saved draft.',
      label: 'Chat recovery', reload: 'Reload chat', back: 'Chat list' },
    ja: { title: 'チャットを開けませんでした', detail: 'チャットを再読み込みして、保存した下書きを確認できます。',
      label: 'チャットの復旧', reload: 'チャットを再読み込み', back: '会話一覧へ' },
  },
};

export function PageRecovery({ kind }: { kind: keyof typeof copy }) {
  const [language, setLanguage] = useState<'ja' | 'en' | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    setLanguage(document.documentElement.lang === 'en' ? 'en' : 'ja');
  }, []);
  useEffect(() => {
    if (language) title.current?.focus();
  }, [language]);

  const text = copy[kind][language ?? 'ja'];
  return <main className="online-character online-recovery">
    <h1 ref={title} tabIndex={-1}>{text.title}</h1>
    {text.detail && <p>{text.detail}</p>}
    <nav aria-label={text.label}>
      <button type="button" onClick={() => location.reload()}>{text.reload}</button>
      <a href={copy[kind].href}>{text.back}</a>
    </nav>
  </main>;
}
