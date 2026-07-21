#!/usr/bin/env python3
"""Render source-spectrum/score overlays for the full Take Five v5 audit.

The plots are review aids only.  They preserve performed score ticks and draw
the nominal 5/4 bar and 3+2 split as annotations; no note is quantized or
written back to the score.
"""

from __future__ import annotations

import json
import math
import struct
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
SCORE = ROOT / "tmp/video-replica/take-five-full-curation-v5/take-five-full-curation-v5.notes.json"
PITCH = ROOT / "tmp/video-replica/take-five-full-curation-v5/full-audit/pitch/full-pitch-audit.json"
TIMING = ROOT / "tmp/video-replica/take-five-full-curation-v5/full-audit/timing/full-timing-audit.json"
SOURCE = ROOT / "tmp/jazz-five-four-analysis/reference.wav"
OUTPUT = ROOT / "tmp/video-replica/take-five-full-curation-v5/full-audit/overlays"

PPQ = 480
BPM = 200.0
TICKS_PER_SECOND = PPQ * BPM / 60.0
BAR_TICKS = PPQ * 5
PAGE_BARS = 5
PAGE_TICKS = BAR_TICKS * PAGE_BARS
MIN_MIDI = 33
MAX_MIDI = 93


def read_wave(path: Path) -> tuple[np.ndarray, int]:
    with path.open("rb") as handle:
        if handle.read(4) != b"RIFF":
            raise ValueError(f"{path} is not RIFF")
        handle.read(4)
        if handle.read(4) != b"WAVE":
            raise ValueError(f"{path} is not WAVE")
        fmt = None
        payload = None
        while True:
            header = handle.read(8)
            if len(header) < 8:
                break
            kind, size = struct.unpack("<4sI", header)
            chunk = handle.read(size)
            if size & 1:
                handle.read(1)
            if kind == b"fmt ":
                fmt = chunk
            elif kind == b"data":
                payload = chunk
                break
    if fmt is None or payload is None:
        raise ValueError(f"{path} has no fmt/data chunk")
    tag, channels, sample_rate, _, _, bits = struct.unpack("<HHIIHH", fmt[:16])
    if tag == 0xFFFE and len(fmt) >= 26:
        tag = struct.unpack("<H", fmt[24:26])[0]
    if tag == 1 and bits == 16:
        samples = np.frombuffer(payload, dtype="<i2").astype(np.float64) / 32768.0
    elif tag == 3 and bits == 32:
        samples = np.frombuffer(payload, dtype="<f4").astype(np.float64)
    else:
        raise ValueError(f"unsupported WAV tag={tag}, bits={bits}")
    return samples.reshape(-1, channels).mean(axis=1), sample_rate


