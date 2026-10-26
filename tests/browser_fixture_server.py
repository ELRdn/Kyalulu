"""Owned loopback Vite process shared by disposable browser fixtures."""
import asyncio
from contextlib import asynccontextmanager
import os
from pathlib import Path
import socket
import subprocess

import httpx

ROOT = Path(__file__).resolve().parents[1]


@asynccontextmanager
async def local_vite(output):
    output.mkdir(parents=True, exist_ok=True)
    with socket.socket() as available:
        available.bind(('127.0.0.1', 0))
        port = available.getsockname()[1]
    origin = f'http://127.0.0.1:{port}'
    with (output / 'vite.log').open('wb') as log:
        server = subprocess.Popen(['node', str(ROOT / 'apps/web/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', str(port), '--strictPort'],
            cwd=ROOT / 'apps/web', stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        try:
            async with httpx.AsyncClient(trust_env=False, timeout=1) as check:
                for _ in range(100):
                    if server.poll() is not None: raise AssertionError(f'Fixture Vite stopped; inspect {output / "vite.log"}')
                    try:
                        if (await check.get(origin)).status_code == 200: break
                    except httpx.HTTPError: pass
                    await asyncio.sleep(.1)
                else: raise AssertionError('Fixture Vite did not start')
            yield origin
        finally:
            if server.poll() is None:
                server.terminate()
                try: await asyncio.to_thread(server.wait, 10)
                except subprocess.TimeoutExpired:
                    server.kill()
                    await asyncio.to_thread(server.wait)
