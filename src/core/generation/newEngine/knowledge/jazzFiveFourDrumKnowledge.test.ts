import { describe, expect, it } from 'vitest';
import {
  JAZZ_FIVE_FOUR_CORE_KEEP_TIME,
  JAZZ_FIVE_FOUR_CORE_KEEP_TIME_ID,
  JAZZ_FIVE_FOUR_DRUM_BAR_TICKS,
  JAZZ_FIVE_FOUR_DRUM_ENGINE_PPQ,
  jazzFiveFourDrumKitIntent,
  jazzFiveFourDrumPattern,
  jazzFiveFourDrumPhaseTicks,
} from './jazzFiveFourDrumKnowledge';

const resolvedCore = () => JAZZ_FIVE_FOUR_CORE_KEEP_TIME.hits.map((hit) => ({
  phase: jazzFiveFourDrumPhaseTicks(hit.phaseBeats),
  pitch: jazzFiveFourDrumKitIntent(hit.kitIntentId).preferredGmPitch,
  velocity: hit.velocity,
  referenceTicks: hit.gate.referenceTicks,
  generativeDefaultTicks: hit.gate.generative.defaultTicks,
}));

describe('Jazz 5/4 source-derived drum knowledge', () => {
  it('owns the exact PPQ480 5/4 clock and exposes a pure archetype-free accessor', () => {
    expect(JAZZ_FIVE_FOUR_DRUM_ENGINE_PPQ).toBe(480);
    expect(JAZZ_FIVE_FOUR_DRUM_BAR_TICKS).toBe(2_400);
    expect(JAZZ_FIVE_FOUR_CORE_KEEP_TIME.meter).toEqual({
      numerator: 5,
      denominator: 4,
      beatGrouping: [3, 2],
    });
    expect(JAZZ_FIVE_FOUR_CORE_KEEP_TIME.authoredAtPpq).toBe(480);
    expect(JAZZ_FIVE_FOUR_CORE_KEEP_TIME.barTicks).toBe(2_400);
    expect(jazzFiveFourDrumPattern(JAZZ_FIVE_FOUR_CORE_KEEP_TIME_ID))
      .toBe(JAZZ_FIVE_FOUR_CORE_KEEP_TIME);
    expect(jazzFiveFourDrumPattern('unknown')).toBeUndefined();
  });

  it('preserves all 12 canonical hits and their exact phase, pitch intent and velocity', () => {
    expect(resolvedCore()).toEqual([
      { phase: 0, pitch: 35, velocity: 94, referenceTicks: 10, generativeDefaultTicks: 10 },
      { phase: 0, pitch: 51, velocity: 92, referenceTicks: 10, generativeDefaultTicks: 10 },
      { phase: 480, pitch: 51, velocity: 92, referenceTicks: 10, generativeDefaultTicks: 10 },
      { phase: 800, pitch: 40, velocity: 67, referenceTicks: 10, generativeDefaultTicks: 10 },
      { phase: 960, pitch: 51, velocity: 92, referenceTicks: 10, generativeDefaultTicks: 10 },
      { phase: 1_280, pitch: 51, velocity: 77, referenceTicks: 10, generativeDefaultTicks: 10 },
      { phase: 1_440, pitch: 51, velocity: 88, referenceTicks: 10, generativeDefaultTicks: 10 },
      { phase: 1_440, pitch: 40, velocity: 67, referenceTicks: 10, generativeDefaultTicks: 10 },
      { phase: 1_760, pitch: 51, velocity: 69, referenceTicks: 10, generativeDefaultTicks: 10 },
      { phase: 1_920, pitch: 51, velocity: 105, referenceTicks: 10, generativeDefaultTicks: 10 },
      { phase: 2_080, pitch: 40, velocity: 33, referenceTicks: 10, generativeDefaultTicks: 10 },
      { phase: 2_240, pitch: 40, velocity: 63, referenceTicks: 10, generativeDefaultTicks: 10 },
    ]);
    expect(new Set(resolvedCore().map((hit) => hit.phase)).size).toBe(10);
  });

  it('keeps reference gates immutable while requiring explicit kit ownership for generative overrides', () => {
    expect(JAZZ_FIVE_FOUR_CORE_KEEP_TIME.eligibility).toEqual({ reference: true, generative: true });
    expect(JAZZ_FIVE_FOUR_CORE_KEEP_TIME.mutationUnit).toBe('whole-pattern');
    for (const hit of JAZZ_FIVE_FOUR_CORE_KEEP_TIME.hits) {
      expect(hit.gate).toEqual({
        referenceTicks: 10,
        generative: {
          defaultTicks: 10,
          owner: 'kit-realization',
          overridePolicy: 'explicit-kit-class-profile-only',
        },
      });
    }
  });

  it('resolves only the core kit allowlist and contains exactly one ghost snare', () => {
    expect(JAZZ_FIVE_FOUR_CORE_KEEP_TIME.gmPitchAllowlist).toEqual([35, 40, 51]);
    const resolvedPitches = resolvedCore().map((hit) => hit.pitch);
    expect(new Set(resolvedPitches)).toEqual(new Set([35, 40, 51]));
    expect(resolvedPitches.every((pitch) =>
      JAZZ_FIVE_FOUR_CORE_KEEP_TIME.gmPitchAllowlist.includes(pitch))).toBe(true);

    const ghostSnares = JAZZ_FIVE_FOUR_CORE_KEEP_TIME.hits.filter((hit) => hit.hitIntent === 'dialogue-ghost');
    expect(ghostSnares).toHaveLength(1);
    expect(jazzFiveFourDrumPhaseTicks(ghostSnares[0].phaseBeats)).toBe(2_080);
    expect(ghostSnares[0].velocity).toBe(33);
    expect(jazzFiveFourDrumKitIntent(ghostSnares[0].kitIntentId).preferredGmPitch).toBe(40);
  });

  it('refuses a lossy phase projection instead of silently moving an authored hit', () => {
    expect(() => jazzFiveFourDrumPhaseTicks({ numerator: 1, denominator: 3 }, 100)).toThrow(
      'is not exact at PPQ 100',
    );
  });
});
