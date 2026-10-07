"""Offline release evidence audit; mocked success never accepts a public launch.

This reports prerequisites. It does not change approval flags, publish, deploy,
or run external acceptance on behalf of the operator.
"""

import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SOURCE_DIRS = ("runtime/python", "apps/web/src", "apps/web/public", "packages/schemas/src",
               "packages/ui/src", "packages/launcher/src", "packages/launcher/bin", "deploy/cloud",
               "characters", "personas", "worlds", "prompts")
SOURCE_FILES = ("uv.lock", "pyproject.toml", "runtime/pyproject.toml", "pnpm-lock.yaml",
                "LICENSE", "package.json", "pnpm-workspace.yaml", "tsconfig.json",
                "apps/web/index.html", "apps/web/package.json", "apps/web/vite.config.ts",
                "apps/web/tsconfig.json", "apps/web/tsconfig.app.json", "apps/web/tsconfig.node.json",
                "packages/schemas/package.json", "packages/schemas/tsconfig.json",
                "packages/ui/package.json", "packages/ui/tsconfig.json", "packages/launcher/package.json",
                "packages/launcher/runtime-manifest.json", "models/example-le.yaml",
                "models/example-lmstudio.yaml", "models/example-ollama.yaml", "models/mock-echo.yaml",
                "scripts/build_local_bundle.py", "scripts/collect_release_sources.py",
                "scripts/prepare_cloud_bundle.py", "scripts/prepare_npm_manifest.mjs")

GATES = {
    "windows_clean": "Windows 11 x64 / Node only: first install, real local model, memory, restart, failed update, restore",
    "mac_clean": "macOS Apple Silicon / Node only: equivalent native acceptance",
    "licenses": "Allowlist, bundled licenses and corresponding source reviewed",
    "npm_permission": "npm package name and publisher permission confirmed",
    "authentication": "Real Supabase Google/email-link, own SMTP, expired/revoked sessions",
    "isolation_sync": "Real hosted account separation, conflicts, deletion, capacity and 250MB/1GB performance",
    "models": "JA/EN 20 turns x3; personality, memory, JSON, SFW images, latency, real billing reconciliation",
    "android": "Physical Android: IME, lock, network switch, reconnect",
    "operations": "24h on target VPS, Relay headroom and restore on another host from offsite backup",
    "legal": "Seller facts, JA/EN privacy/terms, JP/US sales and credit conditions accepted",
    "go_permission": "Written permission covering public noncoding Character AI through Go",
    "go_accounting": "Fixed subscription cost allocation, personal use and 5h/week/month allowance reconciled",
    "stripe_test": "Visible Checkout/Portal Test return, signed replay/order/refund/dispute acceptance",
    "paid_capacity": "Funded 7/30-day retention capacity and financial admission accepted",
    "pilot_72h": "First ten users: onboarding <=10 min and 72h stability observed",
    "openrouter": "Real pinned endpoint, privacy/retention, cost caps and billed-cost acceptance",
}
LOCAL = ("windows_clean", "mac_clean", "licenses", "npm_permission")
CLOUD = ("authentication", "isolation_sync", "models", "android", "operations", "legal", "licenses")
SALES = ("stripe_test", "paid_capacity")


def source_fingerprint(root=ROOT):
    root = root.resolve()
    files = set()
    for name in SOURCE_DIRS:
        directory = root / name
        if directory.exists():
            files.update(p for p in directory.rglob("*") if p.is_file()
                         and "__pycache__" not in p.parts and not p.name.startswith(".env")
                         and p.suffix not in {".pyc", ".db", ".log"})
    files.update(root / name for name in SOURCE_FILES if (root / name).is_file())
    digest = hashlib.sha256()
    for file in sorted(files):
        if not file.resolve().is_relative_to(root) or file.is_symlink():
            raise ValueError("source escaped workspace")
        digest.update(file.relative_to(root).as_posix().encode() + b"\0")
        with file.open("rb") as stream:
            digest.update(hashlib.file_digest(stream, "sha256").digest())
    return digest.hexdigest()


def evidence_status(entry, fingerprint, *, root=ROOT):
    if not isinstance(entry, dict) or entry.get("accepted") is not True:
        return "pending"
    if entry.get("kind") != "real":
        return "mock_or_development_only"
    if entry.get("source_fingerprint") != fingerprint:
        return "stale_source"
    try:
        reference = entry["evidence"]
        expected = entry["sha256"]
        if not isinstance(reference, str) or not isinstance(expected, str):
            return "invalid_evidence"
        path = (root / reference).resolve()
        if not path.is_relative_to(root.resolve()) or path.is_symlink() or not path.is_file():
            return "missing_evidence"
        with path.open("rb") as stream:
            actual = hashlib.file_digest(stream, "sha256").hexdigest()
        return "accepted" if actual == expected else "evidence_hash_mismatch"
    except (KeyError, TypeError, ValueError, OSError):
        return "invalid_evidence"


def audit(evidence=None, *, backend="openrouter", root=ROOT):
    if backend not in {"opencode-go", "openrouter", "deepseek"}:
        raise ValueError("invalid operator backend")
    evidence = evidence or {}
    fingerprint = source_fingerprint(root)
    backend_gates = ("go_permission", "go_accounting") if backend == "opencode-go" else (
        ("openrouter",) if backend == "openrouter" else ())
    applicable = set((*LOCAL, *CLOUD, *SALES, *backend_gates, "pilot_72h"))
    statuses = {key: evidence_status(evidence.get(key), fingerprint, root=root)
                for key in GATES if key in applicable}
    phases = {"local_beta": LOCAL, "cloud_first_ten": (*CLOUD, *backend_gates),
              "sales": (*CLOUD, *backend_gates, *SALES),
              "cloud_first_hundred": (*CLOUD, *backend_gates, "pilot_72h")}
    return {"source_fingerprint": fingerprint, "operator_backend": backend,
            "evidence_basis": "operator-recorded real acceptance; hash and source checked",
            "automatic_external_actions": False,
            "phases": {phase: {"ready": all(statuses[g] == "accepted" for g in gates),
                               "blockers": [g for g in gates if statuses[g] != "accepted"]}
                       for phase, gates in phases.items()},
            "gates": {key: {"status": status, "requirement": GATES[key]} for key, status in statuses.items()}}
