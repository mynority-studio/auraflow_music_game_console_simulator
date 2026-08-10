import { describe, it, expect } from 'vitest';
import { createTimebase, beats, pc } from '../foundation';
import { assemble } from '../harmony/harmonyEngine';
import type { RoadMap } from './mgRoadMapParser';
import { buildMelodyRhythmShapeProfile } from './mgRhythmShapeMatcher';
import {
  applyMotifTransform,
  materializeAuthoredUserMotifDevelopment,
  planMotifDevelopment,
  refineMotifNotes,
  withMotifDevelopment,
  MOTIF_OCCURRENCE_MIN_SUPPORT,
  type MotifDevelopmentTransform,
} from './motifDevelopmentPlan';
import {
  authoredLeadSpans,
  type AuthoredUserMotifBrickPlan,
  type UserMotifBrickNote,
} from './userMotifBrick';

const timebase = createTimebase({
  meter: { numerator: 4, denominator: 4 },
  tempoMap: [{ atBeat: beats(0), bpm: 96 }],
});

const cmajBar = (sectionId: string) => ({
  roman: { degree: 1 as const, accidental: 'natural' as const, quality: 'maj' as const },
  rootPc: pc(0), quality: 'maj' as const, durationBeats: 4, sectionId, func: 'T' as const,
});
const flatRoadMap = (brickCount: number, span = 4): RoadMap => ({
  totalCost: 0,
  segments: [],
  bricks: Array.from({ length: brickCount }, (_, i) => ({
    name: `on-${i}`, family: 'Major-On', startBeat: i * span, durationBeats: span, chordIndices: [i], cost: 0,
  })),
});

// 陈述素材:C/E/G/E 四音(全和弦音,结构分 1)
const NOTES: UserMotifBrickNote[] = [
  { pitch: 60, onsetBeat: 0, durationBeat: 1, velocity: 100, structuralToneScore: 1 },
  { pitch: 64, onsetBeat: 1, durationBeat: 0.5, velocity: 92, structuralToneScore: 1 },
  { pitch: 67, onsetBeat: 2, durationBeat: 1, velocity: 96, structuralToneScore: 1 },
  { pitch: 64, onsetBeat: 3, durationBeat: 1, velocity: 90, structuralToneScore: 1 },
];

const statementPlan = (notes: readonly UserMotifBrickNote[] = NOTES, endBeat = 4): AuthoredUserMotifBrickPlan => ({
  roadMapBrickIndices: [0],
  roadMapBrickNames: ['on-0'],
  startBeat: 0,
  endBeat,
  sourceSpanBeats: endBeat,
  targetSpanBeats: endBeat,
  scaleFactor: 1,
  harmonicSupportRatio: 1,
  placementScore: 100,
  timingDeviationRatioLimit: 0.2,
  fidelityReferenceNotes: notes,
  rhythmShapeProfile: buildMelodyRhythmShapeProfile(notes, 0, endBeat),
  notes,
});

const ALL_TRANSFORMS: MotifDevelopmentTransform[] = [
  'exact-recap', 'fragment-head', 'fragment-tail', 'delay-tail', 'terminal-hold', 'omit-middle',
];

/** a 是否为 b 的保序子序列(音高)。 */
function isOrderedSubsequence(sub: number[], full: number[]): boolean {
  let j = 0;
  for (const x of full) if (j < sub.length && sub[j] === x) j++;
  return j === sub.length;
}

describe('motifDevelopmentPlan · 变奏算子不变量', () => {
  it('全部算子:输出音高 = 输入的保序子序列,onset 单调,音高零改写', () => {
    const inputPitches = NOTES.map((n) => n.pitch);
    for (const t of ALL_TRANSFORMS) {
      const out = applyMotifTransform(t, NOTES, 4);
      if (!out) continue;
      const pitches = out.map((n) => n.pitch);
      expect(isOrderedSubsequence(pitches, inputPitches), `${t} 保序子序列`).toBe(true);
      for (let i = 1; i < out.length; i++) expect(out[i].onsetBeat).toBeGreaterThan(out[i - 1].onsetBeat);
    }
  });

  it('fragment-head 取连续前缀;fragment-tail 取连续后缀并重锚 0', () => {
    const head = applyMotifTransform('fragment-head', NOTES, 4)!;
    expect(head.map((n) => n.pitch)).toEqual([60, 64]);
    const tail = applyMotifTransform('fragment-tail', NOTES, 4)!;
    expect(tail.map((n) => n.pitch)).toEqual([67, 64]);
    expect(tail[0].onsetBeat).toBe(0);
  });

  it('terminal-hold 只延长末音;omit-middle 只删内部最弱音', () => {
    const hold = applyMotifTransform('terminal-hold', NOTES, 4)!;
    expect(hold[hold.length - 1].durationBeat).toBeCloseTo(1, 6); // 3 + 1 = 4 = span
    const weakMiddle = NOTES.map((n, i) => i === 2 ? { ...n, structuralToneScore: 0.1 } : n);
    const omitted = applyMotifTransform('omit-middle', weakMiddle, 4)!;
    expect(omitted.map((n) => n.pitch)).toEqual([60, 64, 64]); // 丢了 67(最弱内部音)
  });
});

