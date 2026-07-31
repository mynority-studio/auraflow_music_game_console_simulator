// ============================================================
// newEngine · render · LOFI lead score scheduler
// ------------------------------------------------------------
// LOFI's detailed lead score is resolved before MgNoteEvent / NoteIR. New
// post-harmony scores arrive with exact rhythm and pitch; legacy slot-only
// fixtures retain the former grammar-token continuity path.
// ============================================================

import type {
  LofiLeadContinuitySlot,
  LofiLeadScorePlan,
} from '../arranger/lofiLeadScorePlan';
import type { AbstractMelodyToken } from '../knowledge/melodyGrammarTypes';
import { getCurrentChordAtBeat, type ChordPart } from './mgChordPart';
import {
  scheduleTokens,
  type LofiLeadScoreCarrierIntent,
  type LofiLeadScoreMotifIntent,
  type LofiLeadScoreReleaseReason,
  type LofiLeadScoreShortGestureClass,
  type LofiLeadScoreTokenIntent,
  type ScheduledToken,
} from './mgTokenScheduler';

const EPSILON = 1e-4;
const MAX_SHORT_RESOLUTION_GAP_BEATS = 0.75;
// The harmony auditor treats >= .75 beat exposure as structural even when a
// token starts off the downbeat. A score-issued crawl/approach therefore has
// to remain a true connective atom, not a quarter-note chromatic landing.
const MAX_SHORT_GESTURE_DURATION_BEATS = 0.5;
const MAX_MOTIF_FINGERPRINT_TOKENS = 5;

interface SlottedToken {
  readonly slot: LofiLeadContinuitySlot;
  readonly entry: ScheduledToken;
  readonly motif?: LofiLeadScoreMotifIntent;
  readonly entryFallback?: true;
}

interface MotifFingerprintEvent {
  readonly token: AbstractMelodyToken;
  readonly relativeStartBeats: number;
  readonly sourceDurationBeats: number;
}

interface MotifFingerprint {
  readonly sourceBarId: string;
  readonly events: readonly MotifFingerprintEvent[];
}

interface PlayableAt {
  readonly index: number;
  readonly item: SlottedToken;
}

/**
 * Resolve a LOFI lead score onto an already-expanded token stream.
 *
 * Callers intentionally feed the result of `scheduleBrickExpansions` (and
 * any user-owned span reservation) into this function.  The generic token
 * scheduler remains unchanged: this module is the LOFI-only owner of slot
 * clipping, motif recall, real breaths, and explicit release decisions.
 */
