import { globalPRNG } from '../../utils/PRNG';
import { NoteData, GeneratedChord, SectionMetadata, StyleConfig, SingerPersonaConfig } from '../types';
import { HarmonyCore } from './HarmonyCore';
import { GrooveEngine } from './GrooveEngine';
import { SingerPersona } from '../performance/SingerPersona';
import { GlobalContext } from '../GlobalContext'; 
import { getRandomRhythmCell } from '../melody/RhythmCells';

type Contour = 'Ascending' | 'Descending' | 'Arch' | 'Bowl' | 'Static' | 'Wandering';
type PhraseForm = string[]; // e.g., ['A', 'A', 'B', 'A']

interface MotifTemplate {
    rhythmOffsets: number[];
    contour: Contour;
    noteCount: number;
    phraseLengthBeats: number;
}

export class ToplineEngine {
    
    public static generateTrackMelody(
        sections: SectionMetadata[], chords: GeneratedChord[], style: StyleConfig, 
        tonality: string, persona: SingerPersonaConfig, instrumentName: string = 'Acoustic_Grand',
        userMotif?: NoteData[]
    ): NoteData[] {
        const fullMelody: NoteData[] = [];
        const beatsPerBar = GlobalContext.currentTimeSignature[0];

        // 🌟 Phase 1: Global Groove Strategy (Now decoupled per section)
        const verseDensityMult = style.contrast.verseDensityMultiplier || 1.0;
        
        sections.forEach(section => {
            // Use decoupled groove parameters from section
            const density = section.groove?.density ?? 0.5;
            const syncopationProb = section.groove?.syncopationProb ?? 0.2;
            
            section.grooveDNA = GrooveEngine.generateRhythmFingerprint(
                density,
                syncopationProb,
                beatsPerBar,
                userMotif
            );
        });

        // 🌟 Phase 2: Chorus Motif Extraction
        const chorusMotifs = new Map<string, MotifTemplate>();
        const firstChorus = sections.find(s => s.name.includes('Chorus'));
        if (firstChorus) {
            const chorusChords = chords.filter(c => c.startBeat >= firstChorus.startBeat && c.startBeat < firstChorus.endBeat);
            if (chorusChords.length === 0) chorusChords.push(chords[0]);
            // Generate motifs only, don't realize notes yet
            const result = this.generateSectionMelody(firstChorus, chorusChords, style, tonality, persona, instrumentName, beatsPerBar, userMotif, undefined, null, true);
            result.motifs.forEach((val, key) => chorusMotifs.set(key, val));
        }

        // 🌟 Phase 3: Chronological Generation with Pitch Continuity
        const sectionMelodies = new Map<number, NoteData[]>();
        let currentPreviousPitch: number | null = null;
        let globalUnresolvedCount = 0; // 🌟 新增：跨段落追踪未解决的乐句数量

        sections.forEach((section, index) => {
            let providedMotifs: Map<string, MotifTemplate> | undefined = undefined;
            
            if (section.name.includes('Chorus')) {
                // Reuse the motifs we extracted
                providedMotifs = chorusMotifs;
            } else if (chorusMotifs.size > 0 && (section.name.includes('Verse') || section.name.includes('PreChorus'))) {
                // 🌟 修复：不再强制让主歌复用副歌的全部动机，恢复旋律的多样性
                // 只在有概率的情况下，让主歌的 A 动机复用副歌的 A 动机（降级版），其余动机重新生成
                // 增加复用概率，增强连贯性 (从 0.3 提升到 0.5)
                if (globalPRNG.next() < 0.5) { 
                    providedMotifs = new Map<string, MotifTemplate>();
                    const motifA = chorusMotifs.get('A');
                    if (motifA) {
                        const sectionDensity = section.groove?.density ?? 0.5;
                        providedMotifs.set('A', this.downgradeMotif(motifA, section.name, sectionDensity));
                    }
                }
            }

            const sectionChords = chords.filter(c => c.startBeat >= section.startBeat && c.startBeat < section.endBeat);
            if (sectionChords.length === 0) sectionChords.push(chords[0]);

            const result = this.generateSectionMelody(section, sectionChords, style, tonality, persona, instrumentName, beatsPerBar, userMotif, providedMotifs, currentPreviousPitch, false, globalUnresolvedCount);
            
            sectionMelodies.set(index, result.notes);
            currentPreviousPitch = result.lastPitch; // Pass the last pitch to the next section!
            globalUnresolvedCount = result.unresolvedCount; // 更新未解决计数
        });

        // Assemble full melody in order
        sections.forEach((section, index) => {
            const notes = sectionMelodies.get(index);
            if (notes) {
                fullMelody.push(...notes);
            }
        });

        return fullMelody;
    }

    private static transformMotif(motif: MotifTemplate, transform: { isInv?: boolean, isRet?: boolean, isAug?: boolean }): MotifTemplate {
        let { rhythmOffsets, contour, noteCount, phraseLengthBeats } = motif;

        if (transform.isInv) {
            const invMap: Record<Contour, Contour> = {
                'Ascending': 'Descending',
                'Descending': 'Ascending',
                'Arch': 'Bowl',
                'Bowl': 'Arch',
                'Static': 'Static',
                'Wandering': 'Wandering'
            };
            contour = invMap[contour];
        }

        if (transform.isRet) {
            if (rhythmOffsets.length > 0) {
                const lastOffset = rhythmOffsets[rhythmOffsets.length - 1];
                rhythmOffsets = rhythmOffsets.map(r => lastOffset - r).reverse();
            }
            const retMap: Record<Contour, Contour> = {
                'Ascending': 'Descending',
                'Descending': 'Ascending',
                'Arch': 'Arch',
                'Bowl': 'Bowl',
                'Static': 'Static',
                'Wandering': 'Wandering'
            };
            contour = retMap[contour];
        }

        if (transform.isAug) {
            // 节奏放大 (Rhythmic Augmentation)
            rhythmOffsets = rhythmOffsets.map(r => r * 2.0).filter(r => r < phraseLengthBeats);
            
            // 如果放大后音符太少（比如只有一个），尝试在中间插入一个音
            if (rhythmOffsets.length === 1 && phraseLengthBeats > 2) {
                rhythmOffsets.push(rhythmOffsets[0] + 1.0);
            }
            
            noteCount = rhythmOffsets.length;
        }

        return { rhythmOffsets, contour, noteCount, phraseLengthBeats };
    }

    private static downgradeMotif(motif: MotifTemplate, sectionName: string, density: number): MotifTemplate {
        let newRhythm = [...motif.rhythmOffsets];
        let newContour = motif.contour;

        if (sectionName.includes('Verse')) {
            // Sparser rhythm: drop some off-beats
            newRhythm = newRhythm.filter(r => {
                if (r % 1 === 0) return true; // keep downbeats
                return globalPRNG.next() < density; // drop some off-beats based on density
            });
            if (newRhythm.length === 0) newRhythm.push(0);
            
            // Keep the same contour to maintain melodic identity, 
            // but the sparser rhythm will naturally make it feel calmer.
        } else if (sectionName.includes('PreChorus')) {
            // Build-up contour
            newContour = 'Ascending';
        }

        return {
            rhythmOffsets: newRhythm,
            contour: newContour,
            noteCount: newRhythm.length,
            phraseLengthBeats: motif.phraseLengthBeats
        };
    }

