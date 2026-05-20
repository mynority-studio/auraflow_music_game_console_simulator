// ============================================================
// TextureContinuum — 织体密度连续统(Phase 3 核心)
// ============================================================
//
// 解决 PEAA 中"段落拼接突兀"的痛点(用户原话):
//   "刚开始一个四个小节都是第一拍柱式和弦,但是到第二个 section 的时候,
//    往往变化比较大,没有连续性"
//
// 实现路径:
//   1. 每段每 role 按 weather.k 派生 target density level(1-7)
//   2. 跨段密度差 > 1 时,按 R 维度(冒险)决定:
//      - R 低(Pop) → 'gradual' 平缓 ±1 滑动(慢半拍触发高潮)
//      - R 高(NeoSoul / Solo) → 'staged' 强制中段过渡(戏剧性跳跃)
//   3. 写回 sectionPlan.assignments[role].densityLevel
//
// 设计要点:
//   - **零 PRNG** — A/B 策略选择用 deterministic hash(sectionIdx → [0,1])
//   - **role-aware** — 不同 role 可有不同 density baseline(Piano/Drums 起步同 K,
//     Atmosphere baseline 偏低,Bass 跨段恒定不变)
//   - **anchor 兼容** — anchor musician 的 recipe 不在本模块决定;本模块只管 density
//
// 关联:
//   - cross_sync_rule.md §1.11(DensityLevel ↔ TextureContinuum ↔ RhythmMask)
//   - Phase 2 CurveWeatherSampler 提供 weather.k / weather.r 输入
// ============================================================

import {
    BandPlan, BandRole, DensityLevel, SectionMetadata, ActiveMusician, SectionType,
} from '../types';
import type { WeatherSampler } from './RenderContext';

// ============================================================
// K → density 量化映射(7 bin)
// ============================================================
//
// Phase 2 实测 K 范围 ~ [0.20, 0.70](默认 4 人乐队 personaK avg ~0.5,Pop styleK 0.55)。
// 用 7 bin 等距覆盖:
//   K ≤ 0.15 → density 1(Tacit)
//   0.15 < K ≤ 0.30 → density 2(SparseSustain)
//   0.30 < K ≤ 0.45 → density 3(BlockQuarter)
//   0.45 < K ≤ 0.60 → density 4(BrokenEighth)
//   0.60 < K ≤ 0.75 → density 5(CompingStab)
//   0.75 < K ≤ 0.90 → density 6(ActiveArp)
//   K > 0.90 → density 7(Saturated)
function kToDensity(k: number): DensityLevel {
    if (k <= 0.15) return DensityLevel.Tacit;
    if (k <= 0.30) return DensityLevel.SparseSustain;
    if (k <= 0.45) return DensityLevel.BlockQuarter;
    if (k <= 0.60) return DensityLevel.BrokenEighth;
    if (k <= 0.75) return DensityLevel.CompingStab;
    if (k <= 0.90) return DensityLevel.ActiveArp;
    return DensityLevel.Saturated;
}

// ============================================================
// Role-aware density 偏置(每 role 在原始 K → density 基础上做调整)
// ============================================================
//
// Atmosphere 自带 sustain pad 性质,baseline 偏低(同 K 下比 Piano 低 1 档)。
// Bass 跨段稳定(只用 baseline,不浮动)。
// Drums 跟 Piano 同步。
function roleDensityOffset(role: BandRole): number {
    switch (role) {
        case BandRole.Atmosphere: return -1;  // pad 更稀疏
        case BandRole.Bass:       return 0;   // bass 走 baseline
        case BandRole.Drums:      return 0;
        case BandRole.Accomp:
        case BandRole.MainInst:   return 0;
        default:                  return 0;
    }
}

function clampDensity(d: number): DensityLevel {
    if (d < 1) return DensityLevel.Tacit;
    if (d > 7) return DensityLevel.Saturated;
    return d as DensityLevel;
}

// ============================================================
// 派生 target density 给单段单 role
// ============================================================

/** 取段中点 beat 的 K(代表本段稳定段中状态,避开段间过渡) */
function midBeatK(section: SectionMetadata, weather: WeatherSampler): number {
    const mid = (section.startBeat + section.endBeat) / 2;
    return weather.at(mid).k;
}

export function deriveTargetDensity(
    section: SectionMetadata,
    role: BandRole,
    weather: WeatherSampler,
): DensityLevel {
    const k = midBeatK(section, weather);
    const baseDensity = kToDensity(k);
    return clampDensity(baseDensity + roleDensityOffset(role));
}

// ============================================================
// 平滑滑动 — 段间 density 限速 ±1(gradual)或强制中段过渡(staged)
// ============================================================

