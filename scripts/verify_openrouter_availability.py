"""One bounded diagnostic after repeated 429s; shares the existing paid ledger."""

import argparse
import asyncio
from decimal import Decimal
import json

import httpx
from dotenv import dotenv_values

import verify_openrouter_quality as quality


async def main(args):
    if not args.execute:
        print("No inference. One fixed-route availability diagnostic per affected candidate.")
        return
    key = dotenv_values(quality.ROOT / ".env.cloud-test.local").get("KYALULU_OPENROUTER_API_KEY")
    if not isinstance(key, str) or not key.strip():
        raise ValueError("OpenRouter key missing")
    run = quality.QualityRun(quality.ROOT / ".artifacts/openrouter-quality-2026-10-04", key, Decimal("0.05"),
                             quality.ROOT / ".artifacts/openrouter-live-2026-10-04/evidence.json")
    async def capture(response):
        if response.status_code < 400:
            return
        await response.aread()
        try:
            error = response.json().get("error", {})
            metadata = error.get("metadata") or {}
            safe = {"message": str(error.get("message", "")).replace(key, "[redacted]")[:240],
                    "code": error.get("code") if type(error.get("code")) is int else None,
                    "provider_name": str(metadata.get("provider_name", "")).replace(key, "[redacted]")[:80],
                    "upstream_detail": str(metadata.get("raw", "")).replace(key, "[redacted]")[:500]}
            safe["headers"] = {k: v for k, v in response.headers.items()
                               if k in {"retry-after", "date", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"}}
            run.data["requests"][-1]["http_diagnostic"] = safe
        except (ValueError, TypeError, AttributeError):
            run.data["requests"][-1]["http_diagnostic"] = {"message": "unparseable_upstream_error"}
    async with httpx.AsyncClient(timeout=httpx.Timeout(45, connect=15), follow_redirects=False,
                               event_hooks={"response": [capture]},
                               headers={"Authorization": "Bearer " + key, "User-Agent": "Kyalulu/0.1.0-beta.1"}) as client:
        for profile in (p for p in quality.PROFILES if p[0] in ("ling", "glm")):
            label = "availability-diagnostic:" + profile[0]
            if any(r["label"] == label for r in run.data["requests"]):
                continue
            prior_block = run.data.get("blocked_candidates", {}).pop(profile[0], None)
            record = await quality.request(run, client, profile, label,
                [{"role": "system", "content": quality.POLICY},
                 {"role": "user", "content": '{"text":"A fictional adult librarian reads a book. No harmful content."}'}],
                {"phase": "availability", "candidate": profile[0], "previous_block": prior_block,
                 "cooled_manual_diagnostic": True}, expected={"sfw": True}, max_tokens=1536 if profile[6] else 128)
            print(json.dumps({k: record[k] for k in ("label", "status", "http_diagnostic") if k in record}, ensure_ascii=False))
        run.data["account_after"] = await quality.account(client)
        run.save()
        print(json.dumps(quality.write_reviews(run), ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true")
    asyncio.run(main(parser.parse_args()))
