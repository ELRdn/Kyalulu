"""Local operator CLI. Run from the repository; no inference dependencies."""

import argparse
import json
import os
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def backup(source: Path, destination: Path):
    """SQLite's snapshot API includes committed WAL data. Never overwrite a backup."""
    if not source.is_file():
        raise ValueError("source database does not exist")
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive create prevents accidentally clobbering a live DB or old backup.
    descriptor = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(descriptor)
    try:
        with (
            closing(
                sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True)
            ) as src,
            closing(sqlite3.connect(destination)) as dst,
        ):
            src.backup(dst)
            if dst.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("integrity check failed")
            tables = {
                r[0]
                for r in dst.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                )
            }
            if not {"owners", "devices", "tickets"} <= tables:
                raise ValueError("not a Relay database")
    except BaseException:
        destination.unlink(missing_ok=True)
        raise


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=os.environ.get("RELAY_DB", "relay.sqlite3"))
    commands = parser.add_subparsers(dest="command", required=True)
    serve = commands.add_parser("serve")
    serve.add_argument("--bind", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8787)
    invitation = commands.add_parser("invite")
    invitation.add_argument("--ttl", type=int, default=300)
    invitation.add_argument("--owner")
    snapshot = commands.add_parser("backup")
    snapshot.add_argument("destination", type=Path)
    restore = commands.add_parser("restore")
    restore.add_argument("source", type=Path)
    restore.add_argument(
        "--offline",
        action="store_true",
        required=True,
        help="acknowledge service is stopped; destination must not exist",
    )
    args = parser.parse_args()
    try:
        if args.command == "backup":
            backup(Path(args.db), args.destination)
        elif args.command == "restore":
            backup(args.source, Path(args.db))
        elif args.command == "invite":
            from runtime.python.relay.store import Store

            print(json.dumps({"invite": Store(args.db).invite(args.ttl, args.owner)}))
        else:
            import uvicorn

            from runtime.python.relay.app import create_app

            # One process owns all sessions and limits. Never enable workers/reload.
            uvicorn.run(
                create_app(args.db),
                host=args.bind,
                port=args.port,
                workers=1,
                access_log=False,
                proxy_headers=False,
                server_header=False,
                ws="websockets",
                ws_max_size=65552,
                ws_max_queue=32,
                ws_per_message_deflate=False,
                limit_concurrency=160,
                timeout_keep_alive=5,
                timeout_graceful_shutdown=10,
                log_level="critical",
            )
    except (ValueError, OSError, sqlite3.Error):
        parser.exit(1, "Relay operation failed; check paths, database and limits.\n")


if __name__ == "__main__":
    main()
