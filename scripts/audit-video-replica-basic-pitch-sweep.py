#!/usr/bin/env python3
"""Run one Basic Pitch inference and several read-only decoding thresholds.

This is a secondary omission/reattack oracle for VideoReplica curation.  Its
events are never imported by the replica compiler and must be corroborated by
the source video/audio before becoming score facts.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np
from basic_pitch import inference as basic_pitch_inference
from basic_pitch import note_creation
from basic_pitch.constants import AUDIO_SAMPLE_RATE, FFT_HOP


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_AUDIO = ROOT / "tmp/jazz-five-four-analysis/reference.wav"
DEFAULT_OUTPUT = ROOT / "tmp/video-replica/take-five-basic-pitch-sweep"
VIDEO_TICK_ZERO_SECONDS = 1.547
TICKS_PER_SECOND = 1_600.0  # PPQ 480 at 200 BPM


CONFIGS: tuple[dict[str, Any], ...] = (
    {
        "id": "default",
        "onsetThreshold": 0.50,
        "frameThreshold": 0.30,
        "minimumNoteLengthMs": 127.7,
        "melodiaTrick": True,
    },
    {
        "id": "balanced",
        "onsetThreshold": 0.42,
        "frameThreshold": 0.25,
        "minimumNoteLengthMs": 80.0,
        "melodiaTrick": True,
    },
    {
        "id": "sensitive",
        "onsetThreshold": 0.35,
        "frameThreshold": 0.20,
        "minimumNoteLengthMs": 60.0,
        "melodiaTrick": True,
    },
    {
        "id": "balanced-no-melodia",
        "onsetThreshold": 0.42,
        "frameThreshold": 0.25,
        "minimumNoteLengthMs": 80.0,
        "melodiaTrick": False,
    },
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", type=Path, default=DEFAULT_AUDIO)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--source-start-seconds", type=float, default=1.30)
    parser.add_argument("--source-end-seconds", type=float, default=17.00)
    parser.add_argument("--manifest-name", default="opening-threshold-sweep.json")
    arguments = parser.parse_args()
    if arguments.source_end_seconds <= arguments.source_start_seconds:
        raise ValueError("source review window must have positive duration")
    arguments.out.mkdir(parents=True, exist_ok=True)

    model_path = Path(basic_pitch_inference.ICASSP_2022_MODEL_PATH)
    model_output = basic_pitch_inference.run_inference(arguments.audio, model_path)
    np.savez_compressed(arguments.out / "model-output.npz", **model_output)

    decoded: list[dict[str, Any]] = []
    for config in CONFIGS:
        minimum_frames = int(round(
            config["minimumNoteLengthMs"] / 1000.0 * AUDIO_SAMPLE_RATE / FFT_HOP
        ))
        _, note_events = note_creation.model_output_to_notes(
            model_output,
            onset_thresh=config["onsetThreshold"],
            frame_thresh=config["frameThreshold"],
            min_note_len=minimum_frames,
            min_freq=40.0,
            max_freq=2_500.0,
            multiple_pitch_bends=False,
            melodia_trick=config["melodiaTrick"],
            midi_tempo=200.0,
        )
        events = []
        for start, end, midi, amplitude, pitch_bends in note_events:
            if end < arguments.source_start_seconds or start > arguments.source_end_seconds:
                continue
            events.append({
                "sourceStartSeconds": float(start),
                "sourceEndSeconds": float(end),
                "performedStartTick": round((float(start) - VIDEO_TICK_ZERO_SECONDS) * TICKS_PER_SECOND),
                "performedDurationTicks": round((float(end) - float(start)) * TICKS_PER_SECOND),
                "midi": int(midi),
                "amplitude": float(amplitude),
                "pitchBends": None if pitch_bends is None else [int(value) for value in pitch_bends],
            })
        decoded.append({**config, "eventCountInReviewWindow": len(events), "events": events})

    manifest = {
        "schemaVersion": 1,
        "truthPolicy": "secondary detector only; video/audio corroboration required; never auto-import",
        "audio": {
            "path": str(arguments.audio.resolve()),
            "sha256": sha256(arguments.audio),
        },
        "model": {
            "package": "basic-pitch",
            "serializationPath": str(model_path),
        },
        "timeMapping": {
            "tickZeroAtVideoSeconds": VIDEO_TICK_ZERO_SECONDS,
            "ticksPerSecond": TICKS_PER_SECOND,
        },
        "sourceReviewWindowSeconds": {
            "start": arguments.source_start_seconds,
            "end": arguments.source_end_seconds,
        },
        "decodings": decoded,
    }
    destination = arguments.out / arguments.manifest_name
    destination.write_text(json.dumps(manifest, indent=2) + "\n")
    print(destination)


if __name__ == "__main__":
    main()
