import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderMgMelody } from './mgLeadRenderer';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { createTimebase, createRandomContext, beats } from '../foundation';

// ============================================================
// Loop 1(strict parity):MG seed = song seed 直通,不经 RandomContext.substream('melody') 派生。
// ============================================================
const SRC = readFileSync(fileURLToPath(new URL('./mgLeadRenderer.ts', import.meta.url)), 'utf8');

describe('render/mgSeedDirect · MG seed 直通', () => {
  it('lead 生产链不出现 substream(melody) / rng.int 派生 MG seed', () => {
    expect(SRC.includes("substream('melody')")).toBe(false);
    expect(SRC.includes('rng.int(')).toBe(false);
    expect(SRC.includes('makeSeededRng(songSeed)')).toBe(true);
  });

  it('renderMgMelody 收 song seed(number);同 seed → 同 lead(确定性)', () => {
    const lead = (seed: number) => {
      const band = buildBandSpec({ seed, styleHint: 'pop', mood: 'build', targetDuration: 120 });
      const arr = buildArrangementPlan(band, { rng: createRandomContext(seed) });
      const plan = buildHarmonicPlanFromArrangement(band, arr, createRandomContext(seed));
      const tb = createTimebase({ meter: { numerator: arr.meter.numerator, denominator: arr.meter.denominator }, tempoMap: [{ atBeat: beats(0), bpm: arr.tempoBpm }] });
      return renderMgMelody(plan, band, tb, seed).notes.map((n) => `${n.pitch}@${n.startTick}:${n.durationTicks}:${n.velocity}`).join('|');
    };
    expect(lead(42)).toBe(lead(42));        // 确定性
    expect(lead(42)).not.toBe(lead(43));    // 不同 seed → 不同旋律(seed 真进入 MG 链)
  });
});
