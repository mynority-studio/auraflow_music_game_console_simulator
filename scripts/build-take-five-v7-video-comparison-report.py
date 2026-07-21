#!/usr/bin/env python3
"""Build the final, read-only V7 video-comparison gate.

The report joins the exhaustive V5 visual verdict, the V6 and V7 fixed scores,
fresh V7 pitch/timing audits, and the locked render/A/B provenance.  It does
not quantize performed ticks, edit the score, approve the candidate, or switch
the product route.
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
V7_ROOT = ROOT / "tmp/video-replica/take-five-full-curation-v7"

V5_NOTES = V5_ROOT / "take-five-full-curation-v5.notes.json"
V6_NOTES = V6_ROOT / "take-five-full-curation-v6.notes.json"
V7_NOTES = V7_ROOT / "take-five-full-curation-v7.notes.json"
V5_VERDICT = V5_ROOT / "full-audit/verdict/full-audit-verdict.json"
V5_TIMING = V5_ROOT / "full-audit/timing/full-timing-audit.json"
V5_VISUAL_EXCEPTIONS = V5_ROOT / "full-audit/visual-exhaustive/exhaustive-exception-visuals.json"
V7_PITCH = V7_ROOT / "full-audit/pitch/full-pitch-audit.json"
V7_TIMING = V7_ROOT / "full-audit/timing/full-timing-audit.json"
V7_PROVENANCE = V7_ROOT / "take-five-full-curation-v7.render-provenance.json"
V7_AB = V7_ROOT / "ab/take-five-v7-AB-manifest.json"
V7_E3_AB = V7_ROOT / "focus/e3-source-vs-v7/take-five-e3-focus-AB-manifest.json"
OUTPUT = V7_ROOT / "full-audit/final-verification"

SOURCE_VIDEO_SHA256 = "73810e3c4dc69f8337c392642e47f52e84ce890c7995949895ca5317100d01e7"
APPROVAL_SHA256 = "335f5ffa1671ffdf89dc8620e94a193909b4b31181856a234273cc84e379ee3c"
E3_EVENT_ID = "observed-v6-76318-e3"
PERFORMED_FIELDS = (
    "role",
    "performedStartTick",
    "performedDurationTicks",
    "midi",
    "velocity",
)


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def relative(path: Path) -> str:
    return str(path.resolve().relative_to(ROOT))


def artifact_path(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else ROOT / path


def require_artifact_hash(path_value: str, expected_sha256: str) -> None:
    path = artifact_path(path_value)
    if not path.is_file():
        raise AssertionError(f"referenced A/B artifact is missing: {path}")
    actual = sha256(path)
    if actual != expected_sha256:
        raise AssertionError(f"referenced A/B hash mismatch: {path}: {actual} != {expected_sha256}")


def verify_ab_artifacts(manifest: dict[str, Any], *, segmented: bool) -> int:
    pairs: list[tuple[str, str]] = [
        (manifest["sourceInput"]["path"], manifest["sourceInput"]["sha256"]),
        (manifest["candidateInput"]["path"], manifest["candidateInput"]["sha256"]),
        (manifest["A"]["path"], manifest["A"]["sha256"]),
        (manifest["B"]["path"], manifest["B"]["sha256"]),
        (manifest["sequential"]["path"], manifest["sequential"]["sha256"]),
        (manifest["alignedStereo"]["path"], manifest["alignedStereo"]["sha256"]),
    ]
    if segmented:
        provenance = manifest["candidateRenderProvenance"]
        pairs.append((provenance["path"], provenance["sha256"]))
        review = manifest["segmentedReview"]
        pairs.append((review["path"], review["sha256"]))
        for segment in review["segments"]:
            pairs.extend((
                (segment["sequential"], segment["sequentialSha256"]),
                (segment["alignedStereo"], segment["alignedStereoSha256"]),
            ))
    for path_value, expected in pairs:
        require_artifact_hash(path_value, expected)
    return len(pairs)


def flatten_notes(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    role_rank = {"bass": 0, "comp": 1, "lead": 2}
    notes = [note for track in manifest["tracks"].values() for note in track["notes"]]
    return sorted(
        notes,
        key=lambda note: (
            int(note["performedStartTick"]),
            role_rank[str(note["role"])],
            int(note["midi"]),
            str(note["eventId"]),
        ),
    )


def performed_snapshot(note: dict[str, Any]) -> dict[str, Any]:
    return {field: note[field] for field in PERFORMED_FIELDS}


def note_name(midi: int) -> str:
    names = ("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
    return f"{names[midi % 12]}{midi // 12 - 1}"


def timing_group_id(note: dict[str, Any]) -> str:
    if note.get("origin") == "curated-observation":
        return str(note.get("relatedStrikeGroupId") or f'observation-strike-{note["eventId"]}')
    return str(note["strikeGroupId"])


def exact_change(before: dict[str, Any], after: dict[str, Any]) -> dict[str, list[Any]]:
    return {
        field: [before[field], after[field]]
        for field in PERFORMED_FIELDS
        if before[field] != after[field]
    }


def build() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    v5_manifest = load(V5_NOTES)
    v6_manifest = load(V6_NOTES)
    v7_manifest = load(V7_NOTES)
    verdict = load(V5_VERDICT)
    v5_timing = load(V5_TIMING)
    visual_exceptions = load(V5_VISUAL_EXCEPTIONS)
    pitch = load(V7_PITCH)
    timing = load(V7_TIMING)
    provenance = load(V7_PROVENANCE)
    ab = load(V7_AB)
    e3_ab = load(V7_E3_AB)

    v5_notes = flatten_notes(v5_manifest)
    v6_notes = flatten_notes(v6_manifest)
    v7_notes = flatten_notes(v7_manifest)
    v5_by_id = {str(note["eventId"]): note for note in v5_notes}
    v6_by_id = {str(note["eventId"]): note for note in v6_notes}
    v7_by_id = {str(note["eventId"]): note for note in v7_notes}
    if (len(v5_notes), len(v6_notes), len(v7_notes)) != (534, 550, 550):
        raise AssertionError("unexpected V5/V6/V7 note counts")
    if any(len(notes) != len(by_id) for notes, by_id in (
        (v5_notes, v5_by_id), (v6_notes, v6_by_id), (v7_notes, v7_by_id)
    )):
        raise AssertionError("duplicate eventId in fixed score")

    # The second comparison pass is deliberately isolated: one E3 attack moves
    # 45 ticks earlier while its audible end and musical identity stay fixed.
    if set(v6_by_id) != set(v7_by_id):
        raise AssertionError("V7 changed the V6 event set")
    v6_to_v7_changes = {
        event_id: exact_change(v6_by_id[event_id], v7_by_id[event_id])
        for event_id in sorted(v7_by_id)
        if exact_change(v6_by_id[event_id], v7_by_id[event_id])
    }
    expected_e3_change = {
        "performedStartTick": [76_318, 76_273],
        "performedDurationTicks": [204, 249],
    }
    if v6_to_v7_changes != {E3_EVENT_ID: expected_e3_change}:
        raise AssertionError(f"unexpected V6 -> V7 performed change: {v6_to_v7_changes}")
    if any(
        v6_by_id[event_id] != v7_by_id[event_id]
        for event_id in v7_by_id
        if event_id != E3_EVENT_ID
    ):
        raise AssertionError("one of the other 549 V6 note objects changed in V7")
    v6_e3 = v6_by_id[E3_EVENT_ID]
    v7_e3 = v7_by_id[E3_EVENT_ID]
    if int(v6_e3["performedStartTick"]) + int(v6_e3["performedDurationTicks"]) != 76_522:
        raise AssertionError("V6 E3 end tick changed unexpectedly")
    if int(v7_e3["performedStartTick"]) + int(v7_e3["performedDurationTicks"]) != 76_522:
        raise AssertionError("V7 E3 must preserve end tick 76522")
    if performed_snapshot(v7_e3) != {
        "role": "comp",
        "performedStartTick": 76_273,
        "performedDurationTicks": 249,
        "midi": 52,
        "velocity": 51,
    }:
        raise AssertionError("V7 E3 identity/timing is not the reviewed result")
    if v7_manifest["diffFromV6"]["summary"] != {
        "added": 0,
        "removed": 0,
        "modified": 1,
        "unchanged": 549,
        "audibleEventChanges": 1,
        "roleOnlyChanges": 0,
    }:
        raise AssertionError("manifest V6 -> V7 diff summary is stale")

    # Reconcile the complete score with the exhaustive V5 visual verdict.  E3
    # is the sole later timing refinement; all other additions remain verbatim.
    expected_additions = {
        str(note["observationId"]): note for note in verdict["proposedDelta"]["additions"]
    }
    expected_removals = {
        str(note["eventId"]) for note in verdict["proposedDelta"]["removals"]
    }
    actual_additions = set(v7_by_id) - set(v5_by_id)
    actual_removals = set(v5_by_id) - set(v7_by_id)
    if actual_additions != set(expected_additions) or actual_removals != expected_removals:
        raise AssertionError("V7 additions/removals diverge from the exhaustive verdict")
    for event_id, expected in expected_additions.items():
        if event_id == E3_EVENT_ID:
            continue
        expected_fields = {
            "role": expected["role"],
            "performedStartTick": expected["performedStartTick"],
            "performedDurationTicks": expected["performedDurationTicks"],
            "midi": expected["midi"],
            "velocity": expected["velocity"],
        }
        if performed_snapshot(v7_by_id[event_id]) != expected_fields:
            raise AssertionError(f"reviewed observation changed: {event_id}")

    expected_duration_fixes = {
        str(row["predecessorEventId"]): int(row["correctedPredecessorDurationTicks"])
        for row in verdict["proposedDelta"]["durationCorrections"]
    }
    common_changes = {
        event_id: exact_change(v5_by_id[event_id], v7_by_id[event_id])
        for event_id in sorted(set(v5_by_id) & set(v7_by_id))
        if exact_change(v5_by_id[event_id], v7_by_id[event_id])
    }
    if set(common_changes) != set(expected_duration_fixes):
        raise AssertionError(f"unexpected common-event changes from V5: {sorted(common_changes)}")
    for event_id, duration in expected_duration_fixes.items():
        if common_changes[event_id] != {
            "performedDurationTicks": [v5_by_id[event_id]["performedDurationTicks"], duration]
        }:
            raise AssertionError(f"wrong lifecycle duration correction: {event_id}")
    common_onset_moves = sum(
        v5_by_id[event_id]["performedStartTick"] != v7_by_id[event_id]["performedStartTick"]
        for event_id in set(v5_by_id) & set(v7_by_id)
    )
    if common_onset_moves != 0:
        raise AssertionError("an existing V5 performed onset was moved")
    if "lead-147" in v7_by_id or "lead-148" not in v7_by_id:
        raise AssertionError("reviewed F#4 false split was not merged exactly")
    if any(note["performedStartTick"] == 40_295 and note["midi"] == 62 for note in v7_notes):
        raise AssertionError("held D4@40295 was silently promoted")

    role_counts = {
        role: sum(note["role"] == role for note in v7_notes)
        for role in ("bass", "comp", "lead")
    }
    if role_counts != {"bass": 96, "comp": 282, "lead": 172}:
        raise AssertionError(f"unexpected V7 role counts: {role_counts}")
    for note in v7_notes:
        values = (
            note["performedStartTick"], note["performedDurationTicks"], note["midi"], note["velocity"]
        )
        if not all(isinstance(value, int) for value in values):
            raise AssertionError(f'non-integer performed event: {note["eventId"]}')
        if note["performedStartTick"] < 0 or note["performedDurationTicks"] <= 0:
            raise AssertionError(f'invalid performed timing: {note["eventId"]}')
        if not 0 <= note["midi"] <= 127 or not 1 <= note["velocity"] <= 127:
            raise AssertionError(f'invalid MIDI data: {note["eventId"]}')
    for role in ("bass", "comp", "lead"):
        for midi in range(128):
            same_key = sorted(
                (note for note in v7_notes if note["role"] == role and note["midi"] == midi),
                key=lambda note: int(note["performedStartTick"]),
            )
            for previous, current in zip(same_key, same_key[1:]):
                previous_end = int(previous["performedStartTick"]) + int(previous["performedDurationTicks"])
                if previous_end > int(current["performedStartTick"]):
                    raise AssertionError(
                        f'same-role/same-key lifecycle overlap: {previous["eventId"]} -> {current["eventId"]}'
                    )
    if v7_manifest["score"]["noteCount"] != 550:
        raise AssertionError("manifest score count is stale")
    if v7_manifest["authority"] != {
        "readOnlyCandidate": True,
        "approvalEffect": "none",
        "productRouteEffect": "none",
    }:
        raise AssertionError("candidate authority unexpectedly affects the product")
    if v7_manifest["approvalCandidate"]["status"] != "unapproved":
        raise AssertionError("V7 was unexpectedly approved")
    if v7_manifest["approvalCandidate"]["sha256"] != APPROVAL_SHA256:
        raise AssertionError("approval content hash changed")

    # Every note gets an independent pitch row; all remaining consensus audio
    # candidates must equal the already adjudicated reject/hold set.
    pitch_rows = {str(row["eventId"]): row for row in pitch["scoreEvents"]}
    if set(pitch_rows) != set(v7_by_id) or pitch["coverageGate"]["status"] != "pass":
        raise AssertionError("fresh pitch audit does not cover every V7 note")
    if pitch["highConfidenceOmissionReview"] or pitch["highConfidenceFalsePositiveReview"]:
        raise AssertionError("fresh pitch audit has an unadjudicated high-confidence exception")
    remaining_consensus = [
        row for row in pitch["omissionReview"]
        if row["classification"] == "consensus-omission-review"
    ]
    omission_verdict_by_cluster = {
        str(row["clusterId"]): row
        for row in verdict["omissionVerdicts"]
        if row["decision"] in ("reject", "hold")
    }
    if {str(row["clusterId"]) for row in remaining_consensus} != set(omission_verdict_by_cluster):
        raise AssertionError("pitch omission queue contains an unreviewed cluster")
    remaining_consensus_adjudications = [
        {
            "clusterId": row["clusterId"],
            "currentAnchorTick": row["startTickAnchor"],
            "currentMedianTick": row["startTickMedian"],
            "verdictTick": omission_verdict_by_cluster[str(row["clusterId"])]["tick"],
            "midi": row["midi"],
            "noteName": row["noteName"],
            "decision": omission_verdict_by_cluster[str(row["clusterId"])]["decision"],
        }
        for row in sorted(remaining_consensus, key=lambda item: int(item["startTickAnchor"]))
    ]
    score_verdict_by_id = {
        str(row["eventId"]): row for row in verdict["scoreEventVerdicts"]
    }
    unmatched_event_ids = sorted(
        str(row["eventId"]) for row in pitch["scoreEvents"] if row["matchStatus"] == "unmatched"
    )
    if unmatched_event_ids != ["bass-028"] or score_verdict_by_id["bass-028"]["decision"] != "retain":
        raise AssertionError("the sole unmatched score note lacks its visual retain verdict")
    weak_event_ids = {str(row["eventId"]) for row in pitch["falsePositiveReview"]}
    if not weak_event_ids or any(score_verdict_by_id[event_id]["decision"] != "retain" for event_id in weak_event_ids):
        raise AssertionError("a weak score event lacks its V5 visual retain verdict")

    # Timing is audited by physical strike, not by track.  Existing V5 onsets
    # remain immutable; four new observation-only attacks expand 335 -> 339.
    timing_rows = {str(row["groupId"]): row for row in timing["strikes"]}
    if len(timing_rows) != 339:
        raise AssertionError("V7 timing audit must cover 339 physical strikes")
    if timing["currentRemainingSameKeyLifecycleCollisions"]:
        raise AssertionError("same-key MIDI lifecycle collision remains")
    for note in v7_notes:
        group_id = timing_group_id(note)
        if group_id not in timing_rows:
            raise AssertionError(f'note lacks timing coverage: {note["eventId"]}')
    audited_event_ids = [
        str(event_id)
        for row in timing["strikes"]
        for event_id in row["retainedEventIds"]
    ]
    if len(audited_event_ids) != 550 or set(audited_event_ids) != set(v7_by_id):
        raise AssertionError("339 timing strikes do not cover all 550 eventIds exactly once")
    if verdict["coverage"]["retainedPhysicalStrikes"] != {"audited": 335, "onsetMoves": 0}:
        raise AssertionError("exhaustive V5 timing verdict is not the expected immutable baseline")
    if int(visual_exceptions["counts"]["uniqueTargetTicks"]) != 135:
        raise AssertionError("exhaustive visual exception coverage is not 135/135 ticks")
    waveform_queue_groups = {
        str(row["groupId"]) for row in timing["waveformSupportedTimingCandidates"]
    }
    secondary_queue_groups = {
        str(row["groupId"]) for row in timing["timingReviewCandidates"]
    }
    if len(waveform_queue_groups) != 15 or len(secondary_queue_groups) != 53:
        raise AssertionError("fresh V7 timing metric queue counts changed")
    if waveform_queue_groups & secondary_queue_groups:
        raise AssertionError("V7 timing metric queues overlap")
    old_retained_timing_groups = {
        str(row["groupId"])
        for row in verdict["timingVerdicts"]
        if row["decision"] == "retain-onset-no-move"
    }
    observation_59682_group = "observation-strike-observed-v6-59682-d3"
    if (waveform_queue_groups | secondary_queue_groups) - old_retained_timing_groups != {
        observation_59682_group
    }:
        raise AssertionError("a V7 timing metric queue item lacks an existing adjudication")
    if (
        "observed-v6-59682-d3" not in expected_additions
        or int(v7_by_id["observed-v6-59682-d3"]["performedStartTick"]) != 59_682
    ):
        raise AssertionError("the sole observation-only queued strike lacks its add verdict")

    e3_group_id = f"observation-strike-{E3_EVENT_ID}"
    e3_timing = timing_rows[e3_group_id]
    if int(e3_timing["anchorTick"]) != 76_273:
        raise AssertionError("E3 timing audit still points to V6")
    if e3_timing["waveformSupportedTimingCandidate"] or e3_timing["timingReviewCandidate"]:
        raise AssertionError("reviewed E3 remains in a timing exception queue")
    if abs(float(e3_timing["detrendedLocalResidualSeconds"])) > 0.009:
        raise AssertionError("reviewed E3 residual did not converge")

    matched_missing_verdict_ids: list[str] = []
    for candidate in timing["missingAttackCandidates"]:
        matches = [
            old for old in verdict["missingAttackVerdicts"]
            if abs(int(candidate["anchorTick"]) - int(old["anchorTick"])) <= 2
        ]
        if len(matches) != 1 or matches[0]["decision"] != "reject-as-new-attack":
            raise AssertionError(f"new missing attack lacks a visual verdict: {candidate['id']}")
        matched_missing_verdict_ids.append(str(matches[0]["id"]))
    if len(set(matched_missing_verdict_ids)) != len(matched_missing_verdict_ids):
        raise AssertionError("V7 missing attacks do not map one-to-one to reject verdicts")
    if timing["extraAttackCandidates"]:
        raise AssertionError("fresh timing audit has an unadjudicated extra attack")

    bars = timing["bars"]
    score_end_tick = int(v7_manifest["score"]["durationPerformedTicks"])
    if len(bars) != 36 or score_end_tick != 85_860:
        raise AssertionError("5/4 audit must cover 35 full bars and one partial tail bar")
    for index, bar in enumerate(bars):
        if int(bar["nominalBarIndexZeroBased"]) != index or int(bar["startTick"]) != index * 2_400:
            raise AssertionError(f"invalid 5/4 start math at bar {index + 1}")
        if int(bar["endTickExclusive"]) != min((index + 1) * 2_400, score_end_tick):
            raise AssertionError(f"invalid 5/4 end math at bar {index + 1}")
    bar_group_ids = [str(group_id) for bar in bars for group_id in bar["groupIds"]]
    if len(bar_group_ids) != 339 or set(bar_group_ids) != set(timing_rows):
        raise AssertionError("36 bar buckets do not cover all 339 strikes exactly once")
    if int(bars[-1]["strikeCount"]) != 0:
        raise AssertionError("partial tail bucket must remain an empty timing boundary")

    # The audition artifact is tied to the exact score hash and independently
    # rerendered byte-for-byte.  Both whole-song and E3-focus A/Bs use that WAV.
    if provenance["status"] != "verified-byte-identical" or provenance["verification"]["byteIdentical"] is not True:
        raise AssertionError("V7 WAV is not byte-identical verified")
    if provenance["candidate"]["scoreId"] != v7_manifest["score"]["id"]:
        raise AssertionError("render provenance points to another score")
    if provenance["candidate"]["approvalContentSha256"] != APPROVAL_SHA256:
        raise AssertionError("render provenance approval hash changed")
    if ab["candidateInput"]["sha256"] != provenance["output"]["sha256"]:
        raise AssertionError("whole-song A/B is not the verified V7 WAV")
    if e3_ab["candidateInput"]["sha256"] != provenance["output"]["sha256"]:
        raise AssertionError("E3 focus A/B is not the verified V7 WAV")
    verified_ab_references = verify_ab_artifacts(ab, segmented=True) + verify_ab_artifacts(
        e3_ab, segmented=False
    )
    if verified_ab_references != 30:
        raise AssertionError("expected to verify exactly 30 A/B artifact references")
    audible_end_tick = max(
        int(note["performedStartTick"]) + int(note["performedDurationTicks"])
        for note in v7_notes
    )
    ab_end_tick = round(float(ab["durationSeconds"]) * 1_600)
    if audible_end_tick != 82_809 or ab_end_tick != 85_820 or score_end_tick - ab_end_tick != 40:
        raise AssertionError("whole-song A/B tail coverage changed")
    if ab_end_tick < audible_end_tick:
        raise AssertionError("whole-song A/B does not cover every audible event")

    handoff = {
        "bassAttacksAtOrAfterTick24000": sum(
            note["role"] == "bass" and note["performedStartTick"] >= 24_000 for note in v7_notes
        ),
        "compAttacksBeforeTick24000": sum(
            note["role"] == "comp" and note["performedStartTick"] < 24_000 for note in v7_notes
        ),
        "lastBassAttackTick": max(
            int(note["performedStartTick"]) for note in v7_notes if note["role"] == "bass"
        ),
        "lastBassTailTick": max(
            int(note["performedStartTick"]) + int(note["performedDurationTicks"])
            for note in v7_notes if note["role"] == "bass"
        ),
        "firstCompAttackTick": min(
            int(note["performedStartTick"]) for note in v7_notes if note["role"] == "comp"
        ),
    }
    if handoff != {
        "bassAttacksAtOrAfterTick24000": 0,
        "compAttacksBeforeTick24000": 0,
        "lastBassAttackTick": 23_924,
        "lastBassTailTick": 24_945,
        "firstCompAttackTick": 24_722,
    }:
        raise AssertionError(f"bass/comp structural handoff changed: {handoff}")

    note_rows: list[dict[str, Any]] = []
    for note in v7_notes:
        event_id = str(note["eventId"])
        tick = int(note["performedStartTick"])
        duration = int(note["performedDurationTicks"])
        phase = tick % 2_400
        group_id = timing_group_id(note)
        pitch_row = pitch_rows[event_id]
        timing_row = timing_rows[group_id]
        if event_id == E3_EVENT_ID:
            timing_decision = "v7-refined-from-v6-76318-to-76273-end-preserved"
            curation = "source-observed-addition-timing-refined-in-v7"
        elif note.get("origin") == "curated-observation":
            timing_decision = "retain-reviewed-observation-onset"
            curation = "source-observed-addition"
        elif event_id in expected_duration_fixes:
            timing_decision = "retain-performed-onset-no-move"
            curation = "duration-only-same-key-lifecycle-fix"
        else:
            timing_decision = "retain-performed-onset-no-move"
            curation = "retained-evidence"
        note_rows.append({
            "eventId": event_id,
            "origin": note["origin"],
            "role": note["role"],
            "startTick": tick,
            "durationTicks": duration,
            "endTick": tick + duration,
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
            "timingResidualMilliseconds": None
            if timing_row["detrendedLocalResidualSeconds"] is None
            else round(float(timing_row["detrendedLocalResidualSeconds"]) * 1_000, 6),
            "timingDecision": timing_decision,
            "pitchMatchStatus": pitch_row["matchStatus"],
            "pitchDetectorConfigs": pitch_row["detectorConfigCount"],
            "pitchOnsetResidualTicks": pitch_row["detectorStartResidualTicks"],
            "pitchReviewClass": pitch_row["reviewClass"],
            "curationDecision": curation,
        })

    summary = timing["summary"]
    clock = timing["performedClock"]
    held_out = [row for row in verdict["omissionVerdicts"] if row["decision"] == "hold"]
    output = {
        "schemaVersion": 1,
        "status": "v7-full-video-comparison-pass; provisional, unapproved, product unchanged",
        "truthPolicy": {
            "source": "user-supplied video plus extracted reference.wav",
            "sourceVideoSha256": SOURCE_VIDEO_SHA256,
            "performedTicks": "fixed replica authority; meter annotations cannot rewrite them",
            "productEffect": "none; historical 555-note product baseline remains active",
        },
        "inputs": {
            name: {"path": relative(path), "sha256": sha256(path)}
            for name, path in {
                "v5Notes": V5_NOTES,
                "v6Notes": V6_NOTES,
                "v7Notes": V7_NOTES,
                "exhaustiveVerdict": V5_VERDICT,
                "exhaustiveVisualExceptions": V5_VISUAL_EXCEPTIONS,
                "v5Timing": V5_TIMING,
                "v7Pitch": V7_PITCH,
                "v7Timing": V7_TIMING,
                "v7RenderProvenance": V7_PROVENANCE,
                "v7AB": V7_AB,
                "v7E3AB": V7_E3_AB,
            }.items()
        },
        "score": {
            "id": v7_manifest["score"]["id"],
            "revision": v7_manifest["score"]["replicaRevision"],
            "approvalStatus": "unapproved",
            "notes": len(v7_notes),
            "roleCounts": role_counts,
            "physicalStrikes": len(timing_rows),
            "bars": len(bars),
            "completeBars": 35,
            "partialEmptyTailBuckets": 1,
            "sameKeyLifecycleCollisions": 0,
        },
        "comparisonFromV5": {
            "added": len(actual_additions),
            "removed": len(actual_removals),
            "durationOnlyCommonEventChanges": len(common_changes),
            "commonEventOnsetMoves": common_onset_moves,
            "all534ExistingEventsReviewed": True,
            "all335ExistingPhysicalStrikesReviewed": True,
            "all135ExceptionTicksReviewed": True,
        },
        "comparisonFromV6": {
            "modified": 1,
            "unchanged": 549,
            "eventId": E3_EVENT_ID,
            "before": performed_snapshot(v6_e3),
            "after": performed_snapshot(v7_e3),
            "preservedEndTick": 76_522,
            "otherPerformedOnsetsChanged": 0,
        },
        "pitchCoverage": {
            "scoreEvents": pitch["counts"]["scoreEvents"],
            "strictSamePitchMatches": pitch["counts"]["strictMatches"],
            "consensusSupported": pitch["counts"]["consensusSupportedScoreEvents"],
            "unmatchedScoreEvents": pitch["counts"]["unmatchedScoreEvents"],
            "highConfidenceUnadjudicatedOmissions": len(pitch["highConfidenceOmissionReview"]),
            "highConfidenceUnadjudicatedFalsePositives": len(pitch["highConfidenceFalsePositiveReview"]),
            "visuallyRetainedUnmatchedScoreEvent": unmatched_event_ids[0],
            "weakScoreEventsAllVisuallyRetained": True,
            "remainingConsensusAdjudications": remaining_consensus_adjudications,
            "remainingCandidatesHaveVisualRejectOrHoldVerdict": True,
            "detectorDurationReviewHints": len(pitch["detectorDurationReview"]),
            "detectorDurationOutsideAllRangesHints": len(
                pitch["detectorDurationOutsideAllConfigRangesReview"]
            ),
            "spectrumDurationReviewHints": len(pitch["spectrumDurationReview"]),
        },
        "timingCoverage": {
            "physicalStrikes": len(timing_rows),
            "bars": len(bars),
            "meter": "5/4",
            "grouping": "3+2 descriptive annotation",
            "ticksPerBeat": 480,
            "ticksPerBar": 2_400,
            "reliableAbsoluteResidualP50Milliseconds": summary["reliableAbsoluteResidualP50Milliseconds"],
            "reliableAbsoluteResidualP90Milliseconds": summary["reliableAbsoluteResidualP90Milliseconds"],
            "equivalentBpm": clock["equivalentBpm"],
            "endClockResidualMilliseconds": clock["endResidualSeconds"] * 1_000,
            "waveformSupportedTimingCandidates": len(timing["waveformSupportedTimingCandidates"]),
            "additionalTimingReviewCandidates": len(timing["timingReviewCandidates"]),
            "thresholdMetricQueueItems": len(waveform_queue_groups | secondary_queue_groups),
            "allThresholdMetricQueueItemsPreviouslyAdjudicated": True,
            "unadjudicatedTimingQueueItems": 0,
            "missingAttackCandidates": len(timing["missingAttackCandidates"]),
            "allMissingCandidatesPreviouslyVisuallyRejected": True,
            "extraAttackCandidates": len(timing["extraAttackCandidates"]),
            "reviewedE3": {
                "anchorTick": e3_timing["anchorTick"],
                "detrendedResidualMilliseconds": e3_timing["detrendedLocalResidualSeconds"] * 1_000,
                "automaticAuditConfidence": e3_timing["confidence"],
                "detectorResidualRangeMilliseconds": e3_timing["detectorResidualRangeSeconds"] * 1_000,
                "reviewBasis": "independent source transients plus expert comparison; not a high-confidence automatic detector claim",
                "remainsInTimingQueue": False,
            },
        },
        "handoff": {
            **handoff,
            "policy": "cross-boundary bass tails are retained; no attack is fabricated at tick 24000",
        },
        "heldOut": held_out,
        "render": {
            "approvalContentSha256": provenance["candidate"]["approvalContentSha256"],
            "midiSha256": provenance["midi"]["sha256"],
            "wavSha256": provenance["output"]["sha256"],
            "byteIdenticalRerender": provenance["verification"]["byteIdentical"],
            "wholeSongABManifest": relative(V7_AB),
            "segmentedAB": ab["segmentedReview"]["path"],
            "e3FocusABManifest": relative(V7_E3_AB),
            "e3FocusSequential": e3_ab["sequential"]["path"],
            "verifiedReferencedArtifacts": verified_ab_references,
            "scoreEndTick": score_end_tick,
            "wholeSongABEndTick": ab_end_tick,
            "lastAudibleEventEndTick": audible_end_tick,
            "coverage": "all audible events; the omitted final 40 ticks are silence",
        },
        "limits": {
            "audited": "all event records, pitches and onsets",
            "notClaimed": "550 frame-exact physical key-off times",
            "durationReason": "pedal, resonance, detector segmentation and spectral decay make note-off less observable than attack",
            "onlyHeldPitchCandidate": "D4@40295",
        },
        "noteAuditRows": len(note_rows),
    }
    return output, note_rows


def write(output: dict[str, Any], note_rows: list[dict[str, Any]]) -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    json_path = OUTPUT / "take-five-v7-video-comparison.json"
    csv_path = OUTPUT / "all-notes-with-5-4-beats.csv"
    readme_path = OUTPUT / "README.md"
    json_path.write_text(json.dumps(output, indent=2) + "\n")
    with csv_path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(note_rows[0]))
        writer.writeheader()
        writer.writerows(note_rows)

    score = output["score"]
    v5 = output["comparisonFromV5"]
    v6 = output["comparisonFromV6"]
    pitch = output["pitchCoverage"]
    timing = output["timingCoverage"]
    handoff = output["handoff"]
    held = output["heldOut"][0]
    render = output["render"]
    readme = f"""# Take Five V7 · 全音符 / 全节拍视频复核

