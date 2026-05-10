// ============================================================
// HarmonyCore — 节奏骨架分裂 + 抢拍 (Anticipation)
// ============================================================
// Pitch Space: RELATIVE（chord.root 是 0~11，相对调式主音的半音偏移）
//
// 重构要点（vs 老版"一小节一换"）：
//   1) 子小节解析：'vi,IV' → 两个时长各 2 拍的和弦平分一小节
//      'i,bVII,VI,V' → 四个时长各 1 拍的和弦平分一小节
//   2) 抢拍 (Anticipation)：高能段（energyLevel >= 6）非段首和弦
//      30% 概率提前 0.5 拍切入（八分音符切分），并修正前一和弦的 endBeat
//      让节拍咬合无缝（不能让前一和弦短到 < 0.5 拍，否则撤销抢拍）
//   3) 段落 → pool 映射：Chorus → chorusPool / PreChorus → preChorusPool / 其它 → versePool
//
// PRNG 消耗（按和弦推进）：
//   - 每段开头：×1（pool 内选进行）
//   - 每个非段首和弦（高能段）：×1（抢拍判定）
// ============================================================

import { GeneratedChord, SectionMetadata, StyleConfig, Tonality, ChordQualityName } from '../types';
import { PRNGManager } from '../../utils/PRNG';
import { MusicTheory } from '../theory/MusicTheory';

const BEAT_EPS = 0.001;
const ANTICIPATION_BEAT = 0.5;        // 八分音符切分提前量
const ANTICIPATION_PROB = 0.30;       // 高能段触发抢拍的概率
const HIGH_ENERGY_THRESHOLD = 6;      // 启用抢拍的能量阈值
const MIN_PREV_CHORD_AFTER_ANTICIPATE = 0.5;  // 抢拍后前一和弦最短残留时长（避免 1/16 碎片）
const DEFAULT_TIME_SIGNATURE: [number, number] = [4, 4];

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

        for (let s = 0; s < sections.length; s++) {
            const sec = sections[s];

            let pool = style.harmony.versePool;
            if (sec.name === 'Chorus') pool = style.harmony.chorusPool;
            else if (sec.name === 'PreChorus') pool = style.harmony.preChorusPool;

            const progStr = pool[PRNGManager.nextInt(0, pool.length - 1)];
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

                    // ★ 抢拍：高能段 + 非段首 + 30% 概率
                    if (isHighEnergy && !isFirstChordInSection) {
                        if (PRNGManager.nextFloat(0, 1) < ANTICIPATION_PROB) {
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
                        quality: ChordQualityName[parsed.quality] as GeneratedChord['quality'],
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
