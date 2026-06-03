// ============================================================
// newEngine · render · OccurrenceResolver
// ------------------------------------------------------------
// 架构定稿 Part 2.4 / 3.5:Prepass 先解析 motif 出现位置 → 覆盖的 chord span,
// 再喂给纯函数 commonSafeToneSet(它不碰 motif 概念)。
//   local  = 当前 phrase 的 chord span
//   global = 该 motifId 所有 binding 出现位置的 chord span 并集
// Slice 1:section 粒度(phrase→section→该 section 的 chord spans);phrase 精确 span 后续做。
// ============================================================

import type { MotifBinding, Phrase } from '../arranger/ArrangementPlan';
import type { ChordSpanId, HarmonicPlan } from '../harmony/HarmonicPlan';
import type { SafeToneScope } from '../harmony/commonSafeToneQuery';

export function resolveOccurrenceSpans(
  motifId: string,
  motifBindings: readonly MotifBinding[],
  phrases: readonly Phrase[],
  plan: HarmonicPlan,
  scope: SafeToneScope,
  currentPhraseId?: string,
): ChordSpanId[] {
  const sectionOfPhrase = new Map<string, string>();
  for (const p of phrases) sectionOfPhrase.set(p.id, p.sectionId);

  const relevant =
    scope === 'global'
      ? motifBindings.filter((b) => b.motifId === motifId)
      : motifBindings.filter((b) => b.motifId === motifId && b.phraseId === currentPhraseId);

  const sectionIds = new Set<string>();
  for (const b of relevant) {
    const sec = sectionOfPhrase.get(b.phraseId);
    if (sec) sectionIds.add(sec);
  }

  return plan.chordTimeline
    .filter((c) => sectionIds.has(c.sectionId))
    .map((c) => c.id);
}
