"""Real App/Device API/IndexedDB paging; synthetic model readiness and Worker, no weights."""
import asyncio
import json
from pathlib import Path
from urllib.parse import quote, urlsplit

from playwright.async_api import async_playwright, expect
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/device-history-pages-browser'
SESSION = 'history-pages-fixture'
DRAFT = '未送信の下書き / retained draft'


async def main():
    results, blocked, errors = [], [], []
    async with local_vite(OUTPUT) as origin, async_playwright() as runtime:
        browser = await runtime.chromium.launch(headless=True)
        try:
            for language, width, theme in [('ja', 393, 'light'), ('en', 1280, 'dark')]:
                context = await browser.new_context(viewport={'width': width, 'height': 852})
                try:
                    async def route(request):
                        url = urlsplit(request.request.url)
                        if url.hostname != '127.0.0.1' or url.port != urlsplit(origin).port or url.path.startswith('/api/'):
                            blocked.append(url.path)
                            await request.abort()
                        else:
                            await request.continue_()
                    await context.route('**/*', route)
                    page = await context.new_page()
                    page.on('pageerror', lambda error: errors.append(error.stack or str(error)))
                    page.set_default_timeout(15000)
                    address = origin + '/@fs/' + quote((ROOT / 'tests/fixtures/device-research.html').as_posix(), safe='/:') + '#/chats/' + SESSION
                    await page.goto(address)
                    await page.wait_for_function('window.__DEVICE_RESEARCH__ !== undefined')
                    await page.evaluate('''async () => {
                        localStorage.setItem('kyalulu-first-chat-tutorial-v1','skipped');
                        localStorage.setItem('kyalulu-context-panel-mode','collapsible');
                        const store=await import('/src/lib/appStore.ts');
                        const {rememberOwner}=await import('/src/lib/appContext.ts');
                        rememberOwner('device-research-fixture');
                        const messages=Array.from({length:150},(_,i)=>({id:i+1,uuid:'page-message-'+i,
                            role:i%2?'assistant':'user',content:'Saved message '+(i+1),model_id:'kyalulu-iq3m',created_at:'2026-10-31T00:00:00Z'}));
                        const {RuntimeStateSchema}=await import('/@fs/ROOT/packages/schemas/src/index.ts');
                        await store.saveEntity(store.newEntity('conversation','SESSION',{storage_policy:'local',rating:'general',
                            settings:{session_id:'SESSION',system_prompt:'',temperature:.8},messages,memories:[],summaries:[],
                            state:RuntimeStateSchema.parse({session_id:'SESSION'}),memory_enabled:false}));
                        await store.setMeta('message-sequence:device-research-fixture',150);
                        window.__pagePartsReads=0;
                        const get=IDBObjectStore.prototype.get;
                        IDBObjectStore.prototype.get=function(...args){if(this.name==='parts')window.__pagePartsReads++;return get.apply(this,args);};
                    }'''.replace('ROOT', ROOT.as_posix()).replace('SESSION', SESSION))

                    async def mount():
                        await page.wait_for_function('window.__DEVICE_RESEARCH__ !== undefined')
                        await page.evaluate('([lang,theme])=>window.__DEVICE_RESEARCH__.mount(document.getElementById("root"),lang,theme)', [language, theme])
                        await page.locator('.k-chat-history-nav').wait_for()
                        await expect(page.locator('.k-chat-messages')).to_have_attribute('aria-busy', 'false')

                    await mount()
                    en = language == 'en'
                    nav = page.get_by_role('navigation', name='Conversation history' if en else '会話の履歴', exact=True)
                    earlier = nav.get_by_role('button', name='Earlier' if en else '前へ', exact=True)
                    later = nav.get_by_role('button', name='Later' if en else '次へ', exact=True)
                    latest = nav.get_by_role('button', name='Latest' if en else '最新', exact=True)
                    composer = page.locator('.k-composer textarea')
                    send = page.locator('.k-composer__send')
                    await expect(nav).to_contain_text('101–150 / 150')
                    await expect(page.locator('.k-msg')).to_have_count(50)
                    await page.wait_for_load_state('networkidle')
                    initial_reads = await page.evaluate('window.__pagePartsReads')
                    assert initial_reads == 1, f'Closed panels/settings/list must share one body read: {initial_reads}'
                    await composer.fill(DRAFT)
                    await expect(send).to_be_enabled()
                    await earlier.click()
                    await expect(nav).to_contain_text('51–100 / 150')
                    await expect(send).to_be_disabled()
                    await expect(composer).to_have_value(DRAFT)
                    await expect(page.locator('.k-msg')).to_have_count(50)
                    await earlier.click()
                    await expect(nav).to_contain_text('1–50 / 150')
                    await expect(earlier).to_be_disabled()
                    await later.click()
                    await expect(nav).to_contain_text('51–100 / 150')
                    await latest.click()
                    await expect(nav).to_contain_text('101–150 / 150')
                    await expect(send).to_be_enabled()
                    # A concurrent saved revision invalidates the cursor without replacing the visible page/draft.
                    await page.evaluate('''async id=>{const s=await import('/src/lib/appStore.ts');const e=await s.entity(id);
                        await s.saveEntity({...e,payload:{...e.payload,title:'Concurrent fixture edit'}},e.revision);}''', SESSION)
                    await earlier.click()
                    await expect(page.locator('.k-chat-messages')).to_have_attribute('aria-busy', 'false')
                    await expect(nav).to_contain_text('101–150 / 150')
                    await expect(composer).to_have_value(DRAFT)
                    await latest.click()
                    await expect(page.locator('.k-chat-messages')).to_have_attribute('aria-busy', 'false')
                    # Editing a page cannot navigate away from the unsaved message draft.
                    await page.locator('.k-msg').last.get_by_role('button', name='Edit' if en else '編集', exact=True).click()
                    editor = page.get_by_role('textbox', name='Message text' if en else 'メッセージ本文', exact=True)
                    await editor.fill('Edited saved reply')
                    await expect(earlier).to_be_disabled()
                    await page.locator('.k-msg__editor').get_by_role('button', name='Save' if en else '保存', exact=True).click()
                    await expect(editor).to_have_count(0)
                    await expect(page.locator('.k-msg').last).to_contain_text('Edited saved reply')
                    await expect(composer).to_have_value(DRAFT)
                    # Resume a committed receipt whose reply is far outside the latest 50 messages.
                    await page.evaluate('''async id=>{
                        const s=await import('/src/lib/appStore.ts'),{ChatRecovery}=await import('/src/lib/chatRecovery.ts'),
                            {connectionScope}=await import('/src/lib/remoteStore.ts');
                        await s.setMeta('generation:device-research-fixture:old-page-generation',{
                            generation_id:'old-page-generation',session_id:id,status:'completed',user_id:7,assistant_id:8,reply:'Saved message 8'});
                        new ChatRecovery(localStorage,connectionScope(),id).begin('old-page-generation',false,'Saved message 7');
                    }''', SESSION)
                    await page.reload()
                    await mount()
                    await expect(composer).to_have_value(DRAFT)
                    await expect(nav).to_contain_text('101–150 / 150')
                    await expect(send).to_be_enabled()
                    # Actual send + recovery uses persisted history; the 100 off-screen messages survive.
                    await send.click()
                    await expect(nav).to_contain_text('103–152 / 152')
                    await expect(page.locator('.k-msg')).to_have_count(50)
                    saved = await page.evaluate('''async id=>{const s=await import('/src/lib/appStore.ts');return (await s.entity(id)).payload.messages;}''', SESSION)
                    assert len(saved) == 152 and all(m['content'] == f'Saved message {i+1}' for i, m in enumerate(saved[:149]))
                    assert saved[149]['content'] == 'Edited saved reply' and saved[150]['content'] == DRAFT
                    assert not await composer.input_value()
                    await page.get_by_role('button', name='Regenerate with direction' if en else '注文して作り直す', exact=True).click()
                    await page.get_by_role('dialog').get_by_role('textbox').fill('短めに / Make it shorter')
                    await page.get_by_role('dialog').get_by_role('button', name='Regenerate' if en else '作り直す', exact=True).click()
                    await page.wait_for_function('window.__DEVICE_RESEARCH__.status().calls===2&&!window.__DEVICE_RESEARCH__.status().busy')
                    await expect(nav).to_contain_text('103–152 / 152')
                    await expect(page.get_by_role('button', name='Regenerate with direction' if en else '注文して作り直す', exact=True)).to_be_enabled()
                    regenerated = await page.evaluate('''async id=>{const s=await import('/src/lib/appStore.ts');return (await s.entity(id)).payload.messages;}''', SESSION)
                    assert len(regenerated) == 152 and regenerated[:151] == saved[:151]
                    # Closed tools are lazy, but opening them retains their original functionality and edit draft.
                    await page.get_by_role('button', name='Open information panel' if en else '情報パネルを開く', exact=True).click()
                    panel = page.get_by_role('dialog', name='Conversation information' if en else '会話の情報', exact=True)
                    await panel.get_by_text('Review and correct conversation summaries' if en else '会話の要約を確認・訂正', exact=True).click()
                    await panel.get_by_text('Chapter summary' if en else '章の要約', exact=False).first.wait_for()
                    await panel.get_by_text('Characters & RPG state' if en else '登場人物・RPGの状態', exact=True).click()
                    await panel.get_by_text('This state is confirmed by the runtime.' if en else '実行先で確定した状態です。', exact=False).wait_for()
                    await panel.locator('summary').filter(has_text='Memories' if en else '覚えていること').click()
                    await panel.get_by_role('button', name='Add a memory' if en else '覚えてほしいことを追加', exact=True).click()
                    memory_draft = panel.get_by_role('textbox', name='What to remember' if en else '覚えてほしいこと', exact=True)
                    await memory_draft.fill('Keep this unsaved memory draft')
                    await panel.locator('summary').filter(has_text='Memories' if en else '覚えていること').click()
                    await panel.locator('summary').filter(has_text='Memories' if en else '覚えていること').click()
                    await expect(memory_draft).to_have_value('Keep this unsaved memory draft')
                    await panel.get_by_role('button', name='Close panel' if en else 'パネルを閉じる', exact=True).click()
                    assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Horizontal overflow'
                    await page.screenshot(path=str(OUTPUT / f'{language}-{width}-{theme}.png'), full_page=True)
                    await page.evaluate('window.__DEVICE_RESEARCH__.owner("other-page-owner")')
                    await expect(page.locator('.k-msg')).to_have_count(0)
                    await expect(composer).to_have_value('')
                    await page.evaluate('window.__DEVICE_RESEARCH__.owner("device-research-fixture")')
                    await expect(nav).to_contain_text('103–152 / 152')
                    await expect(page.locator('.k-msg')).to_have_count(50)
                    results.append({'language': language, 'width': width, 'theme': theme, 'initial_body_reads': initial_reads,
                                    'page_dom_limit': 50, 'cursor_revision_rejected': True, 'draft_and_reload': True,
                                    'edit_and_generation_preserve_hidden_history': True, 'owner_isolation': True,
                                    'lazy_tools_and_memory_draft': True,
                                    'recovery_reply_outside_visible_page': True,
                                    'synthetic_inference_calls': 2, 'real_model_inference': False})
                finally:
                    await context.close()
        finally:
            await browser.close()
    assert not blocked and not errors, {'blocked': blocked, 'errors': errors}
    (OUTPUT / 'results.json').write_text(json.dumps({'results': results, 'blocked_requests': blocked, 'page_errors': errors}, indent=2), encoding='utf-8')
    print(json.dumps({'passed': len(results), 'results': results}))


if __name__ == '__main__':
    asyncio.run(main())
