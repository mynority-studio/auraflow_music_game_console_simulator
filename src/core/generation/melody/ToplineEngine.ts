// ============================================================
// ToplineEngine — 节奏-轮廓-引力 + Idiom 驱动的物理约束
// ============================================================
// Pitch Space: RELATIVE
//   输入  chord.root / chord.quality 都是相对调式空间（root 0~11）
//   输出  NoteData.pitch 全部相对值，keyOffset 由 Orchestrator 应用
//
// 数据驱动（V7.6 + Lead/Comping 拆分 + 拟人化）：
//   - 呼吸感由 idiom.lead.needsBreathing/breath* 数据驱动
//     （needsBreathing 的 idiom 触发 8 拍换气，键盘类跳过）
//   - 拟人化后处理（return 前）：legatoRatio 延音 / humanizeVelocity 力度抖动 / graceNoteProbability 大跳倚音
// ============================================================

import { NoteData, GeneratedChord, Tonality, InstrumentIdiom, SectionMetadata, StyleConfig, PhraseLengthProfile } from '../types';
import { PRNGManager } from '../../utils/PRNG';
import { MusicTheory } from '../theory/MusicTheory';
import { BASIC_RHYTHM_CELLS } from './RhythmCells';

const PITCH_HIGH = 14;
const PITCH_LOW = -7;
const STRONG_BEAT_EPS = 0.05;
const NOTE_END_EPS = 0.001;
const MIN_DUR = 0.05;
const ARTICULATION_RATIO = 0.85;

// 段落 phrase 长度兜底（4/4 拍下，由实际 barBeats 替代）
const MOTIF_BARS = 2;           // 每个 motif 固定 2 小节（拍数 = MOTIF_BARS × barBeats）
const SLOTS_PER_BEAT = 4;       // 16 分网格

// 段落名 → phraseLengthProfile.perSection 键（驼峰）
function sectionNameToProfileKey(name: string): keyof PhraseLengthProfile['perSection'] | null {
    const lower = name.toLowerCase();
    if (lower === 'verse') return 'verse';
    if (lower === 'prechorus') return 'preChorus';
    if (lower === 'chorus') return 'chorus';
    if (lower === 'bridge') return 'bridge';
    if (lower === 'intro') return 'intro';
    if (lower === 'outro') return 'outro';
    return null;
}

function pickPhraseBeats(sectionName: string, style: StyleConfig | undefined, barBeats: number): number {
    const profile = style?.melody?.phraseLengthProfile?.perSection;
    if (!profile) return MOTIF_BARS * 2 * barBeats; // 默认 4 小节

    const key = sectionNameToProfileKey(sectionName);
    const pool = (key && profile[key]) || profile.default;
    if (!pool || pool.length === 0) return MOTIF_BARS * 2 * barBeats;

    let total = 0;
    for (let i = 0; i < pool.length; i++) total += pool[i].weight;
    if (total <= 0) return pool[0].bars * barBeats;

    let r = PRNGManager.nextFloat(0, total);
    for (let i = 0; i < pool.length; i++) {
        r -= pool[i].weight;
        if (r <= 0) return pool[i].bars * barBeats;
    }
    return pool[pool.length - 1].bars * barBeats;
}

/**
 * 计算单个 rhythm cell 与 grooveDNA 的对齐度（fitness）。
 * 单元的所有非休止音符 onset（拍位）映射到 16 分槽位，累加 grooveDNA[slot] 即为分。
 * 分越高代表节奏越贴鼓组律动指纹。
 */
function cellGrooveFitness(cell: number[], grooveDNA: number[]): number {
    if (!grooveDNA || grooveDNA.length === 0) return 0;
    let onset = 0;
    let score = 0;
    for (let i = 0; i < cell.length; i++) {
        const dur = cell[i];
        if (dur > 0) {
            const slot = ((Math.round(onset * SLOTS_PER_BEAT) % grooveDNA.length) + grooveDNA.length) % grooveDNA.length;
            score += grooveDNA[slot];
        }
        onset += Math.abs(dur);
    }
    return score;
}

