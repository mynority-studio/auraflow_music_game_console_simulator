import { PRNGManager } from '../../utils/PRNG';
import { GeneratedChord, SectionMetadata, StyleConfig, ChordProgression, NoteData, Tonality, SCALE_INTERVALS, SectionType, SectionTypeName } from '../types';
import { MusicTheoryRules, ChordFunction } from './MusicTheoryRules';
import { GlobalContext } from '../GlobalContext';
import { sortAndDedupNumbers } from '../utils/Dedup';

import { StyleId } from '../config/StyleFlags';

export class HarmonyCore {
    public static parseRomanNumeral(numeral: string, tonality: Tonality = Tonality.Major, isRelativeMajorProgression: boolean = false) { 
        let rootOffset = 0;
        let cleanNumeral = numeral;
        if (cleanNumeral.startsWith('b')) { rootOffset = -1; cleanNumeral = cleanNumeral.substring(1); }
        else if (cleanNumeral.startsWith('#')) { rootOffset = 1; cleanNumeral = cleanNumeral.substring(1); }

        let isMinor = false;
        let isDim = false;
        let isAug = false;
        let isMaj9 = false;
        let isMaj7 = false;
        let isDom9 = false;
        let isDom7 = false;
        let isMin7 = false;
        let isHalfDim = false;
        let isSus4 = false;
        let isAdd9 = false;
        let isMin9 = false;

        let base = cleanNumeral;
        
        if (base.includes('maj9')) { isMaj9 = true; base = base.replace('maj9', ''); }
        else if (base.includes('maj7')) { isMaj7 = true; base = base.replace('maj7', ''); }
        else if (base.includes('add9')) { isAdd9 = true; base = base.replace('add9', ''); }
        else if (base.includes('m9')) { isMin9 = true; base = base.replace('m9', ''); }
        else if (base.includes('m7b5')) { isHalfDim = true; base = base.replace('m7b5', ''); }
        else if (base.includes('ø7')) { isHalfDim = true; base = base.replace('ø7', ''); }
        else if (base.includes('dim7')) { isDim = true; base = base.replace('dim7', ''); }
        else if (base.includes('dim')) { isDim = true; base = base.replace('dim', ''); }
        else if (base.includes('°')) { isDim = true; base = base.replace('°', ''); }
        else if (base.includes('aug')) { isAug = true; base = base.replace('aug', ''); }
        else if (base.includes('sus4')) { isSus4 = true; base = base.replace('sus4', ''); }
        else if (base.includes('m7')) { isMin7 = true; base = base.replace('m7', ''); }
        else if (base.includes('9')) { isDom9 = true; base = base.replace('9', ''); }
        else if (base.includes('7')) { isDom7 = true; base = base.replace('7', ''); }
        else if (base.includes('b5')) { isDim = true; base = base.replace('b5', ''); }
        
        if (base.endsWith('m')) { isMinor = true; base = base.substring(0, base.length - 1); }
        if (base === base.toLowerCase()) { isMinor = true; }

        const rootMap: {[key: string]: number } = { 'I':0,'i':0,'II':2,'ii':2,'III':4,'iii':4,'IV':5,'iv':5,'V':7,'v':7,'VI':9,'vi':9,'VII':11,'vii':11 };
        let root = (rootMap[base] !== undefined ? rootMap[base] : 0) + rootOffset;
        
        if (tonality === Tonality.Minor) {
            if (isRelativeMajorProgression) {
                // If the progression is written in the relative major (e.g. 'vi - IV - I - V' for minor),
                // we must shift the root up by 3 semitones to align with the minor tonic (0).
                root += 3;
            } else {
                // In minor, III, VI, and VII are naturally flattened compared to major
                // Only apply this natural flattening if there is no explicit accidental (e.g., bVI should not be double-flattened)
                if (base.toUpperCase() === 'III' && rootOffset === 0) root -= 1;
                if (base.toUpperCase() === 'VI' && rootOffset === 0) root -= 1;
                if (base.toUpperCase() === 'VII' && rootOffset === 0) root -= 1;
            }
        }
        
        while(root < 0) root += 12; root %= 12;

        let quality: any = 'Major';
        if (isMinor) quality = 'Minor';
        if (isDim) {
            if (cleanNumeral.includes('dim7') || cleanNumeral.includes('°7')) quality = 'Diminished7';
            else quality = 'Diminished';
        }
        if (isAug) quality = 'Augmented';
        
        if (isAdd9) quality = 'Add9';
        else if (isMin9) quality = 'Minor9';
        else if (isMaj9) quality = 'Major9';
        else if (isMaj7) quality = 'Major7';
        else if (isMin7) quality = 'Minor7';
        else if (isDom9) quality = 'Dominant9';
        else if (isDom7) {
            if (isSus4) quality = 'Dominant7Sus4';
            else if (quality === 'Minor') quality = 'Minor7';
            else quality = 'Dominant7';
        }
        else if (isHalfDim) quality = 'HalfDiminished';
        else if (isSus4) quality = 'Sus4';

        return { root, quality };
    }
    public static getChordTones(chord: GeneratedChord, targetCenter: number): number[] { 
        const root = chord.root;
        let intervals =[0, 4, 7];
        if (chord.quality === 'Minor') intervals =[0, 3, 7];
        if (chord.quality === 'Diminished') intervals =[0, 3, 6];
        if (chord.quality === 'Diminished7') intervals =[0, 3, 6, 9];
        if (chord.quality === 'Augmented') intervals = [0, 4, 8];
        if (chord.quality === 'Add9') intervals = [0, 4, 7, 14];
        if (chord.quality === 'Minor9') intervals = [0, 3, 7, 10, 14];
        if (chord.quality === 'Dominant7') intervals =[0, 4, 7, 10];
        if (chord.quality === 'Minor7') intervals =[0, 3, 7, 10];
        if (chord.quality === 'Major7') intervals =[0, 4, 7, 11];
        if (chord.quality === 'HalfDiminished') intervals =[0, 3, 6, 10];
        if (chord.quality === 'Sus4') intervals =[0, 5, 7];
        if (chord.quality === 'Dominant7Sus4') intervals =[0, 5, 7, 10];
        if (chord.quality === 'Major9') intervals = [0, 4, 7, 11, 14];
        if (chord.quality === 'Dominant9') intervals = [0, 4, 7, 10, 14];
        if (chord.quality === 'Minor11') intervals = [0, 3, 7, 10, 14, 17];
        if (chord.quality === 'Dominant13') intervals = [0, 4, 7, 10, 14, 21];
        
        // 🌟 修复：只将根音对齐到 targetCenter 附近，然后按音程叠加，保留和弦的原始排列（Voicing）
        let baseRoot = root;
        while (baseRoot < targetCenter - 6) baseRoot += 12;
        while (baseRoot > targetCenter + 6) baseRoot -= 12;
        
        return intervals.map(i => baseRoot + i);
    }

