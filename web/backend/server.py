#!/usr/bin/env python3
"""
FastAPI backend for the DrumLess web UI.

Endpoints:
  GET  /api/files           - scan root directory, return file tree
  POST /api/process         - start a drum removal job, return job_id
  GET  /api/stream/{job_id} - SSE stream of job progress
"""

import asyncio
import json
import os
import sys
import uuid
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent.parent  # remove-drums/
BACKEND_DIR = Path(__file__).resolve().parent  # remove-drums/web/backend/
PROCESS_ONE = BACKEND_DIR / "process_one.py"

AUDIO_EXTENSIONS = {".m4a", ".mp3", ".wav", ".flac", ".aac", ".ogg"}
EXCLUDE_DIRS = {
    "venv",
    "web",
    "__pycache__",
    ".git",
    "_tmp",
    "node_modules",
    ".DS_Store",
}

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="DrumLess API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# In-memory job store  {job_id: asyncio.Queue}
# ---------------------------------------------------------------------------
jobs: Dict[str, asyncio.Queue] = {}

# ---------------------------------------------------------------------------
# File scanning
# ---------------------------------------------------------------------------


def _scan_song_folder(folder: Path) -> Optional[dict]:
    """
    Inspect a subdirectory of an artist folder.
    Returns a 'song' item if it looks like a processed/partial song folder.
    """
    original_file: Optional[str] = None
    drumless_file: Optional[str] = None

    try:
        for f in sorted(folder.iterdir()):
            if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS:
                rel = str(f.relative_to(ROOT))
                if "_drumless" in f.stem:
                    drumless_file = rel
                else:
                    original_file = rel
    except PermissionError:
        return None

    # Only treat as a song folder if there's at least one relevant audio file
    if original_file is None and drumless_file is None:
        return None

    status = "done" if (original_file and drumless_file) else "partial"
    return {
        "type": "song",
        "name": folder.name,
        "path": str(folder.relative_to(ROOT)),
        "status": status,
        "originalFile": original_file,
        "drumlessFile": drumless_file,
    }


def _scan_artist_folder(folder: Path) -> dict:
    """Scan a top-level folder (artist) and return a folder tree item."""
    children: list = []

    try:
        entries = sorted(folder.iterdir(), key=lambda p: (p.is_dir(), p.name.lower()))
    except PermissionError:
        entries = []

    for entry in entries:
        if entry.name.startswith(".") or entry.name in EXCLUDE_DIRS:
            continue

        if entry.is_file() and entry.suffix.lower() in AUDIO_EXTENSIONS:
            children.append(
                {
                    "type": "audio",
                    "name": entry.name,
                    "path": str(entry.relative_to(ROOT)),
                    "status": "pending",
                    "originalFile": str(entry.relative_to(ROOT)),
                    "drumlessFile": None,
                }
            )
        elif entry.is_dir():
            song = _scan_song_folder(entry)
            if song:
                children.append(song)

    return {
        "type": "folder",
        "name": folder.name,
        "path": folder.name,
        "children": children,
    }


def scan_root() -> list:
    """Return the full file tree for the root directory."""
    items = []

    try:
        entries = sorted(ROOT.iterdir(), key=lambda p: (p.is_dir(), p.name.lower()))
    except PermissionError:
        return items

    for entry in entries:
        if entry.name.startswith(".") or entry.name in EXCLUDE_DIRS:
            continue

        if entry.is_file() and entry.suffix.lower() in AUDIO_EXTENSIONS:
            items.append(
                {
                    "type": "audio",
                    "name": entry.name,
                    "path": entry.name,
                    "status": "pending",
                    "originalFile": entry.name,
                    "drumlessFile": None,
                }
            )
        elif entry.is_dir():
            items.append(_scan_artist_folder(entry))

    return items


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/api/files")
def list_files():
    return {"items": scan_root()}


# ---------------------------------------------------------------------------
# Processing helpers
# ---------------------------------------------------------------------------


class ProcessRequest(BaseModel):
    files: List[str]  # relative paths (from ROOT) to the original audio files


def _get_songs_dir(file_rel: str) -> str:
    """
    Determine the 'songs_dir' argument for process_song_worker.

    Rules:
      - file directly in ROOT      → ROOT
      - file in artist/            → ROOT/artist  (unprocessed)
      - file in artist/song/       → ROOT/artist  (already processed, re-run)
    """
    parts = Path(file_rel).parts
    if len(parts) == 1:
        return str(ROOT)
    # Always use the top-level folder as songs_dir
    return str(ROOT / parts[0])


