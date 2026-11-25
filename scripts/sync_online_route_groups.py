"""Sync the Caddy page matchers with the shared online rollout groups."""
import argparse
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
GROUPS = "apps/web/src/lib/onlineRouteGroups.json"
CADDY = "deploy/cloud/Caddyfile.unified.example"
APP = "apps/online/app"
PARAMETER = r"[a-zA-Z][a-zA-Z0-9_]*"
SEGMENT = rf"(?:[a-z0-9_-]+|:{PARAMETER})"
DEDICATED = {"/device", "/migration", "/offline"}
INTERNAL = {"/_not-found", "/_global-error"}


def read_groups(root):
    groups = json.loads((root / GROUPS).read_text(encoding="utf-8"))
    if set(groups) != {"entry", "chats", "browse", "pages"}:
        raise ValueError("Expected the four online rollout groups")
    paths = [path for group in groups.values() for path in group]
    if any(not re.fullmatch(rf"/(?:{SEGMENT}(?:/{SEGMENT})*)?", path) for path in paths):
        raise ValueError("Use literal paths and named single-segment parameters in onlineRouteGroups.json")
    patterns = [re.sub(rf":{PARAMETER}", "[^/]+", path) for path in paths]
    if len(set(patterns)) != len(paths) or set(paths) & (DEDICATED | INTERNAL):
        raise ValueError("Duplicate or reserved online rollout path")
    if any(":" in path for path in groups["entry"]):
        raise ValueError("The entry matcher requires literal paths")
    by_path = [(path.split("/"), group) for group, members in groups.items() for path in members]
    for index, (path, group) in enumerate(by_path):
        for other, other_group in by_path[index + 1:]:
            if group != other_group and len(path) == len(other) and all(
                    a == b or a.startswith(":") or b.startswith(":") for a, b in zip(path, other)):
                raise ValueError(f"Overlapping rollout groups for {'/'.join(path)} and {'/'.join(other)}")
    return groups


def render_caddy(text, groups):
    for group, paths in groups.items():
        if group == "entry":
            matcher = "path " + " ".join(paths)
        else:
            paths = [re.sub(rf":{PARAMETER}", "[^/]+", path) for path in paths]
            matcher = "path_regexp ^(" + "|".join(paths) + ")/?$"
        block = rf"(^    @next_{group} \{{\n        vars online_eligible yes\n)        path[^\n]*"
        text, count = re.subn(block, lambda match: match[1] + "        " + matcher, text, flags=re.MULTILINE)
        if count != 1:
            raise ValueError(f"Expected one Caddy page matcher for {group}")
    return text


def check_routes(groups, next_paths):
    paths = {re.sub(rf"\[({PARAMETER})\]", r":\1", path) for path in next_paths} - INTERNAL
    routed = {path for group in groups.values() for path in group} | DEDICATED
    missing = sorted(paths - routed)
    obsolete = sorted(routed - paths)
    if missing or obsolete:
        raise ValueError(f"Online route declarations differ from App Router. Missing: {missing}. Obsolete: {obsolete}.")


def sync(root, *, write=False, next_manifest=None):
    groups = read_groups(root)
    app = root / APP
    next_paths = ["/" + "/".join(page.parent.relative_to(app).parts)
                  for page in app.rglob("page.*") if page.suffix in {".js", ".jsx", ".ts", ".tsx"}]
    check_routes(groups, next_paths)
    if next_manifest is not None:
        check_routes(groups, json.loads(next_manifest.read_text(encoding="utf-8")).values())
    caddy = root / CADDY
    original = caddy.read_text(encoding="utf-8")
    updated = render_caddy(original, groups)
    if write:
        caddy.write_text(updated, encoding="utf-8", newline="\n")
    elif original != updated:
        raise ValueError("Caddy page matchers are stale. Run python scripts/sync_online_route_groups.py --write")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="Regenerate just the Caddy page matchers")
    args = parser.parse_args()
    sync(ROOT, write=args.write)
