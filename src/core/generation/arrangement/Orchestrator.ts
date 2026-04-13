import { PRNGManager } from '../../utils/PRNG';
import { GeneratedTrack, ArrangedTrack, StyleConfig, NoteData, SectionMetadata, MusicContext, EnsembleDraft, MixingConfig, SectionType } from '../types';
import { TextureMapper } from './TextureMapper';
import { TransitionEngine } from './TransitionEngine';
import { GlobalContext } from '../GlobalContext';
import { HarmonyCore } from '../composing/HarmonyCore';
import { ToplineEngine } from '../composing/ToplineEngine';
import { MotifLooper } from './MotifLooper';

import { GlobalReviewer } from '../review/GlobalReviewer';
import { InstrumentIdiom } from '../performance/InstrumentIdiom';
import { getStyleConfig } from '../config/styles/StyleRegistry';
import { ENERGY } from '../config/EnergyThresholds';
import { AcousticEnvelope, InstrumentProfiles, getInstrumentIdByName } from '../config/InstrumentFlags';
import { sortAndDedupNumbers } from '../utils/Dedup';

// 兜底默认混音参数（当 StyleConfig.orchestration.mixingPreferences 字段缺失时使用）
// 仅作为安全防护，正式风格应在 StyleConfig 中配置完整的 mixingPreferences
const FALLBACK_MIXING: Required<{
    vocal: MixingConfig; lead: MixingConfig;
    pad: MixingConfig; accomp: MixingConfig; drums: MixingConfig; bass: MixingConfig;
}> = {
    vocal:           { pan: 0,    reverb: 0.4,  volume: 8 },
    lead:            { pan: 0,    reverb: 0.4,  volume: 4 },
    pad:             { pan: -0.4, reverb: 0.5,  volume: 1 },
    accomp:          { pan: 0.6,  reverb: 0.7,  volume: 3 },
    drums:           { pan: 0,    reverb: 0.1,  volume: 6 },
    bass:            { pan: 0,    reverb: 0,    volume: -1 },
};

// 浅拷贝 MixingConfig，避免 palette.mixing 与 StyleConfig 共享引用
function cloneMixing(src: MixingConfig | undefined, fallback: MixingConfig): MixingConfig {
    const base = src || fallback;
    return {
        pan: base.pan,
        reverb: base.reverb,
        volume: base.volume,
        delay: base.delay,
        chorus: base.chorus,
    };
}

export class Orchestrator {
    /**
     * 从 StyleConfig.orchestration.mixingPreferences 应用混音预设到 palette。
     * 之后再做 vocal-presence 运行时调整（vocal 不存在时 melody 居中提升）。
     */
    private static applyMixerState(palette: EnsembleDraft, style: StyleConfig) {
        if (!palette.mixing) {
            palette.mixing = {};
        }

        const prefs = style.orchestration.mixingPreferences || {};

        palette.mixing.vocal           = cloneMixing(prefs.vocal,           FALLBACK_MIXING.vocal);
        palette.mixing.lead            = cloneMixing(prefs.lead,            FALLBACK_MIXING.lead);
        palette.mixing.pad             = cloneMixing(prefs.pad,             FALLBACK_MIXING.pad);
        palette.mixing.accomp          = cloneMixing(prefs.accomp,          FALLBACK_MIXING.accomp);
        palette.mixing.drums           = cloneMixing(prefs.drums,           FALLBACK_MIXING.drums);
        palette.mixing.bass            = cloneMixing(prefs.bass,            FALLBACK_MIXING.bass);

        // 运行时调整：Vocal 存在时 lead 稍偏右让出中心，不存在时 lead 居中并提升音量
        if (!palette.vocalSound) {
            palette.mixing.lead!.volume = 6;
            palette.mixing.lead!.pan = 0;
        } else {
            palette.mixing.lead!.pan = 0.3;
        }
    }