export function scheduleLofiLeadScoreTokens(
  entries: readonly ScheduledToken[],
  chordPart: ChordPart,
  scorePlan: LofiLeadScorePlan | undefined,
): ScheduledToken[] {
  if (!scorePlan) return [...entries];
  if ((scorePlan.events?.length ?? 0) > 0) {
    return scheduleAuthoredLofiLeadEvents(scorePlan, chordPart);
  }

  const slots = [...scorePlan.slots].sort(compareSlots);
  if (slots.length === 0) return [];
  const slotsById = new Map(slots.map((slot) => [slot.id, slot]));
  const slotsByBar = groupSlotsByBar(slots);
  const bySlot = new Map<string, SlottedToken[]>();
  for (const slot of slots) bySlot.set(slot.id, []);

  // First operation: raw grammar material is clipped to the exact score slot
  // in which it starts.  A token is never split/re-attacked into the next
  // harmony; a legitimate cross-harmony sustain is selected below only from a
  // pre-proved Arranger bridge.
  for (const entry of [...entries].sort(compareScheduled)) {
    const slot = slotAtBeat(slots, entry.startBeat);
    if (!slot || slot.role === 'rest') continue;
    const clipped = clipEntryToSlot(entry, slot);
    if (!clipped) continue;
    bySlot.get(slot.id)!.push({ slot, entry: clipped });
  }

  // An Arranger entry beat is a score requirement, not a post-render rescue.
  // The builder currently copies the bar entry onto every harmony slot, so it
  // is consumed only by the slot that truly contains that beat.
  for (const slot of slots) {
    if (slot.role === 'rest' || slot.entryBeat === undefined
      || !containsBeat(slot, slot.entryBeat)) continue;
    const current = bySlot.get(slot.id)!;
    if (current.some((item) => isPlayable(item.entry))) continue;
    const room = slot.endBeat - slot.entryBeat;
    if (room <= EPSILON) continue;
    const duration = Math.min(
      room,
      Math.max(0.25, slot.minimumWrittenDurationBeats),
    );
    current.push({
      slot,
      entry: {
        token: { kind: 'C', duration },
        startBeat: slot.entryBeat,
        ...roadMapMetaForSlot(slot, scorePlan),
      },
      entryFallback: true,
    });
  }

  applyTokenMotifFingerprints(bySlot, slotsByBar, scorePlan);

  // Rest bars are made explicit only after motif material is replaced.  This
  // guarantees that an old grammar token cannot survive a score-owned rest.
  const active = slots
    .filter((slot) => slot.role !== 'rest')
    .flatMap((slot) => normalizeSlotSlopeMarkers(bySlot.get(slot.id) ?? [], slot))
    .map(withBaseLofiIntent);
  const continuityResolved = resolveTokenContinuity(active, chordPart, slotsById);

  const scoreRests = slots
    .filter((slot) => slot.role === 'rest')
    .map((slot): ScheduledToken => ({
      token: { kind: 'R', duration: Math.max(0, slot.endBeat - slot.startBeat) },
      startBeat: slot.startBeat,
      ...roadMapMetaForSlot(slot, scorePlan),
      lofiScore: releaseIntent(slot, 'score-rest'),
    }));

  return [...continuityResolved, ...scoreRests].sort(compareScheduled);
}

function scheduleAuthoredLofiLeadEvents(
  scorePlan: LofiLeadScorePlan,
  chordPart: ChordPart,
): ScheduledToken[] {
  const slotsById = new Map(scorePlan.slots.map((slot) => [slot.id, slot]));
  const sourceStatementBarByMotif = new Map<string, string>();
  for (const event of scorePlan.events ?? []) {
    if (event.phraseRole === 'statement' && !sourceStatementBarByMotif.has(event.motifId)) {
      sourceStatementBarByMotif.set(event.motifId, event.barId);
    }
  }
  const countByBar = new Map<string, number>();
  for (const event of scorePlan.events ?? []) {
    countByBar.set(event.barId, (countByBar.get(event.barId) ?? 0) + 1);
  }
  const indexByBar = new Map<string, number>();
  const written = (scorePlan.events ?? []).map((event): ScheduledToken | null => {
    const slot = slotsById.get(event.slotId);
    if (!slot) return null;
    const eventIndex = indexByBar.get(event.barId) ?? 0;
    indexByBar.set(event.barId, eventIndex + 1);
    const targetSpanId = event.admittedSpanIds[1];
    const targetChord = targetSpanId === undefined
      ? undefined
      : chordPart.blocks.find((block) => block.spanId === targetSpanId);
    const carrier: LofiLeadScoreCarrierIntent | undefined = targetSpanId && targetChord
      ? {
        kind: 'common-tone',
        minimumDurationBeats: event.durationBeats,
        targetChordIndex: targetChord.index,
        targetSpanId,
        continuationPc: event.pitchClass,
      }
      : undefined;
    return {
      token: { kind: event.tokenKind, duration: event.durationBeats },
      startBeat: event.startBeat,
      ...roadMapMetaForSlot(slot, scorePlan),
      lofiScore: {
        slotId: slot.id,
        phraseId: event.phraseId,
        sourceSpanId: event.sourceSpanId,
        role: slot.role,
        phraseRole: event.phraseRole,
        harmonicScope: carrier ? 'common-tone-next-chord' : 'current-chord',
        stableRoles: slot.stableRoles,
        motif: {
          motifId: event.motifId,
          sourceBarId: sourceStatementBarByMotif.get(event.motifId) ?? event.barId,
          role: event.phraseRole,
          eventIndex,
          eventCount: countByBar.get(event.barId) ?? 1,
          relativeStartBeats: event.startBeat - (event.absoluteBar * (
            chordPart.meter[0] * (4 / chordPart.meter[1])
          )),
          sourceDurationBeats: event.durationBeats,
        },
        ...(carrier ? { carrier } : {}),
        exactPitchMidi: event.pitchMidi,
        exactPitchClass: event.pitchClass,
        scoreEventId: event.id,
        sourceCellId: event.sourceCellId,
        sourceEventIndex: event.sourceEventIndex,
        leadRoadMapBrickId: event.leadRoadMapBrickId,
        leadBrickKind: event.leadBrickKind,
        leadTextureTag: event.leadTextureTag,
        leadTextureResolution: event.leadTextureResolution,
        sourceGrammarRuleId: event.sourceGrammarRuleId,
        sourceGrammarBrickType: event.sourceGrammarBrickType,
        scoreTransform: event.transform,
        harmonicRole: event.harmonicRole,
        admittedSpanIds: [...event.admittedSpanIds],
      },
    };
  }).filter((entry): entry is ScheduledToken => entry !== null);

  const rests = scorePlan.slots
    .filter((slot) => slot.role === 'rest')
    .map((slot): ScheduledToken => ({
      token: { kind: 'R', duration: Math.max(0, slot.endBeat - slot.startBeat) },
      startBeat: slot.startBeat,
      ...roadMapMetaForSlot(slot, scorePlan),
      lofiScore: releaseIntent(slot, 'score-rest'),
    }));
  return [...written, ...rests].sort(compareScheduled);
}

