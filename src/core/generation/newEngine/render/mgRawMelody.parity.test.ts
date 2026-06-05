import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSeededRng } from './mgRng';
import { expandGrammarForRoadMap } from './mgGrammarRuntime';
import { scheduleBrickExpansions } from './mgTokenScheduler';
import { realizeTokens } from './mgMelodyRealizer';
import { buildChordPart, type MgChordDef } from './mgChordPart';
import type { BrickMatch } from './mgRoadMapParser';
import { BUILTIN_GRAMMAR } from '../knowledge/melodyBuiltinGrammar';

// ============================================================
// MG strict 移植 Loop 4 — raw-melody parity 锁
// ------------------------------------------------------------
// 终止判据(directive):raw melody fixture 与 MG 精确一致。
// 用【我们忠实港】的 RNG + 展开 + 落拍 + realizeTokens(PitchClassSets + NoteChooser),
// 一条 rng 实例续用(展开→落拍→实化),guideTonePlan=undefined(无 guide-tone)、无 style,
// 喂 fixture 的 roadMap.bricks + chords,deepEqual MG 自跑的 rawMelodyBuiltin。
// 注:用 BUILTIN_GRAMMAR(无 Slope token)→ NoteChooser 的 slope-window 路径未被覆盖(slope 语料缓搬),
//     C/S/L/A/R/G 实化 + IV 概率窗口 + GOAL 权重 + APPROACH lookahead 全 bit 验证。
// ============================================================

const HERE = dirname(fileURLToPath(import.meta.url));
const ORACLE_DIR = join(HERE, '__mgOracle__');

interface RawNote { midi: number; time: number; dur: number; deg?: string }
interface OracleFixture {
  seed: string;
  style: string;
  chords: MgChordDef[];
  roadMap: { bricks: BrickMatch[] };
  rawMelodyBuiltin: RawNote[];
}

const fixtures: OracleFixture[] = readdirSync(ORACLE_DIR)
  .filter((f) => f.endsWith('.json') && f !== '_index.json')
  .sort()
  .map((f) => JSON.parse(readFileSync(join(ORACLE_DIR, f), 'utf8')) as OracleFixture);

function realizeRaw(fx: OracleFixture): RawNote[] {
  const rng = makeSeededRng(fx.seed);
  const perBrick = expandGrammarForRoadMap(BUILTIN_GRAMMAR, fx.roadMap.bricks, rng);
  const scheduled = scheduleBrickExpansions(perBrick);
  const events = realizeTokens({
    scheduledTokens: scheduled,
    chordPart: buildChordPart(fx.chords),
    rng,
    guideTonePlan: undefined,
  });
  return events.map((e) => ({ midi: e.noteNumber, time: e.time, dur: e.duration, deg: e.degree }));
}

describe('render/mgMelodyRealizer · MG 移植 raw-melody parity (Loop 4)', () => {
  it('加载到 9 个 oracle fixture(含 rawMelodyBuiltin)', () => {
    expect(fixtures.length).toBe(9);
    for (const fx of fixtures) {
      expect(Array.isArray(fx.rawMelodyBuiltin)).toBe(true);
      expect(fx.rawMelodyBuiltin.length).toBeGreaterThan(0);
    }
  });

  for (const fx of fixtures) {
    it(`★ ${fx.seed} [${fx.style}] raw melody 与 MG 精确一致`, () => {
      expect(realizeRaw(fx)).toEqual(fx.rawMelodyBuiltin);
    });
  }

  it('确定性:同 fixture 两次实化结果一致', () => {
    const fx = fixtures[0];
    expect(realizeRaw(fx)).toEqual(realizeRaw(fx));
  });

  it('所有音符落在合理音域内(MELODY_RANGE 边界附近)', () => {
    for (const fx of fixtures) {
      for (const n of fx.rawMelodyBuiltin) {
        expect(n.midi).toBeGreaterThanOrEqual(48);
        expect(n.midi).toBeLessThanOrEqual(96);
      }
    }
  });
});