    // 🌟 平滑声部连接 (Voice Leading) — 纯通用 Voicing
    //
    // 已剥离风格分支：原 Jazz Rootless / Pop Power Chord / Neo-Soul Altered 等分支均已删除。
    // 风格特定的 voicing 应在未来的 idiom 层（如 VoicingIdiom_Jazz、VoicingIdiom_Rock）实现，
    // 由 Orchestrator 在生成 chord 时决定调用 idiom 还是核心 getSmoothVoicing。
    //
    // 核心引擎只负责通用的"基于音质的最小移动平滑排列 + Drop2 候选 + 平行进行惩罚"。
    public static getSmoothVoicing(currentChord: GeneratedChord, prevVoicing: number[], targetCenter: number = 60): number[] {
        const root = currentChord.root;

        // 🌟 Standard Voicing Logic
        let intervals = [0, 4, 7];
        let omit5th = false;

        if (currentChord.quality === 'Minor') intervals = [0, 3, 7];
        else if (currentChord.quality === 'Diminished') intervals = [0, 3, 6];
        else if (currentChord.quality === 'Augmented') intervals = [0, 4, 8];
        else if (currentChord.quality === 'Add9') intervals = [0, 4, 7, 14];
        else if (currentChord.quality === 'Minor9') { intervals = [0, 3, 7, 10, 14]; omit5th = true; }
        else if (currentChord.quality === 'Major9') { intervals = [0, 4, 7, 11, 14]; omit5th = true; }
        else if (currentChord.quality === 'Dominant9') { intervals = [0, 4, 7, 10, 14]; omit5th = true; }
        else if (currentChord.quality === 'Minor11') { intervals = [0, 3, 7, 10, 14, 17]; omit5th = true; }
        else if (currentChord.quality === 'Dominant13') { intervals = [0, 4, 7, 10, 14, 21]; omit5th = true; }
        else if (currentChord.quality === 'Dominant7') { intervals = [0, 4, 7, 10]; omit5th = true; }
        else if (currentChord.quality === 'Minor7') { intervals = [0, 3, 7, 10]; omit5th = true; }
        else if (currentChord.quality === 'Major7') { intervals = [0, 4, 7, 11]; omit5th = true; }
        else if (currentChord.quality === 'HalfDiminished') intervals = [0, 3, 6, 10];
        else if (currentChord.quality === 'Sus4') intervals = [0, 5, 7];
        else if (currentChord.quality === 'Dominant7Sus4') { intervals = [0, 5, 7, 10]; omit5th = true; }

        if (omit5th && PRNGManager.next() < 0.85) { // 提高省略5音的概率，特别是对于复杂和弦
            intervals = intervals.filter(i => i !== 7);
        }

        const targetPcs = intervals.map(i => (root + i) % 12);
        
        if (!prevVoicing || prevVoicing.length === 0) {
            const newVoicing: number[] = [];
            const isOpenVoicing = PRNGManager.next() < 0.7; // 大幅提高开放排列概率，避免浑浊
            
            if (isOpenVoicing && targetPcs.length >= 3) {
                // Open voicing: Root, 5th, 10th (3rd an octave up), and maybe 7th
                newVoicing.push(targetPcs[0] + 3 * 12); // Root
                if (targetPcs.length > 2) newVoicing.push(targetPcs[2] + 4 * 12); // 5th
                if (targetPcs.length > 1) newVoicing.push(targetPcs[1] + 4 * 12); // 3rd up an octave
                if (targetPcs.length > 3) newVoicing.push(targetPcs[3] + 4 * 12); // 7th up an octave
            } else {
                for (let i = 0; i < targetPcs.length; i++) {
                    let oct = 4;
                    if (i === 0) oct = 3;
                    newVoicing.push(targetPcs[i] + oct * 12);
                }
            }
            return sortAndDedupNumbers(newVoicing);
        }

        // Generate all possible inversions/voicings within a reasonable range (C3 to C6)
        const candidates: number[][] = [];
        // A simple way to generate candidates: take the targetPcs, and for each, pick an octave.
        // To avoid combinatorial explosion, we can just generate drop-2, root position, and inversions.
        // Let's build basic close-position voicings in different octaves and their inversions.
        
        const baseVoicing = targetPcs.sort((a, b) => a - b);
        for (let oct = 3; oct <= 5; oct++) {
            for (let inv = 0; inv < baseVoicing.length; inv++) {
                const cand: number[] = [];
                for (let i = 0; i < baseVoicing.length; i++) {
                    let pitch = baseVoicing[(i + inv) % baseVoicing.length] + oct * 12;
                    if (i + inv >= baseVoicing.length) pitch += 12; // Next octave for inverted notes
                    cand.push(pitch);
                }
                candidates.push(cand.sort((a, b) => a - b));
                
                // Also add Drop 2 voicing
                if (cand.length >= 4) {
                    const drop2 = [...cand];
                    drop2[drop2.length - 2] -= 12;
                    candidates.push(drop2.sort((a, b) => a - b));
                }
            }
        }

        let bestCandidate = candidates[0];
        let minDistance = Infinity;

        for (const cand of candidates) {
            let dist = 0;
            let commonTones = 0;
            let parallelMotionPenalty = 0;

            // Calculate distance by matching each note in cand to the closest note in prevVoicing
            for (let i = 0; i < cand.length; i++) {
                let minNoteDist = Infinity;
                let closestPrevIdx = -1;
                for (let j = 0; j < prevVoicing.length; j++) {
                    const d = Math.abs(cand[i] - prevVoicing[j]);
                    if (d < minNoteDist) {
                        minNoteDist = d;
                        closestPrevIdx = j;
                    }
                }
                
                if (minNoteDist === 0) {
                    commonTones++;
                } else {
                    dist += minNoteDist;
                }

                // Penalize parallel motion (if all voices move in the same direction)
                if (i > 0 && closestPrevIdx > 0) {
                    const move1 = cand[i] - prevVoicing[closestPrevIdx];
                    const move2 = cand[i-1] - prevVoicing[closestPrevIdx-1];
                    if ((move1 > 0 && move2 > 0) || (move1 < 0 && move2 < 0)) {
                        parallelMotionPenalty += 2; // Penalty for parallel motion
                    }
                }
            }

            // Penalize extreme registers
            const center = cand.reduce((a, b) => a + b, 0) / cand.length;
            dist += Math.abs(center - targetCenter) * 0.1;
            
            // Reward common tones
            dist -= commonTones * 5; 
            dist += parallelMotionPenalty;

            if (dist < minDistance) {
                minDistance = dist;
                bestCandidate = cand;
            }
        }

        return sortAndDedupNumbers(bestCandidate);
    }
    public static getScalePitches(tonality: Tonality): number[] {
        let intervals = [0, 2, 4, 5, 7, 9, 11]; 
        if (tonality === Tonality.Minor) intervals = [0, 2, 3, 5, 7, 8, 10]; 
        if (tonality === Tonality.Melodic_Minor) intervals = [0, 2, 3, 5, 7, 9, 11]; // 🌟 Phase 3: Melodic Minor for Jazz
        if (tonality === Tonality.Major_Pentatonic) intervals = [0, 2, 4, 7, 9];
        if (tonality === Tonality.Minor_Pentatonic) intervals = [0, 3, 5, 7, 10];
        if (tonality === Tonality.Blues) intervals = [0, 3, 5, 6, 7, 10];
        if (tonality === Tonality.Dorian) intervals = [0, 2, 3, 5, 7, 9, 10];
        if (tonality === Tonality.Mixolydian) intervals = [0, 2, 4, 5, 7, 9, 10];
        return intervals;
    }

    /**
     * 检查两个和弦是否共享至少 minCommon 个共同音（pitch class 级别）。
     * 用于借调和弦验证、经过和弦验证、Pivot Chord 选择。
     * 参数用 root + quality 而非完整 GeneratedChord，便于在候选生成时轻量调用。
     */
    public static sharesCommonTones(
        root1: number, quality1: string,
        root2: number, quality2: string,
        minCommon: number = 1
    ): boolean {
        // 用临时 chord 获取和弦音，仅需 root + quality
        const pcs1 = this.getChordTones({ root: root1, quality: quality1 } as GeneratedChord, 60);
        const pcs2 = this.getChordTones({ root: root2, quality: quality2 } as GeneratedChord, 60);
        let common = 0;
        for (let i = 0; i < pcs1.length; i++) {
            const pc1 = pcs1[i] % 12;
            for (let j = 0; j < pcs2.length; j++) {
                if (pc1 === pcs2[j] % 12) { common++; break; }
            }
        }
        return common >= minCommon;
    }

    public static getDynamicChordScale(chord: GeneratedChord): number[] {
        const rootPc = chord.root % 12;
        let intervals: number[] = [];

        switch (chord.quality) {
            case 'Major7':
            case 'Major9':
            case 'Add9':
                intervals = [0, 2, 4, 6, 7, 9, 11]; // Lydian (has #11 for color)
                break;
            case 'Minor7':
            case 'Minor9':
            case 'Minor11':
                intervals = [0, 2, 3, 5, 7, 9, 10]; // Dorian (has natural 13/6 for color)
                break;
            case 'Dominant7':
            case 'Dominant9':
            case 'Dominant13':
                intervals = [0, 2, 4, 5, 7, 9, 10]; // Mixolydian
                break;
            case 'HalfDiminished':
                intervals = [0, 1, 3, 5, 6, 8, 10]; // Locrian
                break;
            case 'Diminished7':
            case 'Diminished':
                intervals = [0, 2, 3, 5, 6, 8, 9, 11]; // Whole-Half Diminished
                break;
            case 'Sus4':
            case 'Dominant7Sus4':
                intervals = [0, 2, 5, 7, 9, 10]; // Mixolydian without 3rd
                break;
            case 'Minor':
                intervals = [0, 2, 3, 5, 7, 8, 10]; // Aeolian
                break;
            case 'Major':
            default:
                intervals = [0, 2, 4, 5, 7, 9, 11]; // Ionian
                break;
        }

        return intervals.map(i => (rootPc + i) % 12);
    }

