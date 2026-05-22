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
    // Phase 3 — arrangement-layer extracts
    predictMotifStructuralPcs as utilPredictMotifStructuralPcs,
    estimateMotifConflictRatio as utilEstimateMotifConflictRatio,
    selectBestMidi as utilSelectBestMidi,
    selectBestMotif as utilSelectBestMotif,
    applyTexture as utilApplyTexture,
    generateBarPattern as utilGenerateBarPattern,
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
