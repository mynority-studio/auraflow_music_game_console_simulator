import { PRNGManager } from '../../utils/PRNG';
import { GeneratedTrack, ArrangedTrack, StyleConfig, NoteData, SectionMetadata, MusicContext, EnsembleDraft, InstrumentBehavior } from '../types';
import { TextureMapper } from './TextureMapper';
import { TransitionEngine } from './TransitionEngine';
import { GlobalContext } from '../GlobalContext'; // 新增引用
import { HarmonyCore } from '../composing/HarmonyCore';
import { ToplineEngine } from '../composing/ToplineEngine';
import { MotifLooper } from './MotifLooper';

import { GlobalReviewer } from '../review/GlobalReviewer';
import { StyleId, DefaultStyleConfig } from '../config/StyleFlags';

import { PianoIdiom } from '../idioms/PianoIdiom';
import { BassIdiom } from '../idioms/BassIdiom';
import { IdiomContext } from '../idioms/BaseIdiom';

export class Orchestrator {
    private static applyMixerState(palette: EnsembleDraft, style: StyleConfig) {
        if (!palette.mixing) {
            palette.mixing = {};
        }

        // 🌟 Static Gain Cascading (Strict Acoustic Tier System)
        // Establish an insurmountable volume hierarchy to prevent clipping
        palette.mixing.vocal = { pan: 0, reverb: 0.7, volume: 10 };          // Tier 1
        palette.mixing.drums = { pan: 0, reverb: 0.1, volume: 8 };           // Tier 2
        palette.mixing.bass = { pan: 0, reverb: 0.3, volume: 6 };            // Tier 3
        palette.mixing.melody = { pan: 0, reverb: 0.6, volume: 4 };          // Tier 4
        palette.mixing.secondaryMelody = { pan: 0, reverb: 0.6, volume: 2 }; // Tier 4.5
        palette.mixing.chord = { pan: 0, reverb: 0.65, volume: -2 };         // Tier 5
        palette.mixing.counterMelody = { pan: 0, reverb: 0.5, volume: -6 };  // Tier 6

        // Apply data-driven mixing preferences from style config (but ensure they don't break the tier completely)
        if (style.orchestration?.mixingPreferences) {
            const prefs = style.orchestration.mixingPreferences;
            if (prefs.melody && palette.mixing.melody) Object.assign(palette.mixing.melody, prefs.melody);
            if (prefs.chord && palette.mixing.chord) Object.assign(palette.mixing.chord, prefs.chord);
            if (prefs.bass && palette.mixing.bass) Object.assign(palette.mixing.bass, prefs.bass);
            if (prefs.drums && palette.mixing.drums) Object.assign(palette.mixing.drums, prefs.drums);
            if (prefs.counterMelody && palette.mixing.counterMelody) Object.assign(palette.mixing.counterMelody, prefs.counterMelody);
            if (prefs.vocal && palette.mixing.vocal) Object.assign(palette.mixing.vocal, prefs.vocal);
            if (prefs.secondaryMelody && palette.mixing.secondaryMelody) Object.assign(palette.mixing.secondaryMelody, prefs.secondaryMelody);
        }

        // Dynamic Foreground / Midground based on Vocal presence
        if (!palette.vocalSound) {
            palette.mixing.melody!.pan = 0;
            if (!style.orchestration?.mixingPreferences?.melody?.volume) {
                palette.mixing.melody!.volume = 8; // Boost melody if no vocal
            }
        } else {
            palette.mixing.melody!.pan = 0.3;
        }

        // Instrument-specific volume compensation
        if (palette.melodySound === 'Violin') palette.mixing.melody!.volume! -= 6;
        else if (palette.melodySound === 'Acoustic_Grand') palette.mixing.melody!.volume! += 2;

        if (palette.counterMelodySound === 'Violin') palette.mixing.counterMelody!.volume! -= 6;
        else if (palette.counterMelodySound === 'Acoustic_Grand') palette.mixing.counterMelody!.volume! += 2;

        if (palette.chordSound === 'Violin') palette.mixing.chord!.volume! -= 3;
        else if (palette.chordSound === 'Acoustic_Grand') palette.mixing.chord!.volume! += 2;

        if (palette.bassSound === 'Acoustic_Grand') palette.mixing.bass!.volume! += 6;

        // 🌟 修复点：无论什么曲风，主旋律强制居中，保证声场稳定
        if (palette.mixing.melody && palette.mixing.melody.pan === undefined) palette.mixing.melody.pan = 0.1;
        if (palette.mixing.bass) palette.mixing.bass.pan = 0;
        if (palette.mixing.drums) palette.mixing.drums.pan = 0;

        // Balance Panning (Dynamic Acoustic Seesaw)
        const activeTracks = [];
        if (palette.mixing.chord) activeTracks.push({ role: 'Chord', mix: palette.mixing.chord });
        if (palette.mixing.counterMelody) activeTracks.push({ role: 'CounterMelody', mix: palette.mixing.counterMelody });
        if (palette.mixing.secondaryMelody) activeTracks.push({ role: 'SecondaryMelody', mix: palette.mixing.secondaryMelody });

        const accompTracks = activeTracks.filter(t => t.mix.pan === undefined);
        
        let leftWeight = 0;
        let rightWeight = 0;
        
        accompTracks.forEach((track) => {
            // Always assign to the side with less weight to prevent frequency masking
            if (leftWeight <= rightWeight) {
                const panValue = -0.3 - (leftWeight * 0.2); // -0.3, -0.5, -0.7
                track.mix.pan = Math.max(panValue, -0.8);
                leftWeight++;
            } else {
                const panValue = 0.3 + (rightWeight * 0.2); // 0.3, 0.5, 0.7
                track.mix.pan = Math.min(panValue, 0.8);
                rightWeight++;
            }
            
            if (track.role === 'Pad' || track.role === 'Chord') {
                track.mix.chorus = style.orchestration?.mixingPreferences?.chorusDepth ?? 80;
            }
        });
    }