结论：V7 已完成第二轮全视频复核与集成门禁，但仍是 **provisional / unapproved**；产品继续使用历史 555-note baseline。

## 全量覆盖

- 固定谱音符：`{score['notes']}/{score['notes']}`；Bass `{score['roleCounts']['bass']}`、Comp `{score['roleCounts']['comp']}`、Lead `{score['roleCounts']['lead']}`。
- 物理击键：`{score['physicalStrikes']}/{score['physicalStrikes']}`；5/4 计量桶：`{score['bars']}/{score['bars']}`（35 个完整小节 + 1 个 1860-tick 的空白残尾桶，不把它算成完整第 36 小节）。
- 已复核 V5 的 534 个既有音符、335 个既有 strike，以及汇总的 135 个异常 tick；既有音符 onset 移动数为 `{v5['commonEventOnsetMoves']}`。
- 音高检测逐音覆盖 `{pitch['scoreEvents']}/{pitch['scoreEvents']}`，严格同音匹配 `{pitch['strictSamePitchMatches']}`，≥3/4 配置支持 `{pitch['consensusSupported']}`；高置信未裁决漏音/假音均为 `0`。
- timing 可靠残差 P50/P90 为 `{timing['reliableAbsoluteResidualP50Milliseconds']:.2f}/{timing['reliableAbsoluteResidualP90Milliseconds']:.2f} ms`；等效速度 `{timing['equivalentBpm']:.4f} BPM`，尾端 clock 残差 `{timing['endClockResidualMilliseconds']:.3f} ms`。
- 当前 15 个 waveform 指标与 53 个 secondary timing 指标均已映射到既有人工裁决；9 个 missing-attack 指标也全部映射到既有 reject，未裁决 timing 项为 `0`。
- 唯一自动转录 unmatched 事件 `bass-028` 已有视频人工 retain 裁决；其余 11 个 consensus 候选均为 10 reject + 1 hold，并非新的未处理漏音。
- same-key MIDI lifecycle collision：`0`。

