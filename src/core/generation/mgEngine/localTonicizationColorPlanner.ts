// ==========================================
// localTonicizationColorPlanner.ts — Region-aware local borrowing.
//
// STATUS (P3 feedback): DISABLED via baseProb=0 for all styles.
//
// Background (user musicology rule):
//   "在定骨架的时候,定了离调那就是离调,哪怕一个BAR也会是局部离调.
//    这个局部离调的中心就是要遵守新主音来进行借用和弦,哪怕只有
//    5级到1级."
//
// What this Planner WOULD do (split-bar insertion mode, now disabled):
//   The Tonicization Planner produces V/X → X transitions that
//   establish a temporary tonal center. This Planner scans tagged
//   target slots and splits each into [target-half, color-half].
//
// Why disabled (per user listening on pop_xoce8n / jazz_5nujwe):
//   "在离调听感都没有建立完全就继续插入借用和弦了 ... 此刻不能插入借用,
//    而是同主音调式借用,同级替代,而不是插入. 这两个 seed 的听感是飞的."
//
//   Splitting the target slot into [target-half, color-half] means
//   the target chord only plays for half a bar before the color
//   chord interrupts it. Listener doesn't have time to absorb the
//   local tonicization landing before being thrown into a foreign
//   color. Empirically "flying" / unstable.
//
//   User's preferred direction: SAME-DEGREE SUBSTITUTION (Rule F
//   style — flip the EXISTING chord's quality to parallel-mode
//   equivalent), NOT insertion of new chords.
//
// Future (P4): re-implement as type-substitution mode that modifies
// V/X's chord type by borrow source (e.g. V/V dom7 → V/V 7b9 for
// Phrygian-source song), keeping the slot count and timing intact.
// For now, leave the data path in place (analysisKeyPc / localRoman
// tagging by Tonicization Planner still works) but skip materialization.
// ==========================================

import { ChordSkeletonSlot, StyleName, BorrowedSource } from './styleDictionary';

interface PlannerRandom {
  next(): number;
}

// DISABLED (P3 feedback): all 0 to bypass split-bar insertion. The
// planner function still runs and returns the input unchanged. Future
// P4 will re-introduce non-zero probs paired with the type-substitution
// mode (not the split-bar mode). See file header.
const STYLE_LOCAL_COLOR_PROB: Record<StyleName, number> = {
  POP: 0,
  JAZZ: 0,
  RNB: 0,
  BLUES: 0,
  LOFI: 0,
};

/**
 * Per-song max fires — caps regional color insertion across the song
 * to avoid every tonicization landing getting an extra borrowed flavor.
 */
const STYLE_LOCAL_COLOR_MAX_PER_SONG: Record<StyleName, number> = {
  POP: 1,
  JAZZ: 3,
  RNB: 2,
  BLUES: 0,
  LOFI: 0,
};

/**
 * Local borrowing patterns. Each maps to a (rootOffsetFromLocalCenter,
 * type, localRomanLabel) triple. The rule selector picks one of these
 * based on local target quality (major or minor target).
 */
interface LocalColorPattern {
  /** Display name for the choice */
  name: string;
  /** Semitones above the local center root */
  offsetFromLocal: number;
  /** Chord type */
  type: string;
  /** Roman numeral analyzed in local key (e.g. 'bII', 'iv') */
  localRoman: string;
  /** Selection weight within applicable pool */
  weight: number;
  /** Which local-target quality this applies to */
  appliesTo: 'major' | 'minor' | 'both';
}

const LOCAL_COLOR_PATTERNS: LocalColorPattern[] = [
  // bII (Phrygian / Neapolitan in local key)
  // Local G context: bII = Ab (G + 1 semi). In C global = bVI but
  // analyzed locally as bII of V → Neapolitan color before the next V.
  { name: 'bII (Phrygian)',  offsetFromLocal: 1,  type: 'maj7', localRoman: 'bII', weight: 0.5, appliesTo: 'both' },
  // bVI (parallel minor) — works in major target only
  // Local G context (major target): bVI = Eb. In C = bIII but locally bVI/V.
  { name: 'bVI (Aeolian)',   offsetFromLocal: 8,  type: 'maj7', localRoman: 'bVI', weight: 0.4, appliesTo: 'major' },
  // bVII (Mixolydian flat-7) — works in major target only
  // Local G context: bVII = F. In C = IV but locally bVII/V (Mixolydian sound).
  { name: 'bVII (Mixolydian)', offsetFromLocal: 10, type: 'maj',  localRoman: 'bVII', weight: 0.4, appliesTo: 'major' },
  // iv (parallel minor IV) — works in major target only
  // Local G context: iv = Cm. In C = i (home tonic!) but locally iv/V.
  // ★ this IS the user's canonical Cm/G = iv/V example ★
  { name: 'iv (parallel minor)', offsetFromLocal: 5,  type: 'm7',   localRoman: 'iv',  weight: 0.6, appliesTo: 'major' },
  // IV (Dorian raised-6) — works in minor target only
  // Local Am context (minor target): IV = D maj. Locally IV/vi (raised-6 Dorian color).
  { name: 'IV (Dorian raised-6)', offsetFromLocal: 5,  type: 'maj7', localRoman: 'IV',  weight: 0.5, appliesTo: 'minor' },
  // bII (Phrygian) listed first applies to both, repeated as 'both'
  // bVI for minor target — bVI in minor mode is native (Aeolian),
  // less interesting as borrow. Skipped.
];

export interface PlanLocalColorOptions {
  skeleton: ChordSkeletonSlot[];
  style: StyleName;
  random: PlannerRandom;
  beatsPerMeasure: number;
  songKeyRootPc: number;
}

