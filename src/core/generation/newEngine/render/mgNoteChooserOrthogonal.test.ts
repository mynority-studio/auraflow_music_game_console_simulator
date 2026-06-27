import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSeededRng } from './mgRng';
import { expandGrammarForRoadMap } from './mgGrammarRuntime';
import { scheduleBrickExpansions } from './mgTokenScheduler';
import { fallbackTokensForBrick } from './mgAdvisor';
import { realizeTokens } from './mgMelodyRealizer';
import { buildGuideTonePlan } from './mgGuideTonePlanner';
import { buildChordPart, type MgChordDef } from './mgChordPart';
import { MELODY_RANGE } from '../knowledge/mgMusicTheory';
import {
  ENRICHED_GRAMMAR, POP_ENRICHED_GRAMMAR, LOFI_ENRICHED_GRAMMAR, RNB_ENRICHED_GRAMMAR,
} from '../knowledge/melodyStyleGrammarProfiles';

// ============================================================
// MG full-parity G8 — NoteChooser × orthogonal(localScaleContext)候选集 守卫
// ------------------------------------------------------------
// 背景:mgNoteChooser.ts 与【当前 MG】NoteChooser.ts 逐值 byte-identical(仅 import 路径不同),
//   依赖 resolveDegree / CHORD_TYPES / MELODY_RANGE 亦 identical(已核)。选择逻辑(softmax/VL clamp/
//   nearest-midi/IV window/triadic)对当前 MG 忠实。候选集变更(G2-G5 orthogonal admission)发生在
//   【上游 buildPitchSets】,NoteChooser 只消费 ctx.sets —— 故只要 sets 忠实(G2/G3 已验),选择即忠实。
// 但现有 parity oracle 全是【无 context】路径(旧 vocab),NoteChooser 消费【orthogonal 候选集】的路径无守卫。
// 本测专补该缺口:喂 localScaleContext → 走 orthogonal admission → 断言选择结果【合法 + 确定 + 不退化】,
//   且 JAZZ/RNB(chord-scale 真收窄候选)下 context 路径【实际改变】落音(证明 orthogonal 链贯穿到 chooser)。
// ============================================================

const HERE = dirname(fileURLToPath(import.meta.url));
const ORACLE_DIR = join(HERE, '__mgOracle__');

interface OracleFixture {
  seed: string; style: string;
  chords: MgChordDef[];
  roadMap: { bricks: unknown[] };
  shaper: { shaperArgs: { style: string; musicKey: string; musicMode: string } } | null;
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

// 走生产同款链(grammar → schedule → guideTone → realize),可选 localScaleContext。
function realizeWith(fx: OracleFixture, withContext: boolean) {
  const a = fx.shaper!.shaperArgs;
  const rng = makeSeededRng(fx.seed);
  const perBrick = expandGrammarForRoadMap(grammarFor(fx.style), fx.roadMap.bricks as never, rng);
  for (let i = 0; i < perBrick.length; i++) {
    if (perBrick[i].tokens.length === 0) perBrick[i].tokens = fallbackTokensForBrick(perBrick[i].brick);
  }
  const scheduled = scheduleBrickExpansions(perBrick);
  const chordPart = buildChordPart(fx.chords);
  const localScaleContext = withContext ? { style: a.style, key: a.musicKey, mode: a.musicMode } : undefined;
  const guideTonePlan = buildGuideTonePlan({ chordPart, localScaleContext } as never);
  return realizeTokens({
    scheduledTokens: scheduled,
    chordPart,
    rng,
    guideTonePlan,
    preserveSlopeGrammar: fx.style.toUpperCase() === 'LOFI',
    localScaleContext,
  } as never).filter((e) => e.part === 'melody');
}

const seedsByStyle = (s: string) => fixtures.filter((f) => f.shaper && f.style.toUpperCase() === s);

describe('render/mgNoteChooser × orthogonal 候选集(G8 守卫)', () => {
  const withCtx = fixtures.filter((f) => f.shaper);

  it('context-active 落音合法:在旋律寄存域 ±1 八度内 · dur>0 · 时间升序 · 非空', () => {
    // pre-shaper realize 落音可略出 MELODY_RANGE(approach/slope 触界 ±数半音);严格 MELODY_RANGE
    //   钳位由 shaper 的 registered(八度移入域)负责。此处守「不野」:在寄存域 ±1 八度内。
    const LO = MELODY_RANGE.LOW - 12;
    const HI = MELODY_RANGE.HIGH + 12;
    for (const fx of withCtx) {
      const out = realizeWith(fx, true);
      expect(out.length, `${fx.seed} 非空`).toBeGreaterThan(0);
      for (let i = 0; i < out.length; i++) {
        expect(out[i].noteNumber, `${fx.seed}[${i}] 下界`).toBeGreaterThanOrEqual(LO);
        expect(out[i].noteNumber, `${fx.seed}[${i}] 上界`).toBeLessThanOrEqual(HI);
        expect(out[i].duration, `${fx.seed}[${i}] dur>0`).toBeGreaterThan(0);
        if (i > 0) expect(out[i].time, `${fx.seed}[${i}] 升序`).toBeGreaterThanOrEqual(out[i - 1].time - 1e-9);
      }
    }
  });

  it('确定性:同输入两次 realize(context-active)逐音一致', () => {
    for (const fx of withCtx.slice(0, 6)) {
      const a = realizeWith(fx, true);
      const b = realizeWith(fx, true);
      expect(a.map((e) => [e.noteNumber, e.time, e.duration]))
        .toEqual(b.map((e) => [e.noteNumber, e.time, e.duration]));
    }
  });

  it('不退化:orthogonal 候选集未把旋律塌成单一音高(音高多样性 ≥ 3)', () => {
    for (const fx of withCtx) {
      const out = realizeWith(fx, true);
      const distinctPcs = new Set(out.map((e) => ((e.noteNumber % 12) + 12) % 12));
      expect(distinctPcs.size, `${fx.seed} 音高多样性`).toBeGreaterThanOrEqual(3);
    }
  });

  it('orthogonal 链贯穿到 chooser:JAZZ/RNB 至少一 seed 的 context 落音 ≠ 无-context(chord-scale 真收窄)', () => {
    const jazzRnb = [...seedsByStyle('JAZZ'), ...seedsByStyle('RNB')];
    expect(jazzRnb.length).toBeGreaterThan(0);
    const anyDiff = jazzRnb.some((fx) => {
      const withC = realizeWith(fx, true).map((e) => e.noteNumber).join(',');
      const noC = realizeWith(fx, false).map((e) => e.noteNumber).join(',');
      return withC !== noC;
    });
    expect(anyDiff, 'JAZZ/RNB context 应至少在一个 seed 改变落音(否则 orthogonal 未生效)').toBe(true);
  });
});
