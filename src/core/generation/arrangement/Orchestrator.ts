import { globalPRNG } from '../../utils/PRNG';
import { GeneratedTrack, ArrangedTrack, StyleConfig, NoteData, SectionMetadata } from '../types';
import { TextureMapper } from './TextureMapper';
import { TransitionEngine } from './TransitionEngine';
import { InstrumentIdiom } from '../performance/InstrumentIdiom';
import { GlobalContext } from '../GlobalContext'; // 新增引用
import { HarmonyCore } from '../composing/HarmonyCore';
import { MotifLooper } from './MotifLooper';

export class Orchestrator {
    public static arrange(track: GeneratedTrack, style: StyleConfig): ArrangedTrack {
        const lhNotes: NoteData[] =[]; 
        let rhNotes: NoteData[] = []; 
        const drumNotes: NoteData[] =[]; 

        const isElectronic = style.id.includes('house') || style.id.includes('edm') || style.id.includes('synthwave') || style.id.includes('pop');
        const isAcoustic = style.id.includes('folk') || style.id.includes('bossa') || style.id.includes('jazz') || style.id.includes('lofi');
        const isCinematic = style.id.includes('cinematic') || style.id.includes('ghibli') || style.id.includes('post_rock');
        const isRock = style.id.includes('rock');

        const pick = (arr: string[]) => arr[Math.floor(globalPRNG.next() * arr.length)];

        // 1. Vocal
        let hasVocal = globalPRNG.next() < (style.orchestration?.vocalProbability ?? 0.5);
        let vocalSound = hasVocal ? 'Marimba' : undefined;

        // 2. Lead
        let melodySound = 'Acoustic_Grand';
        if (isElectronic) melodySound = pick(['Lead_2_Sawtooth', 'Electric_Piano_1']);
        else if (isCinematic) melodySound = pick(['Violin', 'Flute', 'Acoustic_Grand']);
        else if (isAcoustic) melodySound = pick(['Alto_Sax', 'Electric_Piano_1', 'Acoustic_Grand']);
        else melodySound = pick(['Acoustic_Grand', 'Electric_Piano_1', 'Violin', 'Flute', 'Alto_Sax', 'Lead_2_Sawtooth']);

        // 3. Chord / Accompaniment
        let chordSound = 'Acoustic_Grand';
        if (isElectronic) chordSound = pick(['Synth_Strings_1', 'Electric_Guitar_Clean']);
        else if (isCinematic) chordSound = pick(['String_Ensemble_1', 'Acoustic_Grand']);
        else if (isAcoustic) chordSound = pick(['Acoustic_Guitar_Steel', 'Acoustic_Grand']);
        else if (isRock) chordSound = pick(['Electric_Guitar_Clean', 'Acoustic_Guitar_Steel']);
        else chordSound = pick(['Acoustic_Grand', 'Acoustic_Guitar_Steel', 'Electric_Guitar_Clean', 'String_Ensemble_1', 'Synth_Strings_1', 'Choir_Aahs', 'Voice_Oohs']);

        // 4. Bass
        let bassSound = 'Electric_Bass_Finger';
        if (isElectronic) bassSound = pick(['Synth_Bass_1', 'Synth_Bass_2']);
        else if (isCinematic || style.id.includes('folk')) bassSound = 'Acoustic_Bass';
        else if (isRock) bassSound = pick(['Electric_Bass_Finger', 'Synth_Bass_2']);
        else bassSound = pick(['Acoustic_Bass', 'Electric_Bass_Finger']);

        // 5. Drums
        let drumSound = 'Standard_DrumKit';
        if (isElectronic) drumSound = pick(['TR808_DrumKit', 'Electronic_DrumKit']);
        else drumSound = 'Standard_DrumKit';

        // 6. Counter Melody / Pad / Arp / Choir
        let counterMelodySound: string | null = null;
        if (globalPRNG.next() > 0.3) {
            if (isElectronic) counterMelodySound = pick(['Pad_2_Warm', 'Marimba', 'Voice_Oohs']);
            else if (isCinematic) counterMelodySound = pick(['Pad_1_NewAge', 'Pizzicato_Strings', 'Choir_Aahs', 'Voice_Oohs']);
            else if (isAcoustic) counterMelodySound = pick(['Vibraphone', 'Pad_1_NewAge', 'Voice_Oohs']);
            else counterMelodySound = pick(['Pad_1_NewAge', 'Pad_2_Warm', 'Vibraphone', 'Marimba', 'Pizzicato_Strings', 'Choir_Aahs', 'Voice_Oohs']);
        }

        const palette = track.preSelectedPalette || {
            vocalSound,
            melodySound,
            chordSound,
            bassSound,
            drumSound,
            counterMelodySound
        };

        if (!palette.mixing) {
            palette.mixing = {
                melody: { pan: 0.1, reverb: 0.6, volume: 4, delay: 0.2 }, // Widen melody slightly, more reverb/delay to push it back
                secondaryMelody: { pan: 0.5, reverb: 0.6, volume: 2 },
                vocal: { pan: 0, reverb: 0.7, volume: 8 }, // Vocal in center, loudest, more reverb
                chord: { pan: -0.5, reverb: 0.65, volume: 8 }, // Move chord wider to left, increased volume
                bass: { pan: 0, reverb: 0.3, volume: 0 }, // Bass louder (was -4)
                drums: { pan: 0, reverb: 0.1, volume: 6 }, // Drums louder (was 4)
                counterMelody: { pan: 0.6, reverb: 0.5, volume: -6 }, // Move counter melody wider to right
            };
            
            // Dynamic Foreground / Midground based on Vocal presence
            if (palette.vocalSound) {
                palette.mixing.vocal = { pan: 0, reverb: 0.7, volume: 10 }; // Vocal takes absolute C-position
                palette.mixing.melody.pan = 0.3; // Melody moves to Midground
                palette.mixing.melody.volume = 2; // Melody gets quieter
            } else {
                palette.mixing.melody.pan = 0; // Melody takes C-position
                palette.mixing.melody.volume = 8;
                palette.mixing.melody.reverb = 0.7;
            }

            if (palette.melodySound === 'Violin') {
                palette.mixing.melody.volume -= 6; // Lower violin volume
            } else if (palette.melodySound === 'Acoustic_Grand') {
                palette.mixing.melody.volume += 6; // Increase acoustic grand volume
            }

            // Adjust pad volumes: Counter melody pads can be louder, background pads (chord) should be quieter
            const isCounterMelodyPad = palette.counterMelodySound?.includes('Pad') || palette.counterMelodySound?.includes('String') || palette.counterMelodySound?.includes('Voice') || palette.counterMelodySound?.includes('Synth') || palette.counterMelodySound?.includes('Choir');
            if (isCounterMelodyPad) {
                palette.mixing.counterMelody.volume = -2; // Louder for pad in counter melody
            } else {
                palette.mixing.counterMelody.volume = -6; // Normal counter melody volume
            }
            if (palette.counterMelodySound === 'Violin') {
                palette.mixing.counterMelody.volume -= 6;
            } else if (palette.counterMelodySound === 'Acoustic_Grand') {
                palette.mixing.counterMelody.volume += 6;
            }

            const isChordPad = palette.chordSound?.includes('Pad') || palette.chordSound?.includes('String') || palette.chordSound?.includes('Voice') || palette.chordSound?.includes('Synth') || palette.chordSound?.includes('Choir');
            if (isChordPad) {
                palette.mixing.chord.volume = 2; // Increased volume for background pad
            }
            if (palette.chordSound === 'Violin') {
                palette.mixing.chord.volume -= 3; // Less reduction for violin
            } else if (palette.chordSound === 'Acoustic_Grand') {
                palette.mixing.chord.volume += 8; // More increase for acoustic grand
            }

            if (palette.bassSound === 'Acoustic_Grand') {
                palette.mixing.bass!.volume += 6;
            }
            
            // Adjust based on style
            if (style.id.includes('lofi')) {
                palette.mixing.melody!.reverb = 0.5;
                palette.mixing.chord!.pan = -0.25;
                palette.mixing.chord!.reverb = 0.7;
                palette.mixing.drums!.reverb = 0.1;
            } else if (style.id.includes('cinematic') || style.id.includes('ghibli') || style.id.includes('post_rock')) {
                palette.mixing.melody!.reverb = 0.8;
                palette.mixing.melody!.delay = 0.4;
                palette.mixing.chord!.reverb = 0.9;
                palette.mixing.drums!.reverb = 0.2;
                palette.mixing.bass!.reverb = 0.35;
                palette.mixing.chord!.pan = -0.25; // Left-front further
                palette.mixing.counterMelody!.pan = -0.6;
                palette.mixing.counterMelody!.delay = 0.3;
            } else if (style.id.includes('jazz')) {
                palette.mixing.melody!.pan = 0.2; // Widen lead right
                palette.mixing.chord!.pan = -0.25; // Piano left-front
                palette.mixing.chord!.reverb = 0.6;
                palette.mixing.bass!.pan = 0.1;
                palette.mixing.bass!.reverb = 0.3;
                palette.mixing.drums!.pan = 0;
                palette.mixing.drums!.reverb = 0.1;
            } else if (style.id.includes('bossa') || style.id.includes('latin')) {
                palette.mixing.melody!.pan = 0.15;
                palette.mixing.chord!.pan = -0.25; // Guitar/Piano left-front
                palette.mixing.chord!.reverb = 0.5;
                palette.mixing.bass!.pan = 0.1;
                palette.mixing.bass!.reverb = 0.25;
                palette.mixing.drums!.reverb = 0.1;
            } else if (style.id.includes('house') || style.id.includes('progressive') || style.id.includes('edm') || style.id.includes('synthwave')) {
                // Progressive House / EDM / Synthwave specific atmospheric mix
                palette.mixing.melody!.pan = 0.15;
                palette.mixing.melody!.reverb = 0.8;
                palette.mixing.melody!.delay = 0.5;
                palette.mixing.chord!.pan = -0.25; // Left-front
                palette.mixing.chord!.reverb = 0.85;
                palette.mixing.drums!.reverb = 0.2;
                palette.mixing.bass!.reverb = 0.25;
                palette.mixing.counterMelody!.pan = -0.6;
                palette.mixing.counterMelody!.reverb = 0.7;
            } else if (style.id.includes('electronic') || style.id.includes('pop')) {
                palette.mixing.melody!.pan = 0.15;
                palette.mixing.melody!.reverb = 0.5;
                palette.mixing.melody!.delay = 0.2;
                palette.mixing.chord!.pan = -0.25; // Left-front
                palette.mixing.chord!.reverb = 0.6;
                palette.mixing.counterMelody!.pan = -0.6;
                palette.mixing.drums!.reverb = 0.15;
                palette.mixing.bass!.reverb = 0.25;
            } else if (style.id.includes('funk')) {
                palette.mixing.chord!.pan = -0.25; // Move to left-front
                palette.mixing.chord!.reverb = 0.4;
                palette.mixing.bass!.pan = 0;
                palette.mixing.drums!.reverb = 0.1;
            } else if (style.id.includes('rock')) {
                palette.mixing.melody!.pan = 0.1;
                palette.mixing.melody!.reverb = 0.4;
                palette.mixing.chord!.pan = -0.25; // Guitars left-front
                palette.mixing.chord!.reverb = 0.5;
                palette.mixing.counterMelody!.pan = -0.6; // Counter melody (lead guitar) wide right
                palette.mixing.bass!.reverb = 0.2;
                palette.mixing.drums!.reverb = 0.2;
            }
        }

        let hasDrums = !!palette.drumSound;
        const hasChords = !!palette.chordSound;
        let hasBass = !!palette.bassSound;
        let hasCounterMelody = !!palette.counterMelodySound;
        const counterMelodyNotes: NoteData[] = [];

        // 🌟 双重主音编排 (Dual Lead Orchestration)
        let primaryMelodyRaw: NoteData[] = [];
        let secondaryMelodyRaw: NoteData[] = [];
        const isDuet = !!(palette.secondaryMelodySound && palette.secondaryMelodySound !== palette.melodySound);

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
                if (isPrimary) {
                    primaryMelodyRaw.push(...phrase);
                } else {
                    secondaryMelodyRaw.push(...phrase);
                }
                isPrimary = !isPrimary;
            });
        } else {
            primaryMelodyRaw = track.melody;
        }

        const secondarySound = palette.secondaryMelodySound || null;

        let idiomaticMelody: NoteData[] = [];
        const idiomPrefsWithSections = { ...style.orchestration?.idiomPreferences, sections: track.sections };
        idiomaticMelody = InstrumentIdiom.apply(primaryMelodyRaw, palette.melodySound, track.chords, idiomPrefsWithSections);

        let idiomaticSecondaryMelody = isDuet && secondarySound ? InstrumentIdiom.apply(secondaryMelodyRaw, secondarySound, track.chords, idiomPrefsWithSections) : [];

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
            const rand = globalPRNG.next();
            
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
        }

        // 🌟 Phase 1 & 2: Use decoupled TrackState to determine instrument entry and texture
        const sectionPlayStates = new Map<SectionMetadata, { playBass: boolean, playChords: boolean, playCounterMelody: boolean, texture: string }>();

        track.sections.forEach(section => {
            const energy = section.energyLevel;
            
            let playBass = false;
            let playChords = false;
            let playCounterMelody = false;
            let texture: any = "Block";
            
            // Read from decoupled tracks if available
            if (section.tracks) {
                const bassTrack = section.tracks.find(t => t.id === 'trk_bass');
                const keysTrack = section.tracks.find(t => t.id === 'trk_keys');
                
                if (bassTrack && hasBass) {
                    playBass = energy >= bassTrack.activeEnergyThreshold;
                }
                if (keysTrack && hasChords) {
                    playChords = energy >= keysTrack.activeEnergyThreshold;
                    if (keysTrack.behavior.arpeggiateProb && globalPRNG.next() < (keysTrack.behavior.arpeggiateProb as number)) {
                        texture = "Arpeggio";
                    } else if (globalPRNG.next() < 0.15) { // 15% chance to use Riff texture
                        texture = "Riff";
                    }
                }
            } else {
                // Fallback for older structures
                playBass = hasBass && energy > 3;
                playChords = hasChords;
                if (globalPRNG.next() < 0.15) texture = "Riff";
            }

            const isPad = palette.counterMelodySound?.includes('Pad') || palette.counterMelodySound?.includes('String') || palette.counterMelodySound?.includes('Voice') || palette.counterMelodySound?.includes('Synth') || palette.counterMelodySound?.includes('Choir');
            
            if (hasCounterMelody) {
                if (isPad) {
                    playCounterMelody = energy > 2; // Pads come in early
                    if (!section.tracks && energy <= 3) texture = "Pad";
                } else {
                    playCounterMelody = energy >= 7; // Melodic counter comes in late
                }
            }

            // Special overrides based on section type
            if (section.type === 'Break' || section.type === 'Breakdown') {
                playBass = false;
                playChords = true;
                playCounterMelody = true;
                texture = "Pad";
            } else if (section.type === 'BuildUp') {
                playBass = true;
                playChords = true;
                playCounterMelody = true;
                texture = "Arpeggio";
            }

            // 🌟 解决“听感太赶”与“风格打架”：角色降级 (Role Subordination)
            if (energy <= 4) {
                // 低能量段落，强制伴奏转为 Pad 铺底，留出呼吸空间
                texture = "Pad";
            } else if (energy >= 7 && hasDrums && hasBass) {
                // 高能量段落，如果鼓和贝斯很活跃，伴奏乐器（如钢琴）降级为简单的 Block 或 Riff，避免频段冲突和节奏打架
                if (texture === "Arpeggio" || texture === "Rhythmic") {
                    texture = globalPRNG.next() > 0.5 ? "Block" : "Riff";
                }
            }

            sectionPlayStates.set(section, { playBass, playChords, playCounterMelody, texture });
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
            let playBass = state.playBass;
            let playChords = state.playChords;
            let playCounterMelody = state.playCounterMelody;
            let texture = state.texture;

            const isNeoSoulOrRnB = activeSection.localStyleOverride?.includes('neo_soul') || style.id.includes('neo_soul') || style.id.includes('rnb');

            // 🌟 旋律引导的和声替换 (Melody-Driven Reharmonization)
            if (isNeoSoulOrRnB && globalPRNG.next() < 0.6) {
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
                        texture = globalPRNG.next() > 0.5 ? 'Rhythmic' : 'Arpeggio';
                    }
                }
            }

            // 🌟 乐器化 Call and Response (Fills)
            if (isNeoSoulOrRnB && globalPRNG.next() < 0.5) {
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

            if (playBass) {
                // 如果前奏有贝斯，为了避免割裂感，Verse_1 不应该变得稀疏
                const isSparseSection = (secName.includes("Intro") && !introHasBass) || secName.includes("Outro") || (secName === 'Verse_1' && !introHasBass);
                const isSectionEnd = chord.endBeat === activeSection.endBeat;
                const isBassSolo = playBass && !playChords;
                const nextChord = i < track.chords.length - 1 ? track.chords[i + 1] : undefined;
                const nextEnergyLevel = track.sections.find(s => s.startBeat >= activeSection.endBeat)?.energyLevel || energy;
                
                if (track.motifRole === 'Background' && track.processedUserMotif && track.processedUserMotif.length > 0) {
                    lhNotes.push(...MotifLooper.loopMotif(track.processedUserMotif, chord, track.tonality, 36, track.motifRole));
                } else {
                    lhNotes.push(...TextureMapper.generateBassLine(chord, energy, isSparseSection, isSectionEnd, activeSection.localStyleOverride || style.id, idiomaticMelody, isBassSolo, style.orchestration?.idiomPreferences, nextChord, nextEnergyLevel));
                }
            }

            if (playCounterMelody) {
                // 如果副旋律乐器是铺底音色或合成器，则生成 Pad 或 Synth_Pulse 织体，否则生成副旋律
                if (track.motifRole === 'Middleground' && track.processedUserMotif && track.processedUserMotif.length > 0 && !playChords) {
                    // If Middleground motif is present and chords are not playing, put it here
                    counterMelodyNotes.push(...MotifLooper.loopMotif(track.processedUserMotif, chord, track.tonality, 60, track.motifRole));
                } else if (palette.counterMelodySound?.includes('Pad') || palette.counterMelodySound?.includes('String') || palette.counterMelodySound?.includes('Voice') || palette.counterMelodySound?.includes('Synth') || palette.counterMelodySound?.includes('Choir')) {
                    const isVoiceOrString = palette.counterMelodySound.includes('Voice') || palette.counterMelodySound.includes('String') || palette.counterMelodySound.includes('Choir');
                    const counterTexture = (energy >= 7 && !isVoiceOrString) ? 'Synth_Pulse' : 'Pad';
                    counterMelodyNotes.push(...TextureMapper.generateChordTexture(chord, energy, counterTexture, false, false, idiomaticMelody, undefined, activeSection.localStyleOverride || style.id));
                } else {
                    counterMelodyNotes.push(...TextureMapper.generateCounterMelody(chord, energy, idiomaticMelody, activeSection.localStyleOverride || style.id));
                }
            }

            if (playChords) {
                const nextChord = i < track.chords.length - 1 ? track.chords[i + 1] : undefined;
                const isSparseSection = secName.includes("Intro") || secName.includes("Outro");
                const isSectionEnd = chord.endBeat === activeSection.endBeat;
                const nextEnergyLevel = track.sections.find(s => s.startBeat >= activeSection.endBeat)?.energyLevel || energy;
                
                let chordNotes: NoteData[] = [];
                if (track.motifRole === 'Middleground' && track.processedUserMotif && track.processedUserMotif.length > 0) {
                    chordNotes = MotifLooper.loopMotif(track.processedUserMotif, chord, track.tonality, 60, track.motifRole);
                } else if (texture === "Riff") {
                    chordNotes = TextureMapper.generateRiff(chord, energy, activeSection.localStyleOverride || style.id);
                } else {
                    chordNotes = TextureMapper.generateChordTexture(
                        chord, energy, texture, isSparseSection, isSectionEnd, idiomaticMelody, nextChord, activeSection.localStyleOverride || style.id, prevVoicing, nextEnergyLevel
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
                } else if (sec.name === 'Verse_1') {
                    // Verse 1 鼓组减半或不打 (留白)，但如果前奏已经有鼓，为了连贯性必须继续打
                    playDrums = true; // 移除概率空白
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
                    
                    drumNotes.push(...TextureMapper.generateDrumGroove(startBeat, sec.endBeat, effectiveEnergy, treatAsIntro, sec.name.includes('Outro'), sec.localStyleOverride || style.id, swingRatio, nextEnergyLevel, hasFullGrooveStarted));
                }
            });
        }

        // 🔄 动态角色互换 (Dynamic F-M-B Role Swapping)
        // 在某些段落（如 Verse_2 或 Break），让伴奏乐器弹主旋律，主旋律乐器弹伴奏
        track.sections.forEach(sec => {
            if (sec.name === 'Verse_2' || sec.name.includes('Break')) {
                if (globalPRNG.next() < 0.5) { // 50% 概率触发互换
                    // 找出属于该段落的旋律和和弦音符
                    const secMelody = idiomaticMelody.filter(n => n.onset >= sec.startBeat && n.onset < sec.endBeat);
                    const secSecondaryMelody = idiomaticSecondaryMelody.filter(n => n.onset >= sec.startBeat && n.onset < sec.endBeat);
                    const secChords = rhNotes.filter(n => n.onset >= sec.startBeat && n.onset < sec.endBeat);
                    
                    // 从原数组中移除
                    idiomaticMelody = idiomaticMelody.filter(n => n.onset < sec.startBeat || n.onset >= sec.endBeat);
                    idiomaticSecondaryMelody = idiomaticSecondaryMelody.filter(n => n.onset < sec.startBeat || n.onset >= sec.endBeat);
                    rhNotes = rhNotes.filter(n => n.onset < sec.startBeat || n.onset >= sec.endBeat);
                    
                    // 互换并放回（注意音区调整：伴奏乐器弹旋律可能需要提高八度，旋律乐器弹伴奏可能需要降低八度）
                    secMelody.forEach(n => { n.pitch -= 12; rhNotes.push(n); });
                    secSecondaryMelody.forEach(n => { n.pitch -= 12; rhNotes.push(n); });
                    secChords.forEach(n => { n.pitch += 12; idiomaticMelody.push(n); });
                }
            }
            
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
                } else if (style.id.toLowerCase().includes('rock') || style.id.toLowerCase().includes('edm') || style.id.toLowerCase().includes('electronic')) {
                    endingBehavior = globalPRNG.next() > 0.5 ? 'BigRingOut' : 'FadeOut';
                } else {
                    endingBehavior = globalPRNG.next() > 0.8 ? 'BigRingOut' : 'FadeOut'; // 流行也有小概率 Ring Out
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

        TransitionEngine.applyBoundaries(track.sections, lhNotes, rhNotes, drumNotes, track.timeSignature[0], style.id);
        if (!hasDrums) drumNotes.length = 0; 

        const isGuitar = !!(palette.chordSound && palette.chordSound.includes('Guitar'));
        const swingRatio = style.rhythm.swingRatio || 0.5;
        const swingSubdivision = style.rhythm.swingSubdivision || 0.5;

        // 🌟 Phase 3: Apply InstrumentIdiom to all parts for articulation and polish
        const idiomaticLH = InstrumentIdiom.apply(lhNotes, 'Bass', track.chords, idiomPrefsWithSections);
        const idiomaticRH = InstrumentIdiom.apply(rhNotes, palette.chordSound || 'Piano', track.chords, idiomPrefsWithSections);
        const idiomaticDrums = InstrumentIdiom.apply(drumNotes, 'Drums', track.chords, idiomPrefsWithSections);
        const idiomaticCounterMelody = InstrumentIdiom.apply(counterMelodyNotes, palette.counterMelodySound || 'Piano', track.chords, idiomPrefsWithSections);

        const humanizedLH = InstrumentIdiom.humanize(idiomaticLH, 'Bass', swingRatio, swingSubdivision, false, style.orchestration?.idiomPreferences);
        const humanizedRH = InstrumentIdiom.humanize(idiomaticRH, palette.chordSound || 'Piano', swingRatio, swingSubdivision, true, style.orchestration?.idiomPreferences);
        const humanizedDrums = InstrumentIdiom.humanize(idiomaticDrums, 'Drums', swingRatio, swingSubdivision, false, style.orchestration?.idiomPreferences);
        const humanizedCounterMelody = InstrumentIdiom.humanize(idiomaticCounterMelody, palette.counterMelodySound || 'Piano', swingRatio, swingSubdivision, true, style.orchestration?.idiomPreferences);
        const humanizedMelody = InstrumentIdiom.humanize(idiomaticMelody, palette.melodySound || 'Piano', swingRatio, swingSubdivision, true, style.orchestration?.idiomPreferences);
        const humanizedVocal = hasVocal && track.vocal ? InstrumentIdiom.humanize(track.vocal, palette.vocalSound || 'Marimba', swingRatio, swingSubdivision, true, style.orchestration?.idiomPreferences) : undefined;
        const humanizedSecondaryMelody = InstrumentIdiom.humanize(idiomaticSecondaryMelody, secondarySound || 'Piano', swingRatio, swingSubdivision, true, style.orchestration?.idiomPreferences);

        const finalKeyOffset = track.keyOffset || 0;
        const applyOffset = (notes: NoteData[]) => { notes.forEach(n => { n.pitch += finalKeyOffset; }); };

        applyOffset(humanizedMelody);
        if (humanizedVocal) applyOffset(humanizedVocal);
        applyOffset(humanizedSecondaryMelody);
        applyOffset(humanizedLH);
        applyOffset(humanizedRH);
        applyOffset(humanizedCounterMelody);

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
            styleId: style.id,
            vocal: humanizedVocal, melody: humanizedMelody, secondaryMelody: isDuet ? humanizedSecondaryMelody : undefined, pianoLH: humanizedLH, pianoRH: humanizedRH, drums: hasDrums ? humanizedDrums : undefined,
            counterMelody: hasCounterMelody ? humanizedCounterMelody : undefined,
            palette, sections: track.sections
        };
    }
}
