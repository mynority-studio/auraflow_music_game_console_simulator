import { describe, it, expect } from 'vitest';
import { analyzeUserMelodicBrick } from './melodicBrickAnalyzer';
import { degreeOctaveToMidi } from './scale';
import type { UserMotif } from './types';

// 据 scaleDegree 序列造 motif(C 大调);durs 控制时值(长音=结构重),末音可设长。
function motif(degrees: number[], durs: number[]): UserMotif {
  const keyPc = 0, mode = 'major' as const;
  let onset = 0;
  const notes = degrees.map((d, i) => {
    const dur = durs[i];
    const n = { midi: degreeOctaveToMidi(d, 5, keyPc, mode), onsetBeat: onset, durationBeat: dur, velocity: 0.85, scaleDegree: d, octave: 5, accent: 0.7, structuralToneScore: Math.min(1, 0.4 + dur * 0.3) };
    onset += dur;
    return n;
  });
  const contour: number[] = [];
  for (let i = 1; i < notes.length; i++) contour.push(Math.sign(notes[i].midi - notes[i - 1].midi));
  return { id: 'm', keyPc, mode, bpm: 96, notes, lengthBeats: Math.max(4, Math.round(onset / 4) * 4), contour, rhythmCell: durs, createdAt: 0 };
}
const has = (b: ReturnType<typeof analyzeUserMelodicBrick>, fn: string) => b.functions.some((f) => f.function === fn && f.confidence > 0.2);

describe('motifSandbox/melodicBrickAnalyzer(brick 功能分类)', () => {
  it('① 2→1 尾音长/强 → 主功能 cadence 或 resolution', () => {
    const b = analyzeUserMelodicBrick(motif([3, 2, 1], [1, 1, 2]));
    expect(['cadence', 'resolution']).toContain(b.primaryFunction);
    expect(b.cadenceMotion?.pattern).toBe('2-1');
  });

  it('② 7→1 → approach 与 resolution 都是候选', () => {
    const b = analyzeUserMelodicBrick(motif([5, 7, 1], [1, 1, 2]));
    expect(has(b, 'approach')).toBe(true);
    expect(has(b, 'resolution')).toBe(true);
    expect(b.cadenceMotion?.pattern).toBe('7-1');
  });

  it('② 4→3 → approach + resolution', () => {
    const b = analyzeUserMelodicBrick(motif([1, 4, 3], [1, 1, 2]));
    expect(has(b, 'approach')).toBe(true);
    expect(has(b, 'resolution')).toBe(true);
    expect(b.cadenceMotion?.pattern).toBe('4-3');
  });

  it('③ 首稳定 + 上行 + 落开放音 4(长)→ opening/launcher 高于 cadence', () => {
    const b = analyzeUserMelodicBrick(motif([1, 3, 5, 4], [1, 1, 1, 2]));
    expect(['opening', 'launcher']).toContain(b.primaryFunction);
    const cadence = b.functions.find((f) => f.function === 'cadence')?.confidence ?? 0;
    const opening = b.functions.find((f) => f.function === 'opening')?.confidence ?? 0;
    expect(opening).toBeGreaterThan(cadence);
  });

  it('④ 响亮短经过音不压过长结构尾音(主功能仍 cadence/resolution)', () => {
    // [1, 4(短·响), 1(长)]:中间 4 短 0.25 拍但力度高;尾 1 长 2 拍
    const keyPc = 0;
    const notes = [
      { midi: degreeOctaveToMidi(1, 5, keyPc, 'major'), onsetBeat: 0, durationBeat: 1, velocity: 0.7, scaleDegree: 1, octave: 5, accent: 0.6, structuralToneScore: 0.6 },
      { midi: degreeOctaveToMidi(4, 5, keyPc, 'major'), onsetBeat: 1, durationBeat: 0.25, velocity: 1.0, scaleDegree: 4, octave: 5, accent: 0.5, structuralToneScore: 0.25 }, // 响但短弱结构
      { midi: degreeOctaveToMidi(1, 5, keyPc, 'major'), onsetBeat: 2, durationBeat: 2, velocity: 0.9, scaleDegree: 1, octave: 5, accent: 0.9, structuralToneScore: 1.0 }, // 长结构尾
    ];
    const contour = [Math.sign(notes[1].midi - notes[0].midi), Math.sign(notes[2].midi - notes[1].midi)];
    const m: UserMotif = { id: 'm', keyPc, mode: 'major', bpm: 96, notes, lengthBeats: 4, contour, rhythmCell: [1, 0.25, 2], createdAt: 0 };
    const b = analyzeUserMelodicBrick(m);
    expect(['cadence', 'resolution']).toContain(b.primaryFunction);
  });

  it('★ A:按 quote 单元判功能 —— 4 小节 motif,quote(前2小节)落开放音 2 → opening,而非完整 motif 末尾的 1', () => {
    const seq: [number, number, number][] = [[1, 0, 1], [3, 2, 1], [5, 4, 1], [2, 6, 2], [4, 8, 1], [1, 12, 2]]; // [deg, onset, dur]:前 2 小节落 2、后 2 小节落 1
    const notes = seq.map(([d, on, du]) => ({ midi: degreeOctaveToMidi(d, 5, 0, 'major' as const), onsetBeat: on, durationBeat: du, velocity: 0.85, scaleDegree: d, octave: 5, accent: 0.7, structuralToneScore: Math.min(1, 0.4 + du * 0.3) }));
    const contour: number[] = [];
    for (let i = 1; i < notes.length; i++) contour.push(Math.sign(notes[i].midi - notes[i - 1].midi));
    const m: UserMotif = { id: 'm', keyPc: 0, mode: 'major', bpm: 96, notes, lengthBeats: 16, contour, rhythmCell: seq.map((s) => s[2]), createdAt: 0 };
    const brick = analyzeUserMelodicBrick(m, 8); // quote = 前 2 小节(8 拍)
    expect(brick.tail?.scaleDegree).toBe(2); // quote 尾音是开放音 2(不是完整 motif 的 1)
    expect(['opening', 'launcher']).toContain(brick.primaryFunction);
    expect(brick.lengthBeats).toBe(16); // 仍记完整长度
  });

  it('确定性 + 带 evidence', () => {
    const a = analyzeUserMelodicBrick(motif([3, 2, 1], [1, 1, 2]));
    const b = analyzeUserMelodicBrick(motif([3, 2, 1], [1, 1, 2]));
    expect(a.primaryFunction).toBe(b.primaryFunction);
    expect(a.evidence.length).toBeGreaterThan(0);
  });
});
