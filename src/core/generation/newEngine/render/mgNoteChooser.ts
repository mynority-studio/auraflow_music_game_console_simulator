// ============================================================
// newEngine · render · MgNoteChooser(MG strict 移植 Loop 4)
// Provenance: ../melodygenerative/src/lib/improvisor/NoteChooser.ts 忠实港。
// 改动:import MELODY_RANGE/resolveDegree/CHORD_TYPES←knowledge/mgMusicTheory·
//       AbstractMelodyToken←knowledge/melodyGrammarTypes·ChordPitchSets←./mgPitchClassSets。
// 每 token → MIDI:IV 概率表窗口分类 + GOAL 权重 + APPROACH lookahead + slope window。
// ============================================================

// NoteChooser.ts — Per-token pitch selection.
//
// Input:
//   - One abstract token (C/S/L/A/R/X/Slope/Triadic)
//   - ChordPitchSets for the chord ACTIVE AT THE TOKEN'S BEAT
//   - Voice-leading context (prev note MIDI, register hint)
//
// Output:
//   - Single MIDI note (or null for rest)
//
// Algorithm:
//   1. Determine candidate pcs from token kind:
//      C → chordTones
//      S → scaleTones (or chordTones fallback if empty)
//      L → colorTones (or scaleTones fallback)
//      A → approachTargets (or scaleTones fallback)
//      X (degree?) → resolve degree relative to chord; fall back to root
//      Slope → driven by direction, picks any in-scale tone
//      Triadic → walks chord tones in declared direction
//      R → null
//   2. Materialize each candidate pc to the nearest MIDI in MELODY_RANGE
//      relative to prevMidi (voice leading).
//   3. Pick the candidate with highest score:
//      - voice-leading proximity (smaller leap = better)
//      - register-fit penalty when too far from comfort zone
//      - small bias toward distinct from prev pc (avoid repetition)

import { MELODY_RANGE, resolveDegree, CHORD_TYPES } from '../knowledge/mgMusicTheory';
import type { AbstractMelodyToken } from '../knowledge/melodyGrammarTypes';
import type { ChordPitchSets } from './mgPitchClassSets';

// re-export MELODY_RANGE so the file's other branches can clamp
export { MELODY_RANGE };

const pcOf = (m: number) => ((m % 12) + 12) % 12;

export interface NoteChooserContext {
  /** Current chord's pitch class sets. */
  sets: ChordPitchSets;
  /** Previously emitted melody MIDI (null at song start). */
  prevMidi: number | null;
  /** Register comfort center (preferred MIDI when prevMidi is null
   *  or unconstrained). Default ~ G4. */
  registerCenter?: number;
  /** Triadic walk state — when a Triadic token previously fired, this
   *  carries the last walked chord-tone index so successive Triadics
   *  continue the arpeggio. */
  triadicState?: { lastIdx: number; direction: 'up' | 'down' };
  /** Next non-rest, non-approach token's chosen MIDI — used by
   *  APPROACH tokens to compute true half-step approach (target ± 1).
   *  Without this, A tokens degrade to "pick any neighbor of any
   *  chord tone" and the next note doesn't actually resolve. */
  approachTargetMidi?: number;
  /** Active slope constraint (IV LickGen.java:1991+ semantics). When
   *  set, candidate MIDIs are restricted to [prevMidi + dirMin,
   *  prevMidi + dirMax]. Slope direction sign also picks approach
   *  side: upward (min ≥ 0) → approach FROM BELOW, downward (max ≤ 0)
   *  → approach FROM ABOVE. */
  slopeConstraint?: { dirMin: number; dirMax: number };
  /** Optional seeded PRNG. When provided, candidates are sampled by
   *  softmax-weighted score instead of deterministic argmax. Matches
   *  IV NoteChooser.java's probability-table approach (variety per
   *  call, still seed-deterministic). Omit to keep deterministic
   *  argmax — useful for unit tests and quick checks. */
  rng?: () => number;
  /** Softmax temperature for rng-driven sampling. Lower → more
   *  argmax-like (deterministic); higher → more uniform (IV-like
   *  randomness). Defaults to 2.0 — preserves voice-leading bias
   *  while admitting occasional non-best picks. */
  temperature?: number;
}

