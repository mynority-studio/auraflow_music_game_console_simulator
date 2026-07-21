// ============================================================
// newEngine · render · MgMelodyRealizer(MG strict 移植 Loop 4)
// ------------------------------------------------------------
// Provenance: ../melodygenerative/src/lib/improvisor/LickGen.ts 的 realizeTokens 区段忠实港
//   (LickGenArgs + pushOrMergeRepeat + realizeTokens + chooseNoteWithGuideTone +
//    shouldBindToGuideTone + isStrongBeat + clipToSongEnd)。
//   scheduleTokens/scheduleBrickExpansions 已在 Loop 3 的 mgTokenScheduler。
// 改动:
//   ① import 改 ./mgChordPart · ./mgPitchClassSets · ./mgNoteChooser · ../knowledge/melodyGrammarTypes;
//   ② MG NoteEvent → 本地 MgNoteEvent(realizeTokens 实际写入字段),body 用 type alias 不改;
//   ③ guide-tone(GuideTonePlanner)Loop 4 = null-safe stub —— guideToneAtBeat(null)=null 与 MG 一致,
//      Loop 4 始终传 guideTonePlan=undefined,故 raw melody 严格 parity;Loop 5 接真 mgGuideTonePlanner。
// render 层:per-token 落音高 → raw melody(无 guide-tone / 无 style feel;那是 Loop 5)。确定性(rng 续用)。
// ============================================================

import type { ChordPart } from './mgChordPart';
import { getCurrentChordAtBeat, getNextChordAtBeat } from './mgChordPart';
import type {
  AbstractMelodyToken,
  AcgStableArrivalTokenIntent,
  TokenKind,
} from '../knowledge/melodyGrammarTypes';
import type { AcgReturnGestureIntent, ScheduledToken } from './mgTokenScheduler';
import { acgStableToneCandidates, buildPitchSets } from './mgPitchClassSets';
import type { LocalScaleContext } from '../knowledge/mgLocalScaleResolver';
import { chooseNote, type ChoiceResult, type NoteChooserContext } from './mgNoteChooser';
import { guideToneAtBeat, materializeGuideTone, type GuideTonePlan } from './mgGuideTonePlanner';

/** MG NoteEvent 的窄等价物(realizeTokens 实际写入字段)。完整 MG NoteEvent 另含
 *  chordSymbol/pitchOffset/pitchEnvelope/instrument —— realizeTokens 不写,故省。 */
export interface MgNoteEvent {
  noteNumber: number;
  time: number;
  duration: number;
  velocity: number;
  part: 'melody' | 'chord' | 'bass';
  origin?: 'motif' | 'develop' | 'return';
  lickSource?: boolean;
  degree?: string;
  // ★ MG full-parity G9·C:brick 边界元数据(穿透 ScheduledToken→scheduleBrickExpansions)。
  //   shapeMelodyHarmony 的 applyTargetChordSuspensionBoundary/eventBrickSpansBoundary 读它;
  //   缺省 undefined → eventBrickSpansBoundary 恒 false(MG 无 brick meta 时的优雅 no-op)。
  brickIndex?: number;
  brickStartBeat?: number;
  brickEndBeat?: number;
  // ★ MG full-parity Phase B-2(2026-06-28):full metadata 标准形状。grammar token kind + slope role +
  //   brick name/family —— post-shaper 生产链(enforceMonophonic/boundaryVL/tailHolds/finalizeVL,Phase C)
  //   据 grammarSlopeRole(inside/last)/grammarTokenKind 做边界/解决决策。additive:不改 pitch/time/dur/vel。
  grammarTokenKind?: TokenKind;
  grammarSlopeRole?: 'inside' | 'last';
  brickName?: string;
  brickFamily?: string;
  /** ACG PIANOSONG 主链 return brick 的可追溯身份；只在 realizer 内用于验收，
   * 最终 TrackIR 不需要携带这份创作期 metadata。 */
  acgReturnGestureId?: string;
  acgReturnRole?: AcgReturnGestureIntent['role'];
  /** 同一 arrival grammar token 直接实化出的下方 dyad 声部。 */
  acgReturnVoice?: 'topline' | 'dyad';
}
// body(LickGen 忠实区段)用 NoteEvent;在本模块即 MgNoteEvent。
type NoteEvent = MgNoteEvent;

// ── Guide-tone(Loop 5 已接真 mgGuideTonePlanner)────────────────────────
// guideToneAtBeat/materializeGuideTone/GuideTonePlan 由 ./mgGuideTonePlanner import(见顶部)。
// guideTonePlan=undefined(Loop 4 raw)时 guideToneAtBeat 仍返 null → raw melody 不变;
// 传真 plan(Loop 5)时结构音绑 guide-tone 骨架。两路径均与 MG 一致。

// ============================================================
// 以下为 LickGen.ts:23-278 忠实区段(import/NoteEvent/guide-tone 由上方接管)
// ============================================================

export interface LickGenArgs {
  /** Tokens already laid out with their start beats. */
  scheduledTokens: ScheduledToken[];
  /** Chord context. */
  chordPart: ChordPart;
  /** Initial prev-emit MIDI (null at song start). */
  initialPrevMidi?: number | null;
  /** Default register center (e.g., G4 = 67). */
  registerCenter?: number;
  /** Optional seeded PRNG. When provided, NoteChooser sample-picks by
   *  softmax (IV-style variety). Omit for deterministic argmax. */
  rng?: () => number;
  /** Optional guide-tone backbone. Structural playable tokens bind to
   *  this line before falling back to free IV note choice. */
  guideTonePlan?: GuideTonePlan | null;
  /** When true, active slope groups own their ordinary token pitches.
   *  Guide tones still bind explicit G tokens, but C/L/S/X inside the
   *  slope keep the grammar-authored contour. */
  preserveSlopeGrammar?: boolean;
  /** ★ MG full-parity G2:本地音阶语境(style/key/mode)。给定 → 每个 buildPitchSets 走
   *  orthogonal admission(候选池 = contract ∩ local scale);缺省 → 旧 vocab 路径(parity 测试不变)。 */
  localScaleContext?: LocalScaleContext;
  /**
   * Score compilers may already own one attack per grammar token.  In that
   * case adjacent equal pitches must remain separate events so the rhythmic
   * SlotBinder cardinality survives pitch realization.  Default false keeps
   * the ordinary MG/Impro-Visor repeat-merging path byte-identical.
   */
  preserveTokenBoundaries?: boolean;
}

