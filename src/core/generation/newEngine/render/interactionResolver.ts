// ============================================================
// newEngine · render · InteractionResolver
// ------------------------------------------------------------
// 架构定稿 Part 9 / 铁律20:生成期 best-effort 局部读改。改不动放过,交 Auditor 只读报告。
// 边界:可改音符 + 局部 voicing;不改曲式/段落目标/HarmonicPlan。
//   Pass 1:lead/伴奏音域 collision → 上移八度(pc 不变 → 不伤和声合法性)。
//   Pass 2:voicing-around-melody —— comp 音与同响旋律成实际小二度/小九度(浊响)→ 丢该 comp 音
//           (comp 皆 chord tone,丢一个声部仍是该和弦,bass/pad 撑底;= 编曲"绕开旋律"惯例)。
//   改不动 → 放过,交 Auditor 只读报告。
// ============================================================

import { midi } from '../foundation';
import type { MusicalIRData, NoteIR } from '../ir/MusicalIR';
import type { OccupationMap } from './OccupationMap';

export interface ResolveResult {
  data: MusicalIRData;
  adjustments: number;
}

const overlapTicks = (a: NoteIR, b: NoteIR): number =>
  Math.min((a.startTick as number) + (a.durationTicks as number), (b.startTick as number) + (b.durationTicks as number))
  - Math.max(a.startTick as number, b.startTick as number);

export function resolveInteractions(draft: MusicalIRData, occupation: OccupationMap): ResolveResult {
  let adjustments = 0;

  // —— Pass 1:lead 音域碰撞 → 上移八度 ——
  let tracks = draft.tracks.map((t) => {
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
      }
      return n;
    });
    return { role: t.role, notes };
  });

  // —— Pass 2:voicing-around-melody —— comp 与(已消解的)lead 撞 m2/m9 → 丢该 comp 音 ——
  const leadNotes = tracks.find((t) => t.role === 'lead')?.notes ?? [];
  const minOverlap = draft.timebase.ppq / 2; // ≥半拍同响才算
  tracks = tracks.map((t) => {
    if (t.role !== 'comp') return t;
    const kept = t.notes.filter((cn) => {
      const clashes = leadNotes.some((ln) => {
        if (overlapTicks(cn, ln) < minOverlap) return false;
        const d = Math.abs((cn.pitch as number) - (ln.pitch as number));
        return d === 1 || d === 13; // 实际小二度 / 小九度
      });
      if (clashes) adjustments += 1;
      return !clashes; // 丢掉撞音的 comp 声部
    });
    return { role: t.role, notes: kept };
  });

  return {
    data: { tracks, timebase: draft.timebase, durationTicks: draft.durationTicks },
    adjustments,
  };
}
