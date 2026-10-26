import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { GenerationProgress } from '../../../../packages/schemas/src';
import KyaluluWaiting, { REPLY_WAIT_LABEL } from './KyaluluWaiting';

const stages: [GenerationProgress['stage'], string][] = [
  ['queue', '順番を待っています'],
  ['input_safety', '返事を準備しています'],
  ['generation', '返事を生成しています'],
  ['output_safety', '返事を準備しています'],
  ['save', '返事を保存しています'],
];

describe('Kyalulu waiting display', () => {
  it('keeps English announcements stable and diagnostics outside the live region', () => {
    const baseline = renderToStaticMarkup(<KyaluluWaiting language="en" progress={null} />);
    for (const [stage] of stages) {
      expect(renderToStaticMarkup(<KyaluluWaiting language="en" progress={{ stage, elapsed_ms: 12500 }} />)).toBe(baseline);
      const detailed = renderToStaticMarkup(<KyaluluWaiting language="en" progress={{ stage, elapsed_ms: 12500 }} researcher />);
      expect(detailed).toContain('12.5s elapsed');
      expect(detailed).toContain('aria-live="off"');
      expect(detailed).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
    }
    expect(baseline).toContain('Waiting for a reply…');
  });

  it.each(stages)('keeps the consumer display stable through %s and elapsed updates', stage => {
    const baseline = renderToStaticMarkup(<KyaluluWaiting progress={null} />);
    for (const elapsed_ms of [0, 1200, 65000]) {
      expect(renderToStaticMarkup(<KyaluluWaiting progress={{ stage, elapsed_ms }} />)).toBe(baseline);
    }
    expect(baseline).toContain('class="k-reply-wait"');
    expect(baseline).toContain(REPLY_WAIT_LABEL);
    expect(baseline).not.toContain('秒経過');
  });

  it.each(stages)('retains %s diagnostics outside the live announcement', (stage, label) => {
    const html = renderToStaticMarkup(<KyaluluWaiting progress={{ stage, elapsed_ms: 12500 }} researcher />);
    expect(html).toContain(`${label}（12.5秒経過）`);
    expect(html).toContain('class="k-reply-wait__diagnostic" aria-live="off"');
    expect(html.match(/<span role="status"[^>]*>(.*?)<\/span>/)?.[1]).toBe(REPLY_WAIT_LABEL);
    expect(html.match(/role="status"/g)).toHaveLength(1);
  });

  it('reuses decorative brand art and waits without progress data', () => {
    const html = renderToStaticMarkup(<KyaluluWaiting progress={null} researcher />);
    expect(html).toContain('aria-live="polite" aria-atomic="true"');
    expect(html).toContain('class="k-reply-wait__art" aria-hidden="true"');
    expect(html).toContain('mascot/v1.2/face-curious.png');
    expect(html).toContain('alt=""');
    expect(html).not.toContain('k-reply-wait__diagnostic');
  });
});
