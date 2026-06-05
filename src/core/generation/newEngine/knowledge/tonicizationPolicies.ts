// ============================================================
// newEngine · knowledge · TonicizationPolicies(离调策略数据,B-port)
// ------------------------------------------------------------
// 忠实 port 自 melodygenerative/src/lib/tonicizationPlanner.ts 的 policy 表:
//   STYLE_TONICIZE_PROB / MAX_PER_SONG / PLACEMENT_WEIGHTS / TARGET_MULT /
//   V_TYPE_BY_SOURCE_TARGET / II_TYPE_BY_SOURCE_TARGET。
// ★ 离调 = 临时主音(secondary ii-V / V),需 localTonalCenterPc;不改全曲调中心(区别于借和弦)。
// KB 只存表 + 查询;算法在 harmony/tonicizationPlanner.ts。
// ============================================================

import type { TonicizationPlacement } from './progressions';

export type TonicizeStyle = 'POP' | 'JAZZ' | 'RNB' | 'BLUES' | 'LOFI';

/** 每风格离调触发概率(per-song;BLUES/LOFI=0 不离调)。 */
export const STYLE_TONICIZE_PROB: Record<TonicizeStyle, number> = { POP: 0.30, JAZZ: 0.65, RNB: 0.40, BLUES: 0, LOFI: 0 };
/** 每风格每首最多离调次数。 */
export const STYLE_TONICIZE_MAX_PER_SONG: Record<TonicizeStyle, number> = { POP: 2, JAZZ: 4, RNB: 3, BLUES: 0, LOFI: 0 };

/** 每风格 placement 权重(和=1;POP 禁 full_2bar,JAZZ 偏 iiv_split/full_2bar)。 */
export const STYLE_PLACEMENT_WEIGHTS: Record<TonicizeStyle, Record<TonicizationPlacement, number>> = {
  POP: { light: 0.45, approach: 0.35, iiv_split: 0.20, full_2bar: 0 },
  JAZZ: { light: 0.10, approach: 0.15, iiv_split: 0.45, full_2bar: 0.30 },
  RNB: { light: 0.30, approach: 0.30, iiv_split: 0.30, full_2bar: 0.10 },
  BLUES: { light: 0, approach: 0, iiv_split: 0, full_2bar: 0 },
  LOFI: { light: 0, approach: 0, iiv_split: 0, full_2bar: 0 },
};

/** 目标度数权重(home I/i 缺席=不离调到主音;iii/III 减半)。键=scale degree 1-7。 */
export const TARGET_MULT: Record<number, number> = { 5: 1.0, 6: 1.0, 4: 1.0, 2: 1.0, 3: 0.5 };

/** V/X chordType(按 per-song 借用平行调式来源 × 目标大小调)。 */
export const V_TYPE_BY_SOURCE_TARGET = {
  Aeolian: { major: '7b13', minor: '7b9' }, Dorian: { major: '9', minor: '7b9' },
  Mixolydian: { major: '7sus4', minor: '7b9' }, Phrygian: { major: '7b9', minor: '7b9' },
} as const;
/** ii/X chordType(同上)。 */
export const II_TYPE_BY_SOURCE_TARGET = {
  Aeolian: { major: 'm7', minor: 'm7b5' }, Dorian: { major: 'm7', minor: 'm7b5' },
  Mixolydian: { major: 'm7', minor: 'm7b5' }, Phrygian: { major: 'm7b5', minor: 'm7b5' },
} as const;
export type BorrowSourceName = keyof typeof V_TYPE_BY_SOURCE_TARGET;

/** style → 默认借用来源(决定 V/X 色彩:JAZZ 浓 7b13 / POP 软 7sus4 / RNB 顺 9)。 */
export const STYLE_BORROW_SOURCE: Record<TonicizeStyle, BorrowSourceName> = {
  JAZZ: 'Aeolian', POP: 'Mixolydian', RNB: 'Dorian', BLUES: 'Aeolian', LOFI: 'Aeolian',
};

export interface TonicizationPolicy {
  prob: number;
  maxPerSong: number;
  placementWeights: Record<TonicizationPlacement, number>;
  borrowSource: BorrowSourceName;
}

export function getTonicizationPolicy(style: TonicizeStyle): TonicizationPolicy {
  return { prob: STYLE_TONICIZE_PROB[style], maxPerSong: STYLE_TONICIZE_MAX_PER_SONG[style], placementWeights: STYLE_PLACEMENT_WEIGHTS[style], borrowSource: STYLE_BORROW_SOURCE[style] };
}

/** 目标度数离调权重(0=不可离调)。 */
export function targetMult(scaleDegree: number): number {
  return TARGET_MULT[scaleDegree] ?? 0;
}

/** 该风格最高权重的 placement(确定性 argmax,稳定序 light>approach>iiv_split>full_2bar)。 */
const PLACEMENT_ORDER: TonicizationPlacement[] = ['light', 'approach', 'iiv_split', 'full_2bar'];
export function topPlacement(style: TonicizeStyle): TonicizationPlacement | null {
  const w = STYLE_PLACEMENT_WEIGHTS[style];
  let best: TonicizationPlacement | null = null;
  for (const p of PLACEMENT_ORDER) if (w[p] > 0 && (best === null || w[p] > w[best])) best = p;
  return best;
}

export function vTypeFor(source: BorrowSourceName, targetMinor: boolean): string {
  return V_TYPE_BY_SOURCE_TARGET[source][targetMinor ? 'minor' : 'major'];
}
export function iiTypeFor(source: BorrowSourceName, targetMinor: boolean): string {
  return II_TYPE_BY_SOURCE_TARGET[source][targetMinor ? 'minor' : 'major'];
}