    /**
     * Velocity Curve — 段落级力度曲线
     *
     * 每个段落内部的音符力度按位置乘以一个弧形曲线：
     * - 段落开头 10%：弱起（×0.75→1.0 渐入）
     * - 段落中段 70%：正常（×1.0，小幅正弦波动 ±5%）
     * - 段落结尾 20%：渐弱或渐强取决于下一段能量
     *
     * 不消耗 PRNG（纯确定性数学函数），不影响管道确定性。
     */
    private static applyVelocityCurves(notes: NoteData[], sections: SectionMetadata[]): void {
        if (notes.length === 0 || sections.length === 0) return;

        for (const n of notes) {
            // 找到音符所在段落
            let sec: SectionMetadata | null = null;
            let secIdx = 0;
            for (let s = 0; s < sections.length; s++) {
                if (n.onset >= sections[s].startBeat && n.onset < sections[s].endBeat) {
                    sec = sections[s]; secIdx = s; break;
                }
            }
            if (!sec) continue;

            const secLen = sec.endBeat - sec.startBeat;
            if (secLen < 1) continue;
            const progress = (n.onset - sec.startBeat) / secLen; // 0.0 → 1.0

            let curve = 1.0;

            // 弱起区 (0~10%)：渐入
            if (progress < 0.1) {
                curve = 0.75 + (progress / 0.1) * 0.25; // 0.75 → 1.0
            }
            // 中段 (10~80%)：微小正弦波动
            else if (progress < 0.8) {
                const midProgress = (progress - 0.1) / 0.7;
                curve = 1.0 + Math.sin(midProgress * Math.PI * 2) * 0.05; // ±5%
            }
            // 结尾区 (80~100%)：看下一段能量
            else {
                const tailProgress = (progress - 0.8) / 0.2; // 0→1
                const nextSec = sections[secIdx + 1];
                if (nextSec && nextSec.energyLevel > sec.energyLevel) {
                    // 下一段更高能 → 渐强冲刺
                    curve = 1.0 + tailProgress * 0.15; // 1.0 → 1.15
                } else {
                    // 下一段更低能或结尾 → 渐弱
                    curve = 1.0 - tailProgress * 0.2; // 1.0 → 0.8
                }
            }

            n.velocity = Math.max(1, Math.min(127, n.velocity * curve));
        }
    }

