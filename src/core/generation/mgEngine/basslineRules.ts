// ==========================================
// basslineRules.ts — bass-anchor selection per chord, named.
//
// Each rule produces ONE bass MIDI note for the active chord. The
// rhythm/pattern (block / walking / boom-chuck / ...) is handled
// downstream by applyTexture; rules here only choose the anchor pitch.
//
// COMMON_TECHNIQUES.basslines in styleDictionary.ts re-exports these
// names so style profiles can reference them via basslineRules =
// [{ ref, weight }, ...]. The engine picks one rule per song using a
// seed-derived weighted draw and applies it consistently across the
// whole progression.
// ==========================================

export interface BasslineContext {
  // Pitch class of the chord root (0-11). Used for "relative pc"
  // calculations like "fifth of chord" or "sixth of chord".
  chordRootPc: number;
  /**
   * G5: Pitch class where bass anchors (0-11). Same as chordRootPc
   * when bassRole='root' (default), otherwise the resolved interval
   * pc (3rd / 5th / 7th / pedal). Rules use this for "where the bass
   * line PLAYS" while keeping chordRootPc for chord-relative math.
   */
  bassAnchorPc: number;
  // All chord pitch classes (root plus interval set). Lets rules pick
  // non-root chord tones (e.g. fifth) when stylistically appropriate.
  pitchClasses: number[];
  // The previous bar's bass MIDI, or null for the very first chord.
  prevBassMidi: number | null;
  // True when the prior chord was a dominant resolving to tonic. Pops
  // a strict-cadence flag for rules that want to enforce root.
  isCadenceToTonic: boolean;
  // True when this is the song's final chord. Bass rules MUST anchor
  // on the root for the last bar so the song closes in root position
  // (Solid state under Divisi 2.0). Walking / inverting rules that
  // would otherwise leave the bass on 3rd / 5th / b7 are overridden.
  isLast: boolean;
  // 0-based chord index in the song (handy for alternating-bar rules).
  barIndex: number;
  // For rules that need stochastic choices (e.g. random octave nudges).
  random: { next(): number };
}

export type BasslineRuleFn = (ctx: BasslineContext) => number;

// =====================================================================
// Bass pattern rule — bar-internal rhythmic line (老师 4 选项).
// Returns an array of (time-in-bar, midi, duration) events that
// constitute the bar's full bass line — boogie root-5-6-5, stride
// low-high alternating, dilla pocket micro-shift, etc.
// Distinct from BasslineRuleFn (anchor-only). When a style sets
// bassPattern, realizeProgression calls a pattern rule and stores
// the event list on chord.bassPattern; applyTexture's bass output is
// then replaced by these events for that bar.
// Velocity is stored absolute 0-127 — pattern rule decides accents
// inline (boogie typically beat 1 stronger; stride beat 1+3 lower
// stronger, beat 2+4 higher softer).
// =====================================================================

export interface BassPatternEvent {
  time: number;     // beat offset within the bar (0 ≤ time < 4)
  midi: number;     // pitch (clamped to BASS_LOW..BASS_HIGH)
  duration: number; // beats
  velocity: number; // 0..127 absolute
}

export interface BassPatternContext {
  chordRootPc: number;
  // Actual sounding bass pc — sourced from chord.bassRole via the Bass
  // Planner (resolveBassAnchorPc). When the chord is in root position
  // bassPc === chordRootPc; for an intentional inversion (bassRole:
  // '3rd' / '5th' / '7th' / 'pedal') bassPc is the inverted bass pc.
  // Patterns MUST anchor low-beat notes on bassPc (not chordRootPc) —
  // otherwise stride / boogie / dilla all play the root on a chord
  // that's audibly in inversion, splitting the listener's bass percept
  // (Divisi 2.0's FirstInversion / SlashChord state then fights the
  // bass pattern instead of cooperating with it).
  bassPc: number;
  pitchClasses: number[];
  prevBassMidi: number | null;
  isCadenceToTonic: boolean;
  isLast: boolean;
  barIndex: number;
  random: { next(): number };
}

export type BassPatternRuleFn = (ctx: BassPatternContext) => BassPatternEvent[];

