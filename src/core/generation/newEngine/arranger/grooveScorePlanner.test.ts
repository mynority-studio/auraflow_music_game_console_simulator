import { describe, expect, it } from 'vitest';
import { grooveContractById, type GrooveContract } from '../knowledge/grooveContracts';
import { popRockFillRecipeDescriptors } from '../knowledge/drumFillVocabulary';
import {
  BASS_JAZZ_FIVE_FOUR_OSTINATO_PATTERN_ID,
  COMP_JAZZ_FIVE_FOUR_PIANO_INTERLOCK_PATTERN_ID,
  LEAD_JAZZ_FIVE_FOUR_PHRASE_PATTERN_ID,
  bassRoleRhythmPattern,
  type RoleRhythmPatternReferenceByRole,
} from '../knowledge/roleRhythmPatterns';
import type { OpeningGesturePlan, Section } from './ArrangementPlan';
import { planGrooveScore } from './grooveScorePlanner';

const sections: Section[] = [
  { id: 'intro', role: 'intro', functionTag: 'setup', bars: 4, hookPolicy: 'none' },
  { id: 'verse', role: 'verse', functionTag: 'story', bars: 8, hookPolicy: 'light' },
  { id: 'chorus', role: 'chorus', functionTag: 'hook', bars: 8, hookPolicy: 'main' },
];

const opening = (overrides: Partial<OpeningGesturePlan> = {}): OpeningGesturePlan => ({
  sectionId: 'intro',
  mode: 'textureFadeIn',
  drumEntry: 'hatsOnly',
  textureEntry: 'pianoRiff',
  roleDelayBars: { drum: 0 },
  pickupBars: 0,
  intensity: 'medium',
  ...overrides,
});