function groupSlotsByBar(slots: readonly LofiLeadContinuitySlot[]): Map<string, LofiLeadContinuitySlot[]> {
  const out = new Map<string, LofiLeadContinuitySlot[]>();
  for (const slot of slots) {
    const group = out.get(slot.barId) ?? [];
    group.push(slot);
    out.set(slot.barId, group);
  }
  for (const group of out.values()) group.sort(compareSlots);
  return out;
}

function applyTokenMotifFingerprints(
  bySlot: Map<string, SlottedToken[]>,
  slotsByBar: ReadonlyMap<string, readonly LofiLeadContinuitySlot[]>,
  scorePlan: LofiLeadScorePlan,
): void {
  const fingerprints = new Map<string, MotifFingerprint>();
  const bars = [...scorePlan.bars].sort((left, right) => left.startBeat - right.startBeat || left.id.localeCompare(right.id));

  for (const bar of bars) {
    if (!bar.motifId || bar.phraseRole === 'rest' || bar.role === 'rest') continue;
    const barSlots = slotsByBar.get(bar.id) ?? [];
    const current = barSlots
      .flatMap((slot) => bySlot.get(slot.id) ?? [])
      .filter((item) => isPlayable(item.entry))
      .sort(compareSlotted);
    const source = fingerprints.get(bar.motifId);

    if (bar.phraseRole === 'statement' && !source) {
      const identity = current.slice(0, MAX_MOTIF_FINGERPRINT_TOKENS);
      if (identity.length === 0) continue;
      const events = identity.map((item) => ({
        token: copyToken(item.entry.token),
        relativeStartBeats: Math.max(0, item.entry.startBeat - bar.startBeat),
        sourceDurationBeats: item.entry.token.duration,
      }));
      const fingerprint: MotifFingerprint = { sourceBarId: bar.id, events };
      fingerprints.set(bar.motifId, fingerprint);
      const count = identity.length;
      for (let index = 0; index < identity.length; index++) {
        const item = identity[index]!;
        replaceItemInSlot(bySlot, item, {
          ...item,
          motif: motifIntent(fingerprint, bar.motifId, 'statement', index, count, events[index]!),
        });
      }
      continue;
    }

    if (!source || (bar.phraseRole !== 'variation' && bar.phraseRole !== 'return')) continue;
    for (const slot of barSlots) bySlot.set(slot.id, []);
    const role = bar.phraseRole;
    const replacements = instantiateFingerprintInBar({
      fingerprint: source,
      motifId: bar.motifId,
      role,
      barStartBeat: bar.startBeat,
      barEndBeat: bar.endBeat,
      slots: barSlots,
      scorePlan,
    });
    for (const replacement of replacements) bySlot.get(replacement.slot.id)!.push(replacement);
  }
}

