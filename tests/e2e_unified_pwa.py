"""Built unified shell + Native static server in Chromium; no model or real API."""
import argparse
import asyncio
from contextlib import asynccontextmanager
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit

import httpx
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'runtime'))


async def language_in_place(page, language):
    await page.evaluate('''language=>{
        const key='kyalulu-app-preferences-v1', prefs=JSON.parse(localStorage.getItem(key));
        localStorage.setItem(key,JSON.stringify({...prefs,language}));
        window.dispatchEvent(new Event('kyalulu-app-context'));
    }''', language)


async def entities(page, kinds):
    return await page.evaluate('''kinds=>new Promise((resolve,reject)=>{
        const open=indexedDB.open('kyalulu-app-v1',2);open.onerror=reject;open.onsuccess=()=>{
            const db=open.result,tx=db.transaction('entities'),read=tx.objectStore('entities').getAll();
            tx.oncomplete=()=>{db.close();resolve(read.result.filter(row=>kinds.includes(row.kind)));};tx.onerror=reject;
        };
    })''', kinds)


async def conversations(page):
    return await entities(page, ['conversation'])


async def check_portable_fields(page, editor, language, output):
    en = language == 'en'
    alternate = 'ja' if en else 'en'
    await editor.get_by_role('tab', name='Lorebook' if en else '設定集', exact=False).click()
    await editor.get_by_role('button', name='＋ Add knowledge' if en else '＋ 知識を追加', exact=True).click()
    await editor.get_by_role('textbox', name='Entry 1 keywords' if en else '設定 1のキーワード', exact=True).fill('stars, 星空')
    await editor.get_by_role('textbox', name='Entry 1 knowledge text' if en else '設定 1の知識の本文', exact=True).fill('原文の世界設定 · original lore')
    await editor.get_by_role('tab', name='About' if en else '紹介', exact=False).click()
    await editor.get_by_role('textbox', name='Tag to add' if en else '追加するタグ', exact=True).fill('入力中のタグ')
    await editor.get_by_role('tab', name='Details' if en else '詳細', exact=False).click()
    raw = editor.locator('.k-plot-editor__json').first
    await raw.fill('{"temperature":')
    # The save control is outside the editor and is disabled by its validity callback.
    save = page.locator('.k-create-editor-head').get_by_role('button', name='Save' if en else '保存', exact=True)
    await expect(save).to_be_disabled()
    before = await conversations(page)
    await language_in_place(page, alternate)
    await expect(editor.locator('.k-plot-editor__validation')).to_contain_text('Saving is blocked' if alternate == 'en' else '修正するまで保存できません')
    await expect(raw).to_have_value('{"temperature":')
    await expect(raw).to_have_attribute('aria-invalid', 'true')
    await expect(page.locator('.k-create-editor-head').get_by_role('button', name='Save' if alternate == 'en' else '保存', exact=True)).to_be_disabled()
    assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
    await page.screenshot(path=str(output / f'{language}-{page.viewport_size["width"]}-portable-json-review.png'), full_page=True, animations='disabled')
    assert await conversations(page) == before
    await editor.get_by_role('tab', name='About' if alternate == 'en' else '紹介', exact=False).click()
    await expect(editor.get_by_role('textbox', name='Tag to add' if alternate == 'en' else '追加するタグ', exact=True)).to_have_value('入力中のタグ')
    await editor.get_by_role('tab', name='Lorebook' if alternate == 'en' else '設定集', exact=False).click()
    await expect(editor.get_by_role('textbox', name='Entry 1 knowledge text' if alternate == 'en' else '設定 1の知識の本文', exact=True)).to_have_value('原文の世界設定 · original lore')
    await editor.get_by_role('tab', name='Details' if alternate == 'en' else '詳細', exact=False).click()
    await expect(raw).to_have_value('{"temperature":')
    await raw.fill('{"temperature":0.65}')
    await expect(page.locator('.k-create-editor-head').get_by_role('button', name='Save' if alternate == 'en' else '保存', exact=True)).to_be_enabled()
    await language_in_place(page, language)
    await expect(raw).to_have_value('{"temperature":0.65}')
    assert not await editor.locator('.k-plot-editor__validation').count()
    await editor.get_by_role('tab', name='Intro' if en else 'イントロ', exact=False).click()
    assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')


def without_open_times(rows):
    # Reopening updates only the existing offline-cache recency timestamp.
    return [{key: value for key, value in row.items() if key != 'opened'} for row in rows]


