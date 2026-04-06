// ==========================================
// 📄 文件路径: /src/core/audio/PlaybackEngine.ts
// 🌟 V3.0 纯 MIDI 调度版
// ==========================================
import { ArrangedTrack } from '../generation/types';
import { AudioMixer } from './AudioMixer';
import { InstrumentRegistry } from './Instruments';
import { spessaSynth, startAudioContext } from './SynthManager';
import { globalMidiScheduler, MidiEvent } from './MidiScheduler';

export interface VisualEvent { type: 'melody' | 'pianoLH' | 'pianoRH' | 'drums' | 'bass' | 'counterMelody' | 'confirm' | 'custom_particle' | 'fn_key_active'; midiNote?: number; velocity?: number; col?: number; row?: number; hue?: number; energy?: number; spread?: number; source?: 'playback' | 'gameplay'; time?: number; onset?: number; isUserMotif?: boolean; active?: boolean; }
export type VisualEventListener = (event: VisualEvent) => void;

// removed
import { StyleId } from '../generation/config/StyleFlags';

import { DefaultStyleConfig } from '../generation/config/StyleFlags';

export class PlaybackEngine {
    private mixer: AudioMixer;
    private instruments: InstrumentRegistry;
    private visualListeners: VisualEventListener[] =[];
    private isStopped: boolean = false;
    private totalDurationSeconds: number = 0;
    private drumDucking: boolean = false;

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
        this.isStopped = false;
        await startAudioContext();
        
        // --- 打印歌曲元数据 ---
        console.log("========================================");
        console.log("🎵 歌曲生成完毕，开始播放 🎵");
        // 从 StyleIdName 查风格名（延迟导入避免循环依赖）
        const styleNames: Record<number, string> = { 0: 'Default' };
        console.log(`Style: ${styleNames[song.styleId as number] || `Unknown(${song.styleId})`}`);
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
        const styleConfig = song.styleId ? DefaultStyleConfig[song.styleId] : undefined;
        const selectedProfile = styleConfig?.masteringProfileId || 'Modern_HiFi';
        await this.mixer.applyMasteringProfile(selectedProfile);

        // 🌟 2. 获取采样器 (100% Soundfont)
        
        const vocalSynth = song.palette?.vocalSound ? this.instruments.getInstrument(song.palette.vocalSound, 'Foreground', 'vocal', mixing.vocal) : null;
        const melodySynth = this.instruments.getInstrument(song.palette?.melodySound || 'Acoustic_Grand', song.palette?.vocalSound ? 'Midground' : 'Foreground', 'melody', mixing.melody);
        const chordSynth = this.instruments.getInstrument(song.palette?.chordSound || 'Warm_EP', 'Midground', 'chord', mixing.chord);
        
        // 🌟 3. 独立 Bass 采样器：根据流派选择电贝斯或原声贝斯
        const isAcoustic = !!(song.palette?.chordSound && (song.palette.chordSound.includes('Acoustic') || song.palette.chordSound.includes('Jazz')));
        const bassSynth = this.instruments.getInstrument(isAcoustic ? 'Acoustic_Bass' : 'Electric_Bass', 'Rhythm', 'bass', mixing.bass);
        const drumSynth = this.instruments.getInstrument(song.palette?.drumSound || 'Standard_DrumKit', 'Rhythm', 'drums', mixing.drums); 

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
            }
        };

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
                let channel = activeSynth.channel; // Assuming SpessaSynthWrapper exposes channel
                let pitch = n.pitch;
                
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

                const applyCC = (synthFn: any, mixConfig: any, energyLevel: number) => {
                    if (!synthFn || !mixConfig) return;
                    const channel = synthFn(sec.startBeat).channel;
                    
                    // Base values from mixConfig
                    const basePan = mixConfig.pan !== undefined ? Math.max(0, Math.min(127, Math.round((mixConfig.pan + 1) * 63.5))) : 64;
                    const baseReverb = mixConfig.reverb !== undefined ? Math.max(0, Math.min(127, Math.round(mixConfig.reverb * 127))) : 0;
                    const baseVol = mixConfig.volume !== undefined ? Math.max(0, Math.min(127, Math.round(80 * Math.pow(10, mixConfig.volume / 20)))) : 100;
                    
                    // Dynamic spread based on energy
                    const pan = Math.round(64 + (basePan - 64) * spread);
                    const reverb = Math.min(127, Math.round(baseReverb * (0.5 + 0.5 * spread))); // Reverb increases with energy
                    const vol = Math.min(127, Math.round(baseVol * (0.8 + 0.2 * spread))); // Volume slightly increases with energy

                    allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 7, data2: vol });
                    allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 10, data2: pan });
                    allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 91, data2: reverb });
                    
                    if (mixConfig.chorus !== undefined) {
                        allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 93, data2: mixConfig.chorus });
                    }
                };

                applyCC(vocalSynthFn, mixing.vocal, energyLevel);
                applyCC(melodySynthFn, mixing.melody, energyLevel);
                applyCC(drumSynthFn, mixing.drums, energyLevel);
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

        // 🌟 Luis's Fake Sidechain (CC 11)
        if (song.styleId !== undefined) {
            const needsSidechain = false;
            
            if (needsSidechain && song.drums) {
                song.drums.forEach(n => {
                    const isKick = n.pitch === 35 || n.pitch === 36;
                    if (isKick && n.velocity > 0.7) {
                        const startTick = globalMidiScheduler.beatsToTicks(n.onset + countInBeats);
                        
                        const injectSidechain = (channel: number) => {
                            // T: 40
                            allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 11, data2: 40 });
                            // T + 30ms
                            const tick30 = startTick + globalMidiScheduler.beatsToTicks(0.03 * (song.bpm / 60));
                            allEvents.push({ ticks: tick30, type: 'cc', channel, data1: 11, data2: 65 });
                            // T + 80ms
                            const tick80 = startTick + globalMidiScheduler.beatsToTicks(0.08 * (song.bpm / 60));
                            allEvents.push({ ticks: tick80, type: 'cc', channel, data1: 11, data2: 100 });
                            // T + 150ms
                            const tick150 = startTick + globalMidiScheduler.beatsToTicks(0.15 * (song.bpm / 60));
                            allEvents.push({ ticks: tick150, type: 'cc', channel, data1: 11, data2: 127 });
                        };

                        const bassChannel = bassSynthFn().channel;
                        injectSidechain(bassChannel);

                        const chordChannel = chordSynthFn().channel;
                        injectSidechain(chordChannel);

                        if (song.counterMelody && song.palette?.counterMelodySound) {
                            const counterMelodySynth = this.instruments.getInstrument(song.palette.counterMelodySound, 'Midground', 'counterMelody', mixing.counterMelody);
                            const cmChannel = counterMelodySynth.channel;
                            injectSidechain(cmChannel);
                        }
                    }
                });
            }
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
