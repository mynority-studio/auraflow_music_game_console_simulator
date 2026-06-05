// ============================================================
// newEngine · render · MgRoadMapParser(MG strict 移植 Loop 2)
// ------------------------------------------------------------
// Provenance: ../melodygenerative/src/lib/improvisor/RoadMap.ts(类型 + helper)
//   + BrickParser.ts(DP 最低成本 brick 覆盖)忠实港(逐值)。
// 唯一改动:import 改 ./mgChordPart(ChordPart/ChordBlock)+ ../knowledge/melodyBrickDictionary
//   (BRICK_PATTERNS/stepMatches/BrickFamily/BrickPattern);MG 的 import('./RoadMap') 内联换本地类型。
// render 层:把 ChordPart 解析成有序 brick 序列(RoadMap),供 grammar 规则按 brick 族门控。
// 确定性:纯函数,无 RNG。
// ============================================================

import type { ChordPart, ChordBlock } from './mgChordPart';
import {
  BRICK_PATTERNS,
  stepMatches,
  type BrickFamily,
  type BrickPattern,
} from '../knowledge/melodyBrickDictionary';

// ── RoadMap.ts: 输出类型 ─────────────────────────────────────

export interface BrickMatch {
  name: string;
  family: BrickFamily;
  /** Absolute start beat (cumulative, from ChordPart.startBeat of first
   *  block in the match). */
  startBeat: number;
  /** Total duration of all blocks in the match. */
  durationBeats: number;
  /** ChordPart block indices this brick covers (contiguous). */
  chordIndices: number[];
  /** Local key pc this brick was matched under. */
  keyPc?: number;
  /** Match cost; 0..2 typical. Lower = better. */
  cost: number;
}

/** G8-1: a key-stable region within a song. Multi-key tunes (AABA
 *  bridge in different key, modal interchange sections, etc.) get
 *  multiple segments. Currently `parseRoadMap` derives at most ONE
 *  segment spanning the whole song; future detection can split.
 *
 *  Consumers (PitchClassSets / NoteChooser) read the active segment's
 *  `keyRootPc` + `mode` to pick chord-scales correctly when the local
 *  tonal center diverges from the global song key. */
export interface KeySegment {
  /** Cumulative start beat */
  startBeat: number;
  /** Cumulative end beat (exclusive) */
  endBeat: number;
  /** Tonal center pc for this segment (0-11) */
  keyRootPc: number;
  /** Mode label: 'Major', 'Minor', or a specific mode name. */
  mode: string;
}

export interface RoadMap {
  bricks: BrickMatch[];
  totalCost: number;
  /** Multi-key segment list. Empty array = single-key song
   *  (uses songKeyPc passed to parseRoadMap as default). */
  segments: KeySegment[];
}

/** Empty RoadMap helper. */
export function emptyRoadMap(): RoadMap {
  return { bricks: [], totalCost: 0, segments: [] };
}

/** Find the key segment active at a given beat. Returns null when no
 *  segment covers the beat (caller falls back to song-level key). */
export function getSegmentAtBeat(roadMap: RoadMap, beat: number): KeySegment | null {
  for (const s of roadMap.segments) {
    if (beat >= s.startBeat && beat < s.endBeat) return s;
  }
  return null;
}

// ── BrickParser.ts: DP 最低成本 brick 覆盖 ───────────────────
//
// Algorithm:
//   Let n = blocks.length.
//   dp[i] = min cost to cover blocks[0..i-1] (i.e., to reach position i).
//   trace[i] = which (brick, startIdx, keyPc) led to dp[i].
//   For each i from 1..n:
//     for each j from 0..i-1:
//       for each pattern P with len(P.steps) = i - j:
//         for each candidate keyPc 0..11:
//           if P matches blocks[j..i-1] under keyPc:
//             cost = baseCost (+ small bonus if keyPc matches songKey)
//             if dp[j] + cost < dp[i]: update
//     if dp[i] still Infinity (no match ending at i):
//       allow a singleton "Unknown" brick covering blocks[i-1]
//       cost = UNKNOWN_COST (high enough to be dispreferred when any
//       real match exists)
//
// Reconstruct from trace to produce BrickMatch[].

const UNKNOWN_COST = 5.0;
const SONG_KEY_MATCH_BONUS = -0.2;  // small preference for songKey-rooted matches

