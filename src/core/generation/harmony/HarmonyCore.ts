// ============================================================
// HarmonyCore — 节奏骨架分裂 + 抢拍 (Anticipation)
// ============================================================
// Pitch Space: RELATIVE（chord.root 是 0~11，相对调式主音的半音偏移）
//
// 风格池查找（参考架构 StyleHarmonyConfig 双模式形状）：
//   - 按 tonality 选 style.harmony.major / minor 池
//   - 按 sec.name.toLowerCase() 索引段落池（'verse'/'chorus'/'preChorus'/'bridge'/'intro'/'outro'）
//   - 段落键缺失 → 兜底 'verse' → 'chorus' → 池内任意第一组
//
// 子小节解析：'vi,IV' → 两个时长各 2 拍的和弦平分一小节
// 抢拍：高能段 (energyLevel ≥ 6) 非段首和弦按 style.anticipationProb（兜底 0.3）触发
//       前一和弦残留时长 ≥ 0.5 拍方可触发，否则撤销
//
// PRNG 消耗（按和弦推进）：
//   - 每段开头：×1（pool 内选进行）
//   - 每个非段首和弦（高能段）：×1（抢拍判定）
// ============================================================

import { GeneratedChord, SectionMetadata, StyleConfig, Tonality } from '../types';
import { PRNGManager } from '../../utils/PRNG';
import { MusicTheory } from '../theory/MusicTheory';

const BEAT_EPS = 0.001;
const ANTICIPATION_BEAT = 0.5;
const DEFAULT_ANTICIPATION_PROB = 0.30;
const HIGH_ENERGY_THRESHOLD = 6;
const MIN_PREV_CHORD_AFTER_ANTICIPATE = 0.5;
const DEFAULT_TIME_SIGNATURE: [number, number] = [4, 4];

function isMinorTonality(t: Tonality): boolean {
    return t === Tonality.Minor
        || t === Tonality.Minor_Pentatonic
        || t === Tonality.Melodic_Minor
        || t === Tonality.Harmonic_Minor
        || t === Tonality.Phrygian
        || t === Tonality.Dorian
        || t === Tonality.Blues;
}

const SECTION_KEY_MAP: Record<string, string> = {
    intro: 'intro',
    verse: 'verse',
    prechorus: 'preChorus',
    chorus: 'chorus',
    bridge: 'bridge',
    outro: 'outro',
};

function pickProgressionPool(style: StyleConfig, tonality: Tonality, sectionName: string): string[][] {
    const modeKey = isMinorTonality(tonality) ? 'minor' : 'major';
    const pools = style.harmony[modeKey];
    const lookup = SECTION_KEY_MAP[sectionName.toLowerCase()] ?? 'verse';
    if (pools[lookup] && pools[lookup].length > 0) return pools[lookup];
    if (pools['verse'] && pools['verse'].length > 0) return pools['verse'];
    if (pools['chorus'] && pools['chorus'].length > 0) return pools['chorus'];
    // 终极兜底：返回任一非空池
    for (const k of Object.keys(pools)) {
        if (pools[k] && pools[k].length > 0) return pools[k];
    }
    return [['I', 'IV', 'V', 'I']];
}

export class HarmonyCore {
    public static generateHarmonyTimeline(
        sections: SectionMetadata[],
        style: StyleConfig,
        tonality: Tonality,
        keyOffset: number,
        timeSignature: [number, number] = DEFAULT_TIME_SIGNATURE,
    ): GeneratedChord[] {
        const chords: GeneratedChord[] = [];

        // 拍号驱动的每小节拍数：4/4=4, 3/4=3, 6/8=3, 12/8=6
        const barBeats = (timeSignature[0] * 4) / timeSignature[1];

        const anticipationProb = style.anticipationProb ?? DEFAULT_ANTICIPATION_PROB;

        for (let s = 0; s < sections.length; s++) {
            const sec = sections[s];

            const pool = pickProgressionPool(style, tonality, sec.name);
            const progArr = pool[PRNGManager.nextInt(0, pool.length - 1)];
            // 池里每条进行可能是 string[]（标准）或 string（罕见兜底）
            const progStr: string[] = Array.isArray(progArr) ? progArr : [progArr as unknown as string];
            const isHighEnergy = sec.energyLevel >= HIGH_ENERGY_THRESHOLD;

            let b = sec.startBeat;
            let progIdx = 0;
            let isFirstChordInSection = true;

            while (b < sec.endBeat - BEAT_EPS) {
                const slot = progStr[progIdx % progStr.length];

                // ★ 子小节解析：逗号分隔 → 平分小节拍数
                const tokens = slot.indexOf(',') >= 0 ? slot.split(',') : [slot];
                const subBeats = barBeats / tokens.length;

                for (let k = 0; k < tokens.length && b < sec.endBeat - BEAT_EPS; k++) {
                    const numeral = tokens[k].trim();
                    const parsed = MusicTheory.parseNumeral(numeral, tonality);

                    let endBeat = b + subBeats;
                    if (endBeat > sec.endBeat) endBeat = sec.endBeat;
                    let startBeat = b;

                    // ★ 抢拍：高能段 + 非段首 + style.anticipationProb 概率
                    if (isHighEnergy && !isFirstChordInSection) {
                        if (PRNGManager.nextFloat(0, 1) < anticipationProb) {
                            const candidateStart = b - ANTICIPATION_BEAT;
                            // 安全闸门：抢拍后前一和弦残留时长必须 >= 0.5 拍
                            if (chords.length > 0) {
                                const prev = chords[chords.length - 1];
                                if (candidateStart - prev.startBeat >= MIN_PREV_CHORD_AFTER_ANTICIPATE - BEAT_EPS) {
                                    prev.endBeat = candidateStart;
                                    startBeat = candidateStart;
                                }
                            }
                        }
                    }

                    chords.push({
                        numeral,
                        root: parsed.root,
                        quality: parsed.quality,
                        startBeat,
                        endBeat,
                        keyOffset,
                        ...(parsed.bassOverride !== undefined ? { bassOverride: parsed.bassOverride } : {}),
                    });

                    // 推进游标到原 grid 边界（不抢拍即正常推进；抢拍只改 startBeat 不改 grid）
                    b = endBeat;
                    isFirstChordInSection = false;
                }

                progIdx++;
            }
        }

        return chords;
    }
}
