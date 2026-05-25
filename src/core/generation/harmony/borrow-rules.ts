// ============================================================
// borrow-rules.ts — 10 条借调规则(Modal Interchange via positional rules)
// ============================================================
//
// 来源:melodygenerative/src/lib/borrowedChordPlanner.ts(2026-05-25 完整 port)
//
// Vocabulary:
//   Borrowed Chord (Modal Interchange) — 平行调同主音的不同 mode 借来的 chord,
//   插在特定 functional 位置加色。歌曲 tonal center 不变,melody 不换 scale。
//
// 10 rules(per-rule weight + source mode + apply function):
//
//   A1  IV → iv → T(Aeolian,"sigh color" cadential)
//   A2  iv → bVII7 → I(Aeolian,backdoor cadence)
//   B   vi → bVI → V(Aeolian,chromatic D-prefix)
//   C   ii-V → bVI → bVII → I(Aeolian,cadential chain)
//   D   bII insertion(Phrygian,3 patterns):
//         Pattern 1:iv → bII → i(cadential darkening)
//         Pattern 2:curr → bII → V(Neapolitan predominant)
//         Pattern 3:i → bII → iv(embedded color)
//   E1  I → bVII → IV(Mixolydian,rock color before subdominant)
//   E2  I → bIII → IV(Aeolian source,chromatic mediant)
//   E3  V → bVII → I(Mixolydian cadence — Beatles / classic rock)
//   F   Dorian IV raised-6(Aeolian → Dorian IV major triad,minor mode only)
//   G   V → bVII → i(Aeolian modal cadence,minor only,bypassSourceFilter)
//
// Single-source borrow policy:per song fork 抽 1 个 source mode,只 fire 同源
// rules(Aeolian / Mixolydian / Phrygian / Dorian)。带 bypassSourceFilter 的
// rule(如 G)不受限。
//
// 独立 module:不依赖任何引擎 IR,纯 BorrowChordInput in / BorrowChordInput[] out。
// caller(AF2 BorrowChordPlannerPlugin / ImproCore Borrow stage)做 adapter。
// ============================================================

// ─────────────────────────────────────────────────────────────────
// Plain data interface
// ─────────────────────────────────────────────────────────────────

/** Caller 传入的 chord slot(等同 ChordSkeletonSlot 但 plain object) */
export interface BorrowChordInput {
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
}

export type BorrowSource = 'Aeolian' | 'Mixolydian' | 'Phrygian' | 'Dorian';

type PhraseRole = 'start' | 'middle' | 'cadence' | 'ending';

export interface BorrowedRule {
  name: string;
  weight: number;
  source: BorrowSource;
  bypassSourceFilter?: boolean;
  appliesInMode?: 'minor' | 'major' | 'both';
  apply: (
    curr: BorrowChordInput,
    prev: BorrowChordInput | null,
    prev2: BorrowChordInput | null,
    next: BorrowChordInput | null,
    phraseRole: PhraseRole,
    bpm: number,
  ) => BorrowChordInput[] | null;
}

