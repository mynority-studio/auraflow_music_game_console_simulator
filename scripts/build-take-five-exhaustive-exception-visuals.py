#!/usr/bin/env python3
"""Render every unresolved Take Five v5 exception as source-video frame rows.

The full pitch/timing audits already contain one machine-auditable row for all
534 score notes and all 335 retained physical strikes.  This script is the
second-stage exception review: it gathers every weak score note, every
consensus omission candidate, every missing/extra attack candidate, every
timing-review strike and every outstanding same-key lifecycle collision into
one deterministic visual queue.  It is read-only with respect to the score.

Video frames are only a physical-key review aid.  At the source frame rate they
cannot authorize millisecond onset changes; source-audio evidence remains the
authority for sub-frame timing.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import subprocess
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
VIDEO = Path(
    "/Users/mynority/.codex/attachments/6b2f4909-d0f6-4864-b662-714760bec34d/"
    "微信视频2026-07-15_223754_429.mp4"
)
SCORE = ROOT / "tmp/video-replica/take-five-full-curation-v5/take-five-full-curation-v5.notes.json"
PITCH = ROOT / "tmp/video-replica/take-five-full-curation-v5/full-audit/pitch/full-pitch-audit.json"
TIMING = ROOT / "tmp/video-replica/take-five-full-curation-v5/full-audit/timing/full-timing-audit.json"
DEFAULT_OUT = ROOT / "tmp/video-replica/take-five-full-curation-v5/full-audit/visual-exhaustive"
DEFAULT_EXTRACTOR = ROOT / "tmp/video-replica-audit/extract_frames"

TICK_ZERO_VIDEO_SECONDS = 1.547
TICKS_PER_SECOND = 1600.0
FRAME_STEP_SECONDS = 1.0 / 24.0
FRAME_RADIUS_SECONDS = 0.105
CROP_TOP = 530
CROP_BOTTOM = 735
SOURCE_TILE_WIDTH = 592
LABEL_HEIGHT = 74

# Same keyboard calibration used by the focused visual audit.  It is a review
# overlay, not an automatic key classifier.
CSHARP_X = {25: -108.0, 37: 45.0, 49: 196.0, 61: 341.0, 73: 488.0, 85: 638.0}
WHITE_INDEX = {0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6}
BLACK_POSITION = {1: 0.72, 3: 1.72, 6: 3.72, 8: 4.72, 10: 5.72}
NOTE_NAMES = ("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def midi_name(midi: int) -> str:
    return f"{NOTE_NAMES[midi % 12]}{midi // 12 - 1}"


def midi_x(midi: int) -> float | None:
    octave_c = (midi // 12) * 12
    csharp = octave_c + 1
    if csharp not in CSHARP_X or csharp + 12 not in CSHARP_X:
        return None
    width = (CSHARP_X[csharp + 12] - CSHARP_X[csharp]) / 7.0
    boundary = CSHARP_X[csharp] - 0.72 * width
    pitch_class = midi % 12
    if pitch_class in WHITE_INDEX:
        return boundary + (WHITE_INDEX[pitch_class] + 0.5) * width
    return boundary + BLACK_POSITION[pitch_class] * width


def frame_seconds(path: Path) -> float:
    return float(path.stem.rsplit("_abs_", 1)[1])


def sorted_unique_frames(directory: Path) -> list[Path]:
    by_seconds: dict[float, Path] = {}
    for path in sorted(directory.glob("frame_*.png")):
        by_seconds.setdefault(frame_seconds(path), path)
    return [by_seconds[key] for key in sorted(by_seconds)]


def nearest_frames(paths: list[Path], target_seconds: float) -> list[Path]:
    desired_offsets = (-0.084, -0.042, 0.0, 0.042, 0.084)
    selected: list[Path] = []
    for offset in desired_offsets:
        path = min(paths, key=lambda candidate: abs(frame_seconds(candidate) - target_seconds - offset))
        if path not in selected:
            selected.append(path)
    return sorted(selected, key=frame_seconds)


def note_tuple(note: dict[str, Any]) -> tuple[int, int, str]:
    return int(note["performedStartTick"]), int(note["midi"]), str(note["eventId"])


def build_targets(
    pitch: dict[str, Any],
    timing: dict[str, Any],
    notes: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    by_tick: dict[int, dict[str, Any]] = {}

    def add(
        tick: int,
        category: str,
        source_id: str,
        expected_midis: Iterable[int] = (),
        detail: dict[str, Any] | None = None,
    ) -> None:
        target = by_tick.setdefault(tick, {
            "tick": tick,
            "categories": [],
            "sourceIds": [],
            "expectedMidis": [],
            "details": [],
        })
        if category not in target["categories"]:
            target["categories"].append(category)
        if source_id not in target["sourceIds"]:
            target["sourceIds"].append(source_id)
        target["expectedMidis"] = sorted(set(target["expectedMidis"]) | {int(midi) for midi in expected_midis})
        if detail is not None:
            target["details"].append({"category": category, "sourceId": source_id, **detail})

    for row in pitch["falsePositiveReview"]:
        add(
            int(row["startTick"]),
            "weak-score-event",
            str(row["eventId"]),
            [int(row["midi"])],
            {
                "noteName": row["noteName"],
                "detectorConfigCount": row["detectorConfigCount"],
                "reviewClass": row["reviewClass"],
            },
        )

    for row in pitch["omissionReview"]:
        if row["classification"] != "consensus-omission-review":
            continue
        add(
            int(row["startTickMedian"]),
            "consensus-omission-candidate",
            str(row["clusterId"]),
            [int(row["midi"])],
            {
                "noteName": row["noteName"],
                "durationTicksMedian": row["durationTicksMedian"],
                "amplitudeMedian": row["amplitudeMedian"],
                "detectorConfigCount": row["configCount"],
                "spectrumPercentile": row["sourceSpectrum"]["calibrationPercentile"],
                "partialRisk": row["partialRisk"]["reason"],
            },
        )

    for row in timing["missingAttackCandidates"]:
        add(int(row["anchorTick"]), "possible-missing-attack", str(row["id"]), detail={
            "confidence": row["confidence"], "reason": row["reason"],
        })
    for row in timing["extraAttackCandidates"]:
        tick = int(row["anchorTick"])
        same_tick_midis = [int(note["midi"]) for note in notes if abs(int(note["performedStartTick"]) - tick) <= 32]
        add(tick, "possible-extra-score-attack", str(row["id"]), same_tick_midis, {
            "confidence": row["confidence"], "reason": row["reason"],
        })

    for key, category in (
        ("waveformSupportedTimingCandidates", "waveform-supported-timing-review"),
        ("timingReviewCandidates", "additional-timing-review"),
    ):
        for row in timing[key]:
            add(
                int(row["anchorTick"]),
                category,
                str(row["groupId"]),
                [int(midi) for midi in row["midis"]],
                {
                    "confidence": row["confidence"],
                    "detrendedResidualMilliseconds": round(float(row["detrendedLocalResidualSeconds"]) * 1000.0, 3),
                    "suggestedTickDeltaForReviewOnly": row["suggestedTickDeltaForReviewOnly"],
                },
            )

    for row in timing["currentRemainingSameKeyLifecycleCollisions"]:
        add(
            int(row["successorOnsetTick"]),
            "same-key-lifecycle-collision",
            f'{row["predecessorEventId"]}->{row["successorEventId"]}',
            [int(row["midi"])],
            {
                "previousOffTick": row["predecessorEndTick"],
                "overlapTicks": row["overlapTicks"],
                "role": row["role"],
            },
        )

    output = []
    for tick, target in sorted(by_tick.items()):
        target["categories"].sort()
        target["sourceIds"].sort()
        target["videoSeconds"] = TICK_ZERO_VIDEO_SECONDS + tick / TICKS_PER_SECOND
        target["barNumber"] = tick // 2400 + 1
        target["tickInBar"] = tick % 2400
        target["nearbyScoreEvents"] = [
            {
                "eventId": note["eventId"],
                "role": note["role"],
                "startTick": note["performedStartTick"],
                "deltaTicks": int(note["performedStartTick"]) - tick,
                "midi": note["midi"],
                "noteName": midi_name(int(note["midi"])),
                "durationTicks": note["performedDurationTicks"],
            }
            for note in sorted(notes, key=note_tuple)
            if abs(int(note["performedStartTick"]) - tick) <= 120
        ]
        target["visualDisposition"] = {
            "status": "unreviewed",
            "decision": None,
            "reason": "frame row is evidence for manual review; exact sub-frame timing must come from source audio",
        }
        output.append(target)
    return output


def extract_target_frames(extractor: Path, target: dict[str, Any], frames_root: Path, force: bool) -> list[Path]:
    directory = frames_root / f'tick-{int(target["tick"]):05d}'
    if force and directory.exists():
        shutil.rmtree(directory)
    directory.mkdir(parents=True, exist_ok=True)
    if not list(directory.glob("frame_*.png")):
        center = float(target["videoSeconds"])
        subprocess.run(
            [
                str(extractor), str(VIDEO), str(directory),
                f"{max(0.0, center - FRAME_RADIUS_SECONDS):.6f}",
                f"{center + FRAME_RADIUS_SECONDS:.6f}",
                f"{FRAME_STEP_SECONDS:.9f}",
            ],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
    frames = sorted_unique_frames(directory)
    if not frames:
        raise RuntimeError(f"frame extractor produced no frames for tick {target['tick']}")
    return nearest_frames(frames, float(target["videoSeconds"]))


def draw_target_row(target: dict[str, Any], frames: list[Path], output_path: Path) -> None:
    crop_height = CROP_BOTTOM - CROP_TOP
    width = SOURCE_TILE_WIDTH * len(frames)
    height = LABEL_HEIGHT + crop_height
    row = Image.new("RGB", (width, height), "#101010")
    draw = ImageDraw.Draw(row)
    expected = {int(midi) for midi in target["expectedMidis"]}
    nearby = target["nearbyScoreEvents"]
    score_attack_midis = {
        int(note["midi"]) for note in nearby if abs(int(note["deltaTicks"])) <= 40
    }
    categories = ",".join(target["categories"])
    source_ids = ",".join(target["sourceIds"])
    expected_label = " ".join(midi_name(midi) for midi in sorted(expected)) or "no pitch hypothesis"

    for index, frame_path in enumerate(frames):
        frame = Image.open(frame_path).convert("RGB")
        crop = frame.crop((0, CROP_TOP, SOURCE_TILE_WIDTH, CROP_BOTTOM))
        x0 = index * SOURCE_TILE_WIDTH
        row.paste(crop, (x0, LABEL_HEIGHT))
        delta_ms = (frame_seconds(frame_path) - float(target["videoSeconds"])) * 1000.0
        draw.text((x0 + 5, 3), f'tick={target["tick"]} bar={target["barNumber"]} frameDelta={delta_ms:+.1f}ms', fill="white")
        draw.text((x0 + 5, 22), categories[:92], fill="#ffd166")
        draw.text((x0 + 5, 41), f"keys={expected_label} ids={source_ids}"[:100], fill="#b8e0d2")
        nearby_label = " ".join(
            f'{note["eventId"]}:{note["noteName"]}@{int(note["deltaTicks"]):+d}' for note in nearby[:5]
        ) or "no score onset +/-120 ticks"
        draw.text((x0 + 5, 58), nearby_label[:100], fill="#a8dadc")

        for midi in sorted(expected | score_attack_midis):
            key_x = midi_x(midi)
            if key_x is None:
                continue
            color = "#ffb000" if midi in expected else "#20e3b2"
            draw.line((x0 + key_x, LABEL_HEIGHT + 32, x0 + key_x, height - 3), fill=color, width=2)
            draw.text((x0 + key_x + 2, LABEL_HEIGHT + 35), midi_name(midi), fill=color)
    row.save(output_path)


def build_pages(targets: list[dict[str, Any]], rows_root: Path, pages_root: Path) -> list[dict[str, Any]]:
    page_size = 8
    page_rows = []
    for page_index in range(math.ceil(len(targets) / page_size)):
        page_targets = targets[page_index * page_size:(page_index + 1) * page_size]
        images = [Image.open(rows_root / f'tick-{int(target["tick"]):05d}.png').convert("RGB") for target in page_targets]
        width = max(image.width for image in images)
        height = sum(image.height for image in images)
        page = Image.new("RGB", (width, height), "#101010")
        y = 0
        for image in images:
            page.paste(image, (0, y))
            y += image.height
        path = pages_root / f'page-{page_index + 1:02d}.png'
        page.save(path)
        page_rows.append({
            "page": page_index + 1,
            "path": str(path.relative_to(ROOT)),
            "ticks": [int(target["tick"]) for target in page_targets],
            "sha256": sha256(path),
        })
    return page_rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--extractor", type=Path, default=DEFAULT_EXTRACTOR)
    parser.add_argument("--force-extract", action="store_true")
    args = parser.parse_args()

    score = json.loads(SCORE.read_text())
    pitch = json.loads(PITCH.read_text())
    timing = json.loads(TIMING.read_text())
    notes = [note for track in score["tracks"].values() for note in track["notes"]]
    targets = build_targets(pitch, timing, notes)

    out = args.out.resolve()
    frames_root = out / "frames"
    rows_root = out / "rows"
    pages_root = out / "pages"
    for directory in (frames_root, rows_root, pages_root):
        directory.mkdir(parents=True, exist_ok=True)

    category_counts: dict[str, int] = defaultdict(int)
    for target in targets:
        for category in target["categories"]:
            category_counts[category] += 1
        frames = extract_target_frames(args.extractor.resolve(), target, frames_root, args.force_extract)
        target["frames"] = [
            {
                "path": str(path.relative_to(ROOT)),
                "videoSeconds": frame_seconds(path),
                "sha256": sha256(path),
            }
            for path in frames
        ]
        row_path = rows_root / f'tick-{int(target["tick"]):05d}.png'
        draw_target_row(target, frames, row_path)
        target["contactRow"] = str(row_path.relative_to(ROOT))
        target["contactRowSha256"] = sha256(row_path)

    pages = build_pages(targets, rows_root, pages_root)
    payload = {
        "schemaVersion": 1,
        "status": "read-only exhaustive exception review; no score/engine mutation",
        "truthPolicy": {
            "scoreAndStrikeCoverage": "full pitch/timing audits are authoritative for all score events and retained strikes",
            "visualScope": "all exception queues, not just selected highlights",
            "subFrameTiming": "video frames cannot authorize millisecond tick movement; source audio is required",
        },
        "inputs": {
            "video": {"path": str(VIDEO), "sha256": sha256(VIDEO)},
            "score": {"path": str(SCORE.relative_to(ROOT)), "sha256": sha256(SCORE)},
            "pitchAudit": {"path": str(PITCH.relative_to(ROOT)), "sha256": sha256(PITCH)},
            "timingAudit": {"path": str(TIMING.relative_to(ROOT)), "sha256": sha256(TIMING)},
        },
        "timeMapping": {
            "tickZeroVideoSeconds": TICK_ZERO_VIDEO_SECONDS,
            "ticksPerSecond": TICKS_PER_SECOND,
            "videoFrameStepSeconds": FRAME_STEP_SECONDS,
        },
        "counts": {
            "uniqueTargetTicks": len(targets),
            "categoryTargetCounts": dict(sorted(category_counts.items())),
            "pages": len(pages),
        },
        "targets": targets,
        "pages": pages,
    }
    payload_path = out / "exhaustive-exception-visuals.json"
    payload_path.write_text(json.dumps(payload, indent=2) + "\n")
    readme = (
        "# Take Five v5 · exhaustive exception visuals\n\n"
        "Every unresolved exception emitted by the full pitch and timing audits is present here. "
        "Orange lines are candidate keys and green lines are nearby score attacks. Frames are a "
        "physical-action review aid; they do not have enough temporal resolution to move a performed tick.\n\n"
        f"- unique target ticks: `{len(targets)}`\n"
        f"- category counts: `{json.dumps(dict(sorted(category_counts.items())), sort_keys=True)}`\n"
        f"- source video SHA-256: `{sha256(VIDEO)}`\n\n"
        "Pages:\n\n"
        + "\n".join(f'- page {row["page"]}: `{row["path"]}` ticks `{row["ticks"]}`' for row in pages)
        + "\n"
    )
    (out / "README.md").write_text(readme)
    print(json.dumps({"targets": len(targets), "pages": len(pages), "output": str(payload_path.relative_to(ROOT))}, indent=2))


if __name__ == "__main__":
    main()
