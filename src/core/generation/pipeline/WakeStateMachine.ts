// ============================================================
// WakeStateMachine — 乐器唤醒状态机(Phase 6a)
// ============================================================
//
// PEAA "Threshold Island" 工程落地:
//   每件 musician 持 wakeK / peakK 阈值,与段落 K 比较决定 sleep / 满载状态。
//   per-song 阈值乱序(deterministic 偏移)→ 同 musician 不同 song 行为不同 → 防固化。
//
// 设计动机:
//   - Phase 3-5 在 Idiom 内部硬编阈值(DrumIdiom k<=0.15 / Atmosphere k<=0.15 等)
//     不个性化 + 不防固化 — 同 musician 跨歌行为完全相同
//   - 现统一上提到 musician.persona.wakeK,各 Idiom 不再硬编
//
// 阈值偏移(防固化):
//   每首歌 song hash 派生 deterministic offset ∈ [-0.15, +0.15]
//   musician 实际阈值 = baseline + per-musician offset(由 musician.id hash + song hash)
//   → 同 musician 不同 song 阈值不同 → 不同 song 乐器进出顺序不同
//
// 零 PRNG(所有计算 deterministic hash)。
//
// 关联:cross_sync_rule §1.15(wake 字段 ↔ 消费链)
// ============================================================

import {
    ActiveMusician, BandPlan, BandRole, MusicianPersona, SectionMetadata,
} from '../types';
import type { WeatherSampler } from './RenderContext';

// ============================================================
// 偏移上限(per-song deterministic ±X)
// ============================================================
const THRESHOLD_MUTATION_RANGE = 0.15;

// ============================================================
// 段中 K(同 TextureContinuum;Phase 6+ 应合并)
// ============================================================
function midBeatK(section: SectionMetadata, weather: WeatherSampler): number {
    const mid = (section.startBeat + section.endBeat) / 2;
    return weather.at(mid).k;
}

// ============================================================
// Deterministic hash:musician.id + song seed → [-1, 1]
// ============================================================

/** FNV-1a 32-bit hash(纯派生,零 PRNG)*/
function hashStringTo32(s: string, salt: number): number {
    let h = (2166136261 ^ salt) >>> 0;
    for (let i = 0; i < s.length; i++) {
        h = ((h ^ s.charCodeAt(i)) * 16777619) >>> 0;
    }
    return h;
}

/** 把 32-bit hash 转 [-1, 1] 浮点 */
function hashTo11(s: string, salt: number): number {
    return (hashStringTo32(s, salt) / 0x80000000) - 1.0;
}

// ============================================================
// 主入口:给 musician 阈值做 per-song mutation,再标 sleeping
// ============================================================

/**
 * 副作用:
 *   1. 对每个 activeMusician,如有 wakeK/peakK,根据 songHash 派生新阈值
 *      存到 mutatedWakeK / mutatedPeakK Map 中(不修改 persona 原值,纯函数风格)
 *   2. 对每 (section × role),根据 mutated wakeK 决定 sleeping
 *      写入 plan.assignments[role].sleeping
 *
 * 阈值范围保护:mutated 值 clamp 到 [0, 1]。
 *
 * songHash 通常用 hash(seed)派生 — 调用方提供。
 */
export function attachWakeStates(
    bandPlan: BandPlan,
    sections: SectionMetadata[],
    weather: WeatherSampler,
    activeMusicians: ActiveMusician[],
    songHash: number,
): void {
    // 1. per-song mutation:计算 musician.id → mutated wakeK
    const mutatedWakeKByRole = new Map<BandRole, number>();
    for (let i = 0; i < activeMusicians.length; i++) {
        const am = activeMusicians[i];
        const persona = am.card.persona;
        if (persona.wakeK === undefined) continue;
        const offset = hashTo11(am.card.id, songHash) * THRESHOLD_MUTATION_RANGE;
        const mutatedWake = clamp01(persona.wakeK + offset);
        mutatedWakeKByRole.set(am.assignedRole, mutatedWake);
    }

    // 2. 每段每 role 判 sleeping
    for (let sIdx = 0; sIdx < sections.length; sIdx++) {
        const section = sections[sIdx];
        const k = midBeatK(section, weather);
        const plan = bandPlan.sectionPlans[sIdx];
        if (plan === undefined) continue;

        const roles: BandRole[] = [
            BandRole.MainInst, BandRole.Accomp, BandRole.Bass, BandRole.Drums, BandRole.Atmosphere,
        ];
        for (let r = 0; r < roles.length; r++) {
            const role = roles[r];
            const assignment = plan.assignments[role];
            if (assignment === undefined) continue;
            const wakeK = mutatedWakeKByRole.get(role);
            if (wakeK === undefined) continue;  // 该 role musician 未设 wakeK,跳过
            if (k < wakeK) {
                assignment.sleeping = true;
            }
        }
    }
}

// ============================================================
// 辅助:songHash 由调用方派生(通常 hash(seed))
// ============================================================

/** 把 seed → [0, 2^31] 用于 attachWakeStates 的 songHash 参数 */
export function deriveSongHash(seed: number): number {
    let h = (seed * 2654435761) >>> 0;
    h = ((h ^ (h >>> 16)) * 0x85ebca6b) >>> 0;
    h = ((h ^ (h >>> 13)) * 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
}

// ============================================================
// 工具
// ============================================================
function clamp01(x: number): number {
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
}

// MusicianPersona import 保护(避免 lint 警告)
void ({} as MusicianPersona);
