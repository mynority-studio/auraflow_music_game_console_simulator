// ============================================================
// newEngine · arranger · ACG shared-piano pedal score
// ------------------------------------------------------------
// The three written roles are one physical piano.  This compiler consumes
// only pre-NoteIR score facts (harmony, PianoScorePlan and scheduled lead
// attacks/rests) and writes one damper performance score for all three hands.
// Instrumentation remains the hardware-capability gate; it no longer owns
// ACG's musical pedal timing.
// ============================================================

import type { HarmonicPlan, ChordSpan } from '../harmony/HarmonicPlan';
import { ACG_PIANO_REST_CONTINUITY_KNOWLEDGE } from '../knowledge/acgPianoContinuityKnowledge';
import type { AcgPianoPedalHold, AcgPianoScorePlan, AcgPianoVoiceSelection } from './acgPianoScorePlan';

const EPSILON = 1e-4;

export type AcgPianoPedalAttackRole = 'bass' | 'comp' | 'lead';

/** Neutral scheduler/score fact. It deliberately contains no MIDI or render type. */
export interface AcgPianoPedalAttackIntent {
  readonly id: string;
  readonly atBeat: number;
  readonly durationBeats: number;
  /** End of a rolled/strummed onset; re-pedal may release only after this beat. */
  readonly captureReadyBeat?: number;
  readonly role: AcgPianoPedalAttackRole;
  readonly voiceCount: number;
  readonly spanId?: string;
  readonly sectionId?: string;
}

export interface AcgPianoPedalRestIntent {
  readonly id: string;
  /** Attack whose resonance owns the beginning of the written air. */
  readonly carrierBeat: number;
  /** Bounded end of the desired resonance, before the following score event. */
  readonly endBeat: number;
  readonly resonance: 'bounded-carry' | 'release';
  /** Explicit lower/middle-hand re-entry authored by the scheduler, when any. */
  readonly reengageBeat?: number;
}

export type AcgPianoPedalTechnique =
  | 'initial-depress'
  | 'delayed-repedal-release'
  | 'delayed-repedal-down'
  | 'breath-release'
  | 'dry-entry-depress'
  | 'fast-run-release'
  | 'final-release';

export interface AcgPianoPedalScoreEvent {
  readonly atBeat: number;
  readonly down: boolean;
  readonly technique: AcgPianoPedalTechnique;
  readonly anchorAttackId?: string;
  readonly sectionId?: string;
}

export interface AcgPianoPedalBoundaryDecision {
  readonly atBeat: number;
  readonly sourceSpanId?: string;
  readonly targetSpanId: string;
  readonly technique: 'carry' | 'delayed-repedal' | 'breath-release' | 'fast-run-release';
  readonly anchorAttackId?: string;
}

export interface AcgPianoPedalScore {
  readonly playerGroup: 'shared-piano';
  readonly attacks: readonly AcgPianoPedalAttackIntent[];
  readonly events: readonly AcgPianoPedalScoreEvent[];
  readonly boundaryDecisions: readonly AcgPianoPedalBoundaryDecision[];
}

function voiceCount(selection: AcgPianoVoiceSelection): number {
  if (selection === 'all') return 4;
  if (selection === 'lower-dyad' || selection === 'upper-dyad') return 2;
  return 1;
}

function scoreAttacks(
  harmonic: HarmonicPlan,
  score: AcgPianoScorePlan,
): AcgPianoPedalAttackIntent[] {
  const spans = new Map(harmonic.chordTimeline.map((span) => [span.id, span]));
  const attacks: AcgPianoPedalAttackIntent[] = [];
  for (const [spanId, directive] of Object.entries(score.spanById)) {
    const span = spans.get(spanId);
    if (!span) continue;
    const base = span.startBeat as number;
    for (const event of directive.comp.events) {
      const atBeat = base + event.atBeat;
      const rolled = event.attack !== 'simultaneous';
      const rollVoiceCount = Math.max(1, Math.min(directive.comp.maxVoices, voiceCount(event.voices)));
      const rollSpread = rolled
        ? Math.min(
          directive.comp.rollSpreadLimitBeats ?? score.metricGrid.rollSpreadLimitBeats,
          directive.comp.rollStepBeats * Math.max(0, rollVoiceCount - 1),
        )
        : 0;
      attacks.push({
        id: `comp:${event.id}`,
        atBeat,
        durationBeats: event.durationBeats,
        captureReadyBeat: atBeat + rollSpread,
        role: 'comp',
        voiceCount: voiceCount(event.voices),
        spanId,
        sectionId: span.sectionId,
      });
    }
    for (const [index, event] of directive.bass.events.entries()) {
      attacks.push({
        id: `bass:${spanId}:${index}`,
        atBeat: base + event.atBeat,
        durationBeats: event.durationBeats,
        role: 'bass',
        voiceCount: 1,
        spanId,
        sectionId: span.sectionId,
      });
    }
  }
  return attacks;
}

