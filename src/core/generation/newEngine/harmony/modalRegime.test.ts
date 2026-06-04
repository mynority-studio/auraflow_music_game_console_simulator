import { describe, it, expect } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildHarmonicPlanFromArrangement } from './harmonyEngine';
import { generateSong } from '../generation/GenerationController';
import { createRandomContext, createTimebase, beats, pc } from '../foundation';
import { renderSongFull } from '../render/renderCoordinator';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { modalScale } from '../knowledge/modes';

describe('harmony/render · modal regime (4.1)', () => {
  const mk = (seed = 4) => {
    const seedRng = createRandomContext(seed);
    const band = buildBandSpec({ seed, styleHint: 'modal', mood: 'x', targetDuration: 120, key: pc(0), modalMode: 'dorian' });
    const arrangement = buildArrangementPlan(band, { rng: seedRng });
    const harmonic = buildHarmonicPlanFromArrangement(band, arrangement, seedRng);
    return { band, arrangement, harmonic, seedRng };
  };

  it('band:styleHint=modal → tonalityKind=modal + primaryScale=Dorian(C)', () => {
    const { band } = mk();
    expect(band.tonalityKind).toBe('modal');
    expect(band.modalModeName).toBe('dorian');
    expect(band.primaryScale).toEqual(modalScale(pc(0), 'dorian')); // C Dorian
  });

  it('★ 和声=静态 vamp:全曲只 ≤2 个不同和弦,且 verse1≡verse2(静态)', () => {
    const { harmonic } = mk();
    const sigs = new Set(harmonic.chordTimeline.map((c) => `${c.rootPc}-${c.quality}`));
    expect(sigs.size).toBeLessThanOrEqual(2); // i + 特征和弦
    const roots = (sid: string) => harmonic.chordTimeline.filter((c) => c.sectionId === sid).map((c) => `${c.rootPc}-${c.quality}`);
    if (roots('verse1').length && roots('verse2').length) expect(roots('verse1')).toEqual(roots('verse2'));
  });

  it('逐和弦约束放松:avoid 全空,chord-scale = primaryScale', () => {
    const { harmonic, band } = mk();
    const scaleSorted = [...band.primaryScale].sort((a, b) => a - b);
    for (const c of harmonic.chordTimeline) {
      expect(harmonic.avoidNoteMap[c.id]).toEqual([]); // 无和弦内 avoid
      expect([...harmonic.chordScaleMap[c.id]].sort((a, b) => a - b)).toEqual(scaleSorted);
    }
  });

  it('★ 旋律跑音阶:lead 全部音 pc ∈ primaryScale(scale 色彩,非逐和弦贴音)', () => {
    const { band, arrangement, harmonic, seedRng } = mk();
    const instrumentation = buildInstrumentationPlan(band, arrangement);
    const timebase = createTimebase({
      meter: { numerator: arrangement.meter.numerator, denominator: arrangement.meter.denominator },
      tempoMap: [{ atBeat: beats(0), bpm: arrangement.tempoBpm }],
    });
    const { ir } = renderSongFull(band, arrangement, harmonic, instrumentation, timebase, seedRng);
    const scale = new Set<number>(band.primaryScale);
    const lead = ir.tracks.find((t) => t.role === 'lead')!;
    expect(lead.notes.length).toBeGreaterThan(0);
    for (const n of lead.notes) expect(scale.has((n.pitch as number) % 12)).toBe(true);
  });

  it('端到端:modal generateSong 收敛(avoid 放松 → Auditor 必 pass);多 seed 不崩', () => {
    for (let seed = 0; seed < 6; seed++) {
      const r = generateSong({ seed, styleHint: 'modal', mood: 'x', targetDuration: 120, key: pc(0) });
      expect(r.status).not.toBe('failed');
    }
  });

  it('tonal 不受影响:pop 仍 tonal + 多和弦(非 vamp)', () => {
    const band = buildBandSpec({ seed: 4, styleHint: 'pop', mood: 'x', targetDuration: 120, key: pc(0) });
    expect(band.tonalityKind).toBe('tonal');
    const arr = buildArrangementPlan(band, { rng: createRandomContext(4) });
    const h = buildHarmonicPlanFromArrangement(band, arr, createRandomContext(4));
    const sigs = new Set(h.chordTimeline.map((c) => `${c.rootPc}-${c.quality}`));
    expect(sigs.size).toBeGreaterThan(2); // tonal 进行和弦多样
  });
});
