#!/usr/bin/env python3
"""Clean Aura25 SoundFont zone sends and obvious preset loudness outliers.

This is intentionally conservative for the ESP32-S3/copych style renderer:

* Hidden SF2 reverb/chorus sends are clamped so channel CC91/93/95 remains the
  musical source of space.
* Over-loud audition presets get extra attenuation. Quiet presets are not
  boosted; the mix layer can raise them later without sacrificing headroom.
* The riskiest sustained melodic loop points are nudged inside the existing
  PCM so ESP32 sustained playback does not expose loud loop clicks.
* A tiny loop-end PCM smoothing pass is used only when loop headers cannot move
  and a non-piano melodic sample still has a risky loop seam.
* GM5/DX7 release is baked longer at the SF2 layer; MIDI CC72 can still extend
  it further, but the asset no longer behaves like a pluck by default.
* Bank 128 Standard drums are balanced against a GM128/Roland-style relative
  drum curve, with drum gains baked into PCM so the result does not depend on
  firmware support for SF2 initialAttenuation.
"""

from __future__ import annotations

import argparse
import math
import struct
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from subset_sf2 import INST, PBAG, PGEN, PHDR, SHDR, _clean_name, parse_sf2, records

GEN_CHORUS_SEND = 15
GEN_REVERB_SEND = 16
GEN_INSTRUMENT = 41
GEN_KEY_RANGE = 43
GEN_VEL_RANGE = 44
GEN_RELEASE_VOL_ENV = 38
GEN_INITIAL_ATTENUATION = 48
GEN_SAMPLE_ID = 53
GEN_SAMPLE_MODES = 54

DX7_RELEASE_TC = 1500
DX7_MIN_TARGET_DB = -30.0
DX7_HIGH_ZONE_MAX_ATTENUATION_CB = 300
VIBES_ZONE_TARGET_DB = -26.0
COPYCH_TINY_SEND = 1
DRUM_TARGET_SHIFT_DB = -4.3

GM128_STANDARD_DRUM_DB: dict[int, float] = {
    35: -6.8, 36: -6.4, 37: -17.6, 38: -12.0, 39: -13.6, 40: -10.5,
    41: -13.3, 42: -14.8, 43: -13.3, 44: -14.5, 45: -13.3, 46: -13.9,
    47: -13.3, 48: -13.3, 49: -11.6, 50: -13.3, 51: -18.7, 52: -11.8,
    53: -19.4, 54: -15.8, 55: -11.0, 56: -14.0, 57: -11.6, 58: -15.6,
    59: -18.7, 60: -13.8, 61: -13.2, 62: -13.8, 63: -12.0, 64: -12.1,
    65: -11.4, 66: -11.4, 67: -13.6, 68: -13.5, 69: -14.7, 70: -18.7,
    71: -7.3, 72: -6.6, 73: -15.6, 74: -23.3, 75: -7.8, 76: -15.5,
    77: -15.5, 78: -7.2, 79: -10.0, 80: -10.3, 81: -10.4,
}

PGEN_RECORD_SIZE = PGEN.size
SHDR_RECORD_SIZE = SHDR.size
SHDR_START_LOOP_OFFSET = 28
SHDR_END_LOOP_OFFSET = 32


@dataclass(frozen=True)
class SendLimit:
    max_reverb: int
    max_chorus: int


@dataclass(frozen=True)
class GenRef:
    chunk: bytes
    index: int
    oper: int
    amount: int


@dataclass(frozen=True)
class Zone:
    bank: int
    program: int
    sample_id: int
    key_range: tuple[int, int]
    vel_range: tuple[int, int]
    pglobal_refs: tuple[GenRef, ...]
    pzone_refs: tuple[GenRef, ...]
    iglobal_refs: tuple[GenRef, ...]
    izone_refs: tuple[GenRef, ...]


@dataclass(frozen=True)
class Patch:
    chunk: bytes
    index: int
    old: int
    new: int
    reason: str


@dataclass(frozen=True)
class LoopPatch:
    sample_id: int
    sample_name: str
    old_start_loop: int
    old_end_loop: int
    new_start_loop: int
    new_end_loop: int
    old_score: float
    new_score: float


@dataclass(frozen=True)
class PcmPatch:
    sample_id: int
    sample_name: str
    old_score: float
    new_score: float
    frames: tuple[tuple[int, int], ...]


@dataclass(frozen=True)
class PcmGainPatch:
    sample_id: int
    sample_name: str
    gain_db: float
    keys: tuple[int, ...]
    old_peak: float
    new_peak: float


