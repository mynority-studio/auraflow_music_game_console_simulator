// ============================================================
// newEngine · render · ACG cycle-cadence scheduler(MG full-parity 升级 · G4)
// ------------------------------------------------------------
// 忠实 port 自【当前】../melodygenerative generateImprovisorMelody.ts:
//   scheduleAcgCycleCadencePhrases / inferAcgCycleSpans / hasRepeatedHalves /
//   pickAcgCadenceExpansion / scoreAcgCadenceSource / spreadTokensAcrossAcgCycle / 等。
// ACG 旋律【不是】brick-by-brick lick chain —— 它把一条 cadence 式上行长句【铺满一个和声 cycle】,
// 让钢琴织体呼吸。ACG 风格【不走】scheduleBrickExpansions,走此 cycle scheduler。
// ★ Phase B-2(2026-06-28):ScheduledToken 现带 full brick 元数据 —— ACG stretched cycle 的 brick identity
//   (name/family/index)来自选中的 cadence expansion,brickStart/EndBeat 反映 stretched cycle(directive 3.3)。
//   其余逐函数对齐当前 MG。纯函数无 rng → 确定性。
// ============================================================

import type {
  AbstractMelodyToken,
  AcgBorrowedColorIntent,
  AcgDyadIntent,
  AcgStableRole,
  AcgSustainedCarrierIntent,
} from '../knowledge/melodyGrammarTypes';
import type { AcgReturnGestureIntent, ScheduledToken } from './mgTokenScheduler';
import { getCurrentChordAtBeat } from './mgChordPart';
import type { ChordBlock, ChordPart } from './mgChordPart';
import type { BrickMatch } from './mgRoadMapParser';
import {
  acgReturnTokenToAbstractToken,
  getAcgReturnBrickCandidates,
  type AcgReturnBrick,
  type AcgReturnFunction,
  type AcgReturnStableRole,
} from '../knowledge/acgReturnGrammar';
import { acgStableToneCandidates, type AcgStableToneCandidate } from './mgPitchClassSets';
import {
  isAcgLeadScheduledRelease,
  overlapsAcgLeadSilence,
  type AcgLeadPresencePlan,
} from './acgLeadPresencePlan';
import type {
  AcgPianoLeadContinuitySlot,
  AcgPianoMetricAnchor,
  AcgPianoMetricGrid,
  AcgPianoPedalHold,
  AcgPianoReturnShape,
  AcgPianoScorePlan,
} from '../arranger/acgPianoScorePlan';

type BrickExpansion = { brickIndex: number; brick: BrickMatch; tokens: AbstractMelodyToken[] };

/** Arrangement-owned ACG top-line presence, consumed while tokens still own time. */
export interface AcgCycleSchedulerOptions {
  leadPresencePlan?: AcgLeadPresencePlan;
  /** Arranger-owned phrase overlay; it constrains expression, not harmony facts. */
  pianoScorePlan?: AcgPianoScorePlan;
}

/** ACG 成曲旋律调度:每个和声 cycle 铺一条 cadence 长句(忠实 MG)。 */
export function scheduleAcgCycleCadencePhrases(
  expansions: BrickExpansion[],
  chordPart: ChordPart,
  options: AcgCycleSchedulerOptions = {},
): ScheduledToken[] {
  const cycles = inferAcgCycleSpans(chordPart);
  const globalCadence = pickAcgCadenceExpansion(expansions, 0, chordPart.totalBeats);
  const out: ScheduledToken[] = [];
  for (const cycle of cycles) {
    const local = pickAcgCadenceExpansion(expansions, cycle.startBeat, cycle.endBeat);
    const source = local ?? globalCadence;
    const tokens = source?.tokens?.length ? source.tokens : fallbackAcgCycleCadenceTokens();
    const brickMeta = source ? { brickIndex: source.brickIndex, name: source.brick.name, family: source.brick.family } : {};
    out.push(...spreadTokensAcrossAcgCycle(
      tokens,
      cycle.startBeat,
      cycle.endBeat,
      brickMeta,
      options.pianoScorePlan?.metricGrid,
    ));
  }
  // ★ ACG PIANOSONG 主链:语法产生的 R → audible 边界在【仍有 RoadMap + 和声】的
  // scheduler 内变成可执行回归意图。这里不写 NoteIR、不补空档；realizer 只执行这份一次式指令。
  const boundarySafe = clipAcgTokensToChordBoundaries(out.sort(compareAcgScheduledOrder), chordPart);
  const phraseSafe = normalizeAcgDeferredApproaches(boundarySafe, chordPart);
  const breathReleased = scheduleAcgBreathReleaseBricks(phraseSafe, expansions, chordPart);
  const presenceScheduled = applyAcgLeadPresencePlan(breathReleased, options.leadPresencePlan);
  const materialized = materializeAcgReturnGestures(
    presenceScheduled,
    expansions,
    chordPart,
    options.leadPresencePlan,
    options.pianoScorePlan,
  );
  // A lyrical single must be a written note first.  CC64 can lengthen its
  // resonance, but cannot turn a 0.5-beat key press into cantabile.  Keep
  // this in the scheduler, before stable contracts and before realization.
  const sustained = planAcgSustainedSingleCarriers(materialized, chordPart, options.pianoScorePlan);
  // ACG's ordinary structural carriers are grammar contracts too. The
  // realizer must not be the first place that guesses a long/strong carrier
  // is stable: issue the explicit current-chord role set while token timing
  // and harmonic context are still owned by the scheduler.
  return attachAcgMetricAnchorContracts(
    attachAcgStructuralTokenContracts(sustained, chordPart),
    options.pianoScorePlan?.metricGrid,
  );
}

const ACG_AFTERGLOW_EPSILON = 1e-4;
const ACG_AFTERGLOW_MIN_REST_BEATS = 1.25;
const ACG_AFTERGLOW_MIN_TAIL_BEATS = 0.75;
const ACG_AFTERGLOW_RELEASE_GUARD_BEATS = 0.125;
/**
 * Materialize the Arranger's continuity slots while tokens still own rhythm
 * and harmony.  The slots were compiled from the KB into the PianoScorePlan;
 * this function may select only their written carrier, common-tone,
 * pre-proved b9, or explicit release outcomes.  It must not invent a new
 * musical policy from a rendered gap.
 */
export function planAcgSustainedSingleCarriers(
  entries: readonly ScheduledToken[],
  chordPart: ChordPart,
  pianoScorePlan: AcgPianoScorePlan | undefined,
): ScheduledToken[] {
  if (!pianoScorePlan || entries.length === 0) return [...entries];
  const planned = [...entries].sort(compareAcgScheduledOrder);

  // This is a monotone score-plan resolver, not a post-render retry.  A pass
  // can only turn an unsafe atom into an explicit R or into a fully-contracted
  // carrier.  Re-running the token pass lets an earlier single see that a
  // later unsafe fragment has become a rest; without it, traversal order can
  // leave an otherwise eligible C/L as a click before the newly-created air.
  for (let pass = 0; pass < planned.length; pass++) {
    let changed = false;
    planned.sort(compareAcgScheduledOrder);
    for (let index = 0; index < planned.length; index++) {
      const entry = planned[index]!;
      const sourceChord = getCurrentChordAtBeat(chordPart, entry.startBeat);
      const slot = sourceChord
        ? acgLeadContinuitySlotAtBeat(pianoScorePlan, entry.startBeat, sourceChord)
        : undefined;
      if (!sourceChord || !slot || !isAcgSustainedSingleCandidate(entry, planned, slot)) continue;
      const next = nextAcgPlayableEntry(planned, index);
      // A return approach is atomic with its same-gesture arrival. If a later
      // scheduling operation leaves only the approach, make the absence
      // explicit here rather than treating a coincidental next note as an
      // answer.
      if (entry.acgReturn?.role === 'approach' && !hasAcgLocalShortGestureResolution(entry, next)) {
        planned[index] = explicitAcgRelease(entry);
        changed = true;
        continue;
      }
      const shortGestureClass = acgShortGestureClass(entry);
      if (shortGestureClass) {
        // The Arranger, not the scheduler, declares which grammar classes may
        // remain short in this phrase × harmony slot. A permitted class still
        // needs a connected answer; otherwise it becomes an explicit release.
        if (slot.allowedShortGestureClasses.includes(shortGestureClass)
          && hasAcgLocalShortGestureResolution(entry, next)) continue;
        planned[index] = explicitAcgRelease(entry);
        changed = true;
        continue;
      }
      const noteEnd = entry.startBeat + entry.token.duration;
      // Bass/comp establish the harmonic floor, but a new lower-hand attack is
      // not a license to turn the highest melodic carrier back into a click.
      // Only the next lead onset (or song end) ends this top-line breath.
      // A contiguous (or slightly overlapping) next lead atom is a connected
      // little line, not silence. Only the absence after its key release is
      // eligible for the cantabile-carrier rule.
      const rawLeadGap = next
        ? Math.max(0, next.entry.startBeat - noteEnd)
        : chordPart.totalBeats - noteEnd;
      const nudgeCanExposeCarrier = rawLeadGap + slot.maxOnsetNudgeBeats
        >= slot.exposedGapBeats - ACG_AFTERGLOW_EPSILON;
      if (rawLeadGap < slot.exposedGapBeats - ACG_AFTERGLOW_EPSILON && !nudgeCanExposeCarrier) continue;

      const sameHarmony = planSameHarmonyAcgBreathCarrier(
        entry,
        index,
        planned,
        next,
        sourceChord,
        slot,
      );
      if (sameHarmony) {
        planned[index] = sameHarmony.carrier;
        changed = true;
        if (sameHarmony.suppressBoundaryOrnamentIndex !== undefined) {
          const ornament = planned[sameHarmony.suppressBoundaryOrnamentIndex]!;
          planned[sameHarmony.suppressBoundaryOrnamentIndex] = explicitAcgRelease(ornament);
        }
        continue;
      }

      // Cross-harmony is opt-in and ordered by the arranger's slot: an exact
      // cadence b9 may be selected first; otherwise only a pre-computed common
      // tone can cross. Both retain a full written key-down, not just CC64.
      const dominantB9 = next
        ? planAcgDominantB9SuspensionCarrier(entry, next, sourceChord, chordPart, pianoScorePlan, slot)
        : null;
      if (dominantB9) {
        planned[index] = dominantB9;
        changed = true;
        continue;
      }
      const commonTone = planAcgCommonToneCarrier(entry, next, sourceChord, chordPart, slot);
      if (commonTone) {
        planned[index] = commonTone;
        changed = true;
        continue;
      }

      // The remaining short atom is an unsafe boundary fragment. Make the
      // release explicit rather than leaking a click into a long breath.
      planned[index] = explicitAcgRelease(entry);
      changed = true;
    }
    if (!changed) break;
  }

  return planned.sort(compareAcgScheduledOrder);
}

function planSameHarmonyAcgBreathCarrier(
  entry: ScheduledToken,
  index: number,
  entries: readonly ScheduledToken[],
  next: { index: number; entry: ScheduledToken } | null,
  sourceChord: ChordBlock,
  slot: AcgPianoLeadContinuitySlot,
): { carrier: ScheduledToken; suppressBoundaryOrnamentIndex?: number } | null {
  const requestedEnd = entry.startBeat + slot.minimumKeyDownBeats;
  let startBeat = entry.startBeat;

  if (next && next.entry.startBeat < requestedEnd - ACG_AFTERGLOW_EPSILON) {
    const nudge = requestedEnd - next.entry.startBeat;
    if (nudge > slot.maxOnsetNudgeBeats + ACG_AFTERGLOW_EPSILON) return null;
    const shifted = entry.startBeat - nudge;
    const previousEnd = previousAcgPlayableEnd(entries, index);
    if (shifted < sourceChord.startBeat - ACG_AFTERGLOW_EPSILON
      || (previousEnd !== undefined && shifted < previousEnd + slot.reentryGuardBeats)) return null;
    startBeat = shifted;
  }

  const endBeat = startBeat + slot.minimumKeyDownBeats;
  if (endBeat > slot.endBeat + ACG_AFTERGLOW_EPSILON
    || (next && endBeat > next.entry.startBeat + ACG_AFTERGLOW_EPSILON)) return null;

  const retimed = withAcgSustainedCarrierContract(
    entry,
    slot.stableRoles,
    { kind: 'breath', minimumDurationBeats: slot.minimumKeyDownBeats },
    startBeat,
    slot.minimumKeyDownBeats,
  );
  return {
    carrier: retimed,
    ...(next && isAcgBoundaryMicroOrnament(next.entry, sourceChord) ? { suppressBoundaryOrnamentIndex: next.index } : {}),
  };
}

