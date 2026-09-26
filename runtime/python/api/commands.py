"""Slash commands typed into the chat composer (``/le load ...`` etc.).

Commands run here, not in the renderer, so the LE token never leaves the API.
Output is plain text for display only; nothing is written to chat history.
"""
import asyncio
import shlex
import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from python.providers.le import LEProvider

router = APIRouter()
LOAD_WAIT_SECONDS = 120
TERMINAL = {"completed", "failed", "cancelled", "interrupted"}
OPTION_KEYS = {"ctx", "ngl", "sha256", "device"}

COMMANDS = [
    {"name": "/help", "usage": "/help", "description": "使えるコマンドを表示"},
    {"name": "/le status", "usage": "/le status", "description": "LE の状態・ロード中のモデル・メモリ"},
    {"name": "/le models", "usage": "/le models", "description": "LE のモデル一覧（インストール済み・配信中）"},
    {"name": "/le load", "usage": "/le load <id> [ctx=8192] [ngl=auto|N] [device=Vulkan0]",
     "description": "GGUF モデルをロード（既定は空きVRAMから層数を自動決定）"},
    {"name": "/le plan", "usage": "/le plan <id> [ctx=8192] [device=Vulkan0]", "description": "ロードせずに配置計画（GPU・層数・VRAM見積り）を表示"},
    {"name": "/le devices", "usage": "/le devices", "description": "llama-server から見える GPU と空きメモリ"},
    {"name": "/le unload", "usage": "/le unload [id]", "description": "ロード中のモデルをアンロード"},
    {"name": "/le download", "usage": "/le download <url> [filename] [sha256=...]", "description": "GGUF をダウンロード（中断分は続きから）"},
    {"name": "/le resume", "usage": "/le resume <id>", "description": "途中で止まったダウンロードを再開"},
    {"name": "/le delete", "usage": "/le delete <id>", "description": "インストール済みモデルを削除"},
    {"name": "/le jobs", "usage": "/le jobs", "description": "ジョブ一覧（実行中と直近）"},
    {"name": "/le cancel", "usage": "/le cancel <job_id>", "description": "ジョブをキャンセル"},
]


class CommandIn(BaseModel):
    input: str


class CommandError(Exception):
    pass


def _gb(n) -> str:
    return "不明" if n is None else f"{n / 1024 ** 3:.1f} GB"


def _le_id(raw: str) -> str:
    return raw if raw.startswith("le/") else f"le/{raw}"


def _options(args: list[str]) -> tuple[list[str], dict[str, str]]:
    pos, opts = [], {}
    for a in args:
        k, sep, v = a.partition("=")
        if sep and k.lower() in OPTION_KEYS:
            opts[k.lower()] = v
        else:
            pos.append(a)
    return pos, opts


def _mb(n) -> str:
    return "不明" if n is None else f"{n / 1024 ** 2:,.0f} MiB"


def _int(opts: dict, key: str) -> int | None:
    if key not in opts:
        return None
    try:
        return int(opts[key])
    except ValueError:
        raise CommandError(f"{key} は整数で指定してね: {opts[key]}")


async def _call(le: LEProvider, method: str, path: str, body: dict | None = None) -> dict:
    status, data = await le.call(method, path, body)
    if status >= 400:
        err = data.get("error") or {}
        raise CommandError(f"LE: {err.get('message') or status} ({err.get('code', status)})")
    return data


def _job_line(j: dict) -> str:
    p = j.get("progress") or {}
    prog = ""
    if p.get("total"):
        prog = f" {p['done'] * 100 // p['total']}%"
    elif p.get("phase"):
        prog = f" {p['phase']}"
    err = f" — {j['error']['message']}" if j.get("error") else ""
    return f"{j['id'][:8]}  {j['kind']:<8} {j['state']:<10} {j.get('target') or ''}{prog}{err}"


async def _status(le, _args):
    v = await _call(le, "GET", "version")
    r = await _call(le, "GET", "resources")
    eng = r.get("engine")
    mem, vram = r.get("memory") or {}, r.get("vram") or {}
    return [
        f"LE {v.get('version', '?')} — 稼働中",
        f"ロード中: {eng['model_id']} (port {eng['port']})" if eng else "ロード中: なし",
        f"RAM: 空き {_gb(mem.get('available_bytes'))} / {_gb(mem.get('total_bytes'))}",
        f"VRAM: 空き {_gb(vram.get('free_bytes'))} / {_gb(vram.get('total_bytes'))}",
        f"実行中ジョブ: {r.get('active_jobs', 0)}",
    ], False


