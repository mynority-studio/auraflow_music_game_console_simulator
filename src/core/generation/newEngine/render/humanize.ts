// ============================================================
// newEngine · render · Humanize(力度曲线 + 微时序人性化)
// ------------------------------------------------------------
// 架构定稿 战线5:消解"完全网格"的机械感。两层(均确定性,由 rng 子流驱动):
//   1) 力度 metric accent:小节内重音轮廓(强拍重 / 弱拍轻 / 反拍更软)+ 微随机,
//      → 同一音高反复出现也力度不同。鼓轨跳过(保 1.4 backbeat groove)。
//   2) 微时序抖动:起音 ±少量 tick(人手不踩死网格),swing 之后施加,夹 ≥0。
//      ★ 槽位共享(2026-06-05 审计修):偏移按【起音 tick 槽位】下发,不再每音独立随机——
//        同一 tick 的多声部(bass 根音 + kick + comp)拿【同一偏移】→ 一起移动 = 对拍/复调不被打散;
//        且按 metric 缩放(下拍≈锚定、反拍全幅)→ 重心(下拍)稳,off-beat 才有人味。
//        修前:每音独立 ±7 tick → bass/kick 下拍离散 avg≈4.7/max≈13 tick(27ms flam)= 重心错位。
// 纯函数;pitch/duration 不变 → 不扰 Auditor 和声判定。
// ============================================================

import { ticks, type Rng } from '../foundation';
import type { TrackIR } from '../ir/MusicalIR';

const VEL_RANDOM = 0.04; // 力度微随机幅度(±4%)
const ON_BEAT_EPS = 0.06; // 判定"踩在拍点"的容差(beat 比例)

/** 复合/奇数拍的次强位置优先服从 GrooveContract.beatGrouping。 */
function secondaryMetricBeat(beatsPerBar: number, beatGrouping?: readonly number[]): number | undefined {
  if (beatGrouping && beatGrouping.length > 1) {
    const total = beatGrouping.reduce((sum, group) => sum + group, 0);
    const firstBoundary = beatGrouping[0];
    if (Math.abs(total - beatsPerBar) < 1e-6 && firstBoundary > 0 && firstBoundary < beatsPerBar) {
      return firstBoundary;
    }
  }
  if (Number.isInteger(beatsPerBar) && beatsPerBar % 2 === 0) return beatsPerBar / 2;
  return undefined;
}

/** 小节内 metric accent 力度系数:强拍 1.06 / 次强 1.02 / 其它正拍 0.97 / 反拍 0.92。 */
export function metricAccentScale(beatInBar: number, beatsPerBar: number, beatGrouping?: readonly number[]): number {
  const frac = beatInBar - Math.floor(beatInBar);
  const onBeat = Math.min(frac, 1 - frac) < ON_BEAT_EPS;
  if (!onBeat) return 0.92; // 反拍/切分 → 更软
  const b = Math.round(beatInBar) % beatsPerBar;
  if (b === 0) return 1.06; // 强拍(小节首)
  if (b === secondaryMetricBeat(beatsPerBar, beatGrouping)) return 1.02;
  return 0.97; // 其它正拍
}

/**
 * 力度人性化:metric accent × 微随机。鼓轨 role==='drum' 跳过(保 groove)。
 * 确定性:逐音从 rng 取微随机(顺序稳定 → 同 seed 同结果)。
 */
export function humanizeVelocity(
  tracks: TrackIR[],
  ppq: number,
  beatsPerBar: number,
  rng: Rng,
  beatGrouping?: readonly number[],
  velocityHumanize: number | ((tick: number) => number) = VEL_RANDOM,
): TrackIR[] {
  return tracks.map((t) => {
    if (t.role === 'drum' || t.role === 'lead') return t; // ★ Loop 9:lead = MG StyleRenderer 已上 accent,跳过全局力度人性化(避免双 accent)
    return {
      role: t.role,
      notes: t.notes.map((n) => {
        const beat = (n.startTick as number) / ppq;
        const accent = metricAccentScale(beat % beatsPerBar, beatsPerBar, beatGrouping);
        const requestedAmount = typeof velocityHumanize === 'function'
          ? velocityHumanize(n.startTick as number)
          : velocityHumanize;
        const amount = Math.max(0, Math.min(0.25, requestedAmount));
        const jitter = 1 + (rng.next() * 2 - 1) * amount;
        const v = Math.round(n.velocity * accent * jitter);
        return { ...n, velocity: Math.max(1, Math.min(127, v)) };
      }),
    };
  });
}