// ------------------------------------------------------------------
// boogie_pattern — classic blues / boogie woogie root-5-6-5 walking
// figure within a bar. Beat 1 = root low, beat 2 = 5th, beat 3 = 6th,
// beat 4 = 5th. All quarter-note durations. Last bar / cadence collapse
// to root holds across the whole bar (Solid landing).
// ------------------------------------------------------------------

const boogiePatternRule: BassPatternRuleFn = (ctx) => {
  // Anchor on bassPc (= the chord's actual sounding bass) rather than
  // chordRootPc. Inverted chords get the boogie figure rooted on the
  // inversion bass; root-position chords behave identically to before
  // (bassPc === chordRootPc). Upper-beat 5th/6th still sourced from
  // the chord's logical root so the boogie shape stays recognizable.
  const anchor = clampToBassRange(ctx.bassPc + 36);
  if (ctx.isLast || ctx.isCadenceToTonic) {
    return [{ time: 0, midi: anchor, duration: 4, velocity: 95 }];
  }
  const fifth = clampToBassRange(((ctx.chordRootPc + 7) % 12) + 36);
  const sixth = clampToBassRange(((ctx.chordRootPc + 9) % 12) + 36);
  return [
    { time: 0, midi: anchor, duration: 1, velocity: 100 },
    { time: 1, midi: fifth,  duration: 1, velocity: 88 },
    { time: 2, midi: sixth,  duration: 1, velocity: 92 },
    { time: 3, midi: fifth,  duration: 1, velocity: 85 },
  ];
};

// ------------------------------------------------------------------
// stride_pattern — Art Tatum / Fats Waller LH alternation. Beat 1 + 3
// play low root (or fifth), beat 2 + 4 play higher chord stack pitch
// (3rd / 5th / 7th depending on what's available). Each note is a
// quarter; "low" sits at the chord root in BASS_LOW octave, "high"
// jumps an octave up onto a chord-tone pc.
// ------------------------------------------------------------------

const stridePatternRule: BassPatternRuleFn = (ctx) => {
  // Low beat anchors on bassPc (actual sounding bass — supports
  // inversions). The high beat stays a chord-tone NOT equal to the
  // anchor, preferring the 5th from chord root when present.
  const lowAnchor = clampToBassRange(ctx.bassPc + 24);
  if (ctx.isLast || ctx.isCadenceToTonic) {
    return [{ time: 0, midi: lowAnchor, duration: 4, velocity: 95 }];
  }
  let highPc = (ctx.chordRootPc + 7) % 12;
  if (highPc === ctx.bassPc || !ctx.pitchClasses.includes(highPc)) {
    // Skip the anchor pc itself when picking the high beat (otherwise
    // stride collapses to a single repeated pitch on inversions).
    const nonAnchor = ctx.pitchClasses.find(pc => pc !== ctx.bassPc);
    if (nonAnchor !== undefined) highPc = nonAnchor;
  }
  const highMidi = clampToBassRange(highPc + Math.floor(lowAnchor / 12) * 12 + 12);
  return [
    { time: 0, midi: lowAnchor, duration: 1, velocity: 100 },
    { time: 1, midi: highMidi,  duration: 1, velocity: 75 },
    { time: 2, midi: lowAnchor, duration: 1, velocity: 92 },
    { time: 3, midi: highMidi,  duration: 1, velocity: 75 },
  ];
};

// ------------------------------------------------------------------
// dilla_pocket — neo-soul/hip-hop pocket. Beat 1 root long hold,
// beat 2.75 micro-pickup chord pc (off-beat). Sparser than boogie /
// stride — leaves room for melody and Rhodes comping to fill. The
// 0.75 pickup is what gives the "lay-back" feel: lands later than a
// straight 8th but earlier than a triplet quarter.
// ------------------------------------------------------------------

