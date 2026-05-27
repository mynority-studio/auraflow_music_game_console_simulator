// ==========================================
// tonicizationPlanner.ts — Tonicization (secondary ii-V) planner.
//
// Vocabulary (project-wide):
//   • Tonicization — establish a TEMPORARY new tonic by inserting its
//     ii-V (or V) in front. The melody MUST follow the new center:
//     scale switches to the target key's appropriate mode (Phrygian
//     Dominant for minor target, Mixolydian for major target),
//     leading-tone resolves to the new tonic, tendency table reads
//     against the new key. Multi-chord effect.
//   • Modal Interchange — borrow a single chord from a parallel mode
//     of the SAME tonic to add color. Song's tonal center DOES NOT
//     change. Handled by borrowedChordPlanner.ts.
//
// This module handles Tonicization only. Treats any non-leading-tone
// diatonic chord as a temporary "I" and rewrites the bar BEFORE it
// as that chord's own ii-V. The bar that was previously occupying
// the slot is sacrificed — its 4 beats are repurposed as 2 beats of
// ii + 2 beats of V approaching the target. The new slots carry
// localTonalCenterPc (the new tonic's pc) and forcedScale
// (Phrygian Dominant / Mixolydian) so downstream evaluator and
// scale derivation honor the new center.
//
// Triggered by style probability (POP 15% / JAZZ 50% / RNB 25% /
// BLUES 0%) and gated to disallow:
//   • phrase-boundary positions (i % motifInterval === 0)
//   • diminished targets (vii°, ii° — they aren't real tonics)
//   • already-substituted slots (roman contains '/')
//
// Major target (uppercase roman: I, IV, V): inserts iim7 + V7 with
// forcedScale='Mixolydian'.
// Minor target (lowercase roman: ii, iii, vi): inserts iim7b5 + V7b9
// with forcedScale='Phrygian Dominant'.
//
// Random consumption is funneled through a dedicated stream
// (forked from `${seed}::tonicize`) so the main pipeline's random
// stream is untouched — snapshot stability for non-Planner cases
// preserved when Planner doesn't fire.
//
// Sources:
//   - ii-V-I Progression (Wikipedia) — secondary ii-V can approach
//     any diatonic chord by treating it as I.
//   - Andy French 2018 — minor target uses iim7b5 + altered dominant
//     to emphasize the target's minor tonality.
//   - Popgrammar — most common pop targets are V/V, V/vi, V/IV; vii°
//     not a viable target.
// ==========================================

import { ChordSkeletonSlot, StyleName, BorrowedSource } from './styleDictionary';

interface PlannerRandom {
  next(): number;
}

const STYLE_TONICIZE_PROB: Record<StyleName, number> = {
  POP: 0.30,
  JAZZ: 0.65,
  RNB: 0.40,
  BLUES: 0.0,
  // LOFI 不走复杂离调 — 用户明确说 "soft 扩展、弱终止、短循环"
  LOFI: 0.0,
};

/**
 * Per-song hard cap on the number of Tonicization Planner FIRES.
 * Each fire emits 1 chord (light) or 2 chords (approach / iiv_split /
 * full_2bar), so the chord-count impact varies, but the listener-side
 * "I'm tonicizing" event count is bounded here.
 *
 * Per User feedback after global audit:
 *   "JAZZ 连续 3 个 full_2bar 看起来像功能练习题,不是音乐";
 *   "POP 默认 V/X 或半小节 compact ii-V,不堆 chain"
 *
 * Values:
 *   POP   = 2  — V/X stays light; full ii-V is reserved for JAZZ
 *   JAZZ  = 4  — allows substantial chain but caps at "every 4 bar
 *                one fire" rather than the unbounded probabilistic
 *                stream that produced jazz_9e41rh's 3 consecutive
 *                full_2bar bars
 *   RNB   = 3  — compact ii-V allowed, but breathing room preserved
 *   BLUES = 0  — Tonicization disabled at the prob layer anyway
 */
const STYLE_TONICIZE_MAX_PER_SONG: Record<StyleName, number> = {
  POP: 2,
  JAZZ: 4,
  RNB: 3,
  BLUES: 0,
  LOFI: 0,
};

