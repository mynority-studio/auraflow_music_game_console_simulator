import { PRNGManager } from '../../utils/PRNG';
import { NoteData, GeneratedChord, SectionMetadata, SectionType, StyleConfig, SingerPersonaConfig } from '../types';
import { HarmonyCore } from './HarmonyCore';
import { GrooveEngine } from './GrooveEngine';
import { SingerPersona } from '../performance/SingerPersona';
import { resolveInstrumentFamily, InstrumentFamily } from '../performance/InstrumentIdiom';
import { getStyleGrammar } from '../styles/GrammarRegistry';

type Contour = 'Ascending' | 'Descending' | 'Arch' | 'Bowl' | 'Static' | 'Wandering';
type PhraseForm = string[]; // e.g., ['A', 'A', 'B', 'A']

interface MotifTemplate {
    rhythm?: { pickup: number[]; body: number[]; tail: number[]; };
    anchors?: { bodyStartPitch?: number; bodyEndPitch?: number; };
    isMutated?: boolean;
    rhythmOffsets: number[];
    contour: Contour;
    noteCount: number;
    phraseLengthBeats: number;
}

import { StyleId } from '../config/StyleFlags';
import { MoodId, MoodRegistry } from '../config/MoodFlags';

export class ToplineEngine {
    
    // 🌟 提取并简化副歌 Hook 作为前奏旋律 (Thematic Foreshadowing)
    public static extractForeshadowingIntro(chorusMotif: NoteData[], targetInstrument: number = 10 /* 10: Music Box */, introStartBeat: number = 0, chorusStartBeat: number = 0): NoteData[] {
        const introMelody: NoteData[] = [];
        
        // Find the start beat of the chorus to calculate relative positions
        if (chorusMotif.length === 0) return introMelody;
        const referenceBeat = chorusStartBeat > 0 ? chorusStartBeat : chorusMotif[0].onset;
        
        for (let note of chorusMotif) {
            // 规则 1：过滤掉短于 1/8 音符的装饰音 (去除油腻感)
            if (note.duration < 0.5) continue; 
            
            // 规则 2：只保留落在强拍或次强拍上的音 (例如 4/4 拍的 1, 1.5, 2, 2.5, 3, 3.5 拍)
            const relativeBeat = note.onset - referenceBeat;
            if (relativeBeat < 0) continue; // Prevent pickup notes from playing over wrong chords
            
            const isOnBeat = (relativeBeat % 0.5 === 0);
            
            if (isOnBeat) {
                introMelody.push({
                    pitch: note.pitch,       // 保持原音高
                    onset: introStartBeat + relativeBeat,
                    duration: note.duration * 1.5, // 延长时值，增加连音(Legato)和空灵感
                    velocity: 60            // 降低力度，表现克制
                });
            }
        }
        return introMelody;
    }
    
    // 🌟 动机碎裂引擎：让副歌旋律在 Outro 中如记忆般消散
    public static generateFadingEchoOutro(chorusHook: NoteData[], outroStartBeat: number, outroBars: number, beatsPerBar: number): NoteData[] {
        const fragmentedNotes: NoteData[] = [];
        if (chorusHook.length === 0) return fragmentedNotes;
        
        const chorusStartBeat = chorusHook[0].onset;
        
        // 1. 只截取 Hook 的前 2 小节（最核心的动机），丢弃后面的复杂发展
        const coreMotif = chorusHook.filter(note => (note.onset - chorusStartBeat) < (beatsPerBar * 2));
        
        // 2. 碎裂化处理 (Fragmentation Loop)
        let currentVelocity = 70; // 初始偏弱
        
        coreMotif.forEach((note, index) => {
            const relativeBeat = note.onset - chorusStartBeat;
            // 规则 A：随机“遗忘”某些音符（概率随时间递增），保留强拍音符
            const isOnBeat = relativeBeat % 1.0 === 0; 
            const forgetProbability = isOnBeat ? 0.1 : 0.6; // 弱拍更容易被“遗忘”
            
            if (PRNGManager.next() > forgetProbability) {
                fragmentedNotes.push({
                    pitch: note.pitch,
                    // 规则 B：时间拉伸（Rubato 错觉），让音符稍微滞后，制造慵懒/留恋感
                    onset: outroStartBeat + relativeBeat + (PRNGManager.next() * 0.1), 
                    // 规则 C：时值延长（Fermata），配合更大的 Reverb 显得空灵
                    duration: note.duration * 1.5, 
                    // 规则 D：力度线性衰减（越来越轻）
                    velocity: Math.max(10, currentVelocity - (index * 5))
                });
            }
        });

        return fragmentedNotes;
    }

    public static generateTrackMelody(
        sections: SectionMetadata[], chords: GeneratedChord[], style: StyleConfig,
        tonality: string, persona: SingerPersonaConfig, instrumentName: string = 'Acoustic_Grand',
        userMotif?: NoteData[], isSecondary: boolean = false,
        timeSignature: [number, number] = [4, 4], bpm: number = 120, moodId: MoodId = MoodId.Neutral
    ): NoteData[] {
        const fullMelody: NoteData[] = [];
        const beatsPerBar = timeSignature[0]; // S-2 合规：从参数读取，不依赖 GlobalContext

        // 🌟 Phase 1: Global Groove Strategy (Now decoupled per section)
        const verseDensityMult = style.contrast.verseDensityMultiplier || 1.0;
        
        sections.forEach(section => {
            // Use decoupled groove parameters from section
            const density = isSecondary ? (section.groove?.density ?? 0.5) * 0.5 : (section.groove?.density ?? 0.5);
            const syncopationProb = section.groove?.syncopationProb ?? 0.2;
            
            section.grooveDNA = GrooveEngine.generateRhythmFingerprint(
                density,
                syncopationProb,
                beatsPerBar,
                userMotif
            );
        });

        // 🌟 Phase 2: Chorus Motif Extraction
        const chorusMotifs: Record<string, MotifTemplate> = {};
        const firstChorus = sections.find(s => s.type === SectionType.Chorus);
        if (firstChorus) {
            const chorusChords = chords.filter(c => c.startBeat >= firstChorus.startBeat && c.startBeat < firstChorus.endBeat);
            if (chorusChords.length === 0) chorusChords.push(chords[0]);
            // Generate motifs only, don't realize notes yet
            const result = this.generateSectionMelody(firstChorus, chorusChords, style, tonality, persona, instrumentName, beatsPerBar, userMotif, undefined, null, true, 0, isSecondary, 0, bpm, moodId);
            Object.assign(chorusMotifs, result.motifs);
        }

        // 🌟 Phase 3: Chronological Generation with Pitch Continuity
        const sectionMelodies: Record<number, NoteData[]> = {};
        let currentPreviousPitch: number | null = null;
        let globalUnresolvedCount = 0; // 🌟 新增：跨段落追踪未解决的乐句数量
        let maxPitchBeforeChorus = 0; // 🌟 新增：追踪副歌前的最高音，用于制造 Detonator 爆发

        sections.forEach((section, index) => {
            let providedMotifs: Record<string, MotifTemplate> | undefined = undefined;

            if (section.type === SectionType.Chorus) {
                // Reuse the motifs we extracted
                providedMotifs = chorusMotifs;
            } else if (Object.keys(chorusMotifs).length > 0 && (section.type === SectionType.Verse || section.type === SectionType.PreChorus)) {
                // 🌟 修复：不再强制让主歌复用副歌的全部动机，恢复旋律的多样性
                // 只在有概率的情况下，让主歌的 A 动机复用副歌的 A 动机（降级版），其余动机重新生成
                // 增加复用概率，增强连贯性 (从 0.3 提升到 0.5)
                if (PRNGManager.next() < 0.5) {
                    providedMotifs = {};
                    const motifA = chorusMotifs['A'];
                    if (motifA) {
                        const sectionDensity = isSecondary ? (section.groove?.density ?? 0.5) * 0.5 : (section.groove?.density ?? 0.5);
                        providedMotifs['A'] = this.downgradeMotif(motifA, section.name, sectionDensity);
                    }
                }
            }

            const sectionChords = chords.filter(c => c.startBeat >= section.startBeat && c.startBeat < section.endBeat);
            if (sectionChords.length === 0) sectionChords.push(chords[0]);

            // 🌟 提案一：主题回响 (Motif Fragmentation)
            // 如果是 Outro，且不是 hard_stop，尝试使用副歌动机进行碎裂化处理
            if (section.type === SectionType.Outro && section.endingType !== 'hard_stop' && !isSecondary) {
                const chorusIndex = sections.findIndex(s => s.type === SectionType.Chorus);
                if (chorusIndex !== -1 && chorusIndex in sectionMelodies) {
                    const chorusNotes = sectionMelodies[chorusIndex];
                    if (chorusNotes.length > 0) {
                        const outroBars = (section.endBeat - section.startBeat) / beatsPerBar;
                        const outroNotes = this.generateFadingEchoOutro(chorusNotes, section.startBeat, outroBars, beatsPerBar);
                        
                        sectionMelodies[index] = outroNotes;
                        if (outroNotes.length > 0) {
                            currentPreviousPitch = outroNotes[outroNotes.length - 1].pitch;
                        }
                        globalUnresolvedCount = 0;
                        return; // 跳过常规的 generateSectionMelody
                    }
                }
            }

            const result = this.generateSectionMelody(section, sectionChords, style, tonality, persona, instrumentName, beatsPerBar, userMotif, providedMotifs, currentPreviousPitch, false, globalUnresolvedCount, isSecondary, maxPitchBeforeChorus, bpm, moodId);
            
            sectionMelodies[index] = result.notes;
            currentPreviousPitch = result.lastPitch; // Pass the last pitch to the next section!
            globalUnresolvedCount = result.unresolvedCount; // 更新未解决计数
            
            // 🌟 记录副歌前的最高音
            if (section.type !== SectionType.Chorus && result.notes.length > 0) {
                const sectionMax = Math.max(...result.notes.map(n => n.pitch));
                if (sectionMax > maxPitchBeforeChorus) {
                    maxPitchBeforeChorus = sectionMax;
                }
            }
        });

        // Assemble full melody in order
        sections.forEach((section, index) => {
            const notes = sectionMelodies[index];
            if (notes) {
                fullMelody.push(...notes);
            }
        });

        return fullMelody;
    }

