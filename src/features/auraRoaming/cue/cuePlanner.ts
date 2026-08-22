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
  /** 小节内槽位(拍),含 .5 即为八分槽。energyBias>0 → 高能量小节更偏好。 */
  slots: (beatsPerBar: number, rng: () => number) => number[];
  energyBias: number;
}

const PATTERNS: SlotPattern[] = [
  { key: 'rest', weight: 1.1, energyBias: -1, slots: () => [] },
  { key: 'whole', weight: 3, energyBias: -0.5, slots: () => [0] },
  { key: 'half', weight: 4, energyBias: 0, slots: (bpb) => [0, Math.floor(bpb / 2)] },
  { key: 'halfOff', weight: 1.6, energyBias: 0, slots: (bpb) => [Math.floor(bpb / 2)] },
  {
    key: 'quarterPair', weight: 3, energyBias: 0.5,
    slots: (bpb, rng) => {
      const first = Math.floor(rng() * Math.max(1, bpb - 1));
      const second = first + 1 + Math.floor(rng() * Math.max(1, bpb - first - 1));
      return [first, Math.min(second, bpb - 1)];
    },
  },
  {
    key: 'quarterTriple', weight: 2, energyBias: 1,
    slots: (bpb, rng) => {
      const all = Array.from({ length: bpb }, (_, i) => i);
      // 去掉一个随机整数拍,留下 bpb-1 个(4/4 → 3 个)
      all.splice(Math.floor(rng() * all.length), 1);
      return all;
    },
  },
  {
    key: 'withEighth', weight: 1.4, energyBias: 1,
    slots: (bpb, rng) => {
      const anchor = Math.floor(rng() * Math.max(1, bpb - 1));
      return [anchor, anchor + 0.5, Math.min(anchor + 2, bpb - 1)];
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

/** 槽位 → 最近的高分候选(±0.26 拍容差,分数优先)。 */
function bestCandidateNear(
  candidates: readonly AccentCandidate[],
  targetBeat: number,
): AccentCandidate | null {
  let best: AccentCandidate | null = null;
  for (const c of candidates) {
    if (Math.abs(c.beat - targetBeat) > 0.26) continue;
    if (!best || c.score > best.score || (c.score === best.score && Math.abs(c.beat - targetBeat) < Math.abs(best.beat - targetBeat))) {
      best = c;
    }
  }
  return best;
}

export function planCues(candidates: readonly AccentCandidate[], ctx: CuePlanContext): PlannedCue[] {
  const { beatsPerBar, totalBeats, seed } = ctx;
  if (beatsPerBar <= 0 || totalBeats <= 0 || candidates.length === 0) return [];

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
    for (const slot of pattern.slots(beatsPerBar, rng)) {
      const candidate = bestCandidateNear(candidates, barStart + slot);
      if (!candidate || usedNoteIndexes.has(candidate.noteIndex)) continue;
      usedNoteIndexes.add(candidate.noteIndex);
      picked.push({ candidate, valueClass: valueClassOf(slot, pattern, beatsPerBar) });
    }
  }

  picked.sort((a, b) => a.candidate.tick - b.candidate.tick);

  // ---- 全局硬规则过滤 ----
  const out: PlannedCue[] = [];
  const eighthBudget = Math.max(2, Math.floor(picked.length * 0.12));
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
