// ============================================================
// newEngine · knowledge · ScaleGravity(Lerdahl 音阶引力,B-port 乐理事实)
// ------------------------------------------------------------
// Provenance:port 自 melodygenerative/src/lib/musicTheory.ts(SCALE_GRAVITY /
//   computeLerdahlScaleGravity / lerdahlScaleStrength / getScaleGravity)。
//   Lerdahl 2001 TPS ch.4 attraction:α = (s_to/s_from)×(1/n²)。
//   音阶内每个音相对主音,给出"被拉向哪个更稳定音"的引力(resolve_up/down/hang)。
//   大调家族(Ionian/Mixolydian/Lydian)init 时计算;小调/属/bebop 家族为手调 literal。
// 引用 ScaleLibrary(scales.ts),不复制音阶数据。对外返回 readonly record(非可变 Map)。
// ============================================================

import { getScaleType, type ScaleTypeId } from './scales';

export interface ScaleGravityRule {
  fromInterval: number; // 相对主音半音
  toInterval: number;   // 解决目标(相对主音半音)
  score: number;        // 引力强度(0..~30;阈值参考 18 硬过滤、/25 软)
  type: 'resolve_down' | 'resolve_up' | 'hang';
}

// 音阶强度:chromatic=1 · 主音=5 · 五度=4 · 三音(优先大三 else 小三)=3 · 其它调内=2。
function lerdahlScaleStrength(iv: number, scaleType: ScaleTypeId): number {
  const intervals = getScaleType(scaleType).intervals;
  const v = ((iv % 12) + 12) % 12;
  if (!intervals.includes(v)) return 1;
  if (v === 0) return 5;
  if (v === 7) return 4;
  if (intervals.includes(4)) { if (v === 4) return 3; }
  else if (intervals.includes(3)) { if (v === 3) return 3; }
  return 2;
}

/** Lerdahl 公式逐音算引力:在 ±2 半音内、更稳定的音中取 α 最大者。 */
export function computeLerdahlScaleGravity(scaleType: ScaleTypeId): ScaleGravityRule[] {
  const intervals = getScaleType(scaleType).intervals;
  const rules: ScaleGravityRule[] = [];
  for (const fromIv of intervals) {
    if (fromIv === 0) continue; // 主音无 pull 目标
    let bestToIv = -1;
    let bestAlpha = 0;
    const sFrom = lerdahlScaleStrength(fromIv, scaleType);
    for (const toIv of intervals) {
      if (toIv === fromIv) continue;
      const rawDist = (((toIv - fromIv) % 12) + 12) % 12;
      const n = Math.min(rawDist, 12 - rawDist);
      if (n > 2) continue; // ±2 半音内才算引力
      const sTo = lerdahlScaleStrength(toIv, scaleType);
      if (sTo <= sFrom) continue; // 只解决到更稳定的
      const alpha = (sTo / sFrom) * (1 / (n * n));
      if (alpha > bestAlpha) { bestAlpha = alpha; bestToIv = toIv; }
    }
    if (bestToIv < 0) continue;
    const upDist = (((bestToIv - fromIv) % 12) + 12) % 12;
    const isUp = upDist <= 12 - upDist;
    rules.push({
      fromInterval: fromIv,
      toInterval: bestToIv,
      score: Math.round(bestAlpha * 10),
      type: bestAlpha < 0.5 ? 'hang' : isUp ? 'resolve_up' : 'resolve_down',
    });
  }
  return rules;
}

const r = (fromInterval: number, toInterval: number, score: number, type: ScaleGravityRule['type']): ScaleGravityRule => ({ fromInterval, toInterval, score, type });

// 大调家族:Lerdahl 派生;其余:手调 literal(逐值忠实 port)。
const SCALE_GRAVITY: Partial<Record<ScaleTypeId, readonly ScaleGravityRule[]>> = {
  'Ionian': computeLerdahlScaleGravity('Ionian'),
  'Mixolydian': computeLerdahlScaleGravity('Mixolydian'),
  'Lydian': computeLerdahlScaleGravity('Lydian'),
  'Aeolian': [r(8, 7, 25, 'resolve_down'), r(10, 0, 18, 'resolve_up'), r(2, 3, 10, 'resolve_up'), r(5, 3, 12, 'resolve_down')],
  'Dorian': [r(9, 7, 5, 'hang'), r(9, 10, 6, 'resolve_up'), r(2, 3, 9, 'resolve_up'), r(5, 3, 6, 'resolve_down'), r(10, 0, 10, 'resolve_up')],
  'Phrygian': [r(1, 0, 22, 'resolve_down'), r(8, 7, 20, 'resolve_down')],
  'Locrian': [r(1, 0, 18, 'resolve_down'), r(6, 7, 5, 'resolve_up')],
  'Harmonic Minor': [r(11, 0, 25, 'resolve_up'), r(8, 7, 20, 'resolve_down'), r(2, 3, 10, 'resolve_up')],
  'Melodic Minor': [r(11, 0, 22, 'resolve_up'), r(9, 11, 8, 'resolve_up'), r(2, 3, 9, 'resolve_up')],
  'Phrygian Dominant': [r(1, 0, 25, 'resolve_down'), r(11, 0, 22, 'resolve_up'), r(8, 7, 20, 'resolve_down'), r(5, 4, 12, 'resolve_down')],
  'Lydian Dominant': [r(6, 7, 16, 'resolve_up'), r(10, 9, 10, 'resolve_down')],
  'Altered': [r(1, 0, 18, 'resolve_down'), r(8, 7, 15, 'resolve_down')],
  'Bebop Dominant': [r(11, 0, 16, 'resolve_up'), r(10, 9, 10, 'resolve_down'), r(5, 4, 14, 'resolve_down')],
  'Bebop Major': [r(5, 4, 15, 'resolve_down'), r(11, 0, 22, 'resolve_up'), r(8, 7, 12, 'resolve_down')],
};

/** 某音阶的引力规则:fromInterval → 最优(同 fromInterval 取最高 score)。readonly record。 */
export function getScaleGravity(scaleType: ScaleTypeId): Readonly<Record<number, ScaleGravityRule>> {
  const rules = SCALE_GRAVITY[scaleType];
  const out: Record<number, ScaleGravityRule> = {};
  if (!rules) return out;
  for (const rule of rules) {
    const ex = out[rule.fromInterval];
    if (!ex || rule.score > ex.score) out[rule.fromInterval] = rule;
  }
  return out;
}