/**
 * 段间转换策略选择(Phase 3 用户决策:R 驱动的智能切换)。
 *
 * R 低(Pop) → 85% gradual / 15% staged
 * R 中(Jazz) → 60% gradual / 40% staged
 * R 高(NeoSoul / Solo) → 40% gradual / 60% staged
 *
 * 概率用 deterministic hash(sectionIdx)实现,零 PRNG。
 */
function pickTransitionStrategy(
    fromDensity: DensityLevel,
    toDensity: DensityLevel,
    weather: WeatherSampler,
    sectionStartBeat: number,
    sectionIdx: number,
): 'gradual' | 'staged' {
    const jump = Math.abs(toDensity - fromDensity);
    if (jump <= 1) return 'gradual';  // 差 ≤ 1 不需要策略,自然过渡

    const r = weather.at(sectionStartBeat).r;
    // staged 概率随 R 升高:Pop(R~0.05) → 0.20 / Jazz(R~0.5) → 0.50 / NeoSoul(R~0.55) → 0.56
    const stagedProb = 0.15 + r * 0.75;
    const h = hash01(sectionIdx);
    return h < stagedProb ? 'staged' : 'gradual';
}

/** Deterministic hash sectionIdx → [0,1] floor,零 PRNG */
function hash01(sectionIdx: number): number {
    // 简单整数哈希,32-bit 截断后归一化
    let h = sectionIdx | 0;
    h = ((h * 2654435761) >>> 0) & 0xFFFFFFFF;
    return h / 0x100000000;  // 转 [0, 1)
}

/**
 * 滑动一步:从 currentDensity 向 targetDensity 移动。
 * - gradual: 每段 ±1(若差 ≥ 2,本段只移动 1 档,下段继续追赶)
 * - staged:  一次性跳到 target(模拟"中段插入过渡"的简化,本 Phase 3 用 staged ≡ 直跳)
 *
 * Phase 3 MVP staged 不真插入额外段(那需要修改 sections 结构),而是"允许直跳"。
 * 等于在 R 高时放弃平滑约束,接受戏剧性跳跃 — 仍比"完全无约束"好。
 * Phase 4+ 若需要真插入过渡段,可扩展本逻辑。
 */
function slideOneStep(
    current: DensityLevel,
    target: DensityLevel,
    strategy: 'gradual' | 'staged',
): DensityLevel {
    if (current === target) return current;
    if (strategy === 'staged') return target;
    // gradual: 限速 ±1
    return current < target
        ? clampDensity(current + 1)
        : clampDensity(current - 1);
}

// ============================================================
// 主入口:给 BandPlan 全部 sections × roles 注入 densityLevel
// ============================================================

/**
 * 为 bandPlan.sectionPlans 中每个 (section, role) 写入 densityLevel。
 *
 * 算法:
 *   1. 第 0 段(Intro):直接用 deriveTargetDensity(无前置可滑)
 *   2. 第 N+1 段:fromDensity = sectionPlans[N].densityLevel,
 *                targetDensity = derived,
 *                strategy = pickTransitionStrategy,
 *                writeDensity = slideOneStep(from, target, strategy)
 *
 * 副作用:in-place 修改 bandPlan.sectionPlans[].assignments[].densityLevel。
 */
export function attachDensityPlan(
    bandPlan: BandPlan,
    sections: SectionMetadata[],
    weather: WeatherSampler,
    _activeMusicians: ActiveMusician[],  // 预留(Phase 4+ 按 musician.isAnchor 进一步调整)
): void {
    const roles: BandRole[] = [
        BandRole.MainInst, BandRole.Accomp, BandRole.Bass, BandRole.Drums, BandRole.Atmosphere,
    ];

    // 每 role 独立跨段追踪 currentDensity
    const currentDensityByRole: Map<BandRole, DensityLevel> = new Map();

    for (let sIdx = 0; sIdx < sections.length; sIdx++) {
        const section = sections[sIdx];
        const plan = bandPlan.sectionPlans[sIdx];
        if (plan === undefined) continue;

        for (let r = 0; r < roles.length; r++) {
            const role = roles[r];
            const assignment = plan.assignments[role];
            if (assignment === undefined) continue;  // 本段该 role 未上岗

            const target = deriveTargetDensity(section, role, weather);
            const current = currentDensityByRole.get(role);
            const writeDensity = current === undefined
                ? target  // 首段:直接用 target
                : slideOneStep(
                    current, target,
                    pickTransitionStrategy(current, target, weather, section.startBeat, sIdx),
                );

            assignment.densityLevel = writeDensity;
            // Phase 3:同步写入 instrumentSpecificParams.densityLevel
            // (Piano 等 Idiom 通过 params 而非 assignment 消费,需镜像)
            if (assignment.instrumentSpecificParams !== undefined
                && typeof assignment.instrumentSpecificParams === 'object'
                && assignment.instrumentSpecificParams !== null) {
                (assignment.instrumentSpecificParams as { densityLevel?: number })
                    .densityLevel = writeDensity;
            }
            currentDensityByRole.set(role, writeDensity);
        }
    }
}

