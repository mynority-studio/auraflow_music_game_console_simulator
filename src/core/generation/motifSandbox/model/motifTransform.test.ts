import { describe, it, expect } from 'vitest';
import { identity, transposeDiatonicMotif, invertAroundMidi, retrogradePitchOnly, fitRange } from './motifTransform';
import { analyzeAndNormalize, generateSampleCaptured } from './motifAnalysis';
import { isInScale } from './scale';
import type { MotifNote } from './types';

function sampleMotif(keyPc = 0, mode: 'major' | 'minor' = 'major'): MotifNote[] {
  return analyzeAndNormalize(generateSampleCaptured(96, keyPc, mode, 0), keyPc, mode, 96).motif.notes;
}

describe('motifSandbox/motifTransform', () => {
  it('identity:pitch/rhythm 与原 motif 等价', () => {
    const m = sampleMotif();
    const id = identity(m);
    expect(id.map((n) => [n.midi, n.onsetBeat, n.durationBeat])).toEqual(m.map((n) => [n.midi, n.onsetBeat, n.durationBeat]));
  });

  it('transposeDiatonic / invert 后仍全在调内', () => {
    const m = sampleMotif(7, 'minor');
    for (const steps of [1, -2, 3]) for (const n of transposeDiatonicMotif(m, steps, 7, 'minor')) expect(isInScale(n.midi, 7, 'minor')).toBe(true);
    for (const n of invertAroundMidi(m, m[0].midi, 7, 'minor')) expect(isInScale(n.midi, 7, 'minor')).toBe(true);
  });

  it('retrograde 只逆 pitch,rhythm 不变', () => {
    const m = sampleMotif();
    const r = retrogradePitchOnly(m);
    expect(r.map((n) => n.onsetBeat)).toEqual(m.map((n) => n.onsetBeat));
    expect(r.map((n) => n.midi)).toEqual(m.map((n) => n.midi).reverse());
  });

  it('fitRange:把超域音拉回 [low,high]', () => {
    const m = sampleMotif();
    const high = m.map((n) => ({ ...n, midi: n.midi + 36 })); // 抬 3 个八度
    const fit = fitRange(high, 60, 84);
    for (const n of fit) { expect(n.midi).toBeGreaterThanOrEqual(60); expect(n.midi).toBeLessThanOrEqual(84); }
  });
});
