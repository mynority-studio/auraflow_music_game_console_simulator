import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSeededRng } from './mgRng';
import { expandGrammarForRoadMap } from './mgGrammarRuntime';
import { scheduleBrickExpansions } from './mgTokenScheduler';
import { realizeTokens } from './mgMelodyRealizer';
import { buildGuideTonePlan } from './mgGuideTonePlanner';
import { renderStyleFeel, feelForStyle } from './mgStyleRenderer';
import { buildChordPart, type MgChordDef } from './mgChordPart';
import type { BrickMatch } from './mgRoadMapParser';
import { BUILTIN_GRAMMAR } from '../knowledge/melodyBuiltinGrammar';

// ============================================================
// MG strict 移植 Loop 5 — style-rendered melody parity 锁
// ------------------------------------------------------------
// 终止判据(directive):style-rendered melody fixture 与 MG 精确一致。
// 全链:RNG → 展开 → 落拍 → realizeTokens(+真 guideTonePlan)→ renderStyleFeel(style feel),
// 一条 rng 实例续用,deepEqual MG 自跑的 styledMelodyBuiltin。
// 这是 Loop 4 raw 之上 +guide-tone 绑定(mgGuideTonePlanner)+swing/accent/articulation(mgStyleRenderer)。
// 注:仍用 BUILTIN_GRAMMAR(slope 语料缓搬);LOFI preserveSlopeGrammar 对 builtin 惰性(无 Slope token)。
// ============================================================

const HERE = dirname(fileURLToPath(import.meta.url));
const ORACLE_DIR = join(HERE, '__mgOracle__');

interface StyledNote { midi: number; time: number; dur: number; vel: number; deg?: string }
interface OracleFixture {
  seed: string;
  style: string;
  chords: MgChordDef[];
  roadMap: { bricks: BrickMatch[] };
  styledMelodyBuiltin: StyledNote[];
}

const fixtures: OracleFixture[] = readdirSync(ORACLE_DIR)
  .filter((f) => f.endsWith('.json') && f !== '_index.json')
  .sort()
  .map((f) => JSON.parse(readFileSync(join(ORACLE_DIR, f), 'utf8')) as OracleFixture);

function styledMelody(fx: OracleFixture): StyledNote[] {
  const rng = makeSeededRng(fx.seed);
  const perBrick = expandGrammarForRoadMap(BUILTIN_GRAMMAR, fx.roadMap.bricks, rng);
  const scheduled = scheduleBrickExpansions(perBrick);
  const chordPart = buildChordPart(fx.chords);
  const guideTonePlan = buildGuideTonePlan({ chordPart });
  const raw = realizeTokens({
    scheduledTokens: scheduled,
    chordPart,
    rng,
    guideTonePlan,
    preserveSlopeGrammar: fx.style.toUpperCase() === 'LOFI',
  });
  return renderStyleFeel({ events: raw, feel: feelForStyle(fx.style), rng })
    .map((e) => ({ midi: e.noteNumber, time: e.time, dur: e.duration, vel: e.velocity, deg: e.degree }));
}

describe('render/mgStyleRenderer · MG 移植 style-rendered melody parity (Loop 5)', () => {
  it('加载到 9 个 oracle fixture(含 styledMelodyBuiltin)', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(9);
    for (const fx of fixtures) {
      expect(Array.isArray(fx.styledMelodyBuiltin)).toBe(true);
      expect(fx.styledMelodyBuiltin.length).toBeGreaterThan(0);
    }
  });

  for (const fx of fixtures) {
    it(`★ ${fx.seed} [${fx.style}] style-rendered melody 与 MG 精确一致`, () => {
      expect(styledMelody(fx)).toEqual(fx.styledMelodyBuiltin);
    });
  }

  it('确定性:同 fixture 两次结果一致', () => {
    const fx = fixtures[0];
    expect(styledMelody(fx)).toEqual(styledMelody(fx));
  });

  it('JAZZ 有 swing(offbeat 落在 ~0.67)', () => {
    const jazz = fixtures.find((f) => f.style.toUpperCase() === 'JAZZ')!;
    const swung = jazz.styledMelodyBuiltin.some((n) => Math.abs((n.time % 1) - 0.67) < 0.02);
    expect(swung).toBe(true);
  });

  it('POP 直拍(无 0.67 offbeat — swingRatio 0.5)', () => {
    const pop = fixtures.find((f) => f.style.toUpperCase() === 'POP')!;
    const swung = pop.styledMelodyBuiltin.some((n) => Math.abs((n.time % 1) - 0.67) < 0.02);
    expect(swung).toBe(false);
  });
});