/**
 * A cycle-spread C can be clipped to the final 1/8 beat of a chord. Once the
 * preceding stable arrival has been deliberately written as a half note, that
 * fragment is neither a phrase nor a usable re-articulation; turn it into a
 * real rest while retaining surrounding slope markers for their later phrase.
 */
function isAcgBoundaryMicroOrnament(entry: ScheduledToken, sourceChord: ChordBlock): boolean {
  return entry.token.kind === 'C'
    && entry.token.duration <= 0.125 + ACG_AFTERGLOW_EPSILON
    && !entry.acgReturn
    && !entry.token.acg
    && entry.startBeat >= sourceChord.endBeat - 0.125 - ACG_AFTERGLOW_EPSILON
    && entry.startBeat + entry.token.duration <= sourceChord.endBeat + ACG_AFTERGLOW_EPSILON;
}

function planAcgDominantB9SuspensionCarrier(
  entry: ScheduledToken,
  next: { index: number; entry: ScheduledToken },
  sourceChord: ChordBlock,
  chordPart: ChordPart,
  pianoScorePlan: AcgPianoScorePlan,
  slot: AcgPianoLeadContinuitySlot,
): ScheduledToken | null {
  // Return arrivals already carry an exact source-chord targetPc and may be
  // consumed atomically with a preceding approach. Do not reinterpret that
  // separate gesture as a b9 carrier: keeping it boundary-clipped is safer
  // than allowing the return-materialization branch to bypass this contract.
  if (entry.acgReturn) return null;
  const bridge = slot.boundaryBridges.find((candidate) => candidate.kind === 'dominant-b9');
  const targetChord = getCurrentChordAtBeat(chordPart, sourceChord.endBeat + ACG_AFTERGLOW_EPSILON);
  const endBeat = entry.startBeat + slot.minimumKeyDownBeats;
  const continuationPc = bridge?.continuationPcs?.[0];
  if (!targetChord
    || !bridge
    || bridge.targetSpanId !== targetChord.spanId
    || targetChord.index !== sourceChord.index + 1
    || sourceChord.functionHint !== 'S'
    || targetChord.functionHint !== 'D'
    || !isAcgCadenceCarrier(entry)
    || endBeat > targetChord.endBeat - slot.reentryGuardBeats
    || next.entry.startBeat < endBeat + slot.reentryGuardBeats
    || next.entry.startBeat > targetChord.endBeat + ACG_AFTERGLOW_EPSILON
    || !isAcgStableResolutionCarrier(next.entry)
    || !hasScoredLowerHandAttack(chordPart, pianoScorePlan, targetChord.startBeat, targetChord.startBeat + 0.25)
    || continuationPc === undefined
    || normalizeAcgPc(targetChord.rootPc + 1) !== continuationPc) return null;

  const roles = entry.token.acg?.stableRoles ?? slot.stableRoles;
  const source = acgStableToneCandidates(sourceChord, roles)
    .find((candidate) => candidate.pc === continuationPc);
  if (!source) return null;

  return withAcgSustainedCarrierContract(
    entry,
    [source.role],
    {
      kind: 'dominant-b9',
      minimumDurationBeats: slot.minimumKeyDownBeats,
      targetChordIndex: targetChord.index,
      continuationPc,
    },
    entry.startBeat,
    slot.minimumKeyDownBeats,
  );
}

function planAcgCommonToneCarrier(
  entry: ScheduledToken,
  next: { index: number; entry: ScheduledToken } | null,
  sourceChord: ChordBlock,
  chordPart: ChordPart,
  slot: AcgPianoLeadContinuitySlot,
): ScheduledToken | null {
  // Return arrivals own an exact `targetPc` path in the realizer; only a
  // scheduler-issued non-return carrier may take the generic common-tone path.
  if (entry.acgReturn) return null;
  const bridge = slot.boundaryBridges.find((candidate) => candidate.kind === 'common-tone');
  const targetChord = getCurrentChordAtBeat(chordPart, sourceChord.endBeat + ACG_AFTERGLOW_EPSILON);
  const endBeat = entry.startBeat + slot.minimumKeyDownBeats;
  if (!bridge
    || !targetChord
    || bridge.targetSpanId !== targetChord.spanId
    || targetChord.index !== sourceChord.index + 1
    || endBeat > targetChord.endBeat - slot.reentryGuardBeats
    || (next && next.entry.startBeat < endBeat + slot.reentryGuardBeats)) return null;

  const roles = entry.token.acg?.stableRoles ?? slot.stableRoles;
  const source = acgStableToneCandidates(sourceChord, roles)
    .find((candidate) => bridge.continuationPcs?.includes(candidate.pc));
  if (!source) return null;

  return withAcgSustainedCarrierContract(
    entry,
    [source.role],
    {
      kind: 'common-tone',
      minimumDurationBeats: slot.minimumKeyDownBeats,
      targetChordIndex: targetChord.index,
      continuationPc: source.pc,
    },
    entry.startBeat,
    slot.minimumKeyDownBeats,
  );
}

function acgLeadContinuitySlotAtBeat(
  pianoScorePlan: AcgPianoScorePlan,
  beat: number,
  sourceChord: ChordBlock,
): AcgPianoLeadContinuitySlot | undefined {
  return pianoScorePlan.leadContinuitySlots?.find((candidate) =>
    candidate.sourceSpanId === sourceChord.spanId
      && beat >= candidate.startBeat - ACG_AFTERGLOW_EPSILON
      && beat < candidate.endBeat - ACG_AFTERGLOW_EPSILON);
}

function explicitAcgRelease(entry: ScheduledToken): ScheduledToken {
  return {
    ...entry,
    token: { kind: 'R', duration: entry.token.duration } as AbstractMelodyToken,
    acgReturn: undefined,
  };
}

function isAcgSustainedSingleCandidate(
  entry: ScheduledToken,
  entries: readonly ScheduledToken[],
  slot: AcgPianoLeadContinuitySlot,
): boolean {
  if (!isAcgSingleAfterglowCarrier(entry, entries)
    // This planner supplies a minimum written duration; it must never shorten
    // an already intentional long grammar carrier to exactly one half note.
    || entry.token.duration >= slot.minimumKeyDownBeats - ACG_AFTERGLOW_EPSILON
    || entry.token.acg?.sustain) return false;
  return true;
}

function acgShortGestureClass(entry: ScheduledToken): 'ornament' | 'pulse' | 'suspension' | undefined {
  if (entry.acgReturn?.role === 'pickup'
    || entry.acgReturn?.role === 'approach'
    || entry.token.kind === 'A'
    || entry.token.kind === 'Triadic') return 'ornament';
  if (entry.acgReturn?.dyad !== undefined || entry.token.acg?.dyad !== undefined) return 'pulse';
  if (entry.token.acg?.colorIntent !== undefined) return 'suspension';
  return undefined;
}

/** A short ornamental atom is legal only when its answer actually follows. */
function hasAcgLocalShortGestureResolution(
  entry: ScheduledToken,
  next: { index: number; entry: ScheduledToken } | null,
): boolean {
  if (!next) return false;
  if (entry.acgReturn?.role === 'approach') {
    const approach = entry.acgReturn;
    const arrival = next.entry.acgReturn;
    return arrival?.role === 'arrival'
      && arrival.gestureId === approach.gestureId
      && Math.abs(next.entry.startBeat - approach.arrivalBeat) <= ACG_AFTERGLOW_EPSILON;
  }
  const gapAfterRelease = next.entry.startBeat - (entry.startBeat + entry.token.duration);
  return gapAfterRelease <= 0.75 + ACG_AFTERGLOW_EPSILON;
}

function nextAcgPlayableEntry(
  entries: readonly ScheduledToken[],
  sourceIndex: number,
): { index: number; entry: ScheduledToken } | null {
  const source = entries[sourceIndex]!;
  for (let index = sourceIndex + 1; index < entries.length; index++) {
    const entry = entries[index]!;
    if (isAcgPlayableToken(entry.token) && entry.startBeat > source.startBeat + ACG_AFTERGLOW_EPSILON) {
      return { index, entry };
    }
  }
  return null;
}

function previousAcgPlayableEnd(entries: readonly ScheduledToken[], sourceIndex: number): number | undefined {
  let end: number | undefined;
  for (let index = 0; index < sourceIndex; index++) {
    const entry = entries[index]!;
    if (!isAcgPlayableToken(entry.token)) continue;
    const candidate = entry.startBeat + Math.max(0, entry.token.duration);
    if (end === undefined || candidate > end) end = candidate;
  }
  return end;
}

function isAcgCadenceCarrier(entry: ScheduledToken): boolean {
  return entry.brickFamily === 'Cadence' || /cadence/i.test(entry.brickName ?? '');
}

function isAcgStableResolutionCarrier(entry: ScheduledToken): boolean {
  return isAcgPlayableToken(entry.token)
    && entry.token.kind !== 'A'
    && entry.token.kind !== 'Triadic'
    && !entry.token.acg?.colorIntent
    && (entry.acgReturn?.role === 'arrival'
      || entry.token.kind === 'G'
      || entry.token.kind === 'B'
      || entry.token.duration >= 0.75 - ACG_AFTERGLOW_EPSILON
      || (entry.token.acg?.harmonicScope === 'current-chord'
        && (entry.token.acg.stableRoles?.length ?? 0) > 0));
}

function hasScoredLowerHandAttack(
  chordPart: ChordPart,
  pianoScorePlan: AcgPianoScorePlan,
  startBeat: number,
  endBeat: number,
): boolean {
  for (const block of chordPart.blocks) {
    if (block.endBeat < startBeat - ACG_AFTERGLOW_EPSILON
      || block.startBeat > endBeat + ACG_AFTERGLOW_EPSILON) continue;
    const score = block.spanId ? pianoScorePlan.spanById[block.spanId] : undefined;
    if (!score) continue;
    for (const event of [...(score.comp?.events ?? []), ...(score.bass?.events ?? [])]) {
      const atBeat = block.startBeat + event.atBeat;
      if (atBeat >= startBeat - ACG_AFTERGLOW_EPSILON
        && atBeat <= endBeat + ACG_AFTERGLOW_EPSILON) return true;
    }
  }
  return false;
}

function withAcgSustainedCarrierContract(
  entry: ScheduledToken,
  fallbackRoles: readonly AcgStableRole[],
  sustain: AcgSustainedCarrierIntent,
  startBeat: number,
  duration: number,
): ScheduledToken {
  const existing = entry.token.acg;
  const stableRoles = existing?.stableRoles ?? fallbackRoles;
  const acg = {
    harmonicScope: existing?.harmonicScope ?? 'current-chord',
    stableRoles,
    ...(existing?.dyad ? { dyad: existing.dyad } : {}),
    sustain,
  } as AbstractMelodyToken['acg'];
  return {
    ...entry,
    startBeat,
    token: { ...entry.token, duration, acg } as AbstractMelodyToken,
    ...(entry.acgReturn ? { acgReturn: { ...entry.acgReturn, arrivalBeat: startBeat } } : {}),
  };
}

function normalizeAcgPc(value: number): number {
  return ((value % 12) + 12) % 12;
}

/**
 * Compile a lead single-note → written-rest gesture into a shared-piano
 * damper intent while tokens still own rhythm and harmonic context.  This is
 * deliberately not a FinalIR gap scan: the score can veto it when either
 * lower hand has a new attack, and the renderer still needs an already
 * authorized CC64 lane to execute it.
 *
 * A high piano note naturally loses energy long before an arbitrarily long
 * rest ends.  At ~80 BPM the ordinary cap is 3 beats (~2.25 s); opening/coda
 * phrases may use 4 beats (~3 s).  Longer written rests are handled by the
 * scheduler's existing return-release brick rather than indefinite pedal.
 */
