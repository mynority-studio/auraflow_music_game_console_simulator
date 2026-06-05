import { describe, it, expect } from 'vitest';
import { evaluateNoteInChordContext } from './mgMusicTheory';

// ============================================================
// MG strict 移植 Loop 6 — evaluateNoteInChordContext golden 锁
// ------------------------------------------------------------
// 这是依赖闭包里【最大风险】函数(owns TENDENCY_TABLE / CHORD_VOICING_AESTHETICS /
// INTERVAL_AESTHETICS / KK_* 手调表,转译错=静默腐败)。mgMusicTheory 是整文件 byte 复制,
// 故表 byte 一致;此 golden 由 MG 真跑导出(逐值,含 urgency 浮点)做硬锁,防未来误改表。
// ============================================================

interface Case {
  in: [number, string, number, 'T' | 'S' | 'D', string | null, number | null, number];
  out: {
    consonance: 'consonant' | 'colortone' | 'tension' | 'avoid';
    urgency: number;
    resolutionTargets: number[];
    isInChordContract: boolean;
    isInChordExtension: boolean;
    isInNextChordAnchor: boolean;
  };
}

const GOLDEN: Case[] = [
  { in: [4, 'maj7', 0, 'T', null, null, 0], out: { consonance: 'consonant', urgency: 0.47815533980582514, resolutionTargets: [0, 7, 11], isInChordContract: true, isInChordExtension: false, isInNextChordAnchor: false } },
  { in: [6, 'maj7', 0, 'T', null, null, 0], out: { consonance: 'avoid', urgency: 0.9296116504854368, resolutionTargets: [7, 4, 5, 0, 11], isInChordContract: false, isInChordExtension: true, isInNextChordAnchor: false } },
  { in: [5, '7', 7, 'D', 'maj7', 0, 0], out: { consonance: 'tension', urgency: 0.5485436893203883, resolutionTargets: [4, 0, 7, 11, 2], isInChordContract: true, isInChordExtension: false, isInNextChordAnchor: false } },
  { in: [10, 'm7', 2, 'S', null, null, 0], out: { consonance: 'avoid', urgency: 0.9854368932038835, resolutionTargets: [9, 4, 0, 2, 5], isInChordContract: false, isInChordExtension: false, isInNextChordAnchor: false } },
  { in: [1, '7', 7, 'D', 'maj7', 0, 0], out: { consonance: 'avoid', urgency: 1, resolutionTargets: [2, 11, 0, 7, 5, 4], isInChordContract: false, isInChordExtension: true, isInNextChordAnchor: false } },
];

describe('knowledge/mgMusicTheory · evaluateNoteInChordContext golden (Loop 6 最大风险表)', () => {
  for (const c of GOLDEN) {
    const [np, ct, cr, fn] = c.in;
    it(`★ pc${np} over ${ct}@${cr} (${fn}) 与 MG bit 一致`, () => {
      const r = evaluateNoteInChordContext(...c.in);
      expect(r).toEqual(c.out); // 含 urgency 浮点精确相等
    });
  }
});
