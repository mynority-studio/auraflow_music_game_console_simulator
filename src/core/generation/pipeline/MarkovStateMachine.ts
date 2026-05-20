// ============================================================
// MarkovStateMachine — 宏观状态机(Phase 5)
// ============================================================
//
// PEAA 理论中的三态:
//   - Limbo (混沌态):  rubato,grid 解除(我们不实装 — 与全局 grid 架构冲突)
//   - Establish (确立态): 默认状态,所有乐器按 grid 演奏(无新逻辑)
//   - Drop (真空态):    BuildUp 末尾 1 小节,Bass + Drums 静默,Atmosphere + Lead 独白
//
// Phase 5 实装:**仅 Drop 状态**。Limbo 延后到 Phase 6+(需要 rubato 时序基础)。
//
// 触发模式("EDM Drop"经典效果):
//   BuildUp 段后接 Chorus 时,30% 概率把 BuildUp 最后 4 拍标为 Drop:
//     - Bass + Drums 在该窗口产 0 note(突然抽空)
//     - Atmosphere + Lead 继续(Vacuum Blossom 独白)
//     - Chorus 段头则全力轰炸 — 戏剧反差极强
//
// 概率说明:
//   - 30% 是 Phase 5 起点(便于听感观察 Drop 效果)
//   - 听感后可降低到 5-10%(更符合"罕见"PEAA 设定)
//   - hash01(sectionIdx) 决定 — 同 seed 同 section 必然同结果(D-5 友好)
//
// 关联规则:
//   - cross_sync_rule §1.13:Drop 字段 ↔ Conductor 触发 ↔ Bass/Drum 消费链
//   - Phase 4 Apex 不与 Drop 冲突 — Apex 在整段 ducking velocity,Drop 在末 4 拍硬切
//
// 零 PRNG。
// ============================================================

import {
    BandPlan, BandRole, SectionMetadata, SectionType, ActiveMusician,
} from '../types';
import type { WeatherSampler } from './RenderContext';

// ============================================================
// 常量
// ============================================================

/** Drop 触发概率(Phase 5 起点,听感后可调) */
const DROP_TRIGGER_PROBABILITY = 0.30;

/** Drop 持续 beat 数(Phase 5 固定 4 拍 = 1 小节 @ 4/4) */
const DROP_DURATION_BEATS = 4;

// ============================================================
// 工具
// ============================================================

/** Deterministic hash sectionIdx → [0, 1),零 PRNG */
function hash01(sectionIdx: number, salt: number): number {
    let h = ((sectionIdx | 0) * 2654435761 + (salt | 0) * 40503) | 0;
    h = (h >>> 0) & 0xFFFFFFFF;
    return h / 0x100000000;
}

// ============================================================
// 主入口:为 bandPlan 注入 Drop 标记
// ============================================================

/**
 * 检测 BuildUp → Chorus 边界,按概率激活 Drop。
 *
 * 触发条件:
 *   1. 当前段 sectionType === BuildUp
 *   2. 下段存在且 sectionType === Chorus
 *   3. hash01(sectionIdx, sectionIdx+1) < DROP_TRIGGER_PROBABILITY
 *   4. BuildUp 段长度 ≥ DROP_DURATION_BEATS(否则没空间放 Drop)
 *
 * 副作用:in-place 写 plan.dropFromBeat = section.endBeat - DROP_DURATION_BEATS
 */
export function attachDropStates(
    bandPlan: BandPlan,
    sections: SectionMetadata[],
    _weather: WeatherSampler,           // Phase 5 暂未消费,Phase 6+ 可用 K 推高概率
    _activeMusicians: ActiveMusician[], // 同上
): void {
    for (let sIdx = 0; sIdx < sections.length - 1; sIdx++) {
        const section = sections[sIdx];
        const nextSection = sections[sIdx + 1];

        // 触发条件 1+2:BuildUp 后接 Chorus
        if (section.sectionType !== SectionType.BuildUp) continue;
        if (nextSection.sectionType !== SectionType.Chorus) continue;

        // 触发条件 4:段长 ≥ Drop 时长
        const sectionLen = section.endBeat - section.startBeat;
        if (sectionLen < DROP_DURATION_BEATS) continue;

        // 触发条件 3:概率
        const roll = hash01(sIdx, sIdx + 1);
        if (roll >= DROP_TRIGGER_PROBABILITY) continue;

        // 激活 Drop
        const plan = bandPlan.sectionPlans[sIdx];
        if (plan === undefined) continue;
        plan.dropFromBeat = section.endBeat - DROP_DURATION_BEATS;
    }
}

// ============================================================
// 工具:判断 note 是否落在 Drop 窗口内(供 BassIdiom / DrumIdiom 消费)
// ============================================================

/**
 * 给定 sections + bandPlan,返回所有 Drop 窗口 [from, to) 数组。
 *
 * Idiom 渲染后扫描自己的 NoteData[],过滤 onset 落在任一 drop 窗口内的 notes。
 *
 * 复杂度 O(N) N=sections 数,通常 ≤ 12。
 */
export function collectDropWindows(
    bandPlan: BandPlan, sections: SectionMetadata[],
): { from: number; to: number }[] {
    const out: { from: number; to: number }[] = [];
    for (let sIdx = 0; sIdx < sections.length; sIdx++) {
        const plan = bandPlan.sectionPlans[sIdx];
        if (plan === undefined || plan.dropFromBeat === undefined) continue;
        out.push({ from: plan.dropFromBeat, to: sections[sIdx].endBeat });
    }
    return out;
}

/**
 * 过滤 notes,移除 onset 落在 drop 窗口内的项(就地 in-place)。
 *
 * 用于 BassIdiom / DrumIdiom 渲染后的"真空切除"。
 * 注意:**不能在渲染时 skip step** — DrumIdiom D-5 PRNG 配额铁律要求每 step ×3 gate
 * PRNG 必恒,只能事后剔除。
 */
export function filterNotesByDropWindows(
    notes: { onset: number }[],
    windows: { from: number; to: number }[],
): void {
    if (windows.length === 0) return;
    let writeIdx = 0;
    for (let i = 0; i < notes.length; i++) {
        const onset = notes[i].onset;
        let inDrop = false;
        for (let w = 0; w < windows.length; w++) {
            if (onset >= windows[w].from && onset < windows[w].to) {
                inDrop = true; break;
            }
        }
        if (!inDrop) {
            if (writeIdx !== i) notes[writeIdx] = notes[i];
            writeIdx++;
        }
    }
    notes.length = writeIdx;
}

// ============================================================
// 引用:BandRole 在本模块只用作类型注释,运行期未导入(避免循环)
// ============================================================
void BandRole;  // 占位 — Phase 5 暂未用 BandRole,Phase 6+ Solo 引擎可能用