export function planAcgLeadAfterglowHolds(
  entries: readonly ScheduledToken[],
  chordPart: ChordPart,
  pianoScorePlan: AcgPianoScorePlan | undefined,
  tempoBpm: number | undefined,
): readonly AcgPianoPedalHold[] {
  if (!pianoScorePlan || entries.length === 0) return [];
  const ordered = [...entries].sort(compareAcgScheduledOrder);
  const holds: AcgPianoPedalHold[] = [];
  const safeTempo = Number.isFinite(tempoBpm) && (tempoBpm ?? 0) > 0 ? tempoBpm! : 80;

  for (let index = 0; index < ordered.length; index++) {
    const entry = ordered[index]!;
    if (!isAcgSingleAfterglowCarrier(entry, ordered)) continue;
    const noteEnd = entry.startBeat + entry.token.duration;
    const restEnd = continuousExplicitRestEnd(ordered, index, noteEnd, chordPart.totalBeats);
    if (restEnd === undefined || restEnd - noteEnd < ACG_AFTERGLOW_MIN_REST_BEATS - ACG_AFTERGLOW_EPSILON) continue;

    const lowerHandAttack = nextScoredLowerHandAttack(
      chordPart,
      pianoScorePlan,
      noteEnd,
      restEnd,
    );
    const safeRestEnd = Math.min(restEnd, lowerHandAttack ?? restEnd);
    const phrase = Object.values(pianoScorePlan.phraseById).find((candidate) =>
      entry.startBeat >= candidate.startBeat - ACG_AFTERGLOW_EPSILON
      && entry.startBeat < candidate.endBeat - ACG_AFTERGLOW_EPSILON,
    );
    const cadential = phrase?.phase === 'opening' || phrase?.phase === 'coda'
      || entry.acgReturn?.role === 'arrival';
    const maxTailBeats = cadential
      ? Math.max(2.5, Math.min(4, 3 * safeTempo / 60))
      : Math.max(2, Math.min(3, 2.25 * safeTempo / 60));
    const endBeat = Math.min(
      noteEnd + maxTailBeats,
      safeRestEnd - ACG_AFTERGLOW_RELEASE_GUARD_BEATS,
    );
    if (endBeat - noteEnd < ACG_AFTERGLOW_MIN_TAIL_BEATS - ACG_AFTERGLOW_EPSILON) continue;
    holds.push({
      startBeat: entry.startBeat,
      endBeat,
      reason: 'lead-afterglow',
      ...(lowerHandAttack === undefined ? {} : { reengageBeat: lowerHandAttack }),
    });
  }

  return coalesceAcgAfterglowHolds(holds);
}

function isAcgSingleAfterglowCarrier(entry: ScheduledToken, entries: readonly ScheduledToken[]): boolean {
  if (!isAcgPlayableToken(entry.token) || entry.token.duration <= ACG_AFTERGLOW_EPSILON) return false;
  // An explicitly authored return dyad is already its own miniature phrase;
  // do not pretend it is a solitary lingering top note.
  if (entry.acgReturn?.dyad) return false;
  return !entries.some((other) => other !== entry
    && isAcgPlayableToken(other.token)
    && Math.abs(other.startBeat - entry.startBeat) <= ACG_AFTERGLOW_EPSILON);
}

/** Return only a rest explicitly encoded by the token scheduler. */
function continuousExplicitRestEnd(
  entries: readonly ScheduledToken[],
  sourceIndex: number,
  noteEnd: number,
  songEnd: number,
): number | undefined {
  let coveredUntil = noteEnd;
  let sawRest = false;

  for (let index = sourceIndex + 1; index < entries.length; index++) {
    const entry = entries[index]!;
    if (entry.token.kind === 'SlopeEnter' || entry.token.kind === 'SlopeExit') continue;
    if (isAcgPlayableToken(entry.token)) {
      if (!sawRest || entry.startBeat > coveredUntil + ACG_AFTERGLOW_EPSILON) return undefined;
      return Math.min(coveredUntil, entry.startBeat, songEnd);
    }
    if (entry.token.kind !== 'R' || entry.token.duration <= ACG_AFTERGLOW_EPSILON) continue;
    if (entry.startBeat > coveredUntil + ACG_AFTERGLOW_EPSILON) return undefined;
    const restEnd = entry.startBeat + entry.token.duration;
    if (restEnd > coveredUntil + ACG_AFTERGLOW_EPSILON) {
      coveredUntil = restEnd;
      sawRest = true;
    }
  }
  return sawRest ? Math.min(coveredUntil, songEnd) : undefined;
}

/** A new middle/low-hand onset owns the next pedal change; do not wash it. */
function nextScoredLowerHandAttack(
  chordPart: ChordPart,
  pianoScorePlan: AcgPianoScorePlan,
  afterBeat: number,
  beforeBeat: number,
): number | undefined {
  let next: number | undefined;
  for (const block of chordPart.blocks) {
    if (block.endBeat <= afterBeat + ACG_AFTERGLOW_EPSILON
      || block.startBeat >= beforeBeat - ACG_AFTERGLOW_EPSILON) continue;
    const score = block.spanId ? pianoScorePlan.spanById[block.spanId] : undefined;
    if (!score) continue;
    const events = [...score.comp.events, ...score.bass.events];
    for (const event of events) {
      const atBeat = block.startBeat + event.atBeat;
      if (atBeat <= afterBeat + ACG_AFTERGLOW_EPSILON
        || atBeat >= beforeBeat - ACG_AFTERGLOW_EPSILON) continue;
      if (next === undefined || atBeat < next) next = atBeat;
    }
  }
  return next;
}

function coalesceAcgAfterglowHolds(holds: readonly AcgPianoPedalHold[]): readonly AcgPianoPedalHold[] {
  const out: AcgPianoPedalHold[] = [];
  for (const hold of [...holds].sort((left, right) => left.startBeat - right.startBeat || left.endBeat - right.endBeat)) {
    const previous = out.at(-1);
    if (previous && hold.startBeat <= previous.endBeat + ACG_AFTERGLOW_EPSILON) {
      previous.endBeat = Math.max(previous.endBeat, hold.endBeat);
      if (hold.reengageBeat !== undefined) {
        previous.reengageBeat = Math.max(previous.reengageBeat ?? -Infinity, hold.reengageBeat);
      }
      continue;
    }
    out.push({ ...hold });
  }
  return out;
}

/**
 * Translate arranger-owned silent windows into token-time rests before the
 * realizer can emit a note. A held token is cut at the window edge instead of
 * merely suppressing its onset downstream; otherwise it would still ring
 * through a planned breath. This remains a score/scheduler operation, not a
 * NoteIR filter.
 */
function applyAcgLeadPresencePlan(
  entries: ScheduledToken[],
  plan: AcgLeadPresencePlan | undefined,
): ScheduledToken[] {
  if (!plan || plan.silenceWindows.length === 0) return entries;
  const out: ScheduledToken[] = [];
  for (const entry of entries) {
    // Markers have no duration, so ordinary overlap logic cannot see that an
    // open slope crosses a form-level rest. Handle their paired lifetime
    // below, where a silence can explicitly close/drop the group.
    if (isAcgSlopeMarker(entry)) continue;
    const tokenEnd = entry.startBeat + entry.token.duration;
    if (entry.token.duration <= 0 || entry.token.kind === 'R'
      || !overlapsAcgLeadSilence(entry.startBeat, tokenEnd, plan)) {
      out.push(entry);
      continue;
    }

    // An approach cannot survive being separated from its immediate arrival.
    // Preserve the authored duration as an explicit rest; a later legal
    // audible token will receive a fresh return gesture if the form asks for it.
    if (entry.token.kind === 'A') {
      out.push({ ...entry, token: { kind: 'R', duration: entry.token.duration } as AbstractMelodyToken });
      continue;
    }

    const cuts = [entry.startBeat, tokenEnd];
    for (const window of plan.silenceWindows) {
      if (window.startBeat > entry.startBeat + 1e-4 && window.startBeat < tokenEnd - 1e-4) cuts.push(window.startBeat);
      if (window.endBeat > entry.startBeat + 1e-4 && window.endBeat < tokenEnd - 1e-4) cuts.push(window.endBeat);
    }
    cuts.sort((a, b) => a - b);
    for (let index = 0; index < cuts.length - 1; index++) {
      const startBeat = cuts[index]!;
      const endBeat = cuts[index + 1]!;
      const duration = endBeat - startBeat;
      if (duration <= 1e-4) continue;
      const isSilent = overlapsAcgLeadSilence(startBeat, endBeat, plan);
      out.push({
        ...entry,
        startBeat,
        token: isSilent
          ? { kind: 'R', duration } as AbstractMelodyToken
          : { ...entry.token, duration } as AbstractMelodyToken,
      });
    }
  }
  return [...out, ...normalizeAcgSlopeMarkersForPresence(entries, plan)]
    .sort(compareAcgScheduledOrder);
}

function isAcgSlopeMarker(entry: ScheduledToken): boolean {
  return entry.token.kind === 'SlopeEnter' || entry.token.kind === 'SlopeExit';
}

function silenceWindowContaining(beat: number, plan: AcgLeadPresencePlan): AcgLeadPresencePlan['silenceWindows'][number] | undefined {
  return plan.silenceWindows.find((window) => beat >= window.startBeat - 1e-4 && beat < window.endBeat - 1e-4);
}

/**
 * A slope marker is a stateful grammar instruction, not an inaudible no-op.
 * If a planned rest cuts its group, close the group at the rest edge (or drop
 * a group born inside the rest) so a new re-entry phrase never inherits the
 * deleted phrase's directional interval constraint.
 */
function normalizeAcgSlopeMarkersForPresence(
  entries: readonly ScheduledToken[],
  plan: AcgLeadPresencePlan,
): ScheduledToken[] {
  const markers = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => isAcgSlopeMarker(entry))
    .sort((left, right) => compareAcgScheduledOrder(left.entry, right.entry));
  const keep = new Set(markers.map(({ index }) => index));
  const added: ScheduledToken[] = [];
  const open: Array<{ entry: ScheduledToken; index: number }> = [];

  for (const marker of markers) {
    const { entry, index } = marker;
    if (entry.token.kind === 'SlopeEnter') {
      open.push({ entry, index });
      continue;
    }

    const opener = open.pop();
    if (!opener) {
      if (silenceWindowContaining(entry.startBeat, plan)) keep.delete(index);
      continue;
    }
    const crossed = plan.silenceWindows.find((window) =>
      // An exit exactly at a planned silence boundary still belongs to the
      // pre-silence slope.  The old strict `>` test dropped that exit later
      // as a marker inside the window, leaving its opener live for the next
      // audible phrase.  Close the group at the real boundary instead.
      opener.entry.startBeat < window.startBeat - 1e-4
      && entry.startBeat >= window.startBeat - 1e-4,
    );
    if (!crossed) continue;

    const openerInside = !!silenceWindowContaining(opener.entry.startBeat, plan);
    if (openerInside) {
      // A slope that starts in a deleted phrase never becomes state at all.
      keep.delete(opener.index);
      keep.delete(index);
      continue;
    }

    // Preserve audible motion before the rest, but close it precisely at the
    // boundary and discard its original later exit. Multiple nested groups
    // intentionally produce multiple exits at the same boundary. The common
    // scheduler comparator deliberately places these markers before any
    // same-beat audible carrier, so no new entry inherits this old slope.
    keep.delete(index);
    added.push({
      ...entry,
      token: { kind: 'SlopeExit', duration: 0 } as AbstractMelodyToken,
      startBeat: crossed.startBeat,
    });
  }

  // Unterminated groups are normally closed by spreadTokensAcrossAcgCycle,
  // but fail closed at the first planned silence if a malformed legacy source
  // reaches this layer.
  for (const opener of open) {
    const inside = silenceWindowContaining(opener.entry.startBeat, plan);
    if (inside) {
      keep.delete(opener.index);
      continue;
    }
    const nextWindow = plan.silenceWindows.find((window) => window.startBeat > opener.entry.startBeat + 1e-4);
    if (nextWindow) {
      added.push({
        ...opener.entry,
        token: { kind: 'SlopeExit', duration: 0 } as AbstractMelodyToken,
        startBeat: Math.max(0, nextWindow.startBeat - 1e-5),
      });
    }
  }

  return [
    ...markers
      .filter(({ entry, index }) => keep.has(index) && !silenceWindowContaining(entry.startBeat, plan))
      .map(({ entry }) => entry),
    ...added,
  ];
}

