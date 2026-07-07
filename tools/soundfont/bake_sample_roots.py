#!/usr/bin/env python3
"""Bake unique overridingRootKey/fineTune values into SF2 sample headers.

Some tiny/mobile SoundFont paths primarily consult `shdr.originalPitch` and
`shdr.pitchCorrection`, and only partially honor instrument-zone
`overridingRootKey` / `fineTune`. This tool mirrors each sample's unique
override root into the sample header and moves unique per-sample fineTune into
the header correction, so full SF2 readers and simplified embedded readers
agree on pitch.
"""

from __future__ import annotations

import argparse
import struct
from collections import defaultdict
from pathlib import Path

from subset_sf2 import INST, PBAG, PGEN, PHDR, SHDR, _clean_name, parse_sf2, records

GEN_KEY_RANGE = 43
GEN_FINE_TUNE = 52
GEN_SAMPLE_ID = 53
GEN_OVERRIDING_ROOT_KEY = 58
SHDR_RECORD_SIZE = SHDR.size
SHDR_ORIGINAL_PITCH_OFFSET = 40
SHDR_PITCH_CORRECTION_OFFSET = 41
PGEN_RECORD_SIZE = PGEN.size


def _find_pdta_child_payload_offset(data: bytes, wanted_tag: bytes) -> int:
    if data[:4] != b"RIFF" or data[8:12] != b"sfbk":
        raise ValueError("not a RIFF sfbk file")
    pos = 12
    while pos + 8 <= len(data):
        tag = data[pos:pos + 4]
        size = struct.unpack_from("<I", data, pos + 4)[0]
        payload_start = pos + 8
        payload_end = payload_start + size
        if tag == b"LIST" and data[payload_start:payload_start + 4] == b"pdta":
            child = payload_start + 4
            while child + 8 <= payload_end:
                ctag = data[child:child + 4]
                csize = struct.unpack_from("<I", data, child + 4)[0]
                if ctag == wanted_tag:
                    return child + 8
                child += 8 + csize + (csize & 1)
        pos = payload_end + (size & 1)
    raise ValueError(f"missing pdta/{wanted_tag.decode('latin1')} chunk")


def _key_range(amount: int) -> tuple[int, int]:
    return amount & 0xFF, (amount >> 8) & 0xFF


def _signed16(v: int) -> int:
    return v if v < 32768 else v - 65536


def collect_unique_sample_pitch(path: Path) -> tuple[dict[int, int], dict[int, int], dict[int, list[int]], list[str], list[str]]:
    sf = parse_sf2(path)
    pdta = sf[b"pdta"]
    insts = records(pdta.chunks[b"inst"], INST)
    ibags = records(pdta.chunks[b"ibag"], PBAG)
    igens = records(pdta.chunks[b"igen"], PGEN)
    shdrs = records(pdta.chunks[b"shdr"], SHDR)

    roots: dict[int, set[int]] = defaultdict(set)
    corrections: dict[int, set[int]] = defaultdict(set)
    fine_gen_indices: dict[int, list[int]] = defaultdict(list)
    uses: dict[int, list[str]] = defaultdict(list)
    for inst_i in range(len(insts) - 1):
        inst_name = _clean_name(insts[inst_i][0])
        for bag_i in range(insts[inst_i][1], insts[inst_i + 1][1]):
            gen_start, _ = ibags[bag_i]
            gen_end, _ = ibags[bag_i + 1]
            sample_id: int | None = None
            root_key: int | None = None
            fine_tune = 0
            fine_idx: int | None = None
            key_range: tuple[int, int] | None = None
            for gen_i in range(gen_start, gen_end):
                oper, amount = igens[gen_i]
                if oper == GEN_SAMPLE_ID:
                    sample_id = amount
                elif oper == GEN_OVERRIDING_ROOT_KEY:
                    root_key = amount
                elif oper == GEN_KEY_RANGE:
                    key_range = _key_range(amount)
                elif oper == GEN_FINE_TUNE:
                    fine_tune = _signed16(amount)
                    fine_idx = gen_i
            if sample_id is None or root_key is None:
                if sample_id is not None:
                    corr = shdrs[sample_id][7]
                    corrections[sample_id].add(corr + fine_tune)
                    if fine_idx is not None:
                        fine_gen_indices[sample_id].append(fine_idx)
                continue
            roots[sample_id].add(root_key)
            corr = shdrs[sample_id][7]
            corrections[sample_id].add(corr + fine_tune)
            if fine_idx is not None:
                fine_gen_indices[sample_id].append(fine_idx)
            uses[sample_id].append(f"{inst_name}{key_range or ''}->root{root_key}")

    unique: dict[int, int] = {}
    unique_correction: dict[int, int] = {}
    skipped_roots: list[str] = []
    skipped_tuning: list[str] = []
    for sample_id, root_set in sorted(roots.items()):
        name = _clean_name(shdrs[sample_id][0])
        if len(root_set) == 1:
            unique[sample_id] = next(iter(root_set))
        else:
            skipped_roots.append(f"skip sample {sample_id} {name}: conflicting roots {sorted(root_set)} uses={uses[sample_id]}")
    for sample_id, corr_set in sorted(corrections.items()):
        name = _clean_name(shdrs[sample_id][0])
        if len(corr_set) != 1:
            skipped_tuning.append(f"skip sample {sample_id} {name}: conflicting corrections {sorted(corr_set)}")
            continue
        corr = next(iter(corr_set))
        if -128 <= corr <= 127:
            unique_correction[sample_id] = corr
        else:
            skipped_tuning.append(f"skip sample {sample_id} {name}: correction out of int8 range {corr}")
    return unique, unique_correction, fine_gen_indices, skipped_roots, skipped_tuning


