#!/usr/bin/env python3
"""Verify v6 against the exhaustive video verdict and export every note on the 5/4 clock.

This is a read-only integration gate.  It joins the immutable v5 verdict, the
implemented v6 score, the fresh full-pitch/full-timing audits, and the locked
render/A-B provenance.  It never edits the score or promotes the candidate.
"""

from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
V5_ROOT = ROOT / "tmp/video-replica/take-five-full-curation-v5"
V6_ROOT = ROOT / "tmp/video-replica/take-five-full-curation-v6"
V5_NOTES = V5_ROOT / "take-five-full-curation-v5.notes.json"
V6_NOTES = V6_ROOT / "take-five-full-curation-v6.notes.json"
V5_VERDICT = V5_ROOT / "full-audit/verdict/full-audit-verdict.json"
V5_TIMING = V5_ROOT / "full-audit/timing/full-timing-audit.json"
V6_PITCH = V6_ROOT / "full-audit/pitch/full-pitch-audit.json"
V6_TIMING = V6_ROOT / "full-audit/timing/full-timing-audit.json"
V6_PROVENANCE = V6_ROOT / "take-five-full-curation-v6.render-provenance.json"
V6_AB = V6_ROOT / "ab/take-five-v6-AB-manifest.json"
OUTPUT = V6_ROOT / "full-audit/final-verification"

