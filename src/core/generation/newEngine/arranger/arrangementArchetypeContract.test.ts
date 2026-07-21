import { describe, expect, it } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { createRandomContext } from '../foundation';
import { buildArrangementPlan } from './arranger';
import {
  JAZZ_4_4_ARCHETYPE_ID,
  JAZZ_5_4_ARCHETYPE_ID,
  JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE_ID,
  JAZZ_ARCHETYPE_REGISTRY,
  type JazzArrangementArchetypeId,
} from './jazzArchetypePlanner';

function jazzPlan(archetypeId: JazzArrangementArchetypeId) {
  const band = buildBandSpec({
    seed: 54,
    styleHint: 'jazz',
    mood: 'arrangement contract',
    targetDuration: 60,
  });
  return buildArrangementPlan(band, {
    rng: createRandomContext(54),
    jazzArchetypeId: archetypeId,
  });
}

const activeRoles = (plan: ReturnType<typeof jazzPlan>, sectionId: string) =>
  (['bass', 'comp', 'pad', 'lead', 'drum'] as const)
    .filter((role) => plan.rolePerformanceBySection[role][sectionId].active);

describe('Arrangement archetype contract · Arranger authority', () => {
  it('4/4 展开为全段 Bass+Comp+Lead+Drum，地基归 Bass', () => {
    const plan = jazzPlan(JAZZ_4_4_ARCHETYPE_ID);
    expect(plan.meter).toEqual({ numerator: 4, denominator: 4 });
    expect(plan.resolvedArchetype?.id).toBe(JAZZ_4_4_ARCHETYPE_ID);
    expect(plan.resolvedArchetype?.instrumentationEnsembleId).toBeUndefined();
    expect(plan.jazzFiveFourLeadDirectives).toBeUndefined();
    expect(plan.jazzFiveFourEnsembleScore).toBeUndefined();
    for (const section of plan.sections) {
      expect(activeRoles(plan, section.id)).toEqual(['bass', 'comp', 'lead', 'drum']);
      expect(plan.resolvedArchetype?.sectionPolicyById[section.id].foundationOwner).toBe('bass');
      expect(plan.drumPerformanceBySection[section.id].role).not.toBe('silent');
    }
  });

  it('5/4 生成型展开 33-bar 总谱并明确 Bass+Lead → Comp+Lead 交接', () => {
    const plan = jazzPlan(JAZZ_5_4_ARCHETYPE_ID);
    expect(plan.meter).toEqual({ numerator: 5, denominator: 4 });
    expect(plan.tempoBpm).toBeCloseTo(167.000203, 6);
    expect(plan.songGrooveContract.beatGrouping).toEqual([3, 2]);
    expect(plan.sections.map((section) => section.id)).toEqual(['pickup', 'headA', 'headB', 'headOut', 'coda']);
    expect(plan.jazzFiveFourLeadDirectives).toHaveLength(5);
    expect(plan.jazzFiveFourEnsembleScore).toMatchObject({ mode: 'generative', totalBars: 33 });

    for (const sectionId of ['pickup', 'headA']) {
      expect(activeRoles(plan, sectionId)).toEqual(['bass', 'lead', 'drum']);
      expect(plan.entryBySection[sectionId]).toBe('downbeat');
      expect(plan.resolvedArchetype?.sectionPolicyById[sectionId].foundationOwner).toBe('bass');
    }
    expect(plan.grooveScorePlan.bySection.headA.roleRhythmByRole?.bass?.cells.map((cell) => cell.phaseBeats))
      .toEqual([0, 157 / 96, 3]);

    for (const sectionId of ['headB', 'headOut', 'coda']) {
      expect(activeRoles(plan, sectionId)).toEqual(['comp', 'lead', 'drum']);
      expect(plan.entryBySection[sectionId]).toBe('downbeat');
      expect(plan.resolvedArchetype?.sectionPolicyById[sectionId].foundationOwner).toBe('comp');
      expect(plan.drumPerformanceBySection[sectionId].role).not.toBe('silent');
    }
    expect(plan.grooveScorePlan.bySection.headB.roleRhythmByRole?.comp?.cells.map((cell) => cell.phaseBeats))
      .toEqual([0, 61 / 96, 157 / 96, 2, 3, 4]);
  });

  it('registry 同时保存 4/4、独奏钢琴 5/4 与 MIDI-reference quartet', () => {
    expect(JAZZ_ARCHETYPE_REGISTRY.map((entry) => entry.id)).toEqual([
      JAZZ_4_4_ARCHETYPE_ID,
      JAZZ_5_4_ARCHETYPE_ID,
      JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE_ID,
    ]);
  });

  it('MIDI-reference quartet 让 Bass/Comp/Lead/Drum 全段共存，地基归 Bass', () => {
    const plan = jazzPlan(JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE_ID);
    expect(plan.meter).toEqual({ numerator: 5, denominator: 4 });
    expect(plan.resolvedArchetype?.instrumentationEnsembleId).toBe('jazzFiveFourQuartet');
    expect(plan.sections.map((section) => [section.id, section.bars])).toEqual([
      ['pickup', 1], ['headA', 8], ['headB', 8], ['headOut', 8], ['coda', 8],
    ]);
    expect(plan.jazzFiveFourLeadDirectives).toHaveLength(5);
    expect(plan.jazzFiveFourEnsembleScore?.barDirectives).toHaveLength(33);
    for (const section of plan.sections) {
      expect(activeRoles(plan, section.id)).toEqual(['bass', 'comp', 'lead', 'drum']);
      expect(plan.resolvedArchetype?.sectionPolicyById[section.id].foundationOwner).toBe('bass');
      expect(plan.drumPerformanceBySection[section.id].role).not.toBe('silent');
    }
  });
});
