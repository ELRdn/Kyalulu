from __future__ import annotations
import csv
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parent.parent

class KCBError(Exception):
    """An actionable error safe to present in the CLI."""

def now() -> str:
    return datetime.now(timezone.utc).isoformat()

def dumps(value: Any, *, pretty: bool = False) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      indent=2 if pretty else None, allow_nan=False)

def digest(value: Any) -> str:
    return hashlib.sha256(dumps(value).encode("utf-8")).hexdigest()

def load_json(path: str | Path) -> Any:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        raise KCBError(f"Cannot read JSON: {path}: {exc}") from exc

def save_json(path: str | Path, value: Any) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(dumps(value, pretty=True) + "\n", encoding="utf-8")
    os.replace(temp, path)

def read_jsonl(path: str | Path) -> list[dict]:
    out = []
    try:
        with Path(path).open(encoding="utf-8-sig") as f:
            for i, line in enumerate(f, 1):
                if line.strip():
                    try:
                        value = json.loads(line)
                        if not isinstance(value, dict):
                            raise ValueError("row must be an object")
                        out.append(value)
                    except ValueError as exc:
                        raise KCBError(f"Invalid JSONL at {path}:{i}: {exc}") from exc
    except OSError as exc:
        raise KCBError(str(exc)) from exc
    return out

def write_jsonl(path: str | Path, values: Iterable[dict]) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    with temp.open("w", encoding="utf-8", newline="\n") as f:
        for value in values:
            f.write(dumps(value) + "\n")
    os.replace(temp, path)

def append_jsonl(path: str | Path, value: dict) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as f:
        f.write(dumps(value) + "\n")
        f.flush()
        os.fsync(f.fileno())

def safe_csv(path: str | Path, rows: list[dict], fields: list[str]) -> None:
    """Excel-safe, UTF-8 BOM CSV; no formula execution from generated text."""
    def cell(v: Any) -> Any:
        if isinstance(v, (dict, list)):
            v = dumps(v)
        if isinstance(v, str) and v.lstrip().startswith(("=", "+", "-", "@")):
            return "'" + v
        return v
    with Path(path).open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fields, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: cell(row.get(k, "")) for k in fields})

def json_for_html(value: Any) -> str:
    return dumps(value).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")

def strict_object(text: str) -> dict:
    def unique(pairs):
        out = {}
        for key, value in pairs:
            if key in out:
                raise ValueError(f"duplicate JSON key: {key}")
            out[key] = value
        return out
    def invalid_number(value):
        raise ValueError(f"invalid JSON number: {value}")
    value = json.loads(text.strip(), object_pairs_hook=unique, parse_constant=invalid_number)
    if not isinstance(value, dict):
        raise ValueError("JSON object required")
    return value

def judge_object(text: str) -> dict:
    """Allow only a surrounding JSON fence for judges; never eval() model code."""
    text = text.strip()
    match = re.fullmatch(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.S)
    return strict_object(match.group(1) if match else text)