    public static getSafeScalePitches(chord: GeneratedChord, tonality: Tonality): number[] {
        let intervals =[0, 2, 4, 5, 7, 9, 11]; 
        if (tonality === Tonality.Minor) intervals =[0, 2, 3, 5, 7, 8, 10]; 
        if (tonality === Tonality.Melodic_Minor) intervals = [0, 2, 3, 5, 7, 9, 11]; // 🌟 Phase 3: Melodic Minor for Jazz
        if (tonality === Tonality.Major_Pentatonic) intervals =[0, 2, 4, 7, 9];
        if (tonality === Tonality.Minor_Pentatonic) intervals =[0, 3, 5, 7, 10];
        if (tonality === Tonality.Blues) intervals =[0, 3, 5, 6, 7, 10];
        if (tonality === Tonality.Dorian) intervals = [0, 2, 3, 5, 7, 9, 10];
        if (tonality === Tonality.Mixolydian) intervals = [0, 2, 4, 5, 7, 9, 10];
        let scalePcs = intervals.map(i => i % 12);
        const chordTones = this.getChordTones(chord, 60).map(p => p % 12);
        
        // 移除与和弦外音冲突的自然音阶音 (Remove clashing diatonic tones)
        const rootPc = chord.root % 12;
        chordTones.forEach(ct => {
            if (!scalePcs.includes(ct)) {
                // 这是一个变化音 (accidental)
                const interval = (ct - rootPc + 12) % 12;
                let noteToRemove = -1;
                
                if (interval === 4) noteToRemove = (ct - 1 + 12) % 12; // Major 3rd replaces Minor 3rd
                else if (interval === 3) noteToRemove = (ct + 1) % 12; // Minor 3rd replaces Major 3rd
                else if (interval === 10) noteToRemove = (ct + 1) % 12; // Minor 7th replaces Major 7th
                else if (interval === 11) noteToRemove = (ct - 1 + 12) % 12; // Major 7th replaces Minor 7th
                else if (interval === 6) noteToRemove = (ct + 1) % 12; // Diminished 5th replaces Perfect 5th
                else if (interval === 8) noteToRemove = (ct - 1 + 12) % 12; // Augmented 5th replaces Perfect 5th
                else if (interval === 1) noteToRemove = (ct + 1) % 12; // Minor 9th replaces Major 9th
                else if (interval === 2) noteToRemove = (ct - 1 + 12) % 12; // Major 9th replaces Minor 9th
                
                if (noteToRemove !== -1) {
                    scalePcs = scalePcs.filter(spc => spc !== noteToRemove);
                } else {
                    // Fallback: remove any note that is 1 semitone away if we can't determine
                    scalePcs = scalePcs.filter(spc => {
                        const diff = Math.min(Math.abs(spc - ct), 12 - Math.abs(spc - ct));
                        return diff !== 1;
                    });
                }
            }
        });

        return sortAndDedupNumbers([...scalePcs, ...chordTones]);
    }
    public static snapToScale(pitch: number, scalePcs: number[]): number {
        let closestPitch = pitch;
        let minDiff = 1000;
        
        // Check pitches in the current, previous, and next octaves
        const baseOctave = Math.floor(pitch / 12) * 12;
        const octavesToCheck = [baseOctave - 12, baseOctave, baseOctave + 12];
        
        for (const oct of octavesToCheck) {
            for (const pc of scalePcs) {
                const testPitch = oct + pc;
                const diff = Math.abs(pitch - testPitch);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestPitch = testPitch;
                }
            }
        }
        return closestPitch;
    }

    public static shiftDiatonic(pitch: number, scalePcs: number[], steps: number): number {
        // First, snap to the closest pitch in the scale
        let closestPitch = pitch;
        let minDiff = 1000;
        let closestIdx = 0;
        
        const baseOctave = Math.floor(pitch / 12) * 12;
        const octavesToCheck = [baseOctave - 12, baseOctave, baseOctave + 12];
        
        let snappedOctave = baseOctave;
        
        for (const oct of octavesToCheck) {
            for (let i = 0; i < scalePcs.length; i++) {
                const testPitch = oct + scalePcs[i];
                const diff = Math.abs(pitch - testPitch);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestPitch = testPitch;
                    closestIdx = i;
                    snappedOctave = oct;
                }
            }
        }
        
        // Now shift by steps
        let targetIdx = closestIdx + steps;
        let octaveShift = 0;
        while (targetIdx < 0) { targetIdx += scalePcs.length; octaveShift -= 12; }
        while (targetIdx >= scalePcs.length) { targetIdx -= scalePcs.length; octaveShift += 12; }
        
        return snappedOctave + octaveShift + scalePcs[targetIdx];
    }

    public static calculateDissonance(chord: GeneratedChord, melodyNotes: NoteData[], targetCenter: number = 60): number {
        if (melodyNotes.length === 0) return 0;
        const chordTones = this.getChordTones(chord, targetCenter).map(p => p % 12);
        let dissonanceScore = 0;
        let totalWeight = 0;

        for (const note of melodyNotes) {
            const pc = note.pitch % 12;
            const weight = note.duration * note.velocity; // Longer, louder notes matter more
            totalWeight += weight;

            if (chordTones.includes(pc)) {
                // Chord tone: 0 dissonance
                continue;
            }

            // Check for minor 9th clash (half step above a chord tone)
            let isMinor9thClash = false;
            for (const ct of chordTones) {
                if ((pc - ct + 12) % 12 === 1) {
                    isMinor9thClash = true;
                    break;
                }
            }

            if (isMinor9thClash) {
                dissonanceScore += weight * 1.0; // Max dissonance
            } else {
                dissonanceScore += weight * 0.5; // Mild dissonance (e.g., passing tone)
            }
        }

        return totalWeight > 0 ? dissonanceScore / totalWeight : 0;
    }
}

export class HarmonyEngine {
    // 🌟 核心算法 1：基于功能和声的概率替换 (Macro-Constrained Micro-Probability)
    private static generateFromFunction(func: ChordFunction, originalChord: string, isFirstChord: boolean, style: StyleConfig, nextChord: string | null): string {
        const rand = PRNGManager.next();
        
        // 决定变异概率 (Mutation Rate)
        let mutationRate = style.harmonyRules?.reharmProbability ?? 0.1;

        if (rand > mutationRate) return originalChord;

        const isMinorKey = GlobalContext.currentTonality === Tonality.Minor;
        const roll = PRNGManager.next();

        // 命中变异概率，在同等和声功能 (T/S/D) 下进行概率游走
        if (func === 'Tonic') {
            if (roll < 0.5) return 'I';
            if (roll < 0.8) return 'vi';
            if (roll < 0.9) return 'iii';
            // 🌟 调式互换 (Modal Interchange): 借用同主音小调的 bIII 或 bVI (概率极低，防止突兀)
            if (!isMinorKey && roll > 0.95) {
                return PRNGManager.next() > 0.5 ? 'bVI' : 'bIII';
            }
            return 'I';
        } else if (func === 'Subdominant') {
            if (roll < 0.5) return 'IV';
            if (roll < 0.8) return 'ii';
            // 🌟 调式互换 (Modal Interchange): 借用同主音小调的 iv 或 ii°
            if (!isMinorKey && roll > 0.9) {
                return PRNGManager.next() > 0.6 ? 'iv' : 'ii°';
            }
            return 'IV';
        } else if (func === 'Dominant') {
            if (roll < 0.5) return 'V';
            
            // 🚨 目标导向修复：如果要插入副属和弦或减七和弦，必须检查下一个和弦是否匹配
            if (roll < 0.7 && nextChord && (nextChord === 'vi' || nextChord === 'VI')) return 'III'; // 次属和弦 V/vi 必须接 vi
            if (roll < 0.85 && nextChord && (nextChord === 'V' || nextChord === 'v')) return 'II'; // 次属和弦 V/V 必须接 V
            if (roll < 0.95 && nextChord && (nextChord === 'I' || nextChord === 'i')) return 'vii°'; // 导和弦必须接主和弦
            
            // 🌟 调式互换 (Modal Interchange): 借用同主音小调的 bVII (Backdoor dominant)
            if (!isMinorKey && roll > 0.95) {
                return 'bVII';
            }
            return 'V';
        }
        return originalChord;
    }

