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
import type { AbstractMelodyToken } from '../knowledge/melodyGrammarTypes';
import { buildPitchSets } from './mgPitchClassSets';
import { chooseNote, type ChoiceResult, type NoteChooserContext } from './mgNoteChooser';

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
}
// body(LickGen 忠实区段)用 NoteEvent;在本模块即 MgNoteEvent。
type NoteEvent = MgNoteEvent;

// ── Guide-tone stub(Loop 5 用 mgGuideTonePlanner 接真 plan)─────────────
// MG guideToneAtBeat(null/undefined) 返回 null;Loop 4 始终传 guideTonePlan=undefined,
// 故 stub 恒返 null,materializeGuideTone 分支不可达。raw melody 与 MG(同 guideTonePlan=undefined)严格一致。
export type GuideTonePlan = unknown;
type GuideTonePoint = { pc: number };
function guideToneAtBeat(
  _plan: GuideTonePlan | null | undefined,
  _chord: unknown,
  _beat: number,
): GuideTonePoint | null {
  return null; // Loop 5: 查真 plan.byChordIndex
}
function materializeGuideTone(
  _point: GuideTonePoint,
  _prevMidi: number | null,
  _registerCenter?: number,
): number {
  // Loop 4 永不触达(guideToneAtBeat 恒 null);Loop 5 接真实现。
  throw new Error('materializeGuideTone: guide-tone plan deferred to Loop 5');
}

// ============================================================
// 以下为 LickGen.ts:23-278 忠实区段(import/NoteEvent/guide-tone 由上方接管)
// ============================================================

export interface LickGenArgs {
  /** Tokens already laid out with their start beats. */
  scheduledTokens: Array<{ token: AbstractMelodyToken; startBeat: number }>;
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
}

/** IV LickGen.java:1833-1861 avoidRepeats. When the new event has the
 *  same pitch as the immediately-preceding melody event AND lands at
 *  exactly that event's end time, IV extends the previous note's
 *  duration instead of pushing a fresh event. Cleans up grammar
 *  output's natural tendency to emit repeated pitches as separate
 *  staccato hits and instead glides them into a single sustained note.
 *  Default-on per IV (the only invocation in the LickGen pipeline
 *  passes avoidRepeats=true). */
function pushOrMergeRepeat(events: NoteEvent[], ev: NoteEvent): void {
  if (events.length > 0 && ev.part === 'melody') {
    const last = events[events.length - 1];
    if (last.part === 'melody'
        && last.noteNumber === ev.noteNumber
        && Math.abs(last.time + last.duration - ev.time) < 1e-4) {
      last.duration += ev.duration;
      return;
    }
  }
  events.push(ev);
}

export function realizeTokens(args: LickGenArgs): NoteEvent[] {
  const { scheduledTokens, chordPart, initialPrevMidi, registerCenter, rng, guideTonePlan, preserveSlopeGrammar } = args;
  const events: NoteEvent[] = [];
  let prevMidi: number | null = initialPrevMidi ?? null;
  let triadicState: NoteChooserContext['triadicState'] = undefined;
  // Active slope state per IV LickGen.java:1991+ semantics. Set by
  // SlopeEnter marker, cleared by SlopeExit. While active, each note's
  // candidate MIDIs are constrained to [prev + dirMin, prev + dirMax].
  let activeSlope: { dirMin: number; dirMax: number } | null = null;

  for (let i = 0; i < scheduledTokens.length; i++) {
    const { token, startBeat } = scheduledTokens[i];

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

    const sets = buildPitchSets({ chord, nextChord });

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
          const targetSets = buildPitchSets({ chord: targetChord, nextChord: targetNext });
          const targetChoice = chooseNoteWithGuideTone({
            token: targetEntry.token,
            chord: targetChord,
            startBeat: targetEntry.startBeat,
            chordPart,
            guideTonePlan,
            preserveSlopeGrammar,
            ctx: {
              sets: targetSets, prevMidi, registerCenter, triadicState,
              slopeConstraint: activeSlope ?? undefined,
              rng,
            },
          });
          if (targetChoice.midi !== null) {
            // Emit A using the target as anchor.
            const approachChoice = chooseNote(token, {
              sets, prevMidi, registerCenter, triadicState,
              approachTargetMidi: targetChoice.midi,
              slopeConstraint: activeSlope ?? undefined,
              rng,
            });
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
              });
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
            });
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

    const choice = chooseNoteWithGuideTone({
      token,
      chord,
      startBeat,
      chordPart,
      guideTonePlan,
      preserveSlopeGrammar,
      ctx: {
        sets,
        prevMidi,
        registerCenter,
        triadicState,
        slopeConstraint: activeSlope ?? undefined,
        rng,
      },
    });
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
      });
      prevMidi = choice.midi;
    }
  }
  return events;
}

function chooseNoteWithGuideTone(args: {
  token: AbstractMelodyToken;
  chord: NonNullable<ReturnType<typeof getCurrentChordAtBeat>>;
  startBeat: number;
  chordPart: ChordPart;
  guideTonePlan?: GuideTonePlan | null;
  preserveSlopeGrammar?: boolean;
  ctx: NoteChooserContext;
}): ChoiceResult {
  const { token, chord, startBeat, chordPart, guideTonePlan, preserveSlopeGrammar, ctx } = args;
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
