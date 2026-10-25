import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import Composer from './Composer';

const fixture = vi.hoisted(() => ({ language: 'en' }));
vi.mock('../../lib/appContext', () => ({ useLanguage: () => fixture.language }));

it.each(['ja', 'en'])('localizes composing, disabled and stopping controls in %s', language => {
  fixture.language = language;
  const props = { value: '', onChange: vi.fn(), onSend: vi.fn(), onStop: vi.fn() };
  const ready = renderToStaticMarkup(<Composer {...props} />);
  expect(ready).toContain(language === 'en' ? 'aria-label="Message"' : 'aria-label="メッセージ"');
  expect(ready).toContain(language === 'en' ? 'Write your message' : 'きみの言葉を入力');
  expect(ready).toContain(language === 'en' ? 'Insert narration' : 'ト書きを入れる');
  const disabled = renderToStaticMarkup(<Composer {...props} disabled />);
  expect(disabled).toContain(language === 'en' ? 'Preparing…' : '準備中…');
  const streaming = renderToStaticMarkup(<Composer {...props} streaming />);
  expect(streaming).toContain(language === 'en' ? 'Stop' : '停止');
  if (language === 'en') expect(ready + disabled + streaming).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
  expect(props.onChange).not.toHaveBeenCalled();
  expect(props.onSend).not.toHaveBeenCalled();
  expect(props.onStop).not.toHaveBeenCalled();
});

it('preserves authored drafts and explicit placeholder/disabled text', () => {
  fixture.language = 'en';
  const html = renderToStaticMarkup(<Composer value="原文の下書き" onChange={vi.fn()} onSend={vi.fn()} placeholder="指定した説明" />);
  expect(html).toContain('原文の下書き');
  expect(html).toContain('指定した説明');
  const disabled = renderToStaticMarkup(<Composer value="" onChange={vi.fn()} onSend={vi.fn()} disabled disabledText="特別な状態" />);
  expect(disabled).toContain('特別な状態');
});
