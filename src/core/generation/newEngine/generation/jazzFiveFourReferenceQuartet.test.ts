import { describe, expect, it } from 'vitest';
import { midi, pc } from '../foundation';
import { JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE_ID } from '../arranger/jazzArchetypePlanner';
import { deriveMusicIntentPlan } from '../arranger/deriveMusicIntentPlan';
import { renderSongFull } from '../render/renderCoordinator';
import {
  assertJazzFiveFourProjectionIdentity,
  jazzFiveFourScoreEventSignature,
  jazzFiveFourTrackEventSignature,
} from '../render/jazzFiveFourScoreProjector';
import { assertJazzFiveFourGrooveMatch } from '../render/jazzFiveFourGrooveMatcher';
import { buildSongBundle, generateSongFromBundle } from './GenerationController';

const ROLES = new Set(['bass', 'comp', 'lead', 'drum'] as const);

function referenceBundle() {
  return buildSongBundle({
    seed: 1662,
    styleHint: 'jazz',
    mood: 'MIDI reference quartet',
    targetDuration: 57.5,
    key: pc(4),
    mode: 'minor',
    jazzArchetypeId: JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE_ID,
    bandConstraint: { allowedRoles: ROLES, requiredRoles: ROLES },
  });
}

describe('Jazz 5/4 MIDI-reference quartet bundle', () => {
  it('keeps four independent participants on one 5/4 global clock', () => {
    const bundle = referenceBundle();

    expect(bundle.arrangement.meter).toEqual({ numerator: 5, denominator: 4 });
    expect(bundle.arrangement.tempoBpm).toBeCloseTo(167.000203, 6);
    expect(bundle.arrangement.songGrooveContract.beatGrouping).toEqual([3, 2]);
    expect(bundle.arrangement.sections.map((section) => section.bars)).toEqual([1, 8, 8, 8, 8]);
    expect(bundle.instrumentation.orchestrationChain.ensembleWorld).toBe('jazzFiveFourQuartet');
    expect(bundle.instrumentation.roleProgram).toMatchObject({
      bass: 32,
      comp: 0,
      lead: 65,
    });
    expect(bundle.instrumentation.strictRegisterByRole).toMatchObject({
      bass: { lowMidi: 29, highMidi: 48 },
      comp: { lowMidi: 39, highMidi: 66 },
      lead: { lowMidi: 54, highMidi: 78 },
    });
    for (const section of bundle.arrangement.sections) {
      expect(bundle.instrumentation.activeRolesBySection[section.id])
        .toEqual(expect.arrayContaining(['bass', 'comp', 'lead', 'drum']));
    }
    expect(bundle.jazzFiveFourScorePlan).toBeDefined();
    expect(bundle.jazzFiveFourScorePlan!.performance.events.some((event) => event.role === 'lead')).toBe(true);
  });

  it('projects the compiled Bass/Comp/Drum/Lead score bit-identically through the production renderer', () => {
    const bundle = referenceBundle();
    const score = bundle.jazzFiveFourScorePlan!;
    const rendered = renderSongFull(
      bundle.band,
      bundle.arrangement,
      bundle.harmonic,
      bundle.instrumentation,
      bundle.timebase,
      bundle.seedRng,
      undefined,
      undefined,
      deriveMusicIntentPlan(bundle.band.style, bundle.arrangement),
      undefined,
      bundle.acgPianoScorePlan,
      score,
    );

    expect(jazzFiveFourTrackEventSignature(rendered.ir.tracks))
      .toEqual(jazzFiveFourScoreEventSignature(score));
    expect(assertJazzFiveFourGrooveMatch(score, rendered.ir).pass).toBe(true);
    const eventsInFirstBar = score.performance.events.filter((event) => event.tick < 2_400);
    const phases = (role: 'bass' | 'comp' | 'drum') => [...new Set(eventsInFirstBar
      .filter((event) => event.role === role)
      .map((event) => event.tick % 2_400))].sort((a, b) => a - b);
    expect(phases('bass')).toEqual([0, 1_440, 1_920]);
    expect(phases('comp')).toEqual([0, 305, 785, 960, 1_440, 1_920]);
    expect(phases('drum')).toEqual([0, 480, 800, 960, 1_280, 1_440, 1_760, 1_920, 2_080, 2_240]);
    expect(eventsInFirstBar.filter((event) => event.role === 'drum')).toHaveLength(12);
    expect(eventsInFirstBar.filter((event) => event.role === 'drum')
      .every((event) => event.durationTicks === 10)).toBe(true);
    expect(eventsInFirstBar.filter((event) => event.role === 'bass').map((event) => event.pitch))
      .toEqual([40, 47, 35]);
  });

  it('automatically carries the same score through GenerationController', () => {
    const bundle = referenceBundle();
    const result = generateSongFromBundle(bundle);
    expect(result.ir, result.report.findings.map((finding) => finding.reason).join('\n')).toBeDefined();
    expect(jazzFiveFourTrackEventSignature(result.ir!.tracks))
      .toEqual(jazzFiveFourScoreEventSignature(bundle.jazzFiveFourScorePlan!));
    expect(assertJazzFiveFourGrooveMatch(bundle.jazzFiveFourScorePlan!, result.ir!).pass).toBe(true);
  });

  it('keeps Gate G canonical phase checks on Bass/Comp/Drum while all-role identity guards Lead', () => {
    const bundle = referenceBundle();
    const result = generateSongFromBundle(bundle);
    const tracks = result.ir!.tracks.map((track) => ({
      ...track,
      notes: track.notes.map((note) => ({ ...note })),
    }));
    const lead = tracks.find((track) => track.role === 'lead')!;
    lead.notes[0] = { ...lead.notes[0], pitch: midi(Math.min(127, (lead.notes[0]!.pitch as number) + 1)) };

    expect(assertJazzFiveFourGrooveMatch(bundle.jazzFiveFourScorePlan!, {
      ...result.ir!, tracks,
    }).pass).toBe(true);
    expect(() => assertJazzFiveFourProjectionIdentity(tracks, bundle.jazzFiveFourScorePlan!))
      .toThrow('projection identity violated');
  });
});
