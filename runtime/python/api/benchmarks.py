"""One persisted benchmark job at a time; closing the UI does not abort a run."""
import asyncio
from uuid import UUID

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from python.core import benchmark

router = APIRouter(prefix="/benchmarks")
tasks: dict[str, asyncio.Task] = {}


@router.get("")
async def list_jobs():
    return {"jobs": benchmark.list_jobs()[:50]}


@router.post("", status_code=202)
async def start_job(body: benchmark.BenchmarkRequest):
    id_ = str(body.request_id)
    previous = benchmark.read_job(id_)
    if previous:
        if previous["request"] != body.model_dump(mode="json"):
            raise HTTPException(409, "同じ要求IDに異なる実験条件は使えません")
        return previous
    if any(not task.done() for task in tasks.values()):
        raise HTTPException(409, "比較実験が実行中です。完了または中止してから開始してください")
    try:
        job, matrix = benchmark.prepare_job(body)
    except FileNotFoundError:
        raise HTTPException(404, "シナリオが見つかりません") from None
    benchmark.save_job(job)
    task = asyncio.create_task(benchmark.execute_job(job, matrix, body))
    tasks[id_] = task
    task.add_done_callback(lambda _: tasks.pop(id_, None))
    return job


@router.get("/{job_id}")
async def get_job(job_id: UUID):
    job = benchmark.read_job(str(job_id))
    if not job:
        raise HTTPException(404, "実験が見つかりません")
    return job


@router.get("/{job_id}/export")
async def export_job(job_id: UUID):
    return JSONResponse(await get_job(job_id), headers={"Content-Disposition": 'attachment; filename="benchmark.json"'})


@router.post("/{job_id}/cancel")
async def cancel_job(job_id: UUID):
    id_ = str(job_id)
    job = await get_job(job_id)
    task = tasks.get(id_)
    if task and not task.done():
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        # A queued task can be cancelled before its coroutine starts.
        job = benchmark.read_job(id_)
        if job["status"] == "queued":
            job["status"] = "cancelled"
            benchmark.save_job(job)
    return benchmark.read_job(id_)


async def shutdown():
    pending = list(tasks.values())
    for task in pending:
        task.cancel()
    await asyncio.gather(*pending, return_exceptions=True)
