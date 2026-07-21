import { describe, expect, it } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import {
  JAZZ_4_4_ARCHETYPE_ID,
  JAZZ_5_4_ARCHETYPE_ID,
  JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE_ID,
} from '../arranger/jazzArchetypePlanner';
import { createRandomContext, pc, type PitchClass } from '../foundation';
import { jazzFiveFourHarmonicTemplate } from '../knowledge/jazzFiveFourHarmonicFormGrammar';
import { buildSongBundle } from '../generation/GenerationController';
import {
  JAZZ_FIVE_FOUR_HARMONIC_POLICY_ID,
  planJazzFiveFourHarmonicDirectives,
} from '../arranger/jazzFiveFourHarmonyScore';
import { compileJazzFiveFourHarmonicDirectives } from './jazzFiveFourHarmonyCompiler';
import { buildHarmonicPlanFromArrangement } from './harmonyEngine';

function fixture(key: PitchClass = pc(4)) {
  const seed = 1662;
  const rng = createRandomContext(seed);
  const band = buildBandSpec({
    seed,
    styleHint: 'jazz',
    mood: '5/4 harmony compiler',
    targetDuration: 57.5,
    key,
    mode: 'minor',
  });
  const arrangement = buildArrangementPlan(band, {
    rng,
    targetDuration: 57.5,
    jazzArchetypeId: JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE_ID,
  });
  return { band, arrangement, rng };
}