async def _models(le, _args):
    installed = (await _call(le, "GET", "models")).get("models", [])
    def row(m):
        if m["state"] == "partial":
            total = m.get("total_bytes")
            pct = f" {m['done_bytes'] * 100 // total}%" if total else ""
            return f"  {m['id']}  [途中{pct}]  /le resume {m['id']} で再開"
        return f"  {m['id']}  [{m['state']}]  {_gb(m.get('size_bytes')) if m.get('size_bytes') else ''}".rstrip()
    lines = ["インストール済み (le/):"]
    lines += [row(m) for m in installed] or ["  なし"]
    try:
        served = await le.served_models()
    except httpx.HTTPError:
        served = []
    others = [s for s in served if not s.startswith("le/")]
    lines.append(f"配信中のバックエンドモデル: {len(others)} 件")
    lines += [f"  {s}" for s in others[:20]]
    if len(others) > 20:
        lines.append(f"  …ほか {len(others) - 20} 件")
    return lines, False


def _placement_body(model_id: str, opts: dict, ngl_default: str | None = "auto") -> dict:
    body = {"id": _le_id(model_id)}
    if (ctx := _int(opts, "ctx")) is not None:
        body["context_length"] = ctx
    ngl = opts.get("ngl", ngl_default)
    if ngl is not None:
        body["gpu_layers"] = "auto" if ngl.lower() == "auto" else _int({"ngl": ngl}, "ngl")
    if opts.get("device"):
        body["device"] = opts["device"]
    return body


def _plan_lines(plan: dict) -> list[str]:
    total = plan.get("total_layers")
    if plan.get("full_offload"):
        layers = "全層"
    else:
        layers = f"{plan['gpu_layers']}/{total if total is not None else '?'} 層"
    dev = f"{plan['device']} ({plan.get('device_name') or '?'})" if plan.get("device") else "なし（CPU）"
    kv = _mb(plan.get("kv_cache_bytes")) + ("" if plan.get("kv_exact") else "（概算）")
    lines = [
        f"GPU: {dev}  空き {_mb(plan.get('free_bytes'))}",
        f"GPU に載せる層: {layers}  (-ngl {plan['gpu_layers']})  ctx {plan['context_length']}",
        f"見積り VRAM: {_mb(plan.get('estimated_vram_bytes'))}  = モデル {_mb(plan.get('model_bytes'))} の一部 + KV {kv} + 余裕 {_mb(plan.get('overhead_bytes'))}",
    ]
    return lines + [f"注: {n}" for n in plan.get("notes") or []]


async def _plan(le, args):
    pos, opts = _options(args)
    if len(pos) != 1:
        raise CommandError("使い方: /le plan <id> [ctx=8192] [device=Vulkan0]")
    body = _placement_body(pos[0], opts)
    body["gpu_layers"] = "auto"
    data = await _call(le, "POST", "models/plan", body)
    return [f"{body['id']} の配置計画:"] + [f"  {line}" for line in _plan_lines(data["plan"])], False


async def _devices(le, _args):
    devices = (await _call(le, "GET", "engine/devices")).get("devices", [])
    if not devices:
        return ["llama-server から見える GPU はないよ（CPU で動く）。"], False
    return [f"{d['id']}: {d['name']}  空き {_mb(d['free_bytes'])} / {_mb(d['total_bytes'])}"
            + ("  (内蔵GPU・自動選択しない)" if d.get("integrated") else "") for d in devices], False


async def _load(le, args):
    pos, opts = _options(args)
    if len(pos) != 1:
        raise CommandError("使い方: /le load <id> [ctx=8192] [ngl=auto|N] [device=Vulkan0]")
    body = _placement_body(pos[0], opts)
    job = (await _call(le, "POST", "models/load", body))["job"]
    loop = asyncio.get_running_loop()
    deadline = loop.time() + LOAD_WAIT_SECONDS
    while job["state"] not in TERMINAL and loop.time() < deadline:
        await asyncio.sleep(0.5)
        job = await _call(le, "GET", f"jobs/{job['id']}")
    if job["state"] == "completed":
        lines = [f"{body['id']} をロードしたよ。モデル一覧の le:{body['id']} で会話できる。"]
        if plan := (job.get("result") or {}).get("plan"):
            lines += [f"  {line}" for line in _plan_lines(plan)]
        return lines, True
    if job["state"] in TERMINAL:
        msg = (job.get("error") or {}).get("message") or job["state"]
        raise CommandError(f"{body['id']} のロードに失敗: {msg}")
    return [f"{body['id']} はまだロード中（job {job['id'][:8]}）。/le jobs で確認してね。"], False


async def _unload(le, args):
    pos, _ = _options(args)
    body = {"id": _le_id(pos[0])} if pos else {}
    data = await _call(le, "POST", "models/unload", body)
    return (["アンロードしたよ。"] if data.get("unloaded") else ["ロード中のモデルはなかったよ。"]), True


