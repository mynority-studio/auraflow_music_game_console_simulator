#!/usr/bin/env python3
"""Merge already-subset SoundFont 2 files into one small runtime bank.

The merger concatenates sample, instrument, and preset records while rewriting
sampleID/instrument generator indexes. It is intentionally narrow: feed it SF2s
that were already pruned/resampled by subset_sf2.py.
"""

from __future__ import annotations

import argparse
import struct
from dataclasses import dataclass
from pathlib import Path

from subset_sf2 import (
    GEN_INSTRUMENT,
    GEN_SAMPLE_ID,
    INST,
    PBAG,
    PGEN,
    PHDR,
    SHDR,
    _chunk,
    _list,
    _sf_name,
    pack_records,
    parse_sf2,
    raw_records,
    records,
)


# subset_sf2 exports structs as constants by module globals, but type checkers do
# not know about pmod/imod aliases; keep local record sizes explicit.
PMOD_RECORD_SIZE = 10
IMOD_RECORD_SIZE = 10


@dataclass(frozen=True)
class PresetRename:
    bank: int
    preset: int
    name: str | None = None


def _parse_selector(spec: str) -> tuple[int, int]:
    bank, preset = spec.split(":", 1)
    return int(bank), int(preset)


def _parse_rename(spec: str) -> tuple[tuple[int, int], PresetRename]:
    left, right = spec.split("=", 1)
    src = _parse_selector(left)
    parts = right.split(":", 2)
    if len(parts) < 2:
        raise argparse.ArgumentTypeError(f"expected bank:preset=bank:preset[:name], got {spec!r}")
    name = parts[2] if len(parts) == 3 and parts[2] else None
    return src, PresetRename(int(parts[0]), int(parts[1]), name)


def _rewrite_gen(raw: tuple, mapping: dict[int, int], oper: int) -> tuple:
    gen_oper, amount = raw
    if gen_oper == oper:
        return gen_oper, mapping[amount]
    return raw


