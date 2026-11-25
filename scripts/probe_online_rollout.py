"""Read-only HTTPS checks for the expected Kyalulu rollout wave."""
import argparse
from contextlib import closing
import hashlib
from html.parser import HTMLParser
import http.client
from http.cookies import SimpleCookie
import json
from pathlib import Path
import ssl
from time import monotonic
from urllib.parse import unquote, urlsplit


COOKIE = "__Host-kyalulu-bucket"
BUCKETS = (None, "pilot", "beta", "stable")
PAGES = {"/": "entry", "/chats": "chats", "/discover": "browse", "/profile": "pages",
         "/characters/mocha_sfw": "browse"}
GROUPS = tuple(dict.fromkeys(PAGES.values()))
PROBE_404 = "/__kyalulu_rollout_probe_missing__"
NEXT_STATIC = "/_next/static/"
NODE_STATIC = "online/apps/online/.next/static/"


class ProbeError(ValueError):
    pass


def https_origin(value):
    url = urlsplit(value)
    if (url.scheme != "https" or not url.hostname or url.username is not None or url.password is not None
            or url.path or url.query or url.fragment or value != "https://" + url.netloc):
        raise ProbeError("Use an exact HTTPS origin with no path or credentials")
    return url.netloc


class Document(HTMLParser):
    def __init__(self, body):
        super().__init__()
        self.next = False
        self.scripts = set()
        self.feed(body.decode("utf-8"))

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "html":
            self.next = attrs.get("data-kyalulu-frontend") == "next"
        if tag == "script" and (src := attrs.get("src")) and src.startswith(NEXT_STATIC):
            self.scripts.add(src)


def get(connection, path, bucket=None, limit=8 * 1024 * 1024, accept="*/*"):
    headers = {"Accept": accept, "Accept-Encoding": "identity", "Cache-Control": "no-cache"}
    if bucket is not None:
        headers["Cookie"] = f"{COOKIE}={bucket}"
    start = monotonic()
    connection.request("GET", path, headers=headers)
    with connection.getresponse() as response:
        body = response.read(limit + 1)
        if len(body) > limit:
            raise ProbeError("Probe response exceeded its size limit")
        return response.status, response.headers, body, round((monotonic() - start) * 1000)


def wave_eligible(cohort, bucket):
    return cohort == "all" or bucket == "pilot" or (cohort == "quarter" and bucket == "beta")


