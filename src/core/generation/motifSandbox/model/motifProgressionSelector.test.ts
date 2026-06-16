import { describe, it, expect } from 'vitest';
import { analyzeUserMelodicBrick } from './melodicBrickAnalyzer';
import { inferHarmonyIntent } from './melodicBrickHarmonyIntent';
import { selectProgressionForMotif } from './motifProgressionSelector';
import { scoreProgressionAgainstMelodicBrick } from './melodyProgressionScorer';
import { degreeOctaveToMidi } from './scale';
import type { UserMotif } from './types';
import type { ProgressionCandidate } from './progressionCandidateProvider';
import type { ProgressionSlot, ProgressionPrototype } from '../../newEngine/knowledge/progressions';

function motif(degrees: number[], durs: number[]): UserMotif {
  let onset = 0;
  const notes = degrees.map((d, i) => {
    const n = { midi: degreeOctaveToMidi(d, 5, 0, 'major' as const), onsetBeat: onset, durationBeat: durs[i], velocity: 0.85, scaleDegree: d, octave: 5, accent: 0.7, structuralToneScore: Math.min(1, 0.4 + durs[i] * 0.3) };
    onset += durs[i]; return n;
  });
  const contour: number[] = [];
  for (let i = 1; i < notes.length; i++) contour.push(Math.sign(notes[i].midi - notes[i - 1].midi));
  return { id: 'm', keyPc: 0, mode: 'major', bpm: 96, notes, lengthBeats: 4, contour, rhythmCell: durs, createdAt: 0 };
}
const slot = (roman: string, deg: number, func?: 'T' | 'S' | 'D'): ProgressionSlot => ({ roman, type: 'maj', scaleDegree: deg, rootOffset: 0, effectiveFunc: func });
const fakeCandidate = (id: string, romans: Array<[string, number, ('T' | 'S' | 'D')?]>, cadence?: ProgressionPrototype['cadence']): ProgressionCandidate => {
  const slots = romans.map(([r, d, f]) => slot(r, d, f));
  return { prototype: { id, style: 'POP', mode: 'Major', sectionRoles: ['verse'], lengthBars: 4, slots, cadence }, fittedSlots: slots };
};

describe('motifSandbox/motifProgressionSelector(brick 驱动选模板)', () => {
  it('① 端到端:cadence motif → 选出 16-bar 进行,非退化(≥3 个不同级),确定性,POP', () => {
    const brick = analyzeUserMelodicBrick(motif([3, 2, 1], [1, 1, 2]));
    const intent = inferHarmonyIntent(brick);
    const sel = selectProgressionForMotif({ brick, intent, style: 'pop', mode: 'major', keyPc: 0, seed: 7 });
    expect(sel.style).toBe('POP');
    expect(sel.slots.reduce((n, s) => n + (s.beats ?? 4), 0)).toBe(64); // fit 满 16 bar
    const cycleDegs = new Set(sel.slots.slice(0, 4).map((s) => s.scaleDegree));
    expect(cycleDegs.size, '一个循环里 ≥3 个不同级(非 V-I-I-I)').toBeGreaterThanOrEqual(3);
    const sel2 = selectProgressionForMotif({ brick, intent, style: 'pop', mode: 'major', keyPc: 0, seed: 7 });
    expect(sel.prototypeId).toBe(sel2.prototypeId); // 确定性
    expect(sel.topCandidates.length).toBeGreaterThan(0);
  });

  it('② 退化进行被重罚:V-I-I-I 分数 < 富进行 I-vi-IV-V', () => {
    const brick = analyzeUserMelodicBrick(motif([3, 2, 1], [1, 1, 2]));
    const intent = inferHarmonyIntent(brick);
    const degenerate = fakeCandidate('deg', [['V', 5, 'D'], ['I', 1, 'T'], ['I', 1, 'T'], ['I', 1, 'T']], 'soft_authentic');
    const rich = fakeCandidate('rich', [['I', 1, 'T'], ['vi', 6, 'T'], ['IV', 4, 'S'], ['V', 5, 'D']], 'soft_authentic');
    const dScore = scoreProgressionAgainstMelodicBrick(brick, intent, degenerate, 0, 'major');
    const rScore = scoreProgressionAgainstMelodicBrick(brick, intent, rich, 0, 'major');
    expect(dScore.breakdown.degeneratePenalty).toBeGreaterThan(0);
    expect(rScore.breakdown.degeneratePenalty).toBe(0);
    expect(rScore.total).toBeGreaterThan(dScore.total);
  });

  it('③ cadence 偏好:soft_authentic 模板的 cadenceFit 高于 open 模板(对 cadence motif)', () => {
    const brick = analyzeUserMelodicBrick(motif([3, 2, 1], [1, 1, 2])); // 终止类
    const intent = inferHarmonyIntent(brick);
    const authentic = fakeCandidate('a', [['I', 1, 'T'], ['IV', 4, 'S'], ['V', 5, 'D'], ['I', 1, 'T']], 'soft_authentic');
    const open = fakeCandidate('o', [['I', 1, 'T'], ['IV', 4, 'S'], ['vi', 6, 'T'], ['V', 5, 'D']], 'open');
    const a = scoreProgressionAgainstMelodicBrick(brick, intent, authentic, 0, 'major');
    const o = scoreProgressionAgainstMelodicBrick(brick, intent, open, 0, 'major');
    expect(a.breakdown.cadenceFit).toBeGreaterThan(o.breakdown.cadenceFit);
  });

  it('④ 非 jazz 不选 jazz', () => {
    const brick = analyzeUserMelodicBrick(motif([1, 3, 5, 4], [1, 1, 1, 1]));
    const intent = inferHarmonyIntent(brick);
    for (const style of ['pop', 'lofi', 'rnb'] as const) {
      const sel = selectProgressionForMotif({ brick, intent, style, mode: 'major', keyPc: 0, seed: 3 });
      expect(sel.style, style).not.toBe('JAZZ');
    }
  });
});
