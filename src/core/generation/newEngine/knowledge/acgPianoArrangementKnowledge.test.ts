import { describe, expect, it } from 'vitest';
import { ACG_PIANO_ARRANGEMENT_PROFILES } from '../arranger/acgPianoArrangementProfiles';
import {
  ACG_PIANO_FORM_KNOWLEDGE,
  ACG_PIANO_METRIC_KNOWLEDGE,
  ACG_PIANO_OPENING_KNOWLEDGE,
  ACG_PIANO_PHRASE_ORCHESTRATION_KNOWLEDGE,
} from './acgPianoArrangementKnowledge';

describe('knowledge/acgPianoArrangementKnowledge · three-track piano score', () => {
  it('keeps the theme entrance early and sends duration overflow away from the intro', () => {
    expect(ACG_PIANO_FORM_KNOWLEDGE).toMatchObject({
      defaultIntroBars: 4,
      maxIntroBars: 4,
      themeEntryDeadlineBars: 4,
      minThemeStatementBars: 4,
      preferredThemeStatementBars: 8,
      maxDevelopmentBars: 8,
    });
    expect(ACG_PIANO_FORM_KNOWLEDGE.overflowPriority[0]).toBe('theme');
    expect(ACG_PIANO_FORM_KNOWLEDGE.overflowPriority).not.toContain('intro');
  });

  it('turns every hidden openingStrategy into an audible COMP middle-hand cycle', () => {
    expect(new Set(ACG_PIANO_ARRANGEMENT_PROFILES.map((profile) => profile.openingStrategy)))
      .toEqual(new Set(Object.keys(ACG_PIANO_OPENING_KNOWLEDGE)));
    for (const opening of Object.values(ACG_PIANO_OPENING_KNOWLEDGE)) {
      expect(opening.compSurfaceCycle.length, opening.id).toBeGreaterThanOrEqual(3);
      expect(opening.compSurfaceCycle, `${opening.id} is not a silent prelude`).not.toContain('tacet');
    }
  });

  it('assigns low bass, middle COMP and top lead in every phrase scene', () => {
    for (const scene of ACG_PIANO_PHRASE_ORCHESTRATION_KNOWLEDGE) {
      expect(scene.bass.lane, scene.id).toBe('low');
      expect(scene.bass.rootAnchorRequired, scene.id).toBe(true);
      expect(scene.comp.lane, scene.id).toBe('middle');
      expect(scene.lead.lane, scene.id).toBe('top');
      expect(scene.comp.allowedSurfaceFamilies.length, scene.id).toBeGreaterThan(0);
      expect(scene.lead.allowedGrammarSubsets.length, scene.id).toBeGreaterThan(0);
      if (scene.id !== 'coda-release') {
        expect(scene.comp.maxFullTacetSpansPerPhrase, scene.id).toBe(0);
        expect(scene.comp.maxConsecutiveFullTacetSpans, scene.id).toBe(0);
      }
    }
  });

  it('owns one bounded metric clock for all three written piano hands', () => {
    expect(ACG_PIANO_METRIC_KNOWLEDGE).toMatchObject({
      subdivisionBeats: 0.25,
      expressiveOffsetLimitBeats: 0.04,
      compEntryLimitBeats: 0.125,
      rollSpreadLimitBeats: 0.15,
    });
    expect(ACG_PIANO_METRIC_KNOWLEDGE.expressiveOffsetLimitBeats)
      .toBeLessThan(ACG_PIANO_METRIC_KNOWLEDGE.compEntryLimitBeats);
    expect(ACG_PIANO_METRIC_KNOWLEDGE.compEntryLimitBeats)
      .toBeLessThan(ACG_PIANO_METRIC_KNOWLEDGE.subdivisionBeats);
  });
});
