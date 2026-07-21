import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pc } from '../foundation';
import { JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE_ID } from '../arranger/jazzArchetypePlanner';
import { buildSongBundle } from './GenerationController';
import {
  auditJazzFiveFourLead,
  freezeJazzFiveFourAntiCopyThreshold,
  jazzFiveFourAntiCopySimilarity,
  jazzFiveFourContourNgrams,
  jazzFiveFourDirectedIntervals,
} from './jazzFiveFourLeadAuditor';

const ROLES = new Set(['bass', 'comp', 'lead', 'drum'] as const);

function bundle(seed: number) {
  return buildSongBundle({
    seed,
    styleHint: 'jazz',
    mood: 'Jazz 5/4 Gate L audit',
    targetDuration: 60,
    key: pc(4),
    mode: 'minor',
    jazzArchetypeId: JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE_ID,
    bandConstraint: { allowedRoles: ROLES, requiredRoles: ROLES },
  });
}

describe('generation/jazzFiveFourLeadAuditor · read-only Gate L', () => {
  it('passes hard timing/trace/range/harmony gates and reports honest descriptive metrics', () => {
    const built = bundle(1662);
    const before = JSON.stringify(built.jazzFiveFourScorePlan);
    const report = auditJazzFiveFourLead({
      score: built.jazzFiveFourScorePlan!,
      arrangement: built.arrangement,
      harmonic: built.harmonic,
    });
    expect(report.pass, report.hardViolations.join('\n')).toBe(true);
    expect(report).toMatchObject({
      noteCount: 179,
      traceMissingCount: 0,
      outOfRangeCount: 0,
      offLatticeCount: 0,
      performanceResidualMaxAbsTicks: 40,
      nominalChordMismatchCount: 0,
      avoidNoteArrivalCount: 0,
    });
    expect(report.structuralChordOrGuideRatio).toBeGreaterThanOrEqual(0.7);
    expect(report.families.map((family) => family.family)).toEqual(['pickup', 'headA', 'headB', 'coda']);
    expect(report.families.every((family) => family.attacksPerBar > 0)).toBe(true);
    expect(report.interactions.every((metrics) => metrics.nominal.jaccard < 0.35)).toBe(true);
    expect(report.interactions.find((metrics) => metrics.role === 'comp')!.performed.collisionRate)
      .toBeGreaterThanOrEqual(0.01);
    expect(report.interactions.find((metrics) => metrics.role === 'comp')!.performed.collisionRate)
      .toBeLessThanOrEqual(0.08);
    expect(report.interactions.find((metrics) => metrics.role === 'drum')!.performed.collisionRate)
      .toBeLessThanOrEqual(0.10);
    expect(JSON.stringify(built.jazzFiveFourScorePlan)).toBe(before);
  });

  it('uses the specified distinct-onset directional collision definition', () => {
    const built = bundle(1662);
    const score = built.jazzFiveFourScorePlan!;
    const report = auditJazzFiveFourLead({
      score, arrangement: built.arrangement, harmonic: built.harmonic,
    });
    const instrumentById = new Map(score.instrumentEvents.map((event) => [event.eventId, event] as const));
    for (const metrics of report.interactions) {
      expect(metrics.nominal.collisionRate).toBeCloseTo(
        metrics.nominal.leadDistinctOnsets === 0
          ? 0
          : metrics.nominal.sharedDistinctOnsets / metrics.nominal.leadDistinctOnsets,
        12,
      );
      expect(metrics.performed.collisionRate).toBeCloseTo(
        metrics.performed.leadDistinctOnsets === 0
          ? 0
          : metrics.performed.sharedDistinctOnsets / metrics.performed.leadDistinctOnsets,
        12,
      );
      expect(metrics.nominal.jaccard).toBeGreaterThanOrEqual(0);
      expect(metrics.nominal.jaccard).toBeLessThanOrEqual(1);
      expect(metrics.performed.jaccard).toBeGreaterThanOrEqual(0);
      expect(metrics.performed.jaccard).toBeLessThanOrEqual(1);

      const leadBars = new Set(score.roleBars
        .filter((bar) => bar.role === 'lead' && bar.active)
        .map((bar) => bar.absoluteBar));
      const roleBars = new Set((metrics.role === 'drum' ? score.drumBars : score.roleBars)
        .filter((bar) => bar.role === metrics.role && bar.active)
        .map((bar) => bar.absoluteBar));
      const coactiveBars = new Set([...leadBars].filter((bar) => roleBars.has(bar)));
      const performedOnsets = (role: 'lead' | 'bass' | 'comp' | 'drum') => new Set(
        score.performance.events
          .filter((event) => {
            const instrument = instrumentById.get(event.instrumentEventId);
            return event.role === role && instrument?.role === role && coactiveBars.has(instrument.absoluteBar);
          })
          .map((event) => event.tick),
      );
      const performedLead = performedOnsets('lead');
      const performedRole = performedOnsets(metrics.role);
      const performedShared = [...performedLead].filter((tick) => performedRole.has(tick)).length;
      expect(metrics.performed).toMatchObject({
        leadDistinctOnsets: performedLead.size,
        roleDistinctOnsets: performedRole.size,
        sharedDistinctOnsets: performedShared,
      });

      // Legacy fields remain exact aliases of the nominal-grid report.
      expect(metrics.collisionRate).toBeCloseTo(
        metrics.leadDistinctOnsets === 0 ? 0 : metrics.sharedDistinctOnsets / metrics.leadDistinctOnsets,
        12,
      );
      expect(metrics.leadDistinctOnsets).toBe(metrics.nominal.leadDistinctOnsets);
      expect(metrics.roleDistinctOnsets).toBe(metrics.nominal.roleDistinctOnsets);
      expect(metrics.sharedDistinctOnsets).toBe(metrics.nominal.sharedDistinctOnsets);
      expect(metrics.collisionRate).toBe(metrics.nominal.collisionRate);
      expect(metrics.jaccard).toBe(metrics.nominal.jaccard);
    }
  });

  it('is deterministic for one seed and observes semantic/pitch variation across seeds', () => {
    const audit = (seed: number) => {
      const built = bundle(seed);
      return auditJazzFiveFourLead({
        score: built.jazzFiveFourScorePlan!, arrangement: built.arrangement, harmonic: built.harmonic,
      });
    };
    expect(audit(1662).eventSignature).toBe(audit(1662).eventSignature);
    expect(audit(1663).eventSignature).not.toBe(audit(1662).eventSignature);
  });

  it('detects direct and transposed copies above a frozen negative-control threshold', () => {
    const source = [64, 67, 66, 64, 62, 63, 67, 70, 69, 67, 64, 62, 64, 67, 71, 69];
    const transposedCopy = source.map((pitch) => pitch + 5);
    const negatives = [
      [60, 60, 65, 61, 68, 62, 69, 63, 70, 64, 71, 65, 72, 66, 73, 67],
      [72, 69, 65, 70, 66, 62, 67, 63, 59, 64, 60, 56, 61, 57, 53, 58],
      [55, 62, 58, 65, 60, 67, 61, 68, 63, 70, 64, 71, 66, 73, 67, 74],
      [71, 71, 68, 68, 65, 65, 62, 62, 59, 59, 56, 56, 53, 53, 50, 50],
    ];
    const threshold = freezeJazzFiveFourAntiCopyThreshold(source, negatives);
    expect(jazzFiveFourAntiCopySimilarity(source, source).score).toBe(1);
    expect(jazzFiveFourAntiCopySimilarity(source, transposedCopy)).toMatchObject({
      score: 1,
      bestTransposeSemitones: 5,
    });
    expect(jazzFiveFourAntiCopySimilarity(source, transposedCopy).score).toBeGreaterThan(threshold);
    expect(negatives.every((negative) => jazzFiveFourAntiCopySimilarity(source, negative).score <= threshold)).toBe(true);
    expect(jazzFiveFourDirectedIntervals(source)).toHaveLength(source.length - 1);
    expect(jazzFiveFourContourNgrams(source, 3).size).toBeGreaterThan(0);
  });

  it('contains no source melody, attachment path, evidence import or score mutation hook', () => {
    const source = readFileSync(new URL('./jazzFiveFourLeadAuditor.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from\s+['"][^'"]*jazzFiveFourEvidence['"]/);
    expect(source).not.toMatch(/\.codex\/attachments|Take-Five-1\.mid|readFileSync|writeFileSync/);
    expect(source).not.toMatch(/\.push\([^)]*instrumentEvents|\.push\([^)]*performance\.events/);
  });
});
