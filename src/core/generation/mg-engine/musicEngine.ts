// Seeded random number generator
export class Random {
  private seed: number;

  constructor(seed: number | string) {
    if (typeof seed === 'string') {
      this.seed = seed.split('').reduce((a, b) => {
        a = (a << 5) - a + b.charCodeAt(0);
        return a & a;
      }, 0);
    } else {
      this.seed = seed;
    }
  }

  // Returns float between 0 and 1
  next() {
    const x = Math.sin(this.seed++) * 10000;
    return x - Math.floor(x);
  }

  // Returns integer between min and max (inclusive)
  range(min: number, max: number) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  // Pick random element from array
  pick<T>(arr: T[]): T {
    return arr[this.range(0, arr.length - 1)];
  }

  // Pick with weights, e.g. [{item: 'A', weight: 80}, {item: 'B', weight: 20}]
  pickWeighted<T>(options: { item: T; weight: number }[]): T {
    const totalWeight = options.reduce((sum, opt) => sum + opt.weight, 0);
    let randomVal = this.next() * totalWeight;
    for (const option of options) {
      if (randomVal < option.weight) return option.item;
      randomVal -= option.weight;
    }
    return options[options.length - 1].item;
  }
}

import { STYLE_DICTIONARY, StyleName } from './styleDictionary';
import {
  noteToMidi,
  midiToNote,
  getClosestScaleMidi,
  isAvoidNote,
  TensionTracker,
  INTERVAL_AESTHETICS,
  SCALE_TYPES,
  Emotion,
  MAINSTREAM_EMOTION_TO_MODE,
  EXOTIC_MODES,
  EXOTIC_MODE_PROBABILITY,
  MAJOR_FLAVOR_MODES,
  modeProgressionTemplate,
  getModeAwareSubstitutions,
  getResolutionTargets,
  MELODY_RANGE,
  findCommonTones,
  CHORD_TYPES,
  JAZZ_ROOTLESS_VOICINGS,
  POP_VOICINGS,
  BLUES_VOICINGS,
  RNB_VOICINGS,
  detectModeBorrowing,
  getMeterContext,
  MeterContext,
  computeGlobalContract,
  assembleVoicing,
  placeVoicingMidi,
  STYLE_SHELL,
  STYLE_ROOTLESS,
  STYLE_CLUSTER,
  STYLE_FULL,
  STYLE_BLUES,
  VoicingStylePreference,
  getChordBackboneIntervals,
  classifyNoteRole,
  NoteRole,
  classifyCadenceTier,
  cadenceTargetPcs,
  snapMidiToNearestPc,
  evaluateTensionState,
  detectPhrases,
  PhraseSegment,
  PhraseRole,
  TensionState,
  BASS_RANGE,
  CHORD_RANGE,
  getScaleGravity,
  classifyEngineChordType,
  getChordVoicingAesthetics,
  evaluateNoteInChordContext,
  NoteHarmonicAssessment,
  modeToKeyFamily,
} from './musicTheory';
import { DYNAMIC_TSD_DICTIONARY, analyzeTargetQuality } from './dynamicHarmony';
import { BASSLINE_RULES, DEFAULT_BASSLINE_RULE, pickBasslineRule, BASS_PATTERN_RULES, resolveBassAnchorPc, clampPcToBassMidi } from './basslineRules';
// AF2 ChordTextureEngine 单点劫持(Phase 2b.1 集成).applyTexture 入口先试 AF2,
// 未覆盖的 textureType 返回 null 时 fallback 到下方 mg 原实现.
import { ChordTextureEngine } from '../af2-engine/instruments/chord-texture/ChordTextureEngine';
// Phase 1 (#6) — Engine class 组 A 纯函数化:抽出无 state 依赖的 method 到 engine-utils.
// Phase 2 (#6) — Engine class 组 B PRNG 参数化:接 `Random` 为参数的 method 同步抽出.
import {
    resolveTonalCharacter, getHarmonicFunction, applySwing,
    computeBackboneTargets, estimateBackboneAlignment,
    findClosestCrossChordPair, estimateMotifShapeMetrics,
    getFillScaleForStyle, getScaleForStyle,
    // Phase 2
    resolveMotifStrategy as utilResolveMotifStrategy,
    generateMelodyPhrase as utilGenerateMelodyPhrase,
    deriveDevelopmentMotif as utilDeriveDevelopmentMotif,
    motifMutator as utilMotifMutator,
    decorateChordType as utilDecorateChordType,
    generateProgression as utilGenerateProgression,
    resolveGeneration as utilResolveGeneration,
    realizeProgression as utilRealizeProgression,
    generateProgressions as utilGenerateProgressions,
} from './engine-utils';

// Re-export theory primitives that external callers import from musicEngine
// (test_batch.ts uses noteToMidi). Engine itself no longer owns these.
export { noteToMidi, midiToNote, TensionTracker } from './musicTheory';
export type { Emotion } from './musicTheory';

// Resolution urgency threshold. evaluateNoteInChordContext returns
// urgency ∈ [0, 1]; values at or above this gate the unified-tension-
// resolution hard constraint. 0.5 catches D-function dissonances and
// chord-7 tendencies while still letting S-function color hangs
// (sus / 11 / 13 waiting for D) pass through.
const UNRESOLVED_TENSION_THRESHOLD = 0.5;

// Chord-7 detection and resolve-set computation have been folded into
// evaluateNoteInChordContext in musicTheory.ts — the same primitive
// now handles all five resolution paths uniformly.


export interface ChordDef {
  root: string;       // e.g., 'C', 'F#'
  rootMidi: number;   // MIDI root for scale calculations
  type: string;       // e.g., 'maj7', 'm9', 'dom7'
  roman: string;      // e.g., 'Imaj7', 'V7/vi'
  bass: string;       // e.g., 'C', 'E'
  bassMidi: number;   // Exact MIDI note of the bass
  notes: string[];    // Pitches mapped to octave: 'C4', 'E4', 'G4', 'B4'
  // Authoritative voicing MIDI. notes[] is a display projection
  // (chord-root-relative spelling, may contain ##/bb/B#/Cb), while
  // notesMidi[] is the source of truth the audio renderer reads.
  // Same length and order as notes[]. Keeping both lets the UI label
  // chords correctly while playback never depends on a string ↔ MIDI
  // round-trip — eliminates a whole class of spelling-induced
  // detuning if a future spelling refactor ever produces a name the
  // parser doesn't recognise.
  notesMidi: number[];
  duration: number;   // In beats (1 beat = 1 quarter note)
  // Divisi 2.0 — Harmonic state machine middleware fields. Populated
  // in realizeProgression after bassMidi is finalized via
  // evaluateTensionState (musicTheory). Downstream consumers:
  //   tensionState     — Smart-Omit gate in applyTexture, cadence
  //                      intercept in generateBarPattern.
  //   effectiveFunc    — TSD function override (suspended-dom F/G
  //                      reads as D, pedal-on-key reads as T, etc.).
  //                      Cadence classifier reads this if present.
  //   virtualExtensions — interval semitones from BASS pitch that
  //                      Composite states unlock for melody magnetism.
  //   chordSymbol      — UI display string ("Cmaj7" or "Cmaj7/E"),
  //                      reverse-derived from the actual physical
  //                      bass position so the UI label matches what
  //                      the listener actually hears.
  tensionState?: TensionState;
  effectiveFunc?: 'T' | 'S' | 'D';
  virtualExtensions?: number[];
  chordSymbol?: string;
  // Mode-borrowing detection (modal interchange diagnostic). When the
  // chord's pitch content is NOT diatonic to the song's home mode but
  // IS a subset of some parallel mode (Aeolian / Mixolydian / Dorian /
  // ...), this names the borrowing source. null / undefined for chords
  // diatonic to home or fully chromatic (not from any parallel mode).
  // Pure diagnostic — engine behavior unchanged.
  borrowedFrom?: string | null;
  // Pre-generated bar-internal bass pattern (老师 4 — BASSLINE 自有
  // 线条). Populated by realizeProgression when style.bassPattern is
  // set. applyTexture's bass-emit path is replaced by these events for
  // bars where this is non-null. time is bar-relative (0..duration).
  bassPattern?: { time: number; midi: number; duration: number; velocity: number }[];
  // Local tonal center pc — set at chord-realization time by
  // realizeProgression. Default = globalKey root pc. For secondary
  // dominants (roman contains '/' like V/ii, V/vi, subV/X) it carries
  // the borrowing target's pc, so downstream consumers (the melody
  // evaluator's INTERVAL_AESTHETICS lookup) read leading-tone /
  // expectedResolutions in the borrowed key's frame of reference
  // without having to re-detect borrowing on their own.
  //
  // Borrowing detection lives at the harmony layer where it belongs —
  // when the chord is filled. melody-side consumers are pure data
  // consumers; no rederivation, no parallel borrow logic.
  localTonalCenterPc?: number;
}

export interface NoteEvent {
  noteNumber: number;      // 0-127
  time: number;            // In beats from start of progression
  duration: number;        // In beats
  velocity: number;        // 0 to 127
  part: 'melody' | 'chord' | 'bass';
  chordSymbol?: string;    // Only set on the first event of a chord change to notify UI
  pitchOffset?: number;    // Single pitch bend (e.g. +0.5 for a quarter tone sharp)
  pitchEnvelope?: Array<{ timeOffset: number, offsetValue: number }>; // Glide curve
  // Provenance of melody notes for the sacred-boundary contract.
  //   'motif'   — direct projection of the canonical motif. Sacred:
  //               theory audits report on these but never mutate them.
  //   'develop' — engine-derived transformation of the motif. Eligible
  //               for tension / voice-leading / backbone corrections.
  //   'return'  — engine-forced landing on a chord tone (phrase end or
  //               song end, per style.returnRule, or via the
  //               TensionTracker corrective).
  // Only set on melody events.
  origin?: 'motif' | 'develop' | 'return';
}

export interface MusicTimeline {
  events: NoteEvent[];
  visuals: { time: number, label: string }[];
  // Count of high-tension melody notes left unresolved at the end of
  // the song (TensionTracker.unresolved.length). Surfaced for the
  // diagnostics panel and snapshot fixture.
  unresolvedTensions?: number;
  // Phase 5 — Caplin phrase 切分结果。Diagnostics 面板用它显示
  // Phrase Plan + per-bar cadence role 标签。
  phraseSegments?: PhraseSegment[];
  phraseRoleByBar?: PhraseRole[];
  // Phase 13 — meter context (derived from ctx). Audit scripts +
  // future diagnostic consumers read strongBeats / beatsPerMeasure
  // from here instead of hardcoding 4 / [0, 2].
  meterContext?: MeterContext;
}

// =====================================================================
// AND-architecture melody constraint types
// =====================================================================

/** Per-note context fed to all hard/soft predicates. */
interface NoteContext {
  // Chord context
  chord: ChordDef;
  prevChord: ChordDef | null;
  nextChord: ChordDef | null;
  runScale: number[];
  globalIntervals: number[];   // chord literal + admissible color
  vIntervalsFromBass: number[]; // Composite-state virtual extensions
  literalIntervals: number[];   // raw chord type intervals
  // Voice-leading contextual sets (built at song level)
  barBackboneTargets: Set<number> | null;
  voiceLeadingIn: Set<number> | null;
  voiceLeadingOut: Set<number> | null;
  // Position
  motifProjMidi: number;        // raw projection (motif intent)
  lastNoteMidi: number;         // previously emitted melody pitch
  isStructural: boolean;
  isStrongBeat: boolean;
  isFirstNote: boolean;         // idx === 0 in mutatedMotif
  isLastNote: boolean;          // idx === lastIdx
  isPhraseEnd: boolean;         // bar is phrase-end position
  isMotifSacred: boolean;
  // Cadence
  isCadencePosition: boolean;   // shouldReturn && isLastNote && !cadenceBlocked
  cadenceTargetPcs: Set<number> | null;
  cadenceMode: 'force' | 'preserve' | 'none';
  // Tension
  saturatedTensionPcFromKey: number | null; // Tracker.isSaturated
  urgentTensionPcFromKey: number | null;    // Tracker.getMostUrgentTension
  tensionResolveProb: number;   // 0..1 (style strictness)
  tensionResolveRoll: number;   // pre-rolled random
  // Pitch frame
  chordRootPc: number;
  bassPc: number;
  keyRootPc: number;
  rootKeyMidi: number;
  // Style knobs
  complexity: number;
  // Rule 9 / 11 history (Phase 2)
  lastLeapSemis: number;        // signed: + up, - down
  sameDirRunLength: number;     // count of consecutive same-direction steps ending at lastNoteMidi
  // Rule 8 stats (Phase 2)
  stepCount: number;
  leapCount: number;
  // Rule 10 — Apex Singularity (song-level)
  apexBarIdx: number;        // -1 if not set
  apexPitchMidi: number;     // -1 if not set
  isApexBar: boolean;
  barIndex: number;
  // Scale Gravity (universal physics, per scale name). Pre-built
  // Map<fromInterval-from-scale-root, ScaleGravityRule>. The note
  // context provides scale root pc so degree calculation is local.
  scaleGravityRules: Map<number, import('./musicTheory').ScaleGravityRule> | null;
  scaleRootPc: number;          // -1 if scale unknown
  gravityStrictness: number;    // 0..1 from style; controls weight
  effectiveFunc: 'T' | 'S' | 'D';
  // Per-note bypassSnap (from defineMotif's "!" suffix or rule-
  // level bypassStructuralSnap). When true, the note's intentional
  // chromatic color is exempt from the engine's structural-position
  // contract enforcement (in-chord-contract / no-avoid hard filters
  // pass through).
  bypassSnap: boolean;
  // True when this bar belongs to the apex phrase (E option).
  // Anchor scoring's phrase-register-target soft score prefers high
  // register candidates here, lifting the apex phrase's whole baseline
  // midi rather than just one apex bar.
  isApexPhraseBar: boolean;
  // Note duration in beats (current motif emit's m.d). 老师哲学:
  // 长音 ≥ 1 拍 也算稳定位 (position multiplier ×2 用), 不只 ≥1.5.
  noteDuration: number;
  // 物理避音法则上下文 — 老师 modal-vs-tonal 升级.
  // isModalContext: 严格版判定 (仅 allowFloatingColor OR
  //   allowBluesHangTone 风格授权 = true). 调式场允许特征音强拍悬挂.
  // scaleNameForBar: 当前 bar 的 scale 名 (Dorian/Lydian/Mixolydian
  //   等), MODAL_CHARACTERISTIC_NOTES 查特征音免死用.
  isModalContext: boolean;
  scaleNameForBar: string | undefined;
  // Song style — consumed by style-tuned soft scores
  // (blues-stepwise-bonus, etc.). All other style-specific behavior
  // already routes through scaleNameForBar / isModalContext, but a
  // few rules need direct access to the macro identity (BLUES wants
  // explicit stepwise-bonus weighting independent of mode).
  style: StyleName;
}

/**
 * Hard constraint — candidate must pass all active filters or it's
 * eliminated. Filter relaxation kicks in only when no candidate passes.
 */
interface HardConstraint {
  name: string;
  shouldApply: (ctx: NoteContext) => boolean;
  accept: (midi: number, ctx: NoteContext) => boolean;
}

/**
 * Soft score — weighted preference. Each scorer returns a value
 * (typically [0, 1] or [-1, 0]); final candidate score = sum of
 * weight × score.
 */
interface SoftScore {
  name: string;
  weight: number;
  shouldApply: (ctx: NoteContext) => boolean;
  score: (midi: number, ctx: NoteContext) => number;
}

export interface GenerationConfig {
  seed: string;
  style: StyleName;
  key: string;
  // Direct mode override. When set, bypasses emotion resolution. Used by
  // tests/snapshot.ts and any caller that wants explicit mode control.
  mode?: string;
  // Emotion-driven mode resolution. Default 'auto' rolls bright/sad 50/50
  // from a forked Random; 'bright' / 'sad' fix the emotion. Kept for
  // engine determinism (forked-Random consumes a roll regardless of UI
  // exposure); the UI no longer takes emotion as input — mode is now a
  // diagnostic readout.
  emotion?: 'auto' | Emotion;
  // Time-signature override. When set, takes priority over the style's
  // own timeSignature. Mainly used by snapshot tests / advanced callers
  // exercising non-4/4 paths. Resolved into ctx.meterContext at
  // resolveGeneration time. Format: [upper, lower] — e.g. [6, 8].
  meter?: [number, number];
  // bars / tempo / density / complexity have been dropped from the public
  // generation API. bars is auto-derived per macro style
  // (BLUES → 12, POP / JAZZ → 16) via STYLE_DICTIONARY[style].recommendedBars.
  // tempo is a UI / playback concern only; engine doesn't read it.
  // density / complexity are pinned to 0.5 internally — the magnetism +
  // motif-mutator branches that were gated on them are either always-on
  // or always-off under the divisi architecture, no need to expose.
}

export interface ResolvedGenerationContext {
  emotion: Emotion;
  mode: string;
  isExotic: boolean;
  // Per-song motif placement strategy (mutually exclusive). 'regular'
  // restates the canonical motif every motifInterval bars; 'functional'
  // restates it whenever the harmonic function (T/S/D) recurs.
  motifStrategy: 'regular' | 'functional';
  motifInterval: number; // Only meaningful for 'regular'.
  // Named bass-anchor rule applied for the whole song. Picked from
  // style.basslineRules using the forked Random; falls back to
  // DEFAULT_BASSLINE_RULE when the style declares none.
  basslineRule: string;
  // Time signature + derived metric structure. meter comes from
  // style.timeSignature; meterContext holds the parsed strongBeats /
  // beatsPerMeasure / compound classification for downstream consumers.
  // Phase 13A ships the field; Phase 13B+ replaces hardcoded "4"
  // assumptions across the engine with meterContext.beatsPerMeasure.
  meter: [number, number];
  meterContext: MeterContext;
  // Song-level tonal character — decides whether melody must obey
  // functional-harmony resolution (tonal) or floats freely in a
  // scale color (modal).
  //
  //   'tonal'  → functional harmony rules. Tensions (chord 7s,
  //              avoid notes, leading tones) must resolve. V→I,
  //              ii-V-I cadences are load-bearing. Default for
  //              POP / JAZZ / RNB in Major or Minor.
  //   'modal'  → scale-color music. Tensions may hang as the bar's
  //              defining color. BLUES is canonical (b3 / b5 / b7
  //              hang over I/IV/V as the blues scale's signature,
  //              not as tensions seeking resolution). Also fires
  //              when an exotic mode (Dorian / Phrygian / Lydian /
  //              Mixolydian / Locrian) is selected — those modes'
  //              characteristic notes are floats, not pulls.
  //
  // Consumed by evaluateNoteInChordContext: under 'modal', tension
  // urgency is halved (slips below the unified-tension-resolution
  // hard constraint's threshold) AND in-scale 'tension' verdicts
  // upgrade to 'colortone' (= legitimate scale color, no resolution
  // demanded). Future consumers: cadence resolution (skip Tier A/B
  // forces under modal) and TensionTracker (relax saturation under
  // modal).
  tonalCharacter: 'tonal' | 'modal';
}

export const KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Sharp / flat enharmonic spelling tables. KEYS (above) is the legacy
// flat-default spelling kept for backward compat (key-pickers, snapshot
// invariance). For key-context-aware chord/note labels, use spellPcInKey
// below to pick the spelling that matches the key signature's accidental.
const SHARP_SPELLING = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_SPELLING  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Circle of fifths position for each pitch class — positive = sharps
// side, negative = flats side, 0 = C (neutral). Used to decide which
// enharmonic spelling fits a given key's signature.
//
// Sharps side (clockwise from C):  G(+1) D(+2) A(+3) E(+4) B(+5) F#(+6)
// Flats side  (counterclockwise):  F(-1) Bb(-2) Eb(-3) Ab(-4) Db(-5) Gb(-6)
//
// F# vs Gb (pc 6) — chosen as +6 (F#) by convention; could be either.
const CIRCLE_OF_FIFTHS_POS: Record<number, number> = {
    0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6,
    1: -5, 8: -4, 3: -3, 10: -2, 5: -1,
};

/**
 * Spell a pitch class with the accidental that matches the song's key
 * signature. D major (2 sharps) spells pc 6 as F#, not Gb. Bb major
 * (2 flats) spells pc 3 as Eb, not D#. Minor mode is mapped to its
 * relative major (A minor → C major's neutral preference).
 *
 * Pitches not in the key signature (chromatic borrowed notes) follow
 * the key's general accidental preference — sharp keys prefer #
 * spelling for non-diatonic too, flat keys prefer b.
 *
 * Replaces the old `KEYS[pc]` lookup which always returned flat
 * (Db / Eb / Gb / Ab / Bb) regardless of key context — produced
 * "Gbm7" in D major where F#m7 was the only correct spelling.
 */
export function spellPcInKey(pc: number, keyRootPc: number, isMinor: boolean): string {
    const npc = (((pc % 12) + 12) % 12);
    // Minor keys spell like their relative major. A minor (pc 9) →
    // C major (pc 0); relative major = minor root + 3 semis.
    const adjRoot = isMinor ? (((keyRootPc + 3) % 12) + 12) % 12 : (((keyRootPc % 12) + 12) % 12);
    const pos = CIRCLE_OF_FIFTHS_POS[adjRoot] ?? 0;
    // Sharp-side keys (pos > 0): use sharp spelling
    // Flat-side keys (pos < 0): use flat spelling
    // C major (pos = 0): neutral, default to flat (legacy KEYS table)
    const useSharp = pos > 0;
    return useSharp ? SHARP_SPELLING[npc] : FLAT_SPELLING[npc];
}

/**
 * MIDI → note name using key-context spelling. Replaces midiToNote in
 * chord-voicing / chord-bass label paths so all chord labels read with
 * consistent accidentals (D major bass shows F#2, not Gb2).
 */
export function midiToNoteInKey(midi: number, keyRootPc: number, isMinor: boolean): string {
    const pc = ((midi % 12) + 12) % 12;
    const oct = Math.floor(midi / 12) - 1;
    return `${spellPcInKey(pc, keyRootPc, isMinor)}${oct}`;
}

// Note letters in canonical order (C major scale spelling).
const NOTE_LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_NATURAL_PC: Record<string, number> = {
    C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

// Canonical interval-from-chord-root → letter offset map.
// Each semitone interval has a default letter step from the chord root:
//   0 (R)    → +0 letters
//   1 (b2/b9) → +1 letter with flat
//   2 (2/9)   → +1 letter natural
//   3 (m3/#9) → +2 letters (m3) OR +1 letter (#9) — ambiguous, see below
//   4 (M3)    → +2 letters natural
//   5 (4/11)  → +3 letters
//   6 (b5/#11) → +3 letters with sharp (jazz default) OR +4 with flat (dim)
//   7 (5)     → +4 letters
//   8 (b6/#5/b13) → +5 letters with flat (jazz default) OR +4 with sharp (aug)
//   9 (6/13)  → +5 letters natural
//   10 (m7/b7) → +6 letters with flat
//   11 (M7)   → +6 letters natural
const INTERVAL_TO_LETTER_OFFSET: Record<number, number> = {
    0: 0, 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4, 8: 5, 9: 5, 10: 6, 11: 6,
};

/**
 * Spell a pitch class relative to a chord root. b9 of A is "Bb" (not
 * "A#" which makes the chord contain both A and A#); #11 of F is "B"
 * (not Cb except in strict diminished context); b13 of G is "Eb" (not
 * D# unless using altered-dom spelling). Used for chord voicing notes
 * so a single chord's labels are letter-consistent.
 *
 * For interval 3 (m3 vs #9), interval 6 (b5 vs #11), interval 8
 * (b13 vs #5) — the canonical map picks the more common jazz reading.
 * Ambiguity is rare in practice; both readings have the same pc anyway.
 *
 * Chord root letter is sourced from spellPcInKey so a chord whose root
 * gets a sharp spelling (e.g. F# major's I = F#) has all its intervals
 * spelled from F as base.
 */
export function spellPcInChord(
    pc: number,
    chordRootPc: number,
    keyRootPc: number,
    isMinor: boolean,
    chordType?: string,
): string {
    const npc = (((pc % 12) + 12) % 12);
    const rpc = (((chordRootPc % 12) + 12) % 12);
    const interval = (((npc - rpc) % 12) + 12) % 12;
    const rootName = spellPcInKey(rpc, keyRootPc, isMinor);
    const rootLetter = rootName[0];
    const rootLetterIdx = NOTE_LETTERS.indexOf(rootLetter);
    if (rootLetterIdx === -1) {
        // Defensive fallback — shouldn't happen with valid rootName.
        return spellPcInKey(npc, keyRootPc, isMinor);
    }
    // Chord-type overrides for ambiguous intervals.
    //   interval 6 (b5 vs #11):
    //     - dim family (m7b5, m9b5, dim, dim7) → b5 spelling (letter +4)
    //     - everything else → #11 / #4 spelling (letter +3, jazz default)
    //   interval 8 (b13 vs #5):
    //     - aug / #5 family → #5 (letter +4) — rare in our chord types
    //     - everything else → b13 (letter +5, the canonical default)
    let letterOffset = INTERVAL_TO_LETTER_OFFSET[interval] ?? 0;
    if (chordType) {
        const isDimFamily = chordType.includes('m7b5') || chordType.includes('m9b5')
            || chordType.includes('dim');
        const isAugFamily = chordType.includes('aug') || chordType.includes('+5')
            || chordType.includes('7#5');
        if (interval === 6 && isDimFamily) letterOffset = 4;
        if (interval === 8 && isAugFamily) letterOffset = 4;
    }
    const targetLetterIdx = (rootLetterIdx + letterOffset) % 7;
    const targetLetter = NOTE_LETTERS[targetLetterIdx];
    // adj = how many semitones target pc is above the target letter's
    // natural pc. Range normalised to [-2, 2] (double flat to double
    // sharp). Real chord-tone intervals will almost always fall in
    // [-1, +1] after this normalization.
    let adj = (npc - LETTER_NATURAL_PC[targetLetter] + 12) % 12;
    if (adj > 6) adj -= 12;
    let suffix = '';
    if (adj === 2) suffix = '##';
    else if (adj === 1) suffix = '#';
    else if (adj === -1) suffix = 'b';
    else if (adj === -2) suffix = 'bb';
    return targetLetter + suffix;
}

/**
 * MIDI → note name using chord-root-relative spelling. For chord voicing
 * notes where lining up with the chord's interval semantics matters more
 * than the global key signature (b9 of A7 should be Bb regardless of
 * whether the song is in D major or F minor).
 */
export function midiToNoteInChord(
    midi: number,
    chordRootPc: number,
    keyRootPc: number,
    isMinor: boolean,
    chordType?: string,
): string {
    const pc = ((midi % 12) + 12) % 12;
    const stdOct = Math.floor(midi / 12) - 1;
    const name = spellPcInChord(pc, chordRootPc, keyRootPc, isMinor, chordType);
    const letter = name[0];
    const naturalPc = LETTER_NATURAL_PC[letter];
    if (naturalPc === undefined) return `${name}${stdOct}`;
    // adj ∈ [-2, +2] — accidental that bridges letter's natural pc to
    // the spelled pc. Boundary-crossing cases:
    //   naturalPc + adj >= 12  → letter B raised across C (e.g. B#, B##).
    //                            Sounded pitch is in next MIDI octave but
    //                            letter octave is one lower.
    //   naturalPc + adj < 0    → letter C lowered across B (e.g. Cb, Cbb).
    //                            Letter octave is one higher.
    // Without this correction MIDI 60 spelled "B#" labels as "B#4"
    // which round-trips back to MIDI 72 (C5), silently transposing
    // the voicing up an octave on the audio renderer.
    let adj = pc - naturalPc;
    if (adj > 6) adj -= 12;
    else if (adj < -6) adj += 12;
    let oct = stdOct;
    if (naturalPc + adj >= 12) oct -= 1;
    else if (naturalPc + adj < 0) oct += 1;
    return `${name}${oct}`;
}

// Standard music-theory note durations in beats. The motifMutator
// quantizes every emitted note's `d` to the closest value here, so
// the melody never carries non-standard values (e.g. 1.25 from a
// diminution+sequence dividing 2.5 by 2, or 0.16 from a sub-style's
// odd source motif). 0.25 = 16th, 0.5 = 8th, 0.75 = dotted-8th,
// 1.0 = quarter, 1.5 = dotted-quarter, 2.0 = half, 3.0 = dotted-half,
// 4.0 = whole. Triplets are excluded — re-introduce later via a
// dedicated mechanism if a style needs them.
export const QUANTIZED_DURATIONS = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0];

function getNoteFromInterval(root: string, interval: number, octave: number): string {
  const rootIndex = KEYS.indexOf(root);
  const totalIndex = rootIndex + interval;
  const newKey = KEYS[totalIndex % 12];
  const newOctave = octave + Math.floor(totalIndex / 12);
  return `${newKey}${newOctave}`;
}

