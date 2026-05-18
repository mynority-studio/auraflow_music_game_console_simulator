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
    kickAnchors?: number[];
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

            const pc = chord.bassOverride !== undefined ? chord.bassOverride : chord.root;
            const pitch = BASS_ANCHOR + (((pc % 12) + 12) % 12);

            let hasHits = false;
            if (input.kickAnchors && input.kickAnchors.length > 0) {
                for (let j = 0; j < input.kickAnchors.length; j++) {
                    const kOnset = input.kickAnchors[j];
                    // 检查 kick 是否落在当前和弦内
                    if (kOnset >= chord.startBeat - EPSILON && kOnset < chord.endBeat - EPSILON) {
                        let nextOnset = chord.endBeat;
                        if (j + 1 < input.kickAnchors.length && input.kickAnchors[j + 1] < chord.endBeat) {
                            nextOnset = input.kickAnchors[j + 1];
                        }
                        // 留出间隙形成 staccato feel (Bass-Kick interlock)
                        const dur = Math.max(0.125, (nextOnset - kOnset) * 0.85);
                        out.push({ pitch, onset: kOnset, duration: dur, velocity });
                        hasHits = true;
                    }
                }
            }

            // 兜底：如果这段没有 kick，依然在起拍打底
            if (!hasHits) {
                out.push({ pitch, onset: chord.startBeat, duration, velocity });
            }
        }
        return out;
    }
}
