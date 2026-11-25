"""Check route ownership and access through the staged Next workspace pages."""
import asyncio
from playwright.async_api import expect
from urllib.parse import parse_qs, urlsplit
import httpx


async def check_page_recovery(browser, origin, create_scripts):
    target = origin + "/create?fixture=recovery#details"
    for locale, waiting, failed, reload, home in (
        ("en-US", "Loading page…", "Could not load this page", "Reload page", "Home"),
        ("ja-JP", "ページを読み込んでいます…", "ページを読み込めませんでした", "再読み込み", "ホームへ"),
    ):
        context = await browser.new_context(locale=locale, viewport={"width": 393, "height": 852},
                                            service_workers="block")
        try:
            page = await context.new_page()
            status_requested, release_status = asyncio.Event(), asyncio.Event()
            view_requested, fail_view = asyncio.Event(), asyncio.Event()

            def status(url):
                return urlsplit(url).path == "/api/mobile/status"

            def view_script(url):
                return urlsplit(url).path.removeprefix("/_next/") in create_scripts

            async def hold_status(route):
                status_requested.set()
                await release_status.wait()
                await route.continue_()

            async def interrupt_view(route):
                view_requested.set()
                await fail_view.wait()
                await route.abort("connectionfailed")

            await page.route(status, hold_status)
            await page.route(view_script, interrupt_view)
            response = await page.goto(target, wait_until="domcontentloaded")
            assert response and response.ok
            await asyncio.wait_for(status_requested.wait(), 15)
            loading = page.get_by_role("status").filter(has_text=waiting)
            await expect(loading).to_be_visible()
            await expect(page.locator(".k-connect-screen")).to_have_count(0)
            await expect(page.locator(".k-create")).to_have_count(0)
            release_status.set()
            await asyncio.wait_for(view_requested.wait(), 15)
            await expect(page.locator(".k-shell__main").get_by_role("status").filter(has_text=waiting)).to_be_visible()
            fail_view.set()
            await expect(page.get_by_role("heading", name=failed, exact=True)).to_be_focused()
            await expect(page.get_by_role("link", name=home, exact=True)).to_have_attribute("href", "/")
            await expect(page).to_have_url(target)
            await page.unroute(view_script, interrupt_view)
            await page.unroute(status, hold_status)
            if locale == "en-US":
                await page.get_by_role("button", name=reload, exact=True).click()
                await expect(page.locator(".k-create--guest")).to_be_visible()
                await expect(page).to_have_url(target)
            else:
                await page.keyboard.press("Tab")
                await expect(page.get_by_role("button", name=reload, exact=True)).to_be_focused()
                await page.keyboard.press("Tab")
                await expect(page.get_by_role("link", name=home, exact=True)).to_be_focused()
                await page.keyboard.press("Enter")
                await expect(page).to_have_url(origin + "/")
                await expect(page.get_by_role("heading", name="あなたへのおすすめ", exact=True)).to_be_visible()
        finally:
            release_status.set()
            fail_view.set()
            await context.close()
    print("Verified page loading, failed Create script, keyboard recovery, and same-URL reload in Japanese and English.", flush=True)


async def check_guest_pages(page, origin):
    await page.goto(origin + "/")
    await page.locator('script[src*="/_next/static/"]').first.wait_for(state="attached")
    await expect(page).to_have_url(origin + "/")
    await page.get_by_role("heading", name="あなたへのおすすめ", exact=True).wait_for()
    await page.goto(origin + "/#/discover?q=モカ")
    await page.wait_for_url(lambda url: urlsplit(url).path == "/discover" and "q=" in url, timeout=15000)
    await page.goto(origin + "/login?returnTo=%2Fchats")
    await page.locator(".k-cloud-login").wait_for()
    for path, selector in (("/profile", ".k-me--guest"), ("/create", ".k-create--guest"),
                           ("/profile/legal/terms", ".k-legal"), ("/publications", ".k-cloud-login")):
        response = await page.goto(origin + path)
        assert response and response.ok and "no-store" in response.headers["cache-control"]
        await page.locator(selector).wait_for()
        assert await page.locator('script[src*="/_next/static/"]').count()
    await page.goto(origin + "/discover?q=モカ")
    await page.locator(".k-shell__main").wait_for()
    await page.goto(origin + "/published")
    await page.get_by_role("heading", name="承認済みの作品", exact=True).first.wait_for()
    for path in ("/works/fixture", "/authors/fixture"):
        response = await page.goto(origin + path)
        assert response and response.ok and "no-store" in response.headers["cache-control"]
        await page.get_by_text("提供していません", exact=False).wait_for()


