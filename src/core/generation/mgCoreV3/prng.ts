// ============================================================
// prng.ts — Seeded deterministic PRNG(per-bar 独立流)
// ============================================================
//
// 每个 bar 用 makeBarPrng(songSeed, barIndex) 创建独立 PRNG 流。
// 设计要点:
//   - 同 seed 同 barIndex → 完全相同序列(可复现)
//   - 不同 bar 互不干扰(用 djb2 hash 把 (seed, barIdx) 揉成 32-bit state)
//   - LCG 算法,跟 mg/mgCoreV3 PRNGManager 用同一套数学
//
// API:
//   prng.next()       — [0, 1) float
//   prng.chance(p)    — true if next() < p
//   prng.pickInt(n)   — [0, n) int
// ============================================================

export interface Prng {
    next(): number;
    chance(p: number): boolean;
    pickInt(n: number): number;
}

function djb2Hash(input: string): number {
    let h = 5381;
    for (let i = 0; i < input.length; i++) {
        h = ((h << 5) - h + input.charCodeAt(i)) >>> 0;
    }
    return h >>> 0;
}

export function makeBarPrng(songSeed: string, barIndex: number): Prng {
    let state = djb2Hash(`${songSeed}#${barIndex}`);
    const next = (): number => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
    return {
        next,
        chance(p: number): boolean { return next() < p; },
        pickInt(n: number): number { return Math.floor(next() * n); },
    };
}