/**
 * ACG 的 note identity 属于其 onset 的和弦。长句铺展时，普通旧和弦结构音不能
 * 自然延到下一和弦后再靠末端 resolver 改音；在 scheduler 这里裁到边界，下一
 * 和弦是否开新声由 grammar/RoadMap 决定。唯一例外是后段由
 * `planAcgSustainedSingleCarriers` 写入完整合同的 cadence suspension。
 */
function clipAcgTokensToChordBoundaries(entries: ScheduledToken[], chordPart: ChordPart): ScheduledToken[] {
  return entries.map((entry) => {
    if (entry.token.duration <= 0 || entry.token.kind === 'R') return entry;
    const chord = getCurrentChordAtBeat(chordPart, entry.startBeat);
    if (!chord) return entry;
    const room = chord.endBeat - entry.startBeat;
    if (room <= 0.01 || entry.token.duration <= room + 1e-4) return entry;
    return { ...entry, token: { ...entry.token, duration: Math.max(0.01, room) } as AbstractMelodyToken };
  });
}

/**
 * `A` 只有在很短、紧贴目标、且留在同一和弦里时才是听觉上的“滑向落点”。
 * cycle-spread 会把部分旧 grammar 的 A 拉成近一拍甚至跨和弦的悬空半音；那不再是
 * 用户要的短 riff。这里仍处于 RoadMap/token 调度期，直接把失效的 A 降为 C，
 * 由 realizer 以当前 HarmonicPlan 的 stableToneMap 实化成稳定声部，而不是生成完
 * NoteIR 后再修音。显式 return brick 的 approach 已有自己的原子语义，绝不触碰。
 */
function normalizeAcgDeferredApproaches(entries: ScheduledToken[], chordPart: ChordPart): ScheduledToken[] {
  const MAX_APPROACH_DURATION = 0.5;
  const MAX_APPROACH_TO_TARGET = 0.75;
  return entries.map((entry, index) => {
    if (entry.acgReturn || entry.token.kind !== 'A') return entry;
    const target = entries[index + 1];
    const targetIsPlayable = !!target
      && target.token.kind !== 'A'
      && target.token.kind !== 'R'
      && target.token.kind !== 'SlopeEnter'
      && target.token.kind !== 'SlopeExit';
    const spacing = target ? target.startBeat - entry.startBeat : Infinity;
    const sourceChord = getCurrentChordAtBeat(chordPart, entry.startBeat);
    const targetChord = target ? getCurrentChordAtBeat(chordPart, target.startBeat) : null;
    const isShortLocalPair = targetIsPlayable
      && entry.token.duration <= MAX_APPROACH_DURATION + 1e-4
      && spacing >= entry.token.duration - 1e-4
      && spacing <= MAX_APPROACH_TO_TARGET + 1e-4
      && !!sourceChord
      && sourceChord.index === targetChord?.index
      // A generic A is a passing note, never a downbeat or chord-entry
      // identity.  Return-brick approaches have their own placement proof;
      // a cycle-stretched source A does not, so anchor it before realization
      // when its mapped onset lands on the structural grid.
      && !isAcgReturnNonArrivalStructuralBeat(entry.startBeat, sourceChord, chordPart);
    if (isShortLocalPair) return entry;
    return { ...entry, token: { kind: 'C', duration: entry.token.duration } as AbstractMelodyToken };
  });
}

/**
 * Cycle stretching and chord-boundary clipping can combine into a gap that
 * was never an authored musical breath: the old source note is shortened at
 * a new chord, while the next source token keeps its distant stretched onset.
 *
 * Rather than patching the finished lead, treat that interval as a planned
 * phrase-rest window here. Once it exceeds the ACG breath ceiling, issue a
 * small C carrier on the next useful harmonic boundary. materializeAcgReturn
 * then turns it into a proper T/S/D return brick with an exact stable target.
 * The inserted R makes the rest explicit for the grammar; this stays entirely
 * inside RoadMap → scheduler → realizer and never manufactures NoteIR later.
 */
function scheduleAcgBreathReleaseBricks(
  entries: ScheduledToken[],
  expansions: BrickExpansion[],
  chordPart: ChordPart,
): ScheduledToken[] {
  // A long empty piano tail stops sounding well before a six-beat rest, even
  // with the damper down.  Keep roughly a three-beat inhale, then let an
  // existing return brick write a quiet answer/arrival.  The resulting
  // carrier remains scheduler-authored rather than a NoteIR fill.
  const MAX_SILENCE_BEATS = 4.25;
  const MIN_BREATH_BEFORE_RELEASE = 3;
  const MIN_RELEASE_DURATION = 0.5;
  const injected: ScheduledToken[] = [];
  const playable = entries.filter((entry) => isPlayableToken(entry.token));

  for (let index = 1; index < playable.length; index++) {
    const previous = playable[index - 1];
    const next = playable[index];
    let previousEnd = previous.startBeat + Math.max(0, previous.token.duration);
    const nextStart = next.startBeat;

    // An authored R is an explicit breath. A second legitimate source is a
    // token that was cut at a harmonic boundary by cycle stretching: the
    // source grammar did not ask for ten beats of silence, it simply had its
    // next stretched onset far away. Both cases are score-time phrase rests;
    // arbitrary short spacing still remains untouched.
    const hasAuthoredRest = entries.some((entry) => entry.token.kind === 'R'
      && entry.startBeat >= previousEnd - 1e-4
      && entry.startBeat < nextStart - 1e-4);
    const previousChord = getCurrentChordAtBeat(chordPart, previous.startBeat);
    const wasClippedAtBoundary = !!previousChord
      && Math.abs(previousEnd - previousChord.endBeat) <= 1e-4;
    // SlopeExit/SlopeEnter delimit an authored grammar phrase even when the
    // source rule encodes its breath as stretched spacing rather than an R
    // terminal. A very long gap between such groups is eligible for the same
    // scheduler-owned release; a plain sparse token stream is not.
    const hasSlopePhraseBoundary = entries.some((entry) => (entry.token.kind === 'SlopeEnter' || entry.token.kind === 'SlopeExit')
      && entry.startBeat > previous.startBeat + 1e-4
      && entry.startBeat <= nextStart + 1e-4);
    if (!hasAuthoredRest && !wasClippedAtBoundary && !hasSlopePhraseBoundary) continue;

    while (nextStart - previousEnd > MAX_SILENCE_BEATS + 1e-4) {
      const releaseStart = chooseAcgBreathReleaseBeat(
        previousEnd,
        nextStart,
        MIN_BREATH_BEFORE_RELEASE,
        MIN_RELEASE_DURATION,
        chordPart,
      );
      const releaseChord = getCurrentChordAtBeat(chordPart, releaseStart);
      const actual = releaseChord ? actualBrickAtBeat(expansions, releaseStart) : null;
      const available = Math.min(
        releaseChord ? releaseChord.endBeat - releaseStart : 0,
        nextStart - releaseStart - 0.18,
      );
      if (!actual || available < MIN_RELEASE_DURATION - 1e-4) break;

      // The R is not a second silence: it identifies the implicit portion
      // created by boundary clipping, so the following C is interpreted as
      // a return-brick arrival rather than a generic filler note.
      injected.push({
        ...previous,
        token: { kind: 'R', duration: Math.max(0.01, releaseStart - previousEnd) },
        startBeat: previousEnd,
      });
      injected.push({
        ...next,
        token: { kind: 'C', duration: Math.min(0.75, available) },
        startBeat: releaseStart,
        brickIndex: actual.brickIndex,
        brickName: actual.brick.name,
        brickFamily: actual.brick.family,
        brickStartBeat: actual.brick.startBeat,
        brickEndBeat: actual.brick.startBeat + actual.brick.durationBeats,
      });
      previousEnd = releaseStart + Math.min(0.75, available);
    }
  }

  if (injected.length === 0) return entries;
  return [...entries, ...injected].sort(compareAcgScheduledOrder);
}

function chooseAcgBreathReleaseBeat(
  previousEnd: number,
  nextStart: number,
  minBreath: number,
  minReleaseDuration: number,
  chordPart: ChordPart,
): number {
  const latest = Math.min(nextStart - minReleaseDuration, previousEnd + 6);
  const viable = chordPart.blocks.filter((block) => block.startBeat <= latest + 1e-4
    && block.endBeat - minReleaseDuration > previousEnd + 1e-4);
  const preferredBoundary = viable.find((block) => block.startBeat >= previousEnd + minBreath - 1e-4
    && block.startBeat <= nextStart - minReleaseDuration - 1e-4);
  if (preferredBoundary) return preferredBoundary.startBeat;

  // If the ideal three-beat breath would leave no playable room in the next
  // chord, a nearby harmonic boundary may still support a 2½-beat sigh. This
  // is preferable to silently exceeding the maximum breath ceiling, and it
  // stays on a real chord boundary rather than inventing a late NoteIR fill.
  const compactBoundary = viable.find((block) => block.startBeat >= previousEnd + 2.5 - 1e-4
    && block.startBeat <= nextStart - minReleaseDuration - 1e-4);
  if (compactBoundary) return compactBoundary.startBeat;

  // Non-bar-aligned changes are rare, but a long rest still needs an authored
  // release. Keep the carrier inside the active chord—old code used `latest`
  // directly, which could leave < minReleaseDuration before the next chord
  // and then abandon the release entirely.
  const active = [...viable].reverse().find((block) => block.startBeat <= latest + 1e-4);
  if (active) return Math.max(active.startBeat, Math.min(latest, active.endBeat - minReleaseDuration));
  return latest;
}

type AcgReturnShape = AcgReturnGestureIntent['shape'];
type ResolvedAcgDyad = NonNullable<AcgReturnGestureIntent['dyad']>;

/**
 * An arranger phrase may deliberately prohibit the ordinary stable landing.
 * `undefined` means there is no phrase-owned constraint; an empty array is
 * instead an explicit no-return contract and must not fall through to the
 * scheduler's generic preference list.
 */
function isAcgReturnShapeAllowed(
  shape: AcgReturnShape,
  allowedShapes: readonly AcgPianoReturnShape[] | undefined,
): boolean {
  return allowedShapes === undefined || allowedShapes.includes(shape);
}

/** Look up the arranger's hard return-shape contract at this beat. */
function acgReturnShapesAtBeat(
  pianoScorePlan: AcgPianoScorePlan | undefined,
  beat: number,
): readonly AcgPianoReturnShape[] | undefined {
  return Object.values(pianoScorePlan?.phraseById ?? {})
    .find((phrase) => beat >= phrase.startBeat - 1e-4 && beat < phrase.endBeat - 1e-4)
    ?.lead.returnShapes;
}

interface AcgReturnArrivalTarget extends AcgStableToneCandidate {
  dyad?: ResolvedAcgDyad;
}

/**
 * 将明确的“休止结束”翻译成短回归手势。重点是失败时宁可保留原 grammar，
 * 也不制造一颗无归属的补音：没有实际 RoadMap brick、稳定音或足够的休止空间时直接跳过。
 */
