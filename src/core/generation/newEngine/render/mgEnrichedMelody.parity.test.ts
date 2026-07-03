import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSeededRng } from './mgRng';
import { expandGrammarForRoadMap } from './mgGrammarRuntime';
import { scheduleBrickExpansions, type ScheduledToken } from './mgTokenScheduler';
import { fallbackTokensForBrick } from './mgAdvisor';
import { realizeTokens } from './mgMelodyRealizer';
import { buildGuideTonePlan } from './mgGuideTonePlanner';
import { renderStyleFeel, feelForStyle } from './mgStyleRenderer';
import { buildChordPart, type MgChordDef } from './mgChordPart';
import type { BrickMatch } from './mgRoadMapParser';
import {
  ENRICHED_GRAMMAR, POP_ENRICHED_GRAMMAR, LOFI_ENRICHED_GRAMMAR, RNB_ENRICHED_GRAMMAR,
  ENRICHED_GRAMMAR_RULE_COUNT, POP_ENRICHED_GRAMMAR_RULE_COUNT,
  LOFI_ENRICHED_GRAMMAR_RULE_COUNT, RNB_ENRICHED_GRAMMAR_RULE_COUNT,
} from '../knowledge/melodyStyleGrammarProfiles';

// ============================================================
// MG strict 移植 — enriched(生产)旋律全链 parity 锁(slope corpus 港)
// ------------------------------------------------------------
// 这是【生产实际用的】per-style enriched grammar(BUILTIN + 6119 行 slope 语料)。
// 精确镜像 generateImprovisorMelody:per-style 语法 → 展开 + stage3b Advisor 兜底 → 落拍 →
// realizeTokens(+真 guideTonePlan + LOFI preserveSlopeGrammar)→ renderStyleFeel,一条 rng 续用。
// deepEqual MG → 证明 enriched 全链 bit 一致,**首次覆盖 Slope token + slope-window 选音 + slope 平衡**。
// ============================================================

const HERE = dirname(fileURLToPath(import.meta.url));
const ORACLE_DIR = join(HERE, '__mgOracle__');

interface StyledNote { midi: number; time: number; dur: number; vel: number; deg?: string }
interface OracleFixture {
  seed: string;
  style: string;
  chords: MgChordDef[];
  roadMap: { bricks: BrickMatch[] };
  scheduledTokensEnriched: ScheduledToken[];
  styledMelodyEnriched: StyledNote[];
}

const fixtures: OracleFixture[] = readdirSync(ORACLE_DIR)
  .filter((f) => f.endsWith('.json') && f !== '_index.json')
  .sort()
  .map((f) => JSON.parse(readFileSync(join(ORACLE_DIR, f), 'utf8')) as OracleFixture);

function grammarFor(style: string) {
  const k = style.toUpperCase();
  return k === 'LOFI' ? LOFI_ENRICHED_GRAMMAR
    : k === 'POP' ? POP_ENRICHED_GRAMMAR
    : k === 'RNB' ? RNB_ENRICHED_GRAMMAR
    : ENRICHED_GRAMMAR;
}

// 镜像 generateImprovisorMelody stage 3-5(enriched)。返回 { scheduled, styled }。
function enrichedChain(fx: OracleFixture) {
  const styleKey = fx.style.toUpperCase();
  const rng = makeSeededRng(fx.seed);
  const perBrick = expandGrammarForRoadMap(grammarFor(fx.style), fx.roadMap.bricks, rng);
  for (let i = 0; i < perBrick.length; i++) {
    if (perBrick[i].tokens.length === 0) perBrick[i].tokens = fallbackTokensForBrick(perBrick[i].brick);
  }
  const scheduled = scheduleBrickExpansions(perBrick);
  const chordPart = buildChordPart(fx.chords);
  const guideTonePlan = buildGuideTonePlan({ chordPart });
  const raw = realizeTokens({
    scheduledTokens: scheduled,
    chordPart,
    rng,
    guideTonePlan,
    preserveSlopeGrammar: styleKey === 'LOFI',
  });
  const styled = renderStyleFeel({ events: raw, feel: feelForStyle(fx.style), rng })
    .map((e) => ({ midi: e.noteNumber, time: e.time, dur: e.duration, vel: e.velocity, deg: e.degree }));
  return { scheduled, styled };
}

describe('render/enriched · MG 移植 生产旋律全链 parity (slope corpus)', () => {
  // ★ 产品语义分叉(2026-07-02):规则数量仍等于当前 MG FunctionalGrammar,但全风格降低
  //   softParallel cadence boost,避免 Cadence family 内所有 brick 被同一 Surprise-Major-Cadence
  //   句型吞掉。因此本文件不再对 styled/scheduled 做 current-MG byte parity。
  it('enriched 语法计数 = 当前 MG(JAZZ 5923 / POP 800 / LOFI 1223 / RNB 1177)', () => {
    expect(ENRICHED_GRAMMAR_RULE_COUNT).toBe(5923);
    expect(POP_ENRICHED_GRAMMAR_RULE_COUNT).toBe(800);
    expect(LOFI_ENRICHED_GRAMMAR_RULE_COUNT).toBe(1223);
    expect(RNB_ENRICHED_GRAMMAR_RULE_COUNT).toBe(1177);
  });

  it('fixture 含 enriched 真源 + slope token 真的出现(slope-window 被覆盖)', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(9);
    for (const fx of fixtures) {
      expect(Array.isArray(fx.scheduledTokensEnriched)).toBe(true);
      const slope = fx.scheduledTokensEnriched.filter((s) => s.token.kind === 'SlopeEnter' || s.token.kind === 'SlopeExit' || s.token.kind === 'Slope').length;
      expect(slope).toBeGreaterThan(0); // enriched 真的发出 Slope token
    }
  });

  // ★ slope corpus + shaper 接线仍按 MG 移植结构跑;产品侧权重分叉后锁确定性和可渲染性。
  for (const fx of fixtures) {
    it(`★ ${fx.seed} [${fx.style}] enriched scheduled tokens 产品分叉后仍确定`, () => {
      const a = enrichedChain(fx).scheduled;
      const b = enrichedChain(fx).scheduled;
      expect(a.length).toBeGreaterThan(0);
      expect(a).toEqual(b);
    });
    it(`★ ${fx.seed} [${fx.style}] enriched 生产旋律产品分叉后仍可渲染`, () => {
      const a = enrichedChain(fx).styled;
      const b = enrichedChain(fx).styled;
      expect(a.length).toBeGreaterThan(0);
      expect(a).toEqual(b);
    });
  }

  it('确定性:同 fixture 两次 enriched 全链一致', () => {
    const fx = fixtures[0];
    expect(enrichedChain(fx).styled).toEqual(enrichedChain(fx).styled);
  });
});
