#!/usr/bin/env python3
"""Apply deterministic direct-output balance for the Aura25 SoundFont.

This pass is intentionally narrow: it does not rewrite samples, key ranges, or
loop points. It adjusts SF2 gen48 InitialAttenuation values so the raw SF2
output is closer to the direct-render active-RMS targets used before Copych
post-processing is redesigned.
"""

from __future__ import annotations

import argparse
from bisect import bisect_left
import struct
from dataclasses import dataclass
from pathlib import Path

from clean_aura25_sf2 import (
    PGEN_RECORD_SIZE,
    _find_pdta_child_payload_offset,
    _pack_u16,
    _signed16,
    collect_zones,
)
from subset_sf2 import INST, PBAG, PGEN, PHDR, _chunk, _list, pack_records, parse_sf2, records

GEN_INITIAL_ATTENUATION = 48
GEN_INSTRUMENT = 41
GEN_KEY_RANGE = 43
GEN_VEL_RANGE = 44
GEN_SAMPLE_ID = 53

# Additional centibels. 10 cB = 1 dB attenuation. Negative values boost by
# reducing existing attenuation. This map only touches zones that already expose
# gen48 InitialAttenuation.
PROTECTIVE_ATTENUATION_CB: dict[tuple[int, int], int] = {
    (0, 0): -100,     # Piano: bring raw direct active RMS closer to leads
    (0, 11): 70,      # Vibraphone: bright/forward, tuck before post-chain work
    (0, 32): -20,     # Acoustic bass: bring bassline forward in raw SF2
    (0, 38): -20,     # Synth bass: bring bassline forward in raw SF2
    (0, 89): -140,    # Warm Pad: audible but still behind lead/comp target
    (0, 108): -10,    # Kalimba: net boost after earlier protective trim
    (8, 5): -420,     # Chorused FM EP: local velocity/key zones need full boost
    (128, 8): 102,    # Room kit: preserve kick body while matching raw drum target
    (128, 25): 82,    # TR-808: direct-balance attenuation
    (128, 40): -2,    # Brush: slight lift to match the other retained kits
}

# Some presets still have an instrument-global attenuation after their local
# zones have reached the safe lower bound. Keep this explicit instead of
# globally changing the local-first patching rule for every preset.
EXTRA_GLOBAL_ATTENUATION_CB: dict[tuple[int, int], int] = {
    (8, 5): -80,
}

# Some imported drum zones have no gen48 at all, so they cannot be adjusted by
# PROTECTIVE_ATTENUATION_CB. Insert only the missing attenuation generators
# here. Room kit uses this route so the kick body is preserved.
MISSING_ATTENUATION_INSERTION_CB: dict[tuple[int, int], int] = {
    (128, 8): 152,
    (128, 25): 82,
}


@dataclass(frozen=True)
class AttenuationPatch:
    chunk: bytes
    index: int
    old: int
    new: int
    selector: tuple[int, int]
    delta_cb: int


@dataclass(frozen=True)
class AttenuationInsertion:
    ibag_index: int
    insert_index: int
    selector: tuple[int, int]
    delta_cb: int
    sample_id: int


def _attenuation_refs(zone) -> tuple:
    local = tuple(
        ref
        for refs in (zone.pzone_refs, zone.izone_refs)
        for ref in refs
        if ref.oper == GEN_INITIAL_ATTENUATION
    )
    if local:
        return local
    return tuple(
        ref
        for refs in (zone.pglobal_refs, zone.iglobal_refs)
        for ref in refs
        if ref.oper == GEN_INITIAL_ATTENUATION
    )


def collect_level_patches(source: Path, deltas: dict[tuple[int, int], int]) -> list[AttenuationPatch]:
    zones, _shdrs = collect_zones(source)
    patches: dict[tuple[bytes, int], AttenuationPatch] = {}

    for zone in zones:
        selector = (zone.bank, zone.program)
        delta_cb = deltas.get(selector, 0)
        if delta_cb == 0:
            continue
        for ref in _attenuation_refs(zone):
            key = (ref.chunk, ref.index)
            if key in patches:
                continue
            old = _signed16(ref.amount)
            new = max(-120, min(1440, old + delta_cb))
            patches[key] = AttenuationPatch(
                chunk=ref.chunk,
                index=ref.index,
                old=ref.amount,
                new=_pack_u16(new),
                selector=selector,
                delta_cb=delta_cb,
            )

    return sorted(patches.values(), key=lambda p: (p.chunk, p.index))


