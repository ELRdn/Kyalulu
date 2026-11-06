"""First-run UX baseline on the built unified app (docs/MOBILE_UX_SPEC.md §1, §9).

Serves .artifacts/unified-app through the loopback fixture (scripts/unified_preview.py), then records:
- taps and screens from a cold start to the login wall at 375px (the shortest path a new user can take),
- axe-core serious/critical violations per screen,
- screenshots at 375px and 1440px in light and dark.
Seconds are automation wall time (app latency only), not human reading or typing time.
Run: pnpm --filter web build:app (with VITE_RELAY_ORIGIN), then .venv/Scripts/python.exe scripts/ux_baseline.py
"""
import asyncio
from datetime import date
import json
from pathlib import Path
import socket
import sys
import time

from playwright.async_api import async_playwright
import uvicorn

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'runtime'))
sys.path.insert(0, str(ROOT / 'scripts'))
from unified_preview import DIST, app  # noqa: E402

AXE = ROOT / 'apps/web/node_modules/axe-core/axe.min.js'
# Optional label keeps runs from overwriting each other: scripts/ux_baseline.py phase1
OUTPUT = ROOT / '.artifacts/ux-baseline' / '-'.join([date.today().isoformat(), *sys.argv[1:2]])
SCREENS = {'home': '/', 'discover': '/discover', 'character': '/characters/butler', 'chats': '/chats',
           'create': '/create', 'profile': '/profile', 'not-found': '/no-such-page'}


async def axe(page):
    await page.add_script_tag(path=str(AXE))
    found = await page.evaluate("async()=>(await axe.run(document,{resultTypes:['violations']})).violations"
                                ".filter(v=>['serious','critical'].includes(v.impact))"
                                ".map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length,help:v.help}))")
    return found


async def first_run(browser, origin):
    """Shortest cold-start path to the login wall. Each click or field focus is one tap."""
    context = await browser.new_context(locale='ja-JP', viewport={'width': 375, 'height': 812}, bypass_csp=True)
    page = await context.new_page()
    taps, screens, report = 0, [], {}

    async def tap(locator):
        nonlocal taps
        await locator.click()
        taps += 1

    started = time.perf_counter()
    await page.goto(origin)
    card = page.locator('.k-char-card').first
    await card.wait_for()
    screens.append('home')
    await tap(card)
    # Pick an author-written first reply when the character has one, otherwise the start button.
    start = page.locator('.k-plot-replies .k-starter, .k-plot-cta__main').first
    await start.wait_for()
    screens.append('character')
    report['character-preview'] = await axe(page)
    await page.screenshot(path=str(OUTPUT / 'first-run-1-character.png'), full_page=False, animations='disabled')
    await tap(start)
    await page.locator('.k-cloud-login').wait_for()
    screens.append('login')
    seconds = round(time.perf_counter() - started, 2)
    report['login'] = await axe(page)
    await page.screenshot(path=str(OUTPUT / 'first-run-2-login.png'), full_page=False, animations='disabled')
    storage = await context.storage_state()
    await context.close()
    return {'taps_to_login_wall': taps, 'screens_before_login': screens[:-1], 'automation_seconds': seconds}, report, storage


async def main():
    if not (DIST / 'device/index.html').is_file():
        raise SystemExit('Run pnpm --filter web build:app first')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port, log_level='warning', timeout_graceful_shutdown=1))
    serving = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.05)
    origin = f'http://127.0.0.1:{port}'
    errors = []
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            flow, violations, storage = await first_run(browser, origin)
            for width in (375, 1440):
                for theme in ('light', 'dark'):
                    context = await browser.new_context(locale='ja-JP', viewport={'width': width, 'height': 900},
                                                        color_scheme=theme, bypass_csp=True, storage_state=storage)
                    page = await context.new_page()
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    for name, path in SCREENS.items():
                        await page.goto(origin + path)
                        await page.wait_for_load_state('networkidle')
                        if width == 375 and theme == 'light':
                            violations[name] = await axe(page)
                        await page.screenshot(path=str(OUTPUT / f'{name}-{width}-{theme}.png'), full_page=True, animations='disabled')
                    await context.close()
            await browser.close()
    finally:
        server.should_exit = True
        await serving
    result = {'date': date.today().isoformat(), 'first_run_375': flow,
              'axe_serious_critical': {name: sum(v['nodes'] for v in found) for name, found in violations.items()},
              'axe_details': violations, 'pageerrors': errors}
    (OUTPUT / 'results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: result[k] for k in ('first_run_375', 'axe_serious_critical', 'pageerrors')}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    asyncio.run(main())
