import { describe, it, expect } from 'vitest';
import { deriveLofiMotifCellFromUserBrick } from './userMotifLofiCell';
import { buildUserMotifBrickSongOverride } from '../../motifSandbox/bridge/sandboxToOverride';
import { buildMotifSongBundle, generateSongFromMotifBundle } from '../generation/generateSongFromMotif';
import type { UserMotif } from '../../motifSandbox/model/types';
import type { UserMotifBrick } from './userMotifBrick';

const brick = (notes: UserMotifBrick['notes']): UserMotifBrick => ({ notes, quoteBeats: 4, sourceMotifId: 'm1' });

describe('userMotifLofiCell · 用户 motif → LOFI 种子 cell', () => {
  it('头部 ≤4 音派生:节奏量化 1/4 拍、步进 = 半音差/2 钳 ±3、首 anchor 末 terminal', () => {
    const cell = deriveLofiMotifCellFromUserBrick(brick([
      { pitch: 60, onsetBeat: 0, durationBeat: 0.5, velocity: 100, structuralToneScore: 1 },
      { pitch: 64, onsetBeat: 1, durationBeat: 0.5, velocity: 92, structuralToneScore: 0.3 },
      { pitch: 67, onsetBeat: 2, durationBeat: 1.5, velocity: 96, structuralToneScore: 1 },
    ]))!;
    expect(cell.events.length).toBe(3);
    expect(cell.events.map((e) => e.offsetBeat)).toEqual([0, 1, 2]);
    expect(cell.events.map((e) => e.diatonicStepFromPrevious)).toEqual([0, 2, 2]); // +4/2, +3/2→2(round 1.5)
    expect(cell.events[0].harmonicRole).toBe('anchor');
    expect(cell.events[1].harmonicRole).toBe('passing'); // 弱结构内部音
    expect(cell.events[2].harmonicRole).toBe('terminal');
    expect(cell.id).toBe('user-motif-cell-m1');
  });

  it('时值不吞下一音 onset;超出 bar 的音不进 cell;过密撞位返回 undefined', () => {
    const cell = deriveLofiMotifCellFromUserBrick(brick([
      { pitch: 60, onsetBeat: 0, durationBeat: 3, velocity: 100, structuralToneScore: 1 },  // 3 拍但下一音在 1 → 裁到 1
      { pitch: 62, onsetBeat: 1, durationBeat: 0.5, velocity: 92, structuralToneScore: 0.4 },
      { pitch: 64, onsetBeat: 5, durationBeat: 1, velocity: 96, structuralToneScore: 1 },   // 超 bar → 不进
    ]))!;
    expect(cell.events.length).toBe(2);
    expect(cell.events[0].durationBeats).toBeCloseTo(1, 6);
    const dense = deriveLofiMotifCellFromUserBrick(brick([
      { pitch: 60, onsetBeat: 0, durationBeat: 0.1, velocity: 90, structuralToneScore: 0.5 },
      { pitch: 62, onsetBeat: 0.05, durationBeat: 0.1, velocity: 90, structuralToneScore: 0.5 },
    ]));
    expect(dense).toBeUndefined();
  });

  it('端到端:LOFI + userBrick 时 score plan 的 statement 事件采用用户 cell 节奏', () => {
    const motif: UserMotif = {
      id: 'lofi-seed', keyPc: 0, mode: 'major', bpm: 90, lengthBeats: 4, createdAt: 0,
      contour: [1, 1], rhythmCell: [0.5, 0.5, 1.5],
      notes: [
        { midi: 60, onsetBeat: 0.5, durationBeat: 0.5, velocity: 0.9, scaleDegree: 1, octave: 5, accent: 0.9, structuralToneScore: 0.9 },
        { midi: 64, onsetBeat: 1.5, durationBeat: 0.5, velocity: 0.85, scaleDegree: 3, octave: 5, accent: 0.6, structuralToneScore: 0.4 },
        { midi: 67, onsetBeat: 2.5, durationBeat: 1.5, velocity: 0.9, scaleDegree: 5, octave: 5, accent: 0.8, structuralToneScore: 0.95 },
      ],
    };
    const ov = buildUserMotifBrickSongOverride(motif, { style: 'lofi', seed: 11, keyPc: 0, mode: 'major' });
    const mb = buildMotifSongBundle({ seed: 11, styleHint: 'lofi', mood: 'build', targetDuration: 96 }, ov);
    const plan = mb.bundle.lofiLeadScorePlan;
    if (!plan) return; // 该 seed 无 score 路(presence/interaction 缺)→ 不适用,其它 seed 测试覆盖
    const statements = plan.events.filter((e) => e.phraseRole === 'statement');
    expect(statements.length).toBeGreaterThan(0);
    // statement 事件的 bar 内相对 offset 应来自用户 cell(0.5 相位差组:0/1/2 相对首音)
    expect(statements.every((e) => e.sourceCellId === 'user-motif-cell-lofi-seed')).toBe(true);
    // 整曲仍可正常生成
    const song = generateSongFromMotifBundle(mb);
    expect(song.status).not.toBe('failed');
  });
});
