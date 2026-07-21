#!/usr/bin/env python3
"""Build frame/hand-pose contact sheets for the remaining Take Five v5 queues.

This is a read-only review aid.  It never infers an exact key when the hand is
occluded and it has no path that writes to the replica score.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
VISUAL_ROOT = ROOT / "tmp/video-replica/take-five-full-curation-v5/full-audit/visual"
SCORE_PATH = ROOT / "tmp/video-replica/take-five-full-curation-v5/take-five-full-curation-v5.notes.json"
VIDEO_PATH = Path(
    "/Users/mynority/.codex/attachments/6b2f4909-d0f6-4864-b662-714760bec34d/"
    "微信视频2026-07-15_223754_429.mp4"
)
HAND_SCRIPT = ROOT / "scripts/audit-piano-hand-pose.swift"

TICK_ZERO = 1.547
TICKS_PER_SECOND = 1600.0
CROP_TOP = 530
CROP_BOTTOM = 735
FRAME_RE = re.compile(r"_abs_(\d+\.\d+)\.png$")


# The full keyboard is visible.  C# locations were recovered from the static
# black-key pattern across many frames.  Adjacent octaves are mildly affected
# by phone-camera perspective, so interpolation is octave-local.
CSHARP_X = {25: -108.0, 37: 45.0, 49: 196.0, 61: 341.0, 73: 488.0, 85: 638.0}
WHITE_INDEX = {0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6}
BLACK_POSITION = {1: 0.72, 3: 1.72, 6: 3.72, 8: 4.72, 10: 5.72}


TARGETS = (
    {"id": "opening-overlap-2101", "dir": "opening_overlap_2101", "tick": 2101, "expectedMidis": [47], "kind": "same-key-lifecycle-reattack"},
    {"id": "timing-missing-2324", "dir": "opening_overlap_2101", "tick": 2324, "expectedMidis": [], "kind": "possible-missing-attack"},
    {"id": "bass028", "dir": "bass028", "tick": 7214, "expectedMidis": [59], "kind": "weak-score"},
    {"id": "opening-extra-8848", "dir": "opening_extra_8848", "tick": 8848, "expectedMidis": [47, 50], "kind": "same-key-lifecycle-plus-extra-review"},
    {"id": "opening-repeat-12760", "dir": "opening_repeat_12760", "tick": 12760, "expectedMidis": [54], "kind": "possible-missing-attack"},
    {"id": "opening-repeat-12836", "dir": "opening_repeat_12760", "tick": 12836, "expectedMidis": [54], "kind": "possible-missing-attack"},
    {"id": "opening-repeat-12904", "dir": "opening_repeat_12760", "tick": 12904, "expectedMidis": [54], "kind": "possible-missing-attack"},
    {"id": "opening-overlap-13104", "dir": "opening_repeat_12760", "tick": 13104, "expectedMidis": [54], "kind": "same-key-lifecycle-reattack"},
    {"id": "opening-overlap-15614", "dir": "opening_overlap_15614", "tick": 15614, "expectedMidis": [54], "kind": "same-key-lifecycle-reattack"},
    {"id": "opening-overlap-19424", "dir": "opening_overlap_19424_19591", "tick": 19424, "expectedMidis": [40], "kind": "same-key-lifecycle-reattack"},
    {"id": "opening-overlap-19591", "dir": "opening_overlap_19424_19591", "tick": 19591, "expectedMidis": [70], "kind": "same-key-lifecycle-reattack"},
    {"id": "comp-entry-24722", "dir": "comp_entry", "tick": 24722, "expectedMidis": [54], "kind": "structural-entry"},
    {"id": "comp-entry-25670", "dir": "comp_entry", "tick": 25670, "expectedMidis": [50, 62], "kind": "timing-review"},
    {"id": "comp-entry-26136", "dir": "comp_entry", "tick": 26136, "expectedMidis": [62], "kind": "timing-review"},
    {"id": "comp-entry-26842", "dir": "comp_entry", "tick": 26842, "expectedMidis": [62], "kind": "waveform-supported-timing"},
    {"id": "comp-focus-36118", "dir": "comp_focus", "tick": 36118, "expectedMidis": [34, 46, 53, 56, 64], "kind": "waveform-supported-timing"},
    {"id": "comp-focus-37622", "dir": "comp_focus", "tick": 37622, "expectedMidis": [41], "kind": "waveform-supported-timing"},
    {"id": "d3-omission-59682", "dir": "d3_59682", "tick": 59682, "expectedMidis": [50], "kind": "consensus-omission"},
    {"id": "fsharp-omission-60536", "dir": "fsharp_60536_lead147", "tick": 60536, "expectedMidis": [66], "kind": "consensus-omission"},
    {"id": "timing-missing-60772", "dir": "timing_missing_60772", "tick": 60772, "expectedMidis": [], "kind": "possible-missing-attack"},
    {"id": "lead147", "dir": "fsharp_60536_lead147", "tick": 61080, "expectedMidis": [66], "kind": "weak-score-reattack"},
    {"id": "extra-74130", "dir": "extra_74130", "tick": 74130, "expectedMidis": [41], "kind": "possible-extra-score-strike"},
    {"id": "timing-missing-78224", "dir": "timing_missing_78224", "tick": 78224, "expectedMidis": [], "kind": "possible-missing-attack"},
    {"id": "tail-missing-80730", "dir": "tail_missing", "tick": 80730, "expectedMidis": [], "kind": "possible-missing-attack"},
    {"id": "tail-missing-81530", "dir": "tail_missing", "tick": 81530, "expectedMidis": [], "kind": "possible-missing-attack"},
    {"id": "tail-release-82662", "dir": "tail_missing", "tick": 82662, "expectedMidis": [], "kind": "possible-missing-attack-or-release"},
    {"id": "tail-release-82714", "dir": "tail_missing", "tick": 82714, "expectedMidis": [], "kind": "possible-missing-attack-or-release"},
)

MOTION_WINDOWS = (
    {
        "id": "d3-59682-motion",
        "dir": "d3_59682",
        "startVideoSeconds": 38.70,
        "endVideoSeconds": 38.96,
        "expectedMidis": [50],
        "markers": [{"tick": 59682, "label": "D3 omission"}, {"tick": 59798, "label": "upper chord"}],
    },
    {
        "id": "fsharp-60536-61212-motion",
        "dir": "fsharp_60536_lead147",
        "startVideoSeconds": 39.25,
        "endVideoSeconds": 39.85,
        "expectedMidis": [66],
        "markers": [
            {"tick": 60536, "label": "omission cluster"},
            {"tick": 61080, "label": "lead-147"},
            {"tick": 61212, "label": "lead-148"},
        ],
    },
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def midi_name(midi: int) -> str:
    names = ("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
    return f"{names[midi % 12]}{midi // 12 - 1}"


def midi_x(midi: int) -> float:
    octave_c = (midi // 12) * 12
    csharp = octave_c + 1
    if csharp not in CSHARP_X or csharp + 12 not in CSHARP_X:
        raise ValueError(f"MIDI {midi} is outside calibrated visible keyboard")
    width = (CSHARP_X[csharp + 12] - CSHARP_X[csharp]) / 7.0
    boundary = CSHARP_X[csharp] - 0.72 * width
    pitch_class = midi % 12
    if pitch_class in WHITE_INDEX:
        return boundary + (WHITE_INDEX[pitch_class] + 0.5) * width
    return boundary + BLACK_POSITION[pitch_class] * width


def frame_seconds(path: Path) -> float:
    match = FRAME_RE.search(path.name)
    if not match:
        raise ValueError(f"cannot parse frame time: {path}")
    return float(match.group(1))


def unique_frames(directory: Path) -> list[Path]:
    by_time: dict[float, Path] = {}
    for path in sorted(directory.glob("frame*.png")):
        by_time.setdefault(frame_seconds(path), path)
    return [by_time[key] for key in sorted(by_time)]


def select_frames(paths: list[Path], target: float) -> list[Path]:
    offsets = (-0.084, -0.042, 0.0, 0.042, 0.084)
    selected: list[Path] = []
    for offset in offsets:
        candidate = min(paths, key=lambda path: abs(frame_seconds(path) - (target + offset)))
        if candidate not in selected:
            selected.append(candidate)
    return sorted(selected, key=frame_seconds)


def run_vision(paths: list[Path], skip: bool) -> list[dict[str, Any]]:
    if skip:
        return []
    result = subprocess.run(
        ["swift", str(HAND_SCRIPT), *(str(path) for path in paths)],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def draw_sheet(
    target: dict[str, Any],
    paths: list[Path],
    poses: dict[str, dict[str, Any]],
    nearby_notes: list[dict[str, Any]],
) -> Path:
    tile_width = 592
    crop_height = CROP_BOTTOM - CROP_TOP
    label_height = 64
    columns = 3
    rows = 2
    sheet = Image.new("RGB", (tile_width * columns, (crop_height + label_height) * rows), "#111111")
    draw = ImageDraw.Draw(sheet)
    target_seconds = TICK_ZERO + int(target["tick"]) / TICKS_PER_SECOND
    expected = set(int(value) for value in target["expectedMidis"])
    attack_midis = {int(note["midi"]) for note in nearby_notes if abs(int(note["performedStartTick"]) - int(target["tick"])) <= 40}

    for index, path in enumerate(paths):
        frame = Image.open(path).convert("RGB")
        crop = frame.crop((0, CROP_TOP, tile_width, CROP_BOTTOM))
        x0 = (index % columns) * tile_width
        y0 = (index // columns) * (crop_height + label_height)
        sheet.paste(crop, (x0, y0 + label_height))
        seconds = frame_seconds(path)
        draw.text(
            (x0 + 5, y0 + 4),
            f'{target["id"]}  video={seconds:.3f}s  delta={(seconds - target_seconds) * 1000:+.1f}ms',
            fill="white",
        )
        draw.text(
            (x0 + 5, y0 + 24),
            f'tick={target["tick"]}  kind={target["kind"]}',
            fill="#d0d0d0",
        )
        note_label = " ".join(
            f'{note["eventId"]}:{midi_name(int(note["midi"]))}@{int(note["performedStartTick"])-int(target["tick"]):+d}'
            for note in nearby_notes[:5]
        ) or "no score onset within +/-120 ticks"
        draw.text((x0 + 5, y0 + 44), note_label, fill="#a8e6cf")

        marker_midis = sorted(expected | attack_midis)
        for midi in marker_midis:
            key_x = midi_x(midi)
            color = "#ffb000" if midi in expected else "#20e3b2"
            draw.line(
                (x0 + key_x, y0 + label_height + 34, x0 + key_x, y0 + label_height + crop_height - 3),
                fill=color,
                width=2,
            )
            draw.text((x0 + key_x + 2, y0 + label_height + 38), midi_name(midi), fill=color)

        pose = poses.get(str(path)) or poses.get(str(path.resolve()))
        if pose:
            for hand in pose.get("hands", []):
                hand_color = "#47a7ff" if hand.get("chirality") == "left" else "#ff4fd8"
                for point in hand.get("points", []):
                    if not point["name"].endswith("Tip"):
                        continue
                    px = x0 + float(point["x"])
                    py = y0 + label_height + float(point["y"]) - CROP_TOP
                    if y0 + label_height <= py < y0 + label_height + crop_height:
                        draw.ellipse((px - 4, py - 4, px + 4, py + 4), outline=hand_color, width=2)
                        draw.text((px + 5, py - 8), point["name"][0], fill=hand_color)

    path = VISUAL_ROOT / f'{target["id"]}.contact.png'
    sheet.save(path)
    return path


def draw_motion_sheet(
    window: dict[str, Any],
    paths: list[Path],
    poses: dict[str, dict[str, Any]],
) -> Path:
    tile_width = 592
    crop_height = CROP_BOTTOM - CROP_TOP
    label_height = 50
    columns = 4
    rows = (len(paths) + columns - 1) // columns
    sheet = Image.new("RGB", (tile_width * columns, (crop_height + label_height) * rows), "#111111")
    draw = ImageDraw.Draw(sheet)
    markers = [
        {
            **marker,
            "videoSeconds": TICK_ZERO + int(marker["tick"]) / TICKS_PER_SECOND,
        }
        for marker in window["markers"]
    ]
    for index, path in enumerate(paths):
        frame = Image.open(path).convert("RGB")
        crop = frame.crop((0, CROP_TOP, tile_width, CROP_BOTTOM))
        x0 = (index % columns) * tile_width
        y0 = (index // columns) * (crop_height + label_height)
        sheet.paste(crop, (x0, y0 + label_height))
        seconds = frame_seconds(path)
        nearest = min(markers, key=lambda marker: abs(seconds - marker["videoSeconds"]))
        draw.text(
            (x0 + 5, y0 + 4),
            f'{window["id"]} video={seconds:.3f}s',
            fill="white",
        )
        draw.text(
            (x0 + 5, y0 + 24),
            f'nearest={nearest["label"]} delta={(seconds-nearest["videoSeconds"])*1000:+.1f}ms',
            fill="#d0d0d0",
        )
        for midi in window["expectedMidis"]:
            key_x = midi_x(int(midi))
            draw.line(
                (x0 + key_x, y0 + label_height + 34, x0 + key_x, y0 + label_height + crop_height - 3),
                fill="#ffb000",
                width=2,
            )
            draw.text((x0 + key_x + 2, y0 + label_height + 38), midi_name(int(midi)), fill="#ffb000")
        pose = poses.get(str(path)) or poses.get(str(path.resolve()))
        if pose:
            for hand in pose.get("hands", []):
                hand_color = "#47a7ff" if hand.get("chirality") == "left" else "#ff4fd8"
                for point in hand.get("points", []):
                    if not point["name"].endswith("Tip"):
                        continue
                    px = x0 + float(point["x"])
                    py = y0 + label_height + float(point["y"]) - CROP_TOP
                    if y0 + label_height <= py < y0 + label_height + crop_height:
                        draw.ellipse((px - 4, py - 4, px + 4, py + 4), outline=hand_color, width=2)
                        draw.text((px + 5, py - 8), point["name"][0], fill=hand_color)
    path = VISUAL_ROOT / f'{window["id"]}.png'
    sheet.save(path)
    return path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-vision", action="store_true")
    args = parser.parse_args()

    score = json.loads(SCORE_PATH.read_text())
    notes = [note for track in score["tracks"].values() for note in track["notes"]]
    selected_by_target: dict[str, list[Path]] = {}
    selected_by_motion: dict[str, list[Path]] = {}
    all_paths: list[Path] = []
    for target in TARGETS:
        directory = VISUAL_ROOT / str(target["dir"])
        frames = unique_frames(directory)
        if not frames:
            raise ValueError(f"no frames for {target['id']}: {directory}")
        target_seconds = TICK_ZERO + int(target["tick"]) / TICKS_PER_SECOND
        selected = select_frames(frames, target_seconds)
        selected_by_target[str(target["id"])] = selected
        for path in selected:
            if path not in all_paths:
                all_paths.append(path)

    for window in MOTION_WINDOWS:
        frames = unique_frames(VISUAL_ROOT / str(window["dir"]))
        selected = [
            path for path in frames
            if float(window["startVideoSeconds"]) <= frame_seconds(path) <= float(window["endVideoSeconds"])
        ]
        if not selected:
            raise ValueError(f"no motion frames for {window['id']}")
        selected_by_motion[str(window["id"])] = selected
        for path in selected:
            if path not in all_paths:
                all_paths.append(path)

    pose_rows = run_vision(all_paths, args.skip_vision)
    pose_lookup = {str(row["path"]): row for row in pose_rows}
    evidence_rows: list[dict[str, Any]] = []
    for target in TARGETS:
        tick = int(target["tick"])
        nearby = sorted(
            [note for note in notes if abs(int(note["performedStartTick"]) - tick) <= 120],
            key=lambda note: (int(note["performedStartTick"]), int(note["midi"])),
        )
        selected = selected_by_target[str(target["id"])]
        sheet_path = draw_sheet(target, selected, pose_lookup, nearby)
        evidence_rows.append({
            **target,
            "videoSeconds": TICK_ZERO + tick / TICKS_PER_SECOND,
            "nearbyScoreEvents": [
                {
                    "eventId": note["eventId"],
                    "role": note["role"],
                    "startTick": note["performedStartTick"],
                    "midi": note["midi"],
                    "durationTicks": note["performedDurationTicks"],
                }
                for note in nearby
            ],
            "frames": [
                {
                    "path": str(path.relative_to(ROOT)),
                    "videoSeconds": frame_seconds(path),
                    "sha256": sha256(path),
                    "handPose": pose_lookup.get(str(path)),
                }
                for path in selected
            ],
            "contactSheet": str(sheet_path.relative_to(ROOT)),
            "visualDisposition": "unreviewed; exact pitch must not be inferred from this payload alone",
        })

    motion_rows = []
    for window in MOTION_WINDOWS:
        selected = selected_by_motion[str(window["id"])]
        path = draw_motion_sheet(window, selected, pose_lookup)
        motion_rows.append({
            **window,
            "frames": [str(frame.relative_to(ROOT)) for frame in selected],
            "contactSheet": str(path.relative_to(ROOT)),
            "visualDisposition": "unreviewed motion sequence",
        })

    output = {
        "schemaVersion": 1,
        "status": "read-only visual review aid; no score/engine mutation",
        "video": {"path": str(VIDEO_PATH), "sha256": sha256(VIDEO_PATH)},
        "score": {"path": str(SCORE_PATH.relative_to(ROOT)), "sha256": sha256(SCORE_PATH)},
        "timeMapping": {"tickZeroVideoSeconds": TICK_ZERO, "ticksPerSecond": TICKS_PER_SECOND},
        "keyboardCalibration": {
            "method": "black-key pattern recovered across multiple unobstructed rows; octave-local interpolation",
            "cSharpPixelX": CSHARP_X,
            "caveat": "phone perspective and hand occlusion make this a review overlay, not an automatic key classifier",
        },
        "targets": evidence_rows,
        "motionWindows": motion_rows,
    }
    payload_path = VISUAL_ROOT / "visual-candidate-evidence.json"
    payload_path.write_text(json.dumps(output, indent=2) + "\n")
    readme = (
        "# Take Five v5 · visual candidate evidence\n\n"
        "Read-only frame/hand-pose contact sheets for the strongest cross-modal review points. "
        "Orange lines are the candidate keys; green lines are score attacks within 40 ticks. "
        "Blue/pink circles are Vision fingertip estimates. Occluded or blurred frames remain unresolved.\n\n"
        f"- targets: `{len(evidence_rows)}`\n"
        f"- unique frames: `{len(all_paths)}`\n"
        f"- source video SHA-256: `{sha256(VIDEO_PATH)}`\n\n"
        + "\n".join(
            f'- `{row["id"]}`: `{row["contactSheet"]}`' for row in evidence_rows
        )
        + "\n\nMotion windows:\n\n"
        + "\n".join(f'- `{row["id"]}`: `{row["contactSheet"]}`' for row in motion_rows)
        + "\n"
    )
    (VISUAL_ROOT / "README.md").write_text(readme)
    print(json.dumps({"targets": len(evidence_rows), "frames": len(all_paths), "output": str(payload_path.relative_to(ROOT))}, indent=2))


if __name__ == "__main__":
    main()
