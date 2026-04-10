/**
 * BeatMath — 浮点 beat 比较的 epsilon 安全工具
 *
 * 取代生成管道中所有 `beat % 1 === 0`、`Number.isInteger(beat)` 这类裸露的浮点等值比较。
 * 为什么必须用 epsilon：
 *   - JS Number 是 IEEE 754 双精度，beat 经过 +=0.25 累加 100 次后必产生 ~1e-15 量级误差
 *   - C 移植后 float (单精度) 误差更大，原裸 === 比较会失配
 *   - C-1 / C-2 约束要求所有浮点比较使用 epsilon
 *
 * 默认 epsilon = 1e-6，远大于双精度累加误差但远小于音乐最小有效粒度 (0.0625 beat = 64 分音符)
 */

const BEAT_EPS = 1e-6;

/**
 * 判断 beat 是否落在 `grid` 的整数倍上（epsilon 容差，处理负数 mod）
 *
 * 例：
 *   isOnGrid(2.0, 1)      → true   （整拍）
 *   isOnGrid(2.5, 0.5)    → true   （半拍）
 *   isOnGrid(2.0000001, 1)→ true   （epsilon 内视为整拍）
 *   isOnGrid(2.3, 1)      → false
 */
export function isOnGrid(beat: number, grid: number): boolean {
    if (grid <= 0) return false;
    // mod 后取正值，避免 JS 负数 mod 的坑（-0.1 % 1 → -0.1）
    const m = ((beat % grid) + grid) % grid;
    return m < BEAT_EPS || (grid - m) < BEAT_EPS;
}

/** 判断是否在整拍上（等价于 isOnGrid(beat, 1)，最常用形式） */
export function isOnDownbeat(beat: number): boolean {
    return isOnGrid(beat, 1);
}

/** 判断是否在半拍反拍上（mod 1 后约等于 0.5） */
export function isOnOffbeat(beat: number): boolean {
    const m = ((beat % 1) + 1) % 1;
    return Math.abs(m - 0.5) < BEAT_EPS;
}

/** 浮点 beat 相等比较（带 epsilon） */
export function beatEquals(a: number, b: number): boolean {
    return Math.abs(a - b) < BEAT_EPS;
}
