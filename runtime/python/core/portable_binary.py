"""Shared stdlib guardrails for portable imports/exports (no external deps)."""
from __future__ import annotations
import binascii
import io
import posixpath
import struct
import zipfile
import zlib

MAX_UPLOAD_BYTES = 32 * 1024 * 1024
MAX_EXPANDED_BYTES = 128 * 1024 * 1024
MAX_FILES = 512
MAX_SINGLE_BYTES = 32 * 1024 * 1024

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def sniff_mime(raw: bytes):
    """Return an image MIME type from magic bytes, or None when unknown."""
    if not isinstance(raw, (bytes, bytearray)):
        return None
    if len(raw) >= 8 and bytes(raw[:8]) == PNG_MAGIC:
        return "image/png"
    if len(raw) >= 3 and bytes(raw[:3]) == b"\xff\xd8\xff":
        return "image/jpeg"
    if len(raw) >= 6 and bytes(raw[:6]) in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if len(raw) >= 12 and bytes(raw[:4]) == b"RIFF" and bytes(raw[8:12]) == b"WEBP":
        return "image/webp"
    return None


def parse_png_chunks(raw: bytes) -> list:
    """Parse PNG chunks, verifying CRCs and bounded lengths."""
    if not isinstance(raw, (bytes, bytearray)) or bytes(raw[:8]) != PNG_MAGIC:
        raise ValueError("Not a PNG file")
    raw = bytes(raw)
    if len(raw) < 33:
        raise ValueError("Truncated PNG file")
    pos = 8
    chunks = []
    while True:
        if pos + 8 > len(raw):
            raise ValueError("Truncated PNG chunk header")
        (length,) = struct.unpack(">I", raw[pos:pos + 4])
        ctype = raw[pos + 4:pos + 8]
        if length > 50 * 1024 * 1024:
            raise ValueError("PNG chunk too large")
        end = pos + 8 + length + 4
        if end > len(raw):
            raise ValueError("Truncated PNG chunk data")
        data = raw[pos + 8:pos + 8 + length]
        (crc,) = struct.unpack(">I", raw[pos + 8 + length:end])
        if binascii.crc32(ctype + data) & 0xFFFFFFFF != crc:
            raise ValueError("PNG chunk CRC mismatch")
        try:
            name = ctype.decode("ascii")
        except Exception as exc:
            raise ValueError("Invalid PNG chunk type") from exc
        if not name.isprintable() or not all(32 < ord(c) < 127 for c in name):
            raise ValueError("Invalid PNG chunk type")
        chunks.append((name, data))
        pos = end
        if ctype == b"IEND":
            break
        if len(chunks) > 200:
            raise ValueError("Too many PNG chunks")
        if pos >= len(raw):
            raise ValueError("Missing PNG IEND chunk")
    return chunks


def get_png_texts(raw: bytes) -> dict:
    """Extract tEXt/iTXt keyword/value pairs (first value wins)."""
    texts = {}
    for ctype, data in parse_png_chunks(raw):
        if ctype == "tEXt":
            idx = data.find(b"\x00")
            if idx <= 0:
                continue
            try:
                keyword = data[:idx].decode("latin-1")
                value = data[idx + 1:].decode("latin-1")
            except Exception:
                continue
            texts.setdefault(keyword, value)
        elif ctype == "iTXt":
            try:
                idx = data.find(b"\x00")
                keyword = data[:idx].decode("utf-8", "replace")
                comp_flag = data[idx + 1]
                rest = data[idx + 3:]
                first = rest.find(b"\x00")
                rest2 = rest[first + 1:]
                second = rest2.find(b"\x00")
                text = rest2[second + 1:]
                if comp_flag == 1:
                    if len(text) > 8 * 1024 * 1024:
                        continue
                    decoder = zlib.decompressobj()
                    text = decoder.decompress(text, MAX_UPLOAD_BYTES + 1)
                    if len(text) > MAX_UPLOAD_BYTES or not decoder.eof:
                        raise ValueError('Expanded PNG text exceeds limit')
                texts.setdefault(keyword, text.decode("utf-8", "replace"))
            except ValueError:
                raise
            except Exception:
                continue
    return texts


def _png_chunk(ctype: bytes, data: bytes) -> bytes:
    body = ctype + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", binascii.crc32(body) & 0xFFFFFFFF)


def neutral_png() -> bytes:
    """Deterministic 1x1 neutral gray PNG used when no portrait exists."""
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    idat = zlib.compress(b"\x00\x80\x80\x80")
    return PNG_MAGIC + _png_chunk(b"IHDR", ihdr) + _png_chunk(b"IDAT", idat) + _png_chunk(b"IEND", b"")


