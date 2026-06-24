import { describe, it, expect } from 'vitest';
import { healMotifArticulation, deriveSamePitchStaccatoRuns } from './motifArticulationHealer';
import type { MotifNote } from './types';

const n = (midi: number, onsetBeat: number, durationBeat: number): MotifNote =>
  ({ midi, onsetBeat, durationBeat, velocity: 0.8, scaleDegree: 1, octave: 4, accent: 0.5 });

describe('motifSandbox/motifArticulationHealer(Phase 1)', () => {
  it('★ 不同音高【被夹短的音】+ 小空拍 → 补连(延到 next onset,1/16 网格)', () => {
    const r = healMotifArticulation([n(60, 0, 0.15), n(62, 0.5, 0.4)]); // 60 很短(0.15)、gap=0.35
    expect(r.gapsHealed).toBe(1);
    expect(r.notes[0].durationBeat).toBe(0.5);             // 延到 next onset
    expect(r.notes[0].healingTags).toContain('gap-healed-legato');
    expect(r.notes[0].originalDurationBeat).toBe(0.15);
  });

  it('★ 长音(eighth+)后的小空拍=有意呼吸 → 不补(under-repair)', () => {
    const r = healMotifArticulation([n(60, 0, 0.75), n(62, 1, 0.75)]); // 60 长(0.75)、gap=0.25(16 分休止)
    expect(r.gapsHealed).toBe(0);
    expect(r.notes[0].durationBeat).toBe(0.75);            // 不动
  });

  it('★ 大空拍(≥0.75)= 有意休止 → 不补', () => {
    const r = healMotifArticulation([n(60, 0, 0.2), n(62, 1.5, 0.5)]); // gap=1.3
    expect(r.gapsHealed).toBe(0);
  });

  it('★ 同音重复 C C C → staccato-repeat 锁,不延长,保间隔', () => {
    const r = healMotifArticulation([n(64, 0, 0.2), n(64, 0.5, 0.2), n(64, 1, 0.2)]);
    expect(r.staccatoNotes).toBe(3);
    for (const x of r.notes) { expect(x.articulationLock).toBe('staccato-repeat'); expect(x.durationBeat).toBe(0.2); }
    expect(r.gapsHealed).toBe(0); // 同音不补
  });

  it('★ 不动 onset / pitch / 数量;off 模式完全不动', () => {
    const motif = [n(60, 0, 0.1), n(62, 0.5, 0.4), n(64, 1, 0.3)];
    const r = healMotifArticulation(motif);
    expect(r.notes.length).toBe(motif.length);
    expect(r.notes.map((x) => x.midi)).toEqual([60, 62, 64]);
    expect(r.notes.map((x) => x.onsetBeat)).toEqual([0, 0.5, 1]);
    const off = healMotifArticulation(motif, { mode: 'off' });
    expect(off.gapsHealed).toBe(0);
    expect(off.notes.map((x) => x.durationBeat)).toEqual([0.1, 0.4, 0.3]);
  });

  it('★ deriveSamePitchStaccatoRuns:render 层重推断同音 run(过桥 tag 丢失时用)', () => {
    const locked = deriveSamePitchStaccatoRuns([
      { midi: 60, onsetBeat: 0 }, { midi: 64, onsetBeat: 0.5 }, { midi: 64, onsetBeat: 1 }, { midi: 64, onsetBeat: 1.5 }, { midi: 67, onsetBeat: 2 },
    ]);
    expect([...locked].sort((a, b) => a - b)).toEqual([1, 2, 3]); // 三个 64 是 run;60/67 不是
  });
});
