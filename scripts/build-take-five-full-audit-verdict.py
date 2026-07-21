#!/usr/bin/env python3
"""Build the complete human-reviewed Take Five v5 audit verdict.

This script does not mutate the replica score.  It joins the full machine
pitch/timing audits with the exhaustive frame review and fails unless every
existing score note and every emitted exception receives an explicit outcome.
The resulting delta manifest is the sole input specification for a later,
independent score revision.
"""

from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
AUDIT_ROOT = ROOT / "tmp/video-replica/take-five-full-curation-v5/full-audit"
PITCH_PATH = AUDIT_ROOT / "pitch/full-pitch-audit.json"
TIMING_PATH = AUDIT_ROOT / "timing/full-timing-audit.json"
VISUAL_PATH = AUDIT_ROOT / "visual-exhaustive/exhaustive-exception-visuals.json"
OUTPUT = AUDIT_ROOT / "verdict"

TICK_ZERO_VIDEO_SECONDS = 1.547
TICKS_PER_SECOND = 1600.0


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


# Final adjudication after the exhaustive visual second pass and an independent
# opening review.  40295 remains intentionally unresolved: its pitch-specific
# audio is credible, but the source frames show no physical D4 key contact.
OMISSION_DECISIONS: dict[int, tuple[str, str, float]] = {
    3378: ("add", "left-hand D3 contact plus three-config/spectral onset; short pickup into the next D3 reattack", 0.88),
    6297: ("reject", "F#5 key is untouched; detector follows the sounding F#4 octave partial", 0.99),
    8156: ("add", "right-hand B3 contact joins F#3 five ticks later", 0.82),
    8379: ("add", "low E2 key contact supplies the root under the chord five ticks later", 0.72),
    10107: ("add", "left-hand B2 contact forms the B2-F#3-B3 foundation", 0.80),
    10555: ("add", "visible D3 to F#3 roll with four decoder configurations and strong onset rise", 0.90),
    11112: ("reject", "G3 key has no distinct contact and local pitch contrast is negative", 0.82),
    12097: ("reject", "F#5 key is untouched while F#4 remains sounding", 0.99),
    15591: ("add", "visible D3 to F#3 roll plus strong independent D3 onset", 0.95),
    21799: ("reject", "E5 key is untouched; cluster is the upper octave of the held E4", 0.99),
    39533: ("add", "left-hand C3 contact is near-synchronous with C5", 0.84),
    39552: ("reject", "C2 key is outside the hand and belongs to the C3/C5 octave ambiguity", 0.99),
    40295: ("hold", "three-config pitch audio is credible, but consecutive frames show D4 in the gap between both hands", 0.70),
    40555: ("add", "left-hand G3 contact and independent onset precede the following D4/C5 roll", 0.82),
    43065: ("add", "left-hand A2 pickup is visible before the following upper attack", 0.80),
    43288: ("reject", "no independent lift/repress; prior isolated review remains conflicting and below the conservative gate", 0.62),
    44198: ("reject", "A2 key is outside the left hand; cluster coincides with A4", 0.84),
    51186: ("reject", "B2 key has no physical contact and coincides with B4", 0.82),
    54924: ("reject", "Ab3 key has no new contact and coincides with Ab4; spectrum is at the 3.4th percentile", 0.94),
    54980: ("reject", "no E3 reattack is visible under the already sounding E4", 0.91),
    59682: ("add", "left thumb contacts D3 at the start of the D3-A2-D2 descending roll", 0.97),
    59775: ("add", "left hand contacts A2 between the observed D3 and retained D2 attacks", 0.96),
    60536: ("add", "right hand physically attacks and holds F#4 until the genuine reattack at 61212", 0.96),
    63994: ("add", "left-hand A2 and retained A3 form a visible rolled octave", 0.86),
    67546: ("add", "right-hand D5 contact precedes A4 by 23 ticks", 0.89),
    73622: ("add", "right-hand G4 contact and three decoder configurations support a sustained upper note", 0.85),
    76169: ("add", "left-hand A2 contact belongs to the wide A2-C3-G3-C4-E4-G4 voicing", 0.81),
    76318: ("add", "left-hand E3 contact and strong spectrum support a later inner-voice roll-in", 0.87),
}


ADDITION_ROLE: dict[int, str] = {
    3378: "bass", 8156: "lead", 8379: "bass", 10107: "bass", 10555: "bass", 15591: "bass",
    39533: "comp", 40555: "comp", 43065: "comp", 59682: "comp", 59775: "comp", 60536: "lead",
    63994: "comp", 67546: "lead", 73622: "lead", 76169: "comp", 76318: "comp",
}


