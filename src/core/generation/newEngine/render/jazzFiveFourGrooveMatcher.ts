// ============================================================
// newEngine · render · Jazz 5/4 Gate-G groove matcher
// ------------------------------------------------------------
// A read-only machine gate between the immutable post-harmony score and
// FinalIR. It never repairs, quantizes or reassigns notes. Reference mode also
// compares both layers with the embedded MIDI-derived canonical rhythm cells,
// so a mutually-wrong Score/FinalIR pair cannot pass by identity alone.
// ============================================================

import type {
  JazzFiveFourScorePlan,
  JazzFiveFourScoreRole,
} from '../arranger/jazzFiveFourScorePlan';
import type { MusicalIR, TrackIR } from '../ir/MusicalIR';
import {
  JAZZ_FIVE_FOUR_CORE_KEEP_TIME,
  jazzFiveFourDrumPhaseTicks,
} from '../knowledge/jazzFiveFourDrumKnowledge';
import {
  JAZZ_FIVE_FOUR_ACOUSTIC_BASS_CELLS,
  JAZZ_FIVE_FOUR_PIANO_FOUNDATION_CELLS,
  JAZZ_FIVE_FOUR_ROLE_BAR_TICKS,
  JAZZ_FIVE_FOUR_ROLE_ENGINE_PPQ,
  JAZZ_FIVE_FOUR_ROLE_GROUP_BOUNDARY_TICKS,
  JAZZ_FIVE_FOUR_UPPER_COMP_CELLS,
  type JazzFiveFourRoleCell,
} from '../knowledge/jazzFiveFourRoleKnowledge';

type GrooveOwnedRole = Exclude<JazzFiveFourScoreRole, 'lead'>;
const OWNED_ROLES: readonly GrooveOwnedRole[] = ['bass', 'comp', 'drum'];
const REFERENCE_DRUM_TRIGGER_TICKS = 10;
export const JAZZ_FIVE_FOUR_REFERENCE_TEMPO_BPM = 60_000_000 / 359_281;
const REFERENCE_TEMPO_TOLERANCE = 1e-9;

interface RenderedNoteLike {
  readonly pitch: number;
  readonly startTick: number;
  readonly durationTicks: number;
  readonly velocity: number;
}

interface RenderedTrackLike {
  readonly role: string;
  readonly notes: readonly RenderedNoteLike[];
}

interface NormalizedRenderedEvent {
  key: string;
  role: JazzFiveFourScoreRole;
  tick: number;
  durationTicks: number;
  pitch: number;
  velocity: number;
}

interface ExpectedEvent {
  eventId: string;
  role: JazzFiveFourScoreRole;
  tick: number;
  durationTicks: number;
  pitch: number;
  velocity: number;
}

interface EventPair {
  expected: ExpectedEvent;
  actual: NormalizedRenderedEvent;
}

export interface JazzFiveFourRoleBarSignature {
  role: JazzFiveFourScoreRole;
  absoluteBar: number;
  sectionId?: string;
  expectedPhaseSignature: readonly number[];
  actualPhaseSignature: readonly number[];
  /** phase|pitch|duration|velocity, preserving duplicate chord/hit events. */
  expectedEventSignature: readonly string[];
  actualEventSignature: readonly string[];
  matches: boolean;
}

export type JazzFiveFourChangedField =
  | 'tick'
  | 'durationTicks'
  | 'pitch'
  | 'velocity';

export interface JazzFiveFourChangedEvent {
  expectedEventId: string;
  actualEventKey: string;
  role: JazzFiveFourScoreRole;
  changedFields: readonly JazzFiveFourChangedField[];
  expected: Omit<ExpectedEvent, 'eventId' | 'role'>;
  actual: Omit<NormalizedRenderedEvent, 'key' | 'role'>;
}

export interface JazzFiveFourScoreDelta {
  expectedCount: number;
  actualCount: number;
  /** Full signatures are role|absoluteTick|duration|pitch|velocity. */
  missingSignatures: readonly string[];
  unexpectedSignatures: readonly string[];
  changedEvents: readonly JazzFiveFourChangedEvent[];
  isIdentity: boolean;
}

export interface JazzFiveFourTimingLinkViolation {
  linkId: string;
  kind: 'exact' | 'flam';
  reasons: readonly (
    | 'missing-member'
    | 'relative-offset-changed'
    | 'residual-budget-exceeded'
  )[];
  memberEventIds: readonly string[];
  expectedAnchorTick: number;
  actualTicks: readonly number[];
  residualTicks: readonly number[];
}