function materializeAcgReturnGestures(
  entries: ScheduledToken[],
  expansions: BrickExpansion[],
  chordPart: ChordPart,
  leadPresencePlan?: AcgLeadPresencePlan,
  pianoScorePlan?: AcgPianoScorePlan,
): ScheduledToken[] {
  const out: ScheduledToken[] = [];
  let restStart: number | null = null;
  let gestureOrdinal = 0;

  for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
    const entry = entries[entryIndex]!;
    if (entry.token.kind === 'R') {
      restStart ??= entry.startBeat;
      out.push(entry);
      continue;
    }
    if (entry.token.kind === 'SlopeEnter' || entry.token.kind === 'SlopeExit') {
      out.push(entry);
      continue;
    }

    const rawRestBeats = restStart === null ? 0 : entry.startBeat - restStart;
    // A form-level silence may span several bars. It should invite a compact
    // sigh/riff on re-entry, not trick the grammar into filling the entire
    // absence with its longest possible gesture.
    const plannedRelease = isAcgLeadScheduledRelease(restStart, entry.startBeat, leadPresencePlan);
    const returnShapes = acgReturnShapesAtBeat(pianoScorePlan, entry.startBeat);
    const restBeats = plannedRelease
      ? Math.min(rawRestBeats, leadPresencePlan!.returnRestCapBeats)
      : rawRestBeats;
    const planned = restStart === null
      ? null
      : plannedRelease
        ? planAcgPostEntryReturnGesture(
          entry,
          restBeats,
          expansions,
          chordPart,
          gestureOrdinal,
          acgPostEntrySlotEnd(entries, entryIndex, entry),
          leadPresencePlan,
          returnShapes,
        ) ?? planAcgReturnGesture(entry, restBeats, expansions, chordPart, gestureOrdinal, leadPresencePlan, returnShapes)
        : planAcgReturnGesture(entry, restBeats, expansions, chordPart, gestureOrdinal, leadPresencePlan, returnShapes);
    restStart = null;

    if (!planned) {
      out.push(entry);
      continue;
    }
    gestureOrdinal++;
    out.push(...planned);
  }
  return out.sort(compareAcgScheduledOrder);
}

const ACG_GENERIC_STABLE_ROLES: readonly AcgReturnStableRole[] = ['root', 'third', 'fifth', 'seventh'];

/**
 * Attach an explicit harmonic contract to every ordinary ACG carrier that
 * this scheduler has made structural. This deliberately happens after breath
 * splitting and return insertion: those operations can turn a formerly
 * passing token into a long/strong landing, or create the target of a
 * surviving generic A → target pair.
 *
 * Existing ACG intents are never overwritten. Return arrivals own a more
 * specific scope/role set, while borrowed-color approaches are passing atoms
 * rather than stable anchors.
 */
function attachAcgStructuralTokenContracts(
  entries: readonly ScheduledToken[],
  chordPart: ChordPart,
): ScheduledToken[] {
  const anchors = new Set<number>();

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    if (shouldCarryAcgStableContract(entry, chordPart)) anchors.add(index);

    // A generic A retained by normalizeAcgDeferredApproaches is a short,
    // local pair. Its next carrier is still forced to a stable anchor by the
    // realizer, so token-time scheduling must own that contract as well.
    if (entry.acgReturn || entry.token.kind !== 'A') continue;
    const target = entries[index + 1];
    if (!target || target.acgReturn || !isAcgPlayableToken(target.token)) continue;
    const sourceChord = getCurrentChordAtBeat(chordPart, entry.startBeat);
    const targetChord = getCurrentChordAtBeat(chordPart, target.startBeat);
    if (sourceChord && sourceChord.index === targetChord?.index) anchors.add(index + 1);
  }

  return entries.map((entry, index) => {
    if (!anchors.has(index) || entry.token.acg || !isAcgPlayableToken(entry.token)) return entry;
    return {
      ...entry,
      token: {
        ...entry.token,
        acg: {
          harmonicScope: 'current-chord',
          stableRoles: stableRolesForAcgStructuralToken(entry.token),
        },
      } as AbstractMelodyToken,
    };
  });
}

/**
 * Preserve the shared score-clock identity through pitch realization.  This
 * does not move a finished note: it annotates the final token-time schedule,
 * including return gestures introduced inside this scheduler, with the
 * nearest Arranger anchor and whether that token is an accent-bearing
 * structure or connective flow.
 */
function attachAcgMetricAnchorContracts(
  entries: readonly ScheduledToken[],
  grid: AcgPianoMetricGrid | undefined,
): ScheduledToken[] {
  if (!grid) return [...entries];
  return entries.map((entry) => {
    if (!isAcgPlayableToken(entry.token)) return entry;
    const anchor = nearestAcgLeadMetricAnchor(grid.anchors, entry.startBeat);
    if (!anchor) return entry;
    const inheritedRole = entry.acgMetricRole;
    const role = entry.acgReturn
      ? entry.acgReturn.role === 'arrival' ? 'structural' : 'flow'
      : inheritedRole ?? (isAcgStableArrivalIntent(entry.token) ? 'structural' : 'flow');
    return {
      ...entry,
      acgMetricAnchorId: anchor.id,
      acgMetricStrength: anchor.strength,
      acgMetricRole: role,
    };
  });
}

function isAcgStableArrivalIntent(token: AbstractMelodyToken): boolean {
  return !!token.acg && 'stableRoles' in token.acg;
}

function nearestAcgLeadMetricAnchor(
  anchors: readonly AcgPianoMetricAnchor[],
  beat: number,
): AcgPianoMetricAnchor | undefined {
  return [...anchors].sort((left, right) =>
    Math.abs(left.beat - beat) - Math.abs(right.beat - beat)
    || right.strength - left.strength
    || left.beat - right.beat
    || left.id.localeCompare(right.id))[0];
}

function isAcgPlayableToken(token: AbstractMelodyToken): boolean {
  return token.kind !== 'R' && token.kind !== 'SlopeEnter' && token.kind !== 'SlopeExit';
}

function shouldCarryAcgStableContract(entry: ScheduledToken, chordPart: ChordPart): boolean {
  const token = entry.token;
  if (token.acg || !isAcgPlayableToken(token)) return false;
  // A and Triadic retain explicit motion semantics. An unsafe generic A is
  // normalized to C earlier; a safe one delegates its target contract above.
  if (token.kind === 'A' || token.kind === 'Triadic') return false;
  if (token.kind === 'G' || token.kind === 'B') return true;
  if (token.duration >= 0.75 - 1e-4) return true;
  const chord = getCurrentChordAtBeat(chordPart, entry.startBeat);
  return !!chord && isAcgStructuralBeat(entry.startBeat, chord, chordPart);
}

function stableRolesForAcgStructuralToken(token: AbstractMelodyToken): readonly AcgReturnStableRole[] {
  // B is the one ordinary terminal with an unambiguous stable role. Other
  // structural terminals may resolve to any plan-declared chord role; that
  // full set is still an explicit, enforceable grammar contract.
  return token.kind === 'B' ? ['root'] : ACG_GENERIC_STABLE_ROLES;
}

/** Same metric tolerance as the realizer and final structural auditor. */
function isAcgStructuralBeat(beat: number, chord: ChordBlock, chordPart: ChordPart): boolean {
  const [numerator, denominator] = chordPart.meter;
  const beatsPerBar = numerator * (4 / denominator);
  if (Number.isFinite(beatsPerBar) && beatsPerBar > 0) {
    const phase = ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar;
    const distanceToStrong = Math.min(
      Math.abs(phase),
      Math.abs(phase - beatsPerBar / 2),
      Math.abs(phase - beatsPerBar),
    );
    if (distanceToStrong <= ACG_RETURN_NON_ARRIVAL_GUARD_BEATS + ACG_RETURN_PLACEMENT_EPSILON) return true;
  }
  return Math.abs(beat - chord.startBeat) <= ACG_RETURN_NON_ARRIVAL_GUARD_BEATS + ACG_RETURN_PLACEMENT_EPSILON;
}

/**
 * A form-owned silence must not be retrospectively filled from the left. Its
 * first audible carrier instead owns a small forward slot.  Keep the response
 * inside that carrier and before the next source token, so the scheduler can
 * replace one abstract token with a mini phrase without creating NoteIR
 * overlap or changing the remaining RoadMap sequence.
 */
function acgPostEntrySlotEnd(
  entries: readonly ScheduledToken[],
  entryIndex: number,
  entry: ScheduledToken,
): number {
  let endBeat = entry.startBeat + entry.token.duration;
  for (let index = entryIndex + 1; index < entries.length; index++) {
    const next = entries[index]!;
    // A concurrent source token has already claimed the carrier. Do not make
    // a supposedly monophonic lead re-entry compete with it.
    if (next.startBeat <= entry.startBeat + ACG_RETURN_PLACEMENT_EPSILON) return entry.startBeat;
    endBeat = Math.min(endBeat, next.startBeat);
    break;
  }
  return endBeat;
}

function returnRoleOrder(entry: ScheduledToken): number {
  const role = entry.acgReturn?.role;
  return role === 'pickup' ? -2 : role === 'approach' ? -1 : 0;
}

/**
 * Token order is part of the slope grammar contract: markers mutate the
 * realizer's active slope state, so a marker sharing an onset with a note
 * must be observed first.  Close before open when two groups meet on the same
 * beat; then retain the previous rest/return ordering among non-markers.
 */
function compareAcgScheduledOrder(left: ScheduledToken, right: ScheduledToken): number {
  const byBeat = left.startBeat - right.startBeat;
  if (Math.abs(byBeat) > 1e-9) return byBeat;
  const byTokenRole = acgSameBeatTokenOrder(left) - acgSameBeatTokenOrder(right);
  if (byTokenRole !== 0) return byTokenRole;
  return returnRoleOrder(left) - returnRoleOrder(right);
}

function acgSameBeatTokenOrder(entry: ScheduledToken): number {
  // A closure has to win over a new open at a shared boundary. Otherwise an
  // old group could survive into a later carrier before the exit is consumed.
  if (entry.token.kind === 'SlopeExit') return 0;
  if (entry.token.kind === 'SlopeEnter') return 1;
  // Preserve explicit R-before-carrier behavior used by return-gesture
  // detection, while keeping both marker kinds ahead of audible tokens.
  if (entry.token.kind === 'R') return 2;
  return 3;
}

