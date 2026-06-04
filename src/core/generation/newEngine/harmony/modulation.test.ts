import { describe, it, expect } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildHarmonicPlanFromArrangement } from './harmonyEngine';
import { generateSong } from '../generation/GenerationController';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { renderSongFull } from '../render/renderCoordinator';
import { chordTones } from '../knowledge/chords';
import { createRandomContext, createTimebase, beats, mod12, pc } from '../foundation';

describe('harmony/render · 转调 modulationMap (4.3)', () => {
  const build = (allowModulation: boolean, seed = 1) => {
    const seedRng = createRandomContext(seed);
    const band = buildBandSpec({ seed, styleHint: 'pop', mood: 'x', targetDuration: 120, key: pc(0), allowModulation });
    const arrangement = buildArrangementPlan(band, { rng: seedRng });
    const harmonic = buildHarmonicPlanFromArrangement(band, arrangement, seedRng);
    return { band, arrangement, harmonic, seedRng };
  };

  it('默认(allowModulation=false)→ modulationMap 空,无转调', () => {
    const { harmonic } = build(false);
    expect(harmonic.modulationMap).toEqual({});
  });

  it('★ 开启 → 末段 chorus 升半音(modulationMap.toKey = key+1),进行整体移调', () => {
    const { harmonic } = build(true);
    const ids = Object.keys(harmonic.modulationMap);
    expect(ids.length).toBe(1); // 仅末段 chorus
    const info = harmonic.modulationMap[ids[0]];
    expect(info.toKey).toBe(mod12(pc(0) + 1)); // C → Db
    expect(info.semitones).toBe(1);
    // 转调段 = 某未转调 chorus 的进行整体 +1(同 repeatGroup 同级数)
    const chorus = (sid: string) => harmonic.chordTimeline.filter((c) => c.sectionId === sid).map((c) => c.rootPc);
    const homeChorus = harmonic.chordTimeline.find((c) => c.sectionId !== ids[0] && /chorus/.test(c.sectionId));
    if (homeChorus) {
      const home = chorus(homeChorus.sectionId);
      const moved = chorus(ids[0]);
      expect(moved.length).toBe(home.length);
      for (let i = 0; i < home.length; i++) expect(moved[i]).toBe(mod12(home[i] + 1));
    }
  });

  it('转调段 chord-tones ⊆ chord-scale(按新调中心解析,不变量保持)', () => {
    const { harmonic } = build(true);
    const modId = Object.keys(harmonic.modulationMap)[0];
    const modChords = harmonic.chordTimeline.filter((c) => c.sectionId === modId);
    for (const c of modChords) {
      const scale = new Set<number>(harmonic.chordScaleMap[c.id]);
      for (const t of chordTones(c.rootPc, c.quality)) expect(scale.has(t)).toBe(true);
    }
  });

  it('★ 旋律随转调:末段 lead 含离主调音(进入新调中心)', () => {
    const { band, arrangement, harmonic, seedRng } = build(true);
    const instrumentation = buildInstrumentationPlan(band, arrangement);
    const timebase = createTimebase({
      meter: { numerator: arrangement.meter.numerator, denominator: arrangement.meter.denominator },
      tempoMap: [{ atBeat: beats(0), bpm: arrangement.tempoBpm }],
    });
    const { ir } = renderSongFull(band, arrangement, harmonic, instrumentation, timebase, seedRng);
    const modId = Object.keys(harmonic.modulationMap)[0];
    const modChords = harmonic.chordTimeline.filter((c) => c.sectionId === modId);
    const lo = timebase.beatToTick(modChords[0].startBeat) as number;
    const hi = (timebase.beatToTick(modChords[modChords.length - 1].startBeat) as number)
      + (timebase.beatToTick(modChords[modChords.length - 1].durationBeats) as number);
    const homeMajor = new Set([0, 2, 4, 5, 7, 9, 11]); // C 大调
    const lead = ir.tracks.find((t) => t.role === 'lead')!;
    const modNotes = lead.notes.filter((n) => (n.startTick as number) >= lo && (n.startTick as number) < hi);
    expect(modNotes.length).toBeGreaterThan(0);
    expect(modNotes.some((n) => !homeMajor.has((n.pitch as number) % 12))).toBe(true); // 出现新调音
  });

  it('端到端:开启转调多 seed generateSong 收敛(非 failed);默认仍 pass', () => {
    for (let seed = 0; seed < 5; seed++) {
      expect(generateSong({ seed, styleHint: 'pop', mood: 'x', targetDuration: 120, key: pc(0), allowModulation: true }).status).not.toBe('failed');
      expect(generateSong({ seed, styleHint: 'pop', mood: 'x', targetDuration: 120, key: pc(0) }).status).not.toBe('failed');
    }
  });
});
