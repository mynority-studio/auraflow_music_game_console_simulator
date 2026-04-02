import { NoteData, GeneratedChord, StyleConfig } from '../types';
import { HarmonyCore } from '../composing/HarmonyCore';
import { GlobalContext } from '../GlobalContext';

export class GlobalReviewer {
    /**
     * 全局检查与修复机制 (Global Reviewer & Nudger)
     * 采用 Generate-and-Test 架构，对生成的旋律和和弦进行最终的冲突检测与微调。
     */
    public static reviewAndFix(
        vocal: NoteData[] | undefined,
        melody: NoteData[],
        chords: GeneratedChord[],
        style: StyleConfig,
        tonality: string
    ): { vocal: NoteData[] | undefined, melody: NoteData[], chords: GeneratedChord[] } {
        
        // 1. 修复悬挂的高张力经过和弦 (Fix Unresolved Dominant/Diminished Chords)
        this.fixHangingTensionChords(chords, tonality);

        // 2. 修复旋律与和弦的纵向冲突 (Fix Melody Avoid Notes & Phrase Endings)
        if (vocal && vocal.length > 0) {
            this.fixMelodyClashesAndResolutions(vocal, chords, tonality, style, true);
            this.fixMelodyHorizontalLogic(vocal, tonality, chords, style);
        }
        if (melody && melody.length > 0) {
            this.fixMelodyClashesAndResolutions(melody, chords, tonality, style, false);
            this.fixMelodyHorizontalLogic(melody, tonality, chords, style);
        }

        return { vocal, melody, chords };
    }

    /**
     * 修复悬挂的高张力经过和弦
     * 检查段落末尾或乐句末尾的 V7, vii° 等是否得到了妥善解决。如果没有，则将其降级。
     */
    private static fixHangingTensionChords(chords: GeneratedChord[], tonality: string) {
        for (let i = 0; i < chords.length; i++) {
            const chord = chords[i];
            const nextChord = i < chords.length - 1 ? chords[i + 1] : null;

            const isTension = chord.numeral.includes('°') || 
                              chord.numeral.includes('dim') || 
                              chord.numeral.includes('aug') || 
                              chord.numeral === 'VII7' || 
                              chord.numeral === 'III7' || 
                              chord.numeral === 'V7';

            if (isTension) {
                let resolves = false;
                if (nextChord) {
                    // 简单的解决检查：V -> I, vii° -> I, III7 -> vi
                    const rootDiff = (nextChord.root - chord.root + 12) % 12;
                    if (rootDiff === 5 || rootDiff === 1 || rootDiff === 8) { 
                        resolves = true;
                    }
                }

                // 如果是整首歌的最后一个和弦，或者是一个没有解决且持续时间较长的紧张和弦
                if (!nextChord || (!resolves && chord.endBeat - chord.startBeat >= 2)) {
                    
                    // 最小改动：和弦降级 (Chord Downgrading)
                    if (chord.numeral.includes('°') || chord.numeral.includes('dim')) {
                        chord.numeral = tonality === 'Minor' ? 'ii' : 'V';
                    } else if (chord.numeral.includes('7')) {
                        chord.numeral = chord.numeral.replace('7', '');
                        if (chord.numeral === 'V') chord.numeral = 'Vsus4';
                    }
                    
                    // 重新解析 root 和 quality
                    const parsed = HarmonyCore.parseRomanNumeral(chord.numeral, tonality, false);
                    chord.root = parsed.root;
                    chord.quality = parsed.quality;
                }
            }
        }
    }

