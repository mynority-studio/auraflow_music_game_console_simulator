/**
 * BassIdiom — 独立电贝斯渲染器（A1 升级：Chord-Scale Walking）
 *
 * 两条路径：
 *   Layer 1（向后兼容）— 当 persona.walkPatternId 未设置时：
 *     每和弦头一击 root + sustain（旧行为）。可选 kickAnchors 对齐（Kick-Bass interlock）。
 *
 *   Walking Pattern（A1 新增）— 当 persona.walkPatternId 已设置时：
 *     按 BassWalkPatterns 字母语法（B/5/3/A/N/=/C/S 8 规则）逐步生成 bass line：
 *       B = Root          5 = 5th          3 = 3rd (chord quality 自适应)
 *       A = Approach      N = Next root    = = Repeat last pitch
 *       C = ChordTone     S = ScaleTone (chord-scale 内 hash 抽，2nd/6th 色彩音)
 *     步进时间由 step.durationBeats 决定，可跨拍循环到和弦时长结束。
 *
 * 与 PianoAccompIdiom.renderLHWalkPattern 的差异（A1 关键决策）：
 *   - **独立电贝斯**：单音，不出 10th 双音（钢琴 LH 才出 10th）
 *   - **音域 [C1, B2] = [24, 47]**：低于钢琴 LH 锚位（C2=36），与 ElectricBass 通道对齐
 *   - **kickAnchors 兼容**：walking 模式下 kickAnchors 不再控制 onset；走纯 pattern 节奏
 *     (kickAnchors 仅在 Layer 1 fallback 路径生效)
 *
 * Pitch Space (K-1 / K-2 / K-7)：
 *   RELATIVE — pitch 全部不含 keyOffset，由 AbsoluteTransposer.applyOffset 唯一加。
 *
 * PRNG 消耗：0（D-1 / D-5，确定性 hash 决定 C/S 池抽样）。
 *
 * @author AuraFlow Tap! A1 — BassIdiom ChordScale Walking
 */

import {
    GeneratedChord, MusicianPersona, NoteData, Tonality,
    ChordQuality, CQ_IS_MAJOR, CQ_IS_DOM, CQ_IS_MINOR, CQ_IS_DIM,
    CHORD_SCALE_INTERVALS,
} from '../types';
import type { RenderContext, WeatherSampler } from '../pipeline/RenderContext';
import { StyleId } from '../config/StyleFlags';
import { getChordTonePCs } from '../data/ScaleHelpers';
import {
    WalkPatternId, WalkRule, getWalkPattern,
} from '../data/BassWalkPatterns';

const EPSILON = 1e-6;
const PITCH_CLASS_SIZE = 12;

// 独立电贝斯音域锚 — C1 = 24（与原 BassIdiom 一致）
const BASS_ANCHOR = 24;
// 走音上下界：[C1, B2] — 钢琴 LH 锚位（C2=36）以下到 B2，避免与钢琴 LH walking 撞
const BASS_RANGE_LO = 24;   // C1
const BASS_RANGE_HI = 47;   // B2

// staccato gap：让 walking 听起来有"行进感"（与 PianoAccompIdiom 的 LH Walking 一致）
const STACCATO_RATIO = 0.9;

export interface BassIdiomInput {
    chords: GeneratedChord[];
    styleId: StyleId;
    tonality: Tonality;
    persona: MusicianPersona;
    /** Drum Kick 落点（V5.x），仅 Layer 1 路径消费做 Bass-Kick interlock；walking 路径忽略 */
    kickAnchors?: number[];
    /**
     * Phase 0 — RenderContext 接入点(weather sampler / lookahead / state)。
     * 当前实装不消费 context(bit-exact 保证);Phase 2+ walking 路径
     * 在每 step 调 context.weather.at(beat) 调制 approach / chromatic 概率。
     */
    context: RenderContext;
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

        // A1：persona.walkPatternId 决定路径选择
        const walkPatternId = input.persona.walkPatternId;

