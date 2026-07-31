import { describe, expect, it } from 'vitest';
import { pc } from '../foundation';
import { buildSongBundle, generateSongFromBundle, type SongBundle } from '../generation/GenerationController';
import { harmonicPlanToMgChordDefs } from './mgChordDefAdapter';
import { buildChordPart, getCurrentChordAtBeat, type ChordPart } from './mgChordPart';
import { expandGrammarForBrick } from './mgGrammarRuntime';
import { fallbackTokensForBrick } from './mgAdvisor';
import { scheduleAcgCycleCadencePhrases } from './mgAcgCycleScheduler';
import { makeSeededRng } from './mgRng';
import { ACG_PIANOSONG_INTERNAL_GRAMMARS, acgPianoSongGrammarForContext } from '../knowledge/melodyStyleGrammarProfiles';
import { renderMgMelody } from './mgLeadRenderer';
import type { ScheduledToken } from './mgTokenScheduler';
import { hashSeedToInt } from '../../../../state/MusicGenerationSeedStore';

const FULL_SONG_SEEDS = [0, 3, 7, 11, 42, 99] as const;
const TRACE_SEEDS = Array.from({ length: 32 }, (_, index) => index);
const FAILURE_SWEEP_SEEDS = Array.from({ length: 32 }, (_, index) => index);

type ProductionAcgTrace = {
  bundle: SongBundle;
  part: ChordPart;
  scheduled: ScheduledToken[];
};

function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

function isStructuralAcgBeat(beat: number, chordStartBeat: number, part: ChordPart): boolean {
  const [numerator, denominator] = part.meter;
  const beatsPerBar = numerator * (4 / denominator);
  const tolerance = 0.09;
  if (Number.isFinite(beatsPerBar) && beatsPerBar > 0) {
    const phase = ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar;
    if (Math.min(Math.abs(phase), Math.abs(phase - beatsPerBar / 2), Math.abs(phase - beatsPerBar)) <= tolerance) return true;
  }
  return Math.abs(beat - chordStartBeat) <= tolerance;
}

function isOrdinaryStructuralAcgCarrier(entry: ScheduledToken, part: ChordPart): boolean {
  const token = entry.token;
  if (entry.acgReturn || token.kind === 'R' || token.kind === 'SlopeEnter' || token.kind === 'SlopeExit') return false;
  if (token.kind === 'A' || token.kind === 'Triadic') return false;
  if (token.kind === 'G' || token.kind === 'B' || token.duration >= 0.75 - 1e-4) return true;
  const chord = getCurrentChordAtBeat(part, entry.startBeat);
  return !!chord && isStructuralAcgBeat(entry.startBeat, chord.startBeat, part);
}

/**
 * This is a trace of the actual ACG lead entrypoint, not a hand-authored
 * ScheduledToken fixture.  It intentionally follows renderMgMelody's real
 * RoadMap → arranger phrase overlay → internal grammar bank → scheduler
 * inputs so semantic assertions remain attached to generated song material.
 */
function traceProductionAcgLead(
  seed: number,
  request: { mood?: 'lyrical' | 'build'; targetDuration?: number; mode?: 'major' | 'minor' } = {},
): ProductionAcgTrace {
  const bundle = buildSongBundle({
    seed,
    styleHint: 'acg',
    mood: request.mood ?? 'lyrical',
    targetDuration: request.targetDuration ?? 90,
    key: pc(0),
    mode: request.mode ?? 'minor',
  });
  const part = buildChordPart(
    harmonicPlanToMgChordDefs(bundle.harmonic),
    [bundle.timebase.meter.numerator, bundle.timebase.meter.denominator],
  );
  const score = bundle.acgPianoScorePlan;
  if (!score?.roadMap) throw new Error('ACG production bundle must carry its factual RoadMap score binding');
  const roadMap = score.roadMap;
  const rng = makeSeededRng(seed);
  const expansions = roadMap.bricks.map((brick, brickIndex) => ({
    brickIndex,
    brick,
    tokens: expandGrammarForBrick((() => {
      const phrase = Object.values(score.phraseById).find((candidate) =>
        brick.startBeat >= candidate.startBeat - 1e-4 && brick.startBeat < candidate.endBeat - 1e-4,
      );
      return phrase
        ? ACG_PIANOSONG_INTERNAL_GRAMMARS[phrase.lead.grammarSubset]
        : acgPianoSongGrammarForContext({
          startBeat: brick.startBeat,
          durationBeats: brick.durationBeats,
          family: brick.family,
          name: brick.name,
        });
    })(), { brick, rng }),
  }));
  for (const expansion of expansions) {
    if (expansion.tokens.length === 0) expansion.tokens = fallbackTokensForBrick(expansion.brick);
  }
  return {
    bundle,
    part,
    scheduled: scheduleAcgCycleCadencePhrases(
      expansions,
      part,
      { leadPresencePlan: score.leadPresencePlan, pianoScorePlan: score },
    ),
  };
}