    private static generateSectionMelody(
        section: SectionMetadata, chords: GeneratedChord[], style: StyleConfig, 
        tonality: string, persona: SingerPersonaConfig, instrumentName: string,
        beatsPerBar: number, userMotif?: NoteData[],
        providedMotifs?: Map<string, MotifTemplate>,
        incomingPreviousPitch: number | null = null,
        generateMotifsOnly: boolean = false,
        incomingUnresolvedCount: number = 0
    ): { notes: NoteData[], motifs: Map<string, MotifTemplate>, lastPitch: number | null, unresolvedCount: number } {
        const sectionDensity = section.groove?.density ?? 0.5;
        const sectionSyncopation = section.groove?.syncopationProb ?? 0.2;
        
        // 🌟 修复：如果主奏乐器不是人声，说明这是一首纯器乐曲，主旋律应该具有 Solo 的表现力
        const isInstrumental = !instrumentName.includes('Voice') && !instrumentName.includes('Choir') && !instrumentName.includes('Vocal');
        let isSolo = isInstrumental; 
        
        let isIntro = false;
        let isOutro = false;
        
        let pitchOffset = style.contrast.versePitchOffset;

        if (section.name.includes('Chorus')) {
            pitchOffset = style.contrast.chorusPitchOffset || 5;
        } else if (section.name.includes('Solo')) {
            pitchOffset = 12;  
            isSolo = true; 
        } else if (section.name.includes('Intro')) {
            pitchOffset = 12;
            isIntro = true;
            // 🌟 如果是人声（非器乐），则在前奏期间不唱歌
            if (!isInstrumental) {
                return { notes: [], motifs: new Map(), lastPitch: null, unresolvedCount: incomingUnresolvedCount };
            }
        } else if (section.name.includes('Outro')) {
            pitchOffset = 12;
            isOutro = true;
        } else if (section.name.includes('Break')) {
            pitchOffset = 0;
        }

        const sectionGroove = section.grooveDNA || GrooveEngine.generateRhythmFingerprint(sectionDensity, sectionSyncopation, beatsPerBar, userMotif);
        // 🌟 修复：将生成的 groove 保存回 section，确保 Orchestrator 生成伴奏时使用完全相同的律动骨架！
        section.grooveDNA = sectionGroove;
        GlobalContext.updateCurrentSlice(section, chords[0], sectionGroove);

        const melodyGroove = GrooveEngine.generateInverseGroove(sectionGroove, beatsPerBar, sectionDensity);

        const secStart = section.startBeat;
        const sectionMelody: NoteData[] = [];
        let currentPreviousPitch = incomingPreviousPitch;
        
        // 🌟 戛然而止 (Hard Stop) 逻辑：只在第一拍弹奏一个强有力的主音，然后结束
        if (section.endingType === 'hard_stop') {
            const firstChord = chords[0];
            const rootPitch = HarmonyCore.getChordTones(firstChord, 60)[0];
            const pitch = rootPitch + pitchOffset;
            sectionMelody.push({
                pitch: pitch,
                onset: secStart,
                duration: beatsPerBar * 2, // 延音两小节
                velocity: 1.0 // 强力度
            });
            return { notes: sectionMelody, motifs: new Map(), lastPitch: pitch, unresolvedCount: 0 };
        }

        let motifUsage: 'None' | 'LiteralRiff' | 'RhythmOnly' | 'BrokenDown' = 'None';
        if (userMotif && userMotif.length > 0) {
            if (section.name.includes('Intro')) {
                motifUsage = 'LiteralRiff';
            } else if (section.name.includes('Chorus')) {
                motifUsage = 'LiteralRiff';
            } else if (section.name.includes('Verse')) {
                motifUsage = globalPRNG.next() > 0.5 ? 'BrokenDown' : 'RhythmOnly';
            } else {
                motifUsage = 'None';
            }
        }

        if (motifUsage === 'LiteralRiff' && userMotif) {
            if (generateMotifsOnly) {
                return { notes: [], motifs: new Map(), lastPitch: null, unresolvedCount: incomingUnresolvedCount };
            }

            let maxMotifOnset = 0;
            userMotif.forEach(n => { if (n.onset > maxMotifOnset) maxMotifOnset = n.onset; });
            const motifLengthBeats = Math.ceil((maxMotifOnset + 1) / beatsPerBar) * beatsPerBar;
            let currentBeat = secStart;
            
            const octaveOffset = Math.round(pitchOffset / 12) * 12;

            while (currentBeat + motifLengthBeats <= section.endBeat) {
                userMotif.forEach(n => {
                    const onset = currentBeat + n.onset;
                    const activeChord = chords.find(c => onset >= c.startBeat && onset < c.endBeat) || chords[0];
                    
                    let pitch = n.pitch + octaveOffset;
                    
                    // 🌟 优化方向 2：和声宽容度 (Dissonance Tolerance)
                    // 判断是否在强拍 (距离 0.5 拍的网格点很近，例如 0, 0.5, 1.0, 1.5...)
                    const beatOffset = onset % 0.5;
                    const isStrongBeat = beatOffset < 0.1 || beatOffset > 0.4;
                    
                    // Skip snapToScale to preserve the exact user motif
                    
                    sectionMelody.push({
                        ...n,
                        onset: onset,
                        pitch: pitch,
                        isUserMotif: true
                    });
                });
                currentBeat += motifLengthBeats;
            }
            const humanizedMelody = SingerPersona.apply(sectionMelody, persona, chords, instrumentName);
            
            let lastPitch = currentPreviousPitch;
            if (humanizedMelody.length > 0) {
                lastPitch = humanizedMelody[humanizedMelody.length - 1].pitch;
            }
            
            return { notes: humanizedMelody, motifs: new Map(), lastPitch, unresolvedCount: 0 };
        }

        const FORMS: PhraseForm[] = [
            ['A', 'A_prime', 'B', 'A_prime'],
            ['A', 'B', 'A', 'C'],
            ['A', 'A_prime', 'B', 'C'],
            ['A', 'B', 'A_prime', 'B_prime'],
            // 🌟 Advanced Motif Development Forms
            ['A', 'A_seq', 'B', 'A_prime'],
            ['A', 'A_inv', 'B', 'A_prime'],
            ['A', 'B', 'A_ret', 'C'],
            ['A', 'A_prime', 'B', 'B_aug']
        ];
        // 只有真正的 Solo 段落才使用完全不重复的自由发展形式，器乐主歌/副歌依然需要结构感
        const isActualSoloSection = section.name.includes('Solo');
        const form = isActualSoloSection ? ['A','A_seq','B','B_seq','C','C_inv','D','D_aug'] : FORMS[Math.floor(globalPRNG.next() * FORMS.length)];
        
        const possibleLengths = [beatsPerBar, beatsPerBar * 2];
        const phraseLength = possibleLengths[Math.floor(globalPRNG.next() * possibleLengths.length)];
        const totalPhrases = Math.floor((section.endBeat - section.startBeat) / phraseLength);

        const motifs = new Map<string, MotifTemplate>();
        if (providedMotifs) {
            providedMotifs.forEach((val, key) => motifs.set(key, val));
        }

        let consecutiveUnresolved = incomingUnresolvedCount; // 🌟 新增：追踪连续未解决的乐句数量

        for (let phraseIdx = 0; phraseIdx < totalPhrases; phraseIdx++) {
            const phraseLabel = form[phraseIdx % form.length];
            const baseLabel = phraseLabel.split('_')[0]; 
            let isAnswer = phraseLabel.includes('prime') || phraseLabel === 'C' || phraseIdx === totalPhrases - 1;
            
            let forceStrongResolution = false;
            // 🌟 智能解决机制：如果连续 2 句（或跨段落累积）没有解决，强制当前句进行强解决
            if (!isAnswer) {
                if (consecutiveUnresolved >= 2) {
                    isAnswer = true;
                    forceStrongResolution = true; // 强制回到根音或五音
                }
            }

            if (isAnswer) {
                consecutiveUnresolved = 0;
            } else {
                consecutiveUnresolved++;
            }

            const isSeq = phraseLabel.includes('seq');
            const isInv = phraseLabel.includes('inv');
            const isRet = phraseLabel.includes('ret');
            const isAug = phraseLabel.includes('aug');

            if (!motifs.has(baseLabel)) {
                // 🌟 Vocal Adjustment: Lower note density for vocals
                const densityMultiplier = isSolo ? 1.8 : 1.0; 
                const avgNotesPerBeat = densityMultiplier * sectionDensity; 
                let minNotes = Math.max(isOutro ? 1 : 3, Math.floor(phraseLength * avgNotesPerBeat * 0.6)); 
                let maxNotes = Math.max(minNotes + 1, Math.floor(phraseLength * avgNotesPerBeat * 1.5));
                
                if (isIntro) {
                    minNotes = Math.max(3, Math.floor(minNotes * 0.8));
                    maxNotes = Math.max(minNotes + 1, Math.floor(maxNotes * 0.8));
                }
                
                const noteCount = Math.floor(globalPRNG.next() * (maxNotes - minNotes + 1)) + minNotes;
                
                let contours: Contour[] = ['Ascending', 'Descending', 'Arch', 'Bowl', 'Static', 'Wandering'];
                
                if (isOutro) {
                    const isHopeful = globalPRNG.next() > 0.5;
                    if (isHopeful) {
                        contours = ['Ascending', 'Arch']; 
                    } else {
                        contours = ['Descending', 'Bowl', 'Static']; 
                    }
                }

                const contour = contours[Math.floor(globalPRNG.next() * contours.length)];

                let rhythmOffsets = this.generateMotifRhythm(melodyGroove, noteCount, phraseLength, sectionDensity, (isIntro || isOutro) && phraseIdx === 0, !isSolo);
                
                if (userMotif && (motifUsage === 'RhythmOnly' || motifUsage === 'BrokenDown') && baseLabel === 'A') {
                    let motifRhythm = userMotif.map(n => n.onset);
                    if (motifUsage === 'BrokenDown') {
                        const halfLength = Math.ceil(motifRhythm.length / 2);
                        motifRhythm = motifRhythm.slice(0, halfLength);
                    }
                    motifRhythm = motifRhythm.filter(onset => onset < phraseLength);
                    if (motifRhythm.length > 0) {
                        rhythmOffsets = motifRhythm;
                    }
                }

                motifs.set(baseLabel, { rhythmOffsets, contour, noteCount: rhythmOffsets.length, phraseLengthBeats: phraseLength });
            }

            if (generateMotifsOnly) continue;

            let template = motifs.get(baseLabel)!;
            
            // 🌟 Apply Advanced Motif Transformations
            if (isInv || isRet || isAug) {
                template = this.transformMotif(template, { isInv, isRet, isAug });
            }

            // 🌟 提出-解决 (Call and Response) Contour Logic
            let currentContour = template.contour;
            if (isAnswer && !isInv && !isRet) {
                // 解决 (Response): 倾向于下行或平稳解决
                if (currentContour === 'Ascending') currentContour = 'Arch'; // 上行后下行解决
                else if (currentContour === 'Arch') currentContour = 'Descending';
                else if (currentContour === 'Wandering') currentContour = 'Descending';
                template = { ...template, contour: currentContour };
            } else if (!isAnswer && !isInv && !isRet) {
                // 提出 (Call): 倾向于上扬或悬念
                if (currentContour === 'Descending') currentContour = 'Bowl'; // 下行后上扬提问
                else if (currentContour === 'Static') currentContour = 'Ascending';
                else if (currentContour === 'Bowl') currentContour = 'Ascending';
                template = { ...template, contour: currentContour };
            }

            const phraseStart = secStart + (phraseIdx * phraseLength);
            
            let currentPitchShift = pitchOffset;
            if (isSeq) {
                // Sequence: Shift pitch center up or down
                const shiftOptions = [2, 4, 5, 7, -2, -4, -5, -7]; // Diatonic steps roughly (M2, M3, P4, P5)
                currentPitchShift += shiftOptions[Math.floor(globalPRNG.next() * shiftOptions.length)];
            }

            const isLastPhraseOfIntro = isIntro && phraseIdx === totalPhrases - 1;
            const phraseResult = this.realizeMotif(template, phraseStart, chords, tonality, isAnswer, currentPitchShift, isSolo, instrumentName, isLastPhraseOfIntro, section.lofiEffect, section.name, style, currentPreviousPitch, forceStrongResolution);
            
            currentPreviousPitch = phraseResult.lastPitch;
            const phraseNotes = phraseResult.notes;
            
            if (isOutro) {
                const fadeOutFactor = 1.0 - (phraseIdx / totalPhrases) * 0.6; 
                phraseNotes.forEach(n => n.velocity *= fadeOutFactor);
            }
            
            sectionMelody.push(...phraseNotes);
        }

        if (generateMotifsOnly) {
            return { notes: [], motifs, lastPitch: null, unresolvedCount: consecutiveUnresolved };
        }

        if (section.name.includes('Chorus') && sectionMelody.length > 0) {
            let maxPitch = -1;
            sectionMelody.forEach(n => {
                if (n.pitch > maxPitch) maxPitch = n.pitch;
            });

            const maxNotes = sectionMelody.filter(n => n.pitch === maxPitch);
            if (maxNotes.length > 1) {
                maxNotes.sort((a, b) => {
                    const aStrong = a.onset % 1 === 0 ? 1 : 0;
                    const bStrong = b.onset % 1 === 0 ? 1 : 0;
                    if (aStrong !== bStrong) return bStrong - aStrong;
                    return b.duration - a.duration;
                });

                const goldenNote = maxNotes[0];

                sectionMelody.forEach(n => {
                    if (n.pitch === maxPitch && n !== goldenNote) {
                        const activeChord = chords.find(c => n.onset >= c.startBeat && n.onset < c.endBeat) || chords[0];
                        const safeScalePcs = HarmonyCore.getSafeScalePitches(activeChord, tonality);
                        n.pitch = HarmonyCore.shiftDiatonic(n.pitch, safeScalePcs, -1);
                    }
                });

                goldenNote.velocity = Math.min(1.0, goldenNote.velocity * 1.2);
                goldenNote.duration = Math.max(goldenNote.duration, 1.0);
            }
        }

        const humanizedMelody = SingerPersona.apply(sectionMelody, persona, chords, instrumentName);
        return { notes: humanizedMelody, motifs, lastPitch: currentPreviousPitch, unresolvedCount: consecutiveUnresolved };
    }