def probe(app, hashes, *, cohort, enabled, character_pilot=False, fallback=False, held_chunks=(), source=False, relay=None):
    failures = []
    observed = []
    assets = set()

    def check(ok, label, detail):
        if not ok:
            failures.append({"check": label, "reason": detail})

    def read(connection, path, bucket=None, limit=8 * 1024 * 1024, accept="*/*"):
        status, headers, body, elapsed = get(connection, path, bucket, limit, accept)
        label = f"{path} [{bucket or 'fresh'}]"
        observed.append({"check": label, "status": status, "elapsed_ms": elapsed})
        return status, headers, body, label

    def read_json(connection, path, bucket=None):
        status, headers, body, label = read(connection, path, bucket, accept="application/json")
        try:
            value = json.loads(body)
        except ValueError:
            value = None
        check(status == 200 and isinstance(value, dict), label, "Expected a successful JSON object")
        return headers, value if isinstance(value, dict) else {}, label

    _, health, label = read_json(app, "/api/health")
    check(health.get("status") == "ok", label, "Application health failed")
    if relay is not None:
        _, health, label = read_json(relay, "/healthz")
        check(health.get("status") == "ok", label, "Relay health failed")

    for bucket in BUCKETS:
        eligible = wave_eligible(cohort, bucket)
        headers, status, label = read_json(app, "/api/mobile/status", bucket)
        check(status.get("cloud_mode") is True and status.get("authenticated") is False,
              label, "Expected an anonymous Cloud status")
        check("no-store" in headers.get("Cache-Control", ""), label, "Cloud status was cacheable")
        for group in GROUPS:
            delivered = headers.get(f"X-Kyalulu-Next-{group}")
            expected = "1" if eligible and group in enabled else None
            check(delivered == expected, label, f"Unexpected {group} delivery flag")

        for path, group in (*PAGES.items(), (PROBE_404, None)):
            desired = eligible and (fallback if group is None else group in enabled or
                                    character_pilot and path == "/characters/mocha_sfw")
            code, headers, body, label = read(app, path, bucket, accept="text/html")
            check(code == (404 if group is None else 200), label, "Unexpected page status")
            check(headers.get("Content-Type", "").startswith("text/html"), label, "Expected an HTML document")
            document = Document(body)
            observed[-1]["frontend"] = "next" if document.next else "legacy"
            check(document.next == desired, label, "Frontend differs from the wave settings")
            if desired or cohort != "all":
                check("no-store" in headers.get("Cache-Control", ""), label, "Expected no-store on cohort HTML")
            if path == "/":
                for value in headers.get_all("Set-Cookie", []):
                    cookie = SimpleCookie(value).get(COOKIE)
                    if cookie:
                        break
                else:
                    cookie = None
                enrollment = cohort != "all" and bucket is None
                observed[-1]["enrolled"] = bool(cookie)
                check(bool(cookie) == enrollment, label, "Unexpected cohort enrollment")
                if enrollment and cookie:
                    check(cookie.value in BUCKETS[1:] and bool(cookie["secure"]) and bool(cookie["httponly"])
                          and cookie["path"] == "/" and cookie["samesite"].lower() == "lax", label, "Invalid cohort cookie")
            if desired:
                check(bool(document.scripts), label, "Next HTML had no hydration scripts")
                for src in document.scripts:
                    asset = urlsplit(src).path
                    if NODE_STATIC + unquote(asset).removeprefix(NEXT_STATIC) in hashes:
                        assets.add(asset)
                    else:
                        check(False, label, "Next HTML referenced a script outside the selected build")

    def verify_file(path, member, limit=8 * 1024 * 1024):
        status, _, body, label = read(app, path, limit=limit)
        match = status == 200 and hashlib.sha256(body).hexdigest() == hashes[member]
        observed[-1]["sha256_matches"] = match
        check(match, label, "Bundle file mismatch")

    verify_file("/sw.js", "web/sw.js")
    if source:
        verify_file("/source.tar.gz", "kyalulu-source.tar.gz", 128 * 1024 * 1024)
    for path in sorted(assets | set(held_chunks)):
        verify_file(path, "web" + unquote(urlsplit(path).path))
    return {"ok": not failures, "checks": observed, "failures": failures}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path, help="Extracted verified release or recovery bundle")
    parser.add_argument("--origin", required=True)
    parser.add_argument("--cohort", required=True, choices=("pilot", "quarter", "all"))
    parser.add_argument("--enable", action="append", choices=GROUPS, default=[])
    parser.add_argument("--character-pilot", action="store_true")
    parser.add_argument("--fallback", action="store_true")
    parser.add_argument("--held-chunk", action="append", default=[], help="Retained /_next/static/ URL path to verify")
    parser.add_argument("--check-source", action="store_true")
    parser.add_argument("--check-relay", action="store_true")
    parser.add_argument("--ca-file", type=Path, help="CA for a private HTTPS fixture")
    args = parser.parse_args()
    try:
        target = https_origin(args.origin)
        record = args.bundle / "online-release.json"
        if not record.is_file():
            record = args.bundle / "recovery-release.json"
            if args.enable or args.character_pilot or args.fallback:
                raise ProbeError("The recovery bundle expects every Next page switch off")
        if args.fallback and set(args.enable) != set(GROUPS):
            raise ProbeError("The Next fallback requires all four groups")
        release = json.loads(record.read_text(encoding="utf-8"))
        hashes = {name: digest for digest, name in (line.split("  ", 1) for line in
                  (args.bundle / "SHA256SUMS").read_text(encoding="ascii").splitlines())}
        for path in args.held_chunk:
            url = urlsplit(path)
            if (url.netloc or url.scheme or url.query or url.fragment or not path.startswith(NEXT_STATIC)
                    or "web" + unquote(path) not in hashes):
                raise ProbeError("A held chunk must be an asset in the verified bundle")
        context = ssl.create_default_context(cafile=args.ca_file)
        with closing(http.client.HTTPSConnection(target, context=context, timeout=10)) as app:
            options = dict(cohort=args.cohort, enabled=set(args.enable), character_pilot=args.character_pilot,
                           fallback=args.fallback, held_chunks=args.held_chunk, source=args.check_source)
            if args.check_relay:
                relay_host = https_origin(release["relay_origin"])
                with closing(http.client.HTTPSConnection(relay_host, context=context, timeout=10)) as relay:
                    report = probe(app, hashes, relay=relay, **options)
            else:
                report = probe(app, hashes, **options)
    except ProbeError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1
    except (OSError, http.client.HTTPException, ValueError, KeyError) as exc:
        print(json.dumps({"ok": False, "error": type(exc).__name__}))
        return 1
    print(json.dumps(report, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
