import { PRNGManager } from '../../../utils/PRNG';
import { NoteData, GeneratedChord, RuntimeIdiomPreferences, SectionMetadata } from '../../types';
import { BaseIdiom } from './BaseIdiom';

export class GuitarIdiom extends BaseIdiom {
    public apply(notes: NoteData[], instrumentName: string, chords: GeneratedChord[], idiomPreferences?: RuntimeIdiomPreferences): NoteData[] {
        const guitarStyle = idiomPreferences?.guitarStyle || 'pop';
        const result: NoteData[] = [];
        if (notes.length === 0) return result;

        const sorted = [...notes].sort((a, b) => a.onset - b.onset);
        // safe: timeSignature is [number,number] injected by Orchestrator via idiomPrefsWithSections
        const beatsPerBar = idiomPreferences?.timeSignature?.[0] ?? 4;
        const sections = idiomPreferences?.sections || [];

        const getEnergyLevelAt = (onset: number): number => {
            if (!sections || sections.length === 0) return 5; // S-2: removed GlobalContext fallback
            const section = sections.find((s: SectionMetadata) => onset >= s.startBeat && onset < s.endBeat);
            return section ? section.energyLevel : 5;
        };

        // 🌟 新增：吉他扫弦呼吸感与过渡 (Ghost Strums / Upstrokes)
        // 将音符按和弦/扫弦动作分组
        const strums: { onset: number, notes: NoteData[] }[] = [];
        for (const note of sorted) {
            if (strums.length === 0) {
                strums.push({ onset: note.onset, notes: [note] });
            } else {
                const lastStrum = strums[strums.length - 1];
                if (Math.abs(note.onset - lastStrum.onset) < 0.05) {
                    lastStrum.notes.push(note);
                } else {
                    strums.push({ onset: note.onset, notes: [note] });
                }
            }
        }

        const ghostNotes: NoteData[] = [];
        // 只有当乐器是扫弦吉他，且能量不极低时，才添加呼吸感（避免破坏安静段落的留白）
        const isAcousticStrum = instrumentName.includes('Acoustic_Guitar') || instrumentName.includes('Guitar_Chord');
        
        const arpeggiatedNotes: NoteData[] = [];
        if (guitarStyle === 'arpeggio' || (guitarStyle === 'pop' && getEnergyLevelAt(strums[0]?.onset || 0) <= 4)) {
            // ==========================================
            // 🎸 核心技法 2：分解和弦 (Arpeggios)
            // ==========================================
            // 在低能量段落或指定为 arpeggio 风格时，将和弦转换为分解弹奏
            for (let i = 0; i < strums.length; i++) {
                const currentStrum = strums[i];
                const nextStrum = i < strums.length - 1 ? strums[i+1] : null;
                const gap = nextStrum ? nextStrum.onset - currentStrum.onset : 4.0;
                
                // 只有当和弦持续时间足够长时才进行分解
                if (gap >= 1.0 && currentStrum.notes.length >= 3) {
                    const sortedNotes = currentStrum.notes.sort((a, b) => a.pitch - b.pitch);
                    const rootNote = sortedNotes[0];
                    const otherNotes = sortedNotes.slice(1);
                    
                    // 保留根音在正拍
                    arpeggiatedNotes.push({ ...rootNote, duration: gap });
                    
                    // 分解其他音符 (例如 8分音符或 16分音符的分解)
                    const arpRate = gap >= 2.0 ? 0.5 : 0.25; // 较长的和弦用 8分音符，较短的用 16分音符
                    const numSteps = Math.floor(gap / arpRate) - 1; // 减去根音的一拍
                    
                    for (let step = 1; step <= numSteps; step++) {
                        // 简单的上下行分解模式 (Root - 3rd - 5th - Top - 5th - 3rd...)
                        let noteIndex = (step - 1) % otherNotes.length;
                        if (Math.floor((step - 1) / otherNotes.length) % 2 === 1) {
                            // 下行
                            noteIndex = (otherNotes.length - 1) - noteIndex;
                        }
                        
                        const sourceNote = otherNotes[noteIndex];
                        arpeggiatedNotes.push({
                            pitch: sourceNote.pitch,
                            onset: currentStrum.onset + step * arpRate,
                            duration: gap - (step * arpRate), // 延音到和弦结束
                            velocity: sourceNote.velocity * (0.7 + PRNGManager.next() * 0.2) // 分解音符力度较弱且有波动
                        });
                    }
                } else {
                    // 如果间距太短，保持原样扫弦
                    arpeggiatedNotes.push(...currentStrum.notes);
                }
            }
        } else if (isAcousticStrum && guitarStyle !== 'funk') {
            for (let i = 0; i < strums.length - 1; i++) {
                const currentStrum = strums[i];
                const nextStrum = strums[i+1];
                const gap = nextStrum.onset - currentStrum.onset;
                
                const currentEnergy = getEnergyLevelAt(currentStrum.onset);
                if (currentEnergy < 4) continue; // 安静段落不加 ghost notes

                // 提取当前和弦的高音部分（用于轻扫弦，模拟手往上带的过程）
                const topNotes = currentStrum.notes
                    .map(n => n.pitch)
                    .sort((a, b) => b - a)
                    .slice(0, 3); // 取最高的三根弦

                const baseVel = currentStrum.notes[0].velocity;

                if (gap >= 1.5) {
                    // 空白很大，填补中间的律动
                    let fillOnset = currentStrum.onset + 1.0;
                    // 确保填补的音符不会太靠近下一个和弦
                    while (fillOnset <= nextStrum.onset - 0.5) {
                        // 弱下扫 (Downstroke)
                        topNotes.forEach(pitch => {
                            ghostNotes.push({ pitch, onset: fillOnset, duration: 0.25, velocity: baseVel * 0.4 });
                        });
                        // 弱上扫 (Upstroke)
                        if (PRNGManager.next() > 0.3 && (fillOnset + 0.5 < nextStrum.onset - 0.1)) {
                            topNotes.slice(0, 2).forEach(pitch => {
                                ghostNotes.push({ pitch, onset: fillOnset + 0.5, duration: 0.25, velocity: baseVel * 0.3 });
                            });
                        }
                        fillOnset += 1.0;
                    }
                    
                    // 在下一个重拍前加一个 16 分音符的极弱上扫 (Pick-up)
                    if (PRNGManager.next() > 0.2) {
                        topNotes.slice(0, 2).forEach(pitch => {
                            ghostNotes.push({ pitch, onset: nextStrum.onset - 0.25, duration: 0.15, velocity: baseVel * 0.25 });
                        });
                    }
                } else if (gap >= 1.0) {
                    // 空白中等，加一个反拍上扫
                    topNotes.slice(0, 2).forEach(pitch => {
                        ghostNotes.push({ pitch, onset: currentStrum.onset + 0.5, duration: 0.25, velocity: baseVel * 0.35 });
                    });
                    // 偶尔加一个 16 分音符的抢拍上扫
                    if (PRNGManager.next() > 0.4) {
                        topNotes.slice(0, 2).forEach(pitch => {
                            ghostNotes.push({ pitch, onset: nextStrum.onset - 0.25, duration: 0.15, velocity: baseVel * 0.25 });
                        });
                    }
                } else if (gap >= 0.5 && gap < 1.0) {
                    // 空白较小，加一个 16 分音符的过渡上扫 (Upstroke)
                    if (PRNGManager.next() > 0.4) {
                        topNotes.slice(0, 2).forEach(pitch => {
                            ghostNotes.push({ pitch, onset: nextStrum.onset - 0.25, duration: 0.15, velocity: baseVel * 0.25 });
                        });
                    }
                }
            }
        }

        // 合并原始音符和幽灵音符
        let allNotes: NoteData[] = [];
        if (arpeggiatedNotes.length > 0) {
            allNotes = [...arpeggiatedNotes].sort((a, b) => a.onset - b.onset);
        } else {
            allNotes = [...sorted, ...ghostNotes].sort((a, b) => a.onset - b.onset);
        }

        for (let i = 0; i < allNotes.length; i++) {
            let current = { ...allNotes[i] };
            const beatPos = current.onset % beatsPerBar;
            
            // 闷音 (Palm Mute) 逻辑
            // Funk/Rock 风格中，反拍或短音符经常使用闷音
            let isMuted = false;
            if (guitarStyle === 'funk') {
                // Funk: 16分音符的弱拍极大概率是闷音 (Ghost strums)
                if (beatPos % 0.5 !== 0 && current.duration <= 0.25) {
                    isMuted = PRNGManager.next() < 0.8;
                }
            } else if (guitarStyle === 'rock') {
                // Rock: 强拍根音持续闷音 (Chugging)
                if (current.pitch < 50 && current.duration <= 0.5) {
                    isMuted = PRNGManager.next() < 0.7;
                }
            } else {
                // Pop/Acoustic: 偶尔在 2, 4 拍的后半拍加入闷音打弦 (Slap)
                if ((beatPos > 1 && beatPos < 2) || (beatPos > 3 && beatPos < 4)) {
                    if (current.duration <= 0.25) isMuted = PRNGManager.next() < 0.3;
                }
            }

            if (isMuted) {
                current.duration = Math.min(current.duration, 0.1); // 闷音极短
                current.velocity *= 0.6; // 闷音力度较弱
            } else {
                // 正常音符，如果太长，稍微缩短一点点模拟吉他延音衰减
                if (current.duration > 2.0) {
                    current.velocity *= 0.9;
                }
            }

            result.push(current);
        }

        return result;
    }