async def check_library_workspace(page, language, before, draft, output):
    chat_url=page.url
    await page.goto(chat_url.rsplit('/chats/',1)[0]+'/create')
    await page.locator('.k-page-head').get_by_role('button',name='Create new' if language=='en' else '新しく作る',exact=True).click()
    chooser=page.locator('dialog[open]')
    await chooser.get_by_role('button').filter(has_text='Create a plot' if language=='en' else 'プロットを作る').click()
    editor=page.locator('.k-portable-editor')
    await editor.get_by_role('textbox',name='Name' if language=='en' else '名前',exact=True).fill('ライブラリの原文')
    await editor.get_by_role('textbox',name='Description' if language=='en' else '説明',exact=True).fill('Original description · 原文')
    await editor.get_by_role('tab',name='Intro' if language=='en' else 'イントロ',exact=False).click()
    greeting=editor.locator('section[id$="-panel-intro"] textarea').first
    await greeting.fill('原文の挨拶 *星を見る*')
    await check_portable_fields(page, editor, language, output)
    key='kyalulu-create-draft-v1:device%3Apwa-fixture:editor:new-character'
    await page.wait_for_function('key=>JSON.parse(sessionStorage.getItem(key)||"null")?.document.data.first_mes==="原文の挨拶 *星を見る*"',arg=key)
    stored=await page.evaluate('key=>sessionStorage.getItem(key)',key)
    alternate='ja' if language=='en' else 'en'
    await language_in_place(page,alternate)
    await page.get_by_role('button',name='Save temporary draft' if alternate=='en' else '一時下書きを保存',exact=True).wait_for()
    assert await page.evaluate('key=>sessionStorage.getItem(key)',key)==stored
    assert await greeting.input_value()=='原文の挨拶 *星を見る*'
    async def accept(dialog):
        await dialog.accept()
    page.on('dialog',accept)
    try:
        await page.reload()
        await editor.get_by_role('tab',name='Intro' if alternate=='en' else 'イントロ',exact=False).click()
        await expect(greeting).to_have_value('原文の挨拶 *星を見る*')
    finally:
        page.remove_listener('dialog',accept)
    assert await page.evaluate('key=>sessionStorage.getItem(key)',key)==stored
    await page.get_by_role('button',name='Save temporary draft' if alternate=='en' else '一時下書きを保存',exact=True).click()
    await language_in_place(page,language)
    await page.get_by_role('status').filter(has_text='A temporary draft was saved' if language=='en' else '一時下書きをこのブラウザーに保存しました').wait_for()
    back=page.locator('.k-create-editor-footer').get_by_role('button',name='Keep draft and go back' if language=='en' else '下書きを残して戻る',exact=True)
    await back.click()
    await page.locator('dialog[open]').get_by_role('button',name='Continue editing' if language=='en' else '編集を続ける',exact=True).click()
    assert await page.evaluate('key=>sessionStorage.getItem(key)',key)==stored
    await back.click()
    await page.locator('dialog[open]').get_by_role('button',name='Keep draft and go back' if language=='en' else '下書きを残して戻る',exact=True).click()
    await page.locator('.k-page-head').get_by_role('button',name='Create new' if language=='en' else '新しく作る',exact=True).click()
    await chooser.get_by_text('Resume temporary draft' if language=='en' else '一時下書きから再開',exact=True).wait_for()
    await chooser.get_by_role('button').filter(has_text='Create a plot' if language=='en' else 'プロットを作る').click()
    await expect(editor.get_by_role('textbox',name='Name' if language=='en' else '名前',exact=True)).to_have_value('ライブラリの原文')
    assert await page.evaluate('key=>sessionStorage.getItem(key)',key)==stored
    await page.locator('.k-create-editor-head').get_by_role('button',name='Save' if language=='en' else '保存',exact=True).click()
    await expect(page.locator('.k-create-editor-head').get_by_role('button',name='Save as a new version' if language=='en' else '新しい版として保存',exact=True)).to_be_enabled()
    first=await entities(page,['character'])
    assert len(first)==1 and first[0]['payload']['versions']['1']['data']['description']=='Original description · 原文'
    assert first[0]['payload']['versions']['1']['profile']['settings']=={'temperature':0.65}
    assert first[0]['payload']['versions']['1']['data']['character_book']['entries'][0]['content']=='原文の世界設定 · original lore'
    await editor.get_by_role('tab',name='Plot' if language=='en' else 'プロット',exact=False).click()
    await editor.get_by_role('textbox',name='Description' if language=='en' else '説明',exact=True).fill('Original description · revision two')
    await language_in_place(page,alternate)
    await page.locator('.k-create-editor-head').get_by_role('button',name='Save as a new version' if alternate=='en' else '新しい版として保存',exact=True).click()
    await page.get_by_role('status').filter(has_text='Existing conversations keep' if alternate=='en' else 'これまでの会話は').wait_for()
    second=await entities(page,['character'])
    assert second[0]['id']==first[0]['id'] and second[0]['payload']['current_revision']==2
    assert second[0]['payload']['versions']['1']==first[0]['payload']['versions']['1']
    await page.get_by_role('button',name='Back to my library' if alternate=='en' else 'マイライブラリに戻る',exact=True).click()
    card=page.locator('.k-lib-card').filter(has_text='ライブラリの原文')
    await card.get_by_role('button',name='Export' if alternate=='en' else '書き出し',exact=True).click()
    await page.get_by_role('combobox',name='Export format' if alternate=='en' else '書き出し形式',exact=True).select_option('ccv3-json')
    await language_in_place(page,language)
    await page.get_by_role('combobox',name='Export format' if language=='en' else '書き出し形式',exact=True).wait_for()
    await expect(page.locator('dialog[open] select')).to_have_value('ccv3-json')
    await page.locator('dialog[open]').get_by_role('button',name='Review export' if language=='en' else '書き出し内容を確認',exact=True).click()
    async with page.expect_download() as downloading:
        await page.locator('dialog[open] .k-confirm__actions a[role="button"]').click()
    exported=json.loads(Path(await (await downloading.value).path()).read_text(encoding='utf-8'))
    assert exported['data']['description']=='Original description · revision two'
    await page.locator('dialog[open]').get_by_role('button',name='Close' if language=='en' else '閉じる',exact=True).click()

    raw=json.dumps({'schema_version':1,'name':'持込の原文','data':{'description':'Imported original description','first_mes':'持込の挨拶'},
        'source':{'remote':{'source':'github','source_id':'fixture/card.json','sha256':'a'*64,'document_index':0,'transport':'browser','content_rating':'sfw'}}},ensure_ascii=False).encode('utf-8')
    file={'name':'fictional-card.json','mimeType':'application/json','buffer':raw}
    await page.get_by_label('File to import' if language=='en' else '取り込むファイル',exact=True).set_input_files(file)
    await page.get_by_role('heading',name='Review import' if language=='en' else '取り込み内容を確認',exact=True).wait_for()
    preview_url=page.url
    await language_in_place(page,alternate)
    await page.get_by_role('heading',name='Review import' if alternate=='en' else '取り込み内容を確認',exact=True).wait_for()
    assert page.url==preview_url and await entities(page,['character'])==second
    await page.get_by_role('button',name='Save selected content' if alternate=='en' else '選択した内容を保存',exact=True).click()
    await expect(page.locator('.k-lib-card')).to_have_count(2)
    saved=await entities(page,['character'])
    await page.get_by_label('File to import' if alternate=='en' else '取り込むファイル',exact=True).set_input_files(file)
    await page.get_by_text('This original was already imported.' if alternate=='en' else '同じ原本を取り込み済みです。',exact=True).wait_for()
    await expect(page.get_by_role('button',name='Save selected content' if alternate=='en' else '選択した内容を保存',exact=True)).to_be_disabled()
    await page.get_by_role('checkbox',name='Duplicate as a new item' if alternate=='en' else '新しい項目として複製する',exact=True).check()
    await language_in_place(page,language)
    await expect(page.get_by_role('checkbox',name='Duplicate as a new item' if language=='en' else '新しい項目として複製する',exact=True)).to_be_checked()
    await page.locator('.k-back-link').click()
    await page.locator('dialog[open]').get_by_role('button',name='Continue editing' if language=='en' else '編集を続ける',exact=True).click()
    assert await entities(page,['character'])==saved
    await page.locator('.k-back-link').click()
    await page.locator('dialog[open]').get_by_role('button',name='Keep draft and go back' if language=='en' else '下書きを残して戻る',exact=True).click()
    await page.get_by_role('button',name='Resume draft' if language=='en' else '下書きを再開',exact=True).wait_for()
    assert not await page.evaluate('document.documentElement.scrollWidth > innerWidth')
    await page.screenshot(path=str(output/f'{language}-{page.viewport_size["width"]}-library.png'),full_page=True,animations='disabled')
    await page.goto(chat_url)
    await page.locator('.k-composer textarea').wait_for()
    assert await page.locator('.k-composer textarea').input_value()==draft
    assert without_open_times(await conversations(page))==without_open_times(before)
    assert await entities(page,['character'])==saved