function pedalDownAt(events: readonly { atTick: unknown; down: boolean }[] | undefined, atTick: number): boolean {
  let down = false;
  for (const event of events ?? []) {
    if (Number(event.atTick) > atTick) break;
    down = event.down;
  }
  return down;
}

/** Final-score invariant: do not leave a lone short top note before piano air. */
function exposedShortLeadLeaks(trace: ProductionAcgTrace): Array<{ startBeat: number; durationBeats: number; gapBeats: number }> {
  const generated = generateSongFromBundle(trace.bundle);
  if (generated.status === 'failed' || !generated.ir) throw new Error('ACG production generation failed during continuity audit.');
  const ppq = trace.bundle.timebase.ppq as number;
  const pianoNotes = generated.ir.tracks
    .filter((track) => track.role === 'lead' || track.role === 'comp' || track.role === 'bass')
    .flatMap((track) => track.notes.map((note) => ({
      role: track.role,
      startBeat: (note.startTick as number) / ppq,
      durationBeats: (note.durationTicks as number) / ppq,
    })));
  const lead = pianoNotes.filter((note) => note.role === 'lead');
  const epsilon = 1e-4;
  const leaks: Array<{ startBeat: number; durationBeats: number; gapBeats: number }> = [];
  for (const note of lead) {
    if (note.durationBeats > 0.5 + epsilon) continue;
    if (lead.filter((other) => Math.abs(other.startBeat - note.startBeat) <= epsilon).length !== 1) continue;
    const noteEnd = note.startBeat + note.durationBeats;
    // A deliberately materialized approach → arrival, or two hand-legato
    // atoms with a one-tick overlap, is one connected top-line gesture. It is
    // not piano air simply because the successor begins at (or barely before)
    // the first key's release; the final atom in that gesture is audited on
    // its own iteration.
    const hasConnectedLeadContinuation = lead.some((other) => other !== note
      && other.startBeat > note.startBeat + epsilon
      && other.startBeat <= noteEnd + epsilon
      && other.startBeat + other.durationBeats >= noteEnd - epsilon);
    if (hasConnectedLeadContinuation) continue;
    const nextOnset = pianoNotes
      .filter((other) => other.startBeat > noteEnd + epsilon)
      .map((other) => other.startBeat)
      .sort((left, right) => left - right)[0] ?? trace.part.totalBeats;
    const gapBeats = nextOnset - noteEnd;
    if (gapBeats >= 1.25 - epsilon) leaks.push({
      startBeat: note.startBeat,
      durationBeats: note.durationBeats,
      gapBeats,
    });
  }
  return leaks;
}

