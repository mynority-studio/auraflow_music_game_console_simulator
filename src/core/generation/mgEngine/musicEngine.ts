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

import { STYLE_DICTIONARY, StyleName, ChordSkeletonSlot, LICK_METADATA_BY_NOTES, poolForBrick } from './styleDictionary';
import { LICKS_BY_BRICK } from './improvisorLicks';
import {
  buildMelodyChordContract,
  evaluateLickAgainstContract,
  MelodyChordContract,
} from './melodyChordContract';
import {
  analyzeLickRhythm,
  inferSongRhythmFeel,
  textureFeelOf,
  acceptableTextureFeels,
  buildBarLickContract,
  decideCompingModeForLick,
  densityMultiplierForCompingMode,
  CompingMode,
} from './rhythmContract';
import {
  buildArrangementContract,
  applyCompingModeToTextureEvents,
  ArrangementContract,
} from './arrangementContract';
import { TEXTURE_POOL } from './styleDictionary';
import { parseRoadMap, findBlockForChord, Block } from './roadmapParser';
import { planTonicization } from './tonicizationPlanner';
import { planBorrowedChords } from './borrowedChordPlanner';
import { planLocalTonicizationColor } from './localTonicizationColorPlanner';
// Modern progression + texture data now lives in styleDictionary.ts
// (Sections 2 + 3) — single source of truth for style-related selection.
import {
  pickProgression,
  phraseCellRole,
  densityForCell,
  energyForCell,
  pickTextureForBar,
} from './styleDictionary';
import { attachWidePianoVoicings, renderWidePianoVoicing } from './widePianoVoicing';
import { enforceInstrumentConstraints, DEFAULT_INSTRUMENT_BINDINGS } from './instruments';
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
  getVoiceLeadingPenalty,
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
  applyArrangement,
  ArrangementMode,
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
  normalizeChordType,
  effectiveChromaticOffset,
  countLickHardAvoidsForChord,
  evaluateLickOnChord,
  LICK_ACCEPT_POLICY,
} from './musicTheory';
import { DYNAMIC_TSD_DICTIONARY, analyzeTargetQuality } from './dynamicHarmony';
import { BASSLINE_RULES, DEFAULT_BASSLINE_RULE, pickBasslineRule, BASS_PATTERN_RULES, resolveBassAnchorPc, clampPcToBassMidi } from './basslineRules';

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
  // Planner-set scale override. When present, melody scale derivation
  // (getScaleForStyle / scaleNameForBar) uses this name instead of
  // the style/mode default. Tonicization Planner sets this to
  // 'Mixolydian' on V/MajorTarget and 'Phrygian Dominant' on
  // V/MinorTarget so the melody automatically threads the appropriate
  // altered tones during the borrowed dominant.
  forcedScale?: string;
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
  // Five-way Berklee classification of non-diatonic chords. Set by
  // Planners. UI reads to color-code badges; future melody scoring
  // can read to weight resolution urgency.
  borrowedSource?: import('./styleDictionary').BorrowedSource;
  // "Must resolve" — true for V/X / ii/X / bVII7 (backdoor); false
  // for plain modal interchange (iv → I etc. is soft return).
  mustResolve?: boolean;
  // Tonicization placement form — propagated from ChordSkeletonSlot.
  // Set by the Tonicization Planner. UI Tonicization chain reads this
  // to display HOW the engine approached the target (light = lone V/X
  // full bar, approach = curr + V/X half bars, iiv_split = ii + V half
  // bars in one bar, full_2bar = ii bar + V bar = the classic 2-bar
  // form). Dictionary-native V/X authored directly in progressions
  // leaves this undefined.
  tonicizationPlacement?: 'light' | 'approach' | 'iiv_split' | 'full_2bar';
  // Region-aware analysis frame. analysisKeyPc = absolute pc of the
  // tonal center this chord is analyzed against; undefined / equal to
  // song key root means global analysis. localRoman = roman numeral
  // relative to analysisKeyPc (e.g. 'iv' for Cm in a G local region).
  // The Tonicization Planner tags V/X / ii/X / target slots with
  // these, and the Local Tonicization Color Planner generates
  // additional borrowed chords WITHIN local regions using local-key
  // analysis ("iv/V → V → i" style, per user music-theory rule).
  analysisKeyPc?: number;
  localRoman?: string;
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
  // Vertical-spread arrangement applied to the upper voicing.
  //
  //   'close'   — 4 voices within ~1 octave (default for phrase boundaries / song end)
  //   'drop2'   — 2nd-from-top voice dropped 1 octave (default for phrase middle —
  //               Bill Evans rootless / guitar comp spread)
  //   'drop3'   — 3rd-from-top voice dropped 1 octave (less common; not currently
  //               in default dispatch but exposed via the ArrangementMode type)
  //   'spread'  — drop-2-and-4 open spacing (also not in default dispatch)
  //
  // Bass MIDI is NOT touched by the arrangement transform — only upper voicing
  // changes. Safety guard refuses any drop that would land at-or-below bass + 4.
  arrangementMode?: import('./musicTheory').ArrangementMode;

  // Wide piano voicing — separate layer from notesMidi/close-position
  // arrangement system. Attached by attachWidePianoVoicings() post-process
  // for chords that will be rendered through Piano_Wide_Color_Motion (or
  // similar) texture cases. Contains:
  //   - notes: 5-7 voices distributed across register zones (low_outer /
  //            inner_low/mid/high / upper_outer)
  //   - attackMidi: MIDI list for the strong-beat chord stab
  //   - innerLanes: 3 middle-register voices used as "副旋律" candidates
  //   - innerMotion: 1-2 weak-beat events that drift toward the next chord's
  //                  inner lanes — creates the "若隐若现 counter-melody" feel
  // Undefined for chords rendered by other texture systems.
  widePianoVoicing?: import('./widePianoVoicing').WidePianoVoicing;
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
  // Lick-source flag — true when this melody event was projected from
  // an Impro-Visor lick note (mutatedMotif entry with degreeLabel).
  // Post-projection transforms (grid quantization, contract enforcement,
  // etc.) skip events with this flag — the lick author's pitch + timing
  // are the final answer.
  lickSource?: boolean;
  // Instrument tag — set by enforceInstrumentConstraints. Audio renderer
  // can dispatch to different samplers based on this; future MIDI export
  // emits per-instrument tracks. Default: undefined (renderer defaults
  // to piano sampler).
  instrument?: string;
}

/**
 * Sustain-pedal control event (真踏板 — MIDI CC64).
 *   type: 'on'  = pedal down (CC64 value 127)
 *   type: 'off' = pedal up   (CC64 value 0)
 *
 * The audio renderer (App.tsx Tone.js layer) reads these and either:
 *   (a) extends any active note's effective duration until the next
 *       'off' event, AND
 *   (b) emits MIDI CC64 messages when standard MIDI export is wired.
 *
 * Generated per style:
 *   - LOFI:  pedal down whole bar, brief 50ms lift before next chord
 *   - POP:   pedal down on long-held chord stabs, lift on melody phrase end
 *   - JAZZ:  no pedal (default — voice-leading matters more than ring)
 *   - BLUES: no pedal (boogie/stride bass needs clarity)
 */
export interface PedalEvent {
  type: 'on' | 'off';
  time: number;       // beats from start of song
}

