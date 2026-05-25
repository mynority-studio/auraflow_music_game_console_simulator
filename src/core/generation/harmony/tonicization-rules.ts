// ============================================================
// tonicization-rules.ts — Tonicization Planner(secondary ii-V)
// ============================================================
//
// 来源:melodygenerative/src/lib/tonicizationPlanner.ts(2026-05-25 port)
//
// Tonicization = 临时建立 new tonic by inserting its ii-V(或 V)前置。
// melody 必须 follow new center(跟 Borrowed Chord 区别 — 借调不改 tonic)。
//
// 4 placement(per-style weighted):
//   light       curr 整 bar 变 V/X
//   approach    curr 前半保留 + 后半 V/X
//   iiv_split   curr 整 bar = ii/X(半) + V/X(半)— 经典 jazz comping
//   full_2bar   prev bar 改 ii/X 全 + curr bar 改 V/X 全 — 最 authoritative jazz
//
// borrow-source coloring(P4 — same-degree substitution):
//   per song fork 选 borrow source(Aeolian / Mixolydian / Phrygian / Dorian),
//   V/X + ii/X 的 chord type 跟 source 走:
//     Aeolian source: V → 7b13, ii → m7
//     Mixolydian:     V → 7sus4, ii → m7
//     Phrygian:       V → 7b9, ii → m7b5
//     Dorian:         V → 9, ii → m7
//
// P5a(home V 例外):target = home V(rootOffset===7)时不 tag region。
// V 是 global dominant,不构成 local tonal center,允许 Borrowed Planner
// 后续 fire Mixolydian/Aeolian modal cadence rule。
//
// Per-target cooldown(JAZZ 4 bar / 其他 8 bar):同 target pc 在 cooldown 内不
// 重复 tonicize,避免"V/vi → vi → V/vi → vi"听感像 etude。
//
// chainCooldown:fire 后 2 bar 不再 fire,let target X resolve 干净。
//
// 独立 module:plain TonicizationChordInput in / TonicizationChordInput[] out。
// ============================================================

export interface TonicizationChordInput {
  roman: string;
  type: string;
  scaleDegree?: number;
  rootOffset: number;
  beats?: number;
  mustResolve?: boolean;
  lockType?: boolean;
  borrowedFrom?: string;
  borrowedSource?: string;
  effectiveFunc?: 'T' | 'S' | 'D';
  analysisKeyPc?: number;
  localTonalCenterPc?: number;
  localRoman?: string;
  forcedScale?: string;
  tonicizationPlacement?: 'light' | 'approach' | 'iiv_split' | 'full_2bar';
}

export type Placement = 'light' | 'approach' | 'iiv_split' | 'full_2bar';

// PlannerRandom 跟 borrow-rules.ts 同名 — 避免重复 export,直接 import
import type { PlannerRandom } from './borrow-rules';
export type { PlannerRandom };

// ─────────────────────────────────────────────────────────────────
// Per-style constants
// ─────────────────────────────────────────────────────────────────

export const STYLE_TONICIZE_PROB: Record<string, number> = {
  POP: 0.30,
  JAZZ: 0.65,
  RNB: 0.40,
  BLUES: 0,
  LOFI: 0,
};

export const STYLE_TONICIZE_MAX_PER_SONG: Record<string, number> = {
  POP: 2,
  JAZZ: 4,
  RNB: 3,
  BLUES: 0,
  LOFI: 0,
};

export const STYLE_PLACEMENT_WEIGHTS: Record<string, { light: number; approach: number; iiv_split: number; full_2bar: number }> = {
  POP:   { light: 0.45, approach: 0.35, iiv_split: 0.20, full_2bar: 0    },
  JAZZ:  { light: 0.10, approach: 0.15, iiv_split: 0.45, full_2bar: 0.30 },
  RNB:   { light: 0.30, approach: 0.30, iiv_split: 0.30, full_2bar: 0.10 },
  BLUES: { light: 0, approach: 0, iiv_split: 0, full_2bar: 0 },
  LOFI:  { light: 0, approach: 0, iiv_split: 0, full_2bar: 0 },
};