describe('render/acgProductionE2E · generated ACG PIANOSONG main chain', () => {
  it('keeps the 7mz3vb lyrical single as a written half-note, including its b9 cadence suspension', () => {
    const seed = hashSeedToInt('7mz3vb');
    expect(seed).toBe(1678954363);
    const trace = traceProductionAcgLead(seed, { mood: 'build', targetDuration: 120 });
    const ppq = trace.bundle.timebase.ppq;
    const breath = trace.scheduled.find((entry) => entry.token.acg?.sustain?.kind === 'breath');
    const suspension = trace.scheduled.find((entry) => entry.token.acg?.sustain?.kind === 'dominant-b9');

    // The first return is a written half note on the Arranger's shared piano
    // clock.  Do not pin this to the former 5.875-beat local scheduler phase:
    // BASS, COMP and LEAD now identify the same score-owned metric anchor.
    expect(breath).toBeDefined();
    const breathAnchor = trace.bundle.acgPianoScorePlan?.metricGrid.anchors
      .find((anchor) => anchor.id === breath!.acgMetricAnchorId);
    expect(breathAnchor).toBeDefined();
    expect(breath!.startBeat).toBeCloseTo(breathAnchor!.beat, 6);
    expect(breath!.startBeat / 0.25).toBeCloseTo(Math.round(breath!.startBeat / 0.25), 6);
    expect(breath!.acgMetricRole).toBe('structural');
    expect(breath!.token.duration).toBeGreaterThanOrEqual(2);
    expect(breath!.acgReturn?.role).toBe('arrival');

    // A pre-dominant stable tone is intentionally held as the following
    // dominant's b9, then the next grammar carrier resolves it. This is a
    // scheduler-issued exception to the ordinary chord-boundary clip, not a
    // generic cross-chord tail.
    expect(suspension).toBeDefined();
    expect(suspension!.startBeat).toBeCloseTo(23.5, 6);
    expect(suspension!.token.duration).toBeGreaterThanOrEqual(2);
    const suspensionContract = suspension!.token.acg?.sustain;
    expect(suspensionContract?.kind).toBe('dominant-b9');
    if (!suspensionContract || suspensionContract.kind !== 'dominant-b9') {
      throw new Error('Expected the 7mz3vb cadence carrier to carry a dominant-b9 contract.');
    }
    const dominant = trace.part.blocks[suspensionContract.targetChordIndex];
    expect(dominant).toBeDefined();
    expect(suspensionContract).toMatchObject({
      kind: 'dominant-b9', targetChordIndex: dominant!.index,
      continuationPc: (dominant!.rootPc + 1) % 12,
    });

    const sourceLead = renderMgMelody(
      trace.bundle.harmonic,
      trace.bundle.band,
      trace.bundle.timebase,
      seed,
      trace.bundle.instrumentation.roleProgram.lead,
      trace.bundle.arrangement.songGrooveContract,
      trace.bundle.acgPianoScorePlan?.leadPresencePlan,
      trace.bundle.acgPianoScorePlan,
    );
    // The former 1/8-beat C at 7.875 was a boundary-clipped fragment directly
    // after this held arrival, not an intended riff. It is now an explicit R.
    expect(sourceLead.notes.some((note) => Math.abs((note.startTick as number) / ppq - 7.875) < 1e-6)).toBe(false);
    const writtenSuspension = sourceLead.notes.find((note) =>
      Math.abs((note.startTick as number) / ppq - suspension!.startBeat) < 1e-6);
    expect(writtenSuspension).toBeDefined();
    expect(pitchClass(writtenSuspension!.pitch as number)).toBe((dominant!.rootPc + 1) % 12);
    expect((writtenSuspension!.durationTicks as number) / ppq).toBeGreaterThanOrEqual(2);

    const generated = generateSongFromBundle(trace.bundle);
    expect(generated.status).not.toBe('failed');
    const finalLead = generated.ir!.tracks.find((track) => track.role === 'lead')!;
    const finalSuspension = finalLead.notes.find((note) =>
      Math.abs((note.startTick as number) / ppq - suspension!.startBeat) < 1e-6);
    expect(finalSuspension).toBeDefined();
    const boundaryTick = 24 * ppq;
    expect(finalSuspension!.startTick as number).toBeLessThan(boundaryTick);
    expect((finalSuspension!.startTick as number) + (finalSuspension!.durationTicks as number)).toBeGreaterThan(boundaryTick);
    // The score's re-pedal remains active while the key is still down.
    expect(pedalDownAt(finalLead.pedalEvents, finalSuspension!.startTick as number)).toBe(true);
    expect(pedalDownAt(finalLead.pedalEvents, boundaryTick)).toBe(true);
  });

  it('does not leave unclassified short lead singles before a real piano breath', () => {
    // 114/157/170/273/303 were confirmed leaked examples before the
    // continuity-slot compiler. The compact sweep ensures the rule is not a
    // one-seed repair while keeping test time appropriate for the main chain.
    const cases = [
      {
        id: 'minor/lyrical/90',
        request: { mood: 'lyrical' as const, targetDuration: 90, mode: 'minor' as const },
        seeds: [...new Set([
          ...Array.from({ length: 64 }, (_, index) => index),
          114, 157, 170, 273, 303,
        ])],
      },
      {
        id: 'major/build/120',
        request: { mood: 'build' as const, targetDuration: 120, mode: 'major' as const },
        seeds: Array.from({ length: 32 }, (_, index) => index),
      },
    ];
    const leaks = cases.flatMap(({ id, request, seeds }) => seeds.flatMap((seed) =>
      exposedShortLeadLeaks(traceProductionAcgLead(seed, request))
        .map((leak) => ({ case: id, seed, ...leak }))));
    expect(leaks).toEqual([]);
  });

  it('renders several real ACG seeds without failing and retains the three piano roles', () => {
    for (const seed of FULL_SONG_SEEDS) {
      const trace = traceProductionAcgLead(seed);
      const result = generateSongFromBundle(trace.bundle);
      expect(result.status, `seed ${seed} should not fail`).not.toBe('failed');
      expect(result.ir, `seed ${seed} final IR`).toBeDefined();

      for (const role of ['bass', 'comp', 'lead'] as const) {
        const track = result.ir!.tracks.find((candidate) => candidate.role === role);
        expect(track, `seed ${seed} ${role} track`).toBeDefined();
        expect(track!.notes.length, `seed ${seed} ${role} notes`).toBeGreaterThan(0);
      }
    }
  });

  it('stays generation-safe across a compact major/minor seed sweep', () => {
    for (const mode of ['major', 'minor'] as const) {
      for (const seed of FAILURE_SWEEP_SEEDS) {
        const bundle = buildSongBundle({
          seed,
          styleHint: 'acg',
          mood: 'build',
          targetDuration: 96,
          key: pc(0),
          mode,
        });
        const result = generateSongFromBundle(bundle);
        expect(result.status, `${mode} seed ${seed} should not fail`).not.toBe('failed');
        expect(result.ir?.tracks.find((track) => track.role === 'lead')?.notes.length, `${mode} seed ${seed} lead`).toBeGreaterThan(0);
      }
    }
  });

  it('does not audit score-authored ACG piano air as an unplanned comp dropout', () => {
    for (const seed of Array.from({ length: 16 }, (_, index) => index)) {
      const bundle = buildSongBundle({
        seed,
        styleHint: 'acg',
        mood: 'lyrical',
        targetDuration: 90,
        key: pc(0),
        mode: 'minor',
      });
      const result = generateSongFromBundle(bundle);
      const continuityFindings = result.report.findings.filter((finding) => finding.ruleId === 'comp-continuity-gap');
      expect(continuityFindings, `seed ${seed} written comp silence is not a continuity defect`).toHaveLength(0);
    }
  });

  it('materializes generated return semantics, including a color approach or grammar-issued dyad', () => {
    let returnArrivals = 0;
    let materializedColorResolutions = 0;
    let materializedDyads = 0;

    for (const seed of TRACE_SEEDS) {
      const trace = traceProductionAcgLead(seed);
      const sourceLead = renderMgMelody(
        trace.bundle.harmonic,
        trace.bundle.band,
        trace.bundle.timebase,
        seed,
        trace.bundle.instrumentation.roleProgram.lead,
        trace.bundle.arrangement.songGrooveContract,
        trace.bundle.acgPianoScorePlan?.leadPresencePlan,
        trace.bundle.acgPianoScorePlan,
      );

      const byGesture = new Map<string, ScheduledToken[]>();
      for (const entry of trace.scheduled) {
        if (!entry.acgReturn) continue;
        const group = byGesture.get(entry.acgReturn.gestureId) ?? [];
        group.push(entry);
        byGesture.set(entry.acgReturn.gestureId, group);
      }

      for (const entries of byGesture.values()) {
        const arrival = entries.find((entry) => entry.acgReturn?.role === 'arrival');
        if (!arrival?.acgReturn) continue;
        const intent = arrival.acgReturn;
        const targetChord = trace.part.blocks[intent.targetChordIndex];
        expect(targetChord, `seed ${seed} return target chord`).toBeDefined();
        expect(targetChord!.stableTonePcs).toContain(intent.targetPc);
        expect(targetChord!.chordScalePcs).toContain(intent.targetPc);
        expect(intent.stableRoles).toContain(intent.targetRole);
        expect(arrival.token.acg?.harmonicScope).toBe(intent.harmonicScope);
        expect(arrival.token.acg?.stableRoles).toEqual(intent.stableRoles);
        returnArrivals++;

        const arrivalTick = Math.round(arrival.startBeat * trace.bundle.timebase.ppq);
        const arrivalNotes = sourceLead.notes.filter((note) => (note.startTick as number) === arrivalTick);
        const targetArrival = arrivalNotes.find((note) => pitchClass(note.pitch as number) === intent.targetPc);
        expect(
          targetArrival,
          `seed ${seed} return target must reach its scheduled stable pc`,
        ).toBeDefined();

        if (intent.dyad) {
          expect(arrivalNotes.some((note) => pitchClass(note.pitch as number) === intent.dyad!.partnerPc)).toBe(true);
          materializedDyads++;
        }

        const colorApproach = entries.find((entry) => entry.acgReturn?.role === 'approach' && entry.acgReturn.colorIntent);
        if (colorApproach?.acgReturn) {
          const approachTick = Math.round(colorApproach.startBeat * trace.bundle.timebase.ppq);
          const approachNotes = sourceLead.notes.filter((note) => (note.startTick as number) === approachTick);
          // A malformed/obsolete approach is intentionally fail-closed by the
          // realizer. Count only the returns whose generated source lead kept
          // the full color → stable-arrival pair.
          if (approachNotes.length === 0) continue;
          expect(
            approachNotes.some((note) => Math.abs((note.pitch as number) - (targetArrival!.pitch as number)) <= (colorApproach.acgReturn!.approachSemitones ?? 2)),
            `seed ${seed} color approach resolves into the paired arrival`,
          ).toBe(true);
          materializedColorResolutions++;
        }
      }
    }

    expect(returnArrivals, 'real generated ACG material should contain return arrivals').toBeGreaterThan(0);
    expect(
      materializedColorResolutions + materializedDyads,
      'at least one generated return must realize a color approach or a dyad',
    ).toBeGreaterThan(0);
  });

  it('issues ordinary stable anchors and borrowed/dyad sidecars as exact token contracts', () => {
    let ordinaryAnchors = 0;
    let checkedBorrowedApproaches = 0;
    let checkedArrivals = 0;

    for (const seed of FULL_SONG_SEEDS) {
      const trace = traceProductionAcgLead(seed);
      for (let index = 0; index < trace.scheduled.length; index++) {
        const entry = trace.scheduled[index]!;
        if (isOrdinaryStructuralAcgCarrier(entry, trace.part)) {
          expect(entry.token.acg?.harmonicScope, `seed ${seed} ordinary anchor scope`).toBe('current-chord');
          expect(entry.token.acg?.stableRoles.length, `seed ${seed} ordinary anchor roles`).toBeGreaterThan(0);
          ordinaryAnchors++;
        }

        if (entry.acgReturn?.role === 'approach') {
          // Exact equality catches both illegal directions: a sidecar cannot
          // invent a color, and a token-level borrowed color cannot disappear.
          expect(entry.token.acg?.colorIntent).toBe(entry.acgReturn.colorIntent);
          checkedBorrowedApproaches++;
        }
        if (entry.acgReturn?.role === 'arrival') {
          expect(Boolean(entry.token.acg?.dyad)).toBe(Boolean(entry.acgReturn.dyad));
          checkedArrivals++;
        }
      }
    }

    expect(ordinaryAnchors).toBeGreaterThan(0);
    expect(checkedBorrowedApproaches).toBeGreaterThan(0);
    expect(checkedArrivals).toBeGreaterThan(0);
  });
});
