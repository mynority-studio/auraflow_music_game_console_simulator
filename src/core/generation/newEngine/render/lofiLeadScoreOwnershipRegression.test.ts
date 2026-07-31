import { describe, expect, it } from 'vitest';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import { MOTIF_POLICY_REPEAT_GROUP } from '../arranger/arrangementArchetypeContract';
import { deriveMusicIntentPlan } from '../arranger/deriveMusicIntentPlan';
import { beats, midi, pc, ticks } from '../foundation';
import { buildSongBundle } from '../generation/GenerationController';
import type { HarmonicPlan } from '../harmony/HarmonicPlan';
import type { TrackIR } from '../ir/MusicalIR';
import type { MgLeadDebugCapture } from './mgLeadRenderer';
import type { MgNoteEvent } from './mgMelodyRealizer';
import { leadAvoidExposureResolver, renderSongFull } from './renderCoordinator';
import { applyRepeatGroupReplay, planRepeatGroupReplays } from './repeatGroupReplay';

const REQUEST = {
  seed: 73,
  styleHint: 'lofi',
  mood: 'build',
  targetDuration: 120,
  key: pc(0),
} as const;

type Bundle = ReturnType<typeof buildSongBundle>;
type FinalLead = ReturnType<typeof renderSongFull>['ir']['tracks'][number];

interface LeadEventSnapshot {
  readonly pitch: number;
  readonly startTick: number;
  readonly durationTicks: number;
}

function lofiScoreOf(bundle: Bundle) {
  const score = bundle.lofiLeadScorePlan;
  expect(score, 'LOFI production fixture must supply LofiLeadScorePlan').toBeDefined();
  if (!score) throw new Error('missing LOFI LeadScorePlan');
  return score;
}

function leadOf(rendered: ReturnType<typeof renderSongFull>): FinalLead {
  const lead = rendered.ir.tracks.find((track) => track.role === 'lead');
  expect(lead, 'render must include a lead track').toBeDefined();
  if (!lead) throw new Error('missing lead track');
  return lead;
}

function noteSnapshot(notes: readonly TrackIR['notes'][number][]): LeadEventSnapshot[] {
  return notes
    .map((note) => ({
      pitch: note.pitch as number,
      startTick: note.startTick as number,
      durationTicks: note.durationTicks as number,
    }))
    .sort((left, right) => left.startTick - right.startTick
      || left.pitch - right.pitch
      || left.durationTicks - right.durationTicks);
}

function timingSnapshot(notes: readonly LeadEventSnapshot[]) {
  return notes
    .map((note) => ({ startTick: note.startTick, durationTicks: note.durationTicks }))
    .sort((left, right) => left.startTick - right.startTick || left.durationTicks - right.durationTicks);
}

function rawScoreSnapshot(events: readonly MgNoteEvent[], bundle: Bundle): LeadEventSnapshot[] {
  return events
    .filter((event) => event.part === 'melody' && event.duration > 0)
    .map((event) => ({
      pitch: Math.round(event.noteNumber),
      startTick: bundle.timebase.beatToTick(beats(event.time)) as number,
      durationTicks: bundle.timebase.beatToTick(beats(Math.max(0.01, event.duration))) as number,
    }))
    .sort((left, right) => left.startTick - right.startTick
      || left.pitch - right.pitch
      || left.durationTicks - right.durationTicks);
}

function hasSamePitchCollision(notes: readonly LeadEventSnapshot[]): boolean {
  const ordered = [...notes].sort((left, right) => left.startTick - right.startTick || left.pitch - right.pitch);
  for (let index = 0; index < ordered.length; index++) {
    const current = ordered[index]!;
    const end = current.startTick + current.durationTicks;
    for (let later = index + 1; later < ordered.length; later++) {
      const candidate = ordered[later]!;
      if (candidate.startTick >= end) break;
      if (candidate.pitch === current.pitch) return true;
    }
  }
  return false;
}