export interface ChoiceResult {
  /** Chosen MIDI, or null for rest. */
  midi: number | null;
  /** Updated triadic state (for chaining). */
  triadicState: NoteChooserContext['triadicState'];
}

// G4-1: IV's GOAL weight table per LickGen.java:3215-3260.
// Index = semitone interval from chord root (0..11).
//   3rd or 7th (intervals 3, 4, 10, 11) → 20
//   root or 5th (0, 7)                  → 15
//   9th or 13/6 (1, 2, 9 — diff 3 already taken by 3rd) → 7
//   11 or #11 (5, 6)                    → 5
//   b13 (8 — others already taken by earlier branches) → 3
// IV uses if/else if so first match wins; this table reflects the
// post-dedup weight per interval.
const IV_GOAL_WEIGHT_BY_INTERVAL = [
  15, // 0  root
  7,  // 1  b9
  7,  // 2  9
  20, // 3  b3 / #9 (caught by 3rd-or-7th branch)
  20, // 4  3rd
  5,  // 5  11
  5,  // 6  #11 / b5
  15, // 7  5th
  3,  // 8  b13 / #5
  7,  // 9  13 / 6
  20, // 10 b7
  20, // 11 7
];

// IV NoteChooser default probability table. Source: NoteChooser.java
// lines 61-93 (verbatim default `probString`).
// Key: `${type}|${haveChord}|${haveColor}|${haveRandom}` where type is
// 0=CHORD, 1=COLOR, 2=RANDOM, 3=SCALE. Values: 4-tuple weights for
// [chord, color, random, scale] subtype pick. Total of 100 per row.
// When a token kind asks for COLOR and chord+color are both present,
// IV gives 10% chance of picking from chord and 90% from color (= row
// "1|1|1|0"). Pure-color "L"-token in our prior impl missed this 10%
// guide-tone reinforcement.
const IV_TYPE_PROB_TABLE: Record<string, readonly [number, number, number, number]> = {
  // type=0 CHORD
  '0|1|1|1': [100, 0, 0, 0],
  '0|1|1|0': [100, 0, 0, 0],
  '0|1|0|1': [100, 0, 0, 0],
  '0|1|0|0': [100, 0, 0, 0],
  '0|0|1|1': [0, 100, 0, 0],
  '0|0|1|0': [0, 100, 0, 0],
  '0|0|0|1': [0, 0, 100, 0],
  // type=1 COLOR
  '1|1|1|1': [0, 100, 0, 0],
  '1|1|1|0': [10, 90, 0, 0],
  '1|1|0|1': [85, 0, 15, 0],
  '1|1|0|0': [100, 0, 0, 0],
  '1|0|1|1': [0, 100, 0, 0],
  '1|0|1|0': [0, 100, 0, 0],
  '1|0|0|1': [0, 0, 100, 0],
  // type=3 SCALE
  '3|1|1|1': [0, 0, 0, 100],
  '3|1|1|0': [0, 0, 0, 100],
  '3|1|0|1': [0, 0, 0, 100],
  '3|1|0|0': [0, 0, 0, 100],
  '3|0|1|1': [0, 0, 0, 100],
  '3|0|1|0': [0, 0, 0, 100],
  '3|0|0|1': [0, 0, 100, 0],
  // type=2 RANDOM
  '2|1|1|1': [50, 25, 25, 0],
  '2|1|1|0': [80, 20, 0, 0],
  '2|1|0|1': [50, 0, 50, 0],
  '2|1|0|0': [100, 0, 0, 0],
  '2|0|1|1': [0, 50, 50, 0],
  '2|0|1|0': [0, 100, 0, 0],
  '2|0|0|1': [0, 0, 100, 0],
};

type IvCategory = 'chord' | 'color' | 'random' | 'scale';