ADDITION_VELOCITY: dict[int, int] = {
    3378: 60, 8156: 51, 8379: 55, 10107: 55, 10555: 52, 15591: 55,
    39533: 50, 40555: 50, 43065: 57, 59682: 51, 59775: 51, 60536: 57,
    63994: 56, 67546: 51, 73622: 70, 76169: 54, 76318: 51,
}


# Join only when the observed onset falls inside the fixed 32-tick physical
# strike tolerance.  Otherwise the addition remains an independent strike even
# when it participates in a larger audible roll.
RELATED_STRIKE_GROUP: dict[int, str] = {
    3378: "strike-009", 8156: "strike-029", 8379: "strike-030", 10107: "strike-038",
    10555: "strike-039", 15591: "strike-062", 39533: "strike-152", 59775: "strike-246",
    60536: "strike-248", 63994: "strike-265", 67546: "strike-281", 76169: "strike-320",
}


LIFECYCLE_CORRECTIONS = {
    "bass-006": (501, "bass-008"),
    "bass-037": (148, "bass-038"),
    "bass-058": (501, "bass-059"),
    "bass-069": (501, "bass-071"),
    "bass-084": (278, "bass-087"),
    "lead-042": (445, "lead-044"),
}


def build() -> dict[str, Any]:
    pitch = json.loads(PITCH_PATH.read_text())
    timing = json.loads(TIMING_PATH.read_text())
    visual = json.loads(VISUAL_PATH.read_text())

    omission_rows = [row for row in pitch["omissionReview"] if row["classification"] == "consensus-omission-review"]
    omission_ticks = {int(row["startTickMedian"]) for row in omission_rows}
    if omission_ticks != set(OMISSION_DECISIONS):
        raise AssertionError(f"omission decision coverage mismatch: audit={sorted(omission_ticks)} decisions={sorted(OMISSION_DECISIONS)}")

    weak_rows = pitch["falsePositiveReview"]
    weak_ids = {str(row["eventId"]) for row in weak_rows}
    if len(weak_rows) != 36 or "lead-147" not in weak_ids:
        raise AssertionError("weak-score queue changed; manual verdict must be repeated")

    score_verdicts = []
    for row in pitch["scoreEvents"]:
        event_id = str(row["eventId"])
        decision = "remove-merge-prior-hold" if event_id == "lead-147" else "retain"
        basis = (
            "continuous F#4 hold from observed 60536; no physical reattack at 61080"
            if event_id == "lead-147"
            else ("manual visual exception review" if event_id in weak_ids else "full detector-plus-spectrum audit")
        )
        score_verdicts.append({
            "eventId": event_id,
            "role": row["role"],
            "startTick": row["startTick"],
            "durationTicks": row["durationTicks"],
            "midi": row["midi"],
            "velocity": row["velocity"],
            "decision": decision,
            "basis": basis,
        })
    if len(score_verdicts) != 534 or len({row["eventId"] for row in score_verdicts}) != 534:
        raise AssertionError("existing score verdict must cover 534 unique events")
    if sum(row["decision"] == "retain" for row in score_verdicts) != 533:
        raise AssertionError("expected exactly 533 retained v5 score events")

    additions = []
    omission_verdicts = []
    for row in omission_rows:
        tick = int(row["startTickMedian"])
        decision, reason, confidence = OMISSION_DECISIONS[tick]
        omission_verdicts.append({
            "clusterId": row["clusterId"],
            "tick": tick,
            "midi": int(row["midi"]),
            "noteName": row["noteName"],
            "decision": decision,
            "confidence": confidence,
            "reason": reason,
            "detectorConfigCount": row["configCount"],
            "durationTicksMedian": row["durationTicksMedian"],
            "amplitudeMedian": row["amplitudeMedian"],
            "sourceSpectrum": row["sourceSpectrum"],
            "relatedEvidenceIds": row["relatedStrikeEventIds"],
        })
        if decision != "add":
            continue
        seconds = TICK_ZERO_VIDEO_SECONDS + tick / TICKS_PER_SECOND
        note_name_slug = str(row["noteName"]).replace("#", "s").replace("b", "f").lower()
        additions.append({
            "observationId": f"observed-v6-{tick:05d}-{note_name_slug}",
            "role": ADDITION_ROLE[tick],
            "performedStartTick": tick,
            "performedDurationTicks": int(row["durationTicksMedian"]),
            "midi": int(row["midi"]),
            "velocity": ADDITION_VELOCITY[tick],
            "sourceVideoWindowSeconds": [round(seconds - 0.105, 6), round(seconds + 0.105, 6)],
            "relatedEvidenceIds": row["relatedStrikeEventIds"],
            **({"relatedStrikeGroupId": RELATED_STRIKE_GROUP[tick]} if tick in RELATED_STRIKE_GROUP else {}),
            "reason": reason,
            "method": "exhaustive-video-key-contact-plus-three-threshold-pitch-plus-source-spectrum; velocity-from-role-specific-detector-amplitude-regression",
            "status": "provisional",
        })

    strong_ticks = {int(row["anchorTick"]) for row in timing["waveformSupportedTimingCandidates"]}
    secondary_ticks = {int(row["anchorTick"]) for row in timing["timingReviewCandidates"]}
    timing_verdicts = []
    for row in timing["strikes"]:
        tick = int(row["anchorTick"])
        if tick in strong_ticks:
            review_class = "waveform-supported-review"
        elif tick in secondary_ticks:
            review_class = "secondary-review"
        else:
            review_class = "full-strike-audit"
        timing_verdicts.append({
            "groupId": row["groupId"],
            "anchorTick": tick,
            "decision": "retain-onset-no-move",
            "reviewClass": review_class,
            "confidence": row["confidence"],
            "detrendedLocalResidualSeconds": row["detrendedLocalResidualSeconds"],
            "reason": "source-video frame rate cannot support a sub-frame move; no independent attack contradicts the performed tick",
        })
    if len(timing_verdicts) != 335:
        raise AssertionError("timing verdict must cover all 335 retained physical strikes")

    missing = [{**row, "decision": "reject-as-new-attack"} for row in timing["missingAttackCandidates"]]
    extras = [{**row, "decision": "retain-score-attack"} for row in timing["extraAttackCandidates"]]
    lifecycle = []
    for row in timing["currentRemainingSameKeyLifecycleCollisions"]:
        predecessor = str(row["predecessorEventId"])
        expected_duration, successor = LIFECYCLE_CORRECTIONS[predecessor]
        if successor != row["successorEventId"]:
            raise AssertionError(f"lifecycle successor changed for {predecessor}")
        lifecycle.append({
            **row,
            "decision": "shorten-predecessor-duration-only",
            "correctedPredecessorDurationTicks": expected_duration,
            "correctedPredecessorEndTick": row["successorOnsetTick"],
            "successorOnsetMoved": False,
        })
    if len(lifecycle) != 6:
        raise AssertionError("expected all six opening lifecycle collisions")

    if int(visual["counts"]["uniqueTargetTicks"]) != 135:
        raise AssertionError("exhaustive visual queue changed")

    add_counts = {role: sum(row["role"] == role for row in additions) for role in ("bass", "comp", "lead")}
    expected_tracks = {"bass": 91 + add_counts["bass"], "comp": 274 + add_counts["comp"], "lead": 169 + add_counts["lead"] - 1}
    output = {
        "schemaVersion": 1,
        "status": "complete-v5-audit-verdict; score mutation forbidden; one omission remains isolated hold",
        "truthPolicy": {
            "performedTickAuthority": "source performance; nominal 5/4 and 3+2 are annotations only",
            "frameTimingLimit": "24fps frames cannot authorize 8-30ms onset changes",
            "scoreRevisionPolicy": "only add/remove/duration facts listed in proposedDelta may enter an independent next candidate",
        },
        "inputs": {
            "pitch": {"path": str(PITCH_PATH.relative_to(ROOT)), "sha256": sha256(PITCH_PATH)},
            "timing": {"path": str(TIMING_PATH.relative_to(ROOT)), "sha256": sha256(TIMING_PATH)},
            "visual": {"path": str(VISUAL_PATH.relative_to(ROOT)), "sha256": sha256(VISUAL_PATH)},
        },
        "coverage": {
            "existingScoreEvents": {"audited": len(score_verdicts), "retain": 533, "removeMerge": 1},
            "retainedPhysicalStrikes": {"audited": len(timing_verdicts), "onsetMoves": 0},
            "consensusOmissionCandidates": {
                "audited": len(omission_verdicts),
                "add": sum(row["decision"] == "add" for row in omission_verdicts),
                "reject": sum(row["decision"] == "reject" for row in omission_verdicts),
                "hold": sum(row["decision"] == "hold" for row in omission_verdicts),
            },
            "weakScoreQueue": {"audited": len(weak_rows), "retain": 35, "removeMerge": 1},
            "missingAttackQueue": {"audited": len(missing), "add": 0, "reject": len(missing)},
            "extraAttackQueue": {"audited": len(extras), "retain": len(extras), "remove": 0},
            "sameKeyLifecycleQueue": {"audited": len(lifecycle), "durationOnlyRepairs": len(lifecycle)},
        },
        "proposedDelta": {
            "baseScoreNotes": 534,
            "additions": additions,
            "removals": [{"eventId": "lead-147", "reason": "false split inside the observed F#4 hold from 60536 to 61207"}],
            "durationCorrections": lifecycle,
            "onsetMoves": [],
            "heldOut": [row for row in omission_verdicts if row["decision"] == "hold"],
            "expectedCandidateNoteCount": 534 + len(additions) - 1,
            "expectedTrackNoteCounts": expected_tracks,
        },
        "scoreEventVerdicts": score_verdicts,
        "omissionVerdicts": omission_verdicts,
        "timingVerdicts": timing_verdicts,
        "missingAttackVerdicts": missing,
        "extraAttackVerdicts": extras,
        "lifecycleVerdicts": lifecycle,
    }
    return output


