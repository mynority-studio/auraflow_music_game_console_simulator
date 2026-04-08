import { PRNGManager } from '../../utils/PRNG';
import { GeneratedTrack, ArrangedTrack, StyleConfig, NoteData, SectionMetadata, MusicContext, EnsembleDraft } from '../types';
import { TextureMapper } from './TextureMapper';
import { TransitionEngine } from './TransitionEngine';
import { GlobalContext } from '../GlobalContext';
import { HarmonyCore } from '../composing/HarmonyCore';
import { ToplineEngine } from '../composing/ToplineEngine';
import { MotifLooper } from './MotifLooper';

import { GlobalReviewer } from '../review/GlobalReviewer';
import { getStyleConfig } from '../config/styles/StyleRegistry';

export class Orchestrator {
    private static applyMixerState(palette: EnsembleDraft) {
        if (!palette.mixing) {
            palette.mixing = {};
        }

        // 🌟 3D 全景声增益级联 (3D Panoramic Gain Staging)
        // Z轴深度：聚光灯(干/近) → 侧前(微湿/中距) → 天幕(极湿/宽) → 地下室(极干/底座)
        palette.mixing.vocal = { pan: 0, reverb: 0.43, volume: 10 };           // 聚光灯中心
        palette.mixing.melody = { pan: 0, reverb: 0.43, volume: 4 };           // 聚光灯中心
        palette.mixing.secondaryMelody = { pan: 0.4, reverb: 0.59, volume: 1, chorus: 40 };  // 右前方
        palette.mixing.counterMelody = { pan: -0.4, reverb: 0.59, volume: 1, chorus: 40 };   // 左前方
        palette.mixing.chord = { pan: 0.8, reverb: 0.87, volume: 3, chorus: 90 };            // 天幕声墙
        palette.mixing.drums = { pan: 0, reverb: 0.08, volume: 7 };            // 地下室
        palette.mixing.bass = { pan: 0, reverb: 0, volume: -1 };               // 地下室，零混响，压低

        // Vocal 存在时 melody 稍偏右，不存在时居中提升
        if (!palette.vocalSound) {
            palette.mixing.melody!.volume = 6;
            palette.mixing.melody!.pan = 0;
        } else {
            palette.mixing.melody!.pan = 0.3;
        }
    }

