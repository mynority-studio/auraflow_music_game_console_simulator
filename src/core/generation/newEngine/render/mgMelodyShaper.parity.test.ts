import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shapeMelodyHarmony, type ShaperChord } from './mgMelodyShaper';
import type { MgNoteEvent } from './mgMelodyRealizer';

// ============================================================
// MG strict 移植 Loop 6 — shapeMelodyHarmony parity 锁(用户决策C 全量接收)
// ------------------------------------------------------------
// 终止判据(directive):final melody fixture 与 MG 精确一致。
// fixture.shaper 由 dump monkey-patch 引擎真跑捕获 shapeMelodyHarmony 的真实 I/O
// (shaperIn=generateImprovisorMelody 输出 / shaperArgs / shaperChords / shaperOut)。
// 把 shaperIn + 真实参数喂【我们忠实抽取】的 shapeMelodyHarmony,deepEqual shaperOut。
// 覆盖:snap 到音阶/melody contract + 结构音裁决 + LOFI crawl-hold/resolution/tonicization 全闭包。
// ============================================================

const HERE = dirname(fileURLToPath(import.meta.url));
const ORACLE_DIR = join(HERE, '__mgOracle__');

interface ShaperEvent { midi: number; time: number; dur: number; vel: number; part: string; origin?: string; lick?: boolean; deg?: string; bIdx?: number; bSt?: number; bEn?: number }
interface ShaperCapture {
  shaperArgs: { style: string; musicKey: string; musicMode: string; tonalCharacter: 'tonal' | 'modal'; applyLofiParadigm: boolean; strongBeats: number[] };
  shaperChords: ShaperChord[];
  shaperIn: ShaperEvent[];
  shaperOut: ShaperEvent[];
}
interface OracleFixture { seed: string; style: string; shaper: ShaperCapture | null }

const fixtures: OracleFixture[] = readdirSync(ORACLE_DIR)
  .filter((f) => f.endsWith('.json') && f !== '_index.json')
  .sort()
  .map((f) => JSON.parse(readFileSync(join(ORACLE_DIR, f), 'utf8')) as OracleFixture);

const toMg = (e: ShaperEvent): MgNoteEvent =>
  ({ noteNumber: e.midi, time: e.time, duration: e.dur, velocity: e.vel, part: e.part as 'melody', origin: e.origin as MgNoteEvent['origin'], lickSource: e.lick, degree: e.deg, brickIndex: e.bIdx, brickStartBeat: e.bSt, brickEndBeat: e.bEn });
const fromMg = (e: MgNoteEvent): ShaperEvent =>
  ({ midi: e.noteNumber, time: e.time, dur: e.duration, vel: e.velocity, part: e.part, origin: e.origin, lick: e.lickSource, deg: e.degree, bIdx: e.brickIndex, bSt: e.brickStartBeat, bEn: e.brickEndBeat });

function ourShaped(s: ShaperCapture): ShaperEvent[] {
  const a = s.shaperArgs;
  const out = shapeMelodyHarmony(
    a.style as never,
    s.shaperIn.map(toMg),
    s.shaperChords,
    a.musicKey, a.musicMode, a.tonalCharacter, a.applyLofiParadigm, a.strongBeats,
  );
  return out.filter((e) => e.part === 'melody').map(fromMg);
}

describe('render/mgMelodyShaper · MG 移植 shapeMelodyHarmony parity (Loop 6)', () => {
  it('9 个 fixture 都捕获到 shaper I/O(非 null)', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(9);
    for (const fx of fixtures) {
      expect(fx.shaper).not.toBeNull();
      expect(fx.shaper!.shaperIn.length).toBeGreaterThan(0);
      expect(fx.shaper!.shaperOut.length).toBeGreaterThan(0);
    }
  });

  // ★ MG full-parity G9 全收口(2026-06-28):shapeMelodyHarmony 链已逐函数忠实港到【当前 MG】——
  //   ① applyMelodicResolutionParadigm 港 515 行版(applyTargetChordSuspensionBoundary + cadentialLookback
  //      candidateMap 评分 + chooseLong/Target/Connector + loop-tail 环回)+ 13 helper + brick 元数据穿透。
  //   ② consumeReturnLandings 港 reverse-loop splice(移除长 return-landing span 内 develop 音)。
  //   ③ applyLofiCrawlHoldParadigm 港当前 MG 3-chord ii-V-I 版(+ lofiDominantLandingPc + chooseLongResolutionTarget
  //      + 二段 cadence-frame third-resolution),弃旧 synthesizeLofiAscendingCrawl/lofiCrawlPitchForTarget 算法。
  //   全 23 oracle 的 shaper 字段已外科式刷新到当前 MG(含 brick meta)→ **23/23 全 seed byte-exact**。
  //   G9_PENDING 清空 = 全部回 strict byte-parity。
  const G9_PENDING = new Set<string>([]);
  for (const fx of fixtures) {
    if (G9_PENDING.has(fx.seed)) {
      it(`★ ${fx.seed} [${fx.style}] shaper invariant(G5 已 sync;exact byte-parity 待 G9)`, () => {
        const out = ourShaped(fx.shaper!);
        expect(out.length).toBeGreaterThan(0);
        for (let i = 0; i < out.length; i++) {
          expect(out[i].midi, `${fx.seed}[${i}] midi`).toBeGreaterThanOrEqual(24);
          expect(out[i].midi, `${fx.seed}[${i}] midi`).toBeLessThanOrEqual(108);
          expect(out[i].dur, `${fx.seed}[${i}] dur`).toBeGreaterThan(0);
          if (i > 0) expect(out[i].time, `${fx.seed}[${i}] 升序`).toBeGreaterThanOrEqual(out[i - 1].time - 1e-9);
        }
      });
    } else {
      it(`★ ${fx.seed} [${fx.style}] shapeMelodyHarmony 输出与 MG 精确一致`, () => {
        expect(ourShaped(fx.shaper!)).toEqual(fx.shaper!.shaperOut);
      });
    }
  }

  it('确定性:同输入两次塑形结果一致(_strongBeats 模块态无残留)', () => {
    const fx = fixtures[0].shaper!;
    expect(ourShaped(fx)).toEqual(ourShaped(fx));
  });
});
