"""Cold mobile browser baseline against a built unified app and a disposable Cloud."""
import argparse
import asyncio
from contextlib import asynccontextmanager
import hashlib
import json
from pathlib import Path
import socket
import sys
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit

import httpx
from playwright.async_api import async_playwright
from starlette.middleware.gzip import GZipMiddleware
import uvicorn

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "runtime"))
from python.cloud.app import create_app
from python.cloud.config import CloudConfig

PATH = "/characters/mocha_sfw"
NAME = "モカちゃん（日常）"
DESCRIPTION = "猫の獣人のお姉さん"


@asynccontextmanager
async def fixture(dist, public_origin=None, app_factory=None):
    def reject_provider(_request):
        raise AssertionError("Unexpected external provider call")

    with TemporaryDirectory() as directory, socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
        config = CloudConfig(root=Path(directory), secret="fixture-secret-" * 3,
                             origin=public_origin or f"https://127.0.0.1:{port}", unified_enabled=True, web_dist=dist)
        app = app_factory(config) if app_factory else create_app(config, transport=httpx.MockTransport(reject_provider))
        server = uvicorn.Server(uvicorn.Config(GZipMiddleware(app), access_log=False,
                                                log_level="error", timeout_graceful_shutdown=2))
        task = asyncio.create_task(server.serve(sockets=[listener]))
        try:
            while not server.started:
                if task.done():
                    await task
                    raise RuntimeError("Fixture exited before startup")
                await asyncio.sleep(.02)
            yield f"http://127.0.0.1:{port}"
        finally:
            server.should_exit = True
            await task


async def sample(browser, origin, entry):
    context = await browser.new_context(locale="ja-JP", viewport={"width": 393, "height": 852},
                                        is_mobile=True, device_scale_factor=2, service_workers="block")
    try:
        async def guard(route):
            if urlsplit(route.request.url).netloc == urlsplit(origin).netloc:
                await route.continue_()
            else:
                await route.abort()

        await context.route("**/*", guard)
        page = await context.new_page()
        session = await context.new_cdp_session(page)
        await session.send("Network.enable")
        await session.send("Network.emulateNetworkConditions", {
            "offline": False, "latency": 80, "downloadThroughput": 2_000_000 / 8,
            "uploadThroughput": 750_000 / 8,
        })
        await page.add_init_script("""new PerformanceObserver(list => {
          window.lastLcp = list.getEntries().at(-1).startTime;
        }).observe({type: 'largest-contentful-paint', buffered: true});
        function observeFrame() {
          const heading = document.querySelector('h1');
          if (!window.readable && heading?.textContent.includes('モカちゃん') &&
              heading.getBoundingClientRect().height > 0) window.readable = performance.now();
          const input = document.querySelector('input[aria-label="最初のメッセージ"]');
          if (input && !input.disabled && input.getBoundingClientRect().height > 0) {
            window.inputReady = performance.now();
          } else requestAnimationFrame(observeFrame);
        }
        requestAnimationFrame(observeFrame);""")
        response = await page.goto(origin + entry)
        assert response and response.status == 200
        await page.get_by_role("textbox", name="最初のメッセージ").wait_for()
        async with asyncio.timeout(10):
            while not await page.evaluate("window.inputReady > 0 && window.readable > 0"):
                await asyncio.sleep(.02)
        await page.get_by_role("textbox", name="最初のメッセージ").fill("お待たせ")
        metrics = await page.evaluate("""() => {
          const resources = performance.getEntriesByType('resource')
            .filter(r => r.startTime <= window.inputReady);
          return {readable_frame_ms: Math.round(window.readable),
            input_ready_ms: Math.round(window.inputReady), lcp_ms: Math.round(window.lastLcp),
            initial_script_transfer_bytes: resources.filter(r => new URL(r.name).pathname.endsWith('.js'))
              .reduce((sum, r) => sum + r.transferSize, 0),
            api_reads: resources.filter(r => new URL(r.name).pathname.startsWith('/api/')).length};
        }""")
        await page.get_by_role("button", name="会話をはじめる").click()
        await page.locator(".k-cloud-login").wait_for()
        metrics["login_draft_matches"] = await page.evaluate(
            """JSON.parse(sessionStorage.getItem('kyalulu-pending-start') || '{}').text === 'お待たせ'""")
        assert metrics["login_draft_matches"]
        return metrics
    finally:
        await context.close()


async def run(dist, samples):
    async with fixture(dist) as origin, async_playwright() as pw:
        browser = await pw.chromium.launch()
        try:
            context = await browser.new_context(java_script_enabled=False)
            page = await context.new_page()
            response = await page.goto(origin + PATH)
            assert response
            has_intro = bool(await page.get_by_role("heading", name=NAME).count()
                             and await page.get_by_text(DESCRIPTION, exact=False).count())
            direct_status = response.status
            await context.close()
            entry = PATH if direct_status == 200 else "/#" + PATH
            return {"browser": browser.version, "character": PATH, "no_js_intro": has_intro,
                    "direct_status": direct_status, "interactive_entry": entry,
                    "shell_sha256": hashlib.sha256((dist / "index.html").read_bytes()).hexdigest(),
                    "samples": [await sample(browser, origin, entry) for _ in range(samples)]}
        finally:
            await browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("dist", type=Path)
    parser.add_argument("--samples", default=3, type=int)
    args = parser.parse_args()
    print(json.dumps(asyncio.run(run(args.dist.resolve(), args.samples)), indent=2))
