import { describe, expect, it } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { createRandomContext } from '../foundation';
import {
  JAZZ_FIVE_FOUR_ACOUSTIC_BASS_CELLS,
  JAZZ_FIVE_FOUR_PIANO_FOUNDATION_CELLS,
  JAZZ_FIVE_FOUR_UPPER_COMP_CELLS,
} from '../knowledge/jazzFiveFourRoleKnowledge';
import { jazzFiveFourDrumPhrasePattern } from '../knowledge/jazzFiveFourDrumPhraseKnowledge';
import {
  jazzFiveFourBassTextureCells,
  jazzFiveFourPianoTextureCells,
  jazzFiveFourTextureOnsetMask,
} from '../knowledge/jazzFiveFourTextureKnowledge';
import { buildArrangementPlan } from './arranger';
import {
  JAZZ_4_4_ARCHETYPE_ID,
  JAZZ_5_4_ARCHETYPE_ID,
  JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE_ID,
  type JazzArrangementArchetypeId,
} from './jazzArchetypePlanner';
import {
  jazzFiveFourBarRoleDirective,
  planJazzFiveFourEnsembleScore,
  type JazzFiveFourCodaReturnMode,
  type JazzFiveFourEnsembleScore,
} from './jazzFiveFourEnsembleScore';

function arrangement(archetypeId: JazzArrangementArchetypeId, seed = 54) {
  const band = buildBandSpec({
    seed,
    styleHint: 'jazz',
    mood: 'ensemble score test',
    targetDuration: 60,
  });
  return buildArrangementPlan(band, {
    rng: createRandomContext(seed),
    jazzArchetypeId: archetypeId,
  });
}

function generative(seed: number, returnMode: JazzFiveFourCodaReturnMode): JazzFiveFourEnsembleScore {
  const reference = arrangement(JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE_ID);
  return planJazzFiveFourEnsembleScore({
    mode: 'generative',
    seed,
    codaDirective: { returnMode },
    meter: reference.meter,
    sections: reference.sections,
    phrases: reference.phrases,
  });
}

function roleSignature(score: JazzFiveFourEnsembleScore): string {
  return score.barDirectives.map((bar) => bar.roleDirectives
    .map((role) => `${role.role}:${role.active}:${role.variationId ?? '-'}:${role.textureVariantId ?? '-'}`)
    .join(',')).join('|')
    + `#${score.drumPhraseDirectives.map((phrase) => `${phrase.startBar}:${phrase.patternId}`).join('|')}`;
}

