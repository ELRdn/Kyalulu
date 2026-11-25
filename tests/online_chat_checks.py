"""Browser checks on one disposable authenticated Next chat."""
import asyncio
from urllib.parse import urlsplit

from playwright.async_api import expect


CHUNK_RETRY_DRAFT = "fixture draft retained after script failure"


async def check_opening_proxy_fallback(browser, origin, entry, cookie):
    context = await browser.new_context(locale="en-US", service_workers="block")
    try:
        await context.add_cookies([cookie])
        page = await context.new_page()
        await page.goto(origin + entry)
        draft = "fixture draft after the delivery signal disappears"
        await page.get_by_role("textbox", name="First message").fill(draft)
        requests = []
        saved_sessions = []
        page.on("request", lambda request: requests.append(request))

        async def drop_delivery_signal(route):
            response = await route.fetch()
            assert response.status == 201
            assert response.headers["x-kyalulu-next-opening"] == "1"
            headers = {key: value for key, value in response.headers.items() if key != "x-kyalulu-next-opening"}
            saved_sessions.append(route.request.post_data_json["session_id"])
            await route.fulfill(response=response, headers=headers)

        await page.route("**/api/chat/settings/opening", drop_delivery_signal)
        await page.get_by_role("button", name="Start conversation").click()
        await page.wait_for_url("**/chats/chat_*")
        textarea = page.locator(".k-composer textarea")
        await expect(textarea).to_be_editable()
        await expect(textarea).to_have_value(draft)
        [session] = saved_sessions
        assert page.url == origin + "/chats/" + session
        paths = [urlsplit(request.url).path for request in requests]
        assert paths.index("/api/chat/settings/opening") < paths.index("/api/mobile/status")
        assert "/api/cloud/quotes" not in paths and "/api/chat/stream" not in paths and "/api/chat" not in paths
        assert any(path == "/chats/" + session and request.is_navigation_request()
                   for path, request in zip(paths, requests, strict=True))
        print("Verified a committed opening remains an editable draft when its delivery signal disappears.", flush=True)
    finally:
        await context.close()


async def check_chat_chunk_recovery(browser, origin, entry, cookies, chat_scripts):
    context = await browser.new_context(locale="en-US", viewport={"width": 393, "height": 852}, service_workers="block")
    try:
        await context.add_cookies(cookies)
        page = await context.new_page()
        requested, fail_script = asyncio.Event(), asyncio.Event()
        sent, quotes = [], []

        def watch(request):
            if request.method != "POST":
                return
            path = urlsplit(request.url).path
            if path == "/api/cloud/quotes":
                quotes.append(request)
            if path in ("/api/chat", "/api/chat/stream"):
                sent.append(request)

        def chat_chunk(url):
            return urlsplit(url).path.removeprefix("/_next/") in chat_scripts

        async def interrupt(route):
            requested.set()
            await fail_script.wait()
            await route.abort("connectionfailed")

        page.on("request", watch)
        await page.route(chat_chunk, interrupt)
        await page.goto(origin + entry)
        await page.get_by_role("textbox", name="First message").fill(CHUNK_RETRY_DRAFT)
        await page.get_by_role("button", name="Start conversation").click()
        await asyncio.wait_for(requested.wait(), 15)
        await page.wait_for_url("**/chats/chat_*")
        session_url = page.url
        loading = page.locator(".k-shell__main").get_by_role("status").filter(has_text="Loading chat…")
        await expect(loading).to_be_visible()
        assert not sent and not quotes
        fail_script.set()
        heading = page.get_by_role("heading", name="Could not open this chat")
        await expect(heading).to_be_focused()
        assert not sent and not quotes
        await page.unroute(chat_chunk, interrupt)
        await page.get_by_role("button", name="Reload chat").click()
        composer = page.locator(".k-composer textarea")
        await expect(composer).to_be_editable()
        await expect(composer).to_have_value(CHUNK_RETRY_DRAFT)
        assert page.url == session_url and not sent and not quotes
        await page.locator(".k-composer__send").click()
        history = page.locator(".k-chat-messages")
        await expect(history.get_by_text("hello", exact=True)).to_have_count(1)
        await expect(history.get_by_text(CHUNK_RETRY_DRAFT, exact=True)).to_have_count(1)
        assert len(sent) == len(quotes) == 1
        await page.reload()
        await expect(history.get_by_text("hello", exact=True)).to_have_count(1)
        assert len(sent) == len(quotes) == 1
        print("Verified chat loading, failed script recovery and one explicit send of the recovered draft.", flush=True)
    finally:
        await context.close()


