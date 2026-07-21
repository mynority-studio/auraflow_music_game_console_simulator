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

import type {
  AbstractMelodyToken,
  AcgBorrowedColorIntent,
  AcgDyadIntent,
  AcgHarmonicScope,
  AcgStableRole,
} from '../knowledge/melodyGrammarTypes';

/**
 * ACG PIANOSONG 的“呼吸后回归”是主链在 token 调度期决定的可执行意图，
 * 不是拿到 NoteIR 后再补一颗音。它把 RoadMap/和声的落点选择锁到
 * realizer：趋近音必须服务于同一个稳定落点。
 */
export interface AcgReturnGestureIntent {
  gestureId: string;
  /** 这个 return 来自哪一个实际 RoadMap brick，而非被拉伸的 cadence source。 */
  brickIndex?: number;
  brickName?: string;
  brickFamily?: string;
  /**
   * Target chord identity. `chordIndex` is retained for existing trace/test
   * readers; `targetChordIndex` is the explicit contract field consumed by
   * the realizer and must match the chord active at the arrival onset.
   */
  chordIndex: number;
  targetChordIndex: number;
  function: 'T' | 'S' | 'D';
  shape: 'stableSingle' | 'sigh' | 'liftRiff';
  role: 'pickup' | 'approach' | 'arrival';
  arrivalBeat: number;
  /** Grammar-declared harmonic ownership of the arrival. */
  harmonicScope: AcgHarmonicScope;
  /** Exact permitted arrival roles; never a renderer preference/fallback. */
  stableRoles: readonly AcgStableRole[];
  targetPc: number;
  targetRole: AcgStableRole;
  /** 仅 approach 有值；方向以“相对 arrival”描述。 */
  approachDirection?: 'below' | 'above';
  approachSemitones?: 1 | 2;
  /** ACG 调式/借用色彩只可作为“趋近 → 稳定音”的手势，不能悬置。 */
  colorIntent?: AcgBorrowedColorIntent;
  /**
   * 已在 scheduler 选出的合法第二声部。它仍在同一 arrival token 中，由
   * realizer 一次实化；不能留给成品阶段做和声音后处理。
   */
  dyad?: AcgDyadIntent & { partnerPc: number; partnerRole: AcgStableRole };
}

/** 一个已落拍的 token:token 本体 + 绝对起拍。
 *  ★ MG full-parity Phase 3·D:brick 元数据(scheduleBrickExpansions 盖,realizeTokens 透到 NoteEvent)。
 *    缺省 undefined(如 scheduleTokens 直出 / ACG 调度)→ shapeMelodyHarmony 的 eventBrickSpansBoundary no-op。 */
export interface ScheduledToken {
  token: AbstractMelodyToken;
  startBeat: number;
  brickIndex?: number;
  brickStartBeat?: number;
  brickEndBeat?: number;
  // ★ Phase B-2:full metadata 标准形状 —— brick name/family(post-shaper 链 + audit 需要)。
  brickName?: string;
  brickFamily?: string;
  /** ACG 专属一次式回归意图；没有它的 token 仍走通用 MG 语义。 */
  acgReturn?: AcgReturnGestureIntent;
}

export interface ScheduledLeadOwnershipSpan {
  startBeat: number;
  endBeat: number;
}

/**
 * Reserve authored lead spans before realization. Audible grammar tokens that
 * touch an owned span become rests, and slope state is closed at the boundary
 * so generated continuation cannot inherit a phrase that the user brick replaced.
 */
export function reserveScheduledTokensForAuthoredSpans(
  entries: readonly ScheduledToken[],
  spans: readonly ScheduledLeadOwnershipSpan[],
): ScheduledToken[] {
  const owned = spans
    .filter((span) => Number.isFinite(span.startBeat)
      && Number.isFinite(span.endBeat)
      && span.endBeat > span.startBeat + 1e-6)
    .sort((a, b) => a.startBeat - b.startBeat || a.endBeat - b.endBeat);
  if (owned.length === 0) return [...entries];
  const inside = (beat: number): boolean => owned.some((span) =>
    beat >= span.startBeat - 1e-6 && beat < span.endBeat - 1e-6);
  const overlaps = (startBeat: number, endBeat: number): boolean => owned.some((span) =>
    startBeat < span.endBeat - 1e-6 && endBeat > span.startBeat + 1e-6);

  const out: ScheduledToken[] = [];
  for (const entry of entries) {
    const token = entry.token;
    if ((token.kind === 'SlopeEnter' || token.kind === 'SlopeExit') && inside(entry.startBeat)) continue;
    const endBeat = entry.startBeat + Math.max(0, token.duration);
    if (token.duration > 0 && token.kind !== 'R' && overlaps(entry.startBeat, endBeat)) {
      out.push({
        ...entry,
        token: { kind: 'R', duration: token.duration } as AbstractMelodyToken,
        acgReturn: undefined,
      });
      continue;
    }
    out.push(entry);
  }
  for (const span of owned) {
    out.push({ token: { kind: 'SlopeExit', duration: 0 }, startBeat: span.startBeat });
  }
  return out.sort((a, b) => a.startBeat - b.startBeat
    || (a.token.kind === 'SlopeExit' ? -1 : 0)
    || (b.token.kind === 'SlopeExit' ? 1 : 0));
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
  brick: { startBeat: number; durationBeats?: number; name?: string; family?: string };
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
    const brickEndBeat = ex.brick.durationBeats !== undefined
      ? ex.brick.startBeat + ex.brick.durationBeats
      : undefined;
    all.push(...scheduled.map(entry => ({
      ...entry,
      brickIndex: ex.brickIndex,
      brickStartBeat: ex.brick.startBeat,
      brickEndBeat,
      brickName: ex.brick.name,
      brickFamily: ex.brick.family,
    })));
  }
  return all;
}