async def check_creator_settings(page, language, before, draft, output):
    chat_url=page.url
    await page.goto(chat_url.rsplit('/chats/',1)[0]+'/create/settings')
    form=page.locator('form.k-lab-form')
    name=form.locator('input:not([type="file"])').first
    await name.wait_for()
    persona_name='端末の人物像 · original persona'
    await name.fill(persona_name)
    await form.locator('textarea').nth(0).fill('原文の人物紹介')
    await form.locator('textarea').nth(1).fill('原文の性格・価値観')
    alternate='ja' if language=='en' else 'en'
    await language_in_place(page,alternate)
    await page.get_by_role('heading',name='Personas and worlds' if alternate=='en' else 'ペルソナ・世界観',exact=True).wait_for()
    assert await name.input_value()==persona_name
    assert await entities(page,['persona','world'])==[]
    await form.get_by_role('button',name='Save' if alternate=='en' else '保存',exact=True).click()
    version_save=form.get_by_role('button',name='Save as a new version' if alternate=='en' else '新しい版として保存',exact=True)
    await expect(version_save).to_be_enabled()
    first=await entities(page,['persona','world'])
    assert len(first)==1 and first[0]['payload']['current_revision']==1
    await form.locator('textarea').nth(0).fill('原文の人物紹介 · revision two')
    await language_in_place(page,language)
    await page.get_by_role('heading',name='Personas and worlds' if language=='en' else 'ペルソナ・世界観',exact=True).wait_for()
    assert await entities(page,['persona','world'])==first
    await form.get_by_role('button',name='Save as a new version' if language=='en' else '新しい版として保存',exact=True).click()
    await form.get_by_text('Version history' if language=='en' else '保存履歴',exact=True).wait_for()
    second=await entities(page,['persona','world'])
    assert second[0]['id']==first[0]['id'] and second[0]['payload']['current_revision']==2
    assert second[0]['payload']['versions']['1']['description']=='原文の人物紹介'
    assert second[0]['payload']['versions']['2']['description']=='原文の人物紹介 · revision two'
    await form.locator('details summary').click()
    old=form.locator('details li').filter(has_text='Version 1' if language=='en' else '版1')
    async with page.expect_download() as downloading:
        await old.get_by_role('button',name='Export' if language=='en' else '書き出す',exact=True).click()
    exported=json.loads(Path(await (await downloading.value).path()).read_text(encoding='utf-8'))
    assert exported['kind']=='persona' and exported['document']==second[0]['payload']['versions']['1']

    await page.get_by_role('group',name='Setting type' if language=='en' else '設定の種類',exact=True).get_by_role('button',name='World' if language=='en' else '世界観',exact=True).click()
    await expect(name).to_have_value('')
    await name.fill('端末の世界 · original world')
    await form.locator('textarea').nth(0).fill('原文の舞台')
    await form.locator('textarea').nth(1).fill('原文の世界ルール')
    await form.get_by_role('button',name='Add a character' if language=='en' else '人物を追加',exact=True).click()
    await form.get_by_role('textbox',name='Character name' if language=='en' else '人物名',exact=True).fill('原文の登場人物')
    await form.get_by_role('textbox',name='Knowledge only this character has' if language=='en' else 'この人物だけが知ること',exact=True).fill('本人だけの秘密 · fixture')
    await form.get_by_role('checkbox').check()
    rules=form.locator('textarea[aria-describedby="rpg-rule-help"]')
    invalid='{"initial_hp":'
    await rules.fill(invalid)
    await expect(rules).to_have_attribute('aria-invalid','true')
    await expect(form.get_by_role('button',name='Save' if language=='en' else '保存',exact=True)).to_be_disabled()
    await language_in_place(page,alternate)
    await form.get_by_role('textbox',name='RPG rules (JSON)' if alternate=='en' else 'RPGルール（JSON）',exact=True).wait_for()
    assert await rules.input_value()==invalid
    assert await name.input_value()=='端末の世界 · original world'
    assert await entities(page,['persona','world'])==second
    await expect(form.get_by_role('button',name='Save' if alternate=='en' else '保存',exact=True)).to_be_disabled()
    valid={'initial_hp':45,'initial_inventory':['鍵'],'skills':{'探索':3},'actions':[]}
    await rules.fill(json.dumps(valid,ensure_ascii=False))
    await expect(rules).to_have_attribute('aria-invalid','false')
    await form.get_by_role('button',name='Save' if alternate=='en' else '保存',exact=True).click()
    await expect(form.get_by_role('button',name='Save as a new version' if alternate=='en' else '新しい版として保存',exact=True)).to_be_enabled()
    saved=await entities(page,['persona','world'])
    world=next(row for row in saved if row['kind']=='world')
    assert world['payload']['creator']['cast'][0]['display_name']=='原文の登場人物'
    assert world['payload']['creator']['cast'][0]['knowledge']=='本人だけの秘密 · fixture'
    assert world['payload']['creator']['rpg']['initial_hp']==45
    assert world['payload']['creator']['rpg']['skills']=={'探索':3}
    assert await rules.evaluate('field=>field.getBoundingClientRect().width>=field.parentElement.getBoundingClientRect().width*.9')
    assert not await page.evaluate('document.documentElement.scrollWidth > innerWidth')
    await page.screenshot(path=str(output/f'{language}-{page.viewport_size["width"]}-creator.png'),full_page=True,animations='disabled')

    await name.fill('PRIVATE_UNSAVED_NAME_CANARY')
    await page.evaluate('''()=>{localStorage.setItem('kyalulu-app-owner','creator-other-owner');window.dispatchEvent(new Event('kyalulu-app-context'));}''')
    await form.get_by_role('heading',name='New persona' if alternate=='en' else '新しいペルソナ',exact=True).wait_for()
    await expect(name).to_have_value('')
    assert 'PRIVATE_UNSAVED_NAME_CANARY' not in await page.locator('main').inner_text()
    assert '本人だけの秘密 · fixture' not in await page.locator('main').inner_text()
    assert await entities(page,['persona','world'])==saved
    await name.fill('別のアカウントの人物像')
    await form.get_by_role('button',name='Save' if alternate=='en' else '保存',exact=True).click()
    await expect(form.get_by_role('button',name='Save as a new version' if alternate=='en' else '新しい版として保存',exact=True)).to_be_enabled()
    separate=await entities(page,['persona','world'])
    assert len(separate)==3
    assert [row for row in separate if row['owner']=='pwa-fixture']==saved
    other=next(row for row in separate if row['owner']=='creator-other-owner')
    assert other['payload']['creator']['display_name']=='別のアカウントの人物像'
    await expect(page.locator('ul.k-lab-list button')).to_have_count(1)
    await expect(page.locator('ul.k-lab-list button')).to_contain_text('別のアカウントの人物像')
    await page.evaluate('''()=>{localStorage.setItem('kyalulu-app-owner','pwa-fixture');window.dispatchEvent(new Event('kyalulu-app-context'));}''')
    await page.locator('ul.k-lab-list button').filter(has_text=persona_name).click()
    await expect(name).to_have_value(persona_name)
    assert await form.locator('textarea').nth(0).input_value()=='原文の人物紹介 · revision two'
    await language_in_place(page,language)
    await page.goto(chat_url)
    await page.locator('.k-composer textarea').wait_for()
    assert await page.locator('.k-composer textarea').input_value()==draft
    assert without_open_times(await conversations(page))==without_open_times(before)
    assert await entities(page,['persona','world'])==separate