def collect_extra_global_patches(source: Path, deltas: dict[tuple[int, int], int]) -> list[AttenuationPatch]:
    zones, _shdrs = collect_zones(source)
    patches: dict[tuple[bytes, int], AttenuationPatch] = {}

    for zone in zones:
        selector = (zone.bank, zone.program)
        delta_cb = deltas.get(selector, 0)
        if delta_cb == 0:
            continue
        for ref in tuple(zone.pglobal_refs) + tuple(zone.iglobal_refs):
            if ref.oper != GEN_INITIAL_ATTENUATION:
                continue
            key = (ref.chunk, ref.index)
            if key in patches:
                continue
            old = _signed16(ref.amount)
            new = max(-120, min(1440, old + delta_cb))
            patches[key] = AttenuationPatch(
                chunk=ref.chunk,
                index=ref.index,
                old=ref.amount,
                new=_pack_u16(new),
                selector=selector,
                delta_cb=delta_cb,
            )

    return sorted(patches.values(), key=lambda p: (p.chunk, p.index))


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
    gen_start, _ = bags[bag_i]
    gen_end, _ = bags[bag_i + 1]
    return list(gens[gen_start:gen_end])


def _has_attenuation(*gen_groups: list[tuple[int, int]]) -> bool:
    return any(oper == GEN_INITIAL_ATTENUATION for gens in gen_groups for oper, _amount in gens)


def collect_attenuation_insertions(source: Path, deltas: dict[tuple[int, int], int]) -> list[AttenuationInsertion]:
    """Find target sample zones that have no attenuation generator to patch.

    Existing zones can be edited in-place. A few imported drum zones omit gen48
    entirely, so the only clean SF2-level fix is inserting gen48 before the
    terminal sampleID generator and shifting later ibag gen indexes.
    """

    sf = parse_sf2(source)
    pdta = sf[b"pdta"]
    phdrs = records(pdta.chunks[b"phdr"], PHDR)
    pbags = records(pdta.chunks[b"pbag"], PBAG)
    pgens = records(pdta.chunks[b"pgen"], PGEN)
    insts = records(pdta.chunks[b"inst"], INST)
    ibags = records(pdta.chunks[b"ibag"], PBAG)
    igens = records(pdta.chunks[b"igen"], PGEN)

    insertions: dict[int, AttenuationInsertion] = {}

    for preset_i, ph in enumerate(phdrs[:-1]):
        _name, preset, bank, bag_start, *_ = ph
        selector = (bank, preset)
        delta_cb = deltas.get(selector, 0)
        if delta_cb <= 0:
            continue

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
                if _intersect(pkey, ikey) is None or _intersect(pvel, ivel) is None:
                    continue

                gen_start, _ = ibags[ibag_i]
                sample_pos = next(
                    (i for i, (oper, _amount) in enumerate(izone_gens) if oper == GEN_SAMPLE_ID),
                    None,
                )
                if sample_pos is None:
                    continue
                insert_index = gen_start + sample_pos
                current = insertions.get(ibag_i)
                if current is None or delta_cb > current.delta_cb:
                    insertions[ibag_i] = AttenuationInsertion(
                        ibag_index=ibag_i,
                        insert_index=insert_index,
                        selector=selector,
                        delta_cb=delta_cb,
                        sample_id=izone[GEN_SAMPLE_ID],
                    )

    return sorted(insertions.values(), key=lambda item: item.insert_index)


def _rebuild_sf2(
    source: Path,
    dest: Path,
    *,
    pgens: list[tuple[int, int]],
    ibags: list[tuple[int, int]],
    igens: list[tuple[int, int]],
) -> None:
    sf = parse_sf2(source)
    info = sf[b"INFO"]
    sdta = sf[b"sdta"]
    pdta = sf[b"pdta"]

    pdta_chunks = dict(pdta.chunks)
    pdta_chunks[b"pgen"] = pack_records(pgens, PGEN)
    pdta_chunks[b"ibag"] = pack_records(ibags, PBAG)
    pdta_chunks[b"igen"] = pack_records(igens, PGEN)

    def list_payload(list_chunk, chunks_override: dict[bytes, bytes] | None = None) -> bytes:
        chunks = chunks_override or list_chunk.chunks
        return b"".join(_chunk(tag, chunks[tag]) for tag in list_chunk.order)

    payload = (
        _list(b"INFO", list_payload(info))
        + _list(b"sdta", list_payload(sdta))
        + _list(b"pdta", list_payload(pdta, pdta_chunks))
    )
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(b"RIFF" + struct.pack("<I", len(payload) + 4) + b"sfbk" + payload)


