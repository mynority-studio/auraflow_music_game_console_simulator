#!/usr/bin/env python3
"""Full-song, read-only timing audit for a Take Five VideoReplica candidate.

The source recording is the acoustic timing authority.  The rendered candidate WAV
is used to observe what the fixed score actually plays.  The 5/4 metric grid
is *annotation only*: it describes phase, 3+2 grouping and microtiming, and is
never used to snap or rewrite performed ticks.

Default outputs:
  tmp/video-replica/take-five-full-curation-v5/full-audit/timing/
    full-timing-audit.json
    strike-onset-residuals.csv
    bar-metric-audit.csv
    attack-candidate-queue.csv
    README.md
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import struct
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "tmp/jazz-five-four-analysis/reference.wav"
DEFAULT_RENDER = ROOT / "tmp/video-replica/take-five-full-curation-v5/take-five-full-curation-v5.wav"
DEFAULT_NOTES = ROOT / "tmp/video-replica/take-five-full-curation-v5/take-five-full-curation-v5.notes.json"
DEFAULT_EVIDENCE = ROOT / "tmp/video-replica/take-five-full-provisional/take-five-full-provisional.notes.json"
DEFAULT_OUTPUT = ROOT / "tmp/video-replica/take-five-full-curation-v5/full-audit/timing"


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


DETECTORS = (
    NoveltyConfig("wide-1024", 1024, 64, 80.0, 9000.0, 5.0, 0.20, 1),
    NoveltyConfig("attack-512", 512, 32, 180.0, 9000.0, 7.0, 0.15, 2),
    NoveltyConfig("body-1024", 1024, 64, 60.0, 3500.0, 5.0, 0.35, 2),
    NoveltyConfig("mid-512", 512, 32, 300.0, 5000.0, 8.0, 0.30, 1),
)
GLOBAL_DETECTOR = NoveltyConfig("clock-wide", 1024, 64, 80.0, 9000.0, 5.0, 0.0, 12)


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
    """Read PCM16/float32 WAV, including WAVE_FORMAT_EXTENSIBLE."""
    with path.open("rb") as handle:
        if handle.read(4) != b"RIFF":
            raise ValueError(f"{path} is not RIFF")
        handle.read(4)
        if handle.read(4) != b"WAVE":
            raise ValueError(f"{path} is not WAVE")
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
        raise ValueError(f"{path} has no usable fmt/data")
    tag, channels, sample_rate, _, _, bits = struct.unpack("<HHIIHH", fmt[:16])
    if tag == 0xFFFE and len(fmt) >= 26:
        tag = struct.unpack("<H", fmt[24:26])[0]
    if tag == 1 and bits == 16:
        samples = np.frombuffer(payload, dtype="<i2").astype(np.float64) / 32768.0
    elif tag == 3 and bits == 32:
        samples = np.frombuffer(payload, dtype="<f4").astype(np.float64)
    else:
        raise ValueError(f"unsupported WAV tag={tag}, bits={bits}: {path}")
    if channels < 1 or len(samples) % channels:
        raise ValueError(f"invalid channel payload: {path}")
    return samples.reshape(-1, channels).mean(axis=1), sample_rate


def robust_scale(values: np.ndarray) -> np.ndarray:
    p50 = float(np.percentile(values, 50))
    p95 = float(np.percentile(values, 95))
    return np.maximum((values - p50) / (p95 - p50 + 1e-12), 0.0)


def novelty(signal: np.ndarray, sample_rate: int, config: NoveltyConfig) -> Novelty:
    """Memory-bounded spectral flux plus energy-rise novelty."""
    signal = signal.astype(np.float64, copy=True)
    signal -= float(np.mean(signal))
    signal /= float(np.percentile(np.abs(signal), 99)) + 1e-12
    emphasized = np.r_[signal[0], signal[1:] - 0.97 * signal[:-1]]
    frame_count = 1 + (len(signal) - config.fft_size) // config.hop_size
    if frame_count < 2:
        raise ValueError("audio shorter than novelty FFT")
    frequencies = np.fft.rfftfreq(config.fft_size, 1.0 / sample_rate)
    bins = (frequencies >= config.low_hz) & (frequencies <= config.high_hz)
    window = np.hanning(config.fft_size)
    flux = np.zeros(frame_count, dtype=np.float64)
    rms = np.zeros(frame_count, dtype=np.float64)
    previous: np.ndarray | None = None
    batch_size = 1024
    for first in range(0, frame_count, batch_size):
        count = min(batch_size, frame_count - first)
        starts = (first + np.arange(count)) * config.hop_size
        indices = starts[:, None] + np.arange(config.fft_size)[None, :]
        frames = emphasized[indices]
        compressed = np.log1p(config.log_gain * np.abs(np.fft.rfft(frames * window, axis=1)[:, bins]))
        if previous is not None:
            flux[first] = np.maximum(compressed[0] - previous, 0.0).sum()
        if count > 1:
            flux[first + 1:first + count] = np.maximum(compressed[1:] - compressed[:-1], 0.0).sum(axis=1)
        previous = compressed[-1]
        raw = signal[indices]
        rms[first:first + count] = np.sqrt(np.mean(raw * raw, axis=1) + 1e-12)
    flux = robust_scale(flux)
    energy_rise = robust_scale(np.r_[0.0, np.maximum(np.diff(np.log(rms + 1e-7)), 0.0)])
    values = flux + config.energy_weight * energy_rise
    if config.smooth_frames:
        kernel = np.hanning(config.smooth_frames * 2 + 1)
        kernel /= float(kernel.sum())
        values = np.convolve(values, kernel, mode="same")
    values = robust_scale(values)
    times = (np.arange(frame_count) * config.hop_size + config.fft_size / 2) / sample_rate
    return Novelty(times, values)


def correlation_at_lag(source: np.ndarray, render: np.ndarray, lag: int) -> float:
    if lag > 0:
        source, render = source[lag:], render[:-lag]
    elif lag < 0:
        source, render = source[:lag], render[-lag:]
    if len(source) < 16:
        return -1.0
    source = (source - float(np.mean(source))) / (float(np.std(source)) + 1e-12)
    render = (render - float(np.mean(render))) / (float(np.std(render)) + 1e-12)
    return float(np.mean(source * render))


def weighted_affine(points: list[tuple[float, float, float]]) -> tuple[float, float, list[int]]:
    if len(points) < 3:
        return 0.0, 0.0, []
    x = np.asarray([[1.0, center] for center, _, _ in points])
    y = np.asarray([lag for _, lag, _ in points])
    weights = np.asarray([max(score, 0.01) ** 2 for _, _, score in points])
    keep = np.ones(len(points), dtype=bool)
    coefficients = np.zeros(2)
    for _ in range(6):
        xx, yy, ww = x[keep], y[keep], weights[keep]
        coefficients = np.linalg.lstsq(xx * np.sqrt(ww[:, None]), yy * np.sqrt(ww), rcond=None)[0]
        residuals = y - x @ coefficients
        median = float(np.median(residuals[keep]))
        mad = 1.4826 * float(np.median(np.abs(residuals[keep] - median)))
        next_keep = np.abs(residuals - median) <= max(0.005, 2.75 * mad)
        if int(np.sum(next_keep)) < 3 or np.array_equal(next_keep, keep):
            break
        keep = next_keep
    return float(coefficients[0]), float(coefficients[1]), np.flatnonzero(keep).tolist()


def estimate_clock(source: Novelty, render: Novelty, duration: float) -> dict[str, Any]:
    common = min(len(source.values), len(render.values))
    source_values, render_values = source.values[:common], render.values[:common]
    times = source.times[:common]
    hop_seconds = float(times[1] - times[0])
    max_lag = int(round(0.045 / hop_seconds))
    windows: list[dict[str, Any]] = []
    points: list[tuple[float, float, float]] = []
    width, step = 3.0, 1.5
    center = width / 2
    while center <= duration - width / 2 + 1e-9:
        mask = (times >= center - width / 2) & (times < center + width / 2)
        a, b = source_values[mask], render_values[mask]
        candidates = [(lag, correlation_at_lag(a, b, lag)) for lag in range(-max_lag, max_lag + 1)]
        best_lag, best_score = max(candidates, key=lambda item: item[1])
        lag_seconds = best_lag * hop_seconds
        usable = best_score >= 0.22
        windows.append({
            "startSeconds": center - width / 2,
            "endSeconds": center + width / 2,
            "centerSeconds": center,
            "sourceMinusRenderLagSeconds": lag_seconds,
            "correlation": best_score,
            "usable": usable,
        })
        if usable:
            points.append((center, lag_seconds, best_score))
        center += step
    intercept, slope, kept = weighted_affine(points)
    inliers = [points[index] for index in kept]
    fitted = [intercept + slope * center for center, _, _ in inliers]
    errors = [lag - fit for (_, lag, _), fit in zip(inliers, fitted, strict=True)]
    segment_bounds = (
        ("opening", 0.0, min(15.0, duration)),
        ("comp-entry", min(15.0, duration), min(24.0, duration)),
        ("middle", min(24.0, duration), min(36.0, duration)),
        ("tail", min(36.0, duration), duration),
    )
    segments: list[dict[str, Any]] = []
    for name, start, end in segment_bounds:
        selected = [
            row for row in windows
            if row["usable"] and start <= row["centerSeconds"] < end
        ]
        lags = [float(row["sourceMinusRenderLagSeconds"]) for row in selected]
        correlations = [float(row["correlation"]) for row in selected]
        segments.append({
            "name": name,
            "startSeconds": start,
            "endSeconds": end,
            "usableWindowCount": len(selected),
            "medianLagSeconds": float(np.median(lags)) if lags else None,
            "lagMadSeconds": median_absolute_deviation(lags) if lags else None,
            "lagP10Seconds": percentile(lags, 10),
            "lagP90Seconds": percentile(lags, 90),
            "medianCorrelation": float(np.median(correlations)) if correlations else None,
        })
    return {
        "method": "robust affine fit to 3 s spectral-flux cross-correlation windows",
        "interceptSeconds": intercept,
        "driftSecondsPerSecond": slope,
        "timeScale": 1.0 + slope,
        "endResidualSeconds": intercept + slope * duration,
        "equivalentBpm": 200.0 / (1.0 + slope),
        "usableWindowCount": len(points),
        "inlierWindowCount": len(inliers),
        "inlierResidualMadSeconds": median_absolute_deviation(errors) if errors else None,
        "interpretation": "The affine fit and segment lags describe source/render acoustic alignment. Window variation is not authorization to rewrite BPM or performed ticks.",
        "segments": segments,
        "windows": windows,
    }


def median_absolute_deviation(values: Iterable[float]) -> float:
    array = np.asarray(list(values), dtype=np.float64)
    if not len(array):
        return math.nan
    median = float(np.median(array))
    return 1.4826 * float(np.median(np.abs(array - median)))


def percentile(values: list[float], q: float) -> float | None:
    return float(np.percentile(values, q)) if values else None


def local_maximum(curve: Novelty, center: float, left: float, right: float, radius: float) -> dict[str, float] | None:
    left, right = max(left, center - radius), min(right, center + radius)
    indices = np.flatnonzero((curve.times >= left) & (curve.times <= right))
    if len(indices) < 2:
        return None
    values = curve.values
    peaks = [
        int(index) for index in indices
        if (index == 0 or values[index] >= values[index - 1])
        and (index + 1 == len(values) or values[index] > values[index + 1])
    ] or [int(index) for index in indices]
    scores = [
        math.log1p(3.0 * float(values[index]))
        - 0.24 * ((float(curve.times[index]) - center) / max(radius, 1e-9)) ** 2
        for index in peaks
    ]
    index = peaks[int(np.argmax(scores))]
    before = values[(curve.times >= curve.times[index] - 0.050) & (curve.times <= curve.times[index] - 0.008)]
    baseline = float(np.median(before)) if len(before) else float(np.median(values[indices]))
    return {
        "seconds": float(curve.times[index]),
        "strength": float(values[index] - baseline),
        "normalizedValue": float(values[index]),
        "distanceFromCenterSeconds": float(curve.times[index] - center),
    }


def metric_annotation(tick: int, ppq: int, numerator: int) -> dict[str, Any]:
    bar_ticks = ppq * numerator
    bar_index = tick // bar_ticks
    phase = tick - bar_index * bar_ticks
    beat = 1.0 + phase / ppq
    group = "3-beat" if phase < 3 * ppq else "2-beat"
    eighth = ppq / 2
    eighth_index = int(round(phase / eighth))
    eighth_target = eighth_index * eighth
    eighth_offset = phase - eighth_target
    anchors = [0, 3 * ppq, bar_ticks]
    anchor = min(anchors, key=lambda value: abs(phase - value))
    anchor_name = "bar/downbeat" if anchor in {0, bar_ticks} else "3+2 second-group start"
    return {
        "nominalBarIndexZeroBased": int(bar_index),
        "nominalBarNumber": int(bar_index + 1),
        "phaseTicks": int(phase),
        "beatOneBased": beat,
        "threePlusTwoGroup": group,
        "nearestEighthIndex": eighth_index,
        "microtimingOffsetFromNearestEighthTicks": float(eighth_offset),
        "microtimingOffsetFromNearestEighthMilliseconds": float(eighth_offset / 1600.0 * 1000),
        "nearestThreePlusTwoAnchor": anchor_name,
        "offsetFromNearestThreePlusTwoAnchorTicks": int(phase - anchor),
    }


def score_group_id(note: dict[str, Any]) -> str:
    """Resolve a physical-strike id for evidence and curated observations.

    Evidence notes inherit their immutable detector strike.  A source-observed
    addition may explicitly join a related strike, or form a new physical
    strike when it is an independently observed attack.  This keeps the timing
    audit able to cover positive observations without inventing raw evidence.
    """
    if note.get("origin") == "curated-observation":
        related = note.get("relatedStrikeGroupId")
        return str(related) if related else f'observation-strike-{note["eventId"]}'
    return str(note["strikeGroupId"])


def score_groups(notes: list[dict[str, Any]], evidence_groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    notes_by_group: dict[str, list[dict[str, Any]]] = {}
    for note in notes:
        notes_by_group.setdefault(score_group_id(note), []).append(note)
    rows: list[dict[str, Any]] = []
    evidence_group_ids = {str(group["id"]) for group in evidence_groups}
    for group in evidence_groups:
        retained = notes_by_group.get(group["id"], [])
        row = {
            **group,
            "retainedInScore": bool(retained),
            "retainedEventIds": [note["eventId"] for note in retained],
            "roles": sorted({note["role"] for note in retained}),
            "midis": sorted(note["midi"] for note in retained),
            "velocities": sorted(note["velocity"] for note in retained),
        }
        observed = [note for note in retained if note.get("origin") == "curated-observation"]
        if observed:
            score_anchor = min(int(note["performedStartTick"]) for note in retained)
            score_latest = max(int(note["performedStartTick"]) for note in retained)
            row.update({
                "sourceEvidenceAnchorTick": int(group["anchorTick"]),
                "anchorTick": score_anchor,
                "spreadTicks": score_latest - score_anchor,
                "curatedObservationIds": [note["eventId"] for note in observed],
            })
        rows.append(row)
    for group_id, retained in notes_by_group.items():
        if group_id in evidence_group_ids:
            continue
        starts = [int(note["performedStartTick"]) for note in retained]
        rows.append({
            "id": group_id,
            "anchorTick": min(starts),
            "spreadTicks": max(starts) - min(starts),
            "evidenceIds": [],
            "interpretation": "source-observed-independent-strike",
            "retainedInScore": True,
            "retainedEventIds": [note["eventId"] for note in retained],
            "roles": sorted({note["role"] for note in retained}),
            "midis": sorted(note["midi"] for note in retained),
            "velocities": sorted(note["velocity"] for note in retained),
            "curatedObservationIds": [note["eventId"] for note in retained],
        })
    rows.sort(key=lambda row: (int(row["anchorTick"]), str(row["id"])))
    return rows


def analyse_groups(
    groups: list[dict[str, Any]],
    detector_pairs: dict[str, tuple[Novelty, Novelty]],
    clock: dict[str, Any],
    ticks_per_second: float,
    duration: float,
    ppq: int,
    numerator: int,
) -> list[dict[str, Any]]:
    retained = [group for group in groups if group["retainedInScore"]]
    anchors = np.asarray([float(group["anchorTick"]) / ticks_per_second for group in retained])
    alpha, beta = float(clock["interceptSeconds"]), float(clock["timeScale"])
    rows: list[dict[str, Any]] = []
    for index, (group, event_seconds) in enumerate(zip(retained, anchors, strict=True)):
        left = 0.0 if index == 0 else float((anchors[index - 1] + event_seconds) / 2)
        right = duration + 0.060 if index + 1 == len(anchors) else float((event_seconds + anchors[index + 1]) / 2)
        source_center = alpha + beta * event_seconds
        source_left, source_right = alpha + beta * left, alpha + beta * right
        variants: list[dict[str, Any]] = []
        usable: list[dict[str, Any]] = []
        for name, (source_curve, render_curve) in detector_pairs.items():
            render_peak = local_maximum(render_curve, event_seconds, left, right, 0.022)
            source_peak = local_maximum(source_curve, source_center, source_left, source_right, 0.042)
            variant: dict[str, Any] = {
                "detector": name,
                "sourcePeak": source_peak,
                "renderPeak": render_peak,
                "usable": False,
            }
            if render_peak is not None and source_peak is not None:
                local_residual = source_peak["seconds"] - (alpha + beta * render_peak["seconds"])
                variant.update({
                    "sourceMinusRenderSeconds": source_peak["seconds"] - render_peak["seconds"],
                    "detrendedLocalResidualSeconds": local_residual,
                })
                variant["usable"] = bool(
                    abs(render_peak["distanceFromCenterSeconds"]) <= 0.014
                    and abs(source_peak["distanceFromCenterSeconds"]) <= 0.034
                    and render_peak["strength"] >= 0.18
                    and source_peak["strength"] >= 0.14
                )
                if variant["usable"]:
                    usable.append(variant)
            variants.append(variant)
        residuals = [float(item["detrendedLocalResidualSeconds"]) for item in usable]
        totals = [float(item["sourceMinusRenderSeconds"]) for item in usable]
        residual = float(np.median(residuals)) if residuals else None
        total = float(np.median(totals)) if totals else None
        mad = median_absolute_deviation(residuals) if residuals else None
        residual_range = max(residuals) - min(residuals) if residuals else None
        previous_gap = math.inf if index == 0 else (event_seconds - anchors[index - 1]) * 1000
        next_gap = math.inf if index + 1 == len(anchors) else (anchors[index + 1] - event_seconds) * 1000
        isolation = float(min(previous_gap, next_gap))
        if (
            len(usable) >= 3
            and mad is not None
            and mad <= 0.0045
            and residual_range is not None
            and residual_range <= 0.008
            and isolation >= 42
        ):
            confidence = "high"
        elif (
            len(usable) >= 2
            and mad is not None
            and mad <= 0.008
            and residual_range is not None
            and residual_range <= 0.016
            and isolation >= 26
        ):
            confidence = "medium"
        else:
            confidence = "low"
        waveform_supported = bool(
            confidence == "high"
            and len(usable) == 4
            and residual_range is not None
            and residual_range <= 0.006
            and residual is not None
            and abs(residual) >= 0.012
        )
        review = bool(confidence in {"high", "medium"} and residual is not None and abs(residual) >= 0.008)
        rows.append({
            "groupId": group["id"],
            "anchorTick": int(group["anchorTick"]),
            "performedSeconds": event_seconds,
            "spreadTicks": int(group["spreadTicks"]),
            "retainedEventIds": group["retainedEventIds"],
            "roles": group["roles"],
            "midis": group["midis"],
            "isolationMilliseconds": isolation,
            "usableDetectors": len(usable),
            "confidence": confidence,
            "sourceMinusRenderSeconds": total,
            "detrendedLocalResidualSeconds": residual,
            "detectorConsensusMadSeconds": mad,
            "detectorResidualRangeSeconds": residual_range,
            "waveformSupportedTimingCandidate": waveform_supported,
            "timingReviewCandidate": review,
            "suggestedTickDeltaForReviewOnly": int(round(residual * ticks_per_second)) if review and residual is not None else None,
            "metricAnnotation": metric_annotation(int(group["anchorTick"]), ppq, numerator),
            "detectors": variants,
        })
    return rows


def detector_peaks(curve: Novelty, threshold: float = 0.40, refractory_seconds: float = 0.028) -> list[dict[str, float]]:
    candidates = [
        index for index in range(1, len(curve.values) - 1)
        if curve.values[index] >= threshold
        and curve.values[index] >= curve.values[index - 1]
        and curve.values[index] > curve.values[index + 1]
    ]
    accepted: list[int] = []
    for index in sorted(candidates, key=lambda item: float(curve.values[item]), reverse=True):
        if all(abs(float(curve.times[index] - curve.times[other])) >= refractory_seconds for other in accepted):
            accepted.append(index)
    return [
        {"seconds": float(curve.times[index]), "strength": float(curve.values[index])}
        for index in sorted(accepted)
    ]


def consensus_peaks(curves: dict[str, Novelty]) -> list[dict[str, Any]]:
    observations: list[dict[str, Any]] = []
    for detector, curve in curves.items():
        for peak in detector_peaks(curve):
            observations.append({"detector": detector, **peak})
    observations.sort(key=lambda row: row["seconds"])
    clusters: list[list[dict[str, Any]]] = []
    for observation in observations:
        choices = [
            cluster for cluster in clusters
            if abs(float(np.median([row["seconds"] for row in cluster])) - observation["seconds"]) <= 0.014
            and observation["detector"] not in {row["detector"] for row in cluster}
        ]
        if choices:
            min(choices, key=lambda cluster: abs(float(np.median([row["seconds"] for row in cluster])) - observation["seconds"])).append(observation)
        else:
            clusters.append([observation])
    result = []
    for cluster in clusters:
        detector_count = len({row["detector"] for row in cluster})
        if detector_count < 3:
            continue
        result.append({
            "seconds": float(np.median([row["seconds"] for row in cluster])),
            "detectorCount": detector_count,
            "meanStrength": float(np.mean([row["strength"] for row in cluster])),
            "detectors": cluster,
        })
    return result


def match_consensus_to_groups(
    peaks: list[dict[str, Any]],
    rows: list[dict[str, Any]],
    clock: dict[str, Any],
    domain: str,
) -> tuple[list[dict[str, Any]], set[str]]:
    alpha, beta = float(clock["interceptSeconds"]), float(clock["timeScale"])
    unmatched = set(range(len(peaks)))
    matched_groups: set[str] = set()
    # Most isolated groups choose first; this avoids a dense roll stealing its neighbour's peak.
    for row in sorted(rows, key=lambda item: item["isolationMilliseconds"], reverse=True):
        expected = row["performedSeconds"] if domain == "render" else alpha + beta * row["performedSeconds"]
        candidates = [index for index in unmatched if abs(peaks[index]["seconds"] - expected) <= 0.048]
        if not candidates:
            continue
        index = min(candidates, key=lambda item: abs(peaks[item]["seconds"] - expected))
        unmatched.remove(index)
        matched_groups.add(row["groupId"])
    return [peaks[index] for index in sorted(unmatched)], matched_groups


def bar_audit(rows: list[dict[str, Any]], ppq: int, numerator: int, duration_ticks: int) -> list[dict[str, Any]]:
    bar_ticks = ppq * numerator
    bar_count = math.ceil(duration_ticks / bar_ticks)
    result: list[dict[str, Any]] = []
    for bar_index in range(bar_count):
        selected = [row for row in rows if row["metricAnnotation"]["nominalBarIndexZeroBased"] == bar_index]
        offsets = [float(row["metricAnnotation"]["microtimingOffsetFromNearestEighthTicks"]) for row in selected]
        reliable = [
            float(row["detrendedLocalResidualSeconds"])
            for row in selected
            if row["confidence"] in {"high", "medium"} and row["detrendedLocalResidualSeconds"] is not None
        ]
        anchors: dict[str, Any] = {}
        for name, target in (("downbeat", 0), ("secondGroup", 3 * ppq)):
            candidates = [
                (abs(row["metricAnnotation"]["phaseTicks"] - target), row)
                for row in selected
                if abs(row["metricAnnotation"]["phaseTicks"] - target) <= ppq * 0.375
            ]
            if candidates:
                _, nearest = min(candidates, key=lambda item: item[0])
                anchors[name] = {
                    "groupId": nearest["groupId"],
                    "phaseTicks": nearest["metricAnnotation"]["phaseTicks"],
                    "offsetTicks": nearest["metricAnnotation"]["phaseTicks"] - target,
                    "offsetMilliseconds": (nearest["metricAnnotation"]["phaseTicks"] - target) / 1600.0 * 1000,
                }
            else:
                anchors[name] = None
        role_counts = {
            role: sum(role in row["roles"] for row in selected)
            for role in ("bass", "comp", "lead")
        }
        result.append({
            "nominalBarIndexZeroBased": bar_index,
            "nominalBarNumber": bar_index + 1,
            "startTick": bar_index * bar_ticks,
            "endTickExclusive": min((bar_index + 1) * bar_ticks, duration_ticks),
            "startPerformedSeconds": bar_index * bar_ticks / 1600.0,
            "strikeCount": len(selected),
            "threeBeatGroupStrikeCount": sum(row["metricAnnotation"]["threePlusTwoGroup"] == "3-beat" for row in selected),
            "twoBeatGroupStrikeCount": sum(row["metricAnnotation"]["threePlusTwoGroup"] == "2-beat" for row in selected),
            "roleStrikeCounts": role_counts,
            "threePlusTwoAnchorObservation": anchors,
            "rubatoProxy": {
                "definition": "descriptive offsets from nearest nominal eighth; syncopations/rolls are retained and this is not an error score",
                "medianEighthOffsetTicks": float(np.median(offsets)) if offsets else None,
                "eighthOffsetMadTicks": median_absolute_deviation(offsets) if offsets else None,
                "absoluteEighthOffsetP90Ticks": percentile([abs(value) for value in offsets], 90),
            },
            "replicationResidual": {
                "reliableStrikeCount": len(reliable),
                "medianMilliseconds": float(np.median(reliable) * 1000) if reliable else None,
                "absoluteP90Milliseconds": percentile([abs(value) * 1000 for value in reliable], 90),
            },
            "groupIds": [row["groupId"] for row in selected],
        })
    return result


def remaining_same_key_overlaps(notes: list[dict[str, Any]], rows_by_group: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Report score lifecycle collisions exactly; do not repair them here."""
    buckets: dict[tuple[str, int], list[dict[str, Any]]] = {}
    for note in notes:
        buckets.setdefault((note["role"], int(note["midi"])), []).append(note)
    collisions: list[dict[str, Any]] = []
    for (role, midi), bucket in sorted(buckets.items()):
        ordered = sorted(bucket, key=lambda note: (note["performedStartTick"], note["eventId"]))
        for predecessor, successor in zip(ordered, ordered[1:], strict=False):
            predecessor_end = predecessor["performedStartTick"] + predecessor["performedDurationTicks"]
            overlap_ticks = predecessor_end - successor["performedStartTick"]
            if overlap_ticks <= 0:
                continue
            successor_group_id = score_group_id(successor)
            onset_row = rows_by_group[successor_group_id]
            collisions.append({
                "role": role,
                "midi": midi,
                "predecessorEventId": predecessor["eventId"],
                "successorEventId": successor["eventId"],
                "predecessorEndTick": predecessor_end,
                "successorOnsetTick": successor["performedStartTick"],
                "overlapTicks": overlap_ticks,
                "successorStrikeGroupId": successor_group_id,
                "successorOnsetAuditConfidence": onset_row["confidence"],
                "successorOnsetResidualMilliseconds": None if onset_row["detrendedLocalResidualSeconds"] is None else onset_row["detrendedLocalResidualSeconds"] * 1000,
                "interpretation": "Current score lifecycle collision. It may suppress the successor in MIDI playback, but it does not mean the successor onset tick itself is wrong.",
            })
    return sorted(collisions, key=lambda row: (row["successorOnsetTick"], row["role"], row["midi"]))


