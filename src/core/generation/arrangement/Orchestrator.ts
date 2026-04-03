import { PRNGManager } from '../../utils/PRNG';
import { GeneratedTrack, ArrangedTrack, GenerationParams, NoteData, SectionMetadata, SectionType, MusicContext, EnsembleDraft, TempoCurve, ChordQuality } from '../types';
import { TextureMapper, TextureRenderContext } from './TextureMapper';
import { TransitionEngine } from './TransitionEngine';
import { HarmonyCore } from '../composing/HarmonyCore';
import { MotifLooper } from './MotifLooper';

import { GlobalReviewer } from '../review/GlobalReviewer';
import { InstrumentId, InstrumentIdFamily, isPadLikeInstrument, isGuitarFamily, resolveInstrumentFamily, InstrumentFamily } from '../config/InstrumentFlags';

export class Orchestrator {
    /** L-2 合规：从 ToplineEngine 移入编配层，纯数据变换不消耗 PRNG */
    private static extractForeshadowingIntro(chorusMotif: NoteData[], targetInstrument: number, introStartBeat: number, chorusStartBeat: number): NoteData[] {
        const introMelody: NoteData[] = [];
        if (chorusMotif.length === 0) return introMelody;
        const referenceBeat = chorusStartBeat > 0 ? chorusStartBeat : chorusMotif[0].onset;
        for (const note of chorusMotif) {
            if (note.duration < 0.5) continue;
            const relativeBeat = note.onset - referenceBeat;
            if (relativeBeat < 0) continue;
            if (Math.abs(relativeBeat % 0.5) < 1e-6) {
                introMelody.push({
                    pitch: note.pitch,
                    onset: introStartBeat + relativeBeat,
                    duration: note.duration * 1.5,
                    velocity: 60
                });
            }
        }
        return introMelody;
    }

    private static applyMixerState(palette: EnsembleDraft, params: GenerationParams) {
        if (!palette.mixing) {
            // Fallback to default mixing
            palette.mixing = {
                melody: { pan: 0.1, reverb: 0.6, volume: 4, delay: 0.2 },
                secondaryMelody: { pan: 0.5, reverb: 0.6, volume: 2 },
                vocal: { pan: 0, reverb: 0.7, volume: 8 },
                chord: { pan: -0.5, reverb: 0.65, volume: 8 },
                bass: { pan: 0, reverb: 0.3, volume: 0 },
                drums: { pan: 0, reverb: 0.1, volume: 6 },
                counterMelody: { pan: 0.6, reverb: 0.5, volume: -6 },
            };
            
            // Dynamic Foreground / Midground based on Vocal presence
            if (palette.vocalSound) {
                palette.mixing.vocal = { pan: 0, reverb: 0.7, volume: 10 };
                palette.mixing.melody.pan = 0.3;
                palette.mixing.melody.volume = 2;
            } else {
                palette.mixing.melody.pan = 0;
                palette.mixing.melody.volume = 8;
                palette.mixing.melody.reverb = 0.7;
            }

            if (palette.melodySound === InstrumentId.Violin) {
                palette.mixing.melody.volume -= 6;
            } else if (palette.melodySound === InstrumentId.Acoustic_Grand) {
                palette.mixing.melody.volume += 6;
            }

            // T-1 合规：使用 InstrumentFamily 枚举替换字符串子串匹配
            const cmFamily = palette.counterMelodySound !== null ? resolveInstrumentFamily(palette.counterMelodySound) : InstrumentFamily.Unknown;
            const isCounterMelodyPad = cmFamily === InstrumentFamily.Synth || cmFamily === InstrumentFamily.String || cmFamily === InstrumentFamily.Voice;
            if (isCounterMelodyPad) {
                palette.mixing.counterMelody.volume = -2;
            } else {
                palette.mixing.counterMelody.volume = -6;
            }
            if (palette.counterMelodySound === InstrumentId.Violin) {
                palette.mixing.counterMelody.volume -= 6;
            } else if (palette.counterMelodySound === InstrumentId.Acoustic_Grand) {
                palette.mixing.counterMelody.volume += 6;
            }

            const chordFamily = palette.chordSound !== null ? resolveInstrumentFamily(palette.chordSound) : InstrumentFamily.Unknown;
            const isChordPad = chordFamily === InstrumentFamily.Synth || chordFamily === InstrumentFamily.String || chordFamily === InstrumentFamily.Voice;
            if (isChordPad) {
                palette.mixing.chord.volume = 2;
            }
            if (palette.chordSound === InstrumentId.Violin) {
                palette.mixing.chord.volume -= 3;
            } else if (palette.chordSound === InstrumentId.Acoustic_Grand) {
                palette.mixing.chord.volume += 8;
            }

            if (palette.bassSound === InstrumentId.Acoustic_Grand) {
                palette.mixing.bass!.volume += 6;
            }
        }

        // Apply data-driven mixing preferences from style config
        if (params.orchestration?.mixingPreferences) {
            const prefs = params.orchestration.mixingPreferences;
            if (prefs.melody && palette.mixing.melody) Object.assign(palette.mixing.melody, prefs.melody);
            if (prefs.chord && palette.mixing.chord) Object.assign(palette.mixing.chord, prefs.chord);
            if (prefs.bass && palette.mixing.bass) Object.assign(palette.mixing.bass, prefs.bass);
            if (prefs.drums && palette.mixing.drums) Object.assign(palette.mixing.drums, prefs.drums);
            if (prefs.counterMelody && palette.mixing.counterMelody) Object.assign(palette.mixing.counterMelody, prefs.counterMelody);
            if (prefs.vocal && palette.mixing.vocal) Object.assign(palette.mixing.vocal, prefs.vocal);
            if (prefs.secondaryMelody && palette.mixing.secondaryMelody) Object.assign(palette.mixing.secondaryMelody, prefs.secondaryMelody);
        }

        // 🌟 修复点：无论什么曲风，主旋律强制居中，保证声场稳定
        if (palette.mixing.melody) palette.mixing.melody.pan = 0;
        if (palette.mixing.bass) palette.mixing.bass.pan = 0;
        if (palette.mixing.drums) palette.mixing.drums.pan = 0;
    }