/** 微时序抖动幅度按 metric 缩放:下拍锚定(重心稳)→ off-beat 全幅(人味)。 */
function jitterScale(tick: number, ppq: number, beatsPerBar: number, beatGrouping?: readonly number[]): number {
  const beatInBar = (tick / ppq) % beatsPerBar;
  const frac = beatInBar - Math.floor(beatInBar);
  const onBeat = Math.min(frac, 1 - frac) < ON_BEAT_EPS;
  if (!onBeat) return 1.0; // 反拍/切分 → 全幅(人手最松的地方)
  const b = Math.round(beatInBar) % beatsPerBar;
  if (b === 0) return 0.2; // 下拍 → 近锚定(重心 = 最稳的点)
  if (b === secondaryMetricBeat(beatsPerBar, beatGrouping)) return 0.45;
  return 0.7; // 其它正拍
}

/**
 * 微时序抖动:起音 ±maxJitterTicks(默认 ppq*0.015≈直觉 7 tick),按 metric 缩放。全轨;夹 startTick≥0。
 * ★ 槽位共享:偏移以【起音 tick】为键下发一次,同 tick 的所有音(跨声部)拿同一偏移 →
 *   多声部对拍/复调由织体写定后不被抖散;只在不同槽位之间引入人味。下拍槽近锚定 → 重心不漂。
 * 确定性:distinct tick 升序消费 rng(顺序稳定 → 同 seed 同结果)。
 */
export function humanizeTiming(tracks: TrackIR[], ppq: number, beatsPerBar: number, rng: Rng, maxJitterTicks = Math.max(2, Math.round(ppq * 0.015)), anchorTicks: ReadonlySet<number> = new Set(), skipRoles: ReadonlySet<string> = new Set(), beatGrouping?: readonly number[]): TrackIR[] {
  // 收集全轨 distinct 起音 tick → 升序,每个槽位下发一个(缩放后)偏移。
  const slots = new Set<number>();
  for (const t of tracks) for (const n of t.notes) slots.add(n.startTick as number);
  const offsetBySlot = new Map<number, number>();
  for (const tick of [...slots].sort((a, b) => a - b)) {
    let off = Math.round((rng.next() * 2 - 1) * maxJitterTicks * jitterScale(tick, ppq, beatsPerBar, beatGrouping));
    // ★ Loop F(2026-06-08):结构锚点(段落起始 / 曲首 / 末主音下拍)不做【负向】jitter →
    //   核心 downbeat 不被拉到上一段(新段有明确 release;末主音不被拉出 songEnd)。仍允许微正偏(不全禁 humanize)。
    if (anchorTicks.has(tick)) off = Math.max(0, off);
    offsetBySlot.set(tick, off);
  }
  return tracks.map((t) => {
    if (t.role === 'lead') return t; // ★ Loop 9:lead = MG StyleRenderer 已定时序,跳过全局微抖动(保 MG 旋律纯净)
    if (t.role === 'pad') return t;  // ★ pad = sustain 铺底层:跳过微时序抖动(长音起点不齐=细微重起,毁连续铺底感)
    if (skipRoles.has(t.role)) return t; // ★ MG 升级 2c-2(§7.4):pocket-handled 角色(ACG bass)跳 humanize,改由 groovePocket 拥有时序(不双重)
    return {
    role: t.role,
    notes: t.notes.map((n) => {
      const off = offsetBySlot.get(n.startTick as number) ?? 0;
      const st = Math.max(0, (n.startTick as number) + off);
      return { ...n, startTick: ticks(st) };
    }),
    };
  });
}