    /**
     * 修复旋律冲突与乐句落点
     * 采用 MelodyFixScore 与 ChordFixScore 的理念，进行最小改动 (Nudging)。
     */
    private static fixMelodyClashesAndResolutions(notes: NoteData[], chords: GeneratedChord[], tonality: string, style: StyleConfig, isVocal: boolean) {
        const maxDissonance = style.harmonyRules?.maxDissonanceTolerance ?? 0.5;

        for (let i = 0; i < notes.length; i++) {
            const note = notes[i];
            const activeChord = chords.find(c => note.onset >= c.startBeat && note.onset < c.endBeat) || chords[0];
            const chordTones = HarmonyCore.getChordTones(activeChord, 60);
            const safeScalePcs = HarmonyCore.getSafeScalePitches(activeChord, tonality);

            const isLongNote = note.duration >= 1.0;
            const isStrongBeat = (note.onset % 1 === 0);
            const nextNote = i < notes.length - 1 ? notes[i + 1] : null;
            // 判断是否为乐句结尾：后面没有音，或者与下一个音的间隔大于等于1拍
            const isPhraseEnd = !nextNote || (nextNote.onset - (note.onset + note.duration) >= 1.0);

            const notePc = note.pitch % 12;
            const isChordTone = chordTones.map(ct => ct % 12).includes(notePc);

            // 1. 乐句结尾不落地 (Phrase Ending Resolution Fix)
            if (isPhraseEnd && isLongNote && !isChordTone) {
                // 评分逻辑：由于是乐句结尾的长音，MelodyFixScore 较高（必须改旋律以保证落地）
                
                // 强制拉到 1, 3, 5
                const stableTones = [chordTones[0]];
                if (chordTones[1] !== undefined) stableTones.push(chordTones[1]);
                if (chordTones[2] !== undefined) stableTones.push(chordTones[2]);

                let bestPitch = note.pitch;
                let minDiff = 999;
                for (const st of stableTones) {
                    const targetPitch = this.getNearestOctave(st, note.pitch);
                    const diff = Math.abs(targetPitch - note.pitch);
                    if (diff < minDiff) {
                        minDiff = diff;
                        bestPitch = targetPitch;
                    }
                }
                note.pitch = bestPitch;
                continue; // 修复完毕，跳过后续检查
            }

            // 2. 刺耳冲突 (Avoid Note Clash Fix)
            if (isStrongBeat && isLongNote && !isChordTone) {
                // 检查小九度 (b9) 冲突：旋律音比某个和弦音高半音
                let hasClash = false;
                for (const ct of chordTones) {
                    if ((notePc - (ct % 12) + 12) % 12 === 1) {
                        hasClash = true;
                        break;
                    }
                }

                if (hasClash && maxDissonance < 0.6) {
                    // 评分逻辑：强拍长音的 b9 冲突，MelodyFixScore > ChordFixScore
                    
                    // 最小改动：向下微移半音或全音，直到变成安全的顺阶音
                    note.pitch -= 1;
                    if (!safeScalePcs.includes(note.pitch % 12)) {
                        note.pitch -= 1; 
                    }
                }
            }
        }
    }

    /**
     * 修复旋律横向逻辑 (Horizontal Voice Leading Fix)
     * 检查大跳后是否反向解决，如果没有，则微调第三个音。
     */
    private static fixMelodyHorizontalLogic(notes: NoteData[], tonality: string, chords: GeneratedChord[], style: StyleConfig) {
        const leapThreshold = style?.melody?.leapResolutionThreshold ?? 5;
        
        for (let i = 0; i < notes.length - 2; i++) {
            const note1 = notes[i];
            const note2 = notes[i + 1];
            const note3 = notes[i + 2];

            // 检查大跳 (大跳定义：超过纯四度，即 > 5 个半音)
            const interval = note2.pitch - note1.pitch;
            if (Math.abs(interval) >= leapThreshold) {
                const nextInterval = note3.pitch - note2.pitch;
                
                // 如果大跳向上，下一个音也向上，或者大跳向下，下一个音也向下，这就是没有反向解决
                if ((interval > 0 && nextInterval > 0) || (interval < 0 && nextInterval < 0)) {
                    
                    const activeChord = chords.find(c => note3.onset >= c.startBeat && note3.onset < c.endBeat) || chords[0];
                    const safeScalePcs = HarmonyCore.getSafeScalePitches(activeChord, tonality);
                    
                    // 强制反向解决：将 note3 移向 note1 的方向
                    const direction = interval > 0 ? -1 : 1;
                    
                    // 移动 1 个顺阶音
                    note3.pitch = HarmonyCore.shiftDiatonic(note2.pitch, safeScalePcs, direction);
                }
            }
        }
    }