describe('motifDevelopmentPlan · 发展弧线规划', () => {
  const harmonic16 = assemble(Array.from({ length: 16 }, () => cmajBar('verse')), pc(0), 'major');

  it('64 拍歌:规划 ≤2 个 occurrence,手法互异、支持度达标、与陈述不重叠', () => {
    const plan = statementPlan();
    const occs = planMotifDevelopment({
      plan, roadMap: flatRoadMap(16), harmonicPlan: harmonic16, totalBeats: 64,
    });
    expect(occs.length).toBe(2); // min(3, 64/32) = 2
    const transforms = new Set(occs.map((o) => o.transform));
    expect(transforms.size).toBe(occs.length);
    for (const o of occs) {
      expect(o.harmonicSupportRatio).toBeGreaterThanOrEqual(MOTIF_OCCURRENCE_MIN_SUPPORT);
      expect(o.startBeat).toBeGreaterThanOrEqual(plan.endBeat + 4 - 1e-6); // 与陈述保持间隔
      expect(o.endBeat).toBeLessThanOrEqual(64 + 1e-6);
      for (const n of o.notes) {
        expect(n.onsetBeat).toBeGreaterThanOrEqual(o.startBeat - 1e-6);
        expect(n.onsetBeat).toBeLessThan(o.endBeat + 1e-6);
      }
    }
    // occurrence 之间也不重叠
    for (let i = 1; i < occs.length; i++) expect(occs[i].startBeat).toBeGreaterThanOrEqual(occs[i - 1].endBeat + 4 - 1e-6);
  });

  it('短歌(16 拍)不硬塞发展段', () => {
    const occs = planMotifDevelopment({
      plan: statementPlan(), roadMap: flatRoadMap(4), harmonicPlan: harmonic16, totalBeats: 16,
    });
    expect(occs.length).toBe(0);
  });

  it('withMotifDevelopment:保真档陈述零改动;spans = 陈述 + occurrences', () => {
    const plan = statementPlan();
    const developed = withMotifDevelopment(plan, {
      roadMap: flatRoadMap(16), harmonicPlan: harmonic16, totalBeats: 64, confidenceTier: 'fidelity',
    })!;
    expect(developed.notes).toEqual(plan.notes);
    expect(authoredLeadSpans(developed).length).toBe(1 + (developed.occurrences?.length ?? 0));
    expect(developed.occurrences!.length).toBeGreaterThan(0);
  });

  it('materialize:陈述 + 全部 occurrence 一起出音,各自钳在自己的 span 内', () => {
    const developed = withMotifDevelopment(statementPlan(), {
      roadMap: flatRoadMap(16), harmonicPlan: harmonic16, totalBeats: 64, confidenceTier: 'fidelity',
    })!;
    const out = materializeAuthoredUserMotifDevelopment(developed, timebase);
    const expected = developed.notes.length + developed.occurrences!.reduce((a, o) => a + o.notes.length, 0);
    expect(out.length).toBe(expected);
    const spans = authoredLeadSpans(developed);
    for (const n of out) {
      const b = (n.startTick as number) / timebase.ppq;
      expect(spans.some((s) => b >= s.startBeat - 1e-6 && b < s.endBeat + 1e-6)).toBe(true);
    }
  });
});

describe('motifDevelopmentPlan · 修饰(经过音 + 降级)', () => {
  const harmonic4 = assemble([cmajBar('verse')], pc(0), 'major');

  it('保真档零改动', () => {
    const octaveLeap: UserMotifBrickNote[] = [
      { pitch: 60, onsetBeat: 0, durationBeat: 1, velocity: 100, structuralToneScore: 1 },
      { pitch: 72, onsetBeat: 2, durationBeat: 1, velocity: 96, structuralToneScore: 1 },
    ];
    expect(refineMotifNotes(octaveLeap, harmonic4, 4, 'fidelity')).toEqual(octaveLeap);
  });

  it('修饰档:八度跳进之间插入区间内 scale 经过音,用户音高一个不动', () => {
    const octaveLeap: UserMotifBrickNote[] = [
      { pitch: 60, onsetBeat: 0, durationBeat: 1, velocity: 100, structuralToneScore: 1 },
      { pitch: 72, onsetBeat: 2, durationBeat: 1, velocity: 96, structuralToneScore: 1 },
    ];
    const out = refineMotifNotes(octaveLeap, harmonic4, 4, 'refine');
    expect(out.length).toBe(3);
    const inserted = out.find((n) => n.pitch !== 60 && n.pitch !== 72)!;
    expect(inserted.pitch).toBeGreaterThan(60);
    expect(inserted.pitch).toBeLessThan(72);          // 严格在锚点开区间内 → 保序保轮廓
    expect(inserted.onsetBeat).toBeCloseTo(1.5, 6);   // 弱分位
    expect(inserted.velocity).toBeLessThan(96);
    // 用户原音完好
    expect(out.filter((n) => n.pitch === 60 || n.pitch === 72).map((n) => [n.onsetBeat, n.durationBeat]))
      .toEqual([[0, 1], [2, 1]]);
  });

  it('修饰档:弱结构 + 离 chord-scale 的音被降级(缩时值/降力度),音高不动', () => {
    const withWeak: UserMotifBrickNote[] = [
      { pitch: 60, onsetBeat: 0, durationBeat: 1, velocity: 100, structuralToneScore: 1 },
      { pitch: 61, onsetBeat: 1, durationBeat: 1, velocity: 100, structuralToneScore: 0.1 }, // C#:C 大调 chord-scale 外
      { pitch: 64, onsetBeat: 2, durationBeat: 1, velocity: 96, structuralToneScore: 1 },
    ];
    const out = refineMotifNotes(withWeak, harmonic4, 4, 'heal');
    const weak = out.find((n) => n.pitch === 61)!;
    expect(weak.durationBeat).toBeLessThanOrEqual(1 / 3 + 1e-9);
    expect(weak.velocity).toBeLessThan(100);
    expect(weak.pitch).toBe(61); // 音高保真
  });
});
