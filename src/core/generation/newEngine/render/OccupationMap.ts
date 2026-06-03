// ============================================================
// newEngine · render · OccupationMap
// ------------------------------------------------------------
// 架构定稿 Part 2.8 / 8.3:伴奏占用分析,旋律据此填空 / Resolver 据此判 collision。
// Slice 1:每非 lead 轨的音域占用 + 起音 tick + lead 预留区。
// ============================================================

import type { TrackIR } from '../ir/MusicalIR';

export interface RegisterSpan {
  lowMidi: number;
  highMidi: number;
}

export interface OccupiedRegister {
  role: string;
  lowMidi: number;
  highMidi: number;
}

export interface OccupationMap {
  occupiedRegisters: OccupiedRegister[]; // 非 lead 轨的音域(collision 判据)
  onsetTicks: number[];                  // 伴奏起音(节奏占用),升序去重
  reservedMelodyRegister: RegisterSpan;  // lead 预留区
}

export function buildOccupationMap(
  tracks: TrackIR[],
  reservedMelodyRegister: RegisterSpan,
): OccupationMap {
  const occupiedRegisters: OccupiedRegister[] = [];
  const onsets = new Set<number>();

  for (const t of tracks) {
    if (t.role === 'lead' || t.notes.length === 0) continue;
    let lo = Infinity;
    let hi = -Infinity;
    for (const n of t.notes) {
      lo = Math.min(lo, n.pitch);
      hi = Math.max(hi, n.pitch);
      onsets.add(n.startTick);
    }
    occupiedRegisters.push({ role: t.role, lowMidi: lo, highMidi: hi });
  }

  return {
    occupiedRegisters,
    onsetTicks: [...onsets].sort((a, b) => a - b),
    reservedMelodyRegister,
  };
}