    public static arrange(track: GeneratedTrack, styleId: number, context: MusicContext): ArrangedTrack {
        // 🌟 ACVE §5.1 — 模块入口快照点 C（arrange 开始时的 PRNG state）
        PRNGManager.recordSnapshot('C');
        const style = getStyleConfig(styleId);

        const bassNotes: NoteData[] =[];
        let accompNotes: NoteData[] = [];
        const drumNotes: NoteData[] =[];

        // Fallback instrument selection (PRNG-consumed for sequence alignment)
        let hasVocal = false;
        let vocalSound = undefined;

        // Consume PRNG slots to maintain sequence alignment with legacy code
        let _leadSound = 'Acoustic_Grand';       PRNGManager.next();
        let _accompSound = 'String_Ensemble_1';  PRNGManager.next();
        let _bassSound = 'Acoustic_Bass';        PRNGManager.next();
        let _drumSound = 'Standard_DrumKit';     PRNGManager.next();

        let _padSound: string | null = null;
        let hasPad = PRNGManager.next() > 0.3;
        PRNGManager.next(); // consume slot for padProbability check

        // pad defaults to null (no pad for now)

        const palette = track.preSelectedPalette || {
            vocalSound,
            leadSound: _leadSound,
            accompSound: _accompSound,
            bassSound: _bassSound,
            drumSound: _drumSound,
            padSound: _padSound
        };

        Orchestrator.applyMixerState(palette, style);

        let hasDrums = !!palette.drumSound;
        const hasAccomp = !!palette.accompSound;
        let hasBass = !!palette.bassSound;
        hasPad = !!palette.padSound;
        const padNotes: NoteData[] = [];

        const primaryMelodyRaw: NoteData[] = track.melody;

        // 🌟 InstrumentIdiom 演奏技法后处理：乐器特征 apply（连断奏、力度分层等）
        let idiomaticMelody: NoteData[] = InstrumentIdiom.apply([...primaryMelodyRaw], palette.leadSound || 'Acoustic_Grand', track.chords, style.orchestration?.idiomPreferences);

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
        let introPedalPoint = false; // ST-2: Pedal Point 持续音策略

        const introSection = track.sections.find(s => s.sectionType === SectionType.Intro);
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
            } else if (rand < 0.85) {
                // 🌟 贝斯主角 (Bass Riff Intro)
                introHasBass = true;
                introHasDrums = true;
                introHasPiano = false;
                introHasMelody = false;
                bassEntryBeat = introSection.startBeat;
                drumEntryBeat = introSection.startBeat + introLength / 2;
                pianoEntryBeat = introSection.endBeat;
                melodyEntryBeat = introSection.endBeat;
            } else if (rand < 0.93) {
                // 🌟 ST-2: 持续音悬念 (Pedal Point Intro)
                // 贝斯锁定在主音或属音不动，上方和弦正常变化，制造和声张力 + 期待感
                introHasBass = true;
                introHasPiano = true;
                introHasMelody = true;
                introPedalPoint = true;
                bassEntryBeat = introSection.startBeat;
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
            if (track.vocal) {
                track.vocal = track.vocal.filter(n => n.onset >= melodyEntryBeat);
            }
        }