/** IV LickGen.java:1833-1861 avoidRepeats. When the new event has the
 *  same pitch as the immediately-preceding melody event AND lands at
 *  exactly that event's end time, IV extends the previous note's
 *  duration instead of pushing a fresh event. Cleans up grammar
 *  output's natural tendency to emit repeated pitches as separate
 *  staccato hits and instead glides them into a single sustained note.
 *  Default-on per IV (the only invocation in the LickGen pipeline
 *  passes avoidRepeats=true). */
// ★ MG full-parity Phase 3·D + B-2:从 ScheduledToken 取 full brick 元数据盖到 NoteEvent
//   (shaper 边界 guard + post-shaper 链 boundary VL 读它)。
function brickEventMeta(entry: ScheduledToken): Pick<MgNoteEvent, 'brickIndex' | 'brickStartBeat' | 'brickEndBeat' | 'brickName' | 'brickFamily'> {
  return {
    brickIndex: entry.brickIndex,
    brickStartBeat: entry.brickStartBeat,
    brickEndBeat: entry.brickEndBeat,
    brickName: entry.brickName,
    brickFamily: entry.brickFamily,
  };
}

function pushOrMergeRepeat(
  events: NoteEvent[],
  ev: NoteEvent,
  preserveTokenBoundaries = false,
): void {
  if (preserveTokenBoundaries) {
    events.push(ev);
    return;
  }
  if (events.length > 0 && ev.part === 'melody') {
    const last = events[events.length - 1];
    // ★ MG full-parity:仅同 brick(或任一无 brick meta)才合并重复音 —— 不跨 brick 边界粘连。
    const sameBrick = last.brickIndex === ev.brickIndex
      || last.brickIndex === undefined
      || ev.brickIndex === undefined;
    // ACG return brick 的 pickup / approach / arrival 是原子语义，即使恰好同音也不能
    // 被通用 legato 合并吞掉；否则「趋近 → 到达」的可验证关系会在 realizer 内消失。
    const sameReturnAtom = last.acgReturnGestureId === ev.acgReturnGestureId
      ? last.acgReturnRole === ev.acgReturnRole
      : last.acgReturnGestureId === undefined && ev.acgReturnGestureId === undefined;
    if (last.part === 'melody'
        && last.noteNumber === ev.noteNumber
        && Math.abs(last.time + last.duration - ev.time) < 1e-4
        && sameBrick
        && sameReturnAtom) {
      last.duration += ev.duration;
      // ★ Phase B-2(MG LickGen 77-78):合并时传递 grammar 元数据(last 取最强 slope role + 首个 token kind)。
      if (ev.grammarSlopeRole === 'last') last.grammarSlopeRole = 'last';
      if (!last.grammarTokenKind) last.grammarTokenKind = ev.grammarTokenKind;
      return;
    }
  }
  events.push(ev);
}

