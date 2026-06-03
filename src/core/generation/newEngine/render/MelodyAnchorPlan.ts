// ============================================================
// newEngine · render · MelodyAnchorPlan(Prepass 输出之一)
// ------------------------------------------------------------
// 架构定稿 Part 2.6:只留【候选无关】的 binding 级字段(防 candidateSwap 后过期)。
// 候选特定字段(motifId/source/rhythmCell/anchors)在 MotifCandidate,经
// resolveEffectiveCandidate 取。Prepass 同时输出 MotifStore(2.7)。
// ============================================================

import type { PitchClass } from '../foundation';
import type { MotifBindingId, PhraseId } from '../arranger/ArrangementPlan';
import type { SafeToneScope } from '../harmony/commonSafeToneQuery';

export type DowngradeReason = 'empty-global-safe-tone' | 'collision-ladder' | 'retry-lowered';

export interface MelodyAnchorEntry {
  phraseId: PhraseId;
  bindingId: MotifBindingId;
  commonSafeToneScope: SafeToneScope;
  commonSafeToneSet: PitchClass[];
  requestedRestatementStrength: number;   // Arranger 意图,不可变
  effectiveRestatementStrength: number;   // Render 实际锁档(可能被降级)
  downgradeReason?: DowngradeReason;
}

export interface MelodyAnchorPlan {
  entries: MelodyAnchorEntry[];
}