/** Target-frequency multipliers — V/vi/IV/ii 是 pop staples,iii 稀有 */
export const TARGET_MULT: Record<string, number> = {
  V: 1.0, v: 1.0,
  vi: 1.0, VI: 1.0,
  IV: 1.0, iv: 1.0,
  ii: 1.0, II: 1.0,
  iii: 0.5, III: 0.5,
};

const BORROWED_TARGET_MULT = 0;  // 禁止 Tonicization → borrowed chord(避免 Modal Interchange 复杂化)

/** Per-song borrow-source 着色 V/X chord type */
export const V_TYPE_BY_SOURCE_TARGET: Record<string, { major: string; minor: string }> = {
  Aeolian:    { major: '7b13', minor: '7b9' },
  Dorian:     { major: '9',    minor: '7b9' },
  Mixolydian: { major: '7sus4', minor: '7b9' },
  Phrygian:   { major: '7b9',   minor: '7b9' },
};

/** Per-song borrow-source 着色 ii/X chord type */
export const II_TYPE_BY_SOURCE_TARGET: Record<string, { major: string; minor: string }> = {
  Aeolian:    { major: 'm7',   minor: 'm7b5' },
  Dorian:     { major: 'm7',   minor: 'm7b5' },
  Mixolydian: { major: 'm7',   minor: 'm7b5' },
  Phrygian:   { major: 'm7b5', minor: 'm7b5' },
};

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function pickPlacement(roll: number, style: string): Placement {
  const w = STYLE_PLACEMENT_WEIGHTS[style] ?? STYLE_PLACEMENT_WEIGHTS['POP']!;
  if (roll < w.light) return 'light';
  if (roll < w.light + w.approach) return 'approach';
  if (roll < w.light + w.approach + w.iiv_split) return 'iiv_split';
  return 'full_2bar';
}