const dillaPocketRule: BassPatternRuleFn = (ctx) => {
  // Anchor sits on bassPc (inversion-aware); the off-beat pickup is a
  // non-anchor chord tone — prefers the 5th from chord root.
  const anchor = clampToBassRange(ctx.bassPc + 36);
  if (ctx.isLast || ctx.isCadenceToTonic) {
    return [{ time: 0, midi: anchor, duration: 4, velocity: 95 }];
  }
  let pickupPc = (ctx.chordRootPc + 7) % 12;
  if (pickupPc === ctx.bassPc || !ctx.pitchClasses.includes(pickupPc)) {
    const nonAnchor = ctx.pitchClasses.find(pc => pc !== ctx.bassPc);
    if (nonAnchor !== undefined) pickupPc = nonAnchor;
  }
  const pickupMidi = clampToBassRange(pickupPc + 36);
  return [
    { time: 0,    midi: anchor,     duration: 2.5, velocity: 100 },
    { time: 2.75, midi: pickupMidi, duration: 0.5, velocity: 80 },
    { time: 3.5,  midi: anchor,     duration: 0.5, velocity: 88 },
  ];
};

export const BASS_PATTERN_RULES: Record<string, BassPatternRuleFn> = {
  boogie_pattern: boogiePatternRule,
  stride_pattern: stridePatternRule,
  dilla_pocket: dillaPocketRule,
};

// Allowed bass MIDI window. Anchored to typical piano LH / bass guitar
// practice — A1 (33) is the lowest comfortable note for most arrangements;
// G3 (55) is the upper edge before the comping register starts. Anything
// below 33 sounds sub-musical / muddy on a piano sampler.
// Bass register — kept in sync with musicTheory.ts BASS_RANGE.
// C2 (36) is the practical low for piano LH; below C2 enters sub-bass.
const BASS_LOW = 36;
const BASS_HIGH = 55;

const clampToBassRange = (midi: number): number => {
  while (midi < BASS_LOW) midi += 12;
  while (midi > BASS_HIGH) midi -= 12;
  return midi;
};

// ------------------------------------------------------------------
// stepwise_descent — prefers a downward step of 1-3 semitones from
// the previous bass onto any chord tone in this chord; falls back to
// the nearest chord tone with a small leap penalty. V→I cadences
// snap to the root. The default rule for jazz / pop / soul styles
// where smooth bass voice leading is the genre signature.
// ------------------------------------------------------------------

const stepwiseDescentRule: BasslineRuleFn = (ctx) => {
  const baseDefault = clampToBassRange(ctx.chordRootPc + 36);
  // Song-end always closes on root — overrides walking behavior so
  // the final bar is Solid state instead of Flowing/Preparation.
  if (ctx.isLast) return baseDefault;
  if (ctx.prevBassMidi === null) return baseDefault;

  const prev = ctx.prevBassMidi;
  const candidates = ctx.pitchClasses.map((pc) => {
    let bestC = pc + 36;
    let cDiff = 100;
    for (let oct = 1; oct <= 3; oct++) {
      const testM = pc + (oct + 1) * 12;
      // Prefer a clean stepwise descent (1-3 semitones).
      if (prev - testM >= 1 && prev - testM <= 3) return testM;
      let pDiff = Math.abs(prev - testM);
      if (pDiff > 5) pDiff += 2; // penalize large leaps
      if (pDiff < cDiff) {
        cDiff = pDiff;
        bestC = testM;
      }
    }
    return bestC;
  });

  let bestBass: number;
  const descendingStep = candidates.find((c) => prev - c >= 1 && prev - c <= 4);
  if (descendingStep !== undefined) {
    bestBass = descendingStep;
  } else {
    bestBass = candidates[0];
    let minDiff = Math.abs(prev - bestBass);
    for (const c of candidates) {
      const d = Math.abs(prev - c);
      if (d < minDiff) {
        minDiff = d;
        bestBass = c;
      }
    }
  }

  if (ctx.isCadenceToTonic) {
    let snap = clampToBassRange(ctx.chordRootPc + 36);
    if (Math.abs(snap + 12 - prev) < Math.abs(snap - prev) && snap + 12 < BASS_HIGH) {
      snap += 12;
    }
    bestBass = snap;
  }

  return clampToBassRange(bestBass);
};

// ------------------------------------------------------------------
// root_lock — always lock to the chord root in a low octave.
// Cinematic / ambient / trap. No voice leading: the bass holds
// the harmonic floor and the melody/comping does the moving.
// ------------------------------------------------------------------

