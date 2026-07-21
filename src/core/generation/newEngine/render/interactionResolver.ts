// ============================================================
// newEngine · render · InteractionResolver
// ------------------------------------------------------------
// 架构定稿 Part 9 / 铁律20:生成期 best-effort 局部读改。改不动放过,交 Auditor 只读报告。
// 边界:可改音符 + 局部 voicing;不改曲式/段落目标/HarmonicPlan。
//   Pass 1:lead/伴奏音域 collision → 上移八度(pc 不变 → 不伤和声合法性)。
//   Pass 2:voicing-around-melody —— comp 音与同响旋律成实际小二度/小九度(浊响)→ 丢该 comp 音
//           (comp 皆 chord tone,丢一个声部仍是该和弦,bass/pad 撑底;= 编曲"绕开旋律"惯例)。
//           当 Arranger 声明 Lead/COMP 同音色禁止同音时,exact unison 也由 comp 让位。
//   改不动 → 放过,交 Auditor 只读报告。
// ============================================================

import { midi } from '../foundation';
import type { MusicalIRData, NoteIR } from '../ir/MusicalIR';
import type { OccupationMap } from './OccupationMap';

export interface ResolveResult {
  data: MusicalIRData;
  adjustments: number;
}

export interface InteractionResolveOptions {
  /**
   * `${startTick}:${pitchClass}` keys for arranger-authored Comp foundation
   * attacks. When Bass is absent these are structural bass/root ownership,
   * not optional upper voicing tones, so melody-clash thinning may not delete them.
   */
  protectedCompFoundationKeys?: ReadonlySet<string>;
  /** Arranger-authored: only enable when instrumentation says lead/comp share the same effective program. */
  forbidLeadCompUnison?: boolean;
  /** Generic comp-around-melody thinning. Score-owned piano renderers may disable this while keeping unison protection. */
  thinCompMelodyClashes?: boolean;
}

const overlapTicks = (a: NoteIR, b: NoteIR): number =>
  Math.min((a.startTick as number) + (a.durationTicks as number), (b.startTick as number) + (b.durationTicks as number))
  - Math.max(a.startTick as number, b.startTick as number);

export function resolveInteractions(
  draft: MusicalIRData,
  occupation: OccupationMap,
  options: InteractionResolveOptions = {},
): ResolveResult {
  let adjustments = 0;

  // —— Pass 1(★ Loop 9 起 no-op):MG 旋律是权威(Loop 7 coordinator-swap),resolver 不再上移 lead 八度
  //   改变其音高/轮廓 —— 音域碰撞改由 comp 让位(Pass 2 下方:comp 撞 lead 丢音)。lead 原样保留。
  void occupation; void midi;
  let tracks = draft.tracks;

  // —— Pass 2:voicing-around-melody —— comp 与(已消解的)lead 撞 m2/m9 → 丢该 comp 音 ——
  const leadNotes = tracks.find((t) => t.role === 'lead')?.notes ?? [];
  const minOverlap = draft.timebase.ppq / 2; // ≥半拍同响才算
  tracks = tracks.map((t) => {
    if (t.role !== 'comp') return t;
    const kept = t.notes.filter((cn) => {
      const hasForbiddenUnison = options.forbidLeadCompUnison === true && leadNotes.some((ln) => {
        if (overlapTicks(cn, ln) < minOverlap) return false;
        return (cn.pitch as number) === (ln.pitch as number);
      });
      if (hasForbiddenUnison) {
        adjustments += 1;
        return false;
      }

      const foundationKey = `${cn.startTick as number}:${((cn.pitch as number) % 12 + 12) % 12}`;
      if (options.protectedCompFoundationKeys?.has(foundationKey)) return true;
      if (options.thinCompMelodyClashes === false) return true;
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