describe('arranger/jazzFiveFourEnsembleScore', () => {
  it('attaches the exact 33-bar Gate-G reference score only to the reference archetype', () => {
    const plan = arrangement(JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE_ID);
    const score = plan.jazzFiveFourEnsembleScore!;
    expect(score.mode).toBe('canonical-reference');
    expect(score.totalBars).toBe(33);
    expect(score.codaDirective.returnMode).toBe('full-ensemble-return');
    expect(score.barDirectives.map((bar) => bar.absoluteBar)).toEqual(
      Array.from({ length: 33 }, (_, index) => index),
    );
    expect(Object.isFrozen(score)).toBe(true);
    expect(Object.isFrozen(score.barDirectives)).toBe(true);

    for (const bar of score.barDirectives) {
      expect(bar.activeRoles).toEqual(['bass', 'comp', 'lead', 'drum']);
      expect(bar.foundationMode).toBe('acousticBass+fullPiano');
      expect(bar.foundationOwner).toBe('bass');
      expect(bar.interactionCue.ensembleIntent).toBe('canonical-interlock');
      expect(jazzFiveFourBarRoleDirective(bar, 'bass')).toMatchObject({
        active: true,
        variationId: 'bass.a.source-canonical',
        textureVariantId: 'acoustic.a',
      });
      expect(jazzFiveFourBarRoleDirective(bar, 'comp')).toMatchObject({
        active: true,
        variationId: 'comp.a.source-canonical',
        textureVariantId: 'a.full',
      });
      expect(jazzFiveFourBarRoleDirective(bar, 'drum')).toMatchObject({
        active: true,
        variationId: 'drum.core.source-canonical',
        drumPhraseBarOffset: 0,
      });
      expect(Object.isFrozen(bar.roleDirectives)).toBe(true);
      expect(Object.isFrozen(bar.interactionCue)).toBe(true);
    }
    expect(score.drumPhraseDirectives).toHaveLength(33);
    expect(score.drumPhraseDirectives.every((phrase) =>
      phrase.patternId === 'coreKeepTime' && phrase.spanBars === 1)).toBe(true);

    expect(jazzFiveFourTextureOnsetMask(jazzFiveFourBassTextureCells('acoustic.a')))
      .toEqual([...new Set(JAZZ_FIVE_FOUR_ACOUSTIC_BASS_CELLS.map((cell) => cell.phase.engineTicks))]);
    expect(jazzFiveFourTextureOnsetMask(jazzFiveFourPianoTextureCells('a.full')))
      .toEqual([...new Set([
        ...JAZZ_FIVE_FOUR_PIANO_FOUNDATION_CELLS,
        ...JAZZ_FIVE_FOUR_UPPER_COMP_CELLS,
      ].map((cell) => cell.phase.engineTicks))].sort((left, right) => left - right));

    expect(arrangement(JAZZ_4_4_ARCHETYPE_ID).jazzFiveFourEnsembleScore).toBeUndefined();
    expect(arrangement(JAZZ_5_4_ARCHETYPE_ID).jazzFiveFourEnsembleScore)
      .toMatchObject({ mode: 'generative', totalBars: 33 });
  });

  it('freezes the requested Bass/Lead handoff to Comp/Lead and makes Coda return explicit', () => {
    const continued = generative(9104, 'continue-comp-foundation');
    for (const bar of continued.barDirectives.slice(0, 9)) {
      expect(bar.activeRoles).toEqual(['bass', 'lead', 'drum']);
      expect(bar.foundationMode).toBe('keyboardBassOnly');
      expect(bar.foundationOwner).toBe('bass');
      expect(jazzFiveFourBarRoleDirective(bar, 'comp')).toEqual({
        role: 'comp', active: false, materialOwner: 'silent',
      });
    }
    for (const bar of continued.barDirectives.slice(9)) {
      expect(bar.activeRoles).toEqual(['comp', 'lead', 'drum']);
      expect(bar.foundationMode).toBe('compOwnsFoundation');
      expect(bar.foundationOwner).toBe('comp');
      expect(jazzFiveFourBarRoleDirective(bar, 'bass')).toEqual({
        role: 'bass', active: false, materialOwner: 'silent',
      });
    }

    const headB = continued.barDirectives.filter((bar) => bar.sectionId === 'headB');
    expect(headB.slice(0, 7).map((bar) => jazzFiveFourBarRoleDirective(bar, 'comp').textureVariantId))
      .toEqual(Array(7).fill('b.body.full'));
    expect(jazzFiveFourBarRoleDirective(headB[7]!, 'comp').textureVariantId)
      .toBe('b.turnaround.full');
    expect(jazzFiveFourTextureOnsetMask(jazzFiveFourPianoTextureCells('b.body.full')))
      .toEqual([0, 305, 785, 1_440, 1_920]);
    expect(jazzFiveFourTextureOnsetMask(jazzFiveFourPianoTextureCells('b.turnaround.full')))
      .toEqual([0, 305, 785, 960, 1_440]);

    const returned = generative(9104, 'full-ensemble-return');
    expect(returned.codaDirective.returnMode).toBe('full-ensemble-return');
    for (const bar of returned.barDirectives.filter((entry) => entry.sectionId === 'coda')) {
      expect(bar.activeRoles).toEqual(['bass', 'comp', 'lead', 'drum']);
      expect(bar.foundationMode).toBe('acousticBass+fullPiano');
      expect(bar.foundationOwner).toBe('bass');
    }
  });

  it('covers every bar once with indivisible Drum patterns and preserves source barOffset', () => {
    for (let seed = 0; seed < 64; seed += 1) {
      const score = generative(seed, seed % 2 === 0
        ? 'continue-comp-foundation'
        : 'full-ensemble-return');
      const coverage = Array(33).fill(0) as number[];
      for (const directive of score.drumPhraseDirectives) {
        const pattern = jazzFiveFourDrumPhrasePattern(directive.patternId);
        expect(directive.spanBars, directive.id).toBe(pattern.spanBars);
        expect(directive.mutationUnit, directive.id).toBe(pattern.mutationUnit);
        expect(pattern.hits.every((hit) => hit.barOffset >= 0 && hit.barOffset < directive.spanBars), directive.id)
          .toBe(true);
        for (let offset = 0; offset < directive.spanBars; offset += 1) {
          coverage[directive.startBar + offset] += 1;
          const bar = score.barDirectives[directive.startBar + offset]!;
          const drum = jazzFiveFourBarRoleDirective(bar, 'drum');
          expect(drum.drumPhraseDirectiveId, directive.id).toBe(directive.id);
          expect(drum.drumPhraseBarOffset, directive.id).toBe(offset);
          expect(bar.phraseId, directive.id).toBe(directive.phraseId);
        }
      }
      expect(coverage, `seed ${seed}`).toEqual(Array(33).fill(1));

      const selectionScopes = new Map<string, string>();
      for (const bar of score.barDirectives) {
        const signature = bar.roleDirectives.map((role) => role.variationId ?? '-').join('|');
        const previous = selectionScopes.get(bar.interactionCue.selectionScopeId);
        if (previous) expect(signature).toBe(previous);
        else selectionScopes.set(bar.interactionCue.selectionScopeId, signature);
      }
    }
  });

  it('is stable for one seed, exposes a multi-seed vocabulary, and remains pitchless', () => {
    const once = generative(1662, 'continue-comp-foundation');
    const twice = generative(1662, 'continue-comp-foundation');
    expect(twice).toEqual(once);

    const scores = Array.from({ length: 64 }, (_, seed) =>
      generative(seed, 'continue-comp-foundation'));
    expect(new Set(scores.map(roleSignature)).size).toBeGreaterThanOrEqual(4);
    expect(scores.some((score) => score.drumPhraseDirectives.some((phrase) => phrase.spanBars > 1))).toBe(true);

    const serialized = JSON.stringify(once);
    expect(serialized).not.toMatch(/"(?:pitch|midi|degree|interval|noteName)"/i);
    expect(once.barDirectives.every((bar) =>
      bar.roleDirectives.some((role) => role.role === bar.foundationOwner && role.active))).toBe(true);
  });
});