/**
 * Returns a new skeleton array with optional local-color inserts on
 * tonicization target slots. Original array is not mutated.
 *
 * A "target slot" is one with analysisKeyPc set AND localRoman in
 * {'I', 'i'} AND analysisKeyPc !== songKeyRootPc (= temporary center
 * different from home). It must also be ≥ 2 beats (otherwise no room
 * for split) and not already lockType-locked.
 */
export function planLocalTonicizationColor(opts: PlanLocalColorOptions): ChordSkeletonSlot[] {
  const { skeleton, style, random, beatsPerMeasure, songKeyRootPc } = opts;
  const baseProb = STYLE_LOCAL_COLOR_PROB[style] ?? 0;
  if (baseProb === 0) return skeleton.slice();

  const maxFires = STYLE_LOCAL_COLOR_MAX_PER_SONG[style] ?? 0;
  let firesUsed = 0;
  const half = Math.floor(beatsPerMeasure / 2);
  if (half < 1) return skeleton.slice();

  const result: ChordSkeletonSlot[] = [];

  for (let i = 0; i < skeleton.length; i++) {
    const curr = skeleton[i];

    // ROLL once per slot for stream stability — even non-target slots
    // consume a roll so adding tags doesn't perturb other random
    // consumers downstream.
    // (Actually we only roll when slot is a candidate — keeps stream
    //  minimal. Random ordering is deterministic per seed regardless.)

    const isTargetSlot = curr.analysisKeyPc !== undefined
      && (curr.localRoman === 'I' || curr.localRoman === 'i')
      && curr.analysisKeyPc !== songKeyRootPc;

    const currBeats = curr.beats ?? beatsPerMeasure;

    if (!isTargetSlot || curr.lockType || currBeats < 2 || firesUsed >= maxFires) {
      result.push(curr);
      continue;
    }

    // next-slot guard. The slot AFTER the target IS the listener's
    // "return to home" / re-anchor moment. Inserting local color makes
    // sense only if that next slot exists, is a normal home-key chord,
    // AND isn't itself another tonicization region or a lockType slot.
    // Without this guard, local color could fire on a target whose
    // next slot is part of another in-progress tonicization (e.g. when
    // the song chains tonicizations vi → ii → V → I), producing a
    // jarring "G → Cm → ii/V → V" jump where Cm has no resolution.
    // Per user: "local color 加 next/next2 guard".
    const nextSlot = i + 1 < skeleton.length ? skeleton[i + 1] : null;
    if (!nextSlot) {
      result.push(curr); continue;
    }
    if (nextSlot.lockType) {
      // Next slot is Planner-locked (V/X / ii/X / another color) —
      // don't bracket the target with another color.
      result.push(curr); continue;
    }
    if (nextSlot.analysisKeyPc !== undefined && nextSlot.analysisKeyPc !== songKeyRootPc) {
      // Next slot is in a different tonicization region. Don't
      // straddle two regions with a local color.
      result.push(curr); continue;
    }

    // Roll for fire decision
    const roll = random.next();
    if (roll >= baseProb) {
      result.push(curr);
      continue;
    }

    // Pick a local-color pattern. Filter by target quality (localRoman).
    const localIsMinor = curr.localRoman === 'i';
    const applicable = LOCAL_COLOR_PATTERNS.filter(p =>
      p.appliesTo === 'both' || p.appliesTo === (localIsMinor ? 'minor' : 'major'),
    );
    if (applicable.length === 0) {
      result.push(curr);
      continue;
    }

    // Cumulative-weight pick using same roll (rescaled to [0, totalWeight))
    const totalWeight = applicable.reduce((s, p) => s + p.weight, 0);
    const pickRoll = (roll / baseProb) * totalWeight;
    let acc = 0;
    let picked: LocalColorPattern | null = null;
    for (const p of applicable) {
      acc += p.weight;
      if (pickRoll < acc) { picked = p; break; }
    }
    if (!picked) {
      result.push(curr);
      continue;
    }

    // Compute output slots:
    //   [target-half, local-color-half]
    // Both stay in the local region (analysisKeyPc preserved).
    const localCenterPc = curr.analysisKeyPc!;
    const globalRootOffset = (localCenterPc - songKeyRootPc + 12) % 12;
    const colorRootOffset = (globalRootOffset + picked.offsetFromLocal) % 12;

    // Build display roman: localRoman/targetParent. We don't know the
    // target's global roman directly here (it's curr.roman like 'vi'
    // or 'I'); fall back to localRoman as global display when target
    // IS home (won't happen due to isTargetSlot guard) or pure
    // localRoman as the display when no parent context.
    const parentRoman = curr.roman;  // e.g. 'vi' (the target X)
    const displayRoman = `${picked.localRoman}/${parentRoman}`;

    const targetHalf: ChordSkeletonSlot = {
      ...curr,
      beats: currBeats - half,
    };
    const colorHalf: ChordSkeletonSlot = {
      roman: displayRoman,
      type: picked.type,
      scaleDegree: 1,
      rootOffset: colorRootOffset,
      beats: half,
      borrowedFrom: `${picked.localRoman} of ${parentRoman} (local ${picked.name})`,
      borrowedSource: 'modal_interchange' as BorrowedSource,
      mustResolve: false,
      lockType: true,
      // analysisKeyPc preserves the region context for downstream
      // consumers (UI display, future audit). localTonalCenterPc is
      // NOT set here — that field is reserved for V/X / ii/X slots
      // (secondary_dom semantics: "key center this chord is V of").
      // A modal-interchange chord doesn't tonicize anything; it just
      // sits inside a region already established by V/X.
      analysisKeyPc: localCenterPc,
      localRoman: picked.localRoman,
    };

    result.push(targetHalf, colorHalf);
    firesUsed++;
  }

  return result;
}
