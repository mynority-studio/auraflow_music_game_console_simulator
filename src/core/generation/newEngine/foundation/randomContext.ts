// ============================================================
// newEngine · foundation · RandomContext
// ------------------------------------------------------------
// 架构定稿 Part 2.0.2 / 铁律6 / 附录 C1:确定性 RNG 底座。
// 同 seed + 同输入 → 同输出。每个 stage 用【命名子流】(确定性派生自 seed+name+count)。
// advance(name) 只推进【一个】子流并返回【新】不可变 context,其它子流不受扰动
// —— 这是 retry 收敛的前提(只动需要重跑的那一支)。
// ============================================================

export type StageName =
  | 'band' | 'time' | 'arranger' | 'harmony' | 'instrumental'
  | 'prepass' | 'accompaniment' | 'melody' | 'resolver' | 'humanize';

export interface Rng {
  next(): number;                       // [0,1)
  int(maxExclusive: number): number;    // [0,maxExclusive) 整数
  pick<T>(xs: readonly T[]): T;
}

export interface RandomContext {
  readonly seed: number;
  substream(name: StageName): Rng;          // 取某 stage 的确定性子流(每次返回从头开始的同一序列)
  advance(name: StageName): RandomContext;  // 推进某子流 → 新 context(不可变)
}

// xmur3 字符串哈希 → 32-bit 种子
function xmur3(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

// mulberry32 PRNG:32-bit 种子 → [0,1) 序列
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRandomContext(
  seed: number,
  advances: Partial<Record<StageName, number>> = {},
): RandomContext {
  const adv = Object.freeze({ ...advances }) as Readonly<Partial<Record<StageName, number>>>;

  const ctx: RandomContext = {
    seed,

    substream(name: StageName): Rng {
      const count = adv[name] ?? 0;
      const gen = mulberry32(xmur3(`${seed}:${name}:${count}`));
      return {
        next: (): number => gen(),
        int(maxExclusive: number): number {
          if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
            throw new RangeError(`Rng.int(): maxExclusive 须 >=1 整数,得到 ${maxExclusive}`);
          }
          return Math.floor(gen() * maxExclusive);
        },
        pick<T>(xs: readonly T[]): T {
          if (xs.length === 0) throw new RangeError('Rng.pick(): 空数组');
          return xs[Math.floor(gen() * xs.length)];
        },
      };
    },

    advance(name: StageName): RandomContext {
      return createRandomContext(seed, { ...adv, [name]: (adv[name] ?? 0) + 1 });
    },
  };

  return Object.freeze(ctx);
}