# Hidden SF2 sends are ceilings for copych-style zoneSend * channelSend.
# Reverb 70 means "moderate capability"; guitars/bass stay drier; GM5 EP stays
# fully dry at the asset layer so shared space is owned by MIDI/master routing.
SEND_LIMITS: dict[tuple[int, int], SendLimit] = {
    (0, 0): SendLimit(max_reverb=70, max_chorus=8),
    (0, 5): SendLimit(max_reverb=0, max_chorus=0),
    (0, 11): SendLimit(max_reverb=70, max_chorus=8),
    (0, 24): SendLimit(max_reverb=16, max_chorus=8),
    (0, 25): SendLimit(max_reverb=16, max_chorus=8),
    (0, 32): SendLimit(max_reverb=24, max_chorus=8),
    (0, 38): SendLimit(max_reverb=24, max_chorus=8),
    (0, 67): SendLimit(max_reverb=70, max_chorus=8),
    (0, 89): SendLimit(max_reverb=70, max_chorus=80),
    (0, 108): SendLimit(max_reverb=70, max_chorus=8),
    (128, 0): SendLimit(max_reverb=COPYCH_TINY_SEND, max_chorus=COPYCH_TINY_SEND),
}

AUDITION_NOTES: dict[tuple[int, int], int] = {
    (0, 0): 60,
    (0, 5): 64,
    (0, 11): 72,
    (0, 24): 52,
    (0, 25): 52,
    (0, 32): 40,
    (0, 38): 36,
    (0, 67): 50,
    (0, 89): 55,
    (0, 108): 72,
}


def _find_list_child_payload_offset(data: bytes, list_kind: bytes, wanted_tag: bytes) -> int:
    if data[:4] != b"RIFF" or data[8:12] != b"sfbk":
        raise ValueError("not a RIFF sfbk file")
    pos = 12
    while pos + 8 <= len(data):
        tag = data[pos:pos + 4]
        size = struct.unpack_from("<I", data, pos + 4)[0]
        payload_start = pos + 8
        payload_end = payload_start + size
        if tag == b"LIST" and data[payload_start:payload_start + 4] == list_kind:
            child = payload_start + 4
            while child + 8 <= payload_end:
                ctag = data[child:child + 4]
                csize = struct.unpack_from("<I", data, child + 4)[0]
                if ctag == wanted_tag:
                    return child + 8
                child += 8 + csize + (csize & 1)
        pos = payload_end + (size & 1)
    raise ValueError(f"missing {list_kind.decode('latin1')}/{wanted_tag.decode('latin1')} chunk")


def _find_pdta_child_payload_offset(data: bytes, wanted_tag: bytes) -> int:
    return _find_list_child_payload_offset(data, b"pdta", wanted_tag)


def _signed16(v: int) -> int:
    return v if v < 32768 else v - 65536


def _pack_u16(v: int) -> int:
    return v & 0xFFFF


def _range_from_amount(amount: int) -> tuple[int, int]:
    return amount & 0xFF, (amount >> 8) & 0xFF


def _intersect(a: tuple[int, int], b: tuple[int, int]) -> tuple[int, int] | None:
    lo = max(a[0], b[0])
    hi = min(a[1], b[1])
    return (lo, hi) if lo <= hi else None


def _refs(gens: list[tuple[int, int]], chunk: bytes, start_index: int) -> tuple[GenRef, ...]:
    return tuple(GenRef(chunk, start_index + i, oper, amount) for i, (oper, amount) in enumerate(gens))


def _dict(refs: tuple[GenRef, ...]) -> dict[int, int]:
    return {ref.oper: ref.amount for ref in refs}


def _range_from_refs(refs: tuple[GenRef, ...], oper: int) -> tuple[int, int]:
    amount = _dict(refs).get(oper)
    return _range_from_amount(amount) if amount is not None else (0, 127)


def _gens_for_bag(bags: list[tuple], gens: list[tuple[int, int]], bag_i: int) -> tuple[int, list[tuple[int, int]]]:
    gen_start, _ = bags[bag_i]
    gen_end, _ = bags[bag_i + 1]
    return gen_start, list(gens[gen_start:gen_end])


