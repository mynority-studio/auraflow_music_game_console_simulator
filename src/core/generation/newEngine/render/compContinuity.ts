// ============================================================
// newEngine · render · CompContinuity(comp 连续性审计,texture-switch 第三期)
// ------------------------------------------------------------
// docs/texture_switch_musicality_directive §4.3:只看 comp 自身连续性,不靠 bass/pad 兜底遮过去。
// ★ 关键:只在【comp 应在场】的区间内量空隙(排除密度弧里 comp 缺席的段=intro/breakdown/outro),
//   否则会把"有意不出 comp 的段"误报成断层。织体自身的一致节奏空隙(如 HalfTime 1.26 拍)仍会计入,
//   阈值判定时按"非突发洞"宽容。纯函数、无副作用。
// ============================================================

export interface CompGap {
  startBeat: number;
  endBeat: number;
  gapBeats: number;
}
export interface CompContinuityReport {
  maxGapBeats: number;
  gaps: CompGap[];
}

/**
 * 量 comp 在【应在场区间】内的自身空隙。
 * @param compNotes comp 轨音符(tick)。
 * @param activeRanges comp 应在场的 tick 区间(= comp 在 lineup + 在 activeRolesBySection + 段 active)。
 */
export function measureCompGaps(
  compNotes: readonly { startTick: number; durationTicks: number }[],
  activeRanges: readonly { lo: number; hi: number }[],
  ppq: number,
): CompContinuityReport {
  // comp 覆盖区间(合并)
  const iv = compNotes
    .map((n) => [n.startTick, n.startTick + n.durationTicks] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of iv) {
    if (merged.length && s <= merged[merged.length - 1][1]) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
    else merged.push([s, e]);
  }

  const gaps: CompGap[] = [];
  for (const r of activeRanges) {
    let cursor = r.lo;
    for (const [s, e] of merged) {
      if (e <= r.lo || s >= r.hi) continue;          // 与本区间不相交
      const cs = Math.max(s, r.lo);
      if (cs - cursor > 1e-6) gaps.push({ startBeat: cursor / ppq, endBeat: cs / ppq, gapBeats: (cs - cursor) / ppq });
      cursor = Math.max(cursor, Math.min(e, r.hi));
    }
    if (r.hi - cursor > 1e-6) gaps.push({ startBeat: cursor / ppq, endBeat: r.hi / ppq, gapBeats: (r.hi - cursor) / ppq });
  }
  return { maxGapBeats: gaps.reduce((m, g) => Math.max(m, g.gapBeats), 0), gaps };
}
