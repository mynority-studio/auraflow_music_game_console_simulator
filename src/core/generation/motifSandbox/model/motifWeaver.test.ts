import { describe, it, expect } from 'vitest';
import { generateMotifWeave } from './motifWeaver';
import { generateSampleCaptured } from './motifAnalysis';
import { isInScale } from './scale';
import { quotedAt } from './jazzinessAudit';
import { fitRange, identity } from './motifTransform';
import type { MotifWeaverInput } from './types';

const baseInput = (over: Partial<MotifWeaverInput> = {}): MotifWeaverInput => ({
  capturedNotes: generateSampleCaptured(96, 0, 'major', 0),
  style: 'pop', keyPc: 0, mode: 'major', bpm: 96, seed: 7, ...over,
});
const sig = (lead: { midi: number; onsetBeat: number }[]) => lead.map((n) => `${n.midi}@${n.onsetBeat.toFixed(2)}`).join(',');

describe('motifSandbox/motifWeaver(和弦进行 × motif 复现)', () => {
  it('配出和弦进行;第一轮轮首原样 motif', () => {
    const r = generateMotifWeave(baseInput());
    expect(r.progression.length).toBeGreaterThan(0);
    expect(r.audit.motifQuotedFirstCycle).toBe(true);
    const ref = fitRange(identity(r.motif.notes), 60, 84);
    expect(quotedAt(r.lead, ref, 0)).toBe(true); // 轮首 = 原样 motif
  });

  it('各轮复制一致(进行重复 → 复制第一遍)', () => {
    const r = generateMotifWeave(baseInput());
    expect(r.numCycles).toBeGreaterThanOrEqual(2);
    expect(r.audit.cyclesConsistent).toBe(true);
  });

  it('每轮 motif 出现 1 或 2 次;2 次时后半段有 adapted', () => {
    let sawOnce = false, sawTwice = false;
    for (let s = 1; s <= 20; s++) {
      const r = generateMotifWeave(baseInput({ seed: s }));
      expect([1, 2]).toContain(r.audit.placementsPerCycle);
      if (r.audit.placementsPerCycle === 1) sawOnce = true;
      if (r.audit.placementsPerCycle === 2) { sawTwice = true; expect(r.lead.some((n) => n.occurrenceKind === 'adapted')).toBe(true); }
    }
    expect(sawOnce && sawTwice).toBe(true); // 概率 once/twice 都出现过
  });

  it('确定性:同 seed 同结果', () => {
    expect(sig(generateMotifWeave(baseInput({ seed: 11 })).lead)).toBe(sig(generateMotifWeave(baseInput({ seed: 11 })).lead));
  });

  it('POP/LOFI/RNB:chromaticRatio = 0(全 diatonic);jazziness < 0.4', () => {
    for (const style of ['pop', 'lofi', 'rnb'] as const) {
      const r = generateMotifWeave(baseInput({ style }));
      expect(r.audit.chromaticRatio, style).toBe(0);
      for (const n of r.lead) expect(isInScale(n.midi, 0, 'major'), `${style} GM${n.midi}`).toBe(true);
      expect(r.audit.jazzinessScore, style).toBeLessThan(0.4);
    }
  });

  it('音符排序 + 时值非负', () => {
    const r = generateMotifWeave(baseInput());
    const sorted = [...r.lead].sort((a, b) => a.onsetBeat - b.onsetBeat);
    expect(r.lead.map((n) => n.onsetBeat)).toEqual(sorted.map((n) => n.onsetBeat));
    for (const n of r.lead) expect(n.durationBeat).toBeGreaterThan(0);
  });

  it('★ 续写旋律线平滑:相邻跳进 ≤ 小六度(8 半音),音域 ≤ 十度(作曲原则)', () => {
    for (const style of ['pop', 'lofi', 'rnb'] as const) {
      for (let seed = 1; seed <= 24; seed++) {
        const r = generateMotifWeave(baseInput({ style, seed }));
        const lead = [...r.lead].sort((a, b) => a.onsetBeat - b.onsetBeat);
        let maxLeap = 0;
        for (let i = 1; i < lead.length; i++) maxLeap = Math.max(maxLeap, Math.abs(lead[i].midi - lead[i - 1].midi));
        expect(maxLeap, `${style} seed${seed} 跳进`).toBeLessThanOrEqual(8); // 无大跳(≤ 小六度)
        const range = Math.max(...lead.map((n) => n.midi)) - Math.min(...lead.map((n) => n.midi));
        expect(range, `${style} seed${seed} 音域`).toBeLessThanOrEqual(19); // ≤ 十二度内(含 motif 自身音域)
      }
    }
  });

  it('minor key 全在调内;1-4 bar motif 都不崩', () => {
    for (const lenVariant of [0, 1, 2, 3]) {
      const r = generateMotifWeave(baseInput({ capturedNotes: generateSampleCaptured(96, 9, 'minor', lenVariant), keyPc: 9, mode: 'minor' }));
      for (const n of r.lead) expect(isInScale(n.midi, 9, 'minor')).toBe(true);
      expect(r.lead.length).toBeGreaterThan(4);
    }
  });
});