/**
 * Tonicization placement modes (when the Planner fires):
 *
 *   light       — curr's entire bar becomes V/X (no ii). Lightest
 *                 jazz feel; flow stays close to original. Most
 *                 idiomatic for POP / R&B ballad.
 *                   Before:  C | Am | F | G
 *                   After:   C | Am | D7 | G    (replaces F with V/V)
 *
 *   approach    — curr's first half keeps the ORIGINAL chord; second
 *                 half is V/X. Preserves S-function while still
 *                 inserting the pre-V kick. Compact pop ballad idiom.
 *                   Before:  C | Am | F     | G
 *                   After:   C | Am | F  D7 | G
 *
 *   iiv_split   — curr's bar becomes ii/X (first half) + V/X (second
 *                 half). Most jazz-flavored, full local 2-5 implied
 *                 in one bar. Standard jazz comping idiom.
 *                   Before:  C | Am | F  | G
 *                   After:   C | Am | Am7 D7 | G    (full ii-V of V)
 *
 *   full_2bar   — prev bar OVERWRITTEN to ii/X full bar, curr bar
 *                 OVERWRITTEN to V/X full bar. Most authoritative
 *                 jazz idiom (Bird / Trane standard form). Requires:
 *                 prev iteration did not insert, prev not at phrase
 *                 boundary, prev not lockType (not a borrowed slot).
 *                 Falls back to iiv_split when prev unavailable.
 *                   Before:  C | Am  | F  | G
 *                   After:   C | Am7 | D7 | G    (Am→ii/V=Am7, F→V/V=D7,
 *                                                  target X = G unchanged)
 *                 Math:  target G has rootOffset=7 from C
 *                        → ii offset = (7+2)%12 = 9 = A (Am7 = ii/V)
 *                        → V  offset = (7+7)%12 = 2 = D (D7  = V/V)
 *
 * Per-style placement weights — sum to 1.0:
 *   POP   light leans:  light 0.45 / approach 0.35 / iiv_split 0.20 / full_2bar 0
 *   JAZZ  full-2-5:     light 0.10 / approach 0.15 / iiv_split 0.45 / full_2bar 0.30
 *   RNB   mixed:        light 0.30 / approach 0.30 / iiv_split 0.30 / full_2bar 0.10
 *
 * BLUES weights all zero (baseProb=0 disables Planner anyway).
 * POP gets full_2bar 0 — too jazz-heavy for ballad flow.
 */
type Placement = 'light' | 'approach' | 'iiv_split' | 'full_2bar';

const STYLE_PLACEMENT_WEIGHTS: Record<StyleName, { light: number; approach: number; iiv_split: number; full_2bar: number }> = {
  POP:   { light: 0.45, approach: 0.35, iiv_split: 0.20, full_2bar: 0    },
  JAZZ:  { light: 0.10, approach: 0.15, iiv_split: 0.45, full_2bar: 0.30 },
  RNB:   { light: 0.30, approach: 0.30, iiv_split: 0.30, full_2bar: 0.10 },
  BLUES: { light: 0,    approach: 0,    iiv_split: 0,    full_2bar: 0    },
  LOFI:  { light: 0,    approach: 0,    iiv_split: 0,    full_2bar: 0    },
};

function pickPlacement(roll: number, style: StyleName): Placement {
  const w = STYLE_PLACEMENT_WEIGHTS[style] ?? STYLE_PLACEMENT_WEIGHTS.POP;
  if (roll < w.light) return 'light';
  if (roll < w.light + w.approach) return 'approach';
  if (roll < w.light + w.approach + w.iiv_split) return 'iiv_split';
  return 'full_2bar';
}

// Target-frequency multipliers — V, vi, IV, ii are pop staples
// (full prob); iii is rarer (half prob); everything else is gated
// out by the diminished / borrowed-chord check.
//
// I / i (home tonic) deliberately absent — see also the
// `targetPcAbs === songKeyRootPc` short-circuit below. Tonicizing I
// produces V/I which is identical in sound and function to a plain
// V → I cadence (no new tonal center is being established); it's not
// a Tonicization at all, just a redundant label. Same applies to any
// scale-degree label that resolves to the home pc (e.g. authored
// progressions that spell home as 'VII' in a Phrygian framing or
// similar edge cases) — caught by the pc-comparison guard.
const TARGET_MULT: Record<string, number> = {
  V: 1.0, v: 1.0,
  vi: 1.0, VI: 1.0,
  IV: 1.0, iv: 1.0,
  ii: 1.0, II: 1.0,
  iii: 0.5, III: 0.5,
};

