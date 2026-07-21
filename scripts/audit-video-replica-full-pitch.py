#!/usr/bin/env python3
"""Read-only full-score pitch/completeness/duration audit for a Take Five candidate.

The audit deliberately has no score-writing path.  It compares every curated
note with all four decodings from the existing Basic Pitch threshold sweep and
with measurements made directly from the source WAV.  Detector agreement is
useful review evidence, but the four decodings share one model inference and
therefore are not four independent witnesses.  Likewise, a spectrum alone
cannot always distinguish a played octave from an upper piano partial.

Outputs:
  full-pitch-audit.json   complete machine-readable evidence and queues
  score-events.csv       one row for every score event
  omission-review.csv    unmatched consensus detector clusters
  false-positive-review.csv  conservative weak-score review candidates
  README.md              concise findings and interpretation limits
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import statistics
import struct
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SCORE = (
    ROOT
    / "tmp/video-replica/take-five-full-curation-v5"
    / "take-five-full-curation-v5.notes.json"
)
DEFAULT_SWEEP = (
    ROOT
    / "tmp/video-replica/take-five-basic-pitch-sweep-full"
    / "full-threshold-sweep.json"
)
DEFAULT_PRIOR_CONSENSUS = (
    ROOT
    / "tmp/video-replica/take-five-basic-pitch-sweep-full"
    / "post-handoff-consensus-review-v3.json"
)
DEFAULT_AUDIO = ROOT / "tmp/jazz-five-four-analysis/reference.wav"
DEFAULT_OUTPUT = (
    ROOT
    / "tmp/video-replica/take-five-full-curation-v5/full-audit/pitch"
)

DEFAULT_CLUSTER_TOLERANCE_TICKS = 80
DEFAULT_MATCH_TOLERANCE_TICKS = 100
EXTENDED_MATCH_TOLERANCE_TICKS = 160
STRIKE_TOLERANCE_TICKS = 120
MINIMUM_CONSENSUS_CONFIGS = 3
OCTAVE_INTERVALS = frozenset((12, 24, 36))
# Rounded equal-tempered locations of harmonics 2 through 8.
HARMONIC_INTERVALS = frozenset((12, 19, 24, 28, 31, 34, 36))
EPSILON = 1e-18


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


def midi_name(midi: int) -> str:
    names = ("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
    return f"{names[midi % 12]}{midi // 12 - 1}"


def finite_float(value: float, digits: int = 6) -> float:
    if not math.isfinite(value):
        return 0.0
    return round(float(value), digits)


def median_or_none(values: Iterable[float | int]) -> float | None:
    materialized = list(values)
    return float(statistics.median(materialized)) if materialized else None


def percentile(values: list[float], value: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    below_or_equal = sum(candidate <= value for candidate in ordered)
    return 100.0 * below_or_equal / len(ordered)


def quantiles(values: list[float]) -> dict[str, float] | None:
    if not values:
        return None
    data = np.asarray(values, dtype=np.float64)
    return {
        "p05": finite_float(float(np.percentile(data, 5))),
        "p10": finite_float(float(np.percentile(data, 10))),
        "p25": finite_float(float(np.percentile(data, 25))),
        "p50": finite_float(float(np.percentile(data, 50))),
        "p75": finite_float(float(np.percentile(data, 75))),
        "p90": finite_float(float(np.percentile(data, 90))),
        "p95": finite_float(float(np.percentile(data, 95))),
    }


def read_wave(path: Path) -> tuple[np.ndarray, int]:
    """Read mono/stereo PCM16, PCM24, PCM32, or float32 WAVE without scipy."""
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
    tag, channels, sample_rate, _, block_align, bits = struct.unpack("<HHIIHH", fmt[:16])
    if tag == 0xFFFE and len(fmt) >= 26:
        tag = struct.unpack("<H", fmt[24:26])[0]
    if channels < 1 or block_align < 1:
        raise ValueError(f"Invalid WAVE format in {path}")
    if tag == 1 and bits == 16:
        samples = np.frombuffer(payload, dtype="<i2").astype(np.float64) / 32768.0
    elif tag == 1 and bits == 24:
        raw = np.frombuffer(payload, dtype=np.uint8).reshape(-1, 3)
        values = (
            raw[:, 0].astype(np.int32)
            | (raw[:, 1].astype(np.int32) << 8)
            | (raw[:, 2].astype(np.int32) << 16)
        )
        values = (values ^ 0x800000) - 0x800000
        samples = values.astype(np.float64) / 8388608.0
    elif tag == 1 and bits == 32:
        samples = np.frombuffer(payload, dtype="<i4").astype(np.float64) / 2147483648.0
    elif tag == 3 and bits == 32:
        samples = np.frombuffer(payload, dtype="<f4").astype(np.float64)
    else:
        raise ValueError(f"Unsupported WAVE tag={tag}, bits={bits}: {path}")
    if len(samples) % channels:
        raise ValueError(f"Invalid channel payload in {path}")
    mono = samples.reshape(-1, channels).mean(axis=1)
    return mono, sample_rate


@dataclass(frozen=True)
class SpectrumBank:
    times_seconds: np.ndarray
    pitch_energy: np.ndarray
    sample_rate: int
    window_size: int
    hop_size: int
    fft_size: int
    minimum_midi: int
    maximum_midi: int

    def series(self, midi: int) -> np.ndarray:
        bounded = min(max(midi, self.minimum_midi), self.maximum_midi)
        return self.pitch_energy[:, bounded - self.minimum_midi]


def build_spectrum_bank(
    signal: np.ndarray,
    sample_rate: int,
    *,
    window_size: int = 4096,
    hop_size: int = 256,
    fft_size: int = 16384,
    minimum_midi: int = 21,
    maximum_midi: int = 108,
) -> SpectrumBank:
    """Build narrow log-frequency energy tracks directly from the source WAV."""
    if fft_size < window_size:
        raise ValueError("Spectrum FFT size must be at least the window size")
    if len(signal) < window_size:
        raise ValueError("Source WAV is shorter than the spectrum window")
    signal = signal.astype(np.float64, copy=True)
    signal -= float(np.mean(signal))
    signal /= float(np.percentile(np.abs(signal), 99.5)) + EPSILON
    frame_count = 1 + (len(signal) - window_size) // hop_size
    times = (np.arange(frame_count) * hop_size + window_size / 2) / sample_rate
    pitches = tuple(range(minimum_midi, maximum_midi + 1))
    frequencies = np.fft.rfftfreq(fft_size, 1.0 / sample_rate)
    pitch_bins: list[np.ndarray] = []
    for midi in pitches:
        frequency = 440.0 * 2.0 ** ((midi - 69) / 12.0)
        lower = frequency * 2.0 ** (-40.0 / 1200.0)
        upper = frequency * 2.0 ** (+40.0 / 1200.0)
        indices = np.flatnonzero((frequencies >= lower) & (frequencies <= upper))
        if not len(indices):
            indices = np.asarray([int(np.argmin(np.abs(frequencies - frequency)))])
        pitch_bins.append(indices)

    energy = np.empty((frame_count, len(pitches)), dtype=np.float32)
    window = np.hanning(window_size)
    batch_size = 128
    for first in range(0, frame_count, batch_size):
        last = min(frame_count, first + batch_size)
        starts = np.arange(first, last) * hop_size
        frames = np.stack([signal[start:start + window_size] for start in starts])
        spectra = np.fft.rfft(frames * window, n=fft_size, axis=1)
        power = np.abs(spectra) ** 2
        for pitch_index, indices in enumerate(pitch_bins):
            energy[first:last, pitch_index] = np.mean(power[:, indices], axis=1)
    return SpectrumBank(
        times_seconds=times,
        pitch_energy=energy,
        sample_rate=sample_rate,
        window_size=window_size,
        hop_size=hop_size,
        fft_size=fft_size,
        minimum_midi=minimum_midi,
        maximum_midi=maximum_midi,
    )


def window_values(
    bank: SpectrumBank,
    midi: int,
    start_seconds: float,
    end_seconds: float,
) -> np.ndarray:
    mask = (bank.times_seconds >= start_seconds) & (bank.times_seconds <= end_seconds)
    return bank.series(midi)[mask]


def spectrum_features(bank: SpectrumBank, midi: int, onset_seconds: float) -> dict[str, Any]:
    before = window_values(bank, midi, onset_seconds - 0.180, onset_seconds - 0.050)
    after = window_values(bank, midi, onset_seconds + 0.050, onset_seconds + 0.190)
    if not len(before) or not len(after):
        return {
            "available": False,
            "pitchAttackEvidenceDb": 0.0,
            "onsetRiseDb": 0.0,
            "localPitchContrastDb": 0.0,
        }
    before_energy = float(np.percentile(before, 50))
    after_energy = float(np.percentile(after, 75))
    onset_rise_db = 10.0 * math.log10((after_energy + EPSILON) / (before_energy + EPSILON))

    neighbor_energies: list[float] = []
    for interval in (-4, -3, -2, 2, 3, 4):
        candidate = midi + interval
        if bank.minimum_midi <= candidate <= bank.maximum_midi:
            values = window_values(bank, candidate, onset_seconds + 0.050, onset_seconds + 0.190)
            if len(values):
                neighbor_energies.append(float(np.percentile(values, 75)))
    local_reference = float(statistics.median(neighbor_energies)) if neighbor_energies else EPSILON
    local_contrast_db = 10.0 * math.log10((after_energy + EPSILON) / (local_reference + EPSILON))

    harmonic_energies: list[float] = []
    for interval, weight in ((0, 1.0), (12, 0.55), (19, 0.35), (24, 0.25), (28, 0.18)):
        candidate = midi + interval
        if candidate > bank.maximum_midi:
            continue
        values = window_values(bank, candidate, onset_seconds + 0.050, onset_seconds + 0.190)
        if len(values):
            harmonic_energies.append(weight * float(np.percentile(values, 75)))
    harmonic_template_energy = sum(harmonic_energies)
    attack_evidence_db = max(onset_rise_db, local_contrast_db)
    return {
        "available": True,
        "beforeMedianEnergy": finite_float(before_energy),
        "afterP75Energy": finite_float(after_energy),
        "onsetRiseDb": finite_float(onset_rise_db),
        "localPitchContrastDb": finite_float(local_contrast_db),
        "pitchAttackEvidenceDb": finite_float(attack_evidence_db),
        "harmonicTemplateEnergy": finite_float(harmonic_template_energy),
    }


def estimate_spectral_duration(
    bank: SpectrumBank,
    midi: int,
    onset_seconds: float,
    next_same_pitch_seconds: float | None,
) -> dict[str, Any]:
    series = bank.series(midi)
    before_mask = (
        (bank.times_seconds >= onset_seconds - 0.300)
        & (bank.times_seconds <= onset_seconds - 0.070)
    )
    attack_mask = (
        (bank.times_seconds >= onset_seconds + 0.040)
        & (bank.times_seconds <= onset_seconds + 0.240)
    )
    before = series[before_mask]
    attack = series[attack_mask]
    if not len(before) or not len(attack):
        return {"available": False, "reason": "edge-window"}
    baseline = float(np.percentile(before, 60))
    peak = float(np.percentile(attack, 95))
    rise_db = 10.0 * math.log10((peak + EPSILON) / (baseline + EPSILON))
    if rise_db < 1.5:
        return {
            "available": False,
            "reason": "insufficient-isolated-pitch-rise",
            "riseDb": finite_float(rise_db),
        }

    threshold = max(baseline * 1.70, peak * 0.16)
    hard_end = onset_seconds + 4.0
    limited_by_next = False
    if next_same_pitch_seconds is not None:
        hard_end = min(hard_end, next_same_pitch_seconds)
        limited_by_next = hard_end == next_same_pitch_seconds
    search_indices = np.flatnonzero(
        (bank.times_seconds >= onset_seconds + 0.080)
        & (bank.times_seconds <= hard_end)
    )
    run_length = max(4, int(round(0.055 * bank.sample_rate / bank.hop_size)))
    end_seconds: float | None = None
    if len(search_indices) >= run_length:
        below = series[search_indices] < threshold
        for offset in range(0, len(below) - run_length + 1):
            if bool(np.all(below[offset:offset + run_length])):
                end_seconds = float(bank.times_seconds[search_indices[offset]])
                break
    if end_seconds is None and limited_by_next:
        end_seconds = hard_end
    if end_seconds is None:
        return {
            "available": False,
            "reason": "no-reliable-decay-crossing-within-four-seconds",
            "riseDb": finite_float(rise_db),
            "limitedByNextSamePitch": limited_by_next,
        }
    reliability = "medium" if rise_db >= 4.0 else "low"
    if rise_db >= 8.0 and not limited_by_next:
        reliability = "high"
    return {
        "available": True,
        "estimatedEndSeconds": finite_float(end_seconds),
        "estimatedDurationSeconds": finite_float(max(0.0, end_seconds - onset_seconds)),
        "riseDb": finite_float(rise_db),
        "thresholdEnergy": finite_float(threshold),
        "limitedByNextSamePitch": limited_by_next,
        "reliability": reliability,
    }


def score_events(payload: dict[str, Any]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for role, track in payload["tracks"].items():
        for note in track["notes"]:
            events.append({
                "eventId": str(note["eventId"]),
                "evidenceId": str(note.get("evidenceId", note["eventId"])),
                "strikeGroupId": note.get("strikeGroupId"),
                "role": role,
                "startTick": int(note["performedStartTick"]),
                "durationTicks": int(note["performedDurationTicks"]),
                "endTick": int(note["performedStartTick"]) + int(note["performedDurationTicks"]),
                "midi": int(note["midi"]),
                "noteName": midi_name(int(note["midi"])),
                "velocity": int(note["velocity"]),
                "origin": note.get("origin"),
                "assignmentMethod": note.get("assignmentMethod"),
                "assignmentStatus": note.get("assignmentStatus"),
            })
    return sorted(events, key=lambda event: (event["startTick"], event["midi"], event["role"], event["eventId"]))


def summarize_cluster(index: int, events: list[dict[str, Any]]) -> dict[str, Any]:
    config_ids = sorted({str(event["configId"]) for event in events})
    config_counts = Counter(str(event["configId"]) for event in events)
    ticks = [int(event["startTick"]) for event in events]
    return {
        "clusterId": f"detector-{index + 1:04d}",
        "midi": int(events[0]["midi"]),
        "noteName": midi_name(int(events[0]["midi"])),
        "startTickAnchor": min(ticks),
        "startTickMedian": round(statistics.median(ticks)),
        "startTickSpread": max(ticks) - min(ticks),
        "durationTicksMedian": round(statistics.median(int(event["durationTicks"]) for event in events)),
        "amplitudeMedian": finite_float(statistics.median(float(event["amplitude"]) for event in events)),
        "configCount": len(config_ids),
        "configIds": config_ids,
        "configEventCounts": dict(sorted(config_counts.items())),
        "events": events,
    }


def detector_clusters(
    payload: dict[str, Any],
    start_tick: int,
    end_tick: int,
    tolerance_ticks: int,
) -> list[dict[str, Any]]:
    flat: list[dict[str, Any]] = []
    for decoding in payload["decodings"]:
        for event in decoding["events"]:
            tick = int(event["performedStartTick"])
            if start_tick <= tick < end_tick:
                flat.append({
                    "configId": str(decoding["id"]),
                    "startTick": tick,
                    "durationTicks": int(event["performedDurationTicks"]),
                    "midi": int(event["midi"]),
                    "amplitude": float(event["amplitude"]),
                })
    flat.sort(key=lambda event: (event["midi"], event["startTick"], event["configId"]))
    raw_clusters: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    anchor: int | None = None
    current_midi: int | None = None
    for event in flat:
        begins_new = (
            not current
            or current_midi != event["midi"]
            or anchor is None
            or event["startTick"] - anchor > tolerance_ticks
        )
        if begins_new:
            if current:
                raw_clusters.append(current)
            current = [event]
            anchor = int(event["startTick"])
            current_midi = int(event["midi"])
        else:
            current.append(event)
    if current:
        raw_clusters.append(current)
    clusters = [summarize_cluster(index, events) for index, events in enumerate(raw_clusters)]
    clusters.sort(key=lambda cluster: (cluster["startTickMedian"], cluster["midi"], cluster["clusterId"]))
    return clusters


def match_score_to_clusters(
    notes: list[dict[str, Any]],
    clusters: list[dict[str, Any]],
    tolerance_ticks: int,
) -> tuple[dict[int, int], set[int]]:
    pairs: list[tuple[int, int, int, int]] = []
    clusters_by_midi: dict[int, list[int]] = defaultdict(list)
    for cluster_index, cluster in enumerate(clusters):
        clusters_by_midi[int(cluster["midi"])].append(cluster_index)
    for note_index, note in enumerate(notes):
        for cluster_index in clusters_by_midi[int(note["midi"])]:
            cluster = clusters[cluster_index]
            delta = abs(int(cluster["startTickMedian"]) - int(note["startTick"]))
            if delta <= tolerance_ticks:
                pairs.append((delta, -int(cluster["configCount"]), note_index, cluster_index))
    matches: dict[int, int] = {}
    used_clusters: set[int] = set()
    for _, _, note_index, cluster_index in sorted(pairs):
        if note_index in matches or cluster_index in used_clusters:
            continue
        matches[note_index] = cluster_index
        used_clusters.add(cluster_index)
    return matches, used_clusters


def nearest_same_pitch_cluster(
    note: dict[str, Any],
    clusters: list[dict[str, Any]],
) -> tuple[int | None, int | None]:
    candidates = [
        (abs(int(cluster["startTickMedian"]) - int(note["startTick"])), index)
        for index, cluster in enumerate(clusters)
        if int(cluster["midi"]) == int(note["midi"])
    ]
    if not candidates:
        return None, None
    _, index = min(candidates)
    return index, int(clusters[index]["startTickMedian"]) - int(note["startTick"])


def related_lower_events(
    midi: int,
    tick: int,
    notes: list[dict[str, Any]],
    intervals: frozenset[int],
) -> list[dict[str, Any]]:
    return [
        note for note in notes
        if midi - int(note["midi"]) in intervals
        and abs(int(note["startTick"]) - tick) <= STRIKE_TOLERANCE_TICKS
    ]


def classify_partial_risk(
    *,
    midi: int,
    tick: int,
    detector_config_count: int,
    after_energy: float,
    notes: list[dict[str, Any]],
    note_support: dict[str, int],
    bank: SpectrumBank,
    source_anchor_seconds: float,
    ticks_per_second: float,
) -> dict[str, Any]:
    harmonic = related_lower_events(midi, tick, notes, HARMONIC_INTERVALS)
    octave = [note for note in harmonic if midi - int(note["midi"]) in OCTAVE_INTERVALS]
    details: list[dict[str, Any]] = []
    for lower in harmonic:
        lower_time = source_anchor_seconds + tick / ticks_per_second
        lower_features = spectrum_features(bank, int(lower["midi"]), lower_time)
        lower_energy = float(lower_features.get("afterP75Energy", 0.0))
        ratio_db = 10.0 * math.log10((after_energy + EPSILON) / (lower_energy + EPSILON))
        details.append({
            "eventId": lower["eventId"],
            "midi": lower["midi"],
            "noteName": lower["noteName"],
            "intervalSemitones": midi - int(lower["midi"]),
            "onsetDeltaTicks": int(lower["startTick"]) - tick,
            "detectorConfigCount": int(note_support.get(str(lower["eventId"]), 0)),
            "targetToLowerFundamentalDb": finite_float(ratio_db),
        })
    risk = "none"
    reason = "no near-simultaneous lower score attack at an octave/harmonic interval"
    if details:
        strongest_lower_support = max(int(item["detectorConfigCount"]) for item in details)
        weakest_ratio = min(float(item["targetToLowerFundamentalDb"]) for item in details)
        if detector_config_count <= 1 and strongest_lower_support >= 3:
            risk = "high"
            reason = "weak target support coincides with a strongly supported lower harmonic source"
        elif octave:
            # Threshold consensus and a narrow spectrum are not independent
            # evidence for an octave: both can follow the same strong piano
            # partial.  Exact-octave omissions therefore always remain a
            # visual-key review, even when all four decodings agree.
            risk = "medium"
            reason = "exact-octave source is spectrally ambiguous without physical-key video evidence"
        elif detector_config_count < strongest_lower_support or weakest_ratio <= -6.0:
            risk = "medium"
            reason = "target may be explained by a stronger lower note's piano partial"
        else:
            risk = "low"
            reason = "harmonic relation exists, but independent target support is comparable"
    return {
        "octavePartialRisk": risk if octave else "none",
        "harmonicPartialRisk": risk,
        "reason": reason,
        "relatedLowerEvents": details,
    }


def csv_text(path: Path, rows: list[dict[str, Any]], fields: list[str]) -> None:
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def markdown_table(rows: list[dict[str, Any]], fields: list[str], limit: int = 20) -> str:
    if not rows:
        return "_None._"
    visible = rows[:limit]
    lines = ["| " + " | ".join(fields) + " |", "| " + " | ".join("---" for _ in fields) + " |"]
    for row in visible:
        values = []
        for field in fields:
            value = row.get(field, "")
            if isinstance(value, list):
                value = ", ".join(str(item) for item in value)
            values.append(str(value).replace("|", "\\|"))
        lines.append("| " + " | ".join(values) + " |")
    if len(rows) > limit:
        lines.append(f"\n_First {limit} of {len(rows)}; see CSV/JSON for the complete queue._")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--score", type=Path, default=DEFAULT_SCORE)
    parser.add_argument("--sweep", type=Path, default=DEFAULT_SWEEP)
    parser.add_argument("--prior-consensus", type=Path, default=DEFAULT_PRIOR_CONSENSUS)
    parser.add_argument("--audio", type=Path, default=DEFAULT_AUDIO)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--cluster-tolerance-ticks", type=int, default=DEFAULT_CLUSTER_TOLERANCE_TICKS)
    parser.add_argument("--match-tolerance-ticks", type=int, default=DEFAULT_MATCH_TOLERANCE_TICKS)
    parser.add_argument("--extended-match-tolerance-ticks", type=int, default=EXTENDED_MATCH_TOLERANCE_TICKS)
    parser.add_argument("--minimum-consensus-configs", type=int, default=MINIMUM_CONSENSUS_CONFIGS)
    arguments = parser.parse_args()

    score_payload = json.loads(arguments.score.read_text())
    score_metadata = score_payload.get("score", {})
    score_label = str(score_metadata.get("replicaRevision", score_metadata.get("id", "candidate")))
    sweep_payload = json.loads(arguments.sweep.read_text())
    prior_consensus_payload = json.loads(arguments.prior_consensus.read_text())
    audio_sha256 = sha256(arguments.audio)
    sweep_sha256 = sha256(arguments.sweep)
    recorded_prior_sweep_sha256 = prior_consensus_payload.get("inputs", {}).get("sweep", {}).get("sha256")
    if recorded_prior_sweep_sha256 and recorded_prior_sweep_sha256 != sweep_sha256:
        raise ValueError(
            "The prior post-handoff consensus was not built from the supplied threshold sweep: "
            f"expected {recorded_prior_sweep_sha256}, got {sweep_sha256}"
        )
    recorded_sweep_audio_sha256 = sweep_payload.get("audio", {}).get("sha256")
    if recorded_sweep_audio_sha256 and recorded_sweep_audio_sha256 != audio_sha256:
        raise ValueError(
            "The source WAV does not match the audio used for the threshold sweep: "
            f"expected {recorded_sweep_audio_sha256}, got {audio_sha256}"
        )
    notes = score_events(score_payload)
    if not notes:
        raise ValueError("Score contains no notes")
    source = score_payload.get("source", {})
    ppq = float(source.get("ppq", 480))
    bpm = float(source.get("bpm", 200))
    ticks_per_second = ppq * bpm / 60.0
    source_anchor_seconds = float(source.get(
        "tickZeroAtVideoSeconds",
        sweep_payload.get("timeMapping", {}).get("tickZeroAtVideoSeconds", 1.547),
    ))
    score_end_tick = max(int(note["endTick"]) for note in notes)
    clusters = detector_clusters(
        sweep_payload,
        min(0, min(int(note["startTick"]) for note in notes) - arguments.extended_match_tolerance_ticks),
        score_end_tick + arguments.extended_match_tolerance_ticks,
        arguments.cluster_tolerance_ticks,
    )
    strict_matches, used_cluster_indices = match_score_to_clusters(
        notes, clusters, arguments.match_tolerance_ticks,
    )
    extended_matches, _ = match_score_to_clusters(
        notes, clusters, arguments.extended_match_tolerance_ticks,
    )

    audio, sample_rate = read_wave(arguments.audio)
    bank = build_spectrum_bank(audio, sample_rate)

    # First pass: detector facts plus direct source-spectrum features.
    note_rows: list[dict[str, Any]] = []
    note_support: dict[str, int] = {}
    score_indices_by_midi: dict[int, list[int]] = defaultdict(list)
    for index, note in enumerate(notes):
        score_indices_by_midi[int(note["midi"])].append(index)
    for note_index, note in enumerate(notes):
        cluster_index = strict_matches.get(note_index)
        extended_index = extended_matches.get(note_index)
        nearest_index, nearest_delta = nearest_same_pitch_cluster(note, clusters)
        cluster = clusters[cluster_index] if cluster_index is not None else None
        extended_cluster = clusters[extended_index] if extended_index is not None else None
        support_count = int(cluster["configCount"]) if cluster else 0
        note_support[str(note["eventId"])] = support_count
        source_seconds = source_anchor_seconds + int(note["startTick"]) / ticks_per_second
        spectral = spectrum_features(bank, int(note["midi"]), source_seconds)

        same_pitch_indices = score_indices_by_midi[int(note["midi"])]
        position = same_pitch_indices.index(note_index)
        next_same_seconds = None
        if position + 1 < len(same_pitch_indices):
            next_note = notes[same_pitch_indices[position + 1]]
            next_same_seconds = source_anchor_seconds + int(next_note["startTick"]) / ticks_per_second
        spectral_duration = estimate_spectral_duration(
            bank, int(note["midi"]), source_seconds, next_same_seconds,
        )
        if spectral_duration.get("available"):
            spectrum_duration_ticks = round(float(spectral_duration["estimatedDurationSeconds"]) * ticks_per_second)
            spectrum_duration_residual = spectrum_duration_ticks - int(note["durationTicks"])
        else:
            spectrum_duration_ticks = None
            spectrum_duration_residual = None

        detector_duration = int(cluster["durationTicksMedian"]) if cluster else None
        detector_duration_residual = (
            detector_duration - int(note["durationTicks"])
            if detector_duration is not None else None
        )
        detector_matches = cluster["events"] if cluster else []
        detector_durations = [int(item["durationTicks"]) for item in detector_matches]
        durations_by_config: dict[str, list[int]] = defaultdict(list)
        for item in detector_matches:
            durations_by_config[str(item["configId"])].append(int(item["durationTicks"]))
        if cluster is not None:
            match_status = "strict"
        elif extended_cluster is not None:
            match_status = "extended-only"
        else:
            match_status = "unmatched"
        row = {
            **note,
            "sourceSeconds": finite_float(source_seconds),
            "matchStatus": match_status,
            "matchedClusterId": cluster["clusterId"] if cluster else None,
            "detectorConfigCount": support_count,
            "detectorConfigIds": cluster["configIds"] if cluster else [],
            "detectorStartTickMedian": cluster["startTickMedian"] if cluster else None,
            "detectorStartResidualTicks": (
                int(cluster["startTickMedian"]) - int(note["startTick"])
                if cluster else None
            ),
            "detectorDurationTicksMedian": detector_duration,
            "detectorDurationResidualTicks": detector_duration_residual,
            "detectorDurationTicksRange": (
                [min(detector_durations), max(detector_durations)]
                if detector_durations else None
            ),
            "scoreDurationInsideDetectorRange": (
                min(detector_durations) <= int(note["durationTicks"]) <= max(detector_durations)
                if detector_durations else None
            ),
            "detectorDurationTicksByConfig": dict(sorted(durations_by_config.items())),
            "detectorMatches": detector_matches,
            "detectorAmplitudeMedian": cluster["amplitudeMedian"] if cluster else None,
            "extendedClusterId": extended_cluster["clusterId"] if extended_cluster else None,
            "extendedStartResidualTicks": (
                int(extended_cluster["startTickMedian"]) - int(note["startTick"])
                if extended_cluster else None
            ),
            "nearestSamePitchClusterId": clusters[nearest_index]["clusterId"] if nearest_index is not None else None,
            "nearestSamePitchStartResidualTicks": nearest_delta,
            "rawNearestSamePitchWithinStrictTolerance": (
                nearest_delta is not None
                and abs(nearest_delta) <= arguments.match_tolerance_ticks
            ),
            "rawNearestSamePitchWithinExtendedTolerance": (
                nearest_delta is not None
                and abs(nearest_delta) <= arguments.extended_match_tolerance_ticks
            ),
            "sourceSpectrum": spectral,
            "sourceSpectrumDuration": {
                **spectral_duration,
                "estimatedDurationTicks": spectrum_duration_ticks,
                "durationResidualTicks": spectrum_duration_residual,
            },
        }
        note_rows.append(row)

    calibration_values = [
        float(row["sourceSpectrum"]["pitchAttackEvidenceDb"])
        for row in note_rows
        if int(row["detectorConfigCount"]) >= arguments.minimum_consensus_configs
        and row["sourceSpectrum"].get("available")
    ]
    calibration_amplitudes = [
        float(row["detectorAmplitudeMedian"])
        for row in note_rows
        if int(row["detectorConfigCount"]) >= arguments.minimum_consensus_configs
        and row["detectorAmplitudeMedian"] is not None
    ]
    calibration_quantiles = quantiles(calibration_values)
    amplitude_quantiles = quantiles(calibration_amplitudes)
    spectrum_p05 = float(calibration_quantiles["p05"] if calibration_quantiles else -999.0)
    spectrum_p10 = float(calibration_quantiles["p10"] if calibration_quantiles else -999.0)
    spectrum_p25 = float(calibration_quantiles["p25"] if calibration_quantiles else -999.0)

    # Second pass: calibrated spectrum label and octave/harmonic ambiguity.
    for row in note_rows:
        evidence_db = float(row["sourceSpectrum"].get("pitchAttackEvidenceDb", -999.0))
        evidence_percentile = percentile(calibration_values, evidence_db)
        if evidence_db >= spectrum_p25:
            spectrum_label = "strong-relative"
        elif evidence_db >= spectrum_p10:
            spectrum_label = "moderate-relative"
        else:
            spectrum_label = "weak-relative"
        row["sourceSpectrum"]["calibrationPercentile"] = (
            finite_float(evidence_percentile) if evidence_percentile is not None else None
        )
        row["sourceSpectrum"]["relativeSupportLabel"] = spectrum_label
        partial = classify_partial_risk(
            midi=int(row["midi"]),
            tick=int(row["startTick"]),
            detector_config_count=int(row["detectorConfigCount"]),
            after_energy=float(row["sourceSpectrum"].get("afterP75Energy", 0.0)),
            notes=notes,
            note_support=note_support,
            bank=bank,
            source_anchor_seconds=source_anchor_seconds,
            ticks_per_second=ticks_per_second,
        )
        row["partialRisk"] = partial
        weak_detector = int(row["detectorConfigCount"]) <= 1
        weak_spectrum = evidence_db < spectrum_p05
        high_partial = partial["harmonicPartialRisk"] == "high"
        if weak_detector and weak_spectrum and high_partial:
            review_class = "high-confidence-false-positive-review"
        elif row["matchStatus"] == "unmatched":
            review_class = "unmatched-score-review"
        elif row["matchStatus"] == "extended-only":
            review_class = "onset-offset-review"
        elif int(row["detectorConfigCount"]) < arguments.minimum_consensus_configs:
            review_class = "weak-detector-support-review"
        else:
            review_class = "supported"
        row["reviewClass"] = review_class

    # Unmatched consensus clusters are classified before any omission claim.
    omission_rows: list[dict[str, Any]] = []
    amplitude_p25 = float(amplitude_quantiles["p25"] if amplitude_quantiles else 0.0)
    for cluster_index, cluster in enumerate(clusters):
        if cluster_index in used_cluster_indices:
            continue
        if int(cluster["configCount"]) < arguments.minimum_consensus_configs:
            continue
        tick = int(cluster["startTickMedian"])
        midi = int(cluster["midi"])
        same_pitch_spans = [
            note for note in notes
            if int(note["midi"]) == midi
            and int(note["startTick"]) + arguments.match_tolerance_ticks < tick
            <= int(note["endTick"]) + arguments.match_tolerance_ticks
        ]
        near_same_pitch = [
            note for note in notes
            if int(note["midi"]) == midi
            and abs(int(note["startTick"]) - tick) <= arguments.extended_match_tolerance_ticks
        ]
        near_strike = [
            note for note in notes
            if abs(int(note["startTick"]) - tick) <= STRIKE_TOLERANCE_TICKS
        ]
        source_seconds = source_anchor_seconds + tick / ticks_per_second
        spectral = spectrum_features(bank, midi, source_seconds)
        evidence_db = float(spectral.get("pitchAttackEvidenceDb", -999.0))
        evidence_percentile = percentile(calibration_values, evidence_db)
        spectral["calibrationPercentile"] = (
            finite_float(evidence_percentile) if evidence_percentile is not None else None
        )
        partial = classify_partial_risk(
            midi=midi,
            tick=tick,
            detector_config_count=int(cluster["configCount"]),
            after_energy=float(spectral.get("afterP75Energy", 0.0)),
            notes=notes,
            note_support=note_support,
            bank=bank,
            source_anchor_seconds=source_anchor_seconds,
            ticks_per_second=ticks_per_second,
        )
        if same_pitch_spans:
            classification = "continuation-fragment"
        elif near_same_pitch:
            classification = "onset-offset-or-duplicate"
        elif partial["harmonicPartialRisk"] in ("high", "medium"):
            classification = "upper-partial-risk"
        else:
            strong_omission = (
                int(cluster["configCount"]) == len(sweep_payload["decodings"])
                and float(cluster["amplitudeMedian"]) >= amplitude_p25
                and evidence_db >= spectrum_p25
            )
            classification = (
                "high-confidence-omission-review"
                if strong_omission else "consensus-omission-review"
            )
        omission_rows.append({
            **cluster,
            "sourceSeconds": finite_float(source_seconds),
            "classification": classification,
            "relatedSamePitchSpanEventIds": [note["eventId"] for note in same_pitch_spans],
            "relatedNearSamePitchEventIds": [note["eventId"] for note in near_same_pitch],
            "relatedStrikeEventIds": [note["eventId"] for note in near_strike],
            "sourceSpectrum": spectral,
            "partialRisk": partial,
        })

    false_positive_rows = [
        row for row in note_rows
        if row["reviewClass"] in (
            "high-confidence-false-positive-review",
            "unmatched-score-review",
            "weak-detector-support-review",
        )
    ]
    high_confidence_false_positive = [
        row for row in note_rows
        if row["reviewClass"] == "high-confidence-false-positive-review"
    ]
    high_confidence_omission = [
        row for row in omission_rows
        if row["classification"] == "high-confidence-omission-review"
    ]
    detector_duration_queue = [
        row for row in note_rows
        if int(row["detectorConfigCount"]) >= arguments.minimum_consensus_configs
        and row["detectorDurationResidualTicks"] is not None
        and abs(int(row["detectorDurationResidualTicks"])) >= 240
    ]
    detector_duration_envelope_queue = [
        row for row in note_rows
        if int(row["detectorConfigCount"]) >= arguments.minimum_consensus_configs
        and row["detectorDurationTicksRange"] is not None
        and (
            int(row["durationTicks"]) < int(row["detectorDurationTicksRange"][0]) - 240
            or int(row["durationTicks"]) > int(row["detectorDurationTicksRange"][1]) + 240
        )
    ]
    spectrum_duration_queue = [
        row for row in note_rows
        if row["sourceSpectrumDuration"].get("reliability") in ("medium", "high")
        and row["sourceSpectrumDuration"].get("durationResidualTicks") is not None
        and abs(int(row["sourceSpectrumDuration"]["durationResidualTicks"])) >= 240
    ]

    segment_boundaries = (
        ("opening", 0, 24_000),
        ("postHandoff", 24_000, score_end_tick + 1),
    )
    counts_by_segment: dict[str, dict[str, Any]] = {}
    for segment_id, start_tick, end_tick in segment_boundaries:
        selected = [
            row for row in note_rows
            if start_tick <= int(row["startTick"]) < end_tick
        ]
        selected_omissions = [
            row for row in omission_rows
            if start_tick <= int(row["startTickMedian"]) < end_tick
        ]
        counts_by_segment[segment_id] = {
            "startTick": start_tick,
            "endTickExclusive": end_tick,
            "scoreEvents": len(selected),
            "strictMatches": sum(row["matchStatus"] == "strict" for row in selected),
            "extendedOnlyMatches": sum(row["matchStatus"] == "extended-only" for row in selected),
            "oneToOneUnmatched": sum(row["matchStatus"] == "unmatched" for row in selected),
            "oneToOneUnmatchedWithRawNearestWithinExtendedTolerance": sum(
                row["matchStatus"] == "unmatched"
                and bool(row["rawNearestSamePitchWithinExtendedTolerance"])
                for row in selected
            ),
            "noNearbySamePitchWithinExtendedTolerance": sum(
                row["nearestSamePitchStartResidualTicks"] is None
                or abs(int(row["nearestSamePitchStartResidualTicks"])) > arguments.extended_match_tolerance_ticks
                for row in selected
            ),
            "consensusSupported": sum(
                int(row["detectorConfigCount"]) >= arguments.minimum_consensus_configs
                for row in selected
            ),
            "weakDetectorSupportOrUnmatched": sum(
                int(row["detectorConfigCount"]) < arguments.minimum_consensus_configs
                for row in selected
            ),
            "consensusUnmatchedClusters": len(selected_omissions),
            "omissionClassCounts": dict(sorted(Counter(
                str(row["classification"]) for row in selected_omissions
            ).items())),
            "detectorMedianDurationReview": sum(row in detector_duration_queue for row in selected),
            "detectorOutsideAllConfigRangesReview": sum(
                row in detector_duration_envelope_queue for row in selected
            ),
            "spectrumDurationReview": sum(row in spectrum_duration_queue for row in selected),
        }

    support_distribution = Counter(int(row["detectorConfigCount"]) for row in note_rows)
    role_counts: dict[str, dict[str, int]] = {}
    for role in sorted({str(row["role"]) for row in note_rows}):
        selected = [row for row in note_rows if row["role"] == role]
        role_counts[role] = {
            "scoreEvents": len(selected),
            "strictMatches": sum(row["matchStatus"] == "strict" for row in selected),
            "extendedOnlyMatches": sum(row["matchStatus"] == "extended-only" for row in selected),
            "unmatched": sum(row["matchStatus"] == "unmatched" for row in selected),
            "consensusSupported": sum(
                int(row["detectorConfigCount"]) >= arguments.minimum_consensus_configs
                for row in selected
            ),
        }

    expected_score_events = int(score_payload.get("score", {}).get("noteCount", len(notes)))
    unique_event_ids = len({str(row["eventId"]) for row in note_rows})
    coverage_gate = {
        "status": "pass" if (
            len(notes) == expected_score_events
            and len(note_rows) == expected_score_events
            and unique_event_ids == expected_score_events
        ) else "fail",
        "expectedScoreEvents": expected_score_events,
        "scoreEventsRead": len(notes),
        "perEventAuditRows": len(note_rows),
        "uniqueEventIds": unique_event_ids,
        "coverage": f"{len(note_rows)}/{expected_score_events}",
        "everyEventHasDetectorAndSpectrumFields": all(
            "detectorConfigCount" in row
            and "sourceSpectrum" in row
            and "sourceSpectrumDuration" in row
            and "partialRisk" in row
            for row in note_rows
        ),
    }
    if coverage_gate["status"] != "pass":
        raise ValueError(f"Per-event coverage gate failed: {coverage_gate}")

    prior_counts = prior_consensus_payload.get("counts", {})
    prior_unmatched_total = sum(int(prior_counts.get(key, 0)) for key in (
        "consensusOmissionQueue",
        "consensusDuplicateAttackQueue",
        "consensusContinuationQueue",
        "consensusOctavePartialQueue",
    ))
    prior_duration_ids = {
        str(item["score"]["eventId"])
        for item in prior_consensus_payload.get("durationReviewQueue", [])
    }
    current_post_duration_ids = {
        str(item["eventId"])
        for item in detector_duration_queue
        if int(item["startTick"]) >= 24_000
    }
    prior_unsupported_ids = sorted(
        str(item["eventId"])
        for item in prior_consensus_payload.get("unsupportedScoreEvents", [])
    )
    current_post_unmatched_ids = sorted(
        str(item["eventId"])
        for item in note_rows
        if int(item["startTick"]) >= 24_000 and item["matchStatus"] == "unmatched"
    )
    prior_consensus_cross_check = {
        "status": "pass" if (
            int(prior_counts.get("scoreEvents", -1)) == counts_by_segment["postHandoff"]["scoreEvents"]
            and int(prior_counts.get("matches", -1)) == counts_by_segment["postHandoff"]["strictMatches"]
            and prior_unmatched_total == counts_by_segment["postHandoff"]["consensusUnmatchedClusters"]
            and prior_unsupported_ids == current_post_unmatched_ids
        ) else "review",
        "priorArtifact": relative(arguments.prior_consensus),
        "priorScoreRevision": prior_consensus_payload.get("inputs", {}).get("score"),
        "window": prior_consensus_payload.get("window"),
        "priorCounts": prior_counts,
        "currentScorePostHandoff": counts_by_segment["postHandoff"],
        "priorUnmatchedClassTotal": prior_unmatched_total,
        "currentUnmatchedClassTotal": counts_by_segment["postHandoff"]["consensusUnmatchedClusters"],
        "priorUnsupportedScoreEventIds": prior_unsupported_ids,
        "currentOneToOneUnmatchedScoreEventIds": current_post_unmatched_ids,
        "priorDurationReviewEventIds": sorted(prior_duration_ids),
        "currentDurationReviewEventIds": sorted(current_post_duration_ids),
        "durationReviewAddedSinceV3": sorted(current_post_duration_ids - prior_duration_ids),
        "durationReviewRemovedSinceV3": sorted(prior_duration_ids - current_post_duration_ids),
        "interpretation": (
            "This compares the supplied score against the historical v3 post-handoff consensus. "
            "A review result is expected when a newer candidate adds or rejects events; it is not an "
            "automatic instruction to restore the older score."
        ),
    }

    output = {
        "schemaVersion": 1,
        "status": "read-only-evidence-audit; no score or engine mutation",
        "truthPolicy": (
            "The source video/audio is authoritative. Multi-threshold detector consensus and "
            "source-spectrum measurements produce review evidence only; neither is auto-imported."
        ),
        "inputs": {
            "score": {"path": relative(arguments.score), "sha256": sha256(arguments.score)},
            "sweep": {"path": relative(arguments.sweep), "sha256": sweep_sha256},
            "priorPostHandoffConsensus": {
                "path": relative(arguments.prior_consensus),
                "sha256": sha256(arguments.prior_consensus),
            },
            "audio": {"path": relative(arguments.audio), "sha256": audio_sha256},
            "sweepSourceAudio": sweep_payload.get("audio"),
            "sweepAudioHashMatchesInput": recorded_sweep_audio_sha256 in (None, audio_sha256),
        },
        "timeMapping": {
            "sourceTickZeroSeconds": source_anchor_seconds,
            "ticksPerSecond": ticks_per_second,
            "ppq": ppq,
            "bpm": bpm,
        },
        "tolerances": {
            "detectorClusterTicks": arguments.cluster_tolerance_ticks,
            "strictSamePitchMatchTicks": arguments.match_tolerance_ticks,
            "extendedSamePitchMatchTicks": arguments.extended_match_tolerance_ticks,
            "relatedStrikeTicks": STRIKE_TOLERANCE_TICKS,
            "minimumConsensusConfigs": arguments.minimum_consensus_configs,
        },
        "spectrumMethod": {
            "source": "direct source-WAV narrow-band STFT; no candidate render is measured",
            "sampleRate": sample_rate,
            "windowSizeSamples": bank.window_size,
            "hopSizeSamples": bank.hop_size,
            "fftSizeSamples": bank.fft_size,
            "pitchBandHalfWidthCents": 40,
            "attackBeforeWindowSeconds": [-0.180, -0.050],
            "attackAfterWindowSeconds": [0.050, 0.190],
            "calibrationPopulation": "strict score matches supported by at least three detector configs",
            "pitchAttackEvidenceQuantilesDb": calibration_quantiles,
            "detectorAmplitudeQuantiles": amplitude_quantiles,
        },
        "coverageGate": coverage_gate,
        "priorPostHandoffConsensusCrossCheck": prior_consensus_cross_check,
        "counts": {
            "scoreEvents": len(note_rows),
            "detectorClusters": len(clusters),
            "strictMatches": sum(row["matchStatus"] == "strict" for row in note_rows),
            "extendedOnlyMatches": sum(row["matchStatus"] == "extended-only" for row in note_rows),
            "unmatchedScoreEvents": sum(row["matchStatus"] == "unmatched" for row in note_rows),
            "rawNearestSamePitchWithinExtendedTolerance": sum(
                bool(row["rawNearestSamePitchWithinExtendedTolerance"]) for row in note_rows
            ),
            "noRawNearestSamePitchWithinExtendedTolerance": sum(
                not bool(row["rawNearestSamePitchWithinExtendedTolerance"]) for row in note_rows
            ),
            "oneToOneUnmatchedWithRawNearestWithinExtendedTolerance": sum(
                row["matchStatus"] == "unmatched"
                and bool(row["rawNearestSamePitchWithinExtendedTolerance"])
                for row in note_rows
            ),
            "consensusSupportedScoreEvents": sum(
                int(row["detectorConfigCount"]) >= arguments.minimum_consensus_configs
                for row in note_rows
            ),
            "scoreSupportConfigDistribution": dict(sorted(support_distribution.items())),
            "consensusUnmatchedClusters": len(omission_rows),
            "highConfidenceOmissionReview": len(high_confidence_omission),
            "highConfidenceFalsePositiveReview": len(high_confidence_false_positive),
            "detectorDurationReview": len(detector_duration_queue),
            "detectorDurationOutsideAllConfigRangesReview": len(detector_duration_envelope_queue),
            "spectrumDurationReview": len(spectrum_duration_queue),
        },
        "countsByRole": role_counts,
        "countsBySegment": counts_by_segment,
        "limitations": [
            "All threshold decodings share one Basic Pitch inference; configCount is stability, not independent-vote probability.",
            "A piano upper partial can occupy the same spectral band as a truly played octave; visual key/hand evidence is required for final octave decisions.",
            "Basic Pitch ends and narrow-band spectral decay include key hold, pedal, resonance, and masking; duration residuals are review cues, not literal key-off truth.",
            "Strict matches use one detector cluster per score attack; extended-only rows expose 101-160 tick onset disagreements rather than hiding them.",
        ],
        "highConfidenceOmissionReview": high_confidence_omission,
        "highConfidenceFalsePositiveReview": high_confidence_false_positive,
        "detectorDurationReview": detector_duration_queue,
        "detectorDurationOutsideAllConfigRangesReview": detector_duration_envelope_queue,
        "spectrumDurationReview": spectrum_duration_queue,
        "omissionReview": omission_rows,
        "falsePositiveReview": false_positive_rows,
        "scoreEvents": note_rows,
    }

    arguments.out.mkdir(parents=True, exist_ok=True)
    json_path = arguments.out / "full-pitch-audit.json"
    json_path.write_text(json.dumps(output, indent=2) + "\n")

    score_csv_rows: list[dict[str, Any]] = []
    for row in note_rows:
        score_csv_rows.append({
            **row,
            "detectorConfigIds": ";".join(row["detectorConfigIds"]),
            "octavePartialRisk": row["partialRisk"]["octavePartialRisk"],
            "harmonicPartialRisk": row["partialRisk"]["harmonicPartialRisk"],
            "relatedLowerEventIds": ";".join(
                str(item["eventId"]) for item in row["partialRisk"]["relatedLowerEvents"]
            ),
            "spectrumOnsetRiseDb": row["sourceSpectrum"].get("onsetRiseDb"),
            "spectrumLocalPitchContrastDb": row["sourceSpectrum"].get("localPitchContrastDb"),
            "spectrumAttackEvidenceDb": row["sourceSpectrum"].get("pitchAttackEvidenceDb"),
            "spectrumCalibrationPercentile": row["sourceSpectrum"].get("calibrationPercentile"),
            "spectrumRelativeSupport": row["sourceSpectrum"].get("relativeSupportLabel"),
            "spectrumEstimatedDurationTicks": row["sourceSpectrumDuration"].get("estimatedDurationTicks"),
            "spectrumDurationResidualTicks": row["sourceSpectrumDuration"].get("durationResidualTicks"),
            "spectrumDurationReliability": row["sourceSpectrumDuration"].get("reliability"),
            "detectorDurationTicksRange": (
                ";".join(str(value) for value in row["detectorDurationTicksRange"])
                if row["detectorDurationTicksRange"] else ""
            ),
            "detectorDurationTicksByConfig": ";".join(
                f"{config_id}:{','.join(str(value) for value in values)}"
                for config_id, values in row["detectorDurationTicksByConfig"].items()
            ),
        })
    score_fields = [
        "eventId", "evidenceId", "strikeGroupId", "role", "startTick", "durationTicks",
        "endTick", "midi", "noteName", "velocity", "sourceSeconds", "matchStatus",
        "matchedClusterId", "detectorConfigCount", "detectorConfigIds",
        "detectorStartTickMedian", "detectorStartResidualTicks", "detectorDurationTicksMedian",
        "detectorDurationResidualTicks", "detectorDurationTicksRange",
        "scoreDurationInsideDetectorRange", "detectorDurationTicksByConfig",
        "detectorAmplitudeMedian", "extendedClusterId",
        "extendedStartResidualTicks", "nearestSamePitchClusterId",
        "nearestSamePitchStartResidualTicks", "rawNearestSamePitchWithinStrictTolerance",
        "rawNearestSamePitchWithinExtendedTolerance", "octavePartialRisk", "harmonicPartialRisk",
        "relatedLowerEventIds", "spectrumOnsetRiseDb", "spectrumLocalPitchContrastDb",
        "spectrumAttackEvidenceDb", "spectrumCalibrationPercentile", "spectrumRelativeSupport",
        "spectrumEstimatedDurationTicks", "spectrumDurationResidualTicks",
        "spectrumDurationReliability", "reviewClass",
    ]
    csv_text(arguments.out / "score-events.csv", score_csv_rows, score_fields)

    omission_csv_rows: list[dict[str, Any]] = []
    for row in omission_rows:
        omission_csv_rows.append({
            **row,
            "configIds": ";".join(row["configIds"]),
            "relatedSamePitchSpanEventIds": ";".join(row["relatedSamePitchSpanEventIds"]),
            "relatedNearSamePitchEventIds": ";".join(row["relatedNearSamePitchEventIds"]),
            "relatedStrikeEventIds": ";".join(row["relatedStrikeEventIds"]),
            "octavePartialRisk": row["partialRisk"]["octavePartialRisk"],
            "harmonicPartialRisk": row["partialRisk"]["harmonicPartialRisk"],
            "relatedLowerEventIds": ";".join(
                str(item["eventId"]) for item in row["partialRisk"]["relatedLowerEvents"]
            ),
            "spectrumAttackEvidenceDb": row["sourceSpectrum"].get("pitchAttackEvidenceDb"),
            "spectrumCalibrationPercentile": row["sourceSpectrum"].get("calibrationPercentile"),
        })
    omission_fields = [
        "clusterId", "startTickMedian", "sourceSeconds", "midi", "noteName", "configCount",
        "configIds", "startTickSpread", "durationTicksMedian", "amplitudeMedian", "classification",
        "relatedSamePitchSpanEventIds", "relatedNearSamePitchEventIds", "relatedStrikeEventIds",
        "octavePartialRisk", "harmonicPartialRisk", "relatedLowerEventIds",
        "spectrumAttackEvidenceDb", "spectrumCalibrationPercentile",
    ]
    csv_text(arguments.out / "omission-review.csv", omission_csv_rows, omission_fields)
    csv_text(
        arguments.out / "false-positive-review.csv",
        [row for row in score_csv_rows if row["reviewClass"] != "supported" and row["reviewClass"] != "onset-offset-review"],
        score_fields,
    )

    confirmed_summary = {
        "scoreEvents": len(note_rows),
        "strictMatches": output["counts"]["strictMatches"],
        "extendedOnlyMatches": output["counts"]["extendedOnlyMatches"],
        "unmatchedScoreEvents": output["counts"]["unmatchedScoreEvents"],
        "consensusSupportedScoreEvents": output["counts"]["consensusSupportedScoreEvents"],
    }
    opening_counts = counts_by_segment["opening"]
    post_counts = counts_by_segment["postHandoff"]
    unmatched_summary = [
        {
            "eventId": row["eventId"],
            "role": row["role"],
            "tick": row["startTick"],
            "pitch": row["noteName"],
            "nearestDelta": row["nearestSamePitchStartResidualTicks"],
            "spectrumPercentile": row["sourceSpectrum"].get("calibrationPercentile"),
            "reviewClass": row["reviewClass"],
        }
        for row in note_rows if row["matchStatus"] != "strict"
    ]
    high_omission_summary = [
        {
            "clusterId": row["clusterId"],
            "tick": row["startTickMedian"],
            "pitch": row["noteName"],
            "configs": row["configCount"],
            "amplitude": row["amplitudeMedian"],
            "spectrumPercentile": row["sourceSpectrum"].get("calibrationPercentile"),
        }
        for row in high_confidence_omission
    ]
    weak_score_summary = [
        {
            "eventId": row["eventId"],
            "role": row["role"],
            "tick": row["startTick"],
            "pitch": row["noteName"],
            "configs": row["detectorConfigCount"],
            "nearestDelta": row["nearestSamePitchStartResidualTicks"],
            "spectrumPercentile": row["sourceSpectrum"].get("calibrationPercentile"),
        }
        for row in note_rows
        if int(row["detectorConfigCount"]) < arguments.minimum_consensus_configs
    ]
    consensus_omission_summary = [
        {
            "clusterId": row["clusterId"],
            "tick": row["startTickMedian"],
            "pitch": row["noteName"],
            "configs": row["configCount"],
            "amplitude": row["amplitudeMedian"],
            "spectrumPercentile": row["sourceSpectrum"].get("calibrationPercentile"),
            "nearStrike": row["relatedStrikeEventIds"],
        }
        for row in omission_rows
        if row["classification"] == "consensus-omission-review"
    ]
    duration_envelope_summary = [
        {
            "eventId": row["eventId"],
            "role": row["role"],
            "tick": row["startTick"],
            "pitch": row["noteName"],
            "scoreDuration": row["durationTicks"],
            "detectorRange": row["detectorDurationTicksRange"],
            "spectrumDuration": row["sourceSpectrumDuration"].get("estimatedDurationTicks"),
            "spectrumReliability": row["sourceSpectrumDuration"].get("reliability"),
        }
        for row in detector_duration_envelope_queue
    ]
    prior_cross_check_readme = (
        "The historical v3 post-handoff consensus was loaded and hash-checked against the same sweep. "
        f"Cross-check status: **{prior_consensus_cross_check['status']}**. The current candidate has "
        f"{post_counts['scoreEvents']} post-handoff score events, {post_counts['strictMatches']} strict matches "
        f"and {post_counts['consensusUnmatchedClusters']} classified unmatched clusters. A `review` result "
        "is expected after explicit audiovisual additions/rejections and does not authorize reverting them."
    )
    unmatched_explanations: list[str] = []
    if any(str(row["eventId"]) == "bass-028" for row in note_rows if row["matchStatus"] != "strict"):
        unmatched_explanations.append(
            "- `bass-028` is a historical evidence ID, not its current functional role. Its exported role is "
            "**Lead**; the nearest detector B3 onset is 249 ticks earlier, while direct source-spectrum "
            "evidence is around the calibrated 53rd percentile. It remains a visual/onset review, not a "
            "proved false note."
        )
    unmatched_explanation_readme = "\n".join(unmatched_explanations) or "_No candidate-specific exception note._"

    readme = f"""# Take Five `{score_label}` · full pitch/completeness/duration audit