/** Token kind → IV type code, or null when kind doesn't go through the
 *  probability table (A / G / B / X with explicit degree / Slope / R /
 *  Triadic — all have dedicated handling). */
function ivTypeForKind(kind: string): number | null {
  if (kind === 'C') return 0;
  if (kind === 'L' || kind === 'H') return 1;
  if (kind === 'S') return 3;
  return null;
}

/** Pick the IV-table category for a token given which pools are
 *  available. Consumes ONE rng call when rng is provided; when rng is
 *  omitted, falls back to argmax (highest-weight category wins). */
function ivPickCategory(
  ivType: number, haveChord: boolean, haveColor: boolean, haveRandom: boolean,
  rng?: () => number,
): IvCategory {
  const key = `${ivType}|${haveChord ? 1 : 0}|${haveColor ? 1 : 0}|${haveRandom ? 1 : 0}`;
  const probs = IV_TYPE_PROB_TABLE[key];
  const cats: readonly IvCategory[] = ['chord', 'color', 'random', 'scale'];
  if (!probs) return 'chord';
  const total = probs.reduce((a, b) => a + b, 0);
  if (total === 0) return 'chord';
  if (!rng) {
    let bi = 0;
    for (let i = 1; i < 4; i++) if (probs[i] > probs[bi]) bi = i;
    return cats[bi];
  }
  let r = rng() * total;
  for (let i = 0; i < 4; i++) {
    r -= probs[i];
    if (r <= 0) return cats[i];
  }
  return cats[3];
}

/** Choose a MIDI for one abstract token. */
export function chooseNote(
  token: AbstractMelodyToken,
  ctx: NoteChooserContext,
): ChoiceResult {
  // Rests emit nothing
  if (token.kind === 'R') return { midi: null, triadicState: ctx.triadicState };

  const registerCenter = ctx.registerCenter ?? 67;  // G4

  // Triadic walk
  if (token.kind === 'Triadic') {
    return walkTriadic(token, ctx, registerCenter);
  }

  // G4-1: GOAL token uses IV's per-interval weight table over the FULL
  // chord spell, not just {3rd, 7th}. Replicates LickGen.java:3208-3260
  // where each spell pc gets a weight per its interval from root
  // (3rd/7th=20, root/5=15, 9/13=7, 11/#11=5, b13/#5=3), then weighted
  // random pick. Argmax fallback when no RNG.
  if (token.kind === 'G') {
    return chooseGoalNote(ctx, registerCenter);
  }

  // APPROACH with lookahead — IV semantics (LickGen.java:2050-2103):
  // half-step neighbor of the SUCCESSOR's actual landing pitch.
  // When slope is active, slope direction picks ±1 side; otherwise
  // voice-leading distance from prev decides.
  if (token.kind === 'A' && ctx.approachTargetMidi !== undefined) {
    const target = ctx.approachTargetMidi;
    const above = target + 1;
    const below = target - 1;
    let pick: number;
    if (ctx.slopeConstraint) {
      // Per IV: upper > 0 → approach from below (note = target - 1);
      // lower < 0 → approach from above (note = target + 1).
      const { dirMin, dirMax } = ctx.slopeConstraint;
      if (dirMax > 0 && dirMin >= 0) pick = below;       // upward slope
      else if (dirMin < 0 && dirMax <= 0) pick = above;  // downward slope
      else if (dirMin === 0 && dirMax === 0) pick = below;  // level — default
      else {
        // Bidirectional or mixed — fall back to voice-leading distance
        pick = ctx.prevMidi !== null && Math.abs(above - ctx.prevMidi) <= Math.abs(below - ctx.prevMidi)
            ? above : below;
      }
    } else if (ctx.prevMidi === null) {
      pick = below;  // default leading-tone direction
    } else {
      const aboveDist = Math.abs(above - ctx.prevMidi);
      const belowDist = Math.abs(below - ctx.prevMidi);
      pick = aboveDist <= belowDist ? above : below;
    }
    if (ctx.sets.allowChromaticRandom === false) {
      // The locked target may legitimately sit in IV's lower register
      // (54–59). Octave-wrapping only the approach turns a semitone gesture
      // into a minor ninth. Keep both notes in the same register instead.
      const IV_LOW = 54;
      const IV_HIGH = 84;
      if (pick < IV_LOW || pick > IV_HIGH) {
        const alternate = pick === above ? below : above;
        if (alternate >= IV_LOW && alternate <= IV_HIGH) pick = alternate;
      }
    } else {
      while (pick > MELODY_RANGE.HIGH) pick -= 12;
      while (pick < MELODY_RANGE.LOW) pick += 12;
    }
    return { midi: pick, triadicState: ctx.triadicState };
  }

  // C / L / S / H tokens — IV NoteChooser per-MIDI window classification.
  // Replaces the prior pc-set + score-and-pick scheme. See chooseMidiViaIvWindow.
  if (ivTypeForKind(token.kind) !== null) {
    return chooseMidiViaIvWindow(token, ctx, registerCenter);
  }

  // X / B / Slope and any other not-yet-matched kind — keep pc-based pool +
  // nearest-MIDI snap (no scoring beyond proximity).
  const cands = candidatePcs(token, ctx.sets);
  if (cands.length === 0) {
    const fallback = ctx.sets.chordTones[0] ?? 0;
    const midi = nearestMidi(fallback, ctx.prevMidi ?? registerCenter);
    return { midi, triadicState: ctx.triadicState };
  }
  // Pick a pc uniformly when rng provided, else first. Then nearest MIDI to prev.
  const pcChosen = ctx.rng ? cands[Math.floor(ctx.rng() * cands.length)] : cands[0];
  const midi = nearestMidi(pcChosen, ctx.prevMidi ?? registerCenter);
  return { midi, triadicState: ctx.triadicState };
}