export function targetQuality(roman: string, type: string): 'major' | 'minor' | 'forbidden' {
  if (!roman) return 'forbidden';
  if (roman.includes('°') || roman.includes('ø')) return 'forbidden';
  if (roman.includes('/')) return 'forbidden';
  if (type === 'dim' || type === 'dim7' || type === 'm7b5' || type === 'm9b5') return 'forbidden';
  if (type === 'aug' || type === '7#5' || type === '+5') return 'forbidden';
  const isMinorType = (type.startsWith('m') && !type.startsWith('maj')) || type === 'min';
  if (isMinorType) return 'minor';
  const stripped = roman.replace(/^[b#n]+/, '');
  if (!stripped) return 'forbidden';
  const firstLetter = stripped[0]!;
  if (/[A-Z]/.test(firstLetter)) return 'major';
  if (/[a-z]/.test(firstLetter)) return 'minor';
  return 'forbidden';
}

export function targetKey(roman: string): string | null {
  if (!roman) return null;
  const stripped = roman.replace(/^[b#n]+/, '');
  const m = stripped.match(/^([IVivXxXx]+)/);
  if (!m) return null;
  return m[1]!.replace(/x/gi, '');
}

// ─────────────────────────────────────────────────────────────────
// Planner
// ─────────────────────────────────────────────────────────────────

export interface PlanTonicizationOptions {
  skeleton: TonicizationChordInput[];
  style: string;
  motifInterval: number;
  random: PlannerRandom;
  beatsPerMeasure: number;
  songKeyRootPc: number;
  borrowSource?: 'Aeolian' | 'Mixolydian' | 'Phrygian' | 'Dorian';
}

export function planTonicization(opts: PlanTonicizationOptions): TonicizationChordInput[] {
  const { skeleton, style, motifInterval, random, beatsPerMeasure, songKeyRootPc, borrowSource } = opts;
  const baseProb = STYLE_TONICIZE_PROB[style] ?? 0;
  if (baseProb === 0 || skeleton.length < 2) return skeleton.slice();
  const maxFires = STYLE_TONICIZE_MAX_PER_SONG[style] ?? 0;
  let firesUsed = 0;
  const splitBeats = Math.floor(beatsPerMeasure / 2);
  if (splitBeats < 1) return skeleton.slice();

  const result: TonicizationChordInput[] = [];
  let prevWasInserted = false;
  let chainCooldown = 0;
  // Per-target cooldown(JAZZ 4 bar / 其他 8 bar)
  const repeatedTargetGapBars = style === 'JAZZ' ? 4 : 8;
  const lastTonicizedTargetBar = new Map<number, number>();
  // pending region tag — fire 后给下一 iteration 的 target slot 加 analysisKeyPc
  let pendingTargetTag: { pc: number } | null = null;

  for (let i = 0; i < skeleton.length; i++) {
    const curr = skeleton[i]!;
    const next = i + 1 < skeleton.length ? skeleton[i + 1]! : null;

    const isFirstPhrase = motifInterval > 0 && i < motifInterval;
    const isPhraseStart = motifInterval > 0 && i % motifInterval === 0;

    // 检测 prev 是否是 V/X 解决到 curr(curr 是 in-progress tonicization 的 target)
    const prev = i > 0 && result.length > 0 ? result[result.length - 1]! : null;
    let isPrevTonicizationTarget = false;
    if (prev) {
      const prevRoman = prev.roman ?? '';
      const slashSplit = prevRoman.split('/');
      if (slashSplit.length === 2) {
        const prevTarget = slashSplit[1]!;
        const currHead = curr.roman.replace(/^[b#n]+/, '').match(/^[IVivXx]+/)?.[0] ?? '';
        if (currHead === prevTarget) isPrevTonicizationTarget = true;
      }
    }

    // home target short-circuit(rootOffset===0 = 跟 key 同 root)
    const isHomeTarget = next ? (((next.rootOffset % 12) + 12) % 12) === 0 : false;

    let fire = false;
    const capReached = firesUsed >= maxFires;
    const onCooldown = chainCooldown > 0;
    const targetPcForCooldown = next ? ((songKeyRootPc + (((next.rootOffset % 12) + 12) % 12)) % 12) : -1;
    const lastBarForTarget = lastTonicizedTargetBar.get(targetPcForCooldown);
    const onTargetCooldown = lastBarForTarget !== undefined
      && (i - lastBarForTarget) < repeatedTargetGapBars;

    if (next && !prevWasInserted && !isFirstPhrase && !isPhraseStart && !curr.lockType
        && !isPrevTonicizationTarget && !isHomeTarget && !capReached && !onCooldown && !onTargetCooldown) {
      const roll = random.next();
      const quality = targetQuality(next.roman, next.type);
      if (quality !== 'forbidden') {
        const nextIsBorrowed = next.borrowedSource === 'modal_interchange'
          || next.borrowedSource === 'backdoor_dominant';
        let mult: number;
        if (nextIsBorrowed) {
          const isSecondHalf = i >= Math.floor(skeleton.length * 0.5);
          mult = isSecondHalf ? BORROWED_TARGET_MULT : 0;
        } else {
          const key = targetKey(next.roman);
          mult = (key !== null && TARGET_MULT[key] !== undefined) ? TARGET_MULT[key]! : 0;
        }
        fire = roll < baseProb * mult;
      }
    }

    if (!fire || !next) {
      // 落 pending target tag(如果上次 fire 了)
      if (pendingTargetTag) {
        const targetQual = targetQuality(curr.roman, curr.type);
        const localRoman = targetQual === 'minor' ? 'i' : 'I';
        result.push({ ...curr, analysisKeyPc: pendingTargetTag.pc, localRoman });
        pendingTargetTag = null;
      } else {
        result.push(curr);
      }
      prevWasInserted = false;
      if (chainCooldown > 0) chainCooldown--;
      continue;
    }

    // Build ii-V approaching next
    const quality = targetQuality(next.roman, next.type) as 'major' | 'minor';
    const targetOffset = ((next.rootOffset % 12) + 12) % 12;
    const targetPcAbs = ((songKeyRootPc + targetOffset) % 12 + 12) % 12;
    const iiOffset = (targetOffset + 2) % 12;
    const VOffset = (targetOffset + 7) % 12;

    // P5a — home V target(rootOffset===7)不 tag region
    const targetIsHomeV = targetOffset === 7;
    const regionTagPc: number | undefined = targetIsHomeV ? undefined : targetPcAbs;
    const localRomanII: string | undefined = targetIsHomeV ? undefined : 'ii';
    const localRomanV: string | undefined = targetIsHomeV ? undefined : 'V';

    const targetLabel = next.roman;
    let iiType: string;
    let VType: string;
    let forcedScale: string;
    if (borrowSource && V_TYPE_BY_SOURCE_TARGET[borrowSource]) {
      const vTable = V_TYPE_BY_SOURCE_TARGET[borrowSource]!;
      const iiTable = II_TYPE_BY_SOURCE_TARGET[borrowSource]!;
      VType = quality === 'major' ? vTable.major : vTable.minor;
      iiType = quality === 'major' ? iiTable.major : iiTable.minor;
      if (borrowSource === 'Phrygian') forcedScale = 'Phrygian Dominant';
      else if (borrowSource === 'Mixolydian') forcedScale = 'Mixolydian';
      else forcedScale = quality === 'major' ? 'Mixolydian' : 'Phrygian Dominant';
    } else {
      if (quality === 'major') { iiType = 'm7'; VType = '7'; forcedScale = 'Mixolydian'; }
      else { iiType = 'm7b5'; VType = '7b9'; forcedScale = 'Phrygian Dominant'; }
    }

    const iiSlotHalf: TonicizationChordInput = {
      roman: `ii/${targetLabel}`, type: iiType, scaleDegree: iiOffset, rootOffset: iiOffset,
      beats: splitBeats, localTonalCenterPc: targetPcAbs, analysisKeyPc: regionTagPc, localRoman: localRomanII,
      borrowedSource: 'secondary_ii_v', mustResolve: true, lockType: true,
    };
    const VSlotHalf: TonicizationChordInput = {
      roman: `V/${targetLabel}`, type: VType, scaleDegree: VOffset, rootOffset: VOffset,
      beats: beatsPerMeasure - splitBeats, localTonalCenterPc: targetPcAbs, analysisKeyPc: regionTagPc, localRoman: localRomanV,
      forcedScale, borrowedSource: 'secondary_ii_v', mustResolve: true, lockType: true,
    };
    const VSlotFull: TonicizationChordInput = {
      ...VSlotHalf, beats: beatsPerMeasure, borrowedSource: 'secondary_dominant',
    };
    const iiSlotFull: TonicizationChordInput = { ...iiSlotHalf, beats: beatsPerMeasure };
    const currFirstHalf: TonicizationChordInput = { ...curr, beats: splitBeats };

    const placementRoll = random.next();
    let placement = pickPlacement(placementRoll, style);
    if (placement === 'full_2bar') {
      const prevIdx = i - 1;
      const prevIsPhraseStart = motifInterval > 0 && prevIdx % motifInterval === 0;
      const prevIsFirstPhrase = motifInterval > 0 && prevIdx < motifInterval;
      const prevSlot = i > 0 && result.length > 0 ? skeleton[prevIdx]! : null;
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
      // full_2bar:backward-overwrite result[last]
      result[result.length - 1] = { ...iiSlotFull, tonicizationPlacement: 'full_2bar' };
      result.push({
        ...VSlotFull,
        borrowedSource: 'secondary_ii_v',
        tonicizationPlacement: 'full_2bar',
      });
    }
    prevWasInserted = true;
    firesUsed++;
    chainCooldown = 2;
    lastTonicizedTargetBar.set(targetPcAbs, i);
    pendingTargetTag = targetIsHomeV ? null : { pc: targetPcAbs };
  }
  return result;
}
