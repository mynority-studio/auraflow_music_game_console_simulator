import { describe, expect, it } from 'vitest';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import type { AcgPianoCompEvent, AcgPianoScorePlan } from '../arranger/acgPianoScorePlan';
import { deriveMusicIntentPlan } from '../arranger/deriveMusicIntentPlan';
import { beats, midi, ticks } from '../foundation';
import { buildSongBundle } from '../generation/GenerationController';
import type { InstrumentationPlan } from '../instrumental/InstrumentationPlan';
import type { TrackIR } from '../ir/MusicalIR';
import { applyEnding } from './ending';
import { applyBassPatternSchedule } from './bassPatternSchedule';
import { gateByDensity, renderSongFull } from './renderCoordinator';

const PIANO_ROLES = ['lead', 'comp', 'bass'] as const;
type PianoRole = (typeof PIANO_ROLES)[number];

function scoreOf(bundle: ReturnType<typeof buildSongBundle>): AcgPianoScorePlan {
  const score = bundle.acgPianoScorePlan;
  expect(score, 'ACG production fixture must supply a PianoScorePlan').toBeDefined();
  if (!score) throw new Error('missing ACG PianoScorePlan');
  return score;
}

function renderWithScore(
  bundle: ReturnType<typeof buildSongBundle>,
  score?: AcgPianoScorePlan,
  arrangement = bundle.arrangement,
  instrumentation = bundle.instrumentation,
  intent = deriveMusicIntentPlan(bundle.band.style, arrangement),
) {
  return renderSongFull(
    bundle.band,
    arrangement,
    bundle.harmonic,
    instrumentation,
    bundle.timebase,
    bundle.seedRng,
    undefined,
    undefined,
    intent,
    undefined,
    score,
  );
}

function hostileBassIntent(bundle: ReturnType<typeof buildSongBundle>) {
  const intent = deriveMusicIntentPlan(bundle.band.style, bundle.arrangement);
  return {
    ...intent,
    sections: intent.sections.map((section) => ({
      ...section,
      bassPatternSchedule: section.bassPatternSchedule
        ? {
          ...section.bassPatternSchedule,
          slots: section.bassPatternSchedule.slots.map((slot) => ({ ...slot, family: 'walking' as const })),
        }
        : undefined,
    })),
  };
}

type FinalTrack = ReturnType<typeof renderSongFull>['ir']['tracks'][number];

function trackOf(rendered: ReturnType<typeof renderSongFull>, role: PianoRole): FinalTrack {
  const track = rendered.ir.tracks.find((candidate) => candidate.role === role);
  expect(track, `${role} track`).toBeDefined();
  if (!track) throw new Error(`missing ${role} track`);
  return track;
}

function noteSnapshot(track: { notes: readonly TrackIR['notes'][number][] }) {
  return track.notes.map((note) => ({
    pitch: note.pitch as number,
    startTick: note.startTick as number,
    durationTicks: note.durationTicks as number,
    velocity: note.velocity,
  }));
}

function trioSnapshot(rendered: ReturnType<typeof renderSongFull>) {
  return Object.fromEntries(PIANO_ROLES.map((role) => [role, noteSnapshot(trackOf(rendered, role))]));
}

/**
 * An external lead is deliberately not part of the immutable PianoScorePlan.
 * Put one unmistakable note at each section boundary so the ordinary presence
 * gate has observable material to admit/drop without changing the score-owned
 * comp and bass fixtures.
 */
function overrideLeadAcrossSections(bundle: ReturnType<typeof buildSongBundle>): TrackIR {
  const beatsPerBar = bundle.timebase.meter.numerator * (4 / bundle.timebase.meter.denominator);
  let sectionStartBeat = 0;
  return {
    role: 'lead',
    notes: bundle.arrangement.sections.map((section, index) => {
      const note = {
        pitch: midi(72 + (index % 3) * 2),
        startTick: bundle.timebase.beatToTick(beats(sectionStartBeat)),
        durationTicks: ticks(Math.max(1, Math.round(bundle.timebase.ppq * 0.75))),
        velocity: 88,
      };
      sectionStartBeat += section.bars * beatsPerBar;
      return note;
    }),
  };
}

