// ============================================================
// newEngine · render · MgTokenScheduler(MG strict 移植 Loop 3)
// ------------------------------------------------------------
// Provenance: ../melodygenerative/src/lib/improvisor/LickGen.ts 的调度子集忠实港(逐值):
//   scheduleTokens(clipped overrun preservation + slope state balancing)、
//   scheduleBrickExpansions、BrickExpansionInput。realizeTokens/clipToSongEnd 属 Loop 5,不在此。
// 唯一改动:import AbstractMelodyToken from ../knowledge/melodyGrammarTypes。
// render 层:把展开后的 token 流铺到绝对拍 —— 超出 brick 时长的末 token 裁剪保留(landing pitch 仍触发),
//   破 slope 时补合成 SlopeExit 平衡深度(防泄漏到下个 brick)。确定性,无 RNG。
// ============================================================

import type { AbstractMelodyToken } from '../knowledge/melodyGrammarTypes';

/** 一个已落拍的 token:token 本体 + 绝对起拍。 */
export interface ScheduledToken {
  token: AbstractMelodyToken;
  startBeat: number;
}

/** Lay out a flat token list onto consecutive start beats, starting
 *  from a given offset. Each token consumes `token.duration` beats.
 *  When `maxDuration` is given, the schedule stops once a token would
 *  overrun. The OVERRUNNING token is CLIPPED to fit the remaining
 *  room rather than dropped. IV slope rules often end on a cadence /
 *  approach-target landing, and dropping that final note would leave
 *  the line hanging on the approach without resolution.
 *  Zero-duration tokens (SlopeEnter/SlopeExit markers) always pass
 *  through. They consume no time and carry semantic state. */
export function scheduleTokens(
  tokens: AbstractMelodyToken[],
  startBeat: number,
  maxDuration?: number,
): ScheduledToken[] {
  const out: ScheduledToken[] = [];
  let cursor = startBeat;
  const end = maxDuration !== undefined ? startBeat + maxDuration : Infinity;
  for (const t of tokens) {
    // Markers (duration 0) emit no audio and don't move the cursor.
    if (t.duration === 0) {
      out.push({ token: t, startBeat: cursor });
      continue;
    }
    const room = end - cursor;
    if (room <= 0.001) break;  // genuinely out of room
    if (t.duration > room + 0.001) {
      // Clip the overrunning token so its landing pitch still fires.
      // The clipped token keeps its kind/degree/etc.; only duration
      // changes. (Spread is safe across the AbstractMelodyToken union
      // because all variants share { kind, duration }.)
      const clipped = { ...t, duration: room } as AbstractMelodyToken;
      out.push({ token: clipped, startBeat: cursor });
      cursor += room;
      break;
    }
    out.push({ token: t, startBeat: cursor });
    cursor += t.duration;
  }
  // SLOPE STATE BALANCING: count SlopeEnter vs SlopeExit emitted; if
  // breaking mid-slope left depth > 0, the source SlopeExit didn't make
  // it into the schedule. Without closing here, realizeTokens'
  // activeSlope leaks into the NEXT brick's tokens (concatenated
  // downstream via scheduleBrickExpansions), constraining notes that
  // should be free. Append synthetic SlopeExits at the cursor to
  // close the depth precisely.
  let depth = 0;
  for (const e of out) {
    if (e.token.kind === 'SlopeEnter') depth++;
    else if (e.token.kind === 'SlopeExit') depth--;
  }
  for (let i = 0; i < depth; i++) {
    out.push({ token: { kind: 'SlopeExit', duration: 0 }, startBeat: cursor });
  }
  return out;
}

/** Convenience: schedule a per-brick expansion into absolute beats. */
export interface BrickExpansionInput {
  brickIndex: number;
  brick: { startBeat: number; durationBeats?: number };
  tokens: AbstractMelodyToken[];
}

/** Schedule per-brick expansions onto absolute beats. When a brick
 *  carries `durationBeats`, its tokens are clipped to fit within that
 *  duration. This prevents IV slope rules from bleeding into the next
 *  brick. */
export function scheduleBrickExpansions(
  expansions: BrickExpansionInput[],
): ScheduledToken[] {
  const all: ScheduledToken[] = [];
  for (const ex of expansions) {
    const scheduled = scheduleTokens(ex.tokens, ex.brick.startBeat, ex.brick.durationBeats);
    all.push(...scheduled);
  }
  return all;
}
