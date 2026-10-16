import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import AnalyticsConsent, { AnalyticsConsentChoices } from './AnalyticsConsent';

function button(tree: ReactNode, label: string): ReactElement<any> {
  for (const node of Children.toArray(tree)) {
    if (!isValidElement<{ children?: ReactNode }>(node)) continue;
    if (node.props.children === label) return node;
    try { return button(node.props.children, label); } catch { /* Continue searching siblings. */ }
  }
  throw Error('Missing button: ' + label);
}

describe('analytics consent UI', () => {
  it.each(['ja', 'en'] as const)('explains pseudonymous GA IDs, app privacy, opt-out and official policies in %s', language => {
    const onChoose = vi.fn(); const tree = AnalyticsConsentChoices({ language, onChoose });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('id="analytics-consent-title"');
    expect(html).toContain(`https://kyalulu.com/docs/${language === 'en' ? 'en/' : ''}privacy/#website-analytics`);
    expect(html).toContain('https://policies.google.com/privacy'); expect(html).toContain('rel="noreferrer"');
    expect(html).toContain(language === 'en' ? 'pseudonymous client ID' : '仮名のクライアントID');
    expect(html).toContain(language === 'en' ? 'personal IDs from the app' : 'アプリの個人ID');
    expect(html).toContain(language === 'en' ? 'screen categories, language, and success events' : '画面の分類・言語');
    expect(html).toContain(language === 'en' ? 'withdraw consent at any time' : '同意はいつでも撤回');
    expect(onChoose).not.toHaveBeenCalled();
    button(tree, language === 'en' ? 'Disable analytics' : '解析を無効にする').props.onClick();
    button(tree, language === 'en' ? 'Agree to terms and privacy and enable analytics' : '規約・プライバシーに同意して解析を有効にする').props.onClick();
    expect(onChoose.mock.calls).toEqual([['denied'], ['granted']]);
    expect(html.match(/class="k-btn k-btn--secondary/g)).toHaveLength(2);
    expect(html.match(/type="button"/g)).toHaveLength(2);
  });

  it('does not display analytics controls until runtime/config is enabled', () => {
    expect(renderToStaticMarkup(<AnalyticsConsent enabled={false} language="ja" />)).toBe('');
  });
  it('shows settings without prompting before terms consent', () => {
    const html = renderToStaticMarkup(<AnalyticsConsent enabled={true} language="ja" />);
    expect(html).toContain('規約・プライバシー設定');
    expect(html).not.toContain('Google Analytics receives');
    expect(html).not.toContain('解析を無効にする');
  });
});