export interface JazzFiveFourBarDriftViolation {
  role: JazzFiveFourScoreRole;
  sectionId: string;
  expectedAbsoluteBar: number;
  expectedBarStartTick: number;
  observedAbsoluteBars: readonly number[];
  tickDeltas: readonly number[];
  phaseDeltas: readonly number[];
  eventIds: readonly string[];
}

export interface JazzFiveFourDrumTriggerViolation {
  actualEventKey: string;
  tick: number;
  pitch: number;
  expectedDurationTicks: 10;
  actualDurationTicks: number;
}

export interface JazzFiveFourReferenceViolation {
  layer: 'score' | 'final-ir';
  role: JazzFiveFourScoreRole;
  sectionId: string;
  absoluteBar: number;
  /** phase|duration|velocity; pitch is separately covered by score identity. */
  expectedRhythmSignature: readonly string[];
  actualRhythmSignature: readonly string[];
}

export interface JazzFiveFourGrooveMatchIssue {
  code:
    | 'clock'
    | 'score-final-delta'
    | 'timing-link-exact'
    | 'timing-link-flam'
    | 'bar-drift'
    | 'drum-trigger-duration'
    | 'reference-phase-gate-velocity';
  message: string;
}

export interface JazzFiveFourGrooveMatchReport {
  pass: boolean;
  clockViolations: readonly string[];
  roleBarSignatures: readonly JazzFiveFourRoleBarSignature[];
  scoreDelta: JazzFiveFourScoreDelta;
  timingLinkViolations: readonly JazzFiveFourTimingLinkViolation[];
  barDriftViolations: readonly JazzFiveFourBarDriftViolation[];
  drumTriggerViolations: readonly JazzFiveFourDrumTriggerViolation[];
  referenceViolations: readonly JazzFiveFourReferenceViolation[];
  issues: readonly JazzFiveFourGrooveMatchIssue[];
}

export type JazzFiveFourGrooveMatcherInput = MusicalIR | readonly TrackIR[];

function isOwnedRole(role: string): role is GrooveOwnedRole {
  return OWNED_ROLES.includes(role as GrooveOwnedRole);
}

function grooveRoleOrder(role: JazzFiveFourScoreRole): number {
  return OWNED_ROLES.indexOf(role as GrooveOwnedRole);
}

function tracksOf(input: JazzFiveFourGrooveMatcherInput): readonly RenderedTrackLike[] {
  if (Array.isArray(input)) return input as readonly RenderedTrackLike[];
  return (input as MusicalIR).tracks as readonly RenderedTrackLike[];
}