const rootLockRule: BasslineRuleFn = (ctx) => {
  return clampToBassRange(ctx.chordRootPc + 24); // root at MIDI 24-35 zone, then clamped up
};

// ------------------------------------------------------------------
// octave_alternate — alternate root between two octaves per bar.
// Synth pop / dance / four-on-the-floor. Even bars play the root low,
// odd bars play root + 12.
// ------------------------------------------------------------------

const octaveAlternateRule: BasslineRuleFn = (ctx) => {
  const low = clampToBassRange(ctx.chordRootPc + 24);
  const high = clampToBassRange(ctx.chordRootPc + 36);
  return ctx.barIndex % 2 === 0 ? low : high;
};

// ------------------------------------------------------------------
// fifth_drop — root on most bars, fifth on every fourth bar.
// Pop / soul / motown — gives the "every fourth bar lifts to V"
// counter-line without committing to a full walking line.
// ------------------------------------------------------------------

const fifthDropRule: BasslineRuleFn = (ctx) => {
  // Song-end overrides the every-4th-bar fifth lift; close on root.
  if (ctx.isLast) return clampToBassRange(ctx.chordRootPc + 36);
  const fifthPc = (ctx.chordRootPc + 7) % 12;
  if (ctx.barIndex > 0 && ctx.barIndex % 4 === 3) {
    return clampToBassRange(fifthPc + 36);
  }
  // Otherwise prefer stepwise behaviour from the previous bass for
  // smoothness; degenerates to root on the first bar.
  if (ctx.prevBassMidi === null) return clampToBassRange(ctx.chordRootPc + 36);
  // Light voice leading: nearest chord tone within ±5 of prev.
  let best = clampToBassRange(ctx.chordRootPc + 36);
  let bestDist = Math.abs(best - ctx.prevBassMidi);
  for (const pc of ctx.pitchClasses) {
    for (let oct = 1; oct <= 3; oct++) {
      const m = pc + (oct + 1) * 12;
      if (m < BASS_LOW || m > BASS_HIGH) continue;
      const d = Math.abs(m - ctx.prevBassMidi);
      if (d < bestDist) {
        bestDist = d;
        best = m;
      }
    }
  }
  return best;
};

// ------------------------------------------------------------------
// walking_bass — closest-chord-tone-from-previous, no descent bias.
// Returns the chord tone of THIS chord nearest to the previous bass
// midi, preferring step (1-3 semis) over leap. Distinct from
// stepwise_descent in that walking bass walks BOTH directions
// (Charlie Mingus / Ron Carter line shape, not just downward).
// Each bar's anchor sits adjacent to the prior bar's bass — when
// chained across the song, the bass naturally moves stepwise from
// chord to chord. Per learnjazzstandards: walking bass goal = arrive
// at next chord root via stepwise quarter-note motion.
// ------------------------------------------------------------------

const walkingBassRule: BasslineRuleFn = (ctx) => {
  const baseRoot = clampToBassRange(ctx.chordRootPc + 36);
  if (ctx.isLast) return baseRoot;
  if (ctx.prevBassMidi === null) return baseRoot;
  if (ctx.isCadenceToTonic) return baseRoot;

  const prev = ctx.prevBassMidi;
  let best = baseRoot;
  let bestScore = Infinity;
  for (const pc of ctx.pitchClasses) {
    for (let oct = 1; oct <= 3; oct++) {
      const m = pc + (oct + 1) * 12;
      if (m < BASS_LOW || m > BASS_HIGH) continue;
      const d = Math.abs(m - prev);
      // Step (1-3) ranks above leap (>3); within step prefer the
      // closer pitch. Equal distance — root preferred (already the
      // initial baseline).
      const score = d <= 3 ? d : d * 1.5 + 5;
      if (score < bestScore) {
        bestScore = score;
        best = m;
      }
    }
  }
  return best;
};