export function realizeTokens(args: LickGenArgs): NoteEvent[] {
  const {
    scheduledTokens,
    chordPart,
    initialPrevMidi,
    registerCenter,
    rng,
    guideTonePlan,
    preserveSlopeGrammar,
    localScaleContext,
    preserveTokenBoundaries = false,
  } = args;
  const acgMainChain = localScaleContext?.style.toUpperCase() === 'ACG';
  const events: NoteEvent[] = [];
  let prevMidi: number | null = initialPrevMidi ?? null;
  let triadicState: NoteChooserContext['triadicState'] = undefined;
  // Active slope state per IV LickGen.java:1991+ semantics. Set by
  // SlopeEnter marker, cleared by SlopeExit. While active, each note's
  // candidate MIDIs are constrained to [prev + dirMin, prev + dirMax].
  let activeSlope: { dirMin: number; dirMax: number } | null = null;

  // ★ Phase B-2(MG LickGen 106-115):slope role —— slope 内:若 SlopeExit 前还有可发声 token → 'inside',
  //   否则(下一个就是 SlopeExit / 已无音)→ 'last'。非 slope 内 → undefined。post-shaper 链据此保护 inside 音、
  //   只在 last 处做边界改写。
  const slopeRoleAt = (index: number): 'inside' | 'last' | undefined => {
    if (!activeSlope) return undefined;
    for (let j = index + 1; j < scheduledTokens.length; j++) {
      const next = scheduledTokens[j].token;
      if (next.kind === 'SlopeExit') return 'last';
      if (next.kind === 'SlopeEnter') return 'inside';
      if (next.kind !== 'R' && next.duration > 0) return 'inside';
    }
    return 'last';
  };

  for (let i = 0; i < scheduledTokens.length; i++) {
    const entry = scheduledTokens[i];
    const { token, startBeat } = entry;

    // Slope markers toggle state, emit no audio.
    if (token.kind === 'SlopeEnter') {
      activeSlope = { dirMin: token.dirMin, dirMax: token.dirMax };
      continue;
    }
    if (token.kind === 'SlopeExit') {
      activeSlope = null;
      continue;
    }

    const chord = getCurrentChordAtBeat(chordPart, startBeat);
    if (!chord) continue;  // beyond song end; drop
    const nextChord = getNextChordAtBeat(chordPart, startBeat);

    const sets = buildPitchSets({ chord, nextChord, localScaleContext });

    // ── ACG PIANOSONG:主链下发的“呼吸 → 回归”原子手势 ────────────────
    // scheduler 已用实际 RoadMap brick + HarmonicPlan stable tones 选定 targetPc。
    // 这里严格执行而非重新抽样；任何失败只退化为已有 arrival，不会在成品 TrackIR
    // 再插一颗 filler。approach 和 arrival 作为同一个原子对提交，保证必然解决。
    const returnIntent = entry.acgReturn;
    if (returnIntent?.role === 'approach') {
      const targetIdx = i + 1;
      const targetEntry = scheduledTokens[targetIdx];
      const targetIntent = targetEntry?.acgReturn;
      // Borrowed/modal color is an exact two-way token contract. A sidecar
      // may report only the color actually carried by its A terminal; it may
      // not inject color into an unannotated approach, nor silently ignore a
      // token-side color once scheduling has changed.
      if (!acgReturnApproachContractIsValid(returnIntent, entry)) {
        // A color approach and its arrival are one atomic grammar gesture.
        // If the color contract is malformed, do not let the following loop
        // iteration emit a detached stable landing from that rejected pair.
        if (targetIntent?.gestureId === returnIntent.gestureId && targetIntent.role === 'arrival') i = targetIdx;
        continue;
      }
      if (targetIntent?.gestureId === returnIntent.gestureId
          && targetIntent.role === 'arrival'
          && acgReturnArrivalContractIsValid(targetIntent, targetEntry, chordPart)) {
        const targetMidi = materializeAcgArrivalMidi(targetIntent, prevMidi, registerCenter);
        const approachMidi = materializeAcgApproachMidi(returnIntent, targetMidi, chord, sets);
        pushAcgReturnEvent(events, entry, approachMidi, startBeat, token.duration, 'approach');
        prevMidi = approachMidi;
        pushAcgReturnArrivalEvents(events, targetEntry, targetMidi, targetEntry.startBeat, targetEntry.token.duration, targetIntent);
        prevMidi = targetMidi;
        triadicState = undefined;
        i = targetIdx;
        continue;
      }
      // Atomic partner unexpectedly absent: do not emit a hanging approach.
      if (targetIntent?.gestureId === returnIntent.gestureId && targetIntent.role === 'arrival') i = targetIdx;
      continue;
    }
    if (returnIntent?.role === 'pickup') {
      const pickupMidi = materializeAcgPickupMidi(returnIntent, prevMidi, registerCenter, chord, sets);
      pushAcgReturnEvent(events, entry, pickupMidi, startBeat, token.duration, 'pickup');
      prevMidi = pickupMidi;
      triadicState = undefined;
      continue;
    }
    if (returnIntent?.role === 'arrival') {
      if (!acgReturnArrivalContractIsValid(returnIntent, entry, chordPart)) continue;
      const arrivalMidi = materializeAcgArrivalMidi(returnIntent, prevMidi, registerCenter);
      pushAcgReturnArrivalEvents(events, entry, arrivalMidi, startBeat, token.duration, returnIntent);
      prevMidi = arrivalMidi;
      triadicState = undefined;
      continue;
    }

    // APPROACH + target as a locked pair per IV LickGen.java:2052+.
    // IV's APPROACH consumes the IMMEDIATELY-NEXT rhythm-string entry
    // as its target; it does NOT scan forward across rests, markers, or
    // other A tokens to find a future target. Matching that semantics:
    // accept the next token ONLY if it's a playable kind in stream
    // order. SlopeEnter/SlopeExit between A and target means target
    // belongs to a different slope group (slope-state mismatch), so
    // fall through to generic emission instead of locking pairs across
    // slope boundaries with the wrong activeSlope constraint.
    if (token.kind === 'A' && i + 1 < scheduledTokens.length) {
      const nextKind = scheduledTokens[i + 1].token.kind;
      const playable = nextKind !== 'A' && nextKind !== 'R'
                    && nextKind !== 'SlopeEnter' && nextKind !== 'SlopeExit';
      if (playable) {
        const targetIdx = i + 1;
        const targetEntry = scheduledTokens[targetIdx];
        const targetChord = getCurrentChordAtBeat(chordPart, targetEntry.startBeat);
        if (targetChord) {
          const targetNext = getNextChordAtBeat(chordPart, targetEntry.startBeat);
          const targetSets = buildPitchSets({ chord: targetChord, nextChord: targetNext, localScaleContext });
          let targetChoice = chooseNoteWithGuideTone({
            token: targetEntry.token,
            chord: targetChord,
            startBeat: targetEntry.startBeat,
            chordPart,
            guideTonePlan,
            preserveSlopeGrammar,
            acgMainChain,
            forceAcgStableAnchor: acgMainChain,
            ctx: {
              sets: targetSets, prevMidi, registerCenter, triadicState,
              slopeConstraint: activeSlope ?? undefined,
              rng,
            },
          });
          if (acgMainChain && targetChoice.midi !== null) {
            targetChoice = { ...targetChoice, midi: fitAcgSopranoRegister(targetChoice.midi) };
          }
          if (targetChoice.midi !== null) {
            // Emit A using the target as anchor.
            let approachChoice = chooseNote(token, {
              sets, prevMidi, registerCenter, triadicState,
              approachTargetMidi: targetChoice.midi,
              slopeConstraint: activeSlope ?? undefined,
              rng,
            });
            if (acgMainChain && approachChoice.midi !== null) {
              approachChoice = { ...approachChoice, midi: fitAcgSopranoRegister(approachChoice.midi) };
            }
            if (approachChoice.midi !== null) {
              pushOrMergeRepeat(events, {
                noteNumber: approachChoice.midi,
                time: startBeat,
                duration: clipToSongEnd(token.duration, startBeat, chordPart.totalBeats),
                velocity: 100,
                part: 'melody',
                origin: 'develop',
                // P2-3: mark provenance so audit scripts can identify
                // improvisor-pipeline emissions vs other paths.
                lickSource: true,
                grammarTokenKind: token.kind,
                grammarSlopeRole: slopeRoleAt(i),
                ...brickEventMeta(entry),
              }, preserveTokenBoundaries);
              prevMidi = approachChoice.midi;
            }
            // Emit the locked target using committed midi, not a fresh chooseNote.
            const targetTok = targetEntry.token;
            pushOrMergeRepeat(events, {
              noteNumber: targetChoice.midi,
              time: targetEntry.startBeat,
              duration: clipToSongEnd(targetTok.duration, targetEntry.startBeat, chordPart.totalBeats),
              velocity: 100,
              part: 'melody',
              origin: 'develop',
              lickSource: true,
              // X-token degree carries lick author's intent (e.g. 'b3').
              degree: targetTok.kind === 'X' && targetTok.degree !== undefined
                ? String(targetTok.degree) : undefined,
              grammarTokenKind: targetTok.kind,
              grammarSlopeRole: slopeRoleAt(targetIdx),
              ...brickEventMeta(targetEntry),
            }, preserveTokenBoundaries);
            prevMidi = targetChoice.midi;
            triadicState = targetChoice.triadicState;
            // Skip iteration past the locked target
            i = targetIdx;
            continue;
          }
        }
      }
      // Fallthrough: no target found, emit A as a generic scale-step
      // (no lookahead) so the token isn't lost.
    }

    let choice = chooseNoteWithGuideTone({
      token,
      chord,
      startBeat,
      chordPart,
      guideTonePlan,
      preserveSlopeGrammar,
      acgMainChain,
      ctx: {
        sets,
        prevMidi,
        registerCenter,
        triadicState,
        slopeConstraint: activeSlope ?? undefined,
        rng,
      },
    });
    if (acgMainChain && choice.midi !== null) {
      choice = { ...choice, midi: fitAcgSopranoRegister(choice.midi) };
    }
    triadicState = choice.triadicState;

    if (choice.midi !== null) {
      // No chord-boundary clipping. IV LickGen does NOT shorten notes at
      // chord changes. Held notes ring through, and the listener perceives
      // the new harmonic frame coloring the held pitch (a load-bearing
      // jazz idiom: held b7 over a chord change becomes the new chord's
      // M3 etc.). Only clip at the SONG end so playback doesn't extend
      // past the form's last beat.
      pushOrMergeRepeat(events, {
        noteNumber: choice.midi,
        time: startBeat,
        duration: clipToSongEnd(token.duration, startBeat, chordPart.totalBeats),
        velocity: 100,
        part: 'melody',
        origin: 'develop',
        // P2-3: provenance + degree label (when emitted from X-token).
        lickSource: true,
        degree: token.kind === 'X' && token.degree !== undefined
          ? String(token.degree) : undefined,
        grammarTokenKind: token.kind,
        grammarSlopeRole: slopeRoleAt(i),
        ...brickEventMeta(entry),
      }, preserveTokenBoundaries);
      prevMidi = choice.midi;
    }
  }
  return events;
}

