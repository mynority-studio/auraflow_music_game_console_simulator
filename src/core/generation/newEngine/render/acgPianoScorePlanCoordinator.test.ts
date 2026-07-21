import { describe, expect, it } from 'vitest';
import { beats, midi, ticks, type RandomContext, type Rng } from '../foundation';
import { deriveMusicIntentPlan } from '../arranger/deriveMusicIntentPlan';
import { buildSongBundle } from '../generation/GenerationController';
import { applyGestureExpressionToTrack } from '../instrumental/gestureExpression';
import type { TrackIR } from '../ir/MusicalIR';
import { renderSongFull } from './renderCoordinator';

/** Make final coordinator timing observable without changing the score-time RNG streams. */
function zeroHumanizeTiming(base: RandomContext): RandomContext {
  const neutral: Rng = {
    next: () => 0.5,
    int: (maxExclusive) => Math.floor(maxExclusive / 2),
    pick: <T>(xs: readonly T[]) => xs[Math.floor(xs.length / 2)]!,
  };
  return {
    seed: base.seed,
    substream: (name) => name === 'humanize' ? neutral : base.substream(name),
    advance: (name) => zeroHumanizeTiming(base.advance(name)),
  };
}

/** Deliberately maximises only the generic humanize stream for timing regressions. */
function pushedHumanizeTiming(base: RandomContext): RandomContext {
  const pushed: Rng = {
    next: () => 0.999999,
    int: (maxExclusive) => Math.max(0, maxExclusive - 1),
    pick: <T>(xs: readonly T[]) => xs[Math.max(0, xs.length - 1)]!,
  };
  return {
    seed: base.seed,
    substream: (name) => name === 'humanize' ? pushed : base.substream(name),
    advance: (name) => pushedHumanizeTiming(base.advance(name)),
  };
}

function pianoNotes(rendered: ReturnType<typeof renderSongFull>, role: 'lead' | 'comp' | 'bass') {
  const track = rendered.ir.tracks.find((candidate) => candidate.role === role);
  expect(track, `${role} track`).toBeDefined();
  return track!.notes.map((note) => ({
    pitch: note.pitch as number,
    startTick: note.startTick as number,
    durationTicks: note.durationTicks as number,
    velocity: note.velocity,
  }));
}

function pianoTiming(rendered: ReturnType<typeof renderSongFull>, role: 'comp' | 'bass') {
  return pianoNotes(rendered, role).map(({ pitch, startTick, durationTicks }) => ({ pitch, startTick, durationTicks }));
}

function productionScore(bundle: ReturnType<typeof buildSongBundle>) {
  const score = bundle.acgPianoScorePlan;
  expect(score, 'ACG production bundle must carry its immutable PianoScorePlan').toBeDefined();
  if (!score) throw new Error('missing ACG PianoScorePlan');
  return score;
}

function bundleWithPlannedBlockAndTacet() {
  for (const seed of Array.from({ length: 48 }, (_, index) => index)) {
    const bundle = buildSongBundle({ seed, styleHint: 'acg', mood: 'lyrical', targetDuration: 90 });
    const score = productionScore(bundle);
    const directives = Object.values(score.spanById);
    if (directives.some((span) => span.comp.events.some((event) => event.gesture === 'block'))
      && directives.some((span) => span.comp.gesture === 'tacet')) {
      return { bundle, score };
    }
  }
  throw new Error('fixture needs one scored true block and one scored tacet');
}