function musicalIrOf(input: JazzFiveFourGrooveMatcherInput): MusicalIR | undefined {
  return Array.isArray(input) ? undefined : input as MusicalIR;
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function renderedEvents(input: JazzFiveFourGrooveMatcherInput): NormalizedRenderedEvent[] {
  const result: NormalizedRenderedEvent[] = [];
  tracksOf(input).forEach((track, trackIndex) => {
    if (!isOwnedRole(track.role)) return;
    const role = track.role;
    track.notes.forEach((note, noteIndex) => {
      result.push({
        key: `${role}:track-${trackIndex}:note-${noteIndex}`,
        role,
        tick: Number(note.startTick),
        durationTicks: Number(note.durationTicks),
        pitch: Number(note.pitch),
        velocity: Number(note.velocity),
      });
    });
  });
  return result.sort((left, right) =>
    left.tick - right.tick
    || grooveRoleOrder(left.role) - grooveRoleOrder(right.role)
    || left.pitch - right.pitch
    || left.durationTicks - right.durationTicks
    || left.velocity - right.velocity);
}

function expectedEvents(plan: JazzFiveFourScorePlan): ExpectedEvent[] {
  return plan.performance.events.filter((event) => isOwnedRole(event.role)).map((event) => ({
    eventId: event.eventId,
    role: event.role,
    tick: event.tick,
    durationTicks: event.durationTicks,
    pitch: event.pitch,
    velocity: event.velocity,
  })).sort((left, right) =>
    left.tick - right.tick
    || grooveRoleOrder(left.role) - grooveRoleOrder(right.role)
    || left.pitch - right.pitch
    || left.durationTicks - right.durationTicks
    || left.velocity - right.velocity
    || left.eventId.localeCompare(right.eventId));
}

function fullEventSignature(event: ExpectedEvent | NormalizedRenderedEvent): string {
  return `${event.role}|${event.tick}|${event.durationTicks}|${event.pitch}|${event.velocity}`;
}

function barEventSignature(
  event: ExpectedEvent | NormalizedRenderedEvent,
  ticksPerBar: number,
): string {
  const phase = positiveModulo(event.tick, ticksPerBar);
  return `${phase}|${event.pitch}|${event.durationTicks}|${event.velocity}`;
}

function multisetDifference(left: readonly string[], right: readonly string[]): string[] {
  const rightCount = new Map<string, number>();
  for (const value of right) rightCount.set(value, (rightCount.get(value) ?? 0) + 1);
  const remaining: string[] = [];
  for (const value of left) {
    const count = rightCount.get(value) ?? 0;
    if (count > 0) rightCount.set(value, count - 1);
    else remaining.push(value);
  }
  return remaining.sort();
}

function pairingCost(expected: ExpectedEvent, actual: NormalizedRenderedEvent): number {
  return Math.abs(expected.tick - actual.tick) * 1_000_000
    + Math.abs(expected.pitch - actual.pitch) * 10_000
    + Math.abs(expected.durationTicks - actual.durationTicks) * 100
    + Math.abs(expected.velocity - actual.velocity);
}

/**
 * NoteIR intentionally carries no score event id. Exact events are paired
 * first, then remaining events use the nearest same-role/same-pitch candidate.
 * Multiset delta remains authoritative; pairing only adds actionable field and
 * timing-link diagnostics.
 */
function pairEvents(
  expected: readonly ExpectedEvent[],
  actual: readonly NormalizedRenderedEvent[],
): { pairs: EventPair[]; actualByExpectedId: Map<string, NormalizedRenderedEvent> } {
  const usedActual = new Set<number>();
  const pairedExpected = new Set<string>();
  const pairs: EventPair[] = [];
  const actualByExpectedId = new Map<string, NormalizedRenderedEvent>();
  const exactBuckets = new Map<string, number[]>();

  actual.forEach((event, index) => {
    const signature = fullEventSignature(event);
    exactBuckets.set(signature, [...(exactBuckets.get(signature) ?? []), index]);
  });

  for (const event of expected) {
    const bucket = exactBuckets.get(fullEventSignature(event));
    const actualIndex = bucket?.shift();
    if (actualIndex === undefined) continue;
    const candidate = actual[actualIndex]!;
    usedActual.add(actualIndex);
    pairedExpected.add(event.eventId);
    pairs.push({ expected: event, actual: candidate });
    actualByExpectedId.set(event.eventId, candidate);
  }

  for (const event of expected) {
    if (pairedExpected.has(event.eventId)) continue;
    const sameRole = actual
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate, index }) => !usedActual.has(index) && candidate.role === event.role);
    if (sameRole.length === 0) continue;
    const samePitch = sameRole.filter(({ candidate }) => candidate.pitch === event.pitch);
    const pool = samePitch.length > 0 ? samePitch : sameRole;
    pool.sort((left, right) =>
      pairingCost(event, left.candidate) - pairingCost(event, right.candidate)
      || left.index - right.index);
    const selected = pool[0]!;
    usedActual.add(selected.index);
    pairedExpected.add(event.eventId);
    pairs.push({ expected: event, actual: selected.candidate });
    actualByExpectedId.set(event.eventId, selected.candidate);
  }

  return { pairs, actualByExpectedId };
}

function changedEvents(pairs: readonly EventPair[]): JazzFiveFourChangedEvent[] {
  const result: JazzFiveFourChangedEvent[] = [];
  for (const { expected, actual } of pairs) {
    const fields: JazzFiveFourChangedField[] = [];
    if (expected.tick !== actual.tick) fields.push('tick');
    if (expected.durationTicks !== actual.durationTicks) fields.push('durationTicks');
    if (expected.pitch !== actual.pitch) fields.push('pitch');
    if (expected.velocity !== actual.velocity) fields.push('velocity');
    if (fields.length === 0) continue;
    result.push({
      expectedEventId: expected.eventId,
      actualEventKey: actual.key,
      role: expected.role,
      changedFields: fields,
      expected: {
        tick: expected.tick,
        durationTicks: expected.durationTicks,
        pitch: expected.pitch,
        velocity: expected.velocity,
      },
      actual: {
        tick: actual.tick,
        durationTicks: actual.durationTicks,
        pitch: actual.pitch,
        velocity: actual.velocity,
      },
    });
  }
  return result.sort((left, right) =>
    left.expected.tick - right.expected.tick
    || left.expectedEventId.localeCompare(right.expectedEventId));
}