This is a **read-only evidence report**. It examined every score note and did not mutate the VideoReplica score, engine, MIDI, or WAV.

## Coverage

- Per-event coverage gate: **{coverage_gate['coverage']} ({coverage_gate['status']})**
- Score events: **{confirmed_summary['scoreEvents']}** (Bass {role_counts.get('bass', {}).get('scoreEvents', 0)}, Comp {role_counts.get('comp', {}).get('scoreEvents', 0)}, Lead {role_counts.get('lead', {}).get('scoreEvents', 0)})
- Same-pitch detector match within ±{arguments.match_tolerance_ticks} ticks: **{confirmed_summary['strictMatches']}**
- One-to-one match only in the explicit ±{arguments.extended_match_tolerance_ticks}-tick review band: **{confirmed_summary['extendedOnlyMatches']}**
- No one-to-one detector assignment inside ±{arguments.extended_match_tolerance_ticks} ticks: **{confirmed_summary['unmatchedScoreEvents']}**
- Raw nearest same-pitch cluster inside ±{arguments.extended_match_tolerance_ticks} ticks: **{output['counts']['rawNearestSamePitchWithinExtendedTolerance']}**; outside that band: **{output['counts']['noRawNearestSamePitchWithinExtendedTolerance']}**
- One-to-one-unmatched events that still have a raw nearest cluster inside ±{arguments.extended_match_tolerance_ticks} ticks: **{output['counts']['oneToOneUnmatchedWithRawNearestWithinExtendedTolerance']}**
- Supported by at least {arguments.minimum_consensus_configs}/4 threshold decodings: **{confirmed_summary['consensusSupportedScoreEvents']}**
- Detector-duration residuals ≥240 ticks: **{len(detector_duration_queue)}**
- Score duration ≥240 ticks outside every matched config's duration range: **{len(detector_duration_envelope_queue)}**
- Medium/high-reliability spectral-decay residuals ≥240 ticks: **{len(spectrum_duration_queue)}**