const ACG_RETURN_MIN_MIDI = 69;
const ACG_RETURN_MAX_MIDI = 86;
const ACG_RETURN_DYAD_MIN_MIDI = 57;

function normalizePc(pc: number): number { return ((pc % 12) + 12) % 12; }

/** `never` fields in the compile-time grammar union intentionally prevent
 * mixed intents. Runtime input can still be legacy/untyped, so validate it
 * through this neutral view rather than narrowing the union by an optional
 * `never` property. */
type RuntimeAcgTokenIntent = {
  harmonicScope?: unknown;
  stableRoles?: unknown;
  colorIntent?: unknown;
  dyad?: unknown;
};

/**
 * A return approach has two representations while it is scheduled: the
 * executable sidecar and the grammar terminal. Borrowed color is valid only
 * when they describe exactly the same A token. In particular, a sidecar
 * cannot add a color to an unannotated token, and an uncolored approach may
 * not carry an arrival contract by mistake.
 */
function acgReturnApproachContractIsValid(
  intent: AcgReturnGestureIntent,
  entry: ScheduledToken,
): boolean {
  if (entry.token.kind !== 'A') return false;
  const grammarIntent = entry.token.acg;
  const raw = grammarIntent as RuntimeAcgTokenIntent | undefined;
  const tokenColor = raw?.colorIntent;
  if (tokenColor !== undefined
    && tokenColor !== 'dorian6'
    && tokenColor !== 'harmonic7'
    && tokenColor !== 'phrygianb2') return false;
  if (tokenColor !== intent.colorIntent) return false;
  if (tokenColor === undefined) return grammarIntent === undefined;
  return !!grammarIntent
    && raw?.harmonicScope === undefined
    && raw?.stableRoles === undefined
    && raw?.dyad === undefined;
}

/** Runtime guard for scheduler-issued ordinary stable carriers. Return
 * arrivals are handled by their dedicated branch above; ordinary carriers
 * must belong to their onset chord and declare a non-empty role set. */
function acgStableTokenContract(token: AbstractMelodyToken): AcgStableArrivalTokenIntent | null {
  const intent = token.acg;
  const raw = intent as RuntimeAcgTokenIntent | undefined;
  if (!intent || raw?.harmonicScope !== 'current-chord' || raw.colorIntent !== undefined) return null;
  if (!Array.isArray(raw.stableRoles) || raw.stableRoles.length === 0) return null;
  if (!raw.stableRoles.every((role) => role === 'root'
    || role === 'third'
    || role === 'fifth'
    || role === 'seventh')) return null;
  return intent as AcgStableArrivalTokenIntent;
}

/**
 * Defense in depth for the scheduler-issued grammar contract. It is not a
 * late pitch repair: a malformed/obsolete ScheduledToken simply cannot emit a
 * false stable arrival. The normal production path has already satisfied this
 * in the scheduler, so this check is intentionally read-only.
 */