function planAcgReturnGesture(
  entry: ScheduledToken,
  restBeats: number,
  expansions: BrickExpansion[],
  chordPart: ChordPart,
  ordinal: number,
  leadPresencePlan?: AcgLeadPresencePlan,
  allowedShapes?: readonly AcgPianoReturnShape[],
): ScheduledToken[] | null {
  // The first audible post-rest token must be a meaningful landing, not an existing
  // generic approach which has its own adjacent-target contract.
  if (entry.token.kind === 'A' || entry.token.duration < 0.42 || restBeats < 0.72) return null;
  const arrivalChord = getCurrentChordAtBeat(chordPart, entry.startBeat);
  const actual = actualBrickAtBeat(expansions, entry.startBeat);
  if (!arrivalChord || !actual) return null;

  // 若休止跨越 D → T 的和声边界，返回手势的功能身份必须是“前一块 D”，
  // 但 arrival 必须在当前（下一块 T）和弦中实化。这正是 return grammar 的 D/next-chord 语义。
  const beforeArrival = getCurrentChordAtBeat(chordPart, Math.max(0, entry.startBeat - 0.001));
  const func: AcgReturnFunction = beforeArrival
    && beforeArrival.index !== arrivalChord.index
    && beforeArrival.functionHint === 'D'
    ? 'D'
    : (arrivalChord.functionHint ?? 'T');
  let brick = chooseAcgReturnBrick(
    func,
    restBeats,
    entry.token.duration,
    ordinal,
    entry.startBeat,
    chordPart,
    leadPresencePlan,
    allowedShapes,
  );
  if (!brick) return null;
  let targetChord = resolveAcgReturnTargetChord(
    brick,
    func,
    arrivalChord,
    beforeArrival,
    entry.startBeat,
  );
  if (!targetChord) return null;
  let arrivalSpec = brick.tokens.at(-1);
  if (!arrivalSpec || arrivalSpec.role !== 'arrival') return null;
  let target = chooseStableArrival(
    targetChord,
    brick.arrival.stableRoles,
    arrivalSpec.dyad,
    brick.tokens.find((spec) => spec.role === 'approach')?.colorIntent,
    ordinal,
  );
  // A dyad is a strong token contract when selected, but an under-specified
  // harmony may have only one legal stable role. In that case choose the
  // grammar's authored stable-single alternative, rather than dropping the
  // entire planned return or manufacturing an illegal partner at the end.
  if (!target) {
    const fallback = chooseAcgStableReturnFallback(
      func,
      restBeats,
      entry.token.duration,
      entry.startBeat,
      chordPart,
      leadPresencePlan,
      allowedShapes,
    );
    if (!fallback) return null;
    const fallbackTargetChord = resolveAcgReturnTargetChord(
      fallback,
      func,
      arrivalChord,
      beforeArrival,
      entry.startBeat,
    );
    const fallbackArrival = fallback.tokens.at(-1);
    if (!fallbackTargetChord || !fallbackArrival || fallbackArrival.role !== 'arrival') return null;
    const fallbackTarget = chooseStableArrival(
      fallbackTargetChord,
      fallback.arrival.stableRoles,
      fallbackArrival.dyad,
      undefined,
      ordinal,
    );
    if (!fallbackTarget) return null;
    brick = fallback;
    targetChord = fallbackTargetChord;
    arrivalSpec = fallbackArrival;
    target = fallbackTarget;
  }
  const shape = intentShapeFromBrick(brick);
  // Keep this assertion adjacent to emission as a final guard against a new
  // fallback path bypassing `orderedAcgReturnBricks`.
  if (!isAcgReturnShapeAllowed(shape, allowedShapes)) return null;

  const gestureId = `acg-return-${Math.round(entry.startBeat * 100)}-${ordinal}`;
  const base = {
    gestureId,
    brickIndex: actual.brickIndex,
    brickName: actual.brick.name,
    brickFamily: actual.brick.family,
    // `chordIndex` is the old trace-facing name; the explicit target field
    // below makes harmonicScope a checkable, immutable token contract.
    chordIndex: targetChord.index,
    targetChordIndex: targetChord.index,
    function: func,
    shape,
    arrivalBeat: entry.startBeat,
    harmonicScope: brick.arrival.harmonicScope,
    stableRoles: [...brick.arrival.stableRoles],
    targetPc: target.pc,
    targetRole: target.role,
    dyad: target.dyad,
  } as const;

  const preArrival = brick.tokens.slice(0, -1);
  const required = preArrival.reduce((sum, token) => sum + token.durationBeats, 0);
  // Preserve a real breath before the response. A short slot may use a stable
  // landing only when the phrase explicitly permits that smaller shape.
  if (required > 0 && restBeats < required + ACG_RETURN_BREATH_GUARD_BEATS) {
    // A phrase that requested only a sigh/lift must remain silent here; it is
    // not legal to relabel the terminal as a stable single merely because the
    // available slot was too short.
    if (!isAcgReturnShapeAllowed('stableSingle', allowedShapes)) return null;
    return [{
      ...entry,
      token: {
        ...acgReturnTokenToAbstractToken(arrivalSpec, brick.arrival),
        duration: entry.token.duration,
      } as AbstractMelodyToken,
      acgReturn: { ...base, shape: 'stableSingle', role: 'arrival' },
    }];
  }

  const result: ScheduledToken[] = [];
  let cursor = entry.startBeat - required;
  for (const spec of preArrival) {
    const direction = spec.approach?.direction === 'down' ? 'above' : 'below';
    const token = acgReturnTokenToAbstractToken(spec, brick.arrival);
    result.push({
      ...entry,
      token,
      startBeat: cursor,
      acgReturn: {
        ...base,
        role: spec.role,
        approachDirection: spec.role === 'approach' ? direction : undefined,
        approachSemitones: spec.role === 'approach' ? spec.approach?.maxSemitones : undefined,
        // Sidecar is derived from the concrete grammar token, never from a
        // parallel spec field. That makes a borrowed color impossible to
        // inject after token construction.
        colorIntent: spec.role === 'approach' ? acgBorrowedColorIntentFromToken(token) : undefined,
      },
    });
    cursor += spec.durationBeats;
  }
  result.push({
    ...entry,
    // G here is only a compact terminal carrier. `acgReturn.targetPc` takes
    // precedence in the realizer, so this cannot fall back to random guide-tone choice.
    token: {
      ...acgReturnTokenToAbstractToken(arrivalSpec, brick.arrival),
      duration: entry.token.duration,
    } as AbstractMelodyToken,
    acgReturn: { ...base, role: 'arrival' },
  });
  return result;
}

/**
 * A planned arranger rest is different from an authored within-phrase R:
 * placing pickup/approach before its endpoint would undo the arranger's
 * silence.  Reinterpret the first legal carrier as a forward response slot:
 * a tiny quarter-beat inhale, then an existing return-brick's pickup /
 * approach / stable dyad.  This remains RoadMap → scheduler → realizer; it
 * does not add or repair notes after TrackIR exists.
 */
function planAcgPostEntryReturnGesture(
  entry: ScheduledToken,
  restBeats: number,
  expansions: BrickExpansion[],
  chordPart: ChordPart,
  ordinal: number,
  slotEndBeat: number,
  leadPresencePlan?: AcgLeadPresencePlan,
  allowedShapes?: readonly AcgPianoReturnShape[],
): ScheduledToken[] | null {
  if (entry.token.kind === 'A' || entry.token.duration < 0.42 || restBeats < 0.72) return null;
  const actual = actualBrickAtBeat(expansions, entry.startBeat);
  const sourceChord = getCurrentChordAtBeat(chordPart, entry.startBeat);
  if (!actual || !sourceChord) return null;

  const responseStart = entry.startBeat + ACG_RETURN_POST_ENTRY_INHALE_BEATS;
  if (responseStart >= slotEndBeat - ACG_RETURN_PLACEMENT_EPSILON) return null;
  const func: AcgReturnFunction = sourceChord.functionHint ?? 'T';

  for (const brick of orderedAcgReturnBricks(func, restBeats, ordinal, allowedShapes)) {
    const arrivalSpec = brick.tokens.at(-1);
    if (!arrivalSpec || arrivalSpec.role !== 'arrival') continue;
    const preArrival = brick.tokens.slice(0, -1);
    const required = preArrival.reduce((sum, token) => sum + token.durationBeats, 0);
    const arrivalBeat = responseStart + required;
    const arrivalEnd = arrivalBeat + arrivalSpec.durationBeats;
    if (arrivalEnd > slotEndBeat + ACG_RETURN_PLACEMENT_EPSILON) continue;

    const arrivalChord = getCurrentChordAtBeat(chordPart, arrivalBeat);
    const beforeArrival = getCurrentChordAtBeat(chordPart, Math.max(0, arrivalBeat - 0.001));
    if (!arrivalChord) continue;
    // T/S responses retain their function throughout the compact forward
    // slot. D is left to the existing exact-boundary next-chord contract.
    if (func !== 'D' && (arrivalChord.functionHint ?? 'T') !== func) continue;
    const targetChord = resolveAcgReturnTargetChord(brick, func, arrivalChord, beforeArrival, arrivalBeat);
    if (!targetChord) continue;
    if (!isAcgPostEntryReturnBrickPlaceable(
      brick,
      responseStart,
      arrivalBeat,
      arrivalEnd,
      chordPart,
      leadPresencePlan,
    )) continue;

    const target = chooseStableArrival(
      targetChord,
      brick.arrival.stableRoles,
      arrivalSpec.dyad,
      brick.tokens.find((spec) => spec.role === 'approach')?.colorIntent,
      ordinal,
    );
    if (!target) continue;

    const shape = intentShapeFromBrick(brick);
    if (!isAcgReturnShapeAllowed(shape, allowedShapes)) continue;
    const base = {
      gestureId: `acg-return-${Math.round(entry.startBeat * 100)}-${ordinal}`,
      brickIndex: actual.brickIndex,
      brickName: actual.brick.name,
      brickFamily: actual.brick.family,
      chordIndex: targetChord.index,
      targetChordIndex: targetChord.index,
      function: func,
      shape,
      arrivalBeat,
      harmonicScope: brick.arrival.harmonicScope,
      stableRoles: [...brick.arrival.stableRoles],
      targetPc: target.pc,
      targetRole: target.role,
      dyad: target.dyad,
    } as const;
    const result: ScheduledToken[] = [];
    let cursor = responseStart;
    for (const spec of preArrival) {
      const direction = spec.approach?.direction === 'down' ? 'above' : 'below';
      const token = acgReturnTokenToAbstractToken(spec, brick.arrival);
      result.push({
        ...entry,
        token,
        startBeat: cursor,
        acgReturn: {
          ...base,
          role: spec.role,
          approachDirection: spec.role === 'approach' ? direction : undefined,
          approachSemitones: spec.role === 'approach' ? spec.approach?.maxSemitones : undefined,
          colorIntent: spec.role === 'approach' ? acgBorrowedColorIntentFromToken(token) : undefined,
        },
      });
      cursor += spec.durationBeats;
    }
    result.push({
      ...entry,
      token: acgReturnTokenToAbstractToken(arrivalSpec, brick.arrival),
      startBeat: arrivalBeat,
      acgReturn: { ...base, role: 'arrival' },
    });
    return result;
  }
  return null;
}

function acgBorrowedColorIntentFromToken(token: AbstractMelodyToken): AcgBorrowedColorIntent | undefined {
  return token.acg?.colorIntent;
}

/**
 * `next-chord` is not a suggestion. A D return may only be scheduled on the
 * exact D→target boundary; otherwise the grammar brick is rejected and the
 * original RoadMap token survives. This prevents a dominant goal from being
 * silently materialized on its own chord.
 */
function resolveAcgReturnTargetChord(
  brick: AcgReturnBrick,
  func: AcgReturnFunction,
  arrivalChord: ChordBlock,
  beforeArrival: ChordBlock | null,
  arrivalBeat: number,
): ChordBlock | null {
  if (brick.arrival.harmonicScope === 'current-chord') return arrivalChord;
  if (func !== 'D' || brick.function !== 'D') return null;
  if (!beforeArrival || beforeArrival.index === arrivalChord.index || beforeArrival.functionHint !== 'D') return null;
  if (Math.abs(arrivalBeat - arrivalChord.startBeat) > ACG_RETURN_PLACEMENT_EPSILON) return null;
  return arrivalChord;
}

function actualBrickAtBeat(expansions: BrickExpansion[], beat: number): BrickExpansion | null {
  return expansions.find(({ brick }) => beat >= brick.startBeat - 1e-4 && beat < brick.startBeat + brick.durationBeats - 1e-4) ?? null;
}

function chooseAcgReturnBrick(
  func: AcgReturnFunction,
  restBeats: number,
  landingDuration: number,
  ordinal: number,
  arrivalBeat: number,
  chordPart: ChordPart,
  leadPresencePlan?: AcgLeadPresencePlan,
  allowedShapes?: readonly AcgPianoReturnShape[],
): AcgReturnBrick | null {
  const grammarCandidates = orderedAcgReturnBricks(func, restBeats, ordinal, allowedShapes);
  const durationCompatible = grammarCandidates
    .filter((candidate) => candidate.tokens.at(-1)?.durationBeats <= landingDuration + 0.26);
  // `entry` is an already-reserved audible slot, and planAcgReturnGesture uses
  // its actual duration for the carrier. When a short slot only admits a lift
  // whose passing tones are unsafe, still retain an explicit stable return
  // rather than silently falling back to the old generic C token.
  const candidates = [
    ...durationCompatible,
    ...grammarCandidates.filter((candidate) => candidate.kind === 'stable-single' && !durationCompatible.includes(candidate)),
  ];
  if (candidates.length === 0) return null;
  // A pickup / approach is deliberately allowed to be a passing color. It must
  // therefore never be scheduled where the auditor hears it as a structural
  // note (strong beat / chord entry), nor may it cross into another chord. This
  // is a placement decision in the RoadMap → scheduler chain, not a late pitch
  // repair. If the authored lift cannot fit, retain the breath and select the
  // smaller authored response before falling back to a stable single landing.
  return candidates.find((candidate) => isAcgReturnBrickPlaceable(
    candidate,
    restBeats,
    arrivalBeat,
    chordPart,
    leadPresencePlan,
  )) ?? null;
}

/** Keep the catalog's phrase-size preference deterministic in both backward
 * (ordinary R) and forward (arranger-owned re-entry) scheduling paths. */