function roleBarSignatures(
  plan: JazzFiveFourScorePlan,
  expected: readonly ExpectedEvent[],
  actual: readonly NormalizedRenderedEvent[],
): JazzFiveFourRoleBarSignature[] {
  const ticksPerBar = plan.clock.ticksPerBar;
  const sectionByRoleBar = new Map<string, string>();
  for (const bar of [...plan.roleBars, ...plan.drumBars]) {
    sectionByRoleBar.set(`${bar.role}|${bar.absoluteBar}`, bar.sectionId);
  }
  const bars = new Set<number>();
  for (let absoluteBar = 0; absoluteBar < plan.clock.totalBars; absoluteBar++) bars.add(absoluteBar);
  for (const event of actual) bars.add(Math.floor(event.tick / ticksPerBar));

  const result: JazzFiveFourRoleBarSignature[] = [];
  for (const absoluteBar of [...bars].sort((left, right) => left - right)) {
    for (const role of OWNED_ROLES) {
      const expectedInBar = expected.filter((event) =>
        event.role === role && Math.floor(event.tick / ticksPerBar) === absoluteBar);
      const actualInBar = actual.filter((event) =>
        event.role === role && Math.floor(event.tick / ticksPerBar) === absoluteBar);
      const expectedPhaseSignature = uniqueSorted(expectedInBar.map((event) =>
        positiveModulo(event.tick, ticksPerBar)));
      const actualPhaseSignature = uniqueSorted(actualInBar.map((event) =>
        positiveModulo(event.tick, ticksPerBar)));
      const expectedEventSignature = expectedInBar.map((event) =>
        barEventSignature(event, ticksPerBar)).sort();
      const actualEventSignature = actualInBar.map((event) =>
        barEventSignature(event, ticksPerBar)).sort();
      result.push({
        role,
        absoluteBar,
        sectionId: sectionByRoleBar.get(`${role}|${absoluteBar}`),
        expectedPhaseSignature,
        actualPhaseSignature,
        expectedEventSignature,
        actualEventSignature,
        matches: arraysEqual(expectedEventSignature, actualEventSignature),
      });
    }
  }
  return result;
}

function timingLinkViolations(
  plan: JazzFiveFourScorePlan,
  actualByExpectedId: ReadonlyMap<string, NormalizedRenderedEvent>,
): JazzFiveFourTimingLinkViolation[] {
  const result: JazzFiveFourTimingLinkViolation[] = [];
  for (const link of plan.timingLinks) {
    const present = link.members.map((member) => ({
      member,
      actual: actualByExpectedId.get(member.eventId),
    }));
    const reasons = new Set<JazzFiveFourTimingLinkViolation['reasons'][number]>();
    if (present.some(({ actual }) => !actual)) reasons.add('missing-member');
    const actualTicks = present.flatMap(({ actual }) => actual ? [actual.tick] : []);
    const residualTicks = present.flatMap(({ member, actual }) =>
      actual ? [actual.tick - (link.anchorNominalTick + member.offsetTicks)] : []);
    if (new Set(residualTicks).size > 1) reasons.add('relative-offset-changed');
    if (residualTicks.some((residual) => Math.abs(residual) > link.residualPolicy.maxAbsTicks)) {
      reasons.add('residual-budget-exceeded');
    }
    if (reasons.size === 0) continue;
    result.push({
      linkId: link.id,
      kind: link.kind,
      reasons: [...reasons],
      memberEventIds: link.members.map((member) => member.eventId),
      expectedAnchorTick: link.anchorNominalTick,
      actualTicks,
      residualTicks,
    });
  }
  return result;
}