    // 🌟 核心升级 2 实现：基于 Groove 骨架生成具体节奏点
    private static generateMotifRhythm(baseGroove: number[], targetNoteCount: number, phraseLength: number, density: number, isIntroFirstPhrase: boolean = false, isVocal: boolean = false): number[] {
        let offsets = new Set<number>();
        
        // 1. 获取当前 Style ID 和 Energy Level
        const activeSection = GlobalContext.getActiveSection();
        const styleId = activeSection?.localStyleOverride || 'pop';
        const energyLevel = activeSection?.energyLevel || 5;

        // 2. 使用 RhythmCells 拼接节奏，直到填满 phraseLength
        let currentBeat = 0;
        while (currentBeat < phraseLength) {
            const cell = getRandomRhythmCell(styleId, energyLevel, isVocal);
            
            // 如果这个 cell 会超出乐句长度，就截断或跳过
            const cellTotalDuration = cell.reduce((sum, d) => sum + d, 0);
            if (currentBeat + cellTotalDuration > phraseLength) {
                // 尝试用一个简单的音符填满剩下的时间
                offsets.add(currentBeat);
                break;
            }

            // 将 cell 中的音符添加到 offsets
            let cellBeat = currentBeat;
            for (const duration of cell) {
                offsets.add(cellBeat);
                cellBeat += duration;
            }
            currentBeat += cellTotalDuration;
        }

        let rhythm = Array.from(offsets).sort((a, b) => a - b);

        // 3. 如果音符过多，随机删减音符 (不再只删弱拍，保留切分感)
        while (rhythm.length > targetNoteCount && rhythm.length > 2) {
            // 🌟 修复：不要总是删弱拍，否则旋律全是正拍。随机删，或者偶尔删正拍！
            const isSyncopated = globalPRNG.next() > 0.5; // 50% 概率保留切分音（删正拍）
            const targetIndices = rhythm.map((val, idx) => ({val, idx})).filter(x => isSyncopated ? (x.val % 1 === 0 && x.val !== 0) : (x.val % 1 !== 0));
            
            if (targetIndices.length > 0) {
                const toRemove = targetIndices[Math.floor(globalPRNG.next() * targetIndices.length)].idx;
                rhythm.splice(toRemove, 1);
            } else {
                // 实在没得选，随机删一个（除了第0拍）
                const removeIdx = Math.floor(globalPRNG.next() * (rhythm.length - 1)) + 1;
                rhythm.splice(removeIdx, 1);
            }
        }

        // 🌟 前奏第一句：可能晚一拍或弱起
        if (isIntroFirstPhrase && rhythm.length > 0) {
            if (globalPRNG.next() > 0.5) {
                // 移除第一拍的音符，制造弱起或晚进
                rhythm = rhythm.filter(r => r > 0.5);
                if (rhythm.length === 0) rhythm.push(1.0); // 确保至少有一个音
            }
        }

        // 🌟 切分音补偿定律 (Syncopation Resolution)
        let consecutiveSyncopations = 0;
        for (let i = 0; i < rhythm.length; i++) {
            const isSyncopated = rhythm[i] % 1 !== 0;
            if (isSyncopated) {
                consecutiveSyncopations++;
            } else {
                consecutiveSyncopations = 0;
            }

            // 如果连续出现 3 个切分音，尝试解决它
            if (consecutiveSyncopations >= 3 && i + 1 < rhythm.length) {
                const nextNote = rhythm[i + 1];
                
                // 方案 1: 如果下一个音也是切分，把它移动到最近的正拍 (Downbeat resolution)
                if (nextNote % 1 !== 0) {
                    const nextDownbeat = Math.ceil(rhythm[i]);
                    // 确保移动后不会和后面的音重叠
                    if (i + 2 >= rhythm.length || nextDownbeat < rhythm[i + 2]) {
                        rhythm[i + 1] = nextDownbeat;
                    } else if (rhythm.length > targetNoteCount * 0.8 && globalPRNG.next() > 0.5) {
                        // 方案 2: 偶尔直接删掉下一个音，让当前切分音延长（通过后续的 duration 计算实现）
                        // 只有在音符数量还比较充足的时候才删除
                        rhythm.splice(i + 1, 1);
                        i--; // 调整索引因为删除了一个元素
                    }
                }
                consecutiveSyncopations = 0; // 重置计数
            }
        }
        
        // 去重并重新排序
        rhythm = Array.from(new Set(rhythm)).sort((a, b) => a - b);

        // 确保至少有一个音符
        if (rhythm.length === 0) {
            rhythm.push(0);
        }

        return rhythm;
    }

