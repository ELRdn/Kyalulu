"""Exact browser origins allowed to access the local API."""
import os


def trusted_origins():
    origins = {f"http://{host}:{port}" for host in ("localhost", "127.0.0.1") for port in (5173, 5174)}
    origins.update(x.strip() for x in os.environ.get("KYALULU_TRUSTED_ORIGINS", "").split(",") if x.strip())
    return origins