describe('Harmony/JazzFiveFourHarmonyCompiler · Arranger -> KB -> HarmonicPlan', () => {
  it('consumes the explicit 5/4 score policy and covers every Section/Phrase with whole KB templates', () => {
    const { arrangement } = fixture();
    const directives = arrangement.jazzFiveFourHarmonyDirectives!;

    expect(directives.length).toBeGreaterThan(0);
    expect(Object.isFrozen(directives)).toBe(true);
    expect(directives.every((directive) =>
      Object.isFrozen(directive) && Object.isFrozen(directive.phraseIds))).toBe(true);
    expect(directives.every((directive) => directive.policyId === JAZZ_FIVE_FOUR_HARMONIC_POLICY_ID)).toBe(true);
    expect(directives.every((directive) => jazzFiveFourHarmonicTemplate(directive.templateId) !== undefined)).toBe(true);

    for (const section of arrangement.sections) {
      const inSection = directives.filter((directive) => directive.sectionId === section.id);
      expect(inSection.reduce((bars, directive) => bars + directive.barCount, 0)).toBe(section.bars);
      expect(inSection[0].startBarInSection).toBe(0);
      for (const phrase of arrangement.phrases.filter((item) => item.sectionId === section.id)) {
        expect(inSection.some((directive) => directive.phraseIds.includes(phrase.id))).toBe(true);
      }
    }

    for (const sectionId of ['pickup', 'headA', 'headOut']) {
      expect(directives.filter((directive) => directive.sectionId === sectionId)
        .every((directive) => directive.templateId.includes('.a-vamp.'))).toBe(true);
    }
    expect(directives.filter((directive) => directive.sectionId === 'headB').map((directive) => directive.templateId))
      .toEqual([
        'j54.harmony.b-bridge.modern-reharm.body.v1',
        'j54.harmony.a-vamp.minor-i-v.base.v1',
        'j54.harmony.a-vamp.minor-i-v.answer.v1',
      ]);
    expect(directives.filter((directive) => directive.sectionId === 'coda').slice(-3).map((directive) => directive.templateId))
      .toEqual([
        'j54.harmony.coda.tonic-sustain.v1',
        'j54.harmony.coda.tonic-sustain.v1',
        'j54.harmony.coda.tonic-hold.v1',
      ]);

    const bundle = buildSongBundle({
      seed: 1662,
      styleHint: 'jazz',
      mood: '5/4 harmony compiler',
      targetDuration: 57.5,
      key: pc(4),
      mode: 'minor',
      jazzArchetypeId: JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE_ID,
    });
    expect(bundle.arrangement.jazzFiveFourHarmonyDirectives).toEqual(directives);
    expect(bundle.harmonic.chordTimeline.length).toBeGreaterThan(0);

    const band = buildBandSpec({ seed: 2, styleHint: 'jazz', mood: 'ordinary', targetDuration: 60, mode: 'minor' });
    const ordinary = buildArrangementPlan(band, {
      rng: createRandomContext(2), jazzArchetypeId: JAZZ_4_4_ARCHETYPE_ID,
    });
    expect(ordinary.jazzFiveFourHarmonyDirectives).toBeUndefined();
    expect(planJazzFiveFourHarmonicDirectives({
      meter: ordinary.meter,
      sections: ordinary.sections,
      phrases: ordinary.phrases,
      resolvedArchetype: ordinary.resolvedArchetype,
    })).toBeUndefined();

    const generative = buildArrangementPlan(band, {
      rng: createRandomContext(2), jazzArchetypeId: JAZZ_5_4_ARCHETYPE_ID,
    });
    expect(generative.jazzFiveFourHarmonyDirectives).toEqual(directives);
  });

  it('assembles globally contiguous five-beat bars and keeps every A-vamp bar at exact 3+2', () => {
    const { band, arrangement, rng } = fixture();
    const harmonic = buildHarmonicPlanFromArrangement(band, arrangement, rng);
    const totalBars = arrangement.sections.reduce((sum, section) => sum + section.bars, 0);
    const finalChord = harmonic.chordTimeline.at(-1)!;
    expect((finalChord.startBeat as number) + (finalChord.durationBeats as number)).toBe(totalBars * 5);

    let sectionStart = 0;
    for (const section of arrangement.sections) {
      for (let bar = 0; bar < section.bars; bar += 1) {
        const barStart = sectionStart + bar * 5;
        const spans = harmonic.chordTimeline.filter((span) =>
          span.sectionId === section.id
          && (span.startBeat as number) >= barStart
          && (span.startBeat as number) < barStart + 5,
        );
        let cursor = barStart;
        for (const span of spans) {
          expect(span.startBeat as number).toBe(cursor);
          cursor += span.durationBeats as number;
        }
        expect(cursor, `${section.id} bar ${bar}`).toBe(barStart + 5);

        if (section.id === 'pickup' || section.id === 'headA' || section.id === 'headOut') {
          expect(spans.map((span) => (span.startBeat as number) - barStart)).toEqual([0, 3]);
          expect(spans.map((span) => span.durationBeats as number)).toEqual([3, 2]);
          expect(spans.map((span) => span.rootPc)).toEqual([pc(4), pc(11)]);
        }
      }
      sectionStart += section.bars * 5;
    }

    // Root identity remains global even for an applied dominant: in E minor,
    // E7 is degree I with V/iv semantics, never mislabeled as global degree V.
    const applied = harmonic.chordTimeline.find((span) => span.localRoman === 'V/iv')!;
    expect(applied).toMatchObject({ rootPc: pc(4), chordType: '7alt' });
    expect(applied.roman).toMatchObject({
      degree: 1,
      accidental: 'natural',
      secondaryTarget: { degree: 4, accidental: 'natural' },
    });
    expect(harmonic.chordTimeline.some((span) => span.chordType === '7#11')).toBe(true);
  });

  it('projects every relative KB root through the song key and through an existing section-key decision', () => {
    const atC = fixture(pc(0));
    const atE = fixture(pc(4));
    const cPlan = buildHarmonicPlanFromArrangement(atC.band, atC.arrangement, atC.rng);
    const ePlan = buildHarmonicPlanFromArrangement(atE.band, atE.arrangement, atE.rng);

    expect(ePlan.chordTimeline).toHaveLength(cPlan.chordTimeline.length);
    for (let index = 0; index < cPlan.chordTimeline.length; index += 1) {
      const c = cPlan.chordTimeline[index];
      const e = ePlan.chordTimeline[index];
      expect(e.rootPc).toBe(pc(((c.rootPc as number) + 4) % 12));
      expect({
        sectionId: e.sectionId,
        duration: e.durationBeats,
        func: e.effectiveFunc,
        chordType: e.chordType,
        localRoman: e.localRoman,
      }).toEqual({
        sectionId: c.sectionId,
        duration: c.durationBeats,
        func: c.effectiveFunc,
        chordType: c.chordType,
        localRoman: c.localRoman,
      });
    }

    const home = compileJazzFiveFourHarmonicDirectives({
      band: atC.band,
      arrangement: atC.arrangement,
      sectionKeyOf: () => pc(0),
    })!;
    const sectionShifted = compileJazzFiveFourHarmonicDirectives({
      band: atC.band,
      arrangement: atC.arrangement,
      sectionKeyOf: (sectionId) => sectionId === 'headB' ? pc(6) : pc(0),
    })!;
    const homeReharm = home.find((chord) => chord.sectionId === 'headB')!;
    const shiftedReharm = sectionShifted.find((chord) => chord.sectionId === 'headB')!;
    expect(shiftedReharm.rootPc).toBe(pc(((homeReharm.rootPc as number) + 6) % 12));
    expect(shiftedReharm.sectionKeyPc).toBe(pc(6));
  });

  it('fails closed when Harmony receives the policy without the Arranger-authored score', () => {
    const { band, arrangement } = fixture();
    const missing = {
      ...arrangement,
      jazzFiveFourHarmonyDirectives: undefined,
    } as ArrangementPlan;
    expect(() => compileJazzFiveFourHarmonicDirectives({
      band,
      arrangement: missing,
      sectionKeyOf: () => band.key,
    })).toThrow('policy is enabled but Arranger emitted no directives');
  });
});