        if (walkPatternId !== undefined) {
            // Walking 路径
            let lastBass: number | undefined = undefined;
            for (let i = 0; i < input.chords.length; i++) {
                const chord = input.chords[i];
                const nextChord = i + 1 < input.chords.length ? input.chords[i + 1] : undefined;
                lastBass = renderBassWalkPattern(
                    out, chord, nextChord, walkPatternId, i, velocity, lastBass,
                    input.context.weather,
                );
            }
            return out;
        }

        // Layer 1 — 旧逻辑（Kick-Bass interlock + Root sustain）
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
                    if (kOnset >= chord.startBeat - EPSILON && kOnset < chord.endBeat - EPSILON) {
                        let nextOnset = chord.endBeat;
                        if (j + 1 < input.kickAnchors.length && input.kickAnchors[j + 1] < chord.endBeat) {
                            nextOnset = input.kickAnchors[j + 1];
                        }
                        const dur = Math.max(0.125, (nextOnset - kOnset) * 0.85);
                        out.push({ pitch, onset: kOnset, duration: dur, velocity });
                        hasHits = true;
                    }
                }
            }

            if (!hasHits) {
                out.push({ pitch, onset: chord.startBeat, duration, velocity });
            }
        }
        return out;
    }
}

// ============================================================
// 内部：BassWalk 字母语法解释器（移植自 PianoAccompIdiom.renderLHWalkPattern，单音版）
// ============================================================

