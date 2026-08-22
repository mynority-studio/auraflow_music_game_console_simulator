import { describe, expect, it } from 'vitest';
import { planHarmonicFillCues, type HarmonicFillCell } from './harmonicFill';
import type { PlannedCue } from '../types';

const CELLS: HarmonicFillCell[] = [
  { index: 5, midi: 60, classRole: 'chord' },
  { index: 7, midi: 64, classRole: 'chord' },
  { index: 9, midi: 67, classRole: 'chord' },
  { index: 6, midi: 62, classRole: 'scale' },
  { index: 8, midi: 65, classRole: 'scale' },
  { index: 10, midi: 69, classRole: 'approach' },
];

const CHORD_MIDIS = new Set([60, 64, 67]);
const COLOR_MIDIS = new Set([62, 65, 69]);

function ctx(overrides: Partial<Parameters<typeof planHarmonicFillCues>[1]> = {}) {
  return {
    beatsPerBar: 4,
    totalBeats: 32,
    seed: 7,
    ppq: 480,
    cellsAtBeat: () => CELLS,
    ...overrides,
  };
}

function leadCue(beat: number): PlannedCue {
  return { id: 0, tick: beat * 480, beat, pitch: 72, durationBeats: 1, valueClass: 'quarter', source: 'lead' };
}

describe('auraRoaming/harmonicFill — 和声填充提示', () => {
  it('lead 全空窗时补出可观密度,且互相间距 ≥1 拍', () => {
    const fillers = planHarmonicFillCues([], ctx());
    expect(fillers.length).toBeGreaterThanOrEqual(6);
    const beats = fillers.map((f) => f.beat).sort((a, b) => a - b);
    for (let i = 1; i < beats.length; i++) expect(beats[i] - beats[i - 1]).toBeGreaterThanOrEqual(1);
    for (const f of fillers) expect(f.source).toBe('harmonic');
  });

  it('强拍给结构音,弱拍给色彩音(scale/approach)', () => {
    const fillers = planHarmonicFillCues([], ctx({ totalBeats: 64 }));
    for (const f of fillers) {
      const posInBar = f.beat % 4;
      const strong = posInBar === 0 || posInBar === 2;
      if (strong) expect(CHORD_MIDIS.has(f.pitch), `强拍 ${f.beat} 应为结构音`).toBe(true);
      else expect(COLOR_MIDIS.has(f.pitch), `弱拍 ${f.beat} 应为色彩音`).toBe(true);
    }
  });

  it('不挤 lead 锚点:与既有提示间距 <1 拍的拍位不补', () => {
    const fillers = planHarmonicFillCues([leadCue(4), leadCue(8)], ctx({ totalBeats: 12 }));
    for (const f of fillers) {
      expect(Math.abs(f.beat - 4)).toBeGreaterThanOrEqual(1);
      expect(Math.abs(f.beat - 8)).toBeGreaterThanOrEqual(1);
    }
  });

  it('确定性:同 seed 恒等;布局缺失时不补', () => {
    expect(planHarmonicFillCues([], ctx())).toEqual(planHarmonicFillCues([], ctx()));
    expect(planHarmonicFillCues([], ctx({ cellsAtBeat: () => null }))).toEqual([]);
    const signatures = new Set(
      [1, 2, 3].map((seed) => planHarmonicFillCues([], ctx({ seed })).map((f) => `${f.beat}:${f.padIndex}`).join(',')),
    );
    expect(signatures.size).toBeGreaterThanOrEqual(2);
  });
});