    public static arrange(track: GeneratedTrack, params: GenerationParams, context: MusicContext): ArrangedTrack {
        // 自动记录快照
        const startState = PRNGManager.getState();
        
        const lhNotes: NoteData[] =[]; 
        let rhNotes: NoteData[] = []; 
        const drumNotes: NoteData[] =[]; 

        const pick = (arr: InstrumentId[]) => arr[Math.floor(PRNGManager.next() * arr.length)];

        // 1. Vocal
        // 🌟 全局强制取消掉vocal
        let hasVocal = false; // PRNGManager.next() < (params.orchestration?.vocalProbability ?? 0.5);
        let vocalSound: InstrumentId | undefined = hasVocal ? InstrumentId.Marimba : undefined;

        // 2. Lead
        let melodySound = pick(params.orchestration.melodyInstruments);

        // 3. Chord / Accompaniment
        let chordSound = pick(params.orchestration.chordInstruments);

        // 4. Bass
        let bassSound = pick(params.orchestration.bassInstruments);

        // 5. Drums
        let drumSound = pick(params.orchestration.drumInstruments);

        // 6. Counter Melody / Pad / Arp / Choir
        let counterMelodySound: InstrumentId | null = null;
        let hasCounterMelody = PRNGManager.next() > 0.3;
        if (params.orchestration?.counterMelodyProbability !== undefined) {
            hasCounterMelody = PRNGManager.next() < params.orchestration.counterMelodyProbability;
        }

        if (hasCounterMelody) {
            counterMelodySound = pick(params.orchestration.counterMelodyInstruments);
        }

        const palette = track.preSelectedPalette || {
            vocalSound,
            melodySound,
            chordSound,
            bassSound,
            drumSound,
            counterMelodySound
        };

        Orchestrator.applyMixerState(palette, params);

        let hasDrums = !!palette.drumSound;
        const hasChords = !!palette.chordSound;
        let hasBass = !!palette.bassSound;
        hasCounterMelody = !!palette.counterMelodySound;
        const counterMelodyNotes: NoteData[] = [];

        // 🌟 双重主音编排 (Dual Lead Orchestration)
        let primaryMelodyRaw: NoteData[] = [];
        let secondaryMelodyRaw: NoteData[] = [];

        const isGlobalDuet = !!(palette.secondaryMelodySound && palette.secondaryMelodySound !== palette.melodySound);
        
        // 🌟 提案四：Trading Fours (乐器对话/四小节轮奏)
        // 检查是否有 Solo_Bridge 段落且曲风适合 (Jazz/Blues)
        const hasTradingFours = !!params.orchestration?.allowTradingFours && track.sections.some(s => s.type === SectionType.Solo_Bridge);

        // 如果需要 Trading Fours，但没有副旋律乐器，则从配置中随机选一个
        if (hasTradingFours && !palette.secondaryMelodySound) {
            const available = params.orchestration?.melodyInstruments.filter(i => i !== palette.melodySound) || [];
            if (available.length > 0) {
                palette.secondaryMelodySound = available[Math.floor(PRNGManager.next() * available.length)];
            } else {
                palette.secondaryMelodySound = InstrumentId.Alto_Sax; // Fallback
            }
        }

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
                
                if (hasTradingFours && activeSection.type === SectionType.Solo_Bridge) {
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

        let melodyNotes: NoteData[] = [...primaryMelodyRaw];

        let secondaryMelodyNotes: NoteData[] = isDuet && secondarySound ? [...secondaryMelodyRaw] : [];

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

        const introSection = track.sections.find(s => s.type === SectionType.Intro);
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
            melodyNotes = melodyNotes.filter(n => n.onset >= melodyEntryBeat);
            secondaryMelodyNotes = secondaryMelodyNotes.filter(n => n.onset >= melodyEntryBeat);
            if (track.vocal) {
                track.vocal = track.vocal.filter(n => n.onset >= melodyEntryBeat);
            }
        }

        // 🌟 提取并简化副歌 Hook 作为前奏旋律 (Thematic Foreshadowing)
        if (introSection && PRNGManager.next() < 0.6) { // 60% chance to use foreshadowing intro
            const firstChorus = track.sections.find(s => s.type === SectionType.Chorus);
            if (firstChorus) {
                // Get the full chorus melody (both primary and secondary) to extract a complete hook
                const fullChorusMelody = track.melody.filter(n => n.onset >= firstChorus.startBeat && n.onset < firstChorus.endBeat);
                const targetInstrument = 10; // Music Box
                const foreshadowingIntro = this.extractForeshadowingIntro(fullChorusMelody, targetInstrument, introSection.startBeat, firstChorus.startBeat);
                
                if (foreshadowingIntro.length > 0) {
                    // Remove existing intro melody if any
                    melodyNotes = melodyNotes.filter(n => n.onset >= introSection.endBeat);
                    secondaryMelodyNotes = secondaryMelodyNotes.filter(n => n.onset >= introSection.endBeat);
                    if (track.vocal) {
                        track.vocal = track.vocal.filter(n => n.onset >= introSection.endBeat);
                    }
                    
                    // Add foreshadowing intro
                    melodyNotes.push(...foreshadowingIntro);
                    melodyNotes.sort((a, b) => a.onset - b.onset);

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
                        
                        // D-3 合规：同 startBeat 时按 root 二次排序，消除 tie
                        track.chords.sort((a, b) => {
                            const d = a.startBeat - b.startBeat;
                            return d !== 0 ? d : a.root - b.root;
                        });
                    }
                }
            }
        }