    public static arrange(track: GeneratedTrack, styleId: number, context: MusicContext): ArrangedTrack {
        // 自动记录快照
        const startState = PRNGManager.getState();
        const style = getStyleConfig(styleId);

        const lhNotes: NoteData[] =[];
        let rhNotes: NoteData[] = [];
        const drumNotes: NoteData[] =[];

        // Fallback instrument selection (PRNG-consumed for sequence alignment)
        let hasVocal = false;
        let vocalSound = undefined;

        // Consume PRNG slots to maintain sequence alignment with legacy code
        let melodySound = 'Acoustic_Grand';     PRNGManager.next();
        let chordSound = 'String_Ensemble_1';   PRNGManager.next();
        let bassSound = 'Acoustic_Bass';        PRNGManager.next();
        let drumSound = 'Standard_DrumKit';     PRNGManager.next();

        let counterMelodySound: string | null = null;
        let hasCounterMelody = PRNGManager.next() > 0.3;
        PRNGManager.next(); // consume slot for counterMelodyProbability check

        // counterMelody defaults to null (no counter melody for now)

        const palette = track.preSelectedPalette || {
            vocalSound,
            melodySound,
            secondaryMelodySound: null as string | null,
            chordSound,
            bassSound,
            drumSound,
            counterMelodySound
        };

        Orchestrator.applyMixerState(palette);

        let hasDrums = !!palette.drumSound;
        const hasChords = !!palette.chordSound;
        let hasBass = !!palette.bassSound;
        hasCounterMelody = !!palette.counterMelodySound;
        const counterMelodyNotes: NoteData[] = [];

        // 🌟 双重主音编排 (Dual Lead Orchestration)
        let primaryMelodyRaw: NoteData[] = [];
        let secondaryMelodyRaw: NoteData[] = [];

        const isGlobalDuet = !!(palette.secondaryMelodySound && palette.secondaryMelodySound !== palette.melodySound);
        
        // Trading Fours disabled (no style-driven instrument pools)
        const hasTradingFours = false;

        const isDuet = isGlobalDuet || hasTradingFours;

        if (isDuet) {
            const phrases: NoteData[][] = [];
            let currentPhrase: NoteData[] = [];
            for (let i = 0; i < track.melody.length; i++) {
                const note = track.melody[i];
                if (currentPhrase.length === 0) {
                    currentPhrase.push(note);
                } else {
                    const lastNote = currentPhrase[currentPhrase.length - 1];
                    const gap = note.onset - (lastNote.onset + lastNote.duration);
                    const threshold = 2;
                    if (gap >= threshold) {
                        phrases.push(currentPhrase);
                        currentPhrase = [note];
                    } else {
                        currentPhrase.push(note);
                    }
                }
            }
            if (currentPhrase.length > 0) phrases.push(currentPhrase);

            let isPrimary = true;
            phrases.forEach(phrase => {
                if (phrase.length === 0) return;
                
                const firstNoteOnset = phrase[0].onset;
                const activeSection = track.sections.find(s => firstNoteOnset >= s.startBeat && firstNoteOnset < s.endBeat) || track.sections[0];
                
                let assignToPrimary = isPrimary;
                
                if (hasTradingFours && activeSection.name.includes('Solo')) {
                    // Trading Fours: 每 4 小节切换一次乐器
                    const beatsPerBar = track.timeSignature[0];
                    const barsSinceSectionStart = Math.floor((firstNoteOnset - activeSection.startBeat) / beatsPerBar);
                    const fourBarChunkIndex = Math.floor(barsSinceSectionStart / 4);
                    assignToPrimary = (fourBarChunkIndex % 2 === 0);
                } else if (!isGlobalDuet) {
                    // 如果不是全局 Duet，非 Solo 段落全部给主旋律
                    assignToPrimary = true;
                }

                if (assignToPrimary) {
                    primaryMelodyRaw.push(...phrase);
                } else {
                    secondaryMelodyRaw.push(...phrase);
                }
                
                if (isGlobalDuet) {
                    isPrimary = !isPrimary;
                }
            });
        } else {
            primaryMelodyRaw = track.melody;
        }

        const secondarySound = palette.secondaryMelodySound || null;

        // Use raw notes directly (no InstrumentIdiom post-processing)
        let idiomaticMelody: NoteData[] = [...primaryMelodyRaw];

        let idiomaticSecondaryMelody = isDuet && secondarySound ? [...secondaryMelodyRaw] : [];

        // 🌟 动态前奏编排 (Dynamic Intro Orchestration)
        let introHasBass = false;
        let introHasDrums = false;
        let introHasPiano = true;
        let introHasMelody = true;
        let drumEntryBeat = 0;
        let bassEntryBeat = 0;
        let pianoEntryBeat = 0;
        let melodyEntryBeat = 0;
        let introEndBeat = 0;

        const introSection = track.sections.find(s => s.name.includes('Intro'));
        if (introSection) {
            introEndBeat = introSection.endBeat;
            const introLength = introSection.endBeat - introSection.startBeat;
            const rand = PRNGManager.next();
            
            if (rand < 0.1) {
                // 只有钢琴 (默认)
            } else if (rand < 0.2) {
                // 🌟 旋律主角 (Melody Solo Intro)
                introHasPiano = false;
                introHasBass = false;
                introHasDrums = false;
                introHasMelody = true;
                pianoEntryBeat = introSection.endBeat;
                bassEntryBeat = introSection.endBeat;
                drumEntryBeat = introSection.endBeat;
            } else if (rand < 0.35) {
                // 钢琴 + 贝斯 (贝斯在一半时进入)
                introHasBass = true;
                bassEntryBeat = introSection.startBeat + introLength / 2;
            } else if (rand < 0.5) {
                // 钢琴 + 贝斯 + 鼓 (都在一半时进入)
                introHasBass = true;
                introHasDrums = true;
                bassEntryBeat = introSection.startBeat + introLength / 2;
                drumEntryBeat = introSection.startBeat + introLength / 2;
            } else if (rand < 0.65) {
                // 钢琴 + 鼓 (鼓一开始就进，打节奏)
                introHasDrums = true;
                drumEntryBeat = introSection.startBeat;
            } else if (rand < 0.8) {
                // 🌟 鼓组主角 (Drum Solo Intro)
                introHasDrums = true;
                introHasPiano = false;
                introHasMelody = false;
                drumEntryBeat = introSection.startBeat;
                pianoEntryBeat = introSection.endBeat;
                melodyEntryBeat = introSection.endBeat;
            } else if (rand < 0.9) {
                // 🌟 贝斯主角 (Bass Riff Intro)
                introHasBass = true;
                introHasDrums = true;
                introHasPiano = false;
                introHasMelody = false;
                bassEntryBeat = introSection.startBeat;
                drumEntryBeat = introSection.startBeat + introLength / 2;
                pianoEntryBeat = introSection.endBeat;
                melodyEntryBeat = introSection.endBeat;
            } else {
                // 全进
                introHasBass = true;
                introHasDrums = true;
                bassEntryBeat = introSection.startBeat;
                drumEntryBeat = introSection.startBeat;
            }
        }

        if (melodyEntryBeat > 0) {
            idiomaticMelody = idiomaticMelody.filter(n => n.onset >= melodyEntryBeat);
            idiomaticSecondaryMelody = idiomaticSecondaryMelody.filter(n => n.onset >= melodyEntryBeat);
            if (track.vocal) {
                track.vocal = track.vocal.filter(n => n.onset >= melodyEntryBeat);
            }
        }

        // 🌟 提取并简化副歌 Hook 作为前奏旋律 (Thematic Foreshadowing)
        if (introSection && PRNGManager.next() < 0.6) { // 60% chance to use foreshadowing intro
            const firstChorus = track.sections.find(s => s.name.includes('Chorus'));
            if (firstChorus) {
                // Get the full chorus melody (both primary and secondary) to extract a complete hook
                const fullChorusMelody = track.melody.filter(n => n.onset >= firstChorus.startBeat && n.onset < firstChorus.endBeat);
                const targetInstrument = 10; // Music Box
                const foreshadowingIntro = ToplineEngine.extractForeshadowingIntro(fullChorusMelody, targetInstrument, introSection.startBeat, firstChorus.startBeat);
                
                if (foreshadowingIntro.length > 0) {
                    // Remove existing intro melody if any
                    idiomaticMelody = idiomaticMelody.filter(n => n.onset >= introSection.endBeat);
                    idiomaticSecondaryMelody = idiomaticSecondaryMelody.filter(n => n.onset >= introSection.endBeat);
                    if (track.vocal) {
                        track.vocal = track.vocal.filter(n => n.onset >= introSection.endBeat);
                    }
                    
                    // Add foreshadowing intro
                    idiomaticMelody.push(...foreshadowingIntro);
                    idiomaticMelody.sort((a, b) => a.onset - b.onset);

                    // Replace intro chords with chorus chords to match the foreshadowing melody
                    const chorusChords = track.chords.filter(c => c.startBeat >= firstChorus.startBeat && c.startBeat < firstChorus.endBeat);
                    if (chorusChords.length > 0) {
                        // Remove intro chords
                        track.chords = track.chords.filter(c => c.startBeat < introSection.startBeat || c.startBeat >= introSection.endBeat);
                        
                        // Generate new intro chords by looping chorus chords
                        let currentBeat = introSection.startBeat;
                        let chorusIndex = 0;
                        while (currentBeat < introSection.endBeat) {
                            const sourceChord = chorusChords[chorusIndex % chorusChords.length];
                            const duration = sourceChord.endBeat - sourceChord.startBeat;
                            const nextBeat = Math.min(currentBeat + duration, introSection.endBeat);
                            
                            track.chords.push({
                                ...sourceChord,
                                startBeat: currentBeat,
                                endBeat: nextBeat
                            });
                            
                            currentBeat = nextBeat;
                            chorusIndex++;
                        }
                        
                        track.chords.sort((a, b) => a.startBeat - b.startBeat);
                    }
                }
            }
        }

        // 🌟 Phase 1 & 2: Use decoupled TrackState to determine instrument entry and texture
        const sectionPlayStates = new Map<SectionMetadata, { 
            playBass: boolean, bassEntryBeat: number,
            playChords: boolean, chordsEntryBeat: number,
            playCounterMelody: boolean, counterMelodyEntryBeat: number,
            playDrums: boolean, drumsEntryBeat: number,
            texture: string,
            densityMultiplier: number
        }>();

        // 🌟 Luis 的工程加码：生成全局乐器阈值 (Global Thresholds)
        const trackThresholds = {
            bass: 3 + PRNGManager.next() * 2,          // 3~5 之间进场
            drums: 4 + PRNGManager.next() * 2,         // 4~6 之间进场
            counterMelody: 6 + PRNGManager.next() * 2, // 6~8 之间进场
        };

        let prevSectionPlayBass = false;
        let prevSectionPlayDrums = false;

        track.sections.forEach(section => {
            const energy = section.energyLevel;
            
            // 🌟 动态阈值激活机制 (Dynamic Threshold Activation)
            let playBass = energy >= trackThresholds.bass;
            let playDrums = energy >= trackThresholds.drums;
            let playCounterMelody = energy >= trackThresholds.counterMelody;
            let playChords = true; // 和声骨架通常一直存在
            let texture: any = "Block";

            // 💡 惯性保持（防止副歌后的小跌落导致乐器突然消失）
            if (prevSectionPlayBass && energy >= Math.floor(trackThresholds.bass) - 1) {
                playBass = true; 
            }
            if (prevSectionPlayDrums && energy >= Math.floor(trackThresholds.drums) - 1) {
                playDrums = true;
            }

            const isPad = palette.counterMelodySound?.includes('Pad') || palette.counterMelodySound?.includes('String') || palette.counterMelodySound?.includes('Voice') || palette.counterMelodySound?.includes('Synth') || palette.counterMelodySound?.includes('Choir');
            if (isPad && energy <= 3) {
                playCounterMelody = true; // Pad 可以在极低能量时作为铺底
            }

            // 纯数据驱动的织体分配 (Pure Data-Driven Texture Allocation)
            if (section.type === 'BuildUp') {
                playBass = true; playChords = true; playCounterMelody = true; texture = "Arpeggio";
            } else if (section.type === 'Break' || section.type === 'Breakdown') {
                playBass = false; playChords = true; playCounterMelody = true; texture = "Pad";
            } else if (section.type === 'Verse' || energy <= 4) {
                texture = PRNGManager.next() > 0.5 ? "Arpeggio" : "Pad";
            } else if (section.type === 'Chorus' || section.type === 'Drop' || energy >= 7) {
                playBass = true; 
                playChords = true; 
                texture = "Block"; 
                playCounterMelody = true;
            } else {
                texture = PRNGManager.next() > 0.5 ? "Arpeggio" : "Block";
            }

            // 🌟 织体补偿法则 (Texture Compensation)
            // 如果鼓没进场，和声乐器必须承担打拍子的责任！
            let densityMultiplier = 1.0;
            if (!playDrums && !playBass && energy >= 5) {
                // 🌟 极简高能状态下的织体暴走 (Texture Overdrive)
                texture = PRNGManager.next() > 0.5 ? "Arpeggio" : "Pulsing";
                densityMultiplier = 2.0; // 触发 16 分音符狂飙
            } else if (!playDrums && energy >= 4) {
                texture = "Rhythmic";
            }

            // 🌟 渐进式加法编曲 (Additive Arrangement)
            let bassEntryBeat = section.startBeat;
            let chordsEntryBeat = section.startBeat;
            let counterMelodyEntryBeat = section.startBeat;
            let drumsEntryBeat = section.startBeat;

            const sectionBars = (section.endBeat - section.startBeat) / track.timeSignature[0];
            
            // 如果段落长于等于 8 小节，打散它的乐器进入点
            if (sectionBars >= 8 && section.type === 'Verse') {
                const halfBeat = section.startBeat + (sectionBars / 2) * track.timeSignature[0];
                const roll = PRNGManager.next();
                
                if (roll < 0.3) {
                    // 前一半空拍，后一半进鼓和贝斯
                    bassEntryBeat = halfBeat;
                    drumsEntryBeat = halfBeat;
                } else if (roll < 0.6) {
                    // 前一半只有鼓，后一半进贝斯
                    bassEntryBeat = halfBeat;
                }
            }

            if (sectionBars >= 8 && section.type === 'Chorus') {
                const halfBeat = section.startBeat + (sectionBars / 2) * track.timeSignature[0];
                // 副歌后半段突然加入副旋律推高潮
                if (PRNGManager.next() < 0.7) {
                    counterMelodyEntryBeat = halfBeat;
                }
            }

            sectionPlayStates.set(section, { 
                playBass, bassEntryBeat, 
                playChords, chordsEntryBeat, 
                playCounterMelody, counterMelodyEntryBeat, 
                playDrums, drumsEntryBeat,
                texture, densityMultiplier
            });

            prevSectionPlayBass = playBass;
            prevSectionPlayDrums = playDrums;
        });

        let prevVoicing: number[] = [];

        track.chords.forEach((chord, i) => {
            const activeSection = track.sections.find(s => chord.startBeat >= s.startBeat && chord.startBeat < s.endBeat) || track.sections[0];
            
            // 🌟 核心修复 2：伴奏组生成前，将黑板同步为当前段落专属的 GrooveDNA！
            // 这样贝斯和钢琴就会死死咬住当前主歌或副歌的律动，彻底解决“从头到尾一个样”的问题。
            GlobalContext.updateCurrentSlice(activeSection, chord, activeSection.grooveDNA ||[0, 1, 2, 3]);

            const secName = activeSection.name;
            const energy = activeSection.energyLevel;
            const state = sectionPlayStates.get(activeSection)!;
            
            // 🌟 智能编排逻辑 (Smart Arrangement Logic)
            let playBass = state.playBass && chord.startBeat >= state.bassEntryBeat;
            let playChords = state.playChords && chord.startBeat >= state.chordsEntryBeat;
            let playCounterMelody = state.playCounterMelody && chord.startBeat >= state.counterMelodyEntryBeat;
            let playDrums = state.playDrums && chord.startBeat >= state.drumsEntryBeat;
            let texture = state.texture;
            let densityMultiplier = state.densityMultiplier || 1.0;

            // 🌟 极低算力下的史诗级听感黑客技巧：真空效应 (Vacuum Effect / Dropout)
            const sectionIndex = track.sections.findIndex(s => chord.startBeat >= s.startBeat && chord.startBeat < s.endBeat);
            const beatsUntilNextSection = activeSection.endBeat - chord.startBeat;
            const nextSection = sectionIndex + 1 < track.sections.length ? track.sections[sectionIndex + 1] : null;
            const energyDelta = nextSection ? (nextSection.energyLevel - activeSection.energyLevel) : 0;

            // 如果下一个段落是超级爆发 (能量差 >= 2)，且处于当前段落的最后 1~2 拍
            if (energyDelta >= 2 && beatsUntilNextSection <= 2) {
                // 🔪 触发真空效应 (Vacuum Effect)
                // 拦截 Bass, Drums, Chords 的音符生成，制造绝对的物理留白
                playBass = false;
                playDrums = false; 
                playChords = false;
                playCounterMelody = false;

                // 🚀 Rapid Upward Leap (Tension Fill) - 50% 概率触发急速上扬
                if (PRNGManager.next() > 0.5) {
                    const fillStartBeat = activeSection.endBeat - beatsUntilNextSection;
                    const fillDuration = beatsUntilNextSection;
                    const notesCount = Math.floor(fillDuration * 4); // 16th notes
                    
                    const safeScalePcs = HarmonyCore.getSafeScalePitches(chord, track.tonality);
                    // 确保 scale 按顺序排列
                    safeScalePcs.sort((a, b) => a - b);
                    
                    // 找到一个合适的起始音高 (例如 C4 附近的根音)
                    const rootPc = chord.root % 12;
                    let startPitch = 60 - (60 % 12) + rootPc;
                    if (startPitch > 60) startPitch -= 12; // 确保起始音不要太高
                    
                    let currentPitch = startPitch;
                    let scaleIndex = safeScalePcs.indexOf(currentPitch % 12);
                    if (scaleIndex === -1) {
                        // 如果 startPitch 不在 safeScalePcs 中，找到最近的一个
                        scaleIndex = 0;
                        currentPitch = startPitch - (startPitch % 12) + safeScalePcs[0];
                    }
                    
                    for (let j = 0; j < notesCount; j++) {
                        const onset = fillStartBeat + (j * 0.25);
                        
                        // 沿着音阶上行
                        const pc = safeScalePcs[scaleIndex % safeScalePcs.length];
                        const octave = Math.floor(scaleIndex / safeScalePcs.length);
                        const pitch = currentPitch - (currentPitch % 12) + pc + (octave * 12);
                        
                        // 力度指数级增强 (Exponential Crescendo)
                        const progress = j / Math.max(1, notesCount - 1);
                        const velocity = 0.4 + (0.6 * Math.pow(progress, 2));
                        
                        rhNotes.push({
                            pitch: pitch,
                            onset: onset,
                            duration: 0.25,
                            velocity: velocity
                        });
                        
                        scaleIndex++;
                    }
                }
            }

            const isNeoSoulOrRnB = false; // simplified: no idiom-based style detection

            // 🌟 旋律引导的和声替换 (Melody-Driven Reharmonization)
            const reharmProb = 0; // disabled: no style-driven reharmonization
            if (reharmProb > 0 && PRNGManager.next() < reharmProb) {
                const overlappingMelody = idiomaticMelody.filter(n => n.onset >= chord.startBeat && n.onset < chord.endBeat && n.duration >= 0.5);
                if (overlappingMelody.length > 0) {
                    const rootPc = chord.root % 12;
                    let has9th = false, has11th = false, has13th = false;
                    for (const note of overlappingMelody) {
                        const interval = (note.pitch % 12 - rootPc + 12) % 12;
                        if (interval === 2) has9th = true;
                        if (interval === 5 && chord.quality.includes('Minor')) has11th = true;
                        if (interval === 9 && chord.quality.includes('Dominant')) has13th = true;
                    }

                    if (has13th && chord.quality === 'Dominant7') {
                        chord.quality = 'Dominant13';
                    } else if (has11th && (chord.quality === 'Minor7' || chord.quality === 'Minor9')) {
                        chord.quality = 'Minor11';
                    } else if (has9th) {
                        if (chord.quality === 'Major7') chord.quality = 'Major9';
                        else if (chord.quality === 'Minor7') chord.quality = 'Minor9';
                        else if (chord.quality === 'Dominant7') chord.quality = 'Dominant9';
                    }
                }
            }

            // 🌟 动态织体切换 (Dynamic Texture Shifting)
            if (isNeoSoulOrRnB) {
                const sectionLength = activeSection.endBeat - activeSection.startBeat;
                const progress = (chord.startBeat - activeSection.startBeat) / sectionLength;
                if (progress >= 0.5) {
                    if (texture === 'Block' || texture === 'Pad') {
                        texture = PRNGManager.next() > 0.5 ? 'Rhythmic' : 'Arpeggio';
                    }
                }
            }

            // 🌟 乐器化 Call and Response (Fills)
            if (isNeoSoulOrRnB && PRNGManager.next() < 0.5) {
                const chordMidpoint = chord.startBeat + (chord.endBeat - chord.startBeat) / 2;
                const melodyInSecondHalf = idiomaticMelody.some(n => n.onset >= chordMidpoint && n.onset < chord.endBeat);
                if (!melodyInSecondHalf) {
                    texture = 'Riff'; // Fill in the gap
                }
            }

            // 🌟 Vocal Accompaniment Logic: Simplify accompaniment when vocal is present
            if (palette.vocalSound) {
                if (texture === 'Arpeggio' || texture === 'Rhythmic') {
                    texture = 'Block'; // Use simpler chords to leave room for the vocal
                }
                if (playCounterMelody && energy < 8) {
                    playCounterMelody = false; // Reduce counter melody clutter unless high energy
                }
            }

            if (secName.includes('Intro')) {
                playBass = introHasBass && chord.startBeat >= bassEntryBeat;
                playChords = introHasPiano && chord.startBeat >= pianoEntryBeat;
            }

            if (track.motifRole === 'Background' && track.processedUserMotif && track.processedUserMotif.length > 0) {
                playBass = true;
            }
            if (track.motifRole === 'Middleground' && track.processedUserMotif && track.processedUserMotif.length > 0) {
                playChords = true;
            }

            // 🌟 戛然而止 (Hard Stop) 逻辑：只在第一拍发声
            if (activeSection.endingType === 'hard_stop') {
                if (chord.startBeat === activeSection.startBeat) {
                    if (playBass) {
                        lhNotes.push({ pitch: HarmonyCore.getChordTones(chord, 60)[0] - 12, onset: chord.startBeat, duration: 4, velocity: 1.0 });
                    }
                    if (playChords) {
                        const pitches = HarmonyCore.getChordTones(chord, 60);
                        pitches.forEach(p => {
                            rhNotes.push({ pitch: p, onset: chord.startBeat, duration: 4, velocity: 1.0 });
                        });
                    }
                }
                return; // 跳过常规生成
            }

            if (palette.chordSound && palette.chordSound.includes("Guitar")) {
                texture = "Guitar_Strum";
            }

            if (palette.chordSound && (palette.chordSound.includes("Synth") || palette.chordSound.includes("Pad") || palette.chordSound.includes("String") || palette.chordSound.includes("Voice"))) {
                // 流行电子合成器不需要古典钢琴的复杂加花和切分，保持简洁
                const isVoiceOrString = palette.chordSound.includes("Voice") || palette.chordSound.includes("String");
                if (energy >= 7 && !isVoiceOrString) {
                    texture = "Synth_Pulse"; // 连续八分音符或简单的切分
                } else {
                    texture = "Pad"; // 长音铺底
                }
            }

            // localStyleOverride removed (pure computation mode)

            if (playBass) {
                // 如果前奏有贝斯，为了避免割裂感，Verse_1 不应该变得稀疏
                const isSparseSection = (secName.includes("Intro") && !introHasBass) || secName.includes("Outro") || (secName === 'Verse_1' && !introHasBass);
                const isSectionEnd = chord.endBeat === activeSection.endBeat;
                const isBassSolo = playBass && !playChords;
                const nextChord = i < track.chords.length - 1 ? track.chords[i + 1] : undefined;
                const nextEnergyLevel = track.sections.find(s => s.startBeat >= activeSection.endBeat)?.energyLevel || energy;
                
                if (track.motifRole === 'Background' && track.processedUserMotif && track.processedUserMotif.length > 0) {
                    const chordKeyOffset = chord.keyOffset !== undefined ? chord.keyOffset : (track.keyOffset || 0); lhNotes.push(...MotifLooper.loopMotif(track.processedUserMotif, chord, track.tonality, 36 - chordKeyOffset, track.motifRole));
                } else {
                    lhNotes.push(...TextureMapper.generateBassLine(chord, energy, isSparseSection, isSectionEnd, idiomaticMelody, isBassSolo, nextChord, nextEnergyLevel));
                }
            }

            if (playCounterMelody) {
                // 如果副旋律乐器是铺底音色或合成器，则生成 Pad 或 Synth_Pulse 织体，否则生成副旋律
                if (track.motifRole === 'Middleground' && track.processedUserMotif && track.processedUserMotif.length > 0 && !playChords) {
                    // If Middleground motif is present and chords are not playing, put it here
                    const chordKeyOffset = chord.keyOffset !== undefined ? chord.keyOffset : (track.keyOffset || 0); counterMelodyNotes.push(...MotifLooper.loopMotif(track.processedUserMotif, chord, track.tonality, 60 - chordKeyOffset, track.motifRole));
                } else if (palette.counterMelodySound?.includes('Pad') || palette.counterMelodySound?.includes('String') || palette.counterMelodySound?.includes('Voice') || palette.counterMelodySound?.includes('Synth') || palette.counterMelodySound?.includes('Choir')) {
                    const isVoiceOrString = palette.counterMelodySound.includes('Voice') || palette.counterMelodySound.includes('String') || palette.counterMelodySound.includes('Choir');
                    const counterTexture = (energy >= 7 && !isVoiceOrString) ? 'Synth_Pulse' : 'Pad';
                    counterMelodyNotes.push(...TextureMapper.generateChordTexture(chord, energy, counterTexture, false, false, idiomaticMelody));
                } else {
                    counterMelodyNotes.push(...TextureMapper.generateCounterMelody(chord, energy, idiomaticMelody));
                }
            }

            if (playChords) {
                const nextChord = i < track.chords.length - 1 ? track.chords[i + 1] : undefined;
                const isSparseSection = secName.includes("Intro") || secName.includes("Outro");
                const isSectionEnd = chord.endBeat === activeSection.endBeat;
                const nextEnergyLevel = track.sections.find(s => s.startBeat >= activeSection.endBeat)?.energyLevel || energy;
                
                let chordNotes: NoteData[] = [];
                if (track.motifRole === 'Middleground' && track.processedUserMotif && track.processedUserMotif.length > 0) {
                    const chordKeyOffset = chord.keyOffset !== undefined ? chord.keyOffset : (track.keyOffset || 0); chordNotes = MotifLooper.loopMotif(track.processedUserMotif, chord, track.tonality, 60 - chordKeyOffset, track.motifRole);
                } else if (secName.includes("Intro") && PRNGManager.next() < 0.5) {
                    // 🌟 针对特定风格的前奏 Riff
                    const scale = HarmonyCore.getSafeScalePitches(chord, track.tonality);
                    const rootNote = HarmonyCore.getChordTones(chord, 48)[0]; // C3 range
                    chordNotes = TextureMapper.generateSignatureRiff(scale, rootNote, chord.endBeat - chord.startBeat, chord.startBeat);
                } else if (texture === "Riff") {
                    chordNotes = TextureMapper.generateRiff(chord, energy);
                } else {
                    chordNotes = TextureMapper.generateChordTexture(
                        chord, energy, texture, isSparseSection, isSectionEnd, idiomaticMelody, nextChord, prevVoicing, nextEnergyLevel
                    );
                }
                rhNotes.push(...chordNotes);
                
                // Update prevVoicing for the next chord
                if (chordNotes.length > 0) {
                    // Extract unique pitches from ALL chord notes generated for this chord, ignoring bass notes
                    const highNotes = chordNotes.filter(n => n.pitch >= 53);
                    if (highNotes.length > 0) {
                        prevVoicing = Array.from(new Set(highNotes.map(n => n.pitch))).sort((a,b) => a - b);
                    }
                }
            }
        });

        if (hasDrums) {
            let hasFullGrooveStarted = false;
            track.sections.forEach((sec, index) => {
                let playDrums = true;
                let startBeat = sec.startBeat;
                
                if (sec.name.includes('Intro')) {
                    playDrums = introHasDrums;
                    if (playDrums) {
                        startBeat = Math.max(sec.startBeat, drumEntryBeat);
                    }
                } else if (sec.type === 'Verse') {
                    // 🌟 方案四：曲式驱动的织体突变 - 主歌省去主套鼓或极简
                    playDrums = sec.energyLevel > 3 || PRNGManager.next() > 0.5; 
                } else if (sec.name.includes('Break')) {
                    playDrums = !sec.name.includes('Breakdown'); // Breakdown 绝对停鼓
                }
                
                // 🌟 戛然而止 (Hard Stop) 逻辑：只打一拍 Crash 和 Kick
                if (sec.endingType === 'hard_stop') {
                    drumNotes.push({ pitch: 49, onset: sec.startBeat, duration: 1, velocity: 1.0 }); // CRASH
                    drumNotes.push({ pitch: 36, onset: sec.startBeat, duration: 1, velocity: 1.0 }); // KICK
                    return; // 跳过常规鼓组生成
                }

                if (playDrums && startBeat < sec.endBeat) {
                    // 确保鼓组也吃当前的 GrooveDNA
                    GlobalContext.updateCurrentSlice(sec, track.chords[0], sec.grooveDNA ||[0,1,2,3]);
                    const swingRatio = 0.5;
                    const effectiveEnergy = sec.energyLevel;
                    const nextSec = track.sections[index + 1];
                    const nextEnergyLevel = nextSec ? nextSec.energyLevel : 3;
                    
                    // 如果当前段落能量大于2，或者前奏且下一个段落能量大于2，说明完整的 groove 已经开始
                    if (effectiveEnergy > 2 || (sec.name.includes('Intro') && nextEnergyLevel > 2)) {
                        hasFullGrooveStarted = true;
                    }
                    
                    // 如果是鼓组 Solo 前奏，不应该被视为普通的 Intro（普通 Intro 只有踩镲）
                    const isDrumSoloIntro = introHasDrums && !introHasPiano && !introHasMelody;
                    const treatAsIntro = sec.name.includes('Intro') && !isDrumSoloIntro;
                    
                    drumNotes.push(...TextureMapper.generateDrumGroove(startBeat, sec.endBeat, effectiveEnergy, treatAsIntro, sec.name.includes('Outro'), swingRatio, nextEnergyLevel, hasFullGrooveStarted));
                }
            });
        }

        // 🔄 动态角色互换 (Dynamic F-M-B Role Swapping) - REMOVED
        // 移除此逻辑以防止主旋律轨道变成和弦铺底 (Monophonic Lock)
        track.sections.forEach(sec => {
            // 🌟 尾奏渐弱处理 (Outro Fade Out)
            if (sec.name.includes('Outro')) {
                const outroLength = sec.endBeat - sec.startBeat;
                
                // 决定尾奏模式 (Ending Behavior)
                // 1. Fade Out: 线性渐弱 (适合流行、R&B)
                // 2. Big Ring Out: 最后一小节重击主和弦并延音 (适合摇滚、电子)
                // 3. Stop Ending: 高能量直接切断
                let endingBehavior = 'FadeOut';
                if (sec.energyLevel >= 8) {
                    endingBehavior = 'StopEnding';
                } else {
                    const ringOutProb = 0.2;
                    endingBehavior = PRNGManager.next() < ringOutProb ? 'BigRingOut' : 'FadeOut';
                }

                const applyOutroBehavior = (notes: NoteData[], isDrums: boolean = false) => {
                    for (let i = notes.length - 1; i >= 0; i--) {
                        const n = notes[i];
                        if (n.onset >= sec.startBeat && n.onset < sec.endBeat) {
                            const barsLeft = (sec.endBeat - n.onset) / track.timeSignature[0];
                            const beatInBar = n.onset % track.timeSignature[0];
                            const isLastBar = barsLeft <= 1;

                            if (endingBehavior === 'StopEnding') {
                                if (isLastBar && beatInBar >= 1) {
                                    // 最后一小节第2拍开始全停
                                    notes.splice(i, 1);
                                }
                            } else if (endingBehavior === 'BigRingOut') {
                                if (isLastBar) {
                                    if (beatInBar === 0) {
                                        // 第一拍重击
                                        n.velocity = Math.min(1.0, n.velocity * 1.5);
                                        if (!isDrums) {
                                            n.duration = track.timeSignature[0]; // 延音一整小节
                                        }
                                    } else {
                                        // 最后一小节的其他拍子全部静音
                                        notes.splice(i, 1);
                                    }
                                }
                            } else {
                                // FadeOut
                                const progress = (n.onset - sec.startBeat) / outroLength;
                                const fadeOutFactor = 1.0 - progress * 0.9; // 逐渐减弱到 10%
                                n.velocity *= fadeOutFactor;
                            }
                        }
                    }
                };

                applyOutroBehavior(lhNotes);
                applyOutroBehavior(rhNotes);
                applyOutroBehavior(counterMelodyNotes);
                applyOutroBehavior(idiomaticMelody);
                applyOutroBehavior(idiomaticSecondaryMelody);
                applyOutroBehavior(drumNotes, true);
            }
        });

        // 🌟 Luis's Zone Isolation Rules
        // 1. Bass (lhNotes) must be between E1 (28) and B2 (47)
        lhNotes.forEach(n => {
            while (n.pitch < 28) n.pitch += 12;
            while (n.pitch > 47) n.pitch -= 12;
        });

        // 2. PianoRH / Chord (rhNotes) and CounterMelody must be >= C3 (48)
        const enforceC3 = (notes: NoteData[]) => {
            notes.forEach(n => {
                while (n.pitch < 48) n.pitch += 12;
            });
        };
        enforceC3(rhNotes);
        enforceC3(counterMelodyNotes);

        TransitionEngine.applyBoundaries(track.sections, lhNotes, rhNotes, drumNotes, track.timeSignature[0], style);
        if (!hasDrums) drumNotes.length = 0; 

        // Use raw note arrays directly (no InstrumentIdiom post-processing)
        const humanizedLH = lhNotes;
        const humanizedRH = rhNotes;
        const humanizedDrums = drumNotes;
        const humanizedCounterMelody = counterMelodyNotes;
        const humanizedMelody = idiomaticMelody;

        let finalVocalNotes = track.vocal ? [...track.vocal] : undefined;
        if (hasVocal && finalVocalNotes && finalVocalNotes.length > 0) {
            track.sections.forEach(sec => {
                const sectionMelody = finalVocalNotes!.filter(n => n.onset >= sec.startBeat && n.onset < sec.endBeat);
                const sectionChords = track.chords.filter(c => c.startBeat < sec.endBeat && c.endBeat > sec.startBeat);
                const harmonyNotes = TextureMapper.generateVocalHarmony(sectionMelody, sectionChords, sec.energyLevel, track.tonality);
                finalVocalNotes!.push(...harmonyNotes);
            });
        }
        const humanizedVocal = hasVocal && finalVocalNotes ? finalVocalNotes : undefined;

        const humanizedSecondaryMelody = idiomaticSecondaryMelody;

        // Groove LFO Humanize（三角函数微时序，不影响 PRNG 序列）
        this.applyGrooveLFO(humanizedMelody);
        this.applyGrooveLFO(humanizedLH);
        this.applyGrooveLFO(humanizedRH);
        this.applyGrooveLFO(humanizedCounterMelody);
        if (humanizedVocal) this.applyGrooveLFO(humanizedVocal);
        this.applyGrooveLFO(humanizedSecondaryMelody);
        // 注意：鼓组不做 humanize，保持网格精准

        // 7. 全局对位检查与修复 (Global Counterpoint Review)
        GlobalReviewer.reviewCounterpoint(
            humanizedVocal,
            humanizedMelody,
            humanizedCounterMelody,
            track.chords,
            track.tonality
        );

        const finalKeyOffset = track.keyOffset || 0;
        const applyOffset = (notes: NoteData[]) => { notes.forEach(n => { const activeChord = track.chords.find(c => n.onset >= c.startBeat && n.onset < c.endBeat) || track.chords[0]; const chordKeyOffset = activeChord.keyOffset !== undefined ? activeChord.keyOffset : finalKeyOffset; n.pitch += chordKeyOffset; }); };

        applyOffset(humanizedMelody);
        if (humanizedVocal) applyOffset(humanizedVocal);
        applyOffset(humanizedSecondaryMelody);
        applyOffset(humanizedLH);
        applyOffset(humanizedRH);
        applyOffset(humanizedCounterMelody);

        // 🌟 修复点：强制网格化 (Strict Quantization Mask)
        // Eurodance 等电子舞曲需要绝对精准的网格，禁用所有 Humanize 偏移
        if (false) { // strictGrid disabled (no style system)
            const quantizeToGrid = (beat: number, resolution: number = 0.25): number => {
                return Math.round(beat / resolution) * resolution;
            };
            const applyQuantization = (notes: NoteData[]) => {
                notes.forEach(n => {
                    n.onset = quantizeToGrid(n.onset);
                    n.duration = Math.max(0.125, quantizeToGrid(n.duration)); // 保证最少有 32分音符长度
                });
            };
            applyQuantization(humanizedMelody);
            if (humanizedVocal) applyQuantization(humanizedVocal);
            applyQuantization(humanizedSecondaryMelody);
            applyQuantization(humanizedLH);
            applyQuantization(humanizedRH);
            applyQuantization(humanizedCounterMelody);
            applyQuantization(humanizedDrums);
        }

        // 🌟 提案二：Ritardando 渐慢算法 (Non-linear tempo deceleration)
        const tempoCurves: any[] = [];
        if (track.sections && track.sections.length > 0) {
            const lastSection = track.sections[track.sections.length - 1];
            if (lastSection.name.includes('Outro') && lastSection.endingType !== 'hard_stop') {
                // 仅对适合渐慢的曲风生效
                if (PRNGManager.next() < 0.3) { // 30% chance of ritardando
                    // 渐慢发生在最后 2 个小节
                    const beatsPerBar = track.timeSignature[0];
                    const ritardandoBeats = beatsPerBar * 2;
                    const endBeat = lastSection.endBeat;
                    const startBeat = Math.max(lastSection.startBeat, endBeat - ritardandoBeats);
                    
                    if (endBeat > startBeat) {
                        const ppq = 480; // MidiScheduler.ppq
                        tempoCurves.push({
                            startTick: startBeat * ppq,
                            endTick: endBeat * ppq,
                            startBpm: track.bpm,
                            endBpm: track.bpm * 0.6, // 降速 40%
                            curveType: 'exponential' // 指数级平滑降速
                        });
                    }
                }
            }
        }

        // --- LOGGING ---
        const usedInstruments = [
            `Melody: ${palette.melodySound}`,
            isDuet ? `Secondary Melody: ${secondarySound}` : null,
            `Chords: ${palette.chordSound}`,
            `Bass: ${palette.bassSound}`,
            hasCounterMelody ? `Counter Melody: ${palette.counterMelodySound}` : null,
            hasDrums ? `Drums: ${palette.drumSound}` : null
        ].filter(Boolean).join(' | ');

        const actualKey = track.key;

        // console.log(`[Orchestrator] 🎵 Style: ${style.id} | BPM: ${track.bpm} | Key: ${actualKey} ${track.tonality} | TimeSig: ${track.timeSignature[0]}/${track.timeSignature[1]} | Instruments: ${usedInstruments}`);
        // console.log(`[Orchestrator] 🎹 Chords:`, track.chords);
        // console.log(`[Orchestrator] 🎼 Melody Notes:`, track.melody);
                // --- END LOGGING ---

        return {
            bpm: track.bpm, key: track.key, absoluteStartBeat: track.absoluteStartBeat,
            styleId,
            vocal: humanizedVocal, melody: humanizedMelody, secondaryMelody: isDuet ? humanizedSecondaryMelody : undefined, pianoLH: humanizedLH, pianoRH: humanizedRH, drums: hasDrums ? humanizedDrums : undefined,
            counterMelody: hasCounterMelody ? humanizedCounterMelody : undefined,
            palette, sections: track.sections, chords: track.chords, tempoCurves
        };
    }