async def _download(le, args):
    pos, opts = _options(args)
    if not 1 <= len(pos) <= 2:
        raise CommandError("使い方: /le download <url> [filename] [sha256=...]")
    url = pos[0]
    filename = pos[1] if len(pos) == 2 else url.split("?")[0].rstrip("/").rsplit("/", 1)[-1]
    body = {"url": url, "filename": filename}
    if opts.get("sha256"):
        body["sha256"] = opts["sha256"]
    job = (await _call(le, "POST", "models/download", body))["job"]
    return [f"{filename} のダウンロードを開始したよ（job {job['id'][:8]}）。/le jobs で進捗を見られる。"], False


async def _resume(le, args):
    if len(args) != 1:
        raise CommandError("使い方: /le resume <id>")
    model_id = _le_id(args[0])
    m = await _call(le, "GET", f"models/{model_id}")
    if m.get("state") != "partial":
        raise CommandError(f"{model_id} に再開できるダウンロードはないよ（状態: {m.get('state')}）")
    filename = model_id.removeprefix("le/") + ".gguf"
    job = (await _call(le, "POST", "models/download", {"url": m["url"], "filename": filename}))["job"]
    return [f"{model_id} のダウンロードを {_gb(m.get('done_bytes'))} から再開したよ（job {job['id'][:8]}）。"], False


async def _delete(le, args):
    if len(args) != 1:
        raise CommandError("使い方: /le delete <id>")
    data = await _call(le, "DELETE", f"models/{_le_id(args[0])}")
    return [f"{data.get('deleted', args[0])} を削除したよ。"], True


async def _jobs(le, _args):
    jobs = (await _call(le, "GET", "jobs")).get("jobs", [])
    active = [j for j in jobs if j["state"] not in TERMINAL]
    recent = sorted((j for j in jobs if j["state"] in TERMINAL), key=lambda j: j.get("created_at", 0))[-5:]
    lines = ["実行中:"] + ([f"  {_job_line(j)}" for j in active] or ["  なし"])
    if recent:
        lines += ["直近:"] + [f"  {_job_line(j)}" for j in reversed(recent)]
    return lines, False


async def _cancel(le, args):
    if len(args) != 1:
        raise CommandError("使い方: /le cancel <job_id>")
    jid = args[0]
    if len(jid) < 36:
        matches = [j["id"] for j in (await _call(le, "GET", "jobs")).get("jobs", []) if j["id"].startswith(jid)]
        if len(matches) != 1:
            raise CommandError(f"job {jid} が{'見つからない' if not matches else '複数ある'}よ")
        jid = matches[0]
    await _call(le, "DELETE", f"jobs/{jid}")
    return [f"job {jid[:8]} をキャンセルしたよ。"], False


LE_SUB = {"status": _status, "models": _models, "load": _load, "plan": _plan, "devices": _devices,
          "unload": _unload, "download": _download, "resume": _resume, "delete": _delete, "jobs": _jobs,
          "cancel": _cancel}


def _help() -> list[str]:
    return [f"{c['usage']}  — {c['description']}" for c in COMMANDS]


@router.get("/commands")
async def list_commands():
    return {"commands": COMMANDS}


@router.post("/commands")
async def run_command(body: CommandIn):
    text = body.input.strip()
    try:
        try:
            tokens = shlex.split(text)
        except ValueError:
            raise CommandError("引用符が閉じていないよ")
        if not tokens or not tokens[0].startswith("/"):
            raise CommandError("コマンドは / で始めてね。/help で一覧")
        name, args = tokens[0].lower(), tokens[1:]
        if name == "/help":
            return {"ok": True, "command": "/help", "output": "\n".join(_help()), "refresh_models": False}
        if name != "/le":
            raise CommandError(f"{name} は知らないコマンドだよ。/help で一覧")
        sub = args[0].lower() if args else "status"
        handler = LE_SUB.get(sub)
        if handler is None:
            raise CommandError(f"/le {sub} は知らないサブコマンドだよ。/help で一覧")
        le = LEProvider()
        if not le.api_key:
            raise CommandError("LE のトークンが見つからない。LE が起動しているか確認してね")
        try:
            lines, refresh = await handler(le, args[1:])
        except httpx.HTTPError:
            raise CommandError("LE に接続できない。LE が起動しているか確認してね")
        return {"ok": True, "command": f"/le {sub}", "output": "\n".join(lines), "refresh_models": refresh}
    except CommandError as e:
        return JSONResponse({"ok": False, "command": text.split(" ")[0], "output": str(e), "refresh_models": False},
                            status_code=400)