function replaceItemInSlot(
  bySlot: Map<string, SlottedToken[]>,
  target: SlottedToken,
  replacement: SlottedToken,
): void {
  const entries = bySlot.get(target.slot.id) ?? [];
  const index = entries.indexOf(target);
  if (index >= 0) entries[index] = replacement;
}

function instantiateFingerprintInBar(args: {
  readonly fingerprint: MotifFingerprint;
  readonly motifId: string;
  readonly role: 'variation' | 'return';
  readonly barStartBeat: number;
  readonly barEndBeat: number;
  readonly slots: readonly LofiLeadContinuitySlot[];
  readonly scorePlan: LofiLeadScorePlan;
}): SlottedToken[] {
  const out: SlottedToken[] = [];
  const count = args.fingerprint.events.length;
  for (let index = 0; index < count; index++) {
    const source = args.fingerprint.events[index]!;
    let startBeat = args.barStartBeat + source.relativeStartBeats;
    // A variation may breathe its final answer a little later, but it never
    // gets clamped into the last 0.08 beats of the bar as the old event-level
    // compiler did.
    if (args.role === 'variation' && index === count - 1) {
      const shifted = startBeat + 0.25;
      if (shifted < args.barEndBeat - EPSILON) startBeat = shifted;
    }
    const slot = slotAtBeat(args.slots, startBeat);
    if (!slot || slot.role === 'rest') continue;
    const scheduled = scheduleTokens([copyToken(source.token)], startBeat, slot.endBeat - startBeat)
      .find((entry) => entry.token.duration > EPSILON);
    if (!scheduled) continue;
    const token = args.role === 'return' && index === count - 1
      ? ({ kind: 'C', duration: scheduled.token.duration } as AbstractMelodyToken)
      : scheduled.token;
    const motif = motifIntent(args.fingerprint, args.motifId, args.role, index, count, source);
    out.push({
      slot,
      entry: {
        ...scheduled,
        token,
        ...roadMapMetaForSlot(slot, args.scorePlan),
      },
      motif,
    });
  }
  return out;
}

function motifIntent(
  fingerprint: MotifFingerprint,
  motifId: string,
  role: 'statement' | 'variation' | 'return',
  eventIndex: number,
  eventCount: number,
  event: MotifFingerprintEvent,
): LofiLeadScoreMotifIntent {
  return {
    motifId,
    sourceBarId: fingerprint.sourceBarId,
    role,
    eventIndex,
    eventCount,
    relativeStartBeats: event.relativeStartBeats,
    sourceDurationBeats: event.sourceDurationBeats,
  };
}