export interface PlannerRandom { next(): number; }

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function romanHead(roman: string): string {
  if (!roman) return '';
  const stripped = roman.replace(/^[b#n]+/, '');
  return stripped.match(/^[IVivXx]+/)?.[0] ?? '';
}

type Quality = 'maj' | 'min' | 'dom' | 'dim' | 'sus' | 'other';

function chordQuality(type: string): Quality {
  if (!type) return 'other';
  if (type === 'm7b5' || type === 'm9b5' || type === 'dim' || type === 'dim7') return 'dim';
  if (type.startsWith('sus') || type === '7sus4' || type === '9sus4') return 'sus';
  if (type === 'maj' || type === 'maj7' || type === 'maj9' || type === 'maj13'
      || type === 'maj7#11' || type === 'add9' || type === '6' || type === '6/9') return 'maj';
  if (type.startsWith('m') && !type.startsWith('maj')) return 'min';
  if (type === '7' || type === '9' || type === '11' || type === '13'
      || type === '7b9' || type === '7#9' || type === '7b13'
      || type === '7#11' || type === '7alt') return 'dom';
  return 'other';
}

function tsdFunction(roman: string): 'T' | 'S' | 'D' {
  if (!roman) return 'T';
  if (roman.includes('/')) return 'D';
  const base = roman.split('/')[0]!.replace(
    /maj7|maj9|maj13|m7|m9|m11|sus4|7sus4|9sus4|7b13|7#9|7alt|dim|aug|\+|o|ø|[0-9]/g, '',
  );
  if (['V', 'v', 'vii', 'VII'].includes(base)) return 'D';
  if (['IV', 'iv', 'ii', 'II', 'bVII'].includes(base)) return 'S';
  return 'T';
}

function classifyPhraseRole(i: number, total: number, motifInterval: number): PhraseRole {
  if (i === total - 1) return 'ending';
  if (motifInterval > 0 && (i + 1) % motifInterval === 0) return 'cadence';
  if (motifInterval > 0 && i % motifInterval === 0) return 'start';
  return 'middle';
}

// ─────────────────────────────────────────────────────────────────
// 10 Rules
// ─────────────────────────────────────────────────────────────────

export const RULE_A1: BorrowedRule = {
  name: 'A1: IV → iv → T',
  weight: 1.0,
  source: 'Aeolian',
  apply: (curr, _prev, _prev2, next) => {
    if (romanHead(curr.roman) !== 'IV') return null;
    if (chordQuality(curr.type) !== 'maj') return null;
    if (!next) return null;
    if (tsdFunction(next.roman) !== 'T') return null;
    return [{
      ...curr,
      type: 'm7',
      roman: 'iv',
      borrowedFrom: 'iv (parallel minor)',
      borrowedSource: 'modal_interchange',
      mustResolve: false,
      lockType: true,
    }];
  },
};

export const RULE_A2: BorrowedRule = {
  name: 'A2: iv → bVII7 → I (backdoor)',
  weight: 0.8,
  source: 'Aeolian',
  apply: (curr, _prev, _prev2, next, _phraseRole, bpm) => {
    if (romanHead(curr.roman) !== 'IV') return null;
    if (chordQuality(curr.type) !== 'maj') return null;
    if (!next) return null;
    const nextHead = romanHead(next.roman);
    if (nextHead !== 'I' && nextHead !== 'i') return null;
    const half = Math.floor(bpm / 2);
    const currBeats = curr.beats ?? bpm;
    if (currBeats < 2) return null;
    return [
      {
        ...curr,
        type: 'm7', roman: 'iv',
        borrowedFrom: 'iv (parallel minor)',
        borrowedSource: 'modal_interchange',
        mustResolve: false, beats: half, lockType: true,
      },
      {
        roman: 'bVII7', type: '7', scaleDegree: 7, rootOffset: 10,
        beats: currBeats - half,
        borrowedFrom: 'bVII7 (backdoor cadence)',
        borrowedSource: 'backdoor_dominant',
        mustResolve: true, effectiveFunc: 'D', lockType: true,
      },
    ];
  },
};

export const RULE_B: BorrowedRule = {
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
        roman: 'bVI', type: 'maj7', scaleDegree: 6, rootOffset: 8,
        beats: half,
        borrowedFrom: 'bVI (parallel minor)',
        borrowedSource: 'modal_interchange',
        mustResolve: false, lockType: true,
      },
      { ...curr, beats: currBeats - half },
    ];
  },
};

export const RULE_C: BorrowedRule = {
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
    const insertBeats = Math.max(1, Math.floor(currBeats / 4));
    const remainingI = currBeats - 2 * insertBeats;
    if (remainingI < 1) return null;
    return [
      {
        roman: 'bVI', type: 'maj7', scaleDegree: 6, rootOffset: 8, beats: insertBeats,
        borrowedFrom: 'bVI (cadential chain)',
        borrowedSource: 'modal_interchange', mustResolve: false, lockType: true,
      },
      {
        roman: 'bVII', type: 'maj7', scaleDegree: 7, rootOffset: 10, beats: insertBeats,
        borrowedFrom: 'bVII (cadential chain)',
        borrowedSource: 'modal_interchange', mustResolve: false, lockType: true,
      },
      { ...curr, beats: remainingI },
    ];
  },
};

export const RULE_D: BorrowedRule = {
  name: 'D: bII insertion (Phrygian — 3 patterns)',
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

    const bIISlot: BorrowChordInput = {
      roman: 'bII', type: 'maj7', scaleDegree: 1, rootOffset: 1, beats: half,
      borrowedFrom: 'bII (Phrygian)',
      borrowedSource: 'modal_interchange',
      mustResolve: false, lockType: true,
    };

    // Pattern 1: iv → bII → i  (cadential darkening)
    if ((currHead === 'IV' || currHead === 'iv') && (nextHead === 'I' || nextHead === 'i')) {
      return [{ ...curr, beats: currBeats - half }, bIISlot];
    }
    // Pattern 2: ... → bII → V  (Neapolitan predominant)
    if (nextHead === 'V') {
      return [
        { ...curr, beats: currBeats - half },
        { ...bIISlot, mustResolve: true, borrowedFrom: 'bII (Phrygian / Neapolitan)' },
      ];
    }
    // Pattern 3: i → bII → iv  (embedded color)
    if ((currHead === 'IV' || currHead === 'iv') && (prevHead === 'I' || prevHead === 'i')) {
      return [bIISlot, { ...curr, beats: currBeats - half }];
    }
    return null;
  },
};

