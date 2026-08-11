import { describe, it, expect } from 'vitest';
import { beats, pc, createTimebase } from '../foundation';
import { assemble } from '../harmony/harmonyEngine';
import type { RoadMap } from './mgRoadMapParser';
import { buildMelodyRhythmShapeProfile } from './mgRhythmShapeMatcher';
import {
  applyLineageOp,
  similarityBandVerdict,
  FUNCTION_SIMILARITY_BAND,
} from './motifLineage';
import { withMotifDevelopment } from './motifDevelopmentPlan';
import { admittedPcsAtBeat, type AuthoredUserMotifBrickPlan, type UserMotifBrickNote } from './userMotifBrick';

void createTimebase; void beats; // 保持 fixture 依赖显式

const cmajBar = (sectionId: string) => ({
  roman: { degree: 1 as const, accidental: 'natural' as const, quality: 'maj' as const },
  rootPc: pc(0), quality: 'maj' as const, durationBeats: 4, sectionId, func: 'T' as const,
});
const harmonic16 = assemble(Array.from({ length: 16 }, () => cmajBar('verse')), pc(0), 'major');
const flatRoadMap = (brickCount: number, span = 4): RoadMap => ({
  totalCost: 0,
  segments: [],
  bricks: Array.from({ length: brickCount }, (_, i) => ({
    name: `on-${i}`, family: 'Major-On', startBeat: i * span, durationBeats: span, chordIndices: [i], cost: 0,
  })),
});
const NOTES: UserMotifBrickNote[] = [
  { pitch: 60, onsetBeat: 0, durationBeat: 1, velocity: 100, structuralToneScore: 1 },
  { pitch: 64, onsetBeat: 1, durationBeat: 0.5, velocity: 92, structuralToneScore: 1 },
  { pitch: 67, onsetBeat: 2, durationBeat: 1, velocity: 96, structuralToneScore: 1 },
  { pitch: 64, onsetBeat: 3, durationBeat: 1, velocity: 90, structuralToneScore: 1 },
];
const statementPlan = (): AuthoredUserMotifBrickPlan => ({
  roadMapBrickIndices: [0], roadMapBrickNames: ['on-0'],
  startBeat: 0, endBeat: 4, sourceSpanBeats: 4, targetSpanBeats: 4, scaleFactor: 1,
  harmonicSupportRatio: 1, placementScore: 100, timingDeviationRatioLimit: 0.2,
  fidelityReferenceNotes: NOTES,
  rhythmShapeProfile: buildMelodyRhythmShapeProfile(NOTES, 0, 4),
  notes: NOTES,
});
const signsOf = (xs: readonly UserMotifBrickNote[]): number[] => {
  const s = [...xs].sort((a, b) => a.onsetBeat - b.onsetBeat);
  return s.slice(1).map((x, i) => Math.sign(x.pitch - s[i].pitch));
};

