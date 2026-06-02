// ============================================================
// motifCore — 种子化随机(面板层工具,不碰生成逻辑)
// ============================================================
//
// 目的:让「一段生成」可复现(输入种子重听)。motifCore 的生成代码
// (realize / pickForm / grammar 展开)都走全局 Math.random()。这里在
// 面板层用 withSeed() 临时把 Math.random 换成种子化 PRNG,生成是同步的、
// 跑完即在 finally 还原 —— 因此**一行生成逻辑都不用改**就拿到确定性。
// ============================================================

/** 字符串种子 → 32-bit hash(FNV-1a) */
function hashSeed(str: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** mulberry32:快速确定性 PRNG → [0,1) */
function mulberry32(a: number): () => number {
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * 在 seed 控制的随机流下同步执行 fn —— 期间 Math.random 被换成种子化 PRNG,
 * 执行完(含异常)在 finally 还原。同一 seed → fn 完全可复现。
 */
export function withSeed<T>(seed: string, fn: () => T): T {
    const rng = mulberry32(hashSeed(seed));
    const orig = Math.random;
    Math.random = rng;
    try {
        return fn();
    } finally {
        Math.random = orig;
    }
}

/** 生成一个独一无二的种子串(在未换流时调用,用真 Math.random)*/
export function makeSeed(): string {
    return 'mtf_' + Math.random().toString(36).slice(2, 8);
}
