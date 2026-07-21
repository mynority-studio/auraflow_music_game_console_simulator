#!/usr/bin/env python3
"""Compare a curated VideoReplica score with multi-threshold pitch evidence.

This is a read-only review queue generator.  Detector consensus is not musical
truth and is never imported into VideoReplicaScore automatically.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import statistics
from pathlib import Path
from typing import Any


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def score_events(payload: dict[str, Any], start_tick: int, end_tick: int) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for role, track in payload["tracks"].items():
        for note in track["notes"]:
            tick = int(note["performedStartTick"])
            if start_tick <= tick < end_tick:
                events.append({
                    "eventId": note["eventId"],
                    "role": role,
                    "startTick": tick,
                    "durationTicks": int(note["performedDurationTicks"]),
                    "midi": int(note["midi"]),
                    "velocity": int(note["velocity"]),
                })
    return sorted(events, key=lambda event: (event["startTick"], event["midi"], event["role"]))


def detector_clusters(
    payload: dict[str, Any],
    start_tick: int,
    end_tick: int,
    onset_tolerance_ticks: int,
) -> list[dict[str, Any]]:
    flat: list[dict[str, Any]] = []
    for decoding in payload["decodings"]:
        for event in decoding["events"]:
            tick = int(event["performedStartTick"])
            if start_tick <= tick < end_tick:
                flat.append({
                    "configId": decoding["id"],
                    "startTick": tick,
                    "durationTicks": int(event["performedDurationTicks"]),
                    "midi": int(event["midi"]),
                    "amplitude": float(event["amplitude"]),
                })
    flat.sort(key=lambda event: (event["midi"], event["startTick"], event["configId"]))

    clusters: list[dict[str, Any]] = []
    current: list[dict[str, Any]] = []
    anchor: int | None = None
    current_midi: int | None = None
    for event in flat:
        begins_new = (
            not current
            or event["midi"] != current_midi
            or anchor is None
            or event["startTick"] - anchor > onset_tolerance_ticks
        )
        if begins_new:
            if current:
                clusters.append(summarize_cluster(current))
            current = [event]
            anchor = event["startTick"]
            current_midi = event["midi"]
        else:
            current.append(event)
    if current:
        clusters.append(summarize_cluster(current))
    return sorted(clusters, key=lambda cluster: (cluster["startTickMedian"], cluster["midi"]))


def summarize_cluster(events: list[dict[str, Any]]) -> dict[str, Any]:
    config_ids = sorted({event["configId"] for event in events})
    return {
        "midi": events[0]["midi"],
        "startTickAnchor": min(event["startTick"] for event in events),
        "startTickMedian": round(statistics.median(event["startTick"] for event in events)),
        "durationTicksMedian": round(statistics.median(event["durationTicks"] for event in events)),
        "amplitudeMedian": statistics.median(event["amplitude"] for event in events),
        "configCount": len(config_ids),
        "configIds": config_ids,
        "events": events,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sweep", type=Path, required=True)
    parser.add_argument("--score", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--start-tick", type=int, default=24_000)
    parser.add_argument("--end-tick", type=int, default=85_860)
    parser.add_argument("--cluster-tolerance-ticks", type=int, default=80)
    parser.add_argument("--match-tolerance-ticks", type=int, default=100)
    parser.add_argument("--consensus-configs", type=int, default=3)
    arguments = parser.parse_args()

    sweep = json.loads(arguments.sweep.read_text())
    score = json.loads(arguments.score.read_text())
    notes = score_events(score, arguments.start_tick, arguments.end_tick)
    clusters = detector_clusters(
        sweep,
        arguments.start_tick,
        arguments.end_tick,
        arguments.cluster_tolerance_ticks,
    )

    unused_cluster_ids = set(range(len(clusters)))
    matches: list[dict[str, Any]] = []
    unsupported_score_events: list[dict[str, Any]] = []
    for note in notes:
        candidates = [
            index for index in unused_cluster_ids
            if clusters[index]["midi"] == note["midi"]
            and abs(clusters[index]["startTickMedian"] - note["startTick"]) <= arguments.match_tolerance_ticks
        ]
        if not candidates:
            unsupported_score_events.append(note)
            continue
        cluster_index = min(
            candidates,
            key=lambda index: abs(clusters[index]["startTickMedian"] - note["startTick"]),
        )
        unused_cluster_ids.remove(cluster_index)
        cluster = clusters[cluster_index]
        matches.append({
            "score": note,
            "detector": cluster,
            "startDeltaTicks": cluster["startTickMedian"] - note["startTick"],
            "durationDeltaTicks": cluster["durationTicksMedian"] - note["durationTicks"],
        })

    unmatched_clusters = [clusters[index] for index in sorted(unused_cluster_ids)]
    duplicate_attack_queue: list[dict[str, Any]] = []
    continuation_queue: list[dict[str, Any]] = []
    octave_partial_queue: list[dict[str, Any]] = []
    omission_queue: list[dict[str, Any]] = []
    for cluster in unmatched_clusters:
        if cluster["configCount"] < arguments.consensus_configs:
            continue
        same_pitch_attacks = [
            note for note in notes
            if note["midi"] == cluster["midi"]
            and abs(note["startTick"] - cluster["startTickMedian"]) <= arguments.match_tolerance_ticks
        ]
        if same_pitch_attacks:
            duplicate_attack_queue.append({"detector": cluster, "relatedScoreEvents": same_pitch_attacks})
            continue
        same_pitch_spans = [
            note for note in notes
            if note["midi"] == cluster["midi"]
            and note["startTick"] + arguments.match_tolerance_ticks < cluster["startTickMedian"]
            <= note["startTick"] + note["durationTicks"] + arguments.match_tolerance_ticks
        ]
        if same_pitch_spans:
            continuation_queue.append({"detector": cluster, "relatedScoreEvents": same_pitch_spans})
            continue
        lower_octave_attacks = [
            note for note in notes
            if cluster["midi"] - note["midi"] in (12, 24)
            and abs(cluster["startTickMedian"] - note["startTick"]) <= arguments.match_tolerance_ticks
        ]
        if lower_octave_attacks:
            octave_partial_queue.append({"detector": cluster, "relatedScoreEvents": lower_octave_attacks})
            continue
        omission_queue.append(cluster)
    duration_queue = [
        match for match in matches
        if match["detector"]["configCount"] >= arguments.consensus_configs
        and abs(match["durationDeltaTicks"]) >= 240
    ]

    output = {
        "schemaVersion": 1,
        "truthPolicy": "review queue only; detector consensus requires source video/audio corroboration and is never auto-imported",
        "inputs": {
            "sweep": {"path": str(arguments.sweep.resolve()), "sha256": sha256(arguments.sweep)},
            "score": {"path": str(arguments.score.resolve()), "sha256": sha256(arguments.score)},
            "sourceAudio": sweep.get("audio"),
        },
        "window": {"startTick": arguments.start_tick, "endTick": arguments.end_tick},
        "tolerances": {
            "clusterOnsetTicks": arguments.cluster_tolerance_ticks,
            "scoreMatchTicks": arguments.match_tolerance_ticks,
            "minimumConsensusConfigs": arguments.consensus_configs,
        },
        "counts": {
            "scoreEvents": len(notes),
            "detectorClusters": len(clusters),
            "matches": len(matches),
            "unsupportedScoreEvents": len(unsupported_score_events),
            "consensusOmissionQueue": len(omission_queue),
            "consensusDuplicateAttackQueue": len(duplicate_attack_queue),
            "consensusContinuationQueue": len(continuation_queue),
            "consensusOctavePartialQueue": len(octave_partial_queue),
            "durationReviewQueue": len(duration_queue),
        },
        "unsupportedScoreEvents": unsupported_score_events,
        "consensusOmissionQueue": omission_queue,
        "consensusDuplicateAttackQueue": duplicate_attack_queue,
        "consensusContinuationQueue": continuation_queue,
        "consensusOctavePartialQueue": octave_partial_queue,
        "durationReviewQueue": duration_queue,
        "matches": matches,
    }
    arguments.out.parent.mkdir(parents=True, exist_ok=True)
    arguments.out.write_text(json.dumps(output, indent=2) + "\n")
    print(arguments.out)


if __name__ == "__main__":
    main()