// Roman → TSD function classifier. Exported so UI / diagnostics can
// detect when a chord's effectiveFunc (set by Divisi 2.0 middleware)
// diverges from the function the roman alone would produce, e.g. F/G
// reads as IV by roman but Divisi marks effectiveFunc='D' because the
// audible chord is a suspended dominant.
export function harmonicFunctionFromRoman(romanOriginal: string): 'T' | 'S' | 'D' {
  const base = romanOriginal.split('/')[0].replace(/maj7|maj9|maj13|m7|m9|m11|sus4|7sus4|9sus4|7b13|7\#9|7alt|dim|aug|\+|o|ø|[0-9]/g, '');
  if (['V', 'v', 'vii', 'VII'].includes(base) || romanOriginal.includes('/')) return 'D';
  if (['IV', 'iv', 'ii', 'II', 'bVI', 'bVII'].includes(base)) return 'S';
  return 'T';
}

export class Engine {
  random: Random;
  // Forked Random for the Aesthetic Anchor scoring (Phase 1 of the
  // intention-driven melody loop). Created lazily in generateArrangement
  // from `config.seed::anchor` so the scoring's tiebreak randomness
  // doesn't pollute the main pipeline stream — keeps progression /
  // motif / cadence decisions stable across anchor-scoring tweaks.
  // Null until generateArrangement runs; the scoring path falls back
  // to a default (closest-to-reference) when null.
  aestheticAnchor: Random | null = null;
  // Rule 10 — Apex Singularity. Set by generateArrangement before bar
  // loop; read by NoteContext builder for the apex-target / apex-
  // headroom soft scores. -1 = no apex set (e.g., direct generateBar
  // calls outside generateArrangement).
  songApexBarIdx: number = -1;
  songApexPitchMidi: number = -1;
  // Phrase register — 老师 E 选项: apex 不只单点, 整个 apex phrase
  // (= apex bar 所在的 phrase) 抬高音区 baseline. 非 apex phrase 用
  // mid baseline. NoteContext builder 派 register baseline 进 ctx,
  // anchor scoring 加 phrase-register-target soft score 偏好该窗口.
  // -1 = 未设置 (退化到旧 apex-only 行为).
  songApexPhraseStartBar: number = -1;
  songApexPhraseEndBar: number = -1;
  // Scale-gravity strictness for the active song. Read by selectBestMidi
  // soft scores; controls how aggressively the engine obeys SCALE_GRAVITY.
  songGravityStrictness: number = 0.5;
  // Meter context for the active song. Set once in generateArrangement
  // from ctx.meterContext; read by generateBarPattern's isStrongBeat
  // predicate + motif scaling. Defaults to 4/4 so call paths that
  // bypass generateArrangement (tests, direct invocations) get
  // pre-Phase-13B behavior.
  songMeterContext: MeterContext = {
    meter: [4, 4], literal: '4/4', beatsPerMeasure: 4,
    strongBeats: [0, 2], isCompound: false, isSimple: true, isIrregular: false,
  };
  // Song-level tonal character mirror — set from ctx.tonalCharacter
  // in generateArrangement, read by generateBarPattern's evaluator
  // calls. Default 'tonal' preserves existing behavior for code paths
  // that bypass generateArrangement (tests / direct invocations).
  songTonalCharacter: 'tonal' | 'modal' = 'tonal';

  constructor(random: Random) {
    this.random = random;
  }

  /**
   * Tonal vs modal verdict — picked once per song at resolveGeneration
   * time, then threaded to every consumer that gates resolution-strict
   * behavior. Reasoning:
   *   - BLUES is canonical modal: blues-scale notes (b3 / b5 / b7)
   *     hang across I-IV-V as scale color, not as tensions seeking
   *     resolution. Forcing functional-harmony resolution on BLUES
   *     destroys the genre's signature.
   *   - Exotic modes (Dorian / Phrygian / Lydian / Mixolydian /
   *     Locrian / harmonic / melodic minor) center on a mode's
   *     characteristic tone, not on V→I cadence; treat them as modal.
   *   - Major / Minor (= Ionian / Aeolian) + non-BLUES style = tonal.
   *     Functional harmony is the load-bearing structure; tensions
   *     must resolve via the unified-tension-resolution constraint.
   */
  // Phase 1 (#6):resolveTonalCharacter 已抽到 engine-utils.ts(组 A 纯函数化)

  /**
   * Resolve emotion → mode for a generation run. Deterministic by SEED.
   *
   * Uses a Random forked from `seed::emotion` so the rolls do not consume
   * entropy from the engine's main Random instance — that keeps the
   * pipeline determinism for callers that pass `mode` directly stable
   * across M3 changes.
   */
  // Phase 2 (#6):resolveGeneration 已抽到 engine-utils.ts(自带 Random 不接外部 rng)
  // 完整决策流(meter / direct mode override / emotion auto / exotic gate / BLUES 例外)
  // 与设计注释保留在 engine-utils.ts 同名函数。
  resolveGeneration(config: GenerationConfig): ResolvedGenerationContext {
    return utilResolveGeneration(config);
  }

  /**
   * Pick one of the two mutually-exclusive motif placement strategies
   * for the song (50/50 random unless the style profile prefers one)
   * and decide the canonical interval N (only relevant to 'regular').
   *
   * Engine picks N from [2, 8] by default; if the style's
   * motifRepeatStrategy.N is set, the value is clamped to its range
   * with a 50% chance to snap to the preferred N.
   */
  // Phase 2 (#6):resolveMotifStrategy 已抽到 engine-utils.ts(组 B PRNG 参数化)
  private resolveMotifStrategy(config: GenerationConfig, r: Random):
      { motifStrategy: 'regular' | 'functional'; motifInterval: number } {
    return utilResolveMotifStrategy(config, r);
  }

  // Phase 2 (#6):generateProgressions 已抽到 engine-utils.ts(public 入口,9/9 完成)
  generateProgressions(config: GenerationConfig): ChordDef[] {
    return utilGenerateProgressions(config, this.random);
  }

  // Phase 2 (#6):decorateChordType 已抽到 engine-utils.ts(组 B PRNG 参数化)
  // 完整 8-step decision pipeline + 设计注释保留在 engine-utils.ts 同名函数。
  private decorateChordType(
      base: { roman: string; type: string; rootOffset: number; scaleDegree?: number },
      nextBase: { roman: string; type: string; rootOffset: number; scaleDegree?: number },
      style: StyleName,
      mode: string,
  ): {
      type: string;
      rootOffsetOverride?: number;
      romanOverride?: string;
  } {
      return utilDecorateChordType(base, nextBase, style, mode, this.random);
  }

  // Phase 2 (#6):generateProgression 已抽到 engine-utils.ts(组 B PRNG 参数化)
  // 内部 decorateChordType 调用已直接 import free function 形式.
  private generateProgression(style: StyleName, bars: number, mode: string): any[] {
      return utilGenerateProgression(style, bars, mode, this.random);
  }

  // === 动机变奏算法机 (Motif Mutator) ===
  // Phase 2 (#6):motifMutator 已抽到 engine-utils.ts(组 B PRNG 参数化)
  private motifMutator(
      motif: any[],
      style: StyleName,
      density: number,
      complexity: number,
      isShuffle: boolean
  ): any[] {
      return utilMotifMutator(motif, style, density, complexity, isShuffle, this.random);
  }

  // Phase 2 (#6):realizeProgression 已抽到 engine-utils.ts(组 B PRNG 参数化,515 行)
  // 完整 Stage G voicing pipeline / structural root-anchor / V/X walk-up / Divisi 2.0
  // / extension upgrade / mode-borrowing / sub-V slash sync 保留在 engine-utils.ts.
  private realizeProgression(abstractPath: any[], key: string, style: StyleName, ctx: ResolvedGenerationContext): ChordDef[] {
      return utilRealizeProgression(abstractPath, key, style, ctx, this.random);
  }

  // Phase 1 (#6):getHarmonicFunction 已抽到 engine-utils.ts(组 A 纯函数化)

    generateArrangement(chords: ChordDef[], config: GenerationConfig): MusicTimeline {
        // Re-resolve so this call uses the exact same mode as
        // generateProgressions did. Forking by SEED makes it deterministic.
        const ctx = this.resolveGeneration(config);
        const { style, key: musicKey } = config;
        // density / complexity are pinned to 0.5 — see GenerationConfig.
        // The magnetism + motif-mutator branches gated on these always
        // behave at the "moderate" point.
        const complexity = 0.5;
        const density = 0.5;
        const musicMode = ctx.mode;
        let events: NoteEvent[] = [];
        let visuals: { time: number, label: string }[] = [];
        let beatAcc = 0;
        
        // Rule 10 — Apex Singularity + Golden Ratio. Pre-plan the
        // song's high point: pick an apex bar at golden-ratio position
        // (60-75% of song length) and an apex pitch in the upper end
        // of MELODY_RANGE (high register, ~3 semis below the absolute
        // top). The apex pitch is rooted on the apex bar's chord-tone
        // pc whenever a high-register chord-tone is reachable, otherwise
        // falls back to a generic high note.
        // Forked Random keeps apex deterministic per seed and isolated
        // from the main pipeline's stream.
        const apexRand = new Random(`${config.seed}::apex`);
        const apexFraction = 0.6 + apexRand.next() * 0.15;  // [0.6, 0.75)
        const apexBarIdx = Math.min(chords.length - 1,
            Math.max(0, Math.floor(chords.length * apexFraction)));
        const apexChord = chords[apexBarIdx];
        const apexLiteral = CHORD_TYPES[apexChord.type] || [0, 4, 7];
        const apexRootPc = (((apexChord.rootMidi % 12) + 12) % 12);
        // Try each chord-literal pc in upper octave; pick the highest
        // midi available within (HIGH-3, HIGH-9) — keeps apex within
        // the upper 9 semis of the melody range so it's a clear "high
        // point" but not the absolute ceiling (saves headroom for
        // momentary 16th-note overshoots).
        let apexPitchMidi = -1;
        const upperBound = MELODY_RANGE.HIGH - 3;
        const lowerBound = MELODY_RANGE.HIGH - 9;
        for (let m = upperBound; m >= lowerBound; m--) {
            const candPc = ((m % 12) + 12) % 12;
            for (const iv of apexLiteral) {
                if ((apexRootPc + iv) % 12 === candPc) {
                    apexPitchMidi = m;
                    break;
                }
            }
            if (apexPitchMidi > 0) break;
        }
        // Fallback: pick the highest midi within bounds regardless of
        // chord literal — guarantees apex always lands in the upper
        // ~3-9 semis of MELODY_RANGE.
        if (apexPitchMidi < 0) apexPitchMidi = upperBound;
        // Stash on Engine instance so generateBarPattern's NoteContext
        // builder can read without threading more parameters.
        this.songApexBarIdx = apexBarIdx;
        this.songApexPitchMidi = apexPitchMidi;
        // Compute apex phrase window — the phrase containing apexBarIdx
        // gets the high register baseline. Phrase length tracked via
        // motifInterval (default 4). Apex phrase = floor(apexBarIdx / N)
        // → bars [phrase * N, phrase * N + N - 1] inclusive.
        if (apexBarIdx >= 0) {
            const N = ctx.motifInterval || 4;
            const phraseIdx = Math.floor(apexBarIdx / N);
            this.songApexPhraseStartBar = phraseIdx * N;
            this.songApexPhraseEndBar = Math.min(chords.length - 1, phraseIdx * N + N - 1);
        } else {
            this.songApexPhraseStartBar = -1;
            this.songApexPhraseEndBar = -1;
        }

        // Read scale-gravity strictness from style profile. Per the
        // SCALE_GRAVITY architecture: scale-internal physics (b6→5 in
        // Aeolian, 7→1 in Ionian) is universal, style only controls
        // execution strictness.
        this.songGravityStrictness = STYLE_DICTIONARY[style]?.gravityStrictness ?? 0.5;
        // Cache meter on instance so generateBarPattern's isStrongBeat
        // predicate + motif scaling read from one source.
        this.songMeterContext = ctx.meterContext;
        // Cache tonalCharacter so evaluator calls inside generateBarPattern
        // (anchor scoring + per-emit state update) read the song-level
        // verdict without re-passing ctx through every signature.
        this.songTonalCharacter = ctx.tonalCharacter;

        // K-K profile picked by mode family. modeProgressionTemplate
        // maps Ionian/Lydian/Mixolydian → 'Major' and everything else
        // → 'Minor' (interval-content-based — modes with a b3 fall on
        // Minor side). Tracker uses this to apply the K-K minor probe-
        // tone profile so b3 / b6 / b7 aren't mis-flagged as urgent
        // tensions in minor songs.
        const tensionTracker = new TensionTracker(modeProgressionTemplate(musicMode));
        // melodyState carries the last emitted melody note's pitch
        // AND its end-time across bars. lastNoteEnd starts at -1 so
        // the cross-bar bridge knows there's no preceding event on
        // the song's first bar (and so doesn't try to bridge from
        // negative time).
        // Cross-bar melody state. lastLeapSemis = signed leap from
        // prev-prev → prev (Rule 9 Leap Recovery). sameDirRunLength
        // = count of consecutive same-direction steps ending at the
        // previous emitted note (Rule 11 Anti-Monotonicity). Both
        // updated after each emitted note, fed into the AND pipeline
        // as hard constraints.
        const melodyState: {
            currentMidi: number;
            lastNoteEnd: number;
            lastLeapSemis: number;
            sameDirRunLength: number;
            stepCount: number;
            leapCount: number;
            // SCALE_GRAVITY-driven pending resolve. When the PREVIOUS
            // emitted note matched a fromInterval in the bar's
            // scale-gravity rule, this caches the target interval +
            // score so the NEXT note's score lookup is O(1). Cleared
            // after the pull is consumed by a structural emit or by
            // bar boundary.
            pendingScaleResolveTarget: number | null; // target interval-from-scale-root
            pendingScaleResolveRootPc: number;        // scale root pc
            pendingScaleResolveScore: number;         // rule score 0-30
            // 老师哲学升级: scale-gravity 解决也是过程不是事件.
            // 4 拍窗口期内允许多音/包围回归 (4-2-3 / 4-5-3 / 4-1-3-2-1).
            // accept = stepwise from lineLastMidi OR pc match target.
            pendingScaleLineWindowEnd: number;        // -1 if not armed
            pendingScaleLineLastMidi: number;         // -1 if not armed
            // Color-line pending. Per user哲理: 9/11/13 (and 7) are
            // high-voice color whose physics open a tension window
            // when emitted as structural backbone. Resolution is a
            // PROCESS, not a single event — a stepwise melodic line
            // (any number of notes / passing tones / 16ths / octave
            // displacement) must land on chord 1/3/5 (any octave's
            // pitch class) within the listener's tension-retention
            // window (≤ 4 beats from open). Cleared when the line
            // lands on chord 1/3/5 pc, when the window expires, or
            // when cadence resolution takes over the landing.
            //   startMidi/startPc/startTime: where the color emit
            //     opened the line.
            //   windowEnd: absolute beat time after which tension
            //     dissipates (listener forgets).
            //   lineLastMidi: last emit on the line — used for the
            //     stepwise-continuity test (next emit must be ≤ 2
            //     semis from this OR pc-resolve to chord 1/3/5).
            pendingColorLine: {
                startMidi: number;
                startPc: number;
                startTime: number;
                windowEnd: number;
                lineLastMidi: number;
            } | null;
            // 老师"避讳音解决奖励" 用. 上一 emit 的角色 + midi.
            lastEmitRole: NoteRole;
            lastEmitMidi: number;
            // Unified harmonic assessment of the previous emit, plus
            // the chord it landed on. When the assessment's urgency
            // exceeds the resolution threshold, the next note is
            // forced onto its resolutionTargets. Replaces the prior
            // 7-specific tracking (only caught chord-7 hits) and the
            // pendingResolve ghost (only knew key-relative leading /
            // four). Now ANY unresolved tension — 7-tones, suspended
            // 4ths, altered tensions (b9 / #11 / b13), avoid notes
            // that escaped the structural filter — gets the same
            // unified follow-through.
            lastEmitAssessment: NoteHarmonicAssessment | null;
            lastEmitChord: ChordDef | null;
        } = {
            currentMidi: noteToMidi(musicKey + "5"),
            lastNoteEnd: -1,
            lastLeapSemis: 0,
            sameDirRunLength: 0,
            stepCount: 0,
            leapCount: 0,
            pendingScaleResolveTarget: null,
            pendingScaleResolveRootPc: -1,
            pendingScaleResolveScore: 0,
            pendingScaleLineWindowEnd: -1,
            pendingScaleLineLastMidi: -1,
            pendingColorLine: null,
            // 老师哲学: 跟踪上一 emit 的角色 + midi, 用于
            // avoid-resolution-reward 检测"避讳音 → 半步解决到 chord 音".
            lastEmitRole: 'chord_tone' as NoteRole,
            lastEmitMidi: -1,
            lastEmitAssessment: null,
            lastEmitChord: null,
        };

        // Forked Random for the Aesthetic Anchor scoring. Tiebreak
        // jitter in scoreCandidateAnchor consumes from this stream
        // instead of the main random — prevents Phase 1 changes from
        // shifting downstream decisions (motif placement, cadence
        // randoms, etc.) every time scoring weights are tweaked.
        this.aestheticAnchor = new Random(`${config.seed}::anchor`);

        // === STYLE-BASED CLOSED LOOP CONFIGURATION (风格驱动的闭环配置) ===
        const profile = STYLE_DICTIONARY[style] || STYLE_DICTIONARY['POP'];
        const isShuffle = profile.grooveType === 'swing' || profile.grooveType === 'shuffle' || profile.grooveType === 'dilla';
        
        // 我们锁定风格专属的重音模式和织体池. After the macro merge,
        // primaryTextures is the union of all member sub-styles' texture
        // names, e.g. POP can contain ['Block_Chord', 'Broken_Chord',
        // 'Arpeggio_Flow_Wide', 'Stabs', ...]. We pick ONE texture for
        // the entire song and use it bar-to-bar — mixing two textures
        // (e.g. Block_Chord on bar 0 then Stabs on bar 4) breaks the
        // listener's sense of arrangement consistency, so the engine
        // commits to a single texture per generation.
        const accentMode: 'heavy' | 'syncopated' = (profile.accentMode === 'downbeat' || profile.accentMode === 'fourOnTheFloor') ? 'heavy' : 'syncopated';
        const songTexture = this.random.pick(profile.primaryTextures);
        // =============================================================

        // === Phrase plan: M3e strategy-aware ===
        // Three canonical motifs are generated up front; per-bar logic decides
        // which one (or a derived variant) plays in each chord.
        const motifA = this.generateMelodyPhrase(style);
        const motifB = this.generateMelodyPhrase(style);
        const motifC = this.generateMelodyPhrase(style);
        const emptyMotif: any[] = [];

        const phrasePlan: any[][] = new Array(chords.length);
        // Parallel role array. 'motif' bars are sacred — corrections in
        // generateBarPattern skip them. 'develop' bars are derived and
        // are eligible for tension / voice-leading / backbone fixes.
        // 'rest' bars emit no melody.
        const phraseRole: ('motif' | 'develop' | 'rest')[] = new Array(chords.length);

        // Macro-level pool gate, hoisted so all three strategy branches
        // (BLUES 12-bar / regular head-body-tail / functional) can
        // share the decision. When pool is incomplete, every branch
        // falls back to the legacy motifA/B/C behaviour.
        const useMotifPool = !!profile.motifPool
            && profile.motifPool.starts.length > 0
            && profile.motifPool.flows.length > 0
            && profile.motifPool.ends.length > 0;
        const pool = profile.motifPool;

        // "Motifs as Islands" infrastructure — thematicMemory caches
        // selected motifs per (effectiveFunc, chord type, role) so the
        // same harmonic context replays the same lick most of the time
        // (60% reuse rate via MEMORY_REUSE_PROB), creating hook unity
        // instead of "lick salad". runScales are precomputed so
        // selectBestMotif can score candidates against the chord's
        // actual melodic palette.
        const thematicMemory: Record<string, any[]> = {};
        const memKey = (i: number, role: string) => {
            const c = chords[i];
            const f = c.effectiveFunc ?? getHarmonicFunction(c.roman);
            return `${f}_${c.type}_${role}`;
        };
        const runScales: number[][] = chords.map((c) => {
            const f = c.effectiveFunc ?? getHarmonicFunction(c.roman);
            return getScaleForStyle(style, c, f, musicKey, musicMode);
        });
        // Parallel fill-scale array. Used by Run Generator (in-bar
        // gap fill) and in-bar passing-tone insertion to add style
        // flavor (Bebop / Pentatonic / Mixolydian b6 / Blues hybrid)
        // to non-backbone notes. Backbone path uses runScales[i].
        const fillScales: number[][] = chords.map((c, idx) => {
            const f = c.effectiveFunc ?? getHarmonicFunction(c.roman);
            return getFillScaleForStyle(style, c, f, musicKey, musicMode, runScales[idx]);
        });
        // Backbone targets per bar — pre-compute the "regression points"
        // the melody's structural notes must land on. Used by
        // selectBestMotif (Step 1 of pipeline) and by Color Magnetism
        // to enforce backbone-on-chord-tone (Step 3).
        const modeIvForKey = SCALE_TYPES[(musicMode && musicMode in SCALE_TYPES) ? musicMode : 'Ionian'];
        const keyRootPcGlobal = (((noteToMidi(musicKey + "0") % 12) + 12) % 12);
        // 物理避音法则上下文 (严格版): 仅 RNB / BLUES 风格授权 = modal.
        const isModalEnvGlobal = STYLE_DICTIONARY[style]?.allowFloatingColor === true
            || STYLE_DICTIONARY[style]?.allowBluesHangTone === true;
        const backboneTargets: Set<number>[] = chords.map((c) =>
            computeBackboneTargets(c, keyRootPcGlobal, modeIvForKey, isModalEnvGlobal));

        // Voice leading common-tone sets per bar — pcs of the current
        // chord's voicing that ARE ALSO in the previous (incoming) /
        // next (outgoing) chord's voicing. These are the "smooth
        // connection points" between adjacent harmonies. Used by:
        //   - selectBestMotif: prefer motifs whose first structural
        //     note ∈ voiceLeadingIn and last structural note ∈
        //     voiceLeadingOut
        //   - Color Magnetism: when snapping a structural note off
        //     contract, prefer chord-literal targets that are also
        //     in the relevant VL set (incoming for early-in-bar,
        //     outgoing for late-in-bar)
        const _pcOf = (m: number) => (((m % 12) + 12) % 12);
        const _voicingPcs = (c: ChordDef) => new Set(
            (c.notesMidi ?? c.notes.map(n => noteToMidi(n))).map(_pcOf)
        );
        const voiceLeadingIn: Set<number>[] = chords.map((c, i) => {
            if (i === 0) return new Set();
            const prev = _voicingPcs(chords[i - 1]);
            const curr = _voicingPcs(c);
            const out = new Set<number>();
            for (const pc of curr) if (prev.has(pc)) out.add(pc);
            return out;
        });
        const voiceLeadingOut: Set<number>[] = chords.map((c, i) => {
            if (i === chords.length - 1) return new Set();
            const next = _voicingPcs(chords[i + 1]);
            const curr = _voicingPcs(c);
            const out = new Set<number>();
            for (const pc of curr) if (next.has(pc)) out.add(pc);
            return out;
        });

        // Phrase-parallelism state — track the previous phrase's
        // accumulated structural pcs and the current phrase being
        // built. Phrase length = motifInterval. At every phrase
        // boundary (i % phraseLen === 0 && i > 0), curr → prev,
        // curr resets to empty. selectBestMotif consumes prev to
        // score candidates by Jaccard similarity, peaking at ~50%
        // (排比 / antecedent-consequent parallelism).
        const phraseLen = ctx.motifInterval || 4;
        let prevPhrasePcs: Set<number> = new Set();
        let currPhrasePcs: Set<number> = new Set();
        const advancePhraseIfBoundary = (i: number) => {
            if (i > 0 && i % phraseLen === 0) {
                prevPhrasePcs = currPhrasePcs;
                currPhrasePcs = new Set();
            }
        };
        const accumulateMotifPcs = (motif: any[], chord: ChordDef, runScale: number[]) => {
            if (!motif || motif.length === 0) return;
            const pcs = this.predictMotifStructuralPcs(motif, chord, runScale);
            pcs.forEach(p => currPhrasePcs.add(p));
        };
        // 老师哲学: phrase 末尾"答" = 回归稳定. ends 池 motif 末位
        // 必须落 chord triad (1/3/5). RNB allowFloatingColor 时, chord
        // 类型自带的色彩 (m9 的 9 等) 也算稳定基线.
        // 7 不算"完全稳定" (老师哲学下 7 仍是色彩需要解决) — 不进入
        // strictEnd pool. 但 chord 自带的 maj7/b7 只有 floating 风格 OK.
        const IONIAN_STEPS = [0, 2, 4, 5, 7, 9, 11];
        const isMotifLastNoteStable = (motif: any, chord: ChordDef, allowFloating: boolean): boolean => {
            const notes: any[] = (motif && 'notes' in motif && Array.isArray(motif.notes))
                ? motif.notes
                : (Array.isArray(motif) ? motif : []);
            if (notes.length === 0) return true;
            const last = notes[notes.length - 1];
            let iv: number | null = null;
            if ('chromaticOffset' in last) {
                iv = ((last.chromaticOffset % 12) + 12) % 12;
            } else if ('diatonicStep' in last) {
                const step = ((last.diatonicStep % 7) + 7) % 7;
                iv = IONIAN_STEPS[step];
            }
            if (iv === null) return true;
            // Chord triad 1/3/5 (mode-aware via getChordBackboneIntervals
            // would require an import; use type-derived intervals < 8).
            const intervals = CHORD_TYPES[chord.type] || CHORD_TYPES['maj'];
            const triad = intervals.filter((i: number) => i < 8);
            if (triad.includes(iv)) return true;
            if (allowFloating) {
                const chordTypeIvs = intervals.map((i: number) => i % 12);
                if (chordTypeIvs.includes(iv)) return true;
            }
            return false;
        };
        // Bound helper: advances phrase state at boundary, calls
        // selectBestMotif with all 9 params (incl. prevPhrasePcs),
        // then accumulates the picked motif's structural pcs into
        // currPhrasePcs. All bar-loop call sites use this so the
        // parallelism state stays correctly maintained across
        // the three strategy paths (BLUES, regular, functional).
        // strictEnd=true: filter pool to motifs whose last note is
        // stable (chord triad pc); used at phrase-end positions per
        // 老师哲学"答 = 回归稳定". Falls back to full pool if filter
        // empties out (degenerate chord types where no motif end fits).
        // Pair tracking — when a motif with pairId is picked, the next
        // bar prefers a partner (same pairName, different role). Bridges
        // designed pairs like Rocket+Feather across bars without
        // requiring a global pair-aware selector.
        let lastPickedPairId: string | null = null;
        const TURNAROUND_KEYWORDS = /turnaround|回转/i;
        const pickMotif = (pool: (any[] | { notes: any[]; rules?: any })[], i: number, role: string, strictEnd: boolean = false, preferTurnaround: boolean = false): any[] => {
            advancePhraseIfBoundary(i);

            // Pre-pick: turnaround section (BLUES bar 11) — prefer
            // motifs whose description names them as turnaround licks.
            // Bypasses selectBestMotif for these markers since the
            // section's identity is the priority over conflict scoring.
            if (preferTurnaround) {
                const turnaroundCandidates = pool.filter(item => {
                    if (Array.isArray(item)) return false;
                    const desc = (item as any).description;
                    return typeof desc === 'string' && TURNAROUND_KEYWORDS.test(desc);
                });
                if (turnaroundCandidates.length > 0) {
                    const chosen = this.random.pick(turnaroundCandidates) as { notes: any[]; rules?: any };
                    accumulateMotifPcs(chosen.notes, chords[i], runScales[i]);
                    lastPickedPairId = (chosen.rules && typeof chosen.rules.pairId === 'string') ? chosen.rules.pairId : null;
                    return chosen.notes;
                }
            }

            // Pre-pick: if previous bar's motif had pairId, look for
            // partner (same pair name, different role) in current pool.
            if (lastPickedPairId) {
                const colon = lastPickedPairId.indexOf(':');
                const pairName = colon > 0 ? lastPickedPairId.slice(0, colon) : '';
                const prevRole = colon > 0 ? lastPickedPairId.slice(colon + 1) : '';
                if (pairName) {
                    const partner = pool.find(item => {
                        if (Array.isArray(item)) return false;
                        const rules = (item as any).rules;
                        const pid = rules?.pairId;
                        if (typeof pid !== 'string') return false;
                        const c2 = pid.indexOf(':');
                        if (c2 <= 0) return false;
                        return pid.slice(0, c2) === pairName && pid.slice(c2 + 1) !== prevRole;
                    });
                    if (partner && !Array.isArray(partner)) {
                        const notes = (partner as any).notes;
                        accumulateMotifPcs(notes, chords[i], runScales[i]);
                        lastPickedPairId = (partner as any).rules.pairId;
                        return notes;
                    }
                }
                // No partner found — drop pair tracking.
                lastPickedPairId = null;
            }

            let usePool = pool;
            if (strictEnd) {
                const allowFloating = STYLE_DICTIONARY[style]?.allowFloatingColor === true;
                const filtered = pool.filter(m => isMotifLastNoteStable(m, chords[i], allowFloating));
                if (filtered.length > 0) usePool = filtered;
            }
            // 老师哲学: 长音概率分配按音乐性. Phrase 中段 (starts /
            // flows) 偏好末位短的 motif (≤ 1.0 拍), 让中段流动. Phrase
            // 末位 (ends) 不过滤 — cadence 长 hold 自然 OK. Song 末位
            // (last bar of song) 也走 ends 路径自然保留长音.
            // 联网研究: cadence 末位常 hold ≥ 2 拍; phrase 中段 attack
            // 密度增加, 长 hold 是 phrase end / song end 标志.
            if (role !== 'ends') {
                const flowFiltered = usePool.filter(m => {
                    const notes: any[] = ('notes' in (m as any) && Array.isArray((m as any).notes))
                        ? (m as any).notes
                        : (Array.isArray(m) ? m : []);
                    if (notes.length === 0) return true;
                    const last = notes[notes.length - 1];
                    return last && typeof last.d === 'number' && last.d <= 1.0;
                });
                if (flowFiltered.length > 0) usePool = flowFiltered;
            }
            const m = this.selectBestMotif(
                usePool, chords[i], runScales[i], memKey(i, role),
                thematicMemory, backboneTargets[i],
                voiceLeadingIn[i], voiceLeadingOut[i],
                prevPhrasePcs.size > 0 ? prevPhrasePcs : null,
            );
            accumulateMotifPcs(m, chords[i], runScales[i]);

            // Post-pick: detect if returned motif has pairId by matching
            // its notes reference against pool wrappers. selectBestMotif
            // returns the wrapper's `notes` array directly so === holds.
            const sourceWrapper = pool.find(item => {
                if (Array.isArray(item)) return item === m;
                return (item as any).notes === m;
            });
            if (sourceWrapper && !Array.isArray(sourceWrapper)) {
                const rules = (sourceWrapper as any).rules;
                lastPickedPairId = (rules && typeof rules.pairId === 'string') ? rules.pairId : null;
            } else {
                lastPickedPairId = null;
            }
            return m;
        };

        if (style === 'BLUES' && chords.length >= 12) {
            // Standard 12-bar blues structure (AAB + turnaround). The
            // genre dictates its own layout, but the bar-role pulls
            // come from MACRO_MOTIF_POOLS.BLUES — same head-body-tail
            // assembly as other macros, just laid out across the AAB
            // form's three 4-bar phrases:
            //
            //   Phrase A1 (0-3): start, flow, breath/flow-dev, breath/end
            //   Phrase A2 (4-7): start, flow, breath/flow-dev, breath/end
            //   Phrase B  (8-11): start, flow, flow-dev, turnaround/end
            //
            // The "breath" bars (2, 3, 6, 7, 11) preserve the blues
            // singer's pause-for-breath aesthetic via probabilistic
            // rest. Rest probabilities mirror the prior layout (60%
            // for bars 2/3/6/7, 70% for bar 11). useMotifPool / pool
            // hoisted to the strategy switch's outer scope.
            for (let i = 0; i < chords.length; i++) {
                const barIn12 = i % 12;
                if (barIn12 === 0 || barIn12 === 4) {
                    // A-phrase head
                    phrasePlan[i] = (useMotifPool && pool)
                        ? pickMotif(pool.starts, i, 'starts')
                        : motifA;
                    phraseRole[i] = 'motif';
                } else if (barIn12 === 1 || barIn12 === 5) {
                    // A-phrase body
                    phrasePlan[i] = (useMotifPool && pool)
                        ? pickMotif(pool.flows, i, 'flows')
                        : motifA;
                    phraseRole[i] = 'motif';
                } else if (barIn12 === 2 || barIn12 === 6) {
                    // breath bar — 60% rest / 40% flows-develop
                    if (this.random.next() > 0.4) { phrasePlan[i] = emptyMotif; phraseRole[i] = 'rest'; }
                    else {
                        phrasePlan[i] = (useMotifPool && pool)
                            ? pickMotif(pool.flows, i, 'flows')
                            : motifC;
                        phraseRole[i] = 'develop';
                    }
                } else if (barIn12 === 3 || barIn12 === 7) {
                    // A-phrase tail — 60% rest / 40% ends (motif role
                    // so cadence yield can fire)
                    if (this.random.next() > 0.4) { phrasePlan[i] = emptyMotif; phraseRole[i] = 'rest'; }
                    else {
                        phrasePlan[i] = (useMotifPool && pool)
                            ? pickMotif(pool.ends, i, 'ends', true)
                            : motifC;
                        phraseRole[i] = 'motif';
                    }
                } else if (barIn12 === 8) {
                    // B-phrase head
                    phrasePlan[i] = (useMotifPool && pool)
                        ? pickMotif(pool.starts, i, 'starts')
                        : motifB;
                    phraseRole[i] = 'motif';
                } else if (barIn12 === 9) {
                    // B-phrase body
                    phrasePlan[i] = (useMotifPool && pool)
                        ? pickMotif(pool.flows, i, 'flows')
                        : motifB;
                    phraseRole[i] = 'motif';
                } else if (barIn12 === 10) {
                    // B-phrase develop — turnaround approach. 老师 D
                    // 选项: bar 9-12 是 turnaround section. bar 10 选
                    // 一条 ends 池 turnaround motif 作铺垫(approach).
                    phrasePlan[i] = (useMotifPool && pool)
                        ? pickMotif(pool.ends, i, 'ends', true, true)
                        : motifC;
                    phraseRole[i] = 'develop';
                } else {
                    // bar 11 — turnaround section landing. 100% 强制 ends
                    // turnaround motif (废弃旧的 70% rest fallback —
                    // turnaround 是 12-bar form 的标志位置, 必须出现).
                    // Drain 1 random.next() to keep stream symmetric with
                    // legacy seed snapshots even though turnaround is
                    // unconditional now.
                    this.random.next();
                    phrasePlan[i] = (useMotifPool && pool)
                        ? pickMotif(pool.ends, i, 'ends', true, true)
                        : motifA;
                    phraseRole[i] = 'motif';
                }
            }
        } else if (useMotifPool && pool && ctx.motifStrategy === 'regular') {
            // Head-Body-Tail (起承合) phrase layout. Each chunk of N bars
            // assembles a phrase from role-classified motif pools so the
            // bar-by-bar shape reflects real-world phrase architecture:
            //   bar 0          → starts (anacrusis / Bebop enclosure)
            //   bar 1..N-3     → flows  (continuous running material)
            //   bar N-2        → flows OR derive(starts) (develop)
            //   bar N-1        → ends   (cadential resolution)
            //
            // Each bar fresh-picks from its role pool — coherence comes
            // from the data design (all flows are stylistically related)
            // rather than reusing one canonical motif. Develop bar's
            // 50/50 fork between fresh flow and derived-start gives
            // either continuation or a head-callback feeling.
            const N = chords.length < ctx.motifInterval
                ? Math.max(1, chords.length)
                : ctx.motifInterval;
            for (let i = 0; i < chords.length; i++) {
                const idxInChunk = i % N;
                if (idxInChunk === 0) {
                    phrasePlan[i] = pickMotif(pool.starts, i, 'starts');
                    phraseRole[i] = 'motif';
                } else if (idxInChunk === N - 1 && N >= 2) {
                    phrasePlan[i] = pickMotif(pool.ends, i, 'ends', true);
                    phraseRole[i] = 'motif';
                } else if (idxInChunk === N - 2 && N >= 3) {
                    if (this.random.next() < 0.5) {
                        phrasePlan[i] = pickMotif(pool.flows, i, 'flows');
                    } else {
                        phrasePlan[i] = this.deriveDevelopmentMotif(pickMotif(pool.starts, i, 'starts'));
                    }
                    phraseRole[i] = 'develop';
                } else {
                    phrasePlan[i] = pickMotif(pool.flows, i, 'flows');
                    phraseRole[i] = 'motif';
                }
            }
        } else if (ctx.motifStrategy === 'functional') {
            // Strategy B — recurrence by harmonic function, layered on
            // top of head-body-tail phrase shape.
            //
            // The previous implementation used motifA/B/C from the flat
            // legacy pool, completely bypassing motifPool. With the
            // categorized pools in place, we can preserve the functional
            // recurrence intent (T/S/D positions accumulate distinct
            // shapes across the song) AND respect phrase boundaries
            // (each N-bar chunk has start, body, body, end).
            //
            // Phrase-position rules:
            //   isPhraseStart (bar 0 of chunk) → starts
            //   isPhraseEnd   (last bar of chunk OR song) → ends
            //   middle bars   → flows for the first 2 occurrences of
            //                   each TSD function; afterward develop
            //                   variant of starts (callback feel)
            //
            // The funcCount gate keeps the "first 2 occurrences play
            // verbatim, then develop" recurrence behavior the legacy
            // implementation had — but now that recurrence operates
            // over the FLOWS pool instead of one fixed motif.
            const funcCount: Record<'T'|'S'|'D', number> = { T: 0, S: 0, D: 0 };
            const N = ctx.motifInterval;
            for (let i = 0; i < chords.length; i++) {
                const f = getHarmonicFunction(chords[i].roman);
                funcCount[f]++;
                const isPhraseStart = i % N === 0;
                const isPhraseEnd = (i + 1) % N === 0 || i === chords.length - 1;

                if (useMotifPool && pool) {
                    if (isPhraseStart) {
                        phrasePlan[i] = pickMotif(pool.starts, i, 'starts');
                        phraseRole[i] = 'motif';
                    } else if (isPhraseEnd) {
                        phrasePlan[i] = pickMotif(pool.ends, i, 'ends', true);
                        phraseRole[i] = 'motif';
                    } else if (funcCount[f] <= 2 || this.random.next() < 0.5) {
                        phrasePlan[i] = pickMotif(pool.flows, i, 'flows');
                        phraseRole[i] = 'motif';
                    } else {
                        phrasePlan[i] = this.deriveDevelopmentMotif(pickMotif(pool.starts, i, 'starts'));
                        phraseRole[i] = 'develop';
                    }
                } else {
                    // Legacy fallback (no motifPool — Max Martin Pop /
                    // Modern Trap territory). Same behaviour as before.
                    const funcMotifMap: Record<'T'|'S'|'D', any[]> = { T: motifA, S: motifB, D: motifC };
                    if (funcCount[f] <= 2) {
                        phrasePlan[i] = funcMotifMap[f];
                        phraseRole[i] = 'motif';
                    } else {
                        phrasePlan[i] = this.deriveDevelopmentMotif(funcMotifMap[f]);
                        phraseRole[i] = 'develop';
                    }
                }
            }
        } else {
            // Strategy A — recurrence every N bars. P2 short-song fallback:
            // when bars < N we only have room for one motif statement at the
            // very start; everything else is development.
            const N = chords.length < ctx.motifInterval
                ? Math.max(1, chords.length)
                : ctx.motifInterval;
            for (let i = 0; i < chords.length; i++) {
                const cycleIdx = Math.floor(i / N);
                const barInCycle = i % N;
                const currentMotif = (cycleIdx % 2 === 0) ? motifA : motifB;

                if (barInCycle === 0) {
                    phrasePlan[i] = currentMotif;
                    phraseRole[i] = 'motif';
                } else if (barInCycle === N - 1 && N >= 3) {
                    // Cycle-end response: chance of rest, otherwise motifC fill.
                    if (this.random.next() > 0.5) {
                        phrasePlan[i] = emptyMotif;
                        phraseRole[i] = 'rest';
                    } else {
                        phrasePlan[i] = motifC;
                        phraseRole[i] = 'develop';
                    }
                } else {
                    phrasePlan[i] = this.deriveDevelopmentMotif(currentMotif);
                    phraseRole[i] = 'develop';
                }
            }
        }

        // Fallback-mode per-bar randomisation. When sub-style motifs
        // are empty AND the macro pool is empty, the strategy switch
        // above produced phrasePlan from motifA/B/C (3 generated
        // random motifs replayed across the song). Replaying 3 motifs
        // for 16 bars cascades into PC clusters when the same motif
        // step keeps projecting to the same chord-tone across multiple
        // bars on the same chord (e.g. Em7 ×4 in the progression →
        // motif's "5th" step lands on B four times). Override here so
        // every non-rest bar gets a FRESH random scaffold — listener
        // hears a new shape every bar even though the underlying
        // generator is just evaluator-driven random walk.
        const fallbackMode = (STYLE_DICTIONARY[style]?.motifs?.length ?? 0) === 0
                          && !useMotifPool;
        if (fallbackMode) {
            for (let i = 0; i < chords.length; i++) {
                if (phraseRole[i] === 'rest') continue;
                phrasePlan[i] = this.generateMelodyPhrase(style);
            }
        }

        // Per-bar cadence-resolution flags + phrase role (Phase 5 —
        // 和声驱动 phrase 检测). detectPhrases 扫 chord 进行的 strong
        // cadence (D→strong T) 切 phrase 边界,classifyPhrase 识别
        // Period (antecedent open + consequent closed)。
        //
        // phraseShouldReturn[i] 现在由 phraseRoleByBar[i] !== 'mid_phrase'
        // 决定 — 即 phrase 边界处 (含 antecedent 末尾 / consequent
        // 末尾 / through-composed phrase 末尾 / 整曲末尾) 都 fire cadence。
        // 替代了旧的 "每 motifInterval bar 硬切" 逻辑。
        //
        // style.returnRule.enabled = false 仍是总开关 (ambient 风格)。
        // probabilityPerPhrase 对非终止性 phrase-end 随机 gate。
        // Sacred motif 仍不豁免 — Definition 4 在 cadence 位 yield sacred。
        const phraseSegments: PhraseSegment[] = detectPhrases(chords);
        const phraseRoleByBar: PhraseRole[] = new Array(chords.length).fill('mid_phrase');
        for (const seg of phraseSegments) {
            if (seg.type === 'Period') {
                if (seg.antecedentEndBar !== undefined) {
                    phraseRoleByBar[seg.antecedentEndBar] = 'antecedent_end';
                }
                phraseRoleByBar[seg.endBar] = 'consequent_end';
            } else {
                phraseRoleByBar[seg.endBar] = 'phrase_end_through';
            }
        }
        // 整曲末尾压在 song_end 上 (覆盖前面可能赋的 consequent_end /
        // phrase_end_through)。Tier A 由 song_end + func='T' 触发。
        if (chords.length > 0) {
            phraseRoleByBar[chords.length - 1] = 'song_end';
        }

        const phraseShouldReturn: boolean[] = new Array(chords.length).fill(false);
        const returnRule = profile.returnRule;
        if (returnRule?.enabled !== false) {
            const phraseProb = returnRule?.probabilityPerPhrase ?? 1;
            for (let i = 0; i < chords.length; i++) {
                if (phraseRole[i] === 'rest') continue;
                const role = phraseRoleByBar[i];
                if (role === 'mid_phrase') continue;
                // 整曲末尾必 fire (Tier A);其他 phrase-end 按概率门。
                const fire = role === 'song_end' ? true : (this.random.next() < phraseProb);
                phraseShouldReturn[i] = fire;
            }
        }

        chords.forEach((chord, i) => {
            const currentPhrase = phrasePlan[i];
            const currentRole = phraseRole[i];
            const currentShouldReturn = phraseShouldReturn[i];

            // 决定当前小节使用的织体（50%概率切换到副织体，模拟对比段落）
            const activeTexture = songTexture;

            visuals.push({
                time: beatAcc,
                label: `${chord.root}${chord.type} (${chord.roman})`
            });

            // Divisi 2.0 — TSD function override. evaluateTensionState
            // rewrites the function when the actual sounding chord
            // doesn't match the roman label (suspended dominant F/G
            // reads as D regardless of roman, pedal-on-key reads as T,
            // 6/4 second-inversion reads as D). Cadence Resolution
            // and other downstream func-aware logic must see the
            // effective function, not the roman-derived one.
            const func = chord.effectiveFunc ?? getHarmonicFunction(chord.roman);
            const isLast = i === chords.length - 1;
            const nextChord = isLast ? null : chords[i + 1];

            const prevChord = i > 0 ? chords[i - 1] : null;
            const { patternEvents, bridgeVisual } = this.generateBarPattern(
                chord, nextChord, style, beatAcc, currentPhrase, func, isLast, musicKey, musicMode, tensionTracker, melodyState,
                activeTexture, isShuffle, accentMode, i, chords.length, density, complexity, currentRole,
                currentShouldReturn, ctx.motifInterval, fillScales[i], backboneTargets[i], prevChord,
                phraseRoleByBar[i],
            );
            events.push(...patternEvents);
            if (bridgeVisual) {
                visuals.push(bridgeVisual);
            }
            beatAcc += chord.duration;
        });

        events = events.filter(e => {
            if (!Number.isFinite(e.noteNumber) || isNaN(e.noteNumber) || !Number.isFinite(e.duration) || e.duration <= 0) {
                 console.warn("Filtered out invalid note event generated by engine:", e);
                 return false;
            }
            return true;
        });

        // Bass AND chord both always retained. Dropping either layer
        // produces audibly broken arrangements:
        //   - drop bass → slash chords / inversions / Divisi state lose
        //     their harmonic anchor (audit case: BLUES_001/RNB_001/
        //     JAZZ_002 prior to this had bass=0)
        //   - drop chord → harmonic identity vanishes, listener hears
        //     "melody + lone bass note" (audit case: POP_gc1z2g + JAZZ_002
        //     prior to this had chord=0)
        // For sparse-arrangement variation, do it at the velocity / density
        // level (lower chord velocities), not by dropping the whole layer.
        const chordLayerDropped = false;

        // Bass-only compensation. When the chord layer was dropped,
        // the listener has only the bass (root pc) plus the melody —
        // the chord's 3rd / 5th / 7th identity is otherwise unheard.
        // Inject melody enrichment so the chord color is reconstructed
        // through the melody:
        //   1. Long melody notes (>= 1.0 beat) on backbone positions
        //      get a SECOND simultaneous chord-tone in a nearby octave
        //      (50% chance per qualifying note).
        //   2. Wide gaps between melody events (>= 1.0 beat) get a
        //      chord-tone passing note inserted at the gap's mid-point.
        //
        // The compensation is deterministic (forked Random
        // `seed::bassOnlyComp`) and only fires when chordLayerDropped.
        // Original melody notes are not modified — only NEW notes are
        // added alongside.
        if (chordLayerDropped) {
            const compFork = new Random(`${config.seed}::bassOnlyComp`);
            const compInserts: NoteEvent[] = [];
            const melSorted = events
                .filter(e => e.part === 'melody')
                .sort((a, b) => a.time - b.time);

            // Pre-compute per-bar chord lookup
            const chordAt = (t: number): ChordDef => {
                const ci = Math.min(Math.floor(t / 4), chords.length - 1);
                return chords[Math.max(0, ci)];
            };

            // 1. Double-stops on long held melody notes
            for (const e of melSorted) {
                if (e.duration < 1.0) continue;
                if (compFork.next() > 0.5) continue;
                const c = chordAt(e.time);
                const intervals = CHORD_TYPES[c.type] || [0, 4, 7];
                const rootPc = (((c.rootMidi % 12) + 12) % 12);
                const melPc = (((e.noteNumber % 12) + 12) % 12);
                // Pick a chord tone that's NOT the same pitch class as
                // the melody. Prefer the chord 3rd or 5th (defining
                // tones); otherwise 7th.
                const chordPcs = intervals
                    .map(iv => (rootPc + iv) % 12)
                    .filter(pc => pc !== melPc);
                if (chordPcs.length === 0) continue;
                // Prefer 3rd if available
                const preferredIv = intervals.find(iv => iv === 3 || iv === 4);
                const targetPc = preferredIv !== undefined
                    ? (rootPc + preferredIv) % 12
                    : chordPcs[Math.floor(compFork.next() * chordPcs.length)];
                if (targetPc === melPc) continue;
                // Place the double-stop a 3rd-or-6th below the melody
                // (whichever lands on targetPc within MELODY_RANGE).
                let candidateMidi = e.noteNumber;
                let bestDist = Infinity;
                for (let octShift = -2; octShift <= 0; octShift++) {
                    const baseOct = Math.floor(e.noteNumber / 12) + octShift;
                    const cand = baseOct * 12 + targetPc;
                    if (cand >= MELODY_RANGE.LOW && cand < e.noteNumber) {
                        const d = e.noteNumber - cand;
                        if (d < bestDist) { bestDist = d; candidateMidi = cand; }
                    }
                }
                if (candidateMidi !== e.noteNumber && candidateMidi >= MELODY_RANGE.LOW) {
                    compInserts.push({
                        noteNumber: candidateMidi,
                        time: e.time,
                        duration: e.duration,
                        velocity: Math.max(60, Math.round(e.velocity * 0.85)),
                        part: 'melody',
                        origin: 'develop',
                    });
                }
            }

            // 2. Chord-tone passing notes in melody gaps
            for (let k = 1; k < melSorted.length; k++) {
                const prev = melSorted[k - 1];
                const curr = melSorted[k];
                const gap = curr.time - (prev.time + prev.duration);
                if (gap < 1.0) continue;
                if (compFork.next() > 0.5) continue;
                const c = chordAt(prev.time + prev.duration + gap / 2);
                const intervals = CHORD_TYPES[c.type] || [0, 4, 7];
                const rootPc = (((c.rootMidi % 12) + 12) % 12);
                // Pick a chord tone (prefer 3rd or 5th) closest to prev pitch
                const candidatePcs = intervals.map(iv => (rootPc + iv) % 12);
                let bestMidi = prev.noteNumber;
                let bestDist = Infinity;
                for (const pc of candidatePcs) {
                    for (let oct = -1; oct <= 1; oct++) {
                        const baseOct = Math.floor(prev.noteNumber / 12) + oct;
                        const cand = baseOct * 12 + pc;
                        if (cand < MELODY_RANGE.LOW || cand > MELODY_RANGE.HIGH) continue;
                        const d = Math.abs(cand - prev.noteNumber);
                        if (d < bestDist && d > 0) { bestDist = d; bestMidi = cand; }
                    }
                }
                if (bestDist === Infinity) continue;
                const passTime = prev.time + prev.duration + 0.25;
                const passDur = Math.min(0.5, gap - 0.25);
                if (passDur >= 0.25) {
                    compInserts.push({
                        noteNumber: bestMidi,
                        time: passTime,
                        duration: passDur,
                        velocity: 80,
                        part: 'melody',
                        origin: 'develop',
                    });
                }
            }

            events.push(...compInserts);
        }

        // Final dedupe — collapse any (time, midi, part) collisions to
        // a single event. Sources of accidental collision: BLUES motif
        // double-stops where two different chromaticOffsets happen to
        // project to the same MIDI on a particular chord/anchor; Active
        // Divisi pulling two long notes to the same vacated extension;
        // texture's [bMLow, bM] collapsing when bMLow falls back to bM.
        // Hearing the same pitch twice at the same instant is zero-info,
        // and the doubled sample re-trigger produces a phase glitch on
        // attack. Time is rounded to 4 decimals so 0.999999 ≈ 1.0
        // floating-point fuzz doesn't survive as a separate key.
        const dedupSeen = new Set<string>();
        events = events.filter(e => {
            const k = `${e.time.toFixed(4)}|${e.noteNumber}|${e.part}`;
            if (dedupSeen.has(k)) return false;
            dedupSeen.add(k);
            return true;
        });

        // Single-voice melody enforcement. The dedupe pass above only
        // collapses EXACT (time, midi, part) duplicates; two melody
        // events at the same time with DIFFERENT pitches both survive,
        // producing an unintended two-voice melody (the listener hears
        // a chord on the melody line). Melody is contractually a
        // single-voice line — at any instant the line plays one pitch.
        //
        // When multiple melody events collide at the same beat, pick
        // one by priority:
        //   1. origin: motif > return > develop (sacred boundary
        //      wins — the motif's pitch is the engine's primary
        //      intent; return is the cadence rewrite; develop is
        //      mutated material and is the most replaceable).
        //   2. velocity (higher wins — louder note is the one the
        //      writer wanted on top).
        //   3. higher MIDI (deterministic tiebreak).
        const ORIGIN_PRIORITY: Record<string, number> = {
            motif: 3,
            return: 2,
            develop: 1,
        };
        const scoreEvent = (e: NoteEvent): number =>
            (ORIGIN_PRIORITY[e.origin ?? ''] ?? 0) * 1e6
            + e.velocity * 1000 + e.noteNumber;
        // Two-pass: first, find which melody event wins per (time) slot;
        // second, filter the array in place to preserve original order.
        // Filtering in place keeps non-melody events untouched and
        // melody-survivor relative order stable — the snapshot's event
        // ordering remains byte-equal when no actual collision occurs.
        const melodyWinner = new Map<string, NoteEvent>();
        for (const e of events) {
            if (e.part !== 'melody') continue;
            const k = e.time.toFixed(4);
            const cur = melodyWinner.get(k);
            if (!cur || scoreEvent(e) > scoreEvent(cur)) melodyWinner.set(k, e);
        }
        events = events.filter(e => {
            if (e.part !== 'melody') return true;
            const k = e.time.toFixed(4);
            return melodyWinner.get(k) === e;
        });

        // Strict-grid quantization for non-shuffle styles. Per user:
        // POP must be on grid; JAZZ/RNB/BLUES allowed off-grid for
        // swing / lay-back groove. profile.grooveType === 'straight'
        // is the gate. Cross-bar bridge / Run Generator inserts can
        // produce 0.125 / 0.375 / 0.625 fractional onsets when slot
        // arithmetic doesn't land on 16th boundaries — those snap to
        // nearest 0.25-multiple here. Melody-only snap; bass / chord
        // textures already grid-aligned via applyTexture.
        //
        // **Skip grace notes** (duration < 0.1 beat, develop origin):
        // grace notes are intentional sub-grid 50ms flam attacks before
        // the main note. Snapping them to grid collapses them onto the
        // main note's onset (= same-time double event), reducing them
        // to "noise" rather than "ornament". Detection: develop origin
        // + d < 0.1 — 老师诊断"塞 32 分位置导致切断"的真凶.
        const profileForGrid = STYLE_DICTIONARY[style];
        if (profileForGrid?.grooveType === 'straight') {
            events = events.map(e => {
                if (e.part !== 'melody') return e;
                if (e.origin === 'develop' && e.duration < 0.1) return e; // grace note pass-through
                const snappedTime = Math.round(e.time * 4) / 4;
                if (Math.abs(snappedTime - e.time) < 0.001) return e;
                return { ...e, time: snappedTime };
            });
            // Re-dedup (snapping can create new collisions on the grid)
            const gridSeen = new Set<string>();
            events = events.filter(e => {
                const k = `${e.time.toFixed(4)}|${e.noteNumber}|${e.part}`;
                if (gridSeen.has(k)) return false;
                gridSeen.add(k);
                return true;
            });
            // Re-run single-voice melody enforcement after snap. Two
            // melody events with different pitches but onset times like
            // 0.245 and 0.255 both snap to 0.25 — the (time, midi, part)
            // dedup above keeps both because they differ in noteNumber,
            // producing an unintended 2-voice melody at the snapped
            // grid point. Pick the higher-priority survivor by the same
            // rule used before quantization.
            const gridMelodyWinner = new Map<string, NoteEvent>();
            for (const e of events) {
                if (e.part !== 'melody') continue;
                const k = e.time.toFixed(4);
                const cur = gridMelodyWinner.get(k);
                if (!cur || scoreEvent(e) > scoreEvent(cur)) gridMelodyWinner.set(k, e);
            }
            events = events.filter(e => {
                if (e.part !== 'melody') return true;
                const k = e.time.toFixed(4);
                return gridMelodyWinner.get(k) === e;
            });
        }

        return {
            events, visuals,
            unresolvedTensions: tensionTracker.unresolved.length,
            phraseSegments,
            phraseRoleByBar,
            meterContext: this.songMeterContext,
        };
    }

  // Phase 2 (#6):generateMelodyPhrase 已抽到 engine-utils.ts(组 B PRNG 参数化)
  // 原 method 内含详尽设计注释(rhythm scaffold + random walk + reflection),
  // 完整保留在 engine-utils.ts 内同名函数;此处仅 stub forward。
  private generateMelodyPhrase(style: StyleName): any[] {
      return utilGenerateMelodyPhrase(style, this.random);
  }

  /**
   * Estimate how many of a motif's notes would project onto AVOID
   * intervals for the active chord, returned as a 0..1 ratio.
   *
   * Now takes the chord's actual runScale instead of using a static
   * Ionian proxy. The previous Ionian approximation was inaccurate
   * for chord types whose scale is Dorian / Mixolydian / Altered etc.
   * — a motif might appear "safe" against Ionian but heavily clash
   * against the chord's true scale.
   *
   * For diatonic-step motifs the projection assumes anchor=root (a
   * conservative worst-case — Phase 1 anchor scoring typically lands
   * the anchor near the chord root). For chromatic-offset motifs the
   * pitch class is `(chordRoot + offset) mod 12`.
   *
   * Read by generateBarPattern's motif-conflict-escape gate to decide
   * whether to demote a 'motif' bar to 'develop'.
   */
  /**
   * Backbone target pcs for a chord — the "regression points" the
   * melody's structural notes should land on.
   *
   * Definition (per user direction):
   *   1. Chord literal pcs (1, 3, 5, 7 — the chord's characteristic tones)
   *   2. Intersected with the song's key palette (no chromatic borrowing
   *      on backbone — V/X chord's chromatic alterations like C# in
   *      C major are EXCLUDED from backbone targets even though they
   *      appear in the chord voicing)
   *   3. Add key root pc if missing (so non-tonic chords still have
   *      a "key home" the melody can regress to)
   *
   * Edge case: if the intersection is empty (rare — happens when
   * chord pcs are entirely chromatic to the key, only sub-V style
   * substitutions), fall back to chord literal pcs.
   */
  // Phase 1 (#6):computeBackboneTargets 已抽到 engine-utils.ts(组 A 纯函数化)

  /**
   * Score a motif's structural-position alignment with backbone targets.
   * Returns the fraction of structural notes that project onto a
   * backbone-target pitch class. 1.0 = all structural notes land on
   * chord literal / key root; 0.0 = none do.
   *
   * Uses the same chord-root projection semantics as the per-note
   * loop — diatonicStep through runScale rooted at chord root,
   * chromaticOffset as semitones from chord root.
   */
  // Phase 1 (#6):estimateBackboneAlignment 已抽到 engine-utils.ts(组 A 纯函数化)

  private estimateMotifConflictRatio(motif: any[], chord: ChordDef, runScale: number[], func: string = 'T', isModalContext: boolean = false, scaleName?: string): number {
      if (motif.length === 0) return 0;
      const chordRootPc = (((chord.rootMidi % 12) + 12) % 12);
      // Build the scale's pitch-class set from runScale, then sort
      // for deterministic step indexing. Default to Ionian if runScale
      // is empty (defensive).
      const scalePcsSet = new Set<number>();
      runScale.forEach(m => scalePcsSet.add((((m % 12) + 12) % 12)));
      let scalePcs = Array.from(scalePcsSet).sort((a, b) => a - b);
      if (scalePcs.length === 0) {
          scalePcs = SCALE_TYPES['Ionian'].map(iv => (chordRootPc + iv) % 12).sort((a, b) => a - b);
      }
      // Re-anchor scalePcs so step 0 lands on the chord root pc.
      const rootIdx = scalePcs.indexOf(chordRootPc);
      const rotated = rootIdx >= 0
          ? [...scalePcs.slice(rootIdx), ...scalePcs.slice(0, rootIdx)]
          : scalePcs;
      const N = rotated.length;

      let conflicts = 0;
      const isDominant = chord.effectiveFunc === 'D'
          || getHarmonicFunction(chord.roman) === 'D';
      // Pre-compute per-note ivFromChord so we can detect motion patterns.
      const ivs: number[] = [];
      for (const note of motif) {
          let pc: number;
          if ('chromaticOffset' in note) {
              pc = (((chordRootPc + note.chromaticOffset) % 12) + 12) % 12;
          } else {
              const step = note.diatonicStep;
              const wrappedStep = ((step % N) + N) % N;
              pc = rotated[wrappedStep];
          }
          const intvFromChordRoot = (((pc - chordRootPc) % 12) + 12) % 12;
          ivs.push(intvFromChordRoot);
          if (isAvoidNote(intvFromChordRoot, chord.type, scaleName, isModalContext, func)) conflicts++;
      }
      // 老师规则 1: D 函数上禁止 3→4 上行半音 (false-resolve).
      // chord 3 (= ivFromChord 4 半音) → chord 11/4 (= ivFromChord 5 半音)
      // 是导音→主音的强烈听感解决, 但 harmony 还在 V 上, 撕裂感. 在 D
      // 函数 chord 上每检出一对此 motion, 计 4 次 conflict (motif 长度
      // 内出现一次足以排除该 motif 候选).
      if (isDominant) {
          for (let i = 0; i < ivs.length - 1; i++) {
              if (ivs[i] === 4 && ivs[i + 1] === 5) conflicts += 4;
          }
      }
      return Math.min(1, conflicts / motif.length);
  }

  /**
   * Derive a development variant of a canonical motif using musician-
   * style transformations (倒影 / 晚拍进入 / 截短留白) instead of raw
   * pitch arithmetic.
   *
   * The previous implementation included a `chromaticOffset += 3`
   * branch ("pure sequence") that shifted every note by a fixed minor
   * 3rd. That works on a piano roll but produces atonal drift — the
   * shifted copy lands on whatever chord-tone-or-not the offset
   * happens to hit, with no relation to the underlying harmony. Real
   * developing-variation in Western music doesn't transpose by
   * arbitrary intervals; it preserves the motif's RHYTHMIC shape and
   * permutes the time/space axes. The aesthetic anchor (Phase 1) is
   * what places the motif on the right harmonic landing — development
   * shouldn't undo that with a raw pitch shift.
   *
   * Three musical transformations, picked at uniform weights:
   *   1. Inversion (倒影) — mirror each note's diatonicStep around
   *      the first note's step. Preserves rhythm AND chord-relative
   *      contour, just flips melodic direction (ascending → descending).
   *      A real composer's classic answer-phrase technique.
   *   2. Late entry (晚拍进入) — shift every t by a half-beat.
   *      Pitches are kept verbatim; the listener hears the same shape
   *      arrive a moment after the chord change. Soul / gospel singers
   *      lay back this way to elevate the chord-tone-on-downbeat into
   *      a slightly delayed gesture. Notes that overflow the bar are
   *      dropped (truncation falls out naturally).
   *   3. Truncation with rest (截短留白) — keep only the first half of
   *      notes; the rest of the bar is silence. Lets the original
   *      gesture "ask a question" with the answer being open space.
   *
   * Random consumption: exactly 1 random.next() per call regardless
   * of branch — symmetric across all three transformations so the
   * develop-bar pipeline's downstream stream stays predictable.
   */
  /**
   * "Motifs as Islands" selector — replaces blind `random.pick(pool)`
   * with conflict-aware filtering and thematic recurrence.
   *
   * Steps:
   *   1. Memory check — if (memoryKey) was previously selected AND a
   *      reuseRoll under MEMORY_REUSE_PROB lands, return the cached
   *      motif. Builds hook recurrence: same V/ii context across the
   *      song hears the same lick a majority of the time.
   *   2. Draw N_CANDIDATES motifs from the pool (with replacement).
   *   3. Score each candidate via estimateMotifConflictRatio against
   *      the chord's runScale; pick the lowest-conflict motif.
   *   4. Cache the winner in thematicMemory under memoryKey.
   *
   * Random consumption: exactly 1 + N_CANDIDATES per call regardless
   * of which path is taken (memory check + candidate picks). Symmetric
   * — swapping selection criteria won't shift downstream randoms.
   *
   * Edge cases: empty pool returns []. Single-element pool returns
   * that element with no conflict scoring (still consumes the same
   * randoms for stream stability).
   */
  private static readonly N_CANDIDATES = 5;
  private static readonly MEMORY_REUSE_PROB = 0.60;
  private selectBestMotif(
      pool: (any[] | { notes: any[]; rules?: any })[],
      chord: ChordDef,
      runScale: number[],
      memoryKey: string,
      thematicMemory: Record<string, any[]>,
      backboneTargets: Set<number> | null = null,
      vlIn: Set<number> | null = null,
      vlOut: Set<number> | null = null,
      prevPhrasePcs: Set<number> | null = null,
  ): any[] {
      if (!pool || pool.length === 0) return [];

      // ===== Three-tier context-aware pre-filter =====
      // Tier 1 (strict): allowedQualities AND allowedTSD both match
      // Tier 2 (soft):   allowedQualities only matches (TSD relaxed)
      // Tier 3 (open):   no filter — fall back to full pool when
      //                  Tier 1/2 are too narrow (<3) to keep variety.
      // Raw arrays (no rules) are wildcards — pushed to BOTH tiers.
      // Zero-Drift property: pure-array pool → Tier1 == Tier2 == pool,
      // identical random.pick behaviour as pre-upgrade.
      const chordQuality = classifyEngineChordType(chord.type);
      const currentFunc: 'T'|'S'|'D' = chord.effectiveFunc ?? getHarmonicFunction(chord.roman);
      const tier1: (any[] | { notes: any[]; rules?: any })[] = [];
      const tier2: (any[] | { notes: any[]; rules?: any })[] = [];
      for (const item of pool) {
          if (Array.isArray(item)) {
              tier1.push(item);
              tier2.push(item);
              continue;
          }
          const rules = item.rules;
          if (!rules) {
              tier1.push(item);
              tier2.push(item);
              continue;
          }
          const passQuality = !rules.allowedQualities
              || rules.allowedQualities.includes(chordQuality);
          const passTSD = !rules.allowedTSD
              || rules.allowedTSD.includes(currentFunc);
          if (passQuality) {
              tier2.push(item);
              if (passTSD) tier1.push(item);
          }
      }
      let finalPool: (any[] | { notes: any[]; rules?: any })[] = pool;
      if (tier1.length >= 3) finalPool = tier1;
      else if (tier2.length >= 3) finalPool = tier2;
      // else: keep pool (Tier 3 fallback)

      // Memory reuse roll (1 random)
      const memRoll = this.random.next();
      const cached = thematicMemory[memoryKey];
      if (cached && memRoll < Engine.MEMORY_REUSE_PROB) {
          // Drain the candidate-pick randoms even on cache hit so the
          // stream stays symmetric with the cache-miss path.
          for (let i = 0; i < Engine.N_CANDIDATES; i++) this.random.pick(finalPool);
          return cached;
      }

      // Draw N candidates from filtered pool
      const candidates: (any[] | { notes: any[]; rules?: any })[] = [];
      for (let i = 0; i < Engine.N_CANDIDATES; i++) {
          candidates.push(this.random.pick(finalPool));
      }

      let best: any = candidates[0];
      let bestRank = -Infinity;
      for (const c of candidates) {
          // Unwrap MotifDef → notes for scoring functions which
          // expect raw arrays.
          const notes = Array.isArray(c) ? c : c.notes;
          const avoidRate = this.estimateMotifConflictRatio(notes, chord, runScale);
          const backboneHit = backboneTargets
              ? estimateBackboneAlignment(notes, chord, runScale, backboneTargets)
              : 0;
          const { vlInHit, vlOutHit, variety } =
              estimateMotifShapeMetrics(notes, chord, runScale, vlIn, vlOut);
          let parallelismHit = 0;
          if (prevPhrasePcs && prevPhrasePcs.size > 0) {
              const candPcs = this.predictMotifStructuralPcs(notes, chord, runScale);
              if (candPcs.size > 0) {
                  let inter = 0;
                  candPcs.forEach(p => { if (prevPhrasePcs!.has(p)) inter++; });
                  const union = candPcs.size + prevPhrasePcs.size - inter;
                  const sim = union > 0 ? inter / union : 0;
                  parallelismHit = Math.max(0, 1 - 2 * Math.abs(sim - 0.5));
              }
          }
          const rank = backboneHit * 2.0
              + vlInHit  * 1.0
              + vlOutHit * 1.5
              + variety  * 0.5
              + parallelismHit * 0.8
              - avoidRate * 1.0;
          if (rank > bestRank) { bestRank = rank; best = c; }
      }

      // Cache + return raw notes (downstream pipeline expects array).
      const bestNotes = Array.isArray(best) ? best : best.notes;
      thematicMemory[memoryKey] = bestNotes;
      return bestNotes;
  }

  /**
   * Project a motif onto chord+runScale and return the SET of pcs
   * that land on structural positions (strong beat OR long ≥1.5 OR
   * last note). Used by selectBestMotif's parallelism scorer and by
   * generateArrangement's phrase-pc accumulator. Same projection
   * semantics as the per-note loop.
   */
  private predictMotifStructuralPcs(motif: any[], chord: ChordDef, runScale: number[]): Set<number> {
      const out = new Set<number>();
      if (motif.length === 0) return out;
      const chordRootPc = (((chord.rootMidi % 12) + 12) % 12);
      const scalePcs = Array.from(new Set(runScale.map(x => ((x%12)+12)%12))).sort((a,b)=>a-b);
      const N = scalePcs.length || 7;
      const rootIdx = scalePcs.indexOf(chordRootPc);
      const startIdx = rootIdx >= 0 ? rootIdx : 0;
      for (let i = 0; i < motif.length; i++) {
          const m = motif[i];
          const beatPos = ((m.t % 4) + 4) % 4;
          const isStrong = Math.abs(beatPos) < 0.05 || Math.abs(beatPos - 2) < 0.05;
          const isLong = m.d >= 1.5;
          const isLast = i === motif.length - 1;
          if (!(isStrong || isLong || isLast)) continue;
          let pc: number;
          if ('chromaticOffset' in m) {
              pc = ((chordRootPc + m.chromaticOffset) % 12 + 12) % 12;
          } else {
              const targetIdx = ((startIdx + m.diatonicStep) % N + N) % N;
              pc = scalePcs[targetIdx];
          }
          out.add(pc);
      }
      return out;
  }

  /**
   * Voice-leading Method 2 — closest-pair bridge.
   *
   * Method 1 (common-tone bridge): pick a pc that's in BOTH chord A
   * and chord B's literal. Distance = 0. Implemented elsewhere via
   * findCommonTones.
   *
   * Method 2 (closest-pair bridge): when no common tone exists, pick
   * the pair (pcA ∈ A.literal, pcB ∈ B.literal) with minimum mod-12
   * distance. The melody anchors:
   *   • last note of bar A → pcA  (the "approach note" from chord A)
   *   • first note of bar B → pcB  (the closest landing on chord B)
   *   • bridge between them → stepwise scale walk
   *
   * Method 1 is a special case of Method 2 (distance = 0). This
   * helper returns the closest pair regardless — the caller can
   * inspect distance to know whether it's a common-tone or stepwise
   * bridge.
   *
   * Tiebreak among equal-distance pairs: prefer the pair whose pcA
   * is closer to the current melody anchor (anchorPc). This biases
   * toward smooth voice-leading from the melody's current position.
   */
  // Phase 1 (#6):findClosestCrossChordPair 已抽到 engine-utils.ts(组 A 纯函数化)

  // =====================================================================
  // AND-architecture melody constraint framework
  // ---------------------------------------------------------------------
  // Replaces the historical "sequential override" pipeline with a
  // single-pass constraint-satisfaction-style selection: build candidate
  // pool → apply hard filters → score by soft preferences → pick best.
  //
  // Hard filter = predicate returning boolean. Candidate must pass ALL
  //   active filters or it's eliminated. If the filtered pool is empty,
  //   filters relax in reverse priority until non-empty.
  //
  // Soft score = weighted predicate returning [-1, 1] (typically). Final
  //   score per candidate is sum of weighted scores. Closest to motif
  //   intent wins ties.
  //
  // Each rule (Color Magnetism, VL Bridge, Bass Decollision, Cadence,
  // Tension Resolution, Leap Recovery, Anti-Monotonicity, etc.)
  // contributes either a filter or a score. Rules are independent —
  // adding a new one doesn't require finding "where in the pipeline"
  // it goes.
  //
  // HARD_FILTER_PRIORITY — relaxation drops filters from the END of
  // the sorted list, so position 0 is preserved longest (most
  // important) and position 13 drops first (least important).
  // Filters split into two layers:
  //   load-bearing musical (positions 0-8) — chord identity, avoid
  //       on strong beat, tendency resolution, phrase cadence, pending
  //       tension resolution, acoustic clash, gravity-line closure.
  //       Sacrificing any of these produces an audible "wrong note".
  //   etiquette (positions 9-13) — leap-cap, apex headroom, pc-repeat
  //       anti-stuck, leap-recovery, anti-monotonicity. Violating any
  //       degrades shape but doesn't break harmony; cheap to drop when
  //       the pool is sparse.
  // ===================================================================== */
  private static readonly HARD_FILTER_PRIORITY: Record<string, number> = {
      'in-melody-range': 0,
      'no-avoid': 1,
      'in-chord-contract': 2,
      'saturation-resolve': 3,
      'unified-tension-resolution': 4,
      'phrase-end-no-unresolved-avoid': 5,
      'no-cross-octave-m9': 6,
      'scale-gravity-line': 7,
      'color-line': 8,
      'leap-octave-cap': 9,
      'apex-headroom': 10,
      'no-same-pc-repeat': 11,
      'leap-recovery': 12,
      'anti-monotonicity': 13,
  };

  private selectBestMidi(
      ctx: NoteContext,
      hardFilters: HardConstraint[],
      softScores: SoftScore[],
  ): number {
      const proj = ctx.motifProjMidi;

      // 1. Build candidate pool — runScale tones within ±10 semis of
      //    motif intent + chord literal pcs in nearby octaves (gives
      //    the magnet a way to reach top extensions and chord 1/3/5
      //    even when motif projection is far).
      const candSet = new Set<number>();
      if (proj >= MELODY_RANGE.LOW && proj <= MELODY_RANGE.HIGH) candSet.add(proj);
      for (const sm of ctx.runScale) {
          if (Math.abs(sm - proj) <= 10
              && sm >= MELODY_RANGE.LOW && sm <= MELODY_RANGE.HIGH) {
              candSet.add(sm);
          }
      }
      const literal = CHORD_TYPES[ctx.chord.type] || [0, 4, 7];
      const rootPc = (((ctx.chord.rootMidi % 12) + 12) % 12);
      for (const iv of literal) {
          const pc = (rootPc + iv) % 12;
          for (let oct = 4; oct <= 7; oct++) {
              const m = oct * 12 + pc;
              if (Math.abs(m - proj) <= 12
                  && m >= MELODY_RANGE.LOW && m <= MELODY_RANGE.HIGH) {
                  candSet.add(m);
              }
          }
      }

      // Rule 10 — guarantee apex pitch is in pool at apex bar's
      // structural beats so the apex-target soft score has something
      // to pull to (motif intent may project well below apex; without
      // this, apex pitch isn't reachable from the proj-±10 window).
      if (ctx.isApexBar && ctx.isStructural && ctx.apexPitchMidi > 0
          && ctx.apexPitchMidi >= MELODY_RANGE.LOW
          && ctx.apexPitchMidi <= MELODY_RANGE.HIGH) {
          candSet.add(ctx.apexPitchMidi);
      }

      const cands = Array.from(candSet);

      // 2. Apply hard filters in priority order. If filtered pool
      //    becomes empty, relax the LAST applied filter and retry.
      // Re-rank by musical priority so etiquette filters (anti-
      // monotonicity / leap-recovery / no-same-pc-repeat) drop FIRST
      // when the candidate pool is tight, and load-bearing musical
      // filters (saturation-resolve, unified-tension-resolution,
      // phrase-end-no-unresolved-avoid) drop LAST. The hardFilters
      // array's source-order is convenient for reading; HARD_FILTER_PRIORITY
      // dictates relaxation order.
      const activeFilters = hardFilters
          .filter(f => f.shouldApply(ctx))
          .slice()
          .sort((a, b) =>
              (Engine.HARD_FILTER_PRIORITY[a.name] ?? 999) - (Engine.HARD_FILTER_PRIORITY[b.name] ?? 999)
          );
      let valid = cands.filter(midi => activeFilters.every(f => f.accept(midi, ctx)));
      let droppedFilters = 0;
      while (valid.length === 0 && droppedFilters < activeFilters.length) {
          droppedFilters++;
          const relaxed = activeFilters.slice(0, activeFilters.length - droppedFilters);
          valid = cands.filter(midi => relaxed.every(f => f.accept(midi, ctx)));
      }
      if (valid.length === 0) {
          // Total fail — fall back to motif projection
          return ctx.motifProjMidi;
      }

      // 3. Score each candidate.
      const activeScores = softScores.filter(s => s.shouldApply(ctx));
      let best = valid[0];
      let bestScore = -Infinity;
      for (const midi of valid) {
          let total = 0;
          for (const s of activeScores) {
              total += s.weight * s.score(midi, ctx);
          }
          // Built-in distance penalty — preserves motif character
          // when no other rule decides. Small weight so any explicit
          // preference (chord literal, vl, etc.) overrides this.
          total -= 0.15 * Math.abs(midi - ctx.motifProjMidi);
          if (total > bestScore) {
              bestScore = total;
              best = midi;
          }
      }
      return best;
  }

  /**
   * Compute three motif-shape metrics in one pass:
   *
   *   vlInHit  — first structural note's projected pc ∈ vlIn (or 0
   *              if no vlIn). Reward for "openng on a common tone
   *              with previous chord".
   *   vlOutHit — last structural note's projected pc ∈ vlOut.
   *              Reward for "leaving on a common tone with next chord"
   *              (forward momentum).
   *   variety  — fraction of distinct structural pcs (more variety =
   *              less loopy / repetitive). 1.0 = all structural notes
   *              are different pcs; 0 = single pc on every structural
   *              position.
   *
   * Uses the same projection semantics as the per-note loop:
   *   chromaticOffset → chord_root_pc + offset
   *   diatonicStep    → runScale rotated to start at chord root
   */
  // Phase 1 (#6):estimateMotifShapeMetrics 已抽到 engine-utils.ts(组 A 纯函数化)

  // Phase 2 (#6):deriveDevelopmentMotif 已抽到 engine-utils.ts(组 B PRNG 参数化)
  // 原 method 注释(inversion / late-entry / truncation 设计)全文保留在
  // engine-utils.ts 同名函数;此处仅 stub forward。
  private deriveDevelopmentMotif(currentMotif: any[]): any[] {
      return utilDeriveDevelopmentMotif(currentMotif, this.random);
  }


    // Phase 1 (#6):applySwing 已抽到 engine-utils.ts(组 A 纯函数化)

    private applyTexture(chord: ChordDef, textureType: string, startBeat: number, duration: number, melodyEvents: NoteEvent[], isShuffle: boolean, accentMode: 'heavy' | 'syncopated', density: number = 0.5, nextChord: ChordDef | null = null): NoteEvent[] {
        // ========================================================
        // AF2 ChordTextureEngine 劫持(Phase 2b.1 → 2c)
        // ========================================================
        // Phase 2c 覆盖 38/38 textureType(含 Call_And_Response cross-track)。
        // 理论上 af2Events 永远非 null;保留 fallback 是防御性编程(若未来加新
        // mg textureType 未同步到 TEXTURE_MAPPING,会走 mg 原实现而非崩)。
        //
        // isShuffle / accentMode / density 仍未传给 AF2(目前 23 子族都不消费,
        // 未来需要时再扩 ChordTextureInput schema)。
        const af2Events = ChordTextureEngine.applyByTextureType(
            textureType, chord, nextChord, startBeat, duration, this.random, melodyEvents,
        );
        if (af2Events !== null) return af2Events;
        // Phase 2d:applyTexture 38 case 已迁移到 AF2 ChordTextureEngine(23 子族 100% 覆盖)。
        // 理论 unreachable;若新加 mg textureType 未同步到 TEXTURE_MAPPING 会触发
        throw new Error("mg.applyTexture: AF2 ChordTextureEngine missed textureType " + textureType);
  }

  /**
   * Fill-scale resolver — picks the style-flavored scale used for
   * passing/connecting/run notes (NOT for backbone projection).
   *
   * Lookup order:
   *   1. profile.fillScales[func][chord.type]      (exact chord type)
   *   2. profile.fillScales[func][family fallback]  (maj / min / 7)
   *   3. fallback: returns the input runScale unchanged
   *
   * Special rooting:
   *   - BLUES with Blues / Major Blues / Composite Blues / Country
   *     Blues / Pentatonic family → rooted on KEY (not chord) so the
   *     blue notes ride consistently across the I-IV-V cycle.
   *   - All other macros → rooted on chord root.
   *
   * Returns a multi-octave (oct -2..3) MIDI array, sorted ascending.
   * The Run Generator and in-bar passing-tone logic find the closest
   * scale tone via linear scan (nearest-neighbor fill principle).
   */
  // Phase 1 (#6):getFillScaleForStyle 已抽到 engine-utils.ts(组 A 纯函数化)

  // Phase 1 (#6):getScaleForStyle 已抽到 engine-utils.ts(组 A 纯函数化)

  private generateBarPattern(
      chord: ChordDef, nextChord: ChordDef | null, style: StyleName, startBeat: number, motif: any[],
      func: 'T'|'S'|'D', isLast: boolean, musicKey: string, musicMode: string, tensionTracker: TensionTracker, melodyState: { currentMidi: number; lastNoteEnd: number; lastLeapSemis: number; sameDirRunLength: number; stepCount: number; leapCount: number; pendingScaleResolveTarget: number | null; pendingScaleResolveRootPc: number; pendingScaleResolveScore: number; pendingScaleLineWindowEnd: number; pendingScaleLineLastMidi: number; pendingColorLine: { startMidi: number; startPc: number; startTime: number; windowEnd: number; lineLastMidi: number } | null; lastEmitRole: NoteRole; lastEmitMidi: number; lastEmitAssessment: NoteHarmonicAssessment | null; lastEmitChord: ChordDef | null },
      textureType: string, isShuffle: boolean, accentMode: 'heavy' | 'syncopated',
      barIndex: number = 0, totalBars: number = 1, density: number = 0.5, complexity: number = 0.5,
      role: 'motif' | 'develop' | 'rest' = 'motif',
      shouldReturn: boolean = false,
      motifInterval: number = 4,
      // Style-flavored fill scale for in-bar Run Generator + passing
      // tone insertion. Falls back to runScale (computed below) when
      // not provided.
      fillScale: number[] | null = null,
      // Backbone target pcs (chord literal ∩ key palette + key root if
      // missing). Color Magnetism uses this to FORCE structural notes
      // onto chord contract — no probability gate, per user direction.
      // Falls back to chord-contract globalPcs check when null.
      barBackboneTargets: Set<number> | null = null,
      // Previous bar's chord — used by the cross-bar bridge to filter
      // candidate passing tones against the SOURCE chord's avoid table.
      // Without this, the bridge places a global-key passing tone in
      // the previous bar's silent tail, which can land on the source
      // chord's avoid 4th (e.g. F over a C maj triad) — a real
      // architectural leak the magnetism layer can't catch because
      // the bridge bypasses the per-note pipeline entirely.
      prevChord: ChordDef | null = null,
      // Phase 5 — Caplin-style phrase role from detectPhrases. When
      // provided, drives Cadence Tier selection: antecedent_end → C
      // forced, consequent_end → B (T) or C (D/S), song_end → A (T) or
      // none, phrase_end_through → default by func, mid_phrase → none.
      // Defaults to 'phrase_end_through' so legacy callers still hit
      // the original Tier logic.
      phraseRole: PhraseRole = 'phrase_end_through',
  ): { patternEvents: NoteEvent[], bridgeVisual?: { time: number, label: string } } {
      let events: NoteEvent[] = [];
      let bridgeVisual: { time: number, label: string } | undefined;
      
      const rootKeyMidi = noteToMidi(musicKey + "0");
      const chordTones = chord.notes;

      // ====== Motif placement conflict escape (measured projection) ======
      // Per architecture S4 ("换位置 OR 换motif"), when the canonical motif
      // would clash too heavily with the active chord we demote the bar to
      // develop and swap in a derived variant.
      //
      // The earlier heuristic only triggered on a fixed list of chord-type
      // names (m7b5 / dim / 7alt). Now we project each motif note's would-be
      // interval-from-root and count how many fall on AVOID intervals for
      // this chord type. The trigger is a measured ratio, so it catches
      // motif/chord pairs that are genuinely hostile even when the chord-
      // type name doesn't look problematic, and it leaves alone otherwise-
      // hostile chord types when the specific motif happens to thread the
      // avoid notes.
      // runScale computed up-front so the motif-conflict check below
      // can evaluate against the chord's REAL melodic palette
      // (Dorian / Mixolydian / Altered etc.) instead of a static
      // Ionian proxy. The same runScale is reused by anchor scoring
      // and the per-note projection loop further down — single
      // construction, three consumers.
      const runScale = getScaleForStyle(style, chord, func, musicKey, musicMode);
      // Pcs view of the runScale — passed to evaluator so it can apply
      // scale-awareness. The runScale already includes borrowed scales
      // (Phrygian Dominant / Lydian Dominant / Altered) on secondary
      // dominants, so this set carries the borrowed-pitch-pool to the
      // chord-context judgement.
      const runScalePcs = new Set<number>(runScale.map(m => ((m % 12) + 12) % 12));

      // 物理避音法则上下文 (老师严格版).
      // isModalEnv: 仅 RNB (allowFloatingColor) / BLUES (allowBluesHangTone)
      // 风格授权 = modal 场. POP/JAZZ 即使 mode 是 Dorian/Mixolydian 也
      // 按调性处理 — 严守"三全音泄露"等法则.
      const isModalEnv = STYLE_DICTIONARY[style]?.allowFloatingColor === true
          || STYLE_DICTIONARY[style]?.allowBluesHangTone === true;

      // 提前解析 scale 名 (调式特征音免死查表用). 跟后面 scale-gravity
      // 用的同一份, 上提到这里. 后面 scaleNameForBar/scaleRootPcForBar
      // 重复计算块会沿用此值.
      let scaleNameForBar: string | null = null;
      let scaleRootPcForBar: number = -1;
      {
          const keyRootPcLocal = (((rootKeyMidi % 12) + 12) % 12);
          const chordRootPcLocal = (((chord.rootMidi % 12) + 12) % 12);
          const songMode = (musicMode && musicMode in SCALE_TYPES) ? musicMode : 'Ionian';
          const rsPcs = new Set(runScale.map(mp => ((mp % 12) + 12) % 12));
          const expected1 = new Set(SCALE_TYPES[songMode].map(iv => (keyRootPcLocal + iv) % 12));
          let m1 = expected1.size === rsPcs.size;
          if (m1) for (const pc of expected1) if (!rsPcs.has(pc)) { m1 = false; break; }
          if (m1) {
              scaleNameForBar = songMode;
              scaleRootPcForBar = keyRootPcLocal;
          } else {
              const candidates = ['Phrygian Dominant', 'Lydian Dominant', 'Altered',
                  'Mixolydian', 'Lydian', 'Ionian', 'Aeolian', 'Dorian', 'Phrygian',
                  'Harmonic Minor', 'Melodic Minor', 'Bebop Dominant', 'Bebop Major',
                  'Blues', 'Major Blues', 'Locrian'];
              for (const name of candidates) {
                  const ivs = SCALE_TYPES[name];
                  if (!ivs) continue;
                  const expected = new Set(ivs.map(iv => (chordRootPcLocal + iv) % 12));
                  let match = expected.size === rsPcs.size;
                  if (match) for (const pc of expected) if (!rsPcs.has(pc)) { match = false; break; }
                  if (match) {
                      scaleNameForBar = name;
                      scaleRootPcForBar = chordRootPcLocal;
                      break;
                  }
              }
          }
      }

      const conflictRatio = this.estimateMotifConflictRatio(motif, chord, runScale, func, isModalEnv, scaleNameForBar || undefined);
      if (role === 'motif' && motif.length > 0 && conflictRatio > 0.5) {
          motif = this.deriveDevelopmentMotif(motif);
          role = 'develop';
      }

      // ====== 应用变奏机 Motif Mutator ======
      // Motif raw output assumes a 4-beat bar (motif data is authored
      // for 4/4). For non-4/4 bars, scale t and d by
      // (beatsPerMeasure / 4) so the motif fits the new bar length —
      // a 6/8 bar (3 beats) compresses by 0.75; a 5/4 bar (5 beats)
      // stretches by 1.25. The structural shape of the motif (its
      // strong-beat placements at 0 and middle) maps proportionally.
      // For 4/4 the scale factor is 1 and the array passes through
      // unchanged — byte-equal preserved.
      const meterScale = this.songMeterContext.beatsPerMeasure / 4;
      let mutatedMotif = meterScale === 1
          ? this.motifMutator(motif, style, density, complexity, isShuffle)
          : this.motifMutator(motif, style, density, complexity, isShuffle)
              .map((m) => ({ ...m, t: m.t * meterScale, d: m.d * meterScale }));
      // Chord-slot duration clip. When the slot is shorter than a full
      // bar (planner-inserted ii-V split: chord.duration=2 in 4/4),
      // motif notes whose onset lands past chord.duration must be
      // discarded — they would otherwise emit into the NEXT chord's
      // time region with this chord's pitch/role context. Also clamp
      // each surviving note's d so it doesn't bleed past the slot's
      // tail. No-op when chord.duration === bar length (legacy path).
      if (chord.duration < this.songMeterContext.beatsPerMeasure) {
          mutatedMotif = mutatedMotif
              .filter(m => m.t < chord.duration - 0.001)
              .map(m => ({ ...m, d: Math.min(m.d, chord.duration - m.t) }));
      }

      // === 1. Texture Generation FIRST (伴奏织体锁定骨架) ===
      // 我们把 density 作为参数渗透下去，如果是非常高/很低的 density，能在内部调整
      //
      // Rhythmic Interlocking — pass the motif's rhythmic schedule
      // (timing only, no pitch) so applyTexture can duck under
      // melody hits and step back when melody rests, completing the
      // divisi (melody动 / 伴奏静, 旋律停 / 伴奏托). The blueprint
      // uses noteNumber: -999 as a sentinel so pushEvent's
      // close-pitch octave-drop check at the texture side never
      // misfires against it (real melody pitches are always above
      // MIDI 0).
      const melodyBlueprint: NoteEvent[] = mutatedMotif.map((m: { t: number; d: number }) => ({
          noteNumber: -999,
          time: startBeat + applySwing(m.t, isShuffle),
          duration: m.d,
          velocity: 100,
          part: 'melody' as const,
      }));
      const textureEvents = this.applyTexture(chord, textureType, startBeat, chord.duration, melodyBlueprint, isShuffle, accentMode, density, nextChord);
      // 老师 4 — BASSLINE 自有线条. style.bassPattern 已在
      // realizeProgression 生成 chord.bassPattern. 这里把 texture 的
      // bass 输出整体替换为 pattern 序列, 让 boogie / stride / dilla
      // pocket 这种"铺底简单旋律线"贯穿全 bar.
      if (chord.bassPattern && chord.bassPattern.length > 0) {
          const noBass = textureEvents.filter(e => e.part !== 'bass');
          events.push(...noBass);
          for (const bp of chord.bassPattern) {
              const absTime = startBeat + bp.time;
              if (absTime >= startBeat + chord.duration) continue;
              const remaining = startBeat + chord.duration - absTime - 0.02;
              if (remaining <= 0) continue;
              events.push({
                  noteNumber: bp.midi,
                  time: absTime,
                  duration: Math.min(bp.duration, remaining),
                  velocity: Math.min(127, bp.velocity),
                  part: 'bass',
              });
          }
      } else {
          events.push(...textureEvents);
      }

      // === 2. Melody Generation (Logic Pro Voice Leading & Resolve) ===
      
      const progress = barIndex / totalBars;
      const arch = Math.sin(progress * Math.PI);
      const maxShiftSemis = style === 'BLUES' ? 5 : 7;
      const macroSemiShift = isLast ? 0 : Math.floor(arch * maxShiftSemis);

      // runScale already computed above (line ~2247) for the
      // conflict-ratio check; reused here for anchor scoring + per-
      // note projection.
      const scalePcs = new Set(runScale.map(x => x % 12));
      const N = scalePcs.size;

      // Aesthetic Anchor — score each runScale candidate by what the
      // bar's first projected pitch would mean musically, not just by
      // distance to the previous note.
      //
      // The previous logic picked the runScale tone that landed the
      // motif's first step closest to lastNoteMidi. That's smooth voice
      // leading, but ignorant of harmony: the anchor would land on
      // whichever scale note happened to be nearest, even if it was
      // a bland 1/3/5 over a rich m11 chord, or worse, the chord's
      // declared color tone got skipped because a closer scale note won.
      //
      // The new scoring iterates all runScale candidates and for each
      // computes the FIRST PROJECTED PITCH (anchor + motif's first
      // step), then scores that pitch on:
      //   1. Voice-leading proximity to lastNoteMidi (smooth continuity)
      //   2. Composite-state virtualExtensions hit (Divisi 2.0's
      //      defining color over slash chords like F/G — huge bonus)
      //   3. Vacated-extension hit on declared 5+ interval chords
      //      (m9 / m11 / 13 / maj9 — the chord's "advertised" color)
      //   4. add9 / 6/9 named extension hit
      //   5. INTERVAL_AESTHETICS function vs. chord function intent:
      //        T (tonic)     → reward Home / Anchor / Color
      //        S (subdom.)   → reward Active / Color
      //        D (dominant)  → reward Leading / Tension / Active
      //   6. isAvoidNote penalty
      //   7. Tiny forked-random jitter so equal-score ties don't always
      //      collapse to the lowest scale index.
      //
      // The result: the bar's first note is musically intentional —
      // it answers the chord's role rather than passively following
      // the previous note.
      let anchorIdx = 0;
      const referenceMidi = melodyState.currentMidi || noteToMidi(musicKey + "4");
      const firstNote: any = mutatedMotif.length > 0 ? mutatedMotif[0] : null;
      const firstStepDiatonic = firstNote && 'diatonicStep' in firstNote ? firstNote.diatonicStep : 0;
      const firstChromaOffset = firstNote && 'chromaticOffset' in firstNote ? firstNote.chromaticOffset : 0;
      const firstIsDiatonic = firstNote ? 'diatonicStep' in firstNote : true;

      const projectFirstMidi = (k: number): number => {
          if (!firstIsDiatonic) {
              return runScale[k] + firstChromaOffset;
          }
          const targetIdx = k + firstStepDiatonic;
          const rsLen = runScale.length;
          const octs = Math.floor(targetIdx / rsLen);
          let rem = targetIdx % rsLen;
          if (rem < 0) rem += rsLen;
          return runScale[rem] + (octs * 12);
      };

      const chordRootPc = (((chord.rootMidi % 12) + 12) % 12);
      const keyRootPc = (((noteToMidi(musicKey + "0") % 12) + 12) % 12);
      const literalIntervals = CHORD_TYPES[chord.type] || [];
      const vacatedIntervals: number[] = literalIntervals.length >= 5
          ? literalIntervals.slice(4)
          : [];
      const effFunc = chord.effectiveFunc || func;

      let bestScore = -Infinity;
      for (let k = 0; k < runScale.length; k++) {
          const firstMidi = projectFirstMidi(k);
          if (firstMidi < MELODY_RANGE.LOW || firstMidi > MELODY_RANGE.HIGH) continue;

          let score = 0;
          const pcFromChord = (((firstMidi - chordRootPc) % 12) + 12) % 12;
          const pcFromKey = (((firstMidi - keyRootPc) % 12) + 12) % 12;
          const firstPc = (((firstMidi % 12) + 12) % 12);

          // 1. Voice leading — smoother continuation scores higher.
          //    Now that Active Divisi Magnet (m.d >= 0.5) reliably
          //    pulls held notes onto vacated extensions and Run
          //    Generator bridges gap+leap pairs, the anchor's
          //    responsibility is FIRST-NOTE PLACEMENT — smooth
          //    continuation from the previous bar's last pitch.
          //    Color completion is downstream's job. Coefficient
          //    raised from 1.2 to 3.5 — voice leading dominates,
          //    extensions provide a small flavor preference only.
          score -= Math.abs(firstMidi - referenceMidi) * 3.5;

          // 2. SlashChord virtualExtensions — moderate flavor pull.
          //    Capped at +15 (was +40). On real slash chords
          //    (F/G, D/C) the listener still hears the color when
          //    Active Divisi pulls a held note later in the bar.
          if (chord.tensionState === 'SlashChord' && chord.virtualExtensions) {
              const bassPc = (((chord.bassMidi % 12) + 12) % 12);
              for (const semis of chord.virtualExtensions) {
                  const targetPc = (((bassPc + semis) % 12) + 12) % 12;
                  if (firstPc === targetPc) score += 15;
              }
          }

          // 3. Vacated extensions — capped at +10 (was +30). Vacated
          //    extension completion is now Active Divisi's job (93%+
          //    coverage post-tune); the anchor doesn't need to chase
          //    extensions on bar-1 if they sit far from the previous
          //    pitch.
          for (const iv of vacatedIntervals) {
              const targetPc = (((chordRootPc + iv) % 12) + 12) % 12;
              if (pcFromChord === targetPc) score += 10;
          }

          // 4. add9 / 6/9 — named "added" tone is the chord's identity.
          if (chord.type === 'add9' && pcFromChord === 2) score += 25;
          if (chord.type === '6/9' && (pcFromChord === 9 || pcFromChord === 2)) score += 25;

          // 5. Unified consonance/urgency scoring — evaluator-driven.
          //    Replaces the prior three-rule stack (key INTERVAL_AESTHETICS
          //    function reward, chord CHORD_VOICING_AESTHETICS role
          //    reward, and isAvoidNote penalty) with one chord-context-
          //    authoritative assessment. The evaluator fuses all four
          //    sources internally; the anchor scorer only reads the
          //    fused verdict.
          //
          //    Scoring weights tuned to roughly preserve the prior
          //    range (-25..+15) so voice-leading (rule 1, ×3.5/semi)
          //    still dominates and the anchor doesn't lurch into
          //    unrelated registers when chord-context preferences
          //    change. consonant > colortone > tension > avoid in
          //    every position; TSD-functional intent adds a small
          //    role-confirming bonus on top.
          const anchorAssessment = evaluateNoteInChordContext(
              firstPc,
              chord.type,
              chordRootPc,
              effFunc,
              nextChord ? nextChord.type : null,
              nextChord ? ((nextChord.rootMidi % 12) + 12) % 12 : null,
              keyRootPc,
              scaleNameForBar || undefined,
              isModalEnv,
              runScalePcs,
              this.songTonalCharacter,
              chord.localTonalCenterPc,
              modeToKeyFamily(musicMode),
          );
          switch (anchorAssessment.consonance) {
              case 'consonant': score += 8; break;
              case 'colortone': score += 6; break;
              case 'tension':   score += 3; break;
              case 'avoid':     score -= 25; break;
          }
          // Functional-intent bonus — anchor lands meaningfully for
          // the chord's role. T anchors home tones, D anchors urgency
          // (signals the function via tension-present), S anchors
          // transitional color.
          if (effFunc === 'T' && anchorAssessment.isInChordContract) score += 4;
          else if (effFunc === 'D' && anchorAssessment.urgency >= 0.5) score += 5;
          else if (effFunc === 'S' && anchorAssessment.isInChordExtension) score += 3;

          // Cross-chord resolution bonus — Layer C in the docs. When
          // the previous emit carried a non-trivial tendency (urgency
          // ≥ 0.4) and listed resolutionTargets, candidates that land
          // on one of those targets get a soft bonus proportional to
          // the prior tendency's gravity. This soft layer sits below
          // the unified-tension-resolution hard constraint (which
          // forces gravity ≥ 0.5 onto targets) — together they handle
          // the spectrum from "must resolve" (hard) down to "would
          // sound right to resolve" (soft).
          //
          // Bonus scales with prev urgency × 12 (up to ~+12 for an
          // avoid-class prev, ~+5 for a mild tension prev). Modal
          // tonalCharacter halved prev urgency already, so blues etc.
          // get muted bonus naturally.
          if (melodyState.lastEmitAssessment !== null) {
              const prev = melodyState.lastEmitAssessment;
              if (prev.urgency >= 0.4 && prev.resolutionTargets.includes(firstPc)) {
                  score += 12 * prev.urgency;
              }
          }

          // 7. Hard leap cutoff — beyond an octave from the previous
          //    pitch, the anchor candidate gets a near-disqualifying
          //    -100 penalty. Combined with the +3.5/semi VL penalty
          //    above, this guarantees the bar's first note never
          //    leaps more than 12 semis from the previous bar's last
          //    pitch unless NO closer candidate scores positive
          //    (which happens only on hostile chord types where every
          //    in-range scale tone is also avoid).
          if (Math.abs(firstMidi - referenceMidi) > 12) score -= 100;

          // 8. Tiny forked-random tie-break jitter so identical-score
          //    candidates don't always collapse to the lowest k.
          score += (this.aestheticAnchor?.next() ?? 0) * 0.5;

          if (score > bestScore) {
              bestScore = score;
              anchorIdx = k;
          }
      }
      
      // Macro Arch Shift - shift the anchor octave if macro arch demands it
      const octShift = Math.round(macroSemiShift / 12);
      let targetAnchorMidi = runScale[anchorIdx] + octShift * 12;
      
      // Update anchorIdx to the shifted octave
      let minScaleDist = 999;
      for (let k = 0; k < runScale.length; k++) {
          let d = Math.abs(runScale[k] - targetAnchorMidi);
          if (d < minScaleDist) { minScaleDist = d; anchorIdx = k; }
      }

      let lastNoteMidi = melodyState.currentMidi || runScale[anchorIdx];
      const anchorRootMidi = runScale[anchorIdx];

      // Chord-root reference for motif projection.
      //
      // Motif data uses diatonicStep / chromaticOffset SEMANTICALLY
      // as "scale degree from chord root" / "semitones from chord
      // root" — e.g. POP `step 1` means "9 of chord", RNB `c10`
      // means "b7 of chord", RNB `c17` means "11 of chord (octave+P4)".
      //
      // The Aesthetic Anchor picks an octave + register, but if it
      // lands on a non-root scale tone (preferring voice-leading
      // smoothness), interpreting steps "from anchor" produces
      // wrong intervals from chord root: anchor=Bb + c17 = D#, not
      // the intended G (= 11 of D minor).
      //
      // Fix: project from chord root pitch class, in the OCTAVE
      // closest to the aesthetic anchor. Anchor still drives
      // register; chord root drives pitch class.
      const chordRootPcLocal = (((chord.rootMidi % 12) + 12) % 12);
      const anchorOctLocal = Math.floor(anchorRootMidi / 12);
      let rootMidiForProjection = anchorOctLocal * 12 + chordRootPcLocal;
      // Pick the chord-root midi in the octave closest to anchor.
      const _rmCandidates = [
          rootMidiForProjection - 12,
          rootMidiForProjection,
          rootMidiForProjection + 12,
      ];
      let _bestRm = _rmCandidates[0];
      let _bestRmDist = Infinity;
      for (const c of _rmCandidates) {
          const d = Math.abs(c - anchorRootMidi);
          if (d < _bestRmDist) { _bestRmDist = d; _bestRm = c; }
      }
      rootMidiForProjection = _bestRm;
      // Find that root midi's exact index in runScale (runScale is
      // multi-octave so the root MUST appear at multiple positions
      // when chord is diatonic to key — match by exact MIDI value).
      // If not present (exotic / blues / non-diatonic chords whose
      // runScale is rooted differently), fall back to anchorIdx.
      let rootProjIdx = runScale.indexOf(rootMidiForProjection);
      if (rootProjIdx < 0) {
          // Find any runScale entry sharing the chord root pc, nearest anchor.
          let bestPcDist = Infinity;
          for (let k = 0; k < runScale.length; k++) {
              if ((((runScale[k] % 12) + 12) % 12) === chordRootPcLocal) {
                  const d = Math.abs(runScale[k] - anchorRootMidi);
                  if (d < bestPcDist) { bestPcDist = d; rootProjIdx = k; rootMidiForProjection = runScale[k]; }
              }
          }
          if (rootProjIdx < 0) {
              rootProjIdx = anchorIdx;
              rootMidiForProjection = anchorRootMidi;
          }
      }

      // Cross-bar bridging — extend Run Generator's gap-fill across
      // the bar boundary. When the previous bar's last melody note
      // ended significantly before this bar's first note AND the
      // pitch leap is wide, drop one stepwise scale-tone passing
      // note inside the gap. Sacred motif's pitches are NOT touched
      // (the bridge is a NEW develop note in the silence between
      // bars, not a modification of motif pitches).
      //
      // Skips:
      //   - first bar of song (no preceding note to bridge from)
      //   - empty motif bar (rest)
      //   - same-bar motif notes (handled by the in-bar Run Generator
      //     post-pass at the end of generateBarPattern)
      if (melodyState.lastNoteEnd > 0 && mutatedMotif.length > 0) {
          const firstM = mutatedMotif[0];
          const firstAbsTime = startBeat + applySwing(firstM.t, isShuffle);
          // Predicted first projected pitch — anchored at chord root
          // (matching the per-note loop's chord-relative semantics).
          let firstTargetMidi: number;
          if ('diatonicStep' in firstM) {
              const step = firstM.diatonicStep;
              const rsLen = runScale.length;
              const targetIdx = rootProjIdx + step;
              const octs = Math.floor(targetIdx / rsLen);
              let rem = targetIdx % rsLen;
              if (rem < 0) rem += rsLen;
              firstTargetMidi = runScale[rem] + (octs * 12);
          } else {
              firstTargetMidi = rootMidiForProjection + (firstM.chromaticOffset || 0);
          }
          const timeGap = firstAbsTime - melodyState.lastNoteEnd;
          const pitchLeap = Math.abs(firstTargetMidi - lastNoteMidi);
          // Cross-bar stepwise walk (Method 2 bridge fill). The walk
          // anchors at lastNoteMidi (= bar A's last note, already snapped
          // to pcA by the bar-edge VL step at lastIdx) and arrives at
          // bridgeTargetMidi (= the predicted MIDI of bar B's first note
          // after Method 2 step 3 snaps it to pcB). Stepwise scale tones
          // fill the gap so the listener perceives a connected line
          // across the bar boundary.
          //
          // Triggers when: gap >= 0.5 beat (room for at least one
          // 8th-note insert) AND pitch leap >= 4 semis (close enough
          // already, no need to interpolate).
          if (timeGap >= 0.5 && pitchLeap >= 4 && pitchLeap <= 14) {
              // Recompute bridge target = where bar B's first note
              // will actually land after Method 2 snap (idx === 0
              // block in the per-note loop). When prevChord exists
              // and the natural leap >= 4, the first note snaps to
              // nearest pcB octave around lastNoteMidi.
              let bridgeTargetMidi = firstTargetMidi;
              if (prevChord && pitchLeap >= 4) {
                  const lastPc = (((lastNoteMidi % 12) + 12) % 12);
                  const { pcB } = findClosestCrossChordPair(prevChord, chord, lastPc);
                  const targetOct = Math.floor(lastNoteMidi / 12);
                  let bestPcMidi = bridgeTargetMidi;
                  let bestPcDist = Infinity;
                  for (let oct = targetOct - 1; oct <= targetOct + 1; oct++) {
                      const cand = oct * 12 + pcB;
                      if (cand < MELODY_RANGE.LOW || cand > MELODY_RANGE.HIGH) continue;
                      const d = Math.abs(cand - lastNoteMidi);
                      if (d < bestPcDist) { bestPcDist = d; bestPcMidi = cand; }
                  }
                  bridgeTargetMidi = bestPcMidi;
              }

              const direction = Math.sign(bridgeTargetMidi - lastNoteMidi);
              const updatedLeap = Math.abs(bridgeTargetMidi - lastNoteMidi);

              // Bridge palette = GLOBAL KEY palette (Option B). The
              // walk stays diatonic to the song's key, not the next
              // chord's altered scale.
              const keyPaletteScale = SCALE_TYPES[(musicMode && musicMode in SCALE_TYPES) ? musicMode : 'Ionian'];
              const bridgePalette: number[] = [];
              for (let oct = -2; oct <= 3; oct++) {
                  for (const iv of keyPaletteScale) {
                      bridgePalette.push(noteToMidi(musicKey + "3") + (oct * 12) + iv);
                  }
              }
              const sortedPalette = [...new Set(bridgePalette)].sort((a, b) => a - b);

              // Source + destination avoid filter — the walk plays in
              // the previous bar's chord time, so respect BOTH avoid
              // tables. Without this the walk leaks 4-of-maj or maj7-of-7
              // onto structural listening positions.
              const sourceChord = prevChord;
              const sourceFunc = sourceChord ? (sourceChord.effectiveFunc ?? getHarmonicFunction(sourceChord.roman)) : 'T';
              const isAcceptable = (sm: number): boolean => {
                  const pc = (((sm % 12) + 12) % 12);
                  if (sourceChord) {
                      const ivFromSrc = ((pc - (sourceChord.rootMidi % 12) + 12) % 12);
                      if (isAvoidNote(ivFromSrc, sourceChord.type, undefined, isModalEnv, sourceFunc)) return false;
                  }
                  const ivFromDst = ((pc - (chord.rootMidi % 12) + 12) % 12);
                  if (isAvoidNote(ivFromDst, chord.type, scaleNameForBar || undefined, isModalEnv, func)) return false;
                  return true;
              };

              // Walk stepwise scale tones from lastNoteMidi toward
              // bridgeTargetMidi. Number of inserts capped by:
              //   - gap budget: floor(gap / 0.5) — each insert is an 8th
              //   - pitch budget: updatedLeap - 1 (don't overshoot or
              //     hit the target pitch with the last insert; the
              //     target is reached by bar B's first note itself)
              //   - hard cap: 3 (avoid flooding the gap)
              const maxByGap = Math.floor(timeGap / 0.5);
              const maxByPitch = Math.max(0, updatedLeap - 1);
              const nInserts = Math.max(0, Math.min(3, maxByGap, maxByPitch));

              if (nInserts > 0 && direction !== 0) {
                  // Find anchor index in palette closest to lastNoteMidi.
                  let anchorPaletteIdx = 0;
                  let anchorDist = Infinity;
                  for (let k = 0; k < sortedPalette.length; k++) {
                      const d = Math.abs(sortedPalette[k] - lastNoteMidi);
                      if (d < anchorDist) { anchorDist = d; anchorPaletteIdx = k; }
                  }

                  // Distribute insert times evenly across the gap.
                  // Insert i sits at lastNoteEnd + (i+1) * (gap / (nInserts+1))
                  // — that places the last insert ~ 1/(n+1) of the gap
                  // BEFORE the next bar's first note, and the first insert
                  // ~ 1/(n+1) AFTER the previous bar's last note ended.
                  // Spacing leaves audible clearance on both sides.
                  const gapStart = melodyState.lastNoteEnd;
                  const slot = timeGap / (nInserts + 1);

                  for (let s = 0; s < nInserts; s++) {
                      // Walk one scale step in `direction` per insert.
                      let stepIdx = anchorPaletteIdx + direction * (s + 1);
                      if (stepIdx < 0 || stepIdx >= sortedPalette.length) break;
                      let stepMidi = sortedPalette[stepIdx];
                      // If filtered (avoid), skip ahead one scale step
                      // and try again — preserve direction so the walk
                      // still moves toward target.
                      if (!isAcceptable(stepMidi)) {
                          stepIdx += direction;
                          if (stepIdx < 0 || stepIdx >= sortedPalette.length) continue;
                          stepMidi = sortedPalette[stepIdx];
                          if (!isAcceptable(stepMidi)) continue;
                      }
                      // Don't emit identical pitch as endpoints (would
                      // collapse to a repeat).
                      if (stepMidi === lastNoteMidi || stepMidi === bridgeTargetMidi) continue;
                      if (stepMidi < MELODY_RANGE.LOW || stepMidi > MELODY_RANGE.HIGH) continue;

                      // Don't overshoot — the walk approaches but doesn't
                      // reach (or pass) the target.
                      if (direction > 0 && stepMidi >= bridgeTargetMidi) break;
                      if (direction < 0 && stepMidi <= bridgeTargetMidi) break;

                      const insertTime = gapStart + slot * (s + 1);
                      // Quantize duration to 16th (0.25) or 8th (0.5) —
                      // matches QUANTIZED_DURATIONS contract; non-standard
                      // values trigger the audit's duration warning.
                      const insertDur = slot >= 0.55 ? 0.5 : 0.25;
                      events.push({
                          noteNumber: stepMidi,
                          time: insertTime,
                          duration: insertDur,
                          velocity: 85,
                          part: 'melody',
                          origin: 'develop',
                      });
                  }
              }
          }
      }

      mutatedMotif.forEach((m: any, idx) => {
          const swTime = applySwing(m.t, isShuffle);
          const absTime = startBeat + swTime;

          // Structural-note detection lifted ABOVE the projection so the
          // chromaticOffset avoid-snap (below) can gate on it. The same
          // three-clause definition is used by color magnetism / tension
          // correction further down: strong beat OR long duration OR
          // phrase end. Notes failing all three are passing tones.
          //
          // Strong-beat positions come from the song's meterContext:
          //   4/4 → [0, 2] (downbeat + halfway)
          //   3/4 → [0]    (waltz downbeat only)
          //   6/8 → [0, 1.5] (two compound beats)
          //   12/8 → [0, 1.5, 3, 4.5]
          //   5/4 → [0, 3] (3+2 grouping)
          const bpm = this.songMeterContext.beatsPerMeasure;
          const beatPosition = ((m.t % bpm) + bpm) % bpm;
          const isStrongBeat = this.songMeterContext.strongBeats.some(
              (sb) => Math.abs(beatPosition - sb) < 0.05,
          );
          const isLongDuration = m.d >= 1.5;
          const isPhraseEnd = idx === mutatedMotif.length - 1;
          const isStructuralNote = isStrongBeat || isLongDuration || isPhraseEnd;

          let targetRawMidi: number;

          if ('diatonicStep' in m) {
              // diatonicStep is "scale degree from chord root", per the
              // motif data's semantic intent. Project from the chord
              // root's index in runScale (rootProjIdx), NOT from the
              // aesthetic anchor. Aesthetic anchor sets the octave
              // register; chord root sets the pitch-class meaning of
              // step N.
              const step = m.diatonicStep;
              const targetIndex = rootProjIdx + step;
              const runScaleLength = runScale.length;
              const octaves = Math.floor(targetIndex / runScaleLength);
              let remIndex = targetIndex % runScaleLength;
              if (remIndex < 0) remIndex += runScaleLength;

              targetRawMidi = runScale[remIndex] + (octaves * 12);
          } else {
              // chromaticOffset is "semitones from chord root", per the
              // motif data's intent: c10 = b7 of chord, c14 = 9 of chord,
              // c17 = 11 of chord. Anchored at chord root in the aesthetic
              // anchor's octave register.
              //
              // Two structural-beat snaps run here. Both gated on
              // isStructuralNote so passing chromatics keep the bebop /
              // chromatic-approach color JAZZ depends on; only landing-
              // weight notes get pulled into key + chord contract.
              //
              //   1. Out-of-scale snap — if the chromatic projection
              //      lands on a pc that ISN'T in the bar's runScale
              //      (e.g. F# from chromaticOffset=2 on Em in C major,
              //      where C major = {C,D,E,F,G,A,B}), it's a chromatic
              //      foreign to the song's key palette. The motif's
              //      "9-of-chord" intent (= F# chromatic) needs to be
              //      reinterpreted as the DIATONIC 9 (= F natural) so
              //      the structural beat lands on a key-resident pc.
              //      The runScale already encodes the key palette
              //      (mode-of-key fast path) or the chord-borrowed
              //      scale (V/X with Phrygian Dominant, sub-V with
              //      Lydian Dominant, etc.) — it's the source of
              //      truth on what the listener should hear over this
              //      chord in this key.
              //
              //   2. Avoid snap — if the chromatic projection lands on
              //      a chord-type-specific avoid (e.g. 4th over a maj
              //      triad = 11 = avoid 11), snap to nearest non-avoid
              //      scale tone. Long-rung avoid on a structural beat
              //      corrupts the chord's quality.
              //
              // Both snaps draw from runScale (the same source of
              // truth) and prefer the closest scale tone to the
              // original chromatic projection within ±3 semitones.
              const literalMidi = rootMidiForProjection + (m.chromaticOffset || 0);
              const litPc = (((literalMidi % 12) + 12) % 12);
              const litIntervalFromChord = (((litPc - chordRootPc) % 12) + 12) % 12;
              const inScale = runScale.some(sm => (((sm % 12) + 12) % 12) === litPc);
              const isAvoid = isAvoidNote(litIntervalFromChord, chord.type, scaleNameForBar || undefined, isModalEnv, func);
              // bypassSnap 通行证 — 当 motif 数据明确标记 m.bypassSnap
              // (via "!" suffix in defineMotif or rule-level
              // bypassStructuralSnap), 跳过结构位 out-of-scale / avoid
              // 强制 snap. 用户对 #11 / b9 / etc. 色彩的明确保留意图
              // 优先于引擎的"绝对优先 contract"约束.
              if (isStructuralNote && !m.bypassSnap && (isAvoid || !inScale)) {
                  let bestMidi = literalMidi;
                  let bestDist = Infinity;
                  for (const sm of runScale) {
                      const smPc = (((sm % 12) + 12) % 12);
                      const smIntv = (((smPc - chordRootPc) % 12) + 12) % 12;
                      if (isAvoidNote(smIntv, chord.type, scaleNameForBar || undefined, isModalEnv, func)) continue;
                      const d = Math.abs(sm - literalMidi);
                      if (d < bestDist) { bestDist = d; bestMidi = sm; }
                  }
                  targetRawMidi = bestDist <= 3 ? bestMidi : literalMidi;
              } else {
                  targetRawMidi = literalMidi;
              }
          }

          let mNoteMidi = targetRawMidi;

          let contourDir = 0;
          if (idx > 0) contourDir = Math.sign(mNoteMidi - lastNoteMidi);
          else contourDir = Math.sign(mNoteMidi - melodyState.currentMidi); // Initial inertia

          const chordRootMidi = noteToMidi(chord.root + "0");
          let pcInterval = (mNoteMidi - chordRootMidi) % 12;
          if (pcInterval < 0) pcInterval += 12;

          // Global-harmony contract — chord literal + admissible
          // extensions per quality. Anything in the contract is fair
          // game on a structural beat under the divisi model.
          // literalIntervals stays the raw chord-type pattern for the
          // magnet's top-color-tone calculation below.
          const literalIntervals = CHORD_TYPES[chord.type] || CHORD_TYPES['maj'];
          const { intervals: globalIntervals, pcs: globalPcs } =
              computeGlobalContract(chord.type, chord.rootMidi);

          // Divisi 2.0 — Virtual Extension unlock. When the chord is in
          // 'SlashChord' state with virtualExtensions defined (e.g. F/G
          // exposes b7/9/11/13 of G as a suspended-dominant pool),
          // those tones become legal magnet targets even though they
          // aren't part of the upper chord's CHORD_TYPES contract. The
          // intervals are stored in semitones FROM THE BASS pitch, so
          // we add bassPc + interval to the candidate pcs and to a
          // separate vIntervalsFromBass list that the candidate-search
          // loop will consume below.
          const vIntervalsFromBass: number[] = [];
          if (chord.tensionState === 'SlashChord' && chord.virtualExtensions) {
              const bassPcLocal = (((chord.bassMidi % 12) + 12) % 12);
              for (const semis of chord.virtualExtensions) {
                  const pc = (((bassPcLocal + semis) % 12) + 12) % 12;
                  globalPcs.add(pc);
                  vIntervalsFromBass.push(semis);
              }
          }

          // Cadence-position guard — hoisted above the magnetism +
          // bass-decollision blocks so both can defer cleanly to
          // Cadence Resolution (Definition 4) at the phrase-end last
          // note. Re-checked redundantly in the Active Divisi block
          // for clarity at the trigger site.
          const isCadenceLastNote = shouldReturn && idx === mutatedMotif.length - 1;

          const isStable = globalPcs.has((((mNoteMidi) % 12) + 12) % 12);
          const isTension = !isStable && (
              isAvoidNote(pcInterval, chord.type, scaleNameForBar || undefined, isModalEnv, func)
              || (INTERVAL_AESTHETICS[pcInterval] && INTERVAL_AESTHETICS[pcInterval].tensionAmount > 0.5)
          );

          let resolved = false;

          // Sacred-boundary gate. Motif pitches are preserved verbatim
          // here. Cadence resolution (Definition 4, runs later) is the
          // single architectural exception that yields motif sacred at
          // phrase-end last notes; this magnetism block is responsible
          // only for non-cadence structural notes.
          const motifSacred = role === 'motif';

          // scaleNameForBar / scaleRootPcForBar 已在 generateBarPattern
          // 顶部 (line ~3825) 上提为函数级 scope, 这里直接复用.
          const scaleGravityRulesForBar = scaleNameForBar
              ? getScaleGravity(scaleNameForBar)
              : null;

          // ===========================================================
          // AND PIPELINE — single-pass constraint satisfaction
          //
          // Replaces the historical sequential override sequence
          // (Color Magnetism → VL Hold → VL Bridge → Bass Decollision
          // → VL Limits) with one pure decision: build candidate pool,
          // apply hard filters, score by soft preferences, pick best.
          // Deterministic randoms (sacred-allow gates) are pre-rolled
          // here so consumption order matches the legacy pipeline.
          // ===========================================================
          {
              // Pre-rolls (mirrors legacy random consumption order):
              //   1. Magnetism sacred-allow — random consumed but result
              //      no longer reads into shouldApply. Previously this
              //      gave sacred motif a 15% probability to keep an
              //      avoid note on a structural beat ("preserve motif
              //      color"). In practice this meant 15% of strong-
              //      beat avoid notes survived as-is and the listener
              //      heard them as "wrong". Authors who legitimately
              //      want a structural avoid note (e.g. b9 over m
              //      chord as deliberate tension) mark the motif note
              //      with `!` → bypassSnap flag → still escapes the
              //      no-avoid filter. Random consumption retained so
              //      the snapshot stream stays stable.
              //   2. Bass-decoll sacred-allow (only if sacred)
              const magnetSacredAllow = (motifSacred && isTension)
                  ? (this.random.next() < 0.85)
                  : true;
              void magnetSacredAllow;  // kept for stream stability; no longer consulted
              const bassDecollSacredAllow = motifSacred
                  ? (this.random.next() < 0.6)
                  : true;

              // (scaleGravityRulesForBar / scaleRootPcForBar declared
              //  at outer per-iteration scope so the post-emit state
              //  update can read them.)

              // Saturation tension info — passed to context for hard
              // filter "saturation-resolve".
              const projPcFromKey = ((mNoteMidi - rootKeyMidi) % 12 + 12) % 12;
              const saturatedPc = tensionTracker.isSaturated(projPcFromKey)
                  ? projPcFromKey : null;

              const ctx: NoteContext = {
                  chord, prevChord, nextChord, runScale,
                  globalIntervals, vIntervalsFromBass, literalIntervals,
                  barBackboneTargets,
                  voiceLeadingIn: null,  // not threaded down; closest-pair handles VL
                  voiceLeadingOut: null,
                  motifProjMidi: mNoteMidi,
                  lastNoteMidi,
                  isStructural: isStructuralNote,
                  isStrongBeat,
                  isFirstNote: idx === 0,
                  isLastNote: idx === mutatedMotif.length - 1,
                  isPhraseEnd: ((barIndex + 1) % (motifInterval || 4) === 0)
                      || (barIndex === totalBars - 1),
                  isMotifSacred: motifSacred,
                  isCadencePosition: isCadenceLastNote,
                  cadenceTargetPcs: null,    // computed in cadence stage below
                  cadenceMode: 'none',
                  saturatedTensionPcFromKey: saturatedPc,
                  urgentTensionPcFromKey: null,  // tension correction kept as separate stage
                  tensionResolveProb: 0,
                  tensionResolveRoll: 1,
                  chordRootPc: ((chord.rootMidi % 12) + 12) % 12,
                  bassPc: ((chord.bassMidi % 12) + 12) % 12,
                  keyRootPc: ((rootKeyMidi % 12) + 12) % 12,
                  rootKeyMidi,
                  complexity,
                  lastLeapSemis: melodyState.lastLeapSemis,
                  sameDirRunLength: melodyState.sameDirRunLength,
                  stepCount: melodyState.stepCount,
                  leapCount: melodyState.leapCount,
                  apexBarIdx: this.songApexBarIdx,
                  apexPitchMidi: this.songApexPitchMidi,
                  isApexBar: this.songApexBarIdx >= 0 && barIndex === this.songApexBarIdx,
                  isApexPhraseBar: this.songApexPhraseStartBar >= 0
                      && barIndex >= this.songApexPhraseStartBar
                      && barIndex <= this.songApexPhraseEndBar,
                  barIndex,
                  scaleGravityRules: scaleGravityRulesForBar,
                  scaleRootPc: scaleRootPcForBar,
                  gravityStrictness: this.songGravityStrictness,
                  effectiveFunc: chord.effectiveFunc ?? func,
                  bypassSnap: !!m.bypassSnap,
                  isModalContext: isModalEnv,
                  scaleNameForBar: scaleNameForBar || undefined,
                  style,
                  noteDuration: m.d,
              };

              // ===== Hard Filters =====
              const hardFilters: HardConstraint[] = [
                  // Universal range — replaces the legacy range clamp.
                  { name: 'in-melody-range',
                    shouldApply: () => true,
                    accept: (m) => m >= MELODY_RANGE.LOW && m <= MELODY_RANGE.HIGH },
                  // Avoid-note ban on structural beats (chord-quality-aware).
                  // Sacred motif yields when magnetSacredAllow is false.
                  // bypassSnap (per motif-note "!" suffix) overrides —
                  // author's explicit color statement.
                  { name: 'no-avoid',
                    shouldApply: (c) => c.isStructural
                        && !c.bypassSnap,
                    accept: (m, c) => {
                        const pc = ((m % 12) + 12) % 12;
                        const iv = ((pc - c.chordRootPc + 12) % 12);
                        return !isAvoidNote(iv, c.chord.type, c.scaleNameForBar, c.isModalContext, c.effectiveFunc);
                    } },
                  // ABSOLUTE PRIORITY — backbone + global harmony.
                  // At structural positions (strong beat / long /
                  // phrase-end) the melody MUST land in the chord
                  // contract = literal pcs ∪ admissible color
                  // extensions ∪ Composite-state virtual extensions.
                  // No other rule (apex / leap-recovery / step-leap /
                  // anything) is allowed to violate this — INCLUDING
                  // sacred motif. Per user:
                  // "骨干音的选择一定绝对优先,不能变,然后是全局和声原则,
                  //  这不能变". Placed right after no-avoid so it has
                  // top relax-priority — the LAST hard filter to drop
                  // is the contract guarantee. Sacred motif's non-
                  // contract structural pitches will be reshaped here;
                  // motif character at non-structural positions
                  // (passing 16ths) is unaffected.
                  { name: 'in-chord-contract',
                    shouldApply: (c) => c.isStructural && !c.bypassSnap,
                    accept: (m, c) => {
                        const pc = ((m % 12) + 12) % 12;
                        const root = c.chordRootPc;
                        // chord literal — always in contract
                        for (const iv of c.literalIntervals) {
                            if ((root + iv) % 12 === pc) return true;
                        }
                        // admissible color extensions (full contract)
                        for (const iv of c.globalIntervals) {
                            if ((root + iv) % 12 === pc) return true;
                        }
                        // Composite-state virtual extensions (reckoned
                        // from bass pc)
                        for (const semis of c.vIntervalsFromBass) {
                            if ((c.bassPc + semis) % 12 === pc) return true;
                        }
                        return false;
                    } },
                  // Octave-leap cap — replaces VL Limits L9.
                  { name: 'leap-octave-cap',
                    shouldApply: (c) => !c.isMotifSacred,
                    accept: (m, c) => Math.abs(m - c.lastNoteMidi) <= 12 },
                  // PC-dedupe — candidate pc must NOT equal previous
                  // emit's pc. The in-chord-contract constraint above
                  // forces structural notes onto a small chord-literal
                  // set (4-5 pcs); without pc-dedupe, multiple stepwise
                  // motif steps that snap to the closest chord-tone
                  // produce identical-pc clusters (audited as 5-13
                  // consecutive same-pc events). One step's worth of
                  // pc variance per emit is enough to break monotony
                  // while still allowing octave-displaced repeats
                  // (same pc at different octave is two distinct
                  // melody notes; the check is strict pc equality at
                  // the same octave).
                  //
                  // Sacred motif yields — if motif intentionally
                  // repeats a pc (rare in random fallback, common in
                  // hook-style motifs), let it through.
                  { name: 'no-same-pc-repeat',
                    shouldApply: (c) => !c.isMotifSacred && c.lastNoteMidi > 0,
                    accept: (m, c) => {
                        const pcNew = ((m % 12) + 12) % 12;
                        const pcPrev = ((c.lastNoteMidi % 12) + 12) % 12;
                        return pcNew !== pcPrev;
                    } },
                  // Saturation forced resolve — replaces L4 saturation
                  // block. When same-pc tension count == 2, candidate
                  // must be on a resolution target ∪ chord literal pcs.
                  { name: 'saturation-resolve',
                    shouldApply: (c) => !c.isMotifSacred && c.saturatedTensionPcFromKey !== null,
                    accept: (m, c) => {
                        const pc = ((m % 12) + 12) % 12;
                        const targets = getResolutionTargets(c.saturatedTensionPcFromKey!);
                        const absoluteTargets = new Set(targets.map(t =>
                            ((c.keyRootPc + t) % 12 + 12) % 12));
                        for (const iv of c.literalIntervals)
                            absoluteTargets.add((c.chordRootPc + iv) % 12);
                        return absoluteTargets.has(pc);
                    } },
                  // Unified tension resolution — the only hard
                  // constraint reading the evaluator's authoritative
                  // assessment of the previous emit. When the prior
                  // note's urgency exceeds UNRESOLVED_TENSION_THRESHOLD,
                  // the next note MUST land in that assessment's
                  // resolutionTargets (same-chord literal + next-chord
                  // anchor + key-relative expectedResolutions).
                  //
                  // Covers all five resolution paths the user laid out:
                  //   - Passing / Neighbor: prev dissonant within same
                  //     chord → next must step into resolutionTargets.
                  //     Direction (same vs opposite) handled by the
                  //     voice-leading constraint, not this one.
                  //   - Appoggiatura: large leap onto strong-beat
                  //     dissonance → assessment.urgency high → same
                  //     forced step-down to resolutionTargets.
                  //   - Suspension: prev consonant on old chord →
                  //     chord changes mid-hold → new evaluator pass
                  //     reports tension + urgency → next forced to
                  //     resolutionTargets. (State update below re-
                  //     evaluates against the CURRENT chord, so the
                  //     suspension trigger is automatic.)
                  //   - Harmonic Catch: prev dissonant on old chord
                  //     → chord changes → new evaluator pass on the
                  //     prior pitch under the NEW chord may report
                  //     consonance → urgency drops to 0 → constraint
                  //     doesn't fire. The note may stay; the catch
                  //     happened. (Handled in the state-update path
                  //     by re-assessing on chord change.)
                  //
                  // Sacred motif yields — same architectural reason
                  // as cadence resolution (Tier A/B/C): when global
                  // harmony declares an unresolved tendency, motif
                  // preservation steps aside at exactly one pitch.
                  { name: 'unified-tension-resolution',
                    shouldApply: () =>
                        melodyState.lastEmitAssessment !== null
                        && melodyState.lastEmitAssessment.urgency >= UNRESOLVED_TENSION_THRESHOLD,
                    accept: (m) => {
                        const pc = ((m % 12) + 12) % 12;
                        return melodyState.lastEmitAssessment!.resolutionTargets.includes(pc);
                    } },
                  // Cross-octave m9 / b9 physical clash filter. A melody
                  // pitch sitting exactly 13 semitones (minor 9th) above
                  // OR below any currently-sounding voicing MIDI produces
                  // an audibly harsh frequency-domain beat — the listener
                  // hears it as a low-register half-step grind even
                  // though pc-level the two notes are "the same scale
                  // tone an octave apart" (m9 is the octave-expanded m2).
                  // This was the 23-event "m9 clash" symptom audited
                  // across JAZZ + RNB seeds: melody legitimately landed
                  // on a chord-tone (e.g. Fm9's Ab as b3 of the chord
                  // = CHORD_TONE) while the voicing already held the 9
                  // (G4) → G4 + Ab5 = m9 grind.
                  //
                  // Sacred motif yields here — same architectural reason
                  // as cadence resolution and the tension-resolution
                  // constraint: physical acoustic clash overrides motif
                  // pitch preservation at exactly one note.
                  { name: 'no-cross-octave-m9',
                    shouldApply: () => true,
                    accept: (m, c) => {
                        // Authoritative MIDI source. Re-parsing notes[]
                        // through noteToMidi was the legacy fallback;
                        // notesMidi is the source-of-truth populated by
                        // realizeProgression.
                        const voicingMidis = c.chord.notesMidi
                            ?? c.chord.notes.map(n => noteToMidi(n));
                        for (const vMidi of voicingMidis) {
                            const diff = m - vMidi;
                            if (diff === 13 || diff === -13) return false;
                        }
                        return true;
                    } },
                  // Rule 9 — Leap Recovery. After a leap ≥ 5 semis,
                  // the next emitted note must move ≤ 2 semis in the
                  // OPPOSITE direction (or hold). This is the classical
                  // "law of recovery" — Bach chorales / Mozart melodies
                  // virtually 100% obey it. Sacred motif yields (the
                  // canonical lick may have intentional consecutive
                  // leaps as a gesture). Only applies when there's a
                  // recorded prior leap (lastLeapSemis !== 0); first
                  // note of song is exempt.
                  { name: 'leap-recovery',
                    shouldApply: (c) => !c.isMotifSacred
                        && Math.abs(c.lastLeapSemis) >= 5,
                    accept: (m, c) => {
                        const step = m - c.lastNoteMidi;
                        const prevDir = Math.sign(c.lastLeapSemis);
                        // Step must be opposite (or zero), and small.
                        if (step === 0) return true; // hold is fine
                        const sameDir = Math.sign(step) === prevDir;
                        if (sameDir) return false;   // continuing same direction = ban
                        return Math.abs(step) <= 2;  // recovery must be ≤ M2
                    } },
                  // Rule 11 — Anti-Monotonicity. Forbid 5+ consecutive
                  // same-direction motions. After 4 same-direction
                  // steps, this note must reverse or hold (= step in
                  // opposite direction OR = 0).
                  { name: 'anti-monotonicity',
                    shouldApply: (c) => !c.isMotifSacred
                        && c.sameDirRunLength >= 4,
                    accept: (m, c) => {
                        const step = m - c.lastNoteMidi;
                        if (step === 0) return true;
                        const lastDir = Math.sign(c.lastLeapSemis);
                        return Math.sign(step) !== lastDir;
                    } },
                  // Rule 10 — Apex Headroom (hard constraint at
                  // structural positions). At non-apex bars, structural
                  // notes (strong beat / long / phrase-end) must stay
                  // below the planned apex pitch. Passing tones (16th
                  // runs) are exempt — listener perceives apex as the
                  // longest emphasized pitch, not the highest 16th.
                  // Applies to sacred motif too: relaxation falls back
                  // to motif intent only when no in-scale candidate
                  // exists below apex, preserving motif when truly
                  // forced. Otherwise the constraint pulls structural
                  // peaks of non-apex bars below the song's apex
                  // pitch — guaranteeing apex singularity.
                  { name: 'apex-headroom',
                    shouldApply: (c) => c.apexBarIdx >= 0 && !c.isApexBar
                        && c.apexPitchMidi > 0 && c.isStructural,
                    accept: (m, c) => m < c.apexPitchMidi },
                  // 老师哲学 (升级): 回归是过程不是事件 — 4-2-3 / 4-5-3 /
                  // 4-1-3-2-1 等多音 / 包围回归全合法. 旧的单步 hard
                  // 强制 (resolve-leading-tone / resolve-four) 已删.
                  // key-relative 4/7 是否色彩取决于当前 chord 上下文 —
                  // 这层判定现在由 evaluateNoteInChordContext 实时给出,
                  // 由 unified-tension-resolution hard constraint 消费.
                  //
                  // scale-gravity 也升级到 line-based — pendingScaleLine
                  // 跟踪开窗时间 + line 尾, accept = stepwise from tail
                  // OR pc match scale target. 多音回归 / 包围回归 OK.
                  // 4 拍窗口期满未解决 → expire (听感张力散).
                  // 其他 hard filter (in-chord-contract 等) 仍主导
                  // structural backbone 判定.
                  { name: 'scale-gravity-line',
                    shouldApply: (c) => melodyState.pendingScaleResolveTarget !== null
                        && melodyState.pendingScaleLineWindowEnd > 0
                        && absTime <= melodyState.pendingScaleLineWindowEnd
                        && c.gravityStrictness >= 0.45
                        && melodyState.pendingScaleResolveScore >= 18,
                    accept: (m) => {
                        const target = melodyState.pendingScaleResolveTarget!;
                        const rootPc = melodyState.pendingScaleResolveRootPc;
                        const pc = ((m % 12) + 12) % 12;
                        const iv = ((pc - rootPc + 12) % 12);
                        // (a) Resolution — pc on scale target
                        if (iv === target) return true;
                        // (b) Stepwise continuation — must be ≤ 2 semis
                        // AND must close in on (or hold steady against)
                        // the gravity target. Step-size-only ignores
                        // direction: from Ab leading down to G, both
                        // Ab→A and Ab→G are ≤ 2 semis, but Ab→A walks
                        // AWAY from the target — direction-blind
                        // approval lets the line ping-pong instead of
                        // resolving. Pick the nearest target MIDI to
                        // the prior step's pitch and require the new
                        // candidate is no further from it.
                        const lastMidi = melodyState.pendingScaleLineLastMidi;
                        if (Math.abs(m - lastMidi) > 2) return false;
                        let nearestTargetMidi = -999;
                        let nearestDist = Infinity;
                        for (let cand = target; cand < 128; cand += 12) {
                            const d = Math.abs(cand - lastMidi);
                            if (d < nearestDist) {
                                nearestDist = d;
                                nearestTargetMidi = cand;
                            }
                        }
                        if (nearestTargetMidi < 0) return true; // defensive
                        const oldDist = Math.abs(lastMidi - nearestTargetMidi);
                        const newDist = Math.abs(m - nearestTargetMidi);
                        return newDist <= oldDist;
                    } },
                  // Color-line — 老师哲理: 9/11/13/7 (high-voice color)
                  // open a tension WINDOW. Resolution is a process, not
                  // a single event. Inside the window the candidate
                  // must EITHER:
                  //   (a) land on chord 1/3/5 pitch-class at any octave
                  //       — the line resolves, pending clears; OR
                  //   (b) be ≤ 2 semis from the line's tail — the line
                  //       continues stepwise (passing tone, 16th run,
                  //       enclosure, half-step approach, etc.).
                  // Anything else (leap into more color) breaks the
                  // line and is rejected.
                  // Window width is 4 beats — listener tension memory.
                  // Past windowEnd shouldApply returns false (tension
                  // dissipated). Cadence position yields to Tier A/B/C.
                  // Applies to ALL emits not just structural — passing
                  // tones and 16th runs are part of the line.
                  // 老师哲学: phrase end 最后一个音绝对不能是未解决的
                  // avoid (= 落"句尾稳定位"上的避讳音 = 听感塌). cadence
                  // position 由 Tier A/B/C 接管, 这里只补 non-cadence
                  // phrase end (= phraseShouldReturn false 的 phrase end).
                  { name: 'phrase-end-no-unresolved-avoid',
                    shouldApply: (c) => c.isPhraseEnd && c.isLastNote
                        && !c.isCadencePosition,
                    accept: (m, c) => {
                        const pc = ((m % 12) + 12) % 12;
                        const runPcs = new Set<number>(c.runScale.map(sm => ((sm % 12) + 12) % 12));
                        const role = classifyNoteRole(
                            pc,
                            c.chord.type,
                            c.chordRootPc,
                            c.scaleNameForBar || '',
                            c.isModalContext,
                            c.effectiveFunc,
                            c.scaleRootPc,
                            runPcs,
                        );
                        return role !== 'avoid';
                    } },
                  { name: 'color-line',
                    shouldApply: (c) => melodyState.pendingColorLine !== null
                        && absTime <= melodyState.pendingColorLine.windowEnd
                        && !c.isCadencePosition,
                    accept: (m, c) => {
                        const line = melodyState.pendingColorLine!;
                        const pc = ((m % 12) + 12) % 12;
                        // (a) Resolution — pc on chord 1/3/5 any octave
                        const chordTriad = getChordBackboneIntervals(c.chord.type);
                        for (const iv of chordTriad) {
                            if ((c.chordRootPc + iv) % 12 === pc) return true;
                        }
                        // (b) Stepwise continuation
                        return Math.abs(m - line.lineLastMidi) <= 2;
                    } },
              ];

              // ===== Soft Scores =====
              const softScores: SoftScore[] = [
                  // Color Magnetism — prefer chord literal at structural beats
                  { name: 'in-chord-literal', weight: 2.0,
                    shouldApply: (c) => c.isStructural,
                    score: (m, c) => {
                        const pc = ((m % 12) + 12) % 12;
                        for (const iv of c.literalIntervals) {
                            if ((c.chordRootPc + iv) % 12 === pc) return 1;
                        }
                        return 0;
                    } },
                  // Admissible color (in contract but not literal)
                  { name: 'in-admissible-color', weight: 1.0,
                    shouldApply: (c) => c.isStructural,
                    score: (m, c) => {
                        const pc = ((m % 12) + 12) % 12;
                        let inLit = false;
                        for (const iv of c.literalIntervals) {
                            if ((c.chordRootPc + iv) % 12 === pc) { inLit = true; break; }
                        }
                        if (inLit) return 0;
                        for (const iv of c.globalIntervals) {
                            if ((c.chordRootPc + iv) % 12 === pc) return 1;
                        }
                        for (const semis of c.vIntervalsFromBass) {
                            if ((c.bassPc + semis) % 12 === pc) return 1;
                        }
                        return 0;
                    } },
                  // Top color tone — chord type's highest extension
                  // (m9's 9, 13's 13, etc.) when complexity ≥ 0.5.
                  // Implements the Divisi 2.0 "magnet upper-extension"
                  // bias.
                  { name: 'top-color-bonus', weight: 1.5,
                    shouldApply: (c) => c.isStructural && c.complexity >= 0.5
                        && c.literalIntervals.length > 4,
                    score: (m, c) => {
                        const topIv = c.literalIntervals[c.literalIntervals.length - 1];
                        const topPc = (c.chordRootPc + topIv) % 12;
                        const pc = ((m % 12) + 12) % 12;
                        return pc === topPc ? 1 : 0;
                    } },
                  // Method 2 last-note → pcA of closest cross-chord pair
                  { name: 'closest-pair-pcA', weight: 1.5,
                    shouldApply: (c) => c.isLastNote && c.nextChord !== null,
                    score: (m, c) => {
                        const projPc = ((c.motifProjMidi % 12) + 12) % 12;
                        const { pcA } = findClosestCrossChordPair(c.chord, c.nextChord!, projPc);
                        const pc = ((m % 12) + 12) % 12;
                        return pc === pcA ? 1 : 0;
                    } },
                  // Method 2 first-note → pcB of closest cross-chord pair
                  // (only when the natural projection would leap ≥ 4)
                  { name: 'closest-pair-pcB', weight: 1.0,
                    shouldApply: (c) => c.isFirstNote && c.prevChord !== null
                        && Math.abs(c.motifProjMidi - c.lastNoteMidi) >= 4,
                    score: (m, c) => {
                        const prevPc = ((c.lastNoteMidi % 12) + 12) % 12;
                        const { pcB } = findClosestCrossChordPair(c.prevChord!, c.chord, prevPc);
                        const pc = ((m % 12) + 12) % 12;
                        return pc === pcB ? 1 : 0;
                    } },
                  // Bass decollision — penalize melody pc == bass pc
                  // on structural beats. Sacred motif yields when
                  // bassDecollSacredAllow is false.
                  { name: 'avoid-bass-unison', weight: 1.0,
                    shouldApply: (c) => c.isStructural
                        && (!c.isMotifSacred || bassDecollSacredAllow),
                    score: (m, c) => {
                        const pc = ((m % 12) + 12) % 12;
                        return pc === c.bassPc ? -1 : 0;
                    } },
                  // Rule 8 — Step/Leap distribution bias toward 70-80%
                  // step. Tracks running ratio across the song; biases
                  // candidates that maintain target distribution.
                  // - When ratio < 0.70 (leap-heavy), step candidates
                  //   (≤ 2 semis from prev) get +1 bonus.
                  // - When ratio > 0.85 (over-step), leap candidates
                  //   (≥ 3 semis) get +0.4 bonus.
                  // - Within target band (0.70-0.85), no preference.
                  // First few notes (total < 4) default to "prefer step"
                  // for natural melodic motion.
                  { name: 'step-leap-distribution', weight: 1.5,
                    shouldApply: (c) => !c.isFirstNote && !c.isMotifSacred,
                    score: (m, c) => {
                        const total = c.stepCount + c.leapCount;
                        const ratio = total > 0 ? c.stepCount / total : 0.75;
                        const stepLikeNeeded = total < 4 || ratio < 0.70;
                        const leapLikeNeeded = ratio > 0.85;
                        const stepFromPrev = Math.abs(m - c.lastNoteMidi);
                        const isStep = stepFromPrev > 0 && stepFromPrev <= 2;
                        const isLeap = stepFromPrev >= 3;
                        if (stepLikeNeeded && isStep) return 1;
                        if (leapLikeNeeded && isLeap) return 0.4;
                        return 0;
                    } },
                  // Scale Gravity (universal physics). When the
                  // PREVIOUS emitted note triggered a fromInterval in
                  // SCALE_GRAVITY[scaleName], that gravity points at
                  // a target interval. This score rewards candidates
                  // landing on the target. Weight is dynamic via
                  // gravityStrictness × rule.score / 25 (rule scores
                  // are 0-30; we normalize). Style.gravityStrictness
                  // (0..1) controls how much the engine obeys the
                  // physics: POP 0.85 strict, JAZZ 0.35 loose.
                  { name: 'scale-gravity-target', weight: 1.0,
                    shouldApply: (c) => c.scaleGravityRules !== null
                        && c.scaleRootPc >= 0
                        && melodyState.pendingScaleResolveTarget !== null
                        && melodyState.pendingScaleResolveScore > 0,
                    score: (m) => {
                        const target = melodyState.pendingScaleResolveTarget!;
                        const pc = ((m % 12) + 12) % 12;
                        const intervalFromScaleRoot = ((pc - melodyState.pendingScaleResolveRootPc + 12) % 12);
                        if (intervalFromScaleRoot === target) {
                            // Score = rule.score × strictness, normalized to ~ 0-1.5 range.
                            return melodyState.pendingScaleResolveScore / 25
                                * this.songGravityStrictness;
                        }
                        return 0;
                    } },
                  // Rule 10 — Apex target. At the planned apex bar
                  // (golden-ratio position 60-75% of song), a strong
                  // bonus pulls the highest structural note onto the
                  // pre-planned apex pitch. Only fires on structural
                  // beats so passing tones are unaffected.
                  { name: 'apex-target', weight: 4.0,
                    shouldApply: (c) => c.isApexBar && c.isStructural
                        && c.apexPitchMidi > 0,
                    score: (m, c) => m === c.apexPitchMidi ? 1 : 0 },
                  // Phrase register — apex phrase 整段抬高基线音区.
                  // 老师 E: apex 不是单点, 是整 phrase 的 register
                  // baseline. apex phrase 内任何 structural 候选, midi
                  // 在 apexPitch ± 5 半音窗内得分 1, 距离窗外按线性
                  // 衰减. apex bar 自身已被 apex-target 4.0 主导;
                  // 此 score (weight 1.5) 抬高 apex phrase 内非 apex
                  // bar 的整体音区, 不会喧宾夺主.
                  { name: 'phrase-register-target', weight: 1.5,
                    shouldApply: (c) => c.isApexPhraseBar && !c.isApexBar
                        && c.isStructural && c.apexPitchMidi > 0,
                    score: (m, c) => {
                        const target = c.apexPitchMidi;
                        const d = Math.abs(m - target);
                        if (d <= 5) return 1;
                        if (d >= 12) return 0;
                        return 1 - (d - 5) / 7;
                    } },
                  // 老师哲学落地: 音的角色 × 位置评分.
                  // 5 类角色 base 分:
                  //   chord_tone      +1.0  — 强拍长音首选
                  //   stable_tension  +0.5  — 可以但比 chord 音弱
                  //   characteristic  ±0.4  — 调式 +0.4 / 调性 -0.2
                  //                            (调性下特征音降级)
                  //   avoid           -0.8  — 弱拍短音 OK, 强拍长音重罚
                  //   chromatic       -0.6  — 半音装饰只在短时值
                  // 位置乘数:
                  //   strong beat    ×2
                  //   long (d≥1)     ×2
                  //   phrase-end last ×3
                  // 综合: chord 音 强拍长音 +1.0×4 = +4 强奖励;
                  //       avoid 强拍长音 -0.8×4 = -3.2 强惩罚;
                  //       avoid 弱拍 -0.8×1 = -0.8 可接受 (经过).
                  // 老师哲学: 避讳音级进解决奖励 (4→3, b6→5, b2→1 通用化).
                  // 上一 emit 是 avoid + 当前候选 stepwise (≤2 半音) +
                  // 当前候选是 chord_tone → 强奖励. 这是"避讳音允许使用,
                  // 但要解决"路径的明确加分. weight 2.5 跟 role-by-position
                  // 协同 (前者 3.0 给方向, 这里 2.5 给解决路径加成).
                  { name: 'avoid-resolution-reward', weight: 2.5,
                    shouldApply: () => melodyState.lastEmitRole === 'avoid'
                        && melodyState.lastEmitMidi > 0,
                    score: (m, c) => {
                        const step = Math.abs(m - melodyState.lastEmitMidi);
                        if (step > 2) return 0;
                        const pc = ((m % 12) + 12) % 12;
                        const runPcs = new Set<number>(c.runScale.map(sm => ((sm % 12) + 12) % 12));
                        const role = classifyNoteRole(
                            pc,
                            c.chord.type,
                            c.chordRootPc,
                            c.scaleNameForBar || '',
                            c.isModalContext,
                            c.effectiveFunc,
                            c.scaleRootPc,
                            runPcs,
                        );
                        if (role === 'chord_tone') return 1.0;
                        if (role === 'stable_tension') return 0.4;
                        return 0;
                    } },
                  { name: 'note-role-by-position', weight: 3.0,
                    shouldApply: () => true,
                    score: (m, c) => {
                        const pc = ((m % 12) + 12) % 12;
                        const runPcs = new Set<number>(c.runScale.map(sm => ((sm % 12) + 12) % 12));
                        const role = classifyNoteRole(
                            pc,
                            c.chord.type,
                            c.chordRootPc,
                            c.scaleNameForBar || '',
                            c.isModalContext,
                            c.effectiveFunc,
                            c.scaleRootPc,
                            runPcs,
                        );
                        const base: Record<NoteRole, number> = {
                            chord_tone:     1.0,
                            stable_tension: 0.5,
                            characteristic: c.isModalContext ? 0.4 : -0.2,
                            avoid:          -0.8,
                            chromatic:      -0.6,
                        };
                        let mult = 1;
                        if (c.isStrongBeat) mult *= 2;
                        if (c.noteDuration >= 1.0) mult *= 2;
                        if (c.isPhraseEnd && c.isLastNote) mult *= 3;
                        return base[role] * mult;
                    } },
                  // BLUES stepwise-bonus — rewards candidates within ±2
                  // semitones of the previous emit so the line threads
                  // blues-scale tones (b3/3/4/b5/5/b7) in a continuous
                  // lick-flow rather than arpeggiating chord 1/3/5/7
                  // (which is what in-chord-literal at weight 2.0 would
                  // otherwise dominate). Heavier than step-leap-
                  // distribution's stepwise reward so it actually pulls
                  // the choice on structural beats too.
                  { name: 'blues-stepwise-bonus', weight: 3.0,
                    shouldApply: (c) => c.style === 'BLUES' && c.lastNoteMidi > 0,
                    score: (m, c) => {
                        const semis = Math.abs(m - c.lastNoteMidi);
                        if (semis === 0) return 0;        // same MIDI handled separately
                        if (semis <= 2) return 1;          // stepwise lick
                        if (semis <= 4) return 0.3;        // small leap, still flow
                        return 0;
                    } },
                  // Anti-bridge same-MIDI penalty — universal. The hard
                  // no-same-pc-repeat bans candidates whose PC equals
                  // the previous emit's PC; this soft penalty discourages
                  // identical-MIDI candidates that survive when the hard
                  // filter relaxes (sacred motif, sparse candidate pool),
                  // and also penalizes "octave bounce" (m === lastMidi
                  // ± 12) which sounds like a stutter. Strong enough to
                  // override marginal preferences but not load-bearing
                  // ones (in-chord-literal weight 2.0 still wins when
                  // the only stepwise option lies outside contract).
                  { name: 'same-midi-bridge-penalty', weight: 1.2,
                    // BLUES + RNB only — these styles have repetition-
                    // heavy motif fallbacks and color-tone wallpapering
                    // tendencies. JAZZ + POP main pipelines already
                    // distribute candidates well; adding the penalty
                    // there cost ~4% melodyOK% (3 notes / song push out
                    // of contract) for no measurable shape benefit.
                    shouldApply: (c) => (c.style === 'BLUES' || c.style === 'RNB')
                        && c.lastNoteMidi > 0 && !c.isFirstNote,
                    score: (m, c) => {
                        if (m === c.lastNoteMidi) return -1;
                        if (m === c.lastNoteMidi + 12 || m === c.lastNoteMidi - 12) return -0.6;
                        return 0;
                    } },
              ];

              const newMidi = this.selectBestMidi(ctx, hardFilters, softScores);
              if (newMidi !== mNoteMidi) {
                  mNoteMidi = newMidi;
                  resolved = true;
                  pcInterval = (mNoteMidi - chordRootMidi) % 12;
                  if (pcInterval < 0) pcInterval += 12;
              }
          }


          // Texture–melody collision avoidance with 50/50 skip-or-shift.
          // Per architecture rule "如果伴奏和旋律有相同的音符，则旋律50%概率
          // 不使用这个音符". When the melody pitch matches an active texture
          // note, half the time we drop the melody event entirely (silence
          // for that beat — the texture chord covers the rhythm), the other
          // half we shift up one scale step (existing behaviour). Sacred
          // motif notes opt out — the canonical melody shape is preserved.
          let skipThisNote = false;
          if (!resolved && !motifSacred) {
              const collidingTexMidis = new Set<number>();
              for (const te of textureEvents) {
                  if (Math.abs(te.time - absTime) < 0.1) collidingTexMidis.add(te.noteNumber);
              }
              if (collidingTexMidis.has(mNoteMidi)) {
                  if (this.random.next() < 0.5) {
                      skipThisNote = true;
                  } else {
                      // Step-up to next runScale tone. Validate the
                      // replacement against the same musical contract
                      // the per-note pipeline enforced — runScale
                      // contains scale tones some of which are avoid
                      // notes or sit outside the chord contract, and
                      // an unchecked step-up can land the structural
                      // beat on either. If the candidate fails, keep
                      // the original (collision tolerated) rather than
                      // silently writing the wrong note.
                      const tryIndex = runScale.indexOf(mNoteMidi) + 1;
                      if (tryIndex > 0 && tryIndex < runScale.length) {
                          const candidate = runScale[tryIndex];
                          const candPc = ((candidate % 12) + 12) % 12;
                          const ivFromRoot = ((candPc - ((chord.rootMidi % 12) + 12) % 12) + 12) % 12;
                          const isAvoid = isStructuralNote && isAvoidNote(
                              ivFromRoot, chord.type, scaleNameForBar || undefined,
                              isModalEnv, chord.effectiveFunc ?? func,
                          );
                          const inContract = !isStructuralNote
                              || computeGlobalContract(chord.type, ((chord.rootMidi % 12) + 12) % 12).pcs.has(candPc);
                          if (!isAvoid && inContract) {
                              mNoteMidi = candidate;
                          }
                      }
                  }
              }
          }

          // Cadence Resolution (Definition 4 — dynamic context-aware
          // cadence). shouldReturn was decided at the song level by
          // style.returnRule (enabled / trigger / probabilityPerPhrase).
          // Sacred motif bars NO LONGER bail out — Definition 4 yields
          // sacred at the cadence position because the listener's
          // resolution expectation outranks pitch preservation.
          //
          // The tier classifier picks one of:
          //   A_global_T  → snap to global key root or 3 (剧终绝对回归)
          //   B_phrase_T  → snap to chord 1/3/5, no extensions (句号)
          //   C_phrase_DS → preserve tension if already in extended
          //                 contract; soft snap if not (问号 / 省略号)
          //
          // forceReturnHere upgrades the event's origin tag to 'return'
          // so the audit can count cadential rewrites separately.
          let forceReturnHere = false;
          // Divisi 2.0 — Cadence intercept. When the chord is in
          // 'FirstInversion' or 'Cadential64' state, the bass is sliding
          // (3rd in bass) or building tension (5th in bass / 6/4),
          // and a hard snap to 1/3/5 here cancels the harmonic
          // motion the listener is tracking. Skip Cadence Resolution
          // on those states — the melody continues to flow and lands
          // organically.
          //
          // EXCEPTION: at the song's final bar (`isLast`), cadence
          // ALWAYS fires regardless of state. Per the user's
          // architectural priority "return-to-stable is highest",
          // the song must close — Tier A handles T-function landings
          // on key tonic; Tier C handles D/S landings via
          // preserve-tension which naturally accommodates flowing
          // states without forcing a hard snap.
          // Cadence is blocked only by REAL flowing inversions — bass on
          // the 3rd (FirstInversion proper) or 5th (SecondInversion /
          // Cadential64). evaluateTensionState's fallback also tags
          // 7th-in-bass and other non-3rd shells as 'FirstInversion'
          // (see musicTheory.ts), but those aren't flowing inversions —
          // they're slash-flavored harmonies whose phrase endings
          // should still receive cadence resolution.
          const cadRootPc = ((chord.rootMidi % 12) + 12) % 12;
          const cadBassPc = ((chord.bassMidi % 12) + 12) % 12;
          const cadBassIvToRoot = ((cadBassPc - cadRootPc + 12) % 12);
          const isRealFirstInversion = chord.tensionState === 'FirstInversion'
              && (cadBassIvToRoot === 3 || cadBassIvToRoot === 4);
          const cadenceBlocked = !isLast && (
              isRealFirstInversion
              || chord.tensionState === 'SecondInversion'
              || chord.tensionState === 'Cadential64'
          );
          if (shouldReturn && idx === mutatedMotif.length - 1 && !cadenceBlocked) {
              const isGlobalEnd = isLast;
              const isLastChordT = isLast && func === 'T';
              const tier = classifyCadenceTier({
                  isGlobalEnd,
                  isPhraseEndNote: true,
                  func,
                  isLastChordT,
                  phraseRole,
              });
              if (tier !== 'none') {
                  const keyRootPc = noteToMidi(musicKey + "0") % 12;
                  const keyIsMinor = musicMode === 'Minor' || musicMode === 'Aeolian';
                  const { pcs: targetPcs, mode } = cadenceTargetPcs(
                      tier, chord.type, chord.rootMidi % 12,
                      { keyRootPc, keyIsMinor }
                  );
                  const currentPc = (((mNoteMidi) % 12) + 12) % 12;
                  const shouldSnap = mode === 'force' || !targetPcs.has(currentPc);
                  if (shouldSnap && targetPcs.size > 0) {
                      mNoteMidi = snapMidiToNearestPc(mNoteMidi, targetPcs, runScale);
                      forceReturnHere = true;
                  }
              }
          }

          // Saturation block — if the projected pitch's pc is a tension
          // already at MAX_OCCURRENCES (= 2) and unresolved within the
          // current harmonic cycle, REFUSE the 3rd same-pc emission.
          // Magnetize to a chord-aware resolution target instead. This
          // is the "最多 2 次" hard cap — independent of style strictness,
          // independent of structural-note gate. A 3rd 7 in a row over
          // an unresolved cycle becomes 1; a 3rd F (4th) over Cmaj
          // becomes E or C (whichever is closest chord tone).
          {
              const projectedPc = ((mNoteMidi - rootKeyMidi) % 12 + 12) % 12;
              if (!motifSacred && tensionTracker.isSaturated(projectedPc)) {
                  const targets = getResolutionTargets(projectedPc);
                  // Add chord-literal pcs (relative to KEY root, since the
                  // tracker speaks in key-relative pcs).
                  const chordRootPcAbs = ((chord.rootMidi % 12) + 12) % 12;
                  const keyRootPcAbs = ((rootKeyMidi % 12) + 12) % 12;
                  for (const iv of literalIntervals) {
                      const absPc = (chordRootPcAbs + iv) % 12;
                      const fromKey = ((absPc - keyRootPcAbs) % 12 + 12) % 12;
                      if (!targets.includes(fromKey)) targets.push(fromKey);
                  }
                  if (targets.length > 0) {
                      const baseOct = Math.floor(mNoteMidi / 12);
                      let best = mNoteMidi;
                      let bestDist = Infinity;
                      for (const tPc of targets) {
                          const absPc = ((rootKeyMidi + tPc) % 12 + 12) % 12;
                          for (let oct = -1; oct <= 1; oct++) {
                              const cand = absPc + (baseOct + oct) * 12;
                              const d = Math.abs(cand - mNoteMidi);
                              if (d < bestDist) { bestDist = d; best = cand; }
                          }
                      }
                      // Wider clamp than soft corrective (≤6) since this is
                      // a hard cap — must move; ±6 is still within a
                      // tritone, no violent leap.
                      if (bestDist <= 6 && bestDist > 0) {
                          mNoteMidi = getClosestScaleMidi(best, runScale, 0);
                      }
                  }
              }
          }

          // Tension-driven correction (count == 1, soft pressure):
          // probability-gated by the style's tensionResolutionStrictness.
          // POP / cadence-driven styles (0.7) snap aggressively; JAZZ /
          // ambient (0.15-0.3) leaves most tensions hanging — the
          // genre-defining "挂紧张" aesthetic. count == 2 is handled by
          // the saturation block above (mandatory, no probability).
          let correctedToResolution = false;
          if (!motifSacred && isStructuralNote) {
              const urgent = tensionTracker.getMostUrgentTension();
              if (urgent !== null) {
                  const profile = STYLE_DICTIONARY[style];
                  const strictness = profile?.tensionResolutionStrictness ?? 0.5;
                  if (this.random.next() < strictness) {
                      const targets = getResolutionTargets(urgent);
                      // Chord-aware: add current chord's literal pcs as
                      // resolution candidates (key-relative). Per user:
                      // "倾向解决到4或者0这个要根据当前和弦决定".
                      const chordRootPcAbs = ((chord.rootMidi % 12) + 12) % 12;
                      const keyRootPcAbs = ((rootKeyMidi % 12) + 12) % 12;
                      for (const iv of literalIntervals) {
                          const absPc = (chordRootPcAbs + iv) % 12;
                          const fromKey = ((absPc - keyRootPcAbs) % 12 + 12) % 12;
                          if (!targets.includes(fromKey)) targets.push(fromKey);
                      }
                      if (targets.length > 0) {
                          const baseOct = Math.floor(mNoteMidi / 12);
                          let best = mNoteMidi;
                          let bestDist = Infinity;
                          for (const targetPc of targets) {
                              const absPc = ((rootKeyMidi + targetPc) % 12 + 12) % 12;
                              for (let octShift = -1; octShift <= 1; octShift++) {
                                  const candidate = absPc + (baseOct + octShift) * 12;
                                  const d = Math.abs(candidate - mNoteMidi);
                                  if (d < bestDist) { bestDist = d; best = candidate; }
                              }
                          }
                          // Only snap when the resolution target is within
                          // a melodic step (≤ 4 semitones) — avoids violent
                          // octave jumps just to satisfy the tracker.
                          if (bestDist <= 4 && bestDist > 0) {
                              mNoteMidi = getClosestScaleMidi(best, runScale, 0);
                              correctedToResolution = true;
                          }
                      }
                  }
              }
          }

          // Feed the final pitch decision to TensionTracker. pcFromKey
          // is the pitch class relative to the song's key root, matching
          // INTERVAL_AESTHETICS' semitone-offsets-from-key-root
          // convention. checkResolution gets isStructural (only structural-
          // position notes count as "the listener heard the resolution
          // land") and the current chord's literal pcs (chord-aware
          // resolution per user direction).
          //
          // Gated by !skipThisNote: a skipped note never reaches the
          // listener, so it must not appear to resolve or add tension —
          // phantom notes would corrupt subsequent corrections.
          const pcFromKey = ((mNoteMidi - rootKeyMidi) % 12 + 12) % 12;
          if (!skipThisNote) {
              const chordRootPcForTracker = ((chord.rootMidi % 12) + 12) % 12;
              const keyRootPcForTracker = ((rootKeyMidi % 12) + 12) % 12;
              const chordLitFromKey = new Set<number>();
              for (const iv of literalIntervals) {
                  const absPc = (chordRootPcForTracker + iv) % 12;
                  chordLitFromKey.add(((absPc - keyRootPcForTracker) % 12 + 12) % 12);
              }
              tensionTracker.checkResolution(pcFromKey, isStructuralNote, chordLitFromKey);
              tensionTracker.addTension(pcFromKey, absTime);
          }

          const velocity = Math.max(0.4, Math.min(1.0, 0.6 + Math.sin((idx / mutatedMotif.length) * Math.PI) * 0.3 + (this.random.next() * 0.2)));
          
          let timeDiff = 0;
          let pitchDiff = 0;
          let absPitchDiff = 0;
          let lastAbsTime = absTime;

          if (idx > 0) {
              // motifMutator can insert chromatic-approach notes so
              // mutatedMotif may exceed motif.length. The previous-note
              // lookup must use mutatedMotif since idx is iterating it.
              const lastSwTime = applySwing(mutatedMotif[idx-1].t, isShuffle);
              lastAbsTime = startBeat + lastSwTime;
              timeDiff = absTime - lastAbsTime;
              pitchDiff = mNoteMidi - lastNoteMidi;
              absPitchDiff = Math.abs(pitchDiff);
          }

          // 老师: 装饰音过度滥用. 当前 ~7% melody note 是 grace, 实际
          // 演奏 1-3% 为合理. 收紧条件:
          //   - 跳进才装饰 (≥3 半音): 2 半音已经是步进, 不需"半音趋近"
          //   - 概率 25% (rand > 0.75): 真演奏 grace 不每跳必加
          const needsGraceNote = absPitchDiff >= 3 && absPitchDiff <= 5
              && timeDiff >= 0.5 && this.random.next() > 0.75;
          const passingNoteChance = absPitchDiff >= 3 && absPitchDiff <= 7 && timeDiff >= 1.0 && this.random.next() > 0.4;

          // Skip the passing tone when the destination note (mNoteMidi)
          // is being skipped — a passing tone is by definition the bridge
          // *between* lastNoteMidi and mNoteMidi, so removing the
          // destination leaves it dangling into silence.
          if (passingNoteChance && idx > 0 && !skipThisNote) {
              const passTime = lastAbsTime + (timeDiff / 2);
              // Passing tones snap to a 16th — the shortest standard
              // value. Any longer (e.g. timeDiff*0.25 unquantized) leaks
              // non-standard durations into the melody track and breaks
              // the QUANTIZED_DURATIONS contract for the whole pipeline.
              const passDur = 0.25;

              const avgPitch = lastNoteMidi + Math.round(pitchDiff / 2);
              let passPitchMidi = getClosestScaleMidi(avgPitch, runScale, 0);
              
              if (passPitchMidi === lastNoteMidi || passPitchMidi === mNoteMidi) {
                  passPitchMidi = getClosestScaleMidi(avgPitch, runScale, pitchDiff > 0 ? 1 : -1);
              }

              if (passPitchMidi !== lastNoteMidi && passPitchMidi !== mNoteMidi) {
                  // Range clamp passing tones too — they share the same
                  // playable window as the rest of the melody.
                  while (passPitchMidi > MELODY_RANGE.HIGH) passPitchMidi -= 12;
                  while (passPitchMidi < MELODY_RANGE.LOW) passPitchMidi += 12;
                  // Passing tones inserted between motif notes are always
                  // engine-derived connectors, never sacred — tag as develop
                  // even within a motif bar.
                  events.push({
                      noteNumber: passPitchMidi,
                      time: passTime,
                      duration: passDur,
                      velocity: Math.abs(Math.round(velocity * 0.85 * 127)),
                      part: 'melody',
                      origin: 'develop'
                  });
              }
          }

          // (Per-note Active Divisi Magnet was removed: pulling EVERY
          // note ≥ 0.25 beat onto the chord's top vacated extension
          // turned scalar runs into a single-pc repeat ("F-F-F-F-F"
          // on Cm11 with 8th notes). Color tones are decoration, not
          // wallpaper. The bar-level guarantor — at the end of
          // generateBarPattern, after Run Generator — provides the
          // architectural divisi guarantee by rewriting ONE note per
          // bar (the longest non-cadence develop/motif event) onto
          // the top vacated pc, and only when no note in the bar
          // already landed there. One declaration of color per bar
          // is enough for the listener to register the chord's full
          // type; more is repetition.)

          // Universal range clamp — bring shrill highs (> E6) and rumbly
          // lows (< A1) back into the melody window by octave-shifting.
          // Applies to ALL notes including sacred motif: octave shift
          // preserves the motif's interval relationships, only relocates
          // the register.
          while (mNoteMidi > MELODY_RANGE.HIGH) mNoteMidi -= 12;
          while (mNoteMidi < MELODY_RANGE.LOW) mNoteMidi += 12;

          // Cross-octave m9 escape. Any pitch sitting exactly 13 semis
          // (= m9 = octave-expanded m2) above or below a currently-
          // sounding voicing note creates an audible half-step grind
          // even when both pitches are pc-legitimate chord tones — the
          // canonical case is b3 of Cm9 (Eb5) sounding against the 9
          // (D4) one m9 apart.
          //
          // Anchor scoring's `no-cross-octave-m9` filter catches the
          // first-of-bar note; this catches mid-bar motif projections,
          // passing tones, run-generator inserts, and grace notes that
          // bypass anchor scoring. Sacred motif yields per the same
          // architectural rule as cadence resolution: physical
          // acoustic clash overrides pitch preservation.
          //
          // Strategy: shift ±12 (keeps pc identical → motif interval
          // pattern reads unchanged). Prefer whichever direction
          // escapes the clash and stays in MELODY_RANGE. If neither
          // works (rare — voicing covers both flanks), keep the
          // original — accepting the clash is preferable to dropping
          // out of range or destroying the motif's pc.
          {
              const voicingMidis = chord.notesMidi ?? chord.notes.map(n => noteToMidi(n));
              const formsM9 = (mid: number) =>
                  voicingMidis.some(v => mid - v === 13 || mid - v === -13);
              if (formsM9(mNoteMidi)) {
                  const candidates = [mNoteMidi - 12, mNoteMidi + 12];
                  const fix = candidates.find(c =>
                      c >= MELODY_RANGE.LOW && c <= MELODY_RANGE.HIGH && !formsM9(c)
                  );
                  if (fix !== undefined) mNoteMidi = fix;
              }
          }

          // Inherit the bar role onto each direct motif note. role==='rest'
          // never reaches this loop (mutatedMotif stays empty).
          // forceReturnHere (style.returnRule) and correctedToResolution
          // (TensionTracker corrective) both upgrade the note to 'return'.
          const eventOrigin: 'motif' | 'develop' | 'return' =
              (forceReturnHere || correctedToResolution) ? 'return'
              : role === 'develop' ? 'develop'
              : 'motif';

          // Humanization — break the "machine-gun" grid feel.
          //
          // velocity: the parabolic + jitter velocity from line 2118 is
          // already in [0.4, 1.0]. Heavy accent mode used to hard-clamp
          // downbeats to 127 (the sample's loudest layer), losing all
          // dynamic shaping. Capped at 0.95 (≈ 121) globally so the
          // loudest sample layer stays in reserve; accents still get a
          // small boost over surrounding notes.
          //
          // micro-timing: melody events used to receive a deterministic
          // ±0.008-beat position-hash jitter for "human feel". Removed
          // because bass + chord (texture) are exact-grid, so the jitter
          // produced 4-8ms misalignment between melody and accompaniment
          // at the same nominal beat — the listener perceives this as
          // "off-beat" smearing on strong beats. Modern pop/jazz mixes
          // expect grid-tight timing; intentional groove (behind/ahead
          // of beat) belongs at the global clock level, not per-note.
          const isAccent = accentMode === 'heavy' && (m.t % 1 === 0);
          const velocityFinal = isAccent ? velocity * 1.05 : velocity;
          const velocityMidi = Math.abs(Math.round(Math.min(0.95, velocityFinal) * 127));
          const humanizedTime = absTime;

          // skipThisNote (texture-collision 50% drop) bypasses event push
          // and lastNoteMidi update — the listener hears just the texture
          // chord at this beat, and the next note's voice-leading reference
          // remains the previously emitted note.
          if (!skipThisNote) {
              if (needsGraceNote && idx > 0) {
                  // 老师哲学: 钢琴 sampler 不响应 MIDI pitch bend, 旧
                  // pitchEnvelope 等于死代码. 改成真物理 grace note
                  // (倚音 / 碎音 / flam): 主音前 0.05 beat 砸一下半音
                  // 邻居 (b3 → 3 / 7 → 1 都用同一公式), velocity 70%.
                  const gracePitch = pitchDiff > 0 ? mNoteMidi - 1 : mNoteMidi + 1;
                  if (gracePitch >= MELODY_RANGE.LOW && gracePitch <= MELODY_RANGE.HIGH && humanizedTime - 0.05 >= startBeat) {
                      events.push({
                          noteNumber: gracePitch,
                          time: humanizedTime - 0.05,
                          duration: 0.05,
                          velocity: Math.max(40, Math.round(velocityMidi * 0.7)),
                          part: 'melody',
                          origin: 'develop',
                      });
                  }
              }
              events.push({
                  noteNumber: mNoteMidi,
                  time: humanizedTime,
                  duration: m.d,
                  velocity: velocityMidi,
                  part: 'melody',
                  origin: eventOrigin
              });
              // Rule 8 / 9 / 11 state update — track signed leap,
              // same-direction run length, and step/leap counts for
              // next note's hard + soft constraints.
              const stepFromPrev = mNoteMidi - lastNoteMidi;
              if (stepFromPrev !== 0) {
                  const prevDir = Math.sign(melodyState.lastLeapSemis);
                  const currDir = Math.sign(stepFromPrev);
                  if (prevDir === currDir && currDir !== 0) {
                      melodyState.sameDirRunLength = melodyState.sameDirRunLength + 1;
                  } else {
                      melodyState.sameDirRunLength = 1;
                  }
                  melodyState.lastLeapSemis = stepFromPrev;
                  // Rule 8 — step (≤ 2) vs leap (≥ 3) classification.
                  if (Math.abs(stepFromPrev) <= 2) melodyState.stepCount++;
                  else melodyState.leapCount++;
              }
              // Color-line update — runs on EVERY emit (not just
              // structural; passing tones and 16th runs are part of
              // the resolving line). Order: expire → resolve →
              // continue → arm.
              {
                  const pcMidi = ((mNoteMidi % 12) + 12) % 12;
                  const chordRootPcLocal = ((chord.rootMidi % 12) + 12) % 12;
                  const chordTriad = getChordBackboneIntervals(chord.type);
                  const inChordTriadPc = chordTriad.some(iv => (chordRootPcLocal + iv) % 12 === pcMidi);
                  // 1) Expire — listener tension dissipates past window
                  if (melodyState.pendingColorLine !== null
                      && absTime > melodyState.pendingColorLine.windowEnd) {
                      melodyState.pendingColorLine = null;
                  }
                  // 2) Resolve — pc landed on chord 1/3/5 (any octave)
                  if (melodyState.pendingColorLine !== null && inChordTriadPc) {
                      melodyState.pendingColorLine = null;
                  }
                  // 3) Continue — stepwise continuation, advance tail
                  if (melodyState.pendingColorLine !== null
                      && Math.abs(mNoteMidi - melodyState.pendingColorLine.lineLastMidi) <= 2) {
                      melodyState.pendingColorLine.lineLastMidi = mNoteMidi;
                  }
                  // 4) Arm — only on isStructural emit, only when no
                  //    pending already (don't reset mid-resolution),
                  //    only when this is a color interval from chord
                  //    root, and not when style allows floating + the
                  //    chord type self-declares this color.
                  // Color triggers (mod-12 interval from chord root):
                  //   1=b9, 2=9, 5=11, 6=#11/b5, 9=13, 10=b7, 11=maj7
                  if (isStructuralNote && melodyState.pendingColorLine === null) {
                      const ivFromChord = ((mNoteMidi - chord.rootMidi) % 12 + 12) % 12;
                      const colorTriggers = new Set([1, 2, 5, 6, 9, 10, 11]);
                      if (colorTriggers.has(ivFromChord)) {
                          // Two independent trigger-skip authorizations:
                          //
                          // (A) Floating color (chord-baked) — chord
                          //   types NAMING a color (m9 declares 9,
                          //   maj13 declares 13) raise listener's
                          //   stable baseline. Styles leaning on this
                          //   (neo-soul / R&B) skip trigger on
                          //   chord-baked color.
                          //
                          // (B) Blues hang tone (scale-baked) — blues
                          //   melody language hangs on b3 / b7 of the
                          //   KEY root, regardless of current chord.
                          //   These are scale-level home in the blues
                          //   vocabulary, not chord-relative tension.
                          //   Independent of chord type.
                          const styleAllowsFloating = STYLE_DICTIONARY[style].allowFloatingColor === true;
                          const chordTypeIvs = (CHORD_TYPES[chord.type] || []).map(iv => iv % 12);
                          const isChordBakedColor = chordTypeIvs.includes(ivFromChord);
                          const styleAllowsBluesHang = STYLE_DICTIONARY[style].allowBluesHangTone === true;
                          const ivFromKey = ((mNoteMidi - rootKeyMidi) % 12 + 12) % 12;
                          const isBluesHangTone = ivFromKey === 3 || ivFromKey === 10; // b3 / b7
                          const skipTrigger = (styleAllowsFloating && isChordBakedColor)
                              || (styleAllowsBluesHang && isBluesHangTone);
                          if (!skipTrigger) {
                              melodyState.pendingColorLine = {
                                  startMidi: mNoteMidi,
                                  startPc: pcMidi,
                                  startTime: absTime,
                                  windowEnd: absTime + 4,
                                  lineLastMidi: mNoteMidi,
                              };
                          }
                      }
                  }
              }
              // SCALE_GRAVITY pendingScaleResolve update — applies to
              // ALL emits (not just structural) for tighter physics
              // tracking. When this note's interval-from-scale-root
              // matches a fromInterval in the bar's gravity rules,
              // arm the next note to favor the rule's toInterval.
              // Clear when arrived.
              if (scaleGravityRulesForBar && scaleRootPcForBar >= 0) {
                  const intervalFromScaleRoot = ((mNoteMidi - scaleRootPcForBar) % 12 + 12) % 12;
                  // 1) Window expire — listener tension dissipates.
                  if (melodyState.pendingScaleLineWindowEnd > 0
                      && absTime > melodyState.pendingScaleLineWindowEnd) {
                      melodyState.pendingScaleResolveTarget = null;
                      melodyState.pendingScaleResolveScore = 0;
                      melodyState.pendingScaleLineWindowEnd = -1;
                      melodyState.pendingScaleLineLastMidi = -1;
                  }
                  // 2) Resolve — pc landed on scale target (multi-note
                  //    line OK: 4-2-3 / 4-5-3 / 4-1-3-2-1 都行).
                  if (melodyState.pendingScaleResolveTarget !== null
                      && intervalFromScaleRoot === melodyState.pendingScaleResolveTarget) {
                      melodyState.pendingScaleResolveTarget = null;
                      melodyState.pendingScaleResolveScore = 0;
                      melodyState.pendingScaleLineWindowEnd = -1;
                      melodyState.pendingScaleLineLastMidi = -1;
                  }
                  // 3) Continue — stepwise advance, update line tail.
                  if (melodyState.pendingScaleResolveTarget !== null
                      && melodyState.pendingScaleLineLastMidi > 0
                      && Math.abs(mNoteMidi - melodyState.pendingScaleLineLastMidi) <= 2) {
                      melodyState.pendingScaleLineLastMidi = mNoteMidi;
                  }
                  // 4) Arm — only when no pending already (don't reset
                  //    mid-line). Window 4 拍, lineLastMidi = 触发音.
                  if (melodyState.pendingScaleResolveTarget === null) {
                      const rule = scaleGravityRulesForBar.get(intervalFromScaleRoot);
                      if (rule && rule.type !== 'hang') {
                          melodyState.pendingScaleResolveTarget = rule.toInterval;
                          melodyState.pendingScaleResolveRootPc = scaleRootPcForBar;
                          melodyState.pendingScaleResolveScore = rule.score;
                          melodyState.pendingScaleLineWindowEnd = absTime + 4;
                          melodyState.pendingScaleLineLastMidi = mNoteMidi;
                      }
                  }
              }
              // 老师哲学: 跟踪 last emit 的角色 + midi 给下一 emit 的
              // avoid-resolution-reward 用 ("避讳音 → 半步解决 chord 音").
              {
                  const emittedPc = ((mNoteMidi % 12) + 12) % 12;
                  const runPcsForRole = new Set<number>(runScale.map(sm => ((sm % 12) + 12) % 12));
                  melodyState.lastEmitRole = classifyNoteRole(
                      emittedPc,
                      chord.type,
                      ((chord.rootMidi % 12) + 12) % 12,
                      scaleNameForBar || '',
                      isModalEnv,
                      chord.effectiveFunc ?? func,
                      scaleRootPcForBar,
                      runPcsForRole,
                  );
                  melodyState.lastEmitMidi = mNoteMidi;

                  // Unified harmonic state — evaluate THIS emit under
                  // its currently-active chord. The assessment is
                  // stored verbatim; the next iteration's hard
                  // constraint reads it. Handles all five resolution
                  // paths (Passing / Neighbor / Appoggiatura via
                  // same-chord tension, Suspension via chord-change
                  // re-assessment of held pitch, Harmonic Catch via
                  // re-assessment dropping urgency to 0). No state
                  // machine needed — the evaluator is the state.
                  const keyRootPcForEval = ((noteToMidi(musicKey + "0") % 12) + 12) % 12;
                  melodyState.lastEmitAssessment = evaluateNoteInChordContext(
                      emittedPc,
                      chord.type,
                      ((chord.rootMidi % 12) + 12) % 12,
                      chord.effectiveFunc ?? func,
                      nextChord ? nextChord.type : null,
                      nextChord ? ((nextChord.rootMidi % 12) + 12) % 12 : null,
                      keyRootPcForEval,
                      scaleNameForBar || undefined,
                      isModalEnv,
                      runScalePcs,
                      this.songTonalCharacter,
                      chord.localTonalCenterPc,
                      modeToKeyFamily(musicMode),
                  );
                  melodyState.lastEmitChord = chord;
              }
              lastNoteMidi = mNoteMidi;
          }
      });

      melodyState.currentMidi = lastNoteMidi;

      // Run Generator — fill awkward gap+leap pairs with stepwise
      // scale runs.
      //
      // After the per-note loop the bar's melody might have two
      // adjacent emitted notes separated by a long silence AND a
      // wide pitch jump (e.g. a 1-beat hold landing low followed by
      // a 1.5-beat gap before a high run-in). The listener hears
      // this as an unmotivated leap into nowhere. Real players
      // bridge such gaps with eighth-note scalar runs that connect
      // the two anchors smoothly.
      //
      // Trigger: gap > 0.75 beats AND pitch leap >= 4 semitones.
      // Generation: stepwise scale tones from the runScale starting
      // at lastTime+lastDur, walking toward the next note. Each
      // intermediate tone is 0.5 beat (a swung 8th); the run is
      // capped at 4 inserts so we don't flood a sparse phrase.
      // Sacred yields here for the same architectural reason as
      // Active Divisi: when the listener WOULD perceive a hole,
      // sacred boundary preserving rhythm-only gives way to
      // perception-respecting bridging. Inserts are tagged
      // origin: 'develop' (passing material, never sacred).
      //
      // Deterministic — no random.next() consumption, just shape-
      // driven. New events are appended to the bar's events array;
      // the generateArrangement-level dedupe catches any time-pitch
      // collision.
      const barMel = events
          .filter(e => e.part === 'melody'
              && e.time >= startBeat
              && e.time < startBeat + chord.duration)
          .sort((a, b) => a.time - b.time);
      const runInserts: NoteEvent[] = [];

      // 老师哲学: Run Generator 按风格分发 fill strategy. 源头按 style
      // 选 palette + insertDur, 不在末尾 patch.
      //   POP  → extension arpeggio (chord 1-3-5-7-9 上扫), 16 分密度
      //   RNB  → minor pentatonic cascade (五声瀑布), 16 分密度
      //   JAZZ → stepwise (现状), 8 分密度
      //   BLUES → stepwise, 8 分密度
      const chordRootPcRG = (((chord.rootMidi % 12) + 12) % 12);
      const chordIntervalsRG = CHORD_TYPES[chord.type] || CHORD_TYPES['maj'];

      // POP arpeggio palette: chord 1/3/5/7 + 9 (extension), 跨 3 八度.
      const popArpPalette: number[] = [];
      const popArpIntervals = Array.from(new Set([
          ...chordIntervalsRG.filter(iv => iv < 12),
          14,  // 9
      ]));
      for (let oct = 3; oct <= 6; oct++) {
          for (const iv of popArpIntervals) {
              popArpPalette.push((chordRootPcRG + iv) % 12 + (oct + 1) * 12);
          }
      }
      popArpPalette.sort((a, b) => a - b);

      // RNB pentatonic palette: minor pentatonic (1, b3, 4, 5, b7) 跨 3 八度.
      const rnbPentPalette: number[] = [];
      const minorPentIvs = [0, 3, 5, 7, 10];
      for (let oct = 3; oct <= 6; oct++) {
          for (const iv of minorPentIvs) {
              rnbPentPalette.push((chordRootPcRG + iv) % 12 + (oct + 1) * 12);
          }
      }
      rnbPentPalette.sort((a, b) => a - b);

      // BLUES lick palette: Composite Blues (1, b3, 3, 4, b5, 5, b7) anchored
      // on the SONG key, not the current chord. Composite Blues carries the
      // double blue note (b3 and b5 simultaneously with natural 3 / 5), which
      // is the blues-vocabulary signature — running through it produces the
      // characteristic "blues lick" sound (b3→3 grace, 4→b5→5 chromatic
      // approach, b7 tail). Key-anchored because blues genres ride the same
      // scale over I/IV/V across the whole 12-bar form rather than chord-
      // following — that's the source of the genre's "horizontal" identity.
      const bluesPalette: number[] = [];
      const compositeBluesIvs = [0, 3, 4, 5, 6, 7, 10];
      const keyPcForBlues = ((noteToMidi(musicKey + "0") % 12) + 12) % 12;
      for (let oct = 3; oct <= 6; oct++) {
          for (const iv of compositeBluesIvs) {
              bluesPalette.push((keyPcForBlues + iv) % 12 + (oct + 1) * 12);
          }
      }
      bluesPalette.sort((a, b) => a - b);

      const fillStrategy: 'arpeggio_up' | 'pentatonic_cascade' | 'blues_lick' | 'stepwise' =
          style === 'POP' ? 'arpeggio_up' :
          style === 'RNB' ? 'pentatonic_cascade' :
          style === 'BLUES' ? 'blues_lick' : 'stepwise';
      // 16-th note density on blues_lick to deliver actual run feel —
      // 8th-note stepwise reads as "slow walk", not lick.
      const insertDur = (fillStrategy === 'stepwise') ? 0.5 : 0.25;
      const minSlotSize = insertDur;

      for (let bi = 0; bi < barMel.length - 1; bi++) {
          const curr = barMel[bi];
          const next = barMel[bi + 1];
          const gap = next.time - (curr.time + curr.duration);
          const leap = Math.abs(next.noteNumber - curr.noteNumber);
          // Trigger threshold per strategy. Blues licks need to fill
          // smaller gaps + smaller leaps than the default — the run
          // feel comes from continuous motion, not from filling rare
          // big jumps. Lowered to gap ≥ 0.5 (was 0.75) and leap ≥ 3
          // (was 4) for blues_lick.
          const gapThreshold = fillStrategy === 'blues_lick' ? 0.5 : 0.75;
          const leapThreshold = fillStrategy === 'blues_lick' ? 3 : 4;
          if (gap <= gapThreshold || leap < leapThreshold) continue;

          const direction = next.noteNumber > curr.noteNumber ? 1 : -1;
          const maxByGap = Math.floor(gap / minSlotSize);
          // 16 分密度时单步音程更小, 允许更多 inserts.
          const maxByLeap = fillStrategy === 'stepwise'
              ? Math.max(1, Math.floor(leap / 2))
              : Math.max(1, Math.floor(leap / 1.5));
          const nMaxCap = fillStrategy === 'pentatonic_cascade' ? 8
              : fillStrategy === 'blues_lick' ? 8
              : fillStrategy === 'arpeggio_up' ? 6 : 4;
          const nInserts = Math.max(1, Math.min(nMaxCap, maxByGap, maxByLeap));
          const runStart = curr.time + curr.duration;

          // 选 palette 按 strategy.
          const palette =
              fillStrategy === 'arpeggio_up' ? popArpPalette :
              fillStrategy === 'pentatonic_cascade' ? rnbPentPalette :
              fillStrategy === 'blues_lick' ? bluesPalette :
              (fillScale && fillScale.length > 0 ? fillScale : runScale);

          let bestIdx = 0;
          let bestDist = Infinity;
          for (let k = 0; k < palette.length; k++) {
              const d = Math.abs(palette[k] - curr.noteNumber);
              if (d < bestDist) { bestDist = d; bestIdx = k; }
          }
          // Voicing snapshot for m9 escape — same chord across the
          // whole run since Run Generator works bar-internally.
          const runVoicingMidis = chord.notesMidi ?? chord.notes.map(n => noteToMidi(n));
          const runFormsM9 = (mid: number) =>
              runVoicingMidis.some(v => mid - v === 13 || mid - v === -13);
          for (let s = 0; s < nInserts; s++) {
              const stepIdx = bestIdx + direction * (s + 1);
              if (stepIdx < 0 || stepIdx >= palette.length) break;
              let stepMidi = palette[stepIdx];
              if (stepMidi < MELODY_RANGE.LOW || stepMidi > MELODY_RANGE.HIGH) continue;
              if (stepMidi === curr.noteNumber || stepMidi === next.noteNumber) continue;
              if (direction > 0 && stepMidi >= next.noteNumber) break;
              if (direction < 0 && stepMidi <= next.noteNumber) break;
              // m9 escape — try ±12 if the palette pitch would form a
              // cross-octave m9 with the current voicing. Skip the
              // insert entirely if no octave variant escapes.
              if (runFormsM9(stepMidi)) {
                  const alt = [stepMidi - 12, stepMidi + 12].find(c =>
                      c >= MELODY_RANGE.LOW && c <= MELODY_RANGE.HIGH && !runFormsM9(c)
                  );
                  if (alt === undefined) continue;
                  stepMidi = alt;
              }

              runInserts.push({
                  noteNumber: stepMidi,
                  time: runStart + s * insertDur,
                  duration: insertDur,
                  velocity: fillStrategy === 'stepwise' ? 90 : 82, // 16 分 cascade 更轻
                  part: 'melody',
                  origin: 'develop',
              });
          }
      }
      events.push(...runInserts);

      // Last-emitted Contract Enforcement — Run Generator and other
      // post-loop inserts (cross-bar bridge, passing tones) bypass
      // the AND pipeline; they pick scale tones for stepwise voice
      // leading without checking chord contract. When the bar's
      // LAST emitted melody event happens to be such an insert AND
      // its pc is outside chord contract (literal ∪ admissible
      // color), the audit classifies it as "passing-on-strong" since
      // last-of-bar is a structural-listening position. Per user's
      // "骨干音绝对优先,全局和声不能变" — even post-loop inserts
      // must respect the contract at structural positions.
      //
      // Action: scan the bar's last emitted melody event. If its pc
      // is NOT in chord contract, snap to the nearest contract pc
      // in runScale within ±3 semitones. If no contract pc reachable,
      // accept the original (rare; would require relaxing).
      {
          const literal = CHORD_TYPES[chord.type] || [0, 4, 7];
          const rootPcEnf = (((chord.rootMidi % 12) + 12) % 12);
          const contractPcs = new Set<number>();
          for (const iv of literal) contractPcs.add((rootPcEnf + iv) % 12);
          const { intervals: contractGlobals } = computeGlobalContract(chord.type, chord.rootMidi);
          for (const iv of contractGlobals) contractPcs.add((rootPcEnf + iv) % 12);
          if (chord.tensionState === 'SlashChord' && chord.virtualExtensions) {
              const bassPcEnf = (((chord.bassMidi % 12) + 12) % 12);
              for (const semis of chord.virtualExtensions) contractPcs.add((bassPcEnf + semis) % 12);
          }
          const barMelEnf = events
              .filter(e => e.part === 'melody'
                  && e.time >= startBeat
                  && e.time < startBeat + chord.duration)
              .sort((a, b) => a.time - b.time);
          const lastEmit = barMelEnf[barMelEnf.length - 1];
          if (lastEmit) {
              const lastPc = (((lastEmit.noteNumber % 12) + 12) % 12);
              if (!contractPcs.has(lastPc)) {
                  // find nearest contract pc in runScale within ±3
                  let bestMidi = lastEmit.noteNumber;
                  let bestDist = Infinity;
                  for (const sm of runScale) {
                      const smPc = (((sm % 12) + 12) % 12);
                      if (!contractPcs.has(smPc)) continue;
                      const d = Math.abs(sm - lastEmit.noteNumber);
                      if (d <= 3 && d < bestDist) {
                          bestDist = d;
                          bestMidi = sm;
                      }
                  }
                  if (bestDist <= 3 && bestMidi !== lastEmit.noteNumber
                      && bestMidi >= MELODY_RANGE.LOW
                      && bestMidi <= MELODY_RANGE.HIGH) {
                      lastEmit.noteNumber = bestMidi;
                  }
              }
          }
      }

      // Bar-level vacated-extension guarantor — final divisi insurance.
      //
      // Per-note Active Divisi only fires when m.d >= 0.25 AND the
      // projected pitch lands within ±10 semis of the top vacated pc.
      // Bars dominated by short notes that sit far from the top
      // extension can therefore complete their full motif/develop
      // pass with NO note ever landing on the chord's defining color.
      // The listener hears a shell (7-chord) where the data declared
      // m9/m11/13/maj9 — the chord type label becomes a lie.
      //
      // Action: scan the bar's melody. If no event's pc matches the
      // top vacated pc, find the best rewrite candidate — preferring
      // develop-origin (freely rewriteable) over motif-origin (sacred
      // yields here per CLAUDE.md Active Divisi rule), and longest
      // duration first (so the listener actually rings on the new pc).
      // Excludes return-origin (cadence-locked). ±10-semi clamp keeps
      // the rewrite within a perfect-fifth-and-a-bit; failure to
      // reach is accepted silently rather than polluted.
      {
          let vacatedIvsG: number[];
          if (chord.type === 'add9' || chord.type === '6/9') {
              vacatedIvsG = literalIntervals.slice(3);
          } else if (literalIntervals.length >= 5) {
              vacatedIvsG = literalIntervals.slice(4);
          } else {
              vacatedIvsG = [];
          }
          if (vacatedIvsG.length > 0) {
              const rootPcG = (((chord.rootMidi % 12) + 12) % 12);
              const topPcG = (((rootPcG + vacatedIvsG[vacatedIvsG.length - 1]) % 12) + 12) % 12;
              const barMelG = events.filter(e => e.part === 'melody'
                  && e.time >= startBeat
                  && e.time < startBeat + chord.duration);
              const filled = barMelG.some(e => (((e.noteNumber % 12) + 12) % 12) === topPcG);
              if (!filled && barMelG.length > 0) {
                  const candidates = barMelG
                      .filter(e => e.origin !== 'return')
                      .sort((a, b) => {
                          const aDev = a.origin === 'develop' ? 1 : 0;
                          const bDev = b.origin === 'develop' ? 1 : 0;
                          if (bDev !== aDev) return bDev - aDev;
                          return b.duration - a.duration;
                      });
                  for (const cand of candidates) {
                      const newMidi = snapMidiToNearestPc(cand.noteNumber, new Set([topPcG]), runScale);
                      if (Math.abs(newMidi - cand.noteNumber) <= 10
                          && newMidi >= MELODY_RANGE.LOW
                          && newMidi <= MELODY_RANGE.HIGH
                          && newMidi !== cand.noteNumber) {
                          cand.noteNumber = newMidi;
                          break;
                      }
                  }
              }
          }
      }

      // Cadence-tail Leading-tone (起伏 / ebb-flow). When the bar is
      // phrase-end (shouldReturn) AND the bar's last melody pc is
      // already a chord-tone of the NEXT chord, the next bar's
      // first note will likely OPEN on the same pc (Method 2 closest-
      // pair snap or natural projection). Static continuation across
      // the bar line feels rigid — the listener wants a tiny dip
      // before the resolution lands again.
      //
      // Action: shorten the last melody event by 0.25 beat if needed,
      // then append a 16th-note event at the bar's last 16th slot
      // playing a stepwise scale neighbor of the cadence pc. The
      // result is "C ... C [B] || C" instead of "C ... C || C" — an
      // anticipation that pulls back to the next bar's opening.
      //
      // Gating: shouldReturn (phrase end only) AND last pc ∈ next
      // chord literal pcs (= continuation). Phrase ends already use
      // architectural cadence logic; this tail tone is the post-
      // resolution decoration the user described.
      // Phrase-end position is the ARCHITECTURAL boundary where the
      // user's 起伏 principle applies — independent of the cadence
      // resolution's probability gate. Cadence Tier rewrites the
      // last note's PITCH probabilistically (per style strictness);
      // the tail leading-tone inserts a NEW event in the silent tail
      // unconditionally when the continuation condition is met.
      const isPhraseEndBar = ((barIndex + 1) % (motifInterval || 4) === 0)
          || (barIndex === totalBars - 1);
      if (isPhraseEndBar && nextChord) {
          const barMelForTail = events
              .filter(e => e.part === 'melody'
                  && e.time >= startBeat
                  && e.time < startBeat + chord.duration)
              .sort((a, b) => a.time - b.time);
          // Pick the bar's MELODIC last note — exclude bass-doubling
          // develop notes that share the same time slot but sit
          // octaves below the lead voice (e.g. Bb4 + Bb3 stacked at
          // t=3.0). The leading-tone tail is a melodic gesture; pick
          // the highest-register event among those tied for last.
          let lastEvt = barMelForTail[barMelForTail.length - 1];
          if (lastEvt) {
              const lastTime = lastEvt.time;
              for (const e of barMelForTail) {
                  if (Math.abs(e.time - lastTime) < 0.01 && e.noteNumber > lastEvt.noteNumber) {
                      lastEvt = e;
                  }
              }
              const lastPc = (((lastEvt.noteNumber % 12) + 12) % 12);
              const nextLiteral = CHORD_TYPES[nextChord.type] || [0, 4, 7];
              const nextRootPc = (((nextChord.rootMidi % 12) + 12) % 12);
              const nextLiteralPcs = new Set(nextLiteral.map(iv => (nextRootPc + iv) % 12));
              if (nextLiteralPcs.has(lastPc)) {
                  // Find closest in-scale neighbor (above or below) of
                  // lastEvt within ±2 semis. Filter:
                  //   - skip avoid for CURRENT chord (tail rings
                  //     during current chord time)
                  //   - MUST be in CURRENT chord contract (literal ∪
                  //     admissible color) — per user "骨干音 + 全局
                  //     和声绝对优先". The leading-tone is at the bar's
                  //     LAST 8th = structural-listening position; it
                  //     can't violate contract just to function as a
                  //     leading tone.
                  //   - prefer below (traditional leading-tone direction)
                  const lastMidi = lastEvt.noteNumber;
                  const currChordRootPc = (((chord.rootMidi % 12) + 12) % 12);
                  const { pcs: currContractPcs } = computeGlobalContract(chord.type, chord.rootMidi);
                  let neighborMidi = -1;
                  let neighborDist = Infinity;
                  for (const sm of runScale) {
                      const d = Math.abs(sm - lastMidi);
                      if (d <= 0 || d > 2) continue;
                      const smPc = (((sm % 12) + 12) % 12);
                      const ivFromCurr = ((smPc - currChordRootPc) % 12 + 12) % 12;
                      if (isAvoidNote(ivFromCurr, chord.type, scaleNameForBar || undefined, isModalEnv, func)) continue;
                      // Contract filter: tail tone must stay in current
                      // chord contract.
                      if (!currContractPcs.has(smPc)) continue;
                      if (d < neighborDist
                          || (d === neighborDist && sm < neighborMidi)) {
                          neighborDist = d;
                          neighborMidi = sm;
                      }
                  }
                  if (neighborMidi >= MELODY_RANGE.LOW && neighborMidi <= MELODY_RANGE.HIGH) {
                      // Tail insert lands on the bar's last 8th (= barEnd
                      // - 0.5). Only fire when shortening lastEvt to fit
                      // produces a QUANTIZED duration — skip otherwise to
                      // keep the QUANTIZED_DURATIONS contract intact.
                      // Non-grid lastEvt times (e.g. t=0.66 from swing
                      // applied to a 0.5 motif beat) would shorten to
                      // 2.84 which isn't in {0.25, 0.5, ..., 4.0} — those
                      // bars skip the tail and keep the original cadence
                      // landing intact.
                      const QUANTIZED_DURS = new Set([0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0, 3.25, 3.5, 3.75, 4.0]);
                      const barEnd = startBeat + chord.duration;
                      const tailStart = barEnd - 0.5;
                      const proposedShortened = tailStart - lastEvt.time;
                      const proposedRounded = Math.round(proposedShortened * 100) / 100;
                      if (proposedShortened >= 0.25 && QUANTIZED_DURS.has(proposedRounded)) {
                          if (lastEvt.duration !== proposedRounded) {
                              lastEvt.duration = proposedRounded;
                          }
                          events.push({
                              noteNumber: neighborMidi,
                              time: tailStart,
                              duration: 0.5,
                              velocity: 80,
                              part: 'melody',
                              origin: 'develop',
                          });
                      }
                  }
              }
          }
      }

      // Track the last melody event's end time AFTER all Run Generator
      // inserts so the next bar's cross-bar bridge sees the true tail
      // position (not just the motif's last note).
      const barMelEnds = events
          .filter(e => e.part === 'melody'
              && e.time >= startBeat
              && e.time < startBeat + chord.duration)
          .sort((a, b) => a.time - b.time);
      if (barMelEnds.length > 0) {
          melodyState.lastNoteEnd = Math.max(...barMelEnds.map(e => e.time + e.duration));

          // Pick the bar's MELODIC last (highest-register among events
          // tied for last time). Used by the color-line resync below.
          // (Prior to evaluator-based state, this also resynced the
          // pendingResolve ghost — that ghost is gone now; the per-emit
          // evaluator state inside the main loop is the new source of
          // truth for cross-bar tension awareness.)
          let lastEmit = barMelEnds[barMelEnds.length - 1];
          const lastTime = lastEmit.time;
          for (const e of barMelEnds) {
              if (Math.abs(e.time - lastTime) < 0.01 && e.noteNumber > lastEmit.noteNumber) {
                  lastEmit = e;
              }
          }

          // Color-line resync — apply listener-perspective effects of
          // post-loop inserts (Run Generator / cadence-tail) that the
          // per-emit update missed. By 老师 bridge principle these are
          // transition tones, NOT structural — they DO NOT arm a new
          // pending. They CAN, however:
          //   • land on chord 1/3/5 pc → resolve any pending line
          //   • be ≤ 2 semis from line tail → continue the line
          //   • exceed the window → expire the pending
          // Window expire also runs here so cross-bar pending state
          // doesn't outlive its 4-beat memory window.
          const chordRootPcLocal2 = ((chord.rootMidi % 12) + 12) % 12;
          const lastPcMidi = ((lastEmit.noteNumber % 12) + 12) % 12;
          const chordTriadIvs = getChordBackboneIntervals(chord.type);
          const inChordTriadPc = chordTriadIvs.some(iv => (chordRootPcLocal2 + iv) % 12 === lastPcMidi);
          if (melodyState.pendingColorLine !== null
              && lastEmit.time > melodyState.pendingColorLine.windowEnd) {
              melodyState.pendingColorLine = null;
          }
          if (melodyState.pendingColorLine !== null && inChordTriadPc) {
              melodyState.pendingColorLine = null;
          }
          if (melodyState.pendingColorLine !== null
              && Math.abs(lastEmit.noteNumber - melodyState.pendingColorLine.lineLastMidi) <= 2) {
              melodyState.pendingColorLine.lineLastMidi = lastEmit.noteNumber;
          }

          // Re-sync currentMidi + lastEmitAssessment to the bar's
          // chronologically-last melody event. The per-emit update inside
          // generateBarPattern's main loop sets these to the LAST motif
          // note, but Run Generator inserts, cadence-tail rewrites, and
          // Active Divisi pulls push more events AFTER that point. Without
          // this re-sync the next bar's anchor scoring, voice-leading
          // distance, and unified-tension-resolution hard filter read the
          // stale motif-loop reference instead of the actual prior pitch
          // the listener just heard.
          melodyState.currentMidi = lastEmit.noteNumber;
          const lastEmitPcSync = ((lastEmit.noteNumber % 12) + 12) % 12;
          melodyState.lastEmitAssessment = evaluateNoteInChordContext(
              lastEmitPcSync,
              chord.type,
              chordRootPcLocal2,
              chord.effectiveFunc ?? func,
              nextChord ? nextChord.type : null,
              nextChord ? ((nextChord.rootMidi % 12) + 12) % 12 : null,
              ((noteToMidi(musicKey + "0") % 12) + 12) % 12,
              scaleNameForBar || undefined,
              isModalEnv,
              runScalePcs,
              this.songTonalCharacter,
              chord.localTonalCenterPc,
              modeToKeyFamily(musicMode),
          );
          melodyState.lastEmitChord = chord;
      }

      // Cycle boundary — tension tracker resets at every cadence position
      // (and the song's final bar). User principle: "一个和声进行内" =
      // tensions live within a single chord cycle. A 7 hanging from
      // bar 2 doesn't carry forward into the next phrase's cycle.
      if (shouldReturn) {
          tensionTracker.resetCycle();
      }

      return { patternEvents: events, bridgeVisual };
  }
}