/** P2 — IV NoteChooser.java getNote() per-MIDI window classification.
 *  For each MIDI in [low, high]:
 *    - classify as CHORD / COLOR / SCALE / RANDOM
 *  numTypes[] = counts per category
 *  Look up probability table, pick category, then uniform random within
 *  category's MIDI list.
 *
 *  Window source:
 *    - slope constraint present → [prev + dirMin, prev + dirMax]
 *    - else → [prev - maxInterval, prev + maxInterval]  (IV default maxInterval=9)
 *  Clamped to MELODY_RANGE.
 *
 *  IV CHORD expansion (LickGen.java:3177-3205): when token=C and no
 *  chord MIDIs in window, expand low--/high++ up to 3 times.
 *  IV SCALE pool (NoteChooser.java:168): when chosen category=SCALE,
 *  CHORD and COLOR MIDIs ALSO count as valid (scale-token is the
 *  permissive fallback). */
function chooseMidiViaIvWindow(
  token: AbstractMelodyToken,
  ctx: NoteChooserContext,
  registerCenter: number,
): ChoiceResult {
  // IV LickGen.java defaults (lines 77-84):
  //   MIN_PITCH_DEFAULT = 54  (F#3)
  //   MAX_PITCH_DEFAULT = 84  (C6)
  //   MAX_INTERVAL_DEFAULT = 9
  // Our project-wide MELODY_RANGE (musicTheory.ts) is [60, 86] for the
  // pop/jazz vocal range, but IV's algorithm assumes a wider floor —
  // prev=60 with our floor=60 would clip the bottom half of the window
  // and produce upward-only chord-tone pools. Use IV's defaults here
  // for full-window-faithful behavior.
  const IV_MAX_INTERVAL = 9;
  const minPitch = 54;
  const maxPitch = 84;
  const prev = ctx.prevMidi ?? registerCenter;

  // Window
  let low: number, high: number;
  if (ctx.slopeConstraint) {
    low = prev + ctx.slopeConstraint.dirMin;
    high = prev + ctx.slopeConstraint.dirMax;
  } else {
    low = prev - IV_MAX_INTERVAL;
    high = prev + IV_MAX_INTERVAL;
  }

  // IV LickGen.java:3124-3130 — MIN_JUMP_UPPER_BOUND (=6) relaxation.
  // Slope rules can force a window entirely on one side of prev (e.g.
  // dirMin=+8, dirMax=+12 → low forces a leap of at least 8 semis).
  // IV softens this by pulling the forced edge halfway back toward
  // prev (low -= 3 when low forces ≥ 6 upward; high += 3 when high
  // forces ≥ 6 downward), keeping voice leading singable without
  // breaking the slope's direction.
  const MIN_JUMP_UPPER_BOUND = 6;
  if (low - prev >= MIN_JUMP_UPPER_BOUND) low -= MIN_JUMP_UPPER_BOUND / 2;
  if (high - prev <= -MIN_JUMP_UPPER_BOUND) high += MIN_JUMP_UPPER_BOUND / 2;

  low = Math.max(low, minPitch);
  high = Math.min(high, maxPitch);

  // IV LickGen.java:3106-3110 — relax low==high so picker has at least 2 MIDIs
  if (low === high) {
    if (low !== prev + 1) low -= 1;
    if (high !== prev - 1) high += 1;
    low = Math.max(low, minPitch);
    high = Math.min(high, maxPitch);
  }
  if (low > high) low = high;

  // Build per-MIDI classification
  const chord = new Set(ctx.sets.chordTones);
  const color = new Set(ctx.sets.colorTones);
  const scale = new Set(ctx.sets.scaleTones);

  type IvCat = 'chord' | 'color' | 'scale' | 'random';
  const classify = (midi: number): IvCat => {
    const pc = pcOf(midi);
    if (chord.has(pc)) return 'chord';
    if (color.has(pc)) return 'color';
    if (scale.has(pc)) return 'scale';
    return 'random';
  };

  let byCat: Record<IvCat, number[]>;
  const buildByCat = (lo: number, hi: number): Record<IvCat, number[]> => {
    const r: Record<IvCat, number[]> = { chord: [], color: [], scale: [], random: [] };
    for (let m = lo; m <= hi; m++) r[classify(m)].push(m);
    return r;
  };
  byCat = buildByCat(low, high);

  // IV CHORD expansion: if token=C and zero chord MIDIs, expand up to 3×
  if (token.kind === 'C') {
    let exp = 0;
    while (byCat.chord.length === 0 && exp < 3) {
      low = Math.max(low - 1, minPitch);
      high = Math.min(high + 1, maxPitch);
      byCat = buildByCat(low, high);
      exp++;
    }
  }

  // IV probability table → category
  const ivType = ivTypeForKind(token.kind)!;
  const haveChord = byCat.chord.length > 0;
  const haveColor = byCat.color.length > 0;
  const haveRandom = ctx.sets.allowChromaticRandom !== false && byCat.random.length > 0;
  const cat = ivPickCategory(ivType, haveChord, haveColor, haveRandom, ctx.rng);

  // IV SCALE permissive pool — when picking SCALE, chord + color MIDIs are
  // also eligible (NoteChooser.java:168 `newType == 3 && (... == CHORD || ... == COLOR)`).
  let pool: number[];
  if (cat === 'scale') {
    pool = [...byCat.scale, ...byCat.chord, ...byCat.color];
  } else {
    pool = byCat[cat];
  }

  // Fallback chain if chosen category's pool is empty
  if (pool.length === 0) {
    const fallbackCategories: IvCat[] = ctx.sets.allowChromaticRandom === false
      ? ['chord', 'color', 'scale']
      : ['chord', 'color', 'scale', 'random'];
    for (const c of fallbackCategories) {
      if (byCat[c].length > 0) { pool = byCat[c]; break; }
    }
  }

  if (pool.length === 0) {
    // Window has no notes at all — emit chord root nearest to prev
    const fallback = ctx.sets.chordTones[0] ?? ctx.sets.rootPc;
    const midi = nearestMidi(fallback, prev);
    return { midi, triadicState: ctx.triadicState };
  }

  // IV: uniform random within pool. Argmax / first when no rng.
  const idx = ctx.rng ? Math.floor(ctx.rng() * pool.length) : 0;
  return { midi: pool[idx], triadicState: ctx.triadicState };
}