function orderedAcgReturnBricks(
  func: AcgReturnFunction,
  restBeats: number,
  ordinal: number,
  allowedShapes?: readonly AcgPianoReturnShape[],
): AcgReturnBrick[] {
  const grammarCandidates = getAcgReturnBrickCandidates({ function: func, precedingRestBeats: restBeats, maxAudibleTokens: 4 });
  // 空白越长，优先发展为更完整的 mini-riff；同等级用句内序号轮换，
  // 不额外消耗 RNG，故不会改变其它主链随机流。
  const desired: AcgReturnBrick['kind'] = restBeats >= 1.25
    ? 'lift-riff'
    : restBeats >= 1
      ? 'sigh'
      : 'stable-single';
  const fallbackPreference: readonly AcgReturnBrick['kind'][] = desired === 'lift-riff'
    ? ['lift-riff', 'sigh', 'stable-single']
    : desired === 'sigh'
      ? ['sigh', 'stable-single']
      : ['stable-single'];
  const preference: readonly AcgReturnBrick['kind'][] = allowedShapes === undefined
    ? fallbackPreference
    : allowedShapes.map((shape) => shape === 'liftRiff' ? 'lift-riff' : shape === 'stableSingle' ? 'stable-single' : 'sigh');
  return preference.flatMap((kind) => rotateAcgReturnCandidates(
    grammarCandidates.filter((candidate) => candidate.kind === kind),
    ordinal,
  ));
}

/** Stable-single is the authored, contract-preserving fallback when a chosen
 * dyad cannot find two legal stable voices in the actual HarmonicPlan. */
function chooseAcgStableReturnFallback(
  func: AcgReturnFunction,
  restBeats: number,
  landingDuration: number,
  arrivalBeat: number,
  chordPart: ChordPart,
  leadPresencePlan?: AcgLeadPresencePlan,
  allowedShapes?: readonly AcgPianoReturnShape[],
): AcgReturnBrick | null {
  if (!isAcgReturnShapeAllowed('stableSingle', allowedShapes)) return null;
  return getAcgReturnBrickCandidates({ function: func, precedingRestBeats: restBeats, maxAudibleTokens: 1 })
    .filter((candidate) => candidate.kind === 'stable-single')
    .filter((candidate) => candidate.tokens.at(-1)?.durationBeats <= landingDuration + 0.26)
    .find((candidate) => isAcgReturnBrickPlaceable(candidate, restBeats, arrivalBeat, chordPart, leadPresencePlan)) ?? null;
}

function rotateAcgReturnCandidates(candidates: readonly AcgReturnBrick[], ordinal: number): AcgReturnBrick[] {
  if (candidates.length < 2) return [...candidates];
  const offset = ((ordinal % candidates.length) + candidates.length) % candidates.length;
  return candidates.map((_, index) => candidates[(index + offset) % candidates.length]);
}

const ACG_RETURN_BREATH_GUARD_BEATS = 0.38;
// A deliberate tiny inhale keeps a section re-entry from sounding like a
// generic downbeat restart, while leaving enough of a 1.5-beat carrier for
// the compact T lift (pickup + approach + dyad arrival).
const ACG_RETURN_POST_ENTRY_INHALE_BEATS = 0.25;
// Keep a small margin beyond the auditor's 0.08-beat structural tolerance so
// tick rounding cannot turn an intended passing tone into a hard failure.
const ACG_RETURN_NON_ARRIVAL_GUARD_BEATS = 0.09;
const ACG_RETURN_PLACEMENT_EPSILON = 1e-4;

/**
 * Return pre-arrivals are atomic passing tones. Preflight their actual placed
 * timing before committing the grammar brick: each must fit inside the chord
 * that owns its onset and avoid the same structural grid the read-only auditor
 * protects. Arrival is intentionally exempt because it is chosen from
 * stable∩scale by `chooseStableArrival`.
 */
function isAcgReturnBrickPlaceable(
  brick: AcgReturnBrick,
  restBeats: number,
  arrivalBeat: number,
  chordPart: ChordPart,
  leadPresencePlan?: AcgLeadPresencePlan,
): boolean {
  const preArrival = brick.tokens.slice(0, -1);
  const required = preArrival.reduce((sum, token) => sum + token.durationBeats, 0);
  if (required > 0 && restBeats < required + ACG_RETURN_BREATH_GUARD_BEATS) return false;

  let cursor = arrivalBeat - required;
  for (const spec of preArrival) {
    const chord = getCurrentChordAtBeat(chordPart, cursor);
    if (!chord) return false;
    // Return gestures are appended after the generic boundary clip. Do not
    // reintroduce a cross-harmony note here; reject this brick at selection.
    if (cursor + spec.durationBeats > chord.endBeat + ACG_RETURN_PLACEMENT_EPSILON) return false;
    // The approach/pickup must not backfill a form-authored breath. A legal
    // stable arrival at the end of the window is still allowed and is handled
    // by the caller's existing carrier token.
    if (overlapsAcgLeadSilence(cursor, cursor + spec.durationBeats, leadPresencePlan)) return false;
    if (isAcgReturnNonArrivalStructuralBeat(cursor, chord, chordPart)) return false;
    cursor += spec.durationBeats;
  }
  return true;
}

/** Forward counterpart of `isAcgReturnBrickPlaceable`: all passing atoms are
 * placed after the arranger's silence window, and the arrival itself also
 * stays clear of any subsequent planned dropout. */
function isAcgPostEntryReturnBrickPlaceable(
  brick: AcgReturnBrick,
  responseStart: number,
  arrivalBeat: number,
  arrivalEnd: number,
  chordPart: ChordPart,
  leadPresencePlan?: AcgLeadPresencePlan,
): boolean {
  let cursor = responseStart;
  for (const spec of brick.tokens.slice(0, -1)) {
    const chord = getCurrentChordAtBeat(chordPart, cursor);
    if (!chord) return false;
    if (cursor + spec.durationBeats > chord.endBeat + ACG_RETURN_PLACEMENT_EPSILON) return false;
    if (overlapsAcgLeadSilence(cursor, cursor + spec.durationBeats, leadPresencePlan)) return false;
    if (isAcgReturnNonArrivalStructuralBeat(cursor, chord, chordPart)) return false;
    cursor += spec.durationBeats;
  }
  if (Math.abs(cursor - arrivalBeat) > ACG_RETURN_PLACEMENT_EPSILON) return false;
  return !overlapsAcgLeadSilence(arrivalBeat, arrivalEnd, leadPresencePlan);
}

function isAcgReturnNonArrivalStructuralBeat(
  beat: number,
  chord: ChordBlock,
  chordPart: ChordPart,
): boolean {
  const [numerator, denominator] = chordPart.meter;
  const beatsPerBar = numerator * (4 / denominator);
  if (Number.isFinite(beatsPerBar) && beatsPerBar > 0) {
    const phase = ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar;
    const distanceToStrong = Math.min(
      Math.abs(phase),
      Math.abs(phase - beatsPerBar / 2),
      Math.abs(phase - beatsPerBar),
    );
    if (distanceToStrong <= ACG_RETURN_NON_ARRIVAL_GUARD_BEATS + ACG_RETURN_PLACEMENT_EPSILON) return true;
  }
  return Math.abs(beat - chord.startBeat) <= ACG_RETURN_NON_ARRIVAL_GUARD_BEATS + ACG_RETURN_PLACEMENT_EPSILON;
}

function intentShapeFromBrick(brick: AcgReturnBrick): AcgReturnShape {
  return brick.kind === 'stable-single' ? 'stableSingle'
    : brick.kind === 'lift-riff' ? 'liftRiff'
      : 'sigh';
}

function chooseStableArrival(
  chord: ChordBlock,
  allowedRoles: readonly AcgReturnStableRole[],
  dyadIntent: AcgDyadIntent | undefined,
  colorIntent: AcgBorrowedColorIntent | undefined,
  ordinal: number,
): AcgReturnArrivalTarget | null {
  const candidates = acgStableToneCandidates(chord, allowedRoles);
  if (candidates.length === 0) return null;
  // Do not prepend Cadence roots here. S returns explicitly exclude root and
  // must stay that way even when their RoadMap brick happens to be Cadence.
  const ranked = allowedRoles.flatMap((role) => candidates.filter((candidate) => candidate.role === role));
  const colorTargetRole = colorIntent === 'dorian6' ? 'fifth'
    : colorIntent === 'harmonic7' || colorIntent === 'phrygianb2' ? 'root'
      : undefined;
  const colorCompatible = colorTargetRole
    ? ranked.filter((candidate) => candidate.role === colorTargetRole)
    : [];
  // A color grammar token may prefer its natural resolution target, but cannot
  // manufacture a role that the actual stableToneMap does not admit.
  const pool = colorCompatible.length > 0 ? colorCompatible : ranked.length > 0 ? ranked : candidates;
  const offset = ((ordinal % pool.length) + pool.length) % pool.length;
  for (let index = 0; index < pool.length; index++) {
    const target = pool[(index + offset) % pool.length];
    const dyad = dyadIntent ? chooseAcgDyadPartner(chord, target, allowedRoles, dyadIntent) : undefined;
    // A grammar-declared dyad is an actual token contract, not a later optional
    // ornament. If no stable partner exists, try another allowed arrival role.
    if (!dyadIntent || dyad) return { ...target, dyad };
  }
  return null;
}

function chooseAcgDyadPartner(
  chord: ChordBlock,
  target: AcgStableToneCandidate,
  arrivalRoles: readonly AcgReturnStableRole[],
  intent: AcgDyadIntent,
): ResolvedAcgDyad | undefined {
  const arrivalAllowed = new Set(arrivalRoles);
  const partnerRoles = intent.partnerRoles.filter((role) => arrivalAllowed.has(role));
  const preferred = [...intent.preferredIntervals];
  const candidates = acgStableToneCandidates(chord, partnerRoles)
    .filter((candidate) => candidate.pc !== target.pc)
    .sort((a, b) => {
      const aInterval = ((target.pc - a.pc) % 12 + 12) % 12;
      const bInterval = ((target.pc - b.pc) % 12 + 12) % 12;
      const aRank = preferred.indexOf(aInterval as typeof preferred[number]);
      const bRank = preferred.indexOf(bInterval as typeof preferred[number]);
      const aScore = aRank < 0 ? preferred.length + 1 : aRank;
      const bScore = bRank < 0 ? preferred.length + 1 : bRank;
      return aScore - bScore || aInterval - bInterval || a.pc - b.pc;
    });
  const partner = candidates[0];
  return partner
    ? { ...intent, partnerPc: partner.pc, partnerRole: partner.role }
    : undefined;
}

function inferAcgCycleSpans(chordPart: ChordPart): Array<{ startBeat: number; endBeat: number }> {
  const total = chordPart.totalBeats;
  if (total <= 0) return [];
  const half = total / 2;
  const cycleBeats = total >= 32 && hasRepeatedHalves(chordPart, half)
    ? half
    : total >= 32
      ? 32
      : Math.max(16, total);
  const cycles: Array<{ startBeat: number; endBeat: number }> = [];
  for (let start = 0; start < total - 0.001; start += cycleBeats) {
    cycles.push({ startBeat: start, endBeat: Math.min(total, start + cycleBeats) });
  }
  return cycles;
}

function hasRepeatedHalves(chordPart: ChordPart, halfBeat: number): boolean {
  if (!Number.isFinite(halfBeat) || halfBeat < 16) return false;
  const blocks = chordPart.blocks;
  const left = blocks.filter((block) => block.startBeat < halfBeat - 0.001);
  const right = blocks.filter((block) => block.startBeat >= halfBeat - 0.001);
  if (left.length === 0 || left.length !== right.length) return false;
  return left.every((a, index) => {
    const b = right[index];
    return Boolean(b)
      && Math.abs((a.startBeat + halfBeat) - b.startBeat) < 0.001
      && Math.abs(a.durationBeats - b.durationBeats) < 0.001
      && a.rootPc === b.rootPc
      && a.bassPc === b.bassPc
      && a.type === b.type;
  });
}