function compareAttack(left: AcgPianoPedalAttackIntent, right: AcgPianoPedalAttackIntent): number {
  return left.atBeat - right.atBeat || left.role.localeCompare(right.role) || left.id.localeCompare(right.id);
}

function harmonicIdentity(span: ChordSpan): string {
  return [
    span.rootPc as number,
    span.chordType ?? span.quality,
    span.bassPc as number | undefined,
    span.bassRole,
    span.bassPedalPc as number | undefined,
  ].join('|');
}

function attackGroups(attacks: readonly AcgPianoPedalAttackIntent[]): Array<{
  atBeat: number;
  attacks: AcgPianoPedalAttackIntent[];
  fastRunOnly: boolean;
}> {
  const ordered = [...attacks].sort(compareAttack);
  const runLengthById = new Map<string, number>();
  const maximumIoi = ACG_PIANO_REST_CONTINUITY_KNOWLEDGE.fastRunMaximumIoiBeats;
  const minimumAttacks = ACG_PIANO_REST_CONTINUITY_KNOWLEDGE.fastRunMinimumAttacks;

  for (const role of ['bass', 'comp', 'lead'] as const) {
    const roleAttacks = ordered.filter((attack) => attack.role === role);
    let runStart = 0;
    for (let index = 1; index <= roleAttacks.length; index++) {
      const continues = index < roleAttacks.length
        && roleAttacks[index]!.atBeat - roleAttacks[index - 1]!.atBeat <= maximumIoi + EPSILON;
      if (continues) continue;
      const run = roleAttacks.slice(runStart, index);
      if (run.length >= minimumAttacks) {
        for (const attack of run) runLengthById.set(attack.id, run.length);
      }
      runStart = index;
    }
  }

  const groups: Array<{ atBeat: number; attacks: AcgPianoPedalAttackIntent[]; fastRunOnly: boolean }> = [];
  for (const attack of ordered) {
    const previous = groups.at(-1);
    if (previous && Math.abs(previous.atBeat - attack.atBeat) <= EPSILON) {
      previous.attacks.push(attack);
      previous.fastRunOnly = previous.fastRunOnly && (runLengthById.get(attack.id) ?? 0) >= minimumAttacks;
      continue;
    }
    groups.push({
      atBeat: attack.atBeat,
      attacks: [attack],
      fastRunOnly: (runLengthById.get(attack.id) ?? 0) >= minimumAttacks,
    });
  }
  return groups;
}

function normalizeEvents(events: readonly AcgPianoPedalScoreEvent[]): AcgPianoPedalScoreEvent[] {
  const ordered = [...events].sort((left, right) =>
    left.atBeat - right.atBeat || Number(left.down) - Number(right.down));
  const out: AcgPianoPedalScoreEvent[] = [];
  let state = false;
  for (const event of ordered) {
    if (!Number.isFinite(event.atBeat) || event.atBeat < -EPSILON || event.down === state) continue;
    const previous = out.at(-1);
    if (previous && Math.abs(previous.atBeat - event.atBeat) <= EPSILON) {
      // A score may never hide an off→on transition at one tick. Keep the
      // release and let validation expose the missing later re-entry.
      if (!event.down) out[out.length - 1] = event;
      state = out.at(-1)?.down ?? false;
      continue;
    }
    out.push(event);
    state = event.down;
  }
  return out;
}

function stateAt(events: readonly AcgPianoPedalScoreEvent[], beat: number): boolean {
  let state = false;
  for (const event of events) {
    if (event.atBeat > beat + EPSILON) break;
    state = event.down;
  }
  return state;
}

/**
 * Compile one physical damper lane after all three hands have score-time
 * attacks. New harmony is struck under the old resonance, then a short
 * delayed re-pedal clears the old chord and catches the held new keys.
 */