interface TraceEntry {
  startIdx: number;          // block index where this brick begins
  pattern: BrickPattern;
  keyPc: number;
  isUnknown: boolean;
}

export interface ParseRoadMapArgs {
  part: ChordPart;
  /** Pitch class of the song's tonal center — used as soft preference;
   *  parser still tries all 12 key roots per pattern. */
  songKeyPc: number;
}

export function parseRoadMap(args: ParseRoadMapArgs): RoadMap {
  const { part, songKeyPc } = args;
  const blocks = part.blocks;
  const n = blocks.length;
  if (n === 0) return { bricks: [], totalCost: 0, segments: [] };

  // dp[i] = min cost to cover blocks[0..i)
  const dp: number[] = new Array(n + 1).fill(Infinity);
  const trace: (TraceEntry | null)[] = new Array(n + 1).fill(null);
  dp[0] = 0;

  for (let i = 1; i <= n; i++) {
    // Try every brick pattern ending at i
    for (let j = 0; j < i; j++) {
      const len = i - j;
      for (const pattern of BRICK_PATTERNS) {
        if (pattern.steps.length !== len) continue;
        for (let keyPc = 0; keyPc < 12; keyPc++) {
          if (!matchesPattern(blocks, j, pattern, keyPc)) continue;
          let cost = pattern.baseCost;
          if (keyPc === songKeyPc) cost += SONG_KEY_MATCH_BONUS;
          // Duration scaling penalty per IV BinaryProduction.java:
          //   durationScales == (durA * dur2 == durB * dur1)
          // i.e., actual proportions must match the rule's declared
          // proportions for the match to be "exact". IV multiplies cost
          // by 100 for non-scaling matches (effectively disqualifies
          // them when an exact match exists). We use a sharper
          // multiplier than the previous soft 0.5-cap additive — but
          // less brutal than IV's 100× so reasonable mid-tempo bricks
          // still flow through.
          if (len >= 2 && !pattern.arbitraryDurations) {
            const actualDurs: number[] = [];
            for (let k = 0; k < len; k++) actualDurs.push(blocks[j + k].durationBeats);
            const expectedDurs = pattern.stepDurations ?? new Array(len).fill(1);
            cost = cost * durationScalingMultiplier(actualDurs, expectedDurs);
          }
          if (dp[j] + cost < dp[i]) {
            dp[i] = dp[j] + cost;
            trace[i] = { startIdx: j, pattern, keyPc, isUnknown: false };
          }
        }
      }
    }
    // Fallback: single-block Unknown brick if nothing matched
    if (dp[i] === Infinity || dp[i - 1] + UNKNOWN_COST < dp[i]) {
      // Try the Unknown alternative — covers just the last block (i-1)
      if (dp[i - 1] + UNKNOWN_COST < dp[i]) {
        dp[i] = dp[i - 1] + UNKNOWN_COST;
        trace[i] = {
          startIdx: i - 1,
          pattern: { name: 'Unknown', family: 'Unknown', baseCost: UNKNOWN_COST, steps: [{ rootDegreePc: 0, qualities: ['any'] }] },
          keyPc: blocks[i - 1].rootPc,
          isUnknown: true,
        };
      }
    }
  }

  // Reconstruct
  const bricks: BrickMatch[] = [];
  let cursor = n;
  while (cursor > 0) {
    const t = trace[cursor];
    if (!t) break;
    const j = t.startIdx;
    const span = blocks.slice(j, cursor);
    const startBeat = span[0].startBeat;
    const durationBeats = span.reduce((s, b) => s + b.durationBeats, 0);
    bricks.unshift({
      name: t.pattern.name,
      family: t.pattern.family,
      startBeat,
      durationBeats,
      chordIndices: span.map(b => b.index),
      keyPc: t.keyPc,
      cost: t.pattern.baseCost,
    });
    cursor = j;
  }

  // G8-1: Derive modulation segments by clustering consecutive bricks
  // sharing keyPc. Single-key songs (most current generation output)
  // collapse to one segment. Multi-key tunes show multiple segments
  // when bricks were matched in different keys.
  const segments = deriveKeySegments(bricks, part.totalBeats, songKeyPc);
  return {
    bricks,
    totalCost: dp[n] === Infinity ? UNKNOWN_COST * n : dp[n],
    segments,
  };
}