function barDriftViolations(
  plan: JazzFiveFourScorePlan,
  pairs: readonly EventPair[],
): JazzFiveFourBarDriftViolation[] {
  const ticksPerBar = plan.clock.ticksPerBar;
  const instrumentById = new Map(plan.instrumentEvents.map((event) => [event.eventId, event] as const));
  const groups = new Map<string, EventPair[]>();
  for (const pair of pairs) {
    if (pair.expected.tick === pair.actual.tick) continue;
    const instrument = instrumentById.get(pair.expected.eventId);
    const absoluteBar = instrument?.absoluteBar ?? Math.floor(pair.expected.tick / ticksPerBar);
    const sectionId = instrument?.sectionId ?? 'unknown';
    const key = `${pair.expected.role}|${sectionId}|${absoluteBar}`;
    groups.set(key, [...(groups.get(key) ?? []), pair]);
  }

  return [...groups.values()].map((group) => {
    const first = group[0]!;
    const instrument = instrumentById.get(first.expected.eventId);
    const expectedAbsoluteBar = instrument?.absoluteBar
      ?? Math.floor(first.expected.tick / ticksPerBar);
    return {
      role: first.expected.role,
      sectionId: instrument?.sectionId ?? 'unknown',
      expectedAbsoluteBar,
      expectedBarStartTick: expectedAbsoluteBar * ticksPerBar,
      observedAbsoluteBars: uniqueSorted(group.map(({ actual }) => Math.floor(actual.tick / ticksPerBar))),
      tickDeltas: uniqueSorted(group.map(({ expected, actual }) => actual.tick - expected.tick)),
      phaseDeltas: uniqueSorted(group.map(({ expected, actual }) =>
        positiveModulo(actual.tick, ticksPerBar) - positiveModulo(expected.tick, ticksPerBar))),
      eventIds: group.map(({ expected }) => expected.eventId).sort(),
    };
  }).sort((left, right) =>
    left.expectedAbsoluteBar - right.expectedAbsoluteBar
    || grooveRoleOrder(left.role) - grooveRoleOrder(right.role));
}

interface RhythmTriple {
  phaseTick: number;
  durationTicks: number;
  velocity: number;
}

function rhythmSignature(cells: readonly RhythmTriple[]): string[] {
  return [...cells]
    .sort((left, right) =>
      left.phaseTick - right.phaseTick
      || left.durationTicks - right.durationTicks
      || left.velocity - right.velocity)
    .map((cell) => `${cell.phaseTick}|${cell.durationTicks}|${cell.velocity}`);
}

function roleCellRhythm(
  events: readonly JazzFiveFourRoleCell[],
): RhythmTriple[] {
  return events.map((event) => ({
    phaseTick: event.phase.engineTicks,
    durationTicks: event.duration.engineTicks,
    velocity: event.velocity,
  }));
}

const PIANO_FOUNDATION_REFERENCE = roleCellRhythm(JAZZ_FIVE_FOUR_PIANO_FOUNDATION_CELLS);
const PIANO_UPPER_REFERENCE = roleCellRhythm(JAZZ_FIVE_FOUR_UPPER_COMP_CELLS);
const ACOUSTIC_BASS_REFERENCE = roleCellRhythm(JAZZ_FIVE_FOUR_ACOUSTIC_BASS_CELLS);
const DRUM_REFERENCE: RhythmTriple[] = JAZZ_FIVE_FOUR_CORE_KEEP_TIME.hits.map((hit) => ({
  phaseTick: jazzFiveFourDrumPhaseTicks(hit.phaseBeats),
  durationTicks: hit.gate.referenceTicks,
  velocity: hit.velocity,
}));

function canonicalRhythmForRole(
  plan: JazzFiveFourScorePlan,
  role: GrooveOwnedRole,
): readonly RhythmTriple[] {
  if (role === 'drum') return DRUM_REFERENCE;
  if (role === 'bass') {
    return plan.foundationMode === 'keyboard-foundation'
      ? PIANO_FOUNDATION_REFERENCE
      : ACOUSTIC_BASS_REFERENCE;
  }
  return plan.foundationMode === 'acoustic-bass+full-piano'
    ? [...PIANO_FOUNDATION_REFERENCE, ...PIANO_UPPER_REFERENCE]
    : PIANO_UPPER_REFERENCE;
}

