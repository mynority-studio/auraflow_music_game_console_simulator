// ==========================================
// roadmapParser.ts — chord progression → Block[] (Impro-Visor RoadMap style).
//
// Input:  ChordDef[] — the song's chord sequence (one chord per bar in
//         most cases, but multi-chord-per-bar via slot splits is also
//         supported via the duration field).
// Output: Block[] — a tiling of the chord sequence into named brick
//         segments. Each block names which brick (Sad-Cadence / Dropback
//         / Plain-Tonic / ...) covers its chord indices.
//
// Algorithm: Cocke-Younger-Kasami (CYK) dynamic programming —
//   minVals[i][j] = minimum-cost decomposition of chords[i..j]
//   Recurrence:
//     base: minVals[i][i] = best matching single-chord brick (Plain-X)
//     join: minVals[i][j] = min over k of (
//             cost of any brick whose pattern matches chords[i..j] exactly
//             OR minVals[i][k] + minVals[k+1][j]
//           )
//   Reconstruct: walk back through the table to get the Block sequence.
//
// Cost rationale (Impro-Visor design): lower-cost bricks describe music
// more meaningfully than higher-cost ones. Plain-X is cost 1000 (fallback)
// so CYK only places a Plain-X when no real brick matches.
// ==========================================

import { ChordDef } from './musicEngine';
import { BRICK_LIBRARY, BrickPattern, normalizeRomanToken, matchesBrickPattern } from './brickLibrary';

export interface Block {
  brickName: string;
  brickType: BrickPattern['type'];
  /** brickType from IMPROVISOR_LICKS used for lick-pool filtering. */
  lickBrick: string;
  /** Chord indices this block covers, inclusive on both ends. */
  startIdx: number;
  endIdx: number;
  /** Total duration in beats (sum of covered chords' durations). */
  durationBeats: number;
  /** The roman tokens this block matched. Diagnostic. */
  tokens: string[];
  /** Cost contribution. Diagnostic — used for tuning. */
  cost: number;
}

interface ParseCell {
  cost: number;
  /** When this cell is filled by a single brick match, the brick is set
   *  and split === null. When filled by joining two sub-cells, brick is
   *  null and split = the index `k` such that cell = [i..k] + [k+1..j]. */
  brick: BrickPattern | null;
  split: number | null;
}

/**
 * Parse a chord progression into a Block sequence.
 *
 * @param chords  The song's ChordDef[] (in order)
 * @param mode    Song's globalMode ('major' or 'minor')
 */
export function parseRoadMap(
  chords: ChordDef[],
  mode: 'major' | 'minor',
): Block[] {
  const n = chords.length;
  if (n === 0) return [];

  // Step 1: normalize each chord's roman to a clean token
  const tokens: string[] = chords.map(c => normalizeRomanToken(c.roman));

  // Step 2: build cost table
  // minVals[i][j] = best decomposition of tokens[i..j] (inclusive)
  const minVals: ParseCell[][] = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => ({ cost: Infinity, brick: null as BrickPattern | null, split: null as number | null })),
  );

  // Base case + bottom-up fill
  for (let len = 1; len <= n; len++) {
    for (let i = 0; i <= n - len; i++) {
      const j = i + len - 1;
      const slice = tokens.slice(i, j + 1);

      // Try: a single brick whose pattern matches the entire slice
      for (const brick of BRICK_LIBRARY) {
        if (brick.mode !== 'any' && brick.mode !== mode) continue;
        if (!matchesBrickPattern(brick.pattern, slice)) continue;
        if (brick.cost < minVals[i][j].cost) {
          minVals[i][j] = { cost: brick.cost, brick, split: null };
        }
      }

      // Try: split into two sub-cells, sum their costs
      for (let k = i; k < j; k++) {
        const splitCost = minVals[i][k].cost + minVals[k + 1][j].cost;
        if (splitCost < minVals[i][j].cost) {
          minVals[i][j] = { cost: splitCost, brick: null, split: k };
        }
      }
    }
  }

  // Step 3: reconstruct Block sequence by walking the DP table
  const blocks: Block[] = [];
  const walk = (i: number, j: number): void => {
    const cell = minVals[i][j];
    if (cell.brick !== null) {
      // Single brick covers [i..j]
      const slice = tokens.slice(i, j + 1);
      const durationBeats = chords.slice(i, j + 1).reduce((sum, c) => sum + (c.duration ?? 4), 0);
      blocks.push({
        brickName: cell.brick.name,
        brickType: cell.brick.type,
        lickBrick: cell.brick.lickBrick,
        startIdx: i,
        endIdx: j,
        durationBeats,
        tokens: slice,
        cost: cell.brick.cost,
      });
      return;
    }
    if (cell.split !== null) {
      walk(i, cell.split);
      walk(cell.split + 1, j);
      return;
    }
    // Cell unfilled — shouldn't happen since Plain-Wild matches anything
    // with cost 1200. Defensive: emit each chord as its own Plain-Wild.
    for (let k = i; k <= j; k++) {
      const c = chords[k];
      blocks.push({
        brickName: 'Plain-Wild',
        brickType: 'Plain',
        lickBrick: 'Q-fragment',
        startIdx: k,
        endIdx: k,
        durationBeats: c.duration ?? 4,
        tokens: [tokens[k]],
        cost: 1200,
      });
    }
  };
  walk(0, n - 1);

  return blocks;
}

/**
 * Diagnostic: print the parsed RoadMap as a readable line.
 *   "bar 0-1 Opening-Major [I] | bar 2-4 Sad-Cadence [ii V i]"
 */
export function formatRoadMap(blocks: Block[]): string {
  return blocks
    .map(b => `bar ${b.startIdx}-${b.endIdx} ${b.brickName} [${b.tokens.join(' ')}]`)
    .join(' | ');
}

/**
 * For a given chord index, find the block covering it.
 * Used by the lick selector at melody-generation time.
 */
export function findBlockForChord(blocks: Block[], chordIdx: number): Block | null {
  for (const b of blocks) {
    if (chordIdx >= b.startIdx && chordIdx <= b.endIdx) return b;
  }
  return null;
}