function resolveTokenContinuity(
  entries: readonly SlottedToken[],
  chordPart: ChordPart,
  slotsById: ReadonlyMap<string, LofiLeadContinuitySlot>,
): ScheduledToken[] {
  const planned = [...entries].sort(compareSlotted);
  for (let pass = 0; pass < planned.length; pass++) {
    let changed = false;
    planned.sort(compareSlotted);
    for (let index = planned.length - 1; index >= 0; index--) {
      const current = planned[index]!;
      const entry = current.entry;
      const slot = current.slot;
      if (!isPlayable(entry)) continue;
      // `A` is never a free-standing long tone in a score-owned LOFI line.
      // Even an unusually long source token must either receive its exact
      // target contract below or become an explicit release.
      if (entry.token.kind !== 'A'
        && entry.token.duration >= slot.minimumWrittenDurationBeats - EPSILON) continue;

      // A chromatic/scale approach at a structural attack reads as a landing
      // in FinalIR (the audit intentionally has no renderer-side token
      // provenance). Keep approach grammar to weak connective positions; a
      // strong beat without an explicit stable carrier is an unsafe fragment,
      // not permission to bypass the harmonicScope/stableRoles contract.
      if (entry.token.kind === 'A' && isStructuralScoreBeat(entry.startBeat, chordPart)) {
        planned[index] = { ...current, entry: asRelease(current, 'unsafe-exposed-fragment') };
        changed = true;
        continue;
      }

      const next = nextPlayable(planned, index);
      const shortGesture = classifyShortGesture(entry, slot, next);
      if (shortGesture) {
        const target = resolvedShortGestureTarget(next, entry, slotsById);
        if (slot.allowedShortGestureClasses.includes(shortGesture) && target) {
          const nextEntry = asShortGesture(current, {
            shortGesture: {
              class: shortGesture,
              targetStartBeat: target.item.entry.startBeat,
              targetSlotId: target.item.slot.id,
            },
          });
          if (nextEntry !== entry) planned[index] = { ...current, entry: nextEntry };
          continue;
        }
        planned[index] = { ...current, entry: asRelease(current, 'unresolved-short-gesture') };
        changed = true;
        continue;
      }

      const gap = exposedLeadGap(entry, next, chordPart.totalBeats);
      if (gap < slot.exposedGapBeats - EPSILON) continue;

      const sameHarmony = writeSameHarmonyCarrier(current, index, planned, next);
      if (sameHarmony) {
        planned[index] = { ...current, entry: sameHarmony };
        changed = true;
        continue;
      }

      const commonTone = writeCommonToneCarrier(current, index, planned, next, chordPart);
      if (commonTone) {
        planned[index] = { ...current, entry: commonTone };
        changed = true;
        continue;
      }

      planned[index] = { ...current, entry: asRelease(current, 'no-safe-carrier') };
      changed = true;
    }
    if (!changed) break;
  }
  return planned.map((item) => item.entry).sort(compareScheduled);
}

function classifyShortGesture(
  entry: ScheduledToken,
  slot: LofiLeadContinuitySlot,
  next: PlayableAt | null,
): LofiLeadScoreShortGestureClass | undefined {
  if (entry.token.kind === 'A') return 'approach-target';
  const immediateSuccessor = next !== null
    && next.item.entry.startBeat - (entry.startBeat + entry.token.duration)
      <= MAX_SHORT_RESOLUTION_GAP_BEATS + EPSILON;
  // A lone C/S/L is a candidate single-note carrier, not automatically a
  // "riff" merely because it occurs in an answer bar.  Only material that
  // actually continues into a nearby target is admitted as short grammar.
  if (!immediateSuccessor) return undefined;
  if (slot.role === 'answer-riff') return 'answer-riff';
  if (entry.token.kind === 'S'
    || entry.token.kind === 'L'
    || entry.token.kind === 'H'
    || entry.token.kind === 'X'
    || entry.token.kind === 'Slope'
    || entry.token.kind === 'Triadic') return 'connected-crawl';
  return undefined;
}

function resolvedShortGestureTarget(
  next: PlayableAt | null,
  entry: ScheduledToken,
  slotsById: ReadonlyMap<string, LofiLeadContinuitySlot>,
): PlayableAt | null {
  if (!next) return null;
  const releaseToTarget = next.item.entry.startBeat - (entry.startBeat + entry.token.duration);
  if (releaseToTarget > MAX_SHORT_RESOLUTION_GAP_BEATS + EPSILON) return null;
  const targetSlot = slotsById.get(next.item.slot.id);
  if (!targetSlot || targetSlot.role === 'rest') return null;
  const token = next.item.entry.token;
  if (token.kind === 'A' || token.kind === 'R' || token.duration <= EPSILON) return null;
  // A real target has a stable terminal or enough written value to be a
  // landing.  This prevents adjacent two 16th fragments from certifying one
  // another as a line when neither actually resolves.
  if (token.kind === 'C' || token.kind === 'G' || token.kind === 'B'
    || token.duration >= 0.5 - EPSILON
    || next.item.entry.lofiScore?.carrier !== undefined) return next;
  return null;
}

function writeSameHarmonyCarrier(
  current: SlottedToken,
  index: number,
  entries: readonly SlottedToken[],
  next: PlayableAt | null,
): ScheduledToken | null {
  const { slot, entry } = current;
  const endLimit = Math.min(
    slot.endBeat,
    next ? next.item.entry.startBeat - slot.reentryGuardBeats : Infinity,
  );
  const startBeat = retimedCarrierStart({
    entry,
    slot,
    index,
    entries,
    endLimit,
  });
  if (startBeat === null) return null;
  return asCarrier(current, startBeat, {
    kind: 'breath',
    minimumDurationBeats: slot.minimumWrittenDurationBeats,
  });
}

