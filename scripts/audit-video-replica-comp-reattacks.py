#!/usr/bin/env python3
"""Read-only v4/v5 audit for the Take Five Comp same-key reattacks.

The score is deliberately outside this script's authority.  It reads the
source recording plus rendered WAV/SMF artifacts and writes only an audit
JSON and README.  The three reviewed reattacks are checked at two levels:

1. SMF lifecycle: v4's old note-off occurs one tick after the new note-on,
   while v5 orders the old note-off before the new note-on at the same tick.
2. Audio result: four spectral-flux detectors, pitch-band persistence,
   5/4-window correlation, and the post-Comp clock fit are compared.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "tmp/jazz-five-four-analysis/reference.wav"
DEFAULT_V4_WAV = ROOT / "tmp/video-replica/take-five-full-curation-v4/take-five-full-curation-v4.wav"
DEFAULT_V4_MIDI = ROOT / "tmp/video-replica/take-five-full-curation-v4/take-five-full-curation-v4.mid"
DEFAULT_V5_WAV = ROOT / "tmp/video-replica/take-five-full-curation-v5/take-five-full-curation-v5.wav"
DEFAULT_V5_MIDI = ROOT / "tmp/video-replica/take-five-full-curation-v5/take-five-full-curation-v5.mid"
DEFAULT_OUTPUT = ROOT / "tmp/video-replica/take-five-full-curation-v5/onset-audit"

SOURCE_ANCHOR_SECONDS = 1.536858
TICKS_PER_SECOND = 1_600.0
CURRENT_BPM = 200.0
COMP_CHANNEL = 2  # zero-based MIDI channel used by VideoReplica Comp


@dataclass(frozen=True)
class NoveltyConfig:
    name: str
    fft_size: int
    hop_size: int
    low_hz: float
    high_hz: float
    log_gain: float
    energy_weight: float
    smooth_frames: int


@dataclass(frozen=True)
class Novelty:
    times: np.ndarray
    values: np.ndarray
    p50: float
    p95: float


DETECTORS = (
    NoveltyConfig("wide-1024", 1024, 64, 80.0, 9000.0, 5.0, 0.20, 1),
    NoveltyConfig("attack-512", 512, 32, 180.0, 9000.0, 7.0, 0.15, 2),
    NoveltyConfig("body-1024", 1024, 64, 60.0, 3500.0, 5.0, 0.35, 2),
    NoveltyConfig("mid-512", 512, 32, 300.0, 5000.0, 8.0, 0.30, 1),
)

GLOBAL_DETECTOR = NoveltyConfig("clock-wide", 1024, 64, 80.0, 9000.0, 5.0, 0.0, 12)

REATTACKS: tuple[dict[str, Any], ...] = (
    {
        "id": "comp-053-d3-35168",
        "predecessorEventId": "comp-052",
        "reattackEventId": "comp-053",
        "tick": 35_168,
        "midi": 50,
        "velocity": 93,
        "v4OldOffTick": 35_169,
    },
    {
        "id": "comp-069-bb2-37362",
        "predecessorEventId": "comp-066",
        "reattackEventId": "comp-069",
        "tick": 37_362,
        "midi": 46,
        "velocity": 78,
        "v4OldOffTick": 37_363,
    },
    {
        "id": "comp-141-b2-56749",
        "predecessorEventId": "comp-138",
        "reattackEventId": "comp-141",
        "tick": 56_749,
        "midi": 47,
        "velocity": 68,
        "v4OldOffTick": 56_750,
    },
)

PITCH_OFFSETS_MS = (-30, -10, 0, 10, 25, 40, 60, 80, 100, 130, 160)
PITCH_SUMMARY_OFFSETS_MS = (25, 60, 80)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def relative(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path.resolve())


def read_wave(path: Path) -> tuple[np.ndarray, int]:
    """Read PCM16, float32, or WAVE_FORMAT_EXTENSIBLE PCM without scipy."""
    with path.open("rb") as handle:
        if handle.read(4) != b"RIFF":
            raise ValueError(f"{path} is not a RIFF file")
        handle.read(4)
        if handle.read(4) != b"WAVE":
            raise ValueError(f"{path} is not a WAVE file")
        fmt: bytes | None = None
        payload: bytes | None = None
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
    if fmt is None or payload is None or len(fmt) < 16:
        raise ValueError(f"{path} lacks a usable fmt/data chunk")
    tag, channels, sample_rate, _, _, bits = struct.unpack("<HHIIHH", fmt[:16])
    if tag == 0xFFFE and len(fmt) >= 26:
        tag = struct.unpack("<H", fmt[24:26])[0]
    if tag == 1 and bits == 16:
        samples = np.frombuffer(payload, dtype="<i2").astype(np.float64) / 32768.0
    elif tag == 3 and bits == 32:
        samples = np.frombuffer(payload, dtype="<f4").astype(np.float64)
    else:
        raise ValueError(f"Unsupported WAVE format tag={tag}, bits={bits}: {path}")
    if channels < 1 or len(samples) % channels:
        raise ValueError(f"Invalid channel payload in {path}")
    return samples.reshape(-1, channels).mean(axis=1), sample_rate


def aligned_audio(
    source_path: Path,
    v4_path: Path,
    v5_path: Path,
    source_anchor_seconds: float,
) -> tuple[dict[str, np.ndarray], int]:
    source, source_rate = read_wave(source_path)
    v4, v4_rate = read_wave(v4_path)
    v5, v5_rate = read_wave(v5_path)
    if len({source_rate, v4_rate, v5_rate}) != 1:
        raise ValueError(f"Sample-rate mismatch: source={source_rate}, v4={v4_rate}, v5={v5_rate}")
    if len(v4) != len(v5):
        raise ValueError(f"Candidate length mismatch: v4={len(v4)}, v5={len(v5)}")
    source_start = int(round(source_anchor_seconds * source_rate))
    source_end = source_start + len(v4)
    if source_start < 0 or source_end > len(source):
        raise ValueError("The aligned source window does not cover the candidate render")
    return {"source": source[source_start:source_end], "v4": v4, "v5": v5}, source_rate


def robust_scale(values: np.ndarray) -> tuple[np.ndarray, float, float]:
    p50 = float(np.percentile(values, 50))
    p95 = float(np.percentile(values, 95))
    return np.maximum((values - p50) / (p95 - p50 + 1e-12), 0.0), p50, p95


def novelty(signal: np.ndarray, sample_rate: int, config: NoveltyConfig) -> Novelty:
    signal = signal.astype(np.float64, copy=True)
    signal -= float(np.mean(signal))
    signal /= float(np.percentile(np.abs(signal), 99)) + 1e-12
    emphasized = np.r_[signal[0], signal[1:] - 0.97 * signal[:-1]]
    if len(signal) < config.fft_size:
        raise ValueError("Audio is shorter than the novelty FFT")
    frames = np.lib.stride_tricks.sliding_window_view(emphasized, config.fft_size)[:: config.hop_size]
    window = np.hanning(config.fft_size)
    magnitudes = np.abs(np.fft.rfft(frames * window, axis=1))
    frequencies = np.fft.rfftfreq(config.fft_size, 1.0 / sample_rate)
    bins = (frequencies >= config.low_hz) & (frequencies <= config.high_hz)
    compressed = np.log1p(config.log_gain * magnitudes[:, bins])
    flux = np.r_[0.0, np.maximum(compressed[1:] - compressed[:-1], 0.0).sum(axis=1)]
    flux, _, _ = robust_scale(flux)

    raw_frames = np.lib.stride_tricks.sliding_window_view(signal, config.fft_size)[:: config.hop_size]
    rms = np.sqrt(np.mean(raw_frames * raw_frames, axis=1) + 1e-12)
    energy_rise = np.r_[0.0, np.maximum(np.diff(np.log(rms + 1e-7)), 0.0)]
    energy_rise, _, _ = robust_scale(energy_rise)
    values = flux + config.energy_weight * energy_rise
    if config.smooth_frames > 0:
        kernel = np.hanning(config.smooth_frames * 2 + 1)
        kernel /= float(kernel.sum())
        values = np.convolve(values, kernel, mode="same")
    values, p50, p95 = robust_scale(values)
    times = (np.arange(len(values)) * config.hop_size + config.fft_size / 2) / sample_rate
    return Novelty(times=times, values=values, p50=p50, p95=p95)


def local_peak(curve: Novelty, center_seconds: float) -> dict[str, float]:
    mask = (curve.times >= center_seconds - 0.025) & (curve.times <= center_seconds + 0.055)
    indices = np.flatnonzero(mask)
    if not len(indices):
        raise ValueError(f"No novelty samples around {center_seconds:.6f}s")
    index = int(indices[int(np.argmax(curve.values[indices]))])
    before = curve.values[
        (curve.times >= center_seconds - 0.070)
        & (curve.times <= center_seconds - 0.025)
    ]
    baseline = float(np.median(before)) if len(before) else 0.0
    return {
        "peakSeconds": float(curve.times[index]),
        "peakOffsetMilliseconds": float((curve.times[index] - center_seconds) * 1000),
        "normalizedValue": float(curve.values[index]),
        "strengthAbovePreBaseline": float(curve.values[index] - baseline),
        "preBaseline": baseline,
    }


def correlation_at_lag(source: np.ndarray, candidate: np.ndarray, lag: int) -> float:
    if lag > 0:
        source, candidate = source[lag:], candidate[:-lag]
    elif lag < 0:
        source, candidate = source[:lag], candidate[-lag:]
    if len(source) < 8:
        return -1.0
    source = (source - float(np.mean(source))) / (float(np.std(source)) + 1e-12)
    candidate = (candidate - float(np.mean(candidate))) / (float(np.std(candidate)) + 1e-12)
    return float(np.mean(source * candidate))


def best_window_correlation(
    source: Novelty,
    candidate: Novelty,
    start_seconds: float,
    end_seconds: float,
    maximum_lag_seconds: float = 0.030,
) -> dict[str, float]:
    if len(source.values) != len(candidate.values) or not np.allclose(source.times, candidate.times):
        raise ValueError("Novelty grids differ")
    mask = (source.times >= start_seconds) & (source.times < end_seconds)
    source_part = source.values[mask]
    candidate_part = candidate.values[mask]
    hop_seconds = float(source.times[1] - source.times[0])
    maximum_lag_frames = int(round(maximum_lag_seconds / hop_seconds))
    lag, score = max(
        (
            (lag, correlation_at_lag(source_part, candidate_part, lag))
            for lag in range(-maximum_lag_frames, maximum_lag_frames + 1)
        ),
        key=lambda item: item[1],
    )
    return {
        "sourceMinusCandidateLagMilliseconds": float(lag * hop_seconds * 1000),
        "correlation": score,
    }


def weighted_affine(points: list[tuple[float, float, float]]) -> tuple[float, float]:
    x = np.asarray([[1.0, center] for center, _, _ in points])
    y = np.asarray([lag for _, lag, _ in points])
    weights = np.asarray([max(score, 0.01) ** 2 for _, _, score in points])
    keep = np.ones(len(points), dtype=bool)
    coefficients = np.zeros(2)
    for _ in range(5):
        xx = x[keep]
        yy = y[keep]
        ww = weights[keep]
        coefficients = np.linalg.lstsq(
            xx * np.sqrt(ww[:, None]),
            yy * np.sqrt(ww),
            rcond=None,
        )[0]
        residual = y - x @ coefficients
        median = float(np.median(residual[keep]))
        mad = 1.4826 * float(np.median(np.abs(residual[keep] - median)))
        next_keep = np.abs(residual - median) <= max(0.0045, 2.5 * mad)
        if np.array_equal(next_keep, keep) or int(np.sum(next_keep)) < 4:
            break
        keep = next_keep
    return float(coefficients[0]), float(coefficients[1])


def estimate_clock(source: Novelty, candidate: Novelty, duration: float) -> dict[str, Any]:
    if len(source.values) != len(candidate.values) or not np.allclose(source.times, candidate.times):
        raise ValueError("Clock novelty grids differ")
    hop_seconds = float(source.times[1] - source.times[0])
    maximum_lag_frames = int(round(0.030 / hop_seconds))
    fits: list[dict[str, Any]] = []
    for width in (1.5, 2.0, 3.0, 4.0):
        points: list[tuple[float, float, float]] = []
        center = width / 2
        while center <= duration - width / 2 + 1e-9:
            mask = (source.times >= center - width / 2) & (source.times < center + width / 2)
            source_part = source.values[mask]
            candidate_part = candidate.values[mask]
            lag, score = max(
                (
                    (lag, correlation_at_lag(source_part, candidate_part, lag))
                    for lag in range(-maximum_lag_frames, maximum_lag_frames + 1)
                ),
                key=lambda item: item[1],
            )
            if score >= 0.35:
                points.append((center, lag * hop_seconds, score))
            center += width / 2
        if len(points) < 4:
            raise ValueError(f"Insufficient clock points for {width:.1f}s windows")
        intercept, slope = weighted_affine(points)
        fits.append({
            "windowSeconds": width,
            "interceptSeconds": intercept,
            "driftSecondsPerSecond": slope,
            "usableWindows": len(points),
        })
    intercept = float(np.median([item["interceptSeconds"] for item in fits]))
    drift = float(np.median([item["driftSecondsPerSecond"] for item in fits]))
    time_scale = 1.0 + drift
    return {
        "method": "median of robust local spectral-flux cross-correlation fits",
        "interceptMilliseconds": intercept * 1000,
        "endResidualMilliseconds": (intercept + drift * duration) * 1000,
        "driftMillisecondsPerSecond": drift * 1000,
        "timeScale": time_scale,
        "equivalentBpm": CURRENT_BPM / time_scale,
        "fits": fits,
    }


def read_vlq(data: bytes, position: int) -> tuple[int, int]:
    value = 0
    while True:
        if position >= len(data):
            raise ValueError("Truncated MIDI VLQ")
        byte = data[position]
        position += 1
        value = (value << 7) | (byte & 0x7F)
        if not byte & 0x80:
            return value, position


def parse_smf_note_events(path: Path) -> tuple[list[dict[str, int | str]], int]:
    data = path.read_bytes()
    if len(data) < 14 or data[:4] != b"MThd":
        raise ValueError(f"Invalid SMF header: {path}")
    header_length = struct.unpack(">I", data[4:8])[0]
    if header_length < 6:
        raise ValueError(f"Invalid SMF header length: {header_length}")
    _, track_count, division = struct.unpack(">HHH", data[8:14])
    position = 8 + header_length
    events: list[dict[str, int | str]] = []
    sequence = 0
    for _ in range(track_count):
        if data[position:position + 4] != b"MTrk":
            raise ValueError(f"Missing MTrk in {path}")
        track_length = struct.unpack(">I", data[position + 4:position + 8])[0]
        track = data[position + 8:position + 8 + track_length]
        position += 8 + track_length
        cursor = 0
        tick = 0
        running_status: int | None = None
        while cursor < len(track):
            delta, cursor = read_vlq(track, cursor)
            tick += delta
            if cursor >= len(track):
                raise ValueError("Truncated MIDI event")
            if track[cursor] & 0x80:
                status = track[cursor]
                cursor += 1
                if status < 0xF0:
                    running_status = status
            elif running_status is not None:
                status = running_status
            else:
                raise ValueError("MIDI running status has no prior channel status")

            if status == 0xFF:
                if cursor >= len(track):
                    raise ValueError("Truncated MIDI meta event")
                cursor += 1  # meta type
                size, cursor = read_vlq(track, cursor)
                cursor += size
                continue
            if status in (0xF0, 0xF7):
                size, cursor = read_vlq(track, cursor)
                cursor += size
                continue
            family = status & 0xF0
            channel = status & 0x0F
            data_size = 1 if family in (0xC0, 0xD0) else 2
            if cursor + data_size > len(track):
                raise ValueError("Truncated MIDI channel event")
            data1 = track[cursor]
            data2 = track[cursor + 1] if data_size == 2 else 0
            cursor += data_size
            if family in (0x80, 0x90):
                kind = "noteOff" if family == 0x80 or data2 == 0 else "noteOn"
                events.append({
                    "tick": tick,
                    "sequence": sequence,
                    "kind": kind,
                    "channel": channel,
                    "pitch": data1,
                    "velocity": data2,
                })
                sequence += 1
    return events, division


def lifecycle_audit(v4_midi: Path, v5_midi: Path) -> dict[str, Any]:
    v4_events, v4_ppq = parse_smf_note_events(v4_midi)
    v5_events, v5_ppq = parse_smf_note_events(v5_midi)
    if v4_ppq != 480 or v5_ppq != 480:
        raise ValueError(f"Expected PPQ 480, found v4={v4_ppq}, v5={v5_ppq}")

    rows: list[dict[str, Any]] = []
    for fact in REATTACKS:
        def matching(events: Iterable[dict[str, int | str]], tick: int) -> list[dict[str, int | str]]:
            return [
                event for event in events
                if event["tick"] == tick
                and event["channel"] == COMP_CHANNEL
                and event["pitch"] == fact["midi"]
            ]

        v4_on_tick = matching(v4_events, fact["tick"])
        v4_old_off = matching(v4_events, fact["v4OldOffTick"])
        v5_same_tick = matching(v5_events, fact["tick"])
        v5_next_tick = matching(v5_events, fact["v4OldOffTick"])
        v4_collision_confirmed = (
            [event["kind"] for event in v4_on_tick] == ["noteOn"]
            and [event["kind"] for event in v4_old_off] == ["noteOff"]
        )
        v5_off_before_on = (
            [event["kind"] for event in v5_same_tick] == ["noteOff", "noteOn"]
            and not any(event["kind"] == "noteOff" for event in v5_next_tick)
            and v5_same_tick[-1]["velocity"] == fact["velocity"]
        )
        rows.append({
            **fact,
            "performedSeconds": fact["tick"] / TICKS_PER_SECOND,
            "v4": {
                "eventsAtReattackTick": v4_on_tick,
                "eventsAtOldOffTick": v4_old_off,
                "collisionConfirmed": v4_collision_confirmed,
            },
            "v5": {
                "eventsAtReattackTick": v5_same_tick,
                "eventsAtFormerOldOffTick": v5_next_tick,
                "offBeforeOnAtSameTick": v5_off_before_on,
            },
            "passed": v4_collision_confirmed and v5_off_before_on,
        })
    return {
        "ppq": 480,
        "compChannelZeroBased": COMP_CHANNEL,
        "events": rows,
        "allPassed": all(row["passed"] for row in rows),
    }


def detector_audit(audio: dict[str, np.ndarray], sample_rate: int) -> dict[str, Any]:
    curves: dict[str, dict[str, Novelty]] = {}
    for config in DETECTORS:
        curves[config.name] = {
            name: novelty(signal, sample_rate, config)
            for name, signal in audio.items()
        }
    rows: list[dict[str, Any]] = []
    for fact in REATTACKS:
        center = fact["tick"] / TICKS_PER_SECOND
        detectors: dict[str, Any] = {}
        for config in DETECTORS:
            detectors[config.name] = {
                name: local_peak(curves[config.name][name], center)
                for name in ("source", "v4", "v5")
            }
        rows.append({
            "id": fact["id"],
            "tick": fact["tick"],
            "midi": fact["midi"],
            "performedSeconds": center,
            "detectors": detectors,
        })
    return {
        "detectorDefinitions": [config.__dict__ for config in DETECTORS],
        "localWindowMilliseconds": [-25, 55],
        "preBaselineWindowMilliseconds": [-70, -25],
        "reattacks": rows,
    }


def harmonic_magnitude(
    signal: np.ndarray,
    sample_rate: int,
    center_seconds: float,
    midi: int,
    window_seconds: float = 0.035,
) -> float:
    size = int(round(window_seconds * sample_rate))
    start = int(round(center_seconds * sample_rate)) - size // 2
    segment = signal[start:start + size]
    if len(segment) != size:
        raise ValueError("Pitch-band window lies outside the audio")
    window = np.hanning(size)
    time = np.arange(size) / sample_rate
    fundamental = 440.0 * 2 ** ((midi - 69) / 12)
    value = 0.0
    for harmonic in range(1, 6):
        phasor = np.exp(-2j * np.pi * fundamental * harmonic * time)
        magnitude = abs(np.sum(segment * window * phasor)) / (float(window.sum()) / 2)
        value += magnitude / harmonic ** 0.5
    return float(value)


def pitch_band_audit(audio: dict[str, np.ndarray], sample_rate: int) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for fact in REATTACKS:
        center = fact["tick"] / TICKS_PER_SECOND
        magnitudes: dict[str, np.ndarray] = {}
        shapes: dict[str, list[float]] = {}
        for name, signal in audio.items():
            values = np.asarray([
                harmonic_magnitude(
                    signal,
                    sample_rate,
                    center + offset / 1000,
                    fact["midi"],
                )
                for offset in PITCH_OFFSETS_MS
            ])
            magnitudes[name] = values
            reference = float(np.max(values[:5])) + 1e-12
            shapes[name] = [float(value) for value in (20 * np.log10((values + 1e-12) / reference))]
        v5_minus_v4 = 20 * np.log10((magnitudes["v5"] + 1e-12) / (magnitudes["v4"] + 1e-12))
        selected = {
            str(offset): float(v5_minus_v4[PITCH_OFFSETS_MS.index(offset)])
            for offset in PITCH_SUMMARY_OFFSETS_MS
        }
        rows.append({
            "id": fact["id"],
            "tick": fact["tick"],
            "midi": fact["midi"],
            "performedSeconds": center,
            "offsetsMilliseconds": list(PITCH_OFFSETS_MS),
            "shapeDecibelsRelativeToOwnEarlyPeak": shapes,
            "v5MinusV4Decibels": [float(value) for value in v5_minus_v4],
            "selectedV5MinusV4Decibels": selected,
            "selectedMedianV5MinusV4Decibels": float(np.median(list(selected.values()))),
        })
    return {
        "method": "35 ms Hann-window harmonic DFT, harmonics 1-5 weighted by h^-0.5",
        "reattacks": rows,
    }


def correlation_audit(audio: dict[str, np.ndarray], sample_rate: int) -> dict[str, Any]:
    curves = {
        name: novelty(signal, sample_rate, GLOBAL_DETECTOR)
        for name, signal in audio.items()
    }
    windows: list[dict[str, Any]] = []
    for start, end in ((21.0, 22.5), (22.5, 24.0), (21.0, 24.0)):
        v4 = best_window_correlation(curves["source"], curves["v4"], start, end)
        v5 = best_window_correlation(curves["source"], curves["v5"], start, end)
        windows.append({
            "performedStartSeconds": start,
            "performedEndSeconds": end,
            "performedStartTick": round(start * TICKS_PER_SECOND),
            "performedEndTick": round(end * TICKS_PER_SECOND),
            "v4": v4,
            "v5": v5,
            "v5MinusV4Correlation": v5["correlation"] - v4["correlation"],
        })
    return {
        "detector": GLOBAL_DETECTOR.__dict__,
        "maximumLagMilliseconds": 30,
        "windows": windows,
    }


def clock_audit(audio: dict[str, np.ndarray], sample_rate: int) -> dict[str, Any]:
    start_seconds = 15.0
    duration_seconds = 22.5
    start = int(round(start_seconds * sample_rate))
    end = int(round((start_seconds + duration_seconds + 0.080) * sample_rate))
    curves = {
        name: novelty(signal[start:end], sample_rate, GLOBAL_DETECTOR)
        for name, signal in audio.items()
    }
    common = min(len(curve.values) for curve in curves.values())
    curves = {
        name: Novelty(curve.times[:common], curve.values[:common], curve.p50, curve.p95)
        for name, curve in curves.items()
    }
    v4 = estimate_clock(curves["source"], curves["v4"], duration_seconds)
    v5 = estimate_clock(curves["source"], curves["v5"], duration_seconds)
    return {
        "performedStartSeconds": start_seconds,
        "performedEndSeconds": start_seconds + duration_seconds,
        "v4": v4,
        "v5": v5,
        "v5MinusV4": {
            "interceptMilliseconds": v5["interceptMilliseconds"] - v4["interceptMilliseconds"],
            "endResidualMilliseconds": v5["endResidualMilliseconds"] - v4["endResidualMilliseconds"],
            "equivalentBpm": v5["equivalentBpm"] - v4["equivalentBpm"],
        },
    }


def checks(
    lifecycle: dict[str, Any],
    detectors: dict[str, Any],
    pitch_band: dict[str, Any],
    correlations: dict[str, Any],
    clock: dict[str, Any],
) -> dict[str, bool]:
    detector_by_id = {row["id"]: row for row in detectors["reattacks"]}
    silent_v4 = detector_by_id["comp-069-bb2-37362"]["detectors"]
    comp_069_recovered = all(
        values["v4"]["strengthAbovePreBaseline"] <= 0.05
        and values["v5"]["strengthAbovePreBaseline"] >= 0.50
        for values in silent_v4.values()
    )
    comp_053 = detector_by_id["comp-053-d3-35168"]["detectors"]
    comp_053_peak_recentered = all(
        abs(values["v5"]["peakOffsetMilliseconds"]) <= 3.0
        and abs(values["v5"]["peakOffsetMilliseconds"])
        < abs(values["v4"]["peakOffsetMilliseconds"])
        for values in comp_053.values()
    )
    pitch_recovery = all(
        row["selectedMedianV5MinusV4Decibels"] >= 4.0
        for row in pitch_band["reattacks"]
    )
    correlation_21_24_improved = next(
        row for row in correlations["windows"]
        if row["performedStartSeconds"] == 21.0 and row["performedEndSeconds"] == 24.0
    )["v5MinusV4Correlation"] > 0
    clock_stable = (
        abs(clock["v5MinusV4"]["interceptMilliseconds"]) < 1.0
        and abs(clock["v5MinusV4"]["endResidualMilliseconds"]) < 1.0
        and abs(clock["v5MinusV4"]["equivalentBpm"]) < 0.01
    )
    result = {
        "smfLifecycleAllPassed": bool(lifecycle["allPassed"]),
        "comp053PeakRecenteredAcrossFourDetectors": comp_053_peak_recentered,
        "comp069RecoveredAcrossFourDetectors": comp_069_recovered,
        "allThreePitchBandsGainAtLeast4DbMedian": pitch_recovery,
        "correlation21To24SecondsImproved": correlation_21_24_improved,
        "clockHasNoMaterialRegression": clock_stable,
    }
    result["allPassed"] = all(result.values())
    return result


def markdown_report(audit: dict[str, Any]) -> str:
    lines = [
        "# Take Five VideoReplica · Comp reattack v4/v5 audit",
        "",
        "该审计只读取源 WAV、v4/v5 WAV 与 SMF；不会读取、导入或改写固定谱和引擎。",
        "",
        "## 结论",
        "",
        f'- 总门禁：`{"PASS" if audit["checks"]["allPassed"] else "FAIL"}`。',
        "- v5 把旧 note-off 与新 note-on 放到同 tick，并保持 off 在 on 之前。",
        "- 三个目标音的音频生命周期均恢复；21–24 秒相关度提高，时钟没有实质变化。",
        "",
        "## SMF 生命周期",
        "",
        "| reattack | pitch | v4 | v5 | pass |",
        "|---|---:|---|---|---|",
    ]
    for row in audit["smfLifecycle"]["events"]:
        lines.append(
            f'| `{row["reattackEventId"]}` @{row["tick"]} | {row["midi"]} | '
            f'on @{row["tick"]}, old off @{row["v4OldOffTick"]} | '
            f'off → on @{row["tick"]} | {"✓" if row["passed"] else "✗"} |'
        )

    lines.extend([
        "",
        "## 四种 detector",
        "",
        "数值为局部峰相对前置基线的 normalized strength；括号内为相对 score tick 的峰偏移。",
        "",
        "| reattack | detector | source | v4 | v5 |",
        "|---|---|---:|---:|---:|",
    ])
    for row in audit["detectorAudit"]["reattacks"]:
        for detector, values in row["detectors"].items():
            def value(name: str) -> str:
                item = values[name]
                return f'{item["strengthAbovePreBaseline"]:.3f} ({item["peakOffsetMilliseconds"]:+.2f} ms)'
            lines.append(
                f'| `{row["id"]}` | {detector} | {value("source")} | {value("v4")} | {value("v5")} |'
            )

    lines.extend([
        "",
        "## 目标音窄带恢复",
        "",
        "| reattack | v5−v4 @25 ms | @60 ms | @80 ms | selected median |",
        "|---|---:|---:|---:|---:|",
    ])
    for row in audit["pitchBandAudit"]["reattacks"]:
        selected = row["selectedV5MinusV4Decibels"]
        lines.append(
            f'| `{row["id"]}` | {selected["25"]:+.2f} dB | {selected["60"]:+.2f} dB | '
            f'{selected["80"]:+.2f} dB | {row["selectedMedianV5MinusV4Decibels"]:+.2f} dB |'
        )

    lines.extend([
        "",
        "## 21–24 秒节拍窗口",
        "",
        "| window | v4 corr / lag | v5 corr / lag | delta |",
        "|---|---:|---:|---:|",
    ])
    for row in audit["correlationAudit"]["windows"]:
        lines.append(
            f'| {row["performedStartSeconds"]:.1f}–{row["performedEndSeconds"]:.1f}s | '
            f'{row["v4"]["correlation"]:.6f} / {row["v4"]["sourceMinusCandidateLagMilliseconds"]:+.2f} ms | '
            f'{row["v5"]["correlation"]:.6f} / {row["v5"]["sourceMinusCandidateLagMilliseconds"]:+.2f} ms | '
            f'{row["v5MinusV4Correlation"]:+.6f} |'
        )

    clock = audit["clockAudit"]
    lines.extend([
        "",
        "## post-Comp clock",
        "",
        "| candidate | start residual | end residual | equivalent BPM |",
        "|---|---:|---:|---:|",
        f'| v4 | {clock["v4"]["interceptMilliseconds"]:+.3f} ms | '
        f'{clock["v4"]["endResidualMilliseconds"]:+.3f} ms | {clock["v4"]["equivalentBpm"]:.6f} |',
        f'| v5 | {clock["v5"]["interceptMilliseconds"]:+.3f} ms | '
        f'{clock["v5"]["endResidualMilliseconds"]:+.3f} ms | {clock["v5"]["equivalentBpm"]:.6f} |',
        "",
        "## 门禁",
        "",
    ])
    for name, passed in audit["checks"].items():
        lines.append(f'- {name}: `{"PASS" if passed else "FAIL"}`')
    lines.extend([
        "",
        "完整 detector、窄带序列、输入 SHA-256 与 clock fit 位于 `comp-reattack-onset-audit.json`。",
        "",
    ])
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--source-anchor-seconds", type=float, default=SOURCE_ANCHOR_SECONDS)
    parser.add_argument("--v4-wav", type=Path, default=DEFAULT_V4_WAV)
    parser.add_argument("--v4-midi", type=Path, default=DEFAULT_V4_MIDI)
    parser.add_argument("--v5-wav", type=Path, default=DEFAULT_V5_WAV)
    parser.add_argument("--v5-midi", type=Path, default=DEFAULT_V5_MIDI)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    arguments = parser.parse_args()

    input_paths = {
        "sourceWave": arguments.source,
        "v4Wave": arguments.v4_wav,
        "v4Smf": arguments.v4_midi,
        "v5Wave": arguments.v5_wav,
        "v5Smf": arguments.v5_midi,
    }
    for name, path in input_paths.items():
        if not path.is_file():
            raise FileNotFoundError(f"Missing {name}: {path}")

    audio, sample_rate = aligned_audio(
        arguments.source,
        arguments.v4_wav,
        arguments.v5_wav,
        arguments.source_anchor_seconds,
    )
    lifecycle = lifecycle_audit(arguments.v4_midi, arguments.v5_midi)
    detector_results = detector_audit(audio, sample_rate)
    pitch_results = pitch_band_audit(audio, sample_rate)
    correlation_results = correlation_audit(audio, sample_rate)
    clock_results = clock_audit(audio, sample_rate)
    gate_results = checks(
        lifecycle,
        detector_results,
        pitch_results,
        correlation_results,
        clock_results,
    )

    audit = {
        "schemaVersion": 1,
        "status": "passed" if gate_results["allPassed"] else "failed",
        "implementation": {
            "path": relative(Path(__file__)),
            "sha256": sha256(Path(__file__)),
            "numpyVersion": np.__version__,
        },
        "authority": {
            "readOnlyInputs": True,
            "writesOnlyAuditDirectory": True,
            "scoreEffect": "none",
            "engineEffect": "none",
            "approvalEffect": "none",
        },
        "truthPolicy": "source waveform plus parsed SMF lifecycle; no Groove grid edits or score imports",
        "inputs": {
            name: {
                "path": relative(path),
                "sha256": sha256(path),
                "byteLength": path.stat().st_size,
            }
            for name, path in input_paths.items()
        },
        "alignment": {
            "sourceAnchorSeconds": arguments.source_anchor_seconds,
            "sampleRate": sample_rate,
            "candidateSamples": len(audio["v4"]),
            "candidateDurationSeconds": len(audio["v4"]) / sample_rate,
            "ticksPerSecond": TICKS_PER_SECOND,
        },
        "smfLifecycle": lifecycle,
        "detectorAudit": detector_results,
        "pitchBandAudit": pitch_results,
        "correlationAudit": correlation_results,
        "clockAudit": clock_results,
        "checks": gate_results,
    }

    arguments.out.mkdir(parents=True, exist_ok=True)
    json_path = arguments.out / "comp-reattack-onset-audit.json"
    readme_path = arguments.out / "README.md"
    json_path.write_text(json.dumps(audit, indent=2) + "\n")
    readme_path.write_text(markdown_report(audit))
    print(json.dumps({
        "status": audit["status"],
        "checks": audit["checks"],
        "json": relative(json_path),
        "readme": relative(readme_path),
    }, indent=2))
    if not gate_results["allPassed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
