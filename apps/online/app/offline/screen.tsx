'use client';

import { useEffect, useState } from 'react';
import { selectedExecutionTarget } from '../../../web/src/lib/executionPreference';
import { legacyPath } from '../../../web/src/lib/legacyPath';

export default function OfflineEntry() {
  const [english, setEnglish] = useState(false);
  useEffect(() => {
    if (selectedExecutionTarget('cloud') === 'device') {
      const route = legacyPath(location.hash, location.origin) ?? '/chats';
      location.replace('/device/#' + route);
      return;
    }
    let language = navigator.language;
    try { language = JSON.parse(localStorage.getItem('kyalulu-app-preferences-v1') || '{}').language || language; }
    catch { /* Browser language is available without device preferences. */ }
    setEnglish(language.startsWith('en'));
  }, []);
  return <main className="online-character" lang={english ? 'en' : 'ja'}>
    <h1>{english ? 'You are offline' : 'オフラインです'}</h1>
    <p>{english ? 'Reconnect to open your online conversations.' : 'オンラインの会話を開くには、ネットワークに再接続してください。'}</p>
    <button onClick={() => location.reload()}>{english ? 'Retry' : '再読み込み'}</button>{' '}
    <a href="/device/#/chats">{english ? 'Open chats on this device' : 'この端末の会話を開く'}</a>
  </main>;
}
