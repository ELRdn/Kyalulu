"""Local Host secrets. Windows DPAPI current-user scope; POSIX owner-only files.

No key material is returned by the management API or written to logs.
"""

import ctypes
import json
import os
import tempfile
from pathlib import Path


def _dpapi(data: bytes, decrypt: bool = False) -> bytes:
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]

    buffer = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
    source, target = Blob(len(data), buffer), Blob()
    crypt = ctypes.WinDLL("crypt32", use_last_error=True)
    crypt.CryptProtectData.argtypes = [
        ctypes.POINTER(Blob),
        wintypes.LPCWSTR,
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(Blob),
    ]
    crypt.CryptUnprotectData.argtypes = [
        ctypes.POINTER(Blob),
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(Blob),
    ]
    crypt.CryptProtectData.restype = crypt.CryptUnprotectData.restype = wintypes.BOOL
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    if decrypt:
        ok = crypt.CryptUnprotectData(
            ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)
        )
    else:
        ok = crypt.CryptProtectData(
            ctypes.byref(source), "Kyalulu Remote", None, None, None, 1, ctypes.byref(target)
        )
    if not ok:
        raise OSError(ctypes.get_last_error(), "Host secret protection failed")
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        kernel.LocalFree(target.data)


class Vault:
    def __init__(self, path: Path):
        self.path = path

    def read(self) -> dict:
        raw = self.path.read_bytes()
        if raw.startswith(b"DPAPI1\n"):
            if os.name != "nt":
                raise ValueError("This Host vault belongs to a Windows account")
            raw = _dpapi(raw[7:], decrypt=True)
        elif raw.startswith(b"POSIX1\n") and os.name != "nt":
            if self.path.stat().st_mode & 0o077:
                raise PermissionError("Host vault must have mode 0600")
            raw = raw[7:]
        else:
            raise ValueError("Unsupported Host vault")
        return json.loads(raw)

    def write(self, value: dict):
        raw = json.dumps(value, ensure_ascii=False).encode()
        raw = b"DPAPI1\n" + _dpapi(raw) if os.name == "nt" else b"POSIX1\n" + raw
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd, temporary = tempfile.mkstemp(prefix=".vault-", dir=self.path.parent)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
