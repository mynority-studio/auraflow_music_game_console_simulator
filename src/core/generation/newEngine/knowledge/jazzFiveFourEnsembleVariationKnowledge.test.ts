import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  JAZZ_FIVE_FOUR_ACOUSTIC_BASS_CELLS,
  JAZZ_FIVE_FOUR_UPPER_COMP_CELLS,
} from './jazzFiveFourRoleKnowledge';
import { JAZZ_FIVE_FOUR_CORE_KEEP_TIME, jazzFiveFourDrumPhaseTicks } from './jazzFiveFourDrumKnowledge';
import {
  JAZZ_FIVE_FOUR_ENSEMBLE_VARIATION_KB,
  jazzFiveFourVariantAttackTicks,
  jazzFiveFourVariantMasksAreIndependent,
  selectJazzFiveFourEnsembleVariants,
  type JazzFiveFourVariantSelectionContext,
} from './jazzFiveFourEnsembleVariationKnowledge';

const context = (seed: number, overrides: Partial<JazzFiveFourVariantSelectionContext> = {}): JazzFiveFourVariantSelectionContext => ({
  seed,
  sectionId: 'headB',
  phraseOrdinal: 1,
  barInPhrase: 3,
  phraseFunction: 'head-b',
  phrasePosition: 'answer',
  intensity: 0.72,
  mode: 'generative',
  ...overrides,
});

describe('knowledge/jazzFiveFourEnsembleVariationKnowledge', () => {
  it('keeps the canonical Gate-G identity exact', () => {
    const selected = selectJazzFiveFourEnsembleVariants(context(77, { mode: 'canonical-reference' }));
    expect(jazzFiveFourVariantAttackTicks(selected.bass)).toEqual(
      [...new Set(JAZZ_FIVE_FOUR_ACOUSTIC_BASS_CELLS.map((cell) => cell.phase.engineTicks))],
    );
    expect(jazzFiveFourVariantAttackTicks(selected.comp)).toEqual(
      [...new Set(JAZZ_FIVE_FOUR_UPPER_COMP_CELLS.map((cell) => cell.phase.engineTicks))],
    );
    expect(jazzFiveFourVariantAttackTicks(selected.drum)).toEqual(
      [...new Set(JAZZ_FIVE_FOUR_CORE_KEEP_TIME.hits.map((hit) => jazzFiveFourDrumPhaseTicks(hit.phaseBeats)))],
    );
    expect(selected.bass.budget.timingResidualMaxTicks).toBe(0);
    expect(selected.comp.budget.timingResidualMaxTicks).toBe(0);
    expect(selected.drum.budget.timingResidualMaxTicks).toBe(0);
  });

  it('offers at least three complete, bounded variants per role', () => {
    for (const [role, variants] of Object.entries(JAZZ_FIVE_FOUR_ENSEMBLE_VARIATION_KB.variantsByRole)) {
      expect(variants.length, role).toBeGreaterThanOrEqual(3);
      expect(variants.filter((value) => value.referenceCanonical), role).toHaveLength(1);
      for (const value of variants) {
        const ticks = jazzFiveFourVariantAttackTicks(value);
        expect(ticks.length, value.id).toBeGreaterThan(0);
        expect(new Set(ticks).size, value.id).toBe(ticks.length);
        expect(ticks.every((tick) => Number.isInteger(tick) && tick >= 0 && tick < 2_400), value.id).toBe(true);
        expect(['whole-cell', 'whole-bar', 'whole-phrase']).toContain(value.mutationUnit);
      }
    }
  });

  it('selects only complete role variants and avoids homorhythmic role masks', () => {
    for (let seed = 0; seed < 128; seed += 1) {
      const selected = selectJazzFiveFourEnsembleVariants(context(seed));
      expect(jazzFiveFourVariantMasksAreIndependent(selected), `seed ${seed}`).toBe(true);
      expect(selected.bass.role).toBe('bass');
      expect(selected.comp.role).toBe('comp');
      expect(selected.drum.role).toBe('drum');
    }
  });

  it('is bit-stable for one seed and phrase context, while seeds select a vocabulary', () => {
    const once = selectJazzFiveFourEnsembleVariants(context(1662));
    const twice = selectJazzFiveFourEnsembleVariants(context(1662));
    expect(twice).toEqual(once);
    const signatures = new Set(
      Array.from({ length: 64 }, (_, seed) => selectJazzFiveFourEnsembleVariants(context(seed)))
        .map((selected) => `${selected.bass.id}|${selected.comp.id}|${selected.drum.id}`),
    );
    expect(signatures.size).toBeGreaterThanOrEqual(4);
  });

  it('keeps product schema pitchless, bar-local and independent from the evidence fixture', () => {
    const serialized = JSON.stringify(JAZZ_FIVE_FOUR_ENSEMBLE_VARIATION_KB);
    expect(serialized).not.toMatch(/"(?:pitch|midi|degree|interval|absoluteBar|sourceOriginTick)"/i);
    const source = readFileSync(new URL('./jazzFiveFourEnsembleVariationKnowledge.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from\s+['"][^'"]*jazzFiveFourEvidence['"]/);
    expect(source).not.toContain('Take-Five-1.mid');
    expect(source).not.toMatch(/Math\.random|Bernoulli/i);
  });

  it('uses phrase context for sparse answers, breakdowns and endings', () => {
    const answerIds = new Set(Array.from({ length: 64 }, (_, seed) => {
      const chosen = selectJazzFiveFourEnsembleVariants(context(seed));
      return `${chosen.bass.id}|${chosen.comp.id}|${chosen.drum.id}`;
    }));
    expect([...answerIds].some((id) => id.includes('release-beat-five'))).toBe(true);
    expect([...answerIds].some((id) => id.includes('bridge-air'))).toBe(true);
    expect([...answerIds].some((id) => id.includes('dialogue-answer'))).toBe(true);

    const endingIds = new Set(Array.from({ length: 64 }, (_, seed) => {
      const chosen = selectJazzFiveFourEnsembleVariants(context(seed, {
        phraseFunction: 'coda', phrasePosition: 'ending', intensity: 0.8,
      }));
      return `${chosen.bass.id}|${chosen.comp.id}|${chosen.drum.id}`;
    }));
    expect([...endingIds].some((id) => id.includes('octave-lift-ending'))).toBe(true);
    expect([...endingIds].some((id) => id.includes('turnaround-release'))).toBe(true);
  });
});