async def check_chat(page, origin):
    original = page.url
    session = urlsplit(original).path.rsplit("/", 1)[1]
    composer = page.locator(".k-composer textarea")
    send = page.locator(".k-composer__send")
    messages = page.locator(".k-chat-messages")
    viewport = page.viewport_size
    await page.set_viewport_size({"width": 393, "height": 852})
    try:
        await composer.focus()
        await page.keyboard.press("Control+k")
        search = page.get_by_role("dialog", name="検索とコマンド")
        await expect(search.get_by_role("combobox", name="検索")).to_be_focused()
        await page.keyboard.press("Escape")
        await expect(search).to_be_hidden()
        await expect(composer).to_be_focused()
        await expect(page.locator(".k-portable-session")).to_have_count(0)
        await expect(page.locator(".k-session-policy")).to_have_count(0)
        await page.get_by_role("button", name="会話設定", exact=True).click()
        policy = page.get_by_role("dialog", name="会話の情報").locator(".k-session-policy")
        await expect(policy.get_by_text("保存先", exact=True)).to_be_visible()
        await expect(policy.get_by_text("クラウド", exact=True)).to_be_visible()
        async with page.expect_response(lambda res: urlsplit(res.url).path == "/api/library") as library:
            await page.get_by_role("button", name="キャラ・プリセット", exact=True).click()
        assert (await library.value).ok
        presets = page.get_by_role("dialog", name="キャラ・プリセット", exact=True)
        await expect(presets.get_by_role("heading", name="プリセット", exact=True)).to_be_visible()
        await page.keyboard.press("Escape")
        await expect(presets).to_be_hidden()
    finally:
        if viewport:
            await page.set_viewport_size(viewport)

    # Exercise the consent UI for a synthetic training-enabled quote without accepting any provider terms.
    async def require_consent(route):
        response = await route.fetch()
        quote = await response.json()
        quote["route"]["training_consent_required"] = True
        await route.fulfill(json=quote)

    def quote_url(url):
        return urlsplit(url).path == "/api/cloud/quotes"

    await page.route(quote_url, require_consent)
    try:
        await composer.fill("fixture cancelled quote")
        await send.click()
        quote = page.locator(".k-quote")
        await expect(quote.get_by_role("button", name="送信する")).to_be_disabled()
        await quote.get_by_role("checkbox").check()
        await expect(quote.get_by_role("button", name="送信する")).to_be_enabled()
        await quote.get_by_role("button", name="キャンセル").click()
        await expect(composer).to_have_value("fixture cancelled quote")
    finally:
        await page.unroute(quote_url, require_consent)
    print("Chat consent cancelled; draft retained.", flush=True)
    await composer.fill("fixture recovery turn")
    await page.reload()
    await expect(composer, "An unsent draft must survive a hard refresh").to_have_value("fixture recovery turn")

    attempts = []
    received = asyncio.Event()

    async def interrupt(route):
        attempts.append(route.request.post_data_json["generation_id"])
        if len(attempts) == 2:
            # Forward the original request once and discard the completed SSE response.
            response = await route.fetch(max_retries=0)
            assert response.ok
            assert b"event: done" in await response.body()
        await route.abort("connectionfailed")
        received.set()

    pattern = "**/api/chat/stream"
    await page.route(pattern, interrupt)
    try:
        await send.click()
        await asyncio.wait_for(received.wait(), 15)
        await page.reload()
        await page.get_by_role("button", name="停止して確認").click()
        await expect(composer, "Cancelling a missing generation must recover its submitted draft").to_have_value("fixture recovery turn")
        status_url = origin + "/api/chat/generations/" + attempts[0] + "?session_id=" + session
        assert (await page.evaluate("async url => (await fetch(url)).json()", status_url))["status"] == "cancelled"
        received.clear()
        await send.click()
        await asyncio.wait_for(received.wait(), 15)
        await page.reload()
        await expect(messages.get_by_text("fixture recovery turn", exact=True)).to_have_count(1)
        await expect(messages.get_by_text("hello", exact=True)).to_have_count(2)
        await expect(composer).to_have_value("")
        assert len(set(attempts)) == len(attempts) == 2
        status_url = origin + "/api/chat/generations/" + attempts[1] + "?session_id=" + session
        result = await page.evaluate("async url => (await fetch(url)).json()", status_url)
        assert result["status"] == "completed" and result["user_id"] and result["assistant_id"]
    finally:
        await page.unroute(pattern, interrupt)
    print("Recovered before and after commit by generation ID.", flush=True)

    async def action(name):
        await messages.get_by_role("button", name="メッセージの操作").last.click()
        await page.get_by_role("menuitem", name=name, exact=False).click()

    async with page.expect_request(lambda request: urlsplit(request.url).path == "/api/chat/stream") as regenerated:
        await action("別の返事")
    generation_id = (await regenerated.value).post_data_json["generation_id"]
    url = origin + "/api/chat/generations/" + generation_id + "?session_id=" + session
    async with asyncio.timeout(15):
        while True:
            state = await page.evaluate("async url => (await fetch(url)).json()", url)
            if state["status"] not in ("not_found", "pending"):
                assert state["status"] == "completed" and state["assistant_id"]
                break
            await asyncio.sleep(.1)
    print("Verified the regenerated reply at the runtime.", flush=True)
    await expect(messages.get_by_text("hello", exact=True)).to_have_count(2)
    await action("ここから分岐")
    await page.get_by_role("button", name="分岐を作る", exact=True).click()
    await page.wait_for_url(lambda url: urlsplit(url).path.startswith("/chats/") and url != original)
    branch = page.url
    await expect(messages.get_by_text("fixture recovery turn", exact=True)).to_have_count(1)
    await action("削除")
    await page.get_by_role("dialog").get_by_role("button", name="削除する").click()
    await expect(messages.get_by_text("hello", exact=True)).to_have_count(1)
    await page.goto(original)
    await expect(messages.get_by_text("hello", exact=True)).to_have_count(2)
    await page.goto(origin + "/chats")
    await page.evaluate("window.nextChatNavigationFixture = true")
    await page.locator('.k-session-row__link[href="' + urlsplit(original).path + '"]').first.click()
    await expect(messages.get_by_text("fixture recovery turn", exact=True)).to_have_count(1)
    assert await page.evaluate("window.nextChatNavigationFixture === true")
    return session, urlsplit(branch).path.rsplit("/", 1)[1]
