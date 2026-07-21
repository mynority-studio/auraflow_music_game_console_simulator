import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  JAZZ_FIVE_FOUR_DRUM_PHRASE_PATTERNS,
  JAZZ_FIVE_FOUR_PHRASE_DRUM_INTENTS,
  jazzFiveFourDrumPhraseEventSignature,
  jazzFiveFourDrumPhrasePattern,
} from './jazzFiveFourDrumPhraseKnowledge';
import { JAZZ_FIVE_FOUR_CORE_KEEP_TIME, jazzFiveFourDrumPhaseTicks } from './jazzFiveFourDrumKnowledge';

describe('knowledge/jazzFiveFourDrumPhraseKnowledge', () => {
  it('keeps canonical core phase/pitch/velocity/gate identity', () => {
    const pattern = jazzFiveFourDrumPhrasePattern('coreKeepTime');
    expect(pattern.hits).toHaveLength(12);
    expect(new Set(pattern.hits.map((hit) => hit.phaseTick)).size).toBe(10);
    expect(jazzFiveFourDrumPhraseEventSignature(pattern)).toEqual(
      JAZZ_FIVE_FOUR_CORE_KEEP_TIME.hits.map((hit) => {
        const pitches = { 'acoustic-kick-anchor': 35, 'acoustic-snare-center': 40, 'acoustic-ride-bow': 51 } as const;
        return `0|${jazzFiveFourDrumPhaseTicks(hit.phaseBeats)}|${pitches[hit.kitIntentId]}|${hit.velocity}|10`;
      }),
    );
  });

  it('freezes the three-beat crescendo and downbeat bomb as whole patterns', () => {
    const crescendo = jazzFiveFourDrumPhrasePattern('snareCrescendo3Beat');
    expect(crescendo.hits.map((hit) => hit.phaseTick))
      .toEqual([0, 120, 240, 360, 480, 600, 720, 840, 960]);
    expect(crescendo.hits.map((hit) => hit.velocity))
      .toEqual([41, 41, 51, 51, 63, 85, 95, 105, 115]);
    expect(crescendo.hits.every((hit) => hit.kitIntentId === 'snare-center')).toBe(true);

    expect(jazzFiveFourDrumPhraseEventSignature(jazzFiveFourDrumPhrasePattern('downbeatBomb')))
      .toEqual(['0|0|35|108|10', '0|0|43|127|10']);
  });

  it('preserves the two-bar roll/bomb and tom-ostinato identities', () => {
    const rollBomb = jazzFiveFourDrumPhrasePattern('rollBombCallResponse2Bar');
    expect(rollBomb.spanBars).toBe(2);
    expect(rollBomb.hits.filter((hit) => hit.barOffset === 0)).toHaveLength(11);
    expect(rollBomb.hits.filter((hit) => hit.barOffset === 1)).toHaveLength(2);
    expect(jazzFiveFourDrumPhraseEventSignature(rollBomb).slice(-4)).toEqual([
      '0|1760|35|114|10', '0|1760|41|127|10', '1|800|35|108|10', '1|800|41|120|10',
    ]);

    expect(jazzFiveFourDrumPhraseEventSignature(jazzFiveFourDrumPhrasePattern('tomOstinato2Bar')))
      .toEqual([
        '0|55|43|120|10', '0|160|41|66|10', '0|475|45|127|10',
        '0|720|43|114|10', '0|850|41|68|10', '0|1145|45|127|10',
        '1|780|43|85|10', '1|1260|45|67|10', '1|1440|45|58|10',
        '1|1740|41|66|10', '1|1920|43|80|10', '1|2220|41|80|10',
      ]);
  });

  it('owns return and late-ending cues rather than leaking them into core', () => {
    expect(jazzFiveFourDrumPhraseEventSignature(jazzFiveFourDrumPhrasePattern('returnFill')))
      .toEqual([
        '0|0|35|79|10', '0|0|43|85|10', '0|780|40|57|10',
        '0|960|40|83|10', '0|1440|43|85|10', '0|1920|43|85|10',
      ]);
    expect(jazzFiveFourDrumPhraseEventSignature(jazzFiveFourDrumPhrasePattern('lateEndingHit')))
      .toEqual(['0|40|35|103|10', '0|40|59|90|10']);
    expect(jazzFiveFourDrumPhrasePattern('coreKeepTime').kitIntentAllowlist)
      .toEqual(['kick-anchor', 'ride-bow', 'snare-center']);
    expect(jazzFiveFourDrumPhrasePattern('coreKeepTime').kitIntentAllowlist)
      .not.toContain('ending-ride-edge');
  });

  it('uses only the approved core/fill/ending kit vocabulary', () => {
    const allPitches = new Set(Object.values(JAZZ_FIVE_FOUR_PHRASE_DRUM_INTENTS)
      .map((intent) => intent.preferredGmPitch));
    expect([...allPitches].sort((a, b) => a - b)).toEqual([35, 40, 41, 43, 45, 47, 48, 51, 59]);
    expect(allPitches.has(33 as never)).toBe(false);
    expect(allPitches.has(44 as never)).toBe(false);
    for (const pattern of JAZZ_FIVE_FOUR_DRUM_PHRASE_PATTERNS) {
      expect(pattern.hits.every((hit) => hit.gateTicks === 10), pattern.id).toBe(true);
      expect(pattern.hits.every((hit) => hit.phaseTick >= 0 && hit.phaseTick < 2_400), pattern.id).toBe(true);
      expect(pattern.mutationBudget.mayDropIndividualHits, pattern.id).toBe(false);
      expect(pattern.mutationBudget.timingResidualMaxTicks, pattern.id).toBe(0);
      expect(pattern.requiredAnchorHitIds.every((id) => pattern.hits.some((hit) => hit.id === id)), pattern.id).toBe(true);
    }
  });

  it('keeps phrase KB independent from attachment/runtime evidence reads', () => {
    const source = readFileSync(new URL('./jazzFiveFourDrumPhraseKnowledge.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from\s+['"][^'"]*jazzFiveFourEvidence['"]/);
    expect(source).not.toMatch(/readFileSync|\.codex\/attachments/);
    expect(JAZZ_FIVE_FOUR_DRUM_PHRASE_PATTERNS.filter((pattern) => pattern.referenceCanonical))
      .toHaveLength(1);
  });
});