        // 🌟 Phase 1 & 2: Use decoupled TrackState to determine instrument entry and texture
        type SectionPlayState = { playBass: boolean, playChords: boolean, playCounterMelody: boolean, texture: string };
        const sectionPlayStates: Record<number, SectionPlayState> = {};

        track.sections.forEach((section, sectionIdx) => {
            const energy = section.energyLevel;

            let playBass = false;
            let playChords = false;
            let playCounterMelody = false;
            let texture = "Block";
            
            // Read from decoupled tracks if available
            if (section.tracks) {
                const bassTrack = section.tracks.find(t => t.id === 'trk_bass');
                const keysTrack = section.tracks.find(t => t.id === 'trk_keys');
                
                if (bassTrack && hasBass) {
                    playBass = energy >= bassTrack.activeEnergyThreshold;
                }
                if (keysTrack && hasChords) {
                    playChords = energy >= keysTrack.activeEnergyThreshold;
                    // safe: arpeggiateProb is guarded by truthiness check; it's number | undefined on the type
                    if (keysTrack.behavior.arpeggiateProb && PRNGManager.next() < (keysTrack.behavior.arpeggiateProb as number)) {
                        texture = "Arpeggio";
                    } else if (PRNGManager.next() < 0.15) { // 15% chance to use Riff texture
                        texture = "Riff";
                    }
                }
            } else {
                // Fallback for older structures
                playBass = hasBass && energy > 3;
                playChords = hasChords;
                if (PRNGManager.next() < 0.15) texture = "Riff";
            }

            const cmFam = palette.counterMelodySound !== null ? resolveInstrumentFamily(palette.counterMelodySound) : InstrumentFamily.Unknown;
            const isPad = cmFam === InstrumentFamily.Synth || cmFam === InstrumentFamily.String || cmFam === InstrumentFamily.Voice;
            
            if (hasCounterMelody) {
                if (isPad) {
                    playCounterMelody = energy > 2; // Pads come in early
                    if (!section.tracks && energy <= 3) texture = "Pad";
                } else {
                    playCounterMelody = energy >= 7; // Melodic counter comes in late
                }
            }

            // Special overrides based on section type
            if (section.type === SectionType.Break || section.type === SectionType.Breakdown) {
                playBass = false;
                playChords = true;
                playCounterMelody = true;
                texture = "Pad";
            } else if (section.type === SectionType.BuildUp) {
                playBass = true;
                playChords = true;
                playCounterMelody = true;
                texture = "Arpeggio";
            }

            // Removed old Role Subordination logic

            // 🌟 P2: 律动比例控制器 (Groove Ratio Controller) & Texture Allocation
            // 根据风格分配不同的 Groove Ratio
            if (!section.grooveRatio) {
                section.grooveRatio = params.orchestration?.grooveRatio ?? { foundation: 0.6, comping: 0.6, color: 0.5 }; // Default
            }

            // 使用 Groove Ratio 和 Texture Allocation 动态决定乐器开关和织体
            const ratio = section.grooveRatio;
            
            // 基础概率判断 (结合能量等级)
            const foundationProb = ratio.foundation * (energy / 10);
            const compingProb = ratio.comping * (energy / 10);
            const colorProb = ratio.color * (energy / 10);

            // 核心编排逻辑：纯曲式驱动
            if (section.type === SectionType.Break || section.type === SectionType.Breakdown) {
                playBass = false; playChords = true; playCounterMelody = true; texture = "Pad";
            } else if (section.type === SectionType.Verse || energy <= 4) {
                playBass = foundationProb > 0.6;
                playChords = true;
                texture = PRNGManager.next() > 0.5 ? "Arpeggio" : "Pad";
                playCounterMelody = false;
            } else if (section.type === SectionType.Chorus || energy >= 7) {
                playBass = true;
                playChords = true;
                texture = "Block";
                playCounterMelody = true;
            } else {
                playBass = foundationProb > 0.4; playChords = compingProb > 0.4; texture = colorProb > compingProb ? "Pad" : "Arpeggio";
            }

            sectionPlayStates[sectionIdx] = { playBass, playChords, playCounterMelody, texture };
        });