def collect_zones(path: Path) -> tuple[list[Zone], list[tuple]]:
    sf = parse_sf2(path)
    pdta = sf[b"pdta"]
    phdrs = records(pdta.chunks[b"phdr"], PHDR)
    pbags = records(pdta.chunks[b"pbag"], PBAG)
    pgens = records(pdta.chunks[b"pgen"], PGEN)
    insts = records(pdta.chunks[b"inst"], INST)
    ibags = records(pdta.chunks[b"ibag"], PBAG)
    igens = records(pdta.chunks[b"igen"], PGEN)

    zones: list[Zone] = []
    for preset_i, ph in enumerate(phdrs[:-1]):
        _name, preset, bank, bag_start, *_ = ph
        pglobal_refs: tuple[GenRef, ...] = ()
        for pbag_i in range(bag_start, phdrs[preset_i + 1][3]):
            pgen_start, pgens_here = _gens_for_bag(pbags, pgens, pbag_i)
            pzone_refs = _refs(pgens_here, b"pgen", pgen_start)
            pzone = _dict(pzone_refs)
            if GEN_INSTRUMENT not in pzone:
                pglobal_refs = pzone_refs
                continue

            inst_i = pzone[GEN_INSTRUMENT]
            pkey = _intersect(_range_from_refs(pglobal_refs, GEN_KEY_RANGE), _range_from_refs(pzone_refs, GEN_KEY_RANGE))
            pvel = _intersect(_range_from_refs(pglobal_refs, GEN_VEL_RANGE), _range_from_refs(pzone_refs, GEN_VEL_RANGE))
            if pkey is None or pvel is None:
                continue

            iglobal_refs: tuple[GenRef, ...] = ()
            for ibag_i in range(insts[inst_i][1], insts[inst_i + 1][1]):
                igen_start, igens_here = _gens_for_bag(ibags, igens, ibag_i)
                izone_refs = _refs(igens_here, b"igen", igen_start)
                izone = _dict(izone_refs)
                if GEN_SAMPLE_ID not in izone:
                    iglobal_refs = izone_refs
                    continue

                ikey = _range_from_refs(izone_refs, GEN_KEY_RANGE)
                if GEN_KEY_RANGE not in izone:
                    ikey = _range_from_refs(iglobal_refs, GEN_KEY_RANGE)
                ivel = _range_from_refs(izone_refs, GEN_VEL_RANGE)
                if GEN_VEL_RANGE not in izone:
                    ivel = _range_from_refs(iglobal_refs, GEN_VEL_RANGE)
                key = _intersect(pkey, ikey)
                vel = _intersect(pvel, ivel)
                if key is None or vel is None:
                    continue
                zones.append(
                    Zone(
                        bank=bank,
                        program=preset,
                        sample_id=izone[GEN_SAMPLE_ID],
                        key_range=key,
                        vel_range=vel,
                        pglobal_refs=pglobal_refs,
                        pzone_refs=pzone_refs,
                        iglobal_refs=iglobal_refs,
                        izone_refs=izone_refs,
                    )
                )
    return zones, records(pdta.chunks[b"shdr"], SHDR)


def _sample_rms(path: Path, sample_id: int, shdrs: list[tuple]) -> float:
    sf = parse_sf2(path)
    smpl = sf[b"sdta"].chunks[b"smpl"]
    pcm = np.frombuffer(smpl, dtype="<i2")
    sh = shdrs[sample_id]
    x = pcm[sh[1]:sh[2]].astype(np.float64)
    if x.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(x * x))) / 32768.0


def _attenuation_cb(zone: Zone) -> int:
    total = 0
    for refs in (zone.pglobal_refs, zone.pzone_refs, zone.iglobal_refs, zone.izone_refs):
        for ref in refs:
            if ref.oper == GEN_INITIAL_ATTENUATION:
                total += _signed16(ref.amount)
    return total


def _generator_total(zone: Zone, oper: int, *, signed: bool = True) -> int:
    total = 0
    for refs in (zone.pglobal_refs, zone.pzone_refs, zone.iglobal_refs, zone.izone_refs):
        for ref in refs:
            if ref.oper == oper:
                total += _signed16(ref.amount) if signed else ref.amount
    return total


def _attenuation_patch_ref(zone: Zone) -> GenRef | None:
    # Prefer per-preset/velocity attenuation, then per-sample zone attenuation.
    for refs in (zone.pzone_refs, zone.izone_refs, zone.pglobal_refs, zone.iglobal_refs):
        for ref in refs:
            if ref.oper == GEN_INITIAL_ATTENUATION:
                return ref
    return None


def _attenuation_patch_refs(zone: Zone) -> tuple[GenRef, ...]:
    return tuple(
        ref
        for refs in (zone.pzone_refs, zone.izone_refs, zone.pglobal_refs, zone.iglobal_refs)
        for ref in refs
        if ref.oper == GEN_INITIAL_ATTENUATION
    )


