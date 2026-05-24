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
import { findSectionIdxForBeat } from './Conductor';

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

// findSectionIdx 已删 — 直接调 Conductor.findSectionIdxForBeat(binary search O(log n))

// ============================================================
// v1.2 — Drop / BuildUp 段落动态
// ============================================================

/** Drop section 阈值:energyLevel < 此值视为 drop 段 */
const DROP_ENERGY_THRESHOLD = 3;
/** BuildUp 触发阈值:下一段 energy 比当前段高 ≥ 此值视为 BuildUp */
const BUILDUP_ENERGY_DELTA = 2;

export type InstrumentKind = 'melody' | 'accomp' | 'bass' | 'pad';

/**
 * Per-instrument-kind 段落动态响应表。
 *   drop:drop 段 velocity multiplier
 *   buildupRampMax:buildup 最后 1 bar 末尾 velocity 上限(线性从 1.0 → 此值)
 */
const DYNAMICS_TABLE: Record<InstrumentKind, { drop: number; buildupRampMax: number }> = {
    melody: { drop: 1.0,  buildupRampMax: 1.15 },   // hero:drop 不动,buildup 突出
    accomp: { drop: 0.5,  buildupRampMax: 1.20 },   // 让位 + 强突出
    bass:   { drop: 0.6,  buildupRampMax: 1.15 },   // 保留 anchor + 突出
    pad:    { drop: 1.2,  buildupRampMax: 1.10 },   // 反向突出(drop 接管 ambient)
};

type SectionDynamicState = 'drop' | 'buildup' | 'normal';

function classifySectionDynamic(idx: number, sections: SectionMetadata[]): SectionDynamicState {
    const cur = sections[idx];
    if (cur.energyLevel < DROP_ENERGY_THRESHOLD) return 'drop';
    if (idx + 1 < sections.length) {
        const next = sections[idx + 1];
        if (next.energyLevel > cur.energyLevel + BUILDUP_ENERGY_DELTA) return 'buildup';
    }
    return 'normal';
}

// ============================================================
// v1.1 — 撞音检测 + damp
// ============================================================

/** 撞音时间窗口(beat):accomp event 与 bass/melody 的 onset 差 < 此值视为同 onset */
const COLLISION_TIME_WINDOW = 0.05;
/** Bass 低音区上限(pitch),accomp event pitch 低于此值才检测 vs bass 撞音 */
const BASS_REGION_PITCH_MAX = 60;
/** Melody 区下限,accomp event pitch 高于此值才检测 vs melody 撞音 */
const MELODY_REGION_PITCH_MIN = 60;
/** 撞音 damp 因子(accomp velocity × 此值) */
const COLLISION_DAMP_FACTOR = 0.5;

/** pitch class(0-11)— 抹掉八度差异 */
function pitchClass(pitch: number): number {
    return ((pitch % 12) + 12) % 12;
}

/**
 * Onset-bucket Map:把 events 按 onset 分桶,key = floor(onset / BUCKET_SIZE)。
 * BUCKET_SIZE = COLLISION_TIME_WINDOW(0.05 beat)。
 * 查 collision 时,只看 [bucket-1, bucket, bucket+1] 三桶(覆盖 ±BUCKET_SIZE 容差)。
 *
 * 复杂度:构造 O(n);per-query O(k)k≈3 桶内 event 数(通常 < 5)。
 * 原 O(n×m) 实现:每个 accomp event 全扫 bass/melody → 22,500 比较/首歌。
 * 优化后:~3,000 比较/首歌(85% 削减)。
 */
function buildOnsetBuckets(events: NoteData[]): Map<number, NoteData[]> {
    const buckets = new Map<number, NoteData[]>();
    for (const ev of events) {
        const key = Math.floor(ev.onset / COLLISION_TIME_WINDOW);
        const arr = buckets.get(key);
        if (arr) arr.push(ev);
        else buckets.set(key, [ev]);
    }
    return buckets;
}

/** 检测 accomp event 在 buckets 内有无同时间 + 同 PC 撞音 */
function hasCollisionBucketed(
    accompEvent: NoteData,
    buckets: Map<number, NoteData[]>,
): boolean {
    const accompPc = pitchClass(accompEvent.pitch);
    const baseKey = Math.floor(accompEvent.onset / COLLISION_TIME_WINDOW);
    for (let k = baseKey - 1; k <= baseKey + 1; k++) {
        const candidates = buckets.get(k);
        if (!candidates) continue;
        for (const cn of candidates) {
            if (Math.abs(cn.onset - accompEvent.onset) > COLLISION_TIME_WINDOW) continue;
            if (pitchClass(cn.pitch) === accompPc) return true;
        }
    }
    return false;
}