export class ToplineEngine {
    public static generateMelody(
        chords: GeneratedChord[],
        tonality: Tonality,
        idiom?: InstrumentIdiom,
        sections?: SectionMetadata[],
        style?: StyleConfig,
        timeSignature: [number, number] = [4, 4],
    ): NoteData[] {
        const melody: NoteData[] = [];
        if (chords.length === 0) return melody;

        const scalePcs = MusicTheory.getScalePitches(tonality);

        // 拍号驱动的每小节拍数 + 单个 motif 长度（默认 2 小节）
        const barBeats = (timeSignature[0] * 4) / timeSignature[1];
        const motifBeats = MOTIF_BARS * barBeats;

        // 缓存和弦音池，避免内层循环重复计算
        const chordPools = chords.map(chord => {
            const chordIntervals = MusicTheory.getChordTones(chord.quality);
            const chordPcs = chordIntervals.map(iv => ((chord.root + iv) % 12 + 12) % 12);
            const weakBeatPool = [...chordPcs];
            for (let j = 0; j < scalePcs.length; j++) {
                if (!weakBeatPool.includes(scalePcs[j])) weakBeatPool.push(scalePcs[j]);
            }
            return { chord, chordPcs, weakBeatPool };
        });

        const totalBeats = chords[chords.length - 1].endBeat;

        // 内部函数：生成 motifBeats 拍 (默认 2 小节) 的动机
        // grooveDNA 不为空时：cell 选取按"与 GrooveDNA 对齐分"加权，让旋律切分跟着鼓走；
        //                    为空时退化为均匀随机（兜底向后兼容）。
        const generateMotif = (sectionGrooveDNA?: number[]) => {
            const notes: { offset: number; rawDur: number; contourDelta: number }[] = [];
            let offset = 0;
            let currentContour = [0, 4, 7][PRNGManager.nextInt(0, 2)];

            for (let bar = 0; bar < MOTIF_BARS; bar++) {
                let cellIdx = 0;
                if (sectionGrooveDNA && sectionGrooveDNA.length > 0) {
                    // 加权抽样：fitness 越高越倾向被选中（+1 兜底防全 0）
                    const fitnesses: number[] = [];
                    let total = 0;
                    for (let i = 0; i < BASIC_RHYTHM_CELLS.length; i++) {
                        const f = cellGrooveFitness(BASIC_RHYTHM_CELLS[i], sectionGrooveDNA) + 1;
                        fitnesses.push(f);
                        total += f;
                    }
                    let r = PRNGManager.nextFloat(0, total);
                    for (let i = 0; i < fitnesses.length; i++) {
                        r -= fitnesses[i];
                        if (r <= 0) { cellIdx = i; break; }
                    }
                } else {
                    cellIdx = PRNGManager.nextInt(0, BASIC_RHYTHM_CELLS.length - 1);
                }
                const cell = BASIC_RHYTHM_CELLS[cellIdx];
                for (let i = 0; i < cell.length; i++) {
                    if (offset >= motifBeats - NOTE_END_EPS) break;
                    notes.push({ offset, rawDur: cell[i], contourDelta: currentContour });

                    if (cell[i] > 0) {
                        const move = PRNGManager.nextFloat(0, 1);
                        if (move < 0.10) {
                            currentContour += PRNGManager.nextInt(3, 5) * (PRNGManager.nextFloat(0,1) > 0.5 ? 1 : -1);
                        } else if (move < 0.40) {
                            currentContour += PRNGManager.nextInt(1, 2) * (PRNGManager.nextFloat(0,1) > 0.5 ? 1 : -1);
                        }

                        if (currentContour > 12) currentContour -= 12;
                        if (currentContour < -12) currentContour += 12;
                    }
                    offset += Math.abs(cell[i]);
                }
            }
            return notes;
        };

        // ============================================================
        // 段落对齐：每段独立选 phrase 长度 + 消费 sec.grooveDNA
        // 兜底：sections 缺失时退化为单段（整曲），phrase 长度 = MOTIF_BARS * 2 * barBeats
        // ============================================================
        const useFullSections: SectionMetadata[] =
            sections && sections.length > 0
                ? sections
                : [{ name: 'default', startBeat: 0, endBeat: totalBeats, energyLevel: 5 }];

        for (let si = 0; si < useFullSections.length; si++) {
            const sec = useFullSections[si];
            const phraseBeats = pickPhraseBeats(sec.name, style, barBeats);
            const sectionDNA = sec.grooveDNA;

            for (let phraseStart = sec.startBeat; phraseStart < sec.endBeat - NOTE_END_EPS; phraseStart += phraseBeats) {
                const phraseEnd = Math.min(phraseStart + phraseBeats, sec.endBeat);
                const motifA = generateMotif(sectionDNA);

                // motif 重复次数：phrase 长度 / motif 长度（向上取整，最后一次截断）
                const passes = Math.max(1, Math.ceil((phraseEnd - phraseStart) / motifBeats));

                for (let pass = 0; pass < passes; pass++) {
                    const passStartBeat = phraseStart + pass * motifBeats;
                    if (passStartBeat >= phraseEnd - NOTE_END_EPS) break;

                    // 第 0 趟无模进偏移；后续趟数都做模进，AA'A''... 创造推拉感
                    const sequenceShift = pass === 0 ? 0 : PRNGManager.nextInt(-3, 3);

                    for (let i = 0; i < motifA.length; i++) {
                        const mn = motifA[i];
                        const onset = passStartBeat + mn.offset;
                        // 严格落在 phrase（即 section）内，不溢出
                        if (onset >= phraseEnd - NOTE_END_EPS) continue;

                        let ctx = chordPools[0];
                        for (let c = 0; c < chordPools.length; c++) {
                            if (onset >= chordPools[c].chord.startBeat - NOTE_END_EPS && onset < chordPools[c].chord.endBeat - NOTE_END_EPS) {
                                ctx = chordPools[c];
                                break;
                            }
                        }

                        const rawDur = mn.rawDur;
                        const isRest = rawDur < 0;
                        let actualDur = Math.abs(rawDur);

                        if (onset + actualDur > ctx.chord.endBeat) actualDur = ctx.chord.endBeat - onset;
                        if (onset + actualDur > phraseEnd) actualDur = phraseEnd - onset;
                        if (actualDur < MIN_DUR) continue;

                        if (isRest) continue;

                        const leadIdiom = idiom?.lead;
                        if (leadIdiom?.needsBreathing && leadIdiom.breathPhraseLength && leadIdiom.breathTriggerBeat) {
                            const beatInPhrase = onset % leadIdiom.breathPhraseLength;
                            if (beatInPhrase >= leadIdiom.breathTriggerBeat && PRNGManager.nextFloat(0, 1) < (leadIdiom.breathProbability ?? 0.8)) {
                                continue;
                            }
                        }

                        const numNotes = 1;
                        const noteDur = actualDur;

                        for (let n = 0; n < numNotes; n++) {
                            let targetPitch = ctx.chord.root + sequenceShift + mn.contourDelta;
                            if (n > 0) targetPitch += PRNGManager.nextInt(-2, 2);

                            while (targetPitch > PITCH_HIGH) targetPitch -= 12;
                            while (targetPitch < PITCH_LOW) targetPitch += 12;

                            const subOnset = onset + n * noteDur;
                            const isStrongBeat = Math.abs(subOnset - Math.round(subOnset)) < STRONG_BEAT_EPS;
                            const finalPitch = MusicTheory.snapToPool(targetPitch, isStrongBeat ? ctx.chordPcs : ctx.weakBeatPool);
                            const vel = isStrongBeat ? PRNGManager.nextFloat(0.7, 0.9) : PRNGManager.nextFloat(0.5, 0.7);

                            melody.push({
                                pitch: finalPitch,
                                onset: subOnset,
                                duration: noteDur * ARTICULATION_RATIO,
                                velocity: vel,
                            });
                        }
                    }
                }
            }
        }

        // ============================================================
        // Idiom.lead 渲染后处理：注入"行云流水"的演奏灵魂
        // ============================================================
        const finalMelody: NoteData[] = [];
        const leadIdiom = idiom?.lead;

        for (let i = 0; i < melody.length; i++) {
            const note = { ...melody[i] };

            if (leadIdiom) {
                if (leadIdiom.legatoRatio && leadIdiom.legatoRatio !== 1.0) note.duration *= leadIdiom.legatoRatio;

                if (leadIdiom.humanizeVelocity && leadIdiom.humanizeVelocity > 0) {
                    const noise = PRNGManager.nextFloat(-leadIdiom.humanizeVelocity, leadIdiom.humanizeVelocity);
                    note.velocity = Math.max(0.1, Math.min(1.0, note.velocity + noise));
                }

                if (i > 0 && leadIdiom.graceNoteProbability && PRNGManager.nextFloat(0, 1) < leadIdiom.graceNoteProbability) {
                    const prevNote = melody[i - 1];
                    const pitchDiff = note.pitch - prevNote.pitch;
                    if (Math.abs(pitchDiff) >= 3) {
                        const direction = pitchDiff > 0 ? -1 : 1;
                        const candidatePitch = note.pitch + direction * 2;
                        const graceOnset = note.onset - 0.125;
                        if (graceOnset >= 0) {
                            finalMelody.push({
                                pitch: MusicTheory.snapToScale(candidatePitch, tonality),
                                onset: graceOnset,
                                duration: 0.125,
                                velocity: note.velocity * 0.6,
                                isGraceNote: true,
                            });
                        }
                    }
                }
            }
            finalMelody.push(note);

            // 4. Octave Doubling（高潮加厚）
            if (leadIdiom?.octaveDoubling && note.velocity >= 0.75 && !note.isGraceNote) {
                finalMelody.push({
                    ...note,
                    pitch: note.pitch - 12,
                    velocity: note.velocity * 0.8,
                });
            }
        }

        return finalMelody;
    }