def midi_name(midi: int) -> str:
    names = ("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
    return f"{names[midi % 12]}{midi // 12 - 1}"


def spectrum_page(
    audio: np.ndarray,
    sample_rate: int,
    source_anchor_seconds: float,
    start_tick: int,
    end_tick: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    padding = 0.10
    start_seconds = source_anchor_seconds + start_tick / TICKS_PER_SECOND
    end_seconds = source_anchor_seconds + end_tick / TICKS_PER_SECOND
    first = max(0, int(round((start_seconds - padding) * sample_rate)))
    last = min(len(audio), int(round((end_seconds + padding) * sample_rate)))
    signal = audio[first:last].astype(np.float64, copy=True)
    signal -= float(np.mean(signal))
    signal /= float(np.percentile(np.abs(signal), 99.5)) + 1e-12

    window_size = 4096
    hop_size = 256
    fft_size = 16384
    if len(signal) < window_size:
        raise ValueError("page is too short for spectrum")
    frame_count = 1 + (len(signal) - window_size) // hop_size
    starts = np.arange(frame_count) * hop_size
    window = np.hanning(window_size)
    frequencies = np.fft.rfftfreq(fft_size, 1.0 / sample_rate)
    low_hz = 440.0 * 2.0 ** ((MIN_MIDI - 69 - 0.6) / 12.0)
    high_hz = 440.0 * 2.0 ** ((MAX_MIDI - 69 + 0.6) / 12.0)
    bins = np.flatnonzero((frequencies >= low_hz) & (frequencies <= high_hz))
    magnitude = np.empty((len(bins), frame_count), dtype=np.float32)
    batch_size = 192
    for offset in range(0, frame_count, batch_size):
        count = min(batch_size, frame_count - offset)
        indices = starts[offset:offset + count, None] + np.arange(window_size)[None, :]
        frames = signal[indices] * window
        magnitude[:, offset:offset + count] = np.abs(
            np.fft.rfft(frames, n=fft_size, axis=1)[:, bins]
        ).T
    db = 20.0 * np.log10(magnitude + 1e-7)
    page_p95 = float(np.percentile(db, 95))
    db = np.clip(db, page_p95 - 55.0, page_p95)
    times_absolute = (first + starts + window_size / 2) / sample_rate
    ticks = (times_absolute - source_anchor_seconds) * TICKS_PER_SECOND
    midi_axis = 69.0 + 12.0 * np.log2(frequencies[bins] / 440.0)
    return ticks, midi_axis, db


def main() -> None:
    score = json.loads(SCORE.read_text())
    pitch = json.loads(PITCH.read_text())
    timing = json.loads(TIMING.read_text())
    audio, sample_rate = read_wave(SOURCE)
    source_anchor = float(score["source"]["tickZeroAtVideoSeconds"])
    duration_ticks = int(score["score"]["durationPerformedTicks"])

    notes = [note for track in score["tracks"].values() for note in track["notes"]]
    weak_ids = {
        row["eventId"]
        for row in pitch["scoreEvents"]
        if int(row["detectorConfigCount"]) < int(pitch["tolerances"]["minimumConsensusConfigs"])
    }
    omissions = [
        row for row in pitch["omissionReview"]
        if row["classification"] == "consensus-omission-review"
    ]
    timing_candidates = {
        row["groupId"]: row for row in timing["waveformSupportedTimingCandidates"]
    }

    role_colors = {"bass": "#47a7ff", "comp": "#42d392", "lead": "#ffd166"}
    OUTPUT.mkdir(parents=True, exist_ok=True)
    pages = math.ceil(duration_ticks / PAGE_TICKS)
    created: list[str] = []
    for page_index in range(pages):
        start_tick = page_index * PAGE_TICKS
        end_tick = min((page_index + 1) * PAGE_TICKS, duration_ticks)
        ticks, midi_axis, db = spectrum_page(
            audio, sample_rate, source_anchor, start_tick, end_tick,
        )
        figure, axis = plt.subplots(figsize=(19, 8.5))
        axis.pcolormesh(ticks, midi_axis, db, shading="auto", cmap="magma", rasterized=True)

        selected_notes = [
            note for note in notes
            if int(note["performedStartTick"]) < end_tick
            and int(note["performedStartTick"]) + int(note["performedDurationTicks"]) >= start_tick
        ]
        for note in selected_notes:
            onset = int(note["performedStartTick"])
            end = onset + int(note["performedDurationTicks"])
            midi = int(note["midi"])
            color = role_colors[str(note["role"])]
            axis.plot(
                [max(onset, start_tick), min(end, end_tick)],
                [midi, midi],
                color=color,
                linewidth=1.7 if note["eventId"] not in weak_ids else 2.5,
                alpha=0.86,
                solid_capstyle="round",
            )
            marker = "x" if note["eventId"] in weak_ids else "|"
            axis.scatter([onset], [midi], marker=marker, s=24, color=color, linewidths=1.0, zorder=4)

        for omission in omissions:
            tick = int(omission["startTickMedian"])
            if start_tick <= tick < end_tick:
                axis.scatter(
                    [tick], [int(omission["midi"])], marker="^", s=58,
                    facecolors="none", edgecolors="#00ffff", linewidths=1.3, zorder=5,
                )

        for row in timing_candidates.values():
            tick = int(row["anchorTick"])
            if start_tick <= tick < end_tick:
                axis.axvline(tick, color="#ff4fd8", linewidth=1.0, alpha=0.8)

        first_bar = start_tick // BAR_TICKS
        last_bar = math.ceil(end_tick / BAR_TICKS)
        for bar in range(first_bar, last_bar + 1):
            bar_tick = bar * BAR_TICKS
            if start_tick <= bar_tick <= end_tick:
                axis.axvline(bar_tick, color="white", linewidth=1.2, alpha=0.8, linestyle="--")
            split_tick = bar_tick + 3 * PPQ
            if start_tick <= split_tick <= end_tick:
                axis.axvline(split_tick, color="#55e6ff", linewidth=0.8, alpha=0.65, linestyle=":")

        start_bar = first_bar + 1
        end_bar = math.ceil(end_tick / BAR_TICKS)
        video_start = source_anchor + start_tick / TICKS_PER_SECOND
        video_end = source_anchor + end_tick / TICKS_PER_SECOND
        axis.set_title(
            f"Take Five v5 source-spectrum overlay · bars {start_bar}–{end_bar} · "
            f"video {video_start:.3f}–{video_end:.3f}s\n"
            "score: Bass blue / Comp green / Lead yellow; x=weak score; cyan triangle=omission review; "
            "magenta line=waveform timing review; white=5/4 bar; cyan dotted=3+2 split"
        )
        axis.set_xlim(start_tick, end_tick)
        axis.set_ylim(MIN_MIDI - 0.5, MAX_MIDI + 0.5)
        axis.set_xlabel("performed tick (PPQ 480, 200 BPM; no grid snapping)")
        axis.set_ylabel("source spectrum / MIDI pitch")
        y_ticks = list(range(36, 94, 6))
        axis.set_yticks(y_ticks, [midi_name(value) for value in y_ticks])
        figure.tight_layout()
        path = OUTPUT / f"bars-{start_bar:02d}-{end_bar:02d}.png"
        figure.savefig(path, dpi=150)
        plt.close(figure)
        created.append(path.name)

    readme = (
        "# Take Five v5 · full source-spectrum overlays\n\n"
        "These pages overlay every retained score note on the source recording. "
        "The nominal 5/4 bar and 3+2 split are annotations only; no performed onset was snapped.\n\n"
        f"- score notes: `{len(notes)}`\n"
        f"- weak-score markers: `{len(weak_ids)}`\n"
        f"- consensus omission-review markers: `{len(omissions)}`\n"
        f"- waveform-supported timing markers: `{len(timing_candidates)}`\n"
        f"- pages: `{len(created)}`\n\n"
        + "\n".join(f"- `{name}`" for name in created)
        + "\n"
    )
    (OUTPUT / "README.md").write_text(readme)
    print(json.dumps({"pages": created, "output": str(OUTPUT.relative_to(ROOT))}, indent=2))


if __name__ == "__main__":
    main()
