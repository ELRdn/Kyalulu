"""Register or run a dedicated, outbound-only Relay Host (one Runtime lifespan).

register --relay HTTPS_ORIGIN --app-origin HTTPS_ORIGIN --invite
         --vault PATH --data-dir NEW_DIRECTORY
serve --vault PATH --data-dir DIRECTORY [--port 8766]
autostart --enable-autostart --vault PATH --data-dir DIRECTORY [--port 8766]

Invitations are entered through getpass, never command-line values. Autostart is
an explicit Windows Task Scheduler opt-in and does not start the task immediately.
The data directory is dedicated to this Host. Do not point another runtime at it.
Existing databases require register --adopt-existing-data, after stopping ALL
Runtime processes. A verified SQLite backup is created before registration.
Process scanning catches known legacy launchers; it is not proof that arbitrary
older/custom writers are absent. Stop those yourself before explicit adoption.
"""

import argparse
import asyncio
import getpass
import json
import os
import subprocess
import sys
from contextlib import asynccontextmanager, closing
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "runtime"))


from python.storage.runtime_lock import LOCK_FILENAME, RuntimeLock


def validate_directory(directory, host_id=None):
    directory = Path(directory).resolve()
    marker = directory / ".remote-host-owner"
    if host_id is None:
        if any(p.name != LOCK_FILENAME for p in directory.iterdir()):
            raise ValueError("registration_requires_empty_data_directory")
    elif not marker.is_file() or marker.read_text(encoding="ascii").strip() != host_id:
        raise ValueError("data_directory_not_owned_by_host")


def refuse_legacy_runtime():
    """Conservative check for known launchers; never print process command lines."""
    import psutil

    for process in psutil.process_iter(["pid", "name", "cmdline"]):
        info = process.info
        if info["pid"] == os.getpid():
            continue
        name = (info.get("name") or "").lower()
        command = info.get("cmdline")
        if command is None:
            if name.startswith(("python", "uvicorn")):
                raise ValueError("cannot_verify_runtime_stopped")
            continue
        joined = " ".join(command).replace("\\", "/").lower()
        if (
            "python.api.main" in joined
            or ("home_server.py" in joined and "serve" in command)
            or ("remote_host.py" in joined and "serve" in command)
        ):
            raise ValueError("stop_existing_runtime_before_adoption")


def prepare_directory(directory, adopt):
    """Caller holds RuntimeLock. Never move/edit the source DB to adopt it."""
    directory = Path(directory).resolve()
    if not adopt:
        validate_directory(directory)
        return None
    if (directory / ".remote-host-owner").exists():
        raise ValueError("data_directory_already_registered")
    source = directory / "data.db"
    if not source.is_file() or source.is_symlink():
        raise ValueError("existing_database_required")
    refuse_legacy_runtime()
    import sqlite3
    import tempfile
    import time

    fd, filename = tempfile.mkstemp(
        prefix="remote-adoption-", suffix=".sqlite3", dir=directory
    )
    os.close(fd)
    backup = Path(filename)
    started = time.monotonic()

    def progress(_status, _remaining, _total):
        if time.monotonic() - started > 30:
            raise ValueError("database_backup_timeout")

    try:
        # SQLite backup API includes committed WAL content and gives one snapshot.
        with (
            closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)) as src,
            closing(sqlite3.connect(backup)) as dst,
        ):
            src.backup(dst, pages=256, progress=progress)
            if dst.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                raise ValueError("database_backup_verification_failed")
        with backup.open("r+b") as stream:
            os.fsync(stream.fileno())
    except (sqlite3.Error, OSError, ValueError):
        # Only remove this newly-created incomplete backup, never source files.
        backup.unlink(missing_ok=True)
        raise ValueError("database_backup_failed") from None
    return backup


async def register(args, invite):
    import httpx
    from python.remote.crypto import generate_keypair
    from python.remote.host import exact_origin, uuid
    from python.remote.vault import Vault

    relay, app_origin = exact_origin(args.relay), exact_origin(args.app_origin)
    if args.vault.exists():
        raise ValueError("vault_already_exists")
    with RuntimeLock(args.data_dir):
        backup = prepare_directory(
            args.data_dir, getattr(args, "adopt_existing_data", False)
        )
        async with httpx.AsyncClient(
            timeout=10, trust_env=False, follow_redirects=False
        ) as client:
            response = await client.post(
                relay + "/v1/invitations/redeem",
                json={
                    "invite": invite,
                    "name": args.name,
                },
            )
        if response.status_code != 200:
            raise ValueError("registration_failed")
        result = response.json()
        owner_id, host_id = uuid(result["owner_id"]), uuid(result["host_id"])
        private, public = generate_keypair()
        Vault(args.vault).write(
            {
                "version": 1,
                "relay": relay,
                "app_origin": app_origin,
                "owner_id": owner_id,
                "host_id": host_id,
                "host_token": result["host_token"],
                "private_key": private.hex(),
                "public_key": public.hex(),
                "data_dir": str(args.data_dir.resolve()),
                "devices": {},
                "pairings": {},
            }
        )
        (args.data_dir / ".remote-host-owner").write_text(host_id, encoding="ascii")
    result = {"registered": True, "host_id": host_id}
    if backup is not None:
        result["backup"] = str(backup)
    return result