function acgReturnArrivalContractIsValid(
  intent: AcgReturnGestureIntent,
  entry: ScheduledToken,
  chordPart: ChordPart,
): boolean {
  const targetChord = getCurrentChordAtBeat(chordPart, entry.startBeat);
  if (!targetChord) return false;
  if (targetChord.index !== intent.targetChordIndex || intent.chordIndex !== intent.targetChordIndex) return false;
  const grammarIntent = entry.token.acg;
  // An ACG return arrival is valid only when the executable scheduler intent
  // and the terminal itself carry the same harmonic ownership.  Treating
  // either field as optional would let a manually/legacy-created G token
  // bypass the grammar contract merely because its sidecar intent happened to
  // contain a legal target.
  if (!grammarIntent?.harmonicScope || !grammarIntent.stableRoles?.length) return false;
  if (grammarIntent.harmonicScope !== intent.harmonicScope) return false;
  if (!sameAcgRoleSet(grammarIntent.stableRoles, intent.stableRoles)) return false;
  if (!acgDyadContractsMatch(grammarIntent.dyad, intent.dyad, grammarIntent.stableRoles)) return false;
  const candidates = acgStableToneCandidates(targetChord, intent.stableRoles);
  const targetPc = normalizePc(intent.targetPc);
  const target = candidates.find((candidate) => candidate.pc === targetPc && candidate.role === intent.targetRole);
  if (!target) return false;

  if (intent.harmonicScope === 'next-chord') {
    const source = chordPart.blocks[targetChord.index - 1];
    if (!source || source.functionHint !== 'D') return false;
    if (Math.abs(entry.startBeat - targetChord.startBeat) > 1e-4) return false;
  }

  if (intent.dyad) {
    const partner = candidates.find((candidate) => candidate.pc === normalizePc(intent.dyad!.partnerPc)
      && candidate.role === intent.dyad!.partnerRole
      && candidate.pc !== target.pc
      && intent.dyad!.partnerRoles.includes(candidate.role));
    if (!partner) return false;
  }
  return true;
}

function sameAcgRoleSet(left: readonly AcgReturnGestureIntent['stableRoles'][number][], right: readonly AcgReturnGestureIntent['stableRoles'][number][]): boolean {
  return left.length === right.length && left.every((role) => right.includes(role)) && right.every((role) => left.includes(role));
}

/** A dyad is grammar-owned. Its existence and voicing preferences must match
 * in both directions: a scheduler sidecar may resolve a declared dyad, but it
 * may not add one after the token was authored (or silently erase one). */
function acgDyadContractsMatch(
  grammarDyad: AcgStableArrivalTokenIntent['dyad'],
  scheduledDyad: AcgReturnGestureIntent['dyad'],
  stableRoles: readonly AcgReturnGestureIntent['stableRoles'][number][],
): boolean {
  if (!grammarDyad || !scheduledDyad) return grammarDyad === undefined && scheduledDyad === undefined;
  if (grammarDyad.voicing !== scheduledDyad.voicing) return false;
  if (!sameAcgRoleSet(grammarDyad.partnerRoles, scheduledDyad.partnerRoles)) return false;
  if (grammarDyad.preferredIntervals.length !== scheduledDyad.preferredIntervals.length
    || grammarDyad.preferredIntervals.some((interval, index) => interval !== scheduledDyad.preferredIntervals[index])) return false;
  if (!grammarDyad.partnerRoles.every((role) => stableRoles.includes(role))) return false;
  return stableRoles.includes(scheduledDyad.partnerRole)
    && scheduledDyad.partnerRoles.includes(scheduledDyad.partnerRole);
}

/** Materialize an already-approved stable pc in the piano topline register. */
function materializeAcgArrivalMidi(
  intent: AcgReturnGestureIntent,
  prevMidi: number | null,
  registerCenter?: number,
): number {
  const reference = prevMidi !== null && prevMidi >= ACG_RETURN_MIN_MIDI - 3
    ? prevMidi
    : Math.max(72, registerCenter ?? 74);
  return nearestAcgMidi(intent.targetPc, reference);
}

/**
 * Realize a prescribed approach without re-sampling harmony. Modal colors are
 * only admitted when they resolve immediately into the locked arrival; otherwise
 * a local-scale step wins, then a direct chromatic neighbor is the final safe fallback.
 */
function materializeAcgApproachMidi(
  intent: AcgReturnGestureIntent,
  targetMidi: number,
  chord: NonNullable<ReturnType<typeof getCurrentChordAtBeat>>,
  sets: ReturnType<typeof buildPitchSets>,
): number {
  const sign = intent.approachDirection === 'above' ? 1 : -1;
  const max = intent.approachSemitones ?? 1;
  const colorPc = colorApproachPc(intent, chord, targetMidi);
  const allowed = new Set<number>([...sets.chordTones, ...sets.colorTones, ...sets.scaleTones].map(normalizePc));
  const candidates: number[] = [];
  if (colorPc !== null && allowed.has(colorPc)) {
    const colorMidi = nearestAcgMidi(colorPc, targetMidi + sign * max);
    if (isDirectedAcgApproach(colorMidi, targetMidi, sign, max)) candidates.push(colorMidi);
  }
  for (let distance = max; distance >= 1; distance--) {
    const candidate = targetMidi + sign * distance;
    if (candidate >= ACG_RETURN_MIN_MIDI && candidate <= ACG_RETURN_MAX_MIDI && allowed.has(normalizePc(candidate))) candidates.push(candidate);
  }
  if (candidates.length > 0) return closestMidi(candidates, targetMidi + sign * max);
  // A semitone neighbor is always a resolution-bearing passing tone, even if it
  // falls outside the current chord-scale. It cannot remain unresolved because the
  // paired arrival is emitted immediately after it.
  return clampAcgMidi(targetMidi + sign);
}

function colorApproachPc(
  intent: AcgReturnGestureIntent,
  chord: NonNullable<ReturnType<typeof getCurrentChordAtBeat>>,
  targetMidi: number,
): number | null {
  const targetPc = normalizePc(targetMidi);
  if (intent.colorIntent === 'dorian6'
      && intent.approachDirection === 'above'
      && targetPc === normalizePc(chord.rootPc + 7)
      && chord.functionHint === 'S') {
    return normalizePc(chord.rootPc + 9); // 6 → 5
  }
  if (intent.colorIntent === 'harmonic7'
      && intent.approachDirection === 'below'
      && intent.targetRole === 'root'
      && chord.functionHint === 'D'
      && targetPc === normalizePc(chord.rootPc + 5)) {
    return normalizePc(chord.rootPc + 4); // ♮7 → 1
  }
  if (intent.colorIntent === 'phrygianb2'
      && intent.approachDirection === 'above'
      && intent.targetRole === 'root'
      && targetPc === normalizePc(chord.rootPc)) {
    return normalizePc(chord.rootPc + 1); // ♭2 → 1
  }
  return null;
}