逐音清单 `all-notes-with-5-4-beats.csv` 含 550 行：event、role、tick、duration、end、MIDI、力度、5/4 小节/拍位、3+2 分组、视频秒数、物理 strike、pitch/timing 证据及裁决。5/4/3+2 仅用于定位，不能反向量化 performed tick。

## 相对 V5 的完整变更

- 新增视频确认漏音 `{v5['added']}` 个。
- 删除误切分 `lead-147 F#4@61080` 1 个。
- 六个前驱音仅缩短 1 tick，以保证同音重击的 note-off 先于 note-on。
- 共同事件 onset 移动：`0`。
- `{held['tick']} {held['noteName']}` 继续 hold：{held['reason']}。

## 相对 V6 的唯一变更

- 仅 `{v6['eventId']}`：E3 `start 76318 / duration 204` → `start 76273 / duration 249`，结束 tick 始终为 `{v6['preservedEndTick']}`；role=Comp、MIDI=52、velocity=51 不变。
- 其余 `{v6['unchanged']}` 个音符完全不变，其他 onset 移动为 `0`。
- V7 新鲜 timing audit 中该 E3 的去趋势残差为 `{timing['reviewedE3']['detrendedResidualMilliseconds']:.3f} ms`，已退出 timing exception queue。自动 audit 的局部 confidence 仍为 `{timing['reviewedE3']['automaticAuditConfidence']}`（detector peak spread `{timing['reviewedE3']['detectorResidualRangeMilliseconds']:.2f} ms`），所以这是源瞬态支持的专家修订，不宣称为高置信自动检测。