export const RULE_E1: BorrowedRule = {
  name: 'E1: I → bVII → IV (Mixolydian rock)',
  weight: 0.6,
  source: 'Mixolydian',
  apply: (curr, prev, _prev2, _next, _phraseRole, bpm) => {
    if (romanHead(curr.roman) !== 'IV') return null;
    if (chordQuality(curr.type) !== 'maj') return null;
    if (!prev || romanHead(prev.roman) !== 'I') return null;
    const half = Math.floor(bpm / 2);
    const currBeats = curr.beats ?? bpm;
    if (currBeats < 2) return null;
    return [
      {
        roman: 'bVII', type: 'maj', scaleDegree: 7, rootOffset: 10, beats: half,
        borrowedFrom: 'bVII (Mixolydian — rock color)',
        borrowedSource: 'modal_interchange', mustResolve: false, lockType: true,
      },
      { ...curr, beats: currBeats - half },
    ];
  },
};

export const RULE_E2: BorrowedRule = {
  name: 'E2: I → bIII → IV (chromatic mediant)',
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
        roman: 'bIII', type: 'maj', scaleDegree: 3, rootOffset: 3, beats: half,
        borrowedFrom: 'bIII (parallel minor / chromatic mediant)',
        borrowedSource: 'modal_interchange', mustResolve: false, lockType: true,
      },
      { ...curr, beats: currBeats - half },
    ];
  },
};

export const RULE_E3: BorrowedRule = {
  name: 'E3: V → bVII → I (Mixolydian cadence)',
  weight: 0.55,
  source: 'Mixolydian',
  apply: (curr, _prev, _prev2, next, _phraseRole, bpm) => {
    if (romanHead(curr.roman) !== 'V') return null;
    const q = chordQuality(curr.type);
    if (q !== 'maj' && q !== 'dom') return null;
    if (!next || romanHead(next.roman) !== 'I') return null;
    const half = Math.floor(bpm / 2);
    const currBeats = curr.beats ?? bpm;
    if (currBeats < 2) return null;
    return [
      { ...curr, beats: currBeats - half },
      {
        roman: 'bVII', type: 'maj', scaleDegree: 7, rootOffset: 10, beats: half,
        borrowedFrom: 'bVII (Mixolydian — V→bVII→I cadence)',
        borrowedSource: 'modal_interchange', mustResolve: false, lockType: true,
      },
    ];
  },
};

export const RULE_F: BorrowedRule = {
  name: 'F: Dorian IV (raised 6,minor mode)',
  weight: 0.55,
  source: 'Dorian',
  appliesInMode: 'minor',
  apply: (curr) => {
    const currHead = romanHead(curr.roman);
    if (currHead !== 'IV' && currHead !== 'iv') return null;
    if (chordQuality(curr.type) !== 'min') return null;
    // Dorian IV type mapping(raised 6 + 保 b7)
    let newType: string;
    if (curr.type === 'm7') newType = '7';
    else if (curr.type === 'm9') newType = '9';
    else if (curr.type === 'm11') newType = '13sus4';
    else newType = 'maj';
    return [{
      ...curr,
      type: newType, roman: 'IV',
      borrowedFrom: 'IV (Dorian — raised 6)',
      borrowedSource: 'modal_interchange',
      mustResolve: false, lockType: true,
    }];
  },
};

export const RULE_G: BorrowedRule = {
  name: 'G: V → bVII → i (Aeolian modal cadence,minor)',
  weight: 0.45,
  source: 'Aeolian',
  bypassSourceFilter: true,  // 全 minor mode 都允许(bVII 在所有小调源都有)
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
        roman: 'bVII', type: 'maj', scaleDegree: 7, rootOffset: 10, beats: half,
        borrowedFrom: 'bVII (Aeolian modal cadence — V→bVII→i)',
        borrowedSource: 'modal_interchange', mustResolve: false, lockType: true,
      },
    ];
  },
};

/**
 * Rule 优先级(window 最窄优先,先 match 先 fire)。
 */
