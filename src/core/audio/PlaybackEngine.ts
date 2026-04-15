// ==========================================
// 📄 文件路径: /src/core/audio/PlaybackEngine.ts
// 🌟 V3.0 纯 MIDI 调度版
// ==========================================
import { ArrangedTrack } from '../generation/types';
import { AudioMixer } from './AudioMixer';
import { InstrumentRegistry } from './Instruments';
import { spessaSynth, startAudioContext } from './SynthManager';
import { globalMidiScheduler, MidiEvent } from './MidiScheduler';
import { PRNGManager } from '../utils/PRNG';

export interface VisualEvent { type: 'melody' | 'pianoLH' | 'pianoRH' | 'drums' | 'bass' | 'counterMelody' | 'confirm' | 'custom_particle' | 'fn_key_active'; midiNote?: number; velocity?: number; col?: number; row?: number; hue?: number; energy?: number; spread?: number; source?: 'playback' | 'gameplay'; time?: number; onset?: number; isUserMotif?: boolean; active?: boolean; }
export type VisualEventListener = (event: VisualEvent) => void;

import { StyleId } from '../generation/config/StyleFlags';
import { StyleRegistry, DefaultStyleConfig } from '../generation/config/StyleRegistry';
import { getStyleConfig } from '../generation/config/styles/StyleRegistry';
import { InstrumentProfiles, getInstrumentIdByName } from '../generation/config/InstrumentFlags';

export type PartName = 'vocal' | 'melody' | 'chord' | 'bass' | 'drums' | 'secondaryMelody' | 'counterMelody';

export class PlaybackEngine {
    private mixer: AudioMixer;
    private instruments: InstrumentRegistry;
    private visualListeners: VisualEventListener[] =[];
    private isStopped: boolean = false;
    private totalDurationSeconds: number = 0;
    private drumDucking: boolean = false;
    // 🌟 SeedController 支持：记录当前歌曲每个声部使用的 MIDI channel
    // channel 由 InstrumentRegistry 动态分配（nextChannel++），每次 loadSong 可能变化
    private partChannels: Partial<Record<PartName, number>> = {};

    constructor() {
        this.mixer = new AudioMixer();
        this.instruments = new InstrumentRegistry(this.mixer);
        
        // Forward visual events from MidiScheduler
        globalMidiScheduler.addVisualListener((data: any) => {
            this.emitVisualEvent(data as VisualEvent);
        });
    }

    public setDrumDucking(enabled: boolean) {
        this.drumDucking = enabled;
    }

    // 🌟 SeedController 支持：返回当前歌曲各声部的 MIDI channel
    public getPartChannels(): Partial<Record<PartName, number>> {
        return { ...this.partChannels };
    }

    public getPartChannel(partName: PartName): number | null {
        return this.partChannels[partName] ?? null;
    }

    public addVisualListener(listener: VisualEventListener) { this.visualListeners.push(listener); }
    public removeVisualListener(listener: VisualEventListener) { this.visualListeners = this.visualListeners.filter(l => l !== listener); }
    public emitVisualEvent(event: VisualEvent) { this.visualListeners.forEach(l => l(event)); }

    public getMixerState() {
        return this.mixer.getMixerState();
    }

    public setMixerParam(category: string, param: string, value: number) {
        this.mixer.setMixerParam(category, param, value);
    }

    public setFocusTrack(trackType: 'RHYTHM' | 'MELODY' | 'ATMOSPHERE' | 'NONE') {
        this.mixer.setFocusTrack(trackType);
    }