def _local_attenuation_patch_refs(zone: Zone) -> tuple[GenRef, ...]:
    return tuple(
        ref
        for refs in (zone.pzone_refs, zone.izone_refs)
        for ref in refs
        if ref.oper == GEN_INITIAL_ATTENUATION
    )


def _sample_rms_from_pcm(pcm: np.ndarray, shdrs: list[tuple], sample_id: int) -> float:
    sh = shdrs[sample_id]
    x = pcm[sh[1]:sh[2]].astype(np.float64)
    if x.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(x * x))) / 32768.0


def _sample_peak_from_pcm(pcm: np.ndarray, shdrs: list[tuple], sample_id: int) -> float:
    sh = shdrs[sample_id]
    x = pcm[sh[1]:sh[2]].astype(np.float64)
    if x.size == 0:
        return 0.0
    return float(np.max(np.abs(x))) / 32768.0


def _active_audition_zones(zones: list[Zone], bank: int, program: int, note: int, velocity: int) -> list[Zone]:
    return [
        z for z in zones
        if z.bank == bank
        and z.program == program
        and z.key_range[0] <= note <= z.key_range[1]
        and z.vel_range[0] <= velocity <= z.vel_range[1]
    ]


def _estimated_db(path: Path, shdrs: list[tuple], active: list[Zone], rms_cache: dict[int, float]) -> float:
    energy = 0.0
    for zone in active:
        if zone.sample_id not in rms_cache:
            rms_cache[zone.sample_id] = _sample_rms(path, zone.sample_id, shdrs)
        gain = 10 ** (-_attenuation_cb(zone) / 200.0)
        energy += (rms_cache[zone.sample_id] * gain) ** 2
    return 20 * math.log10(math.sqrt(energy) + 1e-9)


def _patched_attenuation_cb(zone: Zone, patches: dict[tuple[bytes, int], Patch]) -> int:
    total = 0
    for refs in (zone.pglobal_refs, zone.pzone_refs, zone.iglobal_refs, zone.izone_refs):
        for ref in refs:
            if ref.oper != GEN_INITIAL_ATTENUATION:
                continue
            patch = patches.get((ref.chunk, ref.index))
            total += _signed16(patch.new if patch is not None else ref.amount)
    return total


def _estimated_zone_db_with_patches(
    path: Path,
    shdrs: list[tuple],
    zone: Zone,
    rms_cache: dict[int, float],
    patches: dict[tuple[bytes, int], Patch],
) -> float:
    if zone.sample_id not in rms_cache:
        rms_cache[zone.sample_id] = _sample_rms(path, zone.sample_id, shdrs)
    gain = 10 ** (-_patched_attenuation_cb(zone, patches) / 200.0)
    return 20 * math.log10(rms_cache[zone.sample_id] * gain + 1e-9)


def _loop_score(pcm: np.ndarray, start_loop: int, end_loop: int) -> tuple[float, float, float]:
    if start_loop + 1 >= end_loop or end_loop - 2 < 0:
        return float("inf"), float("inf"), float("inf")
    jump = abs(float(pcm[start_loop]) - float(pcm[end_loop - 1])) / 32768.0
    slope = abs(
        (float(pcm[start_loop + 1]) - float(pcm[start_loop]))
        - (float(pcm[end_loop - 1]) - float(pcm[end_loop - 2]))
    ) / 32768.0
    return jump * 4.0 + slope, jump, slope