async def check_profile_settings(page, language, before, draft, output):
    en = language == 'en'
    alternate = 'ja' if en else 'en'
    chat_url = page.url
    await page.goto(chat_url.rsplit('/chats/', 1)[0] + '/profile')
    await page.get_by_role('textbox', name='Display name' if en else '表示名', exact=True).wait_for()
    name = page.locator('#k-profile-name')
    old_name = await page.evaluate("localStorage.getItem('kyalulu-display-name')")
    old_servers = await page.evaluate("localStorage.getItem('kyalulu-server-bookmarks-v1')")
    name_draft = '名前の下書き · profile draft'
    await name.fill(name_draft)
    await language_in_place(page, alternate)
    await page.get_by_role('textbox', name='Display name' if alternate == 'en' else '表示名', exact=True).wait_for()
    assert await name.input_value() == name_draft
    assert await page.evaluate("localStorage.getItem('kyalulu-display-name')") == old_name
    connection = page.locator('.k-connection').filter(has=page.locator('#connection-title'))
    await connection.get_by_text('On-device conversations and memories are stored in this browser.' if alternate == 'en' else '端末内の会話・記憶はこのブラウザーに保存されます。', exact=False).wait_for()
    initial_theme = await page.evaluate("localStorage.getItem('my-zeta-theme')")
    assert initial_theme in {'light', 'dark'}
    for theme in ['dark' if initial_theme == 'light' else 'light', initial_theme]:
        label = ('Light' if theme == 'light' else 'Dark') if alternate == 'en' else ('ライト' if theme == 'light' else 'ダーク')
        radio = page.get_by_role('radio', name=label, exact=True)
        await radio.click()
        await expect(radio).to_have_attribute('aria-checked', 'true')
    assert await page.evaluate("localStorage.getItem('kyalulu-display-name')") == name_draft
    await connection.get_by_role('textbox', name='Destination name' if alternate == 'en' else '接続先の名前', exact=True).wait_for()
    await connection.get_by_role('textbox', name='Server HTTPS address' if alternate == 'en' else 'サーバーのHTTPSアドレス', exact=True).wait_for()
    destination = connection.locator('input').nth(0)
    address = connection.locator('input').nth(1)
    await destination.fill('架空PC · unsaved destination')
    await address.fill('https://example.test')
    await language_in_place(page, language)
    await page.get_by_role('textbox', name='Display name' if en else '表示名', exact=True).wait_for()
    assert await name.input_value() == name_draft
    assert await destination.input_value() == '架空PC · unsaved destination'
    assert await address.input_value() == 'https://example.test'
    assert await page.evaluate("localStorage.getItem('kyalulu-server-bookmarks-v1')") == old_servers
    assert not await page.get_by_role('switch', name='Show adult content' if en else '成人向けコンテンツを表示', exact=True).count()
    assert not await page.evaluate('document.documentElement.scrollWidth > innerWidth')
    await page.locator('.k-profile-card').screenshot(path=str(output / f'{language}-{page.viewport_size["width"]}-profile.png'), animations='disabled')
    await connection.screenshot(path=str(output / f'{language}-{page.viewport_size["width"]}-server-settings.png'), animations='disabled')
    await page.locator('.k-session-row__link').click()
    await page.locator('.k-composer textarea').wait_for()
    assert page.url == chat_url and await page.locator('.k-composer textarea').input_value() == draft
    assert without_open_times(await conversations(page)) == without_open_times(before)


