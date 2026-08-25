// ============================================================
// auraRoaming · cuePlanner(提示音选择,防节拍器)
// ------------------------------------------------------------
// 逐小节从加权节奏型库抽取提示槽位(全/二/四分 + 少量八分),
// seed 驱动 + 小节能量波调密度;槽位再对齐到 accent 候选上。
// 三条硬规则:
//   1. 相邻提示间隔 < 0.45 拍必弃(引导不该比八分还密);
//   2. 八分间隔(0.45~0.55 拍)提示占比 ≤ ~12%,超预算即弃;
//   3. 连续相同间隔最多 3 次,第 4 次强制丢弃 → 不会退化成节拍器。
// 纯函数:相同 (candidates, ctx) 恒得相同计划。
// ============================================================

import type { AccentCandidate, CueValueClass, PlannedCue } from '../types';

export interface CuePlanContext {
  beatsPerBar: number;
  totalBeats: number;
  seed: number;
  /** groove 合同的每拍力度系数(如 POP [1,.9,1,.9]);无合同时用默认 4/4 层级。 */
  accentPattern?: readonly number[];
  /** lead swing 真源(0.5 直,0.67 爵士):八分槽的搜索目标随之偏移。 */
  swingRatio?: number;
}

/** 无合同兜底:4/4 强弱层级(拍0 最强,拍2 次强)。 */
const DEFAULT_ACCENTS = [1.0, 0.85, 0.95, 0.85];

interface SlotFeel {
  /** 长度 = beatsPerBar 的每拍权重(accentPattern 截断/循环)。 */
  accents: number[];
  /** 反拍八分的拍内位置(= swingRatio,直拍 0.5)。 */
  offbeat: number;
}

/** 可按性网格(2026-08-25 裁定):提示只落 整数拍 或 八分位(含 swing 反拍),
 *  16 分位(+0.25/+0.75)太快不好按 → 吸附到这些位置的槽位直接放弃。 */
const PRESSABLE_EPS = 0.13;
function isPressableBeat(beat: number, offbeat: number): boolean {
  const frac = ((beat % 1) + 1) % 1;
  return frac <= PRESSABLE_EPS
    || frac >= 1 - PRESSABLE_EPS
    || Math.abs(frac - 0.5) <= PRESSABLE_EPS
    || Math.abs(frac - offbeat) <= PRESSABLE_EPS;
}

