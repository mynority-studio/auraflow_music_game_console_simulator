/**
 * BassIdiom — 最基础贝斯（Layer 1：Root Anchor）
 *
 * 职责：每个和弦起拍打一个 root，sustain 至和弦结尾。零 PRNG，确定性。
 *
 * 算法：
 *   对每个 chord：
 *     pitch    = BASS_ANCHOR + (chord.bassOverride ?? chord.root)
 *     onset    = chord.startBeat
 *     duration = chord.endBeat - chord.startBeat
 *     velocity = persona.dynamicRange 上限（贝斯锚定要稳，不抖力度）
 *
 * Pitch Space (K-1 / K-2 / K-7)：
 *   RELATIVE — BASS_ANCHOR=24 (C1 RELATIVE 主音)，chord.root/bassOverride 是 PC 0-11。
 *   Orchestrator.applyOffset 再叠加 keyOffset → ABSOLUTE 落在 C1~A#2 (24~46) 区间，
 *   位于 CLAUDE.md 物理音域 E1~G2 周围 — GM Acoustic Bass 标称响应区。
 *
 * Slash 和弦支持：
 *   chord.bassOverride !== undefined 时优先（T-5：显式 !== undefined，不靠 falsy）。
 *
 * PRNG 消耗：0（不动 Stage5 PRNG 顺序锁）。
 *
 * 后续可扩展（不破坏当前接口）：
 *   - Layer 2：长和弦（>= 4 拍）中位补一击 root（更稳的节拍感）
 *   - Layer 3：根 → 五度 → 根 → 三度 的 walking bass（NeoSoul/Jazz 用）
 *   - Layer 4：persona / styleId 驱动的 groove pattern（slap / ghost / 切分）
 */

import { GeneratedChord, MusicianPersona, NoteData, Tonality } from '../types';
import { StyleId } from '../config/StyleFlags';

const EPSILON = 1e-6;
const BASS_ANCHOR = 24;   // C1 RELATIVE — 与 Stage5Layering 文档注释一致

export interface BassIdiomInput {
    chords: GeneratedChord[];
    styleId: StyleId;
    tonality: Tonality;
    persona: MusicianPersona;
}

export class BassIdiom {
    /**
     * Pitch Space: RELATIVE — 输出 pitch 不含 keyOffset。
     *
     * PRNG 消耗：0
     */
    public static render(input: BassIdiomInput): NoteData[] {
        const out: NoteData[] = [];
        const veloHi = input.persona.dynamicRange[1];
        const velocity = veloHi / 127;

        for (let i = 0; i < input.chords.length; i++) {
            const chord = input.chords[i];
            const duration = chord.endBeat - chord.startBeat;
            if (duration < EPSILON) continue;

            // slash 和弦优先：C/E → bassOverride=4 替代 root；否则用 chord.root
            const pc = chord.bassOverride !== undefined ? chord.bassOverride : chord.root;
            const pitch = BASS_ANCHOR + (((pc % 12) + 12) % 12);

            out.push({
                pitch,
                onset: chord.startBeat,
                duration,
                velocity,
            });
        }
        return out;
    }
}
