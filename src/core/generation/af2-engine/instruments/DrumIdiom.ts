// ============================================================
// DrumIdiom — AF2 鼓组 idiom(Phase 2a)
// ============================================================
//
// 决策(PHASE2A.md §10):
//   Q2 A:阈值跳变 — energy 1-3 仅 Kick / 4-5 加 Snare / 6+ 加 Hihat 8th
//
// 职责(Phase 2a):
//   DrumGenerator 消费 sections + beatsPerMeasure,生成 GM Drum Map NoteData[]。
//   **完全 AF 自生成**,不接 mg(mg 不生成 drums)。
//
// 算法(Q2 A — 阈值跳变):
//   for each section:
//     for each bar:
//       Kick on beat 1+3 (always)
//       if energy >= 4: Snare on beat 2+4
//       if energy >= 6: Hihat 8th notes (4分细分到 8分)
//       else if energy >= 3: Hihat quarter notes
//
// 物理约束:
//   - **GM Drum Map 物理键位**(K-8 第三空间,**禁止 keyOffset 加移**)
//     Kick=36 / Snare=38 / Closed Hihat=42
//   - **Channel 9 硬路由**(由 MidiConverter 处理)
//   - eligibleSlots: [Drums]
//
// PRNG:**0**(完全决定性,只依赖 sections + beatsPerMeasure)
// ============================================================

import type { NoteData, SectionMetadata } from '../../types';
import { BandRole } from '../../types';

/** GM Drum Map 物理键位 */
const DRUM_KICK = 36;
const DRUM_SNARE = 38;
const DRUM_CLOSED_HIHAT = 42;

/** 击点固定时长(32 分音符,attack-only,GM Drum 自带 envelope) */
const HIT_DURATION = 0.125;

/** Drum 物理参数 */
export const DRUM_INSTRUMENT_SPEC = {
    /** Drums 不设 gmProgram — Channel 9 硬路由 GM Drum Map */
    eligibleSlots: [BandRole.Drums] as const,
} as const;

export interface DrumGeneratorInput {
    sections: SectionMetadata[];
    beatsPerMeasure: number;
}

export const DrumGenerator = {
    /**
     * 生成 drums NoteData[],onset 升序 + 同 onset 按 pitch 升序。
     */
    generate(input: DrumGeneratorInput): NoteData[] {
        const { sections, beatsPerMeasure } = input;
        const out: NoteData[] = [];

        for (let s = 0; s < sections.length; s++) {
            const section = sections[s];
            const energy = section.energyLevel;
            const sectionBeats = section.endBeat - section.startBeat;
            const totalBars = Math.floor(sectionBeats / beatsPerMeasure);

            // velocity 基线(各类型按 energy 增长)
            const kickVel  = Math.min(0.95, 0.70 + energy * 0.02);
            const snareVel = Math.min(0.95, 0.60 + energy * 0.03);
            const hatVel   = Math.min(0.85, 0.40 + energy * 0.04);

            for (let bar = 0; bar < totalBars; bar++) {
                const barStart = section.startBeat + bar * beatsPerMeasure;

                // === Kick — 总在 beat 1 和 beat 3(假设 4/4) ===
                for (let k = 0; k < beatsPerMeasure; k += 2) {
                    out.push({
                        pitch: DRUM_KICK,
                        onset: barStart + k,
                        duration: HIT_DURATION,
                        velocity: kickVel,
                    });
                }

                // === Snare — energy >= 4 触发 (beat 2 和 4) ===
                if (energy >= 4) {
                    for (let s2 = 1; s2 < beatsPerMeasure; s2 += 2) {
                        out.push({
                            pitch: DRUM_SNARE,
                            onset: barStart + s2,
                            duration: HIT_DURATION,
                            velocity: snareVel,
                        });
                    }
                }

                // === Closed Hihat — 三档密度 ===
                if (energy >= 6) {
                    // 8th notes (每 0.5 beat 一击)
                    for (let h = 0; h < beatsPerMeasure * 2; h++) {
                        out.push({
                            pitch: DRUM_CLOSED_HIHAT,
                            onset: barStart + h * 0.5,
                            duration: HIT_DURATION,
                            velocity: hatVel,
                        });
                    }
                } else if (energy >= 3) {
                    // Quarter notes (每 beat 一击)
                    for (let h = 0; h < beatsPerMeasure; h++) {
                        out.push({
                            pitch: DRUM_CLOSED_HIHAT,
                            onset: barStart + h,
                            duration: HIT_DURATION,
                            velocity: hatVel,
                        });
                    }
                }
                // energy < 3:无 Hihat(完全静默 + Kick 只)
            }
        }

        // 输出排序(onset 升序,同 onset 按 pitch 升序)
        out.sort((a, b) => a.onset - b.onset || a.pitch - b.pitch);
        return out;
    },
};

export const DrumIdiom = {
    /** Drums 透传 — 不像 Piano/Bass/Pad 有 idiom 后处理,因为 DrumGenerator 已经直接产 NoteData */
    realize(notes: NoteData[]): NoteData[] {
        return notes.map(n => ({ ...n }));
    },
};
