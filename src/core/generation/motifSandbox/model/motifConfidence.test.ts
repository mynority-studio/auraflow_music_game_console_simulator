import { describe, expect, it } from 'vitest';
import {
  buildMotifConfidenceProfile,
  motifInterventionTier,
  MOTIF_CONFIDENCE_FIDELITY_MIN,
  MOTIF_CONFIDENCE_REFINE_MIN,
} from './motifConfidence';
import type { UserMotif, MotifNote } from './types';
import type { MotifTimingAnalysis } from './motifAnalysis';

type Spec = [midi: number, onset: number, dur: number, vel: number, degree: number];

function makeMotif(specs: Spec[], lengthBeats = 4, extra: Partial<UserMotif> = {}): UserMotif {
  const notes: MotifNote[] = specs.map(([midi, onsetBeat, durationBeat, velocity, scaleDegree]) => ({
    midi, onsetBeat, durationBeat, velocity, scaleDegree,
    octave: Math.floor(midi / 12) - 1, accent: velocity,
    structuralToneScore: velocity,
  }));
  const contour: number[] = [];
  for (let i = 1; i < notes.length; i++) contour.push(Math.sign(notes[i].midi - notes[i - 1].midi));
  return {
    id: 'test', keyPc: 0, mode: 'major', bpm: 90,
    notes, lengthBeats, contour,
    rhythmCell: notes.map((n) => n.durationBeat), createdAt: 0,
    ...extra,
  };
}

function makeTiming(mean: number, max: number): MotifTimingAnalysis {
  return {
    captureMode: 'hiddenGrid', bpm: 90, captureBars: 1, lengthBeats: 4,
    phaseConfidence: 1, quantizeErrorMean: mean, quantizeErrorMax: max,
    hasPickup: false, leadingRestBeats: 0, aligned: true,
  };
}

// 演奏级:贴拍、强拍重音、清晰上行拱、落主音收满 bar
const PLAYED: Spec[] = [
  [60, 0, 1, 0.95, 1], [62, 1, 0.5, 0.6, 2], [64, 1.5, 0.5, 0.65, 3],
  [67, 2, 1, 0.9, 5], [64, 3, 0.5, 0.55, 3], [60, 3.5, 0.5, 0.85, 1],
];
// 草稿级:锯齿轮廓、大跳不回收、力度乱、半途而废(2 拍就停,网格 4 拍)
const SKETCH: Spec[] = [
  [60, 0, 0.25, 0.3, 1], [71, 0.25, 0.25, 0.9, 7], [62, 0.5, 0.25, 0.2, 2],
  [70, 0.75, 0.25, 0.85, 7], [61, 1.25, 0.25, 0.4, 1], [69, 1.75, 0.25, 0.7, 6],
];

describe('motifConfidence · 六维输入置信度', () => {
  it('演奏级输入 → 保真档(overall ≥ 0.75)', () => {
    const p = buildMotifConfidenceProfile({
      motif: makeMotif(PLAYED), inputSource: 'pitch',
      timing: makeTiming(0.01, 0.04), snapChanges: 0, harmonicSupportRatio: 0.95,
    });
    expect(p.overall).toBeGreaterThanOrEqual(MOTIF_CONFIDENCE_FIDELITY_MIN);
    expect(p.tier).toBe('fidelity');
  });

  it('草稿级输入 → 治愈档(overall < 0.45)', () => {
    const motif = makeMotif(SKETCH);
    // 标记两处补连(破碎)
    motif.notes[0].healingTags = ['gap-healed-legato'];
    motif.notes[2].healingTags = ['gap-healed-legato'];
    motif.notes[4].healingTags = ['gap-healed-legato'];
    const p = buildMotifConfidenceProfile({
      motif, inputSource: 'pitch',
      timing: makeTiming(0.11, 0.3), snapChanges: 3, harmonicSupportRatio: 0.5,
    });
    expect(p.overall).toBeLessThan(MOTIF_CONFIDENCE_REFINE_MIN);
    expect(p.tier).toBe('heal');
  });

  it('按位输入:音高维不参与;恒定力度:力度维不参与', () => {
    const constVel: Spec[] = PLAYED.map(([m, o, d, , g]) => [m, o, d, 0.86, g]);
    const p = buildMotifConfidenceProfile({
      motif: makeMotif(constVel), inputSource: 'position', timing: makeTiming(0.02, 0.05),
    });
    const byKey = Object.fromEntries(p.dimensions.map((d) => [d.key, d]));
    expect(byKey.pitch.informative).toBe(false);
    expect(byKey.velocity.informative).toBe(false);
    expect(byKey.timing.informative).toBe(true);
    expect(byKey.structure.informative).toBe(true);
  });

  it('无信息维度不拖累 overall(权重重归一)', () => {
    const base = { motif: makeMotif(PLAYED), timing: makeTiming(0.01, 0.04) } as const;
    const withPitch = buildMotifConfidenceProfile({ ...base, inputSource: 'pitch', snapChanges: 0 });
    const noPitch = buildMotifConfidenceProfile({ ...base, inputSource: 'position' });
    // 按位输入剔除音高维后,其余维度依旧高分 → overall 不因缺维骤降
    expect(noPitch.overall).toBeGreaterThan(withPitch.overall - 0.1);
  });

  it('和声接洽维:高支持度抬分,低支持度压分', () => {
    const mk = (r: number) => buildMotifConfidenceProfile({
      motif: makeMotif(PLAYED), inputSource: 'pitch', timing: makeTiming(0.03, 0.08), harmonicSupportRatio: r,
    });
    expect(mk(0.95).overall).toBeGreaterThan(mk(0.5).overall);
  });

  it('档位边界', () => {
    expect(motifInterventionTier(0.8)).toBe('fidelity');
    expect(motifInterventionTier(0.6)).toBe('refine');
    expect(motifInterventionTier(0.3)).toBe('heal');
  });

  it('每个 informative 维度都有中文证据', () => {
    const p = buildMotifConfidenceProfile({
      motif: makeMotif(PLAYED), inputSource: 'pitch', timing: makeTiming(0.02, 0.06),
    });
    for (const d of p.dimensions.filter((x) => x.informative)) expect(d.evidence.length).toBeGreaterThan(0);
    expect(p.evidence.length).toBeGreaterThan(0);
  });
});