/** 按 accent² 加权抽一拍(平方拉开强弱差);candidates 为可选拍集合。 */
function pickWeightedBeat(rng: () => number, feel: SlotFeel, candidates: readonly number[]): number {
  let total = 0;
  const weights = candidates.map((b) => {
    const w = (feel.accents[b] ?? 0.85) ** 2;
    total += w;
    return w;
  });
  let roll = rng() * total;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

/** mulberry32:确定性小 PRNG(与工程内其他 seeded 逻辑同风格)。 */
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

interface SlotPattern {
  key: string;
  weight: number;
  /** 小节内槽位(拍),非整数即为八分槽。energyBias>0 → 高能量小节更偏好。 */
  slots: (beatsPerBar: number, rng: () => number, feel: SlotFeel) => number[];
  energyBias: number;
}

// 权重整体偏密(实测"久久才亮一个"太呆):期望 ~2.3 槽/小节,再经
// 候选对齐/键位反查/防节拍器过滤后仍有 ~1.5+/小节的活跃引导感。
const PATTERNS: SlotPattern[] = [
  { key: 'rest', weight: 0.4, energyBias: -1, slots: () => [] },
  { key: 'whole', weight: 1.5, energyBias: -0.5, slots: () => [0] },
  { key: 'half', weight: 3, energyBias: 0, slots: (bpb) => [0, Math.floor(bpb / 2)] },
  { key: 'halfOff', weight: 1.2, energyBias: 0, slots: (bpb) => [Math.floor(bpb / 2)] },
  {
    key: 'quarterPair', weight: 3.5, energyBias: 0.5,
    slots: (bpb, rng, feel) => {
      // 锚点按 accent 加权:4/4 下偏爱 拍0/拍2 起(合同强拍),不再均匀随机
      const first = pickWeightedBeat(rng, feel, Array.from({ length: Math.max(1, bpb - 1) }, (_, i) => i));
      const rest = Array.from({ length: bpb - first - 1 }, (_, i) => first + 1 + i);
      const second = rest.length > 0 ? pickWeightedBeat(rng, feel, rest) : bpb - 1;
      return [first, second];
    },
  },
  {
    key: 'quarterTriple', weight: 3, energyBias: 1,
    slots: (bpb, rng, feel) => {
      // 去掉 accent 最弱的一拍(平局用 rng 破),保留合同强拍骨架
      const all = Array.from({ length: bpb }, (_, i) => i);
      const minW = Math.min(...all.map((b) => feel.accents[b] ?? 0.85));
      const weakest = all.filter((b) => (feel.accents[b] ?? 0.85) === minW);
      const drop = weakest[Math.floor(rng() * weakest.length)];
      return all.filter((b) => b !== drop);
    },
  },
  {
    key: 'quarterFull', weight: 1.5, energyBias: 1.2,
    slots: (bpb) => Array.from({ length: bpb }, (_, i) => i),
  },
  {
    key: 'withEighth', weight: 1.6, energyBias: 1,
    slots: (bpb, rng, feel) => {
      const anchor = pickWeightedBeat(rng, feel, Array.from({ length: Math.max(1, bpb - 1) }, (_, i) => i));
      // 八分槽落在合同 swing 位(直拍 +0.5,爵士 +0.67) → 吸附真实摆动音符
      return [anchor, anchor + feel.offbeat, Math.min(anchor + 2, bpb - 1)];
    },
  },
];

function valueClassOf(slotInBar: number, pattern: SlotPattern, beatsPerBar: number): CueValueClass {
  if (slotInBar % 1 !== 0) return 'eighth';
  if (pattern.key === 'whole') return 'whole';
  if (pattern.key === 'half' || pattern.key === 'halfOff') return 'half';
  if (pattern.key === 'withEighth' && beatsPerBar > 0) return 'quarter';
  return 'quarter';
}

/** 槽位 → 最近的高分【可按】候选(±0.45 拍容差 — 真实 lead 有休止,
 *  容差太窄会让大量槽位落空;分数优先)。16 分位音符在候选池里直接
 *  跳过,槽位吸附到最好的四分/八分位音符,而不是整个槽位放弃。 */
function bestCandidateNear(
  candidates: readonly AccentCandidate[],
  targetBeat: number,
  offbeat: number,
): AccentCandidate | null {
  let best: AccentCandidate | null = null;
  for (const c of candidates) {
    if (Math.abs(c.beat - targetBeat) > 0.45) continue;
    if (!isPressableBeat(c.beat, offbeat)) continue;
    if (!best || c.score > best.score || (c.score === best.score && Math.abs(c.beat - targetBeat) < Math.abs(best.beat - targetBeat))) {
      best = c;
    }
  }
  return best;
}

export function planCues(candidates: readonly AccentCandidate[], ctx: CuePlanContext): PlannedCue[] {
  const { beatsPerBar, totalBeats, seed } = ctx;
  if (beatsPerBar <= 0 || totalBeats <= 0 || candidates.length === 0) return [];

  // groove 合同注入:accentPattern 定每拍强弱(截断/循环到 bpb),swing 定八分槽位
  const source = ctx.accentPattern && ctx.accentPattern.length > 0 ? ctx.accentPattern : DEFAULT_ACCENTS;
  const feel: SlotFeel = {
    accents: Array.from({ length: beatsPerBar }, (_, i) => source[i % source.length]),
    offbeat: Math.min(0.85, Math.max(0.5, ctx.swingRatio ?? 0.5)),
  };

  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const energyPhase = rng() * Math.PI * 2;
  const barCount = Math.ceil(totalBeats / beatsPerBar);

  interface Picked { candidate: AccentCandidate; valueClass: CueValueClass; }
  const picked: Picked[] = [];
  const usedNoteIndexes = new Set<number>();

  for (let bar = 0; bar < barCount; bar++) {
    // 8 小节一个能量波:verse 疏、chorus 密的近似(无段落元数据也成立)
    const energy = 0.5 + 0.5 * Math.sin((Math.PI * 2 * bar) / 8 + energyPhase);
    let totalWeight = 0;
    const weights = PATTERNS.map((p) => {
      const w = Math.max(0.05, p.weight * (1 + p.energyBias * (energy - 0.5)));
      totalWeight += w;
      return w;
    });
    let roll = rng() * totalWeight;
    let pattern = PATTERNS[0];
    for (let i = 0; i < PATTERNS.length; i++) {
      roll -= weights[i];
      if (roll <= 0) { pattern = PATTERNS[i]; break; }
    }

    const barStart = bar * beatsPerBar;
    for (const slot of pattern.slots(beatsPerBar, rng, feel)) {
      const candidate = bestCandidateNear(candidates, barStart + slot, feel.offbeat);
      if (!candidate || usedNoteIndexes.has(candidate.noteIndex)) continue;
      usedNoteIndexes.add(candidate.noteIndex);
      picked.push({ candidate, valueClass: valueClassOf(slot, pattern, beatsPerBar) });
    }
  }

  picked.sort((a, b) => a.candidate.tick - b.candidate.tick);

  // ---- 全局硬规则过滤 ----
  const out: PlannedCue[] = [];
  const eighthBudget = Math.max(2, Math.floor(picked.length * 0.15));
  let eighthUsed = 0;
  const recentIntervals: number[] = [];

  for (const { candidate, valueClass } of picked) {
    const prev = out[out.length - 1];
    if (prev) {
      const interval = candidate.beat - prev.beat;
      if (interval < 0.45) continue; // 比八分还密 → 弃
      const isEighthGap = interval < 0.55 + 1e-9;
      if (isEighthGap && eighthUsed >= eighthBudget) continue;
      // 防节拍器:连续相同间隔 ≤3
      if (
        recentIntervals.length >= 3
        && recentIntervals.slice(-3).every((v) => Math.abs(v - interval) < 0.02)
      ) continue;
      if (isEighthGap) eighthUsed++;
      recentIntervals.push(interval);
      if (recentIntervals.length > 8) recentIntervals.shift();
    }
    out.push({
      id: out.length,
      tick: candidate.tick,
      beat: candidate.beat,
      pitch: candidate.pitch,
      durationBeats: candidate.durationBeats,
      valueClass,
    });
  }
  return out;
}