def build_png_with_text(base, fields: dict) -> bytes:
    """Insert tEXt chunks before IEND, replacing same-keyword entries."""
    if base is None:
        base = neutral_png()
    chunks = parse_png_chunks(base)
    out = bytearray(PNG_MAGIC)
    for ctype, data in chunks:
        if ctype == "IEND":
            for keyword, value in fields.items():
                payload = keyword.encode("latin-1") + b"\x00" + value.encode("latin-1")
                out += _png_chunk(b"tEXt", payload)
            out += _png_chunk(b"IEND", b"")
        elif ctype in {"tEXt", "iTXt", "zTXt"}:
            idx = data.find(b"\x00")
            keyword = data[:idx].decode("latin-1") if idx > 0 else ""
            if keyword in fields or keyword in {'chara', 'ccv3'} or keyword.startswith('chara-ext-asset_:'):
                continue
            out += _png_chunk(ctype.encode("ascii"), data)
        else:
            out += _png_chunk(ctype.encode("ascii"), data)
    return bytes(out)


def validate_image(raw: bytes):
    """Verify actual image bytes; return (sha256_hex, mime). Pillow first."""
    if not isinstance(raw, (bytes, bytearray)) or not raw:
        raise ValueError("Empty image data")
    raw = bytes(raw)
    mime = sniff_mime(raw)
    if mime is None:
        raise ValueError("Unsupported image type")
    if mime == "image/png":
        parse_png_chunks(raw)
    from .portable_assets import accept_image
    return accept_image(raw)


def safe_open_zip(raw: bytes) -> dict:
    """Open a ZIP with traversal/absolute/symlink/duplicate/size guardrails."""
    if not isinstance(raw, (bytes, bytearray)) or not raw:
        raise ValueError("Empty ZIP archive")
    raw = bytes(raw)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise ValueError("Upload exceeds 32 MiB")
    try:
        handle = zipfile.ZipFile(io.BytesIO(raw))
    except Exception as exc:
        raise ValueError("Invalid ZIP archive: %s" % exc) from exc
    with handle:
        infos = handle.infolist()
        files = [i for i in infos if not i.is_dir()]
        if len(files) > MAX_FILES:
            raise ValueError("ZIP archive has too many files")
        seen_raw = set()
        out = {}
        total = 0
        for info in infos:
            if info.is_dir():
                continue
            name = info.filename
            if name in seen_raw:
                raise ValueError("Duplicate ZIP entry: %s" % name)
            seen_raw.add(name)
            bad_abs = name.startswith("/") or name.startswith("\\")
            bad_abs = bad_abs or (len(name) >= 2 and name[1] == ":")
            if bad_abs:
                raise ValueError("Unsafe absolute ZIP path: %s" % name)
            if (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError("ZIP symlinks are not allowed: %s" % name)
            normalized = posixpath.normpath(name.replace("\\", "/"))
            if '..' in name.replace('\\', '/').split('/'):
                raise ValueError('Unsafe ZIP path traversal')
            parts = normalized.split("/")
            if normalized.startswith("/") or normalized == ".." or normalized.startswith("../"):
                raise ValueError("Unsafe ZIP path traversal: %s" % name)
            if ".." in parts:
                raise ValueError("Unsafe ZIP path traversal: %s" % name)
            cleaned = "/".join(p for p in parts if p not in ("", "."))
            if not cleaned or cleaned in out:
                raise ValueError("Duplicate ZIP entry: %s" % name)
            if info.file_size > MAX_SINGLE_BYTES:
                raise ValueError("ZIP entry too large: %s" % name)
            total += info.file_size
            if total > MAX_EXPANDED_BYTES:
                raise ValueError("ZIP expanded size exceeds 128 MiB")
            try:
                data = handle.read(info.filename)
            except Exception as exc:
                raise ValueError("Cannot read ZIP entry %s: %s" % (name, exc)) from exc
            if len(data) > MAX_SINGLE_BYTES:
                raise ValueError("ZIP entry too large: %s" % name)
            out[cleaned] = data
        if sum(len(v) for v in out.values()) > MAX_EXPANDED_BYTES:
            raise ValueError("ZIP expanded size exceeds 128 MiB")
        return out


def sanitize_stem(name, default="character") -> str:
    """Filesystem-safe stem preserving Japanese letters and digits."""
    cleaned = "".join(c if (c.isalnum() or c in ("-", "_", " ")) else "_" for c in (name or ""))
    cleaned = "_".join(cleaned.split())
    return cleaned[:64] or default