    // 🌟 核心算法 2：风格化和弦色彩附加 (Style-Specific Spices)
    private static applyStyleSpices(progression: string[], style: StyleConfig): string[] {
        const tonality = GlobalContext.currentTonality; // 获取当前调性
        return progression.map((chord, index, arr) => {
            const voicingStyle = style.harmonyRules?.voicingStyle || 'standard';
            const isJPop = voicingStyle === 'jpop';
            const isJazz = voicingStyle === 'jazz' || voicingStyle === 'neo-soul';
            const isEDM = voicingStyle === 'edm';
            
            // 提取纯净的罗马数字基底
            let base = chord.replace(/maj9|maj7|m7b5|dim7|dim|°|aug|sus4|m9|m7|9|7|b5|add9/g, '');
            
            // 🌟 核心修复：将所有小调属和弦 v 强制转换为大调属和弦 V，以提供更强的导向性
            if (base === 'v') {
                base = 'V';
                chord = chord.replace('v', 'V');
            }
            
            // 🌟 核心修复：正确判断是否为小调和弦。如果原始和弦包含 'm' 且不包含 'maj'，或者是小写罗马数字，则为小调和弦
            const isMinor = (chord.includes('m') && !chord.includes('maj')) || base === base.toLowerCase();
            const isHalfDim = chord.includes('m7b5');
            const isDiminished = chord.includes('dim') || chord.includes('°');
            const isAug = chord.includes('aug');
            
            const rand = PRNGManager.next();

            // 🚨 核心修复：严禁在 Minor 调性下将小调主和弦 i 错误地变成大调的 Iadd9
            if (tonality === Tonality.Minor && base === 'i') {
                if (rand < 0.4) {
                    if (PRNGManager.next() < 0.5) return 'im9';
                    if (PRNGManager.next() < 0.8) return 'iadd9';
                    return 'im7';
                }
                return 'i';
            }

            // 获取下一个和弦，用于上下文校验
            const nextChord = index + 1 < arr.length ? arr[index + 1].replace(/maj9|maj7|m7b5|dim7|dim|°|aug|sus4|m9|m7|9|7|b5|add9/g, '') : null;

            if (isJazz || isJPop) {
                const spiceProb = isJazz ? 1.0 : 0.8; // Jazz/Neo-Soul 100% 附加色彩，J-Pop 80%
                if (rand < spiceProb) { // 加上浓郁的色彩音
                    if (isDiminished) {
                        // 🚨 核心修复：只有自然音阶的 vii 级或 ii 级可以变成 m7b5，作为 ii-V-I 的前置。
                        // 其他的经过减和弦（如 #idim, #iidim, #ivdim, #vdim）必须保持 fully diminished (dim7) 才能起导和弦作用！
                        if (base === 'ii') return base + 'm7b5';
                        if (base === 'vii' && (nextChord === 'III' || nextChord === 'iii')) return base + 'm7b5';
                        return base + 'dim7';
                    }
                    if (!isMinor && (base === 'I' || base === 'IV' || base === 'bVI' || base === 'bIII')) return rand > 0.5 ? base + 'maj7' : base + 'maj9';
                    if (!isMinor && base === 'bVII') return rand > 0.5 ? base + '7' : base + '9'; // Backdoor dominant
                    if (isMinor && (base === 'ii' || base === 'iii' || base === 'vi' || base === 'iv')) return rand > 0.5 ? base + 'm7' : base + 'm9';
                    
                    // 🚨 核心修复：不能无脑把 VI 变成 VI7。只有当 VI 后面跟着 ii 时，才允许把它变成 VI7（作为 V/ii）。
                    if (base === 'VI') {
                        if (nextChord === 'ii' || nextChord === 'iiø7') {
                            if (rand < 0.3) return base + 'sus4';
                            if (rand < 0.6) return base + '7';
                            return base + '9';
                        } else {
                            return tonality === Tonality.Minor ? 'VImaj7' : 'VIm7'; // 根据调性返回自然和弦
                        }
                    }

                    // 🚨 核心修复：半减七（m7b5）只能用在 ii 级（小调的 iiø7）或 vii 级（大调的 viiø7，但通常作为 ii/vi 接 III）。
                    if (base === 'vii') {
                        if (nextChord === 'III' || nextChord === 'iii') return base + 'm7b5';
                        return base + 'dim7';
                    }
                    if (base === 'ii' && tonality === Tonality.Minor) {
                        if (nextChord === 'V' || nextChord === 'v') return base + 'm7b5';
                    }

                    if (base === 'V' || base === 'III' || base === 'II') {
                        // 属和弦或次属和弦
                        if (rand < 0.3) return base + 'sus4';
                        if (rand < 0.6) return base + '7';
                        return base + '9'; // 增加 9 音
                    }
                }
            } else if (isEDM) {
                if (rand < 0.6) { 
                    if (tonality === Tonality.Minor) {
                        if (base === 'iv' || base === 'v') return PRNGManager.next() > 0.5 ? base + 'm7' : base + 'm9';
                        if (base === 'VI' || base === 'III' || base === 'VII') return PRNGManager.next() > 0.5 ? base + 'add9' : base + 'maj7';
                    } else {
                        if (!isMinor && (base === 'I' || base === 'IV' || base === 'bVI')) return base + 'add9';
                        if (isMinor && (base === 'vi' || base === 'ii' || base === 'iv')) return base + 'm7';
                    }
                    if (base === 'V' || base === 'bVII') return base + 'sus4';
                }
            } else {
                // Standard Pop/Rock
                if (rand < 0.4) {
                    if (!isMinor && (base === 'I' || base === 'IV' || base === 'bVI')) return base + 'add9';
                    if (isMinor && (base === 'vi' || base === 'iv')) return base + 'm7';
                    if (base === 'V') return 'Vsus4';
                }
            }

            // 如果没有附加色彩，返回传入时的和弦
            return chord;
        });
    }

    // 🌟 核心算法 3：动态生成进行 (Dynamic Progression Generator)
    private static generateDynamicProgression(pool: string[][], fallback: string[], style: StyleConfig, sectionType: string = 'Verse'): string[] {
        const baseProgression = pool && pool.length > 0 ? pool[Math.floor(PRNGManager.next() * pool.length)] : fallback;
        
        // 1. 提取功能骨架 (Extract Functional Flow)
        const functionalFlow = baseProgression.map(chord => ({
            original: chord,
            func: MusicTheoryRules.getChordFunction(chord)
        }));

        // 2. 概率替换 (Probabilistic Substitution)
        const isEmotionalCore = sectionType === 'Intro' || sectionType === 'Outro';
        let newProgression = functionalFlow.map((item, index) => {
            if (isEmotionalCore) return item.original; // 🚨 核心修复：Intro 和 Outro 严禁功能性变异，保持原汁原味
            const nextChord = index < functionalFlow.length - 1 ? functionalFlow[index + 1].original : null;
            return this.generateFromFunction(item.func, item.original, index === 0, style, nextChord);
        });

        // 🌟 方案 A：情感化调式互换 (Emotional Modal Interchange)
        // 在大调中，对于 Bridge 或 Chorus，有一定概率借用同主音小调的和弦，制造“红杏出墙”的色彩突变
        if (GlobalContext.currentTonality === Tonality.Major && (sectionType === 'Bridge' || sectionType === 'Chorus' || sectionType === 'PreChorus')) {
            const modalInterchangeProb = 0.35; // 35% 概率触发调式互换
            if (PRNGManager.next() < modalInterchangeProb) {
                newProgression = newProgression.map(chord => {
                    const base = chord.replace(/maj9|maj7|m7b5|dim7|dim|°|aug|sus4|m9|m7|9|7|b5|add9/g, '');
                    // IV -> iv (下属变小下属，极具伤感色彩)
                    if (base === 'IV' && PRNGManager.next() < 0.6) return chord.replace('IV', 'iv');
                    // vi -> bVI (大调的六级变成降六级大和弦，史诗感/流行朋克感)
                    if (base === 'vi' && PRNGManager.next() < 0.4) return chord.replace('vi', 'bVI');
                    // ii -> ii° (二级变减和弦)
                    if (base === 'ii' && PRNGManager.next() < 0.3) return chord.replace('ii', 'ii°');
                    return chord;
                });
            }
        }

        // 3. 附加风格色彩 (Apply Style Spices)
        return this.applyStyleSpices(newProgression, style);
    }

