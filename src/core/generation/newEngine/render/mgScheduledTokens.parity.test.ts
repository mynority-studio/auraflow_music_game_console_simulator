import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSeededRng } from './mgRng';
import { expandGrammarForRoadMap } from './mgGrammarRuntime';
import { scheduleBrickExpansions, type ScheduledToken } from './mgTokenScheduler';
import type { BrickMatch } from './mgRoadMapParser';
import { BUILTIN_GRAMMAR } from '../knowledge/melodyBuiltinGrammar';

// ============================================================
// MG strict 移植 Loop 3 — scheduled-token parity 锁
// ------------------------------------------------------------
// 终止判据(directive):scheduled token fixture 与 MG 精确一致。
// 用【我们忠实港】的 makeSeededRng + expandGrammarForRoadMap(BUILTIN_GRAMMAR) +
// scheduleBrickExpansions,喂 fixture 的 roadMap.bricks + seed,deepEqual MG 自跑的
// scheduledTokensBuiltin。验证 RNG + 加权展开 + 落拍(超界裁剪 + slope 平衡)机器 bit 一致。
// 注:用 BUILTIN_GRAMMAR(slope 语料缓搬);enriched 生产输出待 slope corpus 港后再验。
// ============================================================

const HERE = dirname(fileURLToPath(import.meta.url));
const ORACLE_DIR = join(HERE, '__mgOracle__');

interface OracleFixture {
  seed: string;
  style: string;
  roadMap: { bricks: BrickMatch[] };
  scheduledTokensBuiltin: ScheduledToken[];
}

const fixtures: OracleFixture[] = readdirSync(ORACLE_DIR)
  .filter((f) => f.endsWith('.json') && f !== '_index.json')
  .sort()
  .map((f) => JSON.parse(readFileSync(join(ORACLE_DIR, f), 'utf8')) as OracleFixture);

describe('render/mgTokenScheduler · MG 移植 scheduled-token parity (Loop 3)', () => {
  it('加载到 9 个 oracle fixture(含 scheduledTokensBuiltin)', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(9);
    for (const fx of fixtures) {
      expect(Array.isArray(fx.scheduledTokensBuiltin)).toBe(true);
      expect(fx.scheduledTokensBuiltin.length).toBeGreaterThan(0);
    }
  });

  for (const fx of fixtures) {
    it(`★ ${fx.seed} [${fx.style}] scheduled tokens 与 MG 精确一致`, () => {
      const rng = makeSeededRng(fx.seed);
      const perBrick = expandGrammarForRoadMap(BUILTIN_GRAMMAR, fx.roadMap.bricks, rng);
      const ours = scheduleBrickExpansions(perBrick);
      expect(ours).toEqual(fx.scheduledTokensBuiltin);
    });
  }

  it('确定性:同 seed 重复展开+落拍结果一致', () => {
    const fx = fixtures[0];
    const a = scheduleBrickExpansions(expandGrammarForRoadMap(BUILTIN_GRAMMAR, fx.roadMap.bricks, makeSeededRng(fx.seed)));
    const b = scheduleBrickExpansions(expandGrammarForRoadMap(BUILTIN_GRAMMAR, fx.roadMap.bricks, makeSeededRng(fx.seed)));
    expect(a).toEqual(b);
  });

  it('不同 seed → token 序列发散(RNG 真随机)', () => {
    const fx = fixtures.find((f) => f.roadMap.bricks.length >= 6)!;
    const a = scheduleBrickExpansions(expandGrammarForRoadMap(BUILTIN_GRAMMAR, fx.roadMap.bricks, makeSeededRng('seed-A')));
    const b = scheduleBrickExpansions(expandGrammarForRoadMap(BUILTIN_GRAMMAR, fx.roadMap.bricks, makeSeededRng('seed-B')));
    expect(a).not.toEqual(b);
  });
});
