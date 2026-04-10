#!/usr/bin/env python3
"""
Batch Drum Removal Script using Demucs (htdemucs_6s model)
Parallel processing: runs multiple songs simultaneously using all available CPU cores.

Input structure:
  artist1/
    song1.m4a
    song2.m4a
  artist2/
    song1.m4a
    song2.m4a
Output structure:
  artist1/
    song1/
      song1_drumless.m4a
    song2/
      song2_drumless.m4a
"""

import argparse
import os
import shutil
import subprocess
import sys
import multiprocessing
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path


def fix_macos_ssl():
    try:
        import ssl, certifi
        os.environ["SSL_CERT_FILE"] = certifi.where()
        os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()
        _orig = ssl.create_default_context
        def patched(*args, **kwargs):
            ctx = _orig(*args, **kwargs)
            ctx.load_verify_locations(certifi.where())
            return ctx
        ssl.create_default_context = patched
    except Exception as e:
        print(f"⚠️  Could not patch SSL: {e}")


def install_dependencies():
    print("📦 Installing dependencies...")
    packages = ["certifi", "torch", "demucs", "soundfile", "numpy", "scipy"]
    for pkg in packages:
        print(f"   pip install {pkg}")
        subprocess.run([sys.executable, "-m", "pip", "install", pkg, "--quiet"])
    print("✅ Dependencies installed.\n")
    fix_macos_ssl()


def find_ffmpeg():
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return ffmpeg
    for path in [
        "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg",
        os.path.expanduser("~/Downloads/ffmpeg"),
        os.path.expanduser("~/bin/ffmpeg"), "/usr/bin/ffmpeg",
    ]:
        if os.path.isfile(path) and os.access(path, os.X_OK):
            return path
    return None


def convert_to_wav(input_path: Path, tmp_dir: Path, ffmpeg_bin: str) -> Path:
    wav_path = tmp_dir / (input_path.stem + "_converted.wav")
    result = subprocess.run(
        [ffmpeg_bin, "-y", "-i", str(input_path),
         "-ar", "44100", "-ac", "2", "-acodec", "pcm_s16le", "-f", "wav", str(wav_path)],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"❌ ffmpeg conversion failed:\n{result.stderr}")
        sys.exit(1)
    return wav_path


