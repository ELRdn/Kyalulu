"""Capacity watchdog recovery without starting a browser or Windows Job."""
import asyncio
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import time

import pytest


@pytest.mark.asyncio
@pytest.mark.parametrize('trigger', ['working_set', 'job_commit', 'system_memory', None])
async def test_capacity_watchdog_closes_owned_job_before_waiting_for_cancelled_cdp(
    tmp_path, monkeypatch, trigger,
):
    monkeypatch.syspath_prepend(str(Path(__file__).parent))
    spec = importlib.util.spec_from_file_location('capacity_driver_under_test',
        Path(__file__).with_name('e2e_storage_capacity.py'))
    driver = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(driver)
    assert driver.MEMORY_LIMIT == 4 * 1024**3 and driver.SECONDS_LIMIT == 480
    closed, started, cancelled = asyncio.Event(), asyncio.Event(), asyncio.Event()
    instances = []

    class Owned:
        def __init__(self, *args):
            self.job, self.samples, self.close_calls = True, 0, 0
            self.process = SimpleNamespace(pid=31337, returncode=None)
            instances.append(self)

        def sample(self):
            self.samples += 1
            over = self.samples > 1
            return {'pids': [31337], 'working_set_bytes': driver.MEMORY_LIMIT + 1 if over and trigger == 'working_set' else 1,
                'unmeasured_pids': [], 'job_peak_commit_bytes': driver.MEMORY_LIMIT if over and trigger == 'job_commit' else 1,
                'system_available_physical_bytes': 1024**3 if over and trigger == 'system_memory' else 8 * 1024**3}

        def close(self):
            self.close_calls += 1
            self.job = None
            self.process.returncode = 1
            closed.set()
            return {'remaining_owned_pids_before_cleanup': [31337], 'remaining_owned_pids_after_cleanup': []}

    async def blocked_cdp():
        started.set()
        if trigger is None:
            return True
        try:
            await asyncio.Future()
        except asyncio.CancelledError:
            # A stalled CDP cleanup cannot finish until its browser disconnects.
            cancelled.set()
            await closed.wait()

    create_task = asyncio.create_task

    def start_task(coroutine):
        if coroutine.cr_code.co_name == 'exercise':
            coroutine.close()
            return create_task(blocked_cdp())
        return create_task(coroutine)

    monkeypatch.setattr(driver, 'OwnedBrowser', Owned)
    monkeypatch.setattr(asyncio, 'create_task', start_task)
    profile, output = tmp_path / 'profile', tmp_path / 'output'
    profile.mkdir(); output.mkdir()
    record = {'_start': time.monotonic()}
    task = create_task(driver.phase(None, None, profile, 'http://127.0.0.1:12345',
        1234, 'fixture', output, record))
    try:
        await asyncio.wait_for(started.wait(), 5)
        if trigger is None:
            assert await asyncio.wait_for(task, 5) is True
        else:
            await asyncio.wait_for(cancelled.wait(), 5)
        closed_without_test_intervention = closed.is_set()
    finally:
        closed.set()
    if trigger is not None:
        with pytest.raises(RuntimeError, match={
            'working_set': 'working_set_limit_exceeded', 'job_commit': 'job_commit_limit_reached',
            'system_memory': 'system_available_physical_below_2_GiB',
        }[trigger]):
            await asyncio.wait_for(task, 5)
    assert closed_without_test_intervention
    assert instances[0].close_calls == 1
    assert record['cleanup']['remaining_owned_pids_after_cleanup'] == []