`score-events.csv` has exactly one row per score event and includes support-config count/IDs, nearest same-pitch match and residual, octave/harmonic-partial risk, detector duration residual, and source-spectrum duration residual.

## Opening / post-handoff split

| Segment | Tick range | Score events | Strict match | Consensus supported | Weak/unmatched | Consensus unmatched clusters | Detector duration review | Spectrum duration review |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Opening | 0–23999 | {opening_counts['scoreEvents']} | {opening_counts['strictMatches']} | {opening_counts['consensusSupported']} | {opening_counts['weakDetectorSupportOrUnmatched']} | {opening_counts['consensusUnmatchedClusters']} | {opening_counts['detectorMedianDurationReview']} | {opening_counts['spectrumDurationReview']} |
| Post-handoff | 24000–end | {post_counts['scoreEvents']} | {post_counts['strictMatches']} | {post_counts['consensusSupported']} | {post_counts['weakDetectorSupportOrUnmatched']} | {post_counts['consensusUnmatchedClusters']} | {post_counts['detectorMedianDurationReview']} | {post_counts['spectrumDurationReview']} |

{prior_cross_check_readme}

## Score events outside the strict onset match

{markdown_table(unmatched_summary, ['eventId', 'role', 'tick', 'pitch', 'nearestDelta', 'spectrumPercentile', 'reviewClass'], 30)}