export function compileAcgPianoPedalScore(args: {
  harmonic: HarmonicPlan;
  pianoScorePlan: AcgPianoScorePlan;
  leadAttacks?: readonly AcgPianoPedalAttackIntent[];
  leadRests?: readonly AcgPianoPedalRestIntent[];
}): AcgPianoPedalScore {
  const knowledge = ACG_PIANO_REST_CONTINUITY_KNOWLEDGE;
  const attacks = [
    ...scoreAttacks(args.harmonic, args.pianoScorePlan),
    ...(args.leadAttacks ?? []),
  ].filter((attack) => Number.isFinite(attack.atBeat) && attack.durationBeats > EPSILON)
    .sort(compareAttack);
  const groups = attackGroups(attacks);
  const spans = [...args.harmonic.chordTimeline]
    .filter((span) => !!args.pianoScorePlan.spanById[span.id])
    .sort((left, right) => (left.startBeat as number) - (right.startBeat as number));
  const songEnd = Math.max(0, ...args.harmonic.chordTimeline.map((span) =>
    (span.startBeat as number) + (span.durationBeats as number)));
  const events: AcgPianoPedalScoreEvent[] = [];
  const decisions: AcgPianoPedalBoundaryDecision[] = [];

  const firstNonFast = groups.find((group) => !group.fastRunOnly) ?? groups[0];
  if (firstNonFast) {
    events.push({
      atBeat: firstNonFast.atBeat,
      down: true,
      technique: 'initial-depress',
      anchorAttackId: firstNonFast.attacks[0]?.id,
      sectionId: firstNonFast.attacks[0]?.sectionId,
    });
  }

  for (let index = 1; index < spans.length; index++) {
    const source = spans[index - 1]!;
    const target = spans[index]!;
    const boundary = target.startBeat as number;
    const targetEnd = boundary + (target.durationBeats as number);
    const sameHarmony = harmonicIdentity(source) === harmonicIdentity(target)
      && source.sectionId === target.sectionId;
    if (sameHarmony) {
      decisions.push({
        atBeat: boundary,
        sourceSpanId: source.id,
        targetSpanId: target.id,
        technique: 'carry',
      });
      continue;
    }

    const entry = groups.find((group) =>
      group.atBeat >= boundary - EPSILON && group.atBeat < targetEnd - EPSILON);
    if (!entry) {
      events.push({ atBeat: boundary, down: false, technique: 'breath-release', sectionId: target.sectionId });
      decisions.push({
        atBeat: boundary,
        sourceSpanId: source.id,
        targetSpanId: target.id,
        technique: 'breath-release',
      });
      continue;
    }

    const anchor = entry.attacks[0];
    if (entry.fastRunOnly) {
      events.push({
        atBeat: boundary,
        down: false,
        technique: 'fast-run-release',
        anchorAttackId: anchor?.id,
        sectionId: target.sectionId,
      });
      decisions.push({
        atBeat: boundary,
        sourceSpanId: source.id,
        targetSpanId: target.id,
        technique: 'fast-run-release',
        anchorAttackId: anchor?.id,
      });
      const nextPedalledEntry = groups.find((group) =>
        group.atBeat > entry.atBeat + EPSILON && !group.fastRunOnly);
      if (nextPedalledEntry) {
        events.push({
          atBeat: nextPedalledEntry.atBeat,
          down: true,
          technique: 'dry-entry-depress',
          anchorAttackId: nextPedalledEntry.attacks[0]?.id,
          sectionId: nextPedalledEntry.attacks[0]?.sectionId,
        });
      }
      continue;
    }

    const captureReadyBeat = Math.max(entry.atBeat, ...entry.attacks.map((attack) =>
      attack.captureReadyBeat ?? attack.atBeat));
    events.push({
      atBeat: captureReadyBeat + knowledge.repedalReleaseAfterAttackBeats,
      down: false,
      technique: 'delayed-repedal-release',
      anchorAttackId: anchor?.id,
      sectionId: target.sectionId,
    });
    events.push({
      atBeat: captureReadyBeat + knowledge.repedalDownAfterAttackBeats,
      down: true,
      technique: 'delayed-repedal-down',
      anchorAttackId: anchor?.id,
      sectionId: target.sectionId,
    });
    decisions.push({
      atBeat: boundary,
      sourceSpanId: source.id,
      targetSpanId: target.id,
      technique: 'delayed-repedal',
      anchorAttackId: anchor?.id,
    });
  }

  // A bounded lyrical carrier may deliberately finish inside a long rest.
  // If the next attack is close, defer the release until just after that
  // attack and perform a real delayed re-pedal instead of creating a dry gap.
  for (const rest of args.leadRests ?? []) {
    if (rest.resonance !== 'bounded-carry' || rest.endBeat <= rest.carrierBeat + EPSILON) continue;
    const reentryFloor = rest.reengageBeat ?? rest.endBeat;
    const reentry = groups.find((group) => group.atBeat >= reentryFloor - EPSILON);
    const closeReentry = reentry
      && reentry.atBeat - rest.endBeat <= knowledge.nearReentryBeats + EPSILON;
    if (closeReentry && !reentry.fastRunOnly) {
      const anchor = reentry.attacks[0];
      const captureReadyBeat = Math.max(reentry.atBeat, ...reentry.attacks.map((attack) =>
        attack.captureReadyBeat ?? attack.atBeat));
      events.push({
        atBeat: captureReadyBeat + knowledge.repedalReleaseAfterAttackBeats,
        down: false,
        technique: 'delayed-repedal-release',
        anchorAttackId: anchor?.id,
        sectionId: anchor?.sectionId,
      });
      events.push({
        atBeat: captureReadyBeat + knowledge.repedalDownAfterAttackBeats,
        down: true,
        technique: 'delayed-repedal-down',
        anchorAttackId: anchor?.id,
        sectionId: anchor?.sectionId,
      });
      continue;
    }
    events.push({ atBeat: rest.endBeat, down: false, technique: 'breath-release' });
    if (reentry && !reentry.fastRunOnly) {
      events.push({
        atBeat: reentry.atBeat,
        down: true,
        technique: 'dry-entry-depress',
        anchorAttackId: reentry.attacks[0]?.id,
        sectionId: reentry.attacks[0]?.sectionId,
      });
    }
  }

  events.push({ atBeat: songEnd, down: false, technique: 'final-release' });
  const normalized = normalizeEvents(events);
  const score: AcgPianoPedalScore = {
    playerGroup: 'shared-piano',
    attacks,
    events: normalized,
    boundaryDecisions: decisions,
  };
  const issues = validateAcgPianoPedalScore(score);
  if (issues.length > 0) throw new Error(`ACG PianoPedalScore contract failed: ${issues.join('; ')}`);
  return score;
}

