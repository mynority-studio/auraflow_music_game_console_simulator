import { describe, it, expect } from 'vitest';
import { beats, pc, createTimebase } from '../foundation';
import { assemble } from '../harmony/harmonyEngine';
import { buildMelodyRhythmShapeProfile } from './mgRhythmShapeMatcher';
import { buildMotifCompEchoByBar } from './motifTrackProjection';
import { renderAccompaniment } from './accompanimentRenderer';
import type { AuthoredUserMotifBrickPlan, UserMotifBrickNote } from './userMotifBrick';

const NOTES: UserMotifBrickNote[] = [
  { pitch: 60, onsetBeat: 0, durationBeat: 1, velocity: 100, structuralToneScore: 1 },
  { pitch: 64, onsetBeat: 1.25, durationBeat: 0.5, velocity: 92, structuralToneScore: 1 },
  { pitch: 67, onsetBeat: 2.5, durationBeat: 1, velocity: 96, structuralToneScore: 1 },
];
const plan = (occurrences: AuthoredUserMotifBrickPlan['occurrences'] = []): AuthoredUserMotifBrickPlan => ({
  roadMapBrickIndices: [0], roadMapBrickNames: ['on-0'],
  startBeat: 0, endBeat: 4, sourceSpanBeats: 4, targetSpanBeats: 4, scaleFactor: 1,
  harmonicSupportRatio: 1, placementScore: 100, timingDeviationRatioLimit: 0.2,
  fidelityReferenceNotes: NOTES, rhythmShapeProfile: buildMelodyRhythmShapeProfile(NOTES, 0, 4),
  notes: NOTES, occurrences,
});

describe('motifTrackProjection · comp 回声投射(P2)', () => {
  it('P2.1 · 多个回声小节轮换不同 cell(池含 motif 变体/语料近邻),力度微变', () => {
    const occs = [8, 16, 24, 32].map((startBeat) => ({
      kind: 'develop' as const, transform: 'fragment-head', startBeat, endBeat: startBeat + 4,
      notes: NOTES.map((n) => ({ ...n, onsetBeat: n.onsetBeat + startBeat })),
      fidelityReferenceNotes: NOTES, harmonicSupportRatio: 1, note: '',
    }));
    const map = buildMotifCompEchoByBar(plan(occs), 4, 64, 'pop');
    expect(map.size).toBeGreaterThanOrEqual(3);
    const cells = [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);
    expect(cells[0].sourceLabel).toBe('motif-head'); // 首次回声 = 原头部,辨识优先
    const signatures = new Set(cells.map((c) => c.accentBeats.join(',')));
    expect(signatures.size).toBeGreaterThan(1); // 真的在轮换,不再机械重复
    for (const c of cells) {
      expect(c.velocity!).toBeGreaterThanOrEqual(0.44 - 1e-9);
      expect(c.velocity!).toBeLessThanOrEqual(0.56 + 1e-9);
      expect(c.accentBeats.every((b) => Math.abs(b * 2 - Math.round(b * 2)) < 1e-9)).toBe(true);
    }
  });

  it('每个 span 结束后的下一小节获得头部 cell(相位 0.5 网格量化)', () => {
    const map = buildMotifCompEchoByBar(plan(), 4, 64, 'pop');
    expect(map.has(1)).toBe(true); // 陈述 [0,4) → 回声 bar 1
    const cell = map.get(1)!;
    expect(cell.accentBeats[0]).toBe(0);
    expect(cell.accentBeats.every((b) => Math.abs(b * 2 - Math.round(b * 2)) < 1e-9)).toBe(true); // 0.5 网格
  });

  it('回声小节与 authored span 重叠时跳过;非 perSection 风格(lofi)返回空', () => {
    const occ = {
      kind: 'develop' as const, transform: 'fragment-head', startBeat: 4, endBeat: 6,
      notes: NOTES, fidelityReferenceNotes: NOTES, harmonicSupportRatio: 1, note: '',
    };
    const map = buildMotifCompEchoByBar(plan([occ]), 4, 64, 'pop');
    expect(map.has(1)).toBe(false); // bar 1 与 occurrence [4,6) 重叠?bar1=[4,8) 与 [4,6) 重叠 → 跳过
    expect(buildMotifCompEchoByBar(plan(), 4, 64, 'lofi').size).toBe(0);
  });

  it('集成:comp 在回声小节的 cell 相位上真实出音', () => {
    const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 }, tempoMap: [{ atBeat: beats(0), bpm: 96 }] });
    const harmonic = assemble(Array.from({ length: 4 }, () => ({
      roman: { degree: 1 as const, accidental: 'natural' as const, quality: 'maj' as const },
      rootPc: pc(0), quality: 'maj' as const, durationBeats: 4, sectionId: 'verse', func: 'T' as const,
    })), pc(0), 'major');
    const echo = new Map([[1, { accentBeats: [0, 1.5, 2.5], durations: [0.5, 0.5, 0.5] }]]);
    const withEcho = renderAccompaniment(harmonic, timebase, { style: 'pop', motifEchoByAbsoluteBar: echo });
    const without = renderAccompaniment(harmonic, timebase, { style: 'pop' });
    const compBeats = (tracks: ReturnType<typeof renderAccompaniment>): number[] =>
      (tracks.find((t) => t.role === 'comp')?.notes ?? []).map((n) => (n.startTick as number) / timebase.ppq);
    const a = compBeats(withEcho).filter((b) => b >= 4 && b < 8);
    const b = compBeats(without).filter((b2) => b2 >= 4 && b2 < 8);
    expect(a.length).toBeGreaterThan(b.length); // 回声小节新增击点
    for (const phase of [5.5, 6.5]) { // bar1 的 1.5/2.5 相位(下拍 0 可能已被原织体占据)
      expect(a.some((b3) => Math.abs(b3 - phase) <= 0.2)).toBe(true);
    }
  });
});
