# DrumLess

Remove drums from any song using [Demucs](https://github.com/facebookresearch/demucs) (htdemucs_6s model). Comes with a modern web UI and a CLI batch script.

---

## Requirements

| Tool | Version | Install |
|------|---------|---------|
| Python | 3.10+ | [python.org](https://python.org) |
| Node.js | 18+ | [nodejs.org](https://nodejs.org) |
| ffmpeg | any | `brew install ffmpeg` |

---

## First-time Setup (fresh clone)

**1. Create the Python virtual environment and install dependencies**

```bash
python3 -m venv venv
venv/bin/pip install demucs soundfile scipy certifi torch
```

> The first run also downloads the Demucs model weights (~200 MB) into `~/.cache/torch/hub/`. This only happens once.

**2. Make sure ffmpeg is installed**

```bash
brew install ffmpeg          # macOS
# sudo apt install ffmpeg    # Linux
```

**3. Add your music**

Create an artist folder and drop audio files inside:

```
remove-drums/
  my-artist/
    song1.m4a
    song2.mp3
    song3.wav
```

Any folder in the root (except `venv/` and `web/`) is scanned automatically. Supported formats: `.m4a` `.mp3` `.wav` `.flac` `.aac` `.ogg`.

---

## Web UI (recommended)

```bash
bash web/start.sh
```

This will:
- Install FastAPI + Uvicorn into the venv (if needed)
- Install frontend npm packages (if needed)
- Start the API server on **http://localhost:8000**
- Start the UI on **http://localhost:5173**

Open **http://localhost:5173**, select songs, click **Remove Drums**, and watch the live output log.

Press `Ctrl+C` to stop both servers.

### UI overview

```
┌─────────────────────────────────────────────────────────────┐
│  🥁 DrumLess                     2 selected  [Remove Drums] │
├──────────────────────────┬──────────────────────────────────┤
│  Files                   │  Output                         │
│                          │                                 │
│  ▼ my-artist             │  12:01:34  Starting — 2 files…  │
│    ☑ song1.m4a           │  12:01:35  Loading model…       │
│    ☑ song2.mp3           │  12:02:10  ✓ Done: song1.m4a    │
│    ✓ song3  ✔ done       │  12:03:44  ✓ Done: song2.mp3    │
│                          │  12:03:44  All jobs complete!   │
└──────────────────────────┴──────────────────────────────────┘
```

- **Folder checkbox** — selects / deselects all songs in that folder
- **✔ done** badge — song already has a drumless version; can be re-processed
- **⚠ partial** badge — original file exists but drumless output is missing

---

## CLI

Process all songs in a folder in parallel:

```bash
venv/bin/python remove_drums_batch.py ./my-artist
```

Options:

```bash
# Use a specific number of parallel workers (default: half your CPU cores)
venv/bin/python remove_drums_batch.py ./my-artist --workers 4

# Sequential mode (lower memory usage)
venv/bin/python remove_drums_batch.py ./my-artist --workers 1

# Skip the pip install check if deps are already installed
venv/bin/python remove_drums_batch.py ./my-artist --skip-install
```

---

## Output structure

After processing, originals are moved into per-song subfolders alongside the drumless output:

```
my-artist/
  song1/
    song1.m4a               ← original (moved here)
    song1_drumless.m4a      ← drums removed
  song2/
    song2.mp3
    song2_drumless.m4a
```

---

## Project structure

```
remove-drums/
├── remove_drums_batch.py   ← CLI batch processor (also used by the web backend)
├── web/
│   ├── start.sh            ← starts both servers
│   ├── backend/
│   │   ├── server.py       ← FastAPI: file scanning + SSE job streaming
│   │   └── process_one.py  ← subprocess wrapper called per song
│   └── frontend/           ← React + TypeScript + Tailwind (Vite)
└── venv/                   ← Python virtualenv (created by you, not in git)
```

---

## Troubleshooting

**"ffmpeg not found"**
Install it with `brew install ffmpeg` and make sure it's on your `PATH`.