export interface MusicTimeline {
  events: NoteEvent[];
  visuals: { time: number, label: string }[];
  // Per-bar active texture case (parallel-indexed to chords array).
  // Used by diagnostics + audits to verify per-cell texture cohesion.
  // Within a phrase cell, all bars share the same value; cell boundary
  // (establish→develop→lift→cadence) is the only place where it changes.
  texturePerBar?: string[];
  // Sustain pedal events (CC64 on/off). See PedalEvent doc above.
  pedalEvents?: PedalEvent[];
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
  // Color-extension emit count within the current bar — incremented
  // each time the engine pushes a melody pc that maps to the chord's
  // 9 / 11 / 13 (chord-relative intervals 2 / 5 / 9). Read by the
  // color-density-cap hard filter to BLOCK a 3rd color emission and
  // force the line off color tones onto chord literal pcs. Reset to
  // 0 at every bar boundary (per-bar density is the listener's scope).
  barColorEmitCount: number;
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

/**
 * Section function label — coarse song-section semantic.
 *
 * Phase 1 (this commit): interface-only — picked by forked Random in
 * `resolveGeneration` and exposed via `ResolvedGenerationContext.
 * sectionFunction`. Downstream subsystems (tonicization / borrowed /
 * texture / motif) do NOT yet branch on this field. Future external
 * systems can override the picked value through the same field shape.
 *
 * Set:
 *   - INTRO   — song opener
 *   - VERSE   — main narrative section (default Pop verse)
 *   - CHORUS  — hook / refrain
 *   - BRIDGE  — contrasting section (often modulating)
 *   - OUTRO   — song closer
 *
 * Phase 2+ will wire each into one or more of:
 *   tonicization prob multiplier, borrowed-chord prob multiplier,
 *   texture-pool filter, progression-template tag filter, motif
 *   strategy / register character.
 */
export type SectionFunction = 'INTRO' | 'VERSE' | 'CHORUS' | 'BRIDGE' | 'OUTRO';

export interface ResolvedGenerationContext {
  emotion: Emotion;
  mode: string;
  isExotic: boolean;
  /**
   * Song-section semantic label. Picked once per song from forked
   * Random `${seed}::section` with weights (VERSE 35 / CHORUS 30 /
   * BRIDGE 15 / INTRO 10 / OUTRO 10). Interface-only in Phase 1 —
   * present in the context for UI / downstream observation but no
   * subsystem currently branches on it. Future external system can
   * override by assigning the field after `resolveGeneration` runs.
   */
  sectionFunction: SectionFunction;
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

const KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

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
const QUANTIZED_DURATIONS = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0];

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

/**
 * Generate sustain pedal events (CC64) by style.
 *
 * LOFI / POP抒情: 钢琴-真实手感 — pedal down at the start of each chord,
 *   release 50ms (= 0.05 beat) before next chord so the chord ring blends
 *   into next one but doesn't muddle the new harmony. Last chord pedal
 *   stays down until song end.
 *
 * JAZZ / BLUES: no pedal — voice-leading clarity / boogie bass attack
 *   matter more than ring. Returns empty array.
 *
 * Audio renderer reads these events to drive triggerAttack / triggerRelease
 * timing on the Tone.Sampler (see App.tsx playback wiring).
 */
function generatePedalEvents(chords: ChordDef[], style: StyleName): PedalEvent[] {
  // JAZZ / BLUES: 不用踏板
  if (style === 'JAZZ' || style === 'BLUES') return [];

  const events: PedalEvent[] = [];
  let beatAcc = 0;
  const RELEASE_LEAD = 0.05;  // beat — 在下一 chord 前 50ms 抬踏板

  for (let i = 0; i < chords.length; i++) {
    const chord = chords[i];
    // pedal ON at chord start
    events.push({ type: 'on', time: beatAcc });
    // pedal OFF either:
    //   - just before next chord (lead time)
    //   - or at song end (last chord)
    const isLast = i === chords.length - 1;
    const offTime = isLast
      ? beatAcc + chord.duration   // last chord — pedal held till end
      : beatAcc + chord.duration - RELEASE_LEAD;
    events.push({ type: 'off', time: offTime });
    beatAcc += chord.duration;
  }
  return events;
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

  // Phase 4 — RoadMap blocks for the active song. parseRoadMap fills this
  // at the start of generateArrangement. pickMotif looks up the current
  // bar's block to filter the lick pool by matching brickType. Empty when
  // generateArrangement hasn't run (tests / direct invocations).
  songBlocks: Block[] = [];

  // Per-bar trace of which lick reference was picked. Diagnostic only —
  // populated by pickMotif when the brick filter activates. Audit
  // scripts reverse-look up via LICK_METADATA_BY_NOTES to know which
  // BillEvans/Lovano/etc lick id was actually used.
  lickPicksPerBar: Map<number, any[]> = new Map();

  // Phase 11 — Impro-Visor "single grammar" mode. Per-song musician
  // lock picked by forked random `${seed}::musician`. All bars use
  // licks from this musician (with fallback to any-musician brick
  // match when musician didn't author that brick).
  songMusician: string | null = null;
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
  private resolveTonalCharacter(style: StyleName, mode: string): 'tonal' | 'modal' {
    if (style === 'BLUES') return 'modal';
    const tonalModes = new Set(['Major', 'Minor', 'Ionian', 'Aeolian']);
    if (!tonalModes.has(mode)) return 'modal';
    return 'tonal';
  }

  /**
   * Resolve emotion → mode for a generation run. Deterministic by SEED.
   *
   * Uses a Random forked from `seed::emotion` so the rolls do not consume
   * entropy from the engine's main Random instance — that keeps the
   * pipeline determinism for callers that pass `mode` directly stable
   * across M3 changes.
   */
  /**
   * Section function picker — uses its own forked Random stream
   * (`${seed}::section`) so adding/changing the pick weights does NOT
   * perturb the emotion / motif / bassline / tonicize / borrow streams.
   *
   * Weights: VERSE 35 / CHORUS 30 / BRIDGE 15 / INTRO 10 / OUTRO 10.
   * Phase 1: result is only surfaced via context.sectionFunction — no
   * downstream subsystem branches on it yet (per scoping decision).
   */
  private pickSectionFunction(seed: string): SectionFunction {
    const sr = new Random(`${seed}::section`);
    const roll = sr.next();
    if (roll < 0.35) return 'VERSE';
    if (roll < 0.65) return 'CHORUS';
    if (roll < 0.80) return 'BRIDGE';
    if (roll < 0.90) return 'INTRO';
    return 'OUTRO';
  }

  resolveGeneration(config: GenerationConfig): ResolvedGenerationContext {
    // The fork is shared by emotion/exotic AND motif-strategy rolls so the
    // whole "song-level decisions" stream is one deterministic chain.
    const r = new Random(`${config.seed}::emotion`);
    // Section function — independent stream; picked once per song.
    const sectionFunction = this.pickSectionFunction(config.seed);

    // Meter resolved up-front so both branches return it. Priority:
    //   1. config.meter (explicit override, snapshot tests)
    //   2. style.timeSignature (per-substyle default)
    //   3. [4, 4] fallback
    const meterCtx = getMeterContext(
      config.meter ?? STYLE_DICTIONARY[config.style]?.timeSignature ?? [4, 4],
    );

    // Direct override path (snapshot tests, advanced callers).
    if (config.mode) {
      const mode = config.mode;
      const known = mode in SCALE_TYPES;
      const isMainstream = mode === MAINSTREAM_EMOTION_TO_MODE.bright
                        || mode === MAINSTREAM_EMOTION_TO_MODE.sad
                        || mode === 'Major' || mode === 'Minor'
                        || mode === 'Major Blues' || mode === 'Minor Blues';
      const motif = this.resolveMotifStrategy(config, r);
      const basslineRule = pickBasslineRule(STYLE_DICTIONARY[config.style]?.basslineRules, r);
      return {
        mode,
        emotion: MAJOR_FLAVOR_MODES.includes(mode) || mode === 'Major' ? 'bright' : 'sad',
        isExotic: known && !isMainstream,
        sectionFunction,
        ...motif,
        basslineRule,
        meter: meterCtx.meter,
        meterContext: meterCtx,
        tonalCharacter: this.resolveTonalCharacter(config.style, mode),
      };
    }

    const requested = config.emotion ?? 'auto';
    const finalEmotion: Emotion = requested === 'auto'
      ? (r.next() < 0.5 ? 'bright' : 'sad')
      : requested;

    let mode: string;
    let isExotic: boolean;
    // Always consume the exotic-gate random so the main pipeline's
    // stream stays stable when EXOTIC_MODE_PROBABILITY is tuned. The
    // branch fires only when the rolled value is below the gate.
    const exoticRoll = r.next();
    if (exoticRoll < EXOTIC_MODE_PROBABILITY) {
      mode = r.pick(EXOTIC_MODES as string[]);
      isExotic = true;
    } else {
      // Style-aware mainstream mapping. BLUES is the only style whose
      // mainstream mode is NOT Ionian/Aeolian — the genre lives on
      // Major Blues / Minor Blues (1 b3 3 4 b5 5 b7 family), and
      // running the 12-bar form under plain Ionian erases every
      // blue note (b3 / b5 / b7) the listener expects. The two
      // BLUES sub-styles ('Blues' / 'Blues Turnaround') both declare
      // ['Major Blues', 'Minor Blues'] availableModes, so this
      // mapping is consistent with the style data, not a special
      // case for the resolver.
      if (config.style === 'BLUES') {
        mode = finalEmotion === 'bright' ? 'Major Blues' : 'Minor Blues';
      } else {
        mode = MAINSTREAM_EMOTION_TO_MODE[finalEmotion];
      }
      isExotic = false;
    }

    const motif = this.resolveMotifStrategy(config, r);
    const basslineRule = pickBasslineRule(STYLE_DICTIONARY[config.style]?.basslineRules, r);
    return {
      emotion: finalEmotion,
      mode,
      isExotic,
      sectionFunction,
      ...motif,
      basslineRule,
      meter: meterCtx.meter,
      meterContext: meterCtx,
      tonalCharacter: this.resolveTonalCharacter(config.style, mode),
    };
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
  private resolveMotifStrategy(config: GenerationConfig, r: Random):
      { motifStrategy: 'regular' | 'functional'; motifInterval: number } {
    const profile = STYLE_DICTIONARY[config.style];
    const styleRule = profile?.motifRepeatStrategy;

    // Strategy: 50/50 unless style biases. We treat the style.preferred as
    // a strong nudge — 70% chance of using it.
    let strategy: 'regular' | 'functional';
    if (styleRule && r.next() < 0.7) {
      strategy = styleRule.preferred;
    } else {
      strategy = r.next() < 0.5 ? 'regular' : 'functional';
    }

    // Interval: engine picks 2-8, style modifies (clamp to range, prefer N).
    const enginePick = 2 + Math.floor(r.next() * 7); // 2..8
    let interval = enginePick;
    if (styleRule?.N) {
      const [lo, hi] = styleRule.N.range;
      interval = Math.max(lo, Math.min(hi, enginePick));
      // 50% chance to snap to the style's preferred N within range.
      if (r.next() < 0.5) interval = styleRule.N.preferred;
    }

    return { motifStrategy: strategy, motifInterval: interval };
  }

  generateProgressions(config: GenerationConfig): ChordDef[] {
    const { style, key } = config;
    const ctx = this.resolveGeneration(config);
    const bars = STYLE_DICTIONARY[style]?.recommendedBars ?? 16;
    const progression = this.generateProgression(style, bars, ctx.mode, ctx.motifInterval, ctx.sectionFunction);

    // Borrowed-Chord Planner — positional Modal Interchange. Four
    // rules: A1 (IV→iv→I sigh cadence), A2 (iv→bVII7→I backdoor),
    // B (vi→bVI→V chromatic D-prefix), C (ii-V→bVI-bVII-I cadential
    // chain). Replaces the prior 1:1 mixturePlanner with a rule-set
    // that knows WHERE in the phrase a given borrowed chord
    // idiomatically lives. Forked random `${seed}::borrow` keeps the
    // main stream untouched when the planner doesn't fire.
    // Per-song single borrow-source pick. Forked Random so it
    // doesn't perturb other streams. Mode-aware distribution —
    // Phrygian Neapolitan is a MINOR-key idiom (bII in Major has two
    // foreign pitches Db+Ab, sounds out-of-style for pop major
    // songs); Mixolydian rock-bVII / bIII targets I→IV transitions
    // which only Major-mode progressions have natively. Mixing
    // either with the wrong mode produces the "out of style" effect
    // user flagged on pop_uywg9z (Major + Phrygian → bII insertion
    // lacking idiomatic home).
    //
    //   Major-family (Ionian / Major):
    //     Aeolian    80%  (parallel-minor: iv / bVI / bVII7 — staple)
    //     Mixolydian 20%  (rock color: bVII→IV, bIII→IV)
    //   Minor-family (Aeolian / Minor):
    //     Aeolian    20%  (no-op fallback — Aeolian-source rules expect
    //                       Major-mode patterns; in minor this yields no
    //                       borrowing, kept at 20% so "pure modal" Aeolian
    //                       songs still occur as a stylistic option)
    //     Dorian     40%  (raised-6 IV major — Eleanor Rigby / Mad World)
    //     Phrygian   40%  (classical Neapolitan bII around iv/V/i)
    const sourceRandom = new Random(`${config.seed}::borrow-source`);
    const sourceRoll = sourceRandom.next();
    const modeFamily = modeToKeyFamily(ctx.mode);  // 'major' | 'minor'
    const borrowSource: 'Aeolian' | 'Mixolydian' | 'Phrygian' | 'Dorian' =
        modeFamily === 'major'
          ? (sourceRoll < 0.80 ? 'Aeolian' : 'Mixolydian')
          : (sourceRoll < 0.20 ? 'Aeolian' : sourceRoll < 0.60 ? 'Dorian' : 'Phrygian');
    // ══════════════════════════════════════════════════════════════
    // Planner pipeline — TONICIZATION-FIRST (intent reservation
    // architecture per user music-theory rule).
    //
    //   Phase 1: Tonicization Planner claims its slots first
    //            (V/X, ii/X, target X). These slots become
    //            "reserved" for the local tonicization region.
    //
    //   Phase 2: Borrowed Planner runs on the post-Tonicization
    //            skeleton. It skips Tonicization-locked slots
    //            (`lockType`, roman has '/') AND skips target
    //            slots tagged with analysisKeyPc != home key root.
    //            Borrowed chord only fires in NON-RESERVED region.
    //
    //   Phase 3: Local Tonicization Color Planner runs on tagged
    //            target slots, inserts local-key borrowed flavor
    //            (iv/X, bII/X, bVII/X analyzed against local center).
    //
    // Per user rule: "tonicization intent 优先决定局部中心 / global
    // borrowed chord 只能在非 tonicization region 里发生 / local
    // borrowed chord 只能在 tonicized region 内、按 local key 发生".
    // ══════════════════════════════════════════════════════════════
    const _songKeyRootPc = ((noteToMidi(key + "0") % 12) + 12) % 12;

    // ── Phase 1: Tonicization claims its slots first ──────────────
    const tonicizeRandom = new Random(`${config.seed}::tonicize`);
    const afterTonic = planTonicization({
        skeleton: progression as ChordSkeletonSlot[],
        style,
        motifInterval: ctx.motifInterval,
        random: tonicizeRandom,
        beatsPerMeasure: ctx.meterContext.beatsPerMeasure,
        songKeyRootPc: _songKeyRootPc,
        borrowSource,  // P4 — same-degree substitution colors V/X by source
    });

    // ── Phase 2: Borrowed Planner on non-reserved slots ───────────
    const borrowRandom = new Random(`${config.seed}::borrow`);
    const afterBorrow = planBorrowedChords({
        skeleton: afterTonic,
        style,
        motifInterval: ctx.motifInterval,
        random: borrowRandom,
        beatsPerMeasure: ctx.meterContext.beatsPerMeasure,
        mode: ctx.mode,
        borrowSource,
        songKeyRootPc: _songKeyRootPc,
    });

    // ── Phase 3: Local Color in tonicization region ───────────────
    const localColorRandom = new Random(`${config.seed}::local-color`);
    const colored = planLocalTonicizationColor({
        skeleton: afterBorrow,
        style,
        random: localColorRandom,
        beatsPerMeasure: ctx.meterContext.beatsPerMeasure,
        songKeyRootPc: _songKeyRootPc,
    });

    // Convert roman numerals & abstract chord defs to concrete notes
    const realized = this.realizeProgression(colored, key, style, ctx);

    // Wide piano voicing post-process — attaches widePianoVoicing field
    // to each chord. spreadMode (close/half_wide/wide/drop2_wide) dispatched
    // per chord by music context (function/cell/section/phrase).
    // forked Random `${seed}::spread-mode` keeps choices deterministic
    // without perturbing main pipeline stream.
    const spreadRandom = new Random(`${config.seed}::spread-mode`);
    attachWidePianoVoicings({
      chords: realized,
      style,
      density: 0.5,
      keyRootPc: _songKeyRootPc,
      mode: ctx.mode,
      sectionFunction: ctx.sectionFunction,
      motifInterval: ctx.motifInterval,
      random: spreadRandom,
    });

    return realized;
  }

  // Stage 2 — Dynamic TSD-aware chord decoration with Look-ahead.
  //
  // Decision flow per chord:
  //   1. Roll colorLevel (0/1/2) from style.colorLevelProbabilities.
  //      Always consumes ONE random.next() — preserves determinism
  //      stream stability for non-decoration consumers.
  //   2. Classify the next chord's role via analyzeTargetQuality
  //      (MajorTarget / MinorTarget / Deceptive / Default).
  //   3. Look up DYNAMIC_TSD_DICTIONARY[style][currFunc] for matching
  //      target rule. Pick a chord-type from rule.levels[colorLevel].
  //   4. If the rule defines tritoneProb AND current→next root motion
  //      is a perfect-fifth-down (rootDelta = 5) AND non-deceptive,
  //      consume ONE conditional random.next() to roll Sub-V activation.
  //   5. Static fallback to colorChoices map if dynamic dict misses.
  //   6. Mode-aware filter for exotic modes (Mixolydian / Dorian /
  //      Phrygian / ...) — only when NOT triggering Sub-V.
  //   7. Data-debt guard: if final chord type isn't in CHORD_TYPES,
  //      downgrade to a safe default per function. Prevents silent
  //      fallback-to-'maj' chord when a typo / dict-only entry leaks
  //      through.
  //   8. Sub-V override: when isTritoneSub fires, statically map the
  //      Lydian Dominant chord type by colorLevel (no extra random).
  //      Override rootOffset (+6 semitones) and roman (subV/X). Stage
  //      3's Divisi 2.0 middleware re-classifies on the new bass.
  private decorateChordType(
      base: { roman: string; type: string; rootOffset: number; scaleDegree?: number },
      nextBase: { roman: string; type: string; rootOffset: number; scaleDegree?: number },
      style: StyleName,
      mode: string,
      forbidSubV: boolean = false,
  ): {
      type: string;
      rootOffsetOverride?: number;
      romanOverride?: string;
  } {
      const profile = STYLE_DICTIONARY[style] || STYLE_DICTIONARY['POP'];
      const probs = profile.colorLevelProbabilities;

      // Locked slot preservation gate. Borrowed-Chord Planner and
      // Tonicization Planner set lockType=true on their emitted slots
      // with the EXACT chord type they intend. Stage 2's dynamic dict
      // would otherwise re-classify based on roman + target-quality
      // and overwrite. Example failure: Borrowed Planner emits bVI
      // Abmaj7 (lockType=true) in C major; RNB.S MinorTarget rule
      // re-picks 'm9b5' at level 2 → Abmaj7 mutates to Abm9b5 → bVI
      // ceases to read as parallel-minor borrow and becomes an
      // unsourced half-diminished. Consume two random.next() calls
      // to preserve the snapshot stream order.
      if ((base as any).lockType) {
        this.random.next();
        this.random.next();
        return { type: base.type };
      }

      // Minor-blues / minor-explicit preservation gate. When the
      // progression slot explicitly authored a minor-family type
      // (min / min7 / m7 / m9 / m11) AND the roman is lowercase
      // (clearly a minor chord identity, not a maj-confusable label),
      // skip the dictionary decoration — Minor Blues / minor-jazz
      // sub-styles author min7 specifically and the dom7-centric
      // BLUES dictionary would otherwise overwrite it with '7' /
      // '9' / '13'. Still consume two random.next() calls (colorLevel
      // roll + later type pick) so the random stream stays stable.
      const isAuthoredMinor = (base.type === 'min' || base.type === 'min7'
        || base.type === 'm7' || base.type === 'm9' || base.type === 'm11')
        && base.roman === base.roman.toLowerCase();
      if (isAuthoredMinor) {
        // Consume both rolls to preserve stream order
        this.random.next();
        this.random.next();
        return { type: base.type };
      }

      // 1. Roll colorLevel — single random.next() always consumed.
      const r = this.random.next();
      let colorLevel: 0 | 1 | 2 = 0;
      if (r < probs.level0) colorLevel = 0;
      else if (r < probs.level0 + probs.level1) colorLevel = 1;
      else colorLevel = 2;

      const currFunc = this.getHarmonicFunction(base.roman);
      const nextFunc = this.getHarmonicFunction(nextBase.roman);

      // 2. Look-ahead context analysis.
      const targetQuality = analyzeTargetQuality(currFunc, nextFunc, nextBase.roman, nextBase.type);

      // 3. Dynamic dictionary lookup. Macro StyleName matches dict keys
      // 1-to-1 (POP / JAZZ / BLUES / RNB) — direct lookup, no routing.
      const rules = DYNAMIC_TSD_DICTIONARY[style]?.[currFunc];
      let choices: string[] | undefined;
      let isTritoneSub = false;

      if (rules) {
          const rule = rules.find(rl => rl.target === targetQuality)
              ?? rules.find(rl => rl.target === 'Default');
          if (rule && rule.levels[colorLevel]) {
              choices = rule.levels[colorLevel];

              // 4. Tritone Substitution probability check. Conditional
              // random.next() — only consumed when the look-ahead AND
              // tritoneProb are both present, so determinism only
              // varies on truly substitution-eligible spots.
              if (rule.tritoneProb && currFunc === 'D' && targetQuality !== 'Deceptive' && !forbidSubV) {
                  const rootDelta = (((nextBase.rootOffset - base.rootOffset) % 12) + 12) % 12;
                  if (rootDelta === 5 && this.random.next() < rule.tritoneProb) {
                      isTritoneSub = true;
                  }
              }
          }
      }

      // 5. Static fallback to colorChoices when dynamic dict misses.
      if (!choices || choices.length === 0) {
          const choicesMap = profile.colorChoices || STYLE_DICTIONARY['POP'].colorChoices!;
          const romanBase = base.roman.split('/')[0].replace(/maj7|m7|7|maj9|m9|7sus4|b/g, '');
          let staticChoices = choicesMap[base.roman] || choicesMap[romanBase];

          if (!staticChoices) {
              const isMinor = base.type === 'min'
                  || (base.type.startsWith('m') && !base.type.startsWith('maj'))
                  || base.roman === base.roman.toLowerCase();
              if (currFunc === 'D') staticChoices = choicesMap['V'];
              else if (currFunc === 'S') staticChoices = isMinor ? choicesMap['ii'] : choicesMap['IV'];
              else staticChoices = isMinor ? choicesMap['vi'] : choicesMap['I'];
          }
          choices = staticChoices?.[colorLevel] ?? [base.type];
      }

      // 6. Mode-aware audit. Skipped for:
      //    - Sub-V (tritone substitution intentionally outside palette)
      //    - Secondary dominant V/X (chord.roman.includes('/')) —
      //      V/X is BY DEFINITION non-diatonic to song mode (V of vi
      //      in major = altered E major triad / E7, NOT diatonic iii).
      //      Without this skip, mode filter rejects '7' for diatonic
      //      iii position and downgrades to 'min' / 'm7b5', killing
      //      the borrow.
      //    - Author-intent uppercase Roman in minor-family modes —
      //      a progression author writing 'V' (uppercase) in an Aeolian
      //      song means harmonic-minor V (major triad with leading-
      //      tone), NOT the modal v (minor). The audit's Aeolian table
      //      maps degree 5 → m7 (strict modal), which strips author
      //      intent and breaks Neapolitan / V→i cadences. The skip is
      //      strictly opt-in via uppercase Roman so native Aeolian
      //      uppercase chords (III / VI / VII = major triads in
      //      natural minor) keep working — those still map to 'maj' in
      //      the audit table and pass through unchanged.
      const isSecondaryDom = base.roman.includes('/');
      const romanStrippedAcc = base.roman.replace(/^[b#n]+/, '');
      const isUppercaseAuthor = romanStrippedAcc.length > 0
        && romanStrippedAcc[0] === romanStrippedAcc[0].toUpperCase()
        && /[A-Z]/.test(romanStrippedAcc[0]);
      const isMinorFamilyMode = mode === 'Aeolian' || mode === 'Minor'
        || mode === 'Dorian' || mode === 'Phrygian' || mode === 'Locrian'
        || mode === 'Harmonic Minor' || mode === 'Melodic Minor';
      // Specifically guard V uppercase (degree 5) — harmonic-minor V
      // is the cadence-essential case. III / VI / VII uppercase are
      // already maj in the audit table, so this guard is degree-5
      // specific to avoid over-blocking.
      const isAuthorHarmonicV = isUppercaseAuthor && isMinorFamilyMode
        && base.scaleDegree === 5;
      let pickFrom = choices;
      if (base.scaleDegree !== undefined && !isTritoneSub && !isSecondaryDom && !isAuthorHarmonicV) {
          const filtered = getModeAwareSubstitutions(pickFrom, mode, base.scaleDegree);
          // Guard: keep the un-filtered pool if mode-aware filter
          // emptied it (rather than crashing on random.pick of []).
          pickFrom = filtered.length > 0 ? filtered : choices;
      }
      // For V/X secondary dominants: filter out sus types. A sus4 V/X
      // (e.g. D7sus4 as V/vi in Bb major) replaces the major 3rd
      // (= F#, the BORROWED alteration) with the 4th (= G, diatonic
      // to Bb), which makes the chord fully diatonic to the song key.
      // Engine's getScaleForStyle then takes the diatonic fast path
      // and never picks the borrowed scale (Phrygian Dominant /
      // Mixolydian) — borrow becomes invisible. Force major-3rd dom
      // types so V/X retains its altered identity.
      if (isSecondaryDom) {
          const noSus = pickFrom.filter(t => !/sus/.test(t));
          // Fallback to '7' when the rule's level offers ONLY sus
          // variants (e.g. POP D MinorTarget level 1 = ['7sus4']).
          // Without explicit fallback, the un-filtered pickFrom would
          // keep '7sus4', triggering diatonic fast path and killing
          // the borrow.
          pickFrom = noSus.length > 0 ? noSus : ['7'];
      }

      let finalType = this.random.pick(pickFrom);

      // 7. Data-debt guard. If a dictionary entry references a chord
      // type that's not in CHORD_TYPES, the engine would silently
      // fall back to 'maj' triad downstream — losing all the color.
      // Catch the gap here and downgrade to a safe known type per
      // function instead.
      if (!CHORD_TYPES[finalType]) {
          if (currFunc === 'D') finalType = '7';
          else if (currFunc === 'S') finalType = targetQuality === 'MinorTarget' ? 'm7' : 'maj7';
          else finalType = targetQuality === 'MinorTarget' ? 'min' : 'maj';
      }

      // 8. Sub-V override — Lydian Dominant family. Statically mapped
      // from colorLevel; abandons the rolled finalType to avoid
      // monster strings like '7#9#11' (which would compose two
      // independent altered tensions and likely hit the data-debt
      // guard anyway). The substitution rewrites the chord's
      // rootOffset (+6 semitones = tritone away) AND roman (subV/X);
      // Stage 3's Divisi 2.0 middleware sees the new physical bass
      // and re-classifies the state cleanly without engine-side
      // special handling.
      if (isTritoneSub) {
          let subVType: string;
          if (colorLevel === 0) subVType = '7';
          else if (colorLevel === 1) subVType = '9';
          else subVType = targetQuality === 'MinorTarget' ? '7#11' : '13';

          return {
              type: subVType,
              rootOffsetOverride: ((base.rootOffset + 6) % 12 + 12) % 12,
              romanOverride: `subV/${nextBase.roman.split('/')[0]}`,
          };
      }

      return { type: finalType };
  }

  private generateProgression(
      style: StyleName,
      bars: number,
      mode: string,
      motifInterval: number = 0,
      sectionFunction: SectionFunction = 'VERSE',
  ): any[] {
      // ── Phase A: try modern prototype first (per user direction —
      // pre-authored 8/16-bar shapes replace "pick one template + loop").
      const protoMode: 'Major' | 'Minor' = modeToKeyFamily(mode) === 'minor' ? 'Minor' : 'Major';
      const functionRole: 'intro' | 'verse' | 'chorus' | 'bridge' | 'ending' =
          sectionFunction === 'INTRO'  ? 'intro'  :
          sectionFunction === 'CHORUS' ? 'chorus' :
          sectionFunction === 'BRIDGE' ? 'bridge' :
          sectionFunction === 'OUTRO'  ? 'ending' :
          'verse';
      const modernSkeleton = pickProgression({
          style, mode: protoMode, functionRole, bars,
          random: this.random,
      });
      if (modernSkeleton) {
          // Run Stage 2 decorateChordType — slots are lockType=true so the
          // dictionary's color sweetener can't overwrite the prototype's
          // authored chord types, but the two random.next() calls inside
          // decorateChordType still fire to keep the stream stable for
          // any downstream consumer expecting them.
          return modernSkeleton.map((skel, i) => {
              const nextSkel = modernSkeleton[(i + 1) % modernSkeleton.length];
              const isFirstPhrase = motifInterval > 0 && i < motifInterval;
              const deco = this.decorateChordType(skel, nextSkel, style, mode, isFirstPhrase);
              const isSubV = deco.romanOverride?.startsWith('subV/') ?? false;
              return {
                  ...skel,
                  type: deco.type,
                  ...(deco.rootOffsetOverride !== undefined ? { rootOffset: deco.rootOffsetOverride } : {}),
                  ...(deco.romanOverride !== undefined ? { roman: deco.romanOverride } : {}),
                  ...(isSubV ? {
                      borrowedSource: 'secondary_dominant' as const,
                      mustResolve: true,
                  } : {}),
              };
          });
      }

      // No modern + no legacy match — emit a minimal I-IV-V-I default
      // (should never happen since PROGRESSION_POOL auto-derives from
      // every sub-style's legacy data with broad sectionRoles metadata).
      const fallbackSlots = [
          { roman: 'I',  type: 'maj', scaleDegree: 1, rootOffset: 0 },
          { roman: 'IV', type: 'maj', scaleDegree: 4, rootOffset: 5 },
          { roman: 'V',  type: 'maj', scaleDegree: 5, rootOffset: 7 },
          { roman: 'I',  type: 'maj', scaleDegree: 1, rootOffset: 0 },
      ];
      const skeletons: any[] = [];
      for (let i = 0; i < bars; i++) {
          skeletons.push({ ...fallbackSlots[i % fallbackSlots.length] });
      }
      return skeletons.map((skel, i) => {
          const nextSkel = skeletons[(i + 1) % skeletons.length];
          const isFirstPhrase = motifInterval > 0 && i < motifInterval;
          const deco = this.decorateChordType(skel, nextSkel, style, mode, isFirstPhrase);
          const isSubV = deco.romanOverride?.startsWith('subV/') ?? false;
          return {
              ...skel,
              type: deco.type,
              ...(deco.rootOffsetOverride !== undefined ? { rootOffset: deco.rootOffsetOverride } : {}),
              ...(deco.romanOverride !== undefined ? { roman: deco.romanOverride } : {}),
              ...(isSubV ? {
                  borrowedSource: 'secondary_dominant' as const,
                  mustResolve: true,
              } : {}),
          };
      });
  }

  // === 声部连接平滑器 (Voice Leading Smoother) ===
  private voiceLeadingSmoother(prevNotesMidi: number[], pitchClasses: number[], prevChordRootPc: number = -1, currChordRootPc: number = -1, prevChordFunc: 'T' | 'S' | 'D' | null = null): number[] {
      // Voice leading — chord-to-chord 实施五大经典原则:
      //   1. Common tone retention — 共同音保留 (零位移强 bonus)
      //   2. Least motion — 半音位移最小化
      //   3. Smooth resolution — ≤2 半音优先
      //   4. Avoid parallel 5ths / octaves — 同向 P5/P8 penalty
      //   5. Guide tone resolve (jazz) — prev b7 → curr 3 半音下 bonus
      // 算法: 穷举 voice-to-pc permutation (N ≤ 5, 120 permutations
      // 最多), 每排列算 cost = motion penalty + parallel penalty -
      // guide-tone bonus - common-tone bonus, 选最小.

      const COMP_LOW = 53;   // F3 — bottom voice floor
      const COMP_HIGH = 80;  // G#5 — top voice ceiling
      const uniquePcs = Array.from(new Set(pitchClasses));
      const N = uniquePcs.length;

      // First chord — build a close voicing in the mid register, root
      // in bottom (no prev to lead from).
      if (prevNotesMidi.length === 0) {
          const baseOct = 4;
          const out: number[] = [];
          let cursor = uniquePcs[0] + (baseOct + 1) * 12;
          out.push(cursor);
          for (let i = 1; i < N; i++) {
              let next = uniquePcs[i] + Math.floor(cursor / 12) * 12;
              while (next <= cursor) next += 12;
              out.push(next);
              cursor = next;
          }
          return out;
      }

      // Helper: find the midi closest to refMidi sharing pitch class pc.
      const nearestMidiWithPc = (refMidi: number, pc: number): number => {
          const refOct = Math.floor(refMidi / 12);
          const candidates = [pc + refOct * 12, pc + (refOct - 1) * 12, pc + (refOct + 1) * 12];
          let best = candidates[0];
          let bestDist = Math.abs(best - refMidi);
          for (const c of candidates) {
              const d = Math.abs(c - refMidi);
              if (d < bestDist) { bestDist = d; best = c; }
          }
          return best;
      };

      // Guide tone pcs (jazz): prev b7 = prevRoot + 10; curr 3 =
      // currRoot + 4. When a prev voice is on b7 and the same voice
      // moves to curr 3 by half step (-1 semi), it's the ii-V-I
      // signature voice leading. Bonus.
      // Guide tone bonus 已内联到 cost loop (限 D 函数), 不需 module-level 缓存.

      // Enumerate permutations of uniquePcs assigned to prev voices.
      // For voice count mismatch we fill out the shorter array with
      // -1 placeholders so permutation indexing still works.
      const Vprev = prevNotesMidi.length;
      const permutationLen = Math.max(N, Vprev);
      // Pad uniquePcs (for permutation) so each permutation has length
      // permutationLen — extra slots flagged -1 (= "add new pc").
      const padded: number[] = [...uniquePcs];
      while (padded.length < permutationLen) padded.push(-1);

      const allPerms: number[][] = [];
      const permute = (arr: number[], start: number) => {
          if (start === arr.length - 1) { allPerms.push([...arr]); return; }
          for (let i = start; i < arr.length; i++) {
              [arr[start], arr[i]] = [arr[i], arr[start]];
              permute(arr, start + 1);
              [arr[start], arr[i]] = [arr[i], arr[start]];
          }
      };
      permute([...padded], 0);

      let bestVoicing: number[] = [];
      let bestCost = Infinity;

      for (const perm of allPerms) {
          const voicing: number[] = [];
          let cost = 0;

          for (let v = 0; v < Vprev; v++) {
              const targetPc = perm[v];
              if (targetPc < 0) continue;  // this prev voice is dropped
              const prevMidi = prevNotesMidi[v];
              const newMidi = nearestMidiWithPc(prevMidi, targetPc);
              voicing.push(newMidi);
              const movement = Math.abs(newMidi - prevMidi);

              // 老师哲学升级: 共同音 -25 (大幅强化 "能不动就不动"),
              // smooth ≤2 半音 -5 base + movement (奖励级进),
              // 3-4 半音 ×3, >4 半音 ×6 (严惩内声部大跳).
              if (movement === 0) {
                  cost -= 25;
              } else if (movement <= 2) {
                  cost += movement - 5;  // -5 base + small motion
              } else if (movement <= 4) {
                  cost += movement * 3;
              } else {
                  cost += movement * 6;
              }

              // Guide tone resolution bonus — 老师哲学: 强奖励倾向音
              // 半音解决. 限定 prev chord function === 'D' (= 真正的
              // 导音 / 属七音 才有解决意义). 其他 chord 上 chord 3rd
              // 跳到 next root 不算导音, 不给 bonus.
              if (prevChordFunc === 'D' && prevChordRootPc >= 0 && currChordRootPc >= 0) {
                  const prevPc = ((prevMidi % 12) + 12) % 12;
                  const newPc = ((newMidi % 12) + 12) % 12;
                  const prev3rd = ((prevChordRootPc + 4) % 12 + 12) % 12;  // 导音
                  const prev7th = ((prevChordRootPc + 10) % 12 + 12) % 12; // 属七音
                  const currRoot = ((currChordRootPc % 12) + 12) % 12;
                  const currMaj3 = ((currChordRootPc + 4) % 12 + 12) % 12;
                  const currMin3 = ((currChordRootPc + 3) % 12 + 12) % 12;
                  // 魔法 1: 导音半音向上解决 (3 → 1) — V→I 标志
                  if (prevPc === prev3rd && newPc === currRoot && newMidi > prevMidi && movement === 1) {
                      cost -= 20;
                  }
                  // 魔法 2: 属七音半音/全音向下解决 (b7 → 3) — guide tone
                  if (prevPc === prev7th && (newPc === currMaj3 || newPc === currMin3) && newMidi < prevMidi) {
                      cost -= 20;
                  }
              }
          }

          // Parallel 5th / octave penalty. Two voices moving same
          // direction with both prev AND curr intervals being P5 or P8.
          for (let i = 0; i < voicing.length; i++) {
              for (let j = i + 1; j < voicing.length; j++) {
                  // Get prev pair midis (same voice slot indices into
                  // the source prev array). voicing index = order of
                  // emit; map back through perm.
                  // Find which prev voice this voicing[i] came from
                  // by scanning prev → voicing assignment.
                  // (Simplest: track explicitly.)
                  // 实际上 voicing 跟 prev[v] (其中 perm[v]≥0) 一一对应:
                  // voicing 索引 k 对应 prev 索引 prevIdx[k].
                  // 为简化, 重算 (perm[v]≥0 的 v 序列就是 prev 对应序列).
                  // 提到 outer 块算就是.
              }
          }

          // 直接重算 prev → voicing 对应序列, 用同 i/j 检测平行
          const prevForVoicing: number[] = [];
          for (let v = 0; v < Vprev; v++) {
              if (perm[v] >= 0) prevForVoicing.push(prevNotesMidi[v]);
          }
          for (let i = 0; i < voicing.length; i++) {
              for (let j = i + 1; j < voicing.length; j++) {
                  const prevInt = Math.abs(prevForVoicing[i] - prevForVoicing[j]) % 12;
                  const currInt = Math.abs(voicing[i] - voicing[j]) % 12;
                  // P5 (= 7 semitones) or P8 (= 0 semitones, octave apart)
                  const isParallelInterval = (prevInt === 7 && currInt === 7)
                      || (prevInt === 0 && currInt === 0 && prevForVoicing[i] !== prevForVoicing[j]);
                  if (!isParallelInterval) continue;
                  // Both voices must move the same direction (and non-zero)
                  const dir1 = Math.sign(voicing[i] - prevForVoicing[i]);
                  const dir2 = Math.sign(voicing[j] - prevForVoicing[j]);
                  if (dir1 !== 0 && dir1 === dir2) {
                      cost += 25;  // strong penalty
                  }
              }
          }

          // Handle target-pc not yet placed (perm[v] < 0 prev slot OR
          // N > Vprev → uniquePcs not all used). Append in octave above
          // current top.
          const usedPcs = new Set(voicing.map(m => ((m % 12) + 12) % 12));
          for (const pc of uniquePcs) {
              if (usedPcs.has(pc)) continue;
              const top = voicing.length > 0 ? Math.max(...voicing) : 60;
              let extra = pc + Math.floor(top / 12) * 12;
              while (extra <= top) extra += 12;
              voicing.push(extra);
              usedPcs.add(pc);
              cost += 3;  // small penalty: introducing a new pc costs a bit
          }

          // Skip degenerate (zero-voice) results.
          if (voicing.length === 0) continue;
          // Register clamp
          const sorted = voicing.slice().sort((a, b) => a - b);
          if (sorted[0] < COMP_LOW - 12) cost += 50;
          if (sorted[sorted.length - 1] > COMP_HIGH + 12) cost += 50;

          if (cost < bestCost) {
              bestCost = cost;
              bestVoicing = sorted;
          }
      }

      // Final register clamp on the winner
      while (bestVoicing.length > 0 && bestVoicing[0] < COMP_LOW) bestVoicing[0] += 12;
      while (bestVoicing.length > 0 && bestVoicing[bestVoicing.length - 1] > COMP_HIGH) bestVoicing[bestVoicing.length - 1] -= 12;
      bestVoicing.sort((a, b) => a - b);
      return bestVoicing;
  }

  // === 动机变奏算法机 (Motif Mutator) ===
  private motifMutator(
      motif: any[],
      _style: StyleName,
      _density: number,
      _complexity: number,
      _isShuffle: boolean,
  ): any[] {
      // Phase 6 — motifMutator REMOVED.
      //
      // The mutator used to add 3 style-based per-note transformations:
      //   - JAZZ chromatic-approach insert  (extra half-step neighbor before notes with gap ≥ 0.5)
      //   - POP funk stutter                 (split a hold ≥ 0.75 beat into 0.25 + rest + 0.25)
      //   - POP ballad legato                (extend hold to fill 0.1-1.0 gap)
      // Plus a final QUANTIZED_DURATIONS snap (rounded each duration to 16th/8th/...).
      //
      // With Impro-Visor licks as the sole melody source, the lick
      // author wrote the rhythm. Stutter / legato / chromatic-approach
      // additions ON TOP of a lick obliterate the authored shape; the
      // duration quantizer destroys triplets (0.333 → 0.25 = wrong
      // rhythm). Pass through unchanged.
      return motif.map(n => ({ ...n }));
  }

  private realizeProgression(abstractPath: ChordSkeletonSlot[], key: string, style: StyleName, ctx: ResolvedGenerationContext): ChordDef[] {
      const keyIndex = Math.max(0, KEYS.indexOf(key));
      const isMinorKey = modeToKeyFamily(ctx.mode) === 'minor';
      // Major-mode degree map. degreeOffsets gives diatonic root
      // semitones above tonic per Roman numeral.
      const degreeOffsets: Record<string, number> = {
          'I': 0, 'ii': 2, 'iii': 4, 'IV': 5, 'V': 7, 'vi': 9, 'vii': 11
      };
      // Aeolian/Minor degree map — III / VI / VII are b3 / b6 / b7
      // relative to the tonic in natural minor. Used for resolving
      // secondary-dom target labels in minor songs (V/III in C minor
      // should target Eb, not E — without this, localTonalCenterPc
      // and the evaluator's borrowed-key frame both drift one semitone).
      const minorDegreeOffsets: Record<string, number> = {
          'i': 0, 'I': 0, 'ii': 2, 'II': 2, 'iii': 3, 'III': 3,
          'iv': 5, 'IV': 5, 'v': 7, 'V': 7, 'vi': 8, 'VI': 8,
          'vii': 10, 'VII': 10,
      };
      const activeDegreeOffsets = isMinorKey ? minorDegreeOffsets : degreeOffsets;

      const parsedChords: ChordDef[] = [];
      
      abstractPath.forEach((ap, apIdx) => {
          let rootOffset = 0;
          let activeType = ap.type;

          if (ap.rootOffset !== undefined) {
              rootOffset = ap.rootOffset;
          } else if (ap.roman.includes('/')) {
              // e.g. V/vi
              const [chordPart, targetPart] = ap.roman.split('/');
              const targetOffset = degreeOffsets[targetPart] || 0;
              if (chordPart === 'V') {
                  rootOffset = (targetOffset + 7) % 12; // V of the target
              } else if (chordPart === 'iim7') {
                  rootOffset = (targetOffset + 2) % 12;
              } else if (chordPart === 'V7') {
                  rootOffset = (targetOffset + 7) % 12;
              }
          } else {
              const baseRoman = ap.roman.replace(/maj7|m7|7|maj9|m9|7sus4|b/, '');
              if (ap.roman.startsWith('bVII')) {
                  rootOffset = 10;
              } else {
                  rootOffset = degreeOffsets[baseRoman] !== undefined ? degreeOffsets[baseRoman] : 0;
              }
          }

          // Chord-type alias normalization — the single bottleneck
          // that determines whether the chord identity survives into
          // the voicing layer. CHORD_TYPES is keyed by canonical names
          // ('m7', 'maj7', not 'min7' / 'Maj7'); raw lookup with an
          // alias returns undefined → fall-through to CHORD_TYPES['maj']
          // → [0,4,7] major triad → chord identity destroyed. Runs
          // BEFORE the POP sweetener so the sweetener's `=== 'maj'` /
          // `=== 'min'` literal checks see canonical names regardless
          // of how the sub-style authored them ('Maj' / 'Min' /
          // 'major' aliases all collapse to 'maj' / 'min' first).
          const normalized = normalizeChordType(activeType);
          if (normalized) activeType = normalized;

          // POP late-stage type sweetener — skipped when the slot is
          // Planner-locked (Tonicization Planner already chose the
          // chord identity, e.g. m7b5 on a minor-target ii-V; an
          // add9 / m7 promotion would undo the tonicization). Planner
          // slots set ap.lockType = true.
          if (!ap.lockType && style === 'POP' && activeType === 'maj') activeType = this.random.next() > 0.5 ? 'add9' : 'maj';
          if (!ap.lockType && style === 'POP' && activeType === 'min') activeType = this.random.next() > 0.5 ? 'm7' : 'min';

          const rootKeyIndex = (keyIndex + rootOffset) % 12;
          // Key-context-aware spelling: D major spells pc 6 as F# (not Gb),
          // Bb major spells pc 3 as Eb (not D#).
          const rootName = spellPcInKey(rootKeyIndex, keyIndex, isMinorKey);
          const intervals = CHORD_TYPES[activeType] || CHORD_TYPES['maj'];

          // ─── Voicing pipeline (Stage G refactor) ───────────────
          //
          // Architecture:
          //   1. BASS first (G5 prep): bassline rule decides the bass
          //      MIDI. This must happen before voicing because the
          //      voicing octave placer (G3) needs the bass position
          //      to enforce the 8-14 semitone "sweet spot" gap.
          //   2. PCS selection (G2): existing style voicing tables
          //      (JAZZ_ROOTLESS / POP / BLUES / RNB) take precedence
          //      when they have an entry for this chord type — they
          //      encode Stage B's hand-tuned Bill Evans / Glasper /
          //      etc. knowledge. When tables miss, assembleVoicing
          //      synthesizes pcs via aesthetic table + clash arbitration
          //      (fixes POP V7b13 and other altered cases).
          //   3. MIDI placement (G3): placeVoicingMidi replaces the old
          //      voiceLeadingSmoother. Multi-objective brute-force search
          //      finds octaves matching preferredRegister hints + bass
          //      distance constraint + voice-leading. This fixes the
          //      84%-mid-range-tenor-gap problem uniformly.
          //
          // Step 1: pcs selection — existing style voicing table takes
          // precedence (Stage B hand-tuned wisdom), assembleVoicing as
          // principled fallback.
          const compingMode = STYLE_DICTIONARY[style]?.compingVoicingMode ?? 'shell';
          const stylePref: VoicingStylePreference =
              compingMode === 'rootless' ? STYLE_ROOTLESS :
              compingMode === 'cluster'  ? STYLE_CLUSTER  :
              compingMode === 'full'     ? STYLE_FULL     :
              compingMode === 'blues'    ? STYLE_BLUES    :
              STYLE_SHELL;

          const overrideTable: Record<string, number[]> | null =
              compingMode === 'rootless' ? JAZZ_ROOTLESS_VOICINGS :
              compingMode === 'cluster'  ? RNB_VOICINGS           :
              compingMode === 'full'     ? POP_VOICINGS           :
              compingMode === 'blues'    ? BLUES_VOICINGS         :
              null;
          const overrideIntervals = overrideTable ? overrideTable[activeType] : undefined;

          let compingPcs: number[];
          if (overrideIntervals) {
              // Use hand-tuned voicing table (Bill Evans / Glasper /
              // boogie-style etc.). Preserves Stage B listening quality.
              compingPcs = overrideIntervals.map(iv => (((rootKeyIndex + iv) % 12) + 12) % 12);
              // Dedupe pcs (overrides with octave-doubling like b13 = 20
              // produce same pc as 8, both fold to same chroma).
              compingPcs = Array.from(new Set(compingPcs));
          } else {
              // Principled fallback: aesthetic-table-driven assembly with
              // pair-wise clash arbitration. Fixes POP V7b13 and other
              // altered chord cases.
              compingPcs = assembleVoicing(activeType, rootKeyIndex, stylePref);
          }

          // Secondary dominant 9th injection — preserved from prior
          // architecture. V/X chords get +9 color baked in.
          const isSecondaryDom = ap.roman.includes('/');
          if (isSecondaryDom) {
              const ninthPc = (((rootKeyIndex + 2) % 12) + 12) % 12;
              if (!compingPcs.includes(ninthPc)) compingPcs.push(ninthPc);
          }

          // `pitchClasses` retained for downstream consumers (bassline
          // rules, Divisi 2.0 evaluateTensionState) that read pcs as a
          // sounding-pcs set.
          const pitchClasses = compingPcs;

          // Step 2: Bass — G5 Bass Planner.
          //
          // resolveBassAnchorPc reads slot.bassRole (default 'root') and
          // returns the pc where bass anchors. Inversion (bassRole='3rd'
          // / '5th' / '7th' / 'pedal') overrides the bassline rule and
          // simply holds the anchor pc in BASS_RANGE — bass walk patterns
          // (boogie / stride) don't apply to intentional inversions.
          // Default 'root' goes through the bassline rule as before.
          const slotBassRole = ap.bassRole;
          const slotBassPedalPc = ap.bassPedalPc;
          const bassAnchorPc = resolveBassAnchorPc(
              slotBassRole, rootKeyIndex, intervals, slotBassPedalPc,
          );

          const ruleFn = BASSLINE_RULES[ctx.basslineRule] ?? BASSLINE_RULES[DEFAULT_BASSLINE_RULE];
          const prevBassMidi = parsedChords.length > 0
              ? parsedChords[parsedChords.length - 1].bassMidi
              : null;
          const isCadenceToTonic = ap.roman === 'I'
              && parsedChords.length > 0
              && abstractPath[parsedChords.length - 1].roman.includes('V');

          // Structural root-anchor positions — periodic re-grounding
          // of the bass on the actual chord root so the listener
          // regains tonal gravity. Without this, stepwise_descent (the
          // default bassline rule for POP / JAZZ / RNB) walks an
          // unbroken descent through inversions and the harmony loses
          // its identity (audited at avg 78.9% non-Solid before this
          // fix, 8/8 seeds affected, RNB / JAZZ-minor at 100%).
          //
          // Three trigger conditions:
          //   1. bar 0 — song opening MUST anchor the tonal center.
          //   2. phrase boundaries (every motifInterval bars) — each
          //      new phrase starts with a clean root statement so the
          //      listener resets their tonal expectation.
          //   3. cadential landings — when the previous bar's chord
          //      function was D and this bar is the resolution (T or
          //      its substitute), anchor the resolution on root to
          //      complete the cadence audibly.
          //
          // last-bar root is already enforced by individual bassline
          // rules' isLast branch — kept there for backward compatibility.
          const isBarStart = parsedChords.length === 0;
          const isPhraseBoundary = ctx.motifInterval > 0
              && parsedChords.length > 0
              && parsedChords.length % ctx.motifInterval === 0;
          const prevRoman = parsedChords.length > 0
              ? abstractPath[parsedChords.length - 1].roman
              : '';
          // Dominant detection: primary V (with quality suffix like
          // V7, V9, V7alt) OR secondary V/X (V/ii, V/IV, V/vi). The
          // legacy substring check `includes('V') && !includes('VI')
          // && !includes('IV')` mis-classified V/IV and V/vi as
          // non-dominant because their target tokens contain 'IV'/'VI',
          // so the cadence to those targets missed the force-root
          // anchor. Parse the secondary-dominant target explicitly:
          //   V/X        → dominant of X, expect ap.roman == X
          //   V or V7 …  → primary dominant, expect tonic-class landing
          const isPrimaryV = /^V[^/IiVv]*$|^V$/.test(prevRoman.split('/')[0])
              && prevRoman.split('/')[0] !== 'IV'
              && prevRoman.split('/')[0] !== 'VI';
          const isSecondaryV = prevRoman.startsWith('V/') || prevRoman.startsWith('V7/');
          const secondaryTarget = isSecondaryV
              ? prevRoman.split('/')[1]
              : null;
          const PRIMARY_LANDING_ROMANS = new Set([
              'I', 'i', 'vi', 'VI', 'bVI', 'IV', 'iv',
          ]);
          const isResolutionLanding = (isPrimaryV && PRIMARY_LANDING_ROMANS.has(ap.roman))
              || (isSecondaryV && secondaryTarget !== null
                  && (ap.roman === secondaryTarget
                      || ap.roman.toLowerCase() === secondaryTarget.toLowerCase()));

          // Planner-tagged target-binding: any chord whose previous chord
          // is marked mustResolve (subV/X, ii/X, bVII7 backdoor — the
          // planner sets this on the source, target is the immediate next
          // chord) MUST anchor on root unless the target slot explicitly
          // declares its own inversion (slash / pedal). Subsumes the V/X
          // path via planner data instead of roman parsing, so it covers
          // tritone substitution + backdoor + chain-of-fifths landings
          // that the regex above misses.
          //
          // Source: user spec "任何 mustResolve target: target chord 第一次
          // 出现时 bassRole = root, 除非明确 slash/pedal style".
          const prevMustResolve = parsedChords.length > 0
              && parsedChords[parsedChords.length - 1].mustResolve === true;
          const targetHasExplicitInversion = slotBassRole !== undefined && slotBassRole !== 'root';
          const isMustResolveLanding = prevMustResolve && !targetHasExplicitInversion;

          const forceRootAnchor = isBarStart || isPhraseBoundary || isResolutionLanding || isMustResolveLanding;

          let bassM: number;
          if (slotBassRole && slotBassRole !== 'root') {
              // Intentional inversion / pedal — bypass rule, hold anchor.
              bassM = clampPcToBassMidi(bassAnchorPc);
          } else if (forceRootAnchor) {
              // Structural anchor — root in bass register.
              bassM = clampPcToBassMidi(bassAnchorPc);
          } else {
              // Bass should ONLY anchor on chord literal pcs (1 / 3 / 5 / 7) —
              // never on extensions (9 / 11 / 13). 9-in-the-bass produces an
              // m9 / b9 crash against the chord's b3 / 3 stacked above (audited
              // case: JAZZ_002 had Em7/F# where F# = 9 of Em, voicing G3 above
              // = cross-octave m9 grind). slice(0, 4) takes only the first
              // four chord-type intervals — 1/3/5/7 for tetrads, 1/3/5 for
              // triads, 1/4/5/b7 for sus tetrads (sus4 = legal "substitute 3rd",
              // NOT extension).
              const chordLiteralPcs = intervals.slice(0, 4).map(iv => ((rootKeyIndex + iv) % 12 + 12) % 12);
              bassM = ruleFn({
                  chordRootPc: rootKeyIndex,
                  bassAnchorPc,
                  pitchClasses: chordLiteralPcs,
                  prevBassMidi,
                  isCadenceToTonic,
                  isLast: parsedChords.length === abstractPath.length - 1,
                  barIndex: parsedChords.length,
                  random: this.random,
              });
          }

          // Step 3a: Chord-identity guard for inversions (G7 fix).
          // When bass lands on a non-root chord tone (1st/2nd/3rd
          // inversion — either via bassRole or via the bassline rule
          // walking into it), the upper voicing must (a) contain the
          // root for chord identity and (b) avoid doubling the bass pc.
          //
          // Without this guard, rootless/cluster modes drop the root,
          // and when bass ends up on the b3 (or 3 / 5), the upper
          // voices form a DIFFERENT chord — e.g. Am7/C with cluster
          // would voice as {C, E, G, B} = Cmaj7 sound, losing all
          // Am identity. See rnb_1yxp4j bar 2 audit before this fix.
          const inversionBassPc = (((bassM % 12) + 12) % 12);
          if (inversionBassPc !== rootKeyIndex && stylePref.rootPolicy === 'omit') {
              // Remove bass pc from upper voicing (no doubling),
              // add root pc (chord identity).
              compingPcs = compingPcs.filter(pc => pc !== inversionBassPc);
              if (!compingPcs.includes(rootKeyIndex)) {
                  compingPcs.push(rootKeyIndex);
              }
          }

          // Step 3b: MIDI placement via placeVoicingMidi (G3). Replaces
          // the old voiceLeadingSmoother — adds preferredRegister hints
          // + bass-to-voicing-bottom 8-14 sweet-spot constraint that
          // fixes the 84% mid-range tenor-gap problem.
          const prevCompingMidi = parsedChords.length > 0
              ? (parsedChords[parsedChords.length - 1].notesMidi
                  ?? parsedChords[parsedChords.length - 1].notes.map(n => noteToMidi(n)))
              : [];
          const closeVoicingMidi = placeVoicingMidi(
              compingPcs, prevCompingMidi, bassM, activeType, rootKeyIndex,
          );

          // Step 3c: Arrangement transform (L3 multi-axis dispatch).
          //
          // See Engine.pickArrangementMode for the full Tier 1 / Tier 2 / Tier 3
          // logic. Synopsis:
          //   - Hard constraint: cadence / final / < 4 voices → close;
          //     m9 between bottom-top → reject candidate
          //   - Top-voice motion to prev (primary score axis — Bill Evans rule)
          //   - Function (TSD) + bass motion direction + section function bias
          //
          // Prev-chord state pulled from parsedChords (which is built as we go);
          // first bar uses null for prev fields → Tier 3 silenced for it.
          const prevChord = parsedChords.length > 0
              ? parsedChords[parsedChords.length - 1]
              : null;
          const prevTopVoice = prevChord && prevChord.notesMidi.length > 0
              ? Math.max(...prevChord.notesMidi)
              : null;
          const arrangementMode = this.pickArrangementMode({
              closeVoicing: closeVoicingMidi,
              bassMidi: bassM,
              prevTopVoice,
              prevBassMidi,
              prevArrangement: prevChord?.arrangementMode ?? null,
              chordFunc: ap.effectiveFunc ?? this.getHarmonicFunction(ap.roman),
              barIndex: parsedChords.length,
              totalBars: abstractPath.length,
              motifInterval: ctx.motifInterval,
              sectionFunction: ctx.sectionFunction,
          });
          const compingNotesMidi = applyArrangement(
              closeVoicingMidi, arrangementMode, bassM,
          );

          // Divisi 2.0 — Harmonic state machine middleware. Now that
          // bassM is finalized (whether forced by style.basslineRules
          // or naturally walked by stepwise_descent / etc.), classify
          // the chord's actual sounding state via evaluateTensionState.
          // Downstream Stage 4 layers (texture Smart Omit, cadence
          // intercept, virtual-extension magnetism) read these fields.
          const bassPc = ((bassM % 12) + 12) % 12;
          const upperRootPc = ((rootKeyIndex % 12) + 12) % 12;
          // Logical chord pcs = upper voicing + chord's logical root.
          // For rootless voicings (Bill Evans A-position etc.) the
          // physical upper voicing OMITS the root, but the listener
          // still hears the chord as rooted on rootKeyIndex when bass
          // plays it. Without including the logical root in chordPcs,
          // evaluateTensionState would see bass-not-in-upper-shell and
          // misfire SlashChord — turning every rootless-voicing root-
          // position chord into a false slash-chord label. The Stage G7
          // chord-identity guard already ensures the root is sounding
          // (either in upper voicing or in bass); reflecting that in
          // chordPcs aligns the state-machine input with audible reality.
          const pitchClassesSet = new Set(pitchClasses);
          pitchClassesSet.add(upperRootPc);
          const keyRootPc = ((noteToMidi(key + "0") % 12) + 12) % 12;
          const originalFunc = this.getHarmonicFunction(ap.roman);
          const harmonicState = evaluateTensionState(
              upperRootPc, pitchClassesSet, bassPc, originalFunc, keyRootPc, ap.roman
          );

          // Reverse-derive the UI display symbol so what the listener
          // hears IS what the chord grid shows. When bass != root pc,
          // append `/{bassNote}` slash notation. Both root and bass
          // spelled via spellPcInKey so accidentals follow the song's
          // key signature (D major: F# not Gb; Bb major: Eb not D#).
          //
          // Symbol upgrade: when the voicing contains extensions (9 /
          // 11 / 13) that the base chord type doesn't, upgrade the
          // displayed type to reflect what the listener actually
          // hears. E.g. m7 voicing with M9 (pc 2 from root) becomes
          // m9 in the label even though chord.type stays 'm7' (so
          // TENDENCY_TABLE scenario lookup doesn't change). Without
          // this, the label says "Fm7" while the chord audibly is
          // Fm9 — listener sees "Fm7" but hears m9.
          const voicingPcSet = new Set(compingNotesMidi.map(m => ((m % 12) + 12) % 12));
          const has9 = voicingPcSet.has(((rootKeyIndex + 2) % 12 + 12) % 12);
          const has11 = voicingPcSet.has(((rootKeyIndex + 5) % 12 + 12) % 12);
          const has13 = voicingPcSet.has(((rootKeyIndex + 9) % 12 + 12) % 12);
          let displayType = activeType;
          // Only upgrade base 7-chord types (don't touch already-
          // extended types like 'maj9', '13', '7#11', altered, etc.).
          if (activeType === 'm7') {
              if (has9 && has11) displayType = 'm11';
              else if (has9 && has13) displayType = 'm13';
              else if (has9) displayType = 'm9';
              else if (has11) displayType = 'm7add11';
          } else if (activeType === 'maj7') {
              if (has9 && has13) displayType = 'maj13';
              else if (has9) displayType = 'maj9';
              else if (has13) displayType = 'maj7add13';
          } else if (activeType === '7') {
              if (has9 && has13) displayType = '13';
              else if (has9) displayType = '9';
              else if (has13) displayType = '7add13';
          } else if (activeType === 'min' || activeType === 'm') {
              if (has9 && has11) displayType = 'm11';
              else if (has9) displayType = 'madd9';
          } else if (activeType === 'maj') {
              if (has9 && has13) displayType = '6/9';
              else if (has9) displayType = 'add9';
              else if (has13) displayType = '6';
          }
          const displayChordSymbol = bassPc === upperRootPc
              ? `${rootName}${displayType === 'maj' ? '' : displayType}`
              : `${rootName}${displayType === 'maj' ? '' : displayType}/${spellPcInKey(bassPc, keyIndex, isMinorKey)}`;

          // Bass pattern dispatch (老师 4 — BASSLINE 自有线条).
          // When style.bassPattern names a registered pattern rule,
          // generate the bar's full bass event sequence here. Anchor
          // bassM stays as chord.bassMidi (used by Divisi 2.0 state
          // detection above + virtual-extension calc). The pattern
          // events run in addition / replacement at applyTexture stage.
          const bassPatternKey = STYLE_DICTIONARY[style]?.bassPattern;
          let bassPatternEvents: { time: number; midi: number; duration: number; velocity: number }[] | undefined;
          // 老师哲学: V/X 副属和弦的 bass walk-up / inversion 推进.
          // 优先级最高 — chord-level override 在 style-level bassPattern
          // 之前. forked random 选两种地道的 R&B / Gospel 推进:
          //   (a) 跳进式 (inversion shift): beat 0-1 root, beat 2-3 chord
          //       3rd in bass. 配合上层 add9 色彩 = "Eadd9/G#" 听感.
          //   (b) Walk-up (stepwise): root → 3rd → 5th → leading-to-next
          //       (next chord root - 1 半音). 经典 Gospel 行进 bass.
          //   两种都符合老师"V/X 后半小节低音上扬"要求.
          if (isSecondaryDom) {
              const isMinorChord = activeType === 'min' || activeType === 'm7' || activeType === 'm9'
                  || activeType === 'm11' || activeType === 'm7b5' || activeType === 'dim' || activeType === 'dim7';
              const thirdSemis = isMinorChord ? 3 : 4;
              const fifthSemis = activeType === 'dim' || activeType === 'dim7' || activeType === 'm7b5'
                  ? 6 : (activeType === 'aug' ? 8 : 7);
              const clampBass = (m: number): number => {
                  while (m < 33) m += 12;
                  while (m > 55) m -= 12;
                  return m;
              };
              const thirdBassMidi = clampBass(((rootKeyIndex + thirdSemis) % 12) + 36);
              const fifthBassMidi = clampBass(((rootKeyIndex + fifthSemis) % 12) + 36);
              const modeRoll = this.random.next();
              if (modeRoll < 0.5) {
                  // (a) 跳进式: 转位切换 root → 3rd
                  bassPatternEvents = [
                      { time: 0, midi: bassM, duration: 2, velocity: 92 },
                      { time: 2, midi: thirdBassMidi, duration: 2, velocity: 96 },
                  ];
              } else {
                  // (b) Walk-up: 4 拍 stepwise root → 3rd → 5th → leading
                  // 算 next chord root pc (peek abstractPath)
                  const nextAp = abstractPath[apIdx + 1];
                  let leadingMidi = thirdBassMidi;
                  if (nextAp) {
                      let nextRootOff = nextAp.rootOffset;
                      if (nextRootOff === undefined) {
                          const baseRoman = nextAp.roman.replace(/maj7|m7|7|maj9|m9|7sus4|b/, '');
                          nextRootOff = nextAp.roman.startsWith('bVII') ? 10 : (degreeOffsets[baseRoman] ?? 0);
                      }
                      const nextRootPc = (keyIndex + nextRootOff) % 12;
                      const leadingPc = ((nextRootPc - 1) % 12 + 12) % 12;
                      leadingMidi = clampBass(leadingPc + 36);
                  }
                  bassPatternEvents = [
                      { time: 0, midi: bassM, duration: 1, velocity: 95 },
                      { time: 1, midi: thirdBassMidi, duration: 1, velocity: 88 },
                      { time: 2, midi: fifthBassMidi, duration: 1, velocity: 90 },
                      { time: 3, midi: leadingMidi, duration: 1, velocity: 96 },
                  ];
              }
          } else if (bassPatternKey && BASS_PATTERN_RULES[bassPatternKey]) {
              // Same chord-literal-only filter as the bass anchor — stride /
              // boogie / dilla pick "high beat" chord tone from this set;
              // restricting to 1/3/5/7 prevents extension-in-bass-register
              // (e.g. stride high beat picking the 9 = m9 cluster vs root).
              const chordLiteralPcsPat = intervals.slice(0, 4).map(iv => ((rootKeyIndex + iv) % 12 + 12) % 12);
              bassPatternEvents = BASS_PATTERN_RULES[bassPatternKey]({
                  chordRootPc: rootKeyIndex,
                  // bassPc = the ACTUAL bass MIDI's pc (what bassline rule
                  // selected). Single source of truth — chord.bass label,
                  // bass pattern, Divisi 2.0 state all reference the same pc.
                  bassPc: ((bassM % 12) + 12) % 12,
                  pitchClasses: chordLiteralPcsPat,
                  prevBassMidi,
                  isCadenceToTonic,
                  isLast: parsedChords.length === abstractPath.length - 1,
                  barIndex: parsedChords.length,
                  random: this.random,
              });
          }

          // Modal-mixture label. Two sources, in priority order:
          //   1. Planner-injected:  ap.borrowedFrom set by mixture
          //      Planner (active modal-interchange step) — verbatim.
          //   2. Detector-inferred: detectModeBorrowing pattern check
          //      catches mixture chords that came from the dictionary
          //      itself (e.g. pop_002's Em7 in A major is in the
          //      progression template, not Planner-injected).
          const _nextAp = (apIdx + 1) < abstractPath.length ? abstractPath[apIdx + 1] : null;
          const _nextRootPc = _nextAp ? (((keyIndex + (_nextAp.rootOffset ?? 0)) % 12 + 12) % 12) : undefined;
          const borrowed = ap.borrowedFrom ?? detectModeBorrowing(
              rootKeyIndex,
              activeType,
              keyIndex,
              ctx.mode,
              ap.roman,
              _nextRootPc,
          );

          // Local tonal center — set at harmony layer where borrowing
          // is decided. Default = global key root. For secondary
          // dominants (roman like V/ii, V/vi, subV/X), the borrowing
          // target's pc becomes the local center. Downstream melody
          // evaluator reads this field verbatim — no rederivation.
          //
          // Tonicization Planner pre-computes localTonalCenterPc on its
          // inserted ii/V slots — honor that verbatim (no re-derivation
          // via roman parsing, which would fail on the ii/X label that
          // the planner uses but the harmony parser below doesn't yet
          // recognise).
          let localTonalCenterPc: number = (ap.localTonalCenterPc !== undefined)
              ? ap.localTonalCenterPc
              : keyIndex;
          if (ap.localTonalCenterPc === undefined && ap.roman.includes('/')) {
              const targetPart = ap.roman.split('/')[1];
              // targetPart may be 'ii' / 'IV' / 'vi' etc. Strip flat /
              // sharp prefix (rare) and uppercase-vs-lowercase variation.
              // Use activeDegreeOffsets (mode-aware): in Aeolian/Minor,
              // uppercase III/VI/VII resolve to b3/b6/b7 (=3/8/10) per
              // natural-minor degrees — NOT the Major-mode 4/9/11. Without
              // this dispatch, subV/III in C minor would localize at E
              // (pc 4) but the actual Eb chord (pc 3) lives one semitone
              // away, putting the evaluator's borrowed-key frame on the
              // wrong tonic.
              const cleanTarget = targetPart.replace(/^b/, '').replace(/^#/, '');
              const targetDegreeOffset = activeDegreeOffsets[cleanTarget]
                  ?? activeDegreeOffsets[cleanTarget.charAt(0).toUpperCase() + cleanTarget.slice(1).toLowerCase()]
                  ?? activeDegreeOffsets[cleanTarget.toLowerCase()];
              if (targetDegreeOffset !== undefined) {
                  let offset = targetDegreeOffset;
                  if (targetPart.startsWith('b')) offset = (offset - 1 + 12) % 12;
                  else if (targetPart.startsWith('#')) offset = (offset + 1) % 12;
                  localTonalCenterPc = (keyIndex + offset) % 12;
              }
          }

          parsedChords.push({
              root: rootName,
              rootMidi: rootKeyIndex + 48, // Default to octave 4 for root references
              type: activeType,
              roman: ap.roman,
              bass: midiToNoteInKey(bassM, keyIndex, isMinorKey),
              bassMidi: bassM,
              // Chord voicing notes use chord-root-relative spelling so
              // altered tensions read with correct accidentals (b9 of A7
              // is Bb, not A#; #11 of F is B, not Cb).
              notes: compingNotesMidi.map(m => midiToNoteInChord(m, rootKeyIndex, keyIndex, isMinorKey, activeType)),
              notesMidi: compingNotesMidi.slice(),
              forcedScale: ap.forcedScale,
              // Slot length in quarter-note time. Defaults to one full
              // bar (meter.beatsPerMeasure) when the skeleton author
              // doesn't specify beats. Sub-bar values (e.g. beats=2 in
              // 4/4) let a downstream Tonicization Planner split a bar
              // for ii-V insertions; two slots with beats=2 fill one
              // bar with two chords.
              duration: ap.beats ?? ctx.meterContext.beatsPerMeasure,
              tensionState: harmonicState.tensionState,
              // Planner-set effectiveFunc takes precedence over the
              // Divisi-derived one. Backdoor bVII7 must be D-function
              // (it has dominant-like resolution intent toward T)
              // even though its roman head 'bVII' would default to S.
              effectiveFunc: ap.effectiveFunc ?? harmonicState.effectiveFunc,
              virtualExtensions: harmonicState.virtualExtensions,
              chordSymbol: displayChordSymbol,
              bassPattern: bassPatternEvents,
              // Only attach when non-null so diatonic chords' JSON stays
              // clean (JSON.stringify drops undefined keys but not null).
              borrowedFrom: borrowed ?? undefined,
              borrowedSource: ap.borrowedSource,
              mustResolve: ap.mustResolve,
              tonicizationPlacement: ap.tonicizationPlacement,
              analysisKeyPc: ap.analysisKeyPc,
              localRoman: ap.localRoman,
              localTonalCenterPc,
              arrangementMode,
          });

          // Round-trip guard. notesMidi is the authoritative source the
          // audio renderer reads, but the legacy fallback path still
          // round-trips through noteToMidi(notes[i]). This assert
          // catches any spelling produced by midiToNoteInChord that
          // the parser can't recognise — would silently detune the
          // legacy path if a future spelling refactor introduces an
          // unsupported accidental form. Dev-only (skipped under
          // NODE_ENV='production' so the snapshot harness and audio
          // path stay quiet in release builds).
          if (typeof process === 'undefined' || process.env?.NODE_ENV !== 'production') {
              const justPushed = parsedChords[parsedChords.length - 1];
              for (let i = 0; i < justPushed.notesMidi.length; i++) {
                  const reparsed = noteToMidi(justPushed.notes[i]);
                  if (reparsed !== justPushed.notesMidi[i]) {
                      console.warn(`[voicing round-trip mismatch] bar=${parsedChords.length - 1} ${activeType} root=${rootName}: "${justPushed.notes[i]}" parsed to ${reparsed}, expected ${justPushed.notesMidi[i]}`);
                  }
              }
          }
      });

      // Roman label sync. Progression templates and the mode-aware
      // chord-type filter can produce a mismatch: e.g. a template with
      // `roman: 'III' type: 'maj'` running through Ionian's iii=minor
      // diatonic gate gets type rewritten to 'min', but the roman
      // label still reads 'III' (uppercase = major in classical
      // convention). Sync each roman to its actual final type:
      // major-quality → uppercase, minor / dim → lowercase. Pure
      // cosmetic — doesn't affect any engine logic, just makes the
      // chord-grid UI label match the audible chord.
      //
      // Sub-V slash chords are handled in a SECOND pass after all own-
      // romans are settled, since `subV/X` needs X's synced label.
      const isMinorType = (t: string): boolean =>
          t === 'min' || t === 'm'
          || (t.startsWith('m') && !t.startsWith('maj'))
          || t === 'dim' || t === 'dim7' || t === 'm7b5' || t === 'm9b5';
      const syncRoman = (roman: string, type: string): string => {
          if (roman.includes('/')) return roman; // defer slash romans
          const flat = roman.startsWith('b') ? 'b' : '';
          const base = flat ? roman.slice(1) : roman;
          return flat + (isMinorType(type) ? base.toLowerCase() : base.toUpperCase());
      };
      parsedChords.forEach((c) => {
          c.roman = syncRoman(c.roman, c.type);
      });
      parsedChords.forEach((c, i) => {
          if (c.roman.startsWith('subV/')) {
              const nextRoman = parsedChords[(i + 1) % parsedChords.length].roman;
              c.roman = `subV/${nextRoman.split('/')[0]}`;
          }
      });

      return parsedChords;
  }

  private getHarmonicFunction(romanOriginal: string): 'T' | 'S' | 'D' {
      return harmonicFunctionFromRoman(romanOriginal);
  }

  // generatePedalEvents 是 static logic 不依赖 instance,放在文件 module
  // 级别更合适 — 见 musicEngine.ts module 底部的 generatePedalEvents.

  /**
   * L3 multi-axis arrangement dispatch.
   *
   * Selects the best ArrangementMode (close / drop2 / drop3 / spread) for
   * the current chord by combining:
   *
   *   Tier 1 — Hard constraints (first match wins):
   *     - Cadence / final bar              → close (cadential tension landing)
   *     - Voice count < 4                   → close (no room to drop)
   *     - Drop-N result hits m9 between
   *       bottom and top                    → reject that candidate
   *
   *   Tier 2 — Musical preferences (additive bias):
   *     - Chord function (TSD):
   *         D-function (V/X, dom7) → drop2 +2, close -1, spread +1
   *         T-function (I, vi)     → close +2, drop2 -1
   *         S-function (ii, IV)    → drop2 +1
   *     - Bass motion direction (vs prev chord's bass):
   *         Descending stepwise (1-3 semi)  → drop2 +2 (counter-melody)
   *         Static (same bass pc)           → flip prev arrangement +2 (anti-monotony)
   *         Up 4th / down 5th (cadential)   → match prev arrangement +1 (parallel)
   *         Large leap (>7 semis)           → drop2 +1, spread +2
   *     - Section function:
   *         INTRO / OUTRO → close +2, others -1 to -2
   *         CHORUS         → drop2 / spread +1
   *         BRIDGE         → spread +3, drop3 +2 (max contrast)
   *
   *   Tier 3 — Top-voice motion (Bill Evans "inner voices barely move"):
   *     For each candidate, compute |topVoice - prevTopVoice|:
   *         0 semis (common tone) → +5 (best)
   *         1-2 semis (stepwise)  → +4 (ideal)
   *         3-4 semis (small leap) → +2
   *         5-7 semis (tolerable) → 0
   *         >7 semis (big leap)   → -2 per excess semitone
   *     This implements the "smooth voice-leading priority" rule from
   *     Piano with Jonny: "keep the distance each voice moves as small
   *     as possible with each chord change".
   *
   * Sources synthesized:
   *   - Bill Evans rootless A/B alternation (piano.org / jazzedge.academy):
   *     "alternation prevents voicing sitting in same range chord after chord"
   *     → reflected in Tier 2 static-bass anti-monotony rule.
   *   - Drop-2 melodic harmonization (pianowithjonny.com / learnjazzstandards.com):
   *     "way to harmonize melodies that ascend or descend stepwise"
   *     → reflected in Tier 3 top-voice motion as primary scoring axis.
   *   - m9 avoidance rule (learnjazzstandards.com): drop-2 bottom-top
   *     should be 10th or M9, NOT m9.
   *     → reflected in Tier 1 m9 rejection.
   */
  private pickArrangementMode(opts: {
      closeVoicing: number[];
      bassMidi: number;
      prevTopVoice: number | null;
      prevBassMidi: number | null;
      prevArrangement: import('./musicTheory').ArrangementMode | null;
      chordFunc: 'T' | 'S' | 'D';
      barIndex: number;
      totalBars: number;
      motifInterval: number;
      sectionFunction: import('./musicEngine').SectionFunction;
  }): import('./musicTheory').ArrangementMode {
      const {
          closeVoicing, bassMidi, prevTopVoice, prevBassMidi, prevArrangement,
          chordFunc, barIndex, totalBars, motifInterval, sectionFunction,
      } = opts;
      type Mode = import('./musicTheory').ArrangementMode;

      // ─── Tier 1: Hard constraints ───
      const isLast = barIndex === totalBars - 1;
      const isPhraseEnd = motifInterval > 0 && (barIndex + 1) % motifInterval === 0;
      if (isLast || isPhraseEnd) return 'close';
      if (closeVoicing.length < 4) return 'close';

      const closeSorted = closeVoicing.slice().sort((a, b) => a - b);

      // Build candidate set. Always include close. Try each transform; reject
      // if it didn't actually transform OR if it creates m9 between bottom-top.
      type Cand = { mode: Mode; midis: number[]; score: number };
      const candidates: Cand[] = [{ mode: 'close', midis: closeSorted, score: 0 }];

      const tryAdd = (mode: Mode) => {
          const m = applyArrangement(closeVoicing, mode, bassMidi);
          // Verify transform actually changed voicing (otherwise duplicates close)
          const changed = m.length !== closeSorted.length
              || m.some((v, i) => v !== closeSorted[i]);
          if (!changed) return;
          // m9 safety: bottom-to-top interval mod 12 === 1 AND span > 12
          // = bottom and top are m9 apart (octave + half step). Mancini /
          // standard arranging: avoid m9 between extreme voices.
          const span = m[m.length - 1] - m[0];
          if (((span % 12) + 12) % 12 === 1 && span > 12) return;
          candidates.push({ mode, midis: m, score: 0 });
      };
      tryAdd('drop2');
      if (closeVoicing.length >= 5) tryAdd('drop3');
      if (closeVoicing.length >= 4) tryAdd('spread');

      // ─── Tier 3: Top-voice motion (primary scoring axis) ───
      if (prevTopVoice !== null) {
          for (const c of candidates) {
              const top = c.midis[c.midis.length - 1];
              const motion = Math.abs(top - prevTopVoice);
              if (motion === 0) c.score += 5;
              else if (motion <= 2) c.score += 4;
              else if (motion <= 4) c.score += 2;
              else if (motion <= 7) c.score += 0;
              else c.score -= (motion - 7) * 2;
          }
      }

      // ─── Tier 2: Musical preferences (additive bias) ───
      for (const c of candidates) {
          // Chord function bias
          if (chordFunc === 'D') {
              if (c.mode === 'drop2') c.score += 2;
              else if (c.mode === 'close') c.score -= 1;
              else if (c.mode === 'spread') c.score += 1;
          } else if (chordFunc === 'T') {
              if (c.mode === 'close') c.score += 2;
              else if (c.mode === 'drop2') c.score -= 1;
          } else if (chordFunc === 'S') {
              if (c.mode === 'drop2') c.score += 1;
          }

          // Bass motion direction (vs prev bassMidi)
          if (prevBassMidi !== null) {
              const bassDelta = bassMidi - prevBassMidi;
              if (bassDelta < 0 && bassDelta >= -3) {
                  // Descending stepwise — drop2 creates counter-melody
                  if (c.mode === 'drop2') c.score += 2;
              } else if (bassDelta === 0) {
                  // Static — anti-monotony, prefer opposite of prev arrangement
                  if (prevArrangement && c.mode !== prevArrangement) c.score += 2;
              } else if (bassDelta === 5 || bassDelta === -7) {
                  // Cadential bass motion (5th down / 4th up) — parallel voicing
                  if (prevArrangement && c.mode === prevArrangement) c.score += 1;
              } else if (Math.abs(bassDelta) > 7) {
                  // Large leap — richer texture
                  if (c.mode === 'drop2') c.score += 1;
                  else if (c.mode === 'spread') c.score += 2;
              }
          }

          // Section function bias
          if (sectionFunction === 'INTRO' || sectionFunction === 'OUTRO') {
              if (c.mode === 'close') c.score += 2;
              else if (c.mode === 'drop2') c.score -= 1;
              else if (c.mode === 'spread' || c.mode === 'drop3') c.score -= 2;
          } else if (sectionFunction === 'CHORUS') {
              if (c.mode === 'drop2' || c.mode === 'spread') c.score += 1;
          } else if (sectionFunction === 'BRIDGE') {
              if (c.mode === 'spread') c.score += 3;
              else if (c.mode === 'drop3') c.score += 2;
          }
      }

      // Pick highest score; tie-break = first added (favors close)
      let best = candidates[0];
      for (const c of candidates) {
          if (c.score > best.score) best = c;
      }
      return best.mode;
  }

    generateArrangement(chords: ChordDef[], config: GenerationConfig): MusicTimeline {
        // Re-resolve so this call uses the exact same mode as
        // generateProgressions did. Forking by SEED makes it deterministic.
        const ctx = this.resolveGeneration(config);
        const { style, key: musicKey } = config;

        // Phase 4 — RoadMap parsing. CYK-decompose the chord progression
        // into named Block segments (Sad-Cadence / Dropback / Plain-X / etc.).
        // The block sequence is consumed downstream by pickMotif to choose
        // licks whose IMPROVISOR_LICKS.brickType matches the current
        // block's lickBrick — Impro-Visor-style harmonic-progression-aware
        // lick selection.
        //
        // Mode dispatch: parseRoadMap accepts 'major' / 'minor'; exotic
        // modes (Dorian / Mixolydian / Phrygian / Lydian / Locrian /
        // harmonic-minor / melodic-minor) snap to the closer family.
        const roadMapModeFamily: 'major' | 'minor' = (
            ctx.mode === 'Major' || ctx.mode === 'Ionian' || ctx.mode === 'Lydian' || ctx.mode === 'Mixolydian'
        ) ? 'major' : 'minor';
        const songBlocks: Block[] = parseRoadMap(chords, roadMapModeFamily);

        // Secondary-dominant detection — chord-root motion based.
        //
        // CYK parses brick patterns by ROMAN tokens. A7alt → Dm9 in C major
        // shows up as roman 'VI → ii' and matches Plain-Wild (Q-fragment).
        // But functionally A7 here is V/ii (chord 4th below Dm = P5 down
        // = classic V→i resolution).
        //
        // Detection: if chord i is dominant-family AND chord i+1's root is
        // a P5 below (= 5 semitones higher mod 12) chord i's root, then
        // chord i is acting as a secondary dominant resolving to chord i+1.
        //
        // Three-part override (per user "和声标签错了" audit):
        //   1. chord.roman → 'V/<next.roman>'      ← honest functional label
        //   2. chord.effectiveFunc → 'D'           ← downstream sees correct func
        //   3. block.lickBrick → Dominant-Cycle-Cadence ← lick pool gets alt-V
        //
        // Lock the audit symbol so subsequent regex isolates V/X chords.
        for (let i = 0; i < chords.length - 1; i++) {
            const cur = chords[i];
            const next = chords[i + 1];
            // Already-explicit V/X or subV/X — don't double-override.
            if (/^(V|subV)\//.test(cur.roman)) continue;
            const isDom = /^(7|9|11|13|dom7)/.test(cur.type) || cur.type === '7alt' || /alt|b9|#9|b13|#11|b5/.test(cur.type);
            if (!isDom) continue;
            const curRoot = ((cur.rootMidi % 12) + 12) % 12;
            const nextRoot = ((next.rootMidi % 12) + 12) % 12;
            const interval = ((nextRoot - curRoot) % 12 + 12) % 12;
            // V→i is P5 down = 7 semis down = 5 semis up.
            if (interval !== 5) continue;

            // (1) Roman relabel — V/<next>. Preserve original for trace.
            const originalRoman = cur.roman;
            const nextRomanBase = next.roman.split('/')[0]; // drop any '/X' tail in next's roman
            (cur as any).originalRoman = originalRoman;
            cur.roman = 'V/' + nextRomanBase;

            // (2) effectiveFunc force to D — altered/dom chord resolving P4 down
            //     is functionally a dominant regardless of position in song key.
            cur.effectiveFunc = 'D';

            // (3) lickBrick — bias toward Dominant-Cycle-Cadence pool when
            //     the brick was generic Q-fragment.
            const block = songBlocks.find(b => i >= b.startIdx && i <= b.endIdx);
            if (block && block.lickBrick === 'Q-fragment') {
                block.lickBrick = 'Dominant-Cycle-Cadence';
                block.brickName = block.brickName + ' (V/' + nextRomanBase + ' override)';
            }
        }

        this.songBlocks = songBlocks;
        this.lickPicksPerBar = new Map();
        // Phase 11 reverted — single-musician lock disabled per user.
        // poolForBrick gets null musician = all musicians available.
        this.songMusician = null;
        // density / complexity are pinned to 0.5 — see GenerationConfig.
        // The magnetism + motif-mutator branches gated on these always
        // behave at the "moderate" point.
        const complexity = 0.5;
        const density = 0.5;
        const musicMode = ctx.mode;
        let events: NoteEvent[] = [];
        let visuals: { time: number, label: string }[] = [];
        // Parallel-indexed with chords[]. Populated in the forEach loop
        // each bar — records the cell-cached textureCase active for
        // that bar. Exposed via MusicTimeline.texturePerBar for audits.
        const texturePerBar: string[] = [];
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
        // Ultimate fallback when TEXTURE_POOL is somehow empty.
        const finalFallbackTexture = 'Block_Chord';
        // 整首歌一种 texture (per-song dispatch).
        //
        // 决策: 用 develop cell (= phrase 中段) 作为 anchor 选 texture,
        // 因为它代表整曲的"主体感". Cell 边界仍然存在(影响 melody 处理),
        // 但 texture case 整首不变 — 听感上 phrase 内同 texture 是必要的
        // (用户反馈: 16 bar 多种 texture 听起来杂糅).
        //
        // 对 dominant chain 检测: 如果整曲任一 chord 是 D-function,
        // 不选 ambient texture (避免 V chord 上 "wash" 听起来不解决).
        const songCellRole = phraseCellRole(Math.floor(chords.length / 2), chords.length);
        const songDensity = densityForCell(songCellRole, ctx.sectionFunction);
        const songEnergy = energyForCell(songCellRole, ctx.sectionFunction);
        const songHasDominant = chords.some(c => c.effectiveFunc === 'D');
        const songPicked = pickTextureForBar({
            style, phraseRole: songCellRole,
            density: songDensity, energy: songEnergy,
            isDominantChain: songHasDominant,
            prevTextureId: undefined,
            repeatCount: 0,
            random: this.random,
        });
        let songTextureCase = songPicked?.textureCase ?? finalFallbackTexture;
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
            const f = c.effectiveFunc ?? this.getHarmonicFunction(c.roman);
            return `${f}_${c.type}_${role}`;
        };
        const runScales: number[][] = chords.map((c) => {
            const f = c.effectiveFunc ?? this.getHarmonicFunction(c.roman);
            return this.getScaleForStyle(style, c, f, musicKey, musicMode);
        });
        // Parallel fill-scale array. Used by Run Generator (in-bar
        // gap fill) and in-bar passing-tone insertion to add style
        // flavor (Bebop / Pentatonic / Mixolydian b6 / Blues hybrid)
        // to non-backbone notes. Backbone path uses runScales[i].
        const fillScales: number[][] = chords.map((c, idx) => {
            const f = c.effectiveFunc ?? this.getHarmonicFunction(c.roman);
            return this.getFillScaleForStyle(style, c, f, musicKey, musicMode, runScales[idx]);
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
            this.computeBackboneTargets(c, keyRootPcGlobal, modeIvForKey, isModalEnvGlobal));

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
            if ('chromaticOffset' in last || 'degreeLabel' in last) {
                iv = ((effectiveChromaticOffset(last, chord.type) % 12) + 12) % 12;
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

        // Phase 4.7 — brick-scoped lick cache + source coherence.
        //
        // blockLickCache: block.startIdx → lick reference picked for the
        // block's first bar. When pickMotif fires for a later bar in the
        // same block, slice the cached lick and reuse — true cross-bar
        // phrase coherence (Impro-Visor design).
        //
        // blockSourceCache: block.startIdx → musician source name
        // ('BillEvans' / 'JoeLovano' / 'JimmyHeath' / 'RichPerry') of the
        // first bar's pick. Later bars in the same block FILTER the
        // pool to that same musician (when ≥ 3 candidates available).
        // Mirrors Impro-Visor's "load one grammar = one musician's
        // vocabulary for the whole song"; we soften it to "one
        // musician's vocabulary per brick segment". This addresses the
        // chaos symptom where bar 2 of a 2-bar Sad-Cadence block plays
        // a Lovano post-bop lick while bar 3 plays a BillEvans lyric
        // lick — two unrelated musical voices smashed together.
        const blockLickCache: Map<number, any[]> = new Map();
        const blockSourceCache: Map<number, string> = new Map();
        const findCurrentBlock = (barIdx: number) => {
            for (const b of this.songBlocks) {
                if (barIdx >= b.startIdx && barIdx <= b.endIdx) return b;
            }
            return null;
        };

        // Inter-bar leap state: tracks the previously-picked lick's
        // last-projected MIDI so the next pick can filter for smooth
        // voice leading. Big leaps (> 12 semitones = octave+) between
        // bars usually trace to unrelated lick choices, not musical
        // intent. The filter prefers candidates whose first projected
        // note is within an octave of the prev bar's last projected
        // note; falls back to full pool when filter would leave < 5.
        let prevBarPredictedLastMidi: number | null = null;
        const predictMidi = (note: any, chord: ChordDef): number => {
            const offset = effectiveChromaticOffset(note, chord.type);
            let midi = chord.rootMidi + offset;
            while (midi < MELODY_RANGE.LOW) midi += 12;
            while (midi > MELODY_RANGE.HIGH) midi -= 12;
            return midi;
        };
        const updatePrevLastFromLick = (lick: any[], chord: ChordDef) => {
            if (!lick || lick.length === 0) { prevBarPredictedLastMidi = null; return; }
            const inBar = lick.filter((n: any) => n.t < chord.duration - 0.001);
            if (inBar.length === 0) { prevBarPredictedLastMidi = null; return; }
            const lastNote = inBar[inBar.length - 1];
            prevBarPredictedLastMidi = predictMidi(lastNote, chord);
        };

        const pickMotif = (poolArg: (any[] | { notes: any[]; rules?: any })[], i: number, role: string, strictEnd: boolean = false, preferTurnaround: boolean = false): any[] => {
            advancePhraseIfBoundary(i);

            // Phase 4.7 brick-scoped lick: if this bar is inside a multi-
            // bar block and we already picked a lick for that block's
            // first bar, reuse it (slice the relevant time window).
            const currentBlock = findCurrentBlock(i);

            // Phase 9 — block-aware pool reroute. CELL ROLE traditionally
            // forced phrase-end bars to use the `ends` pool (cadence
            // licks only). But when the block's harmonic context is NOT
            // a cadence (e.g. `Opening-Major` block on I chord, with
            // block.lickBrick = 'Q-fragment'), a cadence lick is the
            // wrong choice — Sad-Cadence licks land V→i language on
            // the major I, sounding like a minor cadence intruding
            // on a major opening. When block.lickBrick is 'Q-fragment'
            // (= no cadence intent) and the caller routed us to ends
            // pool, swap to flows pool. Block intent overrides cell
            // role's pool choice. (Pure-cadence blocks like Sad-Cadence
            // / Major-Cadence / etc. keep ends pool naturally since
            // their lickBrick matches what ends pool has.)
            let pool = poolArg;

            // Phase 10 — block-direct pool selection (Impro-Visor model).
            // For EVERY block (named brick or Plain-X), bypass cell-role
            // pool routing entirely and use LICKS_BY_BRICK lookup based
            // on block.lickBrick. Cell role no longer determines pool.
            //
            // - Named brick (Sad-Cadence / Straight-Cadence): use specific
            //   licks of that brick. STRICT — no Q-fragment dilution.
            // - Plain-X / Opening-X / Secondary-V (lickBrick = 'Q-fragment'):
            //   use Q-fragments only.
            //
            // This matches Impro-Visor: brick name → grammar rules tagged
            // with that brick name. No cell-role indirection.
            if (currentBlock) {
                const directPool = poolForBrick(currentBlock.lickBrick, this.songMusician);
                if (directPool.length > 0) {
                    pool = directPool;
                    strictEnd = false;
                }
            }
            // Phase 4.7 brick-scoped cache (RESTORED Phase 9.5):
            // Lick is authored as a coherent multi-bar phrase tied to a
            // brick (Impro-Visor's grammar rule = one brick span).
            // ONE lick covers the whole brick; each bar's slice gets
            // its bar-local time window and projects against THAT bar's
            // chord. This matches Impro-Visor's per-note `getCurrentChord
            // (brickStart + noteT)` projection: note at brick-time T
            // sounds against the chord active at brick-time T.
            //
            // Cache is enabled for ALL multi-bar blocks (not just
            // Cadence). My earlier "disable for Q-fragment" was wrong —
            // brick-slot projection IS the design intent.
            if (currentBlock && currentBlock.endIdx > currentBlock.startIdx && i > currentBlock.startIdx) {
                const cachedLick = blockLickCache.get(currentBlock.startIdx);
                if (cachedLick && cachedLick.length > 0) {
                    // Bar offset within the block (in beats from block start).
                    // Each bar contributes chord.duration beats; use that to
                    // shift the lick's t window into this bar.
                    let beatsBeforeThisBar = 0;
                    for (let k = currentBlock.startIdx; k < i; k++) {
                        beatsBeforeThisBar += chords[k].duration ?? 4;
                    }
                    const barDur = chords[i].duration ?? 4;
                    // Slice: take lick notes whose t ∈ [beatsBeforeThisBar, beatsBeforeThisBar + barDur)
                    // and rebase their t to bar-local (0-based).
                    const slice = cachedLick
                        .filter((n: any) => n.t >= beatsBeforeThisBar - 0.01 && n.t < beatsBeforeThisBar + barDur - 0.01)
                        .map((n: any) => ({ ...n, t: n.t - beatsBeforeThisBar }));
                    if (slice.length > 0) {
                        // Trace this as the picked motif (for the audit
                        // script and downstream scoring).
                        this.lickPicksPerBar.set(i, slice);
                        accumulateMotifPcs(slice, chords[i], runScales[i]);
                        updatePrevLastFromLick(slice, chords[i]);
                        return slice;
                    }
                    // Slice empty (lick ran short) — let normal pickMotif
                    // pick a fresh one to fill this bar.
                }
            }

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
                        updatePrevLastFromLick(notes, chords[i]);
                        return notes;
                    }
                }
                // No partner found — drop pair tracking.
                lastPickedPairId = null;
            }

            let usePool = pool;

            // Phase 4 — RoadMap brick filter. When the song has a parsed
            // RoadMap and the current bar's block has a real brick (not
            // a Plain-X fallback), prefer pool entries whose underlying
            // lick was authored for that brick. Impro-Visor weight model:
            //   matching brickType → keep weight 1.0
            //   Q-fragment        → keep weight 0.5 (neutral filler)
            //   other brick       → keep weight 0.1 (soft pollution allowed)
            // Implemented as a hard filter: take only matched + Q-fragment
            // when ≥ 2 candidates exist; otherwise fall back to full pool.
            // (currentBlock already resolved above by the brick-scoped
            //  lick cache prelude — re-use it here.)
            // Filter on every block including Plain-X — the lickBrick
            // field is meaningful on Plain-Dom (Dominant-Cycle),
            // Plain-Pred (Nowhere-Approach), Plain-tonic (Minor-On)
            // etc. Only skip when lickBrick is Q-fragment (which means
            // "no specific brick" — the filter would be a no-op).
            let strictBrickMode = false;
            if (currentBlock && currentBlock.lickBrick !== 'Q-fragment') {
                const targetBrick = currentBlock.lickBrick;
                // Altered-V override (Tension-Cadence). The brick CYK matches
                // on roman numerals, so V and V7alt look identical to the
                // parser. But Impro-Visor's Tension-Cadence licks are
                // authored specifically for altered V (b9/#9/#11/b13/alt)
                // resolving to tonic — they ring on the altered tones the
                // chord is playing.
                //
                // Two-tier activation:
                //   (a) Dom-family bricks with altered V → STRICT mode:
                //       pool = target + Tension-Cadence only (no Q-fragment
                //       dilution). Tension competes ~30% against target.
                //   (b) Otherwise (or strict pool too small) → non-strict:
                //       pool = target + Q-fragment as before, Tension
                //       NOT added (its probability would be ~1% lost in
                //       703 Q-fragments, effectively invisible).
                const c = chords[i];
                const isAlteredDom = !!c.type && /(alt|b9|#9|#11|b13|b5)/.test(c.type)
                    && (c.effectiveFunc === 'D' || /V/.test(c.roman));
                const DOM_FAMILY_BRICKS = new Set([
                    'Dominant-Cycle',
                    'Dominant-Cycle-Cadence',
                    'Dominant-Cycle-2-Steps',
                    'Reverse-Dominant-Cycle-2-Steps',
                ]);
                const wantStrict = isAlteredDom && DOM_FAMILY_BRICKS.has(targetBrick);
                const filteredStrict: typeof pool = [];
                const filteredLoose: typeof pool = [];
                for (const item of pool) {
                    const notes: any[] = Array.isArray(item) ? item : (item as any).notes;
                    if (!notes) continue;
                    const meta = LICK_METADATA_BY_NOTES.get(notes);
                    if (!meta) continue;
                    if (meta.brickType === targetBrick) {
                        filteredStrict.push(item);
                        filteredLoose.push(item);
                    } else if (meta.brickType === 'Q-fragment') {
                        filteredLoose.push(item);
                    }
                }
                // Tension-Cadence injection — `pool` was pre-narrowed by
                // poolForBrick (line ~2969) to ONLY contain the target
                // brick's licks (+ Q-fragment fallback), so Tension-Cadence
                // licks are absent from `pool` even though we want them in
                // strict mode. Pull them directly from LICKS_BY_BRICK and
                // append. Match poolForBrick's musician-lock convention:
                // prefer same-musician licks first; if none, take all.
                if (wantStrict) {
                    const allTension = LICKS_BY_BRICK['Tension-Cadence'] ?? [];
                    const sourceLocked = this.songMusician
                        ? allTension.filter(l => l.source === this.songMusician)
                        : allTension;
                    const tensionToAdd = (sourceLocked.length > 0 ? sourceLocked : allTension).map(l => l.notes);
                    filteredStrict.push(...tensionToAdd);
                }
                // Strict mode wins when wantStrict AND it has enough licks.
                if (wantStrict && filteredStrict.length >= 5) {
                    usePool = filteredStrict;
                    strictBrickMode = true;
                } else if (filteredLoose.length >= 5) {
                    usePool = filteredLoose;
                }
            }

            // HARD-avoid pre-filter — drop licks whose authored notes
            // would create structural-position dissonance against the
            // bar's chord. Lick context mismatches (BillEvans writing
            // C# for D7, projected onto our Cm) produce 1-2% of melody
            // notes as long-held avoid on the downbeat — those are
            // ACTUAL musical errors, not jazz idiom. The filter drops
            // any lick with ≥ 1 HARD-avoid against the bar's chord
            // (and against subsequent bars' chords for multi-bar
            // bricks — block scope). Falls back to the unfiltered pool
            // when the filter would leave fewer than 5 candidates
            // (preserves variety).
            if (currentBlock) {
                const bpm = this.songMeterContext?.beatsPerMeasure ?? 4;
                const isModalEnv = !!this.songTonalCharacter
                    && this.songTonalCharacter === 'modal';
                // Build per-block chord checks: each chord in the block,
                // with a time-offset for slicing the lick. For single-bar
                // blocks this is just [{chord: chords[i], offset: 0}].
                const blockChords: Array<{ chord: ChordDef; offset: number }> = [];
                let blockOffset = 0;
                for (let bi = currentBlock.startIdx; bi <= currentBlock.endIdx; bi++) {
                    blockChords.push({ chord: chords[bi], offset: blockOffset });
                    blockOffset += chords[bi].duration;
                }
                const lickHasHardAvoid = (lick: any[]): boolean => {
                    for (const { chord: c, offset } of blockChords) {
                        // Time-shift lick notes into this bar's window
                        const slice = lick
                            .filter((n: any) => n.t >= offset - 0.01 && n.t < offset + c.duration - 0.01)
                            .map((n: any) => ({ ...n, t: n.t - offset }));
                        if (slice.length === 0) continue;
                        const rootPc = ((c.rootMidi % 12) + 12) % 12;
                        const func = c.effectiveFunc ?? this.getHarmonicFunction(c.roman);
                        const ha = countLickHardAvoidsForChord(
                            slice, rootPc, c.type, c.duration,
                            func, bpm, isModalEnv, '',
                        );
                        if (ha > 0) return true;
                    }
                    return false;
                };
                const cleanFiltered = usePool.filter(item => {
                    const notes: any[] = Array.isArray(item) ? item : (item as any).notes;
                    if (!notes) return false;
                    return !lickHasHardAvoid(notes);
                });
                if (cleanFiltered.length >= 5) usePool = cleanFiltered;

                // Tone-category gate — per-chord-INSTANCE contract.
                //
                // Each chord in the block gets its own MelodyChordContract
                // (read-only adapter; does NOT modify ChordDef / bass /
                // voicing / accompaniment). The contract distinguishes
                // instance-specific stable colors:
                //   Cmadd9 stable = {1,b3,5,9}  (b7 NOT stable — would
                //                                require Cm9 upgrade)
                //   Cm9    stable = {1,b3,5,b7,9}
                //   G7sus  stable = {1,4,5,b7,9,13}  (3 conditional only
                //                                      as 4→3 resolution)
                //   Em7b5/D analyzed by E half-dim from root E; bass D
                //   doesn't pollute chord_tones.
                //
                // Dry-run: project each lick note via chord-relative degree,
                // classify as CT / STABLE_COLOR / CONDITIONAL / AVOID,
                // count unresolved (strong-beat-long without resolution).
                // Reject licks exceeding style threshold; fall back to
                // unfiltered pool if filtered count < 5.
                const styleCtx = { style: style as any };
                const contracts: MelodyChordContract[] = blockChords.map(({ chord: c }) =>
                    buildMelodyChordContract(c, styleCtx)
                );
                const policyFiltered = usePool.filter(item => {
                    const notes: any[] = Array.isArray(item) ? item : (item as any).notes;
                    if (!notes) return false;
                    let totalAvoid = 0;
                    let totalConditional = 0;
                    const accept = contracts[0]?.rules ?? { maxUnresolvedAvoid: 1, maxUnresolvedConditional: 3 };
                    for (let bi = 0; bi < blockChords.length; bi++) {
                        const { chord: c, offset } = blockChords[bi];
                        const contract = contracts[bi];
                        const slice = notes
                            .filter((n: any) => n.t >= offset - 0.01 && n.t < offset + c.duration - 0.01)
                            .map((n: any) => ({ ...n, t: n.t - offset }));
                        if (slice.length === 0) continue;
                        // For end-of-slice resolution check, look at next bar's first note.
                        let nextNoteAfter: any = null;
                        const nextBi = bi + 1;
                        if (nextBi < blockChords.length) {
                            const { chord: cNext, offset: offNext } = blockChords[nextBi];
                            const nextFirst = notes.find((n: any) => n.t >= offNext - 0.01 && n.t < offNext + cNext.duration - 0.01);
                            if (nextFirst) {
                                nextNoteAfter = {
                                    degreeLabel: nextFirst.degreeLabel,
                                    chromaticOffset: nextFirst.chromaticOffset,
                                    contract: contracts[nextBi],
                                };
                            }
                        }
                        const r = evaluateLickAgainstContract(slice, contract, bpm, nextNoteAfter);
                        totalAvoid += r.unresolvedAvoid;
                        totalConditional += r.unresolvedConditional;
                    }
                    return totalAvoid <= accept.maxUnresolvedAvoid
                        && totalConditional <= accept.maxUnresolvedConditional;
                });
                if (policyFiltered.length >= 5) usePool = policyFiltered;
            }

            // Inter-bar leap filter — when previous bar set a "last
            // projected MIDI", prefer candidates whose first projected
            // note lands within ±12 semis. Drops only the worst
            // octave-crossing candidates; bag is still musical at ±7-12.
            // Skips on bar 0 (no previous) and when prev was a rest bar.
            if (prevBarPredictedLastMidi !== null && currentBlock) {
                const c0 = chords[i];
                const leapFiltered = usePool.filter(item => {
                    const notes: any[] = Array.isArray(item) ? item : (item as any).notes;
                    if (!notes || notes.length === 0) return true;
                    const firstInBar = notes.find((n: any) => n.t < c0.duration - 0.001);
                    if (!firstInBar) return true;
                    const firstMidi = predictMidi(firstInBar, c0);
                    return Math.abs(firstMidi - prevBarPredictedLastMidi!) <= 12;
                });
                if (leapFiltered.length >= 5) usePool = leapFiltered;
            }

            // Phase 4.7 — source coherence within a block. If we're not
            // on the first bar of the block AND a source was cached, FAVOR
            // licks from the same musician. Falls through when too few
            // candidates remain (keeps variety guarantee).
            if (currentBlock && i > currentBlock.startIdx) {
                const cachedSource = blockSourceCache.get(currentBlock.startIdx);
                if (cachedSource) {
                    const sourceFiltered = usePool.filter(item => {
                        const notes: any[] = Array.isArray(item) ? item : (item as any).notes;
                        if (!notes) return false;
                        const meta = LICK_METADATA_BY_NOTES.get(notes);
                        return meta?.source === cachedSource;
                    });
                    if (sourceFiltered.length >= 3) usePool = sourceFiltered;
                }
            }

            if (strictEnd) {
                const allowFloating = STYLE_DICTIONARY[style]?.allowFloatingColor === true;
                const filtered = usePool.filter(m => isMotifLastNoteStable(m, chords[i], allowFloating));
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
            // Strict-brick mode (altered-V + dom-family target): bypass
            // selectBestMotif's avoid-note scoring. Tension-Cadence licks
            // carry the chord's altered tones (b9/#5/#11/b13) as content;
            // isAvoidNote flags those as conflict, so scoring would
            // systematically eliminate Tension licks even when they're the
            // brick's authored material for THIS chord. Direct random.pick
            // from the strict pool preserves the intended ~30% Tension hit
            // rate. Stream-stability irrelevant here (we don't auto-commit
            // baseline snapshots).
            let m: any;
            if (strictBrickMode) {
                const pickedItem = this.random.pick(usePool);
                m = Array.isArray(pickedItem) ? pickedItem : (pickedItem as any).notes;
            } else {
                m = this.selectBestMotif(
                    usePool, chords[i], runScales[i], memKey(i, role),
                    thematicMemory, backboneTargets[i],
                    voiceLeadingIn[i], voiceLeadingOut[i],
                    prevPhrasePcs.size > 0 ? prevPhrasePcs : null,
                );
            }
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
            // Phase 4 trace: record which lick reference was picked
            this.lickPicksPerBar.set(i, m);
            // Phase 4.7 brick-scoped cache: if this bar is the FIRST in
            // a multi-bar block, cache the picked lick so later bars in
            // the same block reuse it (slicing) + cache its source so
            // subsequent bars prefer same-musician licks.
            if (currentBlock && i === currentBlock.startIdx) {
                // Cache picked lick for any multi-bar block — each
                // subsequent bar slices its time window from the same
                // lick (Impro-Visor brick-slot projection model).
                if (currentBlock.endIdx > currentBlock.startIdx) {
                    blockLickCache.set(currentBlock.startIdx, m);
                }
                const pickedMeta = LICK_METADATA_BY_NOTES.get(m);
                if (pickedMeta) blockSourceCache.set(currentBlock.startIdx, pickedMeta.source);
            }
            updatePrevLastFromLick(m, chords[i]);
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
                const f = this.getHarmonicFunction(chords[i].roman);
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

        // ───────────────────────────────────────────────────────────
        // Rhythm-feel contract — refine song texture to match lick DNA.
        //
        // Impro-Visor's .sty files lock bass/chord/drum patterns to a
        // shared (swing / comp-swing / triplet) grid. We don't import
        // their patterns, but we DO align our texture pick to the lick
        // rhythm: if BillEvans triplet licks dominate the song, the
        // texture should also feel triplet-y (or sparse stab), not
        // straight-16 piano arp.
        //
        // Read-only: existing texture data is not modified. We just
        // filter the texture pool to feel-compatible candidates and
        // re-pick. If the current pick already matches, no change.
        {
            const lickProfiles = phrasePlan
                .filter(m => m && m.length > 0)
                .map(m => analyzeLickRhythm(m as any));
            const songFeel = inferSongRhythmFeel(lickProfiles, style);
            const acceptable = acceptableTextureFeels(songFeel);
            const currentFeel = textureFeelOf(songTextureCase);
            const currentMatches = acceptable.has(currentFeel);
            if (!currentMatches) {
                // Filter pool: same style + acceptable feel.
                const feelCompatible = TEXTURE_POOL.filter(t =>
                    t.styles.includes(style as any)
                    && acceptable.has(textureFeelOf(t.textureCase))
                );
                if (feelCompatible.length > 0) {
                    const refined = this.random.pick(feelCompatible);
                    songTextureCase = refined.textureCase;
                }
            }
        }

        chords.forEach((chord, i) => {
            const currentPhrase = phrasePlan[i];
            const currentRole = phraseRole[i];
            const currentShouldReturn = phraseShouldReturn[i];

            // 整首歌一种 texture — songTextureCase 在 forEach 外已选定
            // (并经过 rhythm-feel 契约 refine,跟 lick DNA 对齐).
            // 16 bar 内不再切换 texture (用户反馈: 多种 texture 听起来杂糅).
            const activeTexture = songTextureCase;
            texturePerBar.push(activeTexture);

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
            const func = chord.effectiveFunc ?? this.getHarmonicFunction(chord.roman);
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

        // Chord / bass event boundary truncation — comp stabs must not
        // bleed into the next chord (would pollute the next bar's
        // downbeat with the previous chord's color). Per-event clamp:
        //   event.duration = min(event.duration, nextChordStart - event.time - 0.03)
        // The 0.03 beat headroom prevents sample-buffer crossfade at the
        // exact bar boundary (audible click).
        //
        // Melody events are NOT truncated — lick notes have authored
        // durations (e.g., long sustain into next bar for cadence ending).
        {
            const chordEndTimes: number[] = [];
            let acc = 0;
            for (const c of chords) { acc += c.duration; chordEndTimes.push(acc); }
            for (const e of events) {
                if (e.part !== 'chord' && e.part !== 'bass') continue;
                // Find the chord slot that contains this event's start.
                for (let i = 0; i < chordEndTimes.length; i++) {
                    if (e.time < chordEndTimes[i] - 0.001) {
                        const maxDur = chordEndTimes[i] - e.time - 0.03;
                        if (maxDur > 0 && e.duration > maxDur) e.duration = maxDur;
                        break;
                    }
                }
            }
        }

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
                if (e.lickSource) return e; // lick notes preserve author's triplet/swing positions
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

        // Generate pedal events per style. LOFI / POP抒情 → 长 hold,
        // JAZZ / BLUES → 不用 (空数组).
        const pedalEvents = generatePedalEvents(chords, style);

        // 乐器约束 — clamp pitch range, polyphony cap, instrument 标签.
        // 默认 bass=piano / chord=piano / melody=piano (现在钢琴-only),
        // 切换到 'synth_lead' 等单音乐器后会自动约束.
        const constrainedEvents = enforceInstrumentConstraints(events, DEFAULT_INSTRUMENT_BINDINGS);

        return {
            events: constrainedEvents,
            visuals,
            texturePerBar,
            pedalEvents,
            unresolvedTensions: tensionTracker.unresolved.length,
            phraseSegments,
            phraseRoleByBar,
            meterContext: this.songMeterContext,
        };
    }

  private generateMelodyPhrase(style: StyleName): any[] {
      const phrases = STYLE_DICTIONARY[style]?.motifs || STYLE_DICTIONARY['POP'].motifs;
      // Evaluator-driven random fallback when no motifs are defined.
      //
      // Strategy: generate a random rhythmic scaffold (one of a few
      // simple patterns) populated with random diatonic steps. The
      // engine's downstream layers do the musical work:
      //   - evaluateNoteInChordContext flags out-of-contract pitches
      //   - unified-tension-resolution hard constraint snaps the
      //     follow-up note to resolutionTargets when urgency ≥ 0.5
      //   - in-chord-contract hard constraint forces structural-beat
      //     pitches into the chord's contract (literal + extensions)
      //   - cadence resolution rewrites phrase-end last notes per Tier
      //   - leading-tone-on-V cross-check upgrades B-on-G7 to tension
      //   - scale awareness + V-borrowing + tonal/modal all participate
      // Result: even with random raw steps, the emitted melody respects
      // chord context and resolution requirements. Truly bad random
      // picks get snapped; truly good ones pass through. Music quality
      // is bounded by the evaluator's correctness, not by motif design.
      //
      // Seeded random — same seed → same melody, determinism preserved.
      if (!phrases || phrases.length === 0) {
          // Rhythm scaffolds — each totals 4 beats. Patterns favor
          // 8th / 16th notes over quarters because isStructural fires
          // on strong-beat OR duration ≥ 1.5 — too many long notes
          // means too many structural positions, which the in-chord-
          // contract hard constraint then snaps to chord literal,
          // producing same-PC clusters. 8ths sit between strong beats
          // so they pass as passing tones and the evaluator's random
          // contour survives. Mix-in long notes (1.5 / 2) for phrase
          // breaths and stop-feel.
          const RHYTHM_PATTERNS: number[][] = [
              [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],          // straight 8ths
              [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1],                  // 8ths + tail quarter
              [0.5, 0.5, 1, 0.5, 0.5, 1],                          // 8-8-Q-8-8-Q
              [0.25, 0.25, 0.5, 0.5, 0.5, 0.5, 0.5, 1],            // 16th opener
              [1, 0.5, 0.5, 0.5, 0.5, 1],                          // Q-8-8-8-8-Q
              [0.5, 0.5, 0.5, 0.5, 2],                             // 8ths + half rest
              [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1.5],                 // breath ending
              [0.25, 0.25, 0.25, 0.25, 0.5, 0.5, 2],               // 16ths gathering
          ];
          const pattern = this.random.pick(RHYTHM_PATTERNS);
          const motif: any[] = [];
          let t = 0;
          // Random-walk contour over a wide range. Start anywhere in
          // [0, 9] (1.5 octaves of scale) so each bar starts in a
          // different register; step ±2..±5 each note (NO ±0/±1) so
          // the projected pitches land far apart and the evaluator's
          // chord-tone snap distributes across many chord positions
          // rather than collapsing to the closest one. Without this
          // wide spread, multiple stepwise steps snap to the same
          // chord-tone and produce same-PC clusters.
          let step = this.random.range(0, 9);
          for (const d of pattern) {
              motif.push({ t, d, diatonicStep: step });
              // Style-tuned random walk. BLUES leans on stepwise lick
              // flow (±1/±2 dominant) so consecutive notes thread blue-
              // scale tones; other styles use wider hops (±2..±5) so
              // motif projections spread across the chord-tone snap
              // basin instead of collapsing to the closest chord tone.
              const moves = style === 'BLUES'
                  ? [-2, -2, -2, -1, -1, -1, -1, 1, 1, 1, 1, 2, 2, 2]
                  : [-5, -4, -3, -3, -2, -2, 2, 2, 3, 3, 4, 5];
              const delta = this.random.pick(moves);
              // Reflect off the [0, 9] boundary instead of clamping.
              // Clamping made step values pile up at 9 or 0 when the
              // walk hit an edge with a same-direction delta (e.g.
              // step=8 +5 → clamp 9, then 9 +5 → clamp 9 again),
              // producing 3+ consecutive identical diatonicSteps which
              // project to the same MIDI ("F-F-F-F" block-stuck
              // symptom the BLUES audit caught: t=4.66/5.00/5.66 all
              // MIDI 81). Reflection turns the over-shoot into a real
              // direction reversal so the walk keeps moving.
              let newStep = step + delta;
              if (newStep > 9) newStep = 9 - (newStep - 9);
              if (newStep < 0) newStep = -newStep;
              step = Math.max(0, Math.min(9, newStep));
              t += d;
          }
          return motif;
      }
      const picked = this.random.pick(phrases);
      // Unwrap MotifDef wrappers — downstream pipeline expects raw
      // note arrays, not the rules-bearing wrapper object.
      return Array.isArray(picked) ? picked : (picked as { notes: any[] }).notes;
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
  private computeBackboneTargets(chord: ChordDef, keyRootPc: number, modeIntervals: number[], isModalContext: boolean = false): Set<number> {
      const chordRootPc = (((chord.rootMidi % 12) + 12) % 12);
      const intervals = CHORD_TYPES[chord.type] || [0, 4, 7];

      // Backbone = chord literal pcs (always, full). Filtering by the
      // global key palette would drop the color tones of secondary
      // dominants (A7 in C → C# missing), sub-V Lydian Dominants, and
      // modal borrows (iv, bVI, bVII) — exactly the notes the listener
      // EXPECTS to hear when those chords play. The runScale already
      // handles TSD modal borrowing (Phrygian Dominant for V/X → minor,
      // Lydian Dominant for sub-V, etc.), so chord literal is in scale
      // by construction.
      const targets = new Set<number>();
      for (const iv of intervals) targets.add((chordRootPc + iv) % 12);

      // Key root added as "regression home" ONLY for fully diatonic
      // chords. Borrowed / secondary / sub-V chords want complete
      // tonicization — diluting their backbone with the global key
      // root would erase the temporary tonal center they create.
      const keyPcs = new Set<number>();
      for (const iv of modeIntervals) keyPcs.add((keyRootPc + iv) % 12);
      const chordLiteralPcs = Array.from(targets);
      const isDiatonic = chordLiteralPcs.every(pc => keyPcs.has(pc));
      if (isDiatonic && !targets.has(keyRootPc)) {
          const intvFromChordRoot = ((keyRootPc - chordRootPc) % 12 + 12) % 12;
          const cFunc = chord.effectiveFunc ?? this.getHarmonicFunction(chord.roman);
          if (!isAvoidNote(intvFromChordRoot, chord.type, undefined, isModalContext, cFunc)) {
              targets.add(keyRootPc);
          }
      }
      return targets;
  }

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
  private estimateBackboneAlignment(motif: any[], chord: ChordDef, runScale: number[], targets: Set<number>): number {
      if (motif.length === 0) return 0;
      const chordRootPc = (((chord.rootMidi % 12) + 12) % 12);
      const scalePcs = Array.from(new Set(runScale.map(x => ((x%12)+12)%12))).sort((a,b)=>a-b);
      const N = scalePcs.length || 7;
      const rootIdx = scalePcs.indexOf(chordRootPc);
      const startIdx = rootIdx >= 0 ? rootIdx : 0;

      let backboneCount = 0;
      let hits = 0;
      for (let i = 0; i < motif.length; i++) {
          const m = motif[i];
          const beatPos = ((m.t % 4) + 4) % 4;
          const isStrong = Math.abs(beatPos) < 0.05 || Math.abs(beatPos - 2) < 0.05;
          const isLong = m.d >= 1.5;
          const isLast = i === motif.length - 1;
          if (!(isStrong || isLong || isLast)) continue;
          backboneCount++;

          let pc: number;
          if ('chromaticOffset' in m || 'degreeLabel' in m) {
              pc = ((chordRootPc + effectiveChromaticOffset(m, chord.type)) % 12 + 12) % 12;
          } else {
              const targetIdx = ((startIdx + m.diatonicStep) % N + N) % N;
              pc = scalePcs[targetIdx];
          }
          if (targets.has(pc)) hits++;
      }
      return backboneCount > 0 ? hits / backboneCount : 0;
  }

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
          || this.getHarmonicFunction(chord.roman) === 'D';
      // Pre-compute per-note ivFromChord so we can detect motion patterns.
      const ivs: number[] = [];
      for (const note of motif) {
          let pc: number;
          if ('chromaticOffset' in note || 'degreeLabel' in note) {
              pc = (((chordRootPc + effectiveChromaticOffset(note, chord.type)) % 12) + 12) % 12;
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
      const currentFunc: 'T'|'S'|'D' = chord.effectiveFunc ?? this.getHarmonicFunction(chord.roman);
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
              ? this.estimateBackboneAlignment(notes, chord, runScale, backboneTargets)
              : 0;
          const { vlInHit, vlOutHit, variety } =
              this.estimateMotifShapeMetrics(notes, chord, runScale, vlIn, vlOut);
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
          if ('chromaticOffset' in m || 'degreeLabel' in m) {
              pc = ((chordRootPc + effectiveChromaticOffset(m, chord.type)) % 12 + 12) % 12;
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
  private findClosestCrossChordPair(
      currChord: ChordDef,
      nextChord: ChordDef,
      anchorPc: number = -1,
  ): { pcA: number; pcB: number; distance: number } {
      const aLit = CHORD_TYPES[currChord.type] || [0, 4, 7];
      const bLit = CHORD_TYPES[nextChord.type] || [0, 4, 7];
      const aRoot = (((currChord.rootMidi % 12) + 12) % 12);
      const bRoot = (((nextChord.rootMidi % 12) + 12) % 12);
      const aPcs = aLit.map(iv => (aRoot + iv) % 12);
      const bPcs = bLit.map(iv => (bRoot + iv) % 12);
      let best = { pcA: aPcs[0], pcB: bPcs[0], distance: 99, anchorDist: 99 };
      for (const a of aPcs) {
          for (const b of bPcs) {
              const d = Math.min(((a - b + 12) % 12), ((b - a + 12) % 12));
              const ad = anchorPc >= 0
                  ? Math.min(((a - anchorPc + 12) % 12), ((anchorPc - a + 12) % 12))
                  : 0;
              if (d < best.distance || (d === best.distance && ad < best.anchorDist)) {
                  best = { pcA: a, pcB: b, distance: d, anchorDist: ad };
              }
          }
      }
      return { pcA: best.pcA, pcB: best.pcB, distance: best.distance };
  }

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
      'color-density-cap': 9,
      'motif-leap-safety': 10,
      'leap-octave-cap': 11,
      'apex-headroom': 12,
      'no-same-pc-repeat': 13,
      'leap-recovery': 14,
      'anti-monotonicity': 15,
  };

  private selectBestMidi(
      ctx: NoteContext,
      hardFilters: HardConstraint[],
      softScores: SoftScore[],
  ): number {
      // Phase 8 — old melody engine fully abandoned on lick notes.
      // When the motif note carries degreeLabel (bypassSnap=true),
      // return the projected MIDI directly — no candidate pool, no
      // hard filters, no soft scoring. The lick author's pitch is
      // the final pitch.
      if (ctx.bypassSnap) {
          let m = ctx.motifProjMidi;
          while (m > MELODY_RANGE.HIGH) m -= 12;
          while (m < MELODY_RANGE.LOW) m += 12;
          return m;
      }

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
  private estimateMotifShapeMetrics(
      motif: any[],
      chord: ChordDef,
      runScale: number[],
      vlIn: Set<number> | null,
      vlOut: Set<number> | null,
  ): { vlInHit: number; vlOutHit: number; variety: number } {
      if (motif.length === 0) return { vlInHit: 0, vlOutHit: 0, variety: 0 };
      const chordRootPc = (((chord.rootMidi % 12) + 12) % 12);
      const scalePcs = Array.from(new Set(runScale.map(x => ((x%12)+12)%12))).sort((a,b)=>a-b);
      const N = scalePcs.length || 7;
      const rootIdx = scalePcs.indexOf(chordRootPc);
      const startIdx = rootIdx >= 0 ? rootIdx : 0;

      const projectPc = (m: any): number => {
          if ('chromaticOffset' in m || 'degreeLabel' in m) {
              return ((chordRootPc + effectiveChromaticOffset(m, chord.type)) % 12 + 12) % 12;
          }
          const targetIdx = ((startIdx + m.diatonicStep) % N + N) % N;
          return scalePcs[targetIdx];
      };

      // Identify structural-position notes
      const structPcs: number[] = [];
      let firstStructPc = -1;
      let lastStructPc = -1;
      for (let i = 0; i < motif.length; i++) {
          const m = motif[i];
          const beatPos = ((m.t % 4) + 4) % 4;
          const isStrong = Math.abs(beatPos) < 0.05 || Math.abs(beatPos - 2) < 0.05;
          const isLong = m.d >= 1.5;
          const isLast = i === motif.length - 1;
          if (!(isStrong || isLong || isLast)) continue;
          const pc = projectPc(m);
          structPcs.push(pc);
          if (firstStructPc < 0) firstStructPc = pc;
          lastStructPc = pc;
      }

      const vlInHit = (vlIn && firstStructPc >= 0 && vlIn.has(firstStructPc)) ? 1 : 0;
      const vlOutHit = (vlOut && lastStructPc >= 0 && vlOut.has(lastStructPc)) ? 1 : 0;
      const variety = structPcs.length > 0
          ? new Set(structPcs).size / structPcs.length
          : 0;
      return { vlInHit, vlOutHit, variety };
  }

  private deriveDevelopmentMotif(currentMotif: any[]): any[] {
      // Phase 6 — deriveDevelopmentMotif REMOVED.
      //
      // The variant generator used to apply one of three musician-
      // style transformations randomly:
      //   - Inversion (倒影)       — mirror each note's diatonicStep/
      //                              chromaticOffset around the first
      //   - Late entry (晚拍进入)  — shift all notes by 0.125 beats
      //   - Truncation (截短留白)  — keep first half, drop rest
      //
      // These produced "develop variants" of motifA/B/C in the legacy
      // hand-written motif system. With Impro-Visor licks as the sole
      // melody source, fresh per-bar lick selection provides the
      // variety; mutation of a real-human lick scrambles its character.
      // Pass through unchanged.
      return currentMotif.map(n => ({ ...n }));
  }

    /**
     * Pick the correct 7th scale-step for a bass walking line over `chord`.
     *
     * Walking 1-7-5-1 patterns (Root_7_5_8 / Root_5_7_5) need a stepwise
     * descent from the root. The 7th must match the chord's actual quality
     * — M7 (11 semis) for major-flavoured chords, b7 (10 semis) otherwise.
     *
     * Priority:
     *   1. If the chord's literal intervals already declare M7 (11) or
     *      b7 (10), use that. Authoritative.
     *   2. Otherwise (triad / add9 / 6/9 / sus / etc.) infer from quality.
     *      Major-quality (maj / add9 / 6 / 6/9 / aug / sus) → M7.
     *      Minor / dim / dom-flavoured → b7.
     *
     * The previous heuristic `chord.type.includes('maj') && !startsWith('m')`
     * was double-broken: 'add9' / '6/9' lacked 'maj' substring so they got
     * b7 (polluting Cadd9 with a Bb), AND every actual 'maj' / 'maj7' /
     * 'maj9' starts with 'm' so the !startsWith('m') guard inverted those
     * to b7 too. Net effect: every chord got b7 except 'aug' / '+'.
     */
    private bassWalkSeventh(chord: ChordDef): number {
        const intervals = CHORD_TYPES[chord.type] || [];
        if (intervals.includes(11)) return 11;
        if (intervals.includes(10)) return 10;
        const t = chord.type;
        const isMinorFamily =
            t === 'min' || t === 'm'
            || (t.startsWith('m') && !t.startsWith('maj'))
            || t === 'dim' || t === 'dim7' || t === 'm7b5' || t === 'm9b5';
        return isMinorFamily ? 10 : 11;
    }

    /**
     * Compute a MIDI pitch sitting `semis` above the chord's UPPER ROOT
     * within the bass register, anchored to the chord's actual bass octave.
     *
     * For Solid (root-position) chords this equals `bassMidi + semis`
     * directly. For Flowing / Preparation / Composite states, `bassMidi` is
     * an inversion or slash-chord bass — adding `semis` to it lands on
     * unrelated pitch classes (e.g. a walking 7th over C/E would naively
     * compute E + 10 = D, not the intended Bb / B). Re-anchoring to the
     * chord's upper root pc, in the same bass-register octave, restores
     * the walking line's musical intent on inversions.
     */
    private bassPitchAtRootOffset(chord: ChordDef, semis: number): number {
        const rootPc = (((chord.rootMidi % 12) + 12) % 12);
        const bMOct = Math.floor(chord.bassMidi / 12);
        const sameOct = bMOct * 12 + rootPc;
        const rootInBassRegister = sameOct >= chord.bassMidi ? sameOct : sameOct + 12;
        return rootInBassRegister + semis;
    }

    private applySwing(t: number, isShuffle: boolean): number {
        if (!isShuffle) return t;
        const beat = Math.floor(t);
        const fraction = t - beat;
        if (fraction === 0) return t;
        // Swing factor (2:1 ratio for 0.66)
        if (Math.abs(fraction - 0.5) < 0.01) return beat + 0.66;
        if (Math.abs(fraction - 0.25) < 0.01) return beat + 0.33;
        if (Math.abs(fraction - 0.75) < 0.01) return beat + 0.83;
        return t;
    }

    private applyTexture(chord: ChordDef, textureType: string, startBeat: number, duration: number, melodyEvents: NoteEvent[], isShuffle: boolean, accentMode: 'heavy' | 'syncopated', density: number = 0.5, nextChord: ChordDef | null = null): NoteEvent[] {
        const events: NoteEvent[] = [];
        const bM = chord.bassMidi;
        // Octave-doubled bass note used by Root_Octave / Arpeggio_Flow /
        // Syncopated_Stabs / etc. The intent is "play the chord root
        // one octave below the bass anchor". When bM-12 would dip
        // below BASS_RANGE.LOW (A1 = 33), fall back to bM itself —
        // preserves chord-tone correctness rather than clamping to an
        // unrelated pc. The earlier Math.max(bM-12, BASS_RANGE.LOW)
        // had a wrong-note bug: when bM was C2 (36), the lower octave
        // would be C1 (24, sub-musical) and the clamp emitted A1 (33)
        // which isn't a chord tone at all. The conditional fallback
        // collapses the doubling to a single-octave bass when the
        // doubled octave would be out of range.
        const bMLow = (bM - 12 >= BASS_RANGE.LOW) ? bM - 12 : bM;
        // Chord-root anchor in bass register. Used by inline texture
        // patterns whose intervals (1-3-5-6-b7, root+P5 alternation,
        // etc.) are written relative to the CHORD ROOT, not the actual
        // bass. When the chord is in an inversion (stepwise_descent /
        // walking_bass picked the 3rd, 5th, or 7th as bass), `bM` no
        // longer carries the root, so `bM + 7` plays a fifth above
        // whatever the bass is — not the chord 5th. Replace pattern
        // arithmetic that's nominally rooted in chord intervals with
        // `bRoot + N` / `bRootLow + N` to stay correctly rooted under
        // inversions.
        const bRoot = this.bassPitchAtRootOffset(chord, 0);
        const bRootLow = (bRoot - 12 >= BASS_RANGE.LOW) ? bRoot - 12 : bRoot;
        // Divisi 2.0 — Smart Omit. When the chord is in 'FirstInversion'
        // state (3rd in bass), upper chord stabs that double the 3rd create
        // a low-frequency clash with the bass. Drop the 3rd from cM so
        // the comping leaves room for the bass to carry it. The 3rd is
        // detected by interval mod-12 — minor third (3) or major (4)
        // semitones above the chord ROOT (NOT the bass), since cM is
        // upper-shell pitches relative to root. Other states pass cM
        // through unchanged.
        // notesMidi is the authoritative source; notes[] is display
        // only. Falls back to string parse if a legacy ChordDef arrives
        // without notesMidi populated.
        let cM = chord.notesMidi ?? chord.notes.map(n => noteToMidi(n));
        if (chord.tensionState === 'FirstInversion') {
            const rootPc = ((chord.rootMidi % 12) + 12) % 12;
            const bassPc = ((chord.bassMidi % 12) + 12) % 12;
            const bassIvToRoot = ((bassPc - rootPc + 12) % 12);
            // Smart Omit only when bass is the chord 3rd (true first
            // inversion). evaluateTensionState's fallback in
            // musicTheory.ts also tags 7th-in-bass (Gm7/F: bass=F=b7)
            // and other non-root inversions as FirstInversion since
            // there's no separate state for them. Without this guard
            // a chord like Gm7/F would lose its literal 3rd (Bb) from
            // the comping, gutting the chord identity — bass already
            // carries the b7, then comping drops the 3rd, leaving only
            // root + 5 + b7 ringing upstairs.
            if (bassIvToRoot === 3 || bassIvToRoot === 4) {
                cM = cM.filter(m => {
                    const intervalToRoot = (((m % 12) - rootPc + 12) % 12);
                    return intervalToRoot !== 3 && intervalToRoot !== 4;
                });
            }
        }

        const pushEvent = (midis: number | number[], t: number, d: number, vol: number, part: 'bass' | 'chord') => {
            if (t >= duration) return;
            // Bar-boundary truncation — clamp the event's duration so
            // it ends within the current bar. Without this, long-held
            // chord voicings (Block_Chord etc. push d = full bar) and
            // tail arpeggio notes ring past the bar line, where the
            // next chord has already started, producing rogue m2
            // clashes between the previous voicing's pcs and the new
            // chord's bass + new melody. The 0.02-beat margin gives a
            // clean release before the next chord enters.
            const remaining = duration - t - 0.02;
            if (remaining <= 0) return;
            d = Math.min(d, remaining);
            // 如果density很低，我们大概率吃掉一些弱拍上的和弦内音（保留强拍）
            if (density < 0.4 && part === 'chord' && (t % 1 !== 0) && this.random.next() > (density * 2)) return;

            // Filter undefined / NaN midis early. Some textures access
            // cM[2] / cM[3] / cM[length-2] etc. which can be undefined
            // when the voicing has only 2-3 notes. Filtering here keeps
            // pushEvent robust without forcing every texture to defend
            // against short voicings inline.
            const noteMidis = (Array.isArray(midis) ? midis : [midis])
                .filter((m): m is number => typeof m === 'number' && Number.isFinite(m));
            if (noteMidis.length === 0) return;

            // Apply global clock
            const swungT = this.applySwing(t, isShuffle);
            const absTime = startBeat + swungT;

            // --- 智能避让与填充感知 ---
            let finalVol = vol;
            // Meter-aware bar position. 4/4: t % 4. 6/8: t % 3. 5/4: t % 5.
            const bpm = this.songMeterContext.beatsPerMeasure;
            const beatInBar = ((t % bpm) + bpm) % bpm;

            // Accent System — strong-beat boost (heavy) vs backbeat boost
            // (syncopated / jazz). Strong-beat positions come from the
            // meter. Tolerance 0.001 = float-precision only — does NOT
            // match humanized texture jitter (±0.05), preserving the
            // original "exact-integer accent" semantics:
            //   4/4 simple: strong [0, 2], backbeat [1, 3]
            //   6/8 compound: strong [0, 1.5], backbeat collapses to strong
            //   3/4 simple: strong [0], backbeat [1, 2]
            //   5/4 irregular: strong [0, 3], backbeat [1, 2, 4]
            const TOL = 0.001;
            const strongBeats = this.songMeterContext.strongBeats;
            const isOnStrong = strongBeats.some(sb => Math.abs(beatInBar - sb) < TOL);
            if (accentMode === 'heavy') {
                if (isOnStrong) finalVol += 0.15;
            } else {
                // Backbeat for compound = on strong (groove emphasizes the 2-of-3 lift).
                // Backbeat for simple = integer position NOT in strongBeats.
                if (this.songMeterContext.isCompound) {
                    if (isOnStrong) finalVol += 0.2;
                } else {
                    const integerInBar = Math.round(beatInBar);
                    const onIntegerBeat = Math.abs(beatInBar - integerInBar) < TOL;
                    if (onIntegerBeat && !isOnStrong) finalVol += 0.2;
                }
            }

            const hasMelodyAtTime = melodyEvents.some(me => absTime >= me.time - 0.1 && absTime < me.time + me.duration);
            if (hasMelodyAtTime) finalVol *= 0.7; 

            const finalMidis = noteMidis.map(m => {
                const overlappingMelody = melodyEvents.find(me => absTime >= me.time - 0.05 && absTime < me.time + me.duration);
                if (overlappingMelody) {
                    const melMidi = overlappingMelody.noteNumber;
                    // Drop overlapping chord-tones an octave to avoid
                    // beating against the melody — but only when the
                    // dropped pitch stays inside the chord-comping
                    // register (CHORD_RANGE.LOW). Otherwise leave the
                    // original; a small clash is better than a chord
                    // event sliding into the bass register.
                    if (Math.abs(m - melMidi) <= 2 && part === 'chord' && m - 12 >= CHORD_RANGE.LOW) return m - 12;
                    if (Math.abs(m - melMidi) <= 2 && part === 'bass' && m - 12 >= BASS_RANGE.LOW) return m - 12; 
                }
                return m;
            });

            // Dedupe before emitting — Root_Octave's [bMLow, bM] pair
            // collapses to [bM, bM] when the lower octave was out of
            // range and bMLow fell back to bM. Without this dedupe,
            // two events at the same midi at the same time get pushed
            // and Tone.js double-triggers the sample (slight phase
            // glitch). Set semantics keeps a single emission per pitch.
            const uniqueMidis = Array.from(new Set(finalMidis));
            uniqueMidis.forEach(m => {
                events.push({
                    noteNumber: m,
                    time: absTime,
                    duration: d,
                    // Soft cap at 0.95 (= MIDI 121). Salamander piano's
                    // top velocity layer (122-127) is the sharpest
                    // hammer-strike sample; keeping that layer in
                    // reserve for actual accents avoids a uniformly
                    // brittle attack on every comping / bass strike.
                    // Melody emit (line ~5688) already uses 0.95; this
                    // brings comping + bass in line.
                    velocity: Math.abs(Math.round(Math.min(0.95, finalVol) * 127)),
                    part,
                });
            });
        };

      switch (textureType) {
          case 'Single_Root': // 1. 单音根音
              pushEvent(bM, 0, duration, 0.8, 'bass');
              break;

          case 'Root_Octave': // 2. 八度根音
              pushEvent([bMLow, bM], 0, duration, 0.85, 'bass');
              break;

          case 'Root_5_8': // 3. 根五根 (1-5-1)
              pushEvent(bM, 0, 0.5, 0.8, 'bass');
              pushEvent(bRoot + 7, 0.5, 0.5, 0.7, 'bass');
              pushEvent(bRoot + 12, 1.0, duration - 1.0, 0.7, 'bass');
              break;

          case 'Root_7_5_8': { // 4. 根七五根 (1-7-5-1) — bass walking pattern
              const seventhSemis = this.bassWalkSeventh(chord);
              pushEvent(bM, 0, 0.5, 0.8, 'bass');
              pushEvent(this.bassPitchAtRootOffset(chord, seventhSemis), 0.5, 0.5, 0.65, 'bass');
              pushEvent(this.bassPitchAtRootOffset(chord, 7), 1.0, 0.5, 0.65, 'bass');
              pushEvent(this.bassPitchAtRootOffset(chord, 12), 1.5, duration - 1.5, 0.7, 'bass');
              break;
          }

          case 'Root_5_7_5': { // 5. 根五七五 — bass walking pattern
              const seventhSemis = this.bassWalkSeventh(chord);
              pushEvent(bM, 0, 0.5, 0.8, 'bass');
              pushEvent(this.bassPitchAtRootOffset(chord, 7), 0.5, 0.5, 0.6, 'bass');
              pushEvent(this.bassPitchAtRootOffset(chord, seventhSemis), 1.0, 0.5, 0.6, 'bass');
              pushEvent(this.bassPitchAtRootOffset(chord, 7), 1.5, 0.5, 0.6, 'bass');
              break;
          }

          case 'Broken_Chord': // 6. 分解和弦
              pushEvent(bM, 0, duration, 0.8, 'bass');
              for (let i = 0; i < duration * 2; i++) {
                  pushEvent(cM[i % cM.length], i * 0.5, 0.5, 0.5 + (this.random.next() * 0.1), 'chord');
              }
              break;

          case 'Arpeggio_Flow': // 7. 琶音
              pushEvent(bMLow, 0, duration, 0.8, 'bass');
              const fullRange = [...cM, ...cM.map(m => m + 12)];
              for (let i = 0; i < duration * 4; i++) {
                  pushEvent(fullRange[i % fullRange.length], i * 0.25, 0.25, 0.5, 'chord');
              }
              break;

          case 'Block_Chord': // 8. 柱式和弦
              pushEvent(bM, 0, duration, 0.85, 'bass');
              pushEvent(cM, 0, Math.min(2, duration), 0.7, 'chord');
              if (duration > 2) pushEvent(cM, 2, duration - 2, 0.6, 'chord');
              break;

          case 'Call_And_Response':
              // Comping pattern: bass anchor on beat 0 + chord stabs in
              // gaps where the melody isn't sounding. Stabs use the
              // full shell voicing (cM array) so the listener hears
              // an actual chord, not a single low note.
              pushEvent(bM, 0, duration, 0.8, 'bass');
              for (let b = 0; b < duration; b += 0.5) {
                  const absTime = startBeat + b;
                  const melAtTime = melodyEvents.find(me => absTime >= me.time - 0.1 && absTime < me.time + 0.3);
                  if (!melAtTime) {
                      pushEvent(cM, b, 0.5, 0.6, 'chord');
                  }
              }
              break;
          
          case 'Jazz_Walking_Bass': {
              // Real walking line: one note per beat, anchored on the chord
              // root at beat 1, walking through chord tones, and approaching
              // the NEXT chord's root chromatically on the final beat.
              //
              // Beat 1: root.
              // Middle beats: chord tones (3rd / 5th / 7th) chosen with light
              //   randomization; bias toward 3-5 motion which is the canon.
              // Last beat (when duration >= 2): chromatic approach landing
              //   one half-step or whole-step away from nextChord.bassMidi
              //   so beat 1 of the next bar resolves naturally.
              //
              // Chord-quality detection mirrors the engine's coarse rules
              // (m without maj → minor third; maj → major third; otherwise
              // major). Seventh choice follows: dominant/dom7-family → b7,
              // maj-family → maj7, minor-family → b7.
              const isMinor = (chord.type === 'min'
                  || (chord.type.startsWith('m') && !chord.type.startsWith('maj'))
                  || chord.type === 'm7b5' || chord.type === 'dim' || chord.type === 'dim7');
              const isMaj = chord.type.startsWith('maj') || chord.type === 'add9' || chord.type === '6' || chord.type === '6/9';
              const isDim = chord.type === 'dim' || chord.type === 'dim7' || chord.type === 'm7b5';

              const thirdInterval = isMinor || isDim ? 3 : 4;
              const fifthInterval = isDim ? 6 : 7;
              const seventhInterval = isMaj ? 11 : 10;

              const chordTones = [
                  bM,                          // root
                  bM + thirdInterval,
                  bM + fifthInterval,
                  bM + seventhInterval,
              ];

              // Beat 1 — root.
              pushEvent(bM, 0, 1, 0.85, 'bass');

              if (duration >= 2) {
                  // Compute approach tone for the LAST beat ahead of time so
                  // intermediate beats can avoid colliding with it.
                  const nextRoot = nextChord ? nextChord.bassMidi : bM;
                  // Half-step approach by default (jazz canon); whole-step is
                  // a softer alternative that tends to feel more diatonic.
                  const halfStep = this.random.next() < 0.6;
                  const direction = this.random.next() < 0.5 ? -1 : 1;
                  const approachTone = nextRoot + direction * (halfStep ? 1 : 2);

                  // Middle beats: pick chord tones avoiding repetition of root.
                  // duration === 2 → one middle slot; duration === 4 → two slots.
                  const middleCount = Math.max(0, Math.floor(duration) - 2);
                  const middlePool = chordTones.slice(1); // 3rd / 5th / 7th
                  let prevPick = bM;
                  for (let i = 0; i < middleCount; i++) {
                      // Bias 3-5 motion: 60% chord tone, 40% scale neighbour.
                      const candidates = middlePool.filter((mt) => mt !== prevPick);
                      const pick = candidates.length > 0
                          ? this.random.pick(candidates)
                          : middlePool[0];
                      pushEvent(pick, i + 1, 1, 0.78, 'bass');
                      prevPick = pick;
                  }

                  // Final beat — approach tone.
                  pushEvent(approachTone, duration - 1, 1, 0.82, 'bass');
              }
              break;
          }

          case 'Jazz_Comping':
              // Strong-beat anchors (0 + 2) so chord aligns with bass
              // on grid; off-beat decoration on 1.5 (→ 1.66 swung).
              // Was only 1.5 + 3.0 — produced chord events ONLY in
              // off-beat positions while bass and melody held grid,
              // creating 重拍错位.
              pushEvent(bM, 0, duration, 0.8, 'bass');
              pushEvent(cM, 0, 0.5, 0.65, 'chord');                              // anchor beat 0
              if (duration > 1.5) pushEvent(cM, 1.5, 0.25, 0.45, 'chord');       // off-beat (→ 1.66 swung)
              if (duration >= 2.0) pushEvent(cM, 2, 0.5, 0.65, 'chord');         // anchor beat 2
              if (duration > 3.0) pushEvent(cM, 3.0, 0.5, 0.55, 'chord');         // (legacy)
              break;

          case 'Blues_Shuffle_Bass': {
              // Boogie pattern walks up from the chord ROOT (not the inversion
              // bass) so the bass line tracks each chord change correctly. The
              // shape is 1-3-5-6 with quality-correct third/fifth — minor and
              // dim chords get b3 / b5 instead of being forced into a major
              // boogie. The 6 stays the major 6 since that's the bluesy
              // shoulder tone the style is built around.
              const rootBass = chord.rootMidi - 12;
              const isMinor = chord.type === 'min'
                  || (chord.type.startsWith('m') && !chord.type.startsWith('maj'))
                  || chord.type === 'dim' || chord.type === 'dim7' || chord.type === 'm7b5';
              const isDim = chord.type === 'dim' || chord.type === 'dim7' || chord.type === 'm7b5';
              const third = isMinor ? 3 : 4;
              const fifth = isDim ? 6 : 7;
              for (let i = 0; i < duration * 2; i++) {
                  const tBase = i * 0.5;
                  const isLong = i % 2 === 0;
                  const offset = i % 4 === 0 ? 0 : i % 4 === 1 ? third : i % 4 === 2 ? fifth : 9;
                  // 针对 Shuffle 的时值优化：让长音更饱满，短音更跳跃
                  pushEvent(rootBass + offset, tBase, isLong ? 0.4 : 0.2, 0.8, 'bass');
              }
              break;
          }

          case 'Blues_Stabs':
              pushEvent(bM, 0, duration, 0.8, 'bass');
              // 加入人性化 Comping (钢琴右手节奏点)，带切分与随机数，不死板
              for (let t = 1; t < Math.floor(duration); t += 2) {
                 // 80% 概率在2、4拍的正拍打出 (带微弱偏移)，20% 在前半拍(1.66)抢拍
                 const isSyncopated = this.random.next() > 0.8;
                 const hitTime = Math.max(0, t + (isSyncopated ? -0.34 : (this.random.next() * 0.1 - 0.05)));
                 const hitDur = isSyncopated ? 0.34 : 0.15 + (this.random.next() * 0.1);
                 const hitVol = 0.6 + (this.random.next() * 0.2); // 随机力度
                 pushEvent(cM, hitTime, hitDur, hitVol, 'chord');
                 
                 // 偶尔在正拍后加上轻巧的“回复”和弦碎音 (Ghost chord)
                 if (!isSyncopated && this.random.next() > 0.7 && t + 0.66 < duration) {
                     pushEvent(cM, t + 0.66, 0.15, hitVol * 0.6, 'chord');
                 }
              }
              break;

          case 'Syncopated_Stabs':
              pushEvent([bMLow, bM], 0, 1.5, 0.9, 'bass');
              pushEvent(cM, 0, 1.0, 0.8, 'chord');
              if (duration > 1.5) pushEvent(cM, 1.5, 1.0, 0.7, 'chord');
              break;

          case 'Ostinato_16s':
              pushEvent(bM, 0, duration, 0.8, 'bass');
              for (let i = 0; i < duration * 4; i++) {
                  pushEvent(cM[i % cM.length], i * 0.25, 0.25, 0.5 + (i%4===0?0.2:0), 'chord');
              }
              break;

          case 'Block_Chord_Staccato':
              pushEvent(bM, 0, 0.1, 0.85, 'bass');
              pushEvent(cM, 0, 0.1, 0.8, 'chord');
              if (duration > 1) {
                  pushEvent(cM, 1.0, 0.1, 0.7, 'chord');
                  pushEvent(cM, 1.5, 0.1, 0.6, 'chord');
              }
              break;

          case 'Arp_Seq':
              pushEvent(bMLow, 0, duration, 0.8, 'bass');
              for (let i = 0; i < duration * 4; i++) {
                  const t = i * 0.25;
                  const note = cM[i % cM.length] + (i >= cM.length ? 12 : 0);
                  pushEvent(note, t, 0.2, 0.6, 'chord');
              }
              break;

          case 'Root_Octave_Pulse':
              for (let i = 0; i < duration * 2; i++) {
                  pushEvent(i % 2 === 0 ? bMLow : bM, i * 0.5, 0.4, 0.8, 'bass');
              }
              break;

          case 'Bossa_Clave_Comping':
              pushEvent(bM, 0, duration, 0.8, 'bass');
              // 3-2 Clave ish comping
              const claveTimes = [0, 0.75, 1.5, 2.5, 3.25];
              claveTimes.forEach(t => {
                  if (t < duration) pushEvent(cM, t, 0.2, 0.7, 'chord');
              });
              break;

          case 'Root_Fifth_Bass':
              for (let i = 0; i < duration; i++) {
                  pushEvent(i % 2 === 0 ? bM : bRoot + 7, i, 0.8, 0.8, 'bass');
              }
              break;

          case 'Funk_Guitar_Scratch':
              pushEvent(bM, 0, 0.5, 0.8, 'bass');
              for (let i = 0; i < duration * 4; i++) {
                  if (i % 4 !== 0) { // Offbeat scratches
                    pushEvent(cM, i * 0.25, 0.1, 0.4, 'chord');
                  }
              }
              break;

          case 'Slap_Bass_Line':
              pushEvent(bMLow, 0, 0.25, 0.9, 'bass'); // The "One"
              if (duration > 0.75) pushEvent(bM, 0.75, 0.15, 0.8, 'bass');
              if (duration > 1.5) pushEvent(bRoot + 12, 1.5, 0.1, 0.7, 'bass');
              if (duration > 2.25) pushEvent(bM, 2.25, 0.15, 0.7, 'bass');
              break;

          case 'Stabs':
              pushEvent(bM, 0, 0.15, 0.85, 'bass');
              const stabPositions = [0.25, 0.75, 1.25, 1.75];
              stabPositions.forEach(p => {
                  if (p < duration) pushEvent(cM, p, 0.1, 0.8, 'chord');
              });
              break;

          // ==========================================
          // Curated mid-low piano accompaniment textures.
          // Designed for the bass-mid register (bMLow / bM / cM); avoid
          // upper register and use precise micro-timing (0.33 triplets,
          // 1.66 shuffle and-of-2, +0.05 grace) to simulate human
          // groove. Texture timing is direct — applySwing operates on
          // motif notes, not these.
          // ==========================================

          // ---- POP (5) ----
          case 'Pop_Piano_Arp_16ths': {
              // Modern pop ballad wave arpeggio (Adele / Ghibli-style).
              // Avoids beat 0 / beat 2 to leave space for the bass.
              pushEvent(bMLow, 0, duration, 0.8, 'bass');
              if (duration >= 2) pushEvent(bRoot + 7, 0.5, duration - 0.5, 0.7, 'bass');
              // Upper octave doubling is filtered against CHORD_RANGE.HIGH
              // — cM's top voicing is often near the ceiling, so a +12
              // doubling would overflow into the melody register.
              const arpPitches = [...cM, ...cM.map(m => m + 12).filter(m => m <= CHORD_RANGE.HIGH)];
              // Density reduced to effective 8th notes (every other
              // 16th slot). The original 16th-note density stacks too
              // many events for ballad context — listener hears it
              // as "音符堆积"。Skipping the off-16ths gives the arp
              // breathing room while preserving the wave shape.
              for (let i = 0; i < duration * 4; i++) {
                  if (i % 8 === 0) continue;
                  if (i % 2 !== 0) continue;  // 8th density: skip odd 16ths
                  const t = i * 0.25;
                  const arpVol = 0.4 + Math.sin((i / (duration * 4)) * Math.PI) * 0.2;
                  pushEvent(arpPitches[(i - 1) % arpPitches.length], t, 0.45, arpVol, 'chord');
              }
              break;
          }
          case 'Pop_Broken_8ths_Sync': {
              // 8th-note syncopated broken chord — alternates lower and
              // upper pair of cM voicing on the off-beats.
              pushEvent(bM, 0, duration, 0.85, 'bass');
              for (let i = 0; i < duration * 2; i++) {
                  const t = i * 0.5;
                  if (i % 4 === 0) continue;
                  const isHigh = i % 2 !== 0;
                  const notes = isHigh ? [cM[cM.length - 2], cM[cM.length - 1]] : [cM[0], cM[1]];
                  pushEvent(notes, t, 0.4, 0.55 + (isHigh ? 0.1 : 0), 'chord');
              }
              break;
          }
          case 'Pop_Anthem_Pulse': {
              // Sparse ballad anthem pulse. Strong beat = bottom + top
              // of voicing (2 notes, octave-anthem feel); off-beat =
              // single middle voice (root color, no stack). The 4-note
              // strong-beat stack of earlier versions piled 16 events
              // on the downbeats alone — too thick for piano ballad.
              // 2-note strong + 1-note off gives ~12 events per bar
              // with clear anthem accent + middle-voice shimmer.
              // Idiom: Coldplay "The Scientist" / "Fix You" piano
              // verse — open intervals on the beat, single fill on
              // the off-beat.
              pushEvent(bMLow, 0, duration, 0.85, 'bass');
              const bottom = cM[0];
              const top = cM[cM.length - 1];
              const middle = cM[Math.floor(cM.length / 2)];
              for (let i = 0; i < duration; i++) {
                  // Beat i (quarter): bottom + top — anthem accent,
                  // 2-note open voicing
                  if (cM.length >= 2 && bottom !== top) {
                      pushEvent([bottom, top], i, 0.9, 0.65, 'chord');
                  } else {
                      pushEvent(cM, i, 0.9, 0.65, 'chord');
                  }
                  // Beat i + 0.5 (off-beat): single middle voice, soft
                  if (i + 0.5 < duration && cM.length >= 3) {
                      pushEvent(middle, i + 0.5, 0.45, 0.4, 'chord');
                  }
              }
              break;
          }
          case 'Pop_Ballad_158_Sweep': {
              // 1-5-8 pop ballad bass sweep with cM stab releases.
              pushEvent(bMLow, 0, duration, 0.8, 'bass');
              pushEvent(bRootLow + 7, 0.5, duration - 0.5, 0.65, 'bass');
              pushEvent(bM, 1.0, duration - 1.0, 0.6, 'bass');
              if (duration > 1.5) pushEvent(cM, 1.5, duration - 1.5, 0.6, 'chord');
              if (duration > 2.5) pushEvent(cM, 2.5, duration - 2.5, 0.5, 'chord');
              break;
          }
          case 'Pop_Ostinato_Rock': {
              // Top-of-cM ostinato held in 16ths against a moving lower
              // voicing on every other 16th.
              pushEvent(bMLow, 0, duration, 0.85, 'bass');
              const topNote = cM[cM.length - 1];
              const lowerNotes = cM.slice(0, cM.length - 1);
              for (let i = 0; i < duration * 4; i++) {
                  const t = i * 0.25;
                  pushEvent(topNote, t, 0.2, 0.6, 'chord');
                  if (i % 2 === 0 && lowerNotes.length > 0) {
                      pushEvent(lowerNotes, t, 0.4, 0.5, 'chord');
                  }
              }
              break;
          }
          case 'Pop_Alberti_Lyrical': {
              // Alberti bass (1-5-3-5) broken chord in 8th notes. The
              // pattern walks low-high-middle-high through the voicing's
              // bottom three voices, repeating every 4 eighths. Bass
              // sustains underneath. Soft dynamics (0.45-0.55) keep the
              // accompaniment "behind" the melody — lyrical default.
              // Source: Alberti bass standard (Mozart K.545 etc.),
              // adapted for pop ballad density.
              pushEvent(bMLow, 0, duration, 0.78, 'bass');
              if (cM.length < 3) {
                  // Fall back to half-arp on small voicings (no 3rd voice
                  // = pattern degenerates to back-and-forth, jarring).
                  for (let i = 0; i < duration * 2; i++) {
                      const t = i * 0.5;
                      pushEvent(cM[i % cM.length], t, 0.45, 0.5, 'chord');
                  }
              } else {
                  const lo = cM[0], mid = cM[Math.floor(cM.length / 2)], hi = cM[cM.length - 1];
                  const pattern = [lo, hi, mid, hi];
                  for (let i = 0; i < duration * 2; i++) {
                      const t = i * 0.5;
                      const vol = i % 4 === 0 ? 0.55 : 0.45;
                      pushEvent(pattern[i % 4], t, 0.45, vol, 'chord');
                  }
              }
              break;
          }
          case 'Pop_Half_Arp_Sweep': {
              // Ascending half-arpeggio: 4 voicing notes one by one in
              // 8ths over the first half of the bar, then the full
              // voicing sustained through the second half. Produces a
              // "rise and settle" feel — listener hears the chord
              // unfolding, then resting. Adele / Sam Smith piano-only
              // ballad opener idiom.
              pushEvent(bMLow, 0, duration, 0.78, 'bass');
              const sweepLen = Math.min(cM.length, 4);
              for (let i = 0; i < sweepLen; i++) {
                  pushEvent(cM[i], i * 0.5, 0.5, 0.45 + (i / sweepLen) * 0.15, 'chord');
              }
              if (duration > sweepLen * 0.5) {
                  const sustainStart = sweepLen * 0.5;
                  pushEvent(cM, sustainStart, duration - sustainStart, 0.5, 'chord');
              }
              break;
          }
          case 'Pop_Wave_16ths': {
              // Up-down arpeggio wave in EIGHTHS through the voicing
              // (was 16ths — halved for ballad density). Coldplay
              // "Clocks" idiom softened: no fixed top-note hammer, no
              // aggressive lower-pair stab. 8th-note wave sweeps cM[0]
              // → cM[top] → back, leaving room between notes instead
              // of stacking events. Bass holds beneath, dynamics curve
              // gently (0.4 - 0.6).
              pushEvent(bMLow, 0, duration, 0.78, 'bass');
              if (cM.length === 0) break;
              // Build a wave: up through cM, down through cM (skip
              // endpoints so the wave doesn't double-hit the top/bottom).
              const wave: number[] = [];
              for (let i = 0; i < cM.length; i++) wave.push(cM[i]);
              for (let i = cM.length - 2; i > 0; i--) wave.push(cM[i]);
              if (wave.length === 0) wave.push(cM[0]);
              for (let i = 0; i < duration * 2; i++) {
                  const t = i * 0.5;
                  // Soft sine envelope per 4-beat group
                  const phase = (i % (wave.length * 2)) / (wave.length * 2);
                  const vol = 0.4 + Math.sin(phase * Math.PI) * 0.2;
                  pushEvent(wave[i % wave.length], t, 0.45, vol, 'chord');
              }
              break;
          }

          // ---- RNB (5) ----
          case 'RnB_Neo_Soul_Roll': {
              // D'Angelo / Erykah Badu chord roll — each cM note
              // staggered by ~40ms (rolled-chord feel). Was offset
              // starting at +0.05 (= 50ms after beat), pushing the
              // perceived strong-beat onset off the grid relative to
              // bass/melody. Now starts at beat 0 (on grid) and the
              // roll-spread (0.04 per voice) preserves the rolled
              // texture without delaying the downbeat anchor.
              pushEvent(bMLow, 0, duration, 0.85, 'bass');
              if (duration >= 4) pushEvent(bM, 2.75, 1.25, 0.75, 'bass');
              [0, 2].forEach(beat => {
                  if (beat >= duration) return;
                  cM.forEach((m, idx) => {
                      const rollTime = beat + (idx * 0.04);
                      pushEvent(m, rollTime, Math.min(2, duration) - 0.2, 0.55 + (idx * 0.05), 'chord');
                  });
              });
              break;
          }
          case 'RnB_Gospel_Triplets': {
              // 6/8 gospel triplet pulse (Alicia Keys-style). Triplet
              // timing 0.33 / 0.66 lives in texture-time, not motif-time
              // — bypasses QUANTIZED_DURATIONS by design.
              pushEvent(bM, 0, duration, 0.8, 'bass');
              for (let i = 0; i < Math.floor(duration); i++) {
                  pushEvent(cM[0 % cM.length], i + 0.00, 0.35, 0.65, 'chord');
                  pushEvent(cM[1 % cM.length], i + 0.33, 0.35, 0.55, 'chord');
                  pushEvent(cM[2 % cM.length], i + 0.66, 0.35, 0.50, 'chord');
              }
              break;
          }
          case 'RnB_Laid_Back_Groove': {
              // Was hardcoded 120ms (0.12 beat) chord delay against
              // on-grid bass for J Dilla feel — but 120ms is too
              // large without drums anchoring the grid, perceived as
              // chord "late one beat" rather than micro-laid-back.
              // Reduced to 40ms (0.04 beat ≈ humanization micro-time)
              // so the chord still feels slightly behind the bass /
              // melody but the strong-beat anchor is intact.
              pushEvent(bMLow, 0, duration, 0.8, 'bass');
              const delay = 0.04;
              [0, 1.5, 2.5].forEach(t => {
                  if (t < duration) pushEvent(cM, t + delay, 0.75, 0.7, 'chord');
              });
              break;
          }
          case 'RnB_16th_Funk_Stabs': {
              // James Brown-style 16th-note off-beat stabs.
              pushEvent(bM, 0, duration, 0.85, 'bass');
              [0.25, 0.75, 1.75, 2.25, 3.25].forEach(t => {
                  if (t < duration) pushEvent(cM, t, 0.15, 0.8, 'chord');
              });
              break;
          }
          case 'RnB_Classic_Soul_Arp': {
              // Stevie Wonder-style descending arpeggio with sustained
              // chord pad on the first half of the bar.
              pushEvent(bMLow, 0, duration, 0.8, 'bass');
              if (duration >= 2.0) pushEvent(bRoot + 7, 1.0, duration - 1.0, 0.6, 'bass');
              if (duration >= 3.0) {
                  cM.slice().reverse().forEach((m, idx) => {
                      pushEvent(m, 2.0 + (idx * 0.25), 0.5, 0.6, 'chord');
                  });
              }
              pushEvent(cM, 0, 1.5, 0.65, 'chord');
              break;
          }

          // ---- JAZZ (5) ----
          case 'Jazz_Drop_2_Comp': {
              // Bill Evans-style off-beat comp — drops the top voice
              // (rootless inner-voice shell). Random velocity jitter
              // gives the comping a human breath. Consumes 1-3 randoms
              // per bar from the main pipeline (texture-stage shift,
              // not main melody — baseline regenerates accordingly).
              //
              // Strong-beat anchor: beat 0 + beat 2 carry the full
              // comp on-grid so bass / melody / chord all align at
              // the bar's down-beats. Off-beat syncopation (0.66 /
              // 1.5 / 2.66 — the "and of 2/3" Charleston positions)
              // is layered as decoration, NOT a substitute. Without
              // the strong-beat anchor, the listener (with no drums
              // backing) perceives the off-beat chord as "early /
              // late" rather than as proper syncopation against an
              // implied grid.
              pushEvent(bM, 0, duration, 0.8, 'bass');
              const compNotes = cM.length > 2 ? cM.slice(0, cM.length - 1) : cM;
              // Strong-beat anchors (grid-aligned, on-beat)
              [0, 2].forEach(t => {
                  if (t < duration) {
                      pushEvent(compNotes, t, 0.45, 0.55, 'chord');
                  }
              });
              // Off-beat syncopation (Charleston-style decoration)
              [1.5].forEach(t => {
                  if (t < duration) {
                      pushEvent(compNotes, t, 0.25, 0.45 + this.random.next() * 0.15, 'chord');
                  }
              });
              break;
          }
          case 'Jazz_Charleston_Comp': {
              // Charleston: strong-beat anchor (0 + 2) PLUS off-beat
              // syncopation. Earlier version had only `0` + `1.66` —
              // beat 2 was un-anchored and chord drifted relative to
              // bass/melody. Now beats 0 + 2 carry chord (grid
              // alignment with bass / melody downbeats); off-beat
              // 1.5 (→ 1.66 swung) layers in as Charleston decoration.
              pushEvent(bMLow, 0, duration, 0.85, 'bass');
              pushEvent(cM, 0, 0.5, 0.7, 'chord');                              // anchor: beat 0
              if (duration >= 2.0) {
                  pushEvent(cM, 1.5, 0.25, 0.45, 'chord');                       // off-beat decoration (1.66 swung)
                  pushEvent(cM, 2, 0.5, 0.7, 'chord');                            // anchor: beat 2
              }
              break;
          }
          case 'Jazz_Red_Garland_Block': {
              // Red Garland-style block chords on every beat. Was
              // hardcoded "i - 0.34" anticipation — that produced
              // chord events at fractional times like 0.66 / 1.66 /
              // 2.66, but bass and melody held grid, creating
              // strong-beat misalignment. Now on-grid; applySwing in
              // pushEvent applies shuffle uniformly when isShuffle.
              pushEvent(bM, 0, duration, 0.75, 'bass');
              for (let i = 0; i < duration; i++) {
                  pushEvent(cM, i, 0.5, 0.4, 'chord');
              }
              break;
          }
          case 'Bossa_Piano_Arp': {
              // Bossa Nova clave-driven bass + chord pattern on
              // {0.5, 1.5, 2.0, 3.5}.
              for (let i = 0; i < Math.floor(duration); i += 2) {
                  pushEvent(bM, i, 1.5, 0.85, 'bass');
                  if (i + 1 < duration) pushEvent(bRoot + 7, i + 1, 1.0, 0.75, 'bass');
              }
              [0.5, 1.5, 2.0, 3.5].forEach(t => {
                  if (t < duration) pushEvent(cM, t, 0.4, 0.65, 'chord');
              });
              break;
          }
          case 'Jazz_Waltz_Hemiola': {
              // 3-against-4 hemiola: chord stabs every 1.5 beats over
              // a 4/4 bass — implies a 3/4 cross-rhythm. WITHOUT
              // drums anchoring the 4/4 grid, the listener perceives
              // the hemiola as straight misalignment rather than
              // intentional polyrhythm. Beat 2 anchor (softer
              // velocity than the hemiola pulses) gives chord a
              // grid foothold so bass/melody downbeats are supported.
              pushEvent(bM, 0, duration, 0.8, 'bass');
              [0, 1.5, 3.0].forEach(t => {
                  if (t < duration) pushEvent(cM, t, 0.5, 0.6, 'chord');
              });
              if (duration >= 2.0) pushEvent(cM, 2.0, 0.4, 0.5, 'chord');  // beat-2 anchor
              break;
          }

          // ---- BLUES (5) ----
          case 'Blues_Slow_12_8_Arp': {
              // Slow blues 12/8 wave — three triplets per beat over a
              // sustained bass. Triplet times 0.00 / 0.33 / 0.66 are
              // texture-direct, not subject to QUANTIZED_DURATIONS.
              pushEvent(bMLow, 0, duration, 0.85, 'bass');
              const bluesPitches = [cM[0], cM[1], cM[2], cM[3] || cM[1]];
              for (let i = 0; i < Math.floor(duration); i++) {
                  pushEvent(bluesPitches[0], i + 0.00, 0.3, 0.7, 'chord');
                  pushEvent(bluesPitches[1], i + 0.33, 0.3, 0.6, 'chord');
                  pushEvent(bluesPitches[2], i + 0.66, 0.3, 0.6, 'chord');
              }
              break;
          }
          case 'Blues_Tremolo_Comp': {
              // Tremolo double-stops on backbeats — bottom note rings,
              // top two alternate in 16ths to simulate the wobble.
              pushEvent(bM, 0, duration, 0.85, 'bass');
              if (cM.length >= 2) {
                  const top1 = cM[cM.length - 1], top2 = cM[cM.length - 2], bottom = cM[0];
                  for (let i = 0; i < duration; i++) {
                      pushEvent(bottom, i, 0.5, 0.75, 'chord');
                      if (i % 2 !== 0) {
                          for (let j = 0; j < 4; j++) {
                              pushEvent(j % 2 === 0 ? top1 : top2, i + (j * 0.25), 0.15, 0.65, 'chord');
                          }
                      }
                  }
              }
              break;
          }
          case 'Blues_Boogie_Woogie': {
              // Boogie-Woogie 1-3-5-6-b7-6-5-3 left-hand walk. Quality-
              // aware: minor → b3, m7b5 → b5. Backbeat chord stab on
              // every 4th 8th-note.
              const isMinor = chord.type.includes('m') && !chord.type.includes('maj');
              const isFlat5 = chord.type.includes('b5');
              const pattern = [
                  0,
                  isMinor ? 3 : 4,
                  isFlat5 ? 6 : 7,
                  9,
                  10,
                  9,
                  isFlat5 ? 6 : 7,
                  isMinor ? 3 : 4,
              ];
              for (let i = 0; i < duration * 2; i++) {
                  const t = i * 0.5;
                  pushEvent(bRootLow + (pattern[i % 8] || 0), t, 0.4, 0.85, 'bass');
                  if (i % 4 === 3) pushEvent(cM, t, 0.4, 0.7, 'chord');
              }
              break;
          }
          case 'Blues_Chicago_Shuffle': {
              // Chicago shuffle — chord stab on each beat plus a
              // shuffled "and" hit at 0.66 (the swing eighth).
              pushEvent(bMLow, 0, duration, 0.85, 'bass');
              for (let i = 0; i < Math.floor(duration); i++) {
                  pushEvent(cM, i, 0.3, 0.6, 'chord');
                  pushEvent(cM, i + 0.66, 0.3, 0.7, 'chord');
              }
              break;
          }
          case 'Blues_Slow_Chops': {
              // Slow blues "chops" — backbeat smash on 2 and 4 with a
              // 50ms grace flam BEFORE the hit (the snare-style attack).
              pushEvent(bM, 0, duration, 0.8, 'bass');
              [1, 3].forEach(beat => {
                  if (beat < duration) {
                      pushEvent(cM, beat - 0.05, 0.1, 0.6, 'chord');
                      pushEvent(cM, beat, 0.5, 0.85, 'chord');
                  }
              });
              break;
          }

          // ───────────────────────────────────────────────────────────
          // Modern lyrical / ambient textures (per textureProfiles.ts).
          // These are dispatched per-bar by pickTextureForBar based on
          // phrase-cell role + density + energy + chord-function context.
          // ───────────────────────────────────────────────────────────

          case 'Lyrical_Felt_Piano_Sparse': {
              // Felt piano — bass long hold, upper voices only answer in gaps.
              // Intended for INTRO / VERSE / low-energy lyrical bars.
              pushEvent(bMLow, 0, Math.min(duration, 3.8), 0.62, 'bass');
              pushEvent(cM, 0.15, 1.2, 0.42, 'chord');
              if (duration >= 4) {
                  pushEvent(cM.slice(-2), 2.25, 0.45, 0.36, 'chord');
                  pushEvent(cM.slice(0, 2), 3.25, 0.35, 0.30, 'chord');
              }
              break;
          }

          case 'Lyrical_10th_Broken': {
              // Mandarin / pop ballad — left hand root + 10th feel,
              // right hand broken-chord arpeggio.
              const isMinorChord = chord.type.startsWith('m') && !chord.type.startsWith('maj');
              const thirdPcMidi = this.bassPitchAtRootOffset(chord, isMinorChord ? 3 : 4);
              const tenth = thirdPcMidi + 12;
              pushEvent(bMLow, 0, 1.5, 0.72, 'bass');
              if (duration > 2) pushEvent(tenth, 1.5, 0.6, 0.45, 'bass');
              const arp = [cM[0], cM[1], cM[2], cM[1]].filter(Number.isFinite);
              for (let i = 0; i < duration * 2; i++) {
                  const t = i * 0.5 + 0.05;
                  pushEvent(arp[i % arp.length], t, 0.32, 0.34 + (i % 4 === 0 ? 0.08 : 0), 'chord');
              }
              break;
          }

          case 'Ambient_Pad_Breath': {
              // Long held chord — INTRO / VERSE / BRIDGE / ambient lyrical.
              // Low velocity intentionally.
              pushEvent(bMLow, 0, duration, 0.48, 'bass');
              pushEvent(cM, 0.05, Math.min(duration, 2.8), 0.34, 'chord');
              if (duration >= 4) {
                  pushEvent(cM.slice(1), 2.6, 1.2, 0.28, 'chord');
              }
              break;
          }

          case 'Ambient_Reverse_Swell': {
              // Inhale / swell — for bar BEFORE a cadence or section change.
              // Velocity ramps up over the bar to simulate reverse / swell.
              pushEvent(bMLow, 0, duration, 0.45, 'bass');
              const times = [1.75, 2.5, 3.0, 3.5].filter(t => t < duration);
              times.forEach((t, i) => {
                  pushEvent(cM, t, 0.35, 0.22 + i * 0.08, 'chord');
              });
              break;
          }

          case 'Soft_Guitar_Pluck_8ths': {
              // Acoustic guitar-pluck pattern — modern pop / folk / light RNB.
              pushEvent(bM, 0, 1.8, 0.58, 'bass');
              const notes = [cM[0], cM[1], cM[2], cM[1], cM[3] ?? cM[2], cM[1]].filter(Number.isFinite);
              const pattern = [0.0, 0.5, 1.0, 1.5, 2.5, 3.0];
              pattern.forEach((t, i) => {
                  if (t < duration) pushEvent(notes[i % notes.length], t + 0.02, 0.28, 0.34, 'chord');
              });
              break;
          }

          case 'Piano_Question_Answer': {
              // Accompaniment answers the melody only in gaps.
              // Bass hits early, chord answers after beat 2.
              pushEvent(bMLow, 0, Math.min(duration, 2.0), 0.65, 'bass');
              if (duration >= 4) {
                  pushEvent(cM, 2.0, 0.5, 0.45, 'chord');
                  pushEvent(cM.slice(-2), 3.0, 0.35, 0.34, 'chord');
              } else {
                  pushEvent(cM, duration * 0.5, 0.35, 0.38, 'chord');
              }
              break;
          }

          case 'Low_Pedal_Color_Wash': {
              // Pedal bass + slowly shifting upper voices.
              // Suits I / vi / IV / bVI color cycles. Avoid on dominant chains.
              pushEvent(bMLow, 0, duration, 0.58, 'bass');
              const upper = cM.filter(m => m - bMLow > 18);
              pushEvent(upper, 0.25, Math.min(duration, 3.2), 0.30, 'chord');
              if (duration >= 4) {
                  pushEvent(upper.slice(1), 3.0, 0.8, 0.24, 'chord');
              }
              break;
          }

          case 'HalfTime_Emotional_Pulse': {
              // Pre-chorus lift / modern emotional Trap-pop —
              // bass holds long, chord stabs on beat 1 and 3 only.
              pushEvent(bMLow, 0, 2.0, 0.82, 'bass');
              if (duration >= 4) pushEvent(bM, 2.0, 2.0, 0.70, 'bass');
              pushEvent(cM, 0.0, 0.75, 0.48, 'chord');
              if (duration >= 4) pushEvent(cM, 2.0, 0.75, 0.42, 'chord');
              break;
          }

          // ───────────────────────────────────────────────────────────
          // LOFI piano-only textures. No drums. Bass is pulse, chord is
          // air, melody is emotion. Per-bar dispatched via TEXTURE_POOL.
          // ───────────────────────────────────────────────────────────

          case 'Piano_Lofi_OneShot_Space': {
              // Single chord hit + long silence. Lowest density.
              // Bass holds full duration. Chord plays ONE soft hit at
              // micro-late position (slight pocket).
              pushEvent(bMLow, 0, duration, 0.55, 'bass');
              pushEvent(cM, 0.05, Math.min(duration * 0.5, 2.0), 0.38, 'chord');
              break;
          }

          case 'Piano_Lofi_Late_Chord_Answer': {
              // Bass starts the bar; chord enters LATE (after beat 2)
              // as if answering the melody's gap. Classic lofi feel.
              pushEvent(bMLow, 0, Math.min(duration, 2.0), 0.60, 'bass');
              if (duration >= 4) {
                  pushEvent(cM, 2.15, 0.65, 0.42, 'chord');
                  pushEvent(cM.slice(-2), 3.1, 0.4, 0.32, 'chord');
              } else {
                  pushEvent(cM, duration * 0.55, 0.4, 0.38, 'chord');
              }
              break;
          }

          case 'Piano_Emo_Broken_10th': {
              // Left hand: root + 10th (third up an octave) feel.
              // Right hand: broken arp on chord tones.
              const isMinorChord = chord.type.startsWith('m') && !chord.type.startsWith('maj');
              const thirdPcMidi = this.bassPitchAtRootOffset(chord, isMinorChord ? 3 : 4);
              const tenthMidi = thirdPcMidi + 12;
              pushEvent(bMLow, 0, 1.5, 0.68, 'bass');
              if (duration > 2) pushEvent(tenthMidi, 1.5, 0.55, 0.42, 'bass');
              const arpPattern = [cM[0], cM[1], cM[2], cM[1]].filter(Number.isFinite);
              for (let i = 0; i < duration * 2; i++) {
                  const t = i * 0.5 + 0.04;
                  pushEvent(arpPattern[i % arpPattern.length], t, 0.30, 0.32 + (i % 4 === 0 ? 0.06 : 0), 'chord');
              }
              break;
          }

          case 'Piano_Ambient_Sustain_Wash': {
              // Long held chord, very low velocity. Pure pad feel.
              // For ambient INTRO bars or low-energy phrase cells.
              pushEvent(bMLow, 0, duration, 0.42, 'bass');
              pushEvent(cM, 0.04, Math.min(duration, 3.5), 0.30, 'chord');
              if (duration >= 4) {
                  pushEvent(cM.slice(1), 3.0, 0.95, 0.24, 'chord');
              }
              break;
          }

          case 'Piano_HalfTime_Soft_Pulse': {
              // Half-time pocket: bass plays 1+3 (beat 0 + 2), chord
              // soft stabs at 0+2 too. Implied beat structure without drums.
              pushEvent(bMLow, 0, 1.85, 0.72, 'bass');
              if (duration >= 4) pushEvent(bM, 2.0, 1.85, 0.62, 'bass');
              pushEvent(cM, 0.05, 0.75, 0.42, 'chord');
              if (duration >= 4) pushEvent(cM, 2.05, 0.75, 0.38, 'chord');
              break;
          }

          case 'Piano_Lofi_Dusty_Chops': {
              // Off-beat dusty chord stabs (J Dilla wonky pocket).
              // Bass anchor + chord on syncopated positions with timing
              // looseness implied via micro velocity humanize.
              pushEvent(bMLow, 0, duration, 0.62, 'bass');
              const offBeats = [0.66, 1.66, 2.66, 3.66].filter(t => t < duration);
              offBeats.forEach((t, i) => {
                  const v = 0.35 + (i % 2 === 0 ? 0.08 : 0);
                  pushEvent(cM, t, 0.30, v, 'chord');
              });
              break;
          }

          case 'Piano_Lofi_Tape_Wobble_Arp': {
              // Slow arpeggio on chord-tone subset, with implied tape
              // wobble (alternating velocity dips). Suits minor / tape
              // sub-styles. Avoids dominant chains (avoidOnDominantChain).
              pushEvent(bMLow, 0, duration, 0.55, 'bass');
              const arp = cM.slice(0, Math.min(cM.length, 4));
              for (let i = 0; i < duration * 2 && i < 8; i++) {
                  const t = i * 0.5 + 0.03;
                  const wobble = i % 2 === 0 ? 0.32 : 0.24;  // alternating velocity dip
                  pushEvent(arp[i % arp.length], t, 0.35, wobble, 'chord');
              }
              break;
          }

          case 'Piano_Wide_Color_Motion': {
              // 真钢琴宽阔排列 + 内部副旋律. 用 chord.widePianoVoicing
              // (attachWidePianoVoicings post-process 挂的).
              // - 强拍轻 roll 整个 7-voice 排列
              // - bass 给空间(不要太花)
              // - 弱拍内部 1-2 条 lane 朝下一和弦"暗中漂"
              if (chord.widePianoVoicing) {
                  const wideEvents = renderWidePianoVoicing({
                      wide: chord.widePianoVoicing,
                      bassMidi: chord.bassMidi,
                      startBeat: 0,  // relative to bar
                      duration,
                      density,
                      melodyEvents,
                  });
                  for (const we of wideEvents) {
                      if (we.part !== 'melody') {
                          pushEvent(we.noteNumber, we.time, we.duration, we.velocity / 127, we.part);
                      }
                  }
              } else {
                  // Fallback: cM block chord
                  pushEvent(cM, 0, Math.min(duration, 2.2), 0.42, 'chord');
              }
              // bass — 简单长持音留空间
              pushEvent(bM, 0, Math.min(duration, 2.4), 0.58, 'bass');
              break;
          }

          case 'Piano_CommonTone_Soft_Roll': {
              // Rolled chord keeping voice-leading common tones.
              // Each voice enters ~30ms apart for "rolled" feel.
              // bMLow holds long; chord rolls in at beat 0 and beat 2.
              pushEvent(bMLow, 0, duration, 0.65, 'bass');
              [0, 2].forEach(beat => {
                  if (beat >= duration) return;
                  cM.forEach((m, idx) => {
                      const rollTime = beat + 0.05 + (idx * 0.03);
                      pushEvent(m, rollTime, Math.min(1.6, duration - beat - 0.1), 0.36 + (idx * 0.02), 'chord');
                  });
              });
              break;
          }
      }
      return events;
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
  private getFillScaleForStyle(
      style: StyleName,
      chord: ChordDef,
      func: 'T' | 'S' | 'D',
      musicKey: string,
      _musicMode: string | undefined,
      fallbackRunScale: number[],
  ): number[] {
      const profile = STYLE_DICTIONARY[style];
      const fillMap = profile.fillScales?.[func];
      if (!fillMap) return fallbackRunScale;

      let scaleNames: string[] | undefined = fillMap[chord.type];
      if (!scaleNames || scaleNames.length === 0) {
          // Family fallback: probe by chord-quality keyword.
          const t = chord.type;
          if (t.includes('maj')) scaleNames = fillMap['maj7'] || fillMap['maj'];
          else if (t.startsWith('m') && !t.startsWith('maj')) scaleNames = fillMap['m7'] || fillMap['min'] || fillMap['m'];
          else if (t.includes('7') || t.includes('9') || t.includes('13')) scaleNames = fillMap['7'];
          else scaleNames = fillMap['maj'];
      }
      if (!scaleNames || scaleNames.length === 0) return fallbackRunScale;

      const scaleName = scaleNames[0];  // first preference per fillMap entry
      const intervals = SCALE_TYPES[scaleName];
      if (!intervals) return fallbackRunScale;

      // BLUES blue-note family stays anchored on key root so the
      // characteristic b3 / b5 / b7 ride across the whole 12-bar form.
      const isBluesFamily = /Blues|Pentatonic/.test(scaleName);
      const rootM = (style === 'BLUES' && isBluesFamily)
          ? noteToMidi(musicKey + "3")
          : chord.rootMidi;

      const midiScale: number[] = [];
      for (let oct = -2; oct <= 3; oct++) {
          intervals.forEach(iv => midiScale.push(rootM + (oct * 12) + iv));
      }
      return midiScale.sort((a, b) => a - b);
  }

  private getScaleForStyle(style: StyleName, chord: ChordDef, func: 'T' | 'S' | 'D', musicKey: string, musicMode?: string): number[] {
      const profile = STYLE_DICTIONARY[style] || STYLE_DICTIONARY['POP'];
      const mapping = profile.scaleMapping[func];

      // ============================================================
      // Diatonic-mode-of-key fast path.
      //
      // Music-theory invariant: when a song is in mode M with key
      // root K, a chord whose root pitch class AND every chord
      // interval pitch class are subsets of M's pitch class set
      // is "diatonic to the key". The melodic palette for that
      // chord MUST be the key's pitch class set — anchored on the
      // chord root, the resulting scale is the rotation-of-M
      // starting at the chord's degree (Ionian's IV → Lydian,
      // ii → Dorian, V → Mixolydian, etc.).
      //
      // The previous logic picked the runScale via
      //   score = preference_bonus(+5) + matching_pcs (0..7)
      // which let "Ionian" (a +5 preference in POP) override
      // "Lydian" on a IV chord even when Lydian fit the key 7/7
      // and Ionian only 6/7 (introducing a foreign Bb). The
      // listener heard a non-diatonic note as the bar's anchor.
      //
      // Fix: detect diatonic chords and bypass style preference
      // entirely. The scale's pc set is fixed by the key, full
      // stop — preference is a "soft" axis that can't override
      // a hard music-theory constraint.
      //
      // BLUES style is excluded from this fast path because its
      // signature aesthetic (b3 + b7 over major chords, blue notes)
      // depends on the chord-rooted Blues scale anchored on the
      // song key — that's an intentional non-diatonic palette and
      // is handled separately further down.
      //
      // Exotic modes (Mixolydian / Dorian / etc. as the song mode)
      // are still handled here as long as the chord is diatonic to
      // the exotic palette. The diatonic check is mode-agnostic;
      // it asks "is the chord built only from notes of the song's
      // declared mode" regardless of which mode that is.
      const modeName = (musicMode && musicMode in SCALE_TYPES)
          ? musicMode
          : 'Ionian';
      if (style !== 'BLUES') {
          const keyRootPc = (((noteToMidi(musicKey + "0") % 12) + 12) % 12);
          const modeIntervals = SCALE_TYPES[modeName];
          const keyPcs = new Set(modeIntervals.map(iv => (keyRootPc + iv) % 12));
          const chordRootPc = (((chord.rootMidi % 12) + 12) % 12);
          const chordIntervals = CHORD_TYPES[chord.type] || [];
          const chordPcs = chordIntervals.map(iv => (chordRootPc + iv) % 12);
          const chordIsDiatonic = keyPcs.has(chordRootPc)
              && chordPcs.every(pc => keyPcs.has(pc));
          if (chordIsDiatonic) {
              const intervalsFromChordRoot: number[] = [];
              for (let iv = 0; iv < 12; iv++) {
                  if (keyPcs.has((chordRootPc + iv) % 12)) {
                      intervalsFromChordRoot.push(iv);
                  }
              }
              const midiScale: number[] = [];
              for (let oct = -2; oct <= 3; oct++) {
                  intervalsFromChordRoot.forEach(iv => {
                      midiScale.push(chord.rootMidi + (oct * 12) + iv);
                  });
              }
              return midiScale.sort((a, b) => a - b);
          }
      }

      // LOGIC PRO: Plan A global scale mapping implementation
      let preferences = profile.scalePreference || [];
      if (musicMode && profile.globalMelodyScaleMapping && profile.globalMelodyScaleMapping[musicMode]) {
          preferences = profile.globalMelodyScaleMapping[musicMode];
      }

      // When an exotic mode is in effect (the 10% gate in
      // resolveGeneration), styleDictionary entries above never name it.
      // Push the exotic mode to the top of preferences so it scores
      // higher than Ionian/Aeolian, and inject it into the chord-type-
      // specific candidate pool below. Without this, melodies in exotic
      // modes silently revert to mainstream scales.
      const isExoticMode = !!musicMode && musicMode in SCALE_TYPES
          && !['Ionian', 'Aeolian', 'Major', 'Minor', 'Major Blues', 'Minor Blues'].includes(musicMode);
      if (isExoticMode) {
          preferences = [musicMode!, ...preferences];
      }

      let scaleChoices: string[] = [];

      // 1. 根据和弦类型获取该风格下的音阶候选池
      if (mapping[chord.type]) {
          scaleChoices = mapping[chord.type];
      } else if (chord.type.includes('maj') && mapping['maj']) {
          scaleChoices = mapping['maj'];
      } else if (chord.type.includes('7') && mapping['7']) {
          scaleChoices = mapping['7'];
      } else if (chord.type.includes('min') && mapping['min']) {
          scaleChoices = mapping['min'];
      }

      // 1.5 — Smart TSD Modal Borrowing for secondary dominants.
      //
      // When a chord is a secondary dominant (V/X, V7/X, subV/X), the
      // scale choice should reflect the chord's role and the target's
      // quality, not just the chord type alone:
      //
      //   subV/X  — tritone substitution. Always Lydian Dominant /
      //             Altered regardless of target. The #11 / b13 are
      //             the substitution's defining color.
      //
      //   V/X with minor target  — Phrygian Dominant (5th mode of
      //             Harmonic Minor). The b9 / b13 give the dark
      //             "borrowed from Aeolian" flavor that resolves
      //             into a minor i / iv / vi / etc.
      //
      //   V/X with major target  — Mixolydian / Lydian Dominant.
      //             Natural 9 / natural 13. Bright "borrowed from
      //             parallel major" flavor.
      //
      // Detection: chord.roman has '/' AND source side is a dominant
      // function. Excludes 'ii/V' style "ii-V on V level" (not itself
      // dominant). Our codebase's roman never contains '/' for chord
      // inversions (those go in chordSymbol), so the gate is safe.
      if (chord.roman.includes('/')) {
          const [src, target] = chord.roman.split('/');
          if (src.startsWith('subV')) {
              // Tritone substitution — Lydian Dominant flavor regardless
              // of target. The #11 / 13 ARE the substitution's identity.
              scaleChoices = ['Lydian Dominant', 'Altered'];
          } else if (/^(V|VII)/.test(src) && target) {
              const targetIsMinor = target === target.toLowerCase()
                  || ['ii', 'iii', 'vi', 'iv'].includes(target);
              scaleChoices = targetIsMinor
                  ? ['Phrygian Dominant', 'Altered', 'Harmonic Minor']
                  : ['Mixolydian', 'Lydian Dominant'];
          }
      }

      // 2. 兜底方案：如果映射表中没有，则根据和弦性质给出基本音阶
      if (scaleChoices.length === 0) {
          if (chord.type.includes('m') && !chord.type.includes('maj')) scaleChoices = ['Dorian', 'Aeolian'];
          else if (chord.type.includes('dim') || chord.type.includes('b5')) scaleChoices = ['Locrian'];
          else if (chord.type.includes('7') && !chord.type.includes('maj')) scaleChoices = ['Mixolydian'];
          else scaleChoices = ['Ionian', 'Lydian'];
      }

      // Make sure the exotic mode is in the candidate set the scoring
      // loop will see.
      if (isExoticMode && !scaleChoices.includes(musicMode!)) {
          scaleChoices = [musicMode!, ...scaleChoices];
      }

      // Exotic-mode override: force the resolved mode as the scale and
      // root it on the global key (not the chord root) so the colour
      // persists across the progression. Mixolydian rebuilt on the V
      // chord of a C song would collapse back to C major otherwise,
      // and the exotic flavour would disappear. Per-chord re-rooting
      // is preserved for the mainstream Major/Minor path.
      let forcedExoticScale: string | null = null;
      if (isExoticMode) {
          forcedExoticScale = musicMode!;
      }

      // 3. 匹配风格偏好与主调关系
      // 我们计算主调的音阶集合（通常是 Ionian）
      const keyRootMidi = noteToMidi(musicKey + "0") % 12;
      const keyScaleIntervals = SCALE_TYPES['Ionian']; 
      const keyPcs = new Set(keyScaleIntervals.map(i => (keyRootMidi + i) % 12));

      // 评分系统：优先选择 1.风格偏好中有的 2.与主调重合音符多的
      let bestScale = scaleChoices[0];
      let maxScore = -1;

      scaleChoices.forEach(scaleName => {
          let score = 0;
          // 风格偏好加成
          if (preferences.includes(scaleName)) score += 5;

          // 主调兼容性评估
          const scaleIntervals = SCALE_TYPES[scaleName] || SCALE_TYPES['Ionian'];
          const chordRootMidi = chord.rootMidi % 12;
          const scalePcs = scaleIntervals.map(i => (chordRootMidi + i) % 12);
          const coincidence = scalePcs.filter(pc => keyPcs.has(pc)).length;
          score += coincidence; // 重合音符越多得分越高

          if (score > maxScore) {
              maxScore = score;
              bestScale = scaleName;
          }
      });

      // Honour the exotic-mode override even if the scoring loop above
      // picked something else (it can lose to scales with stronger keyPcs
      // overlap, e.g. Aeolian beating Mixolydian on a vi chord).
      const effectiveScale = forcedExoticScale ?? bestScale;
      const finalScaleIntervals = SCALE_TYPES[effectiveScale] || SCALE_TYPES['Ionian'];

      // 返回所有可用MIDI音符（供旋律生成使用）
      // 特殊情况：对于Blues等风格，如果是Blues/Pentatonic音阶，应该以全局主调为根音构建，而不是随和弦根音移动
      let rootM = chord.rootMidi;
      if (style === 'BLUES' && (effectiveScale === 'Blues' || effectiveScale === 'Major Blues' || effectiveScale === 'Minor Pentatonic' || effectiveScale === 'Major Pentatonic')) {
          rootM = noteToMidi(musicKey + "3"); // Use octave 3 to match chord.rootMidi range (48 is C3)
      } else if (forcedExoticScale) {
          // Anchor the exotic scale on the global key so the mode's
          // characteristic notes persist across all chord changes.
          rootM = noteToMidi(musicKey + "3");
      }
      
      const midiScale: number[] = [];
      const pcs = new Set(finalScaleIntervals.map(i => (rootM + i) % 12));
      
      // We want the scale centered around the chord root, providing a few octaves
      for (let oct = -2; oct <= 3; oct++) {
          finalScaleIntervals.forEach(interval => {
              midiScale.push(rootM + (oct * 12) + interval);
          });
      }
      return midiScale.sort((a,b) => a-b);
  }

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

      // Color-extension emit count for THIS bar — read by the
      // color-density-cap hard filter. Incremented after each push
      // when the emitted pc maps to chord 9/11/13. Reset implicitly
      // by being a closure local (re-init on every generateBarPattern
      // call). Per-bar scope matches the listener's "within this bar
      // I've heard too much color, give me a chord tone" perception.
      let barColorEmitCount = 0;

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
      let runScale = this.getScaleForStyle(style, chord, func, musicKey, musicMode);
      // Tonicization Planner override. When the harmony layer pinned
      // an explicit scale onto this chord (V/MajorTarget → Mixolydian,
      // V/MinorTarget → Phrygian Dominant, subV → Lydian Dominant),
      // rebuild runScale from that scale rooted on the chord — this
      // ensures both the candidate pool (in-scale tones) and the
      // evaluator's scaleNameForBar reflect the borrowed key, not
      // the song's default mode.
      const _forcedScaleName = chord.forcedScale;
      if (_forcedScaleName && SCALE_TYPES[_forcedScaleName]) {
          const _rootPc = ((chord.rootMidi % 12) + 12) % 12;
          const _ivs = SCALE_TYPES[_forcedScaleName];
          const _scale: number[] = [];
          for (let oct = 3; oct <= 6; oct++) {
              for (const iv of _ivs) {
                  _scale.push((oct + 1) * 12 + ((_rootPc + iv) % 12));
              }
          }
          _scale.sort((a, b) => a - b);
          runScale = _scale;
      }
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
      // Honor Planner-pinned forcedScale before the runScale-reverse-
      // engineer block below tries to detect a name from pcs.
      if (_forcedScaleName && SCALE_TYPES[_forcedScaleName]) {
          scaleNameForBar = _forcedScaleName;
          scaleRootPcForBar = ((chord.rootMidi % 12) + 12) % 12;
      }
      {
          const keyRootPcLocal = (((rootKeyMidi % 12) + 12) % 12);
          const chordRootPcLocal = (((chord.rootMidi % 12) + 12) % 12);
          // Reverse-engineer scaleNameForBar from runScale PCs — skipped
          // when forcedScale has already pinned the name above.
          if (scaleNameForBar === null) {
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
          }  // close: if (scaleNameForBar === null)
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
      // Chord-slot duration clip. Motif notes whose onset lands past
      // chord.duration must be discarded — they would otherwise emit
      // into the NEXT chord's time region with this chord's
      // pitch/role context. Also clamp each surviving note's d so it
      // doesn't bleed past the slot's tail.
      //
      // Fires unconditionally because multi-bar bricks (Sad-Cadence
      // etc.) cache a full multi-bar lick on the block's first bar.
      // Without clipping at the first bar, that bar emits the entire
      // multi-bar lick onto its own chord; later bars then ALSO emit
      // their slice on the correct chord, producing duplicate emits
      // at the same absolute times with different pitches.
      mutatedMotif = mutatedMotif
          .filter(m => m.t < chord.duration - 0.001)
          .map(m => ({ ...m, d: Math.min(m.d, chord.duration - m.t) }));

      // Per-bar lick rhythmic-idiom classification — for swing decision.
      //
      // Issue: when isShuffle (jazz / blues shuffle), texture's straight
      // 8ths get pushed to ~0.66 (swing eighths). Lick notes used to
      // bypass swing entirely (Phase 9 — avoid colliding swung 0.5 with
      // authored triplet at 0.67), but that left lick 8ths at 0.5 while
      // texture at 0.66 — audibly out of pocket.
      //
      // Resolution: classify the bar's lick by rhythmic idiom:
      //   - "triplet" — any note's t lands on a triplet position
      //     (fraction ≈ 0.33 or 0.67). The lick author wrote explicit
      //     triplet figures; we MUST preserve those positions verbatim.
      //     Straight 8ths in the same lick also stay verbatim (avoiding
      //     swing-into-triplet collision).
      //   - "straight" — only straight-grid positions (0, 0.25, 0.5,
      //     0.75). Safe to apply swing — 0.5 → 0.66 grooves with the
      //     swung texture.
      //
      // Per-lick (not per-note) decision = lick author's rhythmic
      // intent is unified across the phrase. Cheap one-pass scan.
      const isLickBar = mutatedMotif.some((m: any) => !!m.degreeLabel);
      let lickIsTripletIdiom = false;
      if (isLickBar) {
          for (const m of mutatedMotif as any[]) {
              const frac = m.t - Math.floor(m.t);
              if (Math.abs(frac - 0.333) < 0.05 || Math.abs(frac - 0.667) < 0.05) {
                  lickIsTripletIdiom = true;
                  break;
              }
          }
      }
      // When swing applies to lick notes: !triplet-idiom AND degreeLabel.
      const swingLickNote = (m: { degreeLabel?: string; t: number }): boolean =>
          !!m.degreeLabel && !lickIsTripletIdiom;

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
      const melodyBlueprint: NoteEvent[] = mutatedMotif.map((m: { t: number; d: number; degreeLabel?: string }) => ({
          noteNumber: -999,
          // Triplet-idiom lick notes preserve authored time (no swing
          // could shift their position without breaking triplet figures).
          // Straight-idiom lick notes AND non-lick notes go through
          // applySwing so they groove with the swung texture.
          time: startBeat + ((m.degreeLabel && lickIsTripletIdiom) ? m.t : this.applySwing(m.t, isShuffle)),
          duration: m.d,
          velocity: 100,
          part: 'melody' as const,
      }));
      // Per-bar comping mode — Impro-Visor's "dense lick → shell comp"
      // principle. When the lick is busy (≥ 8 attacks or covers most
      // of the bar), thin the accompaniment so the listener can hear
      // the lick without harmonic mush. The texture data itself is
      // NOT modified — only the density parameter passed in is reduced,
      // which makes the renderer pick its sparser internal variants.
      //
      // Decision thresholds (per user direction):
      //   ≥ 8 attacks    → bass_plus_shell (density × 0.30)
      //   ≥ 5 attacks    → shell_only       (density × 0.65)
      //   occupied ≥ 2.5 → answer_only      (density × 0.40)
      //   otherwise      → full_voicing     (density × 1.00)
      const _barLickContract = buildBarLickContract(mutatedMotif as any, chord.duration);
      const _compingMode: CompingMode = decideCompingModeForLick(_barLickContract);
      const _densityForBar = density * densityMultiplierForCompingMode(_compingMode);
      const _rawTextureEvents = this.applyTexture(chord, textureType, startBeat, chord.duration, melodyBlueprint, isShuffle, accentMode, _densityForBar, nextChord);

      // ArrangementContract per bar — couples lick and texture decisions.
      // Texture data ITSELF stays unchanged (texture pool / patterns
      // intact); the contract filters chord events post-render based on
      // comping mode + lick attack overlap + m2 prevention. Preserves
      // rich voicing on sparse-lick bars; thins to guide tones on dense.
      //
      // Project each lick note's MIDI for the m2-clash detector. Use
      // chord.rootMidi + offset (one-step projection, matches what the
      // lick will actually emit before any post-projection adjustments).
      const _lickProjectedMidis = (mutatedMotif as any[]).map((m: any) => {
        const offset = effectiveChromaticOffset(m, chord.type);
        let mid = chord.rootMidi + offset;
        while (mid > MELODY_RANGE.HIGH) mid -= 12;
        while (mid < MELODY_RANGE.LOW) mid += 12;
        return { t: m.t, midi: mid };
      });
      const _arrangementContract = buildArrangementContract({
        barIdx: barIndex,
        startBeat,
        chord,
        lickNotes: mutatedMotif as any,
        lickProjectedMidis: _lickProjectedMidis,
        voicingMidis: chord.notesMidi ?? chord.notes.map((n: string) => noteToMidi(n)),
        style,
        songFeel: 'swing_8',
      });
      const textureEvents = applyCompingModeToTextureEvents(_rawTextureEvents, _arrangementContract);
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
      const firstChromaOffset = firstNote && ('chromaticOffset' in firstNote || 'degreeLabel' in firstNote)
          ? effectiveChromaticOffset(firstNote, chord.type)
          : 0;
      const firstIsDiatonic = firstNote ? 'diatonicStep' in firstNote : true;

      // Phase 4.6 — chord-relative chromatic motifs (BillEvans/Lovano
      // licks) carry `degreeLabel`. Their chromaticOffset is semitones
      // FROM CHORD ROOT, not from runScale[k]. The anchor scorer's
      // legacy `runScale[k] + offset` formula transposes the lick away
      // from chord-relative (= changing pitch class) and the resulting
      // anchor is wrong. Force chord-root projection: pitch class is
      // chord.rootMidi + offset, with k only affecting octave choice.
      const firstHasDegreeLabel = !!(firstNote && firstNote.degreeLabel);
      const projectFirstMidi = (k: number): number => {
          if (firstHasDegreeLabel) {
              // Anchor at chord root in different octaves via k offset.
              // k=0 → root in middle octave; k=runScale.length-1 → root
              // higher octave. The Universal range clamp + scoring
              // pick the audible octave.
              const targetIdx = k;
              const rsLen = runScale.length;
              const octs = Math.floor(targetIdx / rsLen);
              const chordRootInRange = chord.rootMidi + (octs * 12);
              return chordRootInRange + firstChromaOffset;
          }
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
      // Phase 6 — Cross-bar stepwise walk (Method 2 bridge fill) REMOVED.
      // (Engine used to fill the gap between previous bar's last note
      // and current bar's first note with 1-3 stepwise scale tones when
      // gap ≥ 0.5 + leap ≥ 4 semis. Impro-Visor licks span their own
      // natural connection across bar boundaries; engine bridge no
      // longer needed.)

      mutatedMotif.forEach((m: any, idx) => {
          // Swing decision (per-lick, lifted above):
          //   triplet-idiom lick    → bypass (preserve authored triplets)
          //   straight-idiom lick   → applySwing (8ths groove with texture)
          //   non-lick motif        → applySwing
          const swTime = (m.degreeLabel && lickIsTripletIdiom)
              ? m.t
              : this.applySwing(m.t, isShuffle);
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
              // Lick notes (degreeLabel present) project directly from
              // chord.rootMidi — one-step (chord root + degree → MIDI).
              // The runScale-aware rootMidiForProjection is for non-lick
              // motifs whose degree-from-chord-root must align with the
              // running scale; for licks, the author wrote chord-relative
              // pitches and the scale is irrelevant. In BLUES the
              // song-key-rooted runScale frequently omits the IV/V chord's
              // root (e.g. F not in a C-rooted blues scale), so falling
              // back to anchor pc here destroys the lick's chord-relative
              // projection.
              const projRoot = m.degreeLabel ? chord.rootMidi : rootMidiForProjection;
              const literalMidi = projRoot + effectiveChromaticOffset(m, chord.type);
              const litPc = (((literalMidi % 12) + 12) % 12);
              const litIntervalFromChord = (((litPc - chordRootPc) % 12) + 12) % 12;
              const inScale = runScale.some(sm => (((sm % 12) + 12) % 12) === litPc);
              const isAvoid = isAvoidNote(litIntervalFromChord, chord.type, scaleNameForBar || undefined, isModalEnv, func);
              // bypassSnap 通行证 — 当 motif 数据明确标记 m.bypassSnap
              // (via "!" suffix in defineMotif or rule-level
              // bypassStructuralSnap), 跳过结构位 out-of-scale / avoid
              // 强制 snap. 用户对 #11 / b9 / etc. 色彩的明确保留意图
              // 优先于引擎的"绝对优先 contract"约束.
              //
              // Phase 12 — Impro-Visor lick notes (degreeLabel present)
              // ALSO bypass this snap. The lick author wrote the explicit
              // degree (e.g. "7" = maj7 of Dm = chromatic C# extension);
              // snapping to nearest in-scale tone would rewrite it to
              // "b7" (= C = scale 7th of Dorian). This was the residual
              // pitch modification source after Phase 8 — selectBestMidi
              // short-circuit only fires AFTER this snap, so the snap
              // had already changed mNoteMidi.
              if (isStructuralNote && !m.bypassSnap && !m.degreeLabel && (isAvoid || !inScale)) {
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
          // Phase 6 — sacred extended to ALL Impro-Visor lick notes,
          // not just role==='motif' bars. When a note carries a
          // degreeLabel (= came from BillEvans/Lovano/Heath/Perry
          // grammar), the lick author chose the pitch deliberately;
          // hard filters gated on !isMotifSacred (no-same-pc-repeat,
          // saturation-resolve, leap-octave-cap, etc.) must yield —
          // otherwise a develop-role bar containing lick notes still
          // gets pitch-rewritten by safety filters originally tuned
          // for engine-generated develop variants.
          const motifSacred = role === 'motif' || !!m.degreeLabel;

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
                  // Phase 4.6 — Impro-Visor lick bypass: notes carrying a
                  // degreeLabel originated from BillEvans/Lovano/Heath/
                  // Perry grammar. The lick author already wrote the
                  // chord-relative pitch sequence, including its color
                  // tones and avoid-note handling. Force bypassSnap so
                  // the no-avoid + in-chord-contract hard filters don't
                  // rewrite the pitch (= color magnetism off for licks).
                  bypassSnap: !!m.bypassSnap || !!m.degreeLabel,
                  isModalContext: isModalEnv,
                  scaleNameForBar: scaleNameForBar || undefined,
                  style,
                  noteDuration: m.d,
                  barColorEmitCount,
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
                    // Phase 7 — bypass on Impro-Visor lick notes
                    // (bypassSnap = true for any note carrying
                    // degreeLabel). The lick author chose the pitch
                    // sequence deliberately, including any "unresolved
                    // tension" hangs — those are intentional color, not
                    // engine bugs. Layer 3 tendency-table evaluator
                    // continues to fire on legacy non-lick motifs.
                    shouldApply: (c) =>
                        !c.bypassSnap
                        && melodyState.lastEmitAssessment !== null
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
                  // Sacred motif safety threshold — even sacred motifs
                  // get this constraint when the prior leap exceeded an
                  // octave. Without it, a motif spelling [C4, C6, A6]
                  // emits a 24-semitone span then continues climbing —
                  // outside any singer's range and outside the listener's
                  // pitch-tracking comfort. Threshold 11 semis (major 7th)
                  // is the audited sweet spot: leaps of 7 / 8 / 9 / 10
                  // (5th / m6 / M6 / m7) are intentional motif gestures
                  // and stay sacred; only super-octave leaps trigger the
                  // forced reversal. Accepts opposite direction within
                  // 4 semis or zero (hold). Filter priority sits between
                  // leap-octave-cap (which already yields to sacred) and
                  // leap-recovery (which excludes sacred entirely) — runs
                  // for ALL roles including motif.
                  { name: 'motif-leap-safety',
                    shouldApply: (c) => Math.abs(c.lastLeapSemis) >= 11,
                    accept: (m, c) => {
                        const step = m - c.lastNoteMidi;
                        if (step === 0) return true;
                        const prevDir = Math.sign(c.lastLeapSemis);
                        const sameDir = Math.sign(step) === prevDir;
                        if (sameDir) return false;
                        return Math.abs(step) <= 4;
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
                  // Color tension density cap — once the bar has emitted
                  // 2 color extensions (9 / 11 / 13), the 3rd emit is
                  // forced OFF color onto chord literal pcs. Listener
                  // perception: a bar saturated with upper extensions
                  // loses its harmonic anchor — the contract chord
                  // (root / 3 / 5 / 7) must resurface before more color
                  // can land. Skips cadence position (Tier A/B/C own
                  // that landing). Skips sacred motif (motif character
                  // is preserved at non-structural positions).
                  { name: 'color-density-cap',
                    shouldApply: (c) => !c.isMotifSacred
                        && !c.isCadencePosition
                        && c.barColorEmitCount >= 2,
                    accept: (m, c) => {
                        const pc = ((m % 12) + 12) % 12;
                        // chord literal pcs always pass
                        for (const iv of c.literalIntervals) {
                            if ((c.chordRootPc + iv) % 12 === pc) return true;
                        }
                        // any non-color, non-literal pc passes too
                        // (scale tones that aren't 9/11/13 — e.g.
                        // chromatic approach to a chord tone)
                        const ivFromRoot = ((pc - c.chordRootPc + 12) % 12);
                        const isColor = ivFromRoot === 2 || ivFromRoot === 5 || ivFromRoot === 9;
                        return !isColor;
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
                        const { pcA } = this.findClosestCrossChordPair(c.chord, c.nextChord!, projPc);
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
                        const { pcB } = this.findClosestCrossChordPair(c.prevChord!, c.chord, prevPc);
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
          // Phase 8 — Texture-melody collision rule skips for lick.
          // (motifSacred is true for lick notes after Phase 6, so this
          // gate already catches them, but keep the explicit !bypassSnap
          // check for clarity — lick author chose the pitch; collision
          // resolution is the old engine's safety net for develop notes.)
          if (!resolved && !motifSacred && !m.degreeLabel) {
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
              // Phase 4.6 — when the motif's last note came from an
              // Impro-Visor lick (degreeLabel present), the lick AUTHOR
              // has already written the cadence resolution into the
              // pitch sequence (BillEvans's Sad-Cadence lands on
              // 1/b3/5 by design). Skip Tier B/C rewriting — let the
              // author's choice come through. Tier A (global song end)
              // STILL fires: even with a lick, the absolute end of the
              // song must close on the key tonic per the architectural
              // priority "return-to-stable is highest".
              const isLickNote = !!(m && m.degreeLabel);
              // Phase 8 — Cadence Resolution ALL tiers skip on lick.
              // (Was: only Tier B/C skipped, Tier A still fired for
              // global song end. Now lick author owns its ending too —
              // full abandonment of old melody engine on lick.)
              const skipCadence = isLickNote;
              if (tier !== 'none' && !skipCadence) {
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
              // Mirror the per-bar swing decision (triplet-idiom lick =
              // bypass; everything else = applySwing) so prev time
              // reflects what was emitted upstream.
              const prevNote = mutatedMotif[idx-1];
              const lastSwTime = (prevNote.degreeLabel && lickIsTripletIdiom)
                  ? prevNote.t
                  : this.applySwing(prevNote.t, isShuffle);
              lastAbsTime = startBeat + lastSwTime;
              timeDiff = absTime - lastAbsTime;
              pitchDiff = mNoteMidi - lastNoteMidi;
              absPitchDiff = Math.abs(pitchDiff);
          }

          // Phase 6 — In-bar passing tone insertion REMOVED.
          // (Engine used to fill 1-beat gaps + 3-7 semi leaps with a
          // 16th scale step. Now Impro-Visor licks carry their own
          // passing tones; engine-side decoration removed.)
          //
          // Phase 6 — Grace note insertion REMOVED.
          // (Engine used to add a 0.05-beat chromatic neighbor before
          // 3-5 semi leaps with 25% probability. Lick authors write
          // grace notes in the lick itself; engine-side removed.)

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

          // Inter-bar leap dampening for the FIRST note of a new bar
          // (idx === 0). When the lick's first projected MIDI sits more
          // than an octave away from the previous bar's last emit, try
          // ±12 octave shifts and pick whichever lands closest. Preserves
          // PC (octave shift = same pitch class) while smoothing the
          // jump from prev bar's tail to this bar's head. Only fires on
          // lick notes (degreeLabel) — non-lick motifs already use the
          // contour-aware anchor scoring upstream.
          if (idx === 0 && m.degreeLabel && melodyState.lastEmitMidi > 0) {
              const prevMidi = melodyState.lastEmitMidi;
              const voicingMidis0 = chord.notesMidi ?? chord.notes.map(n => noteToMidi(n));
              const formsM9here = (mid: number) =>
                  voicingMidis0.some(v => mid - v === 13 || mid - v === -13);
              // Pick the best octave for the bar's first lick note:
              //   minimize leap to prev emit, AND avoid m9 clash with
              //   the underlying voicing. m9 weighs heavier (999) than
              //   leap so an m9-safe larger leap beats an m9-clashing
              //   smaller leap. Searches ±24 (= 2 octaves either way)
              //   because some chord voicings span enough range that
              //   ±12 alone may not escape the clash.
              const candidates = [
                  mNoteMidi - 24, mNoteMidi - 12, mNoteMidi,
                  mNoteMidi + 12, mNoteMidi + 24,
              ];
              let bestMidi = mNoteMidi;
              let bestScore = (formsM9here(mNoteMidi) ? 999 : 0)
                  + Math.abs(mNoteMidi - prevMidi);
              for (const cand of candidates) {
                  if (cand < MELODY_RANGE.LOW || cand > MELODY_RANGE.HIGH) continue;
                  const score = (formsM9here(cand) ? 999 : 0)
                      + Math.abs(cand - prevMidi);
                  if (score < bestScore) { bestScore = score; bestMidi = cand; }
              }
              mNoteMidi = bestMidi;
          }

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
                  if (fix !== undefined) {
                      mNoteMidi = fix;
                  }
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
              events.push({
                  noteNumber: mNoteMidi,
                  time: humanizedTime,
                  duration: m.d,
                  velocity: velocityMidi,
                  part: 'melody',
                  origin: eventOrigin,
                  lickSource: !!m.degreeLabel,
              });
              // Color-density-cap state update — count this emit when
              // its pc lands on chord 9 (interval 2) / 11 (5) / 13 (9).
              // The hard filter reads barColorEmitCount on the NEXT
              // ctx build to block a 3rd color in the same bar.
              {
                  const pcMidi = ((mNoteMidi % 12) + 12) % 12;
                  const chordRootPcLocal = ((chord.rootMidi % 12) + 12) % 12;
                  const ivFromChord = ((pcMidi - chordRootPcLocal + 12) % 12);
                  if (ivFromChord === 2 || ivFromChord === 5 || ivFromChord === 9) {
                      barColorEmitCount++;
                  }
              }
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

      // Phase 6 — Run Generator REMOVED.
      //
      // The Run Generator used to scan the bar after the per-note
      // loop, find adjacent emitted notes with (gap > 0.5..0.75 +
      // leap > 3..4), and fill the gap with up to 8 stepwise notes
      // from a style-specific palette:
      //   POP   → chord arpeggio (1-3-5-7-9, 16th)
      //   RNB   → minor pentatonic cascade (16th)
      //   BLUES → Composite Blues lick (b3/b5/b7 with naturals, 16th)
      //   JAZZ  → stepwise scale tones (8th)
      //
      // This was the biggest source of rhythmic chaos — a single
      // gap could spawn 8 inserted 16ths, carpet-bombing a sparse
      // motif into a dense run. With Impro-Visor licks, the lick
      // author wrote the bar's rhythm; engine-derived fills are
      // not needed.
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
      // Last-emitted Contract Enforcement — Run Generator and other
      // post-loop inserts (cross-bar bridge, passing tones) bypass
      // the AND pipeline; they pick scale tones for stepwise voice
      // leading without checking chord contract. When the bar's
      // LAST emitted melody event happens to be such an insert AND
      // its pc is outside chord contract (literal ∪ admissible
      // color), the audit classifies it as "passing-on-strong" since
      // last-of-bar is a structural-listening position.
      //
      // Action: scan the bar's last emitted melody event. If its pc
      // is NOT in chord contract, snap to the nearest contract pc
      // in runScale within ±3 semitones. If no contract pc reachable,
      // accept the original (rare; would require relaxing).
      //
      // Lick guard: if the bar's last emit traces back to an
      // Impro-Visor lick note (mutatedMotif entry with degreeLabel
      // at matching time), the lick author chose the landing — the
      // engine must not re-snap it. One-step projection from
      // (chord, degree) → MIDI is the final answer.
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
          if (lastEmit && !lastEmit.lickSource) {
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
      //
      // Phase 4.6 — skip ENTIRELY when the bar's motif came from an
      // Impro-Visor lick. The lick author already chose its color tone
      // landings; forcing a vacated-extension rewrite would overwrite
      // a BillEvans deliberate landing with a chord-type-defining color
      // that the lick chose NOT to play.
      const motifHasLickDegree = mutatedMotif.some((mn: any) => !!mn.degreeLabel);
      if (!motifHasLickDegree) {
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

      // Phase 6 — Cadence-tail Leading-tone (起伏 / ebb-flow) REMOVED.
      // (Engine used to append a 16th-note scale neighbor at the bar's
      // last 16th slot when the bar was phrase-end AND the last pc
      // was a chord-tone of the next chord. Impro-Visor licks write
      // their own cadence tail; engine decoration not needed.)

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
