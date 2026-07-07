#!/usr/bin/env python3
"""Clamp Aura25 guitar SoundFont FX sends for compact browser/ESP32 playback."""

from __future__ import annotations

import argparse
import struct
from dataclasses import dataclass
from pathlib import Path

from subset_sf2 import INST, PBAG, PGEN, PHDR, parse_sf2, records

GEN_CHORUS_SEND = 15
GEN_REVERB_SEND = 16
GEN_INSTRUMENT = 41
PGEN_RECORD_SIZE = PGEN.size


@dataclass(frozen=True)
class SendPatch:
    chunk: bytes
    index: int
    old: int
    new: int


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


def _patch_send(
    patches: list[SendPatch],
    chunk: bytes,
    index: int,
    oper: int,
    amount: int,
    *,
    max_reverb: int,
    max_chorus: int,
) -> None:
    if oper == GEN_REVERB_SEND and amount > max_reverb:
        patches.append(SendPatch(chunk, index, amount, max_reverb))
    elif oper == GEN_CHORUS_SEND and amount > max_chorus:
        patches.append(SendPatch(chunk, index, amount, max_chorus))


def collect_patches(
    path: Path,
    *,
    presets: set[int],
    max_reverb: int,
    max_chorus: int,
) -> list[SendPatch]:
    sf = parse_sf2(path)
    pdta = sf[b"pdta"]
    phdrs = records(pdta.chunks[b"phdr"], PHDR)
    pbags = records(pdta.chunks[b"pbag"], PBAG)
    pgens = records(pdta.chunks[b"pgen"], PGEN)
    insts = records(pdta.chunks[b"inst"], INST)
    ibags = records(pdta.chunks[b"ibag"], PBAG)
    igens = records(pdta.chunks[b"igen"], PGEN)

    patches: list[SendPatch] = []
    referenced_instruments: set[int] = set()
    for preset_i, ph in enumerate(phdrs[:-1]):
        _name, preset, bank, bag_start, *_ = ph
        if bank != 0 or preset not in presets:
            continue
        for bag_i in range(bag_start, phdrs[preset_i + 1][3]):
            gen_start, _ = pbags[bag_i]
            gen_end, _ = pbags[bag_i + 1]
            for gen_i in range(gen_start, gen_end):
                oper, amount = pgens[gen_i]
                _patch_send(patches, b"pgen", gen_i, oper, amount, max_reverb=max_reverb, max_chorus=max_chorus)
                if oper == GEN_INSTRUMENT:
                    referenced_instruments.add(amount)

    for inst_i in sorted(referenced_instruments):
        for bag_i in range(insts[inst_i][1], insts[inst_i + 1][1]):
            gen_start, _ = ibags[bag_i]
            gen_end, _ = ibags[bag_i + 1]
            for gen_i in range(gen_start, gen_end):
                oper, amount = igens[gen_i]
                _patch_send(patches, b"igen", gen_i, oper, amount, max_reverb=max_reverb, max_chorus=max_chorus)
    return patches


def dampen_guitar_sends(
    source: Path,
    dest: Path,
    *,
    presets: set[int],
    max_reverb: int,
    max_chorus: int,
) -> dict[str, int]:
    data = bytearray(source.read_bytes())
    offsets = {
        b"pgen": _find_pdta_child_payload_offset(data, b"pgen"),
        b"igen": _find_pdta_child_payload_offset(data, b"igen"),
    }
    patches = collect_patches(source, presets=presets, max_reverb=max_reverb, max_chorus=max_chorus)
    for patch in patches:
        amount_offset = offsets[patch.chunk] + patch.index * PGEN_RECORD_SIZE + 2
        struct.pack_into("<H", data, amount_offset, patch.new)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return {
        "patches": len(patches),
        "reverb": sum(1 for p in patches if p.old > max_reverb and p.new == max_reverb),
        "chorus": sum(1 for p in patches if p.old > max_chorus and p.new == max_chorus),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("dest", type=Path)
    parser.add_argument("--preset", type=int, action="append", default=[24, 25])
    parser.add_argument("--max-reverb", type=int, default=16)
    parser.add_argument("--max-chorus", type=int, default=8)
    args = parser.parse_args()
    stats = dampen_guitar_sends(
        args.source,
        args.dest,
        presets=set(args.preset),
        max_reverb=args.max_reverb,
        max_chorus=args.max_chorus,
    )
    print(
        f"wrote {args.dest} "
        f"({stats['patches']} send generators clamped, "
        f"{stats['reverb']} reverb, {stats['chorus']} chorus)"
    )


if __name__ == "__main__":
    main()