function renderScoreOwned(
  bundle: Bundle,
  options: { arrangement?: ArrangementPlan; harmonic?: HarmonicPlan } = {},
) {
  const arrangement = options.arrangement ?? bundle.arrangement;
  const harmonic = options.harmonic ?? bundle.harmonic;
  const debugCapture: MgLeadDebugCapture = {};
  const rendered = renderSongFull(
    bundle.band,
    arrangement,
    harmonic,
    bundle.instrumentation,
    bundle.timebase,
    bundle.seedRng,
    undefined,
    undefined,
    deriveMusicIntentPlan(bundle.band.style, arrangement),
    undefined,
    bundle.acgPianoScorePlan,
    bundle.jazzFiveFourScorePlan,
    debugCapture,
    lofiScoreOf(bundle),
  );
  const raw = debugCapture.grammarEvents;
  expect(raw, 'score-time debug capture must be populated before NoteIR').toBeDefined();
  if (!raw) throw new Error('missing score-time lead capture');
  return { rendered, raw, lead: leadOf(rendered) };
}

function repeatHostileArrangement(bundle: Bundle): ArrangementPlan {
  // LOFI normally has no resolved archetype because its loop form does not
  // need generic melody replay.  Supplying this policy forces the exact
  // legacy replay call site; score-owned lead must remain untouched.
  return {
    ...bundle.arrangement,
    resolvedArchetype: {
      schemaVersion: 1,
      id: 'test:force-repeat-group-after-score',
      sectionPolicyById: {},
      motifPolicyId: MOTIF_POLICY_REPEAT_GROUP,
      boundaryPolicyId: 'boundary.planned.v1',
    },
  } as unknown as ArrangementPlan;
}

function hostileAvoidPlan(bundle: Bundle, spanId: string, avoidedPc: number): HarmonicPlan {
  return {
    ...bundle.harmonic,
    // The score realizer consumes stableToneMap ∩ chordScaleMap.  It does not
    // use avoidNoteMap to choose this score-owned stable carrier, while the
    // legacy late resolver does. This lets the test make resolver mutation
    // observable without changing the scheduled score material.
    avoidNoteMap: {
      ...bundle.harmonic.avoidNoteMap,
      [spanId]: [...new Set([...(bundle.harmonic.avoidNoteMap[spanId] ?? []), pc(((Math.round(avoidedPc) % 12) + 12) % 12)])],
    },
  } as HarmonicPlan;
}

function spanAtBeat(bundle: Bundle, beat: number) {
  return bundle.harmonic.chordTimeline.find((span) => {
    const start = span.startBeat as number;
    return beat >= start - 1e-6 && beat < start + (span.durationBeats as number) - 1e-6;
  });
}

function auditKeyContext(bundle: Bundle) {
  return {
    keyRootPc: bundle.band.key,
    globalMode: bundle.band.mode,
    isModalContext: bundle.band.tonalityKind === 'modal',
    scaleName: bundle.band.modalModeName,
    tonalCharacter: bundle.band.tonalityKind === 'modal' ? 'modal' as const : 'tonal' as const,
  };
}

