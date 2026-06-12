// ============================================================
// motifSandbox · model · jazziness 审计 + quote 校验
// ------------------------------------------------------------
// 非 jazz(POP/LOFI/RNB)目标:chromaticRatio=0、大跳少、密度适中 → jazzinessScore 低。
// ============================================================

import type { MotifNote, MotifOccurrence, MotifWeaveAudit, ScaleMode, UserMotif } from './types';
import { isInScale } from './scale';

const EPS = 1e-6;

/** 某 startBeat 处是否存在 motif 的原样复现(逐音 onset 相对 + pitch 匹配)。 */
export function isMotifQuotedAt(lead: readonly MotifNote[], motif: UserMotif, startBeat: number): boolean {
  for (const m of motif.notes) {
    const want = startBeat + m.onsetBeat;
    const hit = lead.find((n) => Math.abs(n.onsetBeat - want) < EPS && n.midi === m.midi);
    if (!hit) return false;
  }
  return true;
}

export function auditMotifWeave(
  lead: readonly MotifNote[],
  motif: UserMotif,
  occurrences: readonly MotifOccurrence[],
  keyPc: number,
  mode: ScaleMode,
): MotifWeaveAudit {
  const sorted = [...lead].sort((a, b) => a.onsetBeat - b.onsetBeat);
  let maxLeap = 0;
  for (let i = 1; i < sorted.length; i++) maxLeap = Math.max(maxLeap, Math.abs(sorted[i].midi - sorted[i - 1].midi));
  const chromatic = sorted.filter((n) => !isInScale(n.midi, keyPc, mode)).length;
  const chromaticRatio = sorted.length ? chromatic / sorted.length : 0;
  const sixteenths = sorted.filter((n) => n.durationBeat <= 0.25 + EPS).length;
  const denseRatio = sorted.length ? sixteenths / sorted.length : 0;
  const leapPenalty = Math.min(1, Math.max(0, maxLeap - 9) / 8); // >9 半音才扣
  const jazzinessScore = Math.min(1, chromaticRatio * 0.6 + denseRatio * 0.3 + leapPenalty * 0.1);

  const v1 = occurrences.find((o) => o.sectionId === 'verse1' && o.kind === 'quote');
  const v2 = occurrences.find((o) => o.sectionId === 'verse2' && o.kind === 'quote');
  return {
    motifQuotedInVerse1: !!v1 && isMotifQuotedAt(lead, motif, v1.startBeat),
    motifQuotedInVerse2: !!v2 && isMotifQuotedAt(lead, motif, v2.startBeat),
    maxLeap, chromaticRatio, jazzinessScore,
  };
}
