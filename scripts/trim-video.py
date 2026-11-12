#!/usr/bin/env python3
"""
Trim a video: cut seconds from the start and the end, and optionally remove sections from the middle
(for example, the clicks on Start and Stop in a screen recording, and a pause in the middle).

Usage:
  python scripts/trim-video.py record.mp4
  python scripts/trim-video.py record.mp4 --head 2 --tail 2
  python scripts/trim-video.py record.mp4 --head 2 --tail 2 --remove 1:32-1:44
  python scripts/trim-video.py record.mp4 --remove 0:30-0:35 --remove 1:10-1:12 -o final.mp4

All times are on the INPUT video's clock, as seconds (92.5) or m:ss (1:32.5). --remove can be given more than once.
Defaults: cut 1 second from the start and 1 from the end, remove nothing. The output is written next to the input as
<name>_trimmed.mp4; the input is never overwritten.

ffmpeg: uses `ffmpeg` on PATH if there is one, otherwise the copy bundled with the imageio-ffmpeg package
(pip install imageio-ffmpeg). The kept parts are re-encoded in one pass (H.264, CRF 18, near lossless to the eye) and
joined, so every cut is frame-accurate and video and audio stay in sync.
"""
import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path


def find_ffmpeg() -> str:
    on_path = shutil.which("ffmpeg")
    if on_path:
        return on_path
    try:
        import imageio_ffmpeg
    except ImportError:
        sys.exit("ffmpeg not found. Install ffmpeg, or run: pip install imageio-ffmpeg")
    return imageio_ffmpeg.get_ffmpeg_exe()


def duration_seconds(ffmpeg: str, video: Path) -> float:
    """Reads the container duration from ffmpeg's banner (ffprobe is not bundled with imageio-ffmpeg)."""
    probe = subprocess.run([ffmpeg, "-hide_banner", "-i", str(video)], capture_output=True, text=True)
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", probe.stderr)
    if not m:
        sys.exit(f"could not read the duration of {video}")
    h, mnt, s = m.groups()
    return int(h) * 3600 + int(mnt) * 60 + float(s)


def parse_time(text: str) -> float:
    """'92', '92.5', '1:32' or '1:32.5' -> seconds."""
    parts = text.strip().split(":")
    try:
        if len(parts) == 1:
            return float(parts[0])
        if len(parts) == 2:
            return int(parts[0]) * 60 + float(parts[1])
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    except ValueError:
        pass
    raise argparse.ArgumentTypeError(f"not a time: {text!r} (use seconds or m:ss)")


def parse_range(text: str) -> tuple[float, float]:
    if "-" not in text:
        raise argparse.ArgumentTypeError(f"not a range: {text!r} (use START-END, for example 1:32-1:44)")
    start, end = text.split("-", 1)
    a, b = parse_time(start), parse_time(end)
    if b <= a:
        raise argparse.ArgumentTypeError(f"range {text!r} ends before it starts")
    return a, b


def fmt(seconds: float) -> str:
    return f"{int(seconds // 60)}:{seconds % 60:05.2f}"


def kept_segments(total: float, head: float, tail: float, removals: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """The parts of [head, total - tail] that are not inside any removed range."""
    segments = [(head, total - tail)]
    for a, b in sorted(removals):
        next_segments = []
        for s, e in segments:
            if b <= s or a >= e:  # no overlap
                next_segments.append((s, e))
                continue
            if a > s:
                next_segments.append((s, a))
            if b < e:
                next_segments.append((b, e))
        segments = next_segments
    return [(s, e) for s, e in segments if e - s > 0.01]


def main() -> None:
    ap = argparse.ArgumentParser(description="Cut the start, the end and middle sections of a video.")
    ap.add_argument("input", type=Path)
    ap.add_argument("--head", type=parse_time, default=1.0, help="time to cut from the start (default 1)")
    ap.add_argument("--tail", type=parse_time, default=1.0, help="time to cut from the end (default 1)")
    ap.add_argument("--remove", type=parse_range, action="append", default=[], metavar="START-END",
                    help="remove a section, on the input's clock (repeatable), e.g. 1:32-1:44")
    ap.add_argument("-o", "--output", type=Path, help="output file (default: <input>_trimmed.mp4)")
    args = ap.parse_args()

    src = args.input.resolve()
    if not src.exists():
        sys.exit(f"{src} does not exist")
    out = (args.output or src.with_name(f"{src.stem}_trimmed{src.suffix}")).resolve()
    if out == src:
        sys.exit("the output must not overwrite the input")

    ffmpeg = find_ffmpeg()
    total = duration_seconds(ffmpeg, src)
    segments = kept_segments(total, args.head, args.tail, args.remove)
    if not segments:
        sys.exit(f"the video is {fmt(total)}; these cuts leave nothing")
    keep = sum(e - s for s, e in segments)

    print(f"input:  {src.name}  {fmt(total)} ({total:.2f}s)")
    for i, (s, e) in enumerate(segments, 1):
        print(f"keep {i}: {fmt(s)} -> {fmt(e)}  ({e - s:.2f}s)")
    print(f"output: {out.name}  {fmt(keep)} ({keep:.2f}s)")

    # One filter graph: trim each kept part (video and audio), reset its timestamps, then join them in order.
    parts, labels = [], []
    for i, (s, e) in enumerate(segments):
        parts.append(f"[0:v]trim=start={s:.3f}:end={e:.3f},setpts=PTS-STARTPTS[v{i}]")
        parts.append(f"[0:a]atrim=start={s:.3f}:end={e:.3f},asetpts=PTS-STARTPTS[a{i}]")
        labels.append(f"[v{i}][a{i}]")
    graph = ";".join(parts) + ";" + "".join(labels) + f"concat=n={len(segments)}:v=1:a=1[v][a]"

    cmd = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-stats", "-y",
        "-i", str(src), "-filter_complex", graph, "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        str(out),
    ]
    result = subprocess.run(cmd)
    if result.returncode != 0:
        sys.exit(f"ffmpeg failed with exit code {result.returncode}")
    done = duration_seconds(ffmpeg, out)
    print(f"done: {out}  {fmt(done)} ({done:.2f}s)")


if __name__ == "__main__":
    main()