function pickAcgCadenceExpansion(expansions: BrickExpansion[], startBeat: number, endBeat: number): BrickExpansion | null {
  const candidates = expansions
    .filter((expansion) => expansion.tokens.length > 0)
    .filter((expansion) => {
      const brickStart = expansion.brick.startBeat;
      return brickStart >= startBeat - 0.001 && brickStart < endBeat - 0.001;
    })
    .map((expansion) => ({ expansion, score: scoreAcgCadenceSource(expansion.brick, expansion.tokens) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.expansion ?? null;
}

function scoreAcgCadenceSource(brick: BrickMatch, tokens: AbstractMelodyToken[]): number {
  const audible = tokens.filter(isPlayableToken);
  if (audible.length < 3) return 0;
  const longToneCount = audible.filter((token) => token.duration >= 1 || token.kind === 'G').length;
  const rests = tokens.filter((token) => token.kind === 'R').reduce((sum, token) => sum + token.duration, 0);
  const authored = tokenDurationTotal(tokens);
  const restRatio = authored > 0 ? rests / authored : 0;
  const densityPenalty = Math.max(0, audible.length - 10) * 1.2;
  let score = 1;
  if (brick.family === 'Cadence') score += 14;
  if (/Cadence/i.test(brick.name)) score += 6;
  if (longToneCount > 0) score += 3 + longToneCount;
  if (restRatio >= 0.18) score += 2;
  if (audible.length >= 4 && audible.length <= 9) score += 2;
  return score - densityPenalty;
}

// ★ Phase B-2(directive 3.3):ACG stretched cycle 的 brick 元数据 —— source brick identity(name/family/index)
//   来自选中的 cadence expansion;brickStartBeat/EndBeat 反映【stretched cycle】(非 brick 原始 span)。
function spreadTokensAcrossAcgCycle(
  tokens: AbstractMelodyToken[],
  cycleStart: number,
  cycleEnd: number,
  brick: { brickIndex?: number; name?: string; family?: string } = {},
  metricGrid?: AcgPianoMetricGrid,
): ScheduledToken[] {
  const sourceTotal = tokenDurationTotal(tokens);
  const cycleDuration = Math.max(0, cycleEnd - cycleStart);
  if (sourceTotal <= 0 || cycleDuration <= 0) return [];
  // A score-owned grid uses the complete cycle.  The legacy `- 0.5` tail
  // reserve made every source cursor a different irrational phase
  // (4.923..., 5.906..., 6.892...) and therefore let the top line drift away
  // from the two lower hands.  Keep that exact fallback only for compact
  // callers that do not yet carry an ACG PianoScorePlan.
  const mappingDuration = metricGrid ? cycleDuration : Math.max(1, cycleDuration - 0.5);
  const stretch = mappingDuration / sourceTotal;
  const durationScale = Math.max(1, Math.min(1.65, Math.pow(stretch, 0.32)));
  const out: ScheduledToken[] = [];
  const metricStarts = metricGrid
    ? mapAcgSourceCursorsToMetricGrid(tokens, cycleStart, cycleEnd, sourceTotal, metricGrid)
    : undefined;
  let cursor = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const mappedStart = cycleStart + (cursor / sourceTotal) * mappingDuration;
    const sourceStructural = isStructuralAcgToken(token, tokens, i);
    const startBeat = metricStarts?.[i] ?? (sourceStructural
      ? snapToAcgLandingBeat(mappedStart, cycleStart, cycleEnd)
      : mappedStart);

    if (token.duration === 0) {
      out.push({ token, startBeat });
      continue;
    }

    const shaped = withAcgStableTokenContract(
      shapeAcgCycleTokenDuration(token, durationScale),
      sourceStructural,
    );
    if (startBeat < cycleEnd - 0.01) out.push({ token: shaped, startBeat });
    cursor += token.duration;
  }
  // ★ Phase B-2:盖 full brick 元数据(含 closeOpenSlopeGroups 补的合成 SlopeExit);start/end = stretched cycle。
  return closeOpenSlopeGroups(out).map((st) => ({
    ...st,
    brickIndex: brick.brickIndex,
    brickStartBeat: cycleStart,
    brickEndBeat: cycleEnd,
    brickName: brick.name,
    brickFamily: brick.family,
  }));
}

interface AcgSourceCursorGroup {
  cursor: number;
  tokenIndices: number[];
  structural: boolean;
}

/**
 * Map grammar cursors into the Arranger's absolute piano clock before NoteIR
 * exists.  A cursor group deliberately includes zero-duration slope markers:
 * when its playable token moves to a grid point, the state mutation moves
 * with it, so quantization cannot invert marker/rest/note semantics.
 */
function mapAcgSourceCursorsToMetricGrid(
  tokens: readonly AbstractMelodyToken[],
  cycleStart: number,
  cycleEnd: number,
  sourceTotal: number,
  grid: AcgPianoMetricGrid,
): number[] {
  const subdivision = Number.isFinite(grid.subdivisionBeats) && grid.subdivisionBeats > 1e-6
    ? grid.subdivisionBeats
    : 0.25;
  const cycleDuration = cycleEnd - cycleStart;
  const maxStart = lastAcgMetricSlotBefore(cycleEnd, subdivision);
  const groups: AcgSourceCursorGroup[] = [];
  let cursor = 0;

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    const previous = groups.at(-1);
    if (previous && Math.abs(previous.cursor - cursor) <= 1e-9) {
      previous.tokenIndices.push(index);
      previous.structural ||= isStructuralAcgToken(token, tokens, index);
    } else {
      groups.push({
        cursor,
        tokenIndices: [index],
        structural: isStructuralAcgToken(token, tokens, index),
      });
    }
    cursor += Math.max(0, token.duration);
  }

  const starts = new Array<number>(tokens.length);
  let previousGroupStart = cycleStart - subdivision;
  for (const group of groups) {
    const nominal = cycleStart + (group.cursor / sourceTotal) * cycleDuration;
    const minimumStart = Math.min(maxStart, previousGroupStart + subdivision);
    const gridStart = clampAcgMetricStart(
      snapToAcgSubdivision(nominal, subdivision),
      minimumStart,
      maxStart,
      subdivision,
    );
    const structuralAnchor = group.structural
      ? nearestAvailableAcgStructuralAnchor(grid, nominal, cycleStart, cycleEnd, minimumStart)
      : undefined;
    const startBeat = structuralAnchor
      ? structuralAnchor.beat
      : gridStart;
    for (const index of group.tokenIndices) starts[index] = startBeat;
    previousGroupStart = startBeat;
  }
  return starts;
}

function lastAcgMetricSlotBefore(cycleEnd: number, subdivision: number): number {
  return Math.floor((cycleEnd - 1e-6) / subdivision) * subdivision;
}

function snapToAcgSubdivision(beat: number, subdivision: number): number {
  return Math.round(beat / subdivision) * subdivision;
}

function clampAcgMetricStart(
  beat: number,
  minimum: number,
  maximum: number,
  subdivision: number,
): number {
  if (minimum > maximum) return maximum;
  const firstSlot = Math.ceil((minimum - 1e-6) / subdivision) * subdivision;
  const lastSlot = Math.floor((maximum + 1e-6) / subdivision) * subdivision;
  if (firstSlot > lastSlot + 1e-6) return maximum;
  const snapped = snapToAcgSubdivision(beat, subdivision);
  return Math.max(firstSlot, Math.min(lastSlot, snapped));
}

function nearestAvailableAcgStructuralAnchor(
  grid: AcgPianoMetricGrid,
  nominal: number,
  cycleStart: number,
  cycleEnd: number,
  minimumStart: number,
): AcgPianoMetricAnchor | undefined {
  const captureRadius = Math.max(
    grid.subdivisionBeats,
    Number.isFinite(grid.beatsPerBar) && grid.beatsPerBar > 0
      ? grid.beatsPerBar / 2
      : 2,
  );
  return grid.anchors
    .filter((anchor) => isAcgStructuralMetricAnchor(anchor))
    .filter((anchor) =>
      anchor.beat >= cycleStart - 1e-6
      && anchor.beat < cycleEnd - 1e-6
      && anchor.beat >= minimumStart - 1e-6
      && Math.abs(anchor.beat - nominal) <= captureRadius + 1e-6)
    .sort((left, right) =>
      Math.abs(left.beat - nominal) - Math.abs(right.beat - nominal)
      || acgStructuralAnchorPriority(right) - acgStructuralAnchorPriority(left)
      || right.strength - left.strength
      || left.beat - right.beat
      || left.id.localeCompare(right.id))[0];
}

function isAcgStructuralMetricAnchor(anchor: AcgPianoMetricAnchor): boolean {
  return anchor.kind === 'phrase-arrival'
    || anchor.kind === 'harmonic-arrival'
    || anchor.kind === 'bar-downbeat'
    || anchor.kind === 'secondary-strong-beat';
}

function acgStructuralAnchorPriority(anchor: AcgPianoMetricAnchor): number {
  if (anchor.kind === 'phrase-arrival') return 5;
  if (anchor.kind === 'harmonic-arrival') return 4;
  if (anchor.kind === 'bar-downbeat') return 3;
  if (anchor.kind === 'secondary-strong-beat') return 2;
  return 1;
}

function tokenDurationTotal(tokens: AbstractMelodyToken[]): number {
  return tokens.reduce((sum, token) => sum + Math.max(0, token.duration), 0);
}

function isPlayableToken(token: AbstractMelodyToken): boolean {
  return token.kind !== 'R' && token.kind !== 'SlopeEnter' && token.kind !== 'SlopeExit';
}

function isStructuralAcgToken(token: AbstractMelodyToken, tokens: readonly AbstractMelodyToken[], index: number): boolean {
  if (!isPlayableToken(token)) return false;
  if (token.kind === 'G') return true;
  if (token.duration >= 1) return true;
  return tokens.slice(index + 1).every((next) => !isPlayableToken(next));
}

function shapeAcgCycleTokenDuration(token: AbstractMelodyToken, durationScale: number): AbstractMelodyToken {
  if (token.duration === 0) return token;
  if (token.kind === 'R') {
    return { ...token, duration: Math.max(0.5, Math.min(4, token.duration * durationScale)) } as AbstractMelodyToken;
  }
  const maxDuration = token.kind === 'G'
    ? 2.75
    : token.duration >= 1
      ? 1.75
      : 0.85;
  const duration = Math.max(0.25, Math.min(maxDuration, token.duration * durationScale));
  return { ...token, duration } as AbstractMelodyToken;
}

/** Source-terminal structural identity survives cycle stretching as an
 * explicit token contract, even when its final shortened duration is below
 * the long-tone threshold used by the later scheduler pass. */
function withAcgStableTokenContract(token: AbstractMelodyToken, structural: boolean): AbstractMelodyToken {
  if (!structural || token.acg || !isAcgPlayableToken(token)
    || token.kind === 'A' || token.kind === 'Triadic') return token;
  return {
    ...token,
    acg: {
      harmonicScope: 'current-chord',
      stableRoles: stableRolesForAcgStructuralToken(token),
    },
  } as AbstractMelodyToken;
}

function snapToAcgLandingBeat(time: number, cycleStart: number, cycleEnd: number): number {
  const candidates: number[] = [];
  for (let t = cycleStart; t < cycleEnd - 0.001; t += 4) candidates.push(t);
  const midpoint = cycleStart + (cycleEnd - cycleStart) / 2;
  candidates.push(midpoint, Math.max(cycleStart, cycleEnd - 4));
  let best = time;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - time);
    if (distance < bestDistance) { best = candidate; bestDistance = distance; }
  }
  return bestDistance <= 0.85 ? best : time;
}

function closeOpenSlopeGroups(entries: ScheduledToken[]): ScheduledToken[] {
  let depth = 0;
  for (const entry of entries) {
    if (entry.token.kind === 'SlopeEnter') depth++;
    else if (entry.token.kind === 'SlopeExit') depth = Math.max(0, depth - 1);
  }
  if (depth === 0) return entries;
  const last = entries[entries.length - 1];
  const lastBeat = last?.startBeat ?? 0;
  return [
    ...entries,
    ...Array.from({ length: depth }, () => ({ token: { kind: 'SlopeExit', duration: 0 } as AbstractMelodyToken, startBeat: lastBeat })),
  ];
}

function fallbackAcgCycleCadenceTokens(): AbstractMelodyToken[] {
  return [
    { kind: 'R', duration: 0.5 }, { kind: 'C', duration: 0.5 }, { kind: 'L', duration: 0.5 },
    { kind: 'C', duration: 0.5 }, { kind: 'R', duration: 0.5 }, { kind: 'L', duration: 0.5 },
    { kind: 'C', duration: 1 }, { kind: 'G', duration: 2 }, { kind: 'R', duration: 1 },
    { kind: 'C', duration: 0.5 }, { kind: 'R', duration: 0.5 },
  ];
}