function isDirectedAcgApproach(candidateMidi: number, targetMidi: number, sign: 1 | -1, max: number): boolean {
  const delta = candidateMidi - targetMidi;
  return Math.abs(delta) >= 1 && Math.abs(delta) <= max && (sign > 0 ? delta > 0 : delta < 0);
}

function materializeAcgPickupMidi(
  intent: AcgReturnGestureIntent,
  prevMidi: number | null,
  registerCenter: number | undefined,
  _chord: NonNullable<ReturnType<typeof getCurrentChordAtBeat>>,
  sets: ReturnType<typeof buildPitchSets>,
): number {
  const target = materializeAcgArrivalMidi(intent, prevMidi, registerCenter);
  const sign = intent.approachDirection === 'above' ? 1 : -1;
  // More than one pickup walks toward the approach rather than repeating the same pitch.
  const desired = prevMidi !== null && ((sign < 0 && prevMidi < target) || (sign > 0 && prevMidi > target))
    ? prevMidi - sign * 2
    : target + sign * 3;
  const allowed = new Set<number>([...sets.chordTones, ...sets.colorTones, ...sets.scaleTones].map(normalizePc));
  const candidates: number[] = [];
  for (let midi = ACG_RETURN_MIN_MIDI; midi <= ACG_RETURN_MAX_MIDI; midi++) {
    if (!allowed.has(normalizePc(midi))) continue;
    if ((sign < 0 && midi >= target) || (sign > 0 && midi <= target)) continue;
    candidates.push(midi);
  }
  return candidates.length > 0 ? closestMidi(candidates, desired) : clampAcgMidi(desired);
}

function materializeAcgDyadPartnerMidi(intent: AcgReturnGestureIntent, targetMidi: number): number | null {
  const dyad = intent.dyad;
  if (!dyad) return null;
  const candidates: number[] = [];
  for (let midi = ACG_RETURN_DYAD_MIN_MIDI; midi <= Math.min(ACG_RETURN_MAX_MIDI, targetMidi - 2); midi++) {
    if (normalizePc(midi) === normalizePc(dyad.partnerPc)) candidates.push(midi);
  }
  if (candidates.length === 0) return null;
  const preferred = [...dyad.preferredIntervals];
  return [...candidates].sort((a, b) => {
    const aInterval = targetMidi - a;
    const bInterval = targetMidi - b;
    const aClass = normalizePc(aInterval);
    const bClass = normalizePc(bInterval);
    const aRank = preferred.indexOf(aClass as typeof preferred[number]);
    const bRank = preferred.indexOf(bClass as typeof preferred[number]);
    const aScore = (aRank < 0 ? preferred.length + 1 : aRank) * 100 + Math.abs(aInterval - 7);
    const bScore = (bRank < 0 ? preferred.length + 1 : bRank) * 100 + Math.abs(bInterval - 7);
    return aScore - bScore || b - a;
  })[0] ?? null;
}

function nearestAcgMidi(pc: number, reference: number): number {
  const candidates: number[] = [];
  for (let midi = ACG_RETURN_MIN_MIDI; midi <= ACG_RETURN_MAX_MIDI; midi++) {
    if (normalizePc(midi) === normalizePc(pc)) candidates.push(midi);
  }
  return closestMidi(candidates, reference);
}

function closestMidi(candidates: readonly number[], reference: number): number {
  let best = candidates[0] ?? clampAcgMidi(reference);
  let distance = Math.abs(best - reference);
  for (const candidate of candidates.slice(1)) {
    const nextDistance = Math.abs(candidate - reference);
    if (nextDistance < distance || (nextDistance === distance && candidate > best)) {
      best = candidate;
      distance = nextDistance;
    }
  }
  return best;
}

function clampAcgMidi(midi: number): number {
  while (midi < ACG_RETURN_MIN_MIDI) midi += 12;
  while (midi > ACG_RETURN_MAX_MIDI) midi -= 12;
  return Math.max(ACG_RETURN_MIN_MIDI, Math.min(ACG_RETURN_MAX_MIDI, midi));
}

/** ACG lead is the piano's top voice. This is realization-time register selection,
 * not a later octave-lift pass over NoteIR. */
function fitAcgSopranoRegister(midi: number): number {
  return clampAcgMidi(midi);
}

function pushAcgReturnArrivalEvents(
  events: NoteEvent[],
  entry: ScheduledToken,
  targetMidi: number,
  time: number,
  duration: number,
  intent: AcgReturnGestureIntent,
): void {
  pushAcgReturnEvent(events, entry, targetMidi, time, duration, 'arrival', 'topline');
  const partnerMidi = materializeAcgDyadPartnerMidi(intent, targetMidi);
  if (partnerMidi !== null && partnerMidi !== targetMidi) {
    pushAcgReturnEvent(events, entry, partnerMidi, time, duration, 'arrival', 'dyad');
  }
}

function pushAcgReturnEvent(
  events: NoteEvent[],
  entry: ScheduledToken,
  noteNumber: number,
  time: number,
  duration: number,
  role: AcgReturnGestureIntent['role'],
  voice: 'topline' | 'dyad' = 'topline',
): void {
  pushOrMergeRepeat(events, {
    noteNumber,
    time,
    duration: Math.max(0.01, duration),
    // The dyad is born as a lower inner voice here, while grammar provenance
    // still exists.  Do not try to infer dyads later from arbitrary same-onset
    // NoteIR pairs: a cycle phrase may legitimately overlap at one tick.
    // The return's dyad must leave headroom for the simultaneously-arriving
    // bass root and rolled middle hand.  Bar normalization may lift a quiet
    // phrase a little, so keep the source gesture deliberately cantabile
    // rather than f-level: this is authored expression, not a later peak fix.
    velocity: voice === 'dyad' ? 34 : role === 'arrival' ? 82 : role === 'approach' ? 76 : 72,
    part: 'melody',
    origin: 'return',
    lickSource: true,
    grammarTokenKind: entry.token.kind,
    ...brickEventMeta(entry),
    acgReturnGestureId: entry.acgReturn?.gestureId,
    acgReturnRole: role,
    acgReturnVoice: voice,
  });
}