function renderBassWalkPattern(
    out: NoteData[],
    chord: GeneratedChord,
    nextChord: GeneratedChord | undefined,
    walkPatternId: number,
    chordIndex: number,
    velocity: number,
    lastBass: number | undefined,
    weather: WeatherSampler,  // Phase 5 — R 维度驱动 NCT 模式选择
): number | undefined {
    const chordDur = chord.endBeat - chord.startBeat;
    if (chordDur <= EPSILON) return lastBass;

    const pattern = getWalkPattern(walkPatternId as WalkPatternId);
    if (pattern.steps.length === 0) return lastBass;

    const rootPc = chord.bassOverride !== undefined ? chord.bassOverride : chord.root;
    const rootPcNorm = ((rootPc % 12) + 12) % 12;
    const thirdPc = pickBassThirdPc(rootPcNorm, chord.quality);
    const fifthPc = (rootPcNorm + 7) % 12;

    // Chord/Scale tone 池（lazy 构造，避免不用 C/S 的 pattern 额外开销）
    let chordTonePool: number[] | undefined;
    let scaleTonePool: number[] | undefined;

    let currentLast = lastBass;
    let cursor = 0;
    let stepIdx = 0;

    while (cursor < chordDur - EPSILON) {
        const step = pattern.steps[stepIdx % pattern.steps.length];
        const stepDur = step.durationBeats;
        if (stepDur <= EPSILON) { stepIdx++; continue; }

        let bassPc: number | undefined;
        switch (step.rule) {
            case WalkRule.Root:
                bassPc = rootPcNorm;
                break;
            case WalkRule.Fifth:
                bassPc = fifthPc;
                break;
            case WalkRule.Third:
                bassPc = thirdPc;
                break;
            case WalkRule.Approach: {
                // Phase 5 — NCT R 维度驱动:
                //   R ≥ 0.4 → ChromaticBelow(下方半音趋近,Blues/Bebop 味)
                //   R < 0.4 → DiatonicAbove(原 diatonic 路径,Pop 安全)
                //   零 PRNG(hash 由 chord index + step 派生)
                if (nextChord !== undefined) {
                    const nextRootPc = nextChord.bassOverride !== undefined ? nextChord.bassOverride : nextChord.root;
                    const nextRootNorm = ((nextRootPc % 12) + 12) % 12;
                    const r = weather.at(chord.startBeat).r;
                    if (r >= 0.4) {
                        // ChromaticBelow:目标音下方半音(无视 scale)
                        bassPc = ((nextRootNorm - 1) + PITCH_CLASS_SIZE) % PITCH_CLASS_SIZE;
                    } else {
                        // DiatonicAbove(原路径):scale 内邻音
                        bassPc = pickDiatonicApproachBass(chord, nextRootNorm);
                    }
                } else {
                    bassPc = rootPcNorm;
                }
                break;
            }
            case WalkRule.NextRoot: {
                if (nextChord !== undefined) {
                    const nextRootPc = nextChord.bassOverride !== undefined ? nextChord.bassOverride : nextChord.root;
                    bassPc = ((nextRootPc % 12) + 12) % 12;
                } else {
                    bassPc = rootPcNorm;
                }
                break;
            }
            case WalkRule.Repeat:
                bassPc = undefined;
                break;
            case WalkRule.ChordTone: {
                if (chordTonePool === undefined) chordTonePool = getChordTonePCs(chord);
                if (chordTonePool.length === 0) bassPc = rootPcNorm;
                else {
                    const h = ((chordIndex * 31 + stepIdx * 17) % chordTonePool.length + chordTonePool.length) % chordTonePool.length;
                    bassPc = chordTonePool[h];
                }
                break;
            }
            case WalkRule.ScaleTone: {
                if (scaleTonePool === undefined) scaleTonePool = buildBassScalePool(chord);
                if (scaleTonePool.length === 0) bassPc = rootPcNorm;
                else {
                    const h = ((chordIndex * 41 + stepIdx * 19) % scaleTonePool.length + scaleTonePool.length) % scaleTonePool.length;
                    bassPc = scaleTonePool[h];
                }
                break;
            }
            default:
                bassPc = rootPcNorm;
        }

        // 解析为 pitch
        let bassPitch: number;
        if (bassPc === undefined) {
            // Repeat：复用上一个 pitch
            bassPitch = currentLast !== undefined
                ? currentLast
                : placeBassNearAnchor(rootPcNorm, undefined);
        } else {
            bassPitch = placeBassNearAnchor(bassPc, currentLast);
        }

        // step 不超 chord 边界
        // Phase 6a — S 维度调制 staccato:S 高 → sustain 长(staccato 弱)
        //   S=0(干)→ STACCATO_RATIO × 0.78(更短促 = 0.70)
        //   S=0.5  → STACCATO_RATIO × 1.0(原 0.9)
        //   S=1(湿)→ STACCATO_RATIO × 1.11(更绵长 = 1.0,无 staccato gap)
        const onset = chord.startBeat + cursor;
        const sBass = weather.at(onset).s;
        const sStaccatoFactor = 0.78 + sBass * 0.33;
        const effectiveStaccato = STACCATO_RATIO * sStaccatoFactor;
        const clampedStaccato = effectiveStaccato > 1.0 ? 1.0 : effectiveStaccato;
        const remaining = chordDur - cursor;
        const playDur = (stepDur < remaining ? stepDur : remaining) * clampedStaccato;
        if (playDur > EPSILON) {
            out.push({ pitch: bassPitch, onset, duration: playDur, velocity });
        }

        currentLast = bassPitch;
        cursor += stepDur;
        stepIdx++;
    }

    return currentLast;
}

/**
 * 把 bassPc 落到距离 lastBass 最近的同 PC 八度；首次回退到 BASS_ANCHOR + pc。
 * 钳到 [BASS_RANGE_LO, BASS_RANGE_HI]。
 */
function placeBassNearAnchor(bassPc: number, lastBass: number | undefined): number {
    const pcNorm = ((bassPc % PITCH_CLASS_SIZE) + PITCH_CLASS_SIZE) % PITCH_CLASS_SIZE;
    if (lastBass === undefined) {
        let p = BASS_ANCHOR + pcNorm;
        while (p > BASS_RANGE_HI) p -= 12;
        while (p < BASS_RANGE_LO) p += 12;
        return p;
    }
    // 在 [BASS_RANGE_LO, BASS_RANGE_HI] 内找同 PC 中离 lastBass 最近的 pitch
    let best = -1;
    let bestDist = 9999;
    for (let p = BASS_RANGE_LO; p <= BASS_RANGE_HI; p++) {
        if (((p % PITCH_CLASS_SIZE) + PITCH_CLASS_SIZE) % PITCH_CLASS_SIZE !== pcNorm) continue;
        const d = Math.abs(p - lastBass);
        if (d < bestDist) {
            bestDist = d;
            best = p;
        }
    }
    if (best < 0) {
        // 兜底
        let p = BASS_ANCHOR + pcNorm;
        while (p > BASS_RANGE_HI) p -= 12;
        while (p < BASS_RANGE_LO) p += 12;
        return p;
    }
    return best;
}

