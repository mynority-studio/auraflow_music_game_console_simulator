// ==========================================
// dynamicHarmony.ts — Dynamic TSD-aware harmony dictionary
//
// Stage 2 of the engine pipeline (decorateChordType) used to query
// styleDictionary's per-roman colorChoices map "blind" — only seeing
// the current chord. This module adds the Look-ahead dimension:
// each chord's color decoration consults the NEXT chord's harmonic
// function and quality (MajorTarget / MinorTarget / Deceptive) to
// pick chord types that voice-lead idiomatically into the next bar.
//
// Plus: when a Dominant chord resolves a fifth down (V→I, V/X→X) the
// dictionary may probabilistically trigger Sub-V tritone substitution
// — rewriting the V's rootOffset by +6 semitones to produce the
// classic flat-II dominant (e.g. C major key, G7 → Db7#11). The
// Stage 3 Divisi 2.0 middleware naturally re-classifies the
// substituted chord on its real bass, so no special-case code in
// the engine is needed downstream.
//
// Architectural placement: parallel to basslineRules.ts — a named
// rule registry keyed by macro StyleName. The engine looks it up via
// DYNAMIC_TSD_DICTIONARY[style]?.[func] and falls back to
// styleDictionary's static colorChoices when the lookup misses.
// ==========================================

export type ResolutionTarget = 'MajorTarget' | 'MinorTarget' | 'Deceptive' | 'Default';
export type TSD_Func = 'T' | 'S' | 'D';

export interface DynamicRule {
  // Which next-chord context this rule fires on.
  target: ResolutionTarget;
  // colorLevel (0/1/2) → array of chord-type names to pick from.
  // The engine rolls colorLevel from style.colorLevelProbabilities,
  // then random.pick()s within the corresponding array.
  levels: Record<number, string[]>;
  // Probability (0..1) of triggering Sub-V tritone substitution when
  // this rule fires AND the current → next root motion is a perfect
  // fifth down (i.e. delta = 5 semitones). Defined only for D-function
  // rules where the substitution is musically idiomatic. The engine
  // statically maps the Sub-V's chord type from colorLevel (Lydian
  // Dominant family — '7' / '9' / '13' / '7#11') to avoid
  // 'X#9#11'-style monster strings and to preserve random-stream
  // determinism (no extra random.next consumption inside the sub).
  tritoneProb?: number;
}