async def check_chat_management(page, language, before, draft, output):
    en = language == 'en'
    alternate = 'ja' if en else 'en'
    composer = page.locator('.k-composer textarea')
    actions = page.locator('.k-msg__actions').first
    await actions.get_by_role('button', name='Edit' if en else '編集', exact=True).click()
    await page.get_by_role('textbox', name='Message text' if en else 'メッセージ本文', exact=True).fill('fictional edit · 架空の編集')
    await page.locator('.k-msg__editor').get_by_role('button', name='Cancel' if en else 'キャンセル', exact=True).click()
    confirm = page.locator('dialog[open]')
    for button, title, detail in [
        ('Delete' if en else '削除', 'Delete this message?' if en else 'このメッセージを削除しますか？', None),
        ('Branch here' if en else 'ここから分岐', 'Branch from this point?' if en else 'ここまでの会話から分岐しますか？',
         'Keep the original conversation' if en else '元の会話を保持'),
    ]:
        await actions.get_by_role('button', name=button, exact=True).click()
        await confirm.get_by_role('heading', name=title, exact=True).wait_for()
        if detail:
            await confirm.get_by_text(detail, exact=False).wait_for()
        await confirm.get_by_role('button', name='Cancel' if en else 'キャンセル', exact=True).click()
        assert await conversations(page) == before
        assert await composer.input_value() == draft
    await page.get_by_role('button', name='Open information panel' if en else '情報パネルを開く', exact=True).click()
    panel = page.get_by_role('dialog', name='Conversation information' if en else '会話の情報', exact=True)
    await panel.wait_for()
    for button, fragments in [
        ('Clear displayed history' if en else '表示履歴を削除',
         ['Permanently erasing generation results and memories is a separate action.'] if en else ['生成結果や記憶の完全消去は別の操作です']),
        ('Erase conversation data' if en else '会話データを完全消去',
         ['same conversation ID', 'Conflicting updates require another review', 'unsent changes on other devices remain device only', 'Cost ledgers are retained', 'Backup retention']
         if en else ['同じ会話ID', '更新の競合は再確認', '他の端末の未送信変更は端末限定で保持', '費用台帳は残り', 'バックアップの保持期間']),
    ]:
        await panel.get_by_role('button', name=button, exact=True).click()
        for fragment in fragments:
            await confirm.get_by_text(fragment, exact=False).wait_for()
        if button == ('Erase conversation data' if en else '会話データを完全消去'):
            await confirm.screenshot(path=str(output / f'{language}-{page.viewport_size["width"]}-erasure-warning.png'), animations='disabled')
        # Never accept a destructive action in this display-language check.
        await confirm.get_by_role('button', name='Cancel' if en else 'キャンセル', exact=True).click()
        assert await conversations(page) == before
        assert await composer.input_value() == draft
    await panel.get_by_role('button', name='Close panel' if en else 'パネルを閉じる', exact=True).click()

    chat_url = page.url
    session_id = chat_url.rsplit('/', 1)[1]
    await page.goto(chat_url.rsplit('/', 1)[0])
    row = page.locator('.k-session-row').first
    await row.wait_for()
    name = await row.locator('.k-session-row__name').inner_text()
    search = page.locator('.k-chats-tools input')
    await search.fill(name)
    await expect(page.locator('.k-session-row')).to_have_count(1)
    href = await row.locator('a').get_attribute('href')
    await row.locator('.k-session-row__pin').click()
    await expect(row.locator('.k-session-row__pin')).to_have_attribute('aria-pressed', 'true')
    await page.locator('.k-sort-toggle').click()
    await language_in_place(page, alternate)
    await page.get_by_role('textbox', name='Search chats' if alternate == 'en' else 'チャットを検索', exact=True).wait_for()
    assert await search.input_value() == name
    assert await row.locator('a').get_attribute('href') == href
    await expect(row.locator('.k-session-row__pin')).to_have_attribute('aria-pressed', 'true')
    await expect(page.locator('.k-sort-toggle')).to_contain_text('Oldest first' if alternate == 'en' else '古い順')
    await language_in_place(page, language)
    await page.get_by_role('textbox', name='Search chats' if en else 'チャットを検索', exact=True).wait_for()
    assert await search.input_value() == name
    await row.locator('a').click()
    await composer.wait_for()
    assert page.url == chat_url and await composer.input_value() == draft
    assert without_open_times(await conversations(page)) == without_open_times(before)
    await check_profile_settings(page, language, before, draft, output)
    await check_creator_settings(page, language, before, draft, output)
    await check_library_workspace(page, language, before, draft, output)

    key = 'kyalulu:chat-recovery:v1:device%3Apwa-fixture:' + session_id
    original = await page.evaluate('key=>localStorage.getItem(key)', key)
    assert original is not None
    pending_record = await page.evaluate('''key=>{
        const record=JSON.parse(localStorage.getItem(key));
        record.pending={id:crypto.randomUUID(),draft:'fictional sent draft',regenerate:false};
        const raw=JSON.stringify(record);localStorage.setItem(key,raw);return raw;
    }''', key)
    try:
        await page.reload()
        await page.get_by_text('It will not be resent automatically.' if en else '自動再送はしません。', exact=False).wait_for()
        await page.get_by_text('HTTP 404', exact=False).wait_for()
        await language_in_place(page, alternate)
        await page.get_by_text('It will not be resent automatically.' if alternate == 'en' else '自動再送はしません。', exact=False).wait_for()
        assert await page.evaluate('key=>localStorage.getItem(key)', key) == pending_record
        assert without_open_times(await conversations(page)) == without_open_times(before)
        assert await composer.input_value() == draft
        assert not await page.evaluate('document.documentElement.scrollWidth > innerWidth')
        await page.screenshot(path=str(output / f'{language}-{page.viewport_size["width"]}-recovery.png'), full_page=True, animations='disabled')
    finally:
        # Restore only this new profile's fictional pending fixture.
        await page.evaluate('''([key,raw,language])=>{
            localStorage.setItem(key,raw);
            const prefs=JSON.parse(localStorage.getItem('kyalulu-app-preferences-v1'));
            localStorage.setItem('kyalulu-app-preferences-v1',JSON.stringify({...prefs,language}));
        }''', [key, original, language])
        await page.reload()
    await composer.wait_for()
    assert await composer.input_value() == draft
    assert without_open_times(await conversations(page)) == without_open_times(before)