## 审计边界

- 已逐条审计 550 个事件记录、音高和 onset；不能声称 550 个物理 key-off 都有逐帧精确真值。
- 当前仍有 `{pitch['detectorDurationReviewHints']}` 个 detector-duration 与 `{pitch['spectrumDurationReviewHints']}` 个 spectrum-duration 提示；它们主要反映踏板、共鸣、自然衰减和转录分段，不会反向改写已冻结的 attack tick。
- 唯一继续 hold 的音高候选是 `D4@40295`；没有把不确定证据偷偷写入固定谱。

## 15 秒声部交接

- tick 24000 后 Bass 新攻击：`{handoff['bassAttacksAtOrAfterTick24000']}`；tick 24000 前 Comp 攻击：`{handoff['compAttacksBeforeTick24000']}`。
- 最后 Bass attack `{handoff['lastBassAttackTick']}`，尾音自然延续到 `{handoff['lastBassTailTick']}`；第一 Comp attack `{handoff['firstCompAttackTick']}`。
- 不截断跨段尾音，也不在边界伪造攻击；Lead 贯穿结构。

## 审听与溯源

- 分段完整 A/B：`{render['segmentedAB']}`。
- 完整 A/B manifest：`{render['wholeSongABManifest']}`。
- E3 局部 A/B：`{render['e3FocusSequential']}`。
- MIDI SHA-256：`{render['midiSha256']}`。
- WAV SHA-256：`{render['wavSha256']}`；独立重渲染逐字节一致。
- 两份 A/B manifest 的 `{render['verifiedReferencedArtifacts']}` 个文件引用及 SHA-256 全部复算通过；全曲 A/B 覆盖至 tick `{render['wholeSongABEndTick']}`，最后有声事件结束于 `{render['lastAudibleEventEndTick']}`，相对 score 末尾少的 40 ticks 只有静音。
- approval content SHA-256：`{render['approvalContentSha256']}`。

当前结论只冻结 V7 作为待审听候选；没有批准，也没有切换产品路由。
"""
    readme_path.write_text(readme)
    print(readme_path)
    print(csv_path)
    print(json_path)


if __name__ == "__main__":
    result, rows = build()
    write(result, rows)