def _find_python() -> str:
    """Prefer the project venv's Python; fall back to the running interpreter."""
    candidates = [
        ROOT / "venv" / "bin" / "python3",
        ROOT / "venv" / "bin" / "python",
        ROOT / ".venv" / "bin" / "python3",
    ]
    for c in candidates:
        if c.exists() and os.access(c, os.X_OK):
            return str(c)
    return sys.executable


# ---------------------------------------------------------------------------
# Subprocess stdout reader (top-level so it can be a clean asyncio.Task)
# ---------------------------------------------------------------------------


async def _read_proc_lines(
    stream: asyncio.StreamReader,
    queue: asyncio.Queue,
    file_name: str,
    file_rel: str,
) -> bool:
    """
    Read lines from a subprocess stdout stream until EOF (or cancellation),
    forwarding each line as a queue event.

    Returns True if the ``__result__`` sentinel emitted by process_one.py
    was successfully received and parsed — callers use this to decide whether
    to synthesise a fallback success/error event.

    Why a separate coroutine?
    ─────────────────────────
    asyncio's ``async for stream:`` only ends when the pipe write-end is closed.
    PyTorch (imported inside process_song_worker) can leave background threads /
    resource-tracker processes that keep the write-end of the pipe alive even
    after process_one.py's main thread exits.  Running this reader as a Task
    lets _run_processing await proc.wait() independently and then enforce a
    drain timeout before force-closing the stream with feed_eof().
    """
    result_received = False

    while True:
        try:
            raw = await stream.readline()
        except asyncio.CancelledError:
            # Propagate so the task is properly cancelled
            raise
        except Exception:
            break

        if not raw:  # b"" → EOF
            break

        line = raw.decode("utf-8", errors="replace").rstrip()
        if not line:
            continue

        # ── Structured result sentinel emitted by process_one.py ────────────
        try:
            data = json.loads(line)
            if isinstance(data, dict) and "__result__" in data:
                result_received = True
                if data.get("success"):
                    await queue.put(
                        {
                            "type": "success",
                            "message": f"✅ Done: {file_name}",
                            "file": file_rel,
                        }
                    )
                else:
                    err = data.get("error") or "unknown error"
                    await queue.put(
                        {
                            "type": "error",
                            "message": f"❌ Failed: {file_name} — {err}",
                            "file": file_rel,
                        }
                    )
                # Don't forward the raw JSON sentinel to the log panel
                continue
        except (json.JSONDecodeError, TypeError):
            pass

        # ── Plain log line ───────────────────────────────────────────────────
        await queue.put({"type": "log", "message": line})

    return result_received


# ---------------------------------------------------------------------------
# Main background processing task
# ---------------------------------------------------------------------------