// ============================================================
// Phase 4 — Apex Predator Suppression(侧链 ducking)
// ============================================================

/**
 * Apex 触发的 K 阈值 — K > 此值且任一 apex musician active → 本段 ducking 激活
 *
 * Phase 4 校准:0.80 实测从未触发(默认乐队 personaK avg ~0.15,Pop BuildUp K 上限 0.74)。
 * 调至 0.70 → BuildUp 段(energy 10)触发,Chorus(energy 8)未触发,符合"drop 效果"音乐性。
 * 听感后可继续调:激进 0.65 / 保守 0.75。
 */
const APEX_K_THRESHOLD = 0.70;

/** 默认 suppression 强度(0.6 = 让出 40% velocity 给 apex) */
const DEFAULT_SUPPRESSION_FACTOR = 0.6;

/** 被 ducking 影响的 role 集合(节奏组 Bass / Drums / MainInst 豁免) */
const DUCKING_TARGET_ROLES: ReadonlyArray<BandRole> = Object.freeze([
    BandRole.Accomp,
    BandRole.Atmosphere,
]);

/**
 * 为 bandPlan 注入 apex ducking 标记。
 *
 * 检测逻辑:
 *   1. 对每段,扫描 activeMusicians 找 isApex=true 的乐手
 *   2. 取该段中点 weather.k(用 K 而非 isApex 乐手专属 K,是因为本期 Apex 乐手通常是
 *      鼓 / 主奏,其 K 等同全段 K)
 *   3. K > APEX_K_THRESHOLD → 本段 ducking active,
 *      给 DUCKING_TARGET_ROLES 的 assignment 写 apexActive=true + suppressionFactor
 *
 * 副作用:in-place 修改 bandPlan.sectionPlans[sIdx].assignments[role].apexActive
 *         + .suppressionFactor + instrumentSpecificParams 镜像
 */
export function attachSuppressionPlan(
    bandPlan: BandPlan,
    sections: SectionMetadata[],
    weather: WeatherSampler,
    activeMusicians: ActiveMusician[],
): void {
    // Phase 4 MVP:乐队级 hasApex 一票通过 — 后续可改为 per-section apex 检测
    const hasApex = activeMusicians.some(am => am.card.persona.isApex === true);
    if (!hasApex) return;  // 无 apex 乐手,本 Phase 4 无 ducking 触发

    for (let sIdx = 0; sIdx < sections.length; sIdx++) {
        const section = sections[sIdx];
        const k = midBeatK(section, weather);

        // Apex 触发条件(任一命中):
        //   ① K > APEX_K_THRESHOLD(K-driven 峰值)
        //   ② sectionType ∈ {BuildUp, Drop}(类型驱动 — 音乐性"drop ducking")
        //
        // 理由:BuildUp 段虽 energyLevel 来自模板原值(非真高),但 musically 应让位主奏;
        //       Drop 段是 EDM 经典侧链场景,自然触发。
        const isApexSection = k > APEX_K_THRESHOLD
            || section.sectionType === SectionType.BuildUp
            || section.sectionType === SectionType.Drop;
        if (!isApexSection) continue;

        const plan = bandPlan.sectionPlans[sIdx];
        if (plan === undefined) continue;

        for (let r = 0; r < DUCKING_TARGET_ROLES.length; r++) {
            const role = DUCKING_TARGET_ROLES[r];
            const assignment = plan.assignments[role];
            if (assignment === undefined) continue;

            assignment.apexActive = true;
            assignment.suppressionFactor = DEFAULT_SUPPRESSION_FACTOR;
            // 镜像到 instrumentSpecificParams(Idiom 通过 params 消费)
            if (assignment.instrumentSpecificParams !== undefined
                && typeof assignment.instrumentSpecificParams === 'object'
                && assignment.instrumentSpecificParams !== null) {
                const params = assignment.instrumentSpecificParams as {
                    apexActive?: boolean; suppressionFactor?: number;
                };
                params.apexActive = true;
                params.suppressionFactor = DEFAULT_SUPPRESSION_FACTOR;
            }
        }
    }
}
