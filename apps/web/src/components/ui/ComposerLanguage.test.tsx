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
  expect(ready).toContain(language === 'en' ? 'placeholder="Message"' : 'placeholder="メッセージ"');
  expect(ready).toContain(language === 'en' ? 'Insert an action' : '仕草を入れる');
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

it.each(['ja', 'en'])('turns an empty send into "go on" only when the chat allows it (%s)', language => {
  fixture.language = language;
  const go = language === 'en' ? 'Go on' : '進む', send = language === 'en' ? 'Send' : '送信';
  const empty = renderToStaticMarkup(<Composer value="" onChange={vi.fn()} onSend={vi.fn()} onAdvance={vi.fn()} />);
  expect(empty).toContain(go);
  expect(empty).not.toMatch(/<button[^>]*disabled=""[^>]*>.*?(Go on|進む)/);
  expect(renderToStaticMarkup(<Composer value="hi" onChange={vi.fn()} onSend={vi.fn()} onAdvance={vi.fn()} />)).not.toContain(go);
  expect(renderToStaticMarkup(<Composer value="" onChange={vi.fn()} onSend={vi.fn()} />)).toContain(send);
});
