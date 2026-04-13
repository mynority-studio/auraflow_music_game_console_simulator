/**
 * WindIdiom — 管乐演奏技法引擎
 * Sax/Flute/Reed/Brass 分化处理
 *
 * 核心特征：
 * - 单声部强制（Monophonic）
 * - Legato 连音重叠（而非 gap）
 * - 连奏力度降级（非首音降到 65-70%）
 * - 呼吸引擎（强制换气休止）
 * - Scoop/Fall 标记（由 PlaybackEngine 消费生成 PitchBend）
 *
 * Pitch Space: ABSOLUTE（在 applyOffset 之后调用）
 */
import { PRNGManager } from '../../../utils/PRNG';
import { NoteData, GeneratedChord } from '../../types';
import { BaseIdiom } from './BaseIdiom';
import { InstrumentProfiles, getInstrumentIdByName } from '../../config/InstrumentFlags';

export class WindIdiom extends BaseIdiom {
    apply(notes: NoteData[], instrumentName: string, _chords: GeneratedChord[], _idiomPreferences?: any): NoteData[] {
        if (notes.length === 0) return [];

        // 获取管乐参数
        const instId = getInstrumentIdByName(instrumentName);
        const profile = InstrumentProfiles[instId];
        const wp = profile?.windProfile;

        // 无 windProfile 时走基础默认值
        const legatoOverlap = wp?.legatoOverlap ?? 0.02;
        const legatoVelDrop = wp?.legatoVelocityDrop ?? 0.70;
        const maxBreathBeats = wp?.maxBreathBeats ?? 12;
        const breathRest = wp?.breathRestBeats ?? 0.5;
        const allowScoop = wp?.allowScoop ?? false;
        const allowFall = wp?.allowFall ?? false;
        const scoopBend = wp?.scoopBendRange ?? -4096;

        // Step 1: 按 onset 排序，同 onset 保留最高音（单声部强制）
        const sorted = [...notes].sort((a, b) => {
            const d = a.onset - b.onset;
            if (Math.abs(d) > 1e-6) return d;
            return b.pitch - a.pitch;
        });

        const mono: NoteData[] = [];
        let prevOnset = -999;
        for (let i = 0; i < sorted.length; i++) {
            if (Math.abs(sorted[i].onset - prevOnset) < 1e-6) continue;
            prevOnset = sorted[i].onset;
            mono.push({ ...sorted[i] });
        }

        // Step 2: 呼吸引擎 — 强制换气
        let continuousBeats = 0;
        for (let i = 0; i < mono.length; i++) {
            const n = mono[i];
            // 检测乐句起始（前有足够间隙）
            if (i > 0) {
                const gap = n.onset - (mono[i - 1].onset + mono[i - 1].duration);
                if (gap >= breathRest) {
                    continuousBeats = 0; // 有呼吸空间，重置
                }
            } else {
                continuousBeats = 0;
            }

            continuousBeats += n.duration;

            // 超过最大呼吸拍数 -> 强制缩短当前音，留出换气
            if (continuousBeats > maxBreathBeats && n.duration >= 0.5) {
                n.duration = Math.max(0.25, n.duration - breathRest);
                continuousBeats = 0;
            }
        }

        // Step 3: Legato 连音处理
        for (let i = 0; i < mono.length - 1; i++) {
            const curr = mono[i];
            const next = mono[i + 1];
            const gap = next.onset - (curr.onset + curr.duration);
            const interval = Math.abs(next.pitch - curr.pitch);

            if (interval <= 5 && gap < 0.1 && gap >= -1e-6) {
                // 小音程：连音重叠（前音尾延伸到后音头之后）
                curr.duration = (next.onset - curr.onset) + legatoOverlap;
            } else if (interval > 5) {
                // 大跳：保留间隙（0.02 拍呼吸）
                const maxDur = next.onset - curr.onset - 0.02;
                if (maxDur > 0 && curr.duration > maxDur) {
                    curr.duration = maxDur;
                }
            }
        }

        // Step 4: 连奏力度降级
        for (let i = 0; i < mono.length; i++) {
            const isPhraseStart = i === 0 ||
                (mono[i].onset - (mono[i - 1].onset + mono[i - 1].duration) >= breathRest);

            if (!isPhraseStart) {
                // 非乐句首音：力度降级（模拟无重新吐音）
                const prevOnsetGap = mono[i].onset - mono[i - 1].onset;
                if (prevOnsetGap < 0.5) {
                    mono[i].velocity *= legatoVelDrop;
                    mono[i].velocity = Math.max(0.15, mono[i].velocity);
                }
            }
        }

        // Step 5: Scoop/Fall 标记（由 PlaybackEngine 消费）
        for (let i = 0; i < mono.length; i++) {
            const isPhraseStart = i === 0 ||
                (mono[i].onset - (mono[i - 1].onset + mono[i - 1].duration) >= breathRest);
            const isPhraseEnd = i === mono.length - 1 ||
                (mono[i + 1].onset - (mono[i].onset + mono[i].duration) >= breathRest);

            // Scoop: 乐句首音滑音起音
            if (isPhraseStart && allowScoop && mono[i].duration >= 0.5) {
                mono[i].pitchBend = scoopBend;
            }

            // Fall: 乐句末音掉音收尾
            if (isPhraseEnd && allowFall && mono[i].duration >= 0.75) {
                mono[i].fadeOutDuration = 0.15;
            }
        }

        // Step 6: 力度平滑（大跳时限制力度变化速率）
        for (let i = 1; i < mono.length; i++) {
            const interval = Math.abs(mono[i].pitch - mono[i - 1].pitch);
            if (interval > 7) {
                const diff = mono[i].velocity - mono[i - 1].velocity;
                const maxStep = 0.024;
                if (Math.abs(diff) > maxStep) {
                    mono[i].velocity = mono[i - 1].velocity + Math.sign(diff) * maxStep;
                    mono[i].velocity = Math.min(1.0, Math.max(0.1, mono[i].velocity));
                }
            }
        }

        return mono;
    }

    protected getHumanizeParams(_note: NoteData, _index: number, _chordSize: number, _isHighFirst: boolean, _isRightHand: boolean, idiomPreferences?: any): {
        strumDelay: number; timingWobble: number; velocityWobble: number; velocityMultiplier: number;
    } {
        // 管乐不需要 strum delay
        // Sax 风格微延迟，Flute 精准时序
        const isSaxStyle = idiomPreferences?.windStyle === 'sax';
        const timingBias = isSaxStyle ? 0.01 : 0;

        return {
            strumDelay: 0,
            timingWobble: this.randomGaussian(0, isSaxStyle ? 0.012 : 0.005) + timingBias,
            velocityWobble: this.randomGaussian(0, isSaxStyle ? 0.03 : 0.02),
            velocityMultiplier: 1.0
        };
    }
}