@asynccontextmanager
async def offline_renderer(context, page, language):
    # Traffic emulation alone can leave a cached renderer's navigator.onLine true.
    assert await page.evaluate("() => fetch('/__offline_probe__', {cache:'no-store'}).then(()=>false,()=>true)")
    cdp = await context.new_cdp_session(page)
    try:
        await cdp.send('Network.overrideNetworkState', {'offline': True, 'latency': 0,
            'downloadThroughput': 0, 'uploadThroughput': 0})
        await page.wait_for_function('() => navigator.onLine === false')
        await page.get_by_role('status').filter(has_text='Offline' if language == 'en' else 'オフライン').first.wait_for()
        yield
    finally:
        await cdp.detach()


async def check(dist, output):
    output.mkdir(parents=True, exist_ok=True)
    assert (dist / 'device/index.html').is_file(), 'Build unified app first'
    with socket.socket() as available:
        available.bind(('127.0.0.1', 0))
        port = available.getsockname()[1]
    origin = f'http://127.0.0.1:{port}'
    marker = output / 'worker-version.txt'
    marker.write_text('0', encoding='ascii')
    results = []
    with (output / 'server.log').open('wb') as log:
        server = subprocess.Popen([sys.executable, '-B', str(Path(__file__).resolve()), '--serve',
            '--dist', str(dist), '--port', str(port), '--update-marker', str(marker)], stdout=log, stderr=log,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        try:
            async with httpx.AsyncClient(trust_env=False, timeout=1) as client:
                for _ in range(100):
                    assert server.poll() is None, 'Owned static fixture stopped'
                    try:
                        if (await client.get(origin)).status_code == 200:
                            break
                    except httpx.HTTPError:
                        pass
                    await asyncio.sleep(.1)
                else:
                    raise AssertionError('Owned static fixture did not start')
            async with async_playwright() as playwright:
                for language, width, theme in [('ja', 393, 'light'), ('en', 393, 'dark'), ('ja', 1280, 'dark'), ('en', 1280, 'light')]:
                    profile = tempfile.mkdtemp(prefix='profile-', dir=output)
                    settings = {'headless': True, 'viewport': {'width': width, 'height': 852},
                        'locale': 'ja-JP' if language == 'ja' else 'en-US', 'color_scheme': theme}
                    context = await playwright.chromium.launch_persistent_context(profile, **settings)
                    errors, blocked, api = [], [], []
                    try:
                        def record(request):
                            url = urlsplit(request.url)
                            if url.path.startswith('/api/'):
                                api.append(url.path)
                            if url.hostname != '127.0.0.1' or url.port != port:
                                blocked.append(url.path)
                        async def guard(route):
                            url = urlsplit(route.request.url)
                            if url.hostname != '127.0.0.1' or url.port != port:
                                await route.abort()
                            else:
                                await route.continue_()
                        await context.route('**/*', guard)
                        context.on('request', record)
                        page = await context.new_page()
                        page.on('pageerror', lambda error: errors.append(str(error)))
                        await page.goto(origin)
                        await page.locator('.k-unified-entry').wait_for()
                        assert not await page.evaluate('crossOriginIsolated')
                        await page.wait_for_function('navigator.serviceWorker.controller !== null', timeout=120000)
                        await page.evaluate('''([language,theme])=>{
                            localStorage.setItem('kyalulu-app-preferences-v1',JSON.stringify({version:1,language,country:'JP',age:25,accepted:true,
                              genres:[],moods:[],activities:[],favorites:[],dismissed:[]}));
                            localStorage.setItem('kyalulu-app-owner','pwa-fixture');
                            localStorage.setItem('kyalulu-execution-target','device');
                            localStorage.setItem('my-zeta-theme',theme);
                        }''', [language, theme])
                        await page.goto(origin + '/device/#/')
                        await page.locator('.k-char-card').first.wait_for()
                        await page.locator('.k-mobile-status summary').click()
                        await page.get_by_role('button', name='Check for updates' if language == 'en' else '更新を確認', exact=True).wait_for()
                        await page.locator('.k-mobile-status summary').click()
                        await page.get_by_role('button', name='Search characters and worlds' if language == 'en' else 'キャラクターやワールドを検索', exact=True).click()
                        palette_input = page.locator('.k-cmd input')
                        palette_options = page.locator('.k-cmd').get_by_role('option')
                        await palette_input.wait_for()
                        assert await palette_options.filter(has_text='Studio').count() == 0
                        assert await palette_options.filter(has_text='スタジオ').count() == 0
                        await palette_input.fill('butler')
                        await palette_options.nth(1).wait_for()
                        palette_results = await page.locator('.k-cmd__label').all_text_contents()
                        alternate_language = 'ja' if language == 'en' else 'en'
                        await language_in_place(page, alternate_language)
                        await page.get_by_role('combobox', name='Search' if alternate_language == 'en' else '検索', exact=True).wait_for()
                        assert await palette_input.input_value() == 'butler'
                        assert (await page.locator('.k-cmd__label').all_text_contents())[1:] == palette_results[1:]
                        previous_url = page.url
                        await palette_input.dispatch_event('keydown', {'key': 'Enter', 'code': 'Enter', 'isComposing': True, 'keyCode': 229})
                        assert page.url == previous_url
                        await palette_input.press('Enter')
                        search = page.locator('.k-discover-search input')
                        await search.wait_for()
                        assert await search.input_value() == 'butler'
                        await page.get_by_role('group', name='Filter by mood' if alternate_language == 'en' else '気分で絞り込む').get_by_role('button', name='Butler' if alternate_language == 'en' else '執事', exact=True).click()
                        mood_group = page.get_by_role('group', name='Filter by mood' if alternate_language == 'en' else '気分で絞り込む')
                        await expect(mood_group.get_by_role('button', name='All' if alternate_language == 'en' else 'すべて', exact=True)).to_have_attribute('aria-pressed', 'false')
                        await expect(mood_group.get_by_role('button', name='Butler' if alternate_language == 'en' else '執事', exact=True)).to_have_attribute('aria-pressed', 'true')
                        assert 'mood=butler' in page.url and 'q=butler' in page.url
                        links = await page.locator('.k-char-card').evaluate_all('(cards)=>cards.map(c=>c.getAttribute("href"))')
                        assert len(links) == 1 and 'butler' in links[0]
                        previous_url = page.url
                        await language_in_place(page, language)
                        await page.get_by_role('textbox', name='Search characters' if language == 'en' else 'キャラクターを検索', exact=True).wait_for()
                        assert page.url == previous_url and await search.input_value() == 'butler'
                        assert await page.locator('.k-char-card').evaluate_all('(cards)=>cards.map(c=>c.getAttribute("href"))') == links
                        await search.fill('執事')
                        assert await page.locator('.k-char-card').evaluate_all('(cards)=>cards.map(c=>c.getAttribute("href"))') == links
                        assert await page.get_by_role('tab').count() == 0
                        assert not await page.evaluate('document.documentElement.scrollWidth > innerWidth')
                        await page.screenshot(path=str(output / f'{language}-{width}-{theme}-explore.png'), full_page=True, animations='disabled')
                        assert await page.evaluate('crossOriginIsolated && typeof SharedArrayBuffer !== "undefined"')
                        assert await page.evaluate('''async()=>{
                            await WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0]));return true;
                        }''')
                        await page.locator('.k-char-card').first.click()
                        start = page.get_by_role('button', name='Start conversation' if language == 'en' else '会話をはじめる', exact=True)
                        await start.wait_for()
                        assert not await page.evaluate('document.documentElement.scrollWidth > innerWidth')
                        await page.screenshot(path=str(output / f'{language}-{width}-{theme}-entry.png'), full_page=True, animations='disabled')
                        opening = await page.locator('.k-scene-preview').inner_text()
                        alternate_language = 'ja' if language == 'en' else 'en'
                        await language_in_place(page, alternate_language)
                        await page.get_by_role('button', name='Start conversation' if alternate_language == 'en' else '会話をはじめる', exact=True).wait_for()
                        assert await page.locator('.k-scene-preview').inner_text() == opening
                        assert await conversations(page) == []
                        await language_in_place(page, language)
                        await page.get_by_role('button', name='Start conversation' if language == 'en' else '会話をはじめる', exact=True).click()
                        composer = page.locator('.k-composer textarea')
                        await composer.wait_for()
                        draft = 'オフラインの下書き · draft'
                        await composer.fill(draft)
                        await page.wait_for_function('text=>Object.values(localStorage).some(value=>value.includes(text))', arg=draft)
                        await page.get_by_role('button', name='Choose a model' if language == 'en' else '会話エンジンを選ぶ', exact=True).click()
                        model_panel = page.get_by_role('dialog', name='Character & preset' if language == 'en' else 'キャラ・プリセット', exact=True)
                        await model_panel.wait_for()
                        await model_panel.locator('.k-sheet-head').get_by_role('button', name='Close' if language == 'en' else '閉じる', exact=True).click()
                        assert await composer.input_value() == draft
                        tutorial = page.locator('.k-first-chat-tutorial')
                        await tutorial.wait_for()
                        await tutorial.get_by_role('button', name='Next' if language == 'en' else '次へ', exact=True).click()
                        expected = 'not sent to Cloud or external AI' if language == 'en' else 'Cloudや外部AIへ送りません'
                        await tutorial.get_by_text(expected, exact=False).wait_for()
                        assert 'BYOK' not in await tutorial.inner_text()
                        assert not await page.evaluate('document.documentElement.scrollWidth > innerWidth')
                        await tutorial.screenshot(path=str(output / f'{language}-{width}-{theme}-guide.png'), animations='disabled')
                        before = await conversations(page)
                        assert len(before) == 1
                        await language_in_place(page, alternate_language)
                        expected = 'not sent to Cloud or external AI' if alternate_language == 'en' else 'Cloudや外部AIへ送りません'
                        await tutorial.get_by_text(expected, exact=False).wait_for()
                        assert await composer.input_value() == draft
                        assert await conversations(page) == before
                        await language_in_place(page, language)
                        for _ in range(2):
                            await tutorial.get_by_role('button', name='Next' if language == 'en' else '次へ', exact=True).click()
                        assert await tutorial.get_by_role('button', name='Open Inspector' if language == 'en' else 'Inspectorを開く', exact=True).is_disabled()
                        await tutorial.get_by_role('button', name='Finish guide' if language == 'en' else '案内を完了', exact=True).click()
                        assert await page.evaluate("localStorage.getItem('kyalulu-first-chat-tutorial-v1')") == 'completed'
                        await page.get_by_role('button', name='First chat guide' if language == 'en' else '初トークの案内', exact=True).click()
                        await tutorial.get_by_role('button', name='Skip' if language == 'en' else 'スキップ', exact=True).click()
                        assert await page.evaluate("localStorage.getItem('kyalulu-first-chat-tutorial-v1')") == 'skipped'
                        assert await conversations(page) == before
                        await check_chat_management(page, language, before, draft, output)
                        # Simulate a new worker release without changing app assets or integrity.
                        version = '1' if language == 'ja' else '2'
                        marker.write_text(version, encoding='ascii')
                        await page.locator('.k-mobile-status summary').click()
                        await page.get_by_role('button', name='Check for updates' if language == 'en' else '更新を確認', exact=True).click()
                        update = page.get_by_role('button', name='Update and reload' if language == 'en' else '更新して再読み込み', exact=True)
                        await update.wait_for(timeout=120000)
                        other = await context.new_page()
                        await other.goto(origin + '/device/#/')
                        await other.locator('.k-char-card').first.wait_for()
                        page.on('dialog', lambda dialog: dialog.accept())
                        await update.click()
                        await page.get_by_role('alert').filter(has_text='Close other Kyalulu' if language == 'en' else 'ほかのKyaluluタブ').wait_for()
                        assert await composer.input_value() == draft
                        assert await page.evaluate('navigator.serviceWorker.getRegistration().then(r=>!!r.waiting)')
                        await other.close()
                        async with page.expect_navigation():
                            await update.click()
                        await composer.wait_for()
                        assert await composer.input_value() == draft
                        await page.wait_for_function('version=>caches.keys().then(keys=>keys.some(k=>k.includes(":fixture"+version+"-")))', arg=version)
                        await context.set_offline(True)
                        await page.reload()
                        await composer.wait_for()
                        assert await composer.input_value() == draft
                        assert await page.evaluate('crossOriginIsolated')
                        async with offline_renderer(context, page, language):
                            assert not await page.evaluate('document.documentElement.scrollWidth > innerWidth')
                            await page.screenshot(path=str(output / f'{language}-{width}-{theme}-offline.png'), full_page=True, animations='disabled')
                        chat_url = page.url
                        await context.close()
                        context = await playwright.chromium.launch_persistent_context(profile, offline=True, **settings)
                        await context.route('**/*', guard)
                        context.on('request', record)
                        page = context.pages[0]
                        page.on('pageerror', lambda error: errors.append(str(error)))
                        await page.goto(chat_url)
                        composer = page.locator('.k-composer textarea')
                        await composer.wait_for()
                        assert await composer.input_value() == draft
                        assert await page.evaluate('crossOriginIsolated && navigator.serviceWorker.controller !== null')
                        async with offline_renderer(context, page, language):
                            await page.screenshot(path=str(output / f'{language}-{width}-{theme}-offline-restart.png'), full_page=True, animations='disabled')
                        await context.set_offline(False)
                        await page.goto(origin + '/migration/')
                        assert not await page.evaluate('crossOriginIsolated')
                        assert not errors, errors
                        assert not blocked, blocked
                        assert not api, api
                        results.append({'language': language, 'width': width, 'theme': theme,
                            'device_isolated_online_and_offline': True, 'wasm_csp': True,
                            'entry_language_switch_preserves_opening': True, 'tutorial_device_disclosure': True,
                            'bilingual_search_preserves_query_filter_url_and_results': True, 'palette_ime_guard': True,
                            'device_hub_management_hidden': True,
                            'management_cancellation_preserves_conversation_and_draft': True,
                            'erasure_disclosures_preserved': True, 'chat_list_search_pin_sort_preserved': True,
                            'profile_name_destination_drafts_and_theme_preserved': True,
                            'profile_device_storage_disclosure_and_adult_gate': True,
                            'creator_language_drafts_version_save_and_old_export': True,
                            'world_cast_rpg_invalid_json_and_owner_isolation': True,
                            'library_workspace_language_draft_reload_save_export_and_import': True,
                            'library_duplicate_requires_choice_and_cancellation_keeps_data': True,
                            'uncertain_generation_language_switch_preserves_pending_without_resend': True,
                            'tutorial_language_switch_preserves_step_and_draft': True, 'tutorial_receipts': True,
                            'draft_reload': True, 'explicit_update': True, 'other_tab_update_blocked': True,
                            'offline_browser_restart': True, 'offline_status_with_renderer_emulation': True,
                            'uncached_network_blocked': True, 'migration_not_isolated': True,
                            'api_requests': len(api), 'external_requests': len(blocked), 'page_errors': len(errors)})
                    finally:
                        await context.close()
        finally:
            if server.poll() is None:
                server.terminate()
                try:
                    await asyncio.to_thread(server.wait, 10)
                except subprocess.TimeoutExpired:
                    server.kill()
                    await asyncio.to_thread(server.wait)
    (output / 'results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dist', type=Path, default=ROOT / '.artifacts/unified-app')
    parser.add_argument('--output', type=Path, default=ROOT / '.artifacts/unified-pwa-browser')
    parser.add_argument('--serve', action='store_true')
    parser.add_argument('--port', type=int)
    parser.add_argument('--update-marker', type=Path)
    args = parser.parse_args()
    if args.serve:
        import uvicorn
        from fastapi import FastAPI
        from fastapi.responses import Response
        from python.api.mobile import WebDist
        app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
        @app.get('/sw.js')
        async def worker():
            source = (args.dist / 'sw.js').read_text(encoding='utf-8')
            version = args.update_marker.read_text(encoding='ascii').strip()
            assert version in {'0', '1', '2'}
            return Response(source.replace('const VERSION = "', f'const VERSION = "fixture{version}-', 1),
                media_type='text/javascript', headers={'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/'})
        app.mount('/', WebDist(directory=str(args.dist.resolve()), html=True))
        uvicorn.run(app, host='127.0.0.1', port=args.port, access_log=False)
    else:
        asyncio.run(check(args.dist.resolve(), args.output.resolve()))