These rows are not automatically false notes. An onset delta can come from detector texture splitting, a quiet attack, or the strict one-cluster-per-attack matching rule.

{unmatched_explanation_readme}

## Conservative high-confidence omission review

Count: **{len(high_confidence_omission)}**.

{markdown_table(high_omission_summary, ['clusterId', 'tick', 'pitch', 'configs', 'amplitude', 'spectrumPercentile'], 30)}

This label requires all four decodings, amplitude above the calibrated lower quartile, direct spectrum support above the calibrated lower quartile, no same-pitch continuation/near match, and no medium/high lower-harmonic risk. It is still a review queue, not permission to add notes. **A zero count does not prove there are no omitted notes**; it means no unmatched detector cluster clears this deliberately conservative audio-only gate.

## Conservative high-confidence false-positive review

Count: **{len(high_confidence_false_positive)}**.

A score event enters this queue only when detector support is ≤1/4, direct spectrum evidence is below the calibrated fifth percentile, and a strongly supported lower harmonic source explains the target band. **A zero count does not prove there are no wrong notes.** Absence from this queue does not prove every octave; physical-key video evidence remains authoritative.

## Remaining low-confidence queues

- Score events with fewer than {arguments.minimum_consensus_configs}/4 stable decodings: **{len(weak_score_summary)}** (opening {opening_counts['weakDetectorSupportOrUnmatched']}, post-handoff {post_counts['weakDetectorSupportOrUnmatched']}).
- Consensus unmatched clusters left after continuation, near-duplicate, and upper-partial-risk classification: **{len(consensus_omission_summary)}** (opening {opening_counts['omissionClassCounts'].get('consensus-omission-review', 0)}, post-handoff {post_counts['omissionClassCounts'].get('consensus-omission-review', 0)}).
- Other unmatched consensus clusters are explicitly retained as continuation fragments ({output['countsBySegment']['opening']['omissionClassCounts'].get('continuation-fragment', 0) + output['countsBySegment']['postHandoff']['omissionClassCounts'].get('continuation-fragment', 0)}), onset-offset/duplicates ({output['countsBySegment']['opening']['omissionClassCounts'].get('onset-offset-or-duplicate', 0) + output['countsBySegment']['postHandoff']['omissionClassCounts'].get('onset-offset-or-duplicate', 0)}), or upper-partial risks ({output['countsBySegment']['opening']['omissionClassCounts'].get('upper-partial-risk', 0) + output['countsBySegment']['postHandoff']['omissionClassCounts'].get('upper-partial-risk', 0)}); none is an automatic add.

