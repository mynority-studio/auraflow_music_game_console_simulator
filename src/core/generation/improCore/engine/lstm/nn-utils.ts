// nn-utils.ts — imp/lstm/utilities/NNUtilities + filters/Operations 的对应实现。

/** 右移 distance(NNUtilities.roll):rolled[i] = input[(i-distance) mod n] */
export function roll(input: Float64Array, distance: number): Float64Array {
    const n = input.length;
    let d = distance % n;
    if (d < 0) d += n;
    const out = new Float64Array(n);
    // part1 = input[n-d .. n) 放到前面,part2 = input[0 .. n-d) 接后面
    for (let i = 0; i < d; i++) out[i] = input[n - d + i]!;
    for (let i = 0; i < n - d; i++) out[d + i] = input[i]!;
    return out;
}

/** one-hot 向量 */
export function onehot(index: number, length: number): Float64Array {
    const v = new Float64Array(length);
    v[index] = 1.0;
    return v;
}

/** 数值稳定 softmax */
export function softmax(x: ArrayLike<number>): Float64Array {
    const n = x.length;
    let mx = -Infinity;
    for (let i = 0; i < n; i++) if (x[i]! > mx) mx = x[i]!;
    const out = new Float64Array(n);
    let z = 0;
    for (let i = 0; i < n; i++) { const e = Math.exp(x[i]! - mx); out[i] = e; z += e; }
    for (let i = 0; i < n; i++) out[i] = out[i]! / z;
    return out;
}

/** 按概率分布采样一个索引(NNUtilities.sample 的等价:累积分布 + 随机点) */
export function sample(rand: () => number, probs: ArrayLike<number>): number {
    let z = 0;
    for (let i = 0; i < probs.length; i++) z += probs[i]!;
    let r = rand() * z;
    for (let i = 0; i < probs.length; i++) {
        r -= probs[i]!;
        if (r <= 0) return i;
    }
    return probs.length - 1;
}

/** 可复现 RNG(mulberry32),Java Random 不可移植故自带一个确定性源 */
export function makeRng(seed: number): () => number {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
