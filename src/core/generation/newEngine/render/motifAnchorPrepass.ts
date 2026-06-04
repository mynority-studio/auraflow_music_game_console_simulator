// ============================================================
// newEngine · render · Motif/Anchor Prepass
// ------------------------------------------------------------
// 架构定稿 Part 3.5 / 8.1:伴奏前定 hook 身份 + 锚点。输出 MelodyAnchorPlan + MotifStore(候选池)。
//   1. 逐 motifId 生成抽象 Motif(无 pitch);源 hook→grammar / 连接→guidetone
//   2. occurrence 解析 → commonSafeToneSet(复现 hook=global / 其余=local)
//   3. global 空交集 → 降弱排比 + downgradeReason
//   4. 每 repeatGroup(=同 motifId)首次出现 = 参照,后续 referenceBindingId 指向它(无环)
//   5. 备候选池(主选 + 1 备选,各带 realization + 锚点),冻进 MotifStore
// Slice 1:motif 内容为占位 shape(scaleDegree [1,3,5,3]);真 grammar 变体后续接。
// ============================================================

import { beats, type PitchClass, type RandomContext } from '../foundation';
import type { BandSpec } from '../band/BandSpec';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import { phraseStartBeats } from '../arranger/phraseTiming';
import { pcToMidiInRange } from '../knowledge/pitchPlacement';
import { generateMotifShape, type MotifShape } from '../knowledge/motifShapes';
import { commonSafeToneSet, type SafeToneScope } from '../harmony/commonSafeToneQuery';
import type { HarmonicPlan } from '../harmony/HarmonicPlan';
import { resolveOccurrenceSpans } from './occurrenceResolver';
import type { AnchorPitch, Motif, SkeletonSource } from './Motif';
import {
  assertAcyclicReferences,
  freezeMotifStore,
  type BindingCandidatePool,
  type MotifCandidate,
  type MotifStore,
  type MotifStoreData,
} from './MotifStore';
import type { DowngradeReason, MelodyAnchorEntry, MelodyAnchorPlan } from './MelodyAnchorPlan';

export interface PrepassOutput {
  anchorPlan: MelodyAnchorPlan;
  motifStore: MotifStore;
}

const LEAD_LOW = 67;
const LEAD_HIGH = 84;
const WEAK_STRENGTH = 0.3;

/** 抽象 motif(无 pitch)。由 rng 抽出的 MotifShape 实化:节奏/音级/轮廓皆随种子变。 */
function buildMotif(motifId: string, source: SkeletonSource, shape: MotifShape): Motif {
  let t = 0;
  const noteSlots = shape.scaleDegrees.map((d, i) => {
    const slot = {
      slotId: i,
      timeOffset: beats(t),
      duration: beats(shape.rhythmCell[i]),
      scaleDegree: d,
      lockWeight: i === 0 ? 1 : 0.5,
      segment: (i === 0 ? 'head' : 'tail') as 'head' | 'tail',
    };
    t += shape.rhythmCell[i];
    return slot;
  });
  return {
    id: motifId,
    source,
    rhythmCell: { durations: shape.rhythmCell.map((r) => beats(r)) },
    contourGesture: { directions: shape.contour },
    noteSlots,
  };
}

/** 空-global 降级:复现 hook 的 head 跨段找不到共同安全音 → 降弱排比。 */
export function applyEmptyGlobalDowngrade(
  scope: SafeToneScope,
  safeCount: number,
  requested: number,
): { effective: number; reason?: DowngradeReason } {
  if (scope === 'global' && safeCount === 0) {
    return { effective: Math.min(requested, WEAK_STRENGTH), reason: 'empty-global-safe-tone' };
  }
  return { effective: requested };
}

export function runPrepass(
  band: BandSpec,
  arrangement: ArrangementPlan,
  harmonic: HarmonicPlan,
  rng: RandomContext,
): PrepassOutput {
  const prng = rng.substream('prepass'); // ★ 种子驱动动机形状
  const phraseById = new Map(arrangement.phrases.map((p) => [p.id, p]));
  const starts = phraseStartBeats(arrangement);

  // motifId → 出现次数(>1 = 复现)
  const countByMotif = new Map<string, number>();
  for (const b of arrangement.motifBindings) {
    countByMotif.set(b.motifId, (countByMotif.get(b.motifId) ?? 0) + 1);
  }
  // motifId → 首个 binding(= 该 repeatGroup 的参照)
  const refByMotif = new Map<string, string>();
  for (const b of arrangement.motifBindings) {
    if (!refByMotif.has(b.motifId)) refByMotif.set(b.motifId, b.id);
  }

  const motifs: Record<string, Motif> = {};
  const bindingCandidates: Record<string, BindingCandidatePool> = {};
  const entries: MelodyAnchorEntry[] = [];

  for (const binding of arrangement.motifBindings) {
    const phrase = phraseById.get(binding.phraseId)!;
    const isHook = phrase.skeletonRole === 'hook';
    const recurs = (countByMotif.get(binding.motifId) ?? 0) > 1;
    const scope: SafeToneScope = isHook && recurs ? 'global' : 'local';
    const source: SkeletonSource = isHook ? 'grammar' : 'guidetone';

    if (!motifs[binding.motifId]) {
      motifs[binding.motifId] = buildMotif(binding.motifId, source, generateMotifShape(prng));
    }

    const spans = resolveOccurrenceSpans(
      binding.motifId,
      arrangement.motifBindings,
      arrangement.phrases,
      harmonic,
      scope,
      phrase.id,
    );
    const safe = commonSafeToneSet(harmonic, scope, spans);
    const { effective, reason } = applyEmptyGlobalDowngrade(
      scope,
      safe.length,
      binding.requestedRestatementStrength,
    );

    entries.push({
      phraseId: phrase.id,
      bindingId: binding.id,
      commonSafeToneScope: scope,
      commonSafeToneSet: safe,
      requestedRestatementStrength: binding.requestedRestatementStrength,
      effectiveRestatementStrength: effective,
      downgradeReason: reason,
    });

    // 锚点候选音 pc:安全音优先,空则退主音
    const fallbackPc = band.key as number;
    const beatSlot = starts[phrase.id] ?? 0;
    const mkCandidate = (idx: number): MotifCandidate => {
      const pc: PitchClass = (safe.length > 0 ? safe[idx % safe.length] : fallbackPc) as PitchClass;
      const anchor: AnchorPitch = {
        pitch: pcToMidiInRange(pc, LEAD_LOW, LEAD_HIGH),
        beatSlot,
        segment: 'head',
        lockWeight: 1,
      };
      const candidateId = `${binding.id}-c${idx}`;
      return {
        candidateId,
        motifId: binding.motifId,
        skeletonSource: source,
        rhythmCell: motifs[binding.motifId].rhythmCell,
        anchorPitches: [anchor],
        realization: { bindingId: binding.id, motifId: binding.motifId, pitches: [anchor] },
      };
    };

    const c0 = mkCandidate(0);
    const c1 = mkCandidate(1);
    const refId = refByMotif.get(binding.motifId);
    bindingCandidates[binding.id] = {
      bindingId: binding.id,
      selectedCandidateId: c0.candidateId,
      candidates: { [c0.candidateId]: c0, [c1.candidateId]: c1 },
      candidateOrder: [c0.candidateId, c1.candidateId],
      referenceBindingId: refId === binding.id ? undefined : refId,
    };
  }

  const store = freezeMotifStore({ motifs, bindingCandidates } as MotifStoreData);
  assertAcyclicReferences(store);

  return { anchorPlan: { entries }, motifStore: store };
}
