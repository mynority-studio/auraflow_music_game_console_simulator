import { describe, expect, it } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { createRandomContext } from '../foundation';
import { buildSongBundle } from '../generation/GenerationController';
import { buildArrangementPlan } from './arranger';
import { beatsPerBarOf } from './phraseTiming';

const SEED = 7;
const DURATIONS = [30, 90, 180] as const;

function actualSeconds(arrangement: ReturnType<typeof buildArrangementPlan>): number {
  const bars = arrangement.sections.reduce((sum, section) => sum + section.bars, 0);
  return bars * beatsPerBarOf(arrangement.meter) * 60 / arrangement.tempoBpm;
}

function signature(arrangement: ReturnType<typeof buildArrangementPlan>): string {
  return arrangement.sections.map((section) => `${section.id}:${section.bars}`).join('|');
}

describe('arranger/targetDuration', () => {
  it('GenerationRequest 的 30/90/180 秒进入 bundle，同 seed 产出不同长度曲式', () => {
    const arrangements = DURATIONS.map((targetDuration) => buildSongBundle({
      seed: SEED,
      styleHint: 'pop',
      mood: 'build',
      targetDuration,
    }).arrangement);

    expect(new Set(arrangements.map(signature)).size).toBe(DURATIONS.length);
    expect(arrangements.map(actualSeconds)).toEqual([...arrangements.map(actualSeconds)].sort((a, b) => a - b));
  });

  it('五种生产风格均在一个 4-bar 乐句的量化误差内贴近请求时长', () => {
    for (const styleHint of ['pop', 'rnb', 'lofi', 'jazz', 'acg']) {
      const signatures = new Set<string>();
      for (const targetDuration of DURATIONS) {
        const band = buildBandSpec({ seed: SEED, styleHint, mood: 'build', targetDuration });
        const arrangement = buildArrangementPlan(band, {
          rng: createRandomContext(SEED),
          mood: 'build',
          targetDuration,
        });
        const phraseQuantumSeconds = 4 * beatsPerBarOf(arrangement.meter) * 60 / arrangement.tempoBpm;
        expect(Math.abs(actualSeconds(arrangement) - targetDuration), `${styleHint}/${targetDuration}s`).toBeLessThanOrEqual(phraseQuantumSeconds);
        for (const section of arrangement.sections) expect(section.bars % 4, `${styleHint}/${section.id}`).toBe(0);
        signatures.add(signature(arrangement));
      }
      expect(signatures.size, styleHint).toBe(DURATIONS.length);
    }
  });

  it('ACG 随时长缩放仍保持 A/A′/return 等长和 4/8-bar 句法', () => {
    for (const targetDuration of DURATIONS) {
      const band = buildBandSpec({ seed: SEED, styleHint: 'acg', mood: 'build', targetDuration });
      const arrangement = buildArrangementPlan(band, {
        rng: createRandomContext(SEED),
        mood: 'build',
        targetDuration,
      });
      const themes = arrangement.sections.filter((section) => section.repeatGroup === 'A');
      expect(new Set(themes.map((section) => section.bars)).size).toBe(1);
      expect(themes.every((section) => section.bars % 4 === 0)).toBe(true);
      expect(arrangement.sections.at(-1)?.harmonyRole).toBe('ending');
    }
  });
});
