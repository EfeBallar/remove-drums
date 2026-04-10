#!/usr/bin/env python3
"""
Helper script: process a single audio file for drum removal.
Called by the FastAPI backend as a subprocess.

Usage:
    python3 process_one.py <file_path> <songs_dir>

Outputs JSON progress lines to stdout, ending with a __result__ line.
"""

import json
import sys
from pathlib import Path


def main():
    if len(sys.argv) != 3:
        print(
            json.dumps(
                {
                    "__result__": True,
                    "success": False,
                    "error": "Usage: process_one.py <file_path> <songs_dir>",
                }
            ),
            flush=True,
        )
        sys.exit(1)

    file_path = sys.argv[1]
    songs_dir = sys.argv[2]

    # Add the project root (three levels up from this file: web/backend/process_one.py)
    root = Path(__file__).parent.parent.parent
    sys.path.insert(0, str(root))

    try:
        from remove_drums_batch import find_ffmpeg, fix_macos_ssl, process_song_worker
    except ImportError as e:
        print(
            json.dumps(
                {
                    "__result__": True,
                    "success": False,
                    "error": f"Could not import remove_drums_batch: {e}",
                }
            ),
            flush=True,
        )
        sys.exit(1)

    fix_macos_ssl()

    ffmpeg_bin = find_ffmpeg()
    if not ffmpeg_bin:
        print(
            json.dumps(
                {
                    "__result__": True,
                    "success": False,
                    "error": "ffmpeg not found. Install with: brew install ffmpeg",
                }
            ),
            flush=True,
        )
        sys.exit(1)

    # process_song_worker takes a single tuple argument (designed for ProcessPoolExecutor)
    result = process_song_worker((file_path, songs_dir, ffmpeg_bin, 1))

    song_name, success, error = result
    print(
        json.dumps(
            {"__result__": True, "success": success, "error": error, "file": file_path}
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