// ------------------------------------------------------------------
// boogie_root_fifth — alternates root and fifth across bars.
// Boogie / 12-bar blues anchor pattern: even bars settle on chord
// root, odd bars rise to chord fifth. Distinct from octave_alternate
// (which alternates root between two octaves only) — this one swaps
// pitch class. The bar-internal boogie figure (root-5-6-5 broken
// octave) is a texture-layer concern; this rule supplies the bar's
// principal anchor pitch.
// ------------------------------------------------------------------

const boogieRootFifthRule: BasslineRuleFn = (ctx) => {
  const rootMidi = clampToBassRange(ctx.chordRootPc + 36);
  if (ctx.isLast) return rootMidi;
  if (ctx.isCadenceToTonic) return rootMidi;
  if (ctx.barIndex % 2 === 0) return rootMidi;
  const fifthPc = (ctx.chordRootPc + 7) % 12;
  return clampToBassRange(fifthPc + 36);
};

// ------------------------------------------------------------------
// Rule registry. Style profiles refer to rules by name.
// ------------------------------------------------------------------

/**
 * G5: resolve the chord's bass anchor pc based on its bassRole field.
 * Default 'root' returns chordRootPc (back-compat with pre-G5
 * templates). Non-root roles map to the corresponding chord interval.
 */
export function resolveBassAnchorPc(
  bassRole: 'root' | '3rd' | '5th' | '7th' | 'pedal' | undefined,
  chordRootPc: number,
  chordIntervals: number[],
  bassPedalPc?: number,
): number {
  const norm = (n: number) => (((n % 12) + 12) % 12);
  switch (bassRole) {
    case '3rd':
      // intervals[1] is the chord's 3rd (M3 or m3 by chord quality)
      return norm(chordRootPc + (chordIntervals[1] ?? 4));
    case '5th':
      // intervals[2] is the chord's 5th (P5, b5, or #5 by quality)
      return norm(chordRootPc + (chordIntervals[2] ?? 7));
    case '7th':
      // intervals[3] is the chord's 7th (b7 or maj7) for 7-chord types
      return norm(chordRootPc + (chordIntervals[3] ?? 10));
    case 'pedal':
      return norm(bassPedalPc ?? chordRootPc);
    case 'root':
    default:
      return norm(chordRootPc);
  }
}

/** Clamp arbitrary anchor pc to BASS_RANGE, MIDI. */
export function clampPcToBassMidi(pc: number): number {
  const norm = (((pc % 12) + 12) % 12);
  let m = norm + 36;  // default octave around C2-B2
  while (m < BASS_LOW) m += 12;
  while (m > BASS_HIGH) m -= 12;
  return m;
}

export const BASSLINE_RULES: Record<string, BasslineRuleFn> = {
  stepwise_descent: stepwiseDescentRule,
  root_lock: rootLockRule,
  octave_alternate: octaveAlternateRule,
  fifth_drop: fifthDropRule,
  walking_bass: walkingBassRule,
  boogie_root_fifth: boogieRootFifthRule,
};

// Default rule applied when a style has no basslineRules entries.
// stepwise_descent is the broadest-fit fallback — works on every chord
// type without coupling to chord-quality assumptions like fifth_drop.
export const DEFAULT_BASSLINE_RULE = 'stepwise_descent';

/**
 * Pick one rule name from a weighted style ruleset. Falls back to the
 * default when the style hasn't declared any rules.
 *
 * `random` must be a forked Random so the choice doesn't perturb the
 * main pipeline's stream.
 */
export function pickBasslineRule(
  rules: { ref: string; weight: number }[] | undefined,
  random: { next(): number },
): string {
  if (!rules || rules.length === 0) return DEFAULT_BASSLINE_RULE;
  const totalWeight = rules.reduce((s, r) => s + r.weight, 0);
  if (totalWeight <= 0) return DEFAULT_BASSLINE_RULE;
  let pick = random.next() * totalWeight;
  for (const r of rules) {
    if (pick < r.weight) {
      return r.ref in BASSLINE_RULES ? r.ref : DEFAULT_BASSLINE_RULE;
    }
    pick -= r.weight;
  }
  // Fall through: weighted pick should always hit, but guard anyway.
  return rules[rules.length - 1].ref in BASSLINE_RULES
    ? rules[rules.length - 1].ref
    : DEFAULT_BASSLINE_RULE;
}
