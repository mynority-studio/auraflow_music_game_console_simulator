// SPDX-License-Identifier: GPL-3.0-only
// ============================================================
// export-afe-fill-materialize — POP/Rock fill 60 recipe **全量** materialize 对账靶（P2-4c 步5）
// ------------------------------------------------------------
// 步3 golden 只覆盖 fixtures 触达的少数 recipe，当时记为「[延后·可达] fill 60-recipe 全量
// materialize → 步5 独立靶」。本 exporter 兑现之：对 **15 cell × 4 orch = 60 recipe** × 6 function
// × 3 (durationBeats,intensity) 组合，直调生产 materializePopRockFill，冻结每次的
// (recipeId, rhythmClass, orchestration, hits[offset,voice,velocity])。
//
// 为何必须全量：velocity = baseVelocity × cell.accents[step] × functionContour(fn, progress) 的
// binary64 乘法链 + clamp[38,118]，每个 cell 的 accents 各异；只抽查少数 recipe 无法覆盖
// accents 表与 voiceFor/contour 的全部分支（voiceFor 的 .3/.4/.64/.84/.34/.67 六个阈值需要
// 不同 hit 数才能全部跨越）。
//
// 零触碰 src/：只调生产 exported API（materializePopRockFill / popRockFillRecipeDescriptors）。
// 运行: pnpm exec vitest run --config vitest.export.config.ts scripts/export-afe-fill-materialize.export.test.ts
// ============================================================
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import {
  POP_ROCK_FILL_ORCHESTRATIONS,
  materializePopRockFill,
  popRockFillRecipeDescriptors,
  type GrooveDrumFillFunction,
  type GrooveDrumFillOrchestration,
  type GrooveDrumFillRhythmClass,
} from '../src/core/generation/newEngine/knowledge/drumFillVocabulary';

const SCHEMA_VERSION = 'fill_materialize_v1';
const ENGINE_BASE_COMMIT = 'fb33e9eaa74cee6a1c882b3d710391e969e0462e';
const SPEC_ANCHOR = 'Newengine_Demo-v5.0';
const HERE = dirname(fileURLToPath(import.meta.url));
const EXPORTER_REL = 'scripts/export-afe-fill-materialize.export.test.ts';
const OUT_DIR = join(HERE, '..', '..', 'core', 'tests', 'golden');
const OUT = join(OUT_DIR, 'afe_fill_materialize_golden.json');

const FILL_FUNCTIONS = [
  'opening', 'continuation', 'setup', 'lift', 'climax', 'release',
] as const satisfies readonly GrooveDrumFillFunction[];
const RHYTHM_CLASSES = [
  'straight-sixteenth', 'broken-sixteenth', 'syncopated-sixteenth',
] as const satisfies readonly GrooveDrumFillRhythmClass[];
const FN_IDX: Record<string, number> = {
  opening: 0, continuation: 1, setup: 2, lift: 3, climax: 4, release: 5,
};
const RC_IDX: Record<string, number> = {
  'straight-sixteenth': 0, 'broken-sixteenth': 1, 'syncopated-sixteenth': 2,
};
const ORCH_IDX: Record<string, number> = {
  snare: 0, 'snare-tom-cascade': 1, 'descending-toms': 2, 'linear-hand-foot': 3,
};
const VOICE_IDX: Record<string, number> = {
  kick: 0, snare: 1, 'tom-high': 2, 'tom-mid': 3, 'tom-low': 4,
};

/** (step-8)*0.25 → 精确 rational（1/4 网格；约分、den>0、负号仅 num）。 */
function offsetRational(x: number): { num: number; den: number } {
  const n4 = x * 4;
  if (!Number.isInteger(n4)) throw new Error(`offset ${x} 不在 1/4 网格（fail-closed）`);
  const gcd = (a: number, b: number): number => { a = Math.abs(a); b = Math.abs(b); while (b) { const t = a % b; a = b; b = t; } return a || 1; };
  const g = gcd(n4, 4);
  const r = { num: n4 / g, den: 4 / g };
  if (r.num / r.den !== x) throw new Error(`rational ${r.num}/${r.den} ≠ ${x}`);
  return r;
}

