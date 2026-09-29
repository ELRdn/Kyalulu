"""Run a single-worker HTTPS PWA server, or manage pairing from this machine.

See scripts/HOME_SERVER.md. Does not build the frontend or generate certificates.
"""

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "runtime"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    serve = sub.add_parser("serve")
    serve.add_argument("--origin", required=True, help="Exact public HTTPS origin")
    serve.add_argument("--cert", required=True, type=Path)
    serve.add_argument("--key", required=True, type=Path)
    serve.add_argument("--dist", type=Path, default=ROOT / "apps/web/dist")
    serve.add_argument("--host", default="0.0.0.0")
    serve.add_argument("--port", type=int, default=8000)
    for action in ("code", "devices", "revoke"):
        admin = sub.add_parser(action)
        admin.add_argument("--url", default="https://localhost:8000")
        admin.add_argument(
            "--tls-name",
            help="Public DNS name for TLS SNI and certificate validation; HTTP Host stays loopback",
        )
        admin.add_argument(
            "--ca", type=Path, help="CA certificate PEM for local TLS verification"
        )
        if action == "revoke":
            admin.add_argument("device_id")
    args = parser.parse_args()
    if args.command == "serve":
        for file in (args.cert, args.key):
            if not file.is_file():
                parser.error(f"Missing TLS file: {file}")
        os.environ.update(
            KYALULU_REMOTE_MODE="1",
            KYALULU_PUBLIC_ORIGIN=args.origin,
            KYALULU_WEB_DIST=str(args.dist.resolve()),
        )
        from python.api.mobile import Config

        Config.from_env()  # validate before opening a listener
        import uvicorn

        uvicorn.run(
            "python.api.main:app",
            host=args.host,
            port=args.port,
            workers=1,
            proxy_headers=False,
            ssl_certfile=str(args.cert),
            ssl_keyfile=str(args.key),
        )
        return
    parsed = urlsplit(args.url)
    if (
        parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
        or parsed.scheme not in {"http", "https"}
        or parsed.username
        or parsed.password
        or parsed.path
        or parsed.query
        or parsed.fragment
    ):
        parser.error("Administration requires an exact loopback URL")
    if args.tls_name:
        import re

        if parsed.scheme != "https" or not re.fullmatch(
            r"[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?", args.tls_name
        ):
            parser.error(
                "--tls-name requires HTTPS and a DNS hostname without port/path"
            )
    extensions = {"sni_hostname": args.tls_name} if args.tls_name else {}
    import ssl

    import httpx

    verify = ssl.create_default_context(cafile=str(args.ca)) if args.ca else True
    with httpx.Client(
        base_url=args.url, verify=verify, trust_env=False, timeout=10
    ) as client:
        if args.command == "code":
            response = client.post("/api/mobile/admin/code", extensions=extensions)
        elif args.command == "devices":
            response = client.get("/api/mobile/admin/devices", extensions=extensions)
        else:
            from urllib.parse import quote

            response = client.delete(
                "/api/mobile/admin/devices/" + quote(args.device_id, safe=""),
                extensions=extensions,
            )
        response.raise_for_status()
        print(
            json.dumps(response.json(), ensure_ascii=False, indent=2)
            if response.content
            else "Revoked"
        )


if __name__ == "__main__":
    main()
