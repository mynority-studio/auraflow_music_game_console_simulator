/**
 * Orchestrator — RELATIVE → ABSOLUTE 转换器（K-2 唯一执行点）
 *
 * 职责（pipeline rule §1.4 step 3）：
 *   消费 Stage 5 输出的 GeneratedTrack（pitch 全部 RELATIVE 空间），
 *   产出 ArrangedTrack（pitch 全部 ABSOLUTE 空间，可直送 MIDI 合成器）。
 *
 * 这是全管线**唯一**允许把 keyOffset 加到 NoteData.pitch 的位置（K-2 铁律）。
 * 上游所有 Stage（HarmonyCore / RhythmMutator / TextureMapper / Fractal / PCFG）
 * 严禁触碰 keyOffset；Orchestrator 之后的所有消费者（MidiConverter / PlaybackEngine）
 * 假定 pitch 已是 ABSOLUTE。
 *
 * 轨道映射：
 *   track.melody         (Lead)        → arranged.melody
 *   track.accompaniment  (AccompInst)  → arranged.pianoRH
 *   track.bass           (Bass)        → arranged.pianoLH
 *
 * Pitch Space:
 *   - 输入 NoteData.pitch ∈ RELATIVE（K-1）
 *   - 输出 NoteData.pitch ∈ ABSOLUTE（K-1）
 *   - 转换公式：absolute = relative + track.keyOffset，clamp 到 [0, 127]
 *
 * 约束遵从（pipeline rule §4）：
 *   D-1: 无 PRNG 消耗
 *   D-4 / C-1: 浮点字段（onset/duration/velocity）按位透传，不做浮点比较
 *   P-1: 仅扁平 number[]，无 Map/Set
 *   P-3 / P-4: 整型走 | 0；clamp 用比较运算
 *   S-3: 全同步纯函数
 *   S-4: 输出纯数据 NoteData，无函数 / 类实例 / 循环引用
 *   T-3: 无 any
 *   K-2: 加 keyOffset 是本模块的专属职责；其他模块禁入
 *
 * @author AuraFlow Tap! Phase 4
 */

import {
    ArrangedTrack, GeneratedTrack, MusicContext, NoteData,
} from '../types';
import { StyleId } from '../config/StyleFlags';

const PITCH_LO = 0;
const PITCH_HI = 127;

export class OrchestratorError extends Error {
    public readonly context: Record<string, unknown>;
    constructor(message: string, context: Record<string, unknown>) {
        super(message);
        this.name = 'OrchestratorError';
        this.context = context;
    }
}

export class Orchestrator {
    /**
     * Pitch Space: ABSOLUTE（输出）
     *
     * Pipeline 规则 §2.8：static arrange(track, styleId, context) → ArrangedTrack。
     *
     * @param track  Stage 5 输出，pitch 全 RELATIVE
     * @param styleId 风格标识（透传到 arranged.styleId，供下游音色派发）
     * @param context Stage 5 输出的 MusicContext（透传 — 未来 Phase 5 可消费 tempoCurves 等）
     */
    public static arrange(
        track: GeneratedTrack,
        styleId: StyleId,
        context: MusicContext,
    ): ArrangedTrack {
        Orchestrator.validate(track);
        void context;  // 当前 Layer 1 未消费 context；保留参数与 pipeline rule 签名一致

        const keyOffset = track.keyOffset | 0;

        const melody  = applyKeyOffset(track.melody         ?? [], keyOffset);
        const pianoRH = applyKeyOffset(track.accompaniment  ?? [], keyOffset);
        const pianoLH = applyKeyOffset(track.bass           ?? [], keyOffset);

        // K-8: drums 是 GM Drum Map 物理键位（第三空间，INSTRUMENT_COMMAND），
        // 独立于 K-1 的 RELATIVE/ABSOLUTE 二分；直接透传，禁止 applyKeyOffset。
        const arranged: ArrangedTrack = {
            bpm: track.bpm,
            key: track.key,
            absoluteStartBeat: track.absoluteStartBeat | 0,
            timeSignature: track.timeSignature,
            styleId,
            melody,
            pianoRH,
            pianoLH,
            secondaryMelody: undefined,
            vocal:           track.vocal,
            drums:           track.drums,   // K-8 透传：GM Drum Map 物理键位
            counterMelody:   track.counterMelody,
            userMotif:       track.processedUserMotif,
            palette:         track.preSelectedPalette,
            sections:        track.sections,
            globalRiff:      track.globalRiff,
            chords:          track.chords,
        };

        return arranged;
    }

    private static validate(track: GeneratedTrack): void {
        if (!Number.isFinite(track.keyOffset)) {
            throw new OrchestratorError(
                'track.keyOffset must be finite integer',
                { keyOffset: track.keyOffset },
            );
        }
        if (track.keyOffset < 0 || track.keyOffset > 11) {
            // RELATIVE 空间下 keyOffset ∈ [0, 11]；超出范围说明 Stage 1~2 有 bug
            throw new OrchestratorError(
                'track.keyOffset out of [0, 11]',
                { keyOffset: track.keyOffset },
            );
        }
    }
}

// ============================================================
// 内部：批量加 keyOffset + clamp + 透传其他字段
// ============================================================

/**
 * Pitch Space: RELATIVE → ABSOLUTE（K-2 实际执行点）
 *
 * 不复用输入数组（输出为全新对象数组），避免上游 GeneratedTrack 内 pitch 被
 * 隐式改写造成"双重偏移"难定位的 bug。
 */
function applyKeyOffset(notes: NoteData[], keyOffset: number): NoteData[] {
    const len = notes.length;
    const out: NoteData[] = new Array(len);
    for (let i = 0; i < len; i++) {
        const n = notes[i];
        let p = (n.pitch | 0) + keyOffset;
        if (p < PITCH_LO) p = PITCH_LO;
        if (p > PITCH_HI) p = PITCH_HI;
        out[i] = {
            pitch: p,
            onset: n.onset,
            duration: n.duration,
            velocity: n.velocity,
            isGraceNote: n.isGraceNote,
            pitchBend: n.pitchBend,
            pitchBendDuration: n.pitchBendDuration,
            fadeOutDuration: n.fadeOutDuration,
            isUserMotif: n.isUserMotif,
        };
    }
    return out;
}