    /**
     * Groove LFO Humanize — 用三角函数模拟人类演奏的微时序偏移
     * 灵感来源：Magenta Groove RNN 的微时序分析
     * 不消耗 PRNG（纯确定性数学函数），不影响 PRNG 序列
     */
    private static applyGrooveLFO(notes: NoteData[]): void {
        for (let i = 0; i < notes.length; i++) {
            const note = notes[i];

            // 1. 判断拍子位置：正拍 vs 反拍
            const beatFraction = note.onset % 1;
            const isOnBeat = Math.abs(beatFraction) < 1e-6 || Math.abs(beatFraction - 0.5) < 1e-6;

            // 2. 跨 4 小节的呼吸 LFO（模拟人类演奏的自然漂移）
            const barDrift = Math.sin((note.onset / 16) * Math.PI * 2);

            // 3. 计算时序偏移
            // 反拍更容易被"拖拽" (laid back)，正拍更容易被"抢" (push)
            let timingShift = isOnBeat ? (-0.012 * barDrift) : (0.025 * barDrift);

            // 4. 力度关联：弹得越重，越容易往前赶
            const velocityFactor = (note.velocity - 0.5); // -0.5 to +0.5 (velocity is 0-1)
            timingShift -= velocityFactor * 0.008;

            // 5. 应用偏移（确保不为负）
            note.onset = Math.max(0, note.onset + timingShift);

            // 6. 力度微调：三角函数赋予自然的力度起伏
            const velLFO = Math.sin((note.onset / 8) * Math.PI * 2) * 0.05;
            note.velocity = Math.max(0.1, Math.min(1.0, note.velocity + velLFO));
        }
    }
}