    // 🌟 核心升级 4 & 5 实现：结合和弦、线型、起承转合生成音高
    private static realizeMotif(
        template: MotifTemplate, phraseStart: number, chords: GeneratedChord[], 
        tonality: string, isAnswer: boolean, pitchShift: number, isSolo: boolean, instrumentName: string, isLastPhraseOfIntro: boolean = false, lofiEffect: boolean = false, sectionName: string = '', style?: StyleConfig,
        incomingPreviousPitch: number | null = null,
        forceStrongResolution: boolean = false,
        isUserMotif: boolean = false
    ): { notes: NoteData[], lastPitch: number | null } {
        const notes: NoteData[] = [];
        const targetCenter = 60 + pitchShift;

        const { rhythmOffsets, contour } = template;
        
        // 记录上一个音高，用于迈尔跳进定律 (Meyer's Leap Rule)
        let previousPitch: number | null = incomingPreviousPitch;

        for (let i = 0; i < rhythmOffsets.length; i++) {
            const onset = phraseStart + rhythmOffsets[i];
            let duration = i < rhythmOffsets.length - 1 ? (rhythmOffsets[i+1] - rhythmOffsets[i]) : (isAnswer ? 2.0 : 1.0);

            // 🌟 智能呼吸感 (Intelligent Breathing & Phrasing)
            const isPhraseEnd = i === rhythmOffsets.length - 1;
            const breathChance = isSolo ? 0.15 : 0.3;
            if (isPhraseEnd && globalPRNG.next() < breathChance) {
                // 如果是前奏的最后一句，不要呼吸，要连贯地引出主歌
                if (!isLastPhraseOfIntro) {
                    continue; 
                }
            }

            // 🌟 修复：在乐句中间也随机引入休止符，避免旋律太满、太密
            const restChance = isSolo ? 0.02 : 0.05;
            if (!isPhraseEnd && globalPRNG.next() < restChance) {
                continue; // 概率吃掉这个音，变成休止符
            }

            // 🌟 修复：不要总是把音符填满整个 duration，偶尔断开，增加颗粒感和呼吸感
            if (duration >= 1.0) {
                if (globalPRNG.next() > 0.8) duration = duration * 0.85; // 20% 概率稍微缩短长音
            } else if (duration >= 0.5 && globalPRNG.next() > 0.8) {
                duration -= 0.125; // 稍微缩短一点点，制造断奏感
            }

            const activeChord = chords.find(c => onset >= c.startBeat && onset < c.endBeat) || chords[0];
            const chordTones = HarmonyCore.getChordTones(activeChord, targetCenter);
            const safeScalePcs = HarmonyCore.getSafeScalePitches(activeChord, tonality);

            const isStrongBeat = (onset % 1 === 0);
            const isLongNote = duration >= 1.0;
            const progress = rhythmOffsets.length > 1 ? i / (rhythmOffsets.length - 1) : 0; // 0.0 to 1.0

            // 🌟 计算目标线型音高 (Contour Target)
            let idealPitch = targetCenter;
            const range = isSolo ? 14 : 9; // 旋律起伏跨度

            // 引入一点随机性，让线型不那么死板
            const progressJitter = progress + (globalPRNG.next() * 0.1 - 0.05);
            const safeProgress = Math.max(0, Math.min(1, progressJitter));

            switch (contour) {
                case 'Ascending': 
                    idealPitch = targetCenter - range/2 + safeProgress * range; 
                    // 增加局部起伏
                    if (i > 0 && globalPRNG.next() < 0.3) idealPitch -= (globalPRNG.next() * 3);
                    break;
                case 'Descending': 
                    idealPitch = targetCenter + range/2 - safeProgress * range; 
                    // 增加局部起伏
                    if (i > 0 && globalPRNG.next() < 0.3) idealPitch += (globalPRNG.next() * 3);
                    break;
                case 'Arch': 
                    idealPitch = targetCenter - range/2 + Math.sin(safeProgress * Math.PI) * range; 
                    break;
                case 'Bowl': 
                    idealPitch = targetCenter + range/2 - Math.sin(safeProgress * Math.PI) * range; 
                    break;
                case 'Static': 
                    // 静态也允许微小波动，使用马尔可夫链思想，倾向于保持在中心附近，偶尔偏离
                    const staticDeviation = previousPitch !== null ? (previousPitch - targetCenter) : 0;
                    const returnToCenterProb = 0.7;
                    if (globalPRNG.next() < returnToCenterProb) {
                        idealPitch = targetCenter + (globalPRNG.next() * 2 - 1); // 靠近中心
                    } else {
                        idealPitch = targetCenter + staticDeviation + (globalPRNG.next() * 4 - 2); // 稍微偏离
                    }
                    break;
                case 'Wandering': 
                    // 漫游线型：基于上一个音高进行随机游走
                    if (previousPitch !== null) {
                        const maxWanderStep = 5;
                        idealPitch = previousPitch + (globalPRNG.next() * maxWanderStep * 2 - maxWanderStep);
                        // 限制在 range 范围内
                        idealPitch = Math.max(targetCenter - range, Math.min(targetCenter + range, idealPitch));
                    } else {
                        idealPitch = targetCenter + (globalPRNG.next() * range - range/2);
                    }
                    break;
            }

            // 🌟 锚定音高 (Pitch Anchoring) & 不和谐音控制
            let currentPitch = idealPitch;
            
            if (isAnswer && i >= rhythmOffsets.length - 2) {
                // 解决 (Resolution)：乐句结尾，趋向稳定
                if (i === rhythmOffsets.length - 1) {
                    let targetTones: number[] = [];
                    if (forceStrongResolution) {
                        // 🌟 强制强解决：回到和弦根音(1)或五音(5)
                        targetTones = [chordTones[0]]; 
                        if (chordTones[2] !== undefined) targetTones.push(chordTones[2]); // 五音
                    } else {
                        // 最后一个音：现代流行更倾向于解决到三音(3)或七音(7)/九音(2)，而不是死板的根音(1)
                        // 提取和弦的三音，如果有七音也提取出来
                        targetTones = [chordTones[1] !== undefined ? chordTones[1] : chordTones[0]]; // 默认三音
                        if (chordTones.length > 3) targetTones.push(chordTones[3]); // 七音
                        // 偶尔也允许五音或根音，但概率降低
                        if (globalPRNG.next() > 0.7) {
                            targetTones.push(chordTones[0]);
                            if (chordTones[2] !== undefined) targetTones.push(chordTones[2]);
                        }
                    }
                    
                    const selectedTarget = targetTones[Math.floor(globalPRNG.next() * targetTones.length)];
                    currentPitch = this.getNearestOctave(selectedTarget, idealPitch); 
                    
                    // 确保解决的音高比前一个音低（如果可能），形成下行解决的语感
                    if (previousPitch !== null && currentPitch > previousPitch && (forceStrongResolution || globalPRNG.next() > 0.3)) {
                        currentPitch = HarmonyCore.shiftDiatonic(currentPitch, safeScalePcs, -1);
                        // 如果下移后不是和弦内音，继续下移直到是和弦内音
                        let attempts = 0;
                        while (!chordTones.map(ct => ct % 12).includes(currentPitch % 12) && attempts < 3) {
                            currentPitch = HarmonyCore.shiftDiatonic(currentPitch, safeScalePcs, -1);
                            attempts++;
                        }
                    }
                } else {
                    // 倒数第二个音：导音或经过音，引导向解决
                    currentPitch = safeScalePcs.reduce((prev, curr) => {
                        const prevDist = Math.abs(this.getNearestOctave(prev, idealPitch) - idealPitch);
                        const currDist = Math.abs(this.getNearestOctave(curr, idealPitch) - idealPitch);
                        return currDist < prevDist ? curr : prev;
                    });
                    currentPitch = this.getNearestOctave(currentPitch, idealPitch);
                }
            } else if (!isAnswer && i >= rhythmOffsets.length - 2) {
                // 提出 (Question)：乐句结尾，制造悬念
                if (i === rhythmOffsets.length - 1) {
                    // 最后一个音：停在五音、三音，或者音阶的 2/4/6/7 级（不稳定音）
                    // 现代流行喜欢悬浮感，多用 7音 或 9音(2级)
                    const unstableTones = [chordTones[1], chordTones[2], safeScalePcs[1], safeScalePcs[3], safeScalePcs[5], safeScalePcs[6]].filter(t => t !== undefined);
                    if (chordTones.length > 3) unstableTones.push(chordTones[3]); // 七音
                    const targetTone = unstableTones.length > 0 ? unstableTones[Math.floor(globalPRNG.next() * unstableTones.length)] : (chordTones[1] !== undefined ? chordTones[1] : chordTones[0]);
                    currentPitch = this.getNearestOctave(targetTone, idealPitch);
                    // 确保提出的音高有上扬的语感（Questioning inflection）
                    if (previousPitch !== null && currentPitch < previousPitch && globalPRNG.next() > 0.3) {
                        currentPitch = HarmonyCore.shiftDiatonic(currentPitch, safeScalePcs, 1);
                    }
                } else {
                    // 倒数第二个音：引导向上扬
                    currentPitch = safeScalePcs.reduce((prev, curr) => {
                        const prevDist = Math.abs(this.getNearestOctave(prev, idealPitch) - idealPitch);
                        const currDist = Math.abs(this.getNearestOctave(curr, idealPitch) - idealPitch);
                        return currDist < prevDist ? curr : prev;
                    });
                    currentPitch = this.getNearestOctave(currentPitch, idealPitch);
                }
            } else if (isStrongBeat || isLongNote) {
                // 强拍或长音：吸附到最近的和弦内音 (Chord Tones)
                // 现代流行偏爱三音和七音
                let preferredChordTones = [...chordTones];
                if (globalPRNG.next() > 0.3 && chordTones.length >= 2) {
                    // 提升三音和七音的权重，降低根音的权重
                    preferredChordTones = [chordTones[1]];
                    if (chordTones.length > 3) preferredChordTones.push(chordTones[3]);
                    if (globalPRNG.next() > 0.5 && chordTones[2] !== undefined) preferredChordTones.push(chordTones[2]); // 五音
                }
                currentPitch = preferredChordTones.reduce((prev, curr) => Math.abs(curr - idealPitch) < Math.abs(prev - idealPitch) ? curr : prev);
            } else {
                // 弱拍或短音：吸附到最近的音阶安全音 (Scale Tones)
                // 🌟 不和谐音控制 (Dissonance Control)
                const isEmotionalCore = sectionName.includes('Intro') || sectionName.includes('Chorus') || sectionName.includes('Outro');
                const maxDissonance = style.harmonyRules?.maxDissonanceTolerance ?? 0.6;
                
                // 根据 maxDissonanceTolerance 动态计算使用和弦内音的概率
                // 容忍度越高，使用和弦内音的概率越低（允许更多音阶音/延伸音）
                let chordToneProb = 1.0 - (maxDissonance * 0.7); 
                if (isEmotionalCore) {
                    chordToneProb = Math.min(1.0, chordToneProb + 0.3); // 情绪核心段落更倾向于协和
                }
                
                const useChordTone = globalPRNG.next() < chordToneProb;
                
                if (useChordTone) {
                    currentPitch = chordTones.reduce((prev, curr) => Math.abs(curr - idealPitch) < Math.abs(prev - idealPitch) ? curr : prev);
                } else {
                    currentPitch = safeScalePcs.reduce((prev, curr) => {
                        const prevDist = Math.abs(this.getNearestOctave(prev, idealPitch) - idealPitch);
                        const currDist = Math.abs(this.getNearestOctave(curr, idealPitch) - idealPitch);
                        return currDist < prevDist ? curr : prev;
                    });
                }
                currentPitch = this.getNearestOctave(currentPitch, idealPitch);
            }
            
            // 🎷 物理限制：乐器绝对音域与“困难音”避让
            let maxPitch = isSolo ? 96 : 88; // E6
            let minPitch = isSolo ? 48 : 52; // E3
            
            if (currentPitch > maxPitch) currentPitch = HarmonyCore.shiftDiatonic(currentPitch, safeScalePcs, -2);
            if (currentPitch < minPitch) currentPitch = HarmonyCore.shiftDiatonic(currentPitch, Math.max(minPitch, 55) === minPitch ? safeScalePcs : HarmonyCore.getSafeScalePitches(activeChord, tonality), 2);
            while (currentPitch < minPitch) currentPitch += 12;

            // 🌟 迈尔跳进定律 (Meyer's Leap Rule) & 大跳限制 & 同音反复 (Conversational)
            if (previousPitch !== null) {
                // 现代流行乐 (R&B/Rap影响) 喜欢同音反复，制造“念白感”或“律动感”
                const isConversational = !isSolo && globalPRNG.next() < 0.35; // 35% 概率同音反复
                if (isConversational && duration < 1.0) {
                    currentPitch = previousPitch;
                }

                const interval = currentPitch - previousPitch;
                const isLargeLeap = Math.abs(interval) >= 7; // 纯五度及以上

                // 检查上一个音程是否是大跳，如果是，当前音应该反向级进或小跳来填补空隙
                let shouldFillGap = false;
                let gapDirection = 0;
                if (notes.length >= 2) {
                    const prevPrevPitch = notes[notes.length - 2].pitch;
                    const prevInterval = previousPitch - prevPrevPitch;
                    if (Math.abs(prevInterval) >= 7) {
                        shouldFillGap = true;
                        gapDirection = prevInterval > 0 ? -1 : 1; // 反向
                    }
                }

                if (shouldFillGap && globalPRNG.next() < 0.8) {
                    // 强制反向移动
                    const currentDirection = interval > 0 ? 1 : -1;
                    if (currentDirection !== gapDirection || Math.abs(interval) > 4) {
                        // 如果方向不对，或者跳得太远，修正它
                        let targetPitch = previousPitch + gapDirection * (globalPRNG.next() > 0.5 ? 1 : 2); // 级进或三度
                        // 找最近的音阶音
                        let bestPc = safeScalePcs[0];
                        let minDistance = 999;
                        for (const sc of safeScalePcs) {
                            const p = this.getNearestOctave(sc, targetPitch);
                            const dist = Math.abs(p - targetPitch);
                            if (dist < minDistance) {
                                minDistance = dist;
                                bestPc = sc;
                            }
                        }
                        currentPitch = this.getNearestOctave(bestPc, targetPitch);
                    }
                } else if (isLargeLeap) {
                    const isEmotionalCore = sectionName.includes('Intro') || sectionName.includes('Chorus') || sectionName.includes('Outro');
                    const allowLargeLeap = isEmotionalCore ? (globalPRNG.next() < 0.6) : (globalPRNG.next() < 0.2);

                    if (!allowLargeLeap) {
                        // 不允许大跳，强制缩小音程（级进或小跳）
                        const direction = interval > 0 ? 1 : -1;
                        const maxInterval = globalPRNG.next() > 0.5 ? 4 : 5; // 限制在三度或纯四度
                        let targetPitch = previousPitch + direction * maxInterval;
                        
                        // 找最近的和弦内音
                        let bestPc = chordTones[0];
                        let minDistance = 999;
                        for (const ct of chordTones) {
                            const p = this.getNearestOctave(ct, targetPitch);
                            const dist = Math.abs(p - targetPitch);
                            if (dist < minDistance) {
                                minDistance = dist;
                                bestPc = ct;
                            }
                        }
                        currentPitch = this.getNearestOctave(bestPc, targetPitch);
                    } else {
                        // 允许大跳，有概率加一个经过音来柔和割裂感，或者增加灵动性
                        // 降低经过音概率，避免太碎
                        const passingChance = isEmotionalCore ? 0.1 : 0.2;
                        if (globalPRNG.next() < passingChance && notes.length > 0) {
                            const lastNote = notes[notes.length - 1];
                            // 如果上一个音的时值足够长（>= 0.5拍），我们把它切分，加入一个经过音
                            if (lastNote.duration >= 0.5) {
                                // 经过音的时值与前一个音成比例，但不超过 0.5
                                const passingDuration = Math.min(lastNote.duration * 0.5, 0.5);
                                lastNote.duration -= passingDuration;
                                
                                // 计算经过音的音高（取 previousPitch 和 currentPitch 的中间值，并吸附到音阶）
                                const midPitch = Math.floor((previousPitch + currentPitch) / 2);
                                
                                let bestPc = safeScalePcs[0];
                                let minDistance = 999;
                                for (const sc of safeScalePcs) {
                                    const p = this.getNearestOctave(sc, midPitch);
                                    const dist = Math.abs(p - midPitch);
                                    if (dist < minDistance) {
                                        minDistance = dist;
                                        bestPc = sc;
                                    }
                                }
                                let passingPitch = this.getNearestOctave(bestPc, midPitch);
                                
                                // 🌟 避免经过音造成增四度/减五度等尴尬音程
                                const intervalToNext = Math.abs(currentPitch - passingPitch);
                                if (intervalToNext === 6) {
                                    // 如果是三全音，稍微移动一下经过音
                                    passingPitch = HarmonyCore.shiftDiatonic(passingPitch, safeScalePcs, currentPitch > passingPitch ? 1 : -1);
                                }
                                
                                // 确保经过音在音域内，并且不与前后音高完全相同
                                if (passingPitch >= minPitch && passingPitch <= maxPitch && passingPitch !== previousPitch && passingPitch !== currentPitch) {
                                    notes.push({
                                        pitch: Math.floor(passingPitch),
                                        onset: lastNote.onset + lastNote.duration,
                                        duration: passingDuration,
                                        // 经过音力度较弱
                                        velocity: Math.max(0.15, lastNote.velocity * (0.3 + globalPRNG.next() * 0.2)) 
                                    });
                                } else {
                                    // 如果经过音不合适，恢复上一个音的时值
                                    lastNote.duration += passingDuration;
                                }
                            }
                        }
                        
                        // 确保大跳的目标音是和弦内音，减少不和谐感
                        let bestPc = chordTones[0];
                        let minDistance = 999;
                        for (const ct of chordTones) {
                            const p = this.getNearestOctave(ct, currentPitch);
                            const dist = Math.abs(p - currentPitch);
                            if (dist < minDistance) {
                                minDistance = dist;
                                bestPc = ct;
                            }
                        }
                        currentPitch = this.getNearestOctave(bestPc, currentPitch);
                    }
                } else if (Math.abs(interval) === 1 || Math.abs(interval) === 2) {
                    // 🌟 级进时，有概率加入倚音 (Grace Note) / 幽灵音过度
                    // 大幅降低倚音频率，避免过于密集和烦人。使用方法论：一小节最多出现一次，或者只在长音前出现
                    const maxGraceNotesPerPhrase = isSolo ? 2 : 1;
                    let graceNotesInPhrase = notes.filter(n => (n as any).isGraceNote).length;
                    
                    const graceChance = isSolo ? 0.05 : 0.02; // 大幅降低倚音频率
                    if (globalPRNG.next() < graceChance && notes.length > 0 && !isPhraseEnd && graceNotesInPhrase < maxGraceNotesPerPhrase) {
                        const lastNote = notes[notes.length - 1];
                        // 只有当上一个音足够长，且当前音在强拍或次强拍时，才加倚音，增加“高级感”
                        const isTargetStrongBeat = (onset % 1 === 0) || (onset % 0.5 === 0 && globalPRNG.next() < 0.3);
                        
                        if (onset - lastNote.onset >= 0.5 && isTargetStrongBeat) {
                            // 倚音 (Grace Note) - 极短的音符，紧贴在当前音符之前
                            // 引入微小的时值随机性
                            const graceDuration = 0.0625 + (globalPRNG.next() * 0.02); // 64分音符左右
                            const graceOnset = onset - graceDuration;
                            
                            // 倚音音高通常是目标音的上方或下方二度
                            let gracePitch: number;
                            
                            // 🌟 爵士/R&B 技巧：4度到3度，或者2度到3度的滑音 (Pentatonic Slides)
                            // 如果目标音是和弦的三音，有概率使用 4->3 或 2->3 的倚音
                            const isThird = (currentPitch % 12) === ((chordTones[1] || chordTones[0]+4) % 12);
                            if (isThird && (globalPRNG.next() < 0.4 || style?.id?.includes('rnb') || style?.id?.includes('soul'))) {
                                const slideFrom4 = globalPRNG.next() > 0.5;
                                gracePitch = HarmonyCore.shiftDiatonic(currentPitch, safeScalePcs, slideFrom4 ? 1 : -1);
                            } else if (isSolo && globalPRNG.next() < 0.2) {
                                // 🌟 Bebop 技巧：半音包围 (Chromatic Enclosure)
                                // 在目标音之前加入上方半音或下方半音的经过音
                                const encloseFromAbove = globalPRNG.next() > 0.5;
                                gracePitch = currentPitch + (encloseFromAbove ? 1 : -1);
                            } else {
                                const graceDirection = globalPRNG.next() > 0.5 ? 1 : -1;
                                gracePitch = HarmonyCore.shiftDiatonic(currentPitch, safeScalePcs, graceDirection);
                            }
                            
                            // 确保倚音不与上一个音重叠，且在音域范围内，并且不与当前音高相同
                            if (graceOnset >= lastNote.onset + lastNote.duration * 0.5 && gracePitch >= minPitch && gracePitch <= maxPitch && gracePitch !== currentPitch) {
                                // 缩短上一个音，为倚音腾出空间
                                lastNote.duration = Math.min(lastNote.duration, graceOnset - lastNote.onset);
                                
                                notes.push({
                                    pitch: Math.floor(gracePitch),
                                    onset: graceOnset,
                                    duration: graceDuration * 1.5, // 稍微延长一点点发音时间
                                    // 倚音力度极弱
                                    velocity: Math.max(0.1, lastNote.velocity * (0.2 + globalPRNG.next() * 0.15)),
                                    isGraceNote: true
                                } as any);
                            }
                        }
                    }
                } else if (interval === 0 && notes.length > 0) {
                    // 🌟 辅助音 (Neighbor Tone)
                    // 当音高重复时，有概率将前一个音拆分，加入一个上方或下方的辅助音
                    const isEmotionalCore = sectionName.includes('Intro') || sectionName.includes('Chorus') || sectionName.includes('Outro');
                    const neighborChance = isEmotionalCore ? 0.15 : 0.05;
                    if (globalPRNG.next() < neighborChance) {
                        const lastNote = notes[notes.length - 1];
                        if (lastNote.duration >= 0.5) {
                            const neighborDuration = Math.min(lastNote.duration * 0.5, 0.25);
                            lastNote.duration -= neighborDuration;
                            
                            // 决定是上方还是下方辅助音
                            const isUpper = globalPRNG.next() > 0.5;
                            const neighborPitch = HarmonyCore.shiftDiatonic(currentPitch, safeScalePcs, isUpper ? 1 : -1);
                            
                            if (neighborPitch >= minPitch && neighborPitch <= maxPitch) {
                                notes.push({
                                    pitch: Math.floor(neighborPitch),
                                    onset: lastNote.onset + lastNote.duration,
                                    duration: neighborDuration,
                                    velocity: Math.max(0.2, lastNote.velocity * 0.6)
                                });
                            } else {
                                lastNote.duration += neighborDuration; // 恢复
                            }
                        }
                    }
                }
            }
            
            if (currentPitch > maxPitch) currentPitch = HarmonyCore.shiftDiatonic(currentPitch, safeScalePcs, -2);
            if (currentPitch < minPitch) currentPitch = HarmonyCore.shiftDiatonic(currentPitch, Math.max(minPitch, 55) === minPitch ? safeScalePcs : HarmonyCore.getSafeScalePitches(activeChord, tonality), 2);
            while (currentPitch < minPitch) currentPitch += 12;

            // 🌟 真实人类演奏的轻重音 (Humanized Accents & Dynamics)
            const beatsPerBar = GlobalContext.currentTimeSignature[0];
            const beatInBar = onset % beatsPerBar; 
            const is68 = beatsPerBar === 6;
            
            let metricAccent = 0.6; // 默认弱拍
            if (beatInBar === 0) {
                metricAccent = 1.0; // 强拍 (Downbeat)
                // 乐句开头或结尾的强拍更重
                if (i === 0 || i === rhythmOffsets.length - 1) metricAccent = 1.05;
            }
            else if (is68 && beatInBar === 3) metricAccent = 0.85; // 6/8 次强拍
            else if (!is68 && beatInBar === 2 && beatsPerBar === 4) metricAccent = 0.8; // 4/4 次强拍
            else if (beatInBar % 1 === 0) metricAccent = 0.75; // 正拍
            else if (beatInBar % 0.5 === 0) metricAccent = 0.6; // 8分音符反拍
            else metricAccent = 0.5; // 16分音符反拍
            
            // 引入一点力度随机性，结合音高起伏
            // 音高越高，通常力度越大
            const pitchAccent = (currentPitch - 60) / 40; // 归一化音高影响
            let humanVelocity = metricAccent * (0.85 + globalPRNG.next() * 0.2) + pitchAccent * 0.1;
            
            if (isSolo) humanVelocity *= 1.15; 
            
            // 🌟 针对特定乐器的力度调整：Lo-Fi 钢琴和 EP 需要更轻柔的触键，避免触发高力度采样（太亮）
            if (instrumentName.includes('Lofi_Piano') || instrumentName.includes('Warm_EP') || lofiEffect) {
                humanVelocity *= 0.7; // 整体降低力度，保持温暖、慵懒的音色
            }

            humanVelocity = Math.max(0.15, Math.min(1.0, humanVelocity));

            // 🌟 弹性速度 (Rubato) & Humanized Timing
            // 乐句开头稍微抢拍，乐句结尾稍微拖拍 (Ritardando)
            let rubatoShift = 0;
            if (i === 0 && !isStrongBeat) {
                rubatoShift = -0.02; // 抢拍
            } else if (i === rhythmOffsets.length - 1) {
                rubatoShift = 0.04; // 拖拍
            }
            
            // 强拍通常更准，弱拍可能稍微拖沓
            const timingJitter = (globalPRNG.next() * 0.04 - 0.02) * (1.1 - metricAccent) + rubatoShift; 
            const finalOnset = Math.max(0, onset + timingJitter);
            
            let legatoDuration = Math.max(duration * 1.4 + 0.5 + timingJitter, 0.2);
            if (instrumentName === 'Solo_Vox') {
                // Vocal synths need much longer durations to sound natural and avoid "choking"
                legatoDuration = Math.max(duration * 1.8 + 1.2 + timingJitter, 0.8);
            }

            // 🌟 幽灵音 (Ghost Note) / 律动推进
            // 在音符之前加入极短、极弱的同音高或八度音，增加律动感和推进力
            const ghostChance = isSolo ? 0.1 : 0.03;
            if (globalPRNG.next() < ghostChance && i > 0 && duration >= 0.5) {
                const prevOffset = rhythmOffsets[i - 1];
                const spaceBefore = rhythmOffsets[i] - prevOffset;
                if (spaceBefore >= 0.5) {
                    const ghostOnset = finalOnset - 0.125; // 32分音符提前量
                    if (ghostOnset > phraseStart + prevOffset + 0.25) { // 确保不与上一个音重叠太严重
                        notes.push({
                            pitch: Math.floor(currentPitch),
                            onset: ghostOnset,
                            duration: 0.1,
                            velocity: humanVelocity * 0.15 // 极弱的力度
                        });
                    }
                }
            }

            // 🌟 装饰音 (Ornaments): 颤音 (Trill)
            // 如果是长音，且是乐句结尾或强拍，有概率加入颤音
            const trillChance = isSolo ? 0.1 : 0.02;
            if (isLongNote && (isPhraseEnd || isStrongBeat) && globalPRNG.next() < trillChance) {
                const trillInterval = globalPRNG.next() > 0.5 ? 1 : 2; // 小二度或大二度
                const trillPitch = HarmonyCore.shiftDiatonic(currentPitch, safeScalePcs, 1); // 上方邻音
                
                if (trillPitch <= maxPitch) {
                    // 将长音分割成快速交替的音符
                    const trillSpeed = 0.125; // 32分音符速度
                    const numTrillNotes = Math.floor(Math.min(duration * 0.5, 1.0) / trillSpeed); // 颤音持续时间不超过原音符一半或1拍
                    
                    let currentTrillOnset = finalOnset;
                    for (let t = 0; t < numTrillNotes; t++) {
                        const p = t % 2 === 0 ? currentPitch : trillPitch;
                        const v = humanVelocity * (0.4 + globalPRNG.next() * 0.15); // 颤音力度极弱且有起伏
                        notes.push({ pitch: Math.floor(p), onset: currentTrillOnset, duration: trillSpeed * 1.2, velocity: v });
                        currentTrillOnset += trillSpeed;
                    }
                    
                    // 剩余时间保持主音
                    const remainingDuration = duration - (numTrillNotes * trillSpeed);
                    if (remainingDuration > 0) {
                        notes.push({ pitch: Math.floor(currentPitch), onset: currentTrillOnset, duration: remainingDuration * 1.4 + 0.5, velocity: humanVelocity * 0.9 });
                    }
                } else {
                    // 如果颤音超出音域，正常添加音符
                    notes.push({ pitch: Math.floor(currentPitch), onset: finalOnset, duration: legatoDuration, velocity: humanVelocity });
                }
            } else {
                // 🌟 强拍倚音 (Appoggiatura)
                const isEmotionalCore = sectionName.includes('Intro') || sectionName.includes('Chorus') || sectionName.includes('Outro');
                const appoggiaturaChance = isEmotionalCore ? 0.1 : 0.05;
                if (isStrongBeat && duration >= 0.5 && globalPRNG.next() < appoggiaturaChance) {
                    // 强拍上的非和弦音，随后解决到和弦音
                    const isUpper = globalPRNG.next() > 0.5;
                    const appPitch = HarmonyCore.shiftDiatonic(currentPitch, safeScalePcs, isUpper ? 1 : -1);
                    
                    // 确保 appPitch 不是和弦内音，以产生张力
                    if (!chordTones.some(ct => (ct % 12) === (appPitch % 12)) && appPitch >= minPitch && appPitch <= maxPitch) {
                        const appDuration = Math.min(duration * 0.5, 0.25); // 占据一半时值或最多16分音符
                        
                        notes.push({
                            pitch: Math.floor(appPitch),
                            onset: finalOnset,
                            duration: appDuration,
                            velocity: humanVelocity * 1.1 // 强拍倚音通常带有重音
                        });
                        
                        // 解决音（原本的 currentPitch）延迟出现
                        notes.push({ 
                            pitch: Math.floor(currentPitch), 
                            onset: finalOnset + appDuration, 
                            duration: Math.max(0.1, legatoDuration - appDuration), 
                            velocity: humanVelocity * 0.7 
                        });
                        
                        previousPitch = currentPitch;
                        continue; // 跳过后面的正常添加
                    }
                }

                // 正常添加音符
                notes.push({ pitch: Math.floor(currentPitch), onset: finalOnset, duration: legatoDuration, velocity: humanVelocity });
            }
            
            previousPitch = currentPitch;
        }

        // 🌟 Enforce monophonic behavior for vocals (prevent overlap)
        if (instrumentName.includes('Vocal') || instrumentName.includes('Voice') || instrumentName.includes('Choir')) {
            notes.sort((a, b) => {
                if (Math.abs(a.onset - b.onset) < 0.01) return b.pitch - a.pitch;
                return a.onset - b.onset;
            });
            
            const monophonicNotes: NoteData[] = [];
            let currentNote: NoteData | null = null;
            
            for (const note of notes) {
                if (!currentNote) {
                    currentNote = { ...note };
                    continue;
                }
                
                if (Math.abs(note.onset - currentNote.onset) < 0.01) {
                    continue; // Skip notes that start at the same time
                }
                
                if (currentNote.onset + currentNote.duration > note.onset) {
                    currentNote.duration = Math.max(0.01, note.onset - currentNote.onset - 0.02);
                }
                
                monophonicNotes.push(currentNote);
                currentNote = { ...note };
            }
            
            if (currentNote) {
                monophonicNotes.push(currentNote);
            }
            return { notes: monophonicNotes, lastPitch: previousPitch };
        }

        return { notes, lastPitch: previousPitch };
    }

    private static getNearestOctave(pc: number, target: number): number {
        const octave = Math.floor(target / 12);
        let pitch = (pc % 12) + octave * 12;
        if (Math.abs(pitch + 12 - target) < Math.abs(pitch - target)) pitch += 12;
        if (Math.abs(pitch - 12 - target) < Math.abs(pitch - target)) pitch -= 12;
        return pitch;
    }
}