"""Opt-in fictional v3 capacity: --run (250 MB then gated 1 GB), or --self-check.

No payload bytes cross CDP. Dedicated profiles and reports stay in the allowed artifact tree.
Windows Job Objects own every browser descendant, including across renderer exits.
"""
import argparse
import asyncio
from contextlib import nullcontext
import ctypes as C
from ctypes import wintypes as W
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import uuid
from urllib.parse import quote, urlsplit
from unittest.mock import patch

sys.dont_write_bytecode = True

from playwright.async_api import async_playwright
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/unified-capacity-20261030'
GIB = 1024**3
MEMORY_LIMIT = 4 * GIB
SECONDS_LIMIT = 480


class IO(C.Structure):
    _fields_ = [(name, C.c_ulonglong) for name in ('readOps', 'writeOps', 'otherOps', 'readBytes', 'writeBytes', 'otherBytes')]


class BASIC(C.Structure):
    _fields_ = [('processTime', C.c_longlong), ('jobTime', C.c_longlong), ('flags', W.DWORD),
                ('minimumWS', C.c_size_t), ('maximumWS', C.c_size_t), ('activeLimit', W.DWORD),
                ('affinity', C.c_size_t), ('priority', W.DWORD), ('scheduling', W.DWORD)]


class EXTENDED(C.Structure):
    _fields_ = [('basic', BASIC), ('io', IO), ('processLimit', C.c_size_t), ('jobLimit', C.c_size_t),
                ('peakProcess', C.c_size_t), ('peakJob', C.c_size_t)]


class MEMORY(C.Structure):
    _fields_ = [('cb', W.DWORD), ('faults', W.DWORD)] + [(name, C.c_size_t) for name in
        ('peakWS', 'workingSet', 'peakPaged', 'paged', 'peakNonpaged', 'nonpaged', 'pagefile', 'peakPagefile', 'private')]


class SYSTEM_MEMORY(C.Structure):
    _fields_ = [('length', W.DWORD), ('load', W.DWORD)] + [(name, C.c_ulonglong) for name in
        ('totalPhysical', 'availablePhysical', 'totalPagefile', 'availablePagefile', 'totalVirtual', 'availableVirtual', 'extendedVirtual')]


def winapi():
    kernel = C.WinDLL('kernel32', use_last_error=True)
    signatures = {
        'CreateJobObjectW': ([C.c_void_p, W.LPCWSTR], W.HANDLE),
        'SetInformationJobObject': ([W.HANDLE, C.c_int, C.c_void_p, W.DWORD], W.BOOL),
        'QueryInformationJobObject': ([W.HANDLE, C.c_int, C.c_void_p, W.DWORD, C.c_void_p], W.BOOL),
        'AssignProcessToJobObject': ([W.HANDLE, W.HANDLE], W.BOOL),
        'TerminateJobObject': ([W.HANDLE, W.UINT], W.BOOL),
        'OpenProcess': ([W.DWORD, W.BOOL, W.DWORD], W.HANDLE),
        'CloseHandle': ([W.HANDLE], W.BOOL),
        'GlobalMemoryStatusEx': ([C.POINTER(SYSTEM_MEMORY)], W.BOOL),
    }
    for name, (args, result) in signatures.items():
        getattr(kernel, name).argtypes, getattr(kernel, name).restype = args, result
    return kernel


def available_memory(kernel):
    value = SYSTEM_MEMORY(); value.length = C.sizeof(value)
    return value.availablePhysical if kernel.GlobalMemoryStatusEx(C.byref(value)) else None


def require(value):
    if not value:
        raise C.WinError(C.get_last_error())
    return value