def write(output: dict[str, Any]) -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    json_path = OUTPUT / "full-audit-verdict.json"
    json_path.write_text(json.dumps(output, indent=2) + "\n")
    with (OUTPUT / "score-event-verdicts.csv").open("w", newline="") as handle:
        fields = ["eventId", "role", "startTick", "durationTicks", "midi", "velocity", "decision", "basis"]
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(output["scoreEventVerdicts"])
    with (OUTPUT / "omission-verdicts.csv").open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["clusterId", "tick", "midi", "noteName", "decision", "confidence", "durationTicksMedian", "reason"])
        for row in output["omissionVerdicts"]:
            writer.writerow([row[key] for key in ("clusterId", "tick", "midi", "noteName", "decision", "confidence", "durationTicksMedian", "reason")])

    coverage = output["coverage"]
    delta = output["proposedDelta"]
    hold = delta["heldOut"][0]
    readme = f"""# Take Five v5 · complete video comparison verdict

Every one of the 534 score notes and 335 retained physical strikes has a machine audit row. Every exception emitted by those audits was then reviewed against source-video frames.

## Coverage

- existing score events: `{coverage['existingScoreEvents']['audited']}/534` — retain `533`, remove/merge `1`
- retained physical strikes: `{coverage['retainedPhysicalStrikes']['audited']}/335` — onset moves `0`
- weak-score exceptions: `{coverage['weakScoreQueue']['audited']}/36`
- consensus omission candidates: `{coverage['consensusOmissionCandidates']['audited']}/28` — add `{coverage['consensusOmissionCandidates']['add']}`, reject `{coverage['consensusOmissionCandidates']['reject']}`, hold `{coverage['consensusOmissionCandidates']['hold']}`
- possible missing attacks: `{coverage['missingAttackQueue']['audited']}/10` — all rejected as new attacks
- possible extra attacks: `{coverage['extraAttackQueue']['audited']}/2` — both retained
- same-key lifecycle collisions: `{coverage['sameKeyLifecycleQueue']['audited']}/6` — predecessor duration only; successor onset unchanged

## Authorized next-candidate delta

- add `{len(delta['additions'])}` source-observed notes
- remove `lead-147 F#4@61080`, which is a false split inside the observed F#4 hold beginning at tick 60536
- shorten six opening predecessor durations by exactly one tick
- move **zero** performed onsets
- expected note count: `{delta['expectedCandidateNoteCount']}`; tracks `{json.dumps(delta['expectedTrackNoteCounts'], sort_keys=True)}`

## Deliberately unresolved

`{hold['tick']} {hold['noteName']}` stays outside the fixed score: {hold['reason']}. It requires an isolated A/B or stronger physical-key evidence; it must not be silently promoted.

The metric grid remains descriptive. No 5/4, 3+2, GrooveContract or Arranger layer may quantize these performed ticks.
"""
    (OUTPUT / "README.md").write_text(readme)


def main() -> None:
    output = build()
    write(output)
    print(json.dumps({
        "coverage": output["coverage"],
        "expectedCandidateNoteCount": output["proposedDelta"]["expectedCandidateNoteCount"],
        "output": str((OUTPUT / "full-audit-verdict.json").relative_to(ROOT)),
    }, indent=2))


if __name__ == "__main__":
    main()