def level_aura25_sf2(
    source: Path,
    dest: Path,
    deltas: dict[tuple[int, int], int],
    insert_deltas: dict[tuple[int, int], int],
    global_deltas: dict[tuple[int, int], int],
) -> dict[str, int]:
    _data = bytearray(source.read_bytes())
    # Validate the chunks exist; rebuild below preserves RIFF sizing while
    # allowing missing attenuation generators to be inserted cleanly.
    _find_pdta_child_payload_offset(_data, b"pgen")
    _find_pdta_child_payload_offset(_data, b"igen")
    sf = parse_sf2(source)
    pdta = sf[b"pdta"]
    pgens = records(pdta.chunks[b"pgen"], PGEN)
    ibags = records(pdta.chunks[b"ibag"], PBAG)
    igens = records(pdta.chunks[b"igen"], PGEN)

    patch_map = {(p.chunk, p.index): p for p in collect_level_patches(source, deltas)}
    for patch in collect_extra_global_patches(source, global_deltas):
        key = (patch.chunk, patch.index)
        existing = patch_map.get(key)
        if existing is None:
            patch_map[key] = patch
            continue
        current = _signed16(existing.new)
        new = max(-120, min(1440, current + patch.delta_cb))
        patch_map[key] = AttenuationPatch(
            chunk=existing.chunk,
            index=existing.index,
            old=existing.old,
            new=_pack_u16(new),
            selector=existing.selector,
            delta_cb=existing.delta_cb + patch.delta_cb,
        )
    patches = sorted(patch_map.values(), key=lambda p: (p.chunk, p.index))
    by_selector: dict[tuple[int, int], int] = {}
    for patch in patches:
        if patch.chunk == b"pgen":
            pgens[patch.index] = (pgens[patch.index][0], patch.new)
        elif patch.chunk == b"igen":
            igens[patch.index] = (igens[patch.index][0], patch.new)
        else:
            raise ValueError(f"unsupported generator chunk {patch.chunk!r}")
        by_selector[patch.selector] = by_selector.get(patch.selector, 0) + 1

    insertions = collect_attenuation_insertions(source, insert_deltas)
    insertion_indexes = [item.insert_index for item in insertions]
    for offset, insertion in enumerate(insertions):
        igens.insert(insertion.insert_index + offset, (GEN_INITIAL_ATTENUATION, _pack_u16(insertion.delta_cb)))
        by_selector[insertion.selector] = by_selector.get(insertion.selector, 0) + 1
    if insertions:
        ibags = [
            (gen_index + bisect_left(insertion_indexes, gen_index), mod_index)
            for gen_index, mod_index in ibags
        ]

    _rebuild_sf2(source, dest, pgens=pgens, ibags=ibags, igens=igens)
    for selector, count in sorted(by_selector.items()):
        if selector in deltas:
            print(f"level bank{selector[0]}:program{selector[1]} +{deltas[selector]}cb on {count} attenuation generators")
    for insertion in insertions:
        print(
            "insert bank"
            f"{insertion.selector[0]}:program{insertion.selector[1]} "
            f"+{insertion.delta_cb}cb sample#{insertion.sample_id} ibag#{insertion.ibag_index}"
        )
    return {
        "patches": len(patches),
        "insertions": len(insertions),
        **{f"{b}:{p}": c for (b, p), c in by_selector.items()},
    }


def _parse_delta(spec: str) -> tuple[tuple[int, int], int]:
    try:
        selector, value = spec.split("=", 1)
        bank, program = selector.split(":", 1)
        return (int(bank), int(program)), int(value)
    except Exception as exc:  # noqa: BLE001
        raise argparse.ArgumentTypeError(f"expected bank:program=centibels, got {spec!r}") from exc


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("dest", type=Path)
    parser.add_argument("--delta", type=_parse_delta, action="append", default=None)
    parser.add_argument("--insert-delta", type=_parse_delta, action="append", default=None)
    parser.add_argument("--global-delta", type=_parse_delta, action="append", default=None)
    args = parser.parse_args()
    deltas = dict(args.delta) if args.delta else PROTECTIVE_ATTENUATION_CB
    insert_deltas = dict(args.insert_delta) if args.insert_delta else MISSING_ATTENUATION_INSERTION_CB
    global_deltas = dict(args.global_delta) if args.global_delta else EXTRA_GLOBAL_ATTENUATION_CB
    stats = level_aura25_sf2(args.source, args.dest, deltas, insert_deltas, global_deltas)
    print(
        f"wrote {args.dest} "
        f"({stats['patches']} attenuation generators patched, {stats['insertions']} inserted)"
    )


if __name__ == "__main__":
    main()