async def check_member_pages(page, origin):
    browse_reads = []
    def observe(request):
        browse_reads.append(urlsplit(request.url).path)
    page.on("request", observe)
    try:
        await page.goto(origin + "/discover?q=モカ")
        await page.locator('main a[href="/characters/mocha_sfw"]').first.wait_for()
        assert "/api/chat/sessions" not in browse_reads
    finally:
        page.remove_listener("request", observe)
    await page.goto(origin + "/profile")
    await page.locator(".k-me-profile__edit").wait_for()
    await page.evaluate("window.nextProfileNavigationFixture = true")
    await page.locator('main a[href="/profile/settings"]').first.click()
    await expect(page).to_have_url(origin + "/profile/settings")
    assert await page.evaluate("window.nextProfileNavigationFixture === true")
    await page.get_by_role("combobox", name="言語", exact=True).select_option("en")
    await page.get_by_role("combobox", name="Language", exact=True).select_option("ja")
    await page.goto(origin + "/profile/settings#help")
    await page.locator('main a[href="/profile/legal/terms"]').first.click()
    await page.locator(".k-legal article, article.k-legal").first.wait_for()
    await page.go_back()
    await expect(page).to_have_url(origin + "/profile/settings#help")
    for path, selector in (("/create", ".k-create"), ("/create/settings", ".k-lab"),
                           ("/profile/saved", "main h1"), ("/profile/credits", "main h1")):
        await page.goto(origin + path)
        await page.locator(selector).first.wait_for()
    await page.goto(origin + "/create?edit=new")
    name = page.get_by_role("textbox", name="名前", exact=True)
    await name.fill("Fixture private character")
    await page.get_by_role("button", name="保存", exact=True).click()
    await page.wait_for_url(lambda url: parse_qs(urlsplit(url).query).get("edit", [""])[0].startswith("lib_"), timeout=15000)
    item = parse_qs(urlsplit(page.url).query)["edit"][0]
    await page.reload()
    await expect(name).to_have_value("Fixture private character")
    response = await page.goto(origin + "/characters/" + item)
    assert response and "Fixture private character" not in await response.text()
    await page.get_by_role("heading", name="Fixture private character", exact=True).wait_for()
    await page.goto(origin + "/publications")
    await page.get_by_role("heading", name="送信した作品").wait_for()
    await page.locator("main select").select_option(item)
    await page.get_by_role("button", name="この版を審査へ", exact=True).click()
    async with page.expect_response(lambda res: urlsplit(res.url).path == "/api/cloud/app/publications" and res.request.method == "POST") as submitted:
        await page.get_by_role("dialog").get_by_role("button", name="審査へ送る", exact=True).click()
    response = await submitted.value
    assert response.ok
    publication = (await response.json())["id"]
    for path in ("/studio", "/status", "/research", "/research/benchmarks"):
        await page.goto(origin + path)
        await page.get_by_role("heading", name="サーバー側で管理する機能です").wait_for()
    assert await page.locator('script[src*="/_next/static/"]').count()
    return item, publication


async def check_publication_visibility(page, origin, ca, publication, *, visible):
    async with httpx.AsyncClient(base_url=origin, verify=str(ca), trust_env=False,
                                 headers={"Accept": "text/html", "User-Agent": "Twitterbot/1.0"}) as reader:
        detail = await reader.get("/published/" + publication)
        catalog = await reader.get("/published")
        assert "no-store" in detail.headers["cache-control"] and "no-store" in catalog.headers["cache-control"]
        assert detail.status_code == catalog.status_code == 200
        assert "Fixture private character" not in catalog.text + detail.text
        assert 'property="og:title" content="公開作品 | Kyalulu"' in detail.text
        raw = await reader.get("/api/cloud/app/works/" + publication)
        assert raw.status_code == 403 and raw.json()["code"] == "eligibility_confirmation_required"
    await page.goto(origin + "/published/" + publication)
    heading = page.get_by_role("heading", name="Fixture private character", exact=True)
    if visible:
        await heading.wait_for()
    else:
        await page.locator("main").get_by_role("alert").wait_for()
        await expect(heading).to_have_count(0)
