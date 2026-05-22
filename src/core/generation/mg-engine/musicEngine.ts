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

// Phase 6.6:Engine class 已删,musicEngine.ts 仅保留 Random + types + 常量 +
// 纯 helper 函数(spell/midi 系列)。算法 100% 在 engine-utils.ts。
import type { StyleName } from '../af2-engine/data/styleDictionary';
import type {
    MeterContext, PhraseSegment, PhraseRole, TensionState, Emotion,
} from '../af2-engine/music-theory';

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
  part: 'melody' | 'accomp' | 'bass';
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