// Per-macro × per-function rule sets. Keys MUST match the public
// StyleName union (POP / JAZZ / BLUES / RNB) so the engine can do a
// direct lookup with no dead-code routing logic.
export const DYNAMIC_TSD_DICTIONARY: Record<string, Record<TSD_Func, DynamicRule[]>> = {
  POP: {
    D: [
      // sus4 / 7sus4 / 9sus4 weight raised — pop V chord idiomatically
      // sustains the 4 over the b7 before resolving (Coldplay, 80s
      // synth-pop, Max Martin lift-into-chorus). Roughly 50% sus on
      // approach to MajorTarget, 33% on MinorTarget at level 1.
      { target: 'MajorTarget', levels: { 0: ['7', 'sus4', '7sus4'], 1: ['9sus4', '7sus4', '9'], 2: ['9sus4', '13'] } },
      { target: 'MinorTarget', levels: { 0: ['7', '7sus4'], 1: ['7sus4', '7'], 2: ['7sus4', '7b13'] } },
      { target: 'Deceptive',   levels: { 0: ['sus4', '7sus4'], 1: ['9sus4'], 2: ['11'] } },
      { target: 'Default',     levels: { 0: ['7', '7sus4'], 1: ['7sus4', '9sus4'], 2: ['9'] } },
    ],
    S: [
      { target: 'MajorTarget', levels: { 0: ['maj'], 1: ['add9'], 2: ['maj7', 'maj9'] } },
      { target: 'MinorTarget', levels: { 0: ['min'], 1: ['m7'], 2: ['m9'] } },
      { target: 'Deceptive',   levels: { 0: ['maj'], 1: ['maj7'], 2: ['6'] } },
      { target: 'Default',     levels: { 0: ['maj'], 1: ['add9'], 2: ['maj9'] } },
    ],
    T: [
      { target: 'Default',     levels: { 0: ['maj'], 1: ['add9'], 2: ['maj7'] } },
    ],
  },

  RNB: {
    D: [
      { target: 'MajorTarget', levels: { 0: ['9sus4'], 1: ['13', '9sus4'], 2: ['13', '11'] }, tritoneProb: 0.15 },
      { target: 'MinorTarget', levels: { 0: ['7#9'], 1: ['7b13'], 2: ['7alt'] }, tritoneProb: 0.20 },
      { target: 'Deceptive',   levels: { 0: ['7#9'], 1: ['13b9'], 2: ['7alt'] } },
      { target: 'Default',     levels: { 0: ['9'], 1: ['13'], 2: ['7b13'] } },
    ],
    S: [
      { target: 'MajorTarget', levels: { 0: ['maj9'], 1: ['maj13'], 2: ['maj9#11'] } },
      { target: 'MinorTarget', levels: { 0: ['m9'], 1: ['m11'], 2: ['m9b5'] } },
      { target: 'Deceptive',   levels: { 0: ['maj9'], 1: ['maj13'], 2: ['m11'] } },
      { target: 'Default',     levels: { 0: ['maj9'], 1: ['m9'], 2: ['maj13'] } },
    ],
    T: [
      { target: 'Default',     levels: { 0: ['maj7'], 1: ['maj9'], 2: ['maj13', '6/9'] } },
    ],
  },

  JAZZ: {
    D: [
      // Major target: keep light + airy at low color levels, light
      // alteration only at level 2. Avoids the "everything is 7alt"
      // hard-bop overload.
      { target: 'MajorTarget', levels: { 0: ['7', '9'], 1: ['9', '13'], 2: ['13', '7#11'] }, tritoneProb: 0.35 },
      // Minor target: this is where the dark altered tensions earn
      // their keep — b9 / b13 / 7alt land idiomatically on a minor
      // resolution.
      { target: 'MinorTarget', levels: { 0: ['7b9'], 1: ['7b13', '7#9'], 2: ['7alt', '13b9'] }, tritoneProb: 0.30 },
      { target: 'Deceptive',   levels: { 0: ['7b9'], 1: ['7#9'], 2: ['7alt'] }, tritoneProb: 0.15 },
      { target: 'Default',     levels: { 0: ['7'], 1: ['9', '13'], 2: ['7alt', '13'] } },
    ],
    S: [
      { target: 'MajorTarget', levels: { 0: ['maj7'], 1: ['maj9', '6/9'], 2: ['maj13'] } },
      { target: 'MinorTarget', levels: { 0: ['m7b5'], 1: ['m9b5'], 2: ['m11'] } },
      { target: 'Deceptive',   levels: { 0: ['m7', 'm9'], 1: ['m11'], 2: ['maj9#11'] } },
      { target: 'Default',     levels: { 0: ['maj7'], 1: ['m9'], 2: ['m7b5'] } },
    ],
    T: [
      { target: 'Default',     levels: { 0: ['maj7'], 1: ['maj9'], 2: ['6/9'] } },
    ],
  },

  BLUES: {
    D: [
      { target: 'MajorTarget', levels: { 0: ['7'], 1: ['9'], 2: ['13'] } },
      { target: 'MinorTarget', levels: { 0: ['7#9'], 1: ['7b13'], 2: ['7#9'] } },
      { target: 'Deceptive',   levels: { 0: ['7#9'], 1: ['7#9'], 2: ['7alt'] } },
      { target: 'Default',     levels: { 0: ['7'], 1: ['9'], 2: ['13'] } },
    ],
    S: [
      { target: 'Default',     levels: { 0: ['7'], 1: ['9'], 2: ['9'] } },
    ],
    T: [
      { target: 'Default',     levels: { 0: ['7'], 1: ['9'], 2: ['13'] } },
    ],
  },
};

// Classify the next chord's role. Used by Stage 2 to pick a rule
// inside the dictionary's per-function rule list.
//
// MajorTarget  — next chord lands on a major-quality T (I / IV / VI
//                in major key, or III / VI in minor's relative).
// MinorTarget  — next chord lands on a minor / diminished quality.
// Deceptive    — current is D but next is NOT T-family (D→S or D→D
//                rare — engine reads "the dominant didn't resolve to
//                tonic" as a deceptive landing for color purposes).
// Default      — fallback when none of the above apply.
//
// The minor detection avoids the classic substring trap:
// 'maj7'.includes('m') is true even though maj7 is major. We require
// either roman-case minor (lowercase letters) OR a chord-type that
// explicitly starts with 'm' but NOT 'maj' (so 'm7' / 'm9' / 'm11'
// match but 'maj7' / 'maj9' don't), plus dim-family.
export function analyzeTargetQuality(
  currFunc: TSD_Func,
  nextFunc: TSD_Func,
  nextRoman: string,
  nextType: string,
): ResolutionTarget {
  if (!nextRoman) return 'Default';

  // Dominant didn't resolve to tonic → deceptive flavour.
  if (currFunc === 'D' && nextFunc !== 'T') return 'Deceptive';

  // Strip slash-chord notation (e.g. 'V/ii' → 'V') and chord-type
  // suffix so we look at the bare roman.
  const nextBaseRoman = nextRoman.split('/')[0].replace(/[^a-zA-Z]/g, '');

  // A chord type is minor if (a) its bare 'm' prefix isn't 'maj',
  // (b) it's an explicit dim/m7b5 family, (c) the roman is lowercase.
  const typeIsMinor = (
    nextType === 'min'
    || nextType === 'dim'
    || nextType === 'dim7'
    || nextType === 'm7b5'
    || (nextType.startsWith('m') && !nextType.startsWith('maj'))
  );
  const romanIsMinor = nextBaseRoman.length > 0
    && nextBaseRoman === nextBaseRoman.toLowerCase();

  return (typeIsMinor || romanIsMinor) ? 'MinorTarget' : 'MajorTarget';
}