PERFORMED_FIELDS = ("role", "performedStartTick", "performedDurationTicks", "midi", "velocity")
# These were newly promoted into a timing queue only because v6 changed the
# rendered local context.  Every tick has a second-pass visual/audio verdict;
# none authorizes moving the performed onset.
V6_NEW_QUEUE_REVIEWED_TICKS = {8_848, 59_682, 63_994, 67_606, 75_356, 76_318}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def relative(path: Path) -> str:
    return str(path.resolve().relative_to(ROOT))


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def flatten_notes(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    notes = [note for track in manifest["tracks"].values() for note in track["notes"]]
    return sorted(notes, key=lambda note: (
        int(note["performedStartTick"]),
        {"bass": 0, "comp": 1, "lead": 2}[str(note["role"])],
        int(note["midi"]),
        str(note["eventId"]),
    ))


def note_name(midi: int) -> str:
    names = ("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
    return f"{names[midi % 12]}{midi // 12 - 1}"


def timing_group_id(note: dict[str, Any]) -> str:
    if note.get("origin") == "curated-observation":
        return str(note.get("relatedStrikeGroupId") or f'observation-strike-{note["eventId"]}')
    return str(note["strikeGroupId"])


def queue_identity(row: dict[str, Any]) -> tuple[str, int]:
    return str(row.get("groupId") or row.get("id")), int(row["anchorTick"])


def build() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    v5_manifest = load(V5_NOTES)
    v6_manifest = load(V6_NOTES)
    verdict = load(V5_VERDICT)
    v5_timing = load(V5_TIMING)
    pitch = load(V6_PITCH)
    timing = load(V6_TIMING)
    provenance = load(V6_PROVENANCE)
    ab = load(V6_AB)

    v5_notes = flatten_notes(v5_manifest)
    v6_notes = flatten_notes(v6_manifest)
    v5_by_id = {str(note["eventId"]): note for note in v5_notes}
    v6_by_id = {str(note["eventId"]): note for note in v6_notes}
    if len(v5_by_id) != 534 or len(v6_by_id) != 550:
        raise AssertionError("unexpected v5/v6 unique note counts")

    expected_additions = {
        str(note["observationId"]): note for note in verdict["proposedDelta"]["additions"]
    }
    expected_removals = {
        str(note["eventId"]) for note in verdict["proposedDelta"]["removals"]
    }
    actual_additions = set(v6_by_id) - set(v5_by_id)
    actual_removals = set(v5_by_id) - set(v6_by_id)
    if actual_additions != set(expected_additions) or actual_removals != expected_removals:
        raise AssertionError("v6 additions/removals diverge from the exhaustive visual verdict")

    for event_id, expected in expected_additions.items():
        actual = v6_by_id[event_id]
        expected_fields = {
            "role": expected["role"],
            "performedStartTick": expected["performedStartTick"],
            "performedDurationTicks": expected["performedDurationTicks"],
            "midi": expected["midi"],
            "velocity": expected["velocity"],
        }
        if any(actual[field] != value for field, value in expected_fields.items()):
            raise AssertionError(f"observed addition changed after verdict: {event_id}")

    expected_duration_fixes = {
        str(row["predecessorEventId"]): int(row["correctedPredecessorDurationTicks"])
        for row in verdict["proposedDelta"]["durationCorrections"]
    }
    modified: dict[str, dict[str, list[Any]]] = {}
    for event_id in sorted(set(v5_by_id) & set(v6_by_id)):
        before, after = v5_by_id[event_id], v6_by_id[event_id]
        changes = {
            field: [before[field], after[field]]
            for field in PERFORMED_FIELDS
            if before[field] != after[field]
        }
        if changes:
            modified[event_id] = changes
    if set(modified) != set(expected_duration_fixes):
        raise AssertionError(f"unexpected common-event modifications: {sorted(modified)}")
    for event_id, corrected_duration in expected_duration_fixes.items():
        if modified[event_id] != {
            "performedDurationTicks": [v5_by_id[event_id]["performedDurationTicks"], corrected_duration]
        }:
            raise AssertionError(f"non-duration or wrong duration correction: {event_id}")

    if "lead-147" in v6_by_id or not any(
        note["eventId"] == "lead-148" and note["performedStartTick"] == 61_212
        for note in v6_notes
    ):
        raise AssertionError("F#4 false-split lifecycle was not implemented exactly")
    if any(note["performedStartTick"] == 40_295 and note["midi"] == 62 for note in v6_notes):
        raise AssertionError("held-out D4@40295 was silently promoted")

    role_counts = {
        role: sum(note["role"] == role for note in v6_notes)
        for role in ("bass", "comp", "lead")
    }
    if role_counts != {"bass": 96, "comp": 282, "lead": 172}:
        raise AssertionError(f"unexpected v6 role counts: {role_counts}")

    pitch_rows = {str(row["eventId"]): row for row in pitch["scoreEvents"]}
    if set(pitch_rows) != set(v6_by_id) or pitch["coverageGate"]["status"] != "pass":
        raise AssertionError("fresh pitch audit does not cover every v6 score event")
    if pitch["highConfidenceOmissionReview"] or pitch["highConfidenceFalsePositiveReview"]:
        raise AssertionError("fresh pitch audit produced an unadjudicated high-confidence exception")
    remaining_consensus_ticks = {
        int(row["startTickMedian"])
        for row in pitch["omissionReview"]
        if row["classification"] == "consensus-omission-review"
    }
    expected_non_add_ticks = {
        int(row["tick"])
        for row in verdict["omissionVerdicts"]
        if row["decision"] in ("reject", "hold")
    }
    if remaining_consensus_ticks != expected_non_add_ticks:
        raise AssertionError("fresh omission queue contains a candidate without a visual verdict")

    timing_rows = {str(row["groupId"]): row for row in timing["strikes"]}
    if len(timing_rows) != 339 or timing["currentRemainingSameKeyLifecycleCollisions"]:
        raise AssertionError("v6 timing coverage or same-key lifecycle gate failed")
    for note in v6_notes:
        if timing_group_id(note) not in timing_rows:
            raise AssertionError(f'note lacks a physical-strike timing audit: {note["eventId"]}')

    old_queue = {
        queue_identity(row)
        for key in ("waveformSupportedTimingCandidates", "timingReviewCandidates")
        for row in v5_timing[key]
    }
    new_queue = {
        queue_identity(row)
        for key in ("waveformSupportedTimingCandidates", "timingReviewCandidates")
        for row in timing[key]
    }
    newly_promoted = sorted(new_queue - old_queue, key=lambda item: (item[1], item[0]))
    newly_promoted_ticks = {tick for _, tick in newly_promoted}
    # Same group IDs can acquire an earlier observed anchor; compare by group as
    # well as by exact pair so the explicit reviewed set remains conservative.
    old_queue_groups = {group_id for group_id, _ in old_queue}
    truly_new_or_reanchored = [
        (group_id, tick) for group_id, tick in newly_promoted
        if group_id not in old_queue_groups or tick != next(
            old_tick for old_group, old_tick in old_queue if old_group == group_id
        )
    ]
    if not {tick for _, tick in truly_new_or_reanchored}.issubset(V6_NEW_QUEUE_REVIEWED_TICKS | {15_591}):
        raise AssertionError(f"new v6 timing queue item lacks second-pass review: {truly_new_or_reanchored}")

    v5_missing = v5_timing["missingAttackCandidates"]
    for candidate in timing["missingAttackCandidates"]:
        if not any(abs(int(candidate["anchorTick"]) - int(old["anchorTick"])) <= 2 for old in v5_missing):
            raise AssertionError(f"new missing-attack candidate was not in the visual verdict: {candidate['id']}")
    if timing["extraAttackCandidates"]:
        raise AssertionError("fresh v6 timing audit has an unadjudicated extra attack")

    bars = timing["bars"]
    if len(bars) != 36:
        raise AssertionError("5/4 audit must cover 35 complete bars plus the partial tail bar")
    for index, bar in enumerate(bars):
        if int(bar["nominalBarIndexZeroBased"]) != index or int(bar["startTick"]) != index * 2_400:
            raise AssertionError(f"invalid 5/4 bar math at bar {index + 1}")
        expected_end = min((index + 1) * 2_400, 85_860)
        if int(bar["endTickExclusive"]) != expected_end:
            raise AssertionError(f"invalid 5/4 bar end at bar {index + 1}")

    if provenance["status"] != "verified-byte-identical" or provenance["verification"]["byteIdentical"] is not True:
        raise AssertionError("v6 audition render is not byte-identical verified")
    if provenance["candidate"]["scoreId"] != v6_manifest["score"]["id"]:
        raise AssertionError("render provenance points to a different score")
    if ab["candidateInput"]["sha256"] != provenance["output"]["sha256"]:
        raise AssertionError("A/B candidate is not the verified v6 WAV")

    note_rows: list[dict[str, Any]] = []
    for note in v6_notes:
        event_id = str(note["eventId"])
        tick = int(note["performedStartTick"])
        phase = tick % 2_400
        group_id = timing_group_id(note)
        pitch_row = pitch_rows[event_id]
        timing_row = timing_rows[group_id]
        curation = (
            "source-observed-addition"
            if note.get("origin") == "curated-observation"
            else ("duration-only-lifecycle-fix" if event_id in expected_duration_fixes else "retained-evidence")
        )
        note_rows.append({
            "eventId": event_id,
            "origin": note["origin"],
            "role": note["role"],
            "startTick": tick,
            "durationTicks": note["performedDurationTicks"],
            "endTick": tick + int(note["performedDurationTicks"]),
            "midi": note["midi"],
            "noteName": note_name(int(note["midi"])),
            "velocity": note["velocity"],
            "bar": tick // 2_400 + 1,
            "beat": round(phase / 480 + 1, 6),
            "phaseTicks": phase,
            "threePlusTwoGroup": "3-beat" if phase < 1_440 else "2-beat",
            "performedSeconds": round(tick / 1_600, 6),
            "sourceVideoSeconds": round(1.547 + tick / 1_600, 6),
            "physicalStrikeGroup": group_id,
            "strikeSpreadTicks": timing_row["spreadTicks"],
            "timingConfidence": timing_row["confidence"],
            "timingResidualMilliseconds": None if timing_row["detrendedLocalResidualSeconds"] is None else round(
                float(timing_row["detrendedLocalResidualSeconds"]) * 1_000, 6
            ),
            "timingDecision": "retain-performed-onset-no-move",
            "pitchMatchStatus": pitch_row["matchStatus"],
            "pitchDetectorConfigs": pitch_row["detectorConfigCount"],
            "pitchOnsetResidualTicks": pitch_row["detectorStartResidualTicks"],
            "pitchReviewClass": pitch_row["reviewClass"],
            "curationDecision": curation,
        })

    summary = timing["summary"]
    clock = timing["performedClock"]
    output = {
        "schemaVersion": 1,
        "status": "v6-full-video-comparison-pass; provisional and unapproved",
        "truthPolicy": {
            "source": "user-supplied video and extracted reference.wav",
            "performedTicks": "immutable score authority; 5/4 and 3+2 remain descriptive",
            "productEffect": "none; historical 555-note product baseline remains active",
        },
        "inputs": {
            name: {"path": relative(path), "sha256": sha256(path)}
            for name, path in {
                "v5Notes": V5_NOTES,
                "v6Notes": V6_NOTES,
                "exhaustiveVerdict": V5_VERDICT,
                "v5Timing": V5_TIMING,
                "v6Pitch": V6_PITCH,
                "v6Timing": V6_TIMING,
                "v6RenderProvenance": V6_PROVENANCE,
                "v6AB": V6_AB,
            }.items()
        },
        "score": {
            "id": v6_manifest["score"]["id"],
            "revision": v6_manifest["score"]["replicaRevision"],
            "approvalStatus": "unapproved",
            "notes": len(v6_notes),
            "roleCounts": role_counts,
            "additionsFromV5": len(actual_additions),
            "removalsFromV5": len(actual_removals),
            "durationOnlyChangesFromV5": len(modified),
            "commonEventOnsetMoves": 0,
            "sameKeyLifecycleCollisions": 0,
        },
        "pitchCoverage": {
            "scoreEvents": pitch["counts"]["scoreEvents"],
            "strictSamePitchMatches": pitch["counts"]["strictMatches"],
            "consensusSupported": pitch["counts"]["consensusSupportedScoreEvents"],
            "unmatchedScoreEvents": pitch["counts"]["unmatchedScoreEvents"],
            "highConfidenceUnadjudicatedOmissions": len(pitch["highConfidenceOmissionReview"]),
            "highConfidenceUnadjudicatedFalsePositives": len(pitch["highConfidenceFalsePositiveReview"]),
            "remainingConsensusAudioCandidates": sorted(remaining_consensus_ticks),
            "remainingCandidatesHaveVisualVerdict": True,
        },
        "timingCoverage": {
            "physicalStrikes": len(timing_rows),
            "bars": len(bars),
            "meter": "5/4",
            "grouping": "3+2 descriptive annotation",
            "reliableAbsoluteResidualP50Milliseconds": summary["reliableAbsoluteResidualP50Milliseconds"],
            "reliableAbsoluteResidualP90Milliseconds": summary["reliableAbsoluteResidualP90Milliseconds"],
            "equivalentBpm": clock["equivalentBpm"],
            "endClockResidualMilliseconds": clock["endResidualSeconds"] * 1_000,
            "newlyPromotedQueueItems": [
                {"groupId": group_id, "anchorTick": tick, "decision": "retain-performed-onset-no-move"}
                for group_id, tick in newly_promoted
            ],
            "missingAttackCandidates": len(timing["missingAttackCandidates"]),
            "allMissingCandidatesPreviouslyVisuallyRejected": True,
            "extraAttackCandidates": len(timing["extraAttackCandidates"]),
        },
        "handoff": {
            "bassAttacksAtOrAfterTick24000": sum(
                note["role"] == "bass" and note["performedStartTick"] >= 24_000 for note in v6_notes
            ),
            "compAttacksBeforeTick24000": sum(
                note["role"] == "comp" and note["performedStartTick"] < 24_000 for note in v6_notes
            ),
            "lastBassAttackTick": max(note["performedStartTick"] for note in v6_notes if note["role"] == "bass"),
            "lastBassTailTick": max(
                note["performedStartTick"] + note["performedDurationTicks"]
                for note in v6_notes if note["role"] == "bass"
            ),
            "firstCompAttackTick": min(note["performedStartTick"] for note in v6_notes if note["role"] == "comp"),
            "policy": "cross-boundary tails are retained; no artificial attack at tick 24000",
        },
        "heldOut": [row for row in verdict["omissionVerdicts"] if row["decision"] == "hold"],
        "render": {
            "approvalContentSha256": provenance["candidate"]["approvalContentSha256"],
            "midiSha256": provenance["midi"]["sha256"],
            "wavSha256": provenance["output"]["sha256"],
            "byteIdenticalRerender": provenance["verification"]["byteIdentical"],
            "abManifest": relative(V6_AB),
        },
        "noteAuditRows": len(note_rows),
    }
    return output, note_rows


def write(output: dict[str, Any], note_rows: list[dict[str, Any]]) -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    json_path = OUTPUT / "take-five-v6-video-comparison.json"
    csv_path = OUTPUT / "all-notes-with-5-4-beats.csv"
    readme_path = OUTPUT / "README.md"
    json_path.write_text(json.dumps(output, indent=2) + "\n")
    with csv_path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(note_rows[0]))
        writer.writeheader()
        writer.writerows(note_rows)

    score = output["score"]
    pitch = output["pitchCoverage"]
    timing = output["timingCoverage"]
    handoff = output["handoff"]
    held = output["heldOut"][0]
    additions = [row for row in note_rows if row["curationDecision"] == "source-observed-addition"]
    addition_lines = "\n".join(
        f'| `{row["eventId"]}` | {row["startTick"]} | {row["bar"]} | {row["beat"]} | '
        f'{row["noteName"]} | {row["role"]} |'
        for row in additions
    )
    readme = f"""# Take Five v6 · 全音符 / 全节拍视频复核

结论：v6 已通过完整候选集成门禁，但仍是 **provisional / unapproved**；产品仍使用历史 555-note baseline。

## 全量覆盖

- 固定谱音符：`{score['notes']}/{score['notes']}`；Bass `{score['roleCounts']['bass']}`、Comp `{score['roleCounts']['comp']}`、Lead `{score['roleCounts']['lead']}`。
- 音高/起音检测：严格同音匹配 `{pitch['strictSamePitchMatches']}/{pitch['scoreEvents']}`；≥3/4 阈值支持 `{pitch['consensusSupported']}`；高置信未裁决漏音/假音均为 `0`。
- 物理攻击：`{timing['physicalStrikes']}/{timing['physicalStrikes']}`；5/4 小节审计 `36/36`（35 个完整小节 + 尾部不完整小节）。
- 可靠攻击相对源视频音频的残差 P50 / P90：`{timing['reliableAbsoluteResidualP50Milliseconds']:.2f} / {timing['reliableAbsoluteResidualP90Milliseconds']:.2f} ms`。
- 全局等效速度 `{timing['equivalentBpm']:.4f} BPM`，尾端 clock 残差 `{timing['endClockResidualMilliseconds']:.3f} ms`；没有依据改 BPM、barline 或任何 performed onset。
- 全曲 same-key MIDI lifecycle collision：`0`。

`all-notes-with-5-4-beats.csv` 是逐音符总表：每个音都包含 tick、时值、音高、力度、5/4 小节、拍内位置、3+2 分组、视频绝对秒数、物理 strike、音高匹配和 timing residual。

## 相对 v5 的唯一变化

- 新增视频确认漏音 `17` 个；删除误切分 `lead-147 F#4@61080`；六个前驱音仅缩短 `1 tick`。
- 所有共有事件的 performed onset 移动数：`0`。
- held-out：`{held['tick']} {held['noteName']}` 仍不写入固定谱，因为 {held['reason']}。

| observation | tick | bar | beat | pitch | role |
|---|---:|---:|---:|---|---|
{addition_lines}

## 15 秒功能声部交接

- tick 24000 后 Bass 新攻击：`{handoff['bassAttacksAtOrAfterTick24000']}`；tick 24000 前 Comp 攻击：`{handoff['compAttacksBeforeTick24000']}`。
- 最后 Bass attack `{handoff['lastBassAttackTick']}`，尾音自然延续到 `{handoff['lastBassTailTick']}`；第一 Comp attack `{handoff['firstCompAttackTick']}`。
- tick 24000 不强造和弦，不截断跨段尾音；Lead 贯穿两段。

## 审听与溯源

- 完整 A/B：`{output['render']['abManifest']}`；`segments/` 内按 7.5 秒拆分。
- MIDI SHA-256：`{output['render']['midiSha256']}`。
- WAV SHA-256：`{output['render']['wavSha256']}`；独立重渲染逐字节一致。
- 候选 approval content SHA-256：`{output['render']['approvalContentSha256']}`；当前未批准、未切产品路由。

5/4 与 3+2 在本报告中只负责定位和解释，不具备量化 fixed replica 的权限。
"""
    readme_path.write_text(readme)
    print(readme_path)
    print(csv_path)
    print(json_path)


if __name__ == "__main__":
    result, rows = build()
    write(result, rows)
