// ============================================================
// PadIdiom — AF2 氛围 pad idiom(Phase 2a)
// ============================================================
//
// 决策(PHASE2A.md §10):
//   Q1 C:借用 mg.chord.voicing(去最低音)+ 整体八度移动到 pad 中心区
//
// 职责(Phase 2a):
//   PadGenerator 消费 mg.chords + sections.energyLevel,生成长音 pad NoteData[]。
//   每和弦一击长音,持续整个 chord 区间(无 crossfade,Phase 2b 加)。
//
// 算法(Q1 C — 借用 mg 智慧):
//   for each chord:
//     1. 取 chord.voicing(已经过 mg voice-leading 优化的 MIDI 数组)
//     2. 去最低音(那是 bass,由 mg.bass / electricBass 通道负责)
//     3. 整体八度平移到 pad 中心区(平均 pitch ≈ G4 = 67)
//     4. clamp 到 PAD_RANGE_LO / HI
//     5. energy → velocity(段落能量驱动)
//     6. duration = chord.endBeat - chord.startBeat(整个 chord 区间)
//     7. 每个 voice 一条 NoteData
//
// 物理约束:
//   - GM 89 Warm Pad
//   - 音域 C3-C6(MIDI 48-84)— 不沉到 bass 区,不顶到 melody 区
//   - eligibleSlots: [Atmosphere]
//
// PRNG:**0**(完全决定性,只依赖 chord + sections)
// ============================================================

import type { NoteData, SectionMetadata } from '../../types';
import { BandRole } from '../../types';
// C.3:plan(score, role, peers) 协议 — Conductor + Score 架构地基
import type { Score } from '../Score';
import type { ConductorRole } from '../Conductor';

/** Pad 物理参数 */
export const PAD_INSTRUMENT_SPEC = {
    /** GM 89 Warm Pad */
    gmProgram: 89,
    rangeLo: 48,             // C3
    rangeHi: 84,             // C6
    eligibleSlots: [BandRole.Atmosphere] as const,
} as const;

/** Pad 中心区 — 算法 §4.2 Step 2 的目标平均 pitch 范围 */
const PAD_CENTER_LO = 60;    // C4
const PAD_CENTER_HI = 72;    // C5

/**
 * C.3 plan() 协议输入(全 musician planners 共享同一签名,C.5 提取到顶层
 * shared interface)。
 *
 *   score: 总谱(只读)
 *   role:  Conductor 分配给本 musician 的功能角色
 *   peers: 同伴 musicianId → 已 emit 的 notes(cross-track 协调用,Pad 当前不消费)
 */
export interface PadPlanInput {
    score: Score;
    role: ConductorRole;
    peers: ReadonlyMap<string, ReadonlyArray<NoteData>>;
}

/**
 * 根据 chord.startBeat 找它落在哪个段落,返回 energyLevel。
 * sections 应按 startBeat 升序且无 gap。
 */
function energyForBeat(beat: number, sections: ReadonlyArray<SectionMetadata>): number {
    if (sections.length === 0) return 5;  // 默认中等
    for (let i = 0; i < sections.length; i++) {
        if (beat < sections[i].endBeat) {
            return sections[i].energyLevel;
        }
    }
    return sections[sections.length - 1].energyLevel;
}

/**
 * 算法 Step 2:整体八度移动到 pad 中心区。
 * 直到 voicing 平均 pitch 落在 [PAD_CENTER_LO, PAD_CENTER_HI] 区间。
 */
function shiftToPadCenter(voicing: number[]): number[] {
    if (voicing.length === 0) return voicing;
    let shifted = voicing.slice();
    let avg = shifted.reduce((s, m) => s + m, 0) / shifted.length;

    // 防御性循环上限,避免数据异常导致死循环
    let guard = 16;
    while (avg > PAD_CENTER_HI && guard-- > 0) {
        shifted = shifted.map(m => m - 12);
        avg -= 12;
    }
    guard = 16;
    while (avg < PAD_CENTER_LO && guard-- > 0) {
        shifted = shifted.map(m => m + 12);
        avg += 12;
    }
    return shifted;
}

export const PadGenerator = {
    /**
     * C.3:plan(score, role, peers) — Conductor + Score 协议下乐手 plan 入口。
     *
     * role 检查:
     *   - 'silent' / 不是 'pad' → 返回 []
     *   - 'pad' → 按 Score 编自己演奏
     *
     * peers 字段当前不消费(Pad 暂不需要 cross-track 协调);保留作 C.5+ 时让
     * 其他 musicians 看 pad notes 用。
     *
     * 算法等价原 generate(input):只是把 input.chords / sections 来源改为 score。
     */
    plan(input: PadPlanInput): NoteData[] {
        if (input.role !== 'pad') return [];
        // peers 暂不消费(C.3 试点)
        void input.peers;
        const { score } = input;
        const chords = score.chords;
        const sections = score.sections;
        const out: NoteData[] = [];

        for (let i = 0; i < chords.length; i++) {
            const chord = chords[i];

            // Step 1: 取 voicing(已 voice-leading 优化)
            if (!chord.voicing || chord.voicing.length < 2) continue;
            let voicing = chord.voicing.slice().sort((a, b) => a - b);

            // Step 2: 去最低音(bass)
            voicing.shift();
            if (voicing.length === 0) continue;

            // Step 3: 整体八度移动到 pad 中心区
            voicing = shiftToPadCenter(voicing);

            // Step 4: 边界 clamp 到 [PAD_RANGE_LO, PAD_RANGE_HI]
            voicing = voicing.filter(
                m => m >= PAD_INSTRUMENT_SPEC.rangeLo && m <= PAD_INSTRUMENT_SPEC.rangeHi,
            );
            if (voicing.length === 0) continue;

            // Step 5: energy → velocity
            const energy = energyForBeat(chord.startBeat, sections);
            const velocityRaw = 0.3 + energy * 0.06;
            const velocity = velocityRaw < 0.3 ? 0.3 : velocityRaw > 0.9 ? 0.9 : velocityRaw;

            // Step 6: duration = 整个 chord 区间
            const duration = chord.endBeat - chord.startBeat;
            if (duration <= 0) continue;

            // Step 7: 每 voice 一条 NoteData
            for (const pitch of voicing) {
                out.push({
                    pitch,
                    onset: chord.startBeat,
                    duration,
                    velocity,
                });
            }
        }

        // 输出排序(onset 升序,同 onset 按 pitch 升序)
        out.sort((a, b) => a.onset - b.onset || a.pitch - b.pitch);
        return out;
    },
};

export const PadIdiom = {
    realize(notes: NoteData[]): NoteData[] {
        return notes.map(n => ({ ...n }));
    },

    getGmProgram(): number {
        return PAD_INSTRUMENT_SPEC.gmProgram;
    },
};
