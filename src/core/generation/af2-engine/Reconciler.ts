// ============================================================
// AF2 Reconciler — 跨乐手协调与 events 后处理
// ============================================================
//
// 用户原愿景"总编曲层"的落地:跨乐手协调、撞音 damp、drop/buildup 决策、
// 跑调检测等。Phase 3 起分版本递增:
//
//   v1.0 — 段落能量驱动 velocity humanization                ← 当前
//   v1.1 — 撞音检测 + damp(跨乐手 pitch 冲突)               (Phase 3.x)
//   v1.2 — Drop / BuildUp 决策(段落动态 — 静音 / fill 触发) (Phase 3.x)
//   v1.3 — 跑调检测(跨乐手 chord-aware 校验)                (Phase 3.x)
//
// 设计原则:
//   - 纯函数,接收 events + sections,返回新 events(不 mutate 原数组)
//   - 不改 pitch / onset / duration / part / sectionIdx
//   - 改 velocity 是合法的(humanization 是音乐 standard 做法)
// ============================================================

import type { NoteData, SectionMetadata } from '../types';

/**
 * energyLevel(1-10)→ velocity 缩放因子。
 * 设计曲线:
 *   energy 1 → 0.70 (intro / outro 极弱)
 *   energy 5 → 1.00 (中段不变,保 idiom 原 velocity)
 *   energy 10 → 1.10 (chorus 略强,不超 +10% 避免 clip)
 *
 * 1-5 段:线性 0.70 → 1.00(每级 +0.075)
 * 5-10 段:线性 1.00 → 1.10(每级 +0.020,曲线更平)
 *
 * 数组形式便于未来 per-style 调参(将来可扩展为 style-specific scale)。
 */
const ENERGY_VEL_SCALE: ReadonlyArray<number> = [
    0.70, 0.775, 0.85, 0.925, 1.00,   // energy 1-5
    1.02, 1.04, 1.06, 1.08, 1.10,     // energy 6-10
];

/** clamp energyLevel 到 [1, 10] 索引 [0, 9] */
function energyScale(energyLevel: number | undefined): number {
    if (energyLevel === undefined || !Number.isFinite(energyLevel)) return 1.0;
    const i = (energyLevel | 0);
    if (i < 1) return ENERGY_VEL_SCALE[0];
    if (i > 10) return ENERGY_VEL_SCALE[9];
    return ENERGY_VEL_SCALE[i - 1];
}

/**
 * 查 onset 所在 section index。
 * sections 应按 startBeat 升序且无 gap(SectionPlanner 输出已满足)。
 */
function findSectionIdx(onset: number, sections: SectionMetadata[]): number {
    if (sections.length === 0) return -1;
    for (let i = 0; i < sections.length; i++) {
        if (onset < sections[i].endBeat) return i;
    }
    return sections.length - 1;
}

export const Reconciler = {
    /**
     * v1.0 — 段落能量驱动 velocity humanization。
     *
     * 对每个 event 按 onset 查段落 energy,缩放 velocity。
     * 输入 events 不被 mutate(返回新数组 + 新对象)。
     *
     * 调用方应只对**不自带 energy 响应**的轨道用(melody / accompaniment / bass),
     * drums / atmosphere 已自带响应,二次缩放会过度。
     */
    applyEnergyHumanization(events: NoteData[], sections: SectionMetadata[]): NoteData[] {
        if (events.length === 0 || sections.length === 0) return events;

        const out: NoteData[] = new Array(events.length);
        for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            const sIdx = findSectionIdx(ev.onset, sections);
            const scale = sIdx >= 0 ? energyScale(sections[sIdx].energyLevel) : 1.0;
            const newVel = ev.velocity * scale;
            out[i] = {
                ...ev,
                velocity: newVel < 0 ? 0 : newVel > 1 ? 1 : newVel,
            };
        }
        return out;
    },
};