    private static enforceInstrumentLimits(notes: NoteData[], behavior?: InstrumentBehavior) {
        if (!behavior) return;
        const [minPitch, maxPitch] = behavior.pitchRange;
        const [minVel, maxVel] = behavior.velocityRange;

        notes.forEach(note => {
            // 🌟 音区折叠法则 (Octave Folding)：如果不达标，强行移八度，绝不删音符
            while (note.pitch < minPitch) note.pitch += 12;
            while (note.pitch > maxPitch) note.pitch -= 12;

            // 🌟 力度线性映射 (Velocity Scaling)
            // 处理 0.0-1.0 和 0-127 两种输入范围
            const normalizedVel = note.velocity <= 1.0 ? note.velocity : note.velocity / 127.0;
            const scaledVel = minVel + normalizedVel * (maxVel - minVel);
            // 转换为 MIDI 0-127 范围
            note.velocity = Math.max(1, Math.min(127, Math.round(scaledVel))); 
        });
    }

    public static arrange(track: GeneratedTrack, styleId: StyleId, context: MusicContext): ArrangedTrack {
        // 自动记录快照
        const startState = PRNGManager.getState();
        const style = DefaultStyleConfig;
        
        const lhNotes: NoteData[] =[]; 
        let rhNotes: NoteData[] = []; 
        const drumNotes: NoteData[] =[]; 

        const pick = (arr: string[]) => arr[Math.floor(PRNGManager.next() * arr.length)];

        // 1. Vocal
        let hasVocal = PRNGManager.next() < (style.orchestration?.vocalProbability ?? 0.5);
        let vocalSound = hasVocal ? pick(['Flute', 'Electric_Piano_1']) : undefined;

        // 2. Lead
        let melodySound = pick(style.orchestration.melodyInstruments);

        // 3. Chord / Accompaniment
        let chordSound = pick(style.orchestration.chordInstruments);

        // 4. Bass
        let bassSound = pick(style.orchestration.bassInstruments);

        // 5. Drums
        let drumSound = pick(style.orchestration.drumInstruments);

        // 6. Counter Melody / Pad / Arp / Choir
        let counterMelodySound: string | null = null;
        let hasCounterMelody = PRNGManager.next() > 0.3;
        if (style.orchestration?.counterMelodyProbability !== undefined) {
            hasCounterMelody = PRNGManager.next() < style.orchestration.counterMelodyProbability;
        }
        
        if (hasCounterMelody) {
            counterMelodySound = pick(style.orchestration.counterMelodyInstruments);
        }

        const palette = track.preSelectedPalette || {
            vocalSound,
            melodySound,
            chordSound,
            bassSound,
            drumSound,
            counterMelodySound
        };

        Orchestrator.applyMixerState(palette, style);

        let hasDrums = !!palette.drumSound;
        const hasChords = !!palette.chordSound;
        let hasBass = !!palette.bassSound;
        hasCounterMelody = !!palette.counterMelodySound;
        const counterMelodyNotes: NoteData[] = [];

        // 🌟 聚光灯交接算法 (Spotlight Handoff Algorithm)
        let primaryMelodyRaw: NoteData[] = [];
        let secondaryMelodyRaw: NoteData[] = [];
        let finalVocalRaw: NoteData[] = [];

        const isVocalTrackPresent = !!track.vocal && !!palette.vocalSound;
        const handoffSections = ['Intro', 'Interlude', 'Outro', 'Solo'];
        const hasHandoffSections = track.sections.some(s => handoffSections.some(hs => s.name.includes(hs)));

        // 🌟 第一层：段落级舞台交接 (Section-Level Spotlight Handoff)
        // 如果没有副旋律乐器，但有交接段落，强制分配一个副旋律乐器
        if (!isVocalTrackPresent && hasHandoffSections && !palette.secondaryMelodySound) {
            const available = style.orchestration?.melodyInstruments.filter(i => i !== palette.melodySound) || [];
            if (available.length > 0) {
                palette.secondaryMelodySound = available[Math.floor(PRNGManager.next() * available.length)];
            } else {
                palette.secondaryMelodySound = 'Saxophone'; // Fallback
            }
        }

        const isGlobalDuet = !!(palette.secondaryMelodySound && palette.secondaryMelodySound !== palette.melodySound);
        const hasTradingFours = !!style.orchestration?.allowTradingFours && track.sections.some(s => s.name.includes('Solo'));
        const isDuet = isGlobalDuet || hasTradingFours || !!palette.secondaryMelodySound;

        // 🌟 第二层：人声与器乐的智能避让 (Vocal-Instrumental Avoidance)
        if (isVocalTrackPresent && track.vocal) {
            track.vocal.forEach(note => {
                const activeSection = track.sections.find(s => note.onset >= s.startBeat && note.onset < s.endBeat) || track.sections[0];
                const isHandoffSection = handoffSections.some(hs => activeSection.name.includes(hs));
                
                if (isHandoffSection) {
                    // 人声休息，主奏乐器接管人声的旋律线
                    primaryMelodyRaw.push(note);
                } else {
                    // 人声正常演唱
                    finalVocalRaw.push(note);
                }
            });
        }

        // 处理器乐旋律 (伴奏旋律或纯器乐主旋律)
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
            const isHandoffSection = handoffSections.some(hs => activeSection.name.includes(hs));
            
            let assignToPrimary = isPrimary;
            
            if (isVocalTrackPresent) {
                // 如果有人声，track.melody 是伴奏旋律
                if (isHandoffSection) {
                    // 交接段落中，主奏乐器已经接管了人声的旋律线，所以伴奏旋律交给副旋律乐器（如果存在）
                    assignToPrimary = false;
                } else {
                    // 正常段落，主奏乐器作为伴奏
                    assignToPrimary = true;
                }
            } else {
                // 纯器乐模式
                if (isHandoffSection && isDuet) {
                    // 交接段落，主奏乐器休息，副旋律乐器接管
                    assignToPrimary = false;
                } else if (hasTradingFours && activeSection.name.includes('Solo')) {
                    // Trading Fours: 每 4 小节切换一次乐器
                    const beatsPerBar = track.timeSignature[0];
                    const barsSinceSectionStart = Math.floor((firstNoteOnset - activeSection.startBeat) / beatsPerBar);
                    const fourBarChunkIndex = Math.floor(barsSinceSectionStart / 4);
                    assignToPrimary = (fourBarChunkIndex % 2 === 0);
                } else if (!isGlobalDuet) {
                    // 非全局 Duet，且非交接段落，全部给主旋律
                    assignToPrimary = true;
                }
            }

            if (assignToPrimary) {
                primaryMelodyRaw.push(...phrase);
            } else {
                if (isDuet) {
                    secondaryMelodyRaw.push(...phrase);
                } else {
                    primaryMelodyRaw.push(...phrase); // Fallback
                }
            }
            
            if (isGlobalDuet && !isHandoffSection && !isVocalTrackPresent) {
                isPrimary = !isPrimary; // 在正常段落中交替乐句
            }
        });

        const secondarySound = palette.secondaryMelodySound || null;

        let idiomaticMelody: NoteData[] = primaryMelodyRaw;
        const idiomPrefsWithSections = { sections: track.sections };

        let idiomaticSecondaryMelody = isDuet && secondarySound ? secondaryMelodyRaw : [];

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
        // P-1: array indexed by section index instead of Map<SectionMetadata, ...>
        const sectionPlayStates: Array<{
            playBass: boolean, bassEntryBeat: number,
            playChords: boolean, chordsEntryBeat: number,
            playCounterMelody: boolean, counterMelodyEntryBeat: number,
            playDrums: boolean, drumsEntryBeat: number,
            texture: string,
            densityMultiplier: number
        } | null> = new Array(track.sections.length).fill(null);

        // 🌟 Luis 的工程加码：生成全局乐器阈值 (Global Thresholds)
        const trackThresholds = {
            bass: 3 + PRNGManager.next() * 2,          // 3~5 之间进场
            drums: 4 + PRNGManager.next() * 2,         // 4~6 之间进场
            counterMelody: 3 + PRNGManager.next() * 2, // 3~5 之间进场（降低门槛，让 pad 铺底更早出现）
        };

        let prevSectionPlayBass = false;
        let prevSectionPlayDrums = false;

        track.sections.forEach((section, sectionIdx) => {
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

            const cmSound = (palette.counterMelodySound || '').toLowerCase();
            const isPadLike = cmSound.includes('pad') || cmSound.includes('string') || cmSound.includes('voice') || cmSound.includes('synth') || cmSound.includes('choir') || cmSound.includes('cello') || cmSound.includes('oboe');
            if (isPadLike) {
                playCounterMelody = true; // Pad/弦乐类乐器在任何能量级别都可以作为铺底
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

            sectionPlayStates[sectionIdx] = {
                playBass, bassEntryBeat,
                playChords, chordsEntryBeat,
                playCounterMelody, counterMelodyEntryBeat,
                playDrums, drumsEntryBeat,
                texture, densityMultiplier
            };

            prevSectionPlayBass = playBass;
            prevSectionPlayDrums = playDrums;
        });

        let prevVoicing: number[] = [];

        track.chords.forEach((chord, i) => {
            const sectionIndex = track.sections.findIndex(s => chord.startBeat >= s.startBeat && chord.startBeat < s.endBeat);
            const activeSection = sectionIndex >= 0 ? track.sections[sectionIndex] : track.sections[0];
            
            // 🌟 核心修复 2：伴奏组生成前，将黑板同步为当前段落专属的 GrooveDNA！
            // 这样贝斯和钢琴就会死死咬住当前主歌或副歌的律动，彻底解决“从头到尾一个样”的问题。
            GlobalContext.updateCurrentSlice(activeSection, chord, activeSection.grooveDNA ||[0, 1, 2, 3]);

            const secName = activeSection.name;
            const energy = activeSection.energyLevel;
            const state = sectionPlayStates[sectionIndex]!;
            
            // 🌟 智能编排逻辑 (Smart Arrangement Logic)
            let playBass = state.playBass && chord.startBeat >= state.bassEntryBeat;
            let playChords = state.playChords && chord.startBeat >= state.chordsEntryBeat;
            let playCounterMelody = state.playCounterMelody && chord.startBeat >= state.counterMelodyEntryBeat;
            let playDrums = state.playDrums && chord.startBeat >= state.drumsEntryBeat;
            let texture = state.texture;
            let densityMultiplier = state.densityMultiplier || 1.0;

            // 🌟 极低算力下的史诗级听感黑客技巧：真空效应 (Vacuum Effect / Dropout)
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
            const isNeoSoulOrRnB = false;

            // 🌟 旋律引导的和声替换 (Melody-Driven Reharmonization)
            const reharmProb = style.harmonyRules?.melodyDrivenReharmProbability ?? 0;
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

            const currentStyleConfig = style;

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
                    const bassIdiom = new BassIdiom();
                    const bassContext: IdiomContext = {
                        chord,
                        energyLevel: energy,
                        playBass,
                        playDrums,
                        melodyNotes: idiomaticMelody,
                        densityMultiplier: 1.0,
                        styleConfig: currentStyleConfig,
                        musicContext: context,
                        textureType: 'Bass',
                        isSparseSection,
                        isSectionEnd,
                        nextChord
                    };
                    lhNotes.push(...bassIdiom.generate(bassContext));
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
                    const pianoStyle = 'block-chord';
                    counterMelodyNotes.push(...TextureMapper.generateChordTexture(chord, energy, counterTexture, false, false, idiomaticMelody, undefined, currentStyleConfig, undefined, undefined, pianoStyle, 1.0, playBass));
                } else {
                    counterMelodyNotes.push(...TextureMapper.generateCounterMelody(chord, energy, idiomaticMelody, currentStyleConfig, track.tonality, secName));
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
                } else if (secName.includes("Intro") && !!style.orchestration?.allowIntroRiffs && PRNGManager.next() < 0.5) {
                    // 🌟 针对特定风格的前奏 Riff
                    const scale = HarmonyCore.getSafeScalePitches(chord, track.tonality);
                    const rootNote = HarmonyCore.getChordTones(chord, 48)[0]; // C3 range
                    chordNotes = TextureMapper.generateSignatureRiff(scale, rootNote, chord.endBeat - chord.startBeat, chord.startBeat);
                } else if (texture === "Riff") {
                    chordNotes = TextureMapper.generateRiff(chord, energy, currentStyleConfig);
                } else {
                    // 🌟 使用 PianoIdiom 插件生成钢琴织体
                    const pianoIdiom = new PianoIdiom();
                    chordNotes = pianoIdiom.generate({
                        chord,
                        energyLevel: energy,
                        playBass,
                        playDrums,
                        melodyNotes: idiomaticMelody,
                        prevVoicing,
                        densityMultiplier,
                        styleConfig: currentStyleConfig,
                        textureType: texture
                    });
                }
                rhNotes.push(...chordNotes);
                
                // Update prevVoicing for the next chord
                if (chordNotes.length > 0) {
                    // Extract unique pitches from ALL chord notes generated for this chord, ignoring bass notes
                    const highNotes = chordNotes.filter(n => n.pitch >= 53);
                    if (highNotes.length > 0) {
                        // P-1: dedup sorted array without Set
                    const pitches = highNotes.map(n => n.pitch);
                    pitches.sort((a, b) => a - b);
                    const dedupedPitches: number[] = [];
                    for (let pi = 0; pi < pitches.length; pi++) {
                        if (pi === 0 || pitches[pi] !== pitches[pi - 1]) dedupedPitches.push(pitches[pi]);
                    }
                    prevVoicing = dedupedPitches;
                    }
                }
            }
        });

        if (hasDrums) {
            let hasFullGrooveStarted = false;
            track.sections.forEach((sec, index) => {
                const state = sectionPlayStates[index];
                let playDrums = state ? state.playDrums : true;
                let startBeat = state ? state.drumsEntryBeat : sec.startBeat;
                
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
                    const swingRatio = style.rhythm.swingRatio || 0.5;
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
                    
                    const currentStyleConfig = style;
                    const drumStyle = 'steady';
                    const rawDrumNotes = TextureMapper.generateDrumGroove(startBeat, sec.endBeat, effectiveEnergy, treatAsIntro, sec.name.includes('Outro'), currentStyleConfig, swingRatio, nextEnergyLevel, hasFullGrooveStarted, sec.grooveRatio, drumStyle, [], context.moodId || 0);
                    
                    // 🌟 极低算力下的史诗级听感黑客技巧：真空效应 (Vacuum Effect / Dropout)
                    // 如果下一个段落是超级爆发 (能量差 >= 3)，拦截最后 1~2 拍的鼓点
                    const energyDelta = nextSec ? (nextSec.energyLevel - sec.energyLevel) : 0;
                    if (energyDelta >= 3) {
                        const vacuumStartBeat = sec.endBeat - 2; // 最后两拍
                        drumNotes.push(...rawDrumNotes.filter(n => n.onset < vacuumStartBeat));
                    } else {
                        drumNotes.push(...rawDrumNotes);
                    }
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
                    const ringOutProb = style.orchestration?.outroRingOutProbability ?? 0.2;
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

        TransitionEngine.applyBoundaries(track.sections, lhNotes, rhNotes, drumNotes, track.timeSignature[0], style);
        if (!hasDrums) drumNotes.length = 0; 

        const isGuitar = !!(palette.chordSound && palette.chordSound.includes('Guitar'));
        const swingRatio = style.rhythm.swingRatio || 0.5;
        const swingSubdivision = style.rhythm.swingSubdivision || 0.5;

        const humanizedLH = lhNotes;
        const humanizedRH = rhNotes;
        const humanizedDrums = drumNotes;
        const humanizedCounterMelody = counterMelodyNotes;
        const humanizedMelody = idiomaticMelody;
        
        let finalVocalNotes = hasVocal ? finalVocalRaw : undefined;
        const humanizedVocal = finalVocalNotes;
        
        const humanizedSecondaryMelody = idiomaticSecondaryMelody;

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

        // 🌟 Rhythmic Hocketing (Rhythm Interlocking)
        // Avoid frequency masking by separating Bass and Chords in time
        humanizedLH.forEach(bassNote => {
            // Check if bass is on a strong beat (downbeat or upbeat, i.e., 0, 1, 2, 3)
            if (Math.abs(bassNote.onset % 1) < 1e-6) {
                // Find chord notes that hit at the exact same time
                for (let i = humanizedRH.length - 1; i >= 0; i--) {
                    const chordNote = humanizedRH[i];
                    if (Math.abs(chordNote.onset - bassNote.onset) < 0.05) {
                        // Shift chord note to the offbeat (+0.5)
                        chordNote.onset += 0.5;
                        // Reduce duration to prevent overlapping
                        chordNote.duration = Math.max(0.25, chordNote.duration - 0.5);
                    }
                }
            }
        });

        // 🌟 Absolute Frequency Banding (Strict Zone Isolation)
        // 1. Bass (lhNotes) must be between E1 (28) and B2 (47)
        humanizedLH.forEach(n => {
            while (n.pitch < 28) n.pitch += 12;
            while (n.pitch > 47) n.pitch -= 12;
        });

        // 2. Chords (rhNotes) must be between C3 (48) and B4 (71)
        humanizedRH.forEach(n => {
            while (n.pitch < 48) n.pitch += 12;
            while (n.pitch > 71) n.pitch -= 12;
        });

        // 3. Melody & CounterMelody must be between C4 (60) and C6 (84)
        const enforceMelodyBand = (notes: NoteData[]) => {
            notes.forEach(n => {
                while (n.pitch < 60) n.pitch += 12;
                while (n.pitch > 84) n.pitch -= 12;
            });
        };
        enforceMelodyBand(humanizedMelody);
        enforceMelodyBand(humanizedSecondaryMelody);
        enforceMelodyBand(humanizedCounterMelody);

        // 🌟 修复点：强制网格化 (Strict Quantization Mask)
        // Eurodance 等电子舞曲需要绝对精准的网格，禁用所有 Humanize 偏移
        if (style.rhythm.strictGrid) {
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
                if (!!style.orchestration?.allowRitardando) {
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

        // 🌟 Apply Instrument Limits
        if (style.orchestration?.instrumentBehaviors) {
            const behaviors = style.orchestration.instrumentBehaviors;
            Orchestrator.enforceInstrumentLimits(humanizedMelody, behaviors.melody);
            if (isDuet) Orchestrator.enforceInstrumentLimits(humanizedSecondaryMelody, behaviors.secondaryMelody);
            Orchestrator.enforceInstrumentLimits(humanizedLH, behaviors.bass);
            Orchestrator.enforceInstrumentLimits(humanizedRH, behaviors.chord);
            if (hasCounterMelody) Orchestrator.enforceInstrumentLimits(humanizedCounterMelody, behaviors.counterMelody);
        }

        // 🌟 Velocity Curve — 段落级力度曲线（弱起→渐强→收尾渐弱）
        // 对所有乐器统一应用，让整首曲子有"呼吸感"
        Orchestrator.applyVelocityCurves(humanizedMelody, track.sections);
        if (humanizedVocal) Orchestrator.applyVelocityCurves(humanizedVocal, track.sections);
        Orchestrator.applyVelocityCurves(humanizedSecondaryMelody, track.sections);
        Orchestrator.applyVelocityCurves(humanizedLH, track.sections);
        Orchestrator.applyVelocityCurves(humanizedRH, track.sections);
        Orchestrator.applyVelocityCurves(humanizedCounterMelody, track.sections);
        Orchestrator.applyVelocityCurves(humanizedDrums, track.sections);

        return {
            bpm: track.bpm, key: track.key, absoluteStartBeat: track.absoluteStartBeat,
            styleId: style.id,
            vocal: humanizedVocal, melody: humanizedMelody, secondaryMelody: isDuet ? humanizedSecondaryMelody : undefined, pianoLH: humanizedLH, pianoRH: humanizedRH, drums: hasDrums ? humanizedDrums : undefined,
            counterMelody: hasCounterMelody ? humanizedCounterMelody : undefined,
            palette, sections: track.sections, chords: track.chords, tempoCurves
        };
    }
}
