// ============================================================
// newEngine · render · InteractionResolver
// ------------------------------------------------------------
// 架构定稿 Part 9 / 铁律20:生成期 best-effort 局部读改。改不动放过,交 Auditor 只读报告。
// 边界:可改音符 + 局部 voicing;不改曲式/段落目标/HarmonicPlan。
// Slice 1:lead/伴奏音域 collision → 上移八度(pc 不变 → 不伤和声合法性);改不动放过。
//   (harmonic 类局部修正 + tensionModel 共用判据后续接;此处先做 register collision。)
// ============================================================

import { midi } from '../foundation';
import type { MusicalIRData } from '../ir/MusicalIR';
import type { OccupationMap } from './OccupationMap';

export interface ResolveResult {
  data: MusicalIRData;
  adjustments: number;
}

export function resolveInteractions(draft: MusicalIRData, occupation: OccupationMap): ResolveResult {
  let adjustments = 0;

  const tracks = draft.tracks.map((t) => {
    if (t.role !== 'lead') return t;
    const notes = t.notes.map((n) => {
      const collides = occupation.occupiedRegisters.some(
        (o) => n.pitch >= o.lowMidi && n.pitch <= o.highMidi,
      );
      if (collides) {
        const up = (n.pitch as number) + 12; // 上移八度(pc 不变)
        if (up <= occupation.reservedMelodyRegister.highMidi) {
          adjustments += 1;
          return { ...n, pitch: midi(up) };
        }
        // 改不动 → 放过,交 Auditor
      }
      return n;
    });
    return { role: t.role, notes };
  });

  return {
    data: { tracks, timebase: draft.timebase, durationTicks: draft.durationTicks },
    adjustments,
  };
}