describe('render/LOFI score-owned lead · end-to-end ownership', () => {
  it('keeps score-time onset and written duration unchanged through FinalIR when there is no same-pitch collision', () => {
    const bundle = buildSongBundle(REQUEST);
    const { raw, lead } = renderScoreOwned(bundle);
    const scoreTime = rawScoreSnapshot(raw, bundle);
    const final = noteSnapshot(lead.notes);

    expect(scoreTime, 'fixture needs audible score-owned lead atoms').not.toHaveLength(0);
    expect(hasSamePitchCollision(scoreTime), 'this assertion only permits a no-op sanitizer boundary').toBe(false);
    expect(hasSamePitchCollision(final), 'FinalIR must remain MIDI-safe without a repair').toBe(false);
    expect(timingSnapshot(final), 'post-score passes must not move or resize any clean score atom')
      .toEqual(timingSnapshot(scoreTime));
  });

  it('bypasses forced repeat replay and rejects a stale harmony contract instead of rewriting pitch', () => {
    const bundle = buildSongBundle(REQUEST);
    const baseline = renderScoreOwned(bundle);
    const hostileArrangement = repeatHostileArrangement(bundle);
    const replayPlans = planRepeatGroupReplays(hostileArrangement, bundle.harmonic.chordTimeline, bundle.timebase);
    expect(replayPlans, 'LOFI fixture must expose a real repeated loop body').not.toHaveLength(0);

    const replay = replayPlans[0]!;
    const sentinelOffset = Math.max(1, Math.min(Math.round(bundle.timebase.ppq * 0.5), replay.prefixTicks - 2));
    const sentinelDuration = Math.max(1, Math.min(Math.round(bundle.timebase.ppq * 0.75), replay.prefixTicks - sentinelOffset));
    const replaySentinel: TrackIR = {
      role: 'lead',
      notes: [
        // Source body note and a visibly different target body note. The
        // generic replay helper must delete the latter and copy the former.
        { pitch: midi(108), startTick: ticks(replay.sourceStartTick + sentinelOffset), durationTicks: ticks(sentinelDuration), velocity: 88 },
        { pitch: midi(36), startTick: ticks(replay.targetStartTick + sentinelOffset), durationTicks: ticks(sentinelDuration), velocity: 88 },
      ],
    };
    const genericReplay = applyRepeatGroupReplay([replaySentinel], hostileArrangement, bundle.harmonic.chordTimeline, bundle.timebase)[0]!;
    expect(noteSnapshot(genericReplay.notes), 'the forced legacy replay must be destructive outside ownership')
      .not.toEqual(noteSnapshot(replaySentinel.notes));

    const repeatHostile = renderScoreOwned(bundle, { arrangement: hostileArrangement });
    expect(noteSnapshot(repeatHostile.lead.notes), 'score-owned LOFI lead ignores forced generic replay')
      .toEqual(noteSnapshot(baseline.lead.notes));

    const baselineRaw = baseline.raw
      .filter((event) => event.part === 'melody' && event.duration > 0)
      .map((event) => ({ event, span: spanAtBeat(bundle, event.time) }))
      .find(({ event, span }) => {
        if (!span) return false;
        const stable = bundle.harmonic.stableToneMap[span.id] ?? [];
        const scale = new Set((bundle.harmonic.chordScaleMap[span.id] ?? []).map(Number));
        const hasAlternative = stable.some((candidate) => Number(candidate) !== ((Math.round(event.noteNumber) % 12) + 12) % 12
          && (scale.size === 0 || scale.has(Number(candidate))));
        const reachesFinalUnchanged = baseline.lead.notes.some((note) =>
          (note.pitch as number) === Math.round(event.noteNumber)
          && (note.startTick as number) === (bundle.timebase.beatToTick(beats(event.time)) as number)
          && (note.durationTicks as number) === (bundle.timebase.beatToTick(beats(Math.max(0.01, event.duration))) as number));
        return hasAlternative
          && event.duration >= 0.75
          && reachesFinalUnchanged;
      });
    expect(baselineRaw, 'fixture needs a range-safe, structural score carrier with a legal alternative').toBeDefined();
    if (!baselineRaw?.span) throw new Error('missing resolver sentinel');

    const forcedAvoid = hostileAvoidPlan(bundle, baselineRaw.span.id, baselineRaw.event.noteNumber);
    const resolverHostile = renderScoreOwned(bundle, { harmonic: forcedAvoid });
    const expectedStartTick = bundle.timebase.beatToTick(beats(baselineRaw.event.time)) as number;
    const expectedDurationTicks = bundle.timebase.beatToTick(beats(Math.max(0.01, baselineRaw.event.duration))) as number;
    const finalCarrier = resolverHostile.lead.notes.find((note) =>
      (note.startTick as number) === expectedStartTick
      && (note.durationTicks as number) === expectedDurationTicks
      && (note.pitch as number) === Math.round(baselineRaw.event.noteNumber));
    expect(finalCarrier, 'a stale score/harmony pair must fail closed, never be repitched by Render')
      .toBeUndefined();
    const baselineCarrier = baseline.lead.notes.find((note) =>
      (note.startTick as number) === expectedStartTick
      && (note.durationTicks as number) === expectedDurationTicks
      && (note.pitch as number) === Math.round(baselineRaw.event.noteNumber));
    expect(baselineCarrier).toBeDefined();
    if (!baselineCarrier) throw new Error('missing baseline score-owned carrier');

    const resolverWouldRewrite = leadAvoidExposureResolver(
      [{ ...baselineCarrier, pitch: midi(baselineCarrier.pitch as number), startTick: ticks(baselineCarrier.startTick as number), durationTicks: ticks(baselineCarrier.durationTicks as number) }],
      forcedAvoid,
      bundle.timebase,
      () => bundle.instrumentation.roleProgram.lead,
      [],
      auditKeyContext(bundle),
    );
    expect(noteSnapshot(resolverWouldRewrite), 'the hostile generic resolver would change this exact carrier')
      .not.toEqual(noteSnapshot([baselineCarrier]));
  });
});
