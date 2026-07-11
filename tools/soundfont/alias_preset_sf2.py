#!/usr/bin/env python3
"""Rebuild a SoundFont while aliasing one preset to another preset's zones.

This keeps the destination preset number/name, but copies the source preset's
preset-zone programming so both presets can share one instrument/sample payload.
It is useful for tiny embedded banks where two GM slots can accept the same
clean fallback sound without carrying duplicate multisamples.
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
    LINKED_SAMPLE_TYPES,
    PBAG,
    PGEN,
    PHDR,
    SHDR,
    _chunk,
    _clean_name,
    _list,
    _sf_name,
    pack_records,
    parse_sf2,
    raw_records,
    records,
)

PMOD_RECORD_SIZE = 10
IMOD_RECORD_SIZE = 10


@dataclass(frozen=True)
class PresetAlias:
    dest_bank: int
    dest_program: int
    source_bank: int
    source_program: int
    dest_name: str | None = None


def _parse_selector(spec: str) -> tuple[int, int]:
    bank, program = spec.split(":", 1)
    return int(bank), int(program)


def _parse_alias(spec: str) -> PresetAlias:
    left, right = spec.split("=", 1)
    dest_bank, dest_program = _parse_selector(left)
    parts = right.split(":", 2)
    if len(parts) < 2:
        raise argparse.ArgumentTypeError(f"expected bank:program=bank:program[:name], got {spec!r}")
    name = parts[2] if len(parts) == 3 and parts[2] else None
    return PresetAlias(dest_bank, dest_program, int(parts[0]), int(parts[1]), name)


def _rewrite_gen(raw: tuple[int, int], mapping: dict[int, int], oper: int) -> tuple[int, int]:
    gen_oper, amount = raw
    if gen_oper == oper:
        return gen_oper, mapping[amount]
    return raw


def _has_linked_partner(sample_type: int) -> bool:
    return (sample_type & 0x7FFF) in LINKED_SAMPLE_TYPES


def alias_preset_sf2(source: Path, dest: Path, aliases: list[PresetAlias], *, name: str | None = None) -> dict[str, int]:
    sf = parse_sf2(source)
    info = sf[b"INFO"]
    sdta = sf[b"sdta"]
    pdta = sf[b"pdta"]
    if b"sm24" in sdta.chunks:
        raise ValueError("sm24 is not supported; resample to 16-bit smpl first")

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

    preset_index = {(ph[2], ph[1]): i for i, ph in enumerate(phdrs[:-1])}
    alias_by_dest = {(a.dest_bank, a.dest_program): a for a in aliases}
    copy_from: dict[int, int] = {}
    dest_names: dict[int, bytes] = {}
    for alias in aliases:
        dest_key = (alias.dest_bank, alias.dest_program)
        source_key = (alias.source_bank, alias.source_program)
        if dest_key not in preset_index:
            raise ValueError(f"missing destination preset {dest_key[0]}:{dest_key[1]}")
        if source_key not in preset_index:
            raise ValueError(f"missing source preset {source_key[0]}:{source_key[1]}")
        dest_i = preset_index[dest_key]
        copy_from[dest_i] = preset_index[source_key]
        if alias.dest_name:
            dest_names[dest_i] = _sf_name(alias.dest_name)

    instrument_ids: list[int] = []
    instrument_seen: set[int] = set()
    output_bags_by_preset: dict[int, list[int]] = {}
    for ph_i, ph in enumerate(phdrs[:-1]):
        bag_source_i = copy_from.get(ph_i, ph_i)
        bags = list(range(phdrs[bag_source_i][3], phdrs[bag_source_i + 1][3]))
        output_bags_by_preset[ph_i] = bags
        for bag_i in bags:
            gen_start, _ = pbags[bag_i]
            gen_end, _ = pbags[bag_i + 1]
            for gen_oper, amount in pgens[gen_start:gen_end]:
                if gen_oper == GEN_INSTRUMENT and amount not in instrument_seen:
                    instrument_seen.add(amount)
                    instrument_ids.append(amount)

    sample_ids: list[int] = []
    sample_seen: set[int] = set()
    for inst_i in instrument_ids:
        for bag_i in range(insts[inst_i][1], insts[inst_i + 1][1]):
            gen_start, _ = ibags[bag_i]
            gen_end, _ = ibags[bag_i + 1]
            for gen_oper, amount in igens[gen_start:gen_end]:
                if gen_oper == GEN_SAMPLE_ID and amount not in sample_seen:
                    sample_seen.add(amount)
                    sample_ids.append(amount)

    cursor = 0
    while cursor < len(sample_ids):
        sid = sample_ids[cursor]
        link = shdrs[sid][8]
        sample_type = shdrs[sid][9]
        if _has_linked_partner(sample_type) and 0 <= link < len(shdrs) - 1 and link != sid and link not in sample_seen:
            sample_seen.add(link)
            sample_ids.append(link)
        cursor += 1
    sample_ids.sort()

    sample_map = {old: new for new, old in enumerate(sample_ids)}
    inst_map = {old: new for new, old in enumerate(instrument_ids)}

    new_smpl = bytearray()
    new_shdrs: list[tuple] = []
    for old_i in sample_ids:
        name_bytes, start, end, start_loop, end_loop, rate, pitch, corr, link, typ = shdrs[old_i]
        new_start = len(new_smpl) // 2
        new_smpl.extend(smpl[start * 2 : end * 2])
        new_end = len(new_smpl) // 2
        new_start_loop = new_start + max(0, start_loop - start)
        new_end_loop = new_start + max(0, end_loop - start)
        new_smpl.extend(b"\0" * (46 * 2))
        new_shdrs.append((name_bytes, new_start, new_end, new_start_loop, new_end_loop, rate, pitch, corr, sample_map.get(link, 0), typ))
    eos_pos = len(new_smpl) // 2
    new_shdrs.append((_sf_name("EOS"), eos_pos, eos_pos, eos_pos, eos_pos, 0, 0, 0, 0, 0))

    new_insts: list[tuple] = []
    new_ibags: list[tuple] = []
    new_imods: list[bytes] = []
    new_igens: list[tuple] = []
    for old_i in instrument_ids:
        inst_name, _ = insts[old_i]
        new_insts.append((inst_name, len(new_ibags)))
        for bag_i in range(insts[old_i][1], insts[old_i + 1][1]):
            gen_start, mod_start = ibags[bag_i]
            gen_end, mod_end = ibags[bag_i + 1]
            new_ibags.append((len(new_igens), len(new_imods)))
            for gen in igens[gen_start:gen_end]:
                new_igens.append(_rewrite_gen(gen, sample_map, GEN_SAMPLE_ID))
            new_imods.extend(imods[mod_start:mod_end])
    new_insts.append((_sf_name("EOI"), len(new_ibags)))
    new_ibags.append((len(new_igens), len(new_imods)))
    new_igens.append((0, 0))
    new_imods.append(b"\0" * IMOD_RECORD_SIZE)

    new_phdrs: list[tuple] = []
    new_pbags: list[tuple] = []
    new_pmods: list[bytes] = []
    new_pgens: list[tuple] = []
    for old_i, ph in enumerate(phdrs[:-1]):
        preset_name, preset, bank, _bag_start, library, genre, morphology = ph
        if old_i in dest_names:
            preset_name = dest_names[old_i]
        new_phdrs.append((preset_name, preset, bank, len(new_pbags), library, genre, morphology))
        for bag_i in output_bags_by_preset[old_i]:
            gen_start, mod_start = pbags[bag_i]
            gen_end, mod_end = pbags[bag_i + 1]
            new_pbags.append((len(new_pgens), len(new_pmods)))
            for gen in pgens[gen_start:gen_end]:
                new_pgens.append(_rewrite_gen(gen, inst_map, GEN_INSTRUMENT))
            new_pmods.extend(pmods[mod_start:mod_end])
    new_phdrs.append((_sf_name("EOP"), 0, 0, len(new_pbags), 0, 0, 0))
    new_pbags.append((len(new_pgens), len(new_pmods)))
    new_pgens.append((0, 0))
    new_pmods.append(b"\0" * PMOD_RECORD_SIZE)

    info_chunks = dict(info.chunks)
    info_order = list(info.order)
    if name is not None:
        info_chunks[b"INAM"] = name.encode("latin1", "replace") + b"\0"
        if b"INAM" not in info_order:
            info_order.append(b"INAM")
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
    return {
        "bytes": dest.stat().st_size,
        "presets": len(new_phdrs) - 1,
        "instruments": len(new_insts) - 1,
        "samples": len(new_shdrs) - 1,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("source", type=Path)
    ap.add_argument("dest", type=Path)
    ap.add_argument("--alias", action="append", type=_parse_alias, default=[])
    ap.add_argument("--name", default=None)
    args = ap.parse_args()
    stats = alias_preset_sf2(args.source, args.dest, args.alias, name=args.name)
    print(
        f"wrote {args.dest} ({stats['bytes']} bytes, "
        f"{stats['bytes'] / 1024 / 1024:.3f} MiB, "
        f"{stats['presets']} presets, {stats['instruments']} instruments, {stats['samples']} samples)"
    )


if __name__ == "__main__":
    main()