def process_song_worker(args):
    """
    Worker function — runs in a separate process.
    Each worker loads its own model instance so GPU/CPU cores are used independently.
    """
    song_path_str, songs_dir_str, ffmpeg_bin, worker_id = args

    # Re-apply SSL fix in worker process (env isn't inherited on macOS)
    fix_macos_ssl()

    import torch
    import numpy as np
    import soundfile as sf
    from math import gcd
    from demucs.pretrained import get_model
    from demucs.apply import apply_model

    song_path = Path(song_path_str)
    songs_dir = Path(songs_dir_str)
    stem = song_path.stem

    def log(msg):
        print(f"   [worker {worker_id}] {msg}", flush=True)

    song_dir = songs_dir / stem
    song_dir.mkdir(exist_ok=True)

    # Move original into its folder
    dest_original = song_dir / song_path.name


    tmp_dir = song_dir / "_tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    try:
        # Load model (each worker gets its own instance)
        try:
            model = get_model("htdemucs_6s")
            model_name = "htdemucs_6s"
        except Exception:
            model = get_model("htdemucs")
            model_name = "htdemucs"
        model.eval()

        # Use CPU per worker to avoid GPU memory conflicts between parallel processes
        # If you have a powerful GPU and want GPU, change "cpu" to "cuda"
        device = torch.device("cpu")
        model.to(device)

        # Convert to WAV
        wav_path = convert_to_wav(dest_original, tmp_dir, ffmpeg_bin)

        # Load audio
        audio_np, sample_rate = sf.read(str(wav_path), dtype="float32", always_2d=True)
        audio_np = audio_np.T  # (channels, samples)
        wav = torch.from_numpy(audio_np)

        # Resample if needed
        if sample_rate != model.samplerate:
            from scipy.signal import resample_poly
            g = gcd(model.samplerate, sample_rate)
            up, down = model.samplerate // g, sample_rate // g
            resampled = resample_poly(audio_np, up, down, axis=1).astype("float32")
            wav = torch.from_numpy(resampled)

        # Fix channels
        if wav.shape[0] != model.audio_channels:
            if model.audio_channels == 1:
                wav = wav.mean(0, keepdim=True)
            else:
                wav = wav.repeat(model.audio_channels, 1)[:model.audio_channels]

        # Separate
        log("🎛️  Separating stems...")
        with torch.no_grad():
            sources = apply_model(model, wav.unsqueeze(0).to(device), progress=False)[0]
        sources = sources.cpu()

        # Mix non-drum stems
        stems = model.sources
        non_drum_mix = None
        for i, stem_name in enumerate(stems):
            stem_audio = sources[i].numpy().T
            if stem_name != "drums":
                non_drum_mix = stem_audio if non_drum_mix is None else non_drum_mix + stem_audio

        non_drum_mix = np.clip(non_drum_mix, -1.0, 1.0)

        # Save drumless
        drumless_wav = tmp_dir / f"{stem}_drumless.wav"
        sf.write(str(drumless_wav), non_drum_mix, model.samplerate)

        drumless_out = song_dir / f"{stem}_drumless.m4a"
        result = subprocess.run(
            [ffmpeg_bin, "-y", "-i", str(drumless_wav),
             "-c:a", "aac", "-b:a", "256k", str(drumless_out)],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            drumless_out = song_dir / f"{stem}_drumless.mp3"
            subprocess.run(
                [ffmpeg_bin, "-y", "-i", str(drumless_wav), "-b:a", "320k", str(drumless_out)],
                capture_output=True
            )

        shutil.rmtree(tmp_dir)
        log(f"✅ Done → {drumless_out.name}")
        return (song_path.name, True, None)

    except Exception as e:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        # Move original back on failure
        if dest_original.exists() and not song_path.exists():
            shutil.move(str(dest_original), str(song_path))
        return (song_path.name, False, str(e))


def process_folder(songs_dir: Path, ffmpeg_bin: str, workers: int):
    audio_extensions = {".m4a", ".mp3", ".wav", ".flac", ".aac", ".ogg"}
    song_files = sorted([
        f for f in songs_dir.iterdir()
        if f.is_file() and f.suffix.lower() in audio_extensions
    ])

    if not song_files:
        print(f"❌ No audio files found in {songs_dir}")
        sys.exit(1)

    # Cap workers to number of songs and available CPUs
    cpu_count = multiprocessing.cpu_count()
    workers = min(workers, len(song_files), cpu_count)

    print(f"🎵 Found {len(song_files)} song(s) | CPUs available: {cpu_count} | Workers: {workers}\n")
    for f in song_files:
        print(f"   • {f.name}")
    print()

    if workers == 1:
        print("ℹ️  Running sequentially (1 worker).\n")
    else:
        print(f"⚡ Running {workers} songs in parallel.\n")

    # Build args for each worker
    worker_args = [
        (str(f), str(songs_dir), ffmpeg_bin, i + 1)
        for i, f in enumerate(song_files)
    ]

    results = []
    with ProcessPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(process_song_worker, arg): arg[0] for arg in worker_args}
        completed = 0
        for future in as_completed(futures):
            completed += 1
            song_name, success, error = future.result()
            if success:
                print(f"[{completed}/{len(song_files)}] ✅ {song_name}")
            else:
                print(f"[{completed}/{len(song_files)}] ❌ {song_name}: {error}")
            results.append((song_name, success))

    print(f"\n🎉 All done! {sum(1 for _, ok in results if ok)}/{len(results)} succeeded.")
    print(f"   Output: {songs_dir}")


def main():
    cpu_count = multiprocessing.cpu_count()

    parser = argparse.ArgumentParser(
        description="Batch drum removal — parallel processing across CPU cores.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=f"""
Examples:
  python3 remove_drums_batch.py ./songs               # auto: use all {cpu_count} cores
  python3 remove_drums_batch.py ./songs --workers 4   # use 4 cores
  python3 remove_drums_batch.py ./songs --workers 1   # sequential (safe mode)

Output structure:
  songs/
    song1/
      song1.m4a            <- original (moved here)
      song1_drumless.m4a   <- drums removed
        """
    )
    parser.add_argument("folder", help="Folder containing audio files")
    parser.add_argument(
        "--workers", type=int, default=max(1, cpu_count // 2),
        help=f"Number of parallel workers (default: {max(1, cpu_count // 2)}, half your cores)"
    )
    parser.add_argument("--skip-install", action="store_true", help="Skip pip installs")
    args = parser.parse_args()

    if not args.skip_install:
        install_dependencies()
    else:
        fix_macos_ssl()

    songs_dir = Path(args.folder).resolve()
    if not songs_dir.is_dir():
        print(f"❌ Not a directory: {songs_dir}")
        sys.exit(1)

    ffmpeg_bin = find_ffmpeg()
    if not ffmpeg_bin:
        print("❌ ffmpeg not found. Install: brew install ffmpeg")
        sys.exit(1)

    process_folder(songs_dir, ffmpeg_bin, args.workers)


if __name__ == "__main__":
    # Required for ProcessPoolExecutor on macOS/Windows
    multiprocessing.freeze_support()
    main()
    # python3 remove_drums_batch.py ./songs --workers 6 