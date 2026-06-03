import { describe, it, expect } from 'vitest';
import { applyEmptyGlobalDowngrade, runPrepass } from './motifAnchorPrepass';
import { resolveEffectiveCandidate, assertAcyclicReferences } from './MotifStore';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { createRandomContext } from '../foundation';

describe('render/motifAnchorPrepass · applyEmptyGlobalDowngrade', () => {
  it('global + 空安全音 → 降弱(<=0.3)+ reason', () => {
    const r = applyEmptyGlobalDowngrade('global', 0, 0.8);
    expect(r.effective).toBe(0.3);
    expect(r.reason).toBe('empty-global-safe-tone');
  });
  it('global + 有安全音 → 不动', () => {
    expect(applyEmptyGlobalDowngrade('global', 4, 0.8)).toEqual({ effective: 0.8 });
  });
  it('local + 空 → 不降级(local 不触发)', () => {
    expect(applyEmptyGlobalDowngrade('local', 0, 0.8)).toEqual({ effective: 0.8 });
  });
});

describe('render/motifAnchorPrepass · runPrepass', () => {
  const band = buildBandSpec({ seed: 9, styleHint: 'pop', mood: 'x', targetDuration: 120 });
  const arrangement = buildArrangementPlan(band);
  const harmonic = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(9));
  const { anchorPlan, motifStore } = runPrepass(band, arrangement, harmonic, createRandomContext(9));

  it('每个 binding 有 entry + 候选池', () => {
    expect(anchorPlan.entries.length).toBe(arrangement.motifBindings.length);
    for (const b of arrangement.motifBindings) {
      expect(motifStore.bindingCandidates[b.id]).toBeDefined();
      expect(resolveEffectiveCandidate(b.id, motifStore).candidateId).toBe(`${b.id}-c0`);
    }
  });

  it('复现 hook(verse1-p0)= global scope;非复现/连接 = local', () => {
    const v1 = anchorPlan.entries.find((e) => e.phraseId === 'verse1-p0')!;
    expect(v1.commonSafeToneScope).toBe('global'); // verse slot0 = hook,且 verse1/verse2 复现
    const intro = anchorPlan.entries.find((e) => e.phraseId === 'intro-p0')!;
    expect(intro.commonSafeToneScope).toBe('local'); // intro = connector
  });

  it('referenceBindingId:verse2-p0 指向 verse1-p0;参照自身为 undefined', () => {
    const ref = arrangement.motifBindings.find((b) => b.phraseId === 'verse1-p0')!.id;
    const v2 = arrangement.motifBindings.find((b) => b.phraseId === 'verse2-p0')!.id;
    expect(motifStore.bindingCandidates[v2].referenceBindingId).toBe(ref);
    expect(motifStore.bindingCandidates[ref].referenceBindingId).toBeUndefined();
  });

  it('reference graph 无环(Prepass 保证)', () => {
    expect(() => assertAcyclicReferences(motifStore)).not.toThrow();
  });

  it('锚点音高落在 lead 区 [67,84]', () => {
    for (const pool of Object.values(motifStore.bindingCandidates)) {
      for (const cid of pool.candidateOrder) {
        for (const a of pool.candidates[cid].anchorPitches) {
          expect(a.pitch).toBeGreaterThanOrEqual(67);
          expect(a.pitch).toBeLessThanOrEqual(84);
        }
      }
    }
  });

  it('Motif 纯抽象(noteSlots 无 pitch 字段,有 scaleDegree)', () => {
    const m = Object.values(motifStore.motifs)[0];
    expect(m.noteSlots.every((s) => 'pitch' in s === false)).toBe(true);
    expect(typeof m.noteSlots[0].scaleDegree).toBe('number');
  });

  it('MotifStore 深不可变 + 确定性', () => {
    expect(Object.isFrozen(motifStore)).toBe(true);
    const again = runPrepass(band, arrangement, harmonic, createRandomContext(9));
    const pitchesOf = (s: typeof again.motifStore) =>
      Object.values(s.bindingCandidates).flatMap((p) => p.candidateOrder.flatMap((c) => p.candidates[c].anchorPitches.map((a) => a.pitch)));
    expect(pitchesOf(again.motifStore)).toEqual(pitchesOf(motifStore));
  });
});
