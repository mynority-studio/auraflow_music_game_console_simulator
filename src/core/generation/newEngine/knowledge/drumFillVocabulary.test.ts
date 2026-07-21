import { describe, expect, it } from 'vitest';
import {
  materializePopRockFill,
  materializeFunctionalPopRockFill,
  POP_ROCK_FILL_ORCHESTRATIONS,
  popRockFillCombinationsForFunction,
  popRockFillRecipeDescriptors,
  type GrooveDrumFillRhythmClass,
} from './drumFillVocabulary';

const rhythmClasses: readonly GrooveDrumFillRhythmClass[] = [
  'straight-sixteenth',
  'broken-sixteenth',
  'syncopated-sixteenth',
];

describe('POP/Rock drum fill vocabulary', () => {
  it('models the 60-fill space as 15 rhythm cells x four kit orchestrations', () => {
    const recipes = popRockFillRecipeDescriptors();
    expect(recipes).toHaveLength(60);
    expect(new Set(recipes.map((recipe) => recipe.recipeId)).size).toBe(60);
    for (const rhythmClass of rhythmClasses) {
      expect(recipes.filter((recipe) => recipe.rhythmClass === rhythmClass)).toHaveLength(20);
    }
    for (const orchestration of POP_ROCK_FILL_ORCHESTRATIONS) {
      expect(recipes.filter((recipe) => recipe.orchestration === orchestration)).toHaveLength(15);
    }
  });

  it('makes all 60 KB recipes reachable through function-constrained production selection', () => {
    const reached = new Set<string>();
    for (const fn of ['setup', 'continuation'] as const) {
      const candidateCount = popRockFillCombinationsForFunction(fn).length;
      for (let variant = 0; variant < candidateCount * 5; variant++) {
        reached.add(materializeFunctionalPopRockFill({
          function: fn,
          variant,
          durationBeats: 2,
          intensity: 2,
        }).recipeId);
      }
    }
    expect(reached).toEqual(new Set(popRockFillRecipeDescriptors().map((recipe) => recipe.recipeId)));
  });

  it('materializes playable, bounded semantic hits for every recipe', () => {
    for (const rhythmClass of rhythmClasses) {
      for (let variant = 0; variant < 5; variant++) {
        for (const orchestration of POP_ROCK_FILL_ORCHESTRATIONS) {
          const score = materializePopRockFill({
            rhythmClass,
            orchestration,
            function: rhythmClass === 'syncopated-sixteenth' ? 'climax' : 'lift',
            variant,
            durationBeats: 2,
            intensity: 3,
          });
          expect(score.hits.length).toBeGreaterThan(1);
          expect(new Set(score.hits.map((hit) => hit.offsetBeatsFromEnd)).size).toBe(score.hits.length);
          expect(score.hits.every((hit) => hit.offsetBeatsFromEnd >= -2 && hit.offsetBeatsFromEnd < 0)).toBe(true);
          expect(score.hits.every((hit) => hit.velocity >= 38 && hit.velocity <= 118)).toBe(true);
          expect(score.hits.at(-1)?.voice).not.toBe('kick');
        }
      }
    }
  });

  it('keeps light fills short while a climax hand-foot recipe uses kick and the tom range', () => {
    const light = materializePopRockFill({
      rhythmClass: 'broken-sixteenth',
      orchestration: 'snare',
      function: 'continuation',
      variant: 2,
      durationBeats: 1,
      intensity: 1,
    });
    const climax = materializePopRockFill({
      rhythmClass: 'syncopated-sixteenth',
      orchestration: 'linear-hand-foot',
      function: 'climax',
      variant: 2,
      durationBeats: 2,
      intensity: 3,
    });

    expect(light.hits.every((hit) => hit.offsetBeatsFromEnd >= -1)).toBe(true);
    expect(climax.hits.some((hit) => hit.voice === 'kick')).toBe(true);
    expect(climax.hits.some((hit) => hit.voice.startsWith('tom-'))).toBe(true);
    expect(climax.hits.at(-1)!.velocity).toBeGreaterThan(climax.hits[0].velocity);
  });
});