function chooseNoteWithGuideTone(args: {
  token: AbstractMelodyToken;
  chord: NonNullable<ReturnType<typeof getCurrentChordAtBeat>>;
  startBeat: number;
  chordPart: ChordPart;
  guideTonePlan?: GuideTonePlan | null;
  preserveSlopeGrammar?: boolean;
  /** ACG consumes HarmonicPlan's exact stable/scale contract during realization;
   * it must not hand structural notes to the generic guide-tone rewriter. */
  acgMainChain?: boolean;
  /** A generic A token always resolves into a plan-stable target, even when
   * that target's own metric position is otherwise a passing slot. */
  forceAcgStableAnchor?: boolean;
  ctx: NoteChooserContext;
}): ChoiceResult {
  const { token, chord, startBeat, chordPart, guideTonePlan, preserveSlopeGrammar, acgMainChain, forceAcgStableAnchor, ctx } = args;
  if (acgMainChain) {
    // Stable ACG ownership is issued by the scheduler as a token contract.
    // Do not let realization turn an unannotated long/strong carrier into a
    // stable landing on its own: such a token is malformed and fails closed.
    // This preserves ordinary corpus motion while making harmonicScope and
    // stableRoles executable rather than documentation-only metadata.
    const stableContract = acgStableTokenContract(token);
    const requiresStableAnchor = forceAcgStableAnchor || shouldAnchorAcgToken(token, startBeat, chord, chordPart);
    if (requiresStableAnchor && !stableContract) {
      return { midi: null, triadicState: ctx.triadicState };
    }
    // Do not delegate a plan-stable anchor to IV's empty-window fallback:
    // a slope can leave no chord tone in its exact +/− interval window, at
    // which point the generic chooser intentionally falls back to a random
    // chromatic MIDI. For ACG that would violate the already-issued
    // stableToneMap/chordScaleMap contract. Choose a legal soprano pitch
    // directly, preserving the slope as a preference rather than allowing it
    // to override harmony. This is still token realization, not a NoteIR fix.
    if (stableContract) return chooseAcgPlanStableNote(ctx, chord, stableContract.stableRoles);
    const choice = chooseNote(token, ctx);
    // A paired approach is deliberately permitted to be an immediate
    // neighbour outside the current pool.  All other free grammar terminals
    // must still be admitted by the current HarmonicPlan contract.
    if (choice.midi === null
      || (token.kind === 'A' && ctx.approachTargetMidi !== undefined)
      || isAcgPlanAdmittedMidi(choice.midi, ctx)) return choice;
    // A free terminal that misses its exact slope window may fall back only
    // to the plan's admitted (chord/color/scale) pool. It must not be
    // retroactively promoted to a stable anchor here, because its scheduler
    // did not issue a harmonicScope/stableRoles contract.
    return chooseAcgPlanAdmittedNote(ctx);
  }
  if (preserveSlopeGrammar && ctx.slopeConstraint && token.kind !== 'G') {
    return chooseNote(token, ctx);
  }
  if (shouldBindToGuideTone(token, startBeat, chord, chordPart)) {
    const point = guideToneAtBeat(guideTonePlan, chord, startBeat);
    if (point) {
      return {
        midi: materializeGuideTone(point, ctx.prevMidi, ctx.registerCenter),
        triadicState: ctx.triadicState,
      };
    }
  }
  return chooseNote(token, ctx);
}

/**
 * Select an exact HarmonicPlan stable tone for ACG's non-return anchors.
 * The caller already turned ordinary ACG material into C-like anchors; the
 * only remaining question is register/contour. A slope is honoured whenever
 * a legal stable candidate exists in that direction, but harmony always wins
 * over an impossible directed interval.
 */
function chooseAcgPlanStableNote(
  ctx: NoteChooserContext,
  chord: NonNullable<ReturnType<typeof getCurrentChordAtBeat>>,
  stableRoles: readonly AcgStableArrivalTokenIntent['stableRoles'][number][],
): ChoiceResult {
  const pcs = [...new Set(acgStableToneCandidates(chord, stableRoles).map((candidate) => candidate.pc))];
  // A declared role set that has no stable∩scale candidates is a broken
  // scheduler contract. Do not fall back to generic chord spelling, because
  // that would weaken stableRoles after the token has been issued.
  if (pcs.length === 0) return { midi: null, triadicState: ctx.triadicState };
  return chooseAcgSopranoFromPcs(ctx, pcs);
}

/** Fallback for free ACG grammar motion (for example an impossible slope
 * window). Unlike chooseAcgPlanStableNote this never claims a stable role;
 * it simply stays inside the pre-authorized HarmonicPlan palette. */
function chooseAcgPlanAdmittedNote(ctx: NoteChooserContext): ChoiceResult {
  const pcs = [...new Set([
    ...ctx.sets.chordTones,
    ...ctx.sets.colorTones,
    ...ctx.sets.scaleTones,
  ].map(normalizePc))];
  if (pcs.length === 0) return { midi: null, triadicState: ctx.triadicState };
  return chooseAcgSopranoFromPcs(ctx, pcs);
}