async def _run_processing(job_id: str, files: List[str], queue: asyncio.Queue):
    """
    Process each selected file sequentially, streaming progress to *queue*.

    Robustness guarantees
    ─────────────────────
    • proc.wait() and stdout reading run concurrently so that a pipe that
      doesn't reach EOF (zombie grandchild processes keeping the write-end
      open) never causes an indefinite hang.
    • After proc.wait() returns we give the reader a 10-second drain window.
      If the reader is still blocked we call feed_eof() to unblock readline()
      and then cancel the task.
    • If the __result__ sentinel was never received we synthesise a
      success/error event from the exit code so the UI always gets feedback.
    • An outer try/except guarantees that {"type": "done"} is ALWAYS the last
      message put on the queue, even if an unexpected exception escapes every
      inner guard.  Without this the SSE stream would run forever.
    """
    python_bin = _find_python()
    total = len(files)

    try:
        await queue.put(
            {"type": "info", "message": f"🎵 Starting — {total} file(s) to process"}
        )
        await queue.put({"type": "info", "message": f"🐍 Python: {python_bin}"})

        for idx, file_rel in enumerate(files, 1):
            file_path = str(ROOT / file_rel)
            songs_dir = _get_songs_dir(file_rel)
            file_name = Path(file_rel).name

            await queue.put(
                {"type": "info", "message": f"\n[{idx}/{total}] ▶  {file_name}"}
            )

            cmd = [python_bin, str(PROCESS_ONE), file_path, songs_dir]

            try:
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                    cwd=str(ROOT),
                )

                assert proc.stdout is not None

                # ── Launch reader as a concurrent task ───────────────────────
                read_task: asyncio.Task = asyncio.create_task(
                    _read_proc_lines(proc.stdout, queue, file_name, file_rel)
                )

                # ── Wait for the subprocess itself to exit ───────────────────
                # This returns as soon as process_one.py's main thread is done,
                # regardless of whether the stdout pipe is closed yet.
                await proc.wait()

                # ── Drain remaining buffered output (with timeout) ───────────
                # The process has exited but background threads/grandchild
                # processes spawned by PyTorch may still hold the write-end of
                # the pipe open.  We give the reader 10 s to finish naturally;
                # if it doesn't we force EOF so readline() unblocks immediately.
                result_received: bool = False
                try:
                    # asyncio.shield keeps read_task alive even if wait_for is
                    # cancelled; we want the task to keep running until we
                    # explicitly cancel it below.
                    result_received = await asyncio.wait_for(
                        asyncio.shield(read_task), timeout=10.0
                    )
                except asyncio.TimeoutError:
                    # Force EOF on the asyncio StreamReader — any pending
                    # readline() call will immediately return b"".
                    proc.stdout.feed_eof()
                    read_task.cancel()
                    try:
                        result_received = await read_task
                    except (asyncio.CancelledError, Exception):
                        result_received = False
                    await queue.put(
                        {
                            "type": "error",
                            "message": (
                                f"⚠️ stdout stream did not close within 10 s after "
                                f"process exit — possible zombie grandchild process "
                                f"for {file_name}"
                            ),
                        }
                    )

                # ── Synthesise result event if sentinel never arrived ────────
                # This covers the timeout case above AND any situation where
                # process_one.py crashed before it could print the JSON line.
                if not result_received:
                    if proc.returncode == 0:
                        await queue.put(
                            {
                                "type": "success",
                                "message": f"✅ Done: {file_name}",
                                "file": file_rel,
                            }
                        )
                    else:
                        await queue.put(
                            {
                                "type": "error",
                                "message": (
                                    f"❌ Failed: {file_name} "
                                    f"— exit code {proc.returncode}"
                                ),
                                "file": file_rel,
                            }
                        )
                elif proc.returncode not in (0, None):
                    # Sentinel arrived but process still exited non-zero
                    await queue.put(
                        {
                            "type": "error",
                            "message": (
                                f"❌ Process exited with code {proc.returncode} "
                                f"for {file_name}"
                            ),
                            "file": file_rel,
                        }
                    )

            except Exception as exc:
                await queue.put(
                    {
                        "type": "error",
                        "message": f"❌ Exception while processing {file_name}: {exc}",
                        "file": file_rel,
                    }
                )

        # All files done — this MUST always be reached so the SSE stream closes
        await queue.put({"type": "done", "message": "🎉 All jobs complete!"})

    except Exception as exc:
        # Outermost safety net: something unexpected escaped every inner guard.
        # Still send "done" so the frontend EventSource closes instead of
        # spinning forever.
        try:
            await queue.put(
                {"type": "error", "message": f"💥 Unexpected server error: {exc}"}
            )
            await queue.put(
                {
                    "type": "done",
                    "message": "⚠️ Processing ended due to an unexpected error.",
                }
            )
        except Exception:
            pass

    finally:
        # Give the SSE generator a moment to drain the queue before we remove
        # the job entry — if we popped it immediately the generator might call
        # queue.get() on a queue that no longer exists in the dict.
        await asyncio.sleep(2)
        jobs.pop(job_id, None)


# ---------------------------------------------------------------------------
# HTTP endpoints
# ---------------------------------------------------------------------------


@app.post("/api/process")
async def process_files(request: ProcessRequest):
    if not request.files:
        raise HTTPException(status_code=400, detail="No files specified")

    job_id = str(uuid.uuid4())
    queue: asyncio.Queue = asyncio.Queue()
    jobs[job_id] = queue

    asyncio.create_task(_run_processing(job_id, request.files, queue))

    return {"jobId": job_id}


# ---------------------------------------------------------------------------
# SSE stream
# ---------------------------------------------------------------------------


@app.get("/api/stream/{job_id}")
async def stream_job(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    queue = jobs[job_id]

    async def generate():
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=25.0)
            except asyncio.TimeoutError:
                # Keep-alive heartbeat — ignored by the frontend
                yield 'data: {"type":"ping"}\n\n'
                continue

            yield f"data: {json.dumps(event)}\n\n"

            if event.get("type") == "done":
                break

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