describe('arranger/grooveScorePlanner', () => {
  it('materializes the single GrooveContract accent and phrase grammar for every bar', () => {
    const contract = grooveContractById('pop_radio_straight')!;
    const plan = planGrooveScore(
      sections,
      Object.fromEntries(sections.map((section) => [section.id, contract])),
      { intro: 0.2, verse: 0.48, chorus: 0.82 },
      { intro: 'downbeat', verse: 'downbeat', chorus: 'lead-in' },
      opening(),
    );

    expect(plan.grooveContractId).toBe(contract.id);
    expect(plan.bySection.verse.bars).toHaveLength(8);
    expect(plan.bySection.verse.bars.every((bar) => bar.beatStrength.join() === contract.accentPattern.join())).toBe(true);
    expect(new Set(plan.bySection.verse.bars.map((bar) => bar.role)).size).toBeGreaterThan(1);
    expect(plan.bySection.verse.bars[0].phraseIndex).toBe(0);
    expect(plan.bySection.verse.bars[4].phraseIndex).toBe(1);
    expect(plan.bySection.verse.bars.every((bar) => bar.drumInteraction?.kickFollow === 'bass')).toBe(true);
    expect(plan.bySection.verse.bars.every((bar) => bar.drumInteraction?.snareFollow === 'backbeat')).toBe(true);
    expect(plan.bySection.verse.bars[0].drumInteraction).toMatchObject({
      structuralKickBeats: [0],
      structuralSnareBeats: [1, 3],
      kickResponseLimit: 2,
      snareResponseLimit: 0,
    });
  });

  it('materializes Jazz pulse and comp-catching without creating a second groove contract', () => {
    const head: Section[] = [
      { id: 'head', role: 'verse', functionTag: 'head', bars: 4, hookPolicy: 'main' },
    ];
    const combo = grooveContractById('jazz_combo_swing')!;
    const comboPlan = planGrooveScore(
      head,
      { head: combo },
      { head: 0.62 },
      { head: 'downbeat' },
      opening({ sectionId: 'head', drumEntry: 'rideOnly' }),
    );
    expect(comboPlan.bySection.head.bars[0].drumInteraction).toMatchObject({
      kickFollow: 'pulse',
      snareFollow: 'comping',
      structuralKickBeats: [0, 2],
      structuralSnareBeats: [],
      kickResponseLimit: 0,
      snareResponseLimit: 1,
    });

  });

  it('fails closed on unknown Bass role-pattern IDs', () => {
    const head: Section[] = [
      { id: 'head', role: 'verse', functionTag: 'head', bars: 2, hookPolicy: 'main' },
    ];
    const fourFour = grooveContractById('jazz_combo_swing')!;
    const plan = (patterns: {
      bassPatternIdBySection?: Record<string, string>;
    }) => planGrooveScore(
      head,
      { head: fourFour },
      { head: 0.62 },
      { head: 'downbeat' },
      opening({ sectionId: 'head', drumEntry: 'rideOnly' }),
      patterns,
    );

    expect(() => plan({ bassPatternIdBySection: { head: 'jazz_unknown' } }))
      .toThrow('Unknown Bass pattern reference');
  });

  it('materializes all 5/4 role-pattern references into the section score', () => {
    const head: Section[] = [
      { id: 'head', role: 'verse', functionTag: 'head', bars: 2, hookPolicy: 'main' },
    ];
    const combo = grooveContractById('jazz_combo_swing')!;
    const fiveFour: GrooveContract = {
      ...combo,
      id: 'test_jazz_five_four',
      meter: { numerator: 5, denominator: 4 },
      beatGrouping: [3, 2],
      accentPattern: [1.16, 0.82, 0.92, 1.08, 0.84],
    };
    const plan = planGrooveScore(
      head,
      { head: fiveFour },
      { head: 0.62 },
      { head: 'downbeat' },
      opening({ sectionId: 'head', drumEntry: 'rideOnly' }),
      {
        rolePatternBySection: {
          head: {
            bass: BASS_JAZZ_FIVE_FOUR_OSTINATO_PATTERN_ID,
            comp: COMP_JAZZ_FIVE_FOUR_PIANO_INTERLOCK_PATTERN_ID,
            lead: LEAD_JAZZ_FIVE_FOUR_PHRASE_PATTERN_ID,
          },
        },
      },
    );

    const roles = plan.bySection.head.roleRhythmByRole!;
    const bassPhases = roles.bass!.cells.map((cell) => cell.phaseBeats);
    const compPhases = roles.comp!.cells.map((cell) => cell.phaseBeats);
    expect(bassPhases).toEqual([0, 157 / 96, 3]);
    expect(compPhases).toEqual([0, 61 / 96, 157 / 96, 2, 3, 4]);
    expect(compPhases).not.toEqual(bassPhases);
    expect(roles.comp!.cells.map((cell) => cell.voiceAction)).toEqual([
      'foundation', 'chord', 'foundation', 'chord', 'foundation', 'chord',
    ]);
    expect(roles.lead).toMatchObject({
      realization: 'grammar-marker',
      grammarMarker: LEAD_JAZZ_FIVE_FOUR_PHRASE_PATTERN_ID,
    });
    expect('cells' in roles.lead!).toBe(false);
    expect(roles.bass).not.toBe(bassRoleRhythmPattern(BASS_JAZZ_FIVE_FOUR_OSTINATO_PATTERN_ID));
  });

  it('fails closed on unknown Bass, Comp and Lead role-rhythm references', () => {
    const head: Section[] = [
      { id: 'head', role: 'verse', functionTag: 'head', bars: 1, hookPolicy: 'main' },
    ];
    const combo = grooveContractById('jazz_combo_swing')!;
    const fiveFour: GrooveContract = {
      ...combo,
      id: 'test_jazz_five_four',
      meter: { numerator: 5, denominator: 4 },
      beatGrouping: [3, 2],
      accentPattern: [1.16, 0.82, 0.92, 1.08, 0.84],
    };
    const invalidReferences: RoleRhythmPatternReferenceByRole[] = [
      { bass: 'bass.unknown' },
      { comp: 'comp.unknown' },
      { lead: 'lead.unknown' },
      { bass: COMP_JAZZ_FIVE_FOUR_PIANO_INTERLOCK_PATTERN_ID },
    ];

    for (const references of invalidReferences) {
      expect(() => planGrooveScore(
        head,
        { head: fiveFour },
        { head: 0.62 },
        { head: 'downbeat' },
        opening({ sectionId: 'head', drumEntry: 'rideOnly' }),
        { rolePatternBySection: { head: references } },
      )).toThrow('Unknown role rhythm pattern reference');
    }
  });

  it('authors a setup pickup and a stronger lead-in instead of banning setup fills', () => {
    const contract = grooveContractById('pop_radio_straight')!;
    const plan = planGrooveScore(
      sections,
      Object.fromEntries(sections.map((section) => [section.id, contract])),
      { intro: 0.2, verse: 0.48, chorus: 0.82 },
      { intro: 'downbeat', verse: 'downbeat', chorus: 'lead-in' },
      opening(),
    );

    const intoVerse = plan.boundaries.find((boundary) => boundary.fromSectionId === 'intro')!;
    const intoChorus = plan.boundaries.find((boundary) => boundary.fromSectionId === 'verse')!;
    expect(intoVerse.kind).toBe('pickup');
    expect(intoVerse.drumFillFamily).toBe('pop-tom-build');
    expect(intoChorus.intensity).toBe(3);
    expect(intoChorus.durationBeats).toBe(2);
  });

  it('distinguishes first-hook lift, final climax, release and outro instead of repeating one big fill', () => {
    const contract = grooveContractById('pop_radio_straight')!;
    const dramaticSections: Section[] = [
      { id: 'verse1', role: 'verse', functionTag: 'story', bars: 8, repeatGroup: 'V', hookPolicy: 'light' },
      { id: 'chorus1', role: 'chorus', functionTag: 'hook', bars: 8, repeatGroup: 'C', hookPolicy: 'main' },
      { id: 'verse2', role: 'verse', functionTag: 'story', bars: 8, repeatGroup: 'V', hookPolicy: 'light' },
      { id: 'chorus2', role: 'chorus', functionTag: 'hook', bars: 8, repeatGroup: 'C', hookPolicy: 'main' },
      { id: 'outro', role: 'outro', functionTag: 'outro', bars: 4, hookPolicy: 'none' },
    ];
    const plan = planGrooveScore(
      dramaticSections,
      Object.fromEntries(dramaticSections.map((section) => [section.id, contract])),
      { verse1: 0.52, chorus1: 0.8, verse2: 0.52, chorus2: 0.86, outro: 0.3 },
      { verse1: 'downbeat', chorus1: 'lead-in', verse2: 'downbeat', chorus2: 'lead-in', outro: 'downbeat' },
      opening({ sectionId: 'verse1' }),
      { climaxMap: [{ sectionId: 'chorus2', intensity: 1 }] },
    );

    const intoFirstHook = plan.boundaries.find((boundary) => boundary.toSectionId === 'chorus1')!;
    const backToVerse = plan.boundaries.find((boundary) => boundary.toSectionId === 'verse2')!;
    const intoClimax = plan.boundaries.find((boundary) => boundary.toSectionId === 'chorus2')!;
    const intoOutro = plan.boundaries.find((boundary) => boundary.toSectionId === 'outro')!;

    expect(intoFirstHook).toMatchObject({ fillFunction: 'lift', intensity: 2, landing: 'kick-crash' });
    expect(intoFirstHook.fillScore?.rhythmClass).toMatch(/straight|broken/);
    expect(backToVerse).toMatchObject({ fillFunction: 'release', intensity: 1, landing: 'kick' });
    expect(intoClimax).toMatchObject({ fillFunction: 'climax', intensity: 3, landing: 'kick-crash' });
    expect(intoClimax.fillScore).toMatchObject({
      rhythmClass: 'syncopated-sixteenth',
      orchestration: 'linear-hand-foot',
    });
    expect(intoOutro).toMatchObject({ fillFunction: 'release', intensity: 1, landing: 'none' });
    expect(new Set([intoFirstHook.fillScore?.recipeId, intoClimax.fillScore?.recipeId]).size).toBe(2);

    expect(plan.bySection.verse1.bars.slice(-2).every((bar) => bar.trajectory === 'rising')).toBe(true);
    expect(plan.bySection.chorus1.bars[0].trajectory).toBe('settled');
    expect(plan.bySection.chorus1.bars.slice(-2).every((bar) => bar.trajectory === 'falling')).toBe(true);
    expect(plan.bySection.chorus2.bars[0].trajectory).toBe('arrival');
    expect(plan.bySection.chorus2.bars.slice(1).every((bar) => bar.trajectory === 'peak')).toBe(true);
  });

  it('uses the song fill seed to vary recipes without changing the boundary grammar', () => {
    const contract = grooveContractById('pop_radio_straight')!;
    const plans = Array.from({ length: 16 }, (_, fillVariantSeed) => planGrooveScore(
      sections,
      Object.fromEntries(sections.map((section) => [section.id, contract])),
      { intro: 0.2, verse: 0.48, chorus: 0.82 },
      { intro: 'downbeat', verse: 'downbeat', chorus: 'lead-in' },
      opening(),
      { climaxMap: [{ sectionId: 'chorus', intensity: 1 }], fillVariantSeed },
    ));
    const climaxFills = plans.map((plan) =>
      plan.boundaries.find((boundary) => boundary.toSectionId === 'chorus')!.fillScore!);

    expect(new Set(climaxFills.map((fill) => fill.recipeId)).size).toBeGreaterThan(1);
    expect(new Set(climaxFills.map((fill) => fill.rhythmClass))).toEqual(new Set(['syncopated-sixteenth']));
    expect(new Set(climaxFills.map((fill) => fill.orchestration))).toEqual(new Set(['linear-hand-foot']));
    expect(plans[7].boundaries).toEqual(planGrooveScore(
      sections,
      Object.fromEntries(sections.map((section) => [section.id, contract])),
      { intro: 0.2, verse: 0.48, chorus: 0.82 },
      { intro: 'downbeat', verse: 'downbeat', chorus: 'lead-in' },
      opening(),
      { climaxMap: [{ sectionId: 'chorus', intensity: 1 }], fillVariantSeed: 7 },
    ).boundaries);
  });

  it('makes all 60 POP/Rock recipes reachable through the actual Arranger score path', () => {
    const contract = grooveContractById('pop_radio_straight')!;
    const setupSections: Section[] = [
      { id: 'setup', role: 'intro', functionTag: 'setup', bars: 2, hookPolicy: 'none' },
      { id: 'story', role: 'verse', functionTag: 'story', bars: 2, hookPolicy: 'light' },
    ];
    const continuationSections: Section[] = [
      { id: 'storyA', role: 'verse', functionTag: 'story', bars: 2, hookPolicy: 'light' },
      { id: 'storyB', role: 'verse', functionTag: 'story', bars: 2, hookPolicy: 'light' },
    ];
    const reached = new Set<string>();
    const audibleScores = new Set<string>();

    for (let fillVariantSeed = 0; fillVariantSeed < 2048; fillVariantSeed++) {
      for (const candidate of [setupSections, continuationSections]) {
        const score = planGrooveScore(
          candidate,
          Object.fromEntries(candidate.map((section) => [section.id, contract])),
          Object.fromEntries(candidate.map((section) => [section.id, 0.5])),
          Object.fromEntries(candidate.map((section) => [section.id, 'downbeat' as const])),
          opening({ sectionId: candidate[0].id }),
          { fillVariantSeed },
        );
        const fill = score.boundaries.find((boundary) => boundary.fromSectionId === candidate[0].id)?.fillScore;
        if (fill) {
          reached.add(fill.recipeId);
          audibleScores.add(fill.hits.map((hit) =>
            `${hit.voice}@${hit.offsetBeatsFromEnd}:${hit.velocity}`).join('|'));
        }
      }
      if (reached.size === 60) break;
    }

    expect(reached).toEqual(new Set(popRockFillRecipeDescriptors().map((recipe) => recipe.recipeId)));
    expect(audibleScores.size).toBe(60);
  });

  it('consumes pickupBars as a real opening score event', () => {
    const contract = grooveContractById('pop_radio_straight')!;
    const plan = planGrooveScore(
      sections,
      Object.fromEntries(sections.map((section) => [section.id, contract])),
      { intro: 0.2, verse: 0.48, chorus: 0.82 },
      { intro: 'downbeat', verse: 'downbeat', chorus: 'lead-in' },
      opening({ mode: 'pickupFill', drumEntry: 'tomPickup', pickupBars: 1, intensity: 'bold' }),
    );

    expect(plan.boundaries[0]).toMatchObject({
      opening: true,
      sourceBar: 0,
      landingBar: 1,
      drumFillFamily: 'pop-tom-build',
      baseMask: 'replace-bar',
    });
  });

  it('authors a light internal cadence at the KB interval without stealing the section ending', () => {
    const contract = grooveContractById('pop_radio_straight')!;
    const longVerse: Section[] = [
      { id: 'longVerse', role: 'verse', functionTag: 'story', bars: 12, hookPolicy: 'light' },
    ];
    const plan = planGrooveScore(
      longVerse,
      { longVerse: contract },
      { longVerse: 0.5 },
      { longVerse: 'downbeat' },
      opening({ sectionId: 'longVerse' }),
    );

    expect(plan.boundaries).toEqual([
      expect.objectContaining({
        fromSectionId: 'longVerse',
        toSectionId: 'longVerse',
        sourceBar: 7,
        landingBar: 8,
        intensity: 1,
        drumFillFamily: 'pop-snare-pickup',
      }),
    ]);
    expect(plan.bySection.longVerse.bars[7].role).toBe('turnaround');
    expect(plan.boundaries.some((boundary) => boundary.sourceBar === 11)).toBe(false);
  });

  it('uses the Lo-fi dropout vocabulary and can honor a strict downbeat archetype', () => {
    const contract = grooveContractById('lofi_lazy_dilla')!;
    const bySection = Object.fromEntries(sections.map((section) => [section.id, contract]));
    const loose = planGrooveScore(
      sections,
      bySection,
      { intro: 0.2, verse: 0.4, chorus: 0.8 },
      { intro: 'downbeat', verse: 'downbeat', chorus: 'lead-in' },
      opening(),
    );
    expect(loose.boundaries.find((boundary) => boundary.fromSectionId === 'verse')).toMatchObject({
      kind: 'dropout',
      drumFillFamily: 'lofi-one-shot',
    });

    const strict = planGrooveScore(
      sections,
      bySection,
      { intro: 0.2, verse: 0.4, chorus: 0.8 },
      { intro: 'downbeat', verse: 'downbeat', chorus: 'downbeat' },
      opening(),
      { strictDownbeatBoundaries: true },
    );
    expect(strict.boundaries).toHaveLength(0);
  });
});
