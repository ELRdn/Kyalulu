"""Summarize GSC exported ZIP date tables offline; GA4/account counts stay separate."""

import argparse
import csv
from datetime import date
from decimal import Decimal
import io
import json
from pathlib import Path
import re
import zipfile


HEADERS = (("Date", "Clicks", "Impressions"), ("日付", "クリック数", "表示回数"))
MAX_BYTES = 10 * 1024 * 1024


def count(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+", value):
        raise ValueError("clicks/impressions must be nonnegative integers")
    return int(value.replace(",", ""))


def summarize(path, start, end):
    if start > end:
        raise ValueError("start must not follow end")
    tables = []
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > 100 or sum(entry.file_size for entry in entries) > MAX_BYTES:
            raise ValueError("ZIP exceeds 100 entries or 10 MiB uncompressed")
        for entry in entries:
            if entry.is_dir() or not entry.filename.lower().endswith(".csv"):
                continue
            reader = csv.DictReader(io.StringIO(archive.read(entry).decode("utf-8-sig")), strict=True)
            fields = reader.fieldnames or []
            header = next((names for names in HEADERS if names[0] in fields), None)
            if header is None:
                continue
            if len(fields) != len(set(fields)) or not set(header).issubset(fields):
                raise ValueError("date table requires unique Date/Clicks/Impressions headers (EN or JA)")
            records = {}
            day_key, click_key, impression_key = header
            for row in reader:
                day = date.fromisoformat(row[day_key])
                if row[day_key] != day.isoformat() or day in records:
                    raise ValueError("date table requires unique ISO dates")
                clicks, impressions = count(row[click_key]), count(row[impression_key])
                if clicks > impressions:
                    raise ValueError("clicks exceed impressions")
                records[day] = (clicks, impressions)
            tables.append(records)
    if len(tables) != 1:
        raise ValueError("ZIP must contain exactly one date table; dimension tables are not totals")
    selected = {day: values for day, values in tables[0].items() if start <= day <= end}
    clicks = sum(values[0] for values in selected.values()) if selected else None
    impressions = sum(values[1] for values in selected.values()) if selected else None
    return {
        "start": start.isoformat(), "end": end.isoformat(), "date_rows": len(selected),
        "missing_dates": (end - start).days + 1 - len(selected),
        "clicks": clicks, "impressions": impressions,
        "ctr_percent": str(Decimal(clicks) * 100 / impressions) if impressions else None,
        "coverage": "exported_dates_only" if selected else "no_data",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("zip_files", nargs="+", type=Path)
    parser.add_argument("--start", required=True, type=date.fromisoformat)
    parser.add_argument("--end", required=True, type=date.fromisoformat)
    args = parser.parse_args()
    try:
        exports = [summarize(path, args.start, args.end) for path in args.zip_files]
    except (OSError, ValueError, TypeError, RuntimeError, zipfile.BadZipFile, csv.Error) as exc:
        parser.error(str(exc))
    print(json.dumps({"gsc_exports": exports, "exports_combined": False,
                      "ga4": "not_imported", "cloud_accounts": "not_imported",
                      "ai_attribution": "not_inferred"}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