function chooseAcgSopranoFromPcs(ctx: NoteChooserContext, pcs: readonly number[]): ChoiceResult {
  const minMidi = 69;
  const maxMidi = 86;
  const candidates: number[] = [];
  for (let midi = minMidi; midi <= maxMidi; midi++) {
    if (pcs.includes(((midi % 12) + 12) % 12)) candidates.push(midi);
  }
  if (candidates.length === 0) {
    const fallbackPc = pcs[0];
    return { midi: 72 + ((fallbackPc - 72 + 120) % 12), triadicState: ctx.triadicState };
  }

  const reference = ctx.prevMidi ?? ctx.registerCenter ?? 74;
  const slope = ctx.slopeConstraint;
  let pool = candidates;
  let target = reference;
  if (slope) {
    const desired = (slope.dirMin + slope.dirMax) / 2;
    target = reference + desired;
    const directed = desired > 0
      ? candidates.filter((midi) => midi >= reference + Math.max(1, slope.dirMin))
      : desired < 0
        ? candidates.filter((midi) => midi <= reference + Math.min(-1, slope.dirMax))
        : candidates;
    if (directed.length > 0) pool = directed;
  }
  const bestDistance = Math.min(...pool.map((midi) => Math.abs(midi - target)));
  const best = pool.filter((midi) => Math.abs(midi - target) === bestDistance);
  // A seeded tie-break keeps repeated harmonic choices from always selecting
  // the lower octave while preserving deterministic output for each seed.
  const chosen = best.length > 1 && ctx.rng
    ? best[Math.min(best.length - 1, Math.floor(ctx.rng() * best.length))]
    : best[0];
  return { midi: chosen, triadicState: ctx.triadicState };
}

function shouldAnchorAcgToken(
  token: AbstractMelodyToken,
  startBeat: number,
  chord: NonNullable<ReturnType<typeof getCurrentChordAtBeat>>,
  chordPart: ChordPart,
): boolean {
  if (token.kind === 'R' || token.kind === 'SlopeEnter' || token.kind === 'SlopeExit') return false;
  // A / Triadic are explicit movement terminals. A has a scheduler-time
  // non-structural placement proof; Triadic already walks the plan's chord
  // contract. Slope is different: it can choose any local-scale pitch, so on
  // a strong beat it must be materialized through the stable anchor chooser
  // (which still honours the active direction as a preference).
  if (token.kind === 'A' || token.kind === 'Triadic') return false;
  if (token.kind === 'G' || token.kind === 'B') return true;
  // The final harmony auditor treats an in-chord exposure of 0.75 beat as a
  // structural identity. Keep the producer's threshold identical: a .78-beat
  // free X/S/L tone is musically long enough to need the stable contract and
  // must not rely on a downstream rejection to discover that fact.
  const longTone = token.duration >= 0.75 - 1e-4;
  // Use the same metric tolerance as the read-only auditor. Cycle spreading
  // deliberately leaves some phrase starts a few ticks before 2/4; treating
  // only mathematically exact grid values as structural let an S/L token land
  // at 1.97, remain a free scale tone, then be (correctly) rejected as a
  // strong-beat identity downstream. This is still token-time realization:
  // near-grid anchors choose stable∩scale before any NoteIR exists.
  return longTone || isAcgStructuralBeat(startBeat, chord, chordPart);
}

/** Keep ACG token-time anchor detection aligned with the final harmony
 * auditor's 0.08-beat metric tolerance, with a tiny safety margin for tick
 * rounding. This is deliberately local to ACG; generic MG guide-tone timing
 * retains its original exact-grid semantics. */
function isAcgStructuralBeat(
  beat: number,
  chord: NonNullable<ReturnType<typeof getCurrentChordAtBeat>>,
  chordPart: ChordPart,
): boolean {
  const [numerator, denominator] = chordPart.meter;
  const beatsPerBar = numerator * (4 / denominator);
  const tolerance = 0.09;
  if (Number.isFinite(beatsPerBar) && beatsPerBar > 0) {
    const phase = ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar;
    const distanceToStrong = Math.min(
      Math.abs(phase),
      Math.abs(phase - beatsPerBar / 2),
      Math.abs(phase - beatsPerBar),
    );
    if (distanceToStrong <= tolerance) return true;
  }
  return Math.abs(beat - chord.startBeat) <= tolerance;
}

/** Passing ACG material can be colorful, but never escapes the exact
 * stable/color/scale admission sets carried by the HarmonicPlan. */
function isAcgPlanAdmittedMidi(midi: number, ctx: NoteChooserContext): boolean {
  const pc = normalizePc(midi);
  return ctx.sets.chordTones.includes(pc)
    || ctx.sets.colorTones.includes(pc)
    || ctx.sets.scaleTones.includes(pc);
}

function shouldBindToGuideTone(
  token: AbstractMelodyToken,
  startBeat: number,
  chord: NonNullable<ReturnType<typeof getCurrentChordAtBeat>>,
  chordPart: ChordPart,
): boolean {
  if (token.kind === 'G') return true;
  if (token.kind === 'R' || token.kind === 'A' || token.kind === 'B'
      || token.kind === 'SlopeEnter' || token.kind === 'SlopeExit') return false;

  const chordEntrance = Math.abs(startBeat - chord.startBeat) < 1e-4;
  const longTone = token.duration >= 1.0;
  const strongBeat = isStrongBeat(startBeat, chordPart);

  return chordEntrance || longTone || strongBeat;
}

function isStrongBeat(beat: number, chordPart: ChordPart): boolean {
  const [num, den] = chordPart.meter;
  const beatsPerMeasure = num * (4 / den);
  if (beatsPerMeasure <= 0) return false;
  const beatInMeasure = ((beat % beatsPerMeasure) + beatsPerMeasure) % beatsPerMeasure;
  if (Math.abs(beatInMeasure) < 1e-4) return true;
  if (beatsPerMeasure >= 4 && Math.abs(beatInMeasure - beatsPerMeasure / 2) < 1e-4) return true;
  return false;
}

/** Clip a note's duration so it doesn't ring past the song's final
 *  beat. IV uses slot-based timing and an end-of-leadsheet boundary;
 *  this is the equivalent. Returns at least 0.01 so empty events
 *  aren't created. */
function clipToSongEnd(duration: number, startBeat: number, songEnd: number): number {
  const remain = songEnd - startBeat;
  if (remain <= 0.01) return 0.01;
  return Math.min(duration, remain);
}
