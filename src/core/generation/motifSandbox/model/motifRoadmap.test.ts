import { describe, it, expect } from 'vitest';
import { realizeToSandboxChords, buildMotifRoadmap } from './motifRoadmap';
import { analyzeUserMelodicBrick } from './melodicBrickAnalyzer';
import { inferHarmonyIntent } from './melodicBrickHarmonyIntent';
import { selectProgressionForMotif } from './motifProgressionSelector';
import { degreeOctaveToMidi } from './scale';
import type { UserMotif } from './types';

function motif(degrees: number[], durs: number[]): UserMotif {
  let onset = 0;
  const notes = degrees.map((d, i) => {
    const n = { midi: degreeOctaveToMidi(d, 5, 0, 'major' as const), onsetBeat: onset, durationBeat: durs[i], velocity: 0.85, scaleDegree: d, octave: 5, accent: 0.7, structuralToneScore: 0.6 };
    onset += durs[i]; return n;
  });
  const contour: number[] = [];
  for (let i = 1; i < notes.length; i++) contour.push(Math.sign(notes[i].midi - notes[i - 1].midi));
  return { id: 'm', keyPc: 0, mode: 'major', bpm: 96, notes, lengthBeats: 4, contour, rhythmCell: durs, createdAt: 0 };
}

describe('motifSandbox/motifRoadmap(实现 + 旋律 roadmap)', () => {
  const brick = analyzeUserMelodicBrick(motif([3, 2, 1], [1, 1, 2]));
  const selected = selectProgressionForMotif({ brick, intent: inferHarmonyIntent(brick), style: 'pop', mode: 'major', keyPc: 0, seed: 7 });

  it('realizeToSandboxChords:覆盖 16 bar(64 拍)、保真实和声、非退化', () => {
    const chords = realizeToSandboxChords(selected.slots, 0, 'major');
    expect(chords.reduce((n, c) => n + c.durationBeats, 0)).toBe(64); // 覆盖满 16 bar(含半小节 beats)
    expect(chords[0].startBeat).toBe(0);
    expect(new Set(chords.map((c) => c.realRoman ?? c.roman)).size).toBeGreaterThanOrEqual(2); // 非退化(roman 计,含借和弦)
    expect(selected.scoreBreakdown.degeneratePenalty).toBe(0);
    for (const c of chords) { expect(c.realRoman).toBeTruthy(); expect(c.realTonePcs?.length).toBeGreaterThanOrEqual(2); } // 真实和声保留
  });

  it('buildMotifRoadmap:真 RoadMap(harmonicBricks)+ 规范化 brickSlots(无固定 0/16/32/48 锚点模型)', () => {
    const rm = buildMotifRoadmap(selected, 0, 'major', 16);
    expect(Array.isArray(rm.harmonicBricks)).toBe(true); // parseRoadMap 出真 BrickMatch
    expect(rm.totalBars).toBe(16);
    expect(rm.harmonicRomans.length).toBe(16);
    // brickSlots 从 0 起、连续覆盖、非空(取代旧 userBrick-0/1/2/3 固定锚点)
    expect(rm.brickSlots.length).toBeGreaterThan(0);
    const sorted = [...rm.brickSlots].sort((a, b) => a.startBeat - b.startBeat);
    expect(sorted[0].startBeat).toBe(0);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].startBeat).toBeGreaterThanOrEqual(sorted[i - 1].startBeat - 1e-6);
    expect('melodicSlots' in rm).toBe(false); // 旧固定锚点字段已删
  });

  it('★ Phase3:RoadMap → 规范化 brickSlots(beat 范围 / chordIds / entry-exit func / recurrenceKey)', () => {
    const rm = buildMotifRoadmap(selected, 0, 'major', 16);
    expect(rm.brickSlots.length).toBeGreaterThan(0);
    expect(rm.brickSlotsFromFallback).toBe(false); // 正常 parse 成功(非逐和弦兜底)
    for (const s of rm.brickSlots) {
      expect(s.startBeat).toBeGreaterThanOrEqual(0);
      expect(s.durationBeats).toBeGreaterThan(0);
      expect(s.startBeat + s.durationBeats).toBeLessThanOrEqual(64 + 1e-6); // 落在曲长内
      expect(s.chordIds.length).toBeGreaterThan(0);
      expect(s.recurrenceKey).toBeTruthy();
      expect(['Approach', 'Cadence', 'Launcher', 'Tonic', 'Cycle', 'Turnaround', 'Other']).toContain(s.type);
    }
    // brickSlots 按 startBeat 覆盖整条进行(从 0 起)
    const byStart = [...rm.brickSlots].sort((a, b) => a.startBeat - b.startBeat);
    expect(byStart[0].startBeat).toBe(0);
  });

  it('★ Phase3 复现:16-bar 进行的 brick 结构复现(≥1 个 recurrenceKey 出现 ≥2 次)= Phase4 可接 motif 复用', () => {
    const rm = buildMotifRoadmap(selected, 0, 'major', 16);
    const counts = new Map<string, number>();
    for (const s of rm.brickSlots) counts.set(s.recurrenceKey, (counts.get(s.recurrenceKey) ?? 0) + 1);
    expect([...counts.values()].some((v) => v >= 2), 'brick 结构应复现(供 motif 结构性再现)').toBe(true);
  });
});