// Phase C add11 人手物理(原在此)已下沉到 PianoIdiom.planMelody 内化
// (C.5 末:cross-track pitch 协调归属 musician 层,Reconciler 专注 velocity / 动态层)

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
            const sIdx = findSectionIdxForBeat(ev.onset, sections);
            const scale = sIdx >= 0 ? energyScale(sections[sIdx].energyLevel) : 1.0;
            const newVel = ev.velocity * scale;
            out[i] = {
                ...ev,
                velocity: newVel < 0 ? 0 : newVel > 1 ? 1 : newVel,
            };
        }
        return out;
    },

    /**
     * v1.1 — 撞音检测 + accomp damp。
     *
     * 优先级 melody > bass > accomp > pad > drums,只 damp accomp(melody/bass
     * 是 mg 主输出不动)。
     *
     * 触发规则:
     *   1. accomp.pitch < BASS_REGION_PITCH_MAX(60)且与 bass 同 onset±0.05 +
     *      同 pitch class → damp(让 bass 主导低频)
     *   2. accomp.pitch >= MELODY_REGION_PITCH_MIN(60)且与 melody 同 onset±0.05 +
     *      同 pitch class → damp(让 melody 主导顶音)
     *
     * Damp 方式:velocity × COLLISION_DAMP_FACTOR(0.5)。
     */
    dampAccompForCollisions(
        accomp: NoteData[],
        bass: NoteData[],
        melody: NoteData[],
    ): NoteData[] {
        if (accomp.length === 0) return accomp;

        // 预构造 onset-bucket(O(n))— 后续 per-accomp 查询 O(1) 桶定位 + O(k) 桶内扫
        const bassBuckets = buildOnsetBuckets(bass);
        const melodyBuckets = buildOnsetBuckets(melody);

        const out: NoteData[] = new Array(accomp.length);
        for (let i = 0; i < accomp.length; i++) {
            const ev = accomp[i];
            let damped = false;

            if (ev.pitch < BASS_REGION_PITCH_MAX && hasCollisionBucketed(ev, bassBuckets)) {
                damped = true;
            } else if (ev.pitch >= MELODY_REGION_PITCH_MIN && hasCollisionBucketed(ev, melodyBuckets)) {
                damped = true;
            }

            out[i] = damped
                ? { ...ev, velocity: ev.velocity * COLLISION_DAMP_FACTOR }
                : { ...ev };
        }
        return out;
    },

    /**
     * v1.2 — Drop / BuildUp 段落动态。
     *
     * Drop 段(energy<3):velocity multiplier 按 kind 表(accomp/bass 减弱,
     *   pad 反向突出接管 ambient,melody 不动 hero)。
     * BuildUp 段(next.energy > cur+2):最后 1 bar 内 velocity 线性 ramp(每 kind
     *   有不同 ramp max,如 accomp 上到 1.20、melody 上到 1.15)。
     *
     * Drums 由调用方跳过 — DrumIdiom 内部已感知 isBuildUp(Tom Fill)。
     */
    applyDropBuildupDynamics(
        events: NoteData[],
        sections: SectionMetadata[],
        kind: InstrumentKind,
        beatsPerMeasure: number = 4,
    ): NoteData[] {
        if (events.length === 0 || sections.length === 0) return events;

        const sectionStates = sections.map((_, i) => classifySectionDynamic(i, sections));
        const config = DYNAMICS_TABLE[kind];

        const out: NoteData[] = new Array(events.length);
        for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            const sIdx = findSectionIdxForBeat(ev.onset, sections);
            if (sIdx < 0) {
                out[i] = { ...ev };
                continue;
            }
            const state = sectionStates[sIdx];
            const section = sections[sIdx];

            let velMul = 1.0;

            if (state === 'drop') {
                velMul = config.drop;
            } else if (state === 'buildup') {
                // 仅最后 1 bar 应用 ramp
                const lastBarStart = section.endBeat - beatsPerMeasure;
                if (ev.onset >= lastBarStart) {
                    const progress = (ev.onset - lastBarStart) / beatsPerMeasure;
                    const clamped = progress < 0 ? 0 : progress > 1 ? 1 : progress;
                    velMul = 1.0 + (config.buildupRampMax - 1.0) * clamped;
                }
            }

            if (velMul === 1.0) {
                out[i] = { ...ev };
            } else {
                const newVel = ev.velocity * velMul;
                out[i] = {
                    ...ev,
                    velocity: newVel < 0 ? 0 : newVel > 1 ? 1 : newVel,
                };
            }
        }
        return out;
    },
};
