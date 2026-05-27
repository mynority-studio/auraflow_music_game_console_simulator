// ==========================================
// borrowedChordPlanner.ts — Modal Interchange via positional rules.
//
// Vocabulary (project-wide):
//   • Borrowed Chord (Modal Interchange) — a chord from a parallel
//     mode of the SAME tonic inserted to color a specific functional
//     position. Song's tonal center does NOT change; melody does NOT
//     switch scales. This module handles all such cases.
//   • Tonicization — establish a TEMPORARY new tonic by inserting its
//     ii-V (or V) in front. Melody MUST follow the new center.
//     Handled by tonicizationPlanner.ts (parallel module, runs after).
//
// Replaces the earlier mixturePlanner.ts. The old planner only did
// 1:1 chord substitution (IV → iv) and was triggered by "next chord
// is I" — that captured Rule A1 only. This planner adds three more
// positional patterns (Phase 1 of user's 5-rule scheme):
//
//   Rule A1 — IV → iv → I  (subdominant Mixture, T-prefix)
//     replace IV with iv when next chord is I. Sigh-color cadential
//     return. Idiom: 周杰伦 "轨迹" / 最长的电影; Beatles "Yesterday".
//
//   Rule A2 — iv → bVII7 → I  (backdoor cadence)
//     replace IV's bar with [iv(half) + bVII7(half)] approaching I.
//     Jazz standard backdoor; modern R&B / Neo-Soul cadential color.
//
//   Rule B — vi → bVI → V  (chromatic D-prefix)
//     when curr = V and prev = vi, replace curr with [bVI(half) +
//     V(half)]. The bVI splits the bass walk vi(A) → bVI(Ab) → V(G)
//     — chromatic semitone descent suspending into the dominant.
//
//   Rule C — ii → V → bVI → bVII → I  (cadential ending chain)
//     at phrase ending after ii-V, replace I's 4-beat bar with
//     [bVI(1) + bVII(1) + I(2)]. The bass walks V(G) → Ab → Bb → C
//     — chromatic ascent into the final tonic. Idiom: 史诗 / 副歌
//     final, Beatles Let It Be ending variant.
//
// Phase 2 (D bII before V; E rock bVII/bIII placements) reserved
// for a follow-up after these four prove sound by ear.
//
// SINGLE-SOURCE BORROW POLICY (Rule 3, user-stated):
// All four current rules borrow from PARALLEL MINOR (iv, bVI, bVII,
// bIII, iim7b5 are all natural-minor diatonic chords). Pop / rock /
// R&B / Neo-Soul实战:同一首歌的 borrowed chord 应**同源**(听感
// otherwise drifts and becomes confused). When Phase 2's Rule D
// (bII, Phrygian-source) or Rule E (Mixolydian-source) is added,
// they MUST NOT fire in the same song as parallel-minor borrows.
// Implementation when that day comes: per-song fork
// `${seed}::borrow-source` picks ONE source mode for the entire
// song (Aeolian / Phrygian / Mixolydian), and only rules sourced
// from that mode can fire. For now (Phase 1, all parallel-minor),
// this property holds automatically — no source-lock needed.
//
// Determinism: this planner consumes randoms from a dedicated stream
// (forked `${seed}::borrow`) so adding/removing it leaves the main
// pipeline stream untouched. BLUES short-circuits at baseProb = 0.
// Tonicization-target guard: never modifies a chord whose previous
// chord is a secondary dominant resolving to it (V/X → X — leave X
// to fulfill the Tonicization).
// ==========================================

import { ChordSkeletonSlot, StyleName, BorrowedSource } from './styleDictionary';

interface PlannerRandom {
  next(): number;
}

/**
 * TSD function inference from Roman. Mirrors musicEngine's
 * harmonicFunctionFromRoman semantics — kept inline here to avoid
 * a circular import (musicEngine imports this planner).
 *   T = I, i, iii, III, vi, VI, bIII, bVI  (tonic + tonic substitutes)
 *   S = IV, iv, ii, II, bVII                (subdominant + borrowed S)
 *   D = V, v, vii, VII, anything with '/'   (dominant + secondary dom)
 */
function tsdFunction(roman: string): 'T' | 'S' | 'D' {
  if (!roman) return 'T';
  // Secondary dominants always D-like
  if (roman.includes('/')) return 'D';
  const base = roman.split('/')[0].replace(
    /maj7|maj9|maj13|m7|m9|m11|sus4|7sus4|9sus4|7b13|7#9|7alt|dim|aug|\+|o|ø|[0-9]/g, '',
  );
  if (['V', 'v', 'vii', 'VII'].includes(base)) return 'D';
  if (['IV', 'iv', 'ii', 'II', 'bVII'].includes(base)) return 'S';
  // I, i, III, iii, VI, vi, bIII, bVI → T-class
  return 'T';
}

const STYLE_BORROW_PROB: Record<StyleName, number> = {
  POP: 0.45,
  JAZZ: 0.35,
  RNB: 0.55,
  BLUES: 0.0,
  // LOFI: 不走外部 borrow planner — 原型 progression 已带预定 borrow,
  // 弱终止 / 短循环不需要再叠加随机借用
  LOFI: 0.0,
};