    private static transformMotif(motif: MotifTemplate, transform: { isInv?: boolean, isRet?: boolean, isAug?: boolean, isSwitcheroo?: boolean, isSplit?: boolean, isMerge?: boolean, isShift?: boolean }): MotifTemplate {
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

        if (transform.isSwitcheroo && rhythmOffsets.length > 1) {
            // 🌟 Switcheroo (移位/镜像技巧)
            // 保持第一个音（重拍锚点）不变，将其余音符的旋律线反向，或者把最后一个音移到最前面
            const switchMap: Record<Contour, Contour> = {
                'Ascending': 'Arch',
                'Descending': 'Bowl',
                'Arch': 'Ascending',
                'Bowl': 'Descending',
                'Static': 'Wandering',
                'Wandering': 'Static'
            };
            contour = switchMap[contour];
            
            // 节奏上，把最后一个音符提前到第一个音符之前（切分预期）
            const lastOffset = rhythmOffsets.pop()!;
            rhythmOffsets.unshift(rhythmOffsets[0] - 0.5);
            
            // 归一化，确保不出现负数时间
            const minOffset = Math.min(...rhythmOffsets);
            if (minOffset < 0) {
                rhythmOffsets = rhythmOffsets.map(r => r - minOffset);
            }
        }

        if (transform.isSplit && rhythmOffsets.length > 0) {
            // 🌟 Split (分裂): 随机选择一个音符，将其分裂为两个
            const splitIdx = Math.floor(PRNGManager.next() * rhythmOffsets.length);
            const onset = rhythmOffsets[splitIdx];
            const nextOnset = splitIdx < rhythmOffsets.length - 1 ? rhythmOffsets[splitIdx + 1] : phraseLengthBeats;
            const duration = nextOnset - onset;
            if (duration >= 1.0) {
                // 如果音符足够长，在中间插入一个音符
                rhythmOffsets.splice(splitIdx + 1, 0, onset + duration / 2);
                noteCount++;
            }
        }

        if (transform.isMerge && rhythmOffsets.length > 1) {
            // 🌟 Merge (合并): 随机选择两个相邻的音符，合并为一个
            const mergeIdx = Math.floor(PRNGManager.next() * (rhythmOffsets.length - 1));
            rhythmOffsets.splice(mergeIdx + 1, 1);
            noteCount--;
        }

        if (transform.isShift && rhythmOffsets.length > 0) {
            // 🌟 Shift (移位): 整体平移或局部平移
            const shiftAmount = PRNGManager.next() > 0.5 ? 0.5 : -0.5;
            rhythmOffsets = rhythmOffsets.map(r => r + shiftAmount);
            // 确保不越界
            rhythmOffsets = rhythmOffsets.filter(r => r >= 0 && r < phraseLengthBeats);
            if (rhythmOffsets.length === 0) rhythmOffsets.push(0); // 兜底
            noteCount = rhythmOffsets.length;
        }

        return { rhythm: motif.rhythm, anchors: motif.anchors, isMutated: true, rhythmOffsets, contour, noteCount, phraseLengthBeats };
    }