/**
 * A3b — 在 current chord scale 内挑"比 targetPc 低 1~2 半音"的 diatonic approach。
 * 与 PianoAccompIdiom.pickDiatonicApproach 同算法（独立拷贝避免 idiom 互依赖）。
 *
 * 找不到合适邻音 → 回落 chromatic -1 半音。
 */
function pickDiatonicApproachBass(currentChord: GeneratedChord, targetPc: number): number {
    const targetPcNorm = ((targetPc % 12) + 12) % 12;
    const scale = CHORD_SCALE_INTERVALS[currentChord.quality];
    const rootPc = ((currentChord.root % 12) + 12) % 12;
    if (scale !== undefined && scale.length > 0) {
        let best = -1;
        let bestDist = 99;
        for (let i = 0; i < scale.length; i++) {
            const pc = ((rootPc + scale[i]) % 12 + 12) % 12;
            if (pc === targetPcNorm) continue;
            const downDist = ((targetPcNorm - pc) % 12 + 12) % 12;
            if (downDist === 0 || downDist > 2) continue;
            if (downDist < bestDist) {
                bestDist = downDist;
                best = pc;
            }
        }
        if (best >= 0) return best;
    }
    return (targetPcNorm + 11) % 12;
}

/**
 * 按 ChordQuality 选 3rd：major/dom → +4；minor/dim → +3；sus → +5（fallback 4th）。
 */
function pickBassThirdPc(rootPcNorm: number, quality: ChordQuality): number {
    if (quality === ChordQuality.Sus4 || quality === ChordQuality.Dominant7Sus4) {
        return (rootPcNorm + 5) % 12;
    }
    const qBit = 1 << quality;
    if ((qBit & CQ_IS_MAJOR) !== 0) return (rootPcNorm + 4) % 12;
    if ((qBit & CQ_IS_DOM) !== 0)   return (rootPcNorm + 4) % 12;
    if ((qBit & CQ_IS_MINOR) !== 0) return (rootPcNorm + 3) % 12;
    if ((qBit & CQ_IS_DIM) !== 0)   return (rootPcNorm + 3) % 12;
    if (quality === ChordQuality.Augmented || quality === ChordQuality.Add9) return (rootPcNorm + 4) % 12;
    return (rootPcNorm + 4) % 12;
}

/**
 * 构造 ScaleTone 池：chord-tone PC + 2nd + 6th（与 PianoAccompIdiom.buildWalkScalePool 同算法）。
 *
 * major / dom / aug / add9 → nat 2 + nat 6
 * minor / dim / sus        → nat 2 + b 6
 */
function buildBassScalePool(chord: GeneratedChord): number[] {
    const chordTones = getChordTonePCs(chord);
    const rootPc = ((chord.root % 12) + 12) % 12;
    const qBit = 1 << chord.quality;
    const minorish = (qBit & CQ_IS_MINOR) !== 0 || (qBit & CQ_IS_DIM) !== 0
        || chord.quality === ChordQuality.Sus4
        || chord.quality === ChordQuality.Dominant7Sus4;
    const second = (rootPc + 2) % 12;
    const sixth = minorish ? (rootPc + 8) % 12 : (rootPc + 9) % 12;

    const seen: { [pc: number]: boolean } = {};
    for (let i = 0; i < chordTones.length; i++) seen[chordTones[i]] = true;
    seen[second] = true;
    seen[sixth] = true;

    const out: number[] = [];
    for (let pc = 0; pc < 12; pc++) {
        if (seen[pc]) out.push(pc);
    }
    return out;
}