def collect_loop_patches(source: Path, *, search_radius: int = 2048) -> list[LoopPatch]:
    zones, shdrs = collect_zones(source)
    sample_programs: dict[int, set[tuple[int, int]]] = {}
    for zone in zones:
        selector = (zone.bank, zone.program)
        if selector in AUDITION_NOTES:
            sample_programs.setdefault(zone.sample_id, set()).add(selector)
    sample_ids = set(sample_programs)
    sf = parse_sf2(source)
    pcm = np.frombuffer(sf[b"sdta"].chunks[b"smpl"], dtype="<i2")
    patches: list[LoopPatch] = []

    for sample_id in sorted(sample_ids):
        if sample_id >= len(shdrs) - 1:
            continue
        name, start, end, start_loop, end_loop, *_ = shdrs[sample_id]
        loop_len = end_loop - start_loop
        if loop_len <= 8 or start_loop < start or end_loop > end:
            continue
        old_score, old_jump, old_slope = _loop_score(pcm, start_loop, end_loop)
        sample_name = _clean_name(name)
        programs = sample_programs[sample_id]
        touches_piano = (0, 0) in programs
        non_piano_melodic = any(bank == 0 and program != 0 for bank, program in programs)
        threshold = 0.08 if non_piano_melodic and not touches_piano else 0.20
        high_risk = old_score > threshold
        priority_repair = sample_name == "DX7 Wave"
        if not high_risk and not priority_repair:
            continue

        min_shift = max(-search_radius, (start + 2) - start_loop)
        max_shift = min(search_radius, end - end_loop)
        best_shift = 0
        best_score = old_score
        for shift in range(min_shift, max_shift + 1):
            if shift == 0:
                continue
            cand_start = start_loop + shift
            cand_end = end_loop + shift
            if cand_start < start + 2 or cand_end > end or cand_end - cand_start != loop_len:
                continue
            score, _jump, _slope = _loop_score(pcm, cand_start, cand_end)
            if score < best_score:
                best_score = score
                best_shift = shift

        if best_shift == 0 or best_score > old_score * 0.55:
            continue
        patches.append(
            LoopPatch(
                sample_id=sample_id,
                sample_name=sample_name,
                old_start_loop=start_loop,
                old_end_loop=end_loop,
                new_start_loop=start_loop + best_shift,
                new_end_loop=end_loop + best_shift,
                old_score=old_score,
                new_score=best_score,
            )
        )
    return patches