    /**
     * 修复多声部对位冲突 (Counterpoint Clash Fix)
     * 检查主旋律与副旋律是否在同一拍发生小二度碰撞，或者节奏是否过于拥挤。
     */
    public static reviewCounterpoint(
        vocal: NoteData[] | undefined,
        melody: NoteData[] | undefined,
        counterMelody: NoteData[] | undefined,
        chords: GeneratedChord[],
        tonality: string
    ): void {

        const mainMelody = (vocal && vocal.length > 0) ? vocal : (melody || []);
        if (mainMelody.length === 0) return;

        // 辅助函数：修复碰撞
        const fixClashes = (secondaryNotes: NoteData[], primaryNotes: NoteData[], label: string) => {
            for (let i = 0; i < secondaryNotes.length; i++) {
                const secNote = secondaryNotes[i];
                
                // 找到同时发声的主旋律音 (Onset 相差不到 0.1 拍)
                const concurrentMainNotes = primaryNotes.filter(m => Math.abs(m.onset - secNote.onset) < 0.1);
                
                for (const mNote of concurrentMainNotes) {
                    const interval = Math.abs(secNote.pitch - mNote.pitch) % 12;
                    
                    // 检查小二度 (1) 或大七度 (11) 碰撞
                    if (interval === 1 || interval === 11) {
                        
                        const activeChord = chords.find(c => secNote.onset >= c.startBeat && secNote.onset < c.endBeat) || chords[0];
                        const chordTones = HarmonyCore.getChordTones(activeChord, secNote.pitch);
                        
                        // 最小改动：将副旋律音移到最近的和弦内音，且避开主旋律音
                        let bestPitch = secNote.pitch;
                        let minDiff = 999;
                        for (const ct of chordTones) {
                            const targetPitch = this.getNearestOctave(ct, secNote.pitch);
                            const newInterval = Math.abs(targetPitch - mNote.pitch) % 12;
                            // 避开 1 和 11，最好是 3, 4, 5, 7, 8, 9
                            if (newInterval !== 1 && newInterval !== 11 && newInterval !== 0) {
                                const diff = Math.abs(targetPitch - secNote.pitch);
                                if (diff < minDiff) {
                                    minDiff = diff;
                                    bestPitch = targetPitch;
                                }
                            }
                        }
                        secNote.pitch = bestPitch;
                    }
                }
                
                // 2. 检查节奏重叠混乱 (Rhythm Clutter)
                // 如果主旋律在快速跑动（比如连续的 16 分音符），副旋律最好避让
                const startBeat = Math.floor(secNote.onset);
                const endBeat = startBeat + 1;
                
                const mainNotesInBeat = primaryNotes.filter(m => m.onset >= startBeat && m.onset < endBeat);
                if (mainNotesInBeat.length >= 3) { // 主旋律很密集（一拍内超过2个音）
                    // 降低副旋律的存在感，避免打架
                    secNote.velocity = Math.max(20, secNote.velocity * 0.6);
                }
            }
        };

        // 1. 检查 counterMelody 与 mainMelody 的碰撞
        if (counterMelody && counterMelody.length > 0) {
            fixClashes(counterMelody, mainMelody, 'CM');
        }

        // 2. 如果 vocal 和 melody 都存在，检查 melody 与 vocal 的碰撞
        if (vocal && vocal.length > 0 && melody && melody.length > 0) {
            fixClashes(melody, vocal, 'Melody');
        }

    }

    /**
     * 辅助函数：找到距离目标音高最近的八度音
     */
    private static getNearestOctave(targetPc: number, referencePitch: number): number {
        const tPc = ((targetPc % 12) + 12) % 12;
        const refPc = ((referencePitch % 12) + 12) % 12;
        let diff = tPc - refPc;
        if (diff > 6) diff -= 12;
        if (diff < -6) diff += 12;
        return referencePitch + diff;
    }
}
