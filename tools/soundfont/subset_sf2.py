#!/usr/bin/env python3
"""Create a SoundFont 2 subset by keeping selected bank:preset entries.

The tool preserves the selected presets' instrument/sample programming and
copies only referenced samples into a new SF2. It is intentionally narrow:
enough for deriving small embedded banks from a larger coherent source bank.
"""

from __future__ import annotations

import argparse
import struct
from dataclasses import dataclass
from pathlib import Path


PHDR = struct.Struct("<20sHHHIII")
PBAG = struct.Struct("<HH")
PGEN = struct.Struct("<HH")
INST = struct.Struct("<20sH")
SHDR = struct.Struct("<20sIIIIIBbHH")

GEN_INSTRUMENT = 41
GEN_SAMPLE_ID = 53


@dataclass(frozen=True)
class Chunk:
    tag: bytes
    payload: bytes


@dataclass(frozen=True)
class ListChunk:
    kind: bytes
    chunks: dict[bytes, bytes]
    order: list[bytes]


def _clean_name(raw: bytes) -> str:
    return raw.split(b"\0", 1)[0].decode("latin1", "replace")


def _sf_name(name: str) -> bytes:
    data = name.encode("latin1", "replace")[:20]
    return data + b"\0" * (20 - len(data))


def _chunk(tag: bytes, payload: bytes) -> bytes:
    pad = b"\0" if len(payload) & 1 else b""
    return tag + struct.pack("<I", len(payload)) + payload + pad


def _list(kind: bytes, payload: bytes) -> bytes:
    return _chunk(b"LIST", kind + payload)


def _parse_children(payload: bytes) -> tuple[dict[bytes, bytes], list[bytes]]:
    chunks: dict[bytes, bytes] = {}
    order: list[bytes] = []
    pos = 0
    while pos + 8 <= len(payload):
        tag = payload[pos : pos + 4]
        size = struct.unpack_from("<I", payload, pos + 4)[0]
        start = pos + 8
        end = start + size
        if end > len(payload):
            raise ValueError(f"chunk {tag!r} extends past parent")
        chunks[tag] = payload[start:end]
        order.append(tag)
        pos = end + (size & 1)
    return chunks, order


def parse_sf2(path: Path) -> dict[bytes, ListChunk]:
    data = path.read_bytes()
    if data[:4] != b"RIFF" or data[8:12] != b"sfbk":
        raise ValueError(f"{path} is not a RIFF sfbk file")
    lists: dict[bytes, ListChunk] = {}
    pos = 12
    while pos + 8 <= len(data):
        tag = data[pos : pos + 4]
        size = struct.unpack_from("<I", data, pos + 4)[0]
        start = pos + 8
        end = start + size
        payload = data[start:end]
        if tag == b"LIST":
            kind = payload[:4]
            chunks, order = _parse_children(payload[4:])
            lists[kind] = ListChunk(kind, chunks, order)
        pos = end + (size & 1)
    for required in (b"INFO", b"sdta", b"pdta"):
        if required not in lists:
            raise ValueError(f"missing LIST {required!r}")
    return lists


def records(payload: bytes, fmt: struct.Struct) -> list[tuple]:
    if len(payload) % fmt.size:
        raise ValueError(f"chunk size {len(payload)} not divisible by {fmt.size}")
    return [fmt.unpack_from(payload, i) for i in range(0, len(payload), fmt.size)]


def raw_records(payload: bytes, size: int) -> list[bytes]:
    if len(payload) % size:
        raise ValueError(f"chunk size {len(payload)} not divisible by {size}")
    return [payload[i : i + size] for i in range(0, len(payload), size)]


def pack_records(items: list[tuple], fmt: struct.Struct) -> bytes:
    return b"".join(fmt.pack(*item) for item in items)


