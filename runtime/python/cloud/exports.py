"""Manual logical export at every plan/over-quota state. No keys/device settings."""

import json
import tempfile
import zipfile
import re
from pathlib import Path
from .transfers import snapshot_pages, PAGE_BYTES


def build_export(path, parent):
    parent.mkdir(parents=True, exist_ok=True)
    directory = Path(tempfile.mkdtemp(dir=parent))
    try:
        output = directory / "kyalulu-cloud.zip"
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(
                "manifest.json",
                json.dumps(
                    {"format": "kyalulu-sync-pages", "version": 1, "selected_sessions": None}
                ),
            )
            for index, page in enumerate(snapshot_pages(path, row_bytes=PAGE_BYTES - 512)):
                archive.writestr(f"pages/{index:08d}.json", json.dumps(page, ensure_ascii=False))
                if page["table"] == "library_assets":
                    for row in page["rows"]:
                        key = row["id"]
                        if not re.fullmatch(r"[0-9a-f]{64}", key):
                            raise ValueError("Invalid asset identity")
                        archive.write(path.parent / "library_assets" / key, "library_assets/" + key)
        return output
    except BaseException:
        import shutil

        shutil.rmtree(directory)
        raise
