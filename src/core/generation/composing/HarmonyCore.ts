import { globalPRNG } from '../../utils/PRNG';
import { GeneratedChord, SectionMetadata, StyleConfig, ChordProgression, NoteData } from '../types';
import { MusicTheoryRules, ChordFunction } from './MusicTheoryRules';
import { GlobalContext } from '../GlobalContext';

export class HarmonyCore {
    public static parseRomanNumeral(numeral: string, tonality: string = 'Major', isRelativeMinor: boolean = false) { 
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
        
        if (tonality === 'Minor' && !isRelativeMinor) {
            root += 3;
        }
        
        while(root < 0) root += 12; root %= 12;

        let quality: any = 'Major';
        if (isMinor) quality = 'Minor';
        if (isDim) quality = 'Diminished';
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

    // 🌟 平滑声部连接 (Voice Leading) & 现代 Voicing 理论
    // 根据上一个和弦的排列，计算当前和弦的最平滑排列（总移动距离最小）
    public static getSmoothVoicing(currentChord: GeneratedChord, prevVoicing: number[], targetCenter: number = 60, voicingStyle: string = 'standard'): number[] {
        // 获取当前和弦的所有基础音级 (Pitch Classes)
        const root = currentChord.root;
        let intervals = [0, 4, 7];
        let omit5th = false; // 是否允许省略五音
        
        const isJazz = voicingStyle === 'jazz' || voicingStyle === 'neo-soul';
        const isNeoSoul = voicingStyle === 'neo-soul';

        if (currentChord.quality === 'Minor') intervals = [0, 3, 7];
        else if (currentChord.quality === 'Diminished') intervals = [0, 3, 6];
        else if (currentChord.quality === 'Augmented') intervals = [0, 4, 8];
        else if (currentChord.quality === 'Add9') intervals = [0, 4, 7, 14];
        else if (currentChord.quality === 'Minor9') { intervals = [0, 3, 7, 10, 14]; omit5th = true; }
        else if (currentChord.quality === 'Dominant7') { intervals = [0, 4, 7, 10]; omit5th = true; }
        else if (currentChord.quality === 'Minor7') { intervals = [0, 3, 7, 10]; omit5th = true; }
        else if (currentChord.quality === 'Major7') { intervals = [0, 4, 7, 11]; omit5th = true; }
        else if (currentChord.quality === 'HalfDiminished') intervals = [0, 3, 6, 10]; // 减五度，不可省略
        else if (currentChord.quality === 'Sus4') intervals = [0, 5, 7];
        else if (currentChord.quality === 'Dominant7Sus4') { intervals = [0, 5, 7, 10]; omit5th = true; }

        // Neo-Soul Voicing Enhancements (5 over 1, 4 over 2, etc.)
        if (isNeoSoul) {
            if (currentChord.quality === 'Major7' || currentChord.quality === 'Add9') {
                // 5 over 1 for Maj9: Root, then V triad (7, 11, 14)
                intervals = [0, 7, 11, 14]; 
                omit5th = false; // We are using the 5th as the base of the upper structure
            } else if (currentChord.quality === 'Minor7' || currentChord.quality === 'Minor9') {
                // m11 voicing: Root, b3, b7, 9, 11 (0, 3, 10, 14, 17)
                intervals = [0, 3, 10, 14, 17];
                omit5th = true;
            } else if (currentChord.quality === 'Dominant7') {
                // Altered dominant or 13th for Neo-Soul
                if (globalPRNG.next() > 0.5) {
                    // 13th: Root, 3, b7, 9, 13 (0, 4, 10, 14, 21)
                    intervals = [0, 4, 10, 14, 21];
                } else {
                    // Altered (e.g., 7#9): Root, 3, b7, #9 (0, 4, 10, 15)
                    intervals = [0, 4, 10, 15];
                }
                omit5th = true;
            }
        }

        // 🌟 核心优化 1：省略五音 (Omit the 5th / Drop 5)
        // 如果是七和弦及以上，且五音是纯五度 (7)，高概率省略它，让声音更干净，避免 "Tanked" 浑浊感
        if (omit5th && globalPRNG.next() < 0.75 && !isNeoSoul) {
            intervals = intervals.filter(i => i !== 7);
        }

        // 爵士乐/高级和声：无根音排列 (Rootless Voicings)
        if (isJazz && intervals.length >= 3 && globalPRNG.next() > 0.3) {
            intervals = intervals.filter(i => i !== 0); // 移除根音，交由贝斯
            if (!isNeoSoul) {
                if (currentChord.quality === 'Dominant7' || currentChord.quality === 'Major7') {
                    if (!intervals.includes(14)) intervals.push(14); // Add 9th
                }
            }
        }

        const targetPcs = intervals.map(i => (root + i) % 12);
        const newVoicing: number[] = [];

        if (!prevVoicing || prevVoicing.length === 0) {
            // 如果没有前一个排列，生成一个默认的“底部发散，顶部密集”排列
            for (let i = 0; i < targetPcs.length; i++) {
                let oct = 4; // 默认 C4 附近
                if (i === 0 && !isJazz) oct = 3; // 根音放低一点
                newVoicing.push(targetPcs[i] + oct * 12);
            }
            return Array.from(new Set(newVoicing)).sort((a, b) => a - b);
        }

        // 🌟 核心优化 2：平滑声部连接 (Voice Leading) 仅针对上方色彩音
        for (const pc of targetPcs) {
            let bestPitch = pc;
            let minDistance = 999;

            // 检查几个可能的八度 (C3 到 C6)
            for (let oct = 3; oct <= 6; oct++) {
                const testPitch = pc + oct * 12;
                // 计算这个音高到上一个排列中所有音的最小距离
                for (const prevPitch of prevVoicing) {
                    const dist = Math.abs(testPitch - prevPitch);
                    if (dist < minDistance) {
                        minDistance = dist;
                        bestPitch = testPitch;
                    }
                }
            }
            newVoicing.push(bestPitch);
        }

        // 排序并去重
        return Array.from(new Set(newVoicing)).sort((a, b) => a - b);
    }
    public static getScalePitches(tonality: string): number[] {
        let intervals = [0, 2, 4, 5, 7, 9, 11]; 
        if (tonality === 'Minor') intervals = [0, 2, 3, 5, 7, 8, 10]; 
        if (tonality === 'Major_Pentatonic') intervals = [0, 2, 4, 7, 9];
        if (tonality === 'Minor_Pentatonic') intervals = [0, 3, 5, 7, 10];
        if (tonality === 'Blues') intervals = [0, 3, 5, 6, 7, 10];
        if (tonality === 'Dorian') intervals = [0, 2, 3, 5, 7, 9, 10];
        if (tonality === 'Mixolydian') intervals = [0, 2, 4, 5, 7, 9, 10];
        return intervals;
    }

    public static getSafeScalePitches(chord: GeneratedChord, tonality: string, globalRoot: number = 0): number[] {
        let intervals =[0, 2, 4, 5, 7, 9, 11]; 
        if (tonality === 'Minor') intervals =[0, 2, 3, 5, 7, 8, 10]; 
        if (tonality === 'Major_Pentatonic') intervals =[0, 2, 4, 7, 9];
        if (tonality === 'Minor_Pentatonic') intervals =[0, 3, 5, 7, 10];
        if (tonality === 'Blues') intervals =[0, 3, 5, 6, 7, 10];
        if (tonality === 'Dorian') intervals = [0, 2, 3, 5, 7, 9, 10];
        if (tonality === 'Mixolydian') intervals = [0, 2, 4, 5, 7, 9, 10];
        let scalePcs = intervals.map(i => (globalRoot + i) % 12);
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

        return Array.from(new Set([...scalePcs, ...chordTones])).sort((a,b)=>a-b);
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
    private static generateFromFunction(func: ChordFunction, originalChord: string, isFirstChord: boolean, styleId: string): string {
        const rand = globalPRNG.next();
        
        // 决定变异概率 (Mutation Rate)
        let mutationRate = 0.3; 
        if (styleId.toLowerCase().includes('jazz') || styleId.toLowerCase().includes('rnb') || styleId.toLowerCase().includes('bossa') || styleId.toLowerCase().includes('neo_soul')) mutationRate = 0.75;
        if (styleId.toLowerCase().includes('edm') || styleId.toLowerCase().includes('house')) mutationRate = 0.25; 
        if (styleId.toLowerCase().includes('jpop') || styleId.toLowerCase().includes('anime')) mutationRate = 0.6;
        if (styleId.toLowerCase().includes('pop') || styleId.toLowerCase().includes('cinematic')) mutationRate = 0.4;

        if (rand > mutationRate) return originalChord;

        const isMinorKey = GlobalContext.currentTonality === 'Minor';
        const roll = globalPRNG.next();

        // 命中变异概率，在同等和声功能 (T/S/D) 下进行概率游走
        if (func === 'Tonic') {
            if (isFirstChord) return globalPRNG.next() > 0.5 ? 'I' : 'vi'; 
            if (roll < 0.3) return 'I';
            if (roll < 0.55) return 'vi';
            if (roll < 0.75) return 'iii';
            // 🌟 调式互换 (Modal Interchange): 借用同主音小调的 bIII 或 bVI
            if (!isMinorKey) {
                return globalPRNG.next() > 0.5 ? 'bVI' : 'bIII';
            }
            return 'I';
        } else if (func === 'Subdominant') {
            if (roll < 0.4) return 'IV';
            if (roll < 0.65) return 'ii';
            // 🌟 调式互换 (Modal Interchange): 借用同主音小调的 iv 或 ii°
            if (!isMinorKey) {
                return globalPRNG.next() > 0.6 ? 'iv' : 'ii°';
            }
            return 'IV';
        } else if (func === 'Dominant') {
            if (roll < 0.4) return 'V';
            if (roll < 0.6) return 'III'; // 次属和弦 V/vi
            if (roll < 0.75) return 'II'; // 次属和弦 V/V
            if (roll < 0.85) return 'vii°';
            // 🌟 调式互换 (Modal Interchange): 借用同主音小调的 bVII (Backdoor dominant)
            if (!isMinorKey) {
                return 'bVII';
            }
            return 'V';
        }
        return originalChord;
    }

    // 🌟 核心算法 2：风格化和弦色彩附加 (Style-Specific Spices)
    private static applyStyleSpices(progression: string[], styleId: string): string[] {
        return progression.map((chord) => {
            const isJPop = styleId.toLowerCase().includes('jpop') || styleId.toLowerCase().includes('anime');
            const isJazz = styleId.toLowerCase().includes('jazz') || styleId.toLowerCase().includes('bossa') || styleId.toLowerCase().includes('rnb') || styleId.toLowerCase().includes('neo_soul');
            const isEDM = styleId.toLowerCase().includes('edm') || styleId.toLowerCase().includes('house') || styleId.toLowerCase().includes('electronic');
            
            // 提取纯净的罗马数字基底
            const base = chord.replace(/maj9|maj7|m7b5|dim7|dim|°|aug|sus4|m9|m7|9|7|b5|add9/g, '');
            const isMinor = base === base.toLowerCase();
            const isDiminished = chord.includes('°') || chord.includes('dim');
            
            const rand = globalPRNG.next();

            if (isJazz || isJPop) {
                if (rand < 0.8) { // 80% 概率加上浓郁的色彩音
                    if (isDiminished) return base + 'm7b5'; // 半减七和弦 (Half-diminished) 是爵士常用
                    if (!isMinor && (base === 'I' || base === 'IV' || base === 'bVI' || base === 'bIII')) return rand > 0.5 ? base + 'maj7' : base + 'maj9';
                    if (!isMinor && base === 'bVII') return rand > 0.5 ? base + '7' : base + '9'; // Backdoor dominant
                    if (isMinor && (base === 'ii' || base === 'iii' || base === 'vi' || base === 'iv')) return rand > 0.5 ? base + 'm7' : base + 'm9';
                    if (base === 'V' || base === 'III' || base === 'VI' || base === 'II') {
                        // 属和弦或次属和弦
                        if (rand < 0.3) return base + 'sus4';
                        if (rand < 0.6) return base + '7';
                        return base + '9'; // 增加 9 音
                    }
                    if (base === 'vii') return base + 'm7b5';
                }
            } else if (isEDM) {
                if (rand < 0.6) { 
                    if (!isMinor && (base === 'I' || base === 'IV' || base === 'bVI')) return base + 'add9';
                    if (isMinor && (base === 'vi' || base === 'ii' || base === 'iv')) return base + 'm7';
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
    private static generateDynamicProgression(pool: string[][], fallback: string[], styleId: string): string[] {
        const baseProgression = pool && pool.length > 0 ? pool[Math.floor(globalPRNG.next() * pool.length)] : fallback;
        
        // 1. 提取功能骨架 (Extract Functional Flow)
        const functionalFlow = baseProgression.map(chord => ({
            original: chord,
            func: MusicTheoryRules.getChordFunction(chord)
        }));

        // 2. 概率替换 (Probabilistic Substitution)
        const newProgression = functionalFlow.map((item, index) => {
            return this.generateFromFunction(item.func, item.original, index === 0, styleId);
        });

        // 3. 附加风格色彩 (Apply Style Spices)
        return this.applyStyleSpices(newProgression, styleId);
    }

    public static generateHarmonyTimeline(sections: SectionMetadata[], style: StyleConfig, timeSignature:[number, number]): GeneratedChord[] {
        const timeline: GeneratedChord[] = [];
        const beatsPerBar = timeSignature[0];

        // 1. Global Chord Planning (全局和弦规划)
        const globalPlan: { [type: string]: string[] } = {};
        
        // 决定是全曲共用一套和弦 (Global Progression) 还是不同段落不同和弦
        const isEDM = style.id.toLowerCase().includes('house') || style.id.toLowerCase().includes('edm') || style.id.toLowerCase().includes('electronic');
        const isGlobalProgression = isEDM ? globalPRNG.next() < 0.9 : globalPRNG.next() < 0.2; // 90% 概率全曲共用一套和弦 (EDM特质)

        // EDM 神级和弦进行池
        const edmProgressionPool = [
            ['vi', 'IV', 'I', 'V'], // 神级经典
            ['I', 'V', 'vi', 'IV'], // uplifting 标配
            ['I', 'vi', 'ii', 'IV'], // 柔和空灵
            ['i', 'v', 'bVI', 'IV'], // 偏暗黑深邃 (使用 bVI 适配小调)
            ['I', 'IV', 'vi', 'V'], // 极简催眠
            ['vi', 'ii', 'V', 'I']  // 高级感
        ];

        if (isGlobalProgression) {
            const poolToUse = isEDM ? edmProgressionPool : style.harmony.chorusPool;
            const masterProgression = this.generateDynamicProgression(poolToUse, ['I', 'V', 'vi', 'IV'], style.id);
            globalPlan['Chorus'] = masterProgression;
            globalPlan['Verse'] = masterProgression;
            globalPlan['PreChorus'] = masterProgression;
            globalPlan['Break'] = masterProgression;
            globalPlan['Outro'] = masterProgression;
            globalPlan['Intro'] = masterProgression;
        } else {
            // 为每种段落类型抽取唯一的和弦进行，确保全曲一致性 (例如 Verse 1 和 Verse 2 使用相同的和弦)
            const chorusPool = isEDM ? edmProgressionPool : style.harmony.chorusPool;
            const versePool = isEDM ? edmProgressionPool : style.harmony.versePool;
            const preChorusPool = isEDM ? edmProgressionPool : style.harmony.preChorusPool;
            
            globalPlan['Chorus'] = this.generateDynamicProgression(chorusPool, ['I', 'V', 'vi', 'IV'], style.id);
            globalPlan['Verse'] = this.generateDynamicProgression(versePool, ['I', 'vi', 'IV', 'V'], style.id);
            globalPlan['PreChorus'] = this.generateDynamicProgression(preChorusPool, ['ii', 'V', 'I', 'vi'], style.id);
            globalPlan['Break'] = this.generateDynamicProgression([['vi', 'IV', 'I', 'V'], ['ii', 'vi', 'IV', 'I']], ['vi', 'IV', 'I', 'V'], style.id);
            globalPlan['Outro'] = this.generateDynamicProgression([['I', 'vi', 'IV', 'I'], ['I', 'IV', 'V', 'I'], ['I', 'I', 'I', 'I'], ['V', 'I']], ['I', 'vi', 'IV', 'I'], style.id);
            globalPlan['Intro'] = globalPlan['Verse']; // Intro 通常使用 Verse 的和弦
        }

        // 2. Generate Timeline
        const sectionTypeCounts: { [type: string]: number } = {};

        sections.forEach((section, sectionIndex) => {
            let baseProgression: string[];
            let sectionType = 'Verse';
            if (section.name.includes('Chorus')) sectionType = 'Chorus';
            else if (section.name.includes('Pre')) sectionType = 'PreChorus';
            else if (section.name.includes('Break')) sectionType = 'Break';
            else if (section.name.includes('Outro')) sectionType = 'Outro';
            else if (section.name.includes('Intro')) sectionType = 'Intro';

            baseProgression = globalPlan[sectionType];
            
            // 🌟 Phase 1: Save base progression to decoupled state
            if (section.harmony) {
                section.harmony.baseProgression = [...baseProgression];
            }
            
            // 记录该类型段落出现的次数
            sectionTypeCounts[sectionType] = (sectionTypeCounts[sectionType] || 0) + 1;
            const appearanceCount = sectionTypeCounts[sectionType];

            // 允许同类型段落的变体 (例如 Verse 2 可以是 Verse 1 的微调，这里先保持完全一致，后续可扩展 Re-harmonization)
            let progression = [...baseProgression]; 
            
            // 🌟 核心：替代和弦 (Chord Substitution)
            // 如果是该类型段落的第 2 次或以上出现 (例如 Verse 2, Chorus 2)，有概率进行和弦替换，增加变化
            const reharmProb = style.harmonyRules?.reharmProbability ?? 0.3;
            const borrowedChords = style.harmonyRules?.borrowedChords ?? [];
            if (appearanceCount > 1 && !isGlobalProgression) {
                progression = progression.map(numeral => {
                    if (globalPRNG.next() < reharmProb) { 
                        const subs = MusicTheoryRules.getSubstitution(numeral, borrowedChords);
                        if (subs.length > 0) {
                            return subs[Math.floor(globalPRNG.next() * subs.length)];
                        }
                    }
                    return numeral;
                });
            }
            
            const isRelativeMinor = progression.some(numeral => {
                let clean = numeral;
                if (clean.startsWith('b') || clean.startsWith('#')) clean = clean.substring(1);
                const base = clean.replace(/maj7|m7b5|dim7|dim|°|aug|sus4|m7|7|b5|m9|add9/g, '');
                return base === 'i' || base === 'iv' || base === 'v';
            });

            let currentBeat = section.startBeat;
            const totalBars = (section.endBeat - section.startBeat) / beatsPerBar;
            const loops = Math.ceil(totalBars / progression.length);
            
            let barsGenerated = 0;
            for (let i = 0; i < loops; i++) {
                for (let j = 0; j < progression.length; j++) {
                    if (barsGenerated >= totalBars) break;
                    
                    let numeral = progression[j];
                    const isEndOfPhrase = (j === progression.length - 1); 
                    const isEndOfSection = (barsGenerated === totalBars - 1);

                    // 🌟 尾奏最后两小节强制和声解决 (Forced Harmonic Resolution)
                    if (section.endingType === 'hard_stop') {
                        // Hard Stop: 整个段落保持在一级和弦 (I)
                        numeral = 'I';
                    } else if (section.name.includes('Outro') && barsGenerated >= totalBars - 2) {
                        if (barsGenerated === totalBars - 2) {
                            // 倒数第二小节：强制走下属或属和弦 (IV 或 V)
                            numeral = globalPRNG.next() > 0.5 ? 'IV' : 'V';
                        } else if (barsGenerated === totalBars - 1) {
                            // 最后一小节：强制回到主和弦 I
                            numeral = 'I';
                        }
                    }

                    // 🌟 核心：经过和弦变异 (Passing Chord Mutation) & 段落过渡 (Section Transition)
                    const isEmotionalCore = section.name.includes('Intro') || section.name.includes('Outro');
                    const allowMutation = !isEmotionalCore; // 允许在 Verse, PreChorus, Chorus 中变异，增加和声推动力

                    // 决定下一个目标和弦，用于计算经过和弦
                    let nextNumeral = 'I';
                    if (!isEndOfSection && j + 1 < progression.length) {
                        nextNumeral = progression[j + 1];
                    } else if (!isEndOfSection && j + 1 >= progression.length) {
                        nextNumeral = progression[0]; // 循环回开头
                    } else if (isEndOfSection && sectionIndex + 1 < sections.length) {
                        // 段落交界处，寻找下一个段落的第一个和弦
                        const nextSection = sections[sectionIndex + 1];
                        let nextSecProg: string[];
                        if (nextSection.name.includes('Chorus')) nextSecProg = globalPlan['Chorus'];
                        else if (nextSection.name.includes('Pre')) nextSecProg = globalPlan['PreChorus'];
                        else if (nextSection.name.includes('Break')) nextSecProg = globalPlan['Break'];
                        else if (nextSection.name.includes('Outro')) nextSecProg = globalPlan['Outro'];
                        else if (nextSection.name.includes('Intro')) nextSecProg = globalPlan['Intro'];
                        else nextSecProg = globalPlan['Verse'];
                        nextNumeral = nextSecProg[0];
                    }

                    // 🌟 EDM 色彩附加 (Chord Extensions for EDM)
                    if (isEDM && globalPRNG.next() < 0.4) {
                        if (numeral === 'I' || numeral === 'IV') {
                            numeral = globalPRNG.next() > 0.5 ? numeral + 'add9' : numeral + 'maj7';
                        } else if (numeral === 'vi' || numeral === 'ii' || numeral === 'iii') {
                            numeral = globalPRNG.next() > 0.5 ? numeral + 'm7' : numeral + 'm9';
                        } else if (numeral === 'V' && section.name.includes('Build')) {
                            numeral = 'Vsus4'; // Build-up tension
                        }
                    }

                    // 如果允许变异，且在句尾或段落尾，有概率插入经过和弦
                    const passingChordsAllowed = style.harmonyRules?.passingChords ?? ['SecondaryDominant', 'Diminished7'];
                    const allowTritoneSub = style.harmonyRules?.allowTritoneSub ?? false;

                    if (allowMutation && (isEndOfPhrase || isEndOfSection) && globalPRNG.next() < 0.5 && beatsPerBar >= 3 && passingChordsAllowed.length > 0) {
                        const parsedMain = HarmonyCore.parseRomanNumeral(numeral, GlobalContext.currentTonality, isRelativeMinor);
                        
                        let passingBeats = 1; 
                        if (beatsPerBar === 4) passingBeats = 2; 
                        else if (beatsPerBar === 6) passingBeats = 2; 
                        else if (beatsPerBar === 8) passingBeats = 4; 
                        
                        const mainBeats = beatsPerBar - passingBeats;

                        timeline.push({ 
                            numeral, root: parsedMain.root, quality: parsedMain.quality, 
                            startBeat: currentBeat, endBeat: currentBeat + mainBeats 
                        });
                        
                        // 计算经过和弦 (Secondary Dominant or Leading Tone)
                        let passingNumeral = 'V'; 
                        const passingType = passingChordsAllowed[Math.floor(globalPRNG.next() * passingChordsAllowed.length)];

                        if (passingType === 'SecondaryDominant' || passingType === 'Diminished7' || passingType === 'DescendingDiminished' || (passingType === 'TritoneSub' && allowTritoneSub)) {
                            passingNumeral = MusicTheoryRules.getPassingChord(nextNumeral, passingType as any) || (globalPRNG.next() > 0.5 ? 'V7' : 'vii°');
                        } else {
                            passingNumeral = globalPRNG.next() > 0.5 ? 'V7' : 'vii°';
                        }

                        const parsedPassing = HarmonyCore.parseRomanNumeral(passingNumeral, GlobalContext.currentTonality, isRelativeMinor);
                        timeline.push({ 
                            numeral: passingNumeral, root: parsedPassing.root, quality: parsedPassing.quality, 
                            startBeat: currentBeat + mainBeats, endBeat: currentBeat + beatsPerBar 
                        });
                    } else {
                        // 常规不发生变异
                        const parsed = HarmonyCore.parseRomanNumeral(numeral, GlobalContext.currentTonality, isRelativeMinor);
                        timeline.push({ 
                            numeral, root: parsed.root, quality: parsed.quality, 
                            startBeat: currentBeat, endBeat: currentBeat + beatsPerBar 
                        });
                    }
                    
                    currentBeat += beatsPerBar;
                    barsGenerated++;
                }
            }
        });
        return timeline;
    }

    public static reharmonize(chords: GeneratedChord[], melody: NoteData[], style: StyleConfig): GeneratedChord[] {
        if (!style.harmonyRules || style.harmonyRules.reharmProbability === 0) return chords;
        
        // Viterbi-like dynamic programming for reharmonization
        // State space: for each original chord, we consider a few alternatives (substitutions).
        // We want to find the sequence of chords that maximizes the score (melody fit + transition logic).
        
        const getAlternatives = (original: GeneratedChord, next: GeneratedChord | null): GeneratedChord[] => {
            const alts = [original];
            const parsed = HarmonyCore.parseRomanNumeral(original.numeral);
            
            // 1. Relative Minor/Major substitution (e.g., Cmaj7 <-> Am7)
            const relativeMap: Record<string, string> = {
                'Imaj7': 'vi7', 'vi7': 'Imaj7',
                'IVmaj7': 'ii7', 'ii7': 'IVmaj7',
                'V7': 'vii°', 'vii°': 'V7'
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
                    // Only use it if it's not the same as the original
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

            return alts;
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

        for (let i = 0; i < chords.length; i++) {
            const original = chords[i];
            const next = i < chords.length - 1 ? chords[i + 1] : null;
            const alts = getAlternatives(original, next);
            alternatives.push(alts);
            
            const melodyInSlot = melody.filter(n => n.onset >= original.startBeat && n.onset < original.endBeat);
            
            dp[i] = [];
            for (let j = 0; j < alts.length; j++) {
                const alt = alts[j];
                const emissionScore = getMelodyFitScore(alt, melodyInSlot);
                
                if (i === 0) {
                    // Bias towards original chord for the first chord to establish key
                    const bias = j === 0 ? 5 : 0;
                    dp[i][j] = { score: emissionScore + bias, prevAltIndex: -1 };
                } else {
                    let maxScore = -Infinity;
                    let bestPrevIndex = -1;
                    
                    for (let k = 0; k < alternatives[i - 1].length; k++) {
                        const prevAlt = alternatives[i - 1][k];
                        const transScore = getTransitionScore(prevAlt, alt);
                        // Bias towards original chord to prevent over-reharmonization
                        const bias = j === 0 ? 2 : 0; 
                        const score = dp[i - 1][k].score + transScore + emissionScore + bias;
                        
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
            currIndex = dp[i][currIndex].prevAltIndex;
        }

        return result;
    }
}