export function validateAcgPianoPedalScore(score: AcgPianoPedalScore): readonly string[] {
  const issues: string[] = [];
  for (let index = 0; index < score.events.length; index++) {
    const event = score.events[index]!;
    const previous = score.events[index - 1];
    if (!Number.isFinite(event.atBeat) || event.atBeat < -EPSILON) issues.push(`invalid pedal beat ${event.atBeat}`);
    if (previous && event.atBeat < previous.atBeat - EPSILON) issues.push('pedal events are not sorted');
    if (previous && Math.abs(event.atBeat - previous.atBeat) <= EPSILON) issues.push(`same-tick pedal transition at ${event.atBeat}`);
    if (previous && event.down === previous.down) issues.push(`duplicate pedal state at ${event.atBeat}`);
  }
  if (score.events.length > 0 && score.events.at(-1)?.down) issues.push('pedal score has no final release');

  const groups = attackGroups(score.attacks);
  for (const group of groups) {
    if (group.fastRunOnly) continue;
    if (!stateAt(score.events, group.atBeat)) {
      issues.push(`non-fast piano attack ${group.atBeat.toFixed(3)} is outside pedal continuity`);
    }
  }
  return issues;
}

/** Adapter for the legacy scheduler hold until callers migrate to RestIntent. */
export function acgPianoRestIntentsFromAfterglow(
  holds: readonly AcgPianoPedalHold[],
): readonly AcgPianoPedalRestIntent[] {
  return holds.map((hold, index) => ({
    id: `lead-afterglow:${index}`,
    carrierBeat: hold.startBeat,
    endBeat: hold.endBeat,
    resonance: 'bounded-carry' as const,
    ...(hold.reengageBeat === undefined ? {} : { reengageBeat: hold.reengageBeat }),
  }));
}