function cloneAsSentinelTacetScore(
  score: AcgPianoScorePlan,
  bundle: ReturnType<typeof buildSongBundle>,
): { score: AcgPianoScorePlan; targetSpanId: string; event: AcgPianoCompEvent } {
  const harmonicSpanById = new Map(bundle.harmonic.chordTimeline.map((span) => [span.id, span]));
  const target = Object.values(score.spanById)
    .map((directive) => ({ directive, harmonic: harmonicSpanById.get(directive.spanId) }))
    .find(({ harmonic }) => harmonic && (harmonic.durationBeats as number) >= 1.2);
  expect(target, 'fixture needs one scored harmonic span long enough for a sentinel event').toBeDefined();
  if (!target?.harmonic) throw new Error('missing sentinel harmonic span');

  // The deliberately off-grid onset is not a valid output of the ordinary
  // score builder.  Every other score span becomes a real tacet; this catches
  // a coordinator that silently discards the supplied score and rebuilds one.
  const event: AcgPianoCompEvent = {
    id: 'test:authoritative-sentinel',
    gesture: 'block',
    atBeat: 0.377,
    durationBeats: 0.31,
    voices: 'upper-dyad',
    attack: 'simultaneous',
    velocity: 0.29,
    harmonicTarget: 'current',
    role: 'arrival',
  };
  const spanById = Object.fromEntries(Object.entries(score.spanById).map(([spanId, directive]) => {
    const harmonic = harmonicSpanById.get(spanId);
    if (!harmonic) throw new Error(`missing harmonic span ${spanId}`);
    const isTarget = spanId === target.directive.spanId;
    return [spanId, {
      ...directive,
      comp: isTarget
        ? { ...directive.comp, gesture: 'block' as const, events: [event], silenceWindows: [] }
        : {
          ...directive.comp,
          gesture: 'tacet' as const,
          events: [],
          silenceWindows: [{ startBeat: 0, endBeat: harmonic.durationBeats as number, reason: 'phrase-breath' as const }],
        },
    }];
  })) as AcgPianoScorePlan['spanById'];

  return { score: { ...score, spanById }, targetSpanId: target.directive.spanId, event };
}

function hostileGenericArrangement(bundle: ReturnType<typeof buildSongBundle>): ArrangementPlan {
  const rolePerformanceBySection = {
    ...bundle.arrangement.rolePerformanceBySection,
  } as Record<string, Record<string, Record<string, unknown>>>;
  for (const role of PIANO_ROLES) {
    rolePerformanceBySection[role] = Object.fromEntries(bundle.arrangement.sections.map((section, index) => {
      const current = bundle.arrangement.rolePerformanceBySection[role]?.[section.id] ?? {};
      return [section.id, {
        ...current,
        // The gate would delay the opening and delete every later section if
        // these late generic contracts reached the scored piano hands.
        entryMode: index === 0 ? 'delayed' : 'dropout',
        densityBudget: 0,
        active: true,
      }];
    }));
  }
  return {
    ...bundle.arrangement,
    rolePerformanceBySection,
    openingGesture: {
      ...bundle.arrangement.openingGesture,
      roleDelayBars: {
        ...bundle.arrangement.openingGesture.roleDelayBars,
        lead: 99,
        comp: 99,
        bass: 99,
      },
    },
  } as unknown as ArrangementPlan;
}

function hostileColdEndingInstrumentation(bundle: ReturnType<typeof buildSongBundle>): InstrumentationPlan {
  const outro = bundle.arrangement.sections.at(-1);
  expect(outro, 'fixture needs an outro section').toBeDefined();
  if (!outro) throw new Error('missing outro section');
  return {
    ...bundle.instrumentation,
    endingPlan: {
      ...bundle.instrumentation.endingPlan,
      style: 'cold',
      outroSectionId: outro.id,
      outroBars: outro.bars,
      exitBarByRole: { bass: 0, comp: 0, lead: 0 },
      holdFinalChord: false,
      fadeOut: false,
      coldStop: true,
    },
  } as unknown as InstrumentationPlan;
}

