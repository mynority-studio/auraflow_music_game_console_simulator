// ============================================================
// auraRoaming · harmonicFill(和声填充提示,纯函数)
// ------------------------------------------------------------
// lead 稀疏(尤其 ACG)时提示密度骤降。接管布局本身是逐和弦重建的
// 安全音图,cell 自带 classRole:即使当下 lead 没旋律,"重拍按结构音、
// 弱拍按色彩音"也一定和谐 → 在 lead 提示的空窗里按概率补亮:
//   · 强拍(小节头/中点)偏好 chord 结构音,概率高;
//   · 其他整数拍作弱拍,偏好 scale/approach 色彩音,概率低;
//   · 与既有提示(含已补的)最小间距 1 拍,不挤 lead 锚点;
// seed 驱动,纯函数确定性。
// ============================================================

import type { PlannedCue } from '../types';

export interface HarmonicFillCell {
  index: number;
  midi: number;
  classRole: string;
}

export interface HarmonicFillContext {
  beatsPerBar: number;
  totalBeats: number;
  seed: number;
  ppq: number;
  /** 该拍的当前布局 cells(runtime 里来自 controller.getPadMap)。 */
  cellsAtBeat: (beat: number) => readonly HarmonicFillCell[] | null;
  /** groove 合同每拍力度系数:填充概率随之缩放(合同强拍更常亮)。 */
  accentPattern?: readonly number[];
}

/** 已绑定键位的填充提示。 */
export interface HarmonicFillCue extends PlannedCue {
  padIndex: number;
}

const MIN_GAP_BEATS = 1.0;
const STRONG_PROB = 0.65;
const WEAK_PROB = 0.3;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function planHarmonicFillCues(
  leadCues: readonly PlannedCue[],
  ctx: HarmonicFillContext,
): HarmonicFillCue[] {
  const { beatsPerBar, totalBeats, seed, ppq, cellsAtBeat } = ctx;
  if (beatsPerBar <= 0 || totalBeats <= 0) return [];
  const rng = mulberry32((seed ^ 0x51f0a7) >>> 0);

  const occupied = leadCues.map((c) => c.beat);
  const out: HarmonicFillCue[] = [];
  const tooClose = (beat: number): boolean =>
    occupied.some((b) => Math.abs(b - beat) < MIN_GAP_BEATS)
    || out.some((c) => Math.abs(c.beat - beat) < MIN_GAP_BEATS);

  // 合同 accent 归一权(无合同 = 全 1):强弱概率再按合同每拍系数缩放,
  // 4/4 下亮灯层级与歌曲律动一致(概率缩放不改变 rng 消耗次数 → 确定性不破)
  const accents = ctx.accentPattern && ctx.accentPattern.length > 0 ? ctx.accentPattern : null;
  const maxAccent = accents ? Math.max(...accents) : 1;

  for (let beat = 0; beat < Math.floor(totalBeats); beat++) {
    const posInBar = beat % beatsPerBar;
    const strong = posInBar === 0 || (beatsPerBar % 2 === 0 && posInBar === beatsPerBar / 2);
    const roll = rng(); // 每拍都消耗一次随机数,决策与 tooClose 顺序无关 → 确定性稳定
    const pick = rng();
    if (tooClose(beat)) continue;
    const accentScale = accents ? 0.4 + 0.6 * ((accents[posInBar % accents.length] ?? maxAccent) / maxAccent) : 1;
    if (roll > (strong ? STRONG_PROB : WEAK_PROB) * accentScale) continue;

    const cells = cellsAtBeat(beat);
    if (!cells || cells.length === 0) continue;
    let pool = strong
      ? cells.filter((c) => c.classRole === 'chord')
      : cells.filter((c) => c.classRole === 'scale' || c.classRole === 'approach');
    if (pool.length === 0) pool = cells.filter((c) => c.classRole === 'chord');
    if (pool.length === 0) continue;

    // 靠中心优先,前 3 个里 seeded 抖动选一个,避免每次都同一键
    const sorted = [...pool].sort((a, b) => Math.abs(a.index - 7) - Math.abs(b.index - 7));
    const cell = sorted[Math.floor(pick * Math.min(3, sorted.length))];

    out.push({
      id: 0, // 合并排序后由 runtime 统一重编
      tick: Math.round(beat * ppq),
      beat,
      pitch: cell.midi,
      durationBeats: strong ? 1 : 0.5,
      valueClass: 'quarter',
      source: 'harmonic',
      padIndex: cell.index,
    });
  }
  return out;
}
