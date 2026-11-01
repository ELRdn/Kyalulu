"""Native shutdown must release its process even after a client resets TCP."""
import os
from pathlib import Path
import socket
import struct
import subprocess
import sys
import time

import httpx
import pytest


@pytest.mark.parametrize('platform,expected', [('win32', 'asyncio:SelectorEventLoop'),
                                             ('linux', 'auto'), ('darwin', 'auto')])
def test_native_loop_selection(monkeypatch, platform, expected):
    from python import local_server

    calls = []
    monkeypatch.setattr(local_server.sys, 'platform', platform)
    monkeypatch.setattr(local_server.uvicorn, 'Config', lambda *args, **kwargs: calls.append(kwargs))
    class Server:
        def __init__(self, config):
            pass

        def run(self):
            calls.append('run')

    monkeypatch.setattr(local_server.uvicorn, 'Server', Server)
    monkeypatch.setattr(local_server, 'server', None)
    local_server.main()
    assert calls[0]['loop'] == expected and calls[1] == 'run'
    assert calls[0]['host'] == '127.0.0.1'


@pytest.mark.skipif(sys.platform != 'win32', reason='Windows transport regression')
@pytest.mark.parametrize('inject_shutdown_reset', [False, True])
def test_native_process_exits_after_tcp_reset(tmp_path, inject_shutdown_reset):
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    origin = f'http://127.0.0.1:{port}'
    env = {key: value for key, value in os.environ.items()
           if key.upper() in ('SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATH')}
    env.update(PYTHONPATH=str(Path(__file__).resolve().parents[1] / 'runtime'),
               PYTHONDONTWRITEBYTECODE='1', KYALULU_DATA_DIR=str(tmp_path / 'data'),
               KYALULU_PORT=str(port), KYALULU_OWNER_TOKEN='fictional-lifecycle-owner',
               KYALULU_TRUSTED_ORIGINS=origin, HOME=str(tmp_path), USERPROFILE=str(tmp_path),
               LOCALAPPDATA=str(tmp_path), APPDATA=str(tmp_path))
    program = '''from unittest.mock import patch
from pydantic_settings import BaseSettings
original = BaseSettings.__init__
def no_dotenv(self, **kwargs):
    original(self, _env_file=None, **kwargs)
with patch.object(BaseSettings, '__init__', no_dotenv):
    from python import local_server
    from fastapi.responses import StreamingResponse
    import asyncio, os, socket
    if os.environ.get('FICTIONAL_SHUTDOWN_RESET') == '1':
        original_shutdown = socket.socket.shutdown
        def reset(self, *args):
            if self.getsockname()[1] == int(os.environ['KYALULU_PORT']):
                raise ConnectionResetError(10054, 'Fictional reset during server socket shutdown')
            return original_shutdown(self, *args)
        socket.socket.shutdown = reset
    @local_server.app.get('/api/lifecycle-fixture')
    async def fixture():
        async def body():
            while True:
                yield b'x' * 65536
                await asyncio.sleep(.001)
        return StreamingResponse(body())
    local_server.main()
'''
    env['FICTIONAL_SHUTDOWN_RESET'] = '1' if inject_shutdown_reset else '0'
    with (tmp_path / 'runtime.log').open('w') as log:
        child = subprocess.Popen([sys.executable, '-u', '-c', program], cwd=tmp_path, env=env,
                                 stdout=log, stderr=log)
        try:
            with httpx.Client(base_url=origin, trust_env=False, timeout=2) as client:
                deadline = time.monotonic() + 20
                while True:
                    try:
                        if client.get('/api/health').is_success:
                            break
                    except httpx.HTTPError:
                        pass
                    assert child.poll() is None and time.monotonic() < deadline
                    time.sleep(.1)
                for _ in range(5):
                    with socket.create_connection(('127.0.0.1', port), timeout=3) as connection:
                        connection.sendall(b'GET /api/lifecycle-fixture HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n')
                        assert b'200 OK' in connection.recv(4096)
                        connection.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack('HH', 1, 0))
                response = client.post('/api/local/shutdown', headers={
                    'Origin': origin, 'x-kyalulu-owner': 'fictional-lifecycle-owner'})
                assert response.is_success
            assert child.wait(timeout=10) == 0
        finally:
            if child.poll() is None:
                child.terminate()
                child.wait(timeout=5)
    assert '_call_connection_lost' not in (tmp_path / 'runtime.log').read_text()