/** G4-1 implementation: IV LickGen.java:3215-3260 weighted goal-note
 *  selection. Walks chord.getSpell() (= our sets.chordTones), assigns
 *  weight per interval-from-root via IV_GOAL_WEIGHT_BY_INTERVAL,
 *  weighted-random samples, then octave-shifts within ±6 semis of prev
 *  (matching IV's `while (Math.abs(finalPitch - oldPitch) > 6)`). */
function chooseGoalNote(ctx: NoteChooserContext, registerCenter: number): ChoiceResult {
  const spell = ctx.sets.chordTones;  // vocab.spell, transposed
  if (spell.length === 0) {
    const midi = nearestMidi(ctx.sets.rootPc, ctx.prevMidi ?? registerCenter);
    return { midi, triadicState: ctx.triadicState };
  }
  // Build (pc, weight) list per IV's table.
  const pcs: number[] = [];
  const weights: number[] = [];
  let totalW = 0;
  for (const pc of spell) {
    const interval = (((pc - ctx.sets.rootPc) % 12) + 12) % 12;
    const w = IV_GOAL_WEIGHT_BY_INTERVAL[interval];
    pcs.push(pc);
    weights.push(w);
    totalW += w;
  }
  // Pick pc — weighted sample if rng provided, else argmax.
  let chosenPc: number;
  if (ctx.rng && totalW > 0) {
    let r = ctx.rng() * totalW;
    chosenPc = pcs[pcs.length - 1];
    for (let i = 0; i < pcs.length; i++) {
      r -= weights[i];
      if (r <= 0) { chosenPc = pcs[i]; break; }
    }
  } else {
    let bestIdx = 0;
    for (let i = 1; i < weights.length; i++) {
      if (weights[i] > weights[bestIdx]) bestIdx = i;
    }
    chosenPc = pcs[bestIdx];
  }
  // Materialize to nearest MIDI, then enforce IV's ±6-semitone rule
  // from prev (octave-shift to stay close). Per LickGen.java:3251.
  const ref = ctx.prevMidi ?? registerCenter;
  let midi = nearestMidi(chosenPc, ref);
  // IV loop: while diff > 6, shift +12. We use ±12 toward prev.
  while (ctx.prevMidi !== null && Math.abs(midi - ctx.prevMidi) > 6) {
    if (midi < ctx.prevMidi) midi += 12;
    else midi -= 12;
    if (midi < MELODY_RANGE.LOW || midi > MELODY_RANGE.HIGH) {
      // Shifted out of range — revert and accept the original distance.
      midi = nearestMidi(chosenPc, ref);
      break;
    }
  }
  return { midi, triadicState: ctx.triadicState };
}