// Borrowed-target multiplier — DISABLED (set to 0). Tonicization
// targeting a borrowed chord (e.g. ii/bII → V/bII → bII) over-
// complicates Modal Interchange: the borrowed chord already has its
// own functional role (bII = Phrygian predominant, bVI = relative-
// major lift, bVII = Mixolydian color). Prefixing it with a secondary
// ii-V tonicizes the target as a key center, which conflicts with
// substitution semantics. Per user feedback on pop_xoce8n: "bII 应该
// 是单 chord,不该被 secondary ii-V 又包一层".
//
// To restore the previous behavior (allow Tonicization → borrowed
// chord in song's second half), set this back to 0.35.
const BORROWED_TARGET_MULT = 0;

/**
 * Reads roman head + chord type and returns 'major' / 'minor' /
 * 'forbidden'.
 *
 * The roman case is a hint but the chord type is authoritative.
 * Some progression dictionaries write the borrowed v (minor V in a
 * major key) as uppercase 'V' for visual consistency with the V's
 * scale-degree symbol — but the chord type 'm7' / 'm9' makes it a
 * minor target regardless of the label. Without this cross-check
 * the planner would slap Mixolydian on a v-minor target where
 * Phrygian Dominant is required.
 *
 *   Contains '°' / 'ø'       → diminished (forbidden — not a real tonic)
 *   Contains '/'             → already a secondary dom (don't nest)
 *   Type starts with 'm' but not 'maj'  → minor
 *   Type 'dim' / 'm7b5' / 'm9b5' → forbidden
 *   Otherwise: uppercase roman → major, lowercase → minor
 */