    public async loadSong(song: ArrangedTrack, options?: { withCountIn?: boolean, loopStart?: number, loopEnd?: number }) {
        // 🌟 ACVE §5.1 — 入口快照点 D（MIDI 转换/调度入口，generation pipeline 已结束）
        PRNGManager.recordSnapshot('D');
        this.isStopped = false;
        await startAudioContext();
        
        // --- 打印歌曲元数据 ---
        console.log("========================================");
        console.log("🎵 歌曲生成完毕，开始播放 🎵");
        const actualStyle = getStyleConfig(song.styleId as any);
        console.log(`Style: ${actualStyle.name} (ID: ${song.styleId})`);
        console.log(`BPM: ${song.bpm}`);
        console.log(`Key: ${song.key}`);
        console.log(`Time Signature: ${song.timeSignature ? song.timeSignature.join('/') : '4/4'}`);
        
        console.log("--- 使用的乐器 ---");
        const mixing = song.palette?.mixing || {};
        const printInstrument = (role: string, sound?: string | null, mix?: any) => {
            if (sound) {
                const pan = mix?.pan !== undefined ? mix.pan : 0;
                const panStr = pan === 0 ? 'Center' : (pan < 0 ? `Left ${Math.abs(pan)}` : `Right ${pan}`);
                console.log(`- ${role}: ${sound} (Pan: ${panStr})`);
            }
        };
        printInstrument('Vocal', song.palette?.vocalSound, mixing.vocal);
        printInstrument('Melody', song.palette?.melodySound, mixing.melody);
        printInstrument('Secondary Melody', song.palette?.secondaryMelodySound, mixing.secondaryMelody);
        printInstrument('Chord', song.palette?.chordSound, mixing.chord);
        printInstrument('Bass', song.palette?.bassSound, mixing.bass);
        printInstrument('Drums', song.palette?.drumSound, mixing.drums);
        printInstrument('Counter Melody', song.palette?.counterMelodySound, mixing.counterMelody);

        console.log("--- 全曲和弦与旋律进行 ---");
        if (song.sections && song.chords) {
            const noteToMidiStr = (midi: number): string => {
                const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
                const octave = Math.floor(midi / 12) - 1;
                const note = notes[midi % 12];
                return `${note}${octave}`;
            };

            song.sections.forEach(sec => {
                const sectionChords = song.chords?.filter(c => c.startBeat >= sec.startBeat && c.startBeat < sec.endBeat);
                if (!sectionChords || sectionChords.length === 0) return;

                let chordStr = `[${sec.name}]: | `;
                for (const chord of sectionChords) {
                    chordStr += `${chord.numeral} --- | `;
                }
                console.log(chordStr);

                const printTrackNotes = (trackNotes: any[] | undefined, prefix: string) => {
                    if (!trackNotes || trackNotes.length === 0) return;
                    
                    const secNotes = trackNotes.filter(n => n.onset >= sec.startBeat && n.onset < sec.endBeat);
                    if (secNotes.length === 0) return;

                    let noteStr = `${prefix}_${sec.name}: | `;
                    for (const chord of sectionChords) {
                        const chordNotes = secNotes.filter(n => n.onset >= chord.startBeat && n.onset < chord.endBeat);
                        if (chordNotes.length > 0) {
                            noteStr += chordNotes.map(n => `${noteToMidiStr(n.pitch)}(${Number(n.duration.toFixed(2))})`).join('-') + ' | ';
                        } else {
                            noteStr += '--- | ';
                        }
                    }
                    console.log(noteStr);
                };

                printTrackNotes(song.melody, 'melody');
                printTrackNotes(song.secondaryMelody, 'secondaryMelody');
                printTrackNotes(song.counterMelody, 'counterMelody');
                printTrackNotes(song.pianoLH, 'bass');
            });
        }
        console.log("========================================");
        // ----------------------

        if (spessaSynth) {
            this.mixer.connectSpessaSynth(spessaSynth);
        }
        
        // 🌟 0. Set Mix Style based on song styleId
        if (song.styleId !== undefined) {
            this.mixer.setMixStyle('default');
        } else {
            this.mixer.setMixStyle('default');
        }

        // 🌟 1. 抽卡聘请总调音师 (Mastering)
        const styleConfig = song.styleId !== undefined ? (StyleRegistry[song.styleId as StyleId] || DefaultStyleConfig) : DefaultStyleConfig;
        const selectedProfile = styleConfig.masteringProfileId || 'Retro_Gadget';
        await this.mixer.applyMasteringProfile(selectedProfile);

        // 🌟 2. 获取采样器 (100% Soundfont)
        
        const vocalSynth = song.palette?.vocalSound ? this.instruments.getInstrument(song.palette.vocalSound, 'Foreground', 'vocal', mixing.vocal) : null;
        const melodySynth = this.instruments.getInstrument(song.palette?.melodySound || 'Acoustic_Grand', song.palette?.vocalSound ? 'Midground' : 'Foreground', 'melody', mixing.melody);
        const chordSynth = this.instruments.getInstrument(song.palette?.chordSound || 'Warm_EP', 'Midground', 'chord', mixing.chord);

        // 🌟 3. 独立 Bass 采样器：根据流派选择电贝斯或原声贝斯
        const isAcoustic = !!(song.palette?.chordSound && (song.palette.chordSound.includes('Acoustic') || song.palette.chordSound.includes('Jazz')));
        const bassSynth = this.instruments.getInstrument(isAcoustic ? 'Acoustic_Bass' : 'Electric_Bass', 'Rhythm', 'bass', mixing.bass);
        const drumSynth = this.instruments.getInstrument(song.palette?.drumSound || 'Standard_DrumKit', 'Rhythm', 'drums', mixing.drums);

        // 🌟 SeedController 支持：重置 partChannels 并记录本曲分配的 channel
        // secondaryMelody / counterMelody 在后面 addPartEvents 时按需创建，这里先置空
        this.partChannels = {};
        if (vocalSynth) this.partChannels.vocal = vocalSynth.channel;
        this.partChannels.melody = melodySynth.channel;
        this.partChannels.chord = chordSynth.channel;
        this.partChannels.bass = bassSynth.channel;
        this.partChannels.drums = drumSynth.channel;
        if (song.secondaryMelody && song.palette?.secondaryMelodySound) {
            const secSyn = this.instruments.getInstrument(song.palette.secondaryMelodySound, 'Foreground', 'secondaryMelody', mixing.secondaryMelody);
            this.partChannels.secondaryMelody = secSyn.channel;
        }
        if (song.counterMelody && song.palette?.counterMelodySound) {
            const cmSyn = this.instruments.getInstrument(song.palette.counterMelodySound, 'Midground', 'counterMelody', mixing.counterMelody);
            this.partChannels.counterMelody = cmSyn.channel;
        }

        if (this.isStopped) return;

        globalMidiScheduler.stop();
        
        const secPerBeat = 60 / song.bpm;
        
        let maxOnset = 0;
        const updateMaxOnset = (notes?: any[]) => {
            if (notes) {
                notes.forEach(n => {
                    const end = n.onset + (n.duration || 0.5);
                    if (end > maxOnset) maxOnset = end;
                });
            }
        };
        
        updateMaxOnset(song.vocal);
        updateMaxOnset(song.melody);
        updateMaxOnset(song.secondaryMelody);
        updateMaxOnset(song.pianoLH);
        updateMaxOnset(song.pianoRH);
        updateMaxOnset(song.drums);
        updateMaxOnset(song.counterMelody);
        updateMaxOnset(song.userMotif);
        
        const countInBeats = options?.withCountIn ? 4 : 0;
        this.totalDurationSeconds = (maxOnset + countInBeats) * secPerBeat;

        if (options?.loopStart !== undefined && options?.loopEnd !== undefined) {
            globalMidiScheduler.loop = true;
            globalMidiScheduler.loopStartTicks = globalMidiScheduler.beatsToTicks(options.loopStart + countInBeats);
            globalMidiScheduler.loopEndTicks = globalMidiScheduler.beatsToTicks(options.loopEnd + countInBeats);
        } else {
            globalMidiScheduler.loop = false;
        }

        let allEvents: MidiEvent[] = [];

        const scheduleSynthInit = (synth: any) => {
            if (!synth) return;
            const activeSynth = typeof synth === 'function' ? synth(0) : synth;
            if (activeSynth) {
                allEvents.push({
                    ticks: 0,
                    type: 'cc',
                    channel: activeSynth.channel,
                    data1: 0, // Bank Select MSB
                    data2: activeSynth.bank || 0
                });
                allEvents.push({
                    ticks: 0,
                    type: 'cc',
                    channel: activeSynth.channel,
                    data1: 32, // Bank Select LSB
                    data2: 0
                });
                allEvents.push({
                    ticks: 0,
                    type: 'programChange',
                    channel: activeSynth.channel,
                    data1: activeSynth.program || 0,
                    data2: 0
                });

                // 🌟 CC74 亮度控制：高频刺耳乐器降低 Brightness（免费 LPF）
                // GM Program: 40=Violin, 48=StringEnsemble, 56=Trumpet, 61=Brass, 71=Clarinet, 73=Flute
                const prog = activeSynth.program || 0;
                const isHarshTimbre = prog === 40 || prog === 48 || prog === 49 || prog === 56 || prog === 61 || prog === 71 || prog === 73;
                allEvents.push({
                    ticks: 0,
                    type: 'cc',
                    channel: activeSynth.channel,
                    data1: 74, // Brightness / Filter Cutoff
                    data2: isHarshTimbre ? 50 : 64 // 刺耳音色压低到 50，其他保持默认 64
                });
            }
        };

        // 全局调性移调偏移量（生成管道在 C 大调相对空间工作）
        const transposeOffset = (song.chords && song.chords.length > 0 && song.chords[0].keyOffset !== undefined)
            ? song.chords[0].keyOffset : 0;

        const addPartEvents = (notes: any[], synth: any, eventType: VisualEvent['type']) => {
            if (!notes) return;
            notes.forEach(n => {
                // Onset 吸附 16 分音符网格，Duration 保留原始精度（避免截断尾音）
                let rawOnset = Number(n.onset);
                let rawDuration = Number(n.duration);
                let onset = Math.round(rawOnset / 0.25) * 0.25;
                let dur = Math.max(0.1, rawDuration); // 不量化时值，保留连贯感

                if (isNaN(dur) || dur <= 0) dur = 0.5;
                
                if (eventType === 'drums' && this.drumDucking) {
                    const duckedPitches = [35, 36, 38, 40, 41, 43, 45, 47, 48, 49, 50, 52, 53, 55, 57];
                    if (duckedPitches.includes(n.pitch)) return; 
                }

                const activeSynth = typeof synth === 'function' ? synth(onset) : synth;
                let channel = activeSynth.channel;
                // 全局调性移调 + 声部专属八度折叠
                let pitch = n.pitch;
                if (eventType !== 'drums' && transposeOffset !== 0) {
                    pitch += transposeOffset;
                    if (eventType === 'pianoLH') {
                        // 贝斯专属：折叠到 E1(28) ~ G2(43)，保持低频地基
                        while (pitch > 43) pitch -= 12;
                        while (pitch < 28) pitch += 12;
                    } else {
                        // 其他声部：折叠到 C2(36) ~ C6(84)
                        while (pitch > 84) pitch -= 12;
                        while (pitch < 36) pitch += 12;
                    }
                }
                
                if (pitch !== undefined && !isNaN(pitch)) {
                    const startTick = globalMidiScheduler.beatsToTicks(onset + countInBeats);
                    const durationTicks = globalMidiScheduler.beatsToTicks(dur);
                    const vel = Math.max(0, Math.min(127, Math.round((n.velocity || 1) * 127)));

                    // Note On
                    allEvents.push({
                        ticks: startTick,
                        type: 'noteOn',
                        channel: channel,
                        data1: pitch,
                        data2: vel
                    });

                    // Visual Event
                    allEvents.push({
                        ticks: startTick,
                        type: 'visual',
                        channel: channel,
                        data1: 0,
                        data2: 0,
                        visualData: { type: eventType, midiNote: pitch, velocity: vel, source: 'playback', onset: onset, isUserMotif: n.isUserMotif }
                    });

                    // Note Off
                    allEvents.push({
                        ticks: startTick + durationTicks,
                        type: 'noteOff',
                        channel: channel,
                        data1: pitch,
                        data2: 0
                    });
                }
            });
        };

        const vocalSynthFn = vocalSynth ? () => vocalSynth : null;
        const melodySynthFn = () => melodySynth;
        const chordSynthFn = () => chordSynth;
        const drumSynthFn = () => drumSynth;
        const bassSynthFn = () => bassSynth;

        scheduleSynthInit(vocalSynthFn);
        scheduleSynthInit(melodySynthFn);
        scheduleSynthInit(chordSynthFn);
        scheduleSynthInit(drumSynthFn);
        scheduleSynthInit(bassSynthFn);
        if (song.secondaryMelody && song.palette?.secondaryMelodySound) {
            scheduleSynthInit(() => this.instruments.getInstrument(song.palette!.secondaryMelodySound, 'Foreground', 'secondaryMelody', mixing.secondaryMelody));
        }
        if (song.counterMelody && song.palette?.counterMelodySound) {
            scheduleSynthInit(() => this.instruments.getInstrument(song.palette!.counterMelodySound, 'Midground', 'counterMelody', mixing.counterMelody));
        }

        // 🌟 Luis's Dynamic Panning & Reverb + Gain Staging
        if (song.sections) {
            song.sections.forEach((sec, index) => {
                const startTick = globalMidiScheduler.beatsToTicks(sec.startBeat + countInBeats);
                const energyLevel = sec.energyLevel || 4; // 1-8
                const spread = (energyLevel - 1) / 7.0;

                const applyCC = (synthFn: any, mixConfig: any, energyLevel: number, isDrums: boolean = false) => {
                    if (!synthFn || !mixConfig) return;
                    const channel = synthFn(sec.startBeat).channel;

                    const basePan = mixConfig.pan !== undefined ? Math.max(0, Math.min(127, Math.round((mixConfig.pan + 1) * 63.5))) : 64;
                    const baseReverb = mixConfig.reverb !== undefined ? Math.max(0, Math.min(127, Math.round(mixConfig.reverb * 127))) : 0;
                    const baseVol = mixConfig.volume !== undefined ? Math.max(0, Math.min(115, Math.round(80 * Math.pow(10, mixConfig.volume / 20)))) : 80;

                    const pan = Math.round(64 + (basePan - 64) * spread);
                    const reverb = Math.min(127, Math.round(baseReverb * (0.5 + 0.5 * spread)));
                    const vol = Math.min(115, Math.round(baseVol * (0.8 + 0.2 * spread)));

                    // 🌟 CC7 渐入曲线：非鼓组段落开头 1 拍从 60%→100% 渐变
                    if (!isDrums && index > 0) {
                        for (let step = 0; step < 4; step++) {
                            const progress = (step + 1) / 4;
                            const fadeVol = Math.round(vol * (0.6 + 0.4 * progress));
                            allEvents.push({ ticks: startTick + Math.round(step * globalMidiScheduler.beatsToTicks(0.25)), type: 'cc', channel, data1: 7, data2: fadeVol });
                        }
                    } else {
                        allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 7, data2: vol });
                    }

                    allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 10, data2: pan });
                    allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 91, data2: reverb });

                    if (mixConfig.chorus !== undefined) {
                        allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 93, data2: mixConfig.chorus });
                    }
                };

                applyCC(vocalSynthFn, mixing.vocal, energyLevel);
                applyCC(melodySynthFn, mixing.melody, energyLevel);
                applyCC(drumSynthFn, mixing.drums, energyLevel, true);
                applyCC(bassSynthFn, mixing.bass, energyLevel);
                applyCC(chordSynthFn, mixing.chord, energyLevel);

                if (song.secondaryMelody && song.palette?.secondaryMelodySound) {
                    const secondaryMelodySynth = this.instruments.getInstrument(song.palette.secondaryMelodySound, 'Foreground', 'secondaryMelody', mixing.secondaryMelody);
                    const secondaryMelodySynthFn = () => secondaryMelodySynth;
                    applyCC(secondaryMelodySynthFn, mixing.secondaryMelody, energyLevel);
                }

                if (song.counterMelody && song.palette?.counterMelodySound) {
                    const counterMelodySynth = this.instruments.getInstrument(song.palette.counterMelodySound, 'Midground', 'counterMelody', mixing.counterMelody);
                    const counterMelodySynthFn = () => counterMelodySynth;
                    applyCC(counterMelodySynthFn, mixing.counterMelody, energyLevel);
                }
            });
        }

        if (song.vocal && vocalSynthFn) {
            addPartEvents(song.vocal, vocalSynthFn, 'melody'); // Use 'melody' visual type for now
        }
        addPartEvents(song.melody, melodySynthFn, 'melody');
        if (song.secondaryMelody && song.palette?.secondaryMelodySound) {
            const secondaryMelodySynth = this.instruments.getInstrument(song.palette.secondaryMelodySound, 'Foreground', 'secondaryMelody', mixing.secondaryMelody);
            const secondaryMelodySynthFn = () => secondaryMelodySynth;
            addPartEvents(song.secondaryMelody, secondaryMelodySynthFn, 'melody');
        }
        addPartEvents(song.pianoLH, bassSynthFn, 'pianoLH'); 
        addPartEvents(song.pianoRH, chordSynthFn, 'pianoRH');
        if (song.counterMelody && song.palette?.counterMelodySound) {
            const counterMelodySynth = this.instruments.getInstrument(song.palette.counterMelodySound, 'Midground', 'counterMelody', mixing.counterMelody);
            const counterMelodySynthFn = () => counterMelodySynth;
            addPartEvents(song.counterMelody, counterMelodySynthFn, 'pianoRH'); 
        }
        if (song.drums) {
            addPartEvents(song.drums, drumSynthFn, 'drums');
        }

        // 🌟 CC11 表情呼吸曲线：Sustained/Pad 乐器的背景长音自动生成呼吸包络
        // 仅对 counterMelody 和 secondaryMelody 应用（主旋律不加，避免"断气"）
        const addCC11Swell = (partNotes: any[] | undefined, synthFn: any, instrumentName: string | null | undefined) => {
            if (!partNotes || !synthFn || !instrumentName) return;
            const instId = getInstrumentIdByName(instrumentName);
            const profile = InstrumentProfiles[instId];
            if (!profile.needsCC11) return;
            const activeSynth = typeof synthFn === 'function' ? synthFn(0) : synthFn;
            const channel = activeSynth.channel;
            for (let ni = 0; ni < partNotes.length; ni++) {
                const note = partNotes[ni];
                if (note.duration >= 1.0) {
                    const startTick = globalMidiScheduler.beatsToTicks(note.onset + countInBeats);
                    const endTick = globalMidiScheduler.beatsToTicks(note.onset + note.duration + countInBeats);
                    const midTick = Math.round(startTick + (endTick - startTick) * 0.4);
                    allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 11, data2: 40 });
                    allEvents.push({ ticks: midTick, type: 'cc', channel, data1: 11, data2: 90 });
                    allEvents.push({ ticks: Math.max(startTick + 1, endTick - 120), type: 'cc', channel, data1: 11, data2: 30 });
                }
            }
        };
        if (song.counterMelody && song.palette?.counterMelodySound) {
            const cmSynth = this.instruments.getInstrument(song.palette.counterMelodySound, 'Midground', 'counterMelody', mixing.counterMelody);
            addCC11Swell(song.counterMelody, () => cmSynth, song.palette.counterMelodySound);
        }
        if (song.secondaryMelody && song.palette?.secondaryMelodySound) {
            const secSynth = this.instruments.getInstrument(song.palette.secondaryMelodySound, 'Foreground', 'secondaryMelody', mixing.secondaryMelody);
            addCC11Swell(song.secondaryMelody, () => secSynth, song.palette.secondaryMelodySound);
        }

        // 🌟 提案三：标志性结尾 (Jazz/R&B Signature Ending - CC64 Sustain)
        if (song.chords) {
            song.chords.forEach(chord => {
                if (chord.isSignatureEnding) {
                    const startTick = globalMidiScheduler.beatsToTicks(chord.startBeat + countInBeats);
                    const endTick = globalMidiScheduler.beatsToTicks(chord.endBeat + countInBeats);
                    
                    // 为所有和声乐器 (PianoRH, PianoLH, CounterMelody) 发送 CC64 延音踏板踩下
                    const sustainChannels = new Set<number>();
                    if (chordSynthFn) sustainChannels.add(chordSynthFn().channel);
                    if (bassSynthFn) sustainChannels.add(bassSynthFn().channel);
                    if (song.counterMelody && song.palette?.counterMelodySound) {
                        const cmSynth = this.instruments.getInstrument(song.palette.counterMelodySound, 'Midground', 'counterMelody');
                        sustainChannels.add(cmSynth.channel);
                    }

                    sustainChannels.forEach(channel => {
                        // 踩下踏板 (127)
                        allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 64, data2: 127 });
                        // 松开踏板 (0)
                        allEvents.push({ ticks: endTick, type: 'cc', channel, data1: 64, data2: 0 });
                    });
                    
                    console.log(`[PlaybackEngine] Applied CC64 Sustain for Signature Ending at beat ${chord.startBeat}`);
                }
            });
        }

        // 🌟 Luis's Fake Sidechain (CC 11) — PR #8 启用
        // 仅注入 Bass + Chord;counterMelody 走 addCC11Swell 自己的呼吸包络,不被 sidechain 覆盖
        // StyleConfig.mixing.mixingPreferences.requireSidechain === false 可关闭(Ballad/Classical 风格)
        const sidechainEnabled = styleConfig.orchestration?.mixingPreferences?.requireSidechain !== false;
        if (sidechainEnabled && song.drums) {
            const beatsPerMs = song.bpm / 60 / 1000;
            song.drums.forEach(n => {
                const isKick = n.pitch === 35 || n.pitch === 36;
                if (isKick && n.velocity > 0.7) {
                    const startTick = globalMidiScheduler.beatsToTicks(n.onset + countInBeats);

                    const injectSidechain = (channel: number) => {
                        allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 11, data2: 40 });
                        const tick30 = startTick + globalMidiScheduler.beatsToTicks(30 * beatsPerMs);
                        allEvents.push({ ticks: tick30, type: 'cc', channel, data1: 11, data2: 65 });
                        const tick80 = startTick + globalMidiScheduler.beatsToTicks(80 * beatsPerMs);
                        allEvents.push({ ticks: tick80, type: 'cc', channel, data1: 11, data2: 100 });
                        const tick150 = startTick + globalMidiScheduler.beatsToTicks(150 * beatsPerMs);
                        allEvents.push({ ticks: tick150, type: 'cc', channel, data1: 11, data2: 127 });
                    };

                    injectSidechain(bassSynthFn().channel);
                    injectSidechain(chordSynthFn().channel);
                }
            });
        }

        if (options?.withCountIn) {
            const totalBeats = countInBeats + Math.ceil(maxOnset);
            for (let i = 0; i < totalBeats; i++) {
                const startTick = globalMidiScheduler.beatsToTicks(i);
                const activeSynth: any = drumSynthFn();
                const channel = activeSynth.channel;
                const vel = i < countInBeats ? 127 : 76;
                
                allEvents.push({
                    ticks: startTick,
                    type: 'noteOn',
                    channel: channel,
                    data1: 42, // Closed hi-hat
                    data2: vel
                });
                allEvents.push({
                    ticks: startTick + globalMidiScheduler.beatsToTicks(0.1),
                    type: 'noteOff',
                    channel: channel,
                    data1: 42,
                    data2: 0
                });
            }
        }

        // 🌟 ST-3: Intro Filter Build-up — CC74 (Brightness/Cutoff) 低通涌动
        // 在 Intro 期间注入 CC74 从 20 �� 127 的渐变曲线，让声音从"闷"逐渐变"亮"
        if (song.introFilterSweep && song.sections) {
            const introSec = song.sections.find(s => s.name && s.name.startsWith('Intro'));
            if (introSec) {
                const countInBeats = options?.withCountIn ? (song.timeSignature?.[0] || 4) : 0;
                const introStartTick = globalMidiScheduler.beatsToTicks(introSec.startBeat + countInBeats);
                const introEndTick = globalMidiScheduler.beatsToTicks(introSec.endBeat + countInBeats);
                const steps = 16; // 16 步 CC 自动化，足够��滑
                const ccStart = 20;  // 极度低通
                const ccEnd = 127;   // 全开

                for (let s = 0; s <= steps; s++) {
                    const tick = introStartTick + Math.floor((introEndTick - introStartTick) * s / steps);
                    const value = Math.round(ccStart + (ccEnd - ccStart) * (s / steps));
                    // 对所有非鼓通道（0-8, 10-15）注入 CC74，跳过 GM 鼓通道 9
                    for (let ch = 0; ch < 16; ch++) {
                        if (ch === 9) continue;
                        allEvents.push({ ticks: tick, type: 'cc', channel: ch, data1: 74, data2: value });
                    }
                }

                // Intro 结束后确��� CC74 恢复到默认值 127（防止影��后续段落）
                for (let ch = 0; ch < 16; ch++) {
                    if (ch === 9) continue;
                    allEvents.push({ ticks: introEndTick + 1, type: 'cc', channel: ch, data1: 74, data2: 127 });
                }
            }
        }

        globalMidiScheduler.loadTrack(allEvents, song.bpm, song.tempoCurves);
    }

    public async appendSongChunk(song: ArrangedTrack) {
        // Append logic can be implemented by adding to globalMidiScheduler events
        // For now, this is a placeholder as the architecture shifts to full generation
        console.warn("[PlaybackEngine] appendSongChunk is not fully supported in MidiScheduler yet.");
    }

    public setNextBlockTrigger(triggerBeat: number, callback: () => void) {
        if (this.isStopped) return;
        // Add a visual event that triggers the callback
        const triggerTick = globalMidiScheduler.beatsToTicks(triggerBeat);
        // We can't easily inject a callback into MidiEvent, but we can use visualData
        // However, a simpler way is to just use setTimeout based on current time and BPM
        // Or add a custom event type to MidiScheduler.
        // For now, let's just use a timeout
        const msPerBeat = 60000 / globalMidiScheduler.getBpm();
        const currentBeat = globalMidiScheduler.getCurrentTick() / globalMidiScheduler.ppq;
        const beatsToWait = triggerBeat - currentBeat;
        if (beatsToWait > 0) {
            setTimeout(callback, beatsToWait * msPerBeat);
        } else {
            callback();
        }
    }

    public play() { 
        if (!this.isStopped) globalMidiScheduler.start(); 
    }

    public getDuration(): number {
        return this.totalDurationSeconds;
    }

    public stop() { 
        this.isStopped = true; 
        globalMidiScheduler.stop();
    }
}
