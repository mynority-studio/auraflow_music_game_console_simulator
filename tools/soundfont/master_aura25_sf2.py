#!/usr/bin/env python3
"""Finalize the Aura25 SoundFont as an embedded master bank.

This pass is deliberately SF2-internal. It does not rely on Copych post-chain
gain, EQ, clipping, or any renderer-side compensation. The goal is to make the
bank easier to reason about on ESP32-class synths:

* every effective sample zone gets an explicit gen48 InitialAttenuation;
* known missing/unsafe zones receive conservative attenuation at the SF2 layer;
* the chorused FM EP keeps its character, but negative/near-hot wave-layer gain
  is pulled back into a safer range before any shared effects are applied;
* a machine-readable and human-readable asset audit is emitted.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from clean_aura25_sf2 import GEN_INITIAL_ATTENUATION, GenRef, Zone, _signed16, collect_zones
from level_aura25_sf2 import _rebuild_sf2
from subset_sf2 import INST, PBAG, PGEN, PHDR, SHDR, _clean_name, _sf_name, parse_sf2, records

GEN_INSTRUMENT = 41
GEN_KEY_RANGE = 43
GEN_VEL_RANGE = 44
GEN_SAMPLE_ID = 53

FM_EP_SELECTOR = (8, 5)
SAX_SELECTOR = (0, 67)
BRUSH_SELECTOR = (128, 40)

# Keep the FM EP wave oscillator below unity-style internal gain. This still
# leaves it obviously chorused/FM, but removes the SF2-level "hot layer" smell.
FM_WAVE_MIN_ATTENUATION_CB = 40


@dataclass(frozen=True)
class Insertion:
    ibag_index: int
    insert_index: int
    amount_cb: int
    selector: tuple[int, int]
    sample_id: int
    key_range: tuple[int, int]
    reason: str


@dataclass(frozen=True)
class Patch:
    chunk: bytes
    index: int
    old: int
    new: int
    reason: str


def _pack_u16(value: int) -> int:
    return value & 0xFFFF


def _dict(gens: list[tuple[int, int]]) -> dict[int, int]:
    return {oper: amount for oper, amount in gens}


def _range_from_amount(amount: int | None) -> tuple[int, int]:
    if amount is None:
        return (0, 127)
    return amount & 0xFF, (amount >> 8) & 0xFF


def _intersect(a: tuple[int, int], b: tuple[int, int]) -> tuple[int, int] | None:
    lo = max(a[0], b[0])
    hi = min(a[1], b[1])
    return (lo, hi) if lo <= hi else None


def _gens_for_bag(bags: list[tuple[int, int]], gens: list[tuple[int, int]], bag_i: int) -> list[tuple[int, int]]:
    gen_start, _mod_start = bags[bag_i]
    gen_end, _mod_end = bags[bag_i + 1]
    return list(gens[gen_start:gen_end])


def _has_attenuation(*gen_groups: list[tuple[int, int]]) -> bool:
    return any(oper == GEN_INITIAL_ATTENUATION for gens in gen_groups for oper, _amount in gens)


def _missing_zone_amount_cb(selector: tuple[int, int], key_range: tuple[int, int]) -> tuple[int, str]:
    if selector == SAX_SELECTOR and key_range[1] <= 40:
        return 90, "baritone-sax-low-zone-master-attenuation"
    if selector == BRUSH_SELECTOR:
        return 82, "brush-kit-missing-zone-explicit-master-attenuation"
    return 0, "explicit-zero-master-attenuation"


def _collect_missing_attenuation_insertions(source: Path) -> list[Insertion]:
    sf = parse_sf2(source)
    pdta = sf[b"pdta"]
    phdrs = records(pdta.chunks[b"phdr"], PHDR)
    pbags = records(pdta.chunks[b"pbag"], PBAG)
    pgens = records(pdta.chunks[b"pgen"], PGEN)
    insts = records(pdta.chunks[b"inst"], INST)
    ibags = records(pdta.chunks[b"ibag"], PBAG)
    igens = records(pdta.chunks[b"igen"], PGEN)

    insertions: dict[int, Insertion] = {}

    for preset_i, ph in enumerate(phdrs[:-1]):
        _name, preset, bank, bag_start, *_ = ph
        selector = (bank, preset)
        pglobal: list[tuple[int, int]] = []

        for pbag_i in range(bag_start, phdrs[preset_i + 1][3]):
            pzone_gens = _gens_for_bag(pbags, pgens, pbag_i)
            pzone = _dict(pzone_gens)
            if GEN_INSTRUMENT not in pzone:
                pglobal = pzone_gens
                continue

            pkey = _intersect(
                _range_from_amount(_dict(pglobal).get(GEN_KEY_RANGE)),
                _range_from_amount(pzone.get(GEN_KEY_RANGE)),
            )
            pvel = _intersect(
                _range_from_amount(_dict(pglobal).get(GEN_VEL_RANGE)),
                _range_from_amount(pzone.get(GEN_VEL_RANGE)),
            )
            if pkey is None or pvel is None:
                continue

            inst_i = pzone[GEN_INSTRUMENT]
            iglobal: list[tuple[int, int]] = []
            for ibag_i in range(insts[inst_i][1], insts[inst_i + 1][1]):
                izone_gens = _gens_for_bag(ibags, igens, ibag_i)
                izone = _dict(izone_gens)
                if GEN_SAMPLE_ID not in izone:
                    iglobal = izone_gens
                    continue
                if _has_attenuation(pglobal, pzone_gens, iglobal, izone_gens):
                    continue

                ikey = _range_from_amount(izone.get(GEN_KEY_RANGE, _dict(iglobal).get(GEN_KEY_RANGE)))
                ivel = _range_from_amount(izone.get(GEN_VEL_RANGE, _dict(iglobal).get(GEN_VEL_RANGE)))
                key_range = _intersect(pkey, ikey)
                vel_range = _intersect(pvel, ivel)
                if key_range is None or vel_range is None:
                    continue

                gen_start, _mod_start = ibags[ibag_i]
                sample_pos = next((i for i, (oper, _amount) in enumerate(izone_gens) if oper == GEN_SAMPLE_ID), None)
                if sample_pos is None:
                    continue

                amount_cb, reason = _missing_zone_amount_cb(selector, key_range)
                current = insertions.get(ibag_i)
                if current is None or amount_cb > current.amount_cb:
                    insertions[ibag_i] = Insertion(
                        ibag_index=ibag_i,
                        insert_index=gen_start + sample_pos,
                        amount_cb=amount_cb,
                        selector=selector,
                        sample_id=izone[GEN_SAMPLE_ID],
                        key_range=key_range,
                        reason=reason,
                    )

    return sorted(insertions.values(), key=lambda item: item.insert_index)


def _attenuation_total(zone: Zone, patches: dict[tuple[bytes, int], Patch] | None = None) -> int:
    total = 0
    patches = patches or {}
    for refs in (zone.pglobal_refs, zone.pzone_refs, zone.iglobal_refs, zone.izone_refs):
        for ref in refs:
            if ref.oper != GEN_INITIAL_ATTENUATION:
                continue
            patch = patches.get((ref.chunk, ref.index))
            total += _signed16(patch.new if patch is not None else ref.amount)
    return total


def _first_local_attenuation_ref(zone: Zone) -> GenRef | None:
    for refs in (zone.pzone_refs, zone.izone_refs, zone.pglobal_refs, zone.iglobal_refs):
        for ref in refs:
            if ref.oper == GEN_INITIAL_ATTENUATION:
                return ref
    return None


def _collect_fm_wave_patches(source: Path) -> list[Patch]:
    zones, shdrs = collect_zones(source)
    patches: dict[tuple[bytes, int], Patch] = {}
    for zone in zones:
        if (zone.bank, zone.program) != FM_EP_SELECTOR:
            continue
        sample_name = _clean_name(shdrs[zone.sample_id][0])
        if sample_name != "DX7 Wave":
            continue
        total = _attenuation_total(zone, patches)
        if total >= FM_WAVE_MIN_ATTENUATION_CB:
            continue
        ref = _first_local_attenuation_ref(zone)
        if ref is None:
            continue
        key = (ref.chunk, ref.index)
        current_patch = patches.get(key)
        current = _signed16(current_patch.new if current_patch is not None else ref.amount)
        delta = FM_WAVE_MIN_ATTENUATION_CB - total
        new = max(-120, min(1440, current + delta))
        patches[key] = Patch(
            chunk=ref.chunk,
            index=ref.index,
            old=current_patch.old if current_patch is not None else ref.amount,
            new=_pack_u16(new),
            reason=f"bank8:program5:dx7-wave-master-floor+{delta}cb",
        )
    return sorted(patches.values(), key=lambda patch: (patch.chunk, patch.index))


def _apply_master(source: Path, dest: Path) -> dict[str, object]:
    sf = parse_sf2(source)
    pdta = sf[b"pdta"]
    pgens = records(pdta.chunks[b"pgen"], PGEN)
    ibags = records(pdta.chunks[b"ibag"], PBAG)
    igens = records(pdta.chunks[b"igen"], PGEN)

    patches = _collect_fm_wave_patches(source)
    for patch in patches:
        if patch.chunk == b"pgen":
            pgens[patch.index] = (pgens[patch.index][0], patch.new)
        elif patch.chunk == b"igen":
            igens[patch.index] = (igens[patch.index][0], patch.new)
        else:
            raise ValueError(f"unsupported patch chunk {patch.chunk!r}")

    insertions = _collect_missing_attenuation_insertions(source)
    insertion_indexes = [item.insert_index for item in insertions]
    for offset, insertion in enumerate(insertions):
        igens.insert(insertion.insert_index + offset, (GEN_INITIAL_ATTENUATION, _pack_u16(insertion.amount_cb)))
    if insertions:
        # Shift every ibag whose original generator cursor is at/after each insertion.
        shifted: list[tuple[int, int]] = []
        for gen_index, mod_index in ibags:
            shift = sum(1 for insert_index in insertion_indexes if insert_index <= gen_index)
            shifted.append((gen_index + shift, mod_index))
        ibags = shifted

    _rebuild_sf2(source, dest, pgens=pgens, ibags=ibags, igens=igens)
    return {
        "patches": [
            {
                "chunk": patch.chunk.decode("ascii"),
                "index": patch.index,
                "old": _signed16(patch.old),
                "new": _signed16(patch.new),
                "reason": patch.reason,
            }
            for patch in patches
        ],
        "insertions": [
            {
                "ibagIndex": item.ibag_index,
                "insertIndex": item.insert_index,
                "amountCb": item.amount_cb,
                "selector": f"{item.selector[0]}:{item.selector[1]}",
                "sampleId": item.sample_id,
                "keyRange": list(item.key_range),
                "reason": item.reason,
            }
            for item in insertions
        ],
    }


def _sample_rms(sf2_path: Path, sample_id: int, shdrs: list[tuple]) -> float:
    sf = parse_sf2(sf2_path)
    smpl = np.frombuffer(sf[b"sdta"].chunks[b"smpl"], dtype="<i2")
    sh = shdrs[sample_id]
    x = smpl[sh[1]:sh[2]].astype(np.float64)
    if x.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(x * x))) / 32768.0


def _zone_db(sf2_path: Path, zone: Zone, shdrs: list[tuple], rms_cache: dict[int, float]) -> float:
    if zone.sample_id not in rms_cache:
        rms_cache[zone.sample_id] = _sample_rms(sf2_path, zone.sample_id, shdrs)
    gain = 10 ** (-_attenuation_total(zone) / 200.0)
    return 20 * math.log10(rms_cache[zone.sample_id] * gain + 1e-12)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _audit(sf2_path: Path, apply_stats: dict[str, object]) -> dict[str, object]:
    sf = parse_sf2(sf2_path)
    pdta = sf[b"pdta"]
    shdrs = records(pdta.chunks[b"shdr"], SHDR)
    zones, _ = collect_zones(sf2_path)
    rates = sorted({sh[5] for sh in shdrs[:-1]})
    missing = []
    by_selector: dict[tuple[int, int], list[dict[str, object]]] = {}
    rms_cache: dict[int, float] = {}

    for zone in zones:
        has_att = any(
            ref.oper == GEN_INITIAL_ATTENUATION
            for refs in (zone.pglobal_refs, zone.pzone_refs, zone.iglobal_refs, zone.izone_refs)
            for ref in refs
        )
        if not has_att:
            missing.append({
                "selector": f"{zone.bank}:{zone.program}",
                "sampleId": zone.sample_id,
                "keyRange": list(zone.key_range),
                "sample": _clean_name(shdrs[zone.sample_id][0]),
            })
        by_selector.setdefault((zone.bank, zone.program), []).append({
            "keyRange": list(zone.key_range),
            "velRange": list(zone.vel_range),
            "sampleId": zone.sample_id,
            "sample": _clean_name(shdrs[zone.sample_id][0]),
            "attenuationCb": _attenuation_total(zone),
            "estimatedDb": round(_zone_db(sf2_path, zone, shdrs, rms_cache), 2),
        })

    presets = []
    for selector, rows in sorted(by_selector.items()):
        dbs = [float(row["estimatedDb"]) for row in rows]
        atts = [int(row["attenuationCb"]) for row in rows]
        presets.append({
            "selector": f"{selector[0]}:{selector[1]}",
            "zones": len(rows),
            "attenuationCbMin": min(atts),
            "attenuationCbMedian": sorted(atts)[len(atts) // 2],
            "attenuationCbMax": max(atts),
            "estimatedDbMin": round(min(dbs), 2),
            "estimatedDbMedian": round(sorted(dbs)[len(dbs) // 2], 2),
            "estimatedDbMax": round(max(dbs), 2),
        })

    return {
        "sf2": str(sf2_path.resolve()),
        "sha256": _sha256(sf2_path),
        "sizeBytes": sf2_path.stat().st_size,
        "sampleRates": rates,
        "samples": len(shdrs) - 1,
        "effectiveZones": len(zones),
        "missingInitialAttenuationZones": missing,
        "applyStats": apply_stats,
        "presets": presets,
    }


def _write_markdown(report: dict[str, object], path: Path) -> None:
    lines = [
        "# Aura25 Master SF2 Bank Audit",
        "",
        f"SF2: `{report['sf2']}`",
        f"SHA256: `{report['sha256']}`",
        f"Size: `{report['sizeBytes']}` bytes",
        f"Sample rates: `{report['sampleRates']}`",
        f"Samples: `{report['samples']}`",
        f"Effective zones: `{report['effectiveZones']}`",
        "",
        "## Mastering Actions",
        "",
    ]
    stats = report["applyStats"]  # type: ignore[assignment]
    patches = stats["patches"]  # type: ignore[index]
    insertions = stats["insertions"]  # type: ignore[index]
    lines.append(f"- FM wave attenuation patches: `{len(patches)}`")
    lines.append(f"- Explicit gen48 insertions: `{len(insertions)}`")
    lines.append(f"- Missing gen48 after pass: `{len(report['missingInitialAttenuationZones'])}`")
    lines.append("")
    if patches:
        lines.extend(["### Patched Generators", ""])
        lines.append("| Chunk | Index | Old cB | New cB | Reason |")
        lines.append("|---|---:|---:|---:|---|")
        for patch in patches:
            lines.append(
                f"| {patch['chunk']} | {patch['index']} | {patch['old']} | {patch['new']} | {patch['reason']} |"
            )
        lines.append("")
    lines.extend(["## Preset Internal Balance", ""])
    lines.append("| Preset | Zones | Att cB min/med/max | Est dB min/med/max |")
    lines.append("|---|---:|---:|---:|")
    for row in report["presets"]:  # type: ignore[index]
        lines.append(
            f"| {row['selector']} | {row['zones']} | "
            f"{row['attenuationCbMin']}/{row['attenuationCbMedian']}/{row['attenuationCbMax']} | "
            f"{row['estimatedDbMin']}/{row['estimatedDbMedian']}/{row['estimatedDbMax']} |"
        )
    lines.append("")
    lines.extend([
        "## Judgment",
        "",
        "- This is an SF2-internal master-bank pass: Copych post-chain, EQ, softclip, and masterLift are not part of this fix.",
        "- All effective zones now carry explicit gen48 InitialAttenuation, so ESP32/copych gain behavior is auditable from the SoundFont itself.",
        "- Drum pieces remain musically tiered; kick, snare, hat, ride, and crash are not forced to the same loudness.",
        "- The chorused FM EP keeps its color, but its DX7 Wave layer no longer depends on negative/near-unity internal attenuation.",
    ])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("dest", type=Path)
    parser.add_argument("--json-report", type=Path, default=Path("docs/generated/aura25_master_sf2_bank_audit.json"))
    parser.add_argument("--md-report", type=Path, default=Path("docs/generated/aura25_master_sf2_bank_audit.md"))
    args = parser.parse_args()

    stats = _apply_master(args.source, args.dest)
    report = _audit(args.dest, stats)
    args.json_report.parent.mkdir(parents=True, exist_ok=True)
    args.json_report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    _write_markdown(report, args.md_report)
    print(json.dumps({
        "dest": str(args.dest),
        "sha256": report["sha256"],
        "sizeBytes": report["sizeBytes"],
        "missingInitialAttenuationZones": len(report["missingInitialAttenuationZones"]),
        "patches": len(stats["patches"]),
        "insertions": len(stats["insertions"]),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
