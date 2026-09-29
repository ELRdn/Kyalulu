import os

import pytest
from python.remote.vault import Vault


def test_vault_roundtrip_and_replace(tmp_path):
    vault = Vault(tmp_path / "host.vault")
    vault.write({"private": "test-secret-not-a-real-key", "devices": {}})
    assert vault.read()["private"] == "test-secret-not-a-real-key"
    if os.name == "nt":
        assert b"test-secret-not-a-real-key" not in vault.path.read_bytes()
    else:
        assert vault.path.stat().st_mode & 0o077 == 0
    vault.write({"devices": {"revoked": True}})
    assert vault.read() == {"devices": {"revoked": True}}
    assert len(list(tmp_path.iterdir())) == 1


def test_reject_unprotected_secrets(tmp_path):
    vault = Vault(tmp_path / "host.vault")
    vault.path.write_text('{"private":"unprotected"}')
    with pytest.raises(ValueError):
        vault.read()