        let prevVoicing: number[] = [];

        track.chords.forEach((chord, i) => {
            const activeSection = track.sections.find(s => chord.startBeat >= s.startBeat && chord.startBeat < s.endBeat) || track.sections[0];
            // S-2 合规：构建 renderCtx，将 MusicContext 显式传入 TextureMapper，替代读取 GlobalContext 单例
            const renderCtx: TextureRenderContext = {
                bpm: context.bpm,
                keyOffset: context.keyOffset,
                tonality: context.tonality,
                timeSignature: context.timeSignature,
                activeSection,
            };

            const secName = activeSection.name;
            const energy = activeSection.energyLevel;
            const activeSectionIdx = track.sections.indexOf(activeSection);
            const state = sectionPlayStates[activeSectionIdx] ?? sectionPlayStates[0];
            
            // 🌟 智能编排逻辑 (Smart Arrangement Logic)
            let playBass = state.playBass;
            let playChords = state.playChords;
            let playCounterMelody = state.playCounterMelody;
            let texture = state.texture;
            const isNeoSoulOrRnB = false;

            // 🌟 旋律引导的和声替换 (Melody-Driven Reharmonization)
            const reharmProb = params.harmonyRules?.melodyDrivenReharmProbability ?? 0;
            if (reharmProb > 0 && PRNGManager.next() < reharmProb) {
                const overlappingMelody = melodyNotes.filter(n => n.onset >= chord.startBeat && n.onset < chord.endBeat && n.duration >= 0.5);
                if (overlappingMelody.length > 0) {
                    const rootPc = chord.root % 12;
                    let has9th = false, has11th = false, has13th = false;
                    for (const note of overlappingMelody) {
                        const interval = (note.pitch % 12 - rootPc + 12) % 12;
                        if (interval === 2) has9th = true;
                        // T-1 合规：使用精确等值比较代替子串匹配
                        if (interval === 5 && (chord.quality === ChordQuality.Minor || chord.quality === ChordQuality.Minor7 || chord.quality === ChordQuality.Minor9)) has11th = true;
                        if (interval === 9 && (chord.quality === ChordQuality.Dominant7 || chord.quality === ChordQuality.Dominant9 || chord.quality === ChordQuality.Dominant7Sus4)) has13th = true;
                    }

                    if (has13th && chord.quality === ChordQuality.Dominant7) {
                        chord.quality = ChordQuality.Dominant13;
                    } else if (has11th && (chord.quality === ChordQuality.Minor7 || chord.quality === ChordQuality.Minor9)) {
                        chord.quality = ChordQuality.Minor11;
                    } else if (has9th) {
                        if (chord.quality === ChordQuality.Major7) chord.quality = ChordQuality.Major9;
                        else if (chord.quality === ChordQuality.Minor7) chord.quality = ChordQuality.Minor9;
                        else if (chord.quality === ChordQuality.Dominant7) chord.quality = ChordQuality.Dominant9;
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
                const melodyInSecondHalf = melodyNotes.some(n => n.onset >= chordMidpoint && n.onset < chord.endBeat);
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

            if (activeSection.type === SectionType.Intro) {
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
                if (Math.abs(chord.startBeat - activeSection.startBeat) < 1e-6) {
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

            // T-1 合规：使用 InstrumentFamily 枚举替代 .includes() 字符串子串匹配
            if (palette.chordSound !== null && isGuitarFamily(palette.chordSound)) {
                texture = "Guitar_Strum";
            }

            if (palette.chordSound !== null && isPadLikeInstrument(palette.chordSound)) {
                const chordFam = resolveInstrumentFamily(palette.chordSound);
                const isVoiceOrString = chordFam === InstrumentFamily.Voice || chordFam === InstrumentFamily.String;
                if (energy >= 7 && !isVoiceOrString) {
                    texture = "Synth_Pulse";
                } else {
                    texture = "Pad";
                }
            }


            if (playBass) {
                // 如果前奏有贝斯，为了避免割裂感，Verse_1 不应该变得稀疏
                const isSparseSection = (activeSection.type === SectionType.Intro && !introHasBass) || activeSection.type === SectionType.Outro || (secName === 'Verse_1' && !introHasBass);
                const isSectionEnd = Math.abs(chord.endBeat - activeSection.endBeat) < 1e-6;
                const isBassSolo = playBass && !playChords;
                const nextChord = i < track.chords.length - 1 ? track.chords[i + 1] : undefined;
                const nextEnergyLevel = track.sections.find(s => s.startBeat >= activeSection.endBeat)?.energyLevel || energy;
                
                if (track.motifRole === 'Background' && track.processedUserMotif && track.processedUserMotif.length > 0) {
                    const chordKeyOffset = chord.keyOffset !== undefined ? chord.keyOffset : (track.keyOffset || 0); lhNotes.push(...MotifLooper.loopMotif(track.processedUserMotif, chord, track.tonality, 36 - chordKeyOffset, track.motifRole));
                } else {
                    lhNotes.push(...TextureMapper.generateBassLine(chord, energy, isSparseSection, isSectionEnd, params, melodyNotes, isBassSolo, undefined, nextChord, nextEnergyLevel, renderCtx));
                }
            }

            if (playCounterMelody) {
                // 如果副旋律乐器是铺底音色或合成器，则生成 Pad 或 Synth_Pulse 织体，否则生成副旋律
                if (track.motifRole === 'Middleground' && track.processedUserMotif && track.processedUserMotif.length > 0 && !playChords) {
                    // If Middleground motif is present and chords are not playing, put it here
                    const chordKeyOffset = chord.keyOffset !== undefined ? chord.keyOffset : (track.keyOffset || 0); counterMelodyNotes.push(...MotifLooper.loopMotif(track.processedUserMotif, chord, track.tonality, 60 - chordKeyOffset, track.motifRole));
                // T-1 合规：使用 InstrumentFamily 枚举替代 .includes() 字符串子串匹配
                } else if (palette.counterMelodySound !== null && isPadLikeInstrument(palette.counterMelodySound)) {
                    const cmCounterFam = resolveInstrumentFamily(palette.counterMelodySound);
                    const isVoiceOrString = cmCounterFam === InstrumentFamily.Voice || cmCounterFam === InstrumentFamily.String;
                    const counterTexture = (energy >= 7 && !isVoiceOrString) ? 'Synth_Pulse' : 'Pad';
                    const pianoStyle = 'block-chord';
                    counterMelodyNotes.push(...TextureMapper.generateChordTexture(chord, energy, counterTexture, false, false, melodyNotes, undefined, params, undefined, undefined, pianoStyle, renderCtx));
                } else {
                    counterMelodyNotes.push(...TextureMapper.generateCounterMelody(chord, energy, melodyNotes, params, renderCtx));
                }
            }

            if (playChords) {
                const nextChord = i < track.chords.length - 1 ? track.chords[i + 1] : undefined;
                const isSparseSection = activeSection.type === SectionType.Intro || activeSection.type === SectionType.Outro;
                const isSectionEnd = Math.abs(chord.endBeat - activeSection.endBeat) < 1e-6;
                const nextEnergyLevel = track.sections.find(s => s.startBeat >= activeSection.endBeat)?.energyLevel || energy;
                
                let chordNotes: NoteData[] = [];
                if (track.motifRole === 'Middleground' && track.processedUserMotif && track.processedUserMotif.length > 0) {
                    const chordKeyOffset = chord.keyOffset !== undefined ? chord.keyOffset : (track.keyOffset || 0); chordNotes = MotifLooper.loopMotif(track.processedUserMotif, chord, track.tonality, 60 - chordKeyOffset, track.motifRole);
                } else if (activeSection.type === SectionType.Intro && !!params.orchestration?.allowIntroRiffs && PRNGManager.next() < 0.5) {
                    // 🌟 针对特定风格的前奏 Riff
                    const scale = HarmonyCore.getSafeScalePitches(chord, track.tonality);
                    const rootNote = HarmonyCore.getChordTones(chord, 48)[0]; // C3 range
                    chordNotes = TextureMapper.generateSignatureRiff(scale, rootNote, chord.endBeat - chord.startBeat, chord.startBeat);
                } else if (texture === "Riff") {
                    chordNotes = TextureMapper.generateRiff(chord, energy, params, renderCtx);
                } else {
                    const pianoStyle = 'block-chord';
                    chordNotes = TextureMapper.generateChordTexture(
                        chord, energy, texture, isSparseSection, isSectionEnd, melodyNotes, nextChord, params, prevVoicing, nextEnergyLevel, pianoStyle, renderCtx
                    );
                }
                rhNotes.push(...chordNotes);
                
                // Update prevVoicing for the next chord
                if (chordNotes.length > 0) {
                    // Extract unique pitches from ALL chord notes generated for this chord, ignoring bass notes
                    const highNotes = chordNotes.filter(n => n.pitch >= 53);
                    if (highNotes.length > 0) {
                        // 去重后排序；sort 在整数上无 tie（pitch 唯一）
                        const pitchSet: number[] = [];
                        highNotes.forEach(n => { if (!pitchSet.includes(n.pitch)) pitchSet.push(n.pitch); });
                        prevVoicing = pitchSet.sort((a, b) => a - b);
                    }
                }
            }
        });

        if (hasDrums) {
            let hasFullGrooveStarted = false;
            track.sections.forEach((sec, index) => {
                let playDrums = true;
                let startBeat = sec.startBeat;
                
                if (sec.type === SectionType.Intro) {
                    playDrums = introHasDrums;
                    if (playDrums) {
                        startBeat = Math.max(sec.startBeat, drumEntryBeat);
                    }
                } else if (sec.type === SectionType.Verse) {
                    // 🌟 方案四：曲式驱动的织体突变 - 主歌省去主套鼓或极简
                    playDrums = sec.energyLevel > 3 || PRNGManager.next() > 0.5;
                } else if (sec.type === SectionType.Break || sec.type === SectionType.Breakdown) {
                    playDrums = sec.type !== SectionType.Breakdown; // Breakdown 绝对停鼓
                }
                
                // 🌟 戛然而止 (Hard Stop) 逻辑：只打一拍 Crash 和 Kick
                if (sec.endingType === 'hard_stop') {
                    drumNotes.push({ pitch: 49, onset: sec.startBeat, duration: 1, velocity: 1.0 }); // CRASH
                    drumNotes.push({ pitch: 36, onset: sec.startBeat, duration: 1, velocity: 1.0 }); // KICK
                    return; // 跳过常规鼓组生成
                }

                if (playDrums && startBeat < sec.endBeat) {
                    // 确保鼓组也吃当前的 GrooveDNA
                    const swingRatio = params.rhythm.swingRatio || 0.5;
                    const effectiveEnergy = sec.energyLevel;
                    const nextSec = track.sections[index + 1];
                    const nextEnergyLevel = nextSec ? nextSec.energyLevel : 3;
                    
                    // 如果当前段落能量大于2，或者前奏且下一个段落能量大于2，说明完整的 groove 已经开始
                    if (effectiveEnergy > 2 || (sec.type === SectionType.Intro && nextEnergyLevel > 2)) {
                        hasFullGrooveStarted = true;
                    }
                    
                    // 如果是鼓组 Solo 前奏，不应该被视为普通的 Intro（普通 Intro 只有踩镲）
                    const isDrumSoloIntro = introHasDrums && !introHasPiano && !introHasMelody;
                    const treatAsIntro = sec.type === SectionType.Intro && !isDrumSoloIntro;
                    
                    const drumStyle = 'steady';
                    // S-2 合规：构建鼓组专属 renderCtx
                    const drumRenderCtx: TextureRenderContext = {
                        bpm: context.bpm,
                        keyOffset: context.keyOffset,
                        tonality: context.tonality,
                        timeSignature: context.timeSignature,
                        activeSection: sec,
                    };
                    drumNotes.push(...TextureMapper.generateDrumGroove(startBeat, sec.endBeat, effectiveEnergy, treatAsIntro, sec.type === SectionType.Outro, params, swingRatio, nextEnergyLevel, hasFullGrooveStarted, sec.grooveRatio, drumStyle, [], drumRenderCtx));
                }
            });
        }

        // 🔄 动态角色互换 (Dynamic F-M-B Role Swapping) - REMOVED
        // 移除此逻辑以防止主旋律轨道变成和弦铺底 (Monophonic Lock)
        track.sections.forEach(sec => {
            // 🌟 尾奏渐弱处理 (Outro Fade Out)
            if (sec.type === SectionType.Outro) {
                const outroLength = sec.endBeat - sec.startBeat;
                
                // 决定尾奏模式 (Ending Behavior)
                // 1. Fade Out: 线性渐弱 (适合流行、R&B)
                // 2. Big Ring Out: 最后一小节重击主和弦并延音 (适合摇滚、电子)
                // 3. Stop Ending: 高能量直接切断
                let endingBehavior = 'FadeOut';
                if (sec.energyLevel >= 8) {
                    endingBehavior = 'StopEnding';
                } else {
                    const ringOutProb = params.orchestration?.outroRingOutProbability ?? 0.2;
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
                                    if (Math.abs(beatInBar) < 1e-6) {
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
                applyOutroBehavior(melodyNotes);
                applyOutroBehavior(secondaryMelodyNotes);
                applyOutroBehavior(drumNotes, true);
            }
        });

        TransitionEngine.applyBoundaries(track.sections, lhNotes, rhNotes, drumNotes, track.timeSignature[0], params);
        if (!hasDrums) drumNotes.length = 0; 

        // T-1 合规：使用 InstrumentFamily 枚举替代 .includes('Guitar') 字符串子串匹配
        const isGuitar = palette.chordSound !== null && isGuitarFamily(palette.chordSound);
        const swingRatio = params.rhythm.swingRatio || 0.5;
        const swingSubdivision = params.rhythm.swingSubdivision || 0.5;

        // Simple humanize: add tiny random onset offsets for natural feel
        const simpleHumanize = (notes: NoteData[]): NoteData[] => {
            return notes.map(n => ({
                ...n,
                onset: n.onset + (PRNGManager.next() - 0.5) * 0.02
            }));
        };

        const humanizedLH = simpleHumanize(lhNotes);
        const humanizedRH = simpleHumanize(rhNotes);
        const humanizedDrums = simpleHumanize(drumNotes);
        const humanizedCounterMelody = simpleHumanize(counterMelodyNotes);
        const humanizedMelody = simpleHumanize(melodyNotes);

        let finalVocalNotes = track.vocal ? [...track.vocal] : undefined;
        if (hasVocal && finalVocalNotes && finalVocalNotes.length > 0) {
            // P2: Vocal Harmony Module
            track.sections.forEach(sec => {
                const sectionMelody = finalVocalNotes!.filter(n => n.onset >= sec.startBeat && n.onset < sec.endBeat);
                const sectionChords = track.chords.filter(c => c.startBeat < sec.endBeat && c.endBeat > sec.startBeat);
                const harmonyNotes = TextureMapper.generateVocalHarmony(sectionMelody, sectionChords, params, sec.energyLevel, track.tonality, context.keyOffset);
                finalVocalNotes!.push(...harmonyNotes);
            });
        }
        const humanizedVocal = hasVocal && finalVocalNotes ? simpleHumanize(finalVocalNotes) : undefined;

        const humanizedSecondaryMelody = simpleHumanize(secondaryMelodyNotes);

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

        // 🌟 Zone Isolation Rules（在 applyOffset 之后执行，确保钳位在最终音高上生效）
        // 1. Bass must be between E1 (28) and B2 (47)
        humanizedLH.forEach(n => {
            while (n.pitch < 28) n.pitch += 12;
            while (n.pitch > 47) n.pitch -= 12;
        });
        // 2. PianoRH / Chord and CounterMelody must be >= C3 (48)
        const enforceC3 = (notes: NoteData[]) => {
            notes.forEach(n => {
                while (n.pitch < 48) n.pitch += 12;
            });
        };
        enforceC3(humanizedRH);
        enforceC3(humanizedCounterMelody);

        // 🌟 修复点：强制网格化 (Strict Quantization Mask)
        // Eurodance 等电子舞曲需要绝对精准的网格，禁用所有 Humanize 偏移
        if (params.rhythm.strictGrid) {
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
        const tempoCurves: TempoCurve[] = [];
        if (track.sections && track.sections.length > 0) {
            const lastSection = track.sections[track.sections.length - 1];
            if (lastSection.type === SectionType.Outro && lastSection.endingType !== 'hard_stop') {
                // 仅对适合渐慢的曲风生效
                if (!!params.orchestration?.allowRitardando) {
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

        // console.log(`[Orchestrator] BPM: ${track.bpm} | Key: ${actualKey} ${track.tonality} | TimeSig: ${track.timeSignature[0]}/${track.timeSignature[1]} | Instruments: ${usedInstruments}`);
        // console.log(`[Orchestrator] 🎹 Chords:`, track.chords);
        // console.log(`[Orchestrator] 🎼 Melody Notes:`, track.melody);
                // --- END LOGGING ---

        return {
            bpm: track.bpm, key: track.key, absoluteStartBeat: track.absoluteStartBeat,
            mixStyle: params.rhythm.strictGrid ? 'electro' : 'default',
            requireSidechain: params.orchestration.mixingPreferences?.requireSidechain ?? false,
            vocal: humanizedVocal, melody: humanizedMelody, secondaryMelody: isDuet ? humanizedSecondaryMelody : undefined, pianoLH: humanizedLH, pianoRH: humanizedRH, drums: hasDrums ? humanizedDrums : undefined,
            counterMelody: hasCounterMelody ? humanizedCounterMelody : undefined,
            palette, sections: track.sections, chords: track.chords, tempoCurves
        };
    }
}
