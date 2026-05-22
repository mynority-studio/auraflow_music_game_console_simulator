// ============================================================
// PianoIdiom — AF2 钢琴乐器 idiom(Phase A:槽位 API split;Phase B:音区概率分布)
// ============================================================
//
// 在用户的三层架构里,本文件属于**"世界规则库" 之 "乐器 baseidiom"**子层
//(AF2 私有版本,Phase N 删 AF/MG 后可考虑提升到顶层 src/core/generation/instruments/)。
//
// Phase A 职责:按 role 拆 3 个 API(realizeMelody / realizeAccomp / realizeBass)。
// Phase B 职责:实装 95% 主区音区分布 + 5% 越界保留。
//
// Phase B 音区设计:
//   realizeMelody  主区 [C4=60, D6=86]    超主区音 95% 拉回 / 5% 越界保留
//   realizeAccomp  主区 [C3=48, B4=71]    超主区音 95% 拉回 / 5% 越界保留
//   realizeBass    主区 [A1=33, G3=55]    超主区音 95% 拉回 / 5% 越界保留
//
// 概率门用 deterministic hash(pitch + onset)— 不消耗 PRNG,可重现。
// 拉回 = 八度移调(±12 半音)直到落入主区。
//
// 与 mg 偏离声明:Phase B 是 AF2 主动改 pitch(八度移调),与 Phase 1 的"直通忠实
// mg"不一致。但 2026-05-21 reframe 后 AF2 ≠ MG bit-exact 已可接受,验收锚点改为
// "AF2 听感不输给 mg-standalone"。
//
// 物理声明(供 BandSelectionPanel 校验槽位):
//   - 音域:21-108(标准 88 键)
//   - 可放槽位:MainInst / Accomp / Bass(钢琴能独奏可主奏可伴奏可做低音)
//   - 不能放:Drums / Vocal(物理性质不同)
// ============================================================

import type { NoteData } from '../../types';
import { BandRole } from '../../types';
// C.5:MusicianPlanInput 共享协议 + per-section role gate
import type { MusicianPlanInput, ConductorRole } from '../Conductor';
import { getMyRolesInSection, findSectionIdxForBeat } from '../Conductor';

/** 钢琴物理参数(Phase 1 仅文档,Phase 2+ BandSelectionPanel 消费) */
export const PIANO_INSTRUMENT_SPEC = {
    /** GM program number(Grand Piano) */
    gmProgram: 0,
    /** 物理音域(MIDI) */
    rangeLo: 21,
    rangeHi: 108,
    /** 可放置的乐队槽位 */
    eligibleSlots: [BandRole.MainInst, BandRole.Accomp, BandRole.Bass] as const,
} as const;

/** 各 role 的主区(MIDI 边界,inclusive)。Phase B 实装,Phase C 可让 musician 卡覆盖。 */
export const PIANO_REGIONS = {
    melody: { lo: 60, hi: 86 },  // C4 - D6(soprano 主流域)
    accomp: { lo: 48, hi: 71 },  // C3 - B4(中低 comping 域)
    bass:   { lo: 33, hi: 55 },  // A1 - G3(piano LH / bass)
} as const;

/** 5% 越界保留概率(95% 拉回主区) */
const ESCAPE_PROBABILITY = 0.05;

/**
 * Deterministic hash(pitch + onset)→ [0, 1) 浮点。
 * 用 32-bit Mulberry-like 混合 + 取低位,稳定可重现,不消耗 PRNG。
 */
function detHash01(pitch: number, onset: number): number {
    // mix integer pitch + onset (quantized to 1/16 beat) into 32-bit
    const seedInt = ((pitch & 0xff) << 16) ^ Math.floor(onset * 16) ^ 0x9e3779b9;
    let x = seedInt >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
    x = (x ^ (x >>> 16)) >>> 0;
    return (x & 0xffffff) / 0x1000000;  // → [0, 1)
}

