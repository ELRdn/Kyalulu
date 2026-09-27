from __future__ import annotations
import contextlib
import io
import tempfile
import threading
import unittest
from pathlib import Path
from kcb.cli import main
from kcb.config import validate_config
from kcb.util import save_json
from support import FakeAPI

class CLITests(unittest.TestCase):
    def test_plan_does_not_connect_and_counts_792(self):
        out=io.StringIO()
        with contextlib.redirect_stdout(out):self.assertEqual(main(['plan','--repeats','3']),0)
        self.assertIn('792',out.getvalue());self.assertIn('"network_calls_made": 0',out.getvalue())
    def test_failed_generation_returns_exit_code_three(self):
        with tempfile.TemporaryDirectory() as d,FakeAPI(fail_at=1) as api:
            path=Path(d)/'config.json';save_json(path,api.config())
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(main(['run','--config',str(path),'--out',str(Path(d)/'run'),'--suite','diagnostic','--limit-units','1','--quiet']),3)
    def test_system_doctor_probe_has_session_context(self):
        from tools.system_bridge import make_server
        with tempfile.TemporaryDirectory() as d:
            server=make_server(validate_config({'provider':'mock','model':'fixture'}),0,str(Path(d)/'bridge.sqlite3'))
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                config=validate_config({'provider':'system_http','base_url':f'http://127.0.0.1:{server.server_port}/kcb/v1','track':'system','runtime_id':'test-reference','stream':False})
                path=Path(d)/'config.json';save_json(path,config);output=io.StringIO()
                with contextlib.redirect_stdout(output):self.assertEqual(main(['doctor','--config',str(path),'--probe']),0)
                self.assertIn('unscored_probe',output.getvalue());self.assertIn('"mock": true',output.getvalue())
            finally:server.shutdown();server.server_close();thread.join(timeout=3)

if __name__=='__main__':unittest.main()
