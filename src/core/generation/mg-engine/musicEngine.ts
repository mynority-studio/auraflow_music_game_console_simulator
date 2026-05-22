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

import { STYLE_DICTIONARY, StyleName } from '../af2-engine/data/styleDictionary';
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
} from '../af2-engine/music-theory';
import { DYNAMIC_TSD_DICTIONARY, analyzeTargetQuality } from '../af2-engine/data/dynamicHarmony';
import { BASSLINE_RULES, DEFAULT_BASSLINE_RULE, pickBasslineRule, BASS_PATTERN_RULES, resolveBassAnchorPc, clampPcToBassMidi } from '../af2-engine/data/basslineRules';
// AF2 ChordTextureEngine 单点劫持 — Phase 3.2 后 applyTexture 已抽到 engine-utils.ts,
// ChordTextureEngine import 随 applyTexture 一起搬走;此处不再需要。
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
    // Phase 3 — arrangement-layer extracts
    predictMotifStructuralPcs as utilPredictMotifStructuralPcs,
    estimateMotifConflictRatio as utilEstimateMotifConflictRatio,
    selectBestMidi as utilSelectBestMidi,
    selectBestMotif as utilSelectBestMotif,
    applyTexture as utilApplyTexture,
    generateBarPattern as utilGenerateBarPattern,
    generateArrangement as utilGenerateArrangement,
} from './engine-utils';

// Re-export theory primitives that external callers import from musicEngine
// (test_batch.ts uses noteToMidi). Engine itself no longer owns these.
export { noteToMidi, midiToNote, TensionTracker } from '../af2-engine/music-theory';
export type { Emotion } from '../af2-engine/music-theory';

// Resolution urgency threshold. evaluateNoteInChordContext returns
// urgency ∈ [0, 1]; values at or above this gate the unified-tension-
// resolution hard constraint. 0.5 catches D-function dissonances and
// chord-7 tendencies while still letting S-function color hangs
// (sus / 11 / 13 waiting for D) pass through.
export const UNRESOLVED_TENSION_THRESHOLD = 0.5;

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
export interface NoteContext {
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
  scaleGravityRules: Map<number, import('../af2-engine/music-theory').ScaleGravityRule> | null;
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
export interface HardConstraint {
  name: string;
  shouldApply: (ctx: NoteContext) => boolean;
  accept: (midi: number, ctx: NoteContext) => boolean;
}

/**
 * Soft score — weighted preference. Each scorer returns a value
 * (typically [0, 1] or [-1, 0]); final candidate score = sum of
 * weight × score.
 */
export interface SoftScore {
  name: string;
  weight: number;
  shouldApply: (ctx: NoteContext) => boolean;
  score: (midi: number, ctx: NoteContext) => number;
}

/**
 * Bundle of song-level state required by generateBarPattern(Phase 3.2 抽离时打包)。
 * Engine 内调用 generateBarPattern 时构造一份;free-function 版本接此对象即可,
 * 不需访问 Engine class 实例。
 */
export interface BarPatternSongContext {
  /** Per-song aesthetic anchor — 设 in generateArrangement (`${seed}::anchor` forked) */
  aestheticAnchor: Random | null;
  /** Rule 10 — Apex Singularity bar idx,-1 = 未设 */
  songApexBarIdx: number;
  /** Apex midi pitch,-1 = 未设 */
  songApexPitchMidi: number;
  /** Apex phrase 范围(老师 E 选项,整 phrase 抬高 baseline)*/
  songApexPhraseStartBar: number;
  songApexPhraseEndBar: number;
  /** Scale-gravity 严格度(0..1)*/
  songGravityStrictness: number;
  /** Meter context(quarter-note 拍数 / strongBeats 等)*/
  songMeterContext: MeterContext;
  /** Tonal / modal — chord-context 评估需用 */
  songTonalCharacter: 'tonal' | 'modal';
  /** Main PRNG(原 Engine.random) */
  rng: Random;
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

