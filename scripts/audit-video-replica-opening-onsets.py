#!/usr/bin/env python3
"""Waveform-only onset/clock audit for the first 15 s VideoReplica opening.

This deliberately does not use a Groove grid as timing truth.  It compares
spectral-flux/energy novelty in the source-video audio and the provisional
render, then uses the immutable strike-group anchors only to name and
monotonically partition the physical attacks being compared.

Outputs (default: tmp/video-replica/take-five-opening-onset-audit):
  opening-onset-audit.json  machine-readable evidence and detector variants
  opening-onset-residuals.csv one row for every opening strike group
  README.md concise audit report and conservative correction candidates
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "tmp/jazz-five-four-analysis/reference.wav"
DEFAULT_RENDER = ROOT / "tmp/video-replica/take-five-full-provisional/take-five-full-provisional.wav"
DEFAULT_NOTES = ROOT / "tmp/video-replica/take-five-opening-provisional/take-five-opening-provisional.notes.json"
DEFAULT_OUTPUT = ROOT / "tmp/video-replica/take-five-opening-onset-audit"


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
    if tag == 0xFFFE and len(fmt) >= 26:  # WAVE_FORMAT_EXTENSIBLE
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


def correlation_at_lag(source: np.ndarray, render: np.ndarray, lag: int) -> float:
    if lag > 0:
        source, render = source[lag:], render[:-lag]
    elif lag < 0:
        source, render = source[:lag], render[-lag:]
    if len(source) < 8:
        return -1.0
    source = (source - float(np.mean(source))) / (float(np.std(source)) + 1e-12)
    render = (render - float(np.mean(render))) / (float(np.std(render)) + 1e-12)
    return float(np.mean(source * render))


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
        coefficients = np.linalg.lstsq(xx * np.sqrt(ww[:, None]), yy * np.sqrt(ww), rcond=None)[0]
        residual = y - x @ coefficients
        median = float(np.median(residual[keep]))
        mad = 1.4826 * float(np.median(np.abs(residual[keep] - median)))
        next_keep = np.abs(residual - median) <= max(0.0045, 2.5 * mad)
        if np.array_equal(next_keep, keep) or int(np.sum(next_keep)) < 4:
            break
        keep = next_keep
    return float(coefficients[0]), float(coefficients[1])


def estimate_clock(source: Novelty, render: Novelty, duration: float) -> dict[str, Any]:
    if len(source.values) != len(render.values) or not np.allclose(source.times, render.times):
        raise ValueError("Global source/render novelty grids differ")
    hop_seconds = float(source.times[1] - source.times[0])
    max_lag_frames = int(round(0.030 / hop_seconds))
    fits: list[dict[str, Any]] = []
    all_windows: list[dict[str, Any]] = []
    for width in (1.5, 2.0, 3.0, 4.0):
        points: list[tuple[float, float, float]] = []
        center = width / 2
        while center <= duration - width / 2 + 1e-9:
            mask = (source.times >= center - width / 2) & (source.times < center + width / 2)
            source_part = source.values[mask]
            render_part = render.values[mask]
            candidates = [
                (lag, correlation_at_lag(source_part, render_part, lag))
                for lag in range(-max_lag_frames, max_lag_frames + 1)
            ]
            best_lag, best_score = max(candidates, key=lambda item: item[1])
            lag_seconds = best_lag * hop_seconds
            row = {
                "windowSeconds": width,
                "centerSeconds": center,
                "lagSeconds": lag_seconds,
                "correlation": best_score,
            }
            all_windows.append(row)
            if best_score >= 0.35:
                points.append((center, lag_seconds, best_score))
            center += width / 2
        intercept, slope = weighted_affine(points)
        fits.append({
            "windowSeconds": width,
            "interceptSeconds": intercept,
            "driftSecondsPerSecond": slope,
            "usableWindows": len(points),
        })
    intercept = float(np.median([item["interceptSeconds"] for item in fits]))
    drift = float(np.median([item["driftSecondsPerSecond"] for item in fits]))
    beta = 1.0 + drift
    return {
        "method": "median of robust local spectral-flux cross-correlation fits",
        "interceptSeconds": intercept,
        "driftSecondsPerSecond": drift,
        "timeScale": beta,
        "endResidualSeconds": intercept + drift * duration,
        "equivalentBpm": 200.0 / beta,
        "fitRange": {
            "interceptSeconds": [min(item["interceptSeconds"] for item in fits), max(item["interceptSeconds"] for item in fits)],
            "driftSecondsPerSecond": [min(item["driftSecondsPerSecond"] for item in fits), max(item["driftSecondsPerSecond"] for item in fits)],
        },
        "fits": fits,
        "windows": all_windows,
    }


def local_maximum(
    curve: Novelty,
    center: float,
    left: float,
    right: float,
    radius: float,
) -> dict[str, float] | None:
    left = max(left, center - radius)
    right = min(right, center + radius)
    indices = np.flatnonzero((curve.times >= left) & (curve.times <= right))
    if len(indices) < 2:
        return None
    values = curve.values
    candidates = [
        int(index)
        for index in indices
        if (index == 0 or values[index] >= values[index - 1])
        and (index + 1 == len(values) or values[index] > values[index + 1])
    ]
    if not candidates:
        candidates = [int(index) for index in indices]
    scores = [math.log1p(3.0 * float(values[index])) - 0.25 * ((float(curve.times[index]) - center) / radius) ** 2 for index in candidates]
    index = candidates[int(np.argmax(scores))]
    before = values[(curve.times >= curve.times[index] - 0.050) & (curve.times <= curve.times[index] - 0.008)]
    baseline = float(np.median(before)) if len(before) else float(np.median(values[indices]))
    return {
        "seconds": float(curve.times[index]),
        "strength": float(values[index] - baseline),
        "distanceFromCenterSeconds": float(curve.times[index] - center),
    }


def median_absolute_deviation(values: Iterable[float]) -> float:
    array = np.asarray(list(values), dtype=np.float64)
    if not len(array):
        return math.nan
    median = float(np.median(array))
    return 1.4826 * float(np.median(np.abs(array - median)))


def percentile(values: list[float], q: float) -> float | None:
    return float(np.percentile(values, q)) if values else None


def analyse_groups(
    groups: list[dict[str, Any]],
    detector_pairs: dict[str, tuple[Novelty, Novelty]],
    clock: dict[str, Any],
    ticks_per_second: float,
    duration: float,
) -> list[dict[str, Any]]:
    anchors = np.asarray([float(group["anchorTick"]) / ticks_per_second for group in groups])
    alpha = float(clock["interceptSeconds"])
    beta = float(clock["timeScale"])
    rows: list[dict[str, Any]] = []
    for index, (group, event_seconds) in enumerate(zip(groups, anchors, strict=True)):
        left = 0.0 if index == 0 else float((anchors[index - 1] + event_seconds) / 2)
        right = duration + 0.060 if index + 1 == len(anchors) else float((event_seconds + anchors[index + 1]) / 2)
        source_center = alpha + beta * event_seconds
        source_left = alpha + beta * left
        source_right = alpha + beta * right
        variants: list[dict[str, Any]] = []
        usable: list[dict[str, Any]] = []
        for name, (source_curve, render_curve) in detector_pairs.items():
            render_peak = local_maximum(render_curve, event_seconds, left, right, 0.020)
            source_peak = local_maximum(source_curve, source_center, source_left, source_right, 0.038)
            variant: dict[str, Any] = {"detector": name, "sourcePeak": source_peak, "renderPeak": render_peak, "usable": False}
            if render_peak is not None and source_peak is not None:
                local_residual = source_peak["seconds"] - (alpha + beta * render_peak["seconds"])
                total_residual = source_peak["seconds"] - render_peak["seconds"]
                variant.update({
                    "localResidualSeconds": local_residual,
                    "sourceMinusRenderSeconds": total_residual,
                })
                variant["usable"] = bool(
                    abs(render_peak["distanceFromCenterSeconds"]) <= 0.013
                    and abs(source_peak["distanceFromCenterSeconds"]) <= 0.032
                    and render_peak["strength"] >= 0.20
                    and source_peak["strength"] >= 0.15
                )
                if variant["usable"]:
                    usable.append(variant)
            variants.append(variant)
        local_values = [float(item["localResidualSeconds"]) for item in usable]
        total_values = [float(item["sourceMinusRenderSeconds"]) for item in usable]
        local_median = float(np.median(local_values)) if local_values else None
        total_median = float(np.median(total_values)) if total_values else None
        consensus_mad = median_absolute_deviation(local_values) if local_values else None
        previous_gap = math.inf if index == 0 else (event_seconds - anchors[index - 1]) * 1000
        next_gap = math.inf if index + 1 == len(anchors) else (anchors[index + 1] - event_seconds) * 1000
        isolation_ms = float(min(previous_gap, next_gap))
        if len(usable) >= 3 and consensus_mad is not None and consensus_mad <= 0.0045 and isolation_ms >= 45.0:
            confidence = "high"
        elif len(usable) >= 2 and consensus_mad is not None and consensus_mad <= 0.008 and isolation_ms >= 28.0:
            confidence = "medium"
        else:
            confidence = "low"
        correction_ticks = None
        recommended_tick = None
        if confidence == "high" and local_median is not None and abs(local_median) >= 0.008:
            correction_ticks = int(round(local_median * ticks_per_second))
            recommended_tick = max(0, int(group["anchorTick"]) + correction_ticks)
        rows.append({
            "groupId": group["id"],
            "anchorTick": int(group["anchorTick"]),
            "eventSeconds": float(event_seconds),
            "spreadTicks": int(group["spreadTicks"]),
            "evidenceIds": group["evidenceIds"],
            "isolationMilliseconds": isolation_ms,
            "usableDetectors": len(usable),
            "confidence": confidence,
            "sourceMinusRenderSeconds": total_median,
            "detrendedLocalResidualSeconds": local_median,
            "detectorConsensusMadSeconds": consensus_mad,
            "correctionTicksAfterGlobalClock": correction_ticks,
            "recommendedAnchorTickAfterGlobalClock": recommended_tick,
            "variants": variants,
        })
    return rows


def relative(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path.resolve())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--render", type=Path, default=DEFAULT_RENDER)
    parser.add_argument("--notes", type=Path, default=DEFAULT_NOTES)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    arguments = parser.parse_args()

    manifest = json.loads(arguments.notes.read_text())
    source_manifest = manifest["source"]
    groups = manifest["evidence"]["strikeGroups"]
    if len(groups) != 89:
        raise ValueError(f"Expected the immutable 89-group opening; found {len(groups)}")
    ppq = float(source_manifest["ppq"])
    bpm = float(source_manifest["bpm"])
    ticks_per_second = ppq * bpm / 60.0
    duration = 15.0
    source_offset = float(source_manifest["tickZeroAtVideoSeconds"])

    source_audio, source_rate = read_wave(arguments.source)
    render_audio, render_rate = read_wave(arguments.render)
    if source_rate != render_rate:
        raise ValueError(f"Sample-rate mismatch: {source_rate} vs {render_rate}")
    source_start = int(round(source_offset * source_rate))
    analysis_samples = int(round((duration + 0.080) * source_rate))
    source_audio = source_audio[source_start:source_start + analysis_samples]
    render_audio = render_audio[:analysis_samples]
    sample_count = min(len(source_audio), len(render_audio))
    source_audio = source_audio[:sample_count]
    render_audio = render_audio[:sample_count]

    source_global = novelty(source_audio, source_rate, GLOBAL_DETECTOR)
    render_global = novelty(render_audio, render_rate, GLOBAL_DETECTOR)
    common = min(len(source_global.values), len(render_global.values))
    source_global = Novelty(source_global.times[:common], source_global.values[:common], source_global.p50, source_global.p95)
    render_global = Novelty(render_global.times[:common], render_global.values[:common], render_global.p50, render_global.p95)
    clock = estimate_clock(source_global, render_global, duration)
    clock["currentTickZeroAtVideoSeconds"] = source_offset
    clock["recommendedTickZeroAtVideoSeconds"] = source_offset + float(clock["interceptSeconds"])
    clock["currentBpm"] = bpm
    clock["recommendedBpmIfUsingConstantTempo"] = bpm / float(clock["timeScale"])

    detector_pairs: dict[str, tuple[Novelty, Novelty]] = {}
    for config in DETECTORS:
        detector_pairs[config.name] = (
            novelty(source_audio, source_rate, config),
            novelty(render_audio, render_rate, config),
        )
    rows = analyse_groups(groups, detector_pairs, clock, ticks_per_second, duration)
    corrections = [row for row in rows if row["recommendedAnchorTickAfterGlobalClock"] is not None]
    reliable = [row for row in rows if row["confidence"] in {"high", "medium"}]
    reliable_residuals = [abs(float(row["detrendedLocalResidualSeconds"])) for row in reliable if row["detrendedLocalResidualSeconds"] is not None]
    summary = {
        "strikeGroups": len(rows),
        "highConfidenceGroups": sum(row["confidence"] == "high" for row in rows),
        "mediumConfidenceGroups": sum(row["confidence"] == "medium" for row in rows),
        "lowConfidenceGroups": sum(row["confidence"] == "low" for row in rows),
        "suggestedLocalCorrections": len(corrections),
        "reliableAbsoluteLocalResidualP50Seconds": percentile(reliable_residuals, 50),
        "reliableAbsoluteLocalResidualP90Seconds": percentile(reliable_residuals, 90),
        "policy": "Only high-confidence, >=8 ms detrended residuals receive a tick suggestion; nothing is edited automatically.",
    }
    audit = {
        "schemaVersion": 1,
        "truthPolicy": "source/render waveforms; no Groove grid used as timing truth",
        "inputs": {
            "sourceWave": relative(arguments.source),
            "renderWave": relative(arguments.render),
            "strikeGroupManifest": relative(arguments.notes),
            "sourceSliceStartSeconds": source_offset,
            "sourceSliceDurationSeconds": duration,
            "sampleRate": source_rate,
            "ticksPerSecondAtCurrentClock": ticks_per_second,
        },
        "detectors": [config.__dict__ for config in DETECTORS],
        "clock": clock,
        "summary": summary,
        "groups": rows,
    }

    arguments.out.mkdir(parents=True, exist_ok=True)
    json_path = arguments.out / "opening-onset-audit.json"
    csv_path = arguments.out / "opening-onset-residuals.csv"
    readme_path = arguments.out / "README.md"
    json_path.write_text(json.dumps(audit, indent=2) + "\n")
    with csv_path.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow([
            "groupId", "anchorTick", "eventSeconds", "spreadTicks", "isolationMs", "usableDetectors", "confidence",
            "sourceMinusRenderMs", "detrendedLocalResidualMs", "consensusMadMs", "correctionTicksAfterGlobalClock",
            "recommendedAnchorTickAfterGlobalClock", "evidenceIds",
        ])
        for row in rows:
            writer.writerow([
                row["groupId"], row["anchorTick"], f'{row["eventSeconds"]:.6f}', row["spreadTicks"],
                f'{row["isolationMilliseconds"]:.3f}', row["usableDetectors"], row["confidence"],
                "" if row["sourceMinusRenderSeconds"] is None else f'{row["sourceMinusRenderSeconds"] * 1000:.3f}',
                "" if row["detrendedLocalResidualSeconds"] is None else f'{row["detrendedLocalResidualSeconds"] * 1000:.3f}',
                "" if row["detectorConsensusMadSeconds"] is None else f'{row["detectorConsensusMadSeconds"] * 1000:.3f}',
                "" if row["correctionTicksAfterGlobalClock"] is None else row["correctionTicksAfterGlobalClock"],
                "" if row["recommendedAnchorTickAfterGlobalClock"] is None else row["recommendedAnchorTickAfterGlobalClock"],
                ";".join(row["evidenceIds"]),
            ])
    correction_lines = [
        f'| {row["groupId"]} | {row["anchorTick"]} | {row["detrendedLocalResidualSeconds"] * 1000:+.1f} | '
        f'{row["correctionTicksAfterGlobalClock"]:+d} | {row["recommendedAnchorTickAfterGlobalClock"]} |'
        for row in corrections
    ]
    if not correction_lines:
        correction_lines = ["| — | — | — | — | 没有达到保守门槛的局部改动 |"]
    readme_path.write_text(
        "# Take Five VideoReplica · 前 15 秒 onset/clock 独立审计\n\n"
        "真值是源视频音频波形和 provisional 渲染波形；Groove grid 没有参与拟合或判定。"
        "89 个 strike-group anchor 只用于给物理击键编号和划分单调匹配窗口。\n\n"
        "## 全局时钟\n\n"
        f'- 当前源切片锚点：`{source_offset:.6f}s`；波形拟合建议：`{clock["recommendedTickZeroAtVideoSeconds"]:.6f}s` '
        f'（差 `{clock["interceptSeconds"] * 1000:+.2f}ms`）。\n'
        f'- 15 秒漂移：从 `{clock["interceptSeconds"] * 1000:+.2f}ms` 到 `{clock["endResidualSeconds"] * 1000:+.2f}ms`；'
        f'等效恒定速度 `{clock["recommendedBpmIfUsingConstantTempo"]:.3f} BPM`。\n'
        f'- 多窗口估计范围：起点 `{clock["fitRange"]["interceptSeconds"][0] * 1000:+.2f}`～'
        f'`{clock["fitRange"]["interceptSeconds"][1] * 1000:+.2f}ms`；等效速度的细小差异不构成“错拍”量级。\n\n'
        "## 逐组结果\n\n"
        f'- high / medium / low：`{summary["highConfidenceGroups"]} / {summary["mediumConfidenceGroups"]} / {summary["lowConfidenceGroups"]}`。\n'
        f'- 可靠组去趋势后的绝对局部残差：P50 ` {(summary["reliableAbsoluteLocalResidualP50Seconds"] or 0) * 1000:.2f}ms`，'
        f'P90 `{(summary["reliableAbsoluteLocalResidualP90Seconds"] or 0) * 1000:.2f}ms`。\n'
        "- 每组 residual、置信度和 detector MAD 在 `opening-onset-residuals.csv`；每个 detector 的原始匹配在 JSON。\n\n"
        "## 保守的局部 tick 候选（先应用全局时钟后）\n\n"
        "只有 high-confidence、四种 detector 至少三种可用、detector MAD ≤4.5ms、且去趋势残差 ≥8ms 的组进入此表。"
        "这些是审核候选，不会自动改证据。\n\n"
        "| group | 原 anchor tick | local residual ms | tick delta | 候选 anchor tick |\n"
        "|---|---:|---:|---:|---:|\n"
        + "\n".join(correction_lines)
        + "\n",
    )
    print(json.dumps({"clock": clock, "summary": summary, "corrections": corrections}, indent=2))
    print(f"JSON: {relative(json_path)}")
    print(f"CSV: {relative(csv_path)}")
    print(f"report: {relative(readme_path)}")


if __name__ == "__main__":
    main()
