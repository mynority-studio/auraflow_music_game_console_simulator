import { describe, expect, it } from 'vitest';
import { scoreLeadAccents } from './leadAccents';
import type { AuraLeadNote } from '../types';

const PPQ = 480;

function note(pitch: number, startBeat: number, durBeats: number, velocity = 90): AuraLeadNote {
  return { pitch, startTick: Math.round(startBeat * PPQ), durationTicks: Math.round(durBeats * PPQ), velocity };
}

const CTX = { ppq: PPQ, beatsPerBar: 4 };

describe('auraRoaming/leadAccents — lead 重音识别', () => {
  it('休止 ≥1 拍后的乐句头得分高于连奏中段音', () => {
    const notes = [
      note(60, 0, 0.5),
      note(62, 0.5, 0.5),
      note(64, 1, 0.5),   // 连奏中段
      note(65, 3, 1),     // 1.5 拍休止后的乐句头 + 长音
    ];
    const scored = scoreLeadAccents(notes, CTX);
    const mid = scored.find((c) => c.pitch === 64)!;
    const head = scored.find((c) => c.pitch === 65)!;
    expect(head.score).toBeGreaterThan(mid.score);
  });

  it('正拍长音得分高于反拍短音', () => {
    const notes = [
      note(60, 4, 2),     // 小节正拍 + 2 拍长音
      note(62, 6.5, 0.25), // 反拍短音
      note(64, 7, 0.5),
    ];
    const scored = scoreLeadAccents(notes, CTX);
    const downbeatLong = scored.find((c) => c.pitch === 60)!;
    const offbeatShort = scored.find((c) => c.pitch === 62)!;
    expect(downbeatLong.score).toBeGreaterThan(offbeatShort.score);
  });

  it('输出按 tick 升序且确定性', () => {
    const notes = [note(64, 2, 1), note(60, 0, 1), note(67, 4, 1)];
    const a = scoreLeadAccents(notes, CTX);
    const b = scoreLeadAccents(notes, CTX);
    expect(a).toEqual(b);
    for (let i = 1; i < a.length; i++) expect(a[i].tick).toBeGreaterThanOrEqual(a[i - 1].tick);
  });
});