function candidatePcs(token: AbstractMelodyToken, sets: ChordPitchSets): number[] {
  const strictLocal = sets.allowChromaticRandom === false;
  const admittedLocal = [...new Set([
    ...sets.chordTones,
    ...sets.colorTones,
    ...sets.scaleTones,
  ])];
  // Fallback for non-ivType kinds (A / X / G / B / Slope / R / Triadic).
  // C / L / S / H route through chooseMidiViaIvWindow upstream.
  switch (token.kind) {
    case 'A':
      // Without the immediately-next target locked by the Realizer this is
      // not a complete approach gesture. LOFI falls back to an admitted
      // local tone rather than leaving a chromatic note unresolved.
      return strictLocal
        ? admittedLocal
        : (sets.approachTargets.length > 0 ? sets.approachTargets : sets.scaleTones);
    case 'X': {
      if (token.degree !== undefined) {
        // X(degree) — chord-family-aware degree resolution per IV
        // makeRelativeNote (LickGen.java:2596). Vocab-faithful: emit
        // the resolved pc as-is, no avoid snap.
        const offset = resolveDegree(String(token.degree), sets.chordType);
        const pc = ((sets.rootPc + offset) % 12 + 12) % 12;
        if (!strictLocal || admittedLocal.includes(pc)) return [pc];
        return admittedLocal.slice().sort((a, b) => {
          const distanceA = Math.min((a - pc + 12) % 12, (pc - a + 12) % 12);
          const distanceB = Math.min((b - pc + 12) % 12, (pc - b + 12) % 12);
          return distanceA - distanceB || a - b;
        }).slice(0, 1);
      }
      return [...sets.chordTones, ...sets.scaleTones];
    }
    case 'G': {
      // Goal — jazz guide tones (3rd + 7th). Computed from CHORD_TYPES
      // intervals at positions [1] and [3]: position 1 is the 3rd (or
      // the sus 4 for sus chords), position 3 is the 7th. Triads
      // without a 7th degrade to {3rd}.
      const ivs = CHORD_TYPES[sets.chordType];
      if (ivs && ivs.length >= 2) {
        const guide: number[] = [(sets.rootPc + ivs[1]) % 12];
        if (ivs.length >= 4) guide.push((sets.rootPc + ivs[3]) % 12);
        return guide;
      }
      return sets.chordTones;
    }
    case 'B': {
      // Bass — actual sounding bass pc. Falls back to rootPc when
      // bassPc is undefined (defensive — should always be set via
      // ChordBlock plumbing). EXCEEDS IV: IV's makeBassNote at
      // LickGen.java:3063 uses chord root and has a `// FIX!` TODO
      // acknowledging the omission. We thread the real bass through
      // ChordBlock → ChordPitchSets so B over G7/D plays D, over F/G
      // plays G, over a pedal-on-C section plays C.
      return [sets.bassPc ?? sets.rootPc];
    }
    case 'Slope': {
      // Slope is a direction hint; pick from chord + scale combined.
      return [...sets.chordTones, ...sets.scaleTones];
    }
    case 'R':
    case 'Triadic':
      return [];
  }
}

