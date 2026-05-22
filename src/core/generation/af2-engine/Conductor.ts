// ============================================================
// Conductor — 指挥家:Score + Band → per-section role 分配(C.2)
// ============================================================
//
// 用户 8 层架构里 #2 "指挥家"层。职责:看可用乐手(Band)+ 总谱(Score),
// 决定每段每位乐手演什么角色(melody / accomp / bass / pad / drums / silent /
// 多角色兼任)。
//
// 当前阶段(C.2):
//   StaticConductor 默认实现 — 全曲沿用相同的 band 分配,1 musician → 1 role,
//   等价于当前 forcedBand 行为(0 听感差异)。
//
// 后续阶段:
//   - C.3+:musicians 改造为 plan(score, role, peers) 协议,实际消费
//     SectionAssignment
//   - C.4+:DynamicConductor 支持 per-section 动态编排(如 "Verse 1 钢琴独奏,
//     Verse 2 全队进入"),同一乐手可在不同 section 切换 role
// ============================================================

import { BandRole } from '../types';
import type { Musician } from '../types';
import type { Score } from './Score';

/**
 * Conductor 用的 role(乐手在某 section 的"功能角色")。
 *
 * 与 BandRole 区分:
 *   - BandRole:乐队槽位身份(钢琴手 / 鼓手 / 等,长期不变)
 *   - ConductorRole:这首歌/这一段的演奏功能(melody / accomp / 等,可变 + 可兼任)
 *
 * 一个乐手(BandRole.MainInst 的 alex_piano)在第 1 段可以是 'melody',
 * 在第 2 段可以兼 'melody' + 'bass'(如 stride 钢琴独奏段)。
 */
export type ConductorRole =
    | 'melody'      // 主旋律
    | 'accomp'      // 伴奏(原 chord)
    | 'bass'        // 低音线
    | 'pad'         // 氛围铺垫
    | 'drums'       // 鼓组
    | 'silent';     // 这段不演奏

/**
 * Band — Conductor 决策时看到的可用乐手集。
 * Key = BandRole slot,Value = 该 slot 的 Musician(null = 空槽 = 无人)。
 */
export type Band = Partial<Record<BandRole, Musician | null>>;

/**
 * Conductor 输出:per-section 的 role 分配。
 *
 * `byMusician`: musicianId → 该乐手在此 section 演的角色列表
 * (可多角色,如 stride 钢琴独奏时 ['melody', 'bass'])。
 * 空 Map 表示该 section 无人演奏。
 */
export interface SectionAssignment {
    readonly sectionIdx: number;
    readonly byMusician: ReadonlyMap<string, ReadonlyArray<ConductorRole>>;
}

/**
 * Conductor 接口 — 实现方决定具体调度策略。
 */
export interface Conductor {
    dispatch(score: Score, band: Band): ReadonlyArray<SectionAssignment>;
}

// ============================================================
// StaticConductor — 默认实现:全曲沿用相同 band(= 当前 forcedBand 行为)
// ============================================================

/**
 * BandRole → ConductorRole 默认 1:1 映射(slot 身份 → 演奏功能)。
 * Vocal slot 暂未映射(AF2 未实装 vocal)。
 */
function defaultRoleFor(slot: BandRole): ConductorRole | null {
    switch (slot) {
        case BandRole.MainInst:   return 'melody';
        case BandRole.Accomp:     return 'accomp';
        case BandRole.Bass:       return 'bass';
        case BandRole.Drums:      return 'drums';
        case BandRole.Atmosphere: return 'pad';
        case BandRole.Vocal:      return null;  // Phase 后期
        default:                  return null;
    }
}

export class StaticConductor implements Conductor {
    dispatch(score: Score, band: Band): ReadonlyArray<SectionAssignment> {
        // 1. 计算"通用 byMusician 表"(全曲沿用)
        const byMusician = new Map<string, ConductorRole[]>();
        // BandRole 是 string enum,key 直接是 string value(如 'mainInst' / 'accomp')
        for (const slot of Object.keys(band) as ReadonlyArray<BandRole>) {
            const musician = band[slot];
            if (!musician) continue;
            const role = defaultRoleFor(slot);
            if (!role) continue;
            const existing = byMusician.get(musician.id);
            if (existing) existing.push(role);
            else byMusician.set(musician.id, [role]);
        }
        // freeze inner arrays(防 caller mutate)
        const frozenByMusician = new Map<string, ReadonlyArray<ConductorRole>>();
        for (const [id, roles] of byMusician) frozenByMusician.set(id, Object.freeze([...roles]));

        // 2. 全曲沿用同一份 assignment
        return score.sections.map((_, idx) => ({
            sectionIdx: idx,
            byMusician: frozenByMusician,
        }));
    }
}