class OwnedBrowser:
    def __init__(self, executable, profile, log):
        self.kernel = winapi()
        self.job = require(self.kernel.CreateJobObjectW(None, None))
        self.process = None
        self.assigned = False
        self.log = log.open('wb')
        self.psapi = C.WinDLL('psapi', use_last_error=True)
        self.psapi.GetProcessMemoryInfo.argtypes = [W.HANDLE, C.POINTER(MEMORY), W.DWORD]
        self.psapi.GetProcessMemoryInfo.restype = W.BOOL
        try:
            limits = EXTENDED(); limits.basic.flags = 0x2000 | 0x200  # kill on close + aggregate committed memory cap
            limits.jobLimit = MEMORY_LIMIT
            require(self.kernel.SetInformationJobObject(self.job, 9, C.byref(limits), C.sizeof(limits)))
            args = [str(executable), '--headless=new', '--no-first-run', '--no-default-browser-check',
                    '--disable-background-networking', '--disable-component-update', '--disable-sync',
                    '--disable-crash-reporter', '--disable-breakpad', '--disable-extensions',
                    '--disable-features=MediaRouter,OptimizationHints', '--remote-debugging-address=127.0.0.1',
                    '--remote-debugging-port=0', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=127.0.0.1',
                    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
                    '--user-data-dir='+str(profile), 'about:blank']
            # Suspend before assignment so no child escapes ownership during startup.
            self.process = subprocess.Popen(args, stdout=self.log, stderr=self.log,
                creationflags=subprocess.CREATE_NO_WINDOW | 0x4)
            require(self.kernel.AssignProcessToJobObject(self.job, int(self.process._handle)))
            self.assigned = True
            ntdll = C.WinDLL('ntdll'); ntdll.NtResumeProcess.argtypes = [W.HANDLE]
            if ntdll.NtResumeProcess(int(self.process._handle)) != 0:
                raise RuntimeError('Cannot resume owned browser')
        except BaseException:
            self.close()
            raise

    def pids(self):
        class PIDS(C.Structure):
            _fields_ = [('assigned', W.DWORD), ('listed', W.DWORD), ('ids', C.c_size_t * 4096)]
        value = PIDS()
        require(self.kernel.QueryInformationJobObject(self.job, 3, C.byref(value), C.sizeof(value), None))
        return list(value.ids[:value.listed])

    def sample(self):
        pids = self.pids(); total = 0; missing = []
        for pid in pids:
            handle = self.kernel.OpenProcess(0x400 | 0x10, False, pid)
            if not handle:
                missing.append(pid); continue
            try:
                value = MEMORY(); value.cb = C.sizeof(value)
                if self.psapi.GetProcessMemoryInfo(handle, C.byref(value), value.cb):
                    total += value.workingSet
                else:
                    missing.append(pid)
            finally:
                self.kernel.CloseHandle(handle)
        limits = EXTENDED()
        require(self.kernel.QueryInformationJobObject(self.job, 9, C.byref(limits), C.sizeof(limits), None))
        return {'pids': pids, 'working_set_bytes': None if missing else total,
                'unmeasured_pids': missing, 'job_peak_commit_bytes': limits.peakJob,
                'system_available_physical_bytes': available_memory(self.kernel)}

    def close(self):
        cleanup = {'remaining_owned_pids_before_cleanup':self.pids()} if self.job else {}
        if self.job:
            self.kernel.TerminateJobObject(self.job, 1)
            if self.process:
                if not self.assigned and self.process.poll() is None:
                    self.process.kill()
                self.process.wait(timeout=10)
            for _ in range(50):
                if not self.pids():
                    break
                time.sleep(.1)
            cleanup['remaining_owned_pids_after_cleanup'] = self.pids()
            self.kernel.CloseHandle(self.job); self.job = None
        if self.process and self.process.poll() is None:
            self.process.kill(); self.process.wait(timeout=10)
        self.log.close()
        return cleanup


async def stop_browser(owned, browser):
    graceful = False
    try:
        session = await browser.new_browser_cdp_session()
        await asyncio.wait_for(session.send('Browser.close'), 5)
        graceful = True
    except Exception:
        pass
    for _ in range(50):
        if not owned.pids():
            return {'all_owned_processes_exited': True, 'graceful': graceful, 'forced': False}
        await asyncio.sleep(.1)
    require(owned.kernel.TerminateJobObject(owned.job, 1))
    for _ in range(50):
        if not owned.pids():
            return {'all_owned_processes_exited': True, 'graceful': graceful, 'forced': True}
        await asyncio.sleep(.1)
    raise RuntimeError('Owned browser processes survived termination; do not restart')


