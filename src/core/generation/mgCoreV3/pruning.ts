// ============================================================
// pruning.ts — Layer 5 后处理(melody-aware ducking + clash + ghost)
// ============================================================
//
// 在所有 pattern emit 之后跑,3 步级联:
//   1. applyMelodyClashFilter:删 chord/bass 事件跟 melody 攻击 m2/m9/M7 冲撞
//      (对齐 mg V1 arrangementContract.clashesWithSimultaneousLick 行为)
//   2. applyDensityDucking:按 melodyDensityByBar 给 chord velocity scaling
//      (只 chord,不动 bass — 保留低音 thump 作锚点)
//   3. applyGhostFloor:velocity < 0.15 的 chord 抬到 0.15(悬空感 ghost note)
//
// 设计原则:不删 bass(LH 是结构骨架,不应"消失")。只针对 chord(RH 是色彩,
// 可减弱)。完全静音的"dropout"通过 melody-clash filter 实现(只删真撞)。
// ============================================================

import type { NoteData } from '../ir';

export interface PruningInput {
    /** chord 部分事件(可能被 drop / 改 velocity) */
    chord: NoteData[];
    /** bass 部分事件(可能被 drop,但不会被 ducking 减弱) */
    bass: NoteData[];
    /** melody 事件(只读,用作 clash / density 判定) */
    melody: NoteData[];
    /** chord 边界(用于 per-bar density 查表) */
    chordBoundaries: Array<{ start: number; end: number }>;
    /** mg metadata 的 melodyDensityByBar */
    melodyDensityByBar: number[];
}

export interface PruningOutput {
    chord: NoteData[];
    bass: NoteData[];
    /** 统计(diag 用) */
    stats: {
        chordIn: number;
        bassIn: number;
        chordClashDropped: number;
        bassClashDropped: number;
        chordDucked: number;
        chordGhosted: number;
    };
}

// ─────────────────────────────────────────────────────────────────
// Step 1: melody clash filter
// ─────────────────────────────────────────────────────────────────

const CLASH_TOL_BEFORE = 0.05;
const CLASH_TOL_AFTER  = 0.02;

/**
 * 跟 melody 攻击形成 m2 / m9 / M7(半音类)冲撞的 chord/bass 事件 → drop。
 *   - melody 攻击落在 chord/bass 事件 sounding 窗口内
 *   - pitch diff <= 2 半音 OR mod12 ∈ {1, 11}
 * 对齐 mg V1 arrangementContract 行为。
 */
function clashesWithMelody(e: NoteData, melody: NoteData[]): boolean {
    const eEnd = e.onset + e.duration;
    for (const m of melody) {
        if (m.onset < e.onset - CLASH_TOL_BEFORE) continue;
        if (m.onset > eEnd - CLASH_TOL_AFTER) continue;
        const diff = Math.abs(m.pitch - e.pitch);
        const mod12 = diff % 12;
        if (diff <= 2 || mod12 === 1 || mod12 === 11) return true;
    }
    return false;
}

// ─────────────────────────────────────────────────────────────────
// Step 2: density ducking
// ─────────────────────────────────────────────────────────────────

/**
 * 按 melodyDensityByBar 给 chord velocity 加 scaling。
 *
 * 公式(连续平滑):
 *   scale = clamp(1.0 - 0.06 × max(0, density - 2), 0.5, 1.0)
 *
 *   density 0-2: scale 1.00(无 ducking)
 *   density 3:   scale 0.94
 *   density 5:   scale 0.82
 *   density 7:   scale 0.70
 *   density 10:  scale 0.52
 *
 * 只动 chord,不动 bass。
 */
function duckingScaleForDensity(density: number): number {
    const raw = 1.0 - 0.06 * Math.max(0, density - 2);
    return Math.max(0.5, Math.min(1.0, raw));
}

function findBarIndex(onset: number, boundaries: Array<{ start: number; end: number }>): number {
    for (let i = 0; i < boundaries.length; i++) {
        if (onset >= boundaries[i].start && onset < boundaries[i].end) return i;
    }
    return boundaries.length - 1;
}

// ─────────────────────────────────────────────────────────────────
// Step 3: ghost floor
// ─────────────────────────────────────────────────────────────────

const GHOST_THRESHOLD = 0.20;
const GHOST_FLOOR     = 0.15;

// ─────────────────────────────────────────────────────────────────
// Main entry
// ─────────────────────────────────────────────────────────────────

export function applyPruning(input: PruningInput): PruningOutput {
    const { chord, bass, melody, chordBoundaries, melodyDensityByBar } = input;
    const stats = {
        chordIn: chord.length,
        bassIn: bass.length,
        chordClashDropped: 0,
        bassClashDropped: 0,
        chordDucked: 0,
        chordGhosted: 0,
    };

    // — Step 1: clash filter —
    const chordAfterClash = chord.filter(e => {
        if (clashesWithMelody(e, melody)) {
            stats.chordClashDropped++;
            return false;
        }
        return true;
    });
    const bassAfterClash = bass.filter(e => {
        if (clashesWithMelody(e, melody)) {
            stats.bassClashDropped++;
            return false;
        }
        return true;
    });

    // — Step 2: density ducking(only chord)—
    const chordAfterDucking = chordAfterClash.map(e => {
        const barIdx = findBarIndex(e.onset, chordBoundaries);
        const density = melodyDensityByBar[barIdx] ?? 0;
        const scale = duckingScaleForDensity(density);
        if (scale < 1.0) stats.chordDucked++;
        return { ...e, velocity: e.velocity * scale };
    });

    // — Step 3: ghost floor(low velocity → audible whisper)—
    const chordFinal = chordAfterDucking.map(e => {
        if (e.velocity > 0 && e.velocity < GHOST_THRESHOLD) {
            stats.chordGhosted++;
            return { ...e, velocity: GHOST_FLOOR };
        }
        return e;
    });

    return {
        chord: chordFinal,
        bass: bassAfterClash,
        stats,
    };
}