function targetQuality(roman: string, type: string): 'major' | 'minor' | 'forbidden' {
  if (!roman) return 'forbidden';
  if (roman.includes('°') || roman.includes('ø')) return 'forbidden';
  if (roman.includes('/')) return 'forbidden';
  // Chord-type-driven verdict — authoritative when the type is decided.
  if (type === 'dim' || type === 'dim7' || type === 'm7b5' || type === 'm9b5') {
    return 'forbidden';
  }
  if (type === 'aug' || type === '7#5' || type === '+5') {
    // Augmented isn't a tonic target either — too unstable to be "I".
    return 'forbidden';
  }
  const isMinorType = (type.startsWith('m') && !type.startsWith('maj'))
    || type === 'min';
  if (isMinorType) return 'minor';
  // Strip leading accidental(s)
  const stripped = roman.replace(/^[b#n]+/, '');
  if (!stripped) return 'forbidden';
  const firstLetter = stripped[0];
  if (/[A-Z]/.test(firstLetter)) return 'major';
  if (/[a-z]/.test(firstLetter)) return 'minor';
  return 'forbidden';
}

/**
 * Extract roman quality category for the TARGET_MULT lookup.
 * Returns a normalized form ('V', 'vi', 'IV', 'ii', 'iii', 'I', 'i')
 * or null if outside the known set.
 */
function targetKey(roman: string): string | null {
  if (!roman) return null;
  const stripped = roman.replace(/^[b#n]+/, '');
  // Match an initial run of I/V letters (case-sensitive)
  const m = stripped.match(/^([IVivXxXx]+)/);
  if (!m) return null;
  const head = m[1];
  // Normalize x → I (some sources use lowercase 'x' for chromatic mediant; rare)
  return head.replace(/x/gi, '');
}

export interface PlanTonicizationOptions {
  skeleton: ChordSkeletonSlot[];
  style: StyleName;
  motifInterval: number;  // phrase length in bars; planner skips i % N === 0
  random: PlannerRandom;
  beatsPerMeasure: number; // meter context — split slots get beats = bpm/2
  songKeyRootPc: number;  // absolute pc of the song key (0..11) — used to
                          // convert next.rootOffset (relative to song key)
                          // into an absolute localTonalCenterPc for the
                          // borrowed slot. Without this the Planner would
                          // store offsets that downstream consumers
                          // (evaluator, UI) misread as absolute pcs.
  /**
   * Per-song borrow source (P4 — same-degree substitution). Picked by
   * musicEngine.ts mode-aware distribution. The Tonicization Planner
   * uses this to color the V/X and ii/X chord types with parallel-mode
   * flavor (Aeolian → 7b13, Phrygian → 7b9, Mixolydian → 7sus4, Dorian
   * → 9). No chord insertion — only the dominant approach's type changes.
   *
   * Per user music-theory rule: "在离调region内的借用是同主音调式借用、
   * 同级替代" — instead of inserting a new bII/V or iv/V chord (which
   * makes target only play half a bar and "fly" the listening), the
   * tonicization's V/X itself carries the parallel-mode color.
   */
  borrowSource?: 'Aeolian' | 'Mixolydian' | 'Phrygian' | 'Dorian';
}

/**
 * Same-degree substitution table — V/X chord type by song borrow source
 * × local target quality. The dominant V approaching the local tonic
 * gets parallel-mode-flavored alterations:
 *   Aeolian   → b13 on V/X (Aeolian's b6 → V's b13 in local key)
 *   Dorian    → natural 9 (Dorian's bright extensions)
 *   Mixolydian → sus4 (Mixolydian's modal V is sus-like)
 *   Phrygian   → b9 (Phrygian Dominant)
 *
 * Minor targets default to 7b9 across sources (standard altered V to
 * minor-key cadence), with Phrygian source adding extra b13 for full
 * Phrygian Dominant intensity.
 */
const V_TYPE_BY_SOURCE_TARGET: Record<string, { major: string; minor: string }> = {
  Aeolian:    { major: '7b13', minor: '7b9' },
  Dorian:     { major: '9',    minor: '7b9' },
  Mixolydian: { major: '7sus4', minor: '7b9' },
  Phrygian:   { major: '7b9',   minor: '7b9' },
};

/**
 * Same-degree substitution table — ii/X chord type by borrow source.
 * Phrygian source darkens ii to m7b5 (matches Phrygian's ii° quality).
 * Other sources keep ii as standard m7 for major target, m7b5 for minor.
 */
const II_TYPE_BY_SOURCE_TARGET: Record<string, { major: string; minor: string }> = {
  Aeolian:    { major: 'm7',   minor: 'm7b5' },
  Dorian:     { major: 'm7',   minor: 'm7b5' },
  Mixolydian: { major: 'm7',   minor: 'm7b5' },
  Phrygian:   { major: 'm7b5', minor: 'm7b5' },
};

/**
 * Returns a new skeleton array. Original is not mutated.
 *
 * For each potential target at index i+1, the slot at index i is
 * REPLACED with a two-slot ii-V pair (each with beats = bpm/2)
 * approaching the target. The target itself stays at its original
 * position (now shifted by +1 in the new array).
 *
 * Skips the first slot (i=0 — nothing in front to sacrifice),
 * skips phrase boundaries, skips diminished/borrowed targets,
 * skips adjacent insertions (no consecutive tonicizations).
 */
export function planTonicization(opts: PlanTonicizationOptions): ChordSkeletonSlot[] {
  const { skeleton, style, motifInterval, random, beatsPerMeasure, songKeyRootPc, borrowSource } = opts;
  const baseProb = STYLE_TONICIZE_PROB[style] ?? 0;
  if (baseProb === 0 || skeleton.length < 2) return skeleton.slice();

  const maxFires = STYLE_TONICIZE_MAX_PER_SONG[style] ?? 0;
  let firesUsed = 0;

  const result: ChordSkeletonSlot[] = [];
  const splitBeats = Math.floor(beatsPerMeasure / 2);
  if (splitBeats < 1) return skeleton.slice();  // degenerate meter (1-beat bar etc.)

  // Track whether the PREVIOUS slot we emitted was a Planner-
  // inserted ii or V — used to avoid back-to-back insertions
  // (a triple-tonicize chain would over-saturate).
  let prevWasInserted = false;
  // Chain-cooldown counter — decremented per iteration after a fire.
  // While > 0, fire is blocked. Set to 2 after a fire so the NEXT TWO
  // bars are forced to be plain skeleton chords (the target X resolves
  // cleanly, listener gets a beat to absorb the temporary key).
  let chainCooldown = 0;
  // Repeated-target cooldown — remembers when each target pc was last
  // tonicized. The SAME target (vi at pc 9, V at pc 7, etc.) cannot
  // be re-tonicized within `repeatedTargetGapBars` bars of the
  // previous fire on that target.
  //
  // Without this, the planner can produce "ii/vi → vi  ...  ii/vi →
  // vi  ...  ii/vi → vi" three times in a row — listener perceives
  // this as a practice étude, not music. The general chainCooldown
  // (above) only blocks the next 2 bars regardless of target identity;
  // this map specifically tracks per-target reuse.
  //
  // Per user: "JAZZ 4 bar / 其它 8 bar 内同 target 不重复".
  const repeatedTargetGapBars = style === 'JAZZ' ? 4 : 8;
  const lastTonicizedTargetBar = new Map<number, number>();
  // Pending region tag — when a fire emits V/X targeting `next`, this
  // remembers (targetPcAbs, target's roman string) so the next slot
  // we push (= the resolution target) gets tagged with analysisKeyPc.
  // The target slot then sits IN the local tonicization region, ready
  // for the Local Tonicization Color Planner to insert local-key
  // borrowed flavor (iv/X / bII/X / bVII/X). Cleared after one use.
  let pendingTargetTag: { pc: number; targetRoman: string } | null = null;

  for (let i = 0; i < skeleton.length; i++) {
    const curr = skeleton[i];
    const next = i + 1 < skeleton.length ? skeleton[i + 1] : null;

    // Decide whether to tonicize next.
    //
    // First-phrase guard. Tonicization is disallowed in bars
    // 0..motifInterval-1 — the home key MUST be established before
    // any temporary tonic. Berklee / Open Music Theory rule: "phrase
    // beginnings typically feature a prolongation of tonic harmony to
    // establish the home key" / "when writing a modulating phrase,
    // establishing the home key with a standard tonic expansion is
    // recommended before moving to other tonal areas". Without this
    // guard, a song could open with V/vi → vi as bar 1-2, robbing the
    // listener of any home-key reference.
    //
    // Phrase-boundary guard (for phrases 2..N). At every bar that
    // begins a NEW phrase, don't tonicize either — the phrase start
    // is a structural re-anchor, not a place to drift.
    const isFirstPhrase = motifInterval > 0 && i < motifInterval;
    const isPhraseStart = motifInterval > 0 && i % motifInterval === 0;
    // Tonicization-target guard. If the PREVIOUS chord is a secondary
    // dominant resolving to the CURRENT chord (prev.roman = 'X/Y'
    // where Y matches curr.roman), the current chord is the resolution
    // target of an already-in-progress Tonicization. Replacing it with
    // another ii-V would orphan the V/Y → Y cadence the listener is
    // expecting (e.g. raw `V/iii → iii → IV` becomes broken
    // `V/iii → ii/IV → V/IV → IV` — the iii vanishes mid-resolution
    // and the ear hears the first Tonicization fizzle into a new key).
    // Mirror of the same guard in borrowedChordPlanner.ts.
    const prev = i > 0 ? result[result.length - 1] : null;
    let isPrevTonicizationTarget = false;
    if (prev) {
      const prevRoman = prev.roman ?? '';
      const slashSplit = prevRoman.split('/');
      if (slashSplit.length === 2) {
        const prevTarget = slashSplit[1];
        const currHead = curr.roman.replace(/^[b#n]+/, '').match(/^[IVivXx]+/)?.[0] ?? '';
        if (currHead === prevTarget) isPrevTonicizationTarget = true;
      }
    }
    // Home-key short-circuit. Tonicizing the song's home tonic
    // produces V/I (or V/i) — same sound and function as a plain
    // V → I cadence, no temporary tonal center is established.
    //
    // BUG fix: `next.rootOffset` is ALREADY RELATIVE to the song key
    // root (it's the slot's semitone offset from songKeyRootPc, in
    // [0, 12)). Comparing it to absolute songKeyRootPc was wrong —
    // it only happened to work for C key (where songKeyRootPc === 0).
    // In D / A / etc. keys, home-tonic slots have rootOffset = 0 but
    // songKeyRootPc != 0, so the check returned false and home was
    // wrongly tonicizable. Correct check: rootOffset === 0 means
    // "this slot's root == song key root" == home tonic.
    const isHomeTarget = next
      ? (((next.rootOffset % 12) + 12) % 12) === 0
      : false;
    let fire = false;
    const capReached = firesUsed >= maxFires;
    const onCooldown = chainCooldown > 0;
    // Per-target repeated-cooldown check
    const targetPcForCooldown = next
      ? ((songKeyRootPc + (((next.rootOffset % 12) + 12) % 12)) % 12)
      : -1;
    const lastBarForTarget = lastTonicizedTargetBar.get(targetPcForCooldown);
    const onTargetCooldown = lastBarForTarget !== undefined
      && (i - lastBarForTarget) < repeatedTargetGapBars;
    if (next && !prevWasInserted && !isFirstPhrase && !isPhraseStart && !curr.lockType && !isPrevTonicizationTarget && !isHomeTarget && !capReached && !onCooldown && !onTargetCooldown) {
      // ROLL — must consume one random regardless of subsequent gates
      // so the planner's stream stays deterministic across small
      // changes in target classification.
      const roll = random.next();
      const quality = targetQuality(next.roman, next.type);
      if (quality !== 'forbidden') {
        // Borrowed target: next was rewritten by the Borrowed-Chord
        // Planner. Allowed but gated to the song's second half and
        // weighted low (chromatic-mediant tonicization is a late-song
        // accent, not a home-key destabilizer).
        const nextIsBorrowed = next.borrowedSource === 'modal_interchange'
          || next.borrowedSource === 'backdoor_dominant'
          || next.borrowedSource === 'chromatic_color';
        let mult: number;
        if (nextIsBorrowed) {
          const isSecondHalf = i >= Math.floor(skeleton.length * 0.5);
          mult = isSecondHalf ? BORROWED_TARGET_MULT : 0;
        } else {
          const key = targetKey(next.roman);
          mult = (key !== null && TARGET_MULT[key] !== undefined)
            ? TARGET_MULT[key]
            : 0;
        }
        const effectiveProb = baseProb * mult;
        fire = roll < effectiveProb;
      }
    }

    if (!fire || !next) {
      // Push curr — but if there's a pending region tag from the
      // previous iteration's fire, this slot IS the resolution target.
      // Stamp analysisKeyPc + localRoman = 'I' / 'i' (target chord is
      // the local tonic, so its localRoman is 'I' when target was
      // major-quality, 'i' when minor) so the Local Tonicization
      // Color Planner knows this slot is in a local region.
      if (pendingTargetTag) {
        const targetQual = targetQuality(curr.roman, curr.type);
        const localRoman = targetQual === 'minor' ? 'i' : 'I';
        result.push({
          ...curr,
          analysisKeyPc: pendingTargetTag.pc,
          localRoman,
        });
        pendingTargetTag = null;
      } else {
        result.push(curr);
      }
      prevWasInserted = false;
      if (chainCooldown > 0) chainCooldown--;
      continue;
    }

    // Build ii-V approaching next.
    //
    // Two parallel representations of the target's pitch:
    //   targetOffset — semitones above SONG key root (0..11). This is
    //                  the same frame ChordSkeletonSlot.rootOffset
    //                  uses; realizeProgression resolves it into
    //                  an absolute root via (keyIndex + offset) % 12.
    //                  Use this for the ii / V slots' rootOffset field.
    //   targetPcAbs  — absolute pitch class (0..11) of the target
    //                  chord's root. This is what
    //                  ChordDef.localTonalCenterPc must carry — the
    //                  evaluator's INTERVAL_AESTHETICS layer reads it
    //                  as an absolute pc to derive the borrowed key's
    //                  leading-tone / expectedResolutions in the
    //                  target's frame.
    const quality = targetQuality(next.roman, next.type);  // 'major' | 'minor' — already filtered 'forbidden'
    const targetOffset = ((next.rootOffset % 12) + 12) % 12;
    const targetPcAbs = ((songKeyRootPc + targetOffset) % 12 + 12) % 12;
    const iiOffset = (targetOffset + 2) % 12;
    const VOffset  = (targetOffset + 7) % 12;

    // Region tagging gate (P5a — per user music-theory rule):
    //   "D9/A → G7b13 已经完成对 G 的局部 tonicization;如果后面马上要
    //    回 Cm,那后续和弦默认应该恢复到 C minor 视角."
    //
    // When target is the GLOBAL V (rootOffset === 7), the tonicization
    // is just a brief 2-5-to-V gesture, not a region establishment.
    // The V chord IS the home dominant — it does NOT stabilize as a
    // local tonic. So we DON'T tag V/X / ii/X / target slots with
    // analysisKeyPc / localRoman. The whole V/V → V → i becomes a
    // global cadence figure; subsequent Borrowed Planner rules (like
    // Rule G modal cadence) can fire freely on V.
    //
    // For other targets (vi, IV, ii, iii etc.), V is NOT the home
    // dominant — the target genuinely stabilizes as local I — so
    // region tagging proceeds as before.
    const targetIsHomeV = targetOffset === 7;
    const regionTagPc: number | undefined = targetIsHomeV ? undefined : targetPcAbs;
    const localRomanII: string | undefined = targetIsHomeV ? undefined : 'ii';
    const localRomanV: string | undefined  = targetIsHomeV ? undefined : 'V';

    const targetLabel = next.roman;
    let iiType: string;
    let VType: string;
    let forcedScale: string;
    // P4 — same-degree substitution. V/X and ii/X chord types are
    // colored by the per-song borrow source. Aeolian source adds b13
    // to V (parallel-minor's b6 → V's b13), Phrygian source uses b9
    // (Phrygian Dominant), Mixolydian uses sus (modal V), Dorian
    // uses bright 9. Without borrowSource (legacy / blues / etc.),
    // fall back to target-quality-only typing.
    if (borrowSource && V_TYPE_BY_SOURCE_TARGET[borrowSource]) {
      const vTable = V_TYPE_BY_SOURCE_TARGET[borrowSource];
      const iiTable = II_TYPE_BY_SOURCE_TARGET[borrowSource];
      VType = quality === 'major' ? vTable.major : vTable.minor;
      iiType = quality === 'major' ? iiTable.major : iiTable.minor;
      // forcedScale follows source signature too:
      // Phrygian source always picks Phrygian Dominant (regardless of
      // target quality); Mixolydian picks Mixolydian; others fall to
      // target-quality default.
      if (borrowSource === 'Phrygian') forcedScale = 'Phrygian Dominant';
      else if (borrowSource === 'Mixolydian') forcedScale = 'Mixolydian';
      else forcedScale = quality === 'major' ? 'Mixolydian' : 'Phrygian Dominant';
    } else {
      // Legacy fallback (no borrow source)
      if (quality === 'major') {
        iiType = 'm7';
        VType = '7';
        forcedScale = 'Mixolydian';
      } else {
        iiType = 'm7b5';
        VType = '7b9';
        forcedScale = 'Phrygian Dominant';
      }
    }

    // Build slot factories. ii slots are secondary_ii_v source
    // (when paired with V); V slots in light/approach mode are
    // secondary_dominant (lone V/X). Both must resolve.
    //
    // All Tonicization-Planner-emitted slots ARE inside the local
    // tonicization region — analysisKeyPc = targetPcAbs marks them as
    // such, and localRoman = 'ii' / 'V' is their roman analyzed against
    // the local center. The Local Tonicization Color Planner uses
    // analysisKeyPc to decide which slots can host local-key borrows.
    const iiSlotHalf: ChordSkeletonSlot = {
      roman: `ii/${targetLabel}`,
      type: iiType,
      scaleDegree: iiOffset,
      rootOffset: iiOffset,
      beats: splitBeats,
      localTonalCenterPc: targetPcAbs,
      analysisKeyPc: regionTagPc,
      localRoman: localRomanII,
      borrowedSource: 'secondary_ii_v' as BorrowedSource,
      mustResolve: true,
      lockType: true,
    };
    const VSlotHalf: ChordSkeletonSlot = {
      roman: `V/${targetLabel}`,
      type: VType,
      scaleDegree: VOffset,
      rootOffset: VOffset,
      beats: beatsPerMeasure - splitBeats,
      localTonalCenterPc: targetPcAbs,
      analysisKeyPc: regionTagPc,
      localRoman: localRomanV,
      forcedScale,
      borrowedSource: 'secondary_ii_v' as BorrowedSource,
      mustResolve: true,
      lockType: true,
    };
    const VSlotFull: ChordSkeletonSlot = {
      ...VSlotHalf,
      beats: beatsPerMeasure,
      borrowedSource: 'secondary_dominant' as BorrowedSource,  // light/approach = lone V/X
    };
    const iiSlotFull: ChordSkeletonSlot = {
      ...iiSlotHalf,
      beats: beatsPerMeasure,
    };
    // Approach mode: curr keeps its harmonic identity in first half,
    // then V/X picks up the second half. Inherits curr's roman / type
    // but with halved beats; the V/X slot follows.
    const currFirstHalf: ChordSkeletonSlot = {
      ...curr,
      beats: splitBeats,
    };

    // Per-placement output
    const placementRoll = random.next();
    let placement = pickPlacement(placementRoll, style);

    // full_2bar requires backward-modifying result[last]. Validate
    // prev availability — fall back to iiv_split when unavailable.
    if (placement === 'full_2bar') {
      const prevIdx = i - 1;
      const prevIsPhraseStart = motifInterval > 0 && prevIdx % motifInterval === 0;
      const prevIsFirstPhrase = motifInterval > 0 && prevIdx < motifInterval;
      const prevSlot = i > 0 && result.length > 0 ? skeleton[prevIdx] : null;
      // Block when:
      //   - i === 0 (no prev)
      //   - prev iteration inserted (result[last] is already Planner output)
      //   - prev is at phrase boundary (would overwrite phrase-start anchor)
      //   - prev is in first phrase (would destabilize home key)
      //   - prev is lockType (borrowed chord — don't overwrite Modal Interchange)
      const canFull2Bar = !!prevSlot && !prevWasInserted
        && !prevIsPhraseStart && !prevIsFirstPhrase && !prevSlot.lockType;
      if (!canFull2Bar) placement = 'iiv_split';
    }

    if (placement === 'light') {
      result.push({ ...VSlotFull, tonicizationPlacement: 'light' });
    } else if (placement === 'approach') {
      result.push(
        { ...currFirstHalf, tonicizationPlacement: 'approach' },
        { ...VSlotHalf,     tonicizationPlacement: 'approach' },
      );
    } else if (placement === 'iiv_split') {
      result.push(
        { ...iiSlotHalf, tonicizationPlacement: 'iiv_split' },
        { ...VSlotHalf,  tonicizationPlacement: 'iiv_split' },
      );
    } else {
      // full_2bar — backward-overwrite result[last] with ii/X full bar,
      // push V/X full bar. The classic standard-jazz 2-bar ii-V form.
      // V/X here is paired with ii (secondary_ii_v), not lone (secondary_dominant).
      result[result.length - 1] = { ...iiSlotFull, tonicizationPlacement: 'full_2bar' };
      result.push({
        ...VSlotFull,
        borrowedSource: 'secondary_ii_v' as BorrowedSource,
        tonicizationPlacement: 'full_2bar',
      });
    }
    prevWasInserted = true;
    firesUsed++;
    chainCooldown = 2;
    // Record this target's tonicization bar so the repeated-target
    // cooldown gate (above) can reject same-target fires within
    // `repeatedTargetGapBars` bars.
    lastTonicizedTargetBar.set(targetPcAbs, i);
    // Register the resolution target so the NEXT iteration (which will
    // push the original skeleton[i+1] = the target X) tags that slot
    // with analysisKeyPc + localRoman. This is how a single V/X → X
    // event creates a 1-bar local region:
    //   - V/X slot: analysisKeyPc = targetPc (set above)
    //   - X target slot (next iteration): analysisKeyPc = targetPc
    // Per user music-theory rule: "哪怕只有5级到1级 也是局部离调".
    //
    // EXCEPTION (P5a): when target is home V (rootOffset===7), don't
    // tag the target slot. V is the global dominant — it doesn't
    // stabilize as a local tonic post-resolution. The whole V/V → V → i
    // is a global cadence figure, not a persistent local region.
    pendingTargetTag = targetIsHomeV
      ? null
      : { pc: targetPcAbs, targetRoman: next.roman };
  }

  return result;
}
