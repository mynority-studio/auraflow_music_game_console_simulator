import { describe, it, expect } from 'vitest';
import { realizeToSandboxChords } from './motifRoadmap';
import { generateMotifWeave } from './motifWeaver';
import { generateSampleCaptured } from './motifAnalysis';
import { snapMidiToTonality } from './sandboxScales';
import type { ProgressionSlot } from '../../newEngine/knowledge/progressions';

const m12 = (n: number) => ((n % 12) + 12) % 12;
// 12-slot 进行(I IV V 循环):给 seasoning 足够 S/D 候选
const slot = (roman: string, scaleDegree: number, type = 'maj', effectiveFunc?: 'T' | 'S' | 'D'): ProgressionSlot =>
  ({ roman, type, scaleDegree, rootOffset: [0, 2, 4, 5, 7, 9, 11][(scaleDegree - 1) % 7], effectiveFunc });
const prog: ProgressionSlot[] = [
  slot('I', 1, 'maj', 'T'), slot('IV', 4, 'maj', 'S'), slot('I', 1, 'maj', 'T'), slot('V', 5, 'maj', 'D'),
  slot('I', 1, 'maj', 'T'), slot('IV', 4, 'maj', 'S'), slot('I', 1, 'maj', 'T'), slot('V', 5, 'maj', 'D'),
];

describe('motifSandbox/blues seasoning(Phase 3)', () => {
  it('非布鲁斯:无 opts → 不调味(无 bluesSeasoned)', () => {
    const out = realizeToSandboxChords(prog, 0, 'major');
    expect(out.some((c) => c.bluesSeasoned)).toBe(false);
  });

  it('majorBlues:有界调味(1..4 和弦),优先 S/D,seasoned 和弦含 b7,且不连续', () => {
    const out = realizeToSandboxChords(prog, 0, 'major', { inputTonality: 'majorBlues', seed: 7 });
    const idx = out.map((c, i) => (c.bluesSeasoned ? i : -1)).filter((i) => i >= 0);
    expect(idx.length).toBeGreaterThanOrEqual(1);
    expect(idx.length).toBeLessThanOrEqual(4);
    for (let k = 1; k < idx.length; k++) expect(idx[k] - idx[k - 1]).toBeGreaterThan(1); // 不连续
    for (const i of idx) {
      const c = out[i];
      const root = c.realRootPc ?? c.rootPc;
      expect(c.realTonePcs).toContain(m12(root + 10)); // b7(dom 色)
      expect(c.realType).toMatch(/7/);                 // 类型反映 dom
    }
  });

  it('确定性:同 seed 同 seasoned 集;不同 seed 可不同', () => {
    const a = realizeToSandboxChords(prog, 0, 'major', { inputTonality: 'majorBlues', seed: 7 }).map((c) => !!c.bluesSeasoned);
    const b = realizeToSandboxChords(prog, 0, 'major', { inputTonality: 'majorBlues', seed: 7 }).map((c) => !!c.bluesSeasoned);
    expect(a).toEqual(b);
  });

  it('majorBlues:V(D 功能)被调味后容纳 key 蓝调音 b3 作张力(若 nice interval)', () => {
    // V root=G(7);key b3=Eb(3);(3-7)%12=8=b13 ∈ NICE → 调味后 V 含 Eb
    const vOnly: ProgressionSlot[] = [slot('V', 5, 'maj', 'D'), slot('I', 1, 'maj', 'T'), slot('V', 5, 'maj', 'D'), slot('I', 1, 'maj', 'T')];
    const out = realizeToSandboxChords(vOnly, 0, 'major', { inputTonality: 'majorBlues', seed: 1 });
    const seasonedV = out.find((c) => c.bluesSeasoned && (c.realRootPc ?? c.rootPc) === 7);
    expect(seasonedV).toBeTruthy();
    expect(seasonedV!.realTonePcs).toContain(3); // Eb(b13 of G)
  });

  it('端到端:POP + majorBlues 不变成全 blues(seasoned 占比有界,模板仍 POP 驱动)', () => {
    const cap = generateSampleCaptured(96, 0, 'major', 0).map((n) => ({ ...n, midi: snapMidiToTonality(n.midi, 0, 'majorBlues') }));
    const r = generateMotifWeave({ capturedNotes: cap, style: 'pop', keyPc: 0, mode: 'major', bpm: 96, seed: 7, inputTonality: 'majorBlues' });
    const seasoned = r.progression.filter((c) => c.bluesSeasoned).length;
    expect(seasoned).toBeGreaterThanOrEqual(0);              // 可能 0(无合适 S/D),但不报错
    expect(seasoned).toBeLessThanOrEqual(Math.ceil(r.progression.length * 0.35)); // 远小于全曲
    expect(r.lead.length).toBeGreaterThan(0);
    // 非布鲁斯同 motif → 0 seasoned
    const r2 = generateMotifWeave({ capturedNotes: cap, style: 'pop', keyPc: 0, mode: 'major', bpm: 96, seed: 7 });
    expect(r2.progression.some((c) => c.bluesSeasoned)).toBe(false);
  });
});