function nearestMidi(pc: number, refMidi: number): number {
  // Find MIDI with this pc nearest refMidi, in MELODY_RANGE.
  const refOct = Math.floor(refMidi / 12);
  let best = pc + (refOct - 1) * 12;
  let bestDist = Math.abs(best - refMidi);
  for (let oct = refOct - 2; oct <= refOct + 2; oct++) {
    const m = pc + oct * 12;
    if (m < MELODY_RANGE.LOW || m > MELODY_RANGE.HIGH) continue;
    const d = Math.abs(m - refMidi);
    if (d < bestDist) { bestDist = d; best = m; }
  }
  // Clamp to range
  while (best > MELODY_RANGE.HIGH) best -= 12;
  while (best < MELODY_RANGE.LOW) best += 12;
  return best;
}

function walkTriadic(
  token: { kind: 'Triadic'; direction: 'up' | 'down'; duration: number },
  ctx: NoteChooserContext,
  registerCenter: number,
): ChoiceResult {
  const tones = ctx.sets.chordTones;
  if (tones.length === 0) {
    return { midi: ctx.prevMidi ?? registerCenter, triadicState: ctx.triadicState };
  }
  // Continue prior triadic walk if same direction; else start fresh.
  let idx: number;
  if (ctx.triadicState && ctx.triadicState.direction === token.direction) {
    idx = ctx.triadicState.lastIdx + (token.direction === 'up' ? 1 : -1);
  } else {
    // Start: pick nearest tone to prev
    if (ctx.prevMidi !== null) {
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < tones.length; i++) {
        const m = nearestMidi(tones[i], ctx.prevMidi);
        const d = Math.abs(m - ctx.prevMidi);
        if (d < bestDist) { bestDist = d; best = i; }
      }
      idx = best;
    } else {
      idx = 0;
    }
  }
  // Wrap around modulo tones.length
  const wrappedIdx = ((idx % tones.length) + tones.length) % tones.length;
  const pc = tones[wrappedIdx];
  const midi = nearestMidi(pc, ctx.prevMidi ?? registerCenter);
  return { midi, triadicState: { lastIdx: wrappedIdx, direction: token.direction } };
}

// Re-export for convenience
export { pcOf };
