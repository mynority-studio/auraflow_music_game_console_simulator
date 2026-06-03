// ============================================================
// newEngine · render · MotifStore + 候选池 + resolveEffectiveCandidate
// ------------------------------------------------------------
// 架构定稿 Part 2.7 / 附录 D4-D8 / H2。
// MotifStore = Prepass 的显式不可变值对象快照(含每 binding 候选池)。
// resolveEffectiveCandidate = 读有效候选的【唯一入口】,fail-closed(H2 四边界)。
// candidateSwap 是 RetryContext 的切片(只传 overlay,render 不依赖 generation,避免循环)。
// ============================================================

import { deepFreeze, type DeepReadonly } from '../foundation';
import type { MotifBindingId, MotifId } from '../arranger/ArrangementPlan';
import type {
  AnchorPitch,
  Motif,
  MotifCandidateId,
  MotifRealization,
  RhythmCell,
  SkeletonSource,
} from './Motif';

export interface MotifCandidate {
  candidateId: MotifCandidateId;
  motifId: MotifId;
  skeletonSource: SkeletonSource;
  rhythmCell: RhythmCell;
  anchorPitches: AnchorPitch[];
  realization: MotifRealization;
}

export interface BindingCandidatePool {
  bindingId: MotifBindingId;
  selectedCandidateId: MotifCandidateId;
  candidates: Record<MotifCandidateId, MotifCandidate>;
  candidateOrder: MotifCandidateId[];
  referenceBindingId?: MotifBindingId; // 强复述拷贝源(undefined = 该 repeatGroup 的参照本身)
}

export interface MotifStoreData {
  motifs: Record<MotifId, Motif>;
  bindingCandidates: Record<MotifBindingId, BindingCandidatePool>;
}

export type MotifStore = DeepReadonly<MotifStoreData>;

export function freezeMotifStore(data: MotifStoreData): MotifStore {
  return deepFreeze(data);
}

export type CandidateSwap = Record<MotifBindingId, MotifCandidateId>;

/**
 * 读有效候选的唯一入口。fail-closed(H2):
 *   ① binding 不存在 ② 候选池为空(主选指向空)③ candidateSwap 指向不存在候选 → 全抛。
 * 有效候选 = candidateSwap[binding] ?? pool.selectedCandidateId。
 */
export function resolveEffectiveCandidate(
  bindingId: MotifBindingId,
  store: MotifStore,
  candidateSwap?: CandidateSwap,
): DeepReadonly<MotifCandidate> {
  const pool = store.bindingCandidates[bindingId];
  if (!pool) {
    throw new RangeError(`resolveEffectiveCandidate(): binding "${bindingId}" 不在 MotifStore`);
  }
  const wantedId = candidateSwap?.[bindingId] ?? pool.selectedCandidateId;
  const cand = pool.candidates[wantedId];
  if (!cand) {
    throw new RangeError(
      `resolveEffectiveCandidate(): candidate "${wantedId}" 不在 binding "${bindingId}" 候选池(空池/越界 swap)`,
    );
  }
  return cand;
}

/** H2 第四边界:Prepass 须保证 referenceBindingId 链无环。此处校验,成环即抛。 */
export function assertAcyclicReferences(store: MotifStore): void {
  const pools = store.bindingCandidates;
  for (const startId of Object.keys(pools)) {
    const seen = new Set<string>();
    let cur: string | undefined = startId;
    while (cur !== undefined) {
      if (seen.has(cur)) {
        throw new RangeError(`MotifStore reference graph 成环 @ "${cur}"`);
      }
      seen.add(cur);
      cur = pools[cur]?.referenceBindingId;
    }
  }
}
