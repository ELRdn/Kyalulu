"""Local-only hardware measurements. Never label client memory as inference memory."""
import asyncio
import platform
import shutil
import subprocess
import psutil


def hardware_metadata():
    gpu = None
    if shutil.which("nvidia-smi"):
        try:
            gpu = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
                capture_output=True, text=True, timeout=3,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout.strip() or None
        except (OSError, subprocess.TimeoutExpired):
            pass
    return {"cpu": platform.processor() or platform.machine(), "ram_bytes": psutil.virtual_memory().total,
        "os": platform.platform(), "python": platform.python_version(), "gpu": gpu,
        "gpu_unavailable_reason": None if gpu else "No supported GPU telemetry interface",
        "scope": "runtime host (not necessarily inference host)", "backend_version": None}


class MemorySampler:
    def __init__(self):
        self.peak = 0
        self.task = None

    async def __aenter__(self):
        async def sample():
            process = psutil.Process()
            while True:
                self.peak = max(self.peak, process.memory_info().rss)
                await asyncio.sleep(0.1)
        self.task = asyncio.create_task(sample())
        self.peak = psutil.Process().memory_info().rss
        return self

    async def __aexit__(self, *args):
        self.task.cancel()
        try:
            await self.task
        except asyncio.CancelledError:
            pass