async def phase(runtime, executable, profile, origin, size, name, folder, record):
    # DevToolsActivePort belongs to the previous incarnation of this owned profile only.
    (profile / 'DevToolsActivePort').unlink(missing_ok=True)
    owned = OwnedBrowser(executable, profile, folder / (name+'-chromium.log'))
    record['launch_pid'] = owned.process.pid
    record['peak_working_set_bytes'] = None
    record['peak_job_commit_bytes'] = 0
    browser = None
    try:
        with (folder / (name+'-memory.jsonl')).open('w', encoding='utf-8') as samples:
            async def monitor():
                while True:
                    sample = owned.sample(); sample['elapsed_s'] = round(time.monotonic()-record['_start'], 3)
                    samples.write(json.dumps(sample)+'\n'); samples.flush()
                    ws = sample['working_set_bytes']
                    if ws is not None:
                        record['peak_working_set_bytes'] = max(record['peak_working_set_bytes'] or 0, ws)
                    record['peak_job_commit_bytes'] = max(record['peak_job_commit_bytes'], sample['job_peak_commit_bytes'])
                    record['last_sample'] = sample
                    record['memory_samples'] = record.get('memory_samples',0)+1
                    record['unmeasured_samples'] = record.get('unmeasured_samples',0)+bool(sample['unmeasured_pids'])
                    if ws is not None and ws > MEMORY_LIMIT:
                        raise RuntimeError('working_set_limit_exceeded')
                    if sample['job_peak_commit_bytes'] >= MEMORY_LIMIT:
                        raise RuntimeError('job_commit_limit_reached')
                    if record.get('renderer_crashed'):
                        raise RuntimeError('renderer_crashed')
                    if sample['system_available_physical_bytes'] is not None and sample['system_available_physical_bytes'] < 2*GIB:
                        raise RuntimeError('system_available_physical_below_2_GiB')
                    await asyncio.sleep(.25)

            async def exercise():
                nonlocal browser
                active_port = profile / 'DevToolsActivePort'
                while not active_port.exists():
                    if owned.process.poll() is not None:
                        raise RuntimeError('Browser exited before CDP startup')
                    await asyncio.sleep(.1)
                port = int(active_port.read_text().splitlines()[0])
                browser = await runtime.chromium.connect_over_cdp(f'http://127.0.0.1:{port}')
                record['browser_version'] = browser.version
                if not browser.version.startswith('151.'):
                    raise RuntimeError('Chromium 151 required, got '+browser.version)
                context = browser.contexts[0]
                record.update(blocked_requests=[], blocked_websockets=0, page_errors=[])

                async def local_only(route):
                    parsed = urlsplit(route.request.url)
                    if (parsed.scheme+'://'+parsed.netloc == origin and route.request.method == 'GET'
                            and not parsed.path.startswith(('/api', '/sw'))):
                        if route.request.is_navigation_request():
                            response = await route.fetch()
                            await route.fulfill(response=response, headers={**response.headers,
                                'content-security-policy': "worker-src 'none'; connect-src 'self'"})
                        else:
                            await route.continue_()
                    else:
                        if len(record['blocked_requests']) < 20:
                            record['blocked_requests'].append(route.request.url[:250])
                        await route.abort()

                def block_socket(socket):
                    record['blocked_websockets'] += 1
                    asyncio.create_task(socket.close())

                await context.route('**/*', local_only)
                await context.route_web_socket('**/*', block_socket)
                await context.add_init_script("navigator.serviceWorker.register=()=>Promise.reject(new Error('Capacity fixture blocks SW'))")
                page = await context.new_page()
                page.on('pageerror', lambda error: record['page_errors'].append(str(error)[:1000]))
                page.on('crash', lambda _: record.update(renderer_crashed=True))
                def progress(message):
                    value = message.text
                    if value.startswith('CAPACITY '):
                        record['progress'] = json.loads(value[9:])
                        record['progress']['elapsed_s'] = round(time.monotonic()-record['_start'], 3)
                        if record['progress']['stage'].endswith(('verified','complete')):
                            record.setdefault('checkpoints',[]).append(dict(record['progress']))
                        print(json.dumps({'size': size, 'phase': name, **record['progress']}), flush=True)
                page.on('console', progress)
                path = quote((ROOT / 'tests/fixtures/storage-capacity.html').as_posix(), safe='/:')
                await page.goto(origin+'/@fs/'+path)
                await page.wait_for_function('window.__CAPACITY_READY__ === true', timeout=60000)
                await page.evaluate('([size,phase])=>{window.startCapacity(size,phase);}', [size,name])
                await page.wait_for_function('window.__CAPACITY_RESULT__ !== undefined', timeout=0)
                record['result'] = await page.evaluate('window.__CAPACITY_RESULT__')
                record['shutdown'] = await stop_browser(owned, browser)
                return record['result']['ok'] and not record['page_errors'] and not record['blocked_requests']

            watchdog = asyncio.create_task(monitor()); work = asyncio.create_task(exercise())
            try:
                finished, _ = await asyncio.wait([watchdog,work], return_when=asyncio.FIRST_COMPLETED)
                if watchdog in finished:
                    await watchdog
                return await work
            finally:
                if not work.done():
                    # A stalled CDP cleanup needs the owned browser to disconnect first.
                    record['final_sample'] = owned.sample()
                    record['cleanup'] = owned.close()
                for task in (work,watchdog):
                    task.cancel()
                await asyncio.gather(work,watchdog,return_exceptions=True)
    finally:
        if owned.job:
            record['final_sample'] = owned.sample()
        if 'cleanup' not in record:
            record['cleanup'] = owned.close()
        record['browser_exit_code'] = owned.process.returncode