function writeCommonToneCarrier(
  current: SlottedToken,
  index: number,
  entries: readonly SlottedToken[],
  next: PlayableAt | null,
  chordPart: ChordPart,
): ScheduledToken | null {
  const { slot, entry } = current;
  const source = getCurrentChordAtBeat(chordPart, entry.startBeat);
  if (!source || Math.abs(slot.endBeat - source.endBeat) > EPSILON) return null;
  const bridge = slot.boundaryBridges.find((candidate) => candidate.kind === 'common-tone');
  const target = getCurrentChordAtBeat(chordPart, source.endBeat + EPSILON);
  const continuationPc = bridge?.continuationPcs?.[0];
  if (!bridge || !target || continuationPc === undefined
    || bridge.targetSpanId !== target.spanId
    || target.index !== source.index + 1) return null;

  // The plan has already proved this against HarmonicPlan.  ChordPart carries
  // the same facts when available, so reject a stale/mismatched projection
  // rather than allowing renderer inference to manufacture a suspension.
  if (source.stableTonePcs && !source.stableTonePcs.includes(continuationPc)) return null;
  if (target.stableTonePcs && !target.stableTonePcs.includes(continuationPc)) return null;

  const endLimit = Math.min(
    target.endBeat - slot.releaseGuardBeats,
    next ? next.item.entry.startBeat - slot.reentryGuardBeats : Infinity,
  );
  const startBeat = retimedCarrierStart({
    entry,
    slot,
    index,
    entries,
    endLimit,
  });
  if (startBeat === null || startBeat + slot.minimumWrittenDurationBeats <= source.endBeat + EPSILON) return null;

  return asCarrier(current, startBeat, {
    kind: 'common-tone',
    minimumDurationBeats: slot.minimumWrittenDurationBeats,
    targetChordIndex: target.index,
    targetSpanId: target.spanId ?? bridge.targetSpanId,
    continuationPc,
  });
}

function retimedCarrierStart(args: {
  readonly entry: ScheduledToken;
  readonly slot: LofiLeadContinuitySlot;
  readonly index: number;
  readonly entries: readonly SlottedToken[];
  readonly endLimit: number;
}): number | null {
  const { entry, slot, index, entries, endLimit } = args;
  const duration = slot.minimumWrittenDurationBeats;
  if (duration <= EPSILON || !Number.isFinite(endLimit)) return null;
  let startBeat = entry.startBeat;
  if (startBeat + duration > endLimit + EPSILON) startBeat = endLimit - duration;
  const nudge = entry.startBeat - startBeat;
  if (nudge < -EPSILON || nudge > slot.maxOnsetNudgeBeats + EPSILON
    || startBeat < slot.startBeat - EPSILON) return null;
  const previous = previousPlayable(entries, index);
  if (previous) {
    const previousEnd = previous.item.entry.startBeat + previous.item.entry.token.duration;
    // An approach/crawl landing is a single connected gesture: its target may
    // begin exactly where the preceding atom releases.  The re-entry guard is
    // still required whenever this carrier is nudged earlier or starts a new
    // detached attack.
    const directlyConnected = Math.abs(previousEnd - entry.startBeat) <= EPSILON
      && startBeat >= entry.startBeat - EPSILON;
    const guardedEnd = previousEnd + (directlyConnected ? 0 : slot.reentryGuardBeats);
    if (startBeat < guardedEnd - EPSILON) return null;
  }
  return startBeat;
}

function asCarrier(
  item: SlottedToken,
  startBeat: number,
  carrier: LofiLeadScoreCarrierIntent,
): ScheduledToken {
  return withIntent(item, {
    harmonicScope: carrier.kind === 'common-tone' ? 'common-tone-next-chord' : 'current-chord',
    carrier,
    shortGesture: undefined,
    release: undefined,
  }, {
    startBeat,
    token: { kind: 'C', duration: carrier.minimumDurationBeats },
  });
}

