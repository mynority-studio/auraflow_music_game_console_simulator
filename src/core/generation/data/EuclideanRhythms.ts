// ============================================================
// EuclideanRhythms — Euclidean 节奏算法 + 世界音乐节奏预设库
// ============================================================
//
// 出处:Toussaint 2005 "The Euclidean Algorithm Generates Traditional
// Musical Rhythms"。世界各地的传统 groove(Cuban Tresillo / Son Clave /
// Cinquillo / Afro-bell / Tumbao 等)几乎都符合 "N 击点在 M 步上的最均匀
// 分布" — 这是 Euclidean 距离的 1D 应用。算法可纯数学派生,无需查表。
//
// 关键算法:
//   euclid(steps, beats) — 最均匀分布
//   rotate(pattern, n)   — 循环位移
//   onsets(...gaps)      — 按击点间隔构建
//
// 6 个预设(模块加载时计算):
//   TRESILLO          = euclid(8, 3)     Cuban 3-2 clave 前半
//   CINQUILLO         = euclid(8, 5)     加勒比 5/8 切分
//   SON_CLAVE_FWD     = euclid(16, 5)    Son Clave forward (3-2)
//   AFRO_BELL_12_7    = euclid(12, 7)    Afro 12/8 bell pattern
//   TUMBAO_BASS       = rotate(euclid(8, 4), 2)  拉丁 Tumbao bass
//   COMPOUND_DOWNBEATS_6_8 = euclid(6, 2)        复合 6/8 强拍
//
// 消费方(Batch 1 暂不接):
//   - Batch 4 PianoLHPatterns(Stride / Boogie 节奏底)
//   - 远期 PianoTextureRecipes 加 baseGrid 时可引用(Bossa Clave 已硬编)
//
// 零 PRNG。零依赖。ESP32 友好(纯算法 < 1 KB 编译产物)。
// ============================================================

/** 节奏单元 — 0 = rest,1 = hit */
export type RhythmStep = 0 | 1;

/** 节奏序列(immutable) */
export type RhythmPattern = ReadonlyArray<RhythmStep>;

// ============================================================
// 核心算法
// ============================================================

/**
 * Euclidean 算法:把 beats 个击点最均匀分布到 steps 个位置。
 *
 * @example
 *   euclid(8, 3)   → [1,0,0,1,0,0,1,0]  Tresillo
 *   euclid(8, 5)   → [1,0,1,1,0,1,1,0]  Cinquillo
 *   euclid(7, 3)   → [1,0,1,0,1,0,0]    Afro-bell 7/3
 *
 * 边界:steps<=0 或 beats<0 返回空数组。
 *
 * 算法引自 tonal `@tonaljs/rhythm-pattern`(MIT,Daniel Gómez Blasco)。
 */
export function euclid(steps: number, beats: number): RhythmPattern {
    if (steps <= 0 || beats < 0) return [];
    const pattern: RhythmStep[] = new Array(steps);
    let d = -1;
    for (let i = 0; i < steps; i++) {
        const v = Math.floor((i * beats) / steps);
        pattern[i] = v !== d ? 1 : 0;
        d = v;
    }
    return pattern;
}

/**
 * 循环位移 — 右旋 N 位(N 为负数则左旋)。
 *
 * @example
 *   rotate([1,0,0,1,0,0,1,0], 2) → [1,0,1,0,0,1,0,0]
 */
export function rotate(pattern: RhythmPattern, rotations: number): RhythmPattern {
    const len = pattern.length;
    if (len === 0) return [];
    const out: RhythmStep[] = new Array(len);
    for (let i = 0; i < len; i++) {
        const src = (((i - rotations) % len) + len) % len;
        out[i] = pattern[src];
    }
    return out;
}

/**
 * 按"击点间隔"构建 pattern。
 *
 * @example
 *   onsets(2, 2, 2, 2)    → [1,0,0,1,0,0,1,0,0,1,0,0]   4 hits, gap 2 each
 *   onsets(3, 3, 4, 2, 4) → 21 步定制 pattern
 */
export function onsets(...gaps: number[]): RhythmPattern {
    const out: RhythmStep[] = [];
    for (let i = 0; i < gaps.length; i++) {
        out.push(1);
        for (let j = 0; j < gaps[i]; j++) out.push(0);
    }
    return out;
}

/**
 * pattern → 击点 step 索引数组。
 *
 * @example
 *   patternOnsetTimes([1,0,0,1,0,0,1,0]) → [0, 3, 6]
 */
export function patternOnsetTimes(pattern: RhythmPattern): ReadonlyArray<number> {
    const out: number[] = [];
    for (let i = 0; i < pattern.length; i++) {
        if (pattern[i] === 1) out.push(i);
    }
    return out;
}

// ============================================================
// 常用预设(模块加载时计算 + Object.freeze)
// ============================================================

/** Cuban 3-2 Tresillo:8 步 3 击点 */
export const TRESILLO: RhythmPattern = Object.freeze(euclid(8, 3).slice());

/** Cinquillo:8 步 5 击点,加勒比 / Latin 切分 */
export const CINQUILLO: RhythmPattern = Object.freeze(euclid(8, 5).slice());

/** Son Clave forward("3-2"):16 步 5 击点 */
export const SON_CLAVE_FWD: RhythmPattern = Object.freeze(euclid(16, 5).slice());

/** Afro-bell 12/8 staple:12 步 7 击点 */
export const AFRO_BELL_12_7: RhythmPattern = Object.freeze(euclid(12, 7).slice());

/** Tumbao bass:euclid(8, 4) 右旋 2 位 */
export const TUMBAO_BASS: RhythmPattern = Object.freeze(rotate(euclid(8, 4), 2).slice());

/** 6/8 复合拍强拍:6 步 2 击点 */
export const COMPOUND_DOWNBEATS_6_8: RhythmPattern = Object.freeze(euclid(6, 2).slice());