def load_config(args):
    from python.remote.vault import Vault

    vault = Vault(args.vault)
    config = vault.read()
    if Path(config["data_dir"]).resolve() != args.data_dir.resolve():
        raise ValueError("data_directory_mismatch")
    validate_directory(args.data_dir, config["host_id"])
    return vault


def serve(args):
    # Set before importing Runtime modules that capture DB_PATH at import time.
    vault = load_config(args)
    os.environ["KYALULU_DATA_DIR"] = str(args.data_dir.resolve())
    os.environ["KYALULU_REMOTE_MODE"] = "0"
    os.environ.pop("KYALULU_WEB_DIST", None)
    import uvicorn
    from python.api.main import app
    from python.remote.host import HostService

    service = HostService(app, vault)
    app.state.remote_host = service
    original = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(application):
        async with original(application):
            await service.start()
            try:
                yield
            finally:
                await service.stop()

    app.router.lifespan_context = lifespan
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=args.port,
        workers=1,
        proxy_headers=False,
        access_log=False,
    )


def install_autostart(args):
    if os.name != "nt":
        raise ValueError("autostart_requires_windows")
    load_config(args)
    executable = Path(sys.executable).with_name("pythonw.exe")
    if not executable.is_file():
        raise ValueError("pythonw_not_found")
    command = subprocess.list2cmdline(
        [
            str(Path(__file__).resolve()),
            "serve",
            "--vault",
            str(args.vault.resolve()),
            "--data-dir",
            str(args.data_dir.resolve()),
            "--port",
            str(args.port),
        ]
    )

    def ps(value):
        return "'" + str(value).replace("'", "''") + "'"

    # Interactive logon runs under this user's DPAPI identity, with pythonw hidden.
    # No -Force: never replace an existing task implicitly. No immediate Run call.
    import hashlib

    name = (
        "KyaluluRemoteHost-"
        + hashlib.sha256(str(args.vault.resolve()).encode()).hexdigest()[:12]
    )
    script = (
        "$ErrorActionPreference='Stop'\n"
        f"$action=New-ScheduledTaskAction -Execute {ps(executable)} -Argument {ps(command)}\n"
        "$identity=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name\n"
        "$trigger=New-ScheduledTaskTrigger -AtLogOn -User $identity\n"
        "$principal=New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited\n"
        "$settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) "
        "-MultipleInstances IgnoreNew -StartWhenAvailable\n"
        f"Register-ScheduledTask -TaskName {ps(name)} -Action $action -Trigger $trigger "
        "-Principal $principal -Settings $settings | Out-Null\n"
    )
    import base64

    encoded = base64.b64encode(script.encode("utf-16-le")).decode()
    result = subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
        capture_output=True,
        creationflags=subprocess.CREATE_NO_WINDOW,
        check=False,
    )
    if result.returncode:
        raise ValueError("autostart_registration_failed")
    return {"autostart": True, "task": name}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    registration = sub.add_parser("register")
    registration.add_argument("--relay", required=True)
    registration.add_argument("--app-origin", required=True)
    registration.add_argument(
        "--invite",
        action="store_true",
        required=True,
        help="Prompt securely for the invitation",
    )
    registration.add_argument("--name", default="Kyalulu Host")
    registration.add_argument(
        "--adopt-existing-data",
        action="store_true",
        help="After stopping ALL runtimes: back up and retain existing data.db in place",
    )
    serving = sub.add_parser("serve")
    autostart = sub.add_parser("autostart")
    autostart.add_argument("--enable-autostart", action="store_true", required=True)
    for command in (registration, serving, autostart):
        command.add_argument("--vault", required=True, type=Path)
        command.add_argument("--data-dir", required=True, type=Path)
    for command in (serving, autostart):
        command.add_argument("--port", type=int, default=8766)
    args = parser.parse_args(argv)
    if hasattr(args, "port") and not 1 <= args.port <= 65535:
        parser.error("invalid_port")
    try:
        if args.command == "register":
            if not sys.stdin.isatty():
                parser.error("registration_requires_interactive_terminal")
            result = asyncio.run(register(args, getpass.getpass("Relay invitation: ")))
        elif args.command == "serve":
            serve(args)
            return
        else:
            result = install_autostart(args)
        print(json.dumps(result))
    except Exception:  # noqa: BLE001 -- never expose credential-bearing HTTP exceptions
        # HTTP/OS exceptions can contain tokens/paths; no default traceback.
        print(
            "Remote Host operation failed. Check configuration and local status.",
            file=sys.stderr,
        )
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