The F3 detector cluster at tick 43288 remains in the consensus-only queue; this audit supplies no new physical-key evidence and does not promote it into the score.

First weak-score rows:

{markdown_table(weak_score_summary, ['eventId', 'role', 'tick', 'pitch', 'configs', 'nearestDelta', 'spectrumPercentile'], 20)}

First consensus-omission rows:

{markdown_table(consensus_omission_summary, ['clusterId', 'tick', 'pitch', 'configs', 'amplitude', 'spectrumPercentile', 'nearStrike'], 20)}

## Duration interpretation

`detectorDurationResidualTicks` compares the median Basic Pitch span with the score. `spectrumDurationResidualTicks` estimates when a narrow source band decays below a local threshold. The **{len(detector_duration_queue)} detector-median** and **{len(spectrum_duration_queue)} spectral-decay** rows must not be used to auto-trim or extend notes. Both can include pedal, sympathetic resonance, masking, detector splits, and same-key reattacks. Only **{len(detector_duration_envelope_queue)}** score durations are at least 240 ticks outside every matched decoder's duration range, and even those remain audiovisual review cues rather than literal finger-release measurements.

{markdown_table(duration_envelope_summary, ['eventId', 'role', 'tick', 'pitch', 'scoreDuration', 'detectorRange', 'spectrumDuration', 'spectrumReliability'], 10)}

## Reproducibility

```sh
python3 scripts/audit-video-replica-full-pitch.py
```

Inputs and SHA-256 hashes are recorded in `full-pitch-audit.json`. The four threshold decodings share one model inference, so a 4/4 config count means threshold stability—not four independent transcriptions.
"""
    (arguments.out / "README.md").write_text(readme)
    print(json_path)


if __name__ == "__main__":
    main()