    public static generateHarmonyTimeline(sections: SectionMetadata[], style: StyleConfig, timeSignature:[number, number]): GeneratedChord[] {
        const timeline: GeneratedChord[] = [];
        const beatsPerBar = timeSignature[0];

        // 1. Global Chord Planning (全局和弦规划)
        const globalPlan: { [type: string]: string[] } = {};
        
        // 决定是全曲共用一套和弦 (Global Progression) 还是不同段落不同和弦
        const globalProgressionProbability = style.harmonyRules?.globalProgressionProbability ?? 0.2;
        const isGlobalProgression = PRNGManager.next() < globalProgressionProbability;

        // EDM 神级和弦进行池
        const edmProgressionPool = [
            ['vi', 'IV', 'I', 'V'], // 神级经典
            ['I', 'V', 'vi', 'IV'], // uplifting 标配
            ['I', 'vi', 'ii', 'IV'], // 柔和空灵
            ['i', 'v', 'bVI', 'IV'], // 偏暗黑深邃 (使用 bVI 适配小调)
            ['I', 'IV', 'vi', 'V'], // 极简催眠
            ['vi', 'ii', 'V', 'I']  // 高级感
        ];

        // J-Pop/ACG 经典和弦进行池
        const jpopProgressionPool = [
            ['IV', 'V', 'iii', 'vi'], // 王道进行 (Royal Road)
            ['IV', 'V', 'vi', 'I'],   // 常见变体
            ['vi', 'IV', 'V', 'I'],   // 小调色彩起手 (Tetsuya Komuro)
            ['ii', 'V', 'I', 'vi'],   // 爵士 2-5-1 变体
            ['IV', 'iii', 'ii', 'I']  // 下行级进
        ];

        if (isGlobalProgression) {
            let poolToUse = style.harmony.chorusPool;
            const voicingStyle = style.harmonyRules?.voicingStyle || 'standard';
            const isEDM = voicingStyle === 'edm';
            const isJPop = voicingStyle === 'jpop';
            if (isEDM) poolToUse = edmProgressionPool;
            else if (isJPop) poolToUse = jpopProgressionPool;
            
            const masterProgression = this.generateDynamicProgression(poolToUse, ['I', 'V', 'vi', 'IV'], style, 'Chorus');
            globalPlan['Chorus'] = masterProgression;
            globalPlan['Verse'] = masterProgression;
            globalPlan['PreChorus'] = masterProgression;
            globalPlan['Break'] = masterProgression;
            globalPlan['Bridge'] = masterProgression;
            globalPlan['Outro'] = masterProgression;
            globalPlan['Intro'] = masterProgression;
        } else {
            // 为每种段落类型抽取唯一的和弦进行，确保全曲一致性 (例如 Verse 1 和 Verse 2 使用相同的和弦)
            let chorusPool = style.harmony.chorusPool;
            let versePool = style.harmony.versePool;
            let preChorusPool = style.harmony.preChorusPool;

            const voicingStyle = style.harmonyRules?.voicingStyle || 'standard';
            const isEDM = voicingStyle === 'edm';
            const isJPop = voicingStyle === 'jpop';

            if (isEDM) {
                chorusPool = edmProgressionPool;
                versePool = edmProgressionPool;
                preChorusPool = edmProgressionPool;
            } else if (isJPop) {
                chorusPool = jpopProgressionPool;
                versePool = [['I', 'vi', 'IV', 'V'], ['vi', 'IV', 'I', 'V'], ['I', 'V', 'vi', 'iii']]; // J-Pop Verse 通常比较平稳
                preChorusPool = [['IV', 'V', 'iii', 'vi'], ['ii', 'V', 'I', 'vi'], ['IV', 'iv', 'I', 'I7']]; // PreChorus 增加张力
            }
            
            globalPlan['Chorus'] = this.generateDynamicProgression(chorusPool, ['I', 'V', 'vi', 'IV'], style, 'Chorus');
            globalPlan['Verse'] = this.generateDynamicProgression(versePool, ['I', 'vi', 'IV', 'V'], style, 'Verse');
            globalPlan['PreChorus'] = this.generateDynamicProgression(preChorusPool, ['ii', 'V', 'I', 'vi'], style, 'PreChorus');
            globalPlan['Break'] = this.generateDynamicProgression([['vi', 'IV', 'I', 'V'], ['ii', 'vi', 'IV', 'I']], ['vi', 'IV', 'I', 'V'], style, 'Break');
            globalPlan['Bridge'] = this.generateDynamicProgression([['vi', 'IV', 'I', 'V'], ['ii', 'V', 'vi', 'IV'], ['IV', 'V', 'iii', 'vi']], ['vi', 'IV', 'I', 'V'], style, 'Bridge');
            
            // 🚨 核心修复：Outro 必须根据调性严格收尾，不能无脑 I - I
            const tonality = GlobalContext.currentTonality;
            const isJazzOrSoul = voicingStyle === 'jazz' || voicingStyle === 'neo-soul';
            
            let outroFallback = tonality === Tonality.Minor ? ['i', 'bVI', 'iv', 'i'] : ['I', 'vi', 'IV', 'I'];
            let outroPool = tonality === Tonality.Minor ? [['i', 'bVI', 'iv', 'i'], ['i', 'iv', 'V', 'i'], ['i', 'i', 'i', 'i'], ['V', 'i']] : [['I', 'vi', 'IV', 'I'], ['I', 'IV', 'V', 'I'], ['I', 'I', 'I', 'I'], ['V', 'I']];
            
            if (isJazzOrSoul) {
                // 🚨 核心修复：Jazz/Neo-Soul 的 Outro 使用固定的下行进行或 ii-V-I 延长
                outroFallback = tonality === Tonality.Minor ? ['iim7b5', 'V7', 'im9', 'im9'] : ['IIm9', 'V13', 'IMaj9', 'IMaj9'];
                outroPool = tonality === Tonality.Minor ? [
                    ['iim7b5', 'V7', 'im9', 'im9'], // ii-V-i in minor
                    ['ivm9', 'bVII13', 'im9', 'im9'] // Backdoor ii-V-i in minor
                ] : [
                    ['IIm9', 'V13', 'IMaj9', 'IMaj9'],
                    ['IVmaj9', 'ivm9', 'Imaj9', 'Imaj9'] // Minor Plagal Cadence (Very Neo-Soul)
                ];
            }
            
            globalPlan['Outro'] = this.generateDynamicProgression(outroPool, outroFallback, style, 'Outro');
            
            globalPlan['Intro'] = globalPlan['Verse']; // Intro 通常使用 Verse 的和弦
        }

        // 2. Generate Timeline
        const sectionTypeCounts: { [type: string]: number } = {};

        sections.forEach((section, sectionIndex) => {
            let baseProgression: string[];
            // 从数值 sectionType 派生 globalPlan 查表 key（取代原 name.includes 子串匹配）
            const secType = section.sectionType ?? SectionType.Verse;
            // globalPlan 只支持 Verse/Chorus/PreChorus/Break/Bridge/Intro/Outro 这几个 key，
            // 其他段落类型回退到 Verse
            let progressionKey: string;
            if (secType === SectionType.Chorus) progressionKey = 'Chorus';
            else if (secType === SectionType.PreChorus) progressionKey = 'PreChorus';
            else if (secType === SectionType.Break || secType === SectionType.Breakdown) progressionKey = 'Break';
            else if (secType === SectionType.Bridge || secType === SectionType.Solo_Bridge) progressionKey = 'Bridge';
            else if (secType === SectionType.Outro || secType === SectionType.PreOutro) progressionKey = 'Outro';
            else if (secType === SectionType.Intro) progressionKey = 'Intro';
            else progressionKey = 'Verse';

            baseProgression = globalPlan[progressionKey];
            
            // 🌟 Phase 1: Save base progression to decoupled state
            if (section.harmony) {
                section.harmony.baseProgression = [...baseProgression];
            }
            
            // 记录该类型段落出现的次数（用 progressionKey 字符串作为 hashmap key）
            sectionTypeCounts[progressionKey] = (sectionTypeCounts[progressionKey] || 0) + 1;
            const appearanceCount = sectionTypeCounts[progressionKey];

            // 允许同类型段落的变体 (例如 Verse 2 可以是 Verse 1 的微调，这里先保持完全一致，后续可扩展 Re-harmonization)
            let progression = [...baseProgression];

            // 🌟 核心：替代和弦 (Chord Substitution)
            // 如果是该类型段落的第 2 次或以上出现 (例如 Verse 2, Chorus 2)，有概率进行和弦替换，增加变化
            const reharmProb = style.harmonyRules?.reharmProbability ?? 0.3;
            const borrowedChords = style.harmonyRules?.borrowedChords ?? [];
            if (appearanceCount > 1 && !isGlobalProgression) {
                let hasMutation = false;
                progression = progression.map(numeral => {
                    if (PRNGManager.next() < reharmProb) { 
                        const subs = MusicTheoryRules.getSubstitution(numeral, borrowedChords);
                        if (subs.length > 0) {
                            hasMutation = true;
                            return subs[Math.floor(PRNGManager.next() * subs.length)];
                        }
                    }
                    return numeral;
                });
                
                if (hasMutation) {
                    progression = this.applyStyleSpices(progression, style);
                }
            }
            
            const isMinorProgression = progression.some(numeral => {
                let clean = numeral;
                if (clean.startsWith('b') || clean.startsWith('#')) clean = clean.substring(1);
                const base = clean.replace(/maj9|maj7|m7b5|dim7|dim|°|aug|sus4|m9|m7|9|7|b5|add9/g, '');
                return base === 'i' || base === 'iv' || base === 'v';
            });
            const isRelativeMajorProgression = GlobalContext.currentTonality === Tonality.Minor && !isMinorProgression;

            let currentBeat = section.startBeat;
            const totalBars = (section.endBeat - section.startBeat) / beatsPerBar;
            
            // 🌟 核心修复：预先计算整个段落的实际和弦，解决 Turnaround 覆盖导致经过和弦悬空的问题
            const actualProgression: string[] = [];
            let currentPhraseProgression = [...progression];
            
            for (let bar = 0; bar < totalBars; bar++) {
                // 每 4 小节（一个乐句）重新计算一次变异，增加段落内部的动态变化
                if (bar > 0 && bar % currentPhraseProgression.length === 0 && !isGlobalProgression) {
                    currentPhraseProgression = progression.map(numeral => {
                        if (PRNGManager.next() < reharmProb * 0.5) { // 段落内部变异概率减半，保持主干稳定
                            const subs = MusicTheoryRules.getSubstitution(numeral, borrowedChords);
                            if (subs.length > 0) return subs[Math.floor(PRNGManager.next() * subs.length)];
                        }
                        return numeral;
                    });
                    currentPhraseProgression = this.applyStyleSpices(currentPhraseProgression, style);
                }
                
                let numeral = currentPhraseProgression[bar % currentPhraseProgression.length];
                const isEndOfSection = (bar === totalBars - 1);
                const tonality = GlobalContext.currentTonality;
                const tonic = tonality === Tonality.Minor ? 'i' : 'I';
                const subdominant = tonality === Tonality.Minor ? 'iv' : 'IV';
                const dominant = tonality === Tonality.Minor ? 'V' : 'V';

                if (section.endingType === 'hard_stop') {
                    numeral = tonic;
                } else if ((secType === SectionType.Outro || secType === SectionType.PreOutro) && bar >= totalBars - 2) {
                    if (bar === totalBars - 2) {
                        numeral = PRNGManager.next() > 0.5 ? subdominant : dominant;
                    } else if (bar === totalBars - 1) {
                        numeral = tonic;
                    }
                } else if (secType === SectionType.Chorus && isEndOfSection) {
                    const nextSection = sectionIndex + 1 < sections.length ? sections[sectionIndex + 1] : null;
                    const nextSecType = nextSection?.sectionType;
                    if (nextSection && nextSecType !== SectionType.Chorus && nextSecType !== SectionType.Outro && nextSecType !== SectionType.PreOutro) {
                        numeral = PRNGManager.next() > 0.5 ? 'V7' : 'Vsus4';
                    }
                } else if ((secType === SectionType.Verse || secType === SectionType.Chorus) && !isEndOfSection && (bar + 1) % 4 === 0) {
                    if (PRNGManager.next() < 0.3) {
                        numeral = 'V';
                    }
                }
                actualProgression.push(numeral);
            }

            for (let barsGenerated = 0; barsGenerated < totalBars; barsGenerated++) {
                let numeral = actualProgression[barsGenerated];
                const isEndOfPhrase = ((barsGenerated + 1) % progression.length === 0); 
                const isEndOfSection = (barsGenerated === totalBars - 1);

                // 🌟 核心：经过和弦变异 (Passing Chord Mutation) & 段落过渡 (Section Transition)
                const isEmotionalCore = secType === SectionType.Intro || secType === SectionType.Outro || secType === SectionType.PreOutro;
                const allowMutation = !isEmotionalCore; // 允许在 Verse, PreChorus, Chorus 中变异，增加和声推动力

                // 决定下一个目标和弦，用于计算经过和弦
                let nextNumeral = 'I';
                if (!isEndOfSection) {
                    nextNumeral = actualProgression[barsGenerated + 1];
                } else if (isEndOfSection && sectionIndex + 1 < sections.length) {
                    // 段落交界处，寻找下一个段落的第一个和弦
                    const nextSection = sections[sectionIndex + 1];
                    if (nextSection.endingType === 'hard_stop') {
                        nextNumeral = GlobalContext.currentTonality === Tonality.Minor ? (isMinorProgression ? 'i' : 'vi') : 'I';
                    } else {
                        // 用 nextSection 的数值 sectionType 派生 globalPlan key
                        const nextSecType = nextSection.sectionType ?? SectionType.Verse;
                        let nextSecProg: string[];
                        if (nextSecType === SectionType.Chorus) nextSecProg = globalPlan['Chorus'];
                        else if (nextSecType === SectionType.PreChorus) nextSecProg = globalPlan['PreChorus'];
                        else if (nextSecType === SectionType.Break || nextSecType === SectionType.Breakdown) nextSecProg = globalPlan['Break'];
                        else if (nextSecType === SectionType.Outro || nextSecType === SectionType.PreOutro) nextSecProg = globalPlan['Outro'];
                        else if (nextSecType === SectionType.Intro) nextSecProg = globalPlan['Intro'];
                        else nextSecProg = globalPlan['Verse'];
                        
                        nextNumeral = nextSecProg[0];
                            
                            // 🚨 核心修复：跨段落的 isMinorProgression 约定转换
                            const nextSectionIsMinorProgression = nextSecProg.some(numeral => {
                                let clean = numeral;
                                if (clean.startsWith('b') || clean.startsWith('#')) clean = clean.substring(1);
                                const base = clean.replace(/maj9|maj7|m7b5|dim7|dim|°|aug|sus4|m9|m7|9|7|b5|add9/g, '');
                                return base === 'i' || base === 'iv' || base === 'v';
                            });
                            
                            if (GlobalContext.currentTonality === Tonality.Minor && isMinorProgression !== nextSectionIsMinorProgression) {
                                const translationMapToRelativeMajor: Record<string, string> = {
                                    'i': 'vi', 'iv': 'ii', 'v': 'iii', 'bVI': 'IV', 'bVII': 'V', 'bIII': 'I',
                                    'im7': 'vim7', 'im9': 'vim9', 'ivm7': 'iim7', 'ivm9': 'iim9', 'vm7': 'iiim7',
                                    'bVImaj7': 'IVmaj7', 'bVImaj9': 'IVmaj9', 'bVII7': 'V7', 'bVII9': 'V9', 'bIIImaj7': 'Imaj7', 'bIIImaj9': 'Imaj9'
                                };
                                const translationMapToParallelMinor: Record<string, string> = {
                                    'vi': 'i', 'ii': 'iv', 'iii': 'v', 'IV': 'bVI', 'V': 'bVII', 'I': 'bIII',
                                    'vim7': 'im7', 'vim9': 'im9', 'iim7': 'ivm7', 'iim9': 'ivm9', 'iiim7': 'vm7',
                                    'IVmaj7': 'bVImaj7', 'IVmaj9': 'bVImaj9', 'V7': 'bVII7', 'V9': 'bVII9', 'Imaj7': 'bIIImaj7', 'Imaj9': 'bIIImaj9'
                                };
                                
                                const cleanNext = nextNumeral.replace(/maj9|maj7|m7b5|dim7|dim|°|aug|sus4|m9|m7|9|7|b5|add9/g, '');
                                const isMinor = cleanNext === cleanNext.toLowerCase();
                                
                                if (nextSectionIsMinorProgression && !isMinorProgression) {
                                    nextNumeral = translationMapToRelativeMajor[nextNumeral] || nextNumeral;
                                } else if (!nextSectionIsMinorProgression && isMinorProgression) {
                                    nextNumeral = translationMapToParallelMinor[nextNumeral] || nextNumeral;
                                }
                            }
                        }
                    }

                    const isEDM = style.id === StyleId.Eurodance || style.id === StyleId.Trance || style.id === StyleId.Synthwave;

                    // 如果允许变异，且在句尾或段落尾，有概率插入经过和弦
                    const passingChordsAllowed = isEDM ? [] : [...(style.harmonyRules?.passingChords ?? ['SecondaryDominant', 'Diminished7'])];
                    const allowTritoneSub = isEDM ? false : (style.harmonyRules?.allowTritoneSub ?? false);
                    
                    // 🌟 核心优化 7：J-Pop/ACG 专属经过和弦 (#IVm7b5)
                    const isJPop = !!style.harmonyRules?.preferJPopProgressions;
                    if (isJPop && !passingChordsAllowed.includes('SharpFourHalfDim')) {
                        passingChordsAllowed.push('SharpFourHalfDim');
                    }

                    // 🌟 HC-2: 段落交界经过和弦概率提升
                    // 旧版段落尾仅 10%，导致 Verse→Chorus 经常硬切
                    // 新版段落尾提升到 style 可配（默认 45%），中间维持 30%
                    const sectionEndPassingProb = style.harmonyRules?.sectionTransitionPassingProb ?? 0.45;
                    const passingProb = isEndOfSection ? sectionEndPassingProb : 0.3;
                    if (allowMutation && (isEndOfPhrase || isEndOfSection) && PRNGManager.next() < passingProb && beatsPerBar >= 3 && passingChordsAllowed.length > 0) {
                        
                        let passingBeats = 1; 
                        if (beatsPerBar === 4) passingBeats = 2; 
                        else if (beatsPerBar === 6) passingBeats = 2; 
                        else if (beatsPerBar === 8) passingBeats = 4; 
                        
                        const mainBeats = beatsPerBar - passingBeats;
                        
                        // 计算经过和弦 (Secondary Dominant or Leading Tone)
                        let passingNumeral = 'V'; 
                        const passingType = passingChordsAllowed[Math.floor(PRNGManager.next() * passingChordsAllowed.length)];

                        // 🚨 核心修复：强制校验经过和弦的合理性，防止悬挂
                        let isValidPassing = false;

                        if (passingType === 'SecondaryDominant' || passingType === 'Diminished7' || passingType === 'DescendingDiminished' || passingType === 'SharpFourHalfDim' || (passingType === 'TritoneSub' && allowTritoneSub)) {
                            const calculatedPassing = MusicTheoryRules.getPassingChord(nextNumeral, passingType as any);
                            if (calculatedPassing) {
                                passingNumeral = calculatedPassing;
                                // Apply style spices to the passing chord to get the correct extensions
                                passingNumeral = this.applyStyleSpices([passingNumeral], style)[0];
                                isValidPassing = true;

                                // 🌟 HC-3: 共同音验证
                                // 经过和弦必须与目标和弦（nextNumeral）共享 ≥1 个 pitch class，
                                // 否则听感会"突然跳到一个不相关的和弦"
                                const passingParsed = HarmonyCore.parseRomanNumeral(passingNumeral, GlobalContext.currentTonality, isRelativeMajorProgression);
                                const nextParsed = HarmonyCore.parseRomanNumeral(nextNumeral, GlobalContext.currentTonality, isRelativeMajorProgression);
                                if (!HarmonyCore.sharesCommonTones(passingParsed.root, passingParsed.quality, nextParsed.root, nextParsed.quality)) {
                                    isValidPassing = false; // 回退：不插入这个经过和弦
                                }
                            }
                        }

                        // 如果无法生成合理的经过和弦，或者随机决定不生成，则撤销经过和弦
                        if (!isValidPassing) {
                            // 撤销经过和弦，恢复主和弦占据整个小节
                            const parsedMain = HarmonyCore.parseRomanNumeral(numeral, GlobalContext.currentTonality, isRelativeMajorProgression);
                            timeline.push({ 
                                numeral, root: parsedMain.root, quality: parsedMain.quality, 
                                startBeat: currentBeat, endBeat: currentBeat + beatsPerBar,
                                keyOffset: GlobalContext.currentKeyOffset + (section.localKeyOffset || 0)
                            });
                        } else {
                            // 成功生成合理的经过和弦
                            const parsedMain = HarmonyCore.parseRomanNumeral(numeral, GlobalContext.currentTonality, isRelativeMajorProgression);
                            
                            let passingBeats = 1; 
                            if (beatsPerBar === 4) passingBeats = 2; 
                            else if (beatsPerBar === 6) passingBeats = 2; 
                            else if (beatsPerBar === 8) passingBeats = 4; 
                            
                            const mainBeats = beatsPerBar - passingBeats;

                            timeline.push({ 
                                numeral, root: parsedMain.root, quality: parsedMain.quality, 
                                startBeat: currentBeat, endBeat: currentBeat + mainBeats,
                                keyOffset: GlobalContext.currentKeyOffset + (section.localKeyOffset || 0)
                            });

                            const parsedPassing = HarmonyCore.parseRomanNumeral(passingNumeral, GlobalContext.currentTonality, isRelativeMajorProgression);
                            timeline.push({ 
                                numeral: passingNumeral, root: parsedPassing.root, quality: parsedPassing.quality, 
                                startBeat: currentBeat + mainBeats, endBeat: currentBeat + beatsPerBar,
                                keyOffset: GlobalContext.currentKeyOffset + (section.localKeyOffset || 0)
                            });
                        }
                    } else {
                        // 常规不发生变异
                        const parsed = HarmonyCore.parseRomanNumeral(numeral, GlobalContext.currentTonality, isRelativeMajorProgression);
                        timeline.push({ 
                            numeral, root: parsed.root, quality: parsed.quality, 
                            startBeat: currentBeat, endBeat: currentBeat + beatsPerBar,
                            keyOffset: GlobalContext.currentKeyOffset + (section.localKeyOffset || 0)
                        });
                    }
                    
                    currentBeat += beatsPerBar;
                }
            });
            return timeline;
    }