        // 🌟 提取并简化副歌 Hook 作为前奏旋律 (Thematic Foreshadowing)
        if (introSection && PRNGManager.next() < 0.6) { // 60% chance to use foreshadowing intro
            const firstChorus = track.sections.find(s => s.sectionType === SectionType.Chorus);
            if (firstChorus) {
                // Get the full chorus melody (both primary and secondary) to extract a complete hook
                const fullChorusMelody = track.melody.filter(n => n.onset >= firstChorus.startBeat && n.onset < firstChorus.endBeat);
                const targetInstrument = 10; // Music Box
                const foreshadowingIntro = ToplineEngine.extractForeshadowingIntro(fullChorusMelody, targetInstrument, introSection.startBeat, firstChorus.startBeat);
                
                if (foreshadowingIntro.length > 0) {
                    // Remove existing intro melody if any
                    idiomaticMelody = idiomaticMelody.filter(n => n.onset >= introSection.endBeat);
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
        // C 可移植：用 index-aligned 数组取代 Map<SectionMetadata, ...>，section 索引即数组索引
        type SectionPlayState = {
            playBass: boolean, bassEntryBeat: number,
            playChords: boolean, chordsEntryBeat: number,
            playPad: boolean, padEntryBeat: number,
            playDrums: boolean, drumsEntryBeat: number,
            texture: string,
            densityMultiplier: number
        };
        const sectionPlayStates: SectionPlayState[] = [];

        // 🌟 Luis 的工程加码：生成全局乐器阈值 (Global Thresholds)
        const trackThresholds = {
            bass: 3 + PRNGManager.next() * 2,          // 3~5 之间进场
            drums: 4 + PRNGManager.next() * 2,         // 4~6 之间进场
            pad: 6 + PRNGManager.next() * 2,            // 6~8 之间进场
        };

        let prevSectionPlayBass = false;
        let prevSectionPlayDrums = false;

        track.sections.forEach(section => {
            const energy = section.energyLevel;
            
            // 🌟 动态阈值激活机制 (Dynamic Threshold Activation)
            let playBass = energy >= trackThresholds.bass;
            let playDrums = energy >= trackThresholds.drums;
            let playPad = energy >= trackThresholds.pad;
            let playChords = true; // 和声骨架通常一直存在
            let texture: any = "Block";

            // 💡 惯性保持（防止副歌后的小跌落导致乐器突然消失）
            if (prevSectionPlayBass && energy >= Math.floor(trackThresholds.bass) - 1) {
                playBass = true; 
            }
            if (prevSectionPlayDrums && energy >= Math.floor(trackThresholds.drums) - 1) {
                playDrums = true;
            }

            const isPadSound = palette.padSound?.includes('Pad') || palette.padSound?.includes('String') || palette.padSound?.includes('Voice') || palette.padSound?.includes('Synth') || palette.padSound?.includes('Choir');
            if (isPadSound && energy <= ENERGY.AMBIENT_MAX) {
                playPad = true; // Pad 可以在极低能量时作为铺底
            }

            // 纯数据驱动的织体分配 (Pure Data-Driven Texture Allocation)
            if (section.type === 'BuildUp') {
                playBass = true; playChords = true; playPad = true; texture = "Arpeggio";
            } else if (section.type === 'Break' || section.type === 'Breakdown') {
                playBass = false; playChords = true; playPad = true; texture = "Pad";
            } else if (section.type === 'Verse' || energy <= ENERGY.LOW_MAX) {
                texture = PRNGManager.next() > 0.5 ? "Arpeggio" : "Pad";
            } else if (section.type === 'Chorus' || section.type === 'Drop' || energy >= ENERGY.HIGH_MIN) {
                playBass = true;
                playChords = true;
                texture = "Block";
                playPad = true;
            } else {
                texture = PRNGManager.next() > 0.5 ? "Arpeggio" : "Block";
            }

            // 🌟 织体补偿法则 (Texture Compensation)
            // 如果鼓没进场，和声乐器必须承担打拍子的责任！
            let densityMultiplier = 1.0;
            if (!playDrums && !playBass && energy >= ENERGY.MEDIUM_MIN) {
                // 🌟 极简高能状态下的织体暴走 (Texture Overdrive)
                texture = PRNGManager.next() > 0.5 ? "Arpeggio" : "Pulsing";
                densityMultiplier = 2.0; // 触发 16 分音符狂飙
            } else if (!playDrums && energy >= ENERGY.LOW_MAX) {
                texture = "Rhythmic";
            }

            // 🌟 渐进式加法编曲 (Additive Arrangement)
            let bassEntryBeat = section.startBeat;
            let chordsEntryBeat = section.startBeat;
            let padEntryBeat = section.startBeat;
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
                // 副歌后半段突然加入 pad 推高潮
                if (PRNGManager.next() < 0.7) {
                    padEntryBeat = halfBeat;
                }
            }

            sectionPlayStates.push({
                playBass, bassEntryBeat,
                playChords, chordsEntryBeat,
                playPad, padEntryBeat,
                playDrums, drumsEntryBeat,
                texture, densityMultiplier
            });

            prevSectionPlayBass = playBass;
            prevSectionPlayDrums = playDrums;
        });

        let prevVoicing: number[] = [];

        track.chords.forEach((chord, i) => {
            // 一次 findIndex 同时拿到 section 和它在数组中的索引（C 可移植路径）
            let activeSectionIdx = track.sections.findIndex(s => chord.startBeat >= s.startBeat && chord.startBeat < s.endBeat);
            if (activeSectionIdx < 0) activeSectionIdx = 0;
            const activeSection = track.sections[activeSectionIdx];

            // 🌟 核心修复 2：伴奏组生成前，将黑板同步为当前段落专属的 GrooveDNA！
            // 这样贝斯和钢琴就会死死咬住当前主歌或副歌的律动，彻底解决"从头到尾一个样"的问题。
            GlobalContext.updateCurrentSlice(activeSection, chord, activeSection.grooveDNA ||[0, 1, 2, 3]);

            const secName = activeSection.name;
            const energy = activeSection.energyLevel;
            const state = sectionPlayStates[activeSectionIdx];
            
            // 🌟 智能编排逻辑 (Smart Arrangement Logic)
            let playBass = state.playBass && chord.startBeat >= state.bassEntryBeat;
            let playChords = state.playChords && chord.startBeat >= state.chordsEntryBeat;
            let playPad = state.playPad && chord.startBeat >= state.padEntryBeat;
            let playDrums = state.playDrums && chord.startBeat >= state.drumsEntryBeat;
            let texture = state.texture;
            let densityMultiplier = state.densityMultiplier || 1.0;

            // 🌟 极低算力下的史诗级听感黑客技巧：真空效应 (Vacuum Effect / Dropout)
            const sectionIndex = activeSectionIdx; // 复用上面已计算的索引，避免重复 findIndex
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
                playPad = false;

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
                        
                        accompNotes.push({
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
                if (playPad && energy < ENERGY.PEAK_MIN) {
                    playPad = false; // Reduce pad clutter unless high energy
                }
            }

            if (activeSection.sectionType === SectionType.Intro) {
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
                        bassNotes.push({ pitch: HarmonyCore.getChordTones(chord, 60)[0] - 12, onset: chord.startBeat, duration: 4, velocity: 1.0 });
                    }
                    if (playChords) {
                        const pitches = HarmonyCore.getChordTones(chord, 60);
                        pitches.forEach(p => {
                            accompNotes.push({ pitch: p, onset: chord.startBeat, duration: 4, velocity: 1.0 });
                        });
                    }
                }
                return; // 跳过常规生成
            }

            if (palette.accompSound && palette.accompSound.includes("Guitar")) {
                texture = "Guitar_Strum";
            }

            if (palette.accompSound && (palette.accompSound.includes("Synth") || palette.accompSound.includes("Pad") || palette.accompSound.includes("String") || palette.accompSound.includes("Voice"))) {
                // 流行电子合成器不需要古典钢琴的复杂加花和切分，保持简洁
                const isVoiceOrString = palette.accompSound.includes("Voice") || palette.accompSound.includes("String");
                if (energy >= ENERGY.HIGH_MIN && !isVoiceOrString) {
                    texture = "Synth_Pulse"; // 连续八分音符或简单的切分
                } else {
                    texture = "Pad"; // 长音铺底
                }
            }

            // localStyleOverride removed (pure computation mode)

            if (playBass) {
                // 如果前奏有贝斯，为了避免割裂感，Verse_1 不应该变得稀疏
                const bassSecType = activeSection.sectionType;
                const isFirstVerse = bassSecType === SectionType.Verse && activeSection.name === 'Verse_1';
                const isSparseSection =
                    (bassSecType === SectionType.Intro && !introHasBass) ||
                    bassSecType === SectionType.Outro ||
                    bassSecType === SectionType.PreOutro ||
                    (isFirstVerse && !introHasBass);
                const isSectionEnd = chord.endBeat === activeSection.endBeat;
                const isBassSolo = playBass && !playChords;
                const nextChord = i < track.chords.length - 1 ? track.chords[i + 1] : undefined;
                const nextEnergyLevel = track.sections.find(s => s.startBeat >= activeSection.endBeat)?.energyLevel || energy;
                
                if (track.motifRole === 'Background' && track.processedUserMotif && track.processedUserMotif.length > 0) {
                    // K-4: 禁止预补偿 keyOffset，由 applyOffset() 统一处理
                    bassNotes.push(...MotifLooper.loopMotif(track.processedUserMotif, chord, track.tonality, 36, track.motifRole));
                } else {
                    bassNotes.push(...TextureMapper.generateBassLine(chord, energy, isSparseSection, isSectionEnd, idiomaticMelody, isBassSolo, nextChord, nextEnergyLevel));
                }
            }

            if (playPad) {
                // 如果 pad 乐器是铺底音色或合成器，则生成 Pad 或 Synth_Pulse 织体，否则生成副旋律
                if (track.motifRole === 'Middleground' && track.processedUserMotif && track.processedUserMotif.length > 0 && !playChords) {
                    // If Middleground motif is present and chords are not playing, put it here
                    // K-4: 禁止预补偿 keyOffset，由 applyOffset() 统一处理
                    padNotes.push(...MotifLooper.loopMotif(track.processedUserMotif, chord, track.tonality, 60, track.motifRole));
                } else if (palette.padSound?.includes('Pad') || palette.padSound?.includes('String') || palette.padSound?.includes('Voice') || palette.padSound?.includes('Synth') || palette.padSound?.includes('Choir')) {
                    const isVoiceOrString = palette.padSound.includes('Voice') || palette.padSound.includes('String') || palette.padSound.includes('Choir');
                    const padTexture = (energy >= ENERGY.HIGH_MIN && !isVoiceOrString) ? 'Synth_Pulse' : 'Pad';
                    padNotes.push(...TextureMapper.generateChordTexture(chord, energy, padTexture, false, false, idiomaticMelody));
                } else {
                    padNotes.push(...TextureMapper.generateCounterMelody(chord, energy, idiomaticMelody, track.tonality));
                }
            }

            if (playChords) {
                const nextChord = i < track.chords.length - 1 ? track.chords[i + 1] : undefined;
                const activeSecType = activeSection.sectionType;
                const isSparseSection = activeSecType === SectionType.Intro || activeSecType === SectionType.Outro || activeSecType === SectionType.PreOutro;
                const isSectionEnd = chord.endBeat === activeSection.endBeat;
                const nextEnergyLevel = track.sections.find(s => s.startBeat >= activeSection.endBeat)?.energyLevel || energy;

                let chordNotes: NoteData[] = [];
                if (track.motifRole === 'Middleground' && track.processedUserMotif && track.processedUserMotif.length > 0) {
                    // K-4: 禁止预补偿 keyOffset，由 applyOffset() 统一处理
                    chordNotes = MotifLooper.loopMotif(track.processedUserMotif, chord, track.tonality, 60, track.motifRole);
                } else if (activeSecType === SectionType.Intro && PRNGManager.next() < 0.5) {
                    // 🌟 针对特定风格的前奏 Riff
                    const scale = HarmonyCore.getSafeScalePitches(chord, track.tonality);
                    const rootNote = HarmonyCore.getChordTones(chord, 48)[0]; // C3 range
                    chordNotes = TextureMapper.generateSignatureRiff(scale, rootNote, chord.endBeat - chord.startBeat, chord.startBeat);
                } else if (texture === "Riff") {
                    chordNotes = TextureMapper.generateRiff(chord, energy, track.tonality);
                } else {
                    chordNotes = TextureMapper.generateChordTexture(
                        chord, energy, texture, isSparseSection, isSectionEnd, idiomaticMelody, nextChord, prevVoicing, nextEnergyLevel
                    );
                }
                accompNotes.push(...chordNotes);

                // Update prevVoicing for the next chord
                if (chordNotes.length > 0) {
                    // Extract unique pitches from ALL chord notes generated for this chord, ignoring bass notes
                    const highNotes = chordNotes.filter(n => n.pitch >= 53);
                    if (highNotes.length > 0) {
                        // C 可移植：用专用 dedup 工具取代 Set
                        prevVoicing = sortAndDedupNumbers(highNotes.map(n => n.pitch));
                    }
                }
            }
        });

        // Merge secondary fill line into accomp
        if (hasAccomp) {
            const fillNotes = TextureMapper.generateSecondaryFillLine(primaryMelodyRaw, track.chords, track.tonality);
            accompNotes.push(...fillNotes);
        }

        // 🌟 和弦切分抢拍 — 由 StyleConfig.rhythm.chordAnticipation 驱动
        const chordAnticipation = style.rhythm?.chordAnticipation ?? 0;
        if (chordAnticipation > 1e-6 && accompNotes.length > 0) {
            const firstOnset = accompNotes[0].onset;
            for (let ni = 0; ni < accompNotes.length; ni++) {
                if (Math.abs(accompNotes[ni].onset - firstOnset) > 1e-6) {
                    accompNotes[ni].onset = Math.max(0, accompNotes[ni].onset - chordAnticipation);
                }
            }
        }

        if (hasDrums) {
            let hasFullGrooveStarted = false;
            track.sections.forEach((sec, index) => {
                let playDrums = true;
                let startBeat = sec.startBeat;
                
                if (sec.sectionType === SectionType.Intro) {
                    playDrums = introHasDrums;
                    if (playDrums) {
                        startBeat = Math.max(sec.startBeat, drumEntryBeat);
                    }
                } else if (sec.sectionType === SectionType.Verse) {
                    // 🌟 方案四：曲式驱动的织体突变 - 主歌省去主套鼓或极简
                    playDrums = sec.energyLevel > ENERGY.AMBIENT_MAX || PRNGManager.next() > 0.5;
                } else if (sec.sectionType === SectionType.Break) {
                    playDrums = true; // Break 仍可有鼓
                } else if (sec.sectionType === SectionType.Breakdown) {
                    playDrums = false; // Breakdown 绝对停鼓
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
                    const swingRatio = style.rhythm?.swingRatio ?? 0.5;
                    // 🌟 鼓组模式映射：从 StyleConfig.orchestration.idiomPreferences.drumStyle 映射到 pattern index
                    let drumPatternIndex = 0;
                    const ds = style.orchestration?.idiomPreferences?.drumStyle;
                    if (ds === 'high-energy') drumPatternIndex = 1;      // Four-on-the-floor
                    else if (ds === 'sparse') drumPatternIndex = 2;      // Lo-fi sparse
                    else if (ds === 'syncopated') drumPatternIndex = 3;  // Trap

                    const effectiveEnergy = sec.energyLevel;
                    const nextSec = track.sections[index + 1];
                    const nextEnergyLevel = nextSec ? nextSec.energyLevel : 3;

                    if (effectiveEnergy > 2 || (sec.sectionType === SectionType.Intro && nextEnergyLevel > 2)) {
                        hasFullGrooveStarted = true;
                    }

                    const isDrumSoloIntro = introHasDrums && !introHasPiano && !introHasMelody;
                    const treatAsIntro = sec.sectionType === SectionType.Intro && !isDrumSoloIntro;
                    const isOutroSec = sec.sectionType === SectionType.Outro || sec.sectionType === SectionType.PreOutro;

                    drumNotes.push(...TextureMapper.generateDrumGroove(startBeat, sec.endBeat, effectiveEnergy, treatAsIntro, isOutroSec, swingRatio, nextEnergyLevel, hasFullGrooveStarted, [], drumPatternIndex));
                }
            });
        }

        // �� ST-2: Pedal Point 后处理
        // 当 Intro 选中持续音策略时，将所有 Intro 区间内的 Bass 音符音高
        // 锁定到主音(I, 70%)或属音(V, 30%)。上方和弦正常变化，底部纹丝不动。
        if (introPedalPoint && introSection) {
            // K-4 合规：在相对空间计算 pedal pitch（主音=0, 属音=7），applyOffset 统一加 keyOffset
            const isPedalOnDominant = PRNGManager.next() < 0.3;
            const pedalPc = isPedalOnDominant ? 7 : 0; // 相对空间：主音(0) 或属音(7)
            // 找到 bass 音域内该 pitch class 的最佳音高（相对空间，applyOffset 后移到正确调号）
            let pedalPitch = pedalPc + 24; // C1 octave in relative space
            if (pedalPitch < 28) pedalPitch += 12;
            if (pedalPitch > 47) pedalPitch -= 12;

            for (let i = 0; i < bassNotes.length; i++) {
                if (bassNotes[i].onset >= introSection.startBeat - 1e-6 && bassNotes[i].onset < introSection.endBeat - 1e-6) {
                    bassNotes[i].pitch = pedalPitch;
                }
            }
        }

        // Rule 3.2: Bass-Kick 强拍对齐——贝斯高力度音吸附到最近 kick onset（±0.1 拍容差）
        const KICK_PITCH = 36;
        if (drumNotes.length > 0 && bassNotes.length > 0) {
            const kickOnsets: number[] = [];
            for (let di = 0; di < drumNotes.length; di++) {
                if (drumNotes[di].pitch === KICK_PITCH) kickOnsets.push(drumNotes[di].onset);
            }
            if (kickOnsets.length > 0) {
                for (let bi = 0; bi < bassNotes.length; bi++) {
                    if (bassNotes[bi].velocity >= 0.7) {
                        let nearestDist = 999, nearestKick = bassNotes[bi].onset;
                        for (let ki = 0; ki < kickOnsets.length; ki++) {
                            const d = Math.abs(kickOnsets[ki] - bassNotes[bi].onset);
                            if (d < nearestDist) { nearestDist = d; nearestKick = kickOnsets[ki]; }
                        }
                        if (nearestDist <= 0.1 && nearestDist > 1e-6) bassNotes[bi].onset = nearestKick;
                    }
                }
            }
        }

        track.sections.forEach(sec => {
            // 🌟 尾奏处理 (Outro Behavior) — 简化为 2 种干净策略
            if (sec.sectionType === SectionType.Outro || sec.sectionType === SectionType.PreOutro) {
                const outroLength = sec.endBeat - sec.startBeat;
                const beatsPerBar = track.timeSignature[0];

                // 50% TextureCollapse（乐器逐件退出）/ 50% FadeOut（全体渐弱）
                const useCollapse = PRNGManager.next() < 0.5;

                if (useCollapse) {
                    // 乐器逐件退出：鼓→贝斯→和弦→只留旋律
                    const outroBars = Math.max(1, outroLength / beatsPerBar);
                    const zoneBars = outroBars / 4;

                    const muteAfter = (notes: NoteData[], muteBeat: number) => {
                        for (let i = notes.length - 1; i >= 0; i--) {
                            if (notes[i].onset >= muteBeat - 1e-6 && notes[i].onset < sec.endBeat) {
                                notes.splice(i, 1);
                            }
                        }
                    };

                    muteAfter(drumNotes, sec.startBeat);                                 // 鼓立即退出
                    muteAfter(bassNotes, sec.startBeat + zoneBars * beatsPerBar);          // 贝斯 zone 1
                    muteAfter(accompNotes, sec.startBeat + zoneBars * 2 * beatsPerBar);      // 和弦 zone 2
                    muteAfter(padNotes, sec.startBeat + zoneBars * 2 * beatsPerBar);
                }

                // 全体力度渐弱（两种策略都应用）
                const fadeAll = (notes: NoteData[]) => {
                    for (let i = 0; i < notes.length; i++) {
                        if (notes[i].onset >= sec.startBeat && notes[i].onset < sec.endBeat) {
                            const progress = (notes[i].onset - sec.startBeat) / outroLength;
                            notes[i].velocity *= (1.0 - progress * 0.85);
                        }
                    }
                };
                fadeAll(idiomaticMelody);
                fadeAll(bassNotes);
                fadeAll(accompNotes);
                fadeAll(padNotes);
                fadeAll(drumNotes);
            }
        });

        // 🌟 Luis's Zone Isolation Rules
        // 1. Bass (bassNotes) must be between E1 (28) and B2 (47)
        bassNotes.forEach(n => {
            while (n.pitch < 28) n.pitch += 12;
            while (n.pitch > 47) n.pitch -= 12;
        });

        // 2. Accomp and Pad must be >= C3 (48)
        const enforceC3 = (notes: NoteData[]) => {
            notes.forEach(n => {
                while (n.pitch < 48) n.pitch += 12;
            });
        };
        enforceC3(accompNotes);
        enforceC3(padNotes);

        TransitionEngine.applyBoundaries(track.sections, bassNotes, accompNotes, drumNotes, track.timeSignature[0], style);
        if (!hasDrums) drumNotes.length = 0; 

        // 🌟 InstrumentIdiom 演奏技法后处理：articulation apply + humanize with swing
        const swingRatio = style.rhythm?.swingRatio ?? 0.5;
        const swingSubdivision = style.rhythm?.swingSubdivision ?? 0.5;
        const idiomPrefs = style.orchestration?.idiomPreferences || {};

        // Step 1: apply() — 乐器特征（连断奏、力度、换气等）
        const idiomaticBass = InstrumentIdiom.apply(bassNotes, 'Bass', track.chords, idiomPrefs);
        const idiomaticAccomp = InstrumentIdiom.apply(accompNotes, palette.accompSound || 'Acoustic_Grand', track.chords, idiomPrefs);
        const idiomaticDrums = InstrumentIdiom.apply(drumNotes, palette.drumSound || 'Standard_DrumKit', track.chords, idiomPrefs);
        const idiomaticPad = InstrumentIdiom.apply(padNotes, palette.padSound || 'Acoustic_Grand', track.chords, idiomPrefs);

        // Step 2: humanize() — swing + 时间/力度微偏移
        const humanizedBass = InstrumentIdiom.humanize(idiomaticBass, 'Bass', swingRatio, swingSubdivision, false, idiomPrefs);
        const humanizedAccomp = InstrumentIdiom.humanize(idiomaticAccomp, palette.accompSound || 'Acoustic_Grand', swingRatio, swingSubdivision, true, idiomPrefs);
        const humanizedDrums = InstrumentIdiom.humanize(idiomaticDrums, palette.drumSound || 'Standard_DrumKit', swingRatio, swingSubdivision, false, idiomPrefs);
        const humanizedPad = InstrumentIdiom.humanize(idiomaticPad, palette.padSound || 'Acoustic_Grand', swingRatio, swingSubdivision, true, idiomPrefs);

        // Lead = vocal if present, else instrumental melody
        const leadNotes = track.vocal && track.vocal.length > 0 ? [...track.vocal] : [...primaryMelodyRaw];
        const leadSound = track.vocal && track.vocal.length > 0 ? (palette.vocalSound || palette.leadSound || 'Acoustic_Grand') : (palette.leadSound || 'Acoustic_Grand');
        const humanizedLead = InstrumentIdiom.humanize(
            InstrumentIdiom.apply(leadNotes, leadSound, track.chords, idiomPrefs),
            leadSound, swingRatio, swingSubdivision, true, idiomPrefs
        );

        // Groove LFO Humanize（三角函数微时序，不影响 PRNG 序列）
        this.applyGrooveLFO(humanizedLead);
        this.applyGrooveLFO(humanizedBass);
        this.applyGrooveLFO(humanizedAccomp);
        this.applyGrooveLFO(humanizedPad);
        // 注意：鼓组不做 humanize，保持网格精准

        // 7. 全局对位检查与修复 (Global Counterpoint Review)
        GlobalReviewer.reviewCounterpoint(
            undefined,
            humanizedLead,
            humanizedPad,
            track.chords,
            track.tonality
        );

        const finalKeyOffset = track.keyOffset || 0;
        const applyOffset = (notes: NoteData[]) => { notes.forEach(n => { const activeChord = track.chords.find(c => n.onset >= c.startBeat && n.onset < c.endBeat) || track.chords[0]; const chordKeyOffset = activeChord.keyOffset !== undefined ? activeChord.keyOffset : finalKeyOffset; n.pitch += chordKeyOffset; }); };

        applyOffset(humanizedLead);
        applyOffset(humanizedBass);
        applyOffset(humanizedAccomp);
        applyOffset(humanizedPad);

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
            applyQuantization(humanizedLead);
            applyQuantization(humanizedBass);
            applyQuantization(humanizedAccomp);
            applyQuantization(humanizedPad);
            applyQuantization(humanizedDrums);
        }