def write_outputs(
    output: Path,
    audit: dict[str, Any],
    rows: list[dict[str, Any]],
    bars: list[dict[str, Any]],
    queue: list[dict[str, Any]],
) -> None:
    output.mkdir(parents=True, exist_ok=True)
    (output / "full-timing-audit.json").write_text(json.dumps(audit, indent=2) + "\n")
    with (output / "strike-onset-residuals.csv").open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow([
            "groupId", "anchorTick", "performedSeconds", "bar", "beat", "phaseTicks", "3+2Group",
            "roles", "midis", "spreadTicks", "isolationMs", "usableDetectors", "confidence",
            "sourceMinusRenderMs", "detrendedResidualMs", "detectorMadMs", "detectorRangeMs",
            "waveformSupportedTimingCandidate", "review",
            "suggestedTickDeltaReviewOnly",
        ])
        for row in rows:
            metric = row["metricAnnotation"]
            writer.writerow([
                row["groupId"], row["anchorTick"], f'{row["performedSeconds"]:.6f}', metric["nominalBarNumber"],
                f'{metric["beatOneBased"]:.6f}', metric["phaseTicks"], metric["threePlusTwoGroup"],
                ";".join(row["roles"]), ";".join(map(str, row["midis"])), row["spreadTicks"],
                f'{row["isolationMilliseconds"]:.3f}', row["usableDetectors"], row["confidence"],
                "" if row["sourceMinusRenderSeconds"] is None else f'{row["sourceMinusRenderSeconds"] * 1000:.3f}',
                "" if row["detrendedLocalResidualSeconds"] is None else f'{row["detrendedLocalResidualSeconds"] * 1000:.3f}',
                "" if row["detectorConsensusMadSeconds"] is None else f'{row["detectorConsensusMadSeconds"] * 1000:.3f}',
                "" if row["detectorResidualRangeSeconds"] is None else f'{row["detectorResidualRangeSeconds"] * 1000:.3f}',
                row["waveformSupportedTimingCandidate"], row["timingReviewCandidate"],
                "" if row["suggestedTickDeltaForReviewOnly"] is None else row["suggestedTickDeltaForReviewOnly"],
            ])
    with (output / "bar-metric-audit.csv").open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow([
            "bar", "startTick", "strikes", "3beatStrikes", "2beatStrikes", "bass", "comp", "lead",
            "downbeatOffsetTicks", "secondGroupOffsetTicks", "medianEighthOffsetTicks", "eighthMadTicks",
            "reliableResidualCount", "medianResidualMs", "absoluteResidualP90Ms",
        ])
        for bar in bars:
            anchor = bar["threePlusTwoAnchorObservation"]
            rubato = bar["rubatoProxy"]
            residual = bar["replicationResidual"]
            writer.writerow([
                bar["nominalBarNumber"], bar["startTick"], bar["strikeCount"],
                bar["threeBeatGroupStrikeCount"], bar["twoBeatGroupStrikeCount"],
                bar["roleStrikeCounts"]["bass"], bar["roleStrikeCounts"]["comp"], bar["roleStrikeCounts"]["lead"],
                "" if anchor["downbeat"] is None else anchor["downbeat"]["offsetTicks"],
                "" if anchor["secondGroup"] is None else anchor["secondGroup"]["offsetTicks"],
                "" if rubato["medianEighthOffsetTicks"] is None else f'{rubato["medianEighthOffsetTicks"]:.3f}',
                "" if rubato["eighthOffsetMadTicks"] is None else f'{rubato["eighthOffsetMadTicks"]:.3f}',
                residual["reliableStrikeCount"],
                "" if residual["medianMilliseconds"] is None else f'{residual["medianMilliseconds"]:.3f}',
                "" if residual["absoluteP90Milliseconds"] is None else f'{residual["absoluteP90Milliseconds"]:.3f}',
            ])
    with (output / "attack-candidate-queue.csv").open("w", newline="") as handle:
        fields = ["kind", "id", "performedSeconds", "anchorTick", "confidence", "reason", "detectorCount", "residualMilliseconds"]
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(queue)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--render", type=Path, default=DEFAULT_RENDER)
    parser.add_argument("--notes", type=Path, default=DEFAULT_NOTES)
    parser.add_argument("--evidence", type=Path, default=DEFAULT_EVIDENCE)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    arguments = parser.parse_args()

    manifest = json.loads(arguments.notes.read_text())
    baseline = json.loads(arguments.evidence.read_text())
    score_revision = str(manifest["score"].get("replicaRevision", manifest["score"].get("id", "candidate")))
    source_manifest = manifest["source"]
    ppq, bpm = int(source_manifest["ppq"]), float(source_manifest["bpm"])
    numerator = int(source_manifest["meter"]["numerator"])
    ticks_per_second = ppq * bpm / 60.0
    if (ppq, bpm, numerator) != (480, 200.0, 5):
        raise ValueError(f"unexpected replica clock/meter: ppq={ppq}, bpm={bpm}, numerator={numerator}")
    all_notes = [note for track in manifest["tracks"].values() for note in track["notes"]]
    groups = score_groups(all_notes, baseline["evidence"]["strikeGroups"])
    retained_groups = [group for group in groups if group["retainedInScore"]]
    duration_ticks = int(manifest["score"]["durationPerformedTicks"])
    duration = duration_ticks / ticks_per_second

    source_audio, source_rate = read_wave(arguments.source)
    render_audio, render_rate = read_wave(arguments.render)
    if source_rate != render_rate:
        raise ValueError(f"sample-rate mismatch: {source_rate} vs {render_rate}")
    source_start = int(round(float(source_manifest["tickZeroAtVideoSeconds"]) * source_rate))
    sample_count = min(len(render_audio), len(source_audio) - source_start, int(round((duration + 0.080) * source_rate)))
    source_audio = source_audio[source_start:source_start + sample_count]
    render_audio = render_audio[:sample_count]
    analysis_duration = min(duration, sample_count / source_rate - 0.025)

    source_global = novelty(source_audio, source_rate, GLOBAL_DETECTOR)
    render_global = novelty(render_audio, render_rate, GLOBAL_DETECTOR)
    clock = estimate_clock(source_global, render_global, analysis_duration)
    clock.update({
        "manifestTickZeroAtVideoSeconds": float(source_manifest["tickZeroAtVideoSeconds"]),
        "fittedTickZeroAtVideoSeconds": float(source_manifest["tickZeroAtVideoSeconds"]) + clock["interceptSeconds"],
        "manifestBpm": bpm,
        "policy": "descriptive source/render alignment only; no performed tick mutation",
    })

    detector_pairs: dict[str, tuple[Novelty, Novelty]] = {}
    source_curves: dict[str, Novelty] = {}
    render_curves: dict[str, Novelty] = {}
    for config in DETECTORS:
        source_curve = novelty(source_audio, source_rate, config)
        render_curve = novelty(render_audio, render_rate, config)
        detector_pairs[config.name] = (source_curve, render_curve)
        source_curves[config.name], render_curves[config.name] = source_curve, render_curve
    rows = analyse_groups(retained_groups, detector_pairs, clock, ticks_per_second, analysis_duration, ppq, numerator)

    source_consensus, render_consensus = consensus_peaks(source_curves), consensus_peaks(render_curves)
    unmatched_source, source_matched = match_consensus_to_groups(source_consensus, rows, clock, "source")
    unmatched_render, render_matched = match_consensus_to_groups(render_consensus, rows, clock, "render")
    alpha, beta = float(clock["interceptSeconds"]), float(clock["timeScale"])
    missing_candidates = []
    for index, peak in enumerate(unmatched_source, 1):
        performed = (peak["seconds"] - alpha) / beta
        if performed < 0 or performed > analysis_duration:
            continue
        nearest = min(abs(performed - row["performedSeconds"]) for row in rows)
        has_render_counterpart = any(
            abs(peak["seconds"] - (alpha + beta * render_peak["seconds"])) <= 0.035
            for render_peak in render_consensus
        )
        if (
            nearest < 0.090
            or peak["detectorCount"] < 4
            or peak["meanStrength"] < 1.0
            or has_render_counterpart
        ):
            continue
        missing_candidates.append({
            "kind": "possible-missing-source-attack",
            "id": f"missing-{index:03d}",
            "performedSeconds": performed,
            "anchorTick": int(round(performed * ticks_per_second)),
            "confidence": "waveform-review-only",
            "reason": "all 4 source novelty detectors agree, mean strength >=1.0, no retained strike within 90 ms and no render consensus within 35 ms; pitch/video corroboration is still required",
            "detectorCount": peak["detectorCount"],
            "residualMilliseconds": None,
            "peak": peak,
        })
    possible_extras = []
    for row in rows:
        if (
            row["groupId"] in source_matched
            or row["groupId"] not in render_matched
            or row["confidence"] != "low"
            or row["usableDetectors"] > 1
        ):
            continue
        possible_extras.append({
            "kind": "possible-extra-score-attack",
            "id": row["groupId"],
            "performedSeconds": row["performedSeconds"],
            "anchorTick": row["anchorTick"],
            "confidence": "review-only",
            "reason": "render novelty consensus matched the strike but source consensus did not; four local detector details and video must decide",
            "detectorCount": row["usableDetectors"],
            "residualMilliseconds": None if row["detrendedLocalResidualSeconds"] is None else row["detrendedLocalResidualSeconds"] * 1000,
        })
    waveform_supported = [row for row in rows if row["waveformSupportedTimingCandidate"]]
    timing_review = [row for row in rows if row["timingReviewCandidate"] and not row["waveformSupportedTimingCandidate"]]
    low_confidence = [row for row in rows if row["confidence"] == "low"]
    queue: list[dict[str, Any]] = [
        {
            "kind": "waveform-supported-timing-candidate",
            "id": row["groupId"],
            "performedSeconds": row["performedSeconds"],
            "anchorTick": row["anchorTick"],
            "confidence": row["confidence"],
            "reason": "all 4 detectors usable, residual range <=6 ms, isolation >=42 ms and >=12 ms detrended source/render residual; waveform support alone does not prove a score error",
            "detectorCount": row["usableDetectors"],
            "residualMilliseconds": row["detrendedLocalResidualSeconds"] * 1000,
        }
        for row in waveform_supported
    ] + [
        {
            "kind": "timing-review-candidate",
            "id": row["groupId"],
            "performedSeconds": row["performedSeconds"],
            "anchorTick": row["anchorTick"],
            "confidence": row["confidence"],
            "reason": ">=8 ms reliable residual but below the conservative waveform-supported threshold",
            "detectorCount": row["usableDetectors"],
            "residualMilliseconds": row["detrendedLocalResidualSeconds"] * 1000,
        }
        for row in timing_review
    ] + missing_candidates + possible_extras

    rows_by_group = {row["groupId"]: row for row in rows}
    current_lifecycle_collisions = remaining_same_key_overlaps(all_notes, rows_by_group)
    queue.extend({
        "kind": "current-same-key-lifecycle-collision",
        "id": f'{row["predecessorEventId"]}->{row["successorEventId"]}',
        "performedSeconds": row["successorOnsetTick"] / ticks_per_second,
        "anchorTick": row["successorOnsetTick"],
        "confidence": "score-structural-fact",
        "reason": "same role + same MIDI predecessor ends after successor starts; note lifecycle may suppress the successor, while its onset tick remains unchanged",
        "detectorCount": None,
        "residualMilliseconds": row["successorOnsetResidualMilliseconds"],
    } for row in current_lifecycle_collisions)

    bars = bar_audit(rows, ppq, numerator, duration_ticks)
    reliable_abs = [
        abs(float(row["detrendedLocalResidualSeconds"]))
        for row in rows
        if row["confidence"] in {"high", "medium"} and row["detrendedLocalResidualSeconds"] is not None
    ]
    summary = {
        "evidenceStrikeGroups": len(groups),
        "retainedPhysicalStrikeGroupsAudited": len(rows),
        "fullyRejectedEvidenceGroups": len(groups) - len(rows),
        "highConfidence": sum(row["confidence"] == "high" for row in rows),
        "mediumConfidence": sum(row["confidence"] == "medium" for row in rows),
        "lowConfidence": len(low_confidence),
        "waveformSupportedTimingCandidates": len(waveform_supported),
        "additionalTimingReviewCandidates": len(timing_review),
        "possibleMissingSourceAttacks": len(missing_candidates),
        "possibleExtraScoreAttacks": len(possible_extras),
        "currentSameKeyLifecycleCollisions": len(current_lifecycle_collisions),
        "reliableAbsoluteResidualP50Milliseconds": None if not reliable_abs else percentile(reliable_abs, 50) * 1000,
        "reliableAbsoluteResidualP90Milliseconds": None if not reliable_abs else percentile(reliable_abs, 90) * 1000,
    }

    notes_by_id = {note["eventId"]: note for note in all_notes}
    corrected_lifecycle_regressions: list[dict[str, Any]] = []
    for correction in manifest["score"]["corrections"]:
        if "one-tick detector rounding overlap" not in correction.get("reason", ""):
            continue
        predecessor_id = correction["evidenceId"]
        successor_id = correction["reason"].split()[-1]
        predecessor, successor = notes_by_id[predecessor_id], notes_by_id[successor_id]
        successor_group_id = score_group_id(successor)
        onset_row = rows_by_group[successor_group_id]
        corrected_lifecycle_regressions.append({
            "predecessorEventId": predecessor_id,
            "successorEventId": successor_id,
            "midi": predecessor["midi"],
            "successorStrikeGroupId": successor_group_id,
            "successorOnsetTick": successor["performedStartTick"],
            "successorOnsetPerformedSeconds": successor["performedStartTick"] / ticks_per_second,
            "preCorrectionNoteOffTick": successor["performedStartTick"] + 1,
            "correctedNoteOffTick": successor["performedStartTick"],
            "onsetTickChangedByCorrection": False,
            "onsetAuditConfidence": onset_row["confidence"],
            "onsetResidualMilliseconds": None if onset_row["detrendedLocalResidualSeconds"] is None else onset_row["detrendedLocalResidualSeconds"] * 1000,
            "interpretation": "MIDI lifecycle repair only: the predecessor note-off moved one tick earlier; the physical successor onset did not move.",
        })

    focus_rows = [row for row in rows if 21.0 <= row["performedSeconds"] < 24.0]
    focus_lifecycle = [row for row in corrected_lifecycle_regressions if 21.0 <= row["successorOnsetPerformedSeconds"] < 24.0]
    comp_focus = {
        "performedWindowSeconds": [21.0, 24.0],
        "sourceVideoWindowUsingManifestSeconds": [
            float(source_manifest["tickZeroAtVideoSeconds"]) + 21.0,
            float(source_manifest["tickZeroAtVideoSeconds"]) + 24.0,
        ],
        "strikeCount": len(focus_rows),
        "waveformSupportedTimingCandidates": [row for row in focus_rows if row["waveformSupportedTimingCandidate"]],
        "additionalTimingReviewCandidates": [
            row for row in focus_rows
            if row["timingReviewCandidate"] and not row["waveformSupportedTimingCandidate"]
        ],
        "lowConfidenceGroupIds": [row["groupId"] for row in focus_rows if row["confidence"] == "low"],
        "alreadyCorrectedOneTickLifecycleRegressions": focus_lifecycle,
        "policy": "The one-tick lifecycle repairs change note-off ordering only. They cannot explain or correct an onset residual.",
    }
    audit = {
        "schemaVersion": 1,
        "truthPolicy": {
            "performedTimingAuthority": "source recording waveform",
            "renderObservation": f"{score_revision} fixed-score WAV",
            "metricPolicy": "5/4 and 3+2 are descriptive annotations; never a snap/edit authority",
            "queuePolicy": "waveform candidates require pitch/video/A-B corroboration before a new immutable score revision",
        },
        "inputs": {
            "sourceWave": relative(arguments.source),
            "sourceWaveSha256": sha256(arguments.source),
            "renderWave": relative(arguments.render),
            "renderWaveSha256": sha256(arguments.render),
            "scoreNotes": relative(arguments.notes),
            "scoreNotesSha256": sha256(arguments.notes),
            "evidenceGroups": relative(arguments.evidence),
            "evidenceGroupsSha256": sha256(arguments.evidence),
            "sampleRate": source_rate,
            "analysisDurationSeconds": analysis_duration,
        },
        "performedClock": clock,
        "metricAnnotationDefinition": {
            "ppq": ppq,
            "bpm": bpm,
            "ticksPerSecond": ticks_per_second,
            "meter": source_manifest["meter"],
            "barTicks": ppq * numerator,
            "threePlusTwoPrimaryAnchorsTicks": [0, 3 * ppq],
            "rubatoProxyCaveat": "nearest-eighth offsets include intentional syncopation and rolls; they are descriptive, not errors",
        },
        "detectors": [asdict(config) for config in DETECTORS],
        "summary": summary,
        "waveformSupportedTimingCandidates": waveform_supported,
        "timingReviewCandidates": timing_review,
        "lowConfidenceQueue": low_confidence,
        "missingAttackCandidates": missing_candidates,
        "extraAttackCandidates": possible_extras,
        "compFocus21To24Seconds": comp_focus,
        "currentRemainingSameKeyLifecycleCollisions": current_lifecycle_collisions,
        "correctedOneTickLifecycleRegressions": corrected_lifecycle_regressions,
        "unmatchedRenderConsensusPeaks": unmatched_render,
        "bars": bars,
        "strikes": rows,
    }
    write_outputs(arguments.out, audit, rows, bars, queue)

    candidate_lines = [
        f'| `{row["groupId"]}` | {row["anchorTick"]} | {row["metricAnnotation"]["nominalBarNumber"]} | '
        f'{row["metricAnnotation"]["beatOneBased"]:.3f} | {row["detrendedLocalResidualSeconds"] * 1000:+.1f} | '
        f'{row["suggestedTickDeltaForReviewOnly"]:+d} |'
        for row in waveform_supported
    ] or ["| — | — | — | — | — | 没有达到 waveform-supported 候选门槛 |"]
    focus_lines = [
        f'| `{row["groupId"]}` | {row["performedSeconds"]:.3f} | {row["confidence"]} | '
        f'{row["detrendedLocalResidualSeconds"] * 1000:+.1f} | '
        f'{"waveform-supported" if row["waveformSupportedTimingCandidate"] else "review"} |'
        for row in focus_rows
        if row["timingReviewCandidate"]
    ] or ["| — | — | — | — | 该窗口没有 ≥8ms 的可靠 residual 候选 |"]
    corrected_lifecycle_lines = [
        f'| `{row["predecessorEventId"]}` → `{row["successorEventId"]}` | {row["midi"]} | '
        f'{row["successorOnsetTick"]} | {row["preCorrectionNoteOffTick"]} → {row["correctedNoteOffTick"]} | '
        f'{"—" if row["onsetResidualMilliseconds"] is None else format(row["onsetResidualMilliseconds"], "+.1f")} |'
        for row in corrected_lifecycle_regressions
    ]
    current_collision_lines = [
        f'| `{row["predecessorEventId"]}` → `{row["successorEventId"]}` | {row["role"]} | {row["midi"]} | '
        f'{row["successorOnsetTick"]} | {row["overlapTicks"]} | '
        f'{"—" if row["successorOnsetResidualMilliseconds"] is None else format(row["successorOnsetResidualMilliseconds"], "+.1f")} |'
        for row in current_lifecycle_collisions
    ] or ["| — | — | — | — | — | 当前候选没有 lifecycle collision |"]
    clock_segment_lines = [
        f'| {row["name"]} | {row["startSeconds"]:.1f}–{row["endSeconds"]:.1f} | {row["usableWindowCount"]} | '
        f'{"—" if row["medianLagSeconds"] is None else format(row["medianLagSeconds"] * 1000, "+.2f")} | '
        f'{"—" if row["lagMadSeconds"] is None else format(row["lagMadSeconds"] * 1000, ".2f")} | '
        f'{"—" if row["medianCorrelation"] is None else format(row["medianCorrelation"], ".3f")} |'
        for row in clock["segments"]
    ]
    readme = (
        f"# Take Five VideoReplica `{score_revision}` · 全曲音符攻击/节拍只读审计\n\n"
        f"源视频抽取的 `reference.wav` 是 performed timing 真值；`{score_revision}` WAV 是固定谱实际播放结果。"
        "5/4、3+2 和八分音符网格仅作乐理标注，**没有用于吸附或改写任何音符**。\n\n"
        "## 覆盖与结论\n\n"
        f'- 审计固定谱物理 strike group：`{summary["retainedPhysicalStrikeGroupsAudited"]}` / evidence `{summary["evidenceStrikeGroups"]}`；'
        f'其余 `{summary["fullyRejectedEvidenceGroups"]}` 组在当前候选已完全驳回。\n'
        f'- onset 置信度 high / medium / low：`{summary["highConfidence"]} / {summary["mediumConfidence"]} / {summary["lowConfidence"]}`。\n'
        f'- 可靠 strike 的绝对去趋势残差 P50 / P90：`{(summary["reliableAbsoluteResidualP50Milliseconds"] or 0):.2f} / '
        f'{(summary["reliableAbsoluteResidualP90Milliseconds"] or 0):.2f} ms`。\n'
        f'- waveform-supported timing 候选：`{summary["waveformSupportedTimingCandidates"]}`；次级 timing review：`{summary["additionalTimingReviewCandidates"]}`；'
        f'可能漏攻击：`{summary["possibleMissingSourceAttacks"]}`；可能多余攻击：`{summary["possibleExtraScoreAttacks"]}`。\n\n'
        f'- 当前候选全谱 same-role/same-MIDI lifecycle collision：`{summary["currentSameKeyLifecycleCollisions"]}` 项；'
        "这是 score 结构事实，与 waveform onset residual 分开报告。\n\n"
        "## 全局 clock（描述，不改谱）\n\n"
        f'- manifest tick-zero：`{clock["manifestTickZeroAtVideoSeconds"]:.6f}s`；波形拟合：`{clock["fittedTickZeroAtVideoSeconds"]:.6f}s` '
        f'（`{clock["interceptSeconds"] * 1000:+.2f}ms`）。\n'
        f'- 漂移率：`{clock["driftSecondsPerSecond"] * 1000:+.4f} ms/s`；尾端残差：`{clock["endResidualSeconds"] * 1000:+.2f}ms`；'
        f'等效恒速描述量：`{clock["equivalentBpm"]:.4f} BPM`。这个 fit 不会覆盖 score BPM。\n\n'
        "| segment | performed s | usable windows | median lag ms | lag MAD ms | median corr |\n"
        "|---|---:|---:|---:|---:|---:|\n" + "\n".join(clock_segment_lines) + "\n\n"
        "## Waveform-supported timing 候选（不是已判定错误）\n\n"
        "门槛：四个 detector 全部可用、detector residual range ≤6ms、相邻 strike 隔离 ≥42ms，且去全局 clock 后残差 ≥12ms。"
        "12ms 波形差本身不足以判定音符写错；这里仍只进入逐项视频/A-B 复核，不直接改谱。\n\n"
        "| strike | tick | bar | beat | residual ms | review-only tick delta |\n"
        "|---|---:|---:|---:|---:|---:|\n" + "\n".join(candidate_lines) + "\n\n"
        "## 21–24 秒 COMP 聚焦窗口\n\n"
        f'该 performed 窗口包含 `{len(focus_rows)}` 个 strike；对应 manifest 源视频约 '
        f'`{float(source_manifest["tickZeroAtVideoSeconds"]) + 21.0:.3f}–{float(source_manifest["tickZeroAtVideoSeconds"]) + 24.0:.3f}s`。\n\n'
        "| strike | performed s | confidence | residual ms | queue |\n"
        "|---|---:|---|---:|---|\n" + "\n".join(focus_lines) + "\n\n"
        f'其中落入当前候选已修复 regression 的 successor onset 共 `{len(focus_lifecycle)}` 个：`{", ".join(row["successorEventId"] for row in focus_lifecycle) or "—"}`。'
        "它们只让旧 note-off 从新 note-on 后 1 tick 移到同 tick 的正确事件顺序，新 note-on tick 完全没动。\n\n"
        f'## 当前仍存在的 {len(current_lifecycle_collisions)} 个 lifecycle collision\n\n'
        "这是直接扫描当前 tracks 的 `same role + same MIDI + predecessor end > successor start` 得到的事实；"
        "若存在，它可能在 MIDI 生命周期中压掉 successor，但并不等于 successor 的 onset tick 写错。\n\n"
        "| predecessor → successor | role | MIDI | successor tick | overlap ticks | onset residual ms |\n"
        "|---|---|---:|---:|---:|---:|\n" + "\n".join(current_collision_lines) + "\n\n"
        f'## 当前候选已修复的 {len(corrected_lifecycle_regressions)} 个 one-tick lifecycle regression\n\n'
        f'这 {len(corrected_lifecycle_regressions)} 项来自 corrections metadata，当前已经不再 overlap，也不是 onset 位移。下表逐项给出 successor strike 的波形 residual；'
        "无论 residual 大小，已修复的 note-off regression 都不能当作 timing 校正。\n\n"
        "| predecessor → successor | MIDI | successor tick | note-off before → after | onset residual ms |\n"
        "|---|---:|---:|---:|---:|\n" + "\n".join(corrected_lifecycle_lines) + "\n\n"
        "## 文件\n\n"
        "- `strike-onset-residuals.csv`：每个保留 strike、四 detector 统计、5/4 phase。\n"
        "- `bar-metric-audit.csv`：逐小节 3+2 数量、角色、骨架锚点和 rubato 描述量。\n"
        "- `attack-candidate-queue.csv`：waveform-supported/次级 timing、可能漏/多余攻击审核队列。\n"
        "- `full-timing-audit.json`：全部四 detector 峰值、clock 窗口、低置信队列和输入哈希。\n"
    )
    (arguments.out / "README.md").write_text(readme)
    print(json.dumps({"summary": summary, "clock": {k: v for k, v in clock.items() if k != "windows"}}, indent=2))
    print(f"report: {relative(arguments.out / 'README.md')}")


if __name__ == "__main__":
    main()
