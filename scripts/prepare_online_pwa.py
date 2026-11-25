"""Assemble the Next device and migration documents with the unified release's verified runtime."""
import argparse
import base64
import hashlib
import gzip
import json
from pathlib import Path
import re
import shutil
import stat
from tempfile import TemporaryDirectory


def sri(data):
    return "sha256-" + base64.b64encode(hashlib.sha256(data).digest()).decode("ascii")


def declaration(script, key, *, optional=False):
    match = re.search(rf"^const {key} = (.+);\r?$", script, re.MULTILINE)
    if not match:
        if optional:
            return None
        raise ValueError(f"Missing worker build declaration: {key}")
    return json.loads(match[1])


def check_relay_origin(worker, *, next_origin=None, expected=None):
    origin = declaration(worker, "BUILD_RELAY_ORIGIN", optional=True)
    if origin is not None and (not isinstance(origin, str) or not origin):
        raise ValueError("Invalid unified Web Relay origin")
    if origin is not None and next_origin is not None and origin != next_origin:
        raise ValueError("Unified Web and Next were built for different Relay origins")
    if expected is not None and expected != origin:
        raise ValueError("Unified Web does not declare the expected Relay origin")
    return origin


def next_relay_origin(manifest):
    relay = json.loads(manifest)["config"]["env"]["NEXT_PUBLIC_KYALULU_RELAY_ORIGIN"]
    if not isinstance(relay, str):
        raise ValueError("Invalid Next Relay origin")
    return relay


def checked_mode(path):
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT:
        raise ValueError(f"Unexpected linked build output: {path.name}")
    return info.st_mode


def checked_tree(root):
    if not stat.S_ISDIR(checked_mode(root)):
        raise ValueError(f"Expected build directory: {root.name}")
    for file in root.iterdir():
        mode = checked_mode(file)
        if stat.S_ISDIR(mode):
            yield from checked_tree(file)
        elif stat.S_ISREG(mode):
            yield file
        else:
            raise ValueError(f"Unexpected build output: {file.name}")


def static_document(html, stage, digests, name, worker):
    def externalize(match):
        attributes, code = match.groups()
        if not code.strip():
            return match[0]
        if attributes.strip():
            raise ValueError(f"Unexpected inline script attributes in {name}")
        data = code.encode("utf-8")
        path = "assets/next-shell-" + hashlib.sha256(data).hexdigest() + ".js"
        (stage / path).write_bytes(data)
        digests[path] = sri(data)
        return f'<script src="/{path}" integrity="{digests[path]}"></script>'

    if html.count("<head>") != 1 or "/_next/static/" not in html:
        raise ValueError(f"Expected a prerendered Next {name} document")
    if name == "migration" and '<link rel="manifest"' in html:
        raise ValueError("The isolated migration flow cannot load an app manifest")
    html = re.sub(r"<script\b([^>]*)>(.*?)</script>", externalize, html, flags=re.DOTALL)
    marker = f'<meta name="kyalulu-document" content="next-{name}">'
    if name == "device":
        marker += f'<meta name="kyalulu-inference-worker" content="/{worker}">'
    data = html.replace("<head>", "<head>" + marker, 1).encode("utf-8")
    path = f"{name}/index.html"
    (stage / name).mkdir(exist_ok=True)
    (stage / path).write_bytes(data)
    digests[path] = sri(data)


def prepare(unified, next_build, output):
    for directory in (unified, next_build, next_build / "server", next_build / "server/app"):
        if not stat.S_ISDIR(checked_mode(directory)):
            raise ValueError(f"Expected build directory: {directory.name}")
    unified, next_build, output = (path.resolve() for path in (unified, next_build, output))
    if output.exists() or output.is_relative_to(unified) or output.is_relative_to(next_build):
        raise ValueError("Choose a new output directory outside both input builds")
    if not stat.S_ISREG(checked_mode(unified / "sw.js")):
        raise ValueError("Expected a generated service worker")
    script = (unified / "sw.js").read_text(encoding="utf-8")
    files = declaration(script, "FILES")
    digests = declaration(script, "INTEGRITY")
    compressed = declaration(script, "COMPRESSED")
    if set(files) != set(digests) or not {"device/index.html", "migration/index.html"} <= set(files):
        raise ValueError("Input must be a unified app with both dedicated documents")
    workers = [name for name in files if re.fullmatch(r"assets/runtime\.worker-[\w-]+\.js", name)]
    if len(workers) != 1:
        raise ValueError("Expected exactly one hashed inference worker")
    output.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=output.parent) as temporary:
        stage = Path(temporary) / "web"
        for file in checked_tree(unified):
            target = stage / file.relative_to(unified)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(file, target)
        for name in files:
            packed = compressed.get(name, {})
            for relative in (name, packed.get("path", name)):
                if Path(relative).as_posix() != relative or Path(relative).anchor or ".." in relative.split("/"):
                    raise ValueError("Invalid asset path in worker inventory")
            source = (stage / packed.get("path", name)).resolve()
            if not source.is_relative_to(stage) or sri(source.read_bytes()) != packed.get("integrity", digests[name]):
                raise ValueError(f"Unified asset integrity mismatch: {name}")
            if packed:
                with gzip.open(source, "rb") as stream:
                    digest = base64.b64encode(hashlib.file_digest(stream, "sha256").digest()).decode("ascii")
                if "sha256-" + digest != digests[name]:
                    raise ValueError(f"Uncompressed asset integrity mismatch: {name}")
        static = next_build / "static"
        for file in checked_tree(static):
            relative = file.relative_to(static)
            if file.suffix not in (".js", ".css", ".wasm", ".woff", ".woff2", ".png", ".webp", ".svg", ".avif"):
                continue
            name = "_next/static/" + relative.as_posix()
            if (stage / name).exists():
                raise ValueError("Input already contains Next assets")
            (stage / name).parent.mkdir(parents=True, exist_ok=True)
            data = file.read_bytes()
            (stage / name).write_bytes(data)
            digests[name] = sri(data)
        for name in ("device", "migration", "offline"):
            document = next_build / f"server/app/{name}.html"
            if not stat.S_ISREG(checked_mode(document)):
                raise ValueError(f"Expected generated {name} document")
            html = document.read_text(encoding="utf-8")
            for asset in re.findall(r'(?:src|href)="(/_next/static/[^"?]+)"', html):
                if asset.lstrip("/") not in digests:
                    raise ValueError(f"Missing Next static asset: {asset}")
            static_document(html, stage, digests, name, workers[0])
        old_version = declaration(script, "VERSION")
        inventory = json.dumps(digests, sort_keys=True, separators=(",", ":"))
        version = hashlib.sha256((old_version + inventory).encode()).hexdigest()[:20]
        for key, value in (("FILES", sorted(digests)), ("INTEGRITY", digests), ("VERSION", version)):
            script = re.sub(rf"^const {key} = .+;$",
                            lambda _: f"const {key} = {json.dumps(value, separators=(',', ':'))};",
                            script, count=1, flags=re.MULTILINE)
        (stage / "sw.js").write_text(script, encoding="utf-8", newline="\n")
        stage.rename(output)
    return version


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--unified", type=Path, required=True)
    parser.add_argument("--next-build", type=Path, default=Path("apps/online/.next"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print("Prepared online PWA build", prepare(args.unified, args.next_build, args.output))
