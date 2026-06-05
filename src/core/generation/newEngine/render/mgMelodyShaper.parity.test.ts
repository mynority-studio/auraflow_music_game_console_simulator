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

interface ShaperEvent { midi: number; time: number; dur: number; vel: number; part: string; origin?: string; lick?: boolean; deg?: string }
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
  ({ noteNumber: e.midi, time: e.time, duration: e.dur, velocity: e.vel, part: e.part as 'melody', origin: e.origin as MgNoteEvent['origin'], lickSource: e.lick, degree: e.deg });
const fromMg = (e: MgNoteEvent): ShaperEvent =>
  ({ midi: e.noteNumber, time: e.time, dur: e.duration, vel: e.velocity, part: e.part, origin: e.origin, lick: e.lickSource, deg: e.degree });

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

  for (const fx of fixtures) {
    it(`★ ${fx.seed} [${fx.style}] shapeMelodyHarmony 输出与 MG 精确一致`, () => {
      expect(ourShaped(fx.shaper!)).toEqual(fx.shaper!.shaperOut);
    });
  }

  it('确定性:同输入两次塑形结果一致(_strongBeats 模块态无残留)', () => {
    const fx = fixtures[0].shaper!;
    expect(ourShaped(fx)).toEqual(ourShaped(fx));
  });
});
