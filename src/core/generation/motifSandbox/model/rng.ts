// ============================================================
// motifSandbox · model · 确定性 RNG(sandbox-local,mulberry32)
// ------------------------------------------------------------
// 生成阶段不用 Math.random()。同 seed → 同序列。轻量,不耦合 newEngine foundation。
// ============================================================

export interface SeededRng {
  next(): number;                    // [0,1)
  int(maxExclusive: number): number; // [0,max)
  pick<T>(xs: readonly T[]): T;
  chance(p: number): boolean;
}

export function makeRng(seed: number): SeededRng {
  let a = (seed >>> 0) || 1;
  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (maxExclusive: number): number => Math.floor(next() * Math.max(1, maxExclusive)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    chance: (p: number): boolean => next() < p,
  };
}