describe('export afe fill materialize golden（P2-4c 步5：60 recipe 全量）', () => {
  it('freezes every recipe × function × (duration,intensity) combination', () => {
    mkdirSync(OUT_DIR, { recursive: true });
    const exporterSha = createHash('sha256')
      .update(readFileSync(join(HERE, 'export-afe-fill-materialize.export.test.ts'))).digest('hex');

    const descriptors = popRockFillRecipeDescriptors();
    expect(descriptors.length, '60 recipe').toBe(60);
    // (durationBeats, intensity)：覆盖 slotCount 的 8/4/2 三档（planner transition 的实际取值域）
    const shapes = [
      { durationBeats: 2, intensity: 3 as const },
      { durationBeats: 1, intensity: 2 as const },
      { durationBeats: 0.5, intensity: 1 as const },
    ];

    const cases: unknown[] = [];
    const voicesSeen = new Set<number>();
    const velSeen = new Set<number>();
    let clampLow = 0, clampHigh = 0;
    for (const cls of RHYTHM_CLASSES) {
      // 该 class 内的 cell 数（materializePopRockFill 用 variant % cells.length 选 cell）
      const nCells = descriptors.filter((d) => d.rhythmClass === cls).length / POP_ROCK_FILL_ORCHESTRATIONS.length;
      expect(nCells, `${cls} cell 数`).toBe(5);
      for (let variant = 0; variant < nCells; variant++) {
        for (const orch of POP_ROCK_FILL_ORCHESTRATIONS) {
          for (const fn of FILL_FUNCTIONS) {
            for (const shape of shapes) {
              const got = materializePopRockFill({
                rhythmClass: cls, orchestration: orch as GrooveDrumFillOrchestration,
                function: fn, variant, ...shape,
              });
              for (const h of got.hits) {
                voicesSeen.add(VOICE_IDX[h.voice]);
                velSeen.add(h.velocity);
                if (h.velocity === 38) clampLow++;
                if (h.velocity === 118) clampHigh++;
              }
              cases.push({
                rhythmClass: RC_IDX[cls], orchestration: ORCH_IDX[orch], variant,
                fn: FN_IDX[fn], durationBeats: offsetRational(shape.durationBeats),
                intensity: shape.intensity,
                recipeId: got.recipeId,
                gotRhythmClass: RC_IDX[got.rhythmClass], gotOrchestration: ORCH_IDX[got.orchestration],
                hits: got.hits.map((h) => ({
                  offset: offsetRational(h.offsetBeatsFromEnd),
                  voice: VOICE_IDX[h.voice], velocity: h.velocity,
                })),
              });
            }
          }
        }
      }
    }
    // 覆盖自检：60 recipe 全触达、5 个 voice 全出现、velocity 值域在 clamp 内
    expect(cases.length, '3 class × 5 cell × 4 orch × 6 fn × 3 shape').toBe(3 * 5 * 4 * 6 * 3);
    expect(new Set(cases.map((c) => (c as { recipeId: string }).recipeId)).size, '60 distinct recipe').toBe(60);
    expect(voicesSeen, '5 个 voice 全覆盖').toEqual(new Set([0, 1, 2, 3, 4]));
    expect(Math.min(...velSeen) >= 38 && Math.max(...velSeen) <= 118, 'velocity ∈ [38,118]').toBe(true);

    const out = {
      meta: {
        layer: 'pop-rock-60-v1 fill materialize (全量)',
        schemaVersion: SCHEMA_VERSION, generator: EXPORTER_REL, exporterSha,
        engineBaseCommit: ENGINE_BASE_COMMIT, specAnchor: SPEC_ANCHOR,
        note: '兑现步3 记的「[延后·可达] fill 60-recipe 全量 materialize → 步5 独立靶」。'
          + '组合 = 3 rhythm class × 5 cell(variant) × 4 orch × 6 function × 3 (durationBeats,intensity)。'
          + 'velocity 为 binary64 乘法链 + clamp[38,118] 的产物；offset 为 1/4 网格精确 rational。',
        clampObserved: { atLow38: clampLow, atHigh118: clampHigh },
        velocityDistinct: velSeen.size,
      },
      cases,
    };
    writeFileSync(OUT, JSON.stringify(out, null, 1));
    expect(readFileSync(OUT, 'utf-8').length).toBeGreaterThan(0);
  });
});