def collect_pcm_smoothing_patches(
    source: Path,
    *,
    loop_overrides: dict[int, tuple[int, int]] | None = None,
    skip_sample_ids: set[int] | None = None,
) -> list[PcmPatch]:
    zones, shdrs = collect_zones(source)
    loop_overrides = loop_overrides or {}
    skip_sample_ids = skip_sample_ids or set()
    sample_programs: dict[int, set[tuple[int, int]]] = {}
    for zone in zones:
        selector = (zone.bank, zone.program)
        if selector in AUDITION_NOTES:
            sample_programs.setdefault(zone.sample_id, set()).add(selector)

    sf = parse_sf2(source)
    pcm = np.frombuffer(sf[b"sdta"].chunks[b"smpl"], dtype="<i2").astype(np.int32)
    patches: list[PcmPatch] = []

    for sample_id in sorted(sample_programs):
        if sample_id in skip_sample_ids or sample_id >= len(shdrs) - 1:
            continue
        programs = sample_programs[sample_id]
        touches_piano = (0, 0) in programs
        non_piano_melodic = any(bank == 0 and program != 0 for bank, program in programs)
        if not non_piano_melodic or touches_piano:
            continue

        name, start, end, start_loop, end_loop, *_ = shdrs[sample_id]
        if sample_id in loop_overrides:
            start_loop, end_loop = loop_overrides[sample_id]
        loop_len = end_loop - start_loop
        if loop_len <= 8 or start_loop + 1 >= end_loop or start_loop < start or end_loop > end:
            continue
        old_score, _old_jump, _old_slope = _loop_score(pcm, start_loop, end_loop)
        if old_score <= 0.08:
            continue

        smooth_len = min(16, max(4, loop_len // 2))
        smooth_start = max(start_loop + 2, end_loop - smooth_len)
        if smooth_start >= end_loop - 1:
            smooth_start = max(start_loop + 2, end_loop - 2)

        target_last = int(pcm[start_loop])
        target_prev = int(np.clip((2 * int(pcm[start_loop])) - int(pcm[start_loop + 1]), -32768, 32767))
        edits: list[tuple[int, int]] = []
        working = pcm.copy()
        if smooth_start < end_loop - 2:
            base = int(pcm[smooth_start])
            denom = (end_loop - 2) - smooth_start
            for frame in range(smooth_start + 1, end_loop - 1):
                t = (frame - smooth_start) / denom
                value = int(round((1.0 - t) * base + t * target_prev))
                value = int(np.clip(value, -32768, 32767))
                working[frame] = value
                edits.append((frame, value))
        else:
            working[end_loop - 2] = target_prev
            edits.append((end_loop - 2, target_prev))

        working[end_loop - 1] = target_last
        edits.append((end_loop - 1, target_last))
        new_score, _new_jump, _new_slope = _loop_score(working, start_loop, end_loop)
        if new_score <= 0.04 or new_score <= old_score * 0.5:
            patches.append(
                PcmPatch(
                    sample_id=sample_id,
                    sample_name=_clean_name(name),
                    old_score=old_score,
                    new_score=new_score,
                    frames=tuple(edits),
                )
            )
    return patches


def collect_drum_pcm_gain_patches(source: Path) -> list[PcmGainPatch]:
    zones, shdrs = collect_zones(source)
    sf = parse_sf2(source)
    pcm = np.frombuffer(sf[b"sdta"].chunks[b"smpl"], dtype="<i2")
    desired_by_sample: dict[int, list[tuple[int, float]]] = {}

    for key, reference_db in GM128_STANDARD_DRUM_DB.items():
        active = _active_audition_zones(zones, 128, 0, key, 96)
        if not active:
            continue
        target_db = reference_db + DRUM_TARGET_SHIFT_DB
        for zone in active:
            current_db = 20 * math.log10(_sample_rms_from_pcm(pcm, shdrs, zone.sample_id) + 1e-9)
            desired_by_sample.setdefault(zone.sample_id, []).append((key, target_db - current_db))

    patches: list[PcmGainPatch] = []
    for sample_id, desired in sorted(desired_by_sample.items()):
        if sample_id >= len(shdrs) - 1:
            continue
        sh = shdrs[sample_id]
        sample_name = _clean_name(sh[0])
        gain_db = float(np.median([d for _key, d in desired]))
        peak = _sample_peak_from_pcm(pcm, shdrs, sample_id)
        max_peak_gain_db = 20 * math.log10(0.98 / max(peak, 1e-9)) if peak > 0 else 0.0
        if gain_db > 0:
            gain_db = min(gain_db, max_peak_gain_db, 18.0)
        if abs(gain_db) < 0.25:
            continue
        scale = 10 ** (gain_db / 20.0)
        patches.append(
            PcmGainPatch(
                sample_id=sample_id,
                sample_name=sample_name,
                gain_db=gain_db,
                keys=tuple(key for key, _d in desired),
                old_peak=peak,
                new_peak=min(peak * scale, 0.98),
            )
        )
    return patches


def collect_patches(source: Path, *, target_db: float, audition_velocity: int) -> tuple[list[Patch], list[str]]:
    zones, shdrs = collect_zones(source)
    patches: dict[tuple[bytes, int], Patch] = {}
    report: list[str] = []

    for zone in zones:
        limit = SEND_LIMITS.get((zone.bank, zone.program))
        if limit is not None:
            for refs in (zone.pglobal_refs, zone.pzone_refs, zone.iglobal_refs, zone.izone_refs):
                for ref in refs:
                    new: int | None = None
                    reason = ""
                    if (zone.bank, zone.program) == (128, 0):
                        if ref.oper == GEN_REVERB_SEND and ref.amount != COPYCH_TINY_SEND:
                            new = COPYCH_TINY_SEND
                            reason = f"bank{zone.bank}:program{zone.program}:copych-tiny-reverb-send"
                        elif ref.oper == GEN_CHORUS_SEND and ref.amount != COPYCH_TINY_SEND:
                            new = COPYCH_TINY_SEND
                            reason = f"bank{zone.bank}:program{zone.program}:copych-tiny-chorus-send"
                        elif ref.oper == GEN_INITIAL_ATTENUATION and _signed16(ref.amount) != 0:
                            new = 0
                            reason = f"bank{zone.bank}:program{zone.program}:drum-pcm-balanced-attenuation"
                    elif ref.oper == GEN_REVERB_SEND and ref.amount > limit.max_reverb:
                        new = limit.max_reverb
                        reason = f"bank{zone.bank}:program{zone.program}:reverb-send"
                    elif ref.oper == GEN_CHORUS_SEND and ref.amount > limit.max_chorus:
                        new = limit.max_chorus
                        reason = f"bank{zone.bank}:program{zone.program}:chorus-send"
                    if new is None:
                        continue
                    key = (ref.chunk, ref.index)
                    old_patch = patches.get(key)
                    if old_patch is None or new < old_patch.new:
                        patches[key] = Patch(ref.chunk, ref.index, ref.amount, new, reason)

        if (zone.bank, zone.program) == (0, 5):
            for ref in zone.pglobal_refs:
                if ref.oper != GEN_RELEASE_VOL_ENV:
                    continue
                current = _signed16(ref.amount)
                if current >= DX7_RELEASE_TC:
                    continue
                key = (ref.chunk, ref.index)
                patches[key] = Patch(
                    ref.chunk,
                    ref.index,
                    ref.amount,
                    _pack_u16(DX7_RELEASE_TC),
                    f"bank{zone.bank}:program{zone.program}:dx7-release",
                )
            if zone.key_range[0] >= 97:
                current_attenuation = _attenuation_cb(zone)
                excess = current_attenuation - DX7_HIGH_ZONE_MAX_ATTENUATION_CB
                if excess > 0:
                    refs = _local_attenuation_patch_refs(zone) or _attenuation_patch_refs(zone)
                    per_ref_cb = max(1, round(excess / max(1, len(refs))))
                    for ref in refs:
                        current = _signed16(ref.amount)
                        new = max(-120, min(1440, current - per_ref_cb))
                        patches[(ref.chunk, ref.index)] = Patch(
                            ref.chunk,
                            ref.index,
                            ref.amount,
                            _pack_u16(new),
                            f"bank{zone.bank}:program{zone.program}:dx7-high-zone-gain",
                        )

    rms_cache: dict[int, float] = {}
    for selector, note in AUDITION_NOTES.items():
        active = _active_audition_zones(zones, selector[0], selector[1], note, audition_velocity)
        if not active:
            report.append(f"skip bank{selector[0]}:program{selector[1]} gain: no active audition zones")
            continue
        db = _estimated_db(source, shdrs, active, rms_cache)
        delta_cb = max(0, round((db - target_db) * 10))
        if delta_cb <= 0:
            report.append(f"gain bank{selector[0]}:program{selector[1]} {db:.1f}dB -> no attenuation")
            continue
        touched: set[tuple[bytes, int]] = set()
        for zone in [z for z in zones if (z.bank, z.program) == selector]:
            ref = _attenuation_patch_ref(zone)
            if ref is None:
                continue
            touched.add((ref.chunk, ref.index))
            current = _signed16(ref.amount)
            new = max(-120, min(1440, current + delta_cb))
            key = (ref.chunk, ref.index)
            patches[key] = Patch(ref.chunk, ref.index, ref.amount, _pack_u16(new), f"bank{selector[0]}:program{selector[1]}:+{delta_cb}cb-gain-clean")
        report.append(
            f"gain bank{selector[0]}:program{selector[1]} {db:.1f}dB -> +{delta_cb}cb on {len(touched)} attenuation generators"
        )

    dx7_active = _active_audition_zones(zones, 0, 5, AUDITION_NOTES[(0, 5)], audition_velocity)
    if dx7_active:
        dx7_db = _estimated_db(source, shdrs, dx7_active, rms_cache)
        boost_cb = max(0, round((DX7_MIN_TARGET_DB - dx7_db) * 10))
        if boost_cb > 0:
            refs_by_key: dict[tuple[bytes, int], GenRef] = {}
            for zone in dx7_active:
                for ref in _attenuation_patch_refs(zone):
                    key = (ref.chunk, ref.index)
                    refs_by_key[key] = ref
            per_ref_cb = max(1, round(boost_cb / max(1, len(refs_by_key))))
            for key, ref in refs_by_key.items():
                current = _signed16(ref.amount)
                new = max(-120, min(1440, current - per_ref_cb))
                patches[key] = Patch(ref.chunk, ref.index, ref.amount, _pack_u16(new), f"bank0:program5:-{per_ref_cb}cb-dx7-min-gain")
            report.append(f"gain bank0:program5 {dx7_db:.1f}dB -> -{per_ref_cb}cb on {len(refs_by_key)} attenuation generators")

    for zone in [z for z in zones if (z.bank, z.program) == (0, 11)]:
        # Roland-style vibes have clean spectra but hotter high zones. Keep this
        # as attenuation-only zone balancing so the preset stays musical without
        # adding gain/headroom risk for ESP32.
        db = _estimated_zone_db_with_patches(source, shdrs, zone, rms_cache, patches)
        delta_cb = max(0, round((db - VIBES_ZONE_TARGET_DB) * 10))
        if delta_cb <= 1:
            continue
        refs = _local_attenuation_patch_refs(zone) or _attenuation_patch_refs(zone)
        per_ref_cb = max(1, round(delta_cb / max(1, len(refs))))
        for ref in refs:
            old_patch = patches.get((ref.chunk, ref.index))
            current = _signed16(old_patch.new if old_patch is not None else ref.amount)
            new = max(-120, min(1440, current + per_ref_cb))
            patches[(ref.chunk, ref.index)] = Patch(
                ref.chunk,
                ref.index,
                old_patch.old if old_patch is not None else ref.amount,
                _pack_u16(new),
                f"bank0:program11:+{per_ref_cb}cb-vibes-zone-balance",
            )
        report.append(
            f"gain bank0:program11 zone{zone.key_range[0]}-{zone.key_range[1]} "
            f"{db:.1f}dB -> +{per_ref_cb}cb on {len(refs)} attenuation generators"
        )

    return sorted(patches.values(), key=lambda p: (p.chunk, p.index)), report


def clean_aura25_sf2(source: Path, dest: Path, *, target_db: float, audition_velocity: int) -> dict[str, int]:
    data = bytearray(source.read_bytes())
    offsets = {
        b"pgen": _find_pdta_child_payload_offset(data, b"pgen"),
        b"igen": _find_pdta_child_payload_offset(data, b"igen"),
        b"shdr": _find_pdta_child_payload_offset(data, b"shdr"),
        b"smpl": _find_list_child_payload_offset(data, b"sdta", b"smpl"),
    }
    patches, report = collect_patches(source, target_db=target_db, audition_velocity=audition_velocity)
    for patch in patches:
        amount_offset = offsets[patch.chunk] + patch.index * PGEN_RECORD_SIZE + 2
        struct.pack_into("<H", data, amount_offset, patch.new)
    loop_patches = collect_loop_patches(source)
    for patch in loop_patches:
        record_offset = offsets[b"shdr"] + patch.sample_id * SHDR_RECORD_SIZE
        struct.pack_into("<I", data, record_offset + SHDR_START_LOOP_OFFSET, patch.new_start_loop)
        struct.pack_into("<I", data, record_offset + SHDR_END_LOOP_OFFSET, patch.new_end_loop)
    loop_overrides = {patch.sample_id: (patch.new_start_loop, patch.new_end_loop) for patch in loop_patches}
    pcm_patches = collect_pcm_smoothing_patches(source, loop_overrides=loop_overrides)
    for patch in pcm_patches:
        for frame, value in patch.frames:
            struct.pack_into("<h", data, offsets[b"smpl"] + frame * 2, value)
    drum_gain_patches = collect_drum_pcm_gain_patches(source)
    for patch in drum_gain_patches:
        sh = records(parse_sf2(source)[b"pdta"].chunks[b"shdr"], SHDR)[patch.sample_id]
        start, end = sh[1], sh[2]
        scale = 10 ** (patch.gain_db / 20.0)
        for frame in range(start, end):
            offset = offsets[b"smpl"] + frame * 2
            old = struct.unpack_from("<h", data, offset)[0]
            new = int(np.clip(round(old * scale), -32768, 32767))
            struct.pack_into("<h", data, offset, new)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    for line in report:
        print(line)
    for patch in loop_patches:
        print(
            f"loop {patch.sample_id} {patch.sample_name}: "
            f"{patch.old_score:.3f}->{patch.new_score:.3f} "
            f"shift={patch.new_start_loop - patch.old_start_loop}"
        )
    for patch in pcm_patches:
        print(
            f"pcm-smooth {patch.sample_id} {patch.sample_name}: "
            f"{patch.old_score:.3f}->{patch.new_score:.3f} "
            f"frames={len(patch.frames)}"
        )
    for patch in drum_gain_patches:
        key_list = ",".join(str(k) for k in patch.keys)
        print(
            f"drum-gain {patch.sample_id} {patch.sample_name}: "
            f"{patch.gain_db:+.2f}dB keys={key_list} "
            f"peak={patch.old_peak:.3f}->{patch.new_peak:.3f}"
        )
    return {
        "patches": len(patches),
        "send_patches": sum(1 for p in patches if "send" in p.reason),
        "gain_patches": sum(1 for p in patches if "gain-clean" in p.reason),
        "release_patches": sum(1 for p in patches if "dx7-release" in p.reason),
        "drum_generator_patches": sum(1 for p in patches if "drum-pcm-balanced" in p.reason or "copych-tiny" in p.reason),
        "loop_patches": len(loop_patches),
        "pcm_patches": len(pcm_patches),
        "drum_gain_patches": len(drum_gain_patches),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("dest", type=Path)
    parser.add_argument("--target-db", type=float, default=-26.0)
    parser.add_argument("--audition-velocity", type=int, default=96)
    args = parser.parse_args()
    stats = clean_aura25_sf2(
        args.source,
        args.dest,
        target_db=args.target_db,
        audition_velocity=args.audition_velocity,
    )
    print(
        f"wrote {args.dest} "
        f"({stats['patches']} generators patched, "
        f"{stats['send_patches']} sends, {stats['gain_patches']} gain, "
        f"{stats['release_patches']} release, "
        f"{stats['drum_generator_patches']} drum generators, "
        f"{stats['loop_patches']} loops, {stats['pcm_patches']} pcm smooth, "
        f"{stats['drum_gain_patches']} drum gain)"
    )


if __name__ == "__main__":
    main()
