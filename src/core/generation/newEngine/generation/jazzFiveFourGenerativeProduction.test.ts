import { describe, expect, it } from 'vitest';
import { JAZZ_4_4_ARCHETYPE_ID, JAZZ_5_4_ARCHETYPE_ID } from '../arranger/jazzArchetypePlanner';
import { validateJazzFiveFourScorePlan } from '../arranger/jazzFiveFourScorePlan';
import { pc } from '../foundation';
import { auditJazzFiveFourLead } from './jazzFiveFourLeadAuditor';
import { assertJazzFiveFourGrooveMatch } from '../render/jazzFiveFourGrooveMatcher';
import {
  jazzFiveFourScoreEventSignature,
  jazzFiveFourTrackEventSignature,
} from '../render/jazzFiveFourScoreProjector';
import { buildSongBundle, generateSongFromBundle } from './GenerationController';

function product(seed: number) {
  return buildSongBundle({
    seed,
    styleHint: 'jazz',
    mood: 'modern cool 5/4 generative production',
    targetDuration: 60,
    key: pc(4),
    mode: 'minor',
    jazzArchetypeId: JAZZ_5_4_ARCHETYPE_ID,
  });
}

describe('Jazz 5/4 generative product · Arranger -> ScoreCompiler -> Renderer', () => {
  it('compiles the explicit Bass-to-Comp handoff with full score provenance', () => {
    const built = product(1662);
    const score = built.jazzFiveFourScorePlan!;
    expect(score).toBeDefined();
    expect(score.compilationMode).toBe('generative');
    expect(score.foundationMode).toBe('arranger-per-bar');
    expect(score.clock).toMatchObject({ totalBars: 33, ticksPerBar: 2_400, grouping: [3, 2] });
    expect(validateJazzFiveFourScorePlan(score)).toEqual([]);

    const bassBars = score.roleBars.filter((bar) => bar.role === 'bass');
    const compBars = score.roleBars.filter((bar) => bar.role === 'comp');
    expect(bassBars.filter((bar) => bar.active).map((bar) => bar.absoluteBar))
      .toEqual(Array.from({ length: 9 }, (_, index) => index));
    expect(compBars.filter((bar) => bar.active).map((bar) => bar.absoluteBar))
      .toEqual(Array.from({ length: 24 }, (_, index) => index + 9));

    for (const event of score.instrumentEvents) {
      expect(event.nominalTick).toBe(event.absoluteBar * 2_400 + event.phaseTick);
      const provenance = score.provenanceByEventId[event.eventId]!;
      if (event.role === 'lead') {
        expect(provenance).toMatchObject({ authority: 'arranger-grammar-score' });
        expect(provenance.grammarTokenId).toBeTruthy();
      } else {
        expect(provenance.ensembleDirectiveId).toBeTruthy();
        expect(provenance.phraseId).toBeTruthy();
        expect(provenance.foundationMode).toBeTruthy();
        expect(provenance.interactionCueId).toBeTruthy();
      }
    }

    const broken = JSON.parse(JSON.stringify(score));
    const bassEvent = broken.instrumentEvents.find((event: { role: string }) => event.role === 'bass');
    delete broken.provenanceByEventId[bassEvent.eventId].ensembleDirectiveId;
    expect(validateJazzFiveFourScorePlan(broken)).toContainEqual(expect.objectContaining({
      code: 'provenance',
      path: `provenanceByEventId.${bassEvent.eventId}`,
    }));
  });

  it('projects the performed total score bit-identically and passes production Groove/Lead gates', () => {
    const built = product(1662);
    const score = built.jazzFiveFourScorePlan!;
    const generated = generateSongFromBundle(built);
    expect(generated.ir, JSON.stringify(generated.report.findings, null, 2)).toBeDefined();
    expect(jazzFiveFourTrackEventSignature(generated.ir!.tracks))
      .toEqual(jazzFiveFourScoreEventSignature(score));
    expect(assertJazzFiveFourGrooveMatch(score, generated.ir!).pass).toBe(true);

    const lead = auditJazzFiveFourLead({
      score,
      arrangement: built.arrangement,
      harmonic: built.harmonic,
    });
    expect(lead.pass, lead.hardViolations.join('\n')).toBe(true);
  });

  it('is same-seed stable and exposes whole-phrase Lead/Drum variation across 128 final renders', () => {
    expect(jazzFiveFourScoreEventSignature(product(41).jazzFiveFourScorePlan!))
      .toEqual(jazzFiveFourScoreEventSignature(product(41).jazzFiveFourScorePlan!));

    const leadSkeletons = new Set<string>();
    const drumVocab = new Set<string>();
    const scoreSignatures = new Set<string>();
    for (let seed = 0; seed < 128; seed += 1) {
      const built = product(seed);
      const score = built.jazzFiveFourScorePlan!;
      expect(validateJazzFiveFourScorePlan(score), `seed ${seed}`).toEqual([]);
      const leadAudit = auditJazzFiveFourLead({
        score,
        arrangement: built.arrangement,
        harmonic: built.harmonic,
      });
      expect(leadAudit.pass, `seed ${seed}: ${leadAudit.hardViolations.join('; ')}`).toBe(true);
      const generated = generateSongFromBundle(built);
      expect(
        generated.ir,
        `seed ${seed}: ${JSON.stringify(generated.report.findings, null, 2)}`,
      ).toBeDefined();
      expect(jazzFiveFourTrackEventSignature(generated.ir!.tracks), `seed ${seed}`)
        .toEqual(jazzFiveFourScoreEventSignature(score));
      expect(assertJazzFiveFourGrooveMatch(score, generated.ir!).pass, `seed ${seed}`)
        .toBe(true);
      leadSkeletons.add(built.arrangement.jazzFiveFourLeadDirectives!
        .find((directive) => directive.sectionId === 'headA')!.rhythmTemplateId);
      for (const phrase of built.arrangement.jazzFiveFourEnsembleScore!.drumPhraseDirectives) {
        drumVocab.add(phrase.patternId);
      }
      scoreSignatures.add(jazzFiveFourScoreEventSignature(score).join('\n'));
    }
    expect(leadSkeletons.size).toBeGreaterThanOrEqual(10);
    expect(drumVocab.size).toBeGreaterThanOrEqual(5);
    expect(scoreSignatures.size).toBeGreaterThanOrEqual(20);

    const fourFour = buildSongBundle({
      seed: 41,
      styleHint: 'jazz',
      mood: 'ordinary 4/4 control',
      targetDuration: 60,
      jazzArchetypeId: JAZZ_4_4_ARCHETYPE_ID,
    });
    expect(fourFour.arrangement.meter).toEqual({ numerator: 4, denominator: 4 });
    expect(fourFour.jazzFiveFourScorePlan).toBeUndefined();
  }, 30_000);
});