/** Write an admitted crawl/approach as a real short token before pitch choice. */
function asShortGesture(
  item: SlottedToken,
  patch: Pick<LofiLeadScoreTokenIntent, 'shortGesture'>,
): ScheduledToken {
  const duration = Math.min(item.entry.token.duration, MAX_SHORT_GESTURE_DURATION_BEATS);
  return withIntent(item, patch, {
    token: { ...item.entry.token, duration } as AbstractMelodyToken,
  });
}

function asRelease(item: SlottedToken, reason: LofiLeadScoreReleaseReason): ScheduledToken {
  return withIntent(item, {
    release: { reason },
    shortGesture: undefined,
    carrier: undefined,
  }, {
    token: { kind: 'R', duration: item.entry.token.duration },
  });
}

function exposedLeadGap(entry: ScheduledToken, next: PlayableAt | null, songEndBeat: number): number {
  const noteEnd = entry.startBeat + entry.token.duration;
  return Math.max(0, (next ? next.item.entry.startBeat : songEndBeat) - noteEnd);
}

function nextPlayable(entries: readonly SlottedToken[], sourceIndex: number): PlayableAt | null {
  const source = entries[sourceIndex]!;
  for (let index = sourceIndex + 1; index < entries.length; index++) {
    const candidate = entries[index]!;
    if (candidate.entry.startBeat <= source.entry.startBeat + EPSILON || !isPlayable(candidate.entry)) continue;
    return { index, item: candidate };
  }
  return null;
}

function previousPlayable(entries: readonly SlottedToken[], sourceIndex: number): PlayableAt | null {
  for (let index = sourceIndex - 1; index >= 0; index--) {
    const candidate = entries[index]!;
    if (isPlayable(candidate.entry)) return { index, item: candidate };
  }
  return null;
}

function normalizeSlotSlopeMarkers(
  items: readonly SlottedToken[],
  slot: LofiLeadContinuitySlot,
): SlottedToken[] {
  const out = [...items].sort(compareSlotted);
  let depth = 0;
  for (const item of out) {
    if (item.entry.token.kind === 'SlopeEnter') depth++;
    if (item.entry.token.kind === 'SlopeExit') depth = Math.max(0, depth - 1);
  }
  for (let index = 0; index < depth; index++) {
    out.push({
      slot,
      entry: { token: { kind: 'SlopeExit', duration: 0 }, startBeat: slot.endBeat },
    });
  }
  return out;
}

function clipEntryToSlot(entry: ScheduledToken, slot: LofiLeadContinuitySlot): ScheduledToken | null {
  if (entry.token.duration === 0) {
    return containsBeat(slot, entry.startBeat) ? { ...entry } : null;
  }
  const room = slot.endBeat - entry.startBeat;
  if (room <= EPSILON) return null;
  // Reuse the generic scheduler's exact clipping semantics without modifying
  // it.  The source stream is already scheduled; this is a one-token slot
  // clamp, not a second grammar expansion.
  const clipped = scheduleTokens([entry.token], entry.startBeat, room)
    .find((candidate) => candidate.token.duration > EPSILON);
  return clipped ? { ...entry, ...clipped } : null;
}

function withBaseLofiIntent(item: SlottedToken): SlottedToken {
  return { ...item, entry: withIntent(item, {}) };
}

function withIntent(
  item: SlottedToken,
  patch: Partial<LofiLeadScoreTokenIntent>,
  entryPatch: Partial<Pick<ScheduledToken, 'startBeat' | 'token'>> = {},
): ScheduledToken {
  const base: LofiLeadScoreTokenIntent = {
    slotId: item.slot.id,
    phraseId: item.slot.phraseId,
    sourceSpanId: item.slot.sourceSpanId,
    role: item.slot.role,
    phraseRole: item.slot.phraseRole,
    harmonicScope: 'current-chord',
    stableRoles: item.slot.stableRoles,
    ...(item.motif ? { motif: item.motif } : {}),
    ...(item.entryFallback ? { entryFallback: true as const } : {}),
  };
  const lofiScore: LofiLeadScoreTokenIntent = {
    ...base,
    ...patch,
  };
  return {
    ...item.entry,
    ...entryPatch,
    lofiScore,
  };
}

