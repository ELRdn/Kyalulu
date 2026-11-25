import type { ReactNode } from 'react';
import type { CharacterOpening } from '../../../web/src/lib/characterHandoff';
import { initialLanguage } from '../language';
import { ScreenClient } from './ScreenClient';
import type { ScreenPath } from './views';

export async function Screen({ path, preview, pending, opening }: {
  path: ScreenPath; preview?: ReactNode; pending?: ReactNode; opening?: CharacterOpening;
}) {
  const waiting = pending ?? <div className="online-character" role="status">
    {await initialLanguage() === 'en' ? 'Loading page…' : 'ページを読み込んでいます…'}
  </div>;
  return <ScreenClient path={path} preview={preview} pending={waiting} opening={opening} />;
}
