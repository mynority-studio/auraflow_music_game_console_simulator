import { describe, it, expect } from 'vitest';
import {
  resolveLocalScale, melodyContractPcsForStyle, buildRunScale,
  type LocalScaleChordLike, type LocalScaleContext,
} from './mgLocalScaleResolver';

// ============================================================
// MG strict 移植 Loop 6 — localScaleResolver golden 锁
// ------------------------------------------------------------
// golden 值由 MG ../melodygenerative/src/lib/localScaleResolver.ts 真跑导出(逐值)。
// 这层是 melody shaper 的依赖;先单独 golden 验证,降低 shaper parity 调试面。
// ============================================================

const chord = (rootMidi: number, type: string, roman: string): LocalScaleChordLike =>
  ({ rootMidi, type, roman, bassMidi: rootMidi, duration: 4 } as never);

interface Golden {
  label: string;
  ctx: LocalScaleContext;
  chord: LocalScaleChordLike;
  name: string; rootPc: number; source: string;
  scalePcs: number[]; strict: boolean; contract: number[]; runLen: number;
}

const GOLDEN: Golden[] = [
  { label: 'POP I Cmaj7', ctx: { style: 'POP', key: 'C', mode: 'major' }, chord: chord(48, 'maj7', 'I'),
    name: 'Ionian', rootPc: 0, source: 'global', scalePcs: [0, 2, 4, 5, 7, 9, 11], strict: false, contract: [0, 4, 7, 11], runLen: 30 },
  // ⚠️ MG 活跃开发:melodyContractPcsForStyle 上游简化为 declaredChordPcs;contract 已 re-sync 到当前 MG。
  { label: 'LOFI ii Dm7', ctx: { style: 'LOFI', key: 'C', mode: 'major' }, chord: chord(50, 'm7', 'ii'),
    name: 'Ionian', rootPc: 0, source: 'global', scalePcs: [0, 2, 4, 5, 7, 9, 11], strict: false, contract: [0, 2, 5, 9], runLen: 30 },
  // ★ MG full-parity G5 rebaseline:JAZZ 属和弦走 jazzChordScale→jazzDominantScale(当前 MG ground truth:
  //   G7 func D → stableChoice → Bebop Dominant / 根 7 / jazz-chord-scale)。旧 Ionian/global 是陈旧 old-port 值。
  { label: 'JAZZ V G7', ctx: { style: 'JAZZ', key: 'C', mode: 'major' }, chord: chord(55, '7', 'V'),
    name: 'Bebop Dominant', rootPc: 7, source: 'jazz-chord-scale', scalePcs: [0, 2, 4, 5, 6, 7, 9, 11], strict: true, contract: [2, 5, 7, 11], runLen: 34 },
  { label: 'RNB vi Am9', ctx: { style: 'RNB', key: 'C', mode: 'major' }, chord: chord(57, 'm9', 'vi'),
    name: 'Ionian', rootPc: 0, source: 'global', scalePcs: [0, 2, 4, 5, 7, 9, 11], strict: false, contract: [0, 4, 7, 9, 11], runLen: 30 },
  // ★ MG full-parity Phase C(directive 3.5):RNB 五声/blues 家族候选已补齐(contractScaleCandidateNames RNB 分支)。
  //   forcedScale 'Major Blues' → resolver 返 Major Blues(旧 sim 缺 RNB 候选时此类色彩 scale 不在 candidate 框内)。
  //   golden 由当前 MG resolveLocalScale 真跑导出(逐值)。
  { label: 'RNB I forced Major Blues', ctx: { style: 'RNB', key: 'C', mode: 'major' },
    chord: { rootMidi: 60, type: 'maj', roman: 'I', bassMidi: 60, duration: 4, forcedScale: 'Major Blues', effectiveFunc: 'T' } as never,
    name: 'Major Blues', rootPc: 0, source: 'forced', scalePcs: [0, 2, 3, 4, 7, 9], strict: true, contract: [0, 4, 7], runLen: 26 },
];

describe('knowledge/mgLocalScaleResolver · MG golden (Loop 6 依赖层)', () => {
  for (const g of GOLDEN) {
    it(`★ ${g.label} resolveLocalScale/contract/runScale 与 MG 一致`, () => {
      const ls = resolveLocalScale(g.ctx, g.chord);
      expect(ls.name).toBe(g.name);
      expect(ls.rootPc).toBe(g.rootPc);
      expect(ls.source).toBe(g.source);
      expect([...ls.pcs].sort((a, b) => a - b)).toEqual(g.scalePcs);
      expect(ls.strict).toBe(g.strict);
      const rootPc = ((g.chord.rootMidi % 12) + 12) % 12;
      const contract = [...melodyContractPcsForStyle(g.ctx.style, g.chord, rootPc)].sort((a, b) => a - b);
      expect(contract).toEqual(g.contract);
      expect(buildRunScale(ls).length).toBe(g.runLen);
    });
  }
});