describe('render/acgPianoScorePlanCoordinator · planned piano timing ownership', () => {
  it('executes the supplied phrase score: a true block stays vertical, a tacet stays empty, and authored timing survives coordinator', () => {
    const { bundle, score } = bundleWithPlannedBlockAndTacet();
    expect(bundle.arrangement.feel.swingRatio).toBeCloseTo(0.5, 6);
    const rendered = renderSongFull(
      bundle.band,
      bundle.arrangement,
      bundle.harmonic,
      bundle.instrumentation,
      bundle.timebase,
      zeroHumanizeTiming(bundle.seedRng),
      undefined,
      undefined,
      deriveMusicIntentPlan(bundle.band.style, bundle.arrangement),
      undefined,
      score,
    );
    const comp = rendered.ir.tracks.find((track) => track.role === 'comp')!;
    const spanById = new Map(bundle.harmonic.chordTimeline.map((span) => [span.id, span]));
    const block = Object.values(score.spanById)
      .flatMap((directive) => directive.comp.events
        .filter((event) => event.gesture === 'block')
        .map((event) => ({ directive, event })))
      .at(0);
    expect(block, 'fixture needs a true block authored by PianoScorePlan').toBeDefined();
    expect(block!.event.attack).toBe('simultaneous');
    expect(block!.event.voices).toBe('all');
    const blockSpan = spanById.get(block!.directive.spanId)!;
    const blockTick = bundle.timebase.beatToTick(beats((blockSpan.startBeat as number) + block!.event.atBeat)) as number;
    const blockNotes = comp.notes.filter((note) => (note.startTick as number) === blockTick);
    expect(blockNotes.length, 'an authored block must remain polyphonic at one exact score tick').toBeGreaterThanOrEqual(2);
    expect(new Set(blockNotes.map((note) => note.pitch as number)).size).toBeGreaterThanOrEqual(2);

    const tacet = Object.values(score.spanById).find((directive) => directive.comp.gesture === 'tacet');
    expect(tacet, 'fixture needs a tacet authored by PianoScorePlan').toBeDefined();
    const tacetSpan = spanById.get(tacet!.spanId)!;
    const tacetStart = bundle.timebase.beatToTick(tacetSpan.startBeat) as number;
    const tacetEnd = bundle.timebase.beatToTick(beats((tacetSpan.startBeat as number) + (tacetSpan.durationBeats as number))) as number;
    expect(comp.notes.some((note) => {
      const start = note.startTick as number;
      const end = start + (note.durationTicks as number);
      return start < tacetEnd && end > tacetStart;
    }), 'a score-authored tacet cannot be filled by a renderer fallback').toBe(false);

    for (const directive of Object.values(score.spanById)) {
      const span = spanById.get(directive.spanId)!;
      for (const event of directive.comp.events) {
        const expectedTick = bundle.timebase.beatToTick(beats((span.startBeat as number) + event.atBeat)) as number;
        expect(
          comp.notes.some((note) => (note.startTick as number) === expectedTick),
          `${directive.spanId} ${event.id} must retain its score-authored onset`,
        ).toBe(true);
      }
    }
  });

  it('keeps all three ACG piano hands out of late gesture NoteIR shaping while retaining pedal and release CC', () => {
    const bundle = buildSongBundle({ seed: 1, styleHint: 'acg', mood: 'lyrical', targetDuration: 90 });
    const baseline = renderSongFull(
      bundle.band,
      bundle.arrangement,
      bundle.harmonic,
      bundle.instrumentation,
      bundle.timebase,
      zeroHumanizeTiming(bundle.seedRng),
      undefined,
      undefined,
      deriveMusicIntentPlan(bundle.band.style, bundle.arrangement),
      undefined,
      productionScore(bundle),
    );
    // These deliberately hostile plans would gate any piano hand if the
    // coordinator handed it to late gesture shaping.
    const hostileInstrumentation = {
      ...bundle.instrumentation,
      gestureExpressionByRole: {
        ...bundle.instrumentation.gestureExpressionByRole,
        lead: {
          ...bundle.instrumentation.gestureExpressionByRole.lead,
          // `phrasePolicy: none` makes the sax branch use its explicit
          // gate, so this is guaranteed to mutate any non-empty lead if it
          // leaks through the ACG score boundary.
          kind: 'sax-breath-legato' as const,
          family: 'sax' as const,
          gateRatio: 0.12,
          phrasePolicy: 'none' as const,
          triggerPolicy: 'velocity-gate' as const,
        },
        comp: {
          ...bundle.instrumentation.gestureExpressionByRole.comp,
          kind: 'keyboard-touch' as const,
          gateRatio: 0.12,
          velocityCurve: 'accented' as const,
        },
        bass: {
          ...bundle.instrumentation.gestureExpressionByRole.bass,
          kind: 'keyboard-touch' as const,
          gateRatio: 0.12,
          velocityCurve: 'accented' as const,
        },
      },
    };
    for (const role of ['lead', 'comp', 'bass'] as const) {
      const baseTrack = baseline.ir.tracks.find((candidate) => candidate.role === role)!;
      const hostileNotes = applyGestureExpressionToTrack(
        {
          role,
          notes: baseTrack.notes.map((note) => ({ ...note })),
          program: baseTrack.program,
        },
        hostileInstrumentation.gestureExpressionByRole[role],
        bundle.timebase,
      ).notes;
      expect(hostileNotes, `${role} hostile gesture must be capable of changing NoteIR`).not.toEqual(baseTrack.notes);
    }
    const protectedRender = renderSongFull(
      bundle.band,
      bundle.arrangement,
      bundle.harmonic,
      hostileInstrumentation,
      bundle.timebase,
      zeroHumanizeTiming(bundle.seedRng),
      undefined,
      undefined,
      deriveMusicIntentPlan(bundle.band.style, bundle.arrangement),
      undefined,
      productionScore(bundle),
    );

    for (const role of ['lead', 'comp', 'bass'] as const) {
      expect(pianoNotes(protectedRender, role), `${role} NoteIR must remain score-owned`).toEqual(pianoNotes(baseline, role));
      const track = protectedRender.ir.tracks.find((candidate) => candidate.role === role)!;
      expect(track.pedalEvents?.length, `${role} keeps piano pedal`).toBeGreaterThan(0);
      expect(track.ccEvents?.some((event) => event.controller === 72 || event.controller === 74), `${role} has no uncalibrated sound-controller write`).not.toBe(true);
    }
  });

  it('does not let the generic interaction resolver delete an authored comp voice around a lead m2', () => {
    const bundle = buildSongBundle({ seed: 1, styleHint: 'acg', mood: 'lyrical', targetDuration: 90 });
    const baseline = renderSongFull(
      bundle.band,
      bundle.arrangement,
      bundle.harmonic,
      bundle.instrumentation,
      bundle.timebase,
      zeroHumanizeTiming(bundle.seedRng),
      undefined,
      undefined,
      deriveMusicIntentPlan(bundle.band.style, bundle.arrangement),
      undefined,
      productionScore(bundle),
    );
    const comp = baseline.ir.tracks.find((track) => track.role === 'comp')!;
    const target = comp.notes.find((note) =>
      (note.durationTicks as number) >= bundle.timebase.ppq / 2 && (note.pitch as number) < 107,
    );
    expect(target, 'the fixture needs a sustained score-authored comp voice').toBeDefined();
    const collidingLead: TrackIR = {
      role: 'lead',
      notes: [{
        pitch: midi((target!.pitch as number) + 1),
        startTick: target!.startTick,
        durationTicks: ticks(Math.max(bundle.timebase.ppq, target!.durationTicks as number)),
        velocity: 88,
      }],
    };
    const collided = renderSongFull(
      bundle.band,
      bundle.arrangement,
      bundle.harmonic,
      bundle.instrumentation,
      bundle.timebase,
      zeroHumanizeTiming(bundle.seedRng),
      undefined,
      collidingLead,
      deriveMusicIntentPlan(bundle.band.style, bundle.arrangement),
      undefined,
      productionScore(bundle),
    );
    const compAfter = collided.ir.tracks.find((track) => track.role === 'comp')!;
    expect(compAfter.notes.some((note) =>
      (note.pitch as number) === (target!.pitch as number)
      && (note.startTick as number) === (target!.startTick as number)
      && (note.durationTicks as number) === (target!.durationTicks as number),
    ), 'ACG score voicings are not deleted by a late collision resolver').toBe(true);
  });

  it('does not move ACG comp/bass onsets through generic humanize or groove-pocket passes', () => {
    const bundle = buildSongBundle({ seed: 1, styleHint: 'acg', mood: 'lyrical', targetDuration: 90 });
    const neutral = renderSongFull(
      bundle.band,
      bundle.arrangement,
      bundle.harmonic,
      bundle.instrumentation,
      bundle.timebase,
      zeroHumanizeTiming(bundle.seedRng),
      undefined,
      undefined,
      deriveMusicIntentPlan(bundle.band.style, bundle.arrangement),
      undefined,
      productionScore(bundle),
    );
    const pushed = renderSongFull(
      bundle.band,
      bundle.arrangement,
      bundle.harmonic,
      bundle.instrumentation,
      bundle.timebase,
      pushedHumanizeTiming(bundle.seedRng),
      undefined,
      undefined,
      deriveMusicIntentPlan(bundle.band.style, bundle.arrangement),
      undefined,
      productionScore(bundle),
    );
    expect(pianoTiming(pushed, 'comp'), 'comp rolls stay at their score-authored ticks').toEqual(pianoTiming(neutral, 'comp'));
    expect(pianoTiming(pushed, 'bass'), 'bass root anchors stay at their score-authored ticks').toEqual(pianoTiming(neutral, 'bass'));

    const exaggeratedPocketArrangement = {
      ...bundle.arrangement,
      songGrooveContract: {
        ...bundle.arrangement.songGrooveContract,
        bassPocketMs: [96, 96] as [number, number],
      },
    };
    const pocketed = renderSongFull(
      bundle.band,
      exaggeratedPocketArrangement,
      bundle.harmonic,
      bundle.instrumentation,
      bundle.timebase,
      zeroHumanizeTiming(bundle.seedRng),
      undefined,
      undefined,
      deriveMusicIntentPlan(bundle.band.style, exaggeratedPocketArrangement),
      undefined,
      productionScore(bundle),
    );
    expect(pianoTiming(pocketed, 'bass'), 'bass pocket cannot offset a pre-scored ACG root').toEqual(pianoTiming(neutral, 'bass'));
  });
});