// Per-song maximum number of borrowed-chord FIRES (each fire counts
// as one rule application, regardless of how many slots it produces).
// Lerdahl & Berklee guidance: "extended use of borrowed chords dilutes
// the sense of tonality or causes unwanted modulation". Empirically
// in pop, 1-3 borrows per 16-bar song reads as "tasteful color"; 4+
// starts feeling like a key change. RNB / Neo-Soul tolerates more
// (chord color is the genre signature). BLUES is 0 anyway (modal
// universe, no borrowing).
const STYLE_MAX_BORROWS_PER_SONG: Record<StyleName, number> = {
  POP: 3,
  JAZZ: 4,
  RNB: 5,
  BLUES: 0,
  LOFI: 0,
};

type PhraseRole = 'start' | 'middle' | 'cadence' | 'ending';

function classifyPhraseRole(i: number, total: number, motifInterval: number): PhraseRole {
  if (i === total - 1) return 'ending';
  if (motifInterval > 0 && (i + 1) % motifInterval === 0) return 'cadence';
  if (motifInterval > 0 && i % motifInterval === 0) return 'start';
  return 'middle';
}

/**
 * Strip accidentals + extract Roman head ('IV', 'iv', 'V', 'vi', 'I'
 * etc.). For Planner-inserted "V/X" or "ii/X", returns the first
 * Roman cluster ('V', 'ii') — slash handled separately by callers.
 */