async def case(runtime, executable, origin, size, folder, profile=None, phases=('save','reload')):
    folder.mkdir()
    if profile is None:
        profile = folder / 'owned-fiction-profile'; profile.mkdir()
    report = {'target_utf8_json_bytes':size, 'profile':str(profile), 'ok':False, 'phases':[]}
    start = time.monotonic()
    try:
        async with asyncio.timeout(SECONDS_LIMIT):
            for name in phases:
                record = {'phase':name, '_start':start}; report['phases'].append(record)
                if not await phase(runtime, executable, profile, origin, size, name, folder, record):
                    raise RuntimeError(name+' verification failed')
        report['ok'] = True
    except Exception as error:
        report['failure'] = {'name':type(error).__name__, 'message':str(error) or '480 second per-size deadline exceeded'}
    finally:
        report['elapsed_s'] = time.monotonic()-start
        for record in report['phases']:
            record.pop('_start', None)
        (folder / 'result.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    return report


async def main(args):
    if os.name != 'nt':
        raise SystemExit('Windows Job Object safety required for this runner')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    previous = None
    if args.diagnostic:
        previous_run = Path(args.diagnostic).resolve()
        if previous_run.parent != OUTPUT.resolve():
            raise SystemExit('Diagnostic must reference an owned run directly under '+str(OUTPUT))
        previous = json.loads((previous_run/'results.json').read_text(encoding='utf-8'))
        existing = next(c for c in previous['cases'] if c['target_utf8_json_bytes']==1_000_000_000)
        profile = Path(existing['profile']).resolve()
        if (not profile.is_relative_to(previous_run) or not profile.is_dir()
                or not any(p.get('result',{}).get('ok') and p['phase']=='save' for p in existing['phases'])):
            raise SystemExit('Existing owned 1 GB fictional profile with successful save required')
        parsed = urlsplit(previous['origin'])
        if parsed.scheme!='http' or parsed.hostname!='127.0.0.1' or not parsed.port:
            raise SystemExit('Previous origin must be a random loopback fixture')
    run = OUTPUT / (time.strftime('%Y%m%d-%H%M%S')+('-diagnostic-' if previous else '-')+uuid.uuid4().hex[:8]); run.mkdir()
    report = {'fictional_only':True, 'production_capacity_claim':False, 'run':str(run), 'cases':[],
        'limits':{'per_size_seconds':SECONDS_LIMIT,'aggregate_working_set_bytes':MEMORY_LIMIT,
                  'aggregate_job_commit_bytes':MEMORY_LIMIT,'system_available_physical_floor_bytes':2*GIB,
                  'sampling_seconds':.25},
        'memory_semantics':'Sum of current GetProcessMemoryInfo WorkingSetSize for all live PIDs in an owned Windows Job Object; shared pages may be counted more than once; sampled peak, not private bytes or JS heap. Null when a PID cannot be sampled. Job peak committed bytes is a separate OS high-water mark; a 4 GiB hard job commit cap remains active even if working set is unmeasured.',
        'fixture':'One conversation, independently decoded deterministic 64 KiB message buffers with Unicode, quotes, backslash and newline; no shared repeated body strings. Full decoded object tree remains resident as in appStore; this synthetic distribution is not an operational limit.',
        'network':'Random 127.0.0.1 Vite port; exact-origin GET allowlist, API blocked, all WebSockets closed, SW registration blocked and worker-src none; browser background networking disabled, dead loopback proxy and external DNS denied.',
        'source_sha256':{str(path.relative_to(ROOT)):hashlib.file_digest(path.open('rb'),'sha256').hexdigest() for path in
            [ROOT/'tests/e2e_storage_capacity.py',ROOT/'tests/fixtures/storage-capacity.html',ROOT/'apps/web/src/lib/appStore.ts',ROOT/'apps/web/src/lib/segmentedStorage.ts',ROOT/'apps/web/src/lib/appTransfers.ts',ROOT/'apps/web/src/lib/jsonStream.ts',ROOT/'apps/web/src/mobile/sha256.ts']}}
    try:
        config = run / 'vite.capacity.mjs'
        config.write_text('import config from '+json.dumps((ROOT/'apps/web/vite.config.ts').as_posix())+';\n'
            'export default env => { const base=config(env); return {...base, cacheDir:'+json.dumps((run/'vite-cache').as_posix())+
            ', optimizeDeps:{noDiscovery:true,include:["react"]}, server:{...base.server,proxy:{},hmr:false}}; };\n', encoding='utf-8')
        popen = subprocess.Popen
        def isolated_server(command, **kwargs):
            if len(command)>1 and Path(command[1]) == ROOT/'apps/web/node_modules/vite/bin/vite.js':
                command = [*command, '--config', str(config), '--configLoader', 'runner']
            return popen(command, **kwargs)
        class SameOriginSocket(socket.socket):
            def bind(self, address):
                # IndexedDB is origin-scoped: reuse the original randomly allocated port, or fail if occupied.
                return super().bind(('127.0.0.1',parsed.port) if address==('127.0.0.1',0) else address)
        server = local_vite(run)
        with patch('browser_fixture_server.subprocess.Popen', isolated_server), \
                (patch('browser_fixture_server.socket.socket',SameOriginSocket) if previous else nullcontext()):
            origin = await server.__aenter__()
        try:
          async with async_playwright() as runtime:
            report['origin'] = origin
            executable = Path(args.chromium) if args.chromium else Path(runtime.chromium.executable_path)
            report['executable'] = str(executable)
            if previous:
                report['diagnostic'] = {'previous_run':str(previous_run), 'order':'appStore.entity -> body hash/count -> physical verify',
                    'fresh_browser':True, 'original_random_origin_reused':True, 'forced_gc':False, 'limits_unchanged':True}
                result = await case(runtime,executable,origin,1_000_000_000,run/'1000000000',profile,
                    phases=('restore-first-diagnostic',))
                report['cases'].append(result)
            sizes = [] if previous else [1_234_567] if args.self_check else [250_000_000,1_000_000_000]
            for size in sizes:
                available = available_memory(winapi())
                if size == 1_000_000_000:
                    previous_case = report['cases'][-1]
                    peaks = [p['peak_working_set_bytes'] for p in previous_case['phases']]
                    gate = previous_case['ok'] and all(p is not None and p < 2*GIB for p in peaks) and available is not None and available >= 6*GIB
                    report['one_gb_gate'] = {'allowed':gate,'previous_peaks':peaks,'available_physical_bytes':available,
                        'rule':'250 MB success; measured peak below 2 GiB in both phases; at least 6 GiB available physical memory'}
                    if not gate:
                        report['cases'].append({'target_utf8_json_bytes':size,'ok':False,'not_run':'250 MB success/headroom gate not met'})
                        break
                result = await case(runtime, executable, origin, size, run / str(size))
                report['cases'].append(result)
                (run / 'results.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        finally:
            await server.__aexit__(None,None,None)
    finally:
        report['ok'] = len(report['cases']) == (1 if args.self_check or previous else 2) and all(c['ok'] for c in report['cases'])
        (run / 'results.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps({'ok':report['ok'],'report':str(run/'results.json')}), flush=True)
    return report['ok']


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--run', action='store_true', help='Explicitly opt in to 250 MB then gated 1 GB')
    mode.add_argument('--self-check', action='store_true', help='Small real save/exit/relaunch/hash acceptance')
    mode.add_argument('--diagnostic', metavar='PREVIOUS_RUN', help='Separate restore-first diagnosis on an existing owned 1 GB profile')
    parser.add_argument('--chromium', help='Existing Chromium 151 executable, no installation')
    args = parser.parse_args()
    if not (args.run or args.self_check or args.diagnostic):
        parser.print_help()
    else:
        raise SystemExit(0 if asyncio.run(main(args)) else 1)