/** G8-1: Walk bricks and group consecutive matches sharing keyPc into
 *  KeySegment runs. Standalone single-block bricks fall under the
 *  surrounding segment; explicit songKeyPc is the default.
 *
 *  Conservative: only emit multiple segments when a contiguous run of
 *  >= 2 bricks shares the SAME non-songKey keyPc. Avoids spurious
 *  modulations from single-brick keyPc anomalies. */
function deriveKeySegments(
  bricks: BrickMatch[],
  totalBeats: number,
  songKeyPc: number,
): KeySegment[] {
  if (bricks.length === 0) {
    return totalBeats > 0
      ? [{ startBeat: 0, endBeat: totalBeats, keyRootPc: songKeyPc, mode: 'Major' }]
      : [];
  }
  const segs: KeySegment[] = [];
  let cur = {
    startBeat: 0,
    endBeat: 0,
    keyRootPc: songKeyPc,
    runLen: 0,
  };
  for (const b of bricks) {
    const k = b.keyPc ?? songKeyPc;
    if (k === cur.keyRootPc) {
      cur.endBeat = b.startBeat + b.durationBeats;
      cur.runLen++;
    } else {
      // Conservative: only commit a new segment when prior had >=1 brick.
      // (We always have >=1 since we entered the loop.) Push prior.
      segs.push({
        startBeat: cur.startBeat,
        endBeat: cur.endBeat,
        keyRootPc: cur.keyRootPc,
        mode: 'Major',
      });
      cur = {
        startBeat: b.startBeat,
        endBeat: b.startBeat + b.durationBeats,
        keyRootPc: k,
        runLen: 1,
      };
    }
  }
  segs.push({
    startBeat: cur.startBeat,
    endBeat: Math.max(cur.endBeat, totalBeats),
    keyRootPc: cur.keyRootPc,
    mode: 'Major',
  });
  return segs;
}

/** Compute the IV-style duration-scaling cost multiplier.
 *
 *  IV's BinaryProduction declares two durations (dur1, dur2) per
 *  production rule. A match "scales" when actual proportions match the
 *  declaration exactly:  actualA / actualB == dur1 / dur2.
 *  When not, IV multiplies cost by `inexact_match_factor = 100`.
 *
 *  Generalized to N-step patterns: compare each actual / expected ratio
 *  to a single normalization factor (mean ratio). The closer the
 *  individual ratios cluster, the closer to 1.0× this returns. Wider
 *  spread → larger multiplier up to a cap (we use 8× instead of IV's
 *  100× so reasonable jazz licks with mild duration variance still
 *  flow through the parser rather than degrading to Unknown).
 *
 *  Tolerance: ratios within ±10% of the mean considered exact (1.0×).
 *  Beyond that, multiplier = 1 + (deviation × 5), clamped to [1, 8]. */
function durationScalingMultiplier(actual: number[], expected: number[]): number {
  if (actual.length !== expected.length) return 8;
  // Compute per-step ratios actual/expected. If pattern were a perfect
  // scaling, all ratios would be identical.
  const ratios: number[] = [];
  for (let i = 0; i < actual.length; i++) {
    if (expected[i] <= 0) return 8;  // malformed pattern
    ratios.push(actual[i] / expected[i]);
  }
  const meanRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  if (meanRatio <= 0) return 8;
  // Coefficient of variation (CV): max deviation as fraction of mean.
  let maxDev = 0;
  for (const r of ratios) {
    const dev = Math.abs(r - meanRatio) / meanRatio;
    if (dev > maxDev) maxDev = dev;
  }
  if (maxDev <= 0.10) return 1.0;  // within tolerance → no penalty
  return Math.min(8, 1 + (maxDev - 0.10) * 5);
}

function matchesPattern(
  blocks: ChordBlock[],
  startIdx: number,
  pattern: BrickPattern,
  keyPc: number,
): boolean {
  for (let k = 0; k < pattern.steps.length; k++) {
    if (!stepMatches(pattern.steps[k], blocks[startIdx + k], keyPc)) return false;
  }
  return true;
}

/** Find the BrickMatch covering a given beat. O(log n) via the chord part
 *  + a linear scan in the brick array (bricks are usually < 20). */
export function getBrickAtBeat(roadMap: RoadMap, beat: number): BrickMatch | null {
  for (const b of roadMap.bricks) {
    if (beat >= b.startBeat && beat < b.startBeat + b.durationBeats) return b;
  }
  return null;
}