function romanHead(roman: string): string {
  if (!roman) return '';
  const stripped = roman.replace(/^[b#n]+/, '');
  return stripped.match(/^[IVivXx]+/)?.[0] ?? '';
}

type Quality = 'maj' | 'min' | 'dom' | 'dim' | 'sus' | 'other';

function chordQuality(type: string): Quality {
  if (!type) return 'other';
  if (type === 'm7b5' || type === 'm9b5' || type === 'dim' || type === 'dim7') return 'dim';
  if (type.startsWith('sus')) return 'sus';
  if (type === '7sus4' || type === '9sus4') return 'sus';
  if (type === 'maj' || type === 'maj7' || type === 'maj9' || type === 'maj13'
      || type === 'maj7#11' || type === 'add9' || type === '6' || type === '6/9') return 'maj';
  if (type.startsWith('m') && !type.startsWith('maj')) return 'min';
  if (type === '7' || type === '9' || type === '11' || type === '13'
      || type === '7b9' || type === '7#9' || type === '7b13'
      || type === '7#11' || type === '7alt') return 'dom';
  return 'other';
}

/**
 * Each rule attempts to transform `curr` (one source slot) into N
 * output slots that REPLACE it. Returns null when the rule doesn't
 * match. When returning slots, the beats of those slots must sum to
 * curr's original duration so the song length stays invariant.
 */
interface BorrowedRule {
  name: string;
  weight: number;
  /** Parallel-mode source this rule borrows from. Planner only
   *  fires the rule when song's borrowSource === this — UNLESS
   *  bypassSourceFilter is set. */
  source: 'Aeolian' | 'Mixolydian' | 'Phrygian' | 'Dorian';
  /**
   * When true, this rule fires regardless of song's borrowSource.
   * Used for rules whose chord IS native to all relevant modes
   * (e.g. bVII is in Aeolian / Dorian / Phrygian — all minor sources).
   * Default false (single-source lock per song).
   */
  bypassSourceFilter?: boolean;
  /**
   * Mode restriction. 'both' (default) — rule fires regardless of song
   * mode. 'minor' / 'major' — only fires in that mode family.
   */
  appliesInMode?: 'minor' | 'major' | 'both';
  apply: (
    curr: ChordSkeletonSlot,
    prev: ChordSkeletonSlot | null,
    prev2: ChordSkeletonSlot | null,
    next: ChordSkeletonSlot | null,
    phraseRole: PhraseRole,
    bpm: number,
  ) => ChordSkeletonSlot[] | null;
}

// ─── Rule definitions ─────────────────────────────────────────────

// Backdoor cadence has D-like function — bVII7 leads to T like a
// dominant. The roman 'bVII' would default to S by harmonic analysis,
// but the backdoor pattern (iv → bVII7 → I) makes bVII7 functionally
// dominant: its 3rd (D in C major, the root of V) resolves to I's
// root (C), and its b7 (Ab) resolves to I's third (E) — the same
// guide-tone motion as G7 → C. So we tag effectiveFunc = 'D' on the
// bVII7 slot so cadence resolution / TSD UI / future melody scoring
// treat it as a dominant rather than a passing borrowed chord.

// Rule A1: replace IV with iv when next is T-function (I / vi / iii).
// "S 借调放在 T 前" — T includes any tonic-class chord (I, vi, iii),
// not only I. Cadential context narrows this further via the
// per-rule weight and the planner's per-song fire cap.
const RULE_A1: BorrowedRule = {
  name: 'A1: IV → iv → T',
  weight: 1.0,
  source: 'Aeolian',
  apply: (curr, _prev, _prev2, next, _phraseRole, _bpm) => {
    if (romanHead(curr.roman) !== 'IV') return null;
    if (chordQuality(curr.type) !== 'maj') return null;
    if (!next) return null;
    if (tsdFunction(next.roman) !== 'T') return null;
    return [{
      ...curr,
      type: 'm7',
      roman: 'iv',
      borrowedFrom: 'iv (parallel minor)',
      borrowedSource: 'modal_interchange' as BorrowedSource,
      mustResolve: false,
      lockType: true,
    }];
  },
};

// Rule A2: backdoor cadence iv → bVII7 → T. Replaces IV's bar with
// 2 chords (iv first half + bVII7 second half), approaching any
// T-function chord (I / vi / iii). bVII7 root is always 10 semis
// above key root regardless of which T the cadence lands on.
const RULE_A2: BorrowedRule = {
  name: 'A2: iv → bVII7 → I (backdoor)',
  weight: 0.8,
  source: 'Aeolian',
  apply: (curr, _prev, _prev2, next, _phraseRole, bpm) => {
    if (romanHead(curr.roman) !== 'IV') return null;
    if (chordQuality(curr.type) !== 'maj') return null;
    if (!next) return null;
    // Backdoor cadence only resolves cleanly to I (or i). Routing it
    // to vi or iii (other T-function chords) sounds weak — the b7→1
    // resolution motion needs the literal tonic, not a tonic-class
    // substitute. Per user spec: "backdoor 只建议去 I / i".
    const nextHead = romanHead(next.roman);
    if (nextHead !== 'I' && nextHead !== 'i') return null;
    const half = Math.floor(bpm / 2);
    const currBeats = curr.beats ?? bpm;
    if (currBeats < 2) return null;
    return [
      {
        ...curr,
        type: 'm7',
        roman: 'iv',
        borrowedFrom: 'iv (parallel minor)',
        borrowedSource: 'modal_interchange' as BorrowedSource,
        mustResolve: false,
        beats: half,
        lockType: true,
      },
      {
        roman: 'bVII7',
        type: '7',
        scaleDegree: 7,
        rootOffset: 10,  // bVII = 10 semis above key root
        beats: currBeats - half,
        borrowedFrom: 'bVII7 (backdoor cadence)',
        borrowedSource: 'backdoor_dominant' as BorrowedSource,
        mustResolve: true,
        effectiveFunc: 'D' as const,  // override: bVII7 functions as dominant here
        lockType: true,
      } as ChordSkeletonSlot,
    ];
  },
};

// Rule B: vi → bVI → V (chromatic D-prefix). User plan:
//   if (prevRoman === 'vi' && nextChord is V) allow('bVI')
// curr's bar is split into [bVI(half) + curr(half)]; the bVI sits
// between vi and V, giving the chromatic A → Ab → G bass walk into V.
//
// NARROWED (per user): originally fired on ANY D-function chord
// (including vii, VII etc.). Real music limits this to V — vii has
// b5 in it and doesn't match the chromatic-mediant idiom. Per spec:
// "Rule B 经典是 vi → bVI → V,应该收窄到 V 前的 chromatic D-prefix,
//  不要泛化成任何 D 功能前都能插 bVI".
const RULE_B: BorrowedRule = {
  name: 'B: vi → bVI → V',
  weight: 0.7,
  source: 'Aeolian',
  apply: (curr, prev, _prev2, _next, _phraseRole, bpm) => {
    const currHead = romanHead(curr.roman);
    if (currHead !== 'V' && currHead !== 'v') return null;
    const currQ = chordQuality(curr.type);
    if (currQ !== 'maj' && currQ !== 'dom') return null;
    if (!prev || romanHead(prev.roman) !== 'vi') return null;
    const half = Math.floor(bpm / 2);
    const currBeats = curr.beats ?? bpm;
    if (currBeats < 2) return null;
    return [
      {
        roman: 'bVI',
        type: 'maj7',
        scaleDegree: 6,
        rootOffset: 8,  // bVI = 8 semis above key root
        beats: half,
        borrowedFrom: 'bVI (parallel minor)',
        borrowedSource: 'modal_interchange' as BorrowedSource,
        mustResolve: false,
        lockType: true,
      } as ChordSkeletonSlot,
      {
        ...curr,
        beats: currBeats - half,
      },
    ];
  },
};

// Rule C: ii-V → bVI → bVII → I  (cadential chain).
// Curr = I (maj quality), prev = V, prev2 = ii, phrase role is
// 'cadence' or 'ending'. Replace I's 4-beat bar with:
//   [bVI(1) + bVII(1) + I(rest)]  so the bass walks
//   V → bVI → bVII → I  chromatically up to the final tonic.
const RULE_C: BorrowedRule = {
  name: 'C: ii-V → bVI → bVII → I (cadential)',
  weight: 0.85,
  source: 'Aeolian',
  apply: (curr, prev, prev2, _next, phraseRole, bpm) => {
    if (phraseRole !== 'cadence' && phraseRole !== 'ending') return null;
    if (romanHead(curr.roman) !== 'I') return null;
    if (chordQuality(curr.type) !== 'maj') return null;
    if (!prev || romanHead(prev.roman) !== 'V') return null;
    if (!prev2 || romanHead(prev2.roman) !== 'ii') return null;
    const currBeats = curr.beats ?? bpm;
    // Insert two short borrowed chords; reserve at least 2 beats
    // for the resolving I.
    const insertBeats = Math.max(1, Math.floor(currBeats / 4));
    const remainingI = currBeats - 2 * insertBeats;
    if (remainingI < 1) return null;
    return [
      {
        roman: 'bVI',
        type: 'maj7',
        scaleDegree: 6,
        rootOffset: 8,
        beats: insertBeats,
        borrowedFrom: 'bVI (cadential chain)',
        borrowedSource: 'modal_interchange' as BorrowedSource,
        mustResolve: false,
        lockType: true,
      } as ChordSkeletonSlot,
      {
        roman: 'bVII',
        type: 'maj7',
        scaleDegree: 7,
        rootOffset: 10,
        beats: insertBeats,
        borrowedFrom: 'bVII (cadential chain)',
        borrowedSource: 'modal_interchange' as BorrowedSource,
        mustResolve: false,
        lockType: true,
      } as ChordSkeletonSlot,
      {
        ...curr,
        beats: remainingI,
      },
    ];
  },
};

// Rule D: bII insertion (Phrygian color). Three patterns — bII is
// INSERTED as half-bar split, never replacing the native chord.
// Per user music-theory note: "Phrygian 真正带来的不是四级变化,
// 而是 ♭II,所以小调四级要借 Phrygian,通常是把 ♭II 放在 iv 周围,
// 或者让旋律在 iv 上短暂出现 ♭2 色彩".
//
//   Pattern 1 — Cadential color:  iv → [iv-half | bII-half] → i
//                Idiom:           Fm  →  Db  →  Cm  (C minor)
//                Listener hears:  subdominant-darkening-to-tonic
//
//   Pattern 2 — Neapolitan PD:    [curr-half | bII-half] → V → i
//                Idiom:           ... → Db → G7 → Cm (C minor)
//                Listener hears:  chromatic-predominant → V → i
//                Note: bII before V is the classical Neapolitan,
//                strongest cadence form (target = V, not i directly).
//
//   Pattern 3 — Embedded color:   i → [bII-half | iv-half] → ...
//                Idiom:           Cm → Db → Fm → ...
//                Listener hears:  tonic-darkening-to-subdominant
//
// Replacing native iv with bII (the OLD Rule D) was wrong: it lost
// the iv chord entirely, leaving only Db where Fm-Db-Cm was intended.
const RULE_D: BorrowedRule = {
  name: 'D: bII insertion (Phrygian)',
  weight: 0.6,
  source: 'Phrygian',
  apply: (curr, prev, _prev2, next, _phraseRole, bpm) => {
    if (chordQuality(curr.type) === 'dim') return null;
    const currHead = romanHead(curr.roman);
    const nextHead = next ? romanHead(next.roman) : '';
    const prevHead = prev ? romanHead(prev.roman) : '';
    const currBeats = curr.beats ?? bpm;
    if (currBeats < 2) return null;
    const half = Math.floor(bpm / 2);

    const bIISlot: ChordSkeletonSlot = {
      roman: 'bII',
      type: 'maj7',
      scaleDegree: 1,
      rootOffset: 1,
      beats: half,
      borrowedFrom: 'bII (Phrygian)',
      borrowedSource: 'modal_interchange' as BorrowedSource,
      mustResolve: false,
      lockType: true,
    } as ChordSkeletonSlot;

    // Pattern 1: iv → bII → i  (cadential color)
    //   Both 'I' (major-mode home tonic) and 'i' (minor-mode home tonic)
    //   are valid resolution targets. Pattern docstring is C minor
    //   (Fm → Db → Cm), so minor 'i' is the primary case.
    if ((currHead === 'IV' || currHead === 'iv')
        && (nextHead === 'I' || nextHead === 'i')) {
      return [
        { ...curr, beats: currBeats - half },
        bIISlot,
      ];
    }
    // Pattern 2: ... → bII → V  (Neapolitan predominant). Strongest
    // form — bII feeds V which then resolves to i. Marked mustResolve
    // because the V→i half-cadence must complete.
    if (nextHead === 'V') {
      return [
        { ...curr, beats: currBeats - half },
        { ...bIISlot, mustResolve: true, borrowedFrom: 'bII (Phrygian / Neapolitan)' },
      ];
    }
    // Pattern 3: i → bII → iv  (embedded color, bII darkens transition)
    //   Same case-handling as Pattern 1 — minor 'i' is the canonical case.
    if ((currHead === 'IV' || currHead === 'iv')
        && (prevHead === 'I' || prevHead === 'i')) {
      return [
        bIISlot,
        { ...curr, beats: currBeats - half },
      ];
    }
    return null;
  },
};

// Rule F: Dorian IV (raised 6). In Aeolian / minor-mode song, replace
// the native iv (Fm in C minor) with IV major (F maj). Dorian's
// signature raised-6 lifts the chord built on the 4th degree from
// minor to major. This IS a legitimate same-degree borrow at the 4
// position — unlike Phrygian (where iv = iv, no change), Dorian
// genuinely substitutes the 4-chord quality.
//
//   Aeolian iv:   Fm (F-Ab-C)  — native
//   Dorian IV:    F (F-A-C)    — borrowed, has natural 6 (A) of song key
//
// Idiom:        i → IV → i   Cm → F → Cm
// Listener hears: tonic-bright-up-to-major-IV-and-back, the "Eleanor
// Rigby" / "Mad World" / Stevie Wonder "Superstition" mode color.
// Per user spec: "Dorian / IV 大四级 / 自然 6".
const RULE_F: BorrowedRule = {
  name: 'F: Dorian IV (raised 6)',
  weight: 0.55,
  source: 'Dorian',
  apply: (curr, _prev, _prev2, _next, _phraseRole, _bpm) => {
    const currHead = romanHead(curr.roman);
    if (currHead !== 'IV' && currHead !== 'iv') return null;
    if (chordQuality(curr.type) !== 'min') return null;
    // Dorian IV type mapping. Aeolian iv (Fm) → Dorian IV with the
    // raised 6 (A natural in C key). The chord-7 should follow the
    // PARENT-SCALE flat-7 (Eb in C Aeolian/Dorian both share this).
    // So:
    //   m7  (F-Ab-C-Eb) → 7  (F-A-C-Eb)   ← b7 preserved, 3rd raised
    //   m9  (+9 = G)    → 9  (+9)         ← same
    //   m11 (+11 = Bb)  → 13sus4          ← keep 4, add 13 (raised 6),
    //                                       avoid maj3-vs-11 clash
    //   min (triad)     → maj             ← simple raised-6 triad
    //
    // PREVIOUS BUG: mapped m7/m9/m11 → maj7, which adds E natural —
    // foreign to both C Aeolian and C Dorian, sounds like Lydian
    // intrusion rather than Dorian (per user: "Fmaj7 = F A C E 里的
    // E natural 不在 C Dorian 里,会把 C 小调的 Eb 气质冲掉").
    let newType: string;
    if (curr.type === 'm7') newType = '7';
    else if (curr.type === 'm9') newType = '9';
    else if (curr.type === 'm11') newType = '13sus4';
    else newType = 'maj';
    return [{
      ...curr,
      type: newType,
      roman: 'IV',
      borrowedFrom: 'IV (Dorian — raised 6)',
      borrowedSource: 'modal_interchange' as BorrowedSource,
      mustResolve: false,
      lockType: true,
    }];
  },
};

// Rule E1: bVII → IV  (Mixolydian rock color before subdominant).
// When curr is IV and prev is I, insert bVII between them as a
// chromatic-step predominant. Idiom: Beatles "Yesterday" variant,
// Sweet Child O' Mine intro, etc. Mixolydian source.
const RULE_E1: BorrowedRule = {
  name: 'E1: I → bVII → IV',
  weight: 0.6,
  source: 'Mixolydian',
  apply: (curr, prev, _prev2, _next, _phraseRole, bpm) => {
    if (romanHead(curr.roman) !== 'IV') return null;
    if (chordQuality(curr.type) !== 'maj') return null;
    if (!prev || romanHead(prev.roman) !== 'I') return null;
    const half = Math.floor(bpm / 2);
    const currBeats = curr.beats ?? bpm;
    if (currBeats < 2) return null;
    // Replace curr (IV's bar) with [bVII(half) + IV(half)] — bVII
    // sits between prev I and curr IV's second half
    return [
      {
        roman: 'bVII',
        type: 'maj',
        scaleDegree: 7,
        rootOffset: 10,
        beats: half,
        borrowedFrom: 'bVII (Mixolydian — rock color)',
        borrowedSource: 'modal_interchange' as BorrowedSource,
        mustResolve: false,
        lockType: true,
      } as ChordSkeletonSlot,
      {
        ...curr,
        beats: currBeats - half,
      },
    ];
  },
};

// Rule E2: I → bIII → IV  (chromatic mediant / parallel-minor bIII passing).
// Insert bIII as a chromatic mediant between I and IV. Rock /
// alternative / film-score signature.
//
// CLASSIFICATION fix: bIII is NOT a Mixolydian-source chord (Mixolydian
// only contributes b7 to a major key; its bIII does not exist).
// bIII = Eb major in C key = parallel minor's bIII (Aeolian's III).
// Moved to Aeolian source so single-source-per-song semantics stay
// honest (per user: "bIII 不是 Mixolydian 的特征音, Mixolydian 只有 b7").
const RULE_E2: BorrowedRule = {
  name: 'E2: I → bIII → IV',
  weight: 0.5,
  source: 'Aeolian',
  apply: (curr, prev, _prev2, _next, _phraseRole, bpm) => {
    if (romanHead(curr.roman) !== 'IV') return null;
    if (chordQuality(curr.type) !== 'maj') return null;
    if (!prev || romanHead(prev.roman) !== 'I') return null;
    const half = Math.floor(bpm / 2);
    const currBeats = curr.beats ?? bpm;
    if (currBeats < 2) return null;
    return [
      {
        roman: 'bIII',
        type: 'maj',
        scaleDegree: 3,
        rootOffset: 3,
        beats: half,
        borrowedFrom: 'bIII (parallel minor / chromatic mediant)',
        borrowedSource: 'modal_interchange' as BorrowedSource,
        mustResolve: false,
        lockType: true,
      } as ChordSkeletonSlot,
      {
        ...curr,
        beats: currBeats - half,
      },
    ];
  },
};

// Rule E3: V → bVII → I  (Mixolydian cadence variant). Replaces V's
// second half with bVII to give a flat-7 cadence (Beatles "With a
// Little Help" / classic rock idiom). Much more common trigger than
// E1/E2 since V→I cadences are everywhere — E1/E2 require I→IV which
// only ~8% of POP/JAZZ progressions have. This rule lifts Mixolydian
// fire rate from 1.8% to a usable level without changing the source-
// lock probability distribution.
//
//   Pattern: ... V → [V-half | bVII-half] → I
//   Idiom:    Beatles "Sgt. Pepper" reprise, Lennon "Imagine" outro,
//             countless rock progressions where the V flattens to
//             bVII for a softer, modal landing on I.
//   Listener: less leading-tone tension than V→I, more rock /
//             folk / Mixolydian color.
const RULE_E3: BorrowedRule = {
  name: 'E3: V → bVII → I (Mixolydian cadence)',
  weight: 0.55,
  source: 'Mixolydian',
  apply: (curr, _prev, _prev2, next, _phraseRole, bpm) => {
    if (romanHead(curr.roman) !== 'V') return null;
    // V can be 'maj' (V triad) or 'dom' (V7 / V9 / V13) — both are
    // valid trigger for Mixolydian replacement. Previous bug rejected
    // 'dom' which IS the typical V chord type after Stage 2 decorate.
    const q = chordQuality(curr.type);
    if (q !== 'maj' && q !== 'dom') return null;
    if (!next || romanHead(next.roman) !== 'I') return null;
    const half = Math.floor(bpm / 2);
    const currBeats = curr.beats ?? bpm;
    if (currBeats < 2) return null;
    return [
      { ...curr, beats: currBeats - half },
      {
        roman: 'bVII',
        type: 'maj',
        scaleDegree: 7,
        rootOffset: 10,
        beats: half,
        borrowedFrom: 'bVII (Mixolydian — V→bVII→I cadence)',
        borrowedSource: 'modal_interchange' as BorrowedSource,
        mustResolve: false,
        lockType: true,
      } as ChordSkeletonSlot,
    ];
  },
};

// Rule G: V → bVII → i (Aeolian modal cadence — minor mode).
//
// Per user music-theory rule (pop_tsqr4z analysis):
//   "D9/A → G7b13 已经完成对 G 的局部 tonicization;如果后面马上要回 Cm,
//    那后续和弦默认应该恢复到 C minor 视角. 如果要插一个和弦回 Cm,
//    应该优先插 Bb (= 全局 bVII),不是 Fadd9 (= local Mixolydian bVII/V
//    含 A natural,会变成 Dorian IV 色彩)."
//
//   V → bVII → i is the "dominant evasion to modal cadence" — bVII is
//   diatonic to all minor-family modes (Aeolian / Dorian / Phrygian
//   all have b7), so this rule fires regardless of song's borrowSource
//   (bypassSourceFilter=true). Restricted to minor songs.
//
// bVII type: 'maj' (Bb triad) — purest Aeolian, no extensions adding
// foreign tones. Could also use 'add9' or '7' (both stay in Aeolian
// pcs); avoiding 'maj7' which adds A natural (= Dorian 6, foreign to
// Aeolian).
const RULE_G: BorrowedRule = {
  name: 'G: V → bVII → i (Aeolian modal cadence)',
  weight: 0.45,
  source: 'Aeolian',      // nominal — bypassed via flag below
  bypassSourceFilter: true,  // fires regardless of song's per-song borrow source
  appliesInMode: 'minor',
  apply: (curr, _prev, _prev2, next, _phraseRole, bpm) => {
    if (romanHead(curr.roman) !== 'V') return null;
    const q = chordQuality(curr.type);
    if (q !== 'maj' && q !== 'dom') return null;
    if (!next) return null;
    const nh = romanHead(next.roman);
    if (nh !== 'I' && nh !== 'i') return null;
    const half = Math.floor(bpm / 2);
    const currBeats = curr.beats ?? bpm;
    if (currBeats < 2) return null;
    return [
      { ...curr, beats: currBeats - half },
      {
        roman: 'bVII',
        type: 'maj',
        scaleDegree: 7,
        rootOffset: 10,
        beats: half,
        borrowedFrom: 'bVII (Aeolian modal cadence — V→bVII→i)',
        borrowedSource: 'modal_interchange' as BorrowedSource,
        mustResolve: false,
        lockType: true,
      } as ChordSkeletonSlot,
    ];
  },
};

// Rules tried in priority order (most specific first). First match
// that wins the random gate fires; others are skipped. Source-filter
// happens in planBorrowedChords: rules whose source ≠ song's
// borrowSource are skipped before matcher runs (unless rule has
// bypassSourceFilter=true).
const RULES: BorrowedRule[] = [
  RULE_C,   // ii-V-I + phrase ending — narrowest match
  RULE_A2,  // backdoor — narrower than A1
  RULE_F,   // Dorian IV quality flip (minor song iv→IV maj)
  RULE_D,   // bII insertion (Phrygian)
  RULE_G,   // V → bVII → i (Aeolian modal cadence, minor only)
  RULE_E1,  // I → bVII → IV (Mixolydian)
  RULE_E2,  // I → bIII → IV (Mixolydian)
  RULE_E3,  // V → bVII → I (Mixolydian cadence)
  RULE_B,   // vi-V context (Aeolian)
  RULE_A1,  // simplest replace (Aeolian)
];

export interface PlanBorrowedOptions {
  skeleton: ChordSkeletonSlot[];
  style: StyleName;
  motifInterval: number;
  random: PlannerRandom;
  beatsPerMeasure: number;
  mode: string;
  /**
   * Per-song single borrow-source mode (Rule 3 user policy).
   * Picked once at planner entry by a forked Random
   * `${seed}::borrow-source`. Rules whose source mode doesn't match
   * are skipped — guarantees a song's borrowed chords all come from
   * the same parallel mode (no Aeolian + Phrygian + Mixolydian mix).
   *
   * 'Aeolian' (default, 80% songs)    — Rules A1, A2, B, C, E2 fire
   * 'Mixolydian' (rock, 12% songs)    — Rule E1 (bVII → IV) fires
   * 'Phrygian' (Spanish, 8% songs)    — Rule D (bII → V) fires
   */
  borrowSource: 'Aeolian' | 'Mixolydian' | 'Phrygian' | 'Dorian';
  /**
   * Song-key root pc (0..11). Used by the reserved-slot guard to
   * identify slots whose `analysisKeyPc` has been retagged to a
   * temporary tonal center by the Tonicization Planner (= target
   * slots of V/X). Global borrowed-chord rules MUST NOT fire on
   * these slots — they belong to the local tonicization region and
   * are reserved for the Local Tonicization Color Planner instead.
   */
  songKeyRootPc: number;
}

const MODAL_HOME_MODES = new Set([
  'Dorian', 'Phrygian', 'Lydian', 'Mixolydian', 'Locrian',
  // Blues family — modal in spirit, blues scale supplies its own color
  'Blues', 'Major Blues', 'Minor Blues', 'Composite Blues', 'Country Blues',
  // Bebop / altered scales — already "modal" extensions, not tonal
  'Bebop Dominant', 'Bebop Major', 'Bebop Dorian', 'Altered',
  'Phrygian Dominant', 'Lydian Dominant',
]);

/**
 * Returns a new skeleton array. Original is not mutated. Slots marked
 * lockType (typically by an earlier planner pass — shouldn't happen
 * since borrowed-chord runs first, but defensive) are skipped.
 */
export function planBorrowedChords(opts: PlanBorrowedOptions): ChordSkeletonSlot[] {
  const { skeleton, style, motifInterval, random, beatsPerMeasure, mode, songKeyRootPc } = opts;
  const baseProb = STYLE_BORROW_PROB[style] ?? 0;
  if (baseProb === 0 || skeleton.length < 2) return skeleton.slice();
  // Skip exotic / modal home modes — borrowing into a mode that IS
  // already borrowed flavor is theoretically nonsense and produces
  // dilution of tonality. Only Ionian (Major) and Aeolian (Minor)
  // and their close relatives have a clear parallel-mode source pool.
  if (MODAL_HOME_MODES.has(mode)) return skeleton.slice();

  const maxFires = STYLE_MAX_BORROWS_PER_SONG[style] ?? 3;
  let firesUsed = 0;

  const result: ChordSkeletonSlot[] = [];

  for (let i = 0; i < skeleton.length; i++) {
    const curr = skeleton[i];

    if (curr.lockType) {
      // Already processed by another planner (shouldn't happen but defensive)
      result.push(curr);
      continue;
    }

    // Skip slots already marked as secondary dominants (V/X, subV/X,
    // ii/X). These are part of an ongoing Tonicization and shouldn't
    // be replaced — Rule B's "V → bVI before V" would mis-fire on a
    // V/iii (treating its head 'V' as home V). Borrowed-chord rules
    // apply only to home-key diatonic positions.
    if (curr.roman.includes('/')) {
      result.push(curr);
      continue;
    }

    // Reserved-slot guard (intent-reservation architecture). The
    // Tonicization Planner ran before us and tagged slots that belong
    // to a local tonicization region — V/X / ii/X slots themselves are
    // caught by the lockType / slash-roman checks above, but the
    // TARGET slot X (which keeps its original roman) is identified by
    // `analysisKeyPc !== songKeyRootPc`. Global borrowed-chord rules
    // must skip these so the local tonal center stays clean and the
    // Local Tonicization Color Planner can insert local-key borrows
    // there instead. Per user rule: "global borrowed chord 只能在非
    // tonicization region 里发生".
    if (curr.analysisKeyPc !== undefined && curr.analysisKeyPc !== songKeyRootPc) {
      result.push(curr);
      continue;
    }

    // Re-anchor reservation. The slot IMMEDIATELY AFTER a tonicization
    // target is the listener's "return to home" moment — inserting a
    // global borrow there confuses the resolution. We skip ONE bar of
    // home-key playback as breathing room, then allow normal borrows
    // from the next slot onward. Per user rule: "tonicization 标记
    // reserved slots: ii/V、V/V、target X、target 后 re-anchor".
    const _prevInResult = result.length > 0 ? result[result.length - 1] : null;
    const _prevWasInRegion = _prevInResult?.analysisKeyPc !== undefined
      && _prevInResult?.analysisKeyPc !== songKeyRootPc;
    if (_prevWasInRegion) {
      result.push(curr);
      continue;
    }

    const prev = result.length > 0 ? result[result.length - 1] : null;
    const prev2 = result.length > 1 ? result[result.length - 2] : null;
    const next = i + 1 < skeleton.length ? skeleton[i + 1] : null;
    const phraseRole = classifyPhraseRole(i, skeleton.length, motifInterval);

    // First-phrase guard (Berklee / Open Music Theory): the opening
    // phrase MUST establish the home key before any modal-interchange
    // color is introduced. Tonicization Planner has the same guard at
    // tonicizationPlanner.ts:isFirstPhrase; mirror it here so Borrowed
    // Rule A1 / A2 / B / C / D / E1 / E2 all skip bars [0, motifInterval)
    // without each rule re-checking individually.
    if (motifInterval > 0 && i < motifInterval) {
      result.push(curr);
      continue;
    }

    // Tonicization-zone protection.
    //
    // Rule (user-stated, Berklee-aligned): "Tonicization 临时建立了
    // 局部调性,borrowed chord 在临时调性内要 follow 临时主调; 否则
    // 听感互打".
    //
    // Three sub-cases that mark curr as "inside a Tonicization zone":
    //   (1) prev is V/X where curr's roman head matches X — curr IS
    //       the resolution target (V/Y → Y); don't borrow on it,
    //       complete the resolution.
    //   (2) next is V/X or ii/X — curr is the LAST diatonic chord
    //       before a Tonicization starts; borrowing here would muddy
    //       the listener's transition into the temporary key.
    //   (3) prev is a Tonicization target (V/Y → Y) and curr is the
    //       first chord AFTER the resolution. Brief tonal re-anchor
    //       needed before adding color.
    //
    // In any of these cases, skip Borrowed for curr.
    let inTonicizationZone = false;
    // Sub-case 1
    //   P5a exception: when prev is a "home V tonicization" (V/V → V
    //   under home-V-target rule, prev.localTonalCenterPc === song's
    //   home-V pc), the V target is NOT a local tonic — it's the
    //   global dominant returning to home. The whole figure is a
    //   global cadence, not a region. So sub-case 1 must NOT block
    //   curr (= V) here, otherwise Rule G (V → bVII → i Aeolian modal
    //   cadence) and Rule E3 (V → bVII → I Mixolydian) can never fire
    //   on V chords reached via V/V → V — defeating P5a's intent.
    const homeVPc = (songKeyRootPc + 7) % 12;
    const prevTargetsHomeV = prev?.localTonalCenterPc !== undefined
      && prev.localTonalCenterPc === homeVPc;
    if (prev && !prevTargetsHomeV) {
      const slashSplit = (prev.roman ?? '').split('/');
      if (slashSplit.length === 2) {
        const currHead = romanHead(curr.roman);
        if (currHead === slashSplit[1]) inTonicizationZone = true;
      }
    }
    // Sub-case 2
    if (!inTonicizationZone && next && (next.roman ?? '').includes('/')) {
      inTonicizationZone = true;
    }
    // Sub-case 3
    if (!inTonicizationZone && prev2 && prev) {
      const slashSplit2 = (prev2.roman ?? '').split('/');
      if (slashSplit2.length === 2) {
        const prevHead = romanHead(prev.roman);
        if (prevHead === slashSplit2[1]) inTonicizationZone = true;
      }
    }
    if (inTonicizationZone) {
      result.push(curr);
      continue;
    }

    // Roll once per slot for stream stability. Two-step decision —
    // (1) whether to fire at all (roll vs baseProb × avg weight of
    // applicable rules), (2) WHICH applicable rule fires (weighted
    // pick across applicable rules using the same roll).
    //
    // Previously this loop did per-rule independent gate
    // `roll < baseProb * rule.weight` + `break` on first applicable
    // rule whose roll succeeded OR failed. That meant when TWO rules
    // share the same trigger (E1 + E2 both fire on `prev=I, curr=IV`),
    // only the FIRST in array order ever got a chance: E1's roll
    // outcome decided fire/no-fire, E2 never tried. Result: Rule E2
    // (bIII Mixolydian) had 0 fires across 900-case audit despite
    // E2's trigger being satisfied on every I→IV transition.
    const roll = random.next();

    const applicable: { rule: BorrowedRule; out: ChordSkeletonSlot[] }[] = [];
    const isMinorMode = mode === 'Aeolian' || mode === 'Minor'
        || mode === 'Phrygian' || mode === 'Dorian' || mode === 'Locrian'
        || mode === 'Harmonic Minor' || mode === 'Melodic Minor';
    for (const rule of RULES) {
      // Source filter: skip rules whose parallel-mode source doesn't
      // match the song's borrowSource. Bypassed by rules whose chord
      // is diatonic to all relevant modes (e.g. Rule G's bVII is in
      // every minor-family mode — no need to source-gate).
      if (!rule.bypassSourceFilter && rule.source !== opts.borrowSource) continue;
      // Mode-applicability filter — some rules only fire in major or
      // minor songs (e.g. Rule G's V→bVII→i is a minor-mode cadence).
      if (rule.appliesInMode === 'minor' && !isMinorMode) continue;
      if (rule.appliesInMode === 'major' && isMinorMode) continue;
      const out = rule.apply(curr, prev, prev2, next, phraseRole, beatsPerMeasure);
      if (!out) continue;
      applicable.push({ rule, out });
    }

    let fired = false;
    if (applicable.length > 0 && firesUsed < maxFires) {
      // Fire-decision threshold uses AVERAGE weight of applicable rules
      // — preserves original per-slot fire rate (baseProb × weight)
      // when only one rule applies, while still allowing the cumulative
      // pick to distribute fires across multiple applicable rules.
      const avgWeight = applicable.reduce((s, a) => s + a.rule.weight, 0) / applicable.length;
      const fireThreshold = baseProb * avgWeight;
      if (roll < fireThreshold) {
        // Cumulative-weight pick — same roll, scaled to [0, fireThreshold)
        // and mapped onto cumulative-weight bands.
        const totalWeight = applicable.reduce((s, a) => s + a.rule.weight, 0);
        const pickPosition = (roll / fireThreshold) * totalWeight;
        let acc = 0;
        for (const a of applicable) {
          acc += a.rule.weight;
          if (pickPosition < acc) {
            result.push(...a.out);
            fired = true;
            firesUsed++;
            break;
          }
        }
      }
    }

    if (!fired) {
      result.push(curr);
    }
  }

  return result;
}
