// ============================================================
// newEngine · render · Humanize(力度曲线 + 微时序人性化)
// ------------------------------------------------------------
// 架构定稿 战线5:消解"完全网格"的机械感。两层(均确定性,由 rng 子流驱动):
//   1) 力度 metric accent:小节内重音轮廓(强拍重 / 弱拍轻 / 反拍更软)+ 微随机,
//      → 同一音高反复出现也力度不同。鼓轨跳过(保 1.4 backbeat groove)。
//   2) 微时序抖动:起音 ±少量 tick(人手不踩死网格),swing 之后施加,夹 ≥0。
// 纯函数;pitch/duration 不变 → 不扰 Auditor 和声判定。
// ============================================================

import { ticks, type Rng } from '../foundation';
import type { TrackIR } from '../ir/MusicalIR';

const VEL_RANDOM = 0.04; // 力度微随机幅度(±4%)
const ON_BEAT_EPS = 0.06; // 判定"踩在拍点"的容差(beat 比例)

/** 小节内 metric accent 力度系数:强拍 1.06 / 次强 1.02 / 其它正拍 0.97 / 反拍 0.92。 */
export function metricAccentScale(beatInBar: number, beatsPerBar: number): number {
  const frac = beatInBar - Math.floor(beatInBar);
  const onBeat = Math.min(frac, 1 - frac) < ON_BEAT_EPS;
  if (!onBeat) return 0.92; // 反拍/切分 → 更软
  const b = Math.round(beatInBar) % beatsPerBar;
  if (b === 0) return 1.06; // 强拍(小节首)
  if (beatsPerBar % 2 === 0 && b === beatsPerBar / 2) return 1.02; // 半小节次强
  return 0.97; // 其它正拍
}

/**
 * 力度人性化:metric accent × 微随机。鼓轨 role==='drum' 跳过(保 groove)。
 * 确定性:逐音从 rng 取微随机(顺序稳定 → 同 seed 同结果)。
 */
export function humanizeVelocity(tracks: TrackIR[], ppq: number, beatsPerBar: number, rng: Rng): TrackIR[] {
  return tracks.map((t) => {
    if (t.role === 'drum') return t;
    return {
      role: t.role,
      notes: t.notes.map((n) => {
        const beat = (n.startTick as number) / ppq;
        const accent = metricAccentScale(beat % beatsPerBar, beatsPerBar);
        const jitter = 1 + (rng.next() * 2 - 1) * VEL_RANDOM;
        const v = Math.round(n.velocity * accent * jitter);
        return { ...n, velocity: Math.max(1, Math.min(127, v)) };
      }),
    };
  });
}

/**
 * 微时序抖动:起音 ±maxJitterTicks(默认 ppq*0.015≈直觉 7 tick)。全轨;夹 startTick≥0。
 * 整拍/反拍同抖 → 非完全网格。确定性:逐音从 rng 取偏移。
 */
export function humanizeTiming(tracks: TrackIR[], ppq: number, rng: Rng, maxJitterTicks = Math.max(2, Math.round(ppq * 0.015))): TrackIR[] {
  return tracks.map((t) => ({
    role: t.role,
    notes: t.notes.map((n) => {
      const off = Math.round((rng.next() * 2 - 1) * maxJitterTicks);
      const st = Math.max(0, (n.startTick as number) + off);
      return { ...n, startTick: ticks(st) };
    }),
  }));
}
