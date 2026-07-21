#!/usr/bin/env python3
"""Create level-matched source/candidate A/B files without changing score time.

The source slice uses the independently fitted transport anchor.  It does not
shift, stretch, quantize or rewrite candidate events.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
import wave
from pathlib import Path

import numpy as np


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
        raise ValueError(f"{path} lacks fmt/data")
    tag, channels, sample_rate, _, _, bits = struct.unpack("<HHIIHH", fmt[:16])
    if tag == 0xFFFE and len(fmt) >= 26:
        tag = struct.unpack("<H", fmt[24:26])[0]
    if tag == 1 and bits == 16:
        samples = np.frombuffer(payload, dtype="<i2").astype(np.float64) / 32768.0
    elif tag == 3 and bits == 32:
        samples = np.frombuffer(payload, dtype="<f4").astype(np.float64)
    else:
        raise ValueError(f"unsupported WAVE tag={tag}, bits={bits}: {path}")
    return samples.reshape(-1, channels).mean(axis=1), sample_rate


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def level_match(signal: np.ndarray, target_rms: float) -> tuple[np.ndarray, float, float]:
    rms = math.sqrt(float(np.mean(signal * signal)) + 1e-15)
    gain = target_rms / rms
    peak = float(np.max(np.abs(signal))) if len(signal) else 0.0
    if peak * gain > 0.95:
        gain = 0.95 / peak
    return signal * gain, gain, rms


def shared_level_match(
    source: np.ndarray,
    candidate: np.ndarray,
    target_rms: float,
) -> tuple[np.ndarray, np.ndarray, float, float, float]:
    """Apply one source-derived gain so a single-variable render stays single-variable."""
    source_rms = math.sqrt(float(np.mean(source * source)) + 1e-15)
    candidate_rms = math.sqrt(float(np.mean(candidate * candidate)) + 1e-15)
    gain = target_rms / source_rms
    peak = max(
        float(np.max(np.abs(source))) if len(source) else 0.0,
        float(np.max(np.abs(candidate))) if len(candidate) else 0.0,
    )
    if peak * gain > 0.95:
        gain = 0.95 / peak
    return source * gain, candidate * gain, gain, source_rms, candidate_rms


def write_pcm16(path: Path, samples: np.ndarray, sample_rate: int) -> None:
    samples = np.clip(samples, -1.0, 1.0)
    pcm = np.round(samples * 32767.0).astype("<i2")
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1 if pcm.ndim == 1 else pcm.shape[1])
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(pcm.tobytes())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument(
        "--candidate-render-provenance",
        type=Path,
        help="optional verified MIDI/SoundFont/renderer provenance for the candidate WAV",
    )
    parser.add_argument("--source-anchor", type=float, required=True)
    parser.add_argument(
        "--candidate-anchor",
        type=float,
        default=0.0,
        help="performed-time offset into the candidate; defaults to the score start",
    )
    parser.add_argument("--duration", type=float, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--label", default="video-replica")
    parser.add_argument(
        "--gain-policy",
        choices=("independent", "shared"),
        default="independent",
        help="independent matches unrelated recordings; shared preserves exact render-to-render dynamics",
    )
    parser.add_argument(
        "--segment-seconds",
        type=float,
        default=0.0,
        help="also export short, whole-file-level-matched A/B windows in performed time",
    )
    arguments = parser.parse_args()

    candidate_render_provenance = None
    if arguments.candidate_render_provenance is not None:
        provenance_path = arguments.candidate_render_provenance.resolve()
        provenance = json.loads(provenance_path.read_text())
        candidate_sha256 = sha256(arguments.candidate)
        output_path = Path(provenance["output"]["path"])
        if not output_path.is_absolute():
            output_path = Path.cwd() / output_path
        if output_path.resolve() != arguments.candidate.resolve():
            raise ValueError("candidate render provenance points to a different WAV")
        if provenance.get("status") != "verified-byte-identical":
            raise ValueError("candidate render provenance is not byte-identical verified")
        if provenance.get("verification", {}).get("byteIdentical") is not True:
            raise ValueError("candidate render provenance lacks byte-identical verification")
        if provenance["output"]["sha256"] != candidate_sha256:
            raise ValueError("candidate WAV hash does not match render provenance")
        candidate_render_provenance = {
            "path": str(provenance_path),
            "sha256": sha256(provenance_path),
            "status": provenance["status"],
            "candidateApprovalContentSha256": provenance["candidate"]["approvalContentSha256"],
            "midi": provenance["midi"],
            "renderer": provenance["renderer"],
            "soundFont": provenance["soundFont"],
            "output": provenance["output"],
            "verification": provenance["verification"],
        }

    source, source_rate = read_wave(arguments.source)
    candidate, candidate_rate = read_wave(arguments.candidate)
    if source_rate != candidate_rate:
        raise ValueError(f"sample-rate mismatch: {source_rate} vs {candidate_rate}")
    count = round(arguments.duration * source_rate)
    source_start = round(arguments.source_anchor * source_rate)
    candidate_start = round(arguments.candidate_anchor * source_rate)
    source = source[source_start:source_start + count]
    candidate = candidate[candidate_start:candidate_start + count]
    count = min(len(source), len(candidate))
    source = source[:count]
    candidate = candidate[:count]

    target_rms = 10 ** (-20 / 20)
    if arguments.gain_policy == "shared":
        source_matched, candidate_matched, shared_gain, source_rms, candidate_rms = shared_level_match(
            source,
            candidate,
            target_rms,
        )
        source_gain = shared_gain
        candidate_gain = shared_gain
    else:
        source_matched, source_gain, source_rms = level_match(source, target_rms)
        candidate_matched, candidate_gain, candidate_rms = level_match(candidate, target_rms)
    silence = np.zeros(round(0.75 * source_rate), dtype=np.float64)

    arguments.out.mkdir(parents=True, exist_ok=True)
    source_path = arguments.out / f"{arguments.label}-A-source.wav"
    candidate_path = arguments.out / f"{arguments.label}-B-candidate.wav"
    sequential_path = arguments.out / f"{arguments.label}-AB-sequential.wav"
    stereo_path = arguments.out / f"{arguments.label}-AB-aligned-L-source-R-candidate.wav"
    write_pcm16(source_path, source_matched, source_rate)
    write_pcm16(candidate_path, candidate_matched, source_rate)
    write_pcm16(sequential_path, np.concatenate([source_matched, silence, candidate_matched]), source_rate)
    write_pcm16(stereo_path, np.column_stack([source_matched, candidate_matched]), source_rate)

    segments = []
    if arguments.segment_seconds > 0:
        segment_count = max(1, round(arguments.segment_seconds * source_rate))
        segment_silence = np.zeros(round(0.25 * source_rate), dtype=np.float64)
        segment_dir = arguments.out / "segments"
        segment_dir.mkdir(parents=True, exist_ok=True)
        review_parts = []
        for index, start in enumerate(range(0, count, segment_count), start=1):
            end = min(count, start + segment_count)
            start_seconds = arguments.candidate_anchor + start / source_rate
            end_seconds = arguments.candidate_anchor + end / source_rate
            stem = f"{arguments.label}-{index:02d}-{start_seconds:06.3f}-{end_seconds:06.3f}"
            segment_source = source_matched[start:end]
            segment_candidate = candidate_matched[start:end]
            segment_ab_path = segment_dir / f"{stem}-AB.wav"
            segment_stereo_path = segment_dir / f"{stem}-L-source-R-candidate.wav"
            write_pcm16(
                segment_ab_path,
                np.concatenate([segment_source, segment_silence, segment_candidate]),
                source_rate,
            )
            write_pcm16(
                segment_stereo_path,
                np.column_stack([segment_source, segment_candidate]),
                source_rate,
            )
            review_parts.extend([segment_source, segment_silence, segment_candidate, silence])
            segments.append({
                "index": index,
                "performedStartSeconds": start_seconds,
                "performedEndSeconds": end_seconds,
                "performedStartTickAt200BpmPpq480": round(start_seconds * 1600),
                "performedEndTickAt200BpmPpq480": round(end_seconds * 1600),
                "sequential": str(segment_ab_path),
                "sequentialSha256": sha256(segment_ab_path),
                "alignedStereo": str(segment_stereo_path),
                "alignedStereoSha256": sha256(segment_stereo_path),
            })
        segmented_review_path = arguments.out / f"{arguments.label}-AB-by-segment.wav"
        write_pcm16(segmented_review_path, np.concatenate(review_parts), source_rate)
    else:
        segmented_review_path = None

    manifest = {
        "schemaVersion": 2,
        "policy": (
            "transport-aligned with one shared source-derived gain; no score event or timebase changes"
            if arguments.gain_policy == "shared"
            else "transport-aligned and whole-file RMS matched only; no score event or timebase changes"
        ),
        "gainPolicy": arguments.gain_policy,
        "A": {
            "kind": "source-video-audio",
            "path": str(source_path),
            "sha256": sha256(source_path),
            "gain": source_gain,
            "inputRms": source_rms,
        },
        "B": {
            "kind": "candidate-render",
            "path": str(candidate_path),
            "sha256": sha256(candidate_path),
            "gain": candidate_gain,
            "inputRms": candidate_rms,
        },
        "sourceInput": {"path": str(arguments.source.resolve()), "sha256": sha256(arguments.source)},
        "candidateInput": {"path": str(arguments.candidate.resolve()), "sha256": sha256(arguments.candidate)},
        "candidateRenderProvenance": candidate_render_provenance,
        "sourceAnchorSeconds": arguments.source_anchor,
        "candidateAnchorSeconds": arguments.candidate_anchor,
        "durationSeconds": count / source_rate,
        "sampleRate": source_rate,
        "sequential": {"path": str(sequential_path), "sha256": sha256(sequential_path)},
        "alignedStereo": {
            "path": str(stereo_path),
            "sha256": sha256(stereo_path),
            "left": "A source",
            "right": "B candidate",
        },
        "segmentedReview": {
            "policy": "each window is A source, 0.25 s silence, then B candidate; levels remain whole-file matched",
            "path": str(segmented_review_path) if segmented_review_path else None,
            "sha256": sha256(segmented_review_path) if segmented_review_path else None,
            "segments": segments,
        },
    }
    manifest_path = arguments.out / f"{arguments.label}-AB-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(manifest_path)


if __name__ == "__main__":
    main()