function referenceViolations(
  plan: JazzFiveFourScorePlan,
  expected: readonly ExpectedEvent[],
  actual: readonly NormalizedRenderedEvent[],
): JazzFiveFourReferenceViolation[] {
  if (plan.compilationMode !== 'canonical-reference') return [];
  const ticksPerBar = plan.clock.ticksPerBar;
  const result: JazzFiveFourReferenceViolation[] = [];
  const bars = [...plan.roleBars.filter((bar) => isOwnedRole(bar.role)), ...plan.drumBars];

  for (const bar of bars) {
    if (!isOwnedRole(bar.role)) continue;
    const canonical = bar.active ? rhythmSignature(canonicalRhythmForRole(plan, bar.role)) : [];
    const scoreCells = expected
      .filter((event) => event.role === bar.role && Math.floor(event.tick / ticksPerBar) === bar.absoluteBar)
      .map((event) => ({
        phaseTick: positiveModulo(event.tick, ticksPerBar),
        durationTicks: event.durationTicks,
        velocity: event.velocity,
      }));
    const finalCells = actual
      .filter((event) => event.role === bar.role && Math.floor(event.tick / ticksPerBar) === bar.absoluteBar)
      .map((event) => ({
        phaseTick: positiveModulo(event.tick, ticksPerBar),
        durationTicks: event.durationTicks,
        velocity: event.velocity,
      }));
    const scoreSignature = rhythmSignature(scoreCells);
    const finalSignature = rhythmSignature(finalCells);
    if (!arraysEqual(canonical, scoreSignature)) {
      result.push({
        layer: 'score', role: bar.role, sectionId: bar.sectionId, absoluteBar: bar.absoluteBar,
        expectedRhythmSignature: canonical, actualRhythmSignature: scoreSignature,
      });
    }
    if (!arraysEqual(canonical, finalSignature)) {
      result.push({
        layer: 'final-ir', role: bar.role, sectionId: bar.sectionId, absoluteBar: bar.absoluteBar,
        expectedRhythmSignature: canonical, actualRhythmSignature: finalSignature,
      });
    }
  }
  return result;
}

function clockViolations(
  plan: JazzFiveFourScorePlan,
  input: JazzFiveFourGrooveMatcherInput,
): string[] {
  const result: string[] = [];
  if (plan.clock.ppq !== JAZZ_FIVE_FOUR_ROLE_ENGINE_PPQ) {
    result.push(`Score PPQ ${plan.clock.ppq} != canonical PPQ ${JAZZ_FIVE_FOUR_ROLE_ENGINE_PPQ}`);
  }
  if (plan.clock.meter.numerator !== 5 || plan.clock.meter.denominator !== 4) {
    result.push(`Score meter ${plan.clock.meter.numerator}/${plan.clock.meter.denominator} != canonical meter 5/4`);
  }
  if (plan.clock.ticksPerBar !== JAZZ_FIVE_FOUR_ROLE_BAR_TICKS) {
    result.push(`Score bar ${plan.clock.ticksPerBar} ticks != canonical ${JAZZ_FIVE_FOUR_ROLE_BAR_TICKS}`);
  }
  if (plan.clock.groupBoundaryTick !== JAZZ_FIVE_FOUR_ROLE_GROUP_BOUNDARY_TICKS) {
    result.push(
      `Score group boundary ${plan.clock.groupBoundaryTick} != canonical ${JAZZ_FIVE_FOUR_ROLE_GROUP_BOUNDARY_TICKS}`,
    );
  }
  if (plan.clock.grouping[0] !== 3 || plan.clock.grouping[1] !== 2) {
    result.push(`Score grouping ${plan.clock.grouping.join('+')} != canonical 3+2`);
  }
  if (plan.clock.barOriginPolicy !== 'song-global') {
    result.push(`Score bar origin ${plan.clock.barOriginPolicy} != song-global`);
  }
  const ir = musicalIrOf(input);
  if (!ir) return result;
  if (ir.timebase.ppq !== plan.clock.ppq) {
    result.push(`FinalIR PPQ ${ir.timebase.ppq} != score PPQ ${plan.clock.ppq}`);
  }
  if (
    ir.timebase.meter.numerator !== plan.clock.meter.numerator
    || ir.timebase.meter.denominator !== plan.clock.meter.denominator
  ) {
    result.push(
      `FinalIR meter ${ir.timebase.meter.numerator}/${ir.timebase.meter.denominator}`
      + ` != score meter ${plan.clock.meter.numerator}/${plan.clock.meter.denominator}`,
    );
  }
  const firstTempo = ir.timebase.tempoMap[0];
  if (!firstTempo || Number(firstTempo.atBeat) !== 0) {
    result.push('FinalIR reference tempo must begin at beat 0');
  } else if (Math.abs(firstTempo.bpm - JAZZ_FIVE_FOUR_REFERENCE_TEMPO_BPM) > REFERENCE_TEMPO_TOLERANCE) {
    result.push(
      `FinalIR reference tempo ${firstTempo.bpm} != canonical ${JAZZ_FIVE_FOUR_REFERENCE_TEMPO_BPM}`,
    );
  }
  return result;
}