describe('render/acgPianoScoreOwnershipBoundary · supplied score remains authoritative', () => {
  it('executes a supplied sentinel/tacet score instead of silently rebuilding the deterministic fallback', () => {
    const bundle = buildSongBundle({ seed: 1, styleHint: 'acg', mood: 'lyrical', targetDuration: 90 });
    const { score, targetSpanId, event } = cloneAsSentinelTacetScore(scoreOf(bundle), bundle);
    const supplied = renderWithScore(bundle, score);
    const fallback = renderWithScore(bundle);
    const targetSpan = bundle.harmonic.chordTimeline.find((span) => span.id === targetSpanId);
    expect(targetSpan, 'sentinel must map to a harmonic span').toBeDefined();
    if (!targetSpan) throw new Error('missing sentinel target span');
    const sentinelTick = bundle.timebase.beatToTick(beats((targetSpan.startBeat as number) + event.atBeat)) as number;
    const suppliedComp = trackOf(supplied, 'comp');
    const fallbackComp = trackOf(fallback, 'comp');
    const sentinelNotes = suppliedComp.notes.filter((note) => (note.startTick as number) === sentinelTick);

    expect(sentinelNotes, 'the custom dyad must reach the final IR at its authored score tick').toHaveLength(2);
    expect(
      new Set(suppliedComp.notes.map((note) => note.startTick as number)),
      'all other supplied score spans are true tacets, never renderer fallback rhythm',
    ).toEqual(new Set([sentinelTick]));
    expect(
      fallbackComp.notes.some((note) => (note.startTick as number) !== sentinelTick),
      'without the supplied plan, normal deterministic score generation has its own comp material',
    ).toBe(true);
  });

  it('keeps the scored piano trio byte-for-byte intact under hostile generic gate and cold-ending inputs', () => {
    const bundle = buildSongBundle({ seed: 1, styleHint: 'acg', mood: 'lyrical', targetDuration: 90 });
    const score = scoreOf(bundle);
    const baseline = renderWithScore(bundle, score);
    const hostileArrangement = hostileGenericArrangement(bundle);
    const hostileInstrumentation = hostileColdEndingInstrumentation(bundle);
    const hostile = renderWithScore(bundle, score, hostileArrangement, hostileInstrumentation);
    const baselineTrio = PIANO_ROLES.map((role) => {
      const source = trackOf(baseline, role);
      return { ...source, notes: source.notes.map((note) => ({ ...note })) } as TrackIR;
    });

    // Guard the fixture: the late transforms are genuinely hostile, not a
    // vacuous comparison that would also pass if their inputs had no effect.
    const genericallyGated = gateByDensity(
      baselineTrio,
      bundle.harmonic,
      bundle.timebase,
      bundle.instrumentation.activeRolesBySection,
      {
        rolePerformanceBySection: hostileArrangement.rolePerformanceBySection,
        openingGesture: hostileArrangement.openingGesture,
        forceImmediateOpeningRoles: new Set<TrackIR['role']>(['bass']),
        preserveLeadPresence: true,
      },
    );
    expect(genericallyGated.map(noteSnapshot), 'dropout/delay gate must be destructive outside the ACG score boundary')
      .not.toEqual(baselineTrio.map(noteSnapshot));
    const coldEnded = applyEnding(
      baselineTrio,
      hostileArrangement,
      hostileInstrumentation.endingPlan,
      bundle.timebase.ppq,
      bundle.timebase.meter.numerator * (4 / bundle.timebase.meter.denominator),
    );
    expect(coldEnded.map(noteSnapshot), 'cold ending must be destructive outside the ACG score boundary')
      .not.toEqual(baselineTrio.map(noteSnapshot));

    expect(trioSnapshot(hostile)).toEqual(trioSnapshot(baseline));
  });

  it('does not let a generic bass floor append notes after the PianoScorePlan is complete', () => {
    const bundle = buildSongBundle({ seed: 1, styleHint: 'acg', mood: 'lyrical', targetDuration: 90 });
    const score = scoreOf(bundle);
    const baseline = renderWithScore(bundle, score);
    const hostileIntent = hostileBassIntent(bundle);
    const hostile = renderWithScore(bundle, score, bundle.arrangement, bundle.instrumentation, hostileIntent);
    const baselineBass = trackOf(baseline, 'bass');
    const genericWouldMutate = applyBassPatternSchedule(
      {
        role: 'bass',
        notes: baselineBass.notes.map((note) => ({ ...note })),
        program: baselineBass.program,
      },
      bundle.harmonic,
      bundle.arrangement.sections,
      hostileIntent,
      bundle.timebase.meter.numerator * (4 / bundle.timebase.meter.denominator),
      bundle.timebase.ppq,
    );

    expect(noteSnapshot(genericWouldMutate), 'fixture must prove that the hostile generic schedule is not a no-op')
      .not.toEqual(noteSnapshot(baselineBass));
    expect(noteSnapshot(trackOf(hostile, 'bass')), 'score-owned bass ignores the later generic floor')
      .toEqual(noteSnapshot(baselineBass));
  });

  it('routes an external override lead through the legacy gate while score-owned comp/bass stay protected', () => {
    const bundle = buildSongBundle({ seed: 1, styleHint: 'acg', mood: 'lyrical', targetDuration: 90 });
    const score = scoreOf(bundle);
    const overrideLead = overrideLeadAcrossSections(bundle);
    const baseline = renderSongFull(
      bundle.band,
      bundle.arrangement,
      bundle.harmonic,
      bundle.instrumentation,
      bundle.timebase,
      bundle.seedRng,
      undefined,
      overrideLead,
      deriveMusicIntentPlan(bundle.band.style, bundle.arrangement),
      undefined,
      score,
    );
    const hostileArrangement = hostileGenericArrangement(bundle);
    const hostile = renderSongFull(
      bundle.band,
      hostileArrangement,
      bundle.harmonic,
      bundle.instrumentation,
      bundle.timebase,
      bundle.seedRng,
      undefined,
      overrideLead,
      deriveMusicIntentPlan(bundle.band.style, hostileArrangement),
      undefined,
      score,
    );

    const firstSection = bundle.arrangement.sections[0];
    expect(firstSection, 'fixture needs a first section').toBeDefined();
    if (!firstSection) throw new Error('missing first section');
    const beatsPerBar = bundle.timebase.meter.numerator * (4 / bundle.timebase.meter.denominator);
    const firstSectionEndTick = bundle.timebase.beatToTick(beats(firstSection.bars * beatsPerBar)) as number;
    const baselineLead = trackOf(baseline, 'lead');
    const hostileLead = trackOf(hostile, 'lead');
    const expectedAdmittedLead = noteSnapshot(baselineLead)
      .filter((note) => note.startTick < firstSectionEndTick);

    expect(noteSnapshot(baselineLead).some((note) => note.startTick >= firstSectionEndTick), 'fixture must include later override entries').toBe(true);
    expect(noteSnapshot(hostileLead), 'override lead follows delayed/dropout gate, unlike score-owned hands')
      .toEqual(expectedAdmittedLead);
    expect(noteSnapshot(trackOf(hostile, 'comp')), 'score-owned comp bypasses the external lead gate').toEqual(noteSnapshot(trackOf(baseline, 'comp')));
    expect(noteSnapshot(trackOf(hostile, 'bass')), 'score-owned bass bypasses the external lead gate').toEqual(noteSnapshot(trackOf(baseline, 'bass')));
  });
});