    /**
     * 副旋律生成器 — 稀疏长音、低音区运动、就近吸到当前和弦音。
     *
     * 设计目标：
     *   - 故意放在主旋律下方（起点 -5），形成对位高低差
     *   - 节奏稀疏（每 2~4 拍一个音），不与 melody 抢前景
     *   - 力度弱（0.4~0.6），融入背景
     *   - 仅吸和弦音池（非完整音阶），保证和声纯净
     *
     * 输出仍是相对空间，由 Orchestrator 应用 keyOffset。
     */
    public static generateCounterMelody(
        chords: GeneratedChord[],
        _tonality: Tonality,
        _idiom?: InstrumentIdiom,
    ): NoteData[] {
        const counter: NoteData[] = [];
        let currentPitch = -5;

        for (let ci = 0; ci < chords.length; ci++) {
            const chord = chords[ci];
            const chordIntervals = MusicTheory.getChordTones(chord.quality);

            const chordPcs: number[] = [];
            for (let j = 0; j < chordIntervals.length; j++) {
                const raw = chord.root + chordIntervals[j];
                chordPcs.push(((raw % 12) + 12) % 12);
            }

            let currentBeat = chord.startBeat;
            while (currentBeat < chord.endBeat - NOTE_END_EPS) {
                const dur = PRNGManager.nextFloat(0, 1) > 0.5 ? 2.0 : 4.0;
                let actualDur = dur;
                if (currentBeat + actualDur > chord.endBeat) {
                    actualDur = chord.endBeat - currentBeat;
                }
                if (actualDur < MIN_DUR) {
                    currentBeat += actualDur;
                    continue;
                }

                currentPitch += PRNGManager.nextInt(-1, 1) * 2;
                if (currentPitch > 5) currentPitch -= 12;
                if (currentPitch < -12) currentPitch += 12;

                currentPitch = MusicTheory.snapToPool(currentPitch, chordPcs);

                counter.push({
                    pitch: currentPitch,
                    onset: currentBeat,
                    duration: actualDur * 0.95,
                    velocity: PRNGManager.nextFloat(0.4, 0.6),
                });

                currentBeat += actualDur;
            }
        }

        return counter;
    }
}