    protected getHumanizeParams(note: NoteData, index: number, chordSize: number, isHighFirst: boolean, isRightHand: boolean, idiomPreferences?: RuntimeIdiomPreferences) {
        const guitarStyle = idiomPreferences?.guitarStyle || 'pop';
        // safe: timeSignature is [number,number] injected by Orchestrator via idiomPrefsWithSections
        const beatsPerBar = idiomPreferences?.timeSignature?.[0] ?? 4;
        const is68 = beatsPerBar === 6;
        const beatPos = note.onset % beatsPerBar;

        // 扫弦方向 (Strum Direction)
        // 下拨 (Downstroke): 正拍 (0, 1, 2, 3) 或 8分音符正拍 (0, 0.5, 1.0...)
        // 上拨 (Upstroke): 反拍 (0.25, 0.75...)
        const isDownstroke = (beatPos % 0.5 === 0);
        
        // 如果是下拨，从低音到高音 (index 0 -> chordSize - 1)
        // 如果是上拨，从高音到低音 (index chordSize - 1 -> 0)
        const effectiveIndex = isDownstroke ? index : (chordSize - 1 - index);

        // 扫弦速度 (Strum Speed)
        let strumSpeed = 0.015; // 默认 15ms 一根弦
        if (guitarStyle === 'funk') strumSpeed = 0.008; // Funk 扫弦极快 (Chukka)
        else if (guitarStyle === 'folk') strumSpeed = 0.025; // 民谣扫弦较慢，更舒展

        const strumDelay = effectiveIndex * (strumSpeed + PRNGManager.next() * 0.005);
        
        let timingWobble = this.randomGaussian(0, 0.015);
        
        // 节奏微调：正拍稍微晚一点点（慵懒），弱拍稍微提前一点点（推动感）
        if (beatPos % 1 === 0) {
            timingWobble += PRNGManager.next() * 0.02;
        } else {
            timingWobble -= PRNGManager.next() * 0.02;
        }

        // 强弱拍层级 (Beat Hierarchy)
        let velocityMultiplier = 1.0;
        if (beatPos === 0) velocityMultiplier *= 1.1;       // 第一拍强拍
        else if (is68 && beatPos === 3) velocityMultiplier *= 0.95; // 6/8 次强拍
        else if (!is68 && beatPos === 2) velocityMultiplier *= 0.9;  // 4/4 第三拍次强拍
        else if (beatPos % 1 !== 0) velocityMultiplier *= 0.85; // 反拍或切分音略弱

        // 上拨通常比下拨力度轻
        if (!isDownstroke) velocityMultiplier *= 0.8;

        // 音区配平：突出和弦的最高音 (Top Note) 或最低音 (Bass Note)
        if (isDownstroke && index === 0) {
            velocityMultiplier *= 1.1; // 下拨突出根音
        } else if (!isDownstroke && index === chordSize - 1) {
            velocityMultiplier *= 1.1; // 上拨突出高音
        }

        const velocityWobble = this.randomGaussian(0, 0.05);

        return { strumDelay, timingWobble, velocityWobble, velocityMultiplier };
    }
}