def list_presets(path: Path) -> None:
    sf = parse_sf2(path)
    phdrs = records(sf[b"pdta"].chunks[b"phdr"], PHDR)
    for i, ph in enumerate(phdrs[:-1]):
        name, preset, bank, bag, *_ = ph
        print(f"{bank:>3}:{preset:<3} {i:>4} {_clean_name(name)}")


def _parse_selector(spec: str) -> tuple[int, int]:
    try:
        bank, preset = spec.split(":", 1)
        return int(bank), int(preset)
    except Exception as exc:  # noqa: BLE001
        raise argparse.ArgumentTypeError(f"expected bank:preset, got {spec!r}") from exc


def _rewrite_gen(raw: tuple, mapping: dict[int, int], oper: int) -> tuple:
    gen_oper, amount = raw
    if gen_oper == oper:
        return gen_oper, mapping[amount]
    return raw


def subset_sf2(source: Path, dest: Path, selectors: list[tuple[int, int]]) -> dict[str, int]:
    sf = parse_sf2(source)
    info = sf[b"INFO"]
    sdta = sf[b"sdta"]
    pdta = sf[b"pdta"]

    phdrs = records(pdta.chunks[b"phdr"], PHDR)
    pbags = records(pdta.chunks[b"pbag"], PBAG)
    pmods = raw_records(pdta.chunks[b"pmod"], 10)
    pgens = records(pdta.chunks[b"pgen"], PGEN)
    insts = records(pdta.chunks[b"inst"], INST)
    ibags = records(pdta.chunks[b"ibag"], PBAG)
    imods = raw_records(pdta.chunks[b"imod"], 10)
    igens = records(pdta.chunks[b"igen"], PGEN)
    shdrs = records(pdta.chunks[b"shdr"], SHDR)
    smpl = sdta.chunks[b"smpl"]
    sm24 = sdta.chunks.get(b"sm24")

    wanted = set(selectors)
    selected_phdr = [i for i, ph in enumerate(phdrs[:-1]) if (ph[2], ph[1]) in wanted]
    found = {(phdrs[i][2], phdrs[i][1]) for i in selected_phdr}
    missing = sorted(wanted - found)
    if missing:
        raise ValueError("missing presets: " + ", ".join(f"{b}:{p}" for b, p in missing))

    instrument_ids: list[int] = []
    instrument_seen: set[int] = set()
    for ph_i in selected_phdr:
        for bag_i in range(phdrs[ph_i][3], phdrs[ph_i + 1][3]):
            gen_start, _ = pbags[bag_i]
            gen_end, _ = pbags[bag_i + 1]
            for gen in pgens[gen_start:gen_end]:
                if gen[0] == GEN_INSTRUMENT and gen[1] not in instrument_seen:
                    instrument_seen.add(gen[1])
                    instrument_ids.append(gen[1])

    sample_seen: set[int] = set()
    sample_ids: list[int] = []
    for inst_i in instrument_ids:
        for bag_i in range(insts[inst_i][1], insts[inst_i + 1][1]):
            gen_start, _ = ibags[bag_i]
            gen_end, _ = ibags[bag_i + 1]
            for gen in igens[gen_start:gen_end]:
                if gen[0] == GEN_SAMPLE_ID and gen[1] not in sample_seen:
                    sample_seen.add(gen[1])
                    sample_ids.append(gen[1])

    # Preserve linked stereo partners if the source uses sampleLink.
    cursor = 0
    while cursor < len(sample_ids):
        sid = sample_ids[cursor]
        link = shdrs[sid][8]
        if 0 <= link < len(shdrs) - 1 and link != sid and link not in sample_seen:
            sample_seen.add(link)
            sample_ids.append(link)
        cursor += 1
    sample_ids.sort()

    sample_map = {old: new for new, old in enumerate(sample_ids)}
    inst_map = {old: new for new, old in enumerate(instrument_ids)}

    new_smpl = bytearray()
    new_sm24 = bytearray() if sm24 is not None else None
    new_shdrs: list[tuple] = []
    for old_i in sample_ids:
        name, start, end, start_loop, end_loop, rate, pitch, corr, link, typ = shdrs[old_i]
        new_start = len(new_smpl) // 2
        sample_bytes = smpl[start * 2 : end * 2]
        new_smpl.extend(sample_bytes)
        new_end = len(new_smpl) // 2
        new_start_loop = new_start + max(0, start_loop - start)
        new_end_loop = new_start + max(0, end_loop - start)
        # SoundFont readers expect a small zero guard after each sample.
        new_smpl.extend(b"\0" * (46 * 2))
        if new_sm24 is not None and sm24 is not None:
            new_sm24.extend(sm24[start:end])
            new_sm24.extend(b"\0" * 46)
        new_link = sample_map.get(link, 0)
        new_shdrs.append((name, new_start, new_end, new_start_loop, new_end_loop, rate, pitch, corr, new_link, typ))
    eos_pos = len(new_smpl) // 2
    new_shdrs.append((_sf_name("EOS"), eos_pos, eos_pos, eos_pos, eos_pos, 0, 0, 0, 0, 0))

    new_insts: list[tuple] = []
    new_ibags: list[tuple] = []
    new_imods: list[bytes] = []
    new_igens: list[tuple] = []
    for old_i in instrument_ids:
        name, _bag_start = insts[old_i]
        new_insts.append((name, len(new_ibags)))
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
    new_imods.append(b"\0" * 10)

    new_phdrs: list[tuple] = []
    new_pbags: list[tuple] = []
    new_pmods: list[bytes] = []
    new_pgens: list[tuple] = []
    for old_i in selected_phdr:
        name, preset, bank, _bag_start, library, genre, morphology = phdrs[old_i]
        new_phdrs.append((name, preset, bank, len(new_pbags), library, genre, morphology))
        for bag_i in range(phdrs[old_i][3], phdrs[old_i + 1][3]):
            gen_start, mod_start = pbags[bag_i]
            gen_end, mod_end = pbags[bag_i + 1]
            new_pbags.append((len(new_pgens), len(new_pmods)))
            for gen in pgens[gen_start:gen_end]:
                new_pgens.append(_rewrite_gen(gen, inst_map, GEN_INSTRUMENT))
            new_pmods.extend(pmods[mod_start:mod_end])
    new_phdrs.append((_sf_name("EOP"), 0, 0, len(new_pbags), 0, 0, 0))
    new_pbags.append((len(new_pgens), len(new_pmods)))
    new_pgens.append((0, 0))
    new_pmods.append(b"\0" * 10)

    info_payload = b"".join(_chunk(tag, info.chunks[tag]) for tag in info.order)
    sdta_payload = _chunk(b"smpl", bytes(new_smpl))
    if new_sm24 is not None:
        sdta_payload += _chunk(b"sm24", bytes(new_sm24))
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
        "presets": len(new_phdrs) - 1,
        "instruments": len(new_insts) - 1,
        "samples": len(new_shdrs) - 1,
        "bytes": dest.stat().st_size,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("source", type=Path)
    ap.add_argument("dest", type=Path, nargs="?")
    ap.add_argument("--preset", action="append", type=_parse_selector, default=[])
    ap.add_argument("--list-presets", action="store_true")
    args = ap.parse_args()
    if args.list_presets:
        list_presets(args.source)
        return
    if not args.dest:
        ap.error("dest is required unless --list-presets is used")
    if not args.preset:
        ap.error("at least one --preset bank:preset is required")
    stats = subset_sf2(args.source, args.dest, args.preset)
    print(
        f"wrote {args.dest} "
        f"({stats['bytes'] / 1024 / 1024:.2f} MiB, "
        f"{stats['presets']} presets, {stats['instruments']} instruments, {stats['samples']} samples)"
    )


if __name__ == "__main__":
    main()