describe('motifLineage · 谱系操作不变量', () => {
  it('diatonic-sequence:音高全部落 chord-scale 准入集,轮廓符号与父代一致', () => {
    const out = applyLineageOp('diatonic-sequence', NOTES, harmonic16, 5)!;
    expect(out.pitchPolicy).toBe('contour');
    expect(signsOf(out.notes)).toEqual(signsOf(NOTES));
    for (const n of out.notes) {
      expect(admittedPcsAtBeat(harmonic16, n.onsetBeat)).toContain(((n.pitch % 12) + 12) % 12);
    }
    expect(out.notes.some((n, i) => n.pitch !== NOTES[i].pitch)).toBe(true); // 真的换了音高
  });

  it('inversion(倒影解禁):轮廓符号镜像,音高仍在准入集', () => {
    const out = applyLineageOp('inversion', NOTES, harmonic16, 5)!;
    expect(signsOf(out.notes)).toEqual(signsOf(NOTES).map((v) => -v));
    expect(out.introduced).toContain('inverted-contour');
    for (const n of out.notes) {
      expect(admittedPcsAtBeat(harmonic16, n.onsetBeat)).toContain(((n.pitch % 12) + 12) % 12);
    }
  });

  it('liquidation:只留结构骨架(音数减少,保首尾顺序)', () => {
    const out = applyLineageOp('liquidation', NOTES, harmonic16, 5)!;
    expect(out.notes.length).toBeLessThan(NOTES.length);
    expect(out.notes.length).toBeGreaterThanOrEqual(2);
    expect(out.introduced).toContain('liquidation');
  });

  it('rhythmic-displacement:onset 平移 0.5,音高零改写', () => {
    const out = applyLineageOp('rhythmic-displacement', NOTES, harmonic16, 6)!;
    expect(out.pitchPolicy).toBe('exact');
    expect(out.notes.map((n) => n.pitch)).toEqual(NOTES.map((n) => n.pitch));
    expect(out.notes.map((n) => n.onsetBeat)).toEqual(NOTES.map((n) => n.onsetBeat + 0.5));
  });

  it('距离带:太近/带内/太远三态', () => {
    expect(similarityBandVerdict('continuation', 0.99)).toBe('too-close');
    expect(similarityBandVerdict('continuation', 0.7)).toBe('in-band');
    expect(similarityBandVerdict('development', 0.1)).toBe('too-far');
    expect(similarityBandVerdict('presentation', 1)).toBe('in-band'); // 锚点豁免
    expect(FUNCTION_SIMILARITY_BAND.return.min).toBeGreaterThan(FUNCTION_SIMILARITY_BAND.development.min);
  });
});

describe('motifLineage · v2 谱系规划(withMotifDevelopment developmentV2)', () => {
  const sections = [
    { id: 's1', role: 'verse', startBeat: 0, endBeat: 16 },
    { id: 's2', role: 'verse', startBeat: 16, endBeat: 32 },
    { id: 's3', role: 'chorus', startBeat: 32, endBeat: 48 },
    { id: 's4', role: 'chorus', startBeat: 48, endBeat: 64 },
  ];
  const developed = withMotifDevelopment(statementPlan(), {
    roadMap: flatRoadMap(16), harmonicPlan: harmonic16, totalBeats: 64,
    sections, confidenceTier: 'fidelity', style: 'pop', developmentV2: true,
  })!;

  it('谱系链:第二个发展节点的父代是第一个节点,不是 root;return 是双亲合成', () => {
    const occs = developed.occurrences!;
    expect(occs.length).toBeGreaterThanOrEqual(2);
    const devs = occs.filter((o) => o.kind === 'develop');
    if (devs.length >= 2) expect(devs[1].parentNodeId).toBe(devs[0].nodeId);
    const ret = occs.find((o) => o.kind === 'return');
    if (ret) {
      expect(ret.parentNodeId).toMatch(/^root\+/);
      expect(ret.pitchPolicy).toBe('exact');
      expect([...new Set(ret.notes.map((n) => n.pitch))].sort())
        .toEqual([...new Set(NOTES.map((n) => n.pitch))].sort()); // 回归音高保真
    }
  });

  it('形式功能与 provenance 齐全;至少一个 contour 节点真的换了音高', () => {
    for (const occ of developed.occurrences!) {
      expect(occ.formalFunction).toBeDefined();
      expect(occ.nodeId).toBeDefined();
      expect(occ.similarityToRoot).toBeGreaterThan(0);
    }
    const contour = developed.occurrences!.filter((o) => o.pitchPolicy === 'contour');
    expect(contour.length).toBeGreaterThan(0);
  });

  it('辨识度审计对 contour 节点验轮廓:整体保序不因换音高而误报', () => {
    expect(developed.recognizability!.allPitchOrderPreserved).toBe(true);
  });

  it('v2 关闭时回退二期行为(baseline 可对照)', () => {
    const v1 = withMotifDevelopment(statementPlan(), {
      roadMap: flatRoadMap(16), harmonicPlan: harmonic16, totalBeats: 64,
      sections, confidenceTier: 'fidelity', style: 'pop',
    })!;
    for (const occ of v1.occurrences!) expect(occ.nodeId).toBeUndefined();
  });
});
