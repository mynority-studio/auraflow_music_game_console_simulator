import { describe, expect, it } from 'vitest';
import { makeGrammar, type AbstractMelodyToken } from '../knowledge/melodyGrammarTypes';
import {
  buildGrammarRhythmShapeProfile,
  buildMelodyRhythmShapeProfile,
  expandGrammarForBrickMatchingRhythm,
  melodyRhythmShapeSimilarity,
} from './mgRhythmShapeMatcher';
import type { BrickMatch } from './mgRoadMapParser';

const brick: BrickMatch = {
  name: 'Major-On',
  family: 'Major-On',
  startBeat: 0,
  durationBeats: 4,
  chordIndices: [0],
  cost: 0,
};

const sounding = (durations: readonly number[]): AbstractMelodyToken[] =>
  durations.map((duration) => ({ kind: 'C', duration }));

describe('render/mgRhythmShapeMatcher', () => {
  it('从同一 brick grammar 候选池选择和用户速度/长短形状更接近的一句', () => {
    const target = buildMelodyRhythmShapeProfile(
      Array.from({ length: 8 }, (_, index) => ({ onsetBeat: index * 0.5, durationBeat: 0.35 })),
      0,
      4,
    );
    const slow = sounding([1, 1, 1, 1]);
    const close = sounding([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    const grammar = makeGrammar([
      { lhs: 'Phrase', weight: 1, rhs: slow },
      { lhs: 'Phrase', weight: 1, rhs: close },
    ], 'Phrase');
    const draws = [0.1, 0.9];
    let draw = 0;
    const selected = expandGrammarForBrickMatchingRhythm({
      grammar,
      brick,
      target,
      attempts: 2,
      rng: () => draws[draw++] ?? 0.1,
    });

    const slowSimilarity = melodyRhythmShapeSimilarity(target, buildGrammarRhythmShapeProfile(slow, 4));
    expect(selected.tokens).toEqual(close);
    expect(selected.similarity).toBeGreaterThan(slowSimilarity);
  });
});