    private static downgradeMotif(motif: MotifTemplate, sectionName: string, density: number): MotifTemplate {
        let newRhythm = [...motif.rhythmOffsets];
        let newContour = motif.contour;

        if (sectionName.includes('Verse')) {
            // Sparser rhythm: drop some off-beats
            newRhythm = newRhythm.filter(r => {
                if (r % 1 === 0) return true; // keep downbeats
                return PRNGManager.next() < density; // drop some off-beats based on density
            });
            if (newRhythm.length === 0) newRhythm.push(0);
            
            // Keep the same contour to maintain melodic identity, 
            // but the sparser rhythm will naturally make it feel calmer.
        } else if (sectionName.includes('PreChorus')) {
            // Build-up contour
            newContour = 'Ascending';
        }

        return {
            rhythm: motif.rhythm, anchors: motif.anchors, isMutated: true,
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
        providedMotifs?: Record<string, MotifTemplate>,
        incomingPreviousPitch: number | null = null,
        generateMotifsOnly: boolean = false,
        incomingUnresolvedCount: number = 0,
        isSecondary: boolean = false,
        maxPitchBeforeChorus: number = 0,
        bpm: number = 120,
        moodId: MoodId = MoodId.Neutral
    ): { notes: NoteData[], motifs: Record<string, MotifTemplate>, lastPitch: number | null, unresolvedCount: number } {
        const sectionDensity = section.groove?.density ?? 0.5;
        const sectionSyncopation = section.groove?.syncopationProb ?? 0.2;

        // T-1 合规：用 InstrumentFamily 枚举替换字符串子串匹配
        const instrFam = resolveInstrumentFamily(instrumentName);
        // 🌟 修复：如果主奏乐器不是人声，说明这是一首纯器乐曲，主旋律应该具有 Solo 的表现力
        const isVocal = instrFam === InstrumentFamily.Voice;
        const isInstrumental = !isVocal;
        const isLead = !isSecondary;
        let isSolo = false; 
        
        let isIntro = false;
        let isOutro = false;
        
        let pitchOffset = style.contrast.versePitchOffset;

        if (section.type === SectionType.Chorus) {
            pitchOffset = style.contrast.chorusPitchOffset || 5;
        } else if (section.type === SectionType.Solo_Bridge) {
            pitchOffset = 12;
            isSolo = true;
        } else if (section.type === SectionType.Intro) {
            pitchOffset = 12;
            isIntro = true;
            // 🌟 如果是人声（非器乐），则在前奏期间不唱歌
            if (!isInstrumental) {
                return { notes: [], motifs: {}, lastPitch: null, unresolvedCount: incomingUnresolvedCount };
            }
        } else if (section.type === SectionType.Outro) {
            pitchOffset = 12;
            isOutro = true;
            if (!isInstrumental && PRNGManager.next() > 0.5) {
                return { notes: [], motifs: {}, lastPitch: null, unresolvedCount: incomingUnresolvedCount };
            }
        } else if (section.type === SectionType.Break || section.type === SectionType.Breakdown) {
            pitchOffset = 0;
        }

        const sectionGroove = section.grooveDNA || GrooveEngine.generateRhythmFingerprint(sectionDensity, sectionSyncopation, beatsPerBar, userMotif);
        // 🌟 修复：将生成的 groove 保存回 section，确保 Orchestrator 生成伴奏时使用完全相同的律动骨架！
        section.grooveDNA = sectionGroove;

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
            return { notes: sectionMelody, motifs: {}, lastPitch: pitch, unresolvedCount: 0 };
        }

        let motifUsage: 'None' | 'LiteralRiff' | 'RhythmOnly' | 'BrokenDown' = 'None';
        if (userMotif && userMotif.length > 0) {
            if (section.type === SectionType.Intro) {
                motifUsage = 'LiteralRiff';
            } else if (section.type === SectionType.Chorus) {
                motifUsage = 'LiteralRiff';
            } else if (section.type === SectionType.Verse) {
                motifUsage = PRNGManager.next() > 0.5 ? 'BrokenDown' : 'RhythmOnly';
            } else {
                motifUsage = 'None';
            }
        }

        if (motifUsage === 'LiteralRiff' && userMotif) {
            if (generateMotifsOnly) {
                return { notes: [], motifs: {}, lastPitch: null, unresolvedCount: incomingUnresolvedCount };
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
            // S-2 合规：显式传递 tonality 和 bpm，不依赖 GlobalContext
            const humanizedMelody = SingerPersona.apply(sectionMelody, persona, chords, instrumentName, tonality, bpm);
            
            let lastPitch = currentPreviousPitch;
            if (humanizedMelody.length > 0) {
                lastPitch = humanizedMelody[humanizedMelody.length - 1].pitch;
            }
            
            return { notes: humanizedMelody, motifs: {}, lastPitch, unresolvedCount: 0 };
        }

        const FORMS: PhraseForm[] = [
            ['A', 'A_prime', 'B', 'A_prime'],
            ['A', 'B', 'A', 'C'],
            ['A', 'A_prime', 'B', 'C'],
            ['A', 'B', 'A_prime', 'B_prime'],
            // 🌟 Advanced Motif Development Forms
            ['A', 'A_seq', 'B', 'A_prime'],
            ['A', 'A_inv', 'B', 'A_prime'],
            ['A', 'A_switch', 'B', 'A_prime'],
            ['A', 'B', 'A_ret', 'C'],
            ['A', 'A_prime', 'B', 'B_aug']
        ];
        // 只有真正的 Solo 段落才使用完全不重复的自由发展形式，器乐主歌/副歌依然需要结构感
        const isActualSoloSection = section.type === SectionType.Solo_Bridge;
        // 🌟 Bottom-Up Generative Grammar: Dynamic Phrase State Machine
        // Replace hardcoded FORMS with dynamic state machine based on Mood
        // S-2 合规：moodId 从参数读取，替代 GlobalContext.currentMoodId
        const mood = MoodRegistry[moodId] || MoodRegistry[MoodId.Neutral];
        const actionBias = mood.phraseActionBias || [0.4, 0.3, 0.3]; // Repeat, Vary, Contrast
        
        // 🌟 修复：倾向于使用更长的乐句（2小节），减少短乐句的频繁重复
        const possibleLengths = [beatsPerBar * 2];
        if (PRNGManager.next() < 0.3) {
            possibleLengths.push(beatsPerBar); // 只有 30% 的概率允许 1 小节的短乐句
        }
        const phraseLength = possibleLengths[Math.floor(PRNGManager.next() * possibleLengths.length)];
        const totalPhrases = Math.floor((section.endBeat - section.startBeat) / phraseLength);

        const motifs: Record<string, MotifTemplate> = {};
        if (providedMotifs) {
            Object.assign(motifs, providedMotifs);
        }

        let consecutiveUnresolved = incomingUnresolvedCount; // 🌟 新增：追踪连续未解决的乐句数量
        let currentLabelCode = 65; // 'A'
        let lastBaseLabel = 'A';
        const generatedForm: string[] = [];

        // 🌟 Schenkerian Macro-Targets
        let macroTargetDegree: number | undefined;
        if (section.type === SectionType.Chorus) {
            macroTargetDegree = PRNGManager.next() > 0.5 ? 1 : 3;
        } else if (section.type === SectionType.Verse) {
            macroTargetDegree = PRNGManager.next() > 0.5 ? 5 : 3;
        } else if (section.type === SectionType.PreChorus) {
            macroTargetDegree = PRNGManager.next() > 0.5 ? 5 : 2;
        }

        for (let phraseIdx = 0; phraseIdx < totalPhrases; phraseIdx++) {
            let phraseLabel = '';
            
            if (phraseIdx === 0) {
                phraseLabel = 'A';
                lastBaseLabel = 'A';
            } else if (isActualSoloSection) {
                // Solos wander freely
                phraseLabel = String.fromCharCode(currentLabelCode++);
                lastBaseLabel = phraseLabel;
            } else {
                // Roll for action
                const roll = PRNGManager.next();
                if (roll < actionBias[0]) {
                    // Repeat
                    phraseLabel = lastBaseLabel;
                } else if (roll < actionBias[0] + actionBias[1]) {
                    // Vary
                    const variations = ['_prime', '_seq', '_inv', '_switch', '_split', '_merge', '_shift'];
                    phraseLabel = lastBaseLabel + variations[Math.floor(PRNGManager.next() * variations.length)];
                } else {
                    // Contrast
                    currentLabelCode++;
                    phraseLabel = String.fromCharCode(currentLabelCode);
                    lastBaseLabel = phraseLabel;
                }
            }
            generatedForm.push(phraseLabel);
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
            const isSwitcheroo = phraseLabel.includes('switch');
            const isSplit = phraseLabel.includes('split');
            const isMerge = phraseLabel.includes('merge');
            const isShift = phraseLabel.includes('shift');

            if (!(baseLabel in motifs)) {
                // 🌟 Vocal/Lead Adjustment: Lower note density for vocals and leads, high for solos
                const densityMultiplier = isSolo ? 1.8 : (isInstrumental && isLead ? 1.2 : 1.0); 
                const avgNotesPerBeat = densityMultiplier * sectionDensity; 
                let minNotes = Math.max(isOutro ? 1 : 3, Math.floor(phraseLength * avgNotesPerBeat * 0.6)); 
                let maxNotes = Math.max(minNotes + 1, Math.floor(phraseLength * avgNotesPerBeat * 1.5));
                
                if (isIntro) {
                    minNotes = Math.max(3, Math.floor(minNotes * 0.8));
                    maxNotes = Math.max(minNotes + 1, Math.floor(maxNotes * 0.8));
                }
                
                const noteCount = Math.floor(PRNGManager.next() * (maxNotes - minNotes + 1)) + minNotes;
                
                let contours: Contour[] = ['Ascending', 'Descending', 'Arch', 'Bowl', 'Static', 'Wandering'];
                
                if (isOutro) {
                    const isHopeful = PRNGManager.next() > 0.5;
                    if (isHopeful) {
                        contours = ['Ascending', 'Arch']; 
                    } else {
                        contours = ['Descending', 'Bowl', 'Static']; 
                    }
                }

                const contour = contours[Math.floor(PRNGManager.next() * contours.length)];

                let rhythm3D = this.generateMotifRhythm(melodyGroove, noteCount, phraseLength, sectionDensity, (isIntro || isOutro) && phraseIdx === 0, !isSolo && !isLead, style, section.energyLevel);
                let rhythmOffsets = [...rhythm3D.pickup, ...rhythm3D.body, ...rhythm3D.tail];
                
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

                motifs[baseLabel] = { rhythm: rhythm3D, rhythmOffsets, contour, noteCount: rhythmOffsets.length, phraseLengthBeats: phraseLength, isMutated: false };
            }

            if (generateMotifsOnly) continue;

            let template = motifs[baseLabel];
            
            // 🌟 Apply Advanced Motif Transformations
            if (isInv || isRet || isAug || isSwitcheroo || isSplit || isMerge || isShift) {
                template = this.transformMotif(template, { isInv, isRet, isAug, isSwitcheroo, isSplit, isMerge, isShift });
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
                currentPitchShift += shiftOptions[Math.floor(PRNGManager.next() * shiftOptions.length)];
            }

            const isLastPhraseOfIntro = isIntro && phraseIdx === totalPhrases - 1;
            const phraseResult = this.realizeMotif(template, phraseStart, chords, tonality, isAnswer, currentPitchShift, isSolo, isInstrumental, isLead, instrumentName, isLastPhraseOfIntro, section.name, style, currentPreviousPitch, forceStrongResolution, false, 0, false, macroTargetDegree, beatsPerBar);
            
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

        if (section.type === SectionType.Chorus && sectionMelody.length > 0) {
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


    // 🌟 核心升级 2 实现：基于 Schillinger 干涉理论生成具体节奏点 (Pick-up + Body + Tail)
    // S-2 合规：energyLevel 从参数传入，不读 GlobalContext.getActiveSection()
    private static generateMotifRhythm(baseGroove: number[], targetNoteCount: number, phraseLength: number, density: number, isIntroFirstPhrase: boolean = false, isVocal: boolean = false, style?: StyleConfig, energyLevel: number = 5): { pickup: number[], body: number[], tail: number[] } {
        
        let interference: number[] = [];

        if (isVocal) {
            // 🌟 虚拟歌词节奏引擎 (Virtual Lyrics Rhythm Engine)
            // 模拟人类说话的音节组合 (Syllable Grouping)
            let currentBeat = 0;
            const maxBeats = phraseLength;
            
            // 决定起拍位置 (Pickup or Downbeat)
            if (PRNGManager.next() > 0.5 && !isIntroFirstPhrase) {
                currentBeat = PRNGManager.next() > 0.5 ? 0.5 : 0.75; // 弱起
            } else if (isIntroFirstPhrase) {
                currentBeat = 1.0; // 前奏第一句通常正拍或晚进
            }

            while (currentBeat < maxBeats - 0.5) {
                const rand = PRNGManager.next();
                let syllables = 1;
                if (rand < 0.2) syllables = 1;
                else if (rand < 0.6) syllables = 2;
                else if (rand < 0.9) syllables = 3;
                else syllables = 4;

                let wordOffsets: number[] = [];
                let wordDuration = 1.0;

                if (syllables === 1) {
                    wordOffsets = [0];
                    wordDuration = PRNGManager.next() > 0.5 ? 1.0 : 0.5;
                } else if (syllables === 2) {
                    const patternRand = PRNGManager.next();
                    if (patternRand < 0.5) { wordOffsets = [0, 0.5]; wordDuration = 1.0; }
                    else if (patternRand < 0.8) { wordOffsets = [0, 0.75]; wordDuration = 1.0; } // 附点
                    else { wordOffsets = [0, 0.25]; wordDuration = 0.5; } // 紧凑的两个十六分
                } else if (syllables === 3) {
                    const patternRand = PRNGManager.next();
                    if (patternRand < 0.4) { wordOffsets = [0, 0.5, 0.75]; wordDuration = 1.0; } // 前八后十六
                    else if (patternRand < 0.8) { wordOffsets = [0, 0.25, 0.5]; wordDuration = 1.0; } // 前十六后八
                    else { wordOffsets = [0, 0.33, 0.66]; wordDuration = 1.0; } // 三连音近似
                } else {
                    wordOffsets = [0, 0.25, 0.5, 0.75];
                    wordDuration = 1.0;
                }

                for (const offset of wordOffsets) {
                    const onset = currentBeat + offset;
                    if (onset < maxBeats) {
                        interference.push(onset);
                    }
                }

                currentBeat += wordDuration;

                // 词与词之间的停顿 (Breathing / Phrasing)
                if (PRNGManager.next() < 0.4) {
                    currentBeat += PRNGManager.next() > 0.5 ? 0.5 : 1.0; // 停顿半拍或一拍
                }
            }
            
            // 强制量化到 16 分音符网格 (0.25)
            interference = interference.map(b => Math.round(b * 4) / 4);
            // 去重：interference 已量化到 0.25 网格，整数比较可靠，sort 后无 tie
            const uniq: number[] = [];
            interference.forEach(v => { if (!uniq.includes(v)) uniq.push(v); });
            interference = uniq.sort((a, b) => a - b);
            
            // 如果密度太低，强制加几个音
            if (interference.length < 3 && phraseLength >= 2) {
                interference.push(Math.round(((interference[interference.length-1] || 0) + 0.5)*4)/4);
            }

        } else {
            // Schillinger Interference Generators based on energy
            const gen1 = energyLevel >= 6 ? 3 : 4;
            const gen2 = energyLevel >= 6 ? 2 : 3;
            
            // Generate interference pattern (in 16th notes, so step = 0.25)
            const maxTicks = phraseLength * 4;
            for (let i = 0; i < maxTicks; i++) {
                if (i % gen1 === 0 || i % gen2 === 0) {
                    // Apply density filter
                    if (PRNGManager.next() < Math.min(1.0, density * 1.5)) {
                        interference.push(i * 0.25);
                    }
                }
            }
        }
        
        // Split into pickup, body, tail
        const pickup: number[] = [];
        const body: number[] = [];
        const tail: number[] = [];
        
        // Determine pickup (negative offsets or late previous bar, here we just use early beats)
        // Let's say pickup is anything before beat 1.0 if phrase starts at 0
        // Or we can just use the first 1-2 notes as pickup if they are short
        
        let bodyStartIdx = 0;
        if (interference.length > 2 && interference[0] < 1.0 && PRNGManager.next() > 0.5) {
            pickup.push(interference[0]);
            if (interference[1] < 1.0 && PRNGManager.next() > 0.5) {
                pickup.push(interference[1]);
                bodyStartIdx = 2;
            } else {
                bodyStartIdx = 1;
            }
        }
        
        // Tail is the last note if it's long enough or isolated
        let bodyEndIdx = interference.length - 1;
        if (interference.length > bodyStartIdx + 1 && PRNGManager.next() > 0.3) {
            tail.push(interference[interference.length - 1]);
            bodyEndIdx = interference.length - 2;
        }
        
        for (let i = bodyStartIdx; i <= bodyEndIdx; i++) {
            body.push(interference[i]);
        }
        
        // 🌟 前奏第一句：可能晚一拍或弱起
        if (isIntroFirstPhrase) {
            if (pickup.length > 0) pickup.length = 0; // Clear pickup
            if (body.length > 0 && body[0] < 1.0) {
                body.shift();
            }
            if (body.length === 0) body.push(1.0);
        }
        
        return { pickup, body, tail };
    }

    // 🌟 核心升级 4 & 5 实现：结合和弦、线型、起承转合生成音高
    private static realizeMotif(
        template: MotifTemplate, phraseStart: number, chords: GeneratedChord[], 
        tonality: string, isAnswer: boolean, pitchShift: number, isSolo: boolean, isInstrumental: boolean, isLead: boolean, instrumentName: string, isLastPhraseOfIntro: boolean = false, sectionName: string = '', style?: StyleConfig,
        incomingPreviousPitch: number | null = null,
        forceStrongResolution: boolean = false,
        isClimax: boolean = false,
        maxPitchBeforeChorus: number = 0,
        isUserMotif: boolean = false,
        macroTargetDegree?: number,
        beatsPerBar: number = 4
    ): { notes: NoteData[], lastPitch: number | null } {
        const notes: NoteData[] = [];
        const targetCenter = 60 + pitchShift;
        // S-2 合规：activeSection 已通过 sectionName 参数传入，不读 GlobalContext
        // safe: style 在唯一调用处 generateSectionMelody 中始终为必填参数
        const grammar = getStyleGrammar(style!);
        const melodyRules = grammar.melodyRules;
        let currentTension = 0;

        const { rhythmOffsets, contour, rhythm, anchors } = template;
        const pickupLen = rhythm?.pickup?.length || 0;
        const bodyLen = rhythm?.body?.length || rhythmOffsets.length;
        const tailLen = rhythm?.tail?.length || 0;
        
        // 记录上一个音高，用于迈尔跳进定律 (Meyer's Leap Rule)
        let previousPitch: number | null = incomingPreviousPitch;
        
        let consecutiveNotes = 0;
        let consecutiveDuration = 0;

        // 🌟 Rhythmic Displacement & Anticipation (The "4-AND" Rule)
        let adjustedOffsets = [...rhythmOffsets];
        for (let i = 0; i < adjustedOffsets.length; i++) {
            if (PRNGManager.next() < melodyRules.anticipationProbability) {
                // Anticipate by an 8th note (0.5 beats) or 16th note (0.25 beats)
                const anticipationAmount = PRNGManager.next() > 0.5 ? 0.5 : 0.25;
                const newOnset = adjustedOffsets[i] - anticipationAmount;
                // Ensure it doesn't overlap with the previous note
                if (i === 0 || newOnset > adjustedOffsets[i - 1]) {
                    adjustedOffsets[i] = newOnset;
                }
            }
        }
        
        for (let i = 0; i < adjustedOffsets.length; i++) {
            const onset = phraseStart + adjustedOffsets[i];
            let duration = i < adjustedOffsets.length - 1 ? (adjustedOffsets[i+1] - adjustedOffsets[i]) : (isAnswer ? 2.0 : 1.0);

            // 🌟 智能呼吸感 (Intelligent Breathing & Phrasing) - Rule 3
            const isPhraseEnd = i === adjustedOffsets.length - 1;
            
            // 强制插入“呼吸窗口”（Rest Window）
            let restChance = isSolo ? 0.02 : (!isInstrumental ? 0.08 : 0.05);
            
            if (consecutiveDuration > 6.0 || consecutiveNotes > 8) {
                restChance = 0.90; // 90% 概率休止
            }
            
            if (isPhraseEnd) {
                // 强制乐句结尾：必须是长音或休止符，绝不允许出现密集的八分音符
                if (duration < 1.0) {
                    restChance = 1.0; // 强制休止
                } else {
                    restChance = isSolo ? 0.15 : (!isInstrumental ? 0.35 : 0.25);
                }
                if (!isLastPhraseOfIntro && PRNGManager.next() < restChance) {
                    consecutiveNotes = 0;
                    consecutiveDuration = 0;
                    continue;
                }
            } else if (PRNGManager.next() < restChance) {
                consecutiveNotes = 0;
                consecutiveDuration = 0;
                continue; // 概率吃掉这个音，变成休止符
            }

            consecutiveNotes++;
            consecutiveDuration += duration;

            // 🌟 修复点：强制节奏量化 (Rhythm Quantization)
            // 抛弃 0.85, 0.125 这种非标时值，强制对齐到白名单
            const validDurations = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0];
            let closestDuration = validDurations[0];
            let minDiff = Math.abs(duration - validDurations[0]);
            for (const vd of validDurations) {
                const diff = Math.abs(duration - vd);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestDuration = vd;
                }
            }
            duration = closestDuration;

            // 偶尔制造断奏感，但必须是干净的网格
            if (duration >= 1.0 && PRNGManager.next() > 0.8) {
                duration -= 0.25; // 缩短一个十六分音符，留出干净的休止
            } else if (Math.abs(duration - 0.5) < 1e-6 && PRNGManager.next() > 0.8) {
                duration = 0.25; // 八分音符变十六分音符
            }

            const activeChord = chords.find(c => onset >= c.startBeat && onset < c.endBeat) || chords[0];
            const chordTones = HarmonyCore.getChordTones(activeChord, targetCenter);
            let safeScalePcs = HarmonyCore.getSafeScalePitches(activeChord, tonality);

            // 🌟 法则四：五声音阶的“留白”艺术 (The Pentatonic Gap)
            // 强制跳过音阶中的 4 音和 7 音（大调），直接跳到下一个五声音阶内的音
            const pentatonicGapProb = melodyRules.pentatonicGapProbability ?? 0.3;
            if (PRNGManager.next() < pentatonicGapProb) {
                const isMajor = tonality.includes('Major');
                // S-2 合规：chord.keyOffset 已由 HarmonyCore 注入，默认 0
                const rootPc = activeChord.keyOffset ?? 0;
                const avoidPcs = isMajor ? [(rootPc + 5) % 12, (rootPc + 11) % 12] : [(rootPc + 2) % 12, (rootPc + 8) % 12];
                safeScalePcs = safeScalePcs.filter(pc => !avoidPcs.includes(pc));
            }

            // 🌟 Neo-Soul / Advanced: Pentatonic Shifts
            const pentatonicShiftProb = style?.melody?.pentatonicShiftProbability ?? 0;
            if (pentatonicShiftProb > 0 && PRNGManager.next() < pentatonicShiftProb) {
                if (activeChord.quality === 'Minor7' || activeChord.quality === 'Minor9') {
                    // Minor pentatonic built on the 5th
                    safeScalePcs = HarmonyCore.getScalePitches('Minor_Pentatonic').map(p => (activeChord.root + 7 + p) % 12);
                } else if (activeChord.quality === 'Major7' || activeChord.quality === 'Add9') {
                    // Major pentatonic built on the 5th
                    safeScalePcs = HarmonyCore.getScalePitches('Major_Pentatonic').map(p => (activeChord.root + 7 + p) % 12);
                } else if (activeChord.quality === 'Dominant7') {
                    // Minor pentatonic built on b3 (Altered sound)
                    safeScalePcs = HarmonyCore.getScalePitches('Minor_Pentatonic').map(p => (activeChord.root + 3 + p) % 12);
                }
            }

            // 🌟 Dynamic Melody Simplification: Give complex chords space
            const isStrongBeat = (onset % 1 === 0);
            const isLongNote = duration >= 1.0;
            const isComplexChord = ['Minor9', 'Add9', 'Dominant7Sus4', 'HalfDiminished'].includes(activeChord.quality);
            if (isComplexChord && !isStrongBeat && !isLongNote && PRNGManager.next() < 0.3) {
                continue; // Skip weak beats over complex chords
            }

            const progress = adjustedOffsets.length > 1 ? i / (adjustedOffsets.length - 1) : 0; // 0.0 to 1.0

            // 🌟 计算目标线型音高 (Contour Target)
            let idealPitch = targetCenter;
            const isVocal = !isInstrumental;
            const range = isVocal ? 12 : (isSolo ? 19 : (isLead ? 14 : 12)); // 旋律起伏跨度

            // 引入一点随机性，让线型不那么死板
            const progressJitter = progress + (PRNGManager.next() * 0.1 - 0.05);
            const safeProgress = Math.max(0, Math.min(1, progressJitter));

            const isPickup = i < pickupLen; const isBody = i >= pickupLen && i < pickupLen + bodyLen; const isTail = i >= pickupLen + bodyLen; if (isTail || i === adjustedOffsets.length - 1) { if (macroTargetDegree !== undefined) { // S-2 合规：chord.keyOffset 已由 HarmonyCore 注入，默认 0
 const rootPc = activeChord.keyOffset ?? 0; const scalePcs = HarmonyCore.getScalePitches(tonality); const degreeIdx = (macroTargetDegree - 1) % scalePcs.length; const targetPc = (rootPc + scalePcs[degreeIdx]) % 12; let minDiff = 100; for (let oct = -1; oct <= 1; oct++) { const p = targetPc + (Math.floor(targetCenter / 12) + oct) * 12; const diff = Math.abs(p - targetCenter); if (diff < minDiff) { minDiff = diff; idealPitch = p; } } } else { idealPitch = targetCenter; } } else if (isBody && i === pickupLen && anchors?.bodyStartPitch !== undefined) { idealPitch = anchors.bodyStartPitch; } else { switch (contour) {
                case 'Ascending': 
                    idealPitch = targetCenter - range/2 + safeProgress * range; 
                    // 增加局部起伏
                    if (i > 0 && PRNGManager.next() < 0.3) idealPitch -= (PRNGManager.next() * 3);
                    break;
                case 'Descending': 
                    idealPitch = targetCenter + range/2 - safeProgress * range; 
                    // 增加局部起伏
                    if (i > 0 && PRNGManager.next() < 0.3) idealPitch += (PRNGManager.next() * 3);
                    break;
                case 'Arch': 
                    idealPitch = targetCenter - range/2 + Math.sin(safeProgress * Math.PI) * range; 
                    break;
                case 'Bowl': 
                    idealPitch = targetCenter + range/2 - Math.sin(safeProgress * Math.PI) * range; 
                    break;
                case 'Static': 
                    idealPitch = targetCenter; 
                    break;
                case 'Wandering': 
                        idealPitch = targetCenter + (PRNGManager.next() * range - range/2); 
                        break;
                }
            }

            // 🌟 锚定音高 (Pitch Anchoring) & 不和谐音控制
            let currentPitch = idealPitch;
            
            if (isAnswer && i >= adjustedOffsets.length - 2) {
                // 解决 (Resolution)：乐句结尾，趋向稳定
                if (i === adjustedOffsets.length - 1) {
                    // 🌟 "Forward-Looking" Melody Logic: 
                    // 如果当前和弦是紧张的经过和弦（如 vii°, V7/vi, sus4）且持续时间短，
                    // 旋律应该“穿透”它，直接解决到下一个稳定和弦的音上。
                    let targetChord = activeChord;
                    let targetChordTones = chordTones;
                    
                    const isTensePassingChord = (
                        activeChord.numeral.includes('°') || 
                        activeChord.numeral.includes('dim') || 
                        activeChord.numeral.includes('aug') || 
                        activeChord.numeral.includes('/') || 
                        activeChord.numeral === 'VII7' || 
                        activeChord.numeral === 'III7' ||
                        activeChord.numeral.includes('sus')
                    ) && (activeChord.endBeat - activeChord.startBeat <= 2);

                    if (isTensePassingChord) {
                        const nextChord = chords.find(c => c.startBeat >= activeChord.endBeat);
                        if (nextChord) {
                            targetChord = nextChord;
                            targetChordTones = HarmonyCore.getChordTones(nextChord, targetCenter);
                        }
                    }

                    let targetTones: number[] = [];
                    if (forceStrongResolution || melodyRules.tailResolution) {
                        // 🌟 强制强解决：回到和弦根音(1)或三音(3)
                        targetTones = [targetChordTones[0]]; 
                        if (targetChordTones[1] !== undefined) targetTones.push(targetChordTones[1]); // 三音
                    } else {
                        // 最后一个音：现代流行更倾向于解决到三音(3)或根音(1)，偶尔五音(5)
                        targetTones = [targetChordTones[0]]; // 根音
                        if (targetChordTones[1] !== undefined) targetTones.push(targetChordTones[1]); // 三音
                        if (targetChordTones[2] !== undefined) targetTones.push(targetChordTones[2]); // 五音
                        
                        // 只有在极少数情况（如爵士或 Neo-Soul）且容忍度高时，才允许七音作为半解决
                        const maxDissonance = style?.harmonyRules?.maxDissonanceTolerance ?? 0.6;
                        if (maxDissonance > 0.6 && targetChordTones.length > 3 && PRNGManager.next() > 0.8) {
                            targetTones.push(targetChordTones[3]); // 七音
                        }
                    }
                    
                    const selectedTarget = targetTones[Math.floor(PRNGManager.next() * targetTones.length)];
                    currentPitch = this.getNearestOctave(selectedTarget, idealPitch); 
                } else {
                    // 倒数第二个音：导音或经过音，引导向解决
                    currentPitch = safeScalePcs.reduce((prev, curr) => {
                        const prevDist = Math.abs(this.getNearestOctave(prev, idealPitch) - idealPitch);
                        const currDist = Math.abs(this.getNearestOctave(curr, idealPitch) - idealPitch);
                        return currDist < prevDist ? curr : prev;
                    });
                    currentPitch = this.getNearestOctave(currentPitch, idealPitch);
                }
            } else if (!isAnswer && i >= adjustedOffsets.length - 2) {
                // 提出 (Question)：乐句结尾，制造悬念
                if (i === adjustedOffsets.length - 1) {
                    // 最后一个音：停在五音、三音，或者音阶的 2/4/6/7 级（不稳定音）
                    // 现代流行喜欢悬浮感，多用 7音 或 9音(2级)
                    const unstableTones = [chordTones[1], chordTones[2], safeScalePcs[1], safeScalePcs[3], safeScalePcs[5], safeScalePcs[6]].filter(t => t !== undefined);
                    if (chordTones.length > 3) unstableTones.push(chordTones[3]); // 七音
                    const targetTone = unstableTones.length > 0 ? unstableTones[Math.floor(PRNGManager.next() * unstableTones.length)] : (chordTones[1] !== undefined ? chordTones[1] : chordTones[0]);
                    currentPitch = this.getNearestOctave(targetTone, idealPitch);
                    // 确保提出的音高有上扬的语感（Questioning inflection）
                    if (previousPitch !== null && currentPitch < previousPitch && PRNGManager.next() > 0.3) {
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
                if (PRNGManager.next() > 0.3 && chordTones.length >= 2) {
                    // 提升三音和七音的权重，降低根音的权重
                    preferredChordTones = [chordTones[1]];
                    if (chordTones.length > 3) preferredChordTones.push(chordTones[3]);
                    if (PRNGManager.next() > 0.5 && chordTones[2] !== undefined) preferredChordTones.push(chordTones[2]); // 五音
                }
                currentPitch = preferredChordTones.reduce((prev, curr) => {
                    const prevDist = Math.abs(this.getNearestOctave(prev, idealPitch) - idealPitch);
                    const currDist = Math.abs(this.getNearestOctave(curr, idealPitch) - idealPitch);
                    return currDist < prevDist ? curr : prev;
                });
                currentPitch = this.getNearestOctave(currentPitch, idealPitch);

                // 🌟 倚音法则 (Appoggiatura / Tension & Release)
                // 在强拍上故意唱一个非和弦音（如上方大二度），制造紧张感
                const useAppoggiatura = PRNGManager.next() < 0.15; // 15% 概率触发
                if (useAppoggiatura && i < adjustedOffsets.length - 1) {
                    // 向上偏移一个音阶级数（Diatonic Step）
                    currentPitch = HarmonyCore.shiftDiatonic(currentPitch, safeScalePcs, 1);
                    // 标记我们需要在下一个音符解决它
                    currentTension = -1; // 负数表示下一个音需要向下级进解决
                }
            } else {
                // 弱拍或短音：吸附到最近的音阶安全音 (Scale Tones)
                if (currentTension !== 0 && previousPitch !== null) {
                    // 🌟 解决倚音 (Resolve Appoggiatura)
                    currentPitch = HarmonyCore.shiftDiatonic(previousPitch, safeScalePcs, currentTension);
                    currentTension = 0;
                } else {
                    // 🌟 不和谐音控制 (Dissonance Control)
                const isEmotionalCore = sectionName.includes('Intro') || sectionName.includes('Chorus') || sectionName.includes('Outro');
                const maxDissonance = style.harmonyRules?.maxDissonanceTolerance ?? 0.6;
                
                // 根据 maxDissonanceTolerance 动态计算使用和弦内音的概率
                // 容忍度越高，使用和弦内音的概率越低（允许更多音阶音/延伸音）
                let chordToneProb = 1.0 - (maxDissonance * 0.7); 
                if (isEmotionalCore) {
                    chordToneProb = Math.min(1.0, chordToneProb + 0.3); // 情绪核心段落更倾向于协和
                }
                
                const useChordTone = PRNGManager.next() < chordToneProb;
                
                if (useChordTone) {
                    currentPitch = chordTones.reduce((prev, curr) => {
                        const prevDist = Math.abs(this.getNearestOctave(prev, idealPitch) - idealPitch);
                        const currDist = Math.abs(this.getNearestOctave(curr, idealPitch) - idealPitch);
                        return currDist < prevDist ? curr : prev;
                    });
                } else {
                    currentPitch = safeScalePcs.reduce((prev, curr) => {
                        const prevDist = Math.abs(this.getNearestOctave(prev, idealPitch) - idealPitch);
                        const currDist = Math.abs(this.getNearestOctave(curr, idealPitch) - idealPitch);
                        return currDist < prevDist ? curr : prev;
                    });
                }
                currentPitch = this.getNearestOctave(currentPitch, idealPitch);
                }
            }
            
            // 🎷 物理限制：乐器绝对音域与“困难音”避让
            
            
            let maxPitch = isSolo ? 96 : 88; // E6
            let minPitch = isSolo ? 48 : 52; // E3
            if (isVocal) {
                maxPitch = 72; // C5
                minPitch = 55; // G3
                // 🌟 法则五：Tessitura (音区) 管理
                // 主歌的最高音，必须比副歌的最高音低至少一个纯四度（5个半音）
                if (sectionName.includes('Verse') || sectionName.includes('PreChorus')) {
                    maxPitch -= 5; 
                }
            }
            
            // S-2 合规：chord.keyOffset 已由 HarmonyCore 注入，默认 0 而非 GlobalContext
            const chordKeyOffset = activeChord.keyOffset ?? 0;
            maxPitch -= chordKeyOffset;
            minPitch -= chordKeyOffset;
            if (currentPitch > maxPitch) currentPitch = HarmonyCore.shiftDiatonic(currentPitch, safeScalePcs, -2);
            while (currentPitch > maxPitch) currentPitch -= 12;
            if (currentPitch < minPitch) currentPitch = HarmonyCore.shiftDiatonic(currentPitch, safeScalePcs, 2);
            while (currentPitch < minPitch) currentPitch += 12;

            // 🌟 迈尔跳进定律 (Meyer's Leap Rule) & 音程惩罚 (Interval Penalty)
            if (previousPitch !== null) {
                // 现代流行乐 (R&B/Rap影响) 喜欢同音反复，制造“念白感”或“律动感”
                // 🌟 数据驱动的旋律锚定 (Melody Anchoring)
                const anchorProb = style?.melody?.anchorProbability ?? (isVocal ? 0.35 : 0.15);
                const isConversational = !isSolo && PRNGManager.next() < anchorProb;
                if (isConversational && duration < 1.0) {
                    currentPitch = previousPitch;
                }

                let interval = currentPitch - previousPitch;
                let absInterval = Math.abs(interval);

                // 🌟 Rule 2: Interval Penalty & Leap Compensation
                // 检查上一个音程是否是大跳，如果是，当前音应该反向级进或小跳来填补空隙
                let shouldFillGap = false;
                let gapDirection = 0;
                if (notes.length >= 2) {
                    const prevPrevPitch = notes[notes.length - 2].pitch;
                    const prevInterval = previousPitch - prevPrevPitch;
                    const leapThreshold = style?.melody?.leapResolutionThreshold ?? 5; // 默认纯四度及以上视为大跳
                    if (Math.abs(prevInterval) >= leapThreshold) { 
                        shouldFillGap = true;
                        gapDirection = prevInterval > 0 ? -1 : 1; // 反向
                    }
                }

                if (shouldFillGap) {
                    // 强制反向级进或小跳 (Leap Compensation)
                    let targetPitch = previousPitch + gapDirection * (PRNGManager.next() > 0.5 ? 1 : 2);
                    
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
                } else {
                    // Interval Penalty Logic
                    const r = PRNGManager.next();
                    let allowedMaxInterval = 2; // 默认级进 (m2, M2)
                    
                    const maxJump = style?.melody?.maxJumpInterval ?? 12;
                    
                    if (r < 0.70) {
                        allowedMaxInterval = 2; // 70% 概率 1-2 半音
                    } else if (r < 0.90) {
                        allowedMaxInterval = 4; // 20% 概率 3-4 半音 (m3, M3)
                    } else {
                        allowedMaxInterval = maxJump; // 10% 概率允许大跳
                    }
                    
                    if (absInterval > allowedMaxInterval) {
                        // 缩小音程到允许的范围内
                        const direction = interval > 0 ? 1 : -1;
                        let targetPitch = previousPitch + direction * allowedMaxInterval;
                        
                        // 找最近的音阶音
                        let bestPc = safeScalePcs[0];
                        let minDistance = 999;
                        for (const pc of safeScalePcs) {
                            const p = this.getNearestOctave(pc, targetPitch);
                            const dist = Math.abs(p - targetPitch);
                            if (dist < minDistance) {
                                minDistance = dist;
                                bestPc = pc;
                            }
                        }
                        currentPitch = this.getNearestOctave(bestPc, targetPitch);
                    }
                }
                
                // 重新计算 interval 以供后续逻辑使用
                interval = currentPitch - previousPitch;
                absInterval = Math.abs(interval);
                
                if (absInterval === 1 || absInterval === 2) {
                    // 🌟 级进时，有概率加入倚音 (Grace Note) / 幽灵音过度
                    // 大幅降低倚音频率，避免过于密集和烦人。使用方法论：一小节最多出现一次，或者只在长音前出现
                    const maxGraceNotesPerPhrase = isSolo ? 2 : 1;
                    let graceNotesInPhrase = notes.filter(n => n.isGraceNote).length;
                    
                    const graceChance = style?.melody?.inflectionProbability ?? (isSolo ? 0.08 : (isInstrumental ? 0.04 : 0.02)); // 大幅降低倚音频率
                    if (PRNGManager.next() < graceChance && notes.length > 0 && !isPhraseEnd && graceNotesInPhrase < maxGraceNotesPerPhrase) {
                        const lastNote = notes[notes.length - 1];
                        // 只有当上一个音足够长，且当前音在强拍或次强拍时，才加倚音，增加“高级感”
                        const isTargetStrongBeat = (onset % 1 === 0) || (onset % 0.5 === 0 && PRNGManager.next() < 0.3);
                        
                        if (onset - lastNote.onset >= 0.5 && isTargetStrongBeat) {
                            // 倚音 (Grace Note) - 极短的音符，紧贴在当前音符之前
                            // 引入微小的时值随机性
                            const graceDuration = 0.0625 + (PRNGManager.next() * 0.02); // 64分音符左右
                            const graceOnset = onset - graceDuration;
                            
                            // 倚音音高通常是目标音的上方或下方二度
                            let gracePitch: number;
                            
                            // 🌟 爵士/R&B 技巧：4度到3度，或者2度到3度的滑音 (Pentatonic Slides)
                            // 如果目标音是和弦的三音，有概率使用 4->3 或 2->3 的倚音
                            const isThird = (currentPitch % 12) === ((chordTones[1] || chordTones[0]+4) % 12);
                            const shiftProb = style?.melody?.pentatonicShiftProbability ?? 0.4;
                            if (isThird && PRNGManager.next() < shiftProb) {
                                const slideFrom4 = PRNGManager.next() > 0.5;
                                gracePitch = HarmonyCore.shiftDiatonic(currentPitch, safeScalePcs, slideFrom4 ? 1 : -1);
                            } else if (isSolo && PRNGManager.next() < (style?.melody?.chromaticPassingProbability ?? 0.2)) {
                                // 🌟 Bebop 技巧：半音包围 (Chromatic Enclosure)
                                // 在目标音之前加入上方半音或下方半音的经过音
                                const encloseFromAbove = PRNGManager.next() > 0.5;
                                gracePitch = currentPitch + (encloseFromAbove ? 1 : -1);
                            } else {
                                const graceDirection = PRNGManager.next() > 0.5 ? 1 : -1;
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
                                    velocity: Math.max(0.1, lastNote.velocity * (0.2 + PRNGManager.next() * 0.15)),
                                    isGraceNote: true
                                });
                            }
                        }
                    }
                } else if (interval === 0 && notes.length > 0) {
                    // 🌟 辅助音 (Neighbor Tone)
                    // 当音高重复时，有概率将前一个音拆分，加入一个上方或下方的辅助音
                    const isEmotionalCore = sectionName.includes('Intro') || sectionName.includes('Chorus') || sectionName.includes('Outro');
                    const neighborChance = isEmotionalCore ? 0.15 : 0.05;
                    if (PRNGManager.next() < neighborChance) {
                        const lastNote = notes[notes.length - 1];
                        if (lastNote.duration >= 0.5) {
                            const neighborDuration = Math.min(lastNote.duration * 0.5, 0.25);
                            lastNote.duration -= neighborDuration;
                            
                            // 决定是上方还是下方辅助音
                            const isUpper = PRNGManager.next() > 0.5;
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
            while (currentPitch > maxPitch) currentPitch -= 12;
            if (currentPitch < minPitch) currentPitch = HarmonyCore.shiftDiatonic(currentPitch, safeScalePcs, 2);
            while (currentPitch < minPitch) currentPitch += 12;

            // 🌟 真实人类演奏的轻重音 (Humanized Accents & Dynamics)
            // S-2 合规：使用外层 generateTrackMelody 的 beatsPerBar（来自 timeSignature 参数）
            const beatInBar = onset % beatsPerBar;
            const is68 = beatsPerBar === 6;
            
            let metricAccent = 0.6; // 默认弱拍
            if (beatInBar === 0) {
                metricAccent = 1.0; // 强拍 (Downbeat)
                // 乐句开头或结尾的强拍更重
                if (i === 0 || i === adjustedOffsets.length - 1) metricAccent = 1.05;
            }
            else if (is68 && beatInBar === 3) metricAccent = 0.85; // 6/8 次强拍
            else if (!is68 && beatInBar === 2 && beatsPerBar === 4) metricAccent = 0.8; // 4/4 次强拍
            else if (beatInBar % 1 === 0) metricAccent = 0.75; // 正拍
            else if (beatInBar % 0.5 === 0) metricAccent = 0.6; // 8分音符反拍
            else metricAccent = 0.5; // 16分音符反拍
            
            // 引入一点力度随机性，结合音高起伏
            // 音高越高，通常力度越大
            const pitchAccent = (currentPitch - 60) / 40; // 归一化音高影响
            let humanVelocity = metricAccent * (0.85 + PRNGManager.next() * 0.2) + pitchAccent * 0.1;
            
            if (isSolo) humanVelocity *= 1.15; 
            else if (isLead && isInstrumental) humanVelocity *= 1.05;
            
            // 🌟 针对特定乐器的力度调整：Lo-Fi 钢琴和 EP 需要更轻柔的触键，避免触发高力度采样（太亮）
            if (instrumentName.includes('Lofi_Piano') || instrumentName.includes('Warm_EP')) {
                humanVelocity *= 0.7; // 整体降低力度，保持温暖、慵懒的音色
            }

            humanVelocity = Math.max(0.15, Math.min(1.0, humanVelocity));

            // 🌟 弹性速度 (Rubato) & Humanized Timing
            // 乐句开头稍微抢拍，乐句结尾稍微拖拍 (Ritardando)
            let rubatoShift = 0;
            if (i === 0 && !isStrongBeat) {
                rubatoShift = -0.02; // 抢拍
            } else if (i === adjustedOffsets.length - 1) {
                rubatoShift = 0.04; // 拖拍
            }
            
            // 强拍通常更准，弱拍可能稍微拖沓
            const timingJitter = (PRNGManager.next() * 0.04 - 0.02) * (1.1 - metricAccent) + rubatoShift; 
            const finalOnset = Math.max(0, onset + timingJitter);
            
            let legatoDuration = duration;
            if (instrumentName === 'Marimba') {
                // Vocal synths might need a tiny bit of overlap to trigger legato, but keep it minimal
                legatoDuration = duration * 1.05;
            }

            // 🌟 幽灵音 (Ghost Note) / 律动推进
            // 在音符之前加入极短、极弱的同音高或八度音，增加律动感和推进力
            const ghostChance = isSolo ? 0.1 : (isInstrumental ? 0.05 : 0.02);
            if (PRNGManager.next() < ghostChance && i > 0 && duration >= 0.5) {
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
            const trillChance = isSolo ? 0.1 : (isInstrumental && isLead ? 0.05 : 0.01);
            if (isLongNote && (isPhraseEnd || isStrongBeat) && PRNGManager.next() < trillChance) {
                const trillInterval = PRNGManager.next() > 0.5 ? 1 : 2; // 小二度或大二度
                const trillPitch = HarmonyCore.shiftDiatonic(currentPitch, safeScalePcs, 1); // 上方邻音
                
                if (trillPitch <= maxPitch) {
                    // 将长音分割成快速交替的音符
                    const trillSpeed = isSolo ? 0.125 : 0.25; // 32分音符或16分音符速度
                    const numTrillNotes = Math.floor(Math.min(duration * 0.5, 1.0) / trillSpeed); // 颤音持续时间不超过原音符一半或1拍
                    
                    let currentTrillOnset = finalOnset;
                    for (let t = 0; t < numTrillNotes; t++) {
                        const p = t % 2 === 0 ? currentPitch : trillPitch;
                        const v = humanVelocity * (0.4 + PRNGManager.next() * 0.15); // 颤音力度极弱且有起伏
                        notes.push({ pitch: Math.floor(p), onset: currentTrillOnset, duration: trillSpeed * 1.2, velocity: v });
                        currentTrillOnset += trillSpeed;
                    }
                    
                    // 剩余时间保持主音
                    const remainingDuration = legatoDuration - (numTrillNotes * trillSpeed);
                    if (remainingDuration > 0) {
                        notes.push({ pitch: Math.floor(currentPitch), onset: currentTrillOnset, duration: remainingDuration, velocity: humanVelocity * 0.9 });
                    }
                } else {
                    // 如果颤音超出音域，正常添加音符
                    notes.push({ pitch: Math.floor(currentPitch), onset: finalOnset, duration: legatoDuration, velocity: humanVelocity });
                }
            } else {
                // 🌟 强拍倚音 (Appoggiatura)
                const isEmotionalCore = sectionName.includes('Intro') || sectionName.includes('Chorus') || sectionName.includes('Outro');
                const appoggiaturaChance = isEmotionalCore ? 0.1 : 0.05;
                if (isStrongBeat && duration >= 0.5 && PRNGManager.next() < appoggiaturaChance) {
                    // 强拍上的非和弦音，随后解决到和弦音
                    const isUpper = PRNGManager.next() > 0.5;
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

        // 🌟 法则五：黄金分割高潮 (The Golden Ratio Climax)
        if (isClimax && notes.length > 0) {
            let climaxNote = notes[0];
            let maxScore = -1;
            for (const note of notes) {
                const isStrong = note.onset % 1 === 0;
                const score = (isStrong ? 10 : 0) + note.duration;
                if (score > maxScore) {
                    maxScore = score;
                    climaxNote = note;
                }
            }
            
            const activeChord = chords.find(c => climaxNote.onset >= c.startBeat && climaxNote.onset < c.endBeat) || chords[0];
            const safeScalePcs = HarmonyCore.getSafeScalePitches(activeChord, tonality);
            
            let targetPitch = climaxNote.pitch + 12;
            const absoluteMax = !isInstrumental ? 76 : (isSolo ? 100 : 92); // E5 for vocal climax
            if (targetPitch > absoluteMax) {
                targetPitch = absoluteMax;
            }
            
            let bestPc = safeScalePcs[0];
            let minDistance = 999;
            for (const pc of safeScalePcs) {
                const p = this.getNearestOctave(pc, targetPitch);
                const dist = Math.abs(p - targetPitch);
                if (dist < minDistance) {
                    minDistance = dist;
                    bestPc = pc;
                }
            }
            climaxNote.pitch = this.getNearestOctave(bestPc, targetPitch);
            climaxNote.velocity = Math.min(1.0, climaxNote.velocity * 1.3);
            climaxNote.duration = Math.max(climaxNote.duration, 1.0);
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