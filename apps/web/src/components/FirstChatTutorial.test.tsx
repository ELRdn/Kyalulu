import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import FirstChatTutorial, { FIRST_CHAT_TUTORIAL_KEY, readTutorialReceipt, writeTutorialReceipt,
  tutorialReducer, useFirstChatTutorial, type FirstChatTutorialProps, type TutorialState } from './FirstChatTutorial';

function props(overrides: Partial<FirstChatTutorialProps> = {}): FirstChatTutorialProps {
  return { step: 0, cloud: false, inspectorAvailable: true, storageFailed: false,
    onNext: vi.fn(), onBack: vi.fn(), onSkip: vi.fn(), onComplete: vi.fn(), onFocusComposer: vi.fn(),
    onOpenModels: vi.fn(), onOpenMemory: vi.fn(), onOpenInspector: vi.fn(), ...overrides };
}

// Inspect the controlled card's actual handlers without starting an app or installing a DOM runtime.
function findButton(tree: ReactNode, label: string): ReactElement<any> {
  const visit = (node: ReactNode): ReactElement<any> | undefined => {
    for (const child of Children.toArray(node)) {
      if (!isValidElement<{ children?: ReactNode }>(child)) continue;
      if (child.props.children === label) return child;
      const found = visit(child.props.children);
      if (found) return found;
    }
  };
  const found = visit(tree);
  if (!found) throw new Error(`Button not found: ${label}`);
  return found;
}

describe('first-chat tutorial', () => {
  it('keeps the full English guide, Cloud consent and PC/BYOK boundaries', () => {
    for (let step = 0; step < 4; step++) {
      for (const cloud of [true, false]) {
        const html = renderToStaticMarkup(<FirstChatTutorial {...props({ step, cloud, language: 'en', storageFailed: true })} />);
        expect(html).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
        expect(html).toContain('recorded in this browser');
      }
    }
    const cloud = renderToStaticMarkup(<FirstChatTutorial {...props({ step: 1, cloud: true, language: 'en' })} />);
    expect(cloud).toContain('before every send');
    expect(cloud).toContain('cost cap');
    expect(cloud).toContain('Canceling or expiry does not start generation');
    expect(cloud).toContain('separate from K-Credits');
    const pc = renderToStaticMarkup(<FirstChatTutorial {...props({ step: 1, language: 'en' })} />);
    expect(pc).toContain('connected PC');
    expect(pc).toContain('external provider');
    expect(pc).toContain('do not show Cloud’s per-send quote');
    const memory = renderToStaticMarkup(<FirstChatTutorial {...props({ step: 2, language: 'en' })} />);
    expect(memory).toContain('Word matches do not prove a fact');
    expect(memory).toContain('separate operations');
  });

  it.each(['ja', 'en'] as const)('describes device execution without PC/BYOK instructions in %s', language => {
    const p = props({ step: 1, device: true, language });
    const html = renderToStaticMarkup(<FirstChatTutorial {...p} />);
    expect(html).toContain(language === 'en' ? 'this browser on this device' : 'このブラウザーの端末内');
    expect(html).toContain(language === 'en' ? 'not sent to Cloud or external AI' : 'Cloudや外部AIへ送りません');
    expect(html).not.toContain('BYOK');
    expect(html).not.toContain('接続先のPC');
    expect(p.onOpenModels).not.toHaveBeenCalled();
  });

  it('keeps English Inspector disabled and completion explicit after switching language', () => {
    const p = props({ step: 3, language: 'en', inspectorAvailable: false });
    const tree = FirstChatTutorial(p);
    expect(findButton(tree, 'Open Inspector').props.disabled).toBe(true);
    expect(findButton(tree, 'Open Inspector').props.onClick).toBeUndefined();
    expect(p.onComplete).not.toHaveBeenCalled();
    findButton(tree, 'Finish guide').props.onClick();
    expect(p.onComplete).toHaveBeenCalledOnce();
  });

  it.each(['completed', 'skipped'] as const)('records %s on this browser, with no conversation data', receipt => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(readTutorialReceipt(storage)).toBeNull();
    expect(writeTutorialReceipt(receipt, storage)).toBe(true);
    expect(readTutorialReceipt(storage)).toBe(receipt);
    expect([...values]).toEqual([[FIRST_CHAT_TUTORIAL_KEY, receipt]]);
  });

  it('ignores unknown receipts and tolerates blocked browser storage', () => {
    expect(readTutorialReceipt({ getItem: () => 'old-or-invalid', setItem: vi.fn() })).toBeNull();
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readTutorialReceipt(blocked)).toBeNull();
    expect(writeTutorialReceipt('skipped', blocked)).toBe(false);
  });

  it.each(['completed', 'skipped'] as const)('does not auto-reopen after %s, but allows manual reopening', receipt => {
    const closed: TutorialState = { open: false, step: 3, receipt };
    expect(tutorialReducer(closed, 'auto-open')).toEqual(closed);
    expect(tutorialReducer(closed, 'reopen')).toEqual({ open: true, step: 0, receipt });
  });

  it('opens first talk and bounds navigation; skip closes without finishing', () => {
    let state: TutorialState = { open: false, step: 0, receipt: null };
    state = tutorialReducer(state, 'auto-open');
    expect(state.open).toBe(true);
    expect(tutorialReducer(state, 'back').step).toBe(0);
    for (let i = 0; i < 5; i++) state = tutorialReducer(state, 'next');
    expect(state.step).toBe(3);
    expect(tutorialReducer(state, 'auto-open')).toEqual(state);
    expect(tutorialReducer(state, 'skipped')).toEqual({ ...state, open: false, receipt: 'skipped' });
  });

  it('starts closed before loaded-history eligibility is evaluated', () => {
    function Harness() {
      const tutorial = useFirstChatTutorial(false);
      return <span>{tutorial.open ? 'open' : 'closed'}</span>;
    }
    expect(renderToStaticMarkup(<Harness />)).toBe('<span>closed</span>');
  });

  it('explains per-send Cloud consent and separate BYOK costs without a fixed price', () => {
    const html = renderToStaticMarkup(<FirstChatTutorial {...props({ step: 1, cloud: true })} />);
    expect(html).toContain('送信のたびに');
    expect(html).toContain('送信先・モデル・料金上限');
    expect(html).toContain('取り消しや期限切れ');
    expect(html).toContain('K-Creditsとは別');
  });

  it('distinguishes local execution from external BYOK and does not promise local quote consent', () => {
    const html = renderToStaticMarkup(<FirstChatTutorial {...props({ step: 1 })} />);
    expect(html).toContain('接続先のPC');
    expect(html).toContain('外部の提供元');
    expect(html).toContain('Cloudの毎回の見積確認は出ません');
  });

  it('explains source-based correction and does not enable memory automatically', () => {
    const p = props({ step: 2 });
    const tree = FirstChatTutorial(p);
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('事実の証明ではありません');
    expect(html).toContain('会話本文の編集は別');
    expect(html).toContain('共有範囲');
    expect(p.onOpenMemory).not.toHaveBeenCalled();
    findButton(tree, '覚えていることを開く').props.onClick();
    expect(p.onOpenMemory).toHaveBeenCalledOnce();
  });

  it('focus navigation, configuration and Inspector actions require explicit clicks', () => {
    const p = props();
    findButton(FirstChatTutorial(p), '入力欄へ').props.onClick();
    expect(p.onFocusComposer).toHaveBeenCalledOnce();
    expect(p.onNext).not.toHaveBeenCalled();
    findButton(FirstChatTutorial({ ...p, step: 1 }), 'キャラ・プリセットを開く').props.onClick();
    expect(p.onOpenModels).toHaveBeenCalledOnce();
    findButton(FirstChatTutorial({ ...p, step: 3 }), 'Inspectorを開く').props.onClick();
    expect(p.onOpenInspector).toHaveBeenCalledOnce();
    expect(p.onComplete).not.toHaveBeenCalled();
  });

  it('disables unavailable Inspector and offers the existing memory panel', () => {
    const p = props({ step: 3, cloud: true, inspectorAvailable: false });
    const tree = FirstChatTutorial(p);
    const button = findButton(tree, 'Inspectorを開く');
    expect(button.props.disabled).toBe(true);
    expect(button.props.onClick).toBeUndefined();
    expect(renderToStaticMarkup(tree)).toContain('詳細Inspectorを利用できません');
    findButton(tree, '覚えていることを開く').props.onClick();
    expect(p.onOpenMemory).toHaveBeenCalledOnce();
    expect(p.onOpenInspector).not.toHaveBeenCalled();
  });

  it('only finishes on the final step; Escape skips unless IME is composing', () => {
    const p = props();
    findButton(FirstChatTutorial(p), '次へ').props.onClick();
    expect(p.onNext).toHaveBeenCalledOnce();
    findButton(FirstChatTutorial({ ...p, step: 3 }), '案内を完了').props.onClick();
    expect(p.onComplete).toHaveBeenCalledOnce();
    const keyDown = FirstChatTutorial(p).props.onKeyDown;
    const event = { key: 'Escape', nativeEvent: { isComposing: true }, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    keyDown(event);
    expect(p.onSkip).not.toHaveBeenCalled();
    keyDown({ ...event, nativeEvent: { isComposing: false } });
    expect(p.onSkip).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it('renders non-submitting buttons and browser receipt fallback', () => {
    const html = renderToStaticMarkup(<FirstChatTutorial {...props({ storageFailed: true })} />);
    expect(html).not.toContain('type="submit"');
    expect(html).toContain('type="button"');
    expect(html).toContain('再表示できます');
    expect(html).toContain('次回また案内が出る場合');
  });
});