    // Phase 3.3 (#6.4):generateArrangement(1029 行,mg.Engine 最后一个非 stub method)
    // 已抽到 engine-utils.ts。Class field 写入(aestheticAnchor / songApex* / songGravityStrictness /
    // songMeterContext / songTonalCharacter)改为函数局部 var,bar 循环直接调 free generateBarPattern
    // + 打包 songCtx。完整算法 + 设计注释 verbatim 保留在 engine-utils.ts。
    generateArrangement(chords: ChordDef[], config: GenerationConfig): MusicTimeline {
        return utilGenerateArrangement(chords, config, this.random);
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

  // Phase 3 (#6.4):estimateMotifConflictRatio 已抽到 engine-utils.ts(纯函数)
  // 完整设计注释(D 函数 3→4 false-resolve 规则等)保留在 engine-utils.ts 同名函数。
  private estimateMotifConflictRatio(motif: any[], chord: ChordDef, runScale: number[], func: string = 'T', isModalContext: boolean = false, scaleName?: string): number {
      return utilEstimateMotifConflictRatio(motif, chord, runScale, func, isModalContext, scaleName);
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
  // Phase 3 (#6.4):selectBestMotif 已抽到 engine-utils.ts(PRNG 参数化)
  // 完整算法(three-tier pre-filter / memory roll / N=5 候选评分)保留在同名函数。
  // N_CANDIDATES / MEMORY_REUSE_PROB 也作 module-level const 移出。
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
      return utilSelectBestMotif(pool, chord, runScale, memoryKey, thematicMemory, backboneTargets, vlIn, vlOut, prevPhrasePcs, this.random);
  }

  /**
   * Project a motif onto chord+runScale and return the SET of pcs
   * that land on structural positions (strong beat OR long ≥1.5 OR
   * last note). Used by selectBestMotif's parallelism scorer and by
   * generateArrangement's phrase-pc accumulator. Same projection
   * semantics as the per-note loop.
   */
  // Phase 3 (#6.4):predictMotifStructuralPcs 已抽到 engine-utils.ts(纯函数)
  private predictMotifStructuralPcs(motif: any[], chord: ChordDef, runScale: number[]): Set<number> {
      return utilPredictMotifStructuralPcs(motif, chord, runScale);
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
  // Phase 3 (#6.4):HARD_FILTER_PRIORITY 已挪到 engine-utils.ts(module-level const)
  // Phase 3 (#6.4):selectBestMidi 已抽到 engine-utils.ts(纯函数,完整 AND-architecture
  // selector 算法 + filter relaxation + soft score 保留在同名函数)
  private selectBestMidi(
      ctx: NoteContext,
      hardFilters: HardConstraint[],
      softScores: SoftScore[],
  ): number {
      return utilSelectBestMidi(ctx, hardFilters, softScores);
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

    // Phase 3.2 (#6.4):applyTexture 已抽到 engine-utils.ts(thin wrapper)
    private applyTexture(chord: ChordDef, textureType: string, startBeat: number, duration: number, melodyEvents: NoteEvent[], isShuffle: boolean, accentMode: 'heavy' | 'syncopated', density: number = 0.5, nextChord: ChordDef | null = null): NoteEvent[] {
        return utilApplyTexture(chord, textureType, startBeat, duration, melodyEvents, isShuffle, accentMode, density, nextChord, this.random);
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

  // Phase 3.2 (#6.4):generateBarPattern(2557 行)已抽到 engine-utils.ts
  // BarPatternSongContext 打包 song-level state(8 字段)传入,完整算法 + 设计注释 verbatim 保留。
  private generateBarPattern(
      chord: ChordDef, nextChord: ChordDef | null, style: StyleName, startBeat: number, motif: any[],
      func: 'T'|'S'|'D', isLast: boolean, musicKey: string, musicMode: string, tensionTracker: TensionTracker, melodyState: any,
      textureType: string, isShuffle: boolean, accentMode: 'heavy' | 'syncopated',
      barIndex: number = 0, totalBars: number = 1, density: number = 0.5, complexity: number = 0.5,
      role: 'motif' | 'develop' | 'rest' = 'motif',
      shouldReturn: boolean = false,
      motifInterval: number = 4,
      fillScale: number[] | null = null,
      barBackboneTargets: Set<number> | null = null,
      prevChord: ChordDef | null = null,
      phraseRole: PhraseRole = 'phrase_end_through',
  ): { patternEvents: NoteEvent[], bridgeVisual?: { time: number, label: string } } {
      return utilGenerateBarPattern(chord, nextChord, style, startBeat, motif, func, isLast, musicKey, musicMode, tensionTracker, melodyState, textureType, isShuffle, accentMode, barIndex, totalBars, density, complexity, role, shouldReturn, motifInterval, fillScale, barBackboneTargets, prevChord, phraseRole, {
          aestheticAnchor: this.aestheticAnchor,
          songApexBarIdx: this.songApexBarIdx,
          songApexPitchMidi: this.songApexPitchMidi,
          songApexPhraseStartBar: this.songApexPhraseStartBar,
          songApexPhraseEndBar: this.songApexPhraseEndBar,
          songGravityStrictness: this.songGravityStrictness,
          songMeterContext: this.songMeterContext,
          songTonalCharacter: this.songTonalCharacter,
          rng: this.random,
      });
  }
}