    public static reharmonize(chords: GeneratedChord[], melody: NoteData[], style: StyleConfig): GeneratedChord[] {
        if (!style.harmonyRules || style.harmonyRules.reharmProbability === 0) return chords;
        
        // Viterbi-like dynamic programming for reharmonization
        // State space: for each original chord, we consider a few alternatives (substitutions).
        // We want to find the sequence of chords that maximizes the score (melody fit + transition logic).
        
        // 🌟 HC-5: getAlternatives 返回候选列表 + borrowedStartIndex（从此索引起的候选是借调和弦）
        const getAlternatives = (original: GeneratedChord, next: GeneratedChord | null): { alts: GeneratedChord[], borrowedStartIndex: number } => {
            const alts = [original];
            const parsed = HarmonyCore.parseRomanNumeral(original.numeral);

            // 1. Relative Minor/Major substitution (e.g., Cmaj7 <-> Am7)
            const relativeMap: Record<string, string> = {
                'Imaj7': 'vi7', 'vi7': 'Imaj7',
                'IVmaj7': 'ii7', 'ii7': 'IVmaj7'
            };
            if (relativeMap[original.numeral]) {
                const relParsed = HarmonyCore.parseRomanNumeral(relativeMap[original.numeral]);
                alts.push({ ...original, numeral: relativeMap[original.numeral], root: relParsed.root, quality: relParsed.quality });
            }

            // 2. Secondary Dominant (if we know the next chord)
            if (next && style.harmonyRules?.passingChords?.includes('SecondaryDominant')) {
                const secDom = MusicTheoryRules.getPassingChord(next.numeral, 'SecondaryDominant');
                if (secDom) {
                    const secParsed = HarmonyCore.parseRomanNumeral(secDom);
                    if (secDom !== original.numeral) {
                        alts.push({ ...original, numeral: secDom, root: secParsed.root, quality: secParsed.quality });
                    }
                }
            }

            // 3. Tritone Substitution (if going to a dominant or target)
            if (next && style.harmonyRules?.allowTritoneSub) {
                const tritoneSub = MusicTheoryRules.getPassingChord(next.numeral, 'TritoneSub');
                if (tritoneSub && tritoneSub !== original.numeral) {
                    const triParsed = HarmonyCore.parseRomanNumeral(tritoneSub);
                    alts.push({ ...original, numeral: tritoneSub, root: triParsed.root, quality: triParsed.quality });
                }
            }

            // ── 以上为常规候选，以下为借调候选 ──
            const borrowedStartIndex = alts.length;

            // 4. HC-1: 借调和弦 (Borrowed Chords / Modal Mixture)
            const borrowedTypes = style.harmonyRules?.borrowedChords ?? [];
            if (borrowedTypes.length > 0) {
                const subs = MusicTheoryRules.getSubstitution(original.numeral, borrowedTypes);
                for (let si = 0; si < subs.length; si++) {
                    const sub = subs[si];
                    if (sub === original.numeral) continue;
                    const subParsed = HarmonyCore.parseRomanNumeral(sub);
                    if (HarmonyCore.sharesCommonTones(parsed.root, parsed.quality, subParsed.root, subParsed.quality)) {
                        alts.push({ ...original, numeral: sub, root: subParsed.root, quality: subParsed.quality });
                    }
                }
            }

            return { alts, borrowedStartIndex };
        };

        const getMelodyFitScore = (chord: GeneratedChord, melodyNotes: NoteData[]): number => {
            if (melodyNotes.length === 0) return 0;
            const chordTones = HarmonyCore.getChordTones(chord, 60); // Simplified, relative to C4
            const chordPcs = chordTones.map(p => p % 12);
            let score = 0;
            for (const note of melodyNotes) {
                const pc = note.pitch % 12;
                if (chordPcs.includes(pc)) {
                    score += note.duration * 2; // Strong fit
                } else {
                    // Check if it's a valid extension (9th, 11th, 13th)
                    const rootPc = chord.root % 12;
                    const interval = (pc - rootPc + 12) % 12;
                    if ([2, 5, 9].includes(interval)) {
                        score += note.duration * 0.5; // Okay fit
                    } else {
                        score -= note.duration * 1.5; // Clash
                    }
                }
            }
            return score;
        };

        const getTransitionScore = (prev: GeneratedChord, curr: GeneratedChord): number => {
            if (prev.numeral === curr.numeral) return 0;
            
            const prevRoot = prev.root % 12;
            const currRoot = curr.root % 12;
            const interval = (currRoot - prevRoot + 12) % 12;

            // Circle of fifths movement (e.g., V -> I, ii -> V) is very strong
            if (interval === 5 || interval === 7) return 3;
            
            // Stepwise movement (e.g., IV -> V)
            if (interval === 2 || interval === 10) return 1;
            
            // Chromatic descending (Tritone sub resolution)
            if (interval === 11) return 2;

            return -1; // Random jumps are penalized slightly
        };

        // Viterbi Initialization
        // dp[i][j] stores the max score up to chord i, choosing alternative j
        const dp: { score: number, prevAltIndex: number }[][] = [];
        const alternatives: GeneratedChord[][] = [];
        const borrowedStartIndices: number[] = []; // 每个 chord 位置的借调起始索引

        for (let i = 0; i < chords.length; i++) {
            const original = chords[i];
            const next = i < chords.length - 1 ? chords[i + 1] : null;
            const { alts, borrowedStartIndex } = getAlternatives(original, next);
            alternatives.push(alts);
            borrowedStartIndices.push(borrowedStartIndex);

            const melodyInSlot = melody.filter(n => n.onset >= original.startBeat && n.onset < original.endBeat);

            dp[i] = [];
            for (let j = 0; j < alts.length; j++) {
                const alt = alts[j];
                const emissionScore = getMelodyFitScore(alt, melodyInSlot);

                // 🌟 HC-5A: 借调和弦负偏差 — 只有旋律贴合度显著优��原和弦才会被选��
                const isBorrowed = j >= borrowedStartIndex;
                const borrowedPenalty = isBorrowed ? -3 : 0;

                if (i === 0) {
                    // Bias towards original chord for the first chord to establish key
                    const bias = j === 0 ? 5 : 0;
                    dp[i][j] = { score: emissionScore + bias + borrowedPenalty, prevAltIndex: -1 };
                } else {
                    let maxScore = -Infinity;
                    let bestPrevIndex = -1;

                    for (let k = 0; k < alternatives[i - 1].length; k++) {
                        const prevAlt = alternatives[i - 1][k];
                        const transScore = getTransitionScore(prevAlt, alt);
                        // Bias towards original chord to prevent over-reharmonization
                        const bias = j === 0 ? 2 : 0;
                        const score = dp[i - 1][k].score + transScore + emissionScore + bias + borrowedPenalty;

                        if (score > maxScore) {
                            maxScore = score;
                            bestPrevIndex = k;
                        }
                    }
                    dp[i][j] = { score: maxScore, prevAltIndex: bestPrevIndex };
                }
            }
        }

        // Backtracking
        const result: GeneratedChord[] = [];
        const resultIsBorrowed: boolean[] = [];
        let bestLastIndex = 0;
        let maxFinalScore = -Infinity;

        for (let j = 0; j < dp[chords.length - 1].length; j++) {
            if (dp[chords.length - 1][j].score > maxFinalScore) {
                maxFinalScore = dp[chords.length - 1][j].score;
                bestLastIndex = j;
            }
        }

        let currIndex = bestLastIndex;
        for (let i = chords.length - 1; i >= 0; i--) {
            result.unshift(alternatives[i][currIndex]);
            resultIsBorrowed.unshift(currIndex >= borrowedStartIndices[i]);
            currIndex = dp[i][currIndex].prevAltIndex;
        }

        // 🌟 HC-5B: 全曲借调上限 — 超出预算的借调和弦强制回退到原和弦
        // 默认全曲最多 2 个借调，作为"高光时刻"而非常态
        const maxBorrowed = style.harmonyRules?.maxBorrowedChords ?? 2;
        let borrowedCount = 0;
        for (let i = 0; i < result.length; i++) {
            if (resultIsBorrowed[i]) {
                borrowedCount++;
                if (borrowedCount > maxBorrowed) {
                    result[i] = chords[i]; // 超出预算，回退到原和弦
                }
            }
        }

        return result;
    }
}