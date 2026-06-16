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
    expect(new Set(chords.map((c) => c.degree)).size).toBeGreaterThanOrEqual(3); // 非退化
    for (const c of chords) { expect(c.realRoman).toBeTruthy(); expect(c.realTonePcs?.length).toBeGreaterThanOrEqual(2); } // 真实和声保留
  });

  it('buildMotifRoadmap:真 RoadMap(harmonicBricks)+ userBrick 锚 0/16/32/48 + 应答槽、不重叠', () => {
    const rm = buildMotifRoadmap(selected, brick, 4, 0, 'major', 16);
    expect(Array.isArray(rm.harmonicBricks)).toBe(true); // parseRoadMap 出真 BrickMatch
    expect(rm.totalBars).toBe(16);
    expect(rm.harmonicRomans.length).toBe(16);
    const anchors = rm.melodicSlots.filter((s) => s.role === 'userBrick').map((s) => s.startBeat);
    expect(anchors).toEqual([0, 16, 32, 48]);
    for (const s of rm.melodicSlots.filter((s) => s.role === 'userBrick')) {
      expect(s.source).toBe('user');
      expect(s.anchorMotifId).toBe(brick.sourceMotifId);
    }
    // 每个 userBrick 之后有非重叠的应答槽
    expect(rm.melodicSlots.some((s) => s.role !== 'userBrick' && s.source === 'generated')).toBe(true);
    const sorted = [...rm.melodicSlots].sort((a, b) => a.startBeat - b.startBeat);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].startBeat).toBeGreaterThanOrEqual(sorted[i - 1].startBeat + sorted[i - 1].durationBeats - 1e-6);
  });
});
