import { describe, it, expect } from 'vitest';
import {
  assertAcyclicReferences,
  freezeMotifStore,
  resolveEffectiveCandidate,
  type BindingCandidatePool,
  type MotifCandidate,
  type MotifStoreData,
} from './MotifStore';
import type { Motif } from './Motif';
import { midi } from '../foundation';

function motif(id: string): Motif {
  return { id, source: 'grammar', rhythmCell: { durations: [] }, contourGesture: { directions: [] }, noteSlots: [] };
}
function candidate(id: string, motifId: string): MotifCandidate {
  return {
    candidateId: id,
    motifId,
    skeletonSource: 'grammar',
    rhythmCell: { durations: [] },
    anchorPitches: [{ pitch: midi(60), beatSlot: 0, segment: 'head', lockWeight: 1 }],
    realization: { bindingId: 'b', motifId, pitches: [] },
  };
}
function pool(bindingId: string, sel: string, cands: MotifCandidate[], ref?: string): BindingCandidatePool {
  const candidates: Record<string, MotifCandidate> = {};
  for (const c of cands) candidates[c.candidateId] = c;
  return { bindingId, selectedCandidateId: sel, candidates, candidateOrder: cands.map((c) => c.candidateId), referenceBindingId: ref };
}

describe('render/MotifStore · resolveEffectiveCandidate (H2 fail-closed)', () => {
  const store = freezeMotifStore({
    motifs: { 'm-0': motif('m-0') },
    bindingCandidates: {
      b1: pool('b1', 'c0', [candidate('c0', 'm-0'), candidate('c1', 'm-0')]),
    },
  } as MotifStoreData);

  it('默认返回主选候选', () => {
    expect(resolveEffectiveCandidate('b1', store).candidateId).toBe('c0');
  });

  it('candidateSwap overlay → 切到备选', () => {
    expect(resolveEffectiveCandidate('b1', store, { b1: 'c1' }).candidateId).toBe('c1');
  });

  it('① binding 不存在 → 抛', () => {
    expect(() => resolveEffectiveCandidate('nope', store)).toThrow(RangeError);
  });

  it('② 空候选池(主选指向空)→ 抛', () => {
    const empty = freezeMotifStore({
      motifs: {},
      bindingCandidates: { b1: pool('b1', 'cX', []) },
    } as MotifStoreData);
    expect(() => resolveEffectiveCandidate('b1', empty)).toThrow(RangeError);
  });

  it('③ candidateSwap 指向不存在候选 → 抛', () => {
    expect(() => resolveEffectiveCandidate('b1', store, { b1: 'ghost' })).toThrow(RangeError);
  });
});

describe('render/MotifStore · assertAcyclicReferences (H2 第四边界)', () => {
  it('无环 → 通过', () => {
    const ok = freezeMotifStore({
      motifs: {},
      bindingCandidates: {
        v1: pool('v1', 'c0', [candidate('c0', 'm')]),                 // 参照本身(ref undefined)
        v2: pool('v2', 'c0', [candidate('c0', 'm')], 'v1'),           // v2 → v1
      },
    } as MotifStoreData);
    expect(() => assertAcyclicReferences(ok)).not.toThrow();
  });

  it('④ 成环(a→b→a)→ 抛', () => {
    const cyclic = freezeMotifStore({
      motifs: {},
      bindingCandidates: {
        a: pool('a', 'c0', [candidate('c0', 'm')], 'b'),
        b: pool('b', 'c0', [candidate('c0', 'm')], 'a'),
      },
    } as MotifStoreData);
    expect(() => assertAcyclicReferences(cyclic)).toThrow(RangeError);
  });
});