/**
 * 把单音 pitch 按"主区 + 越界概率"约束调整。
 *
 *   pitch 在 [lo, hi] 内:直通
 *   pitch 在主区外:
 *     - escape 命中(<5%):保留越界 pitch(自然感 / 小概率越界)
 *     - 否则(95%):八度移调到主区(±12 直到落入)
 *
 * 越界往主区折叠时优先选离原 pitch 最近的八度,保留 voice-leading 语义。
 */
function applyRegionProbability(
    notes: NoteData[],
    region: { lo: number; hi: number },
): NoteData[] {
    return notes.map(n => {
        if (n.pitch >= region.lo && n.pitch <= region.hi) return { ...n };
        const escape = detHash01(n.pitch, n.onset) < ESCAPE_PROBABILITY;
        if (escape) return { ...n };
        // 95% 路径:八度移调拉回主区
        let p = n.pitch;
        while (p < region.lo) p += 12;
        while (p > region.hi) p -= 12;
        // p 现在在 [region.lo - 11, region.hi] 内,clamp 保险
        if (p < region.lo) p = region.lo;
        if (p > region.hi) p = region.hi;
        return { ...n, pitch: p };
    });
}

/**
 * 内部 helper:per-section role gate + Phase B region clamp。
 *
 * 1. 从 input.notes[role] 取本 role 的原料 events
 * 2. 每 note 查 sectionIdx → getMyRolesInSection → 不含 role 则 skip
 * 3. 通过的 notes 走 Phase B 音区概率分布
 */
function planForRole(
    input: MusicianPlanInput,
    role: ConductorRole,
    region: { lo: number; hi: number },
): NoteData[] {
    const raw = input.notes?.[role] ?? [];
    if (raw.length === 0) return [];
    const filtered: NoteData[] = [];
    for (const n of raw) {
        const sectionIdx = findSectionIdxForBeat(n.onset, input.score.sections);
        if (sectionIdx < 0) continue;
        const myRoles = getMyRolesInSection(input, sectionIdx);
        if (!myRoles.includes(role)) continue;  // Conductor 让我这段 silent for this role
        filtered.push(n);
    }
    return applyRegionProbability(filtered, region);
}

export const PianoIdiom = {
    /**
     * C.5:plan melody role(MainInst 槽 + Conductor 给本 musician 分 'melody' role 的 sections)。
     *
     * 流程:input.notes.melody 是 mg 原料 → per-section role gate → Phase B 音区概率分布。
     *
     * Phase B 主区 [C4, D6],超出 95% 拉回 / 5% 越界保留。
     * Phase D+ 计划:melody 技巧 / 装饰 / passing tones / cross-track 物理(add11)
     */
    planMelody(input: MusicianPlanInput): NoteData[] {
        return planForRole(input, 'melody', PIANO_REGIONS.melody);
    },

    /**
     * C.5:plan accomp role(Accomp 槽 + Conductor 给本 musician 分 'accomp' role 的 sections)。
     *
     * Phase B 主区 [C3, B4],超出 95% 拉回 / 5% 越界保留。
     * Phase D+ 计划:柱式 / 分解 / smart omit + add11 hand-spread 约束
     */
    planAccomp(input: MusicianPlanInput): NoteData[] {
        return planForRole(input, 'accomp', PIANO_REGIONS.accomp);
    },

    /**
     * C.5:plan bass role(钢琴占 Bass 槽时,无电贝斯)。
     *
     * Phase B 主区 [A1, G3],超出 95% 拉回 / 5% 越界保留。
     * Phase D+ 计划:walking / stride / boogie 技巧
     */
    planBass(input: MusicianPlanInput): NoteData[] {
        return planForRole(input, 'bass', PIANO_REGIONS.bass);
    },

    /**
     * 取 GM program number(供 MusicContext.gmProgramOverrides 装配)。
     */
    getGmProgram(): number {
        return PIANO_INSTRUMENT_SPEC.gmProgram;
    },
};