def merge_sf2(sources: list[Path], dest: Path, *, rename: dict[tuple[int, int], PresetRename], name: str | None) -> None:
    if not sources:
        raise ValueError("at least one source SF2 is required")

    first = parse_sf2(sources[0])
    info = first[b"INFO"]
    info_chunks = dict(info.chunks)
    info_order = list(info.order)
    if name is not None:
        info_chunks[b"INAM"] = name.encode("latin1", "replace") + b"\0"
        if b"INAM" not in info_order:
            info_order.append(b"INAM")

    new_smpl = bytearray()
    new_shdrs: list[tuple] = []
    new_insts: list[tuple] = []
    new_ibags: list[tuple] = []
    new_imods: list[bytes] = []
    new_igens: list[tuple] = []
    new_phdrs: list[tuple] = []
    new_pbags: list[tuple] = []
    new_pmods: list[bytes] = []
    new_pgens: list[tuple] = []

    for source in sources:
        sf = parse_sf2(source)
        sdta = sf[b"sdta"]
        pdta = sf[b"pdta"]
        if b"sm24" in sdta.chunks:
            raise ValueError(f"{source} still has sm24; run subset_sf2.py with --target-rate first")

        phdrs = records(pdta.chunks[b"phdr"], PHDR)
        pbags = records(pdta.chunks[b"pbag"], PBAG)
        pmods = raw_records(pdta.chunks[b"pmod"], PMOD_RECORD_SIZE)
        pgens = records(pdta.chunks[b"pgen"], PGEN)
        insts = records(pdta.chunks[b"inst"], INST)
        ibags = records(pdta.chunks[b"ibag"], PBAG)
        imods = raw_records(pdta.chunks[b"imod"], IMOD_RECORD_SIZE)
        igens = records(pdta.chunks[b"igen"], PGEN)
        shdrs = records(pdta.chunks[b"shdr"], SHDR)
        smpl = sdta.chunks[b"smpl"]

        sample_offset = len(new_shdrs)
        sample_map = {old_i: sample_offset + old_i for old_i in range(len(shdrs) - 1)}
        for old_i, sh in enumerate(shdrs[:-1]):
            name_bytes, start, end, start_loop, end_loop, rate, pitch, corr, link, typ = sh
            new_start = len(new_smpl) // 2
            new_smpl.extend(smpl[start * 2:end * 2])
            new_end = len(new_smpl) // 2
            new_start_loop = new_start + max(0, start_loop - start)
            new_end_loop = new_start + max(0, end_loop - start)
            new_smpl.extend(b"\0" * (46 * 2))
            new_shdrs.append((name_bytes, new_start, new_end, new_start_loop, new_end_loop, rate, pitch, corr, sample_map.get(link, 0), typ))

        inst_offset = len(new_insts)
        inst_map = {old_i: inst_offset + old_i for old_i in range(len(insts) - 1)}
        for old_i, inst in enumerate(insts[:-1]):
            inst_name, _ = inst
            new_insts.append((inst_name, len(new_ibags)))
            for bag_i in range(insts[old_i][1], insts[old_i + 1][1]):
                gen_start, mod_start = ibags[bag_i]
                gen_end, mod_end = ibags[bag_i + 1]
                new_ibags.append((len(new_igens), len(new_imods)))
                for gen in igens[gen_start:gen_end]:
                    new_igens.append(_rewrite_gen(gen, sample_map, GEN_SAMPLE_ID))
                new_imods.extend(imods[mod_start:mod_end])

        for old_i, ph in enumerate(phdrs[:-1]):
            preset_name, preset, bank, _bag_start, library, genre, morphology = ph
            remap = rename.get((bank, preset))
            if remap is not None:
                bank, preset = remap.bank, remap.preset
                if remap.name is not None:
                    preset_name = _sf_name(remap.name)
            new_phdrs.append((preset_name, preset, bank, len(new_pbags), library, genre, morphology))
            for bag_i in range(phdrs[old_i][3], phdrs[old_i + 1][3]):
                gen_start, mod_start = pbags[bag_i]
                gen_end, mod_end = pbags[bag_i + 1]
                new_pbags.append((len(new_pgens), len(new_pmods)))
                for gen in pgens[gen_start:gen_end]:
                    new_pgens.append(_rewrite_gen(gen, inst_map, GEN_INSTRUMENT))
                new_pmods.extend(pmods[mod_start:mod_end])

    eos_pos = len(new_smpl) // 2
    new_shdrs.append((_sf_name("EOS"), eos_pos, eos_pos, eos_pos, eos_pos, 0, 0, 0, 0, 0))
    new_insts.append((_sf_name("EOI"), len(new_ibags)))
    new_ibags.append((len(new_igens), len(new_imods)))
    new_igens.append((0, 0))
    new_imods.append(b"\0" * IMOD_RECORD_SIZE)
    new_phdrs.append((_sf_name("EOP"), 0, 0, len(new_pbags), 0, 0, 0))
    new_pbags.append((len(new_pgens), len(new_pmods)))
    new_pgens.append((0, 0))
    new_pmods.append(b"\0" * PMOD_RECORD_SIZE)

    info_payload = b"".join(_chunk(tag, info_chunks[tag]) for tag in info_order)
    sdta_payload = _chunk(b"smpl", bytes(new_smpl))
    pdta_payload = b"".join(
        [
            _chunk(b"phdr", pack_records(new_phdrs, PHDR)),
            _chunk(b"pbag", pack_records(new_pbags, PBAG)),
            _chunk(b"pmod", b"".join(new_pmods)),
            _chunk(b"pgen", pack_records(new_pgens, PGEN)),
            _chunk(b"inst", pack_records(new_insts, INST)),
            _chunk(b"ibag", pack_records(new_ibags, PBAG)),
            _chunk(b"imod", b"".join(new_imods)),
            _chunk(b"igen", pack_records(new_igens, PGEN)),
            _chunk(b"shdr", pack_records(new_shdrs, SHDR)),
        ]
    )
    body = b"sfbk" + _list(b"INFO", info_payload) + _list(b"sdta", sdta_payload) + _list(b"pdta", pdta_payload)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(b"RIFF" + struct.pack("<I", len(body)) + body)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("dest", type=Path)
    ap.add_argument("sources", type=Path, nargs="+")
    ap.add_argument("--rename", action="append", type=_parse_rename, default=[])
    ap.add_argument("--name", default=None)
    args = ap.parse_args()
    merge_sf2(args.sources, args.dest, rename=dict(args.rename), name=args.name)
    print(f"wrote {args.dest} ({args.dest.stat().st_size / 1024 / 1024:.2f} MiB)")


if __name__ == "__main__":
    main()