        // 🌟 提案二：Ritardando 渐慢算法 (Non-linear tempo deceleration)
        const tempoCurves: any[] = [];
        if (track.sections && track.sections.length > 0) {
            const lastSection = track.sections[track.sections.length - 1];
            if ((lastSection.sectionType === SectionType.Outro || lastSection.sectionType === SectionType.PreOutro) && lastSection.endingType !== 'hard_stop') {
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
            `Lead: ${palette.leadSound}`,
            `Accomp: ${palette.accompSound}`,
            `Bass: ${palette.bassSound}`,
            hasPad ? `Pad: ${palette.padSound}` : null,
            hasDrums ? `Drums: ${palette.drumSound}` : null
        ].filter(Boolean).join(' | ');

        const actualKey = track.key;

        // console.log(`[Orchestrator] 🎵 Style: ${style.id} | BPM: ${track.bpm} | Key: ${actualKey} ${track.tonality} | TimeSig: ${track.timeSignature[0]}/${track.timeSignature[1]} | Instruments: ${usedInstruments}`);
        // console.log(`[Orchestrator] 🎹 Chords:`, track.chords);
        // console.log(`[Orchestrator] 🎼 Melody Notes:`, track.melody);
                // --- END LOGGING ---

        // ============================================================
        // 🌟 乐器物理约束后处理 (Instrument Idiom Post-Processing)
        // ============================================================

        // --- Sustained 乐器 Idiom：短音过滤 + 单声部 + 精确衔接 + 力度平滑 ---
        const applySustainedIdiom = (notes: NoteData[], sound: string | null | undefined) => {
            if (!sound || notes.length === 0) return;
            const profile = InstrumentProfiles[getInstrumentIdByName(sound)];
            const velCap = profile.maxVelocity / 127;
            for (let ni = 0; ni < notes.length; ni++) {
                if (notes[ni].velocity > velCap) notes[ni].velocity = velCap;
            }
            if (profile.envelope !== AcousticEnvelope.Sustained) return;
            // 过滤短音
            for (let ni = notes.length - 1; ni >= 0; ni--) {
                if (notes[ni].duration < 0.5) notes.splice(ni, 1);
            }
            // 单声部强制
            notes.sort((a, b) => Math.abs(a.onset - b.onset) < 0.01 ? b.pitch - a.pitch : a.onset - b.onset);
            for (let ni = notes.length - 1; ni >= 1; ni--) {
                if (Math.abs(notes[ni].onset - notes[ni - 1].onset) < 0.01) notes.splice(ni, 1);
            }
            // 精确衔接（0.02 拍间隙）
            for (let ni = 0; ni < notes.length - 1; ni++) {
                const idealEnd = notes[ni + 1].onset - 0.02;
                if (notes[ni].onset + notes[ni].duration > idealEnd) {
                    notes[ni].duration = Math.max(0.1, idealEnd - notes[ni].onset);
                }
            }
            // 力度平滑
            for (let ni = 1; ni < notes.length; ni++) {
                const maxDiff = Math.abs(notes[ni].pitch - notes[ni - 1].pitch) >= 7 ? 0.024 : 0.05;
                const diff = notes[ni].velocity - notes[ni - 1].velocity;
                if (Math.abs(diff) > maxDiff) {
                    notes[ni].velocity = notes[ni - 1].velocity + (diff > 0 ? maxDiff : -maxDiff);
                }
            }
        };
        applySustainedIdiom(padNotes, palette.padSound);

        // --- Lead 声部按乐器包络分流 ---
        const leadProfile = palette.leadSound ? InstrumentProfiles[getInstrumentIdByName(palette.leadSound)] : null;
        if (leadProfile && leadProfile.envelope === AcousticEnvelope.Sustained) {
            applySustainedIdiom(humanizedLead, palette.leadSound);
        } else if (leadProfile && leadProfile.envelope === AcousticEnvelope.Plucked) {
            // Plucked Lead：截短长音 + 大跳后力度补偿
            const maxSustain = 1.5; // Plucked 乐器最大有效发声拍数
            for (let ni = 0; ni < humanizedLead.length; ni++) {
                if (humanizedLead[ni].duration > maxSustain) {
                    humanizedLead[ni].duration = maxSustain;
                }
                // 力度上限
                const velCap = leadProfile.maxVelocity / 127;
                if (humanizedLead[ni].velocity > velCap) humanizedLead[ni].velocity = velCap;
                // 大跳后力度补偿：下行 ≥ 纯五度（7 半音）时目标音力度 +20%
                if (ni > 0) {
                    const interval = humanizedLead[ni - 1].pitch - humanizedLead[ni].pitch;
                    if (interval >= 7) {
                        humanizedLead[ni].velocity = Math.min(velCap, humanizedLead[ni].velocity * 1.2);
                    }
                }
            }
        } else {
            // 其他包络（Pad 等）：仅做力度上限
            if (leadProfile) {
                const velCap = leadProfile.maxVelocity / 127;
                for (let ni = 0; ni < humanizedLead.length; ni++) {
                    if (humanizedLead[ni].velocity > velCap) humanizedLead[ni].velocity = velCap;
                }
            }
        }

        // --- Plucked 乐器 Idiom：和弦滚奏 + 智能踏板 + 旋律避让力度 ---
        const applyPluckedIdiom = (notes: NoteData[], sound: string | null | undefined, melodyRef: NoteData[]) => {
            if (!sound || notes.length === 0) return;
            const profile = InstrumentProfiles[getInstrumentIdByName(sound)];
            if (profile.envelope !== AcousticEnvelope.Plucked) return;
            const velCap = profile.maxVelocity / 127;
            // 和弦滚奏
            notes.sort((a, b) => Math.abs(a.onset - b.onset) < 0.01 ? a.pitch - b.pitch : a.onset - b.onset);
            let groupStart = 0;
            for (let ni = 0; ni <= notes.length; ni++) {
                const isNew = ni === notes.length || Math.abs(notes[ni].onset - notes[groupStart].onset) > 0.01;
                if (isNew && ni - groupStart >= 2) {
                    const roll = 0.015 + PRNGManager.next() * 0.015;
                    for (let gi = groupStart; gi < ni; gi++) notes[gi].onset += (gi - groupStart) * roll;
                }
                if (ni < notes.length && isNew) groupStart = ni;
            }
            // 力度限制 + 旋律避让
            for (let ni = 0; ni < notes.length; ni++) {
                if (notes[ni].velocity > velCap) notes[ni].velocity = velCap;
                let melDensity = 0;
                for (let mi = 0; mi < melodyRef.length; mi++) {
                    if (melodyRef[mi].onset >= notes[ni].onset - 0.5 && melodyRef[mi].onset < notes[ni].onset + 1.0) melDensity++;
                }
                if (melDensity >= 2) notes[ni].velocity *= 0.7;
            }
        };
        applyPluckedIdiom(accompNotes, palette.accompSound, humanizedLead);

        // Rule 4.1: 并发声部密度限制器——超过 MAX_CONCURRENT 时削掉低优先级声部的短音
        const MAX_CONCURRENT = 8;
        if (track.sections.length > 0) {
            const songEnd = track.sections[track.sections.length - 1].endBeat;
            const lowPri: NoteData[][] = [];
            if (humanizedPad.length > 0) lowPri.push(humanizedPad);
            for (let beat = 0; beat < songEnd; beat += 0.5) {
                const beatEnd = beat + 0.5;
                let total = 0;
                const all = [humanizedLead, humanizedBass, humanizedAccomp, humanizedDrums, humanizedPad];
                for (let ti = 0; ti < all.length; ti++) {
                    for (let ni = 0; ni < all[ti].length; ni++) {
                        if (all[ti][ni].onset < beatEnd && all[ti][ni].onset + all[ti][ni].duration > beat) total++;
                    }
                }
                if (total > MAX_CONCURRENT) {
                    for (let ti = 0; ti < lowPri.length && total > MAX_CONCURRENT; ti++) {
                        for (let ni = lowPri[ti].length - 1; ni >= 0 && total > MAX_CONCURRENT; ni--) {
                            if (lowPri[ti][ni].onset >= beat && lowPri[ti][ni].onset < beatEnd && lowPri[ti][ni].duration < 0.5) {
                                lowPri[ti].splice(ni, 1); total--;
                            }
                        }
                    }
                }
            }
        }

        // 🌟 ST-3: Filter Build-up 决策
        // 25% 概率让 Intro 启用低通涌动（CC74 从闷到亮），但不适用于鼓 Solo Intro
        const isDrumSoloIntroFinal = introHasDrums && !introHasPiano && !introHasMelody;
        const useFilterSweep = introSection && !isDrumSoloIntroFinal && PRNGManager.next() < 0.25;

        return {
            bpm: track.bpm, key: track.key, absoluteStartBeat: track.absoluteStartBeat,
            styleId,
            lead: humanizedLead,
            accomp: hasAccomp ? humanizedAccomp : undefined,
            bass: humanizedBass,
            drums: hasDrums ? humanizedDrums : undefined,
            pad: hasPad ? humanizedPad : undefined,
            palette, sections: track.sections, chords: track.chords, tempoCurves,
            introFilterSweep: useFilterSweep,
            userMotif: track.processedUserMotif,
            globalRiff: track.globalRiff,
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