function releaseIntent(
  slot: LofiLeadContinuitySlot,
  reason: LofiLeadScoreReleaseReason,
): LofiLeadScoreTokenIntent {
  return {
    slotId: slot.id,
    phraseId: slot.phraseId,
    sourceSpanId: slot.sourceSpanId,
    role: slot.role,
    phraseRole: slot.phraseRole,
    harmonicScope: 'current-chord',
    stableRoles: slot.stableRoles,
    release: { reason },
  };
}

function roadMapMetaForSlot(
  slot: LofiLeadContinuitySlot,
  scorePlan: LofiLeadScorePlan,
): Partial<ScheduledToken> {
  const leadBrickIndex = (scorePlan.compiledRoadMapBricks ?? [])
    .findIndex((brick) => brick.absoluteBar === slot.absoluteBar);
  const leadBrick = leadBrickIndex < 0 ? undefined : scorePlan.roadMap?.bricks[leadBrickIndex];
  if (leadBrick) {
    return {
      brickIndex: leadBrickIndex,
      brickStartBeat: leadBrick.startBeat,
      brickEndBeat: leadBrick.startBeat + leadBrick.durationBeats,
      brickName: leadBrick.name,
      brickFamily: leadBrick.family,
    };
  }
  const brickIndex = slot.roadMapBinding.brickIndices[0];
  const brick = brickIndex === undefined
    ? undefined
    : (scorePlan.harmonicRoadMap ?? scorePlan.roadMap)?.bricks[brickIndex];
  return brick
    ? {
      brickIndex,
      brickStartBeat: brick.startBeat,
      brickEndBeat: brick.startBeat + brick.durationBeats,
      brickName: brick.name,
      brickFamily: brick.family,
    }
    : {};
}

function slotAtBeat(
  slots: readonly LofiLeadContinuitySlot[],
  beat: number,
): LofiLeadContinuitySlot | undefined {
  return slots.find((slot) => containsBeat(slot, beat));
}

function containsBeat(slot: Pick<LofiLeadContinuitySlot, 'startBeat' | 'endBeat'>, beat: number): boolean {
  return beat >= slot.startBeat - EPSILON && beat < slot.endBeat - EPSILON;
}

function isPlayable(entry: ScheduledToken): boolean {
  return entry.token.duration > EPSILON
    && entry.token.kind !== 'R'
    && entry.token.kind !== 'SlopeEnter'
    && entry.token.kind !== 'SlopeExit';
}

function isStructuralScoreBeat(beat: number, chordPart: ChordPart): boolean {
  const [numerator, denominator] = chordPart.meter;
  const beatsPerBar = numerator * (4 / denominator);
  const tolerance = 1e-4;
  if (Number.isFinite(beatsPerBar) && beatsPerBar > 0) {
    const phase = ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar;
    if (Math.abs(phase) <= tolerance
      || (beatsPerBar >= 4 && Math.abs(phase - beatsPerBar / 2) <= tolerance)) return true;
  }
  const chord = getCurrentChordAtBeat(chordPart, beat);
  return !!chord && Math.abs(beat - chord.startBeat) <= tolerance;
}

function copyToken(token: AbstractMelodyToken): AbstractMelodyToken {
  return { ...token } as AbstractMelodyToken;
}

function compareSlots(left: LofiLeadContinuitySlot, right: LofiLeadContinuitySlot): number {
  return left.startBeat - right.startBeat
    || left.endBeat - right.endBeat
    || left.id.localeCompare(right.id);
}

function compareSlotted(left: SlottedToken, right: SlottedToken): number {
  return compareScheduled(left.entry, right.entry);
}

function compareScheduled(left: ScheduledToken, right: ScheduledToken): number {
  return left.startBeat - right.startBeat
    || tokenOrder(left) - tokenOrder(right)
    || left.token.duration - right.token.duration;
}

function tokenOrder(entry: ScheduledToken): number {
  return entry.token.kind === 'SlopeExit' ? -1
    : entry.token.kind === 'SlopeEnter' ? 1
      : 0;
}