def bake_sample_roots(source: Path, dest: Path) -> dict[str, int]:
    data = bytearray(source.read_bytes())
    shdr_payload_offset = _find_pdta_child_payload_offset(data, b"shdr")
    igen_payload_offset = _find_pdta_child_payload_offset(data, b"igen")
    sf = parse_sf2(source)
    shdrs = records(sf[b"pdta"].chunks[b"shdr"], SHDR)
    roots, corrections, fine_gen_indices, skipped_roots, skipped_tuning = collect_unique_sample_pitch(source)

    root_changed = 0
    for sample_id, root in roots.items():
        if sample_id >= len(shdrs) - 1:
            continue
        if not 0 <= root <= 127:
            continue
        record_offset = shdr_payload_offset + sample_id * SHDR_RECORD_SIZE
        pitch_offset = record_offset + SHDR_ORIGINAL_PITCH_OFFSET
        if data[pitch_offset] != root:
            data[pitch_offset] = root
            root_changed += 1

    correction_changed = 0
    cleared_fine_tune = 0
    for sample_id, correction in corrections.items():
        if sample_id >= len(shdrs) - 1:
            continue
        record_offset = shdr_payload_offset + sample_id * SHDR_RECORD_SIZE
        corr_offset = record_offset + SHDR_PITCH_CORRECTION_OFFSET
        current = struct.unpack_from("<b", data, corr_offset)[0]
        if current != correction:
            struct.pack_into("<b", data, corr_offset, correction)
            correction_changed += 1
        for gen_i in fine_gen_indices.get(sample_id, []):
            amount_offset = igen_payload_offset + gen_i * PGEN_RECORD_SIZE + 2
            if struct.unpack_from("<H", data, amount_offset)[0] != 0:
                struct.pack_into("<H", data, amount_offset, 0)
                cleared_fine_tune += 1

    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    for line in skipped_roots:
        print(line)
    for line in skipped_tuning:
        print(line)
    return {
        "samples_with_unique_roots": len(roots),
        "root_changed": root_changed,
        "samples_with_unique_corrections": len(corrections),
        "correction_changed": correction_changed,
        "cleared_fine_tune": cleared_fine_tune,
        "skipped_root_conflicts": len(skipped_roots),
        "skipped_tuning_conflicts": len(skipped_tuning),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("dest", type=Path)
    args = parser.parse_args()
    stats = bake_sample_roots(args.source, args.dest)
    print(
        f"wrote {args.dest} "
        f"({stats['root_changed']} sample header roots baked, "
        f"{stats['correction_changed']} header pitch corrections baked, "
        f"{stats['cleared_fine_tune']} zone fineTune generators cleared, "
        f"{stats['skipped_root_conflicts']} root conflicts skipped, "
        f"{stats['skipped_tuning_conflicts']} tuning conflicts skipped)"
    )


if __name__ == "__main__":
    main()
