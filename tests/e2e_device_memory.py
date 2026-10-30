"""Memory API through actual IndexedDB; injected metadata failure, no model/network."""
import asyncio
import json
from pathlib import Path
from urllib.parse import quote, urlsplit

from playwright.async_api import async_playwright
from browser_fixture_server import local_vite

ROOT=Path(__file__).resolve().parents[1]
OUTPUT=ROOT/'.artifacts/device-memory-api-browser'
SESSION='memory-language-fixture'

async def main():
    results=[]
    async with local_vite(OUTPUT) as origin, async_playwright() as runtime:
        browser=await runtime.chromium.launch(headless=True)
        try:
            for language,width,theme in [('ja',393,'light'),('en',1280,'dark')]:
                context=await browser.new_context(viewport={'width':width,'height':852},service_workers='block')
                blocked,errors=[],[]
                try:
                    async def guard(route):
                        url=urlsplit(route.request.url)
                        if url.hostname=='127.0.0.1' and url.port==urlsplit(origin).port and not url.path.startswith('/api/'):
                            await route.continue_()
                        else:
                            blocked.append(url.path);await route.abort()
                    await context.route('**/*',guard)
                    await context.route_web_socket('**/*',lambda socket:socket.close())
                    page=await context.new_page()
                    page.on('pageerror',lambda error:errors.append(str(error)))
                    url=origin+'/@fs/'+quote((ROOT/'tests/fixtures/memory-language.html').as_posix(),safe='/:')
                    await page.goto(url)
                    await page.wait_for_function('window.__MEMORY_LANGUAGE__ !== undefined')
                    await page.evaluate('([lang,theme])=>window.__MEMORY_LANGUAGE__.mount(document.getElementById("root"),lang,theme)',[language,theme])
                    await page.get_by_role('button',name='Add a memory' if language=='en' else '覚えてほしいことを追加',exact=True).wait_for()
                    async def api(path,method='GET',body=None):
                        return await page.evaluate('([path,method,body])=>window.__MEMORY_LANGUAGE__.api(path,method,body??undefined)',[path,method,body])
                    made=await api('/api/memory','POST',{'scope':SESSION,'type':'semantic','content':'  サーモンの寿司が好き  '})
                    assert made['status']==200,made
                    memory=made['data'];mid=memory['id']
                    assert memory['content']=='サーモンの寿司が好き' and memory['confirmation']=='user_confirmed'
                    assert memory['source_kind']=='user_statement' and memory['source_quote']==memory['content']
                    before=await page.evaluate('window.__MEMORY_LANGUAGE__.saved()')
                    events=await page.evaluate('window.__MEMORY_LANGUAGE__.events()')
                    rejected=await page.evaluate('id=>window.__MEMORY_LANGUAGE__.rejectEventWrite(id)',mid)
                    assert rejected['status']!=200,rejected
                    after=await page.evaluate('window.__MEMORY_LANGUAGE__.saved()')
                    # Opening the conversation updates its access time before the failing save.
                    assert {k:v for k,v in after.items() if k!='opened'}=={k:v for k,v in before.items() if k!='opened'},(before,after)
                    assert await page.evaluate('window.__MEMORY_LANGUAGE__.events()')==events
                    corrected=await api('/api/memory/'+mid,'PATCH',{'content':'猫を三匹飼っている','id':'forged','scope':'foreign'})
                    assert corrected['status']==200,corrected
                    assert corrected['data']['id']==mid and corrected['data']['scope']==SESSION
                    assert corrected['data']['source_kind']=='user_correction' and corrected['data']['source_revision']=='manual:2'
                    preview=await api('/api/memory/search','POST',{'scope':SESSION,'query':'猫を三匹飼っている','top_k':1})
                    assert preview['status']==200 and preview['data']['injected']==[mid],preview
                    assert (await api('/api/memory/'+mid))['data']['access_count']==0
                    detail=await api('/api/memory/'+mid)
                    assert [e['op'] for e in detail['data']['events']]==['update','create'],detail
                    await page.reload()
                    await page.wait_for_function('window.__MEMORY_LANGUAGE__ !== undefined')
                    restored=await api('/api/memory/'+mid)
                    assert restored==detail,(restored,detail)
                    await page.evaluate('window.__MEMORY_LANGUAGE__.owner("fictional-foreign-owner")')
                    assert (await api('/api/memory/'+mid))['status']==404
                    assert (await api('/api/memory/events?scope='+SESSION))['data']['events']==[]
                    await page.evaluate('window.__MEMORY_LANGUAGE__.owner("memory-language-fixture")')
                    assert (await api('/api/memory/'+mid))['data']['content']=='猫を三匹飼っている'
                    erased=await api('/api/memory/'+mid,'DELETE')
                    assert erased['status']==200 and erased['data']['version']==2 and erased['data']['status']=='deleted'
                    assert (await api('/api/memory/'+mid,'PATCH',{'content':'must not resurrect'}))['status']==404
                    assert [e['op'] for e in (await api('/api/memory/'+mid))['data']['events']]==['delete','update','create']
                    cleared=await api('/api/memory/session/'+SESSION+'/data','DELETE')
                    assert cleared['status']==200 and not cleared['data']['affects_shared_sessions']
                    assert (await api('/api/memory/events?scope='+SESSION))['data']['events']==[]
                    assert (await api('/api/memory?scope='+SESSION+'&include_deleted=true'))['data']['memories']==[]
                    await page.reload();await page.wait_for_function('window.__MEMORY_LANGUAGE__ !== undefined')
                    assert (await api('/api/memory/events?scope='+SESSION))['data']['events']==[]
                    assert (await api('/api/memory/'+mid))['status']==404
                    unsent=await api('/api/memory','POST',{'scope':SESSION,'type':'semantic','content':'Fictional unsent memory'})
                    assert unsent['status']==200
                    recovered=await page.evaluate('window.__MEMORY_LANGUAGE__.remoteDeletionWithUnsentMemory()')
                    assert recovered['source']['deleted'] and not recovered.get('source_events')
                    assert recovered['recovery']['payload']['storage_policy']=='local' and not recovered['recovery']['dirty']
                    assert recovered['recovery']['payload']['draft']=='UNSENT MEMORY DRAFT'
                    assert recovered['events'][0]['detail']['content']=='Fictional unsent memory'
                    assert recovered['events'][0]['source_scope']==SESSION
                    assert recovered['events'][0]['source_memory_id']==unsent['data']['id']
                    assert recovered['events'][0]['memory_id']==recovered['recovery']['payload']['memories'][0]['id']
                    assert not blocked and not errors,(blocked,errors)
                    results.append({'language':language,'width':width,'theme':theme,'ok':True,
                        'atomic_metadata_failure_preserves_original':True,'search_without_access_mutation':True,
                        'reload_preserves_provenance_and_events':True,'owner_isolation':True,
                        'deleted_memory_not_resurrected':True,'explicit_scope_erasure_removes_event_evidence':True,
                        'remote_deletion_preserves_unsent_memory_evidence_in_device_only_recovery':True,
                        'blocked_external_or_api_network_requests':blocked,'page_errors':errors,'real_inference_attempts':0})
                finally:
                    await context.close()
        finally:
            await browser.close()
    report={'ok':True,'results':results,'vite_stopped':True,'production_used':False,
            'limits':['Metadata QuotaExceededError injected; not physical disk exhaustion','No real inference or physical device']}
    (OUTPUT/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'ok':True,'cases':len(results),'report':str(OUTPUT/'result.json')}))

if __name__=='__main__':
    asyncio.run(asyncio.wait_for(main(),120))