/** Produce the complete Gate-G machine report without mutating either layer. */
export function matchJazzFiveFourGroove(
  plan: JazzFiveFourScorePlan,
  input: JazzFiveFourGrooveMatcherInput,
): JazzFiveFourGrooveMatchReport {
  const expected = expectedEvents(plan);
  const actual = renderedEvents(input);
  const expectedSignatures = expected.map(fullEventSignature).sort();
  const actualSignatures = actual.map(fullEventSignature).sort();
  const missingSignatures = multisetDifference(expectedSignatures, actualSignatures);
  const unexpectedSignatures = multisetDifference(actualSignatures, expectedSignatures);
  const pairing = pairEvents(expected, actual);
  const changes = changedEvents(pairing.pairs);
  const scoreDelta: JazzFiveFourScoreDelta = {
    expectedCount: expected.length,
    actualCount: actual.length,
    missingSignatures,
    unexpectedSignatures,
    changedEvents: changes,
    isIdentity: missingSignatures.length === 0 && unexpectedSignatures.length === 0,
  };
  const clocks = clockViolations(plan, input);
  const links = timingLinkViolations(plan, pairing.actualByExpectedId);
  const drift = barDriftViolations(plan, pairing.pairs);
  const drumTriggers: JazzFiveFourDrumTriggerViolation[] = plan.compilationMode === 'canonical-reference'
    ? actual
      .filter((event) => event.role === 'drum' && event.durationTicks !== REFERENCE_DRUM_TRIGGER_TICKS)
      .map((event) => ({
        actualEventKey: event.key,
        tick: event.tick,
        pitch: event.pitch,
        expectedDurationTicks: REFERENCE_DRUM_TRIGGER_TICKS,
        actualDurationTicks: event.durationTicks,
      }))
    : [];
  const reference = referenceViolations(plan, expected, actual);
  const issues: JazzFiveFourGrooveMatchIssue[] = [];
  for (const message of clocks) issues.push({ code: 'clock', message });
  if (!scoreDelta.isIdentity) {
    issues.push({
      code: 'score-final-delta',
      message: `Score/FinalIR differ: ${missingSignatures.length} missing, ${unexpectedSignatures.length} unexpected events`,
    });
  }
  for (const violation of links) {
    issues.push({
      code: violation.kind === 'exact' ? 'timing-link-exact' : 'timing-link-flam',
      message: `${violation.linkId}: ${violation.reasons.join(', ')}`,
    });
  }
  for (const violation of drift) {
    issues.push({
      code: 'bar-drift',
      message: `${violation.role} ${violation.sectionId} bar ${violation.expectedAbsoluteBar}: tick delta ${violation.tickDeltas.join('/')}`,
    });
  }
  if (drumTriggers.length > 0) {
    issues.push({
      code: 'drum-trigger-duration',
      message: `${drumTriggers.length} reference Drum trigger(s) are not 10 ticks`,
    });
  }
  for (const violation of reference) {
    issues.push({
      code: 'reference-phase-gate-velocity',
      message: `${violation.layer} ${violation.role} ${violation.sectionId} bar ${violation.absoluteBar} differs from canonical phase/gate/velocity`,
    });
  }

  return {
    pass: issues.length === 0,
    clockViolations: clocks,
    roleBarSignatures: roleBarSignatures(plan, expected, actual),
    scoreDelta,
    timingLinkViolations: links,
    barDriftViolations: drift,
    drumTriggerViolations: drumTriggers,
    referenceViolations: reference,
    issues,
  };
}

/** Fail closed at a production/test boundary while returning the report on success. */
export function assertJazzFiveFourGrooveMatch(
  plan: JazzFiveFourScorePlan,
  input: JazzFiveFourGrooveMatcherInput,
): JazzFiveFourGrooveMatchReport {
  const report = matchJazzFiveFourGroove(plan, input);
  if (!report.pass) {
    const details = report.issues.slice(0, 12).map((issue) => `${issue.code}: ${issue.message}`).join('\n');
    const remaining = report.issues.length > 12 ? `\n... ${report.issues.length - 12} more issue(s)` : '';
    throw new Error(`Jazz 5/4 Gate G failed:\n${details}${remaining}`);
  }
  return report;
}