export const BORROW_RULES: BorrowedRule[] = [
  RULE_C,   // ii-V-I + phrase ending(最窄)
  RULE_A2,  // backdoor(比 A1 窄)
  RULE_F,   // Dorian IV quality flip(minor only)
  RULE_D,   // bII insertion 3 patterns(Phrygian)
  RULE_G,   // V → bVII → i Aeolian modal cadence(minor only)
  RULE_E1,  // I → bVII → IV(Mixolydian)
  RULE_E2,  // I → bIII → IV(Aeolian chromatic mediant)
  RULE_E3,  // V → bVII → I(Mixolydian cadence)
  RULE_B,   // vi-V context(Aeolian)
  RULE_A1,  // 最 generic(Aeolian)
];

// ─────────────────────────────────────────────────────────────────
// Simplified planner — single-pass, source filter + maxFires
// ─────────────────────────────────────────────────────────────────
//
// 原 melodygenerative 含 reserved-slot guard + tonicization zone protection +
// re-anchor reservation 等复杂 guard,本简化版只保留:
//   - source filter(rule.source 必须 === songBorrowSource,bypassSourceFilter 例外)
//   - appliesInMode 检查(major / minor only)
//   - maxFires per song(STYLE_MAX_BORROWS_PER_SONG)
//   - first-phrase guard(前 motifInterval bar 不 borrow)
//   - weighted random gate(rule.weight × baseProb)
// ─────────────────────────────────────────────────────────────────

export interface PlanBorrowedOptions {
  skeleton: BorrowChordInput[];
  baseProb: number;             // STYLE_BORROW_PROB(POP 0.45 / JAZZ 0.35 / RNB 0.55 / BLUES 0 / LOFI 0)
  maxFires: number;             // STYLE_MAX_BORROWS_PER_SONG(POP 3 / JAZZ 4 / RNB 5)
  motifInterval: number;        // phrase 长度(典型 4 bar)
  random: PlannerRandom;
  beatsPerMeasure: number;
  mode: string;                 // 'Ionian' / 'Aeolian' / 等
  borrowSource: BorrowSource;
  isMinorKey: boolean;
}

/** modal home mode 不 borrow(已经是 borrow 风格,再加困惑) */
const MODAL_HOME_MODES = new Set([
  'Dorian', 'Phrygian', 'Lydian', 'Mixolydian', 'Locrian',
  'Blues', 'Major Blues', 'Minor Blues', 'Composite Blues',
  'Bebop Dominant', 'Bebop Major', 'Phrygian Dominant', 'Lydian Dominant',
]);

export function planBorrowedChords(opts: PlanBorrowedOptions): BorrowChordInput[] {
  const { skeleton, baseProb, maxFires, motifInterval, random, beatsPerMeasure, mode, borrowSource, isMinorKey } = opts;
  if (baseProb === 0 || skeleton.length < 2 || maxFires === 0) return skeleton.slice();
  if (MODAL_HOME_MODES.has(mode)) return skeleton.slice();

  let firesUsed = 0;
  const result: BorrowChordInput[] = [];
  for (let i = 0; i < skeleton.length; i++) {
    const curr = skeleton[i]!;
    if (curr.lockType) { result.push(curr); continue; }
    // skip secondary dominants(V/X / subV/X)
    if (curr.roman.includes('/')) { result.push(curr); continue; }
    // first-phrase guard
    if (motifInterval > 0 && i < motifInterval) { result.push(curr); continue; }
    if (firesUsed >= maxFires) { result.push(curr); continue; }

    const prev = result.length > 0 ? result[result.length - 1]! : null;
    const prev2 = result.length > 1 ? result[result.length - 2]! : null;
    const next = i + 1 < skeleton.length ? skeleton[i + 1]! : null;
    const phraseRole = classifyPhraseRole(i, skeleton.length, motifInterval);

    let fired = false;
    for (const rule of BORROW_RULES) {
      if (!rule.bypassSourceFilter && rule.source !== borrowSource) continue;
      if (rule.appliesInMode === 'minor' && !isMinorKey) continue;
      if (rule.appliesInMode === 'major' && isMinorKey) continue;

      // weighted gate
      const roll = random.next();
      if (roll >= baseProb * rule.weight) continue;

      const replacement = rule.apply(curr, prev, prev2, next, phraseRole, beatsPerMeasure);
      if (replacement) {
        result.push(...replacement);
        firesUsed++;
        fired = true;
        break;
      }
    }
    if (!fired) result.push(curr);
  }
  return result;
}
