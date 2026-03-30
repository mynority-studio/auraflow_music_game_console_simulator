// ==========================================
// 📄 文件路径: /src/core/audio/PlaybackEngine.ts
// 🌟 V3.0 纯 MIDI 调度版
// ==========================================
import { ArrangedTrack } from '../generation/types';
import { AudioMixer } from './AudioMixer';
import { InstrumentRegistry } from './Instruments';
import { spessaSynth, startAudioContext } from './AudioEngine';
import { globalMidiScheduler, MidiEvent } from './MidiScheduler';

export interface VisualEvent { type: 'melody' | 'pianoLH' | 'pianoRH' | 'drums' | 'bass' | 'counterMelody' | 'confirm' | 'custom_particle'; midiNote?: number; velocity?: number; col?: number; row?: number; hue?: number; energy?: number; spread?: number; source?: 'playback' | 'gameplay'; time?: number; onset?: number; isUserMotif?: boolean; }
export type VisualEventListener = (event: VisualEvent) => void;

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
        
        if (spessaSynth) {
            this.mixer.connectSpessaSynth(spessaSynth);
        }
        
        // 🌟 0. Set Mix Style based on song styleId
        if (song.styleId) {
            if (song.styleId.includes('jazz') || song.styleId.includes('bossa')) {
                this.mixer.setMixStyle('jazz');
            } else if (song.styleId.includes('house') || song.styleId.includes('electro')) {
                this.mixer.setMixStyle('electro');
            } else if (song.styleId.includes('folk') || song.styleId.includes('ballad')) {
                this.mixer.setMixStyle('folk');
            } else {
                this.mixer.setMixStyle('default');
            }
        } else {
            this.mixer.setMixStyle('default');
        }

        // 🌟 1. 抽卡聘请总调音师 (Mastering)
        const selectedProfile = 'Recording_Studio';
        await this.mixer.applyMasteringProfile(selectedProfile);

        // 🌟 2. 获取采样器 (100% Soundfont)
        const mixing = song.palette?.mixing || {};
        
        const melodySynth = this.instruments.getInstrument(song.palette?.melodySound || 'Acoustic_Grand', 'Foreground', 'melody', mixing.melody);
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

        const addPartEvents = (notes: any[], synth: any, eventType: VisualEvent['type']) => {
            if (!notes) return;
            notes.forEach(n => {
                let dur = Number(n.duration);
                if (isNaN(dur) || dur <= 0) dur = 0.5; 
                
                if (eventType === 'drums' && this.drumDucking) {
                    const duckedPitches = [35, 36, 38, 40, 41, 43, 45, 47, 48, 49, 50, 52, 53, 55, 57];
                    if (duckedPitches.includes(n.pitch)) return; 
                }

                const activeSynth = typeof synth === 'function' ? synth(n.onset) : synth;
                const channel = activeSynth.channel; // Assuming SpessaSynthWrapper exposes channel
                
                if (n.pitch !== undefined && !isNaN(n.pitch)) {
                    const startTick = globalMidiScheduler.beatsToTicks(n.onset + countInBeats);
                    const durationTicks = globalMidiScheduler.beatsToTicks(dur);
                    const vel = Math.max(0, Math.min(127, Math.round((n.velocity || 1) * 127)));

                    // Note On
                    allEvents.push({
                        ticks: startTick,
                        type: 'noteOn',
                        channel: channel,
                        data1: n.pitch,
                        data2: vel
                    });

                    // Visual Event
                    allEvents.push({
                        ticks: startTick,
                        type: 'visual',
                        channel: channel,
                        data1: 0,
                        data2: 0,
                        visualData: { type: eventType, midiNote: n.pitch, velocity: vel, source: 'playback', onset: n.onset, isUserMotif: n.isUserMotif }
                    });

                    // Note Off
                    allEvents.push({
                        ticks: startTick + durationTicks,
                        type: 'noteOff',
                        channel: channel,
                        data1: n.pitch,
                        data2: 0
                    });
                }
            });
        };

        const lofiMelodySynth = this.instruments.getInstrument('Lofi_Piano', 'Foreground', 'lofi_melody', mixing.melody);
        const lofiChordSynth = this.instruments.getInstrument('Lofi_Piano', 'Midground', 'lofi_chord', mixing.chord);
        const lofiDrumSynth = this.instruments.getInstrument('Lofi_DrumKit', 'Rhythm', 'lofi_drums', mixing.drums);
        const lofiBassSynth = this.instruments.getInstrument('Lofi_Piano', 'Background', 'lofi_bass', mixing.bass);

        const getSynthForRole = (defaultSynth: any, lofiSynth: any) => {
            return (onset: number) => {
                if (!song.sections) return defaultSynth;
                const section = song.sections.find(s => onset >= s.startBeat && onset < s.endBeat);
                if (section && section.lofiEffect) {
                    return lofiSynth;
                }
                return defaultSynth;
            };
        };

        const melodySynthFn = getSynthForRole(melodySynth, lofiMelodySynth);
        const chordSynthFn = getSynthForRole(chordSynth, lofiChordSynth);
        const drumSynthFn = getSynthForRole(drumSynth, lofiDrumSynth);
        const bassSynthFn = getSynthForRole(bassSynth, lofiBassSynth);

        addPartEvents(song.melody, melodySynthFn, 'melody');
        if (song.secondaryMelody && song.palette?.secondaryMelodySound) {
            const secondaryMelodySynth = this.instruments.getInstrument(song.palette.secondaryMelodySound, 'Foreground', 'secondaryMelody', mixing.secondaryMelody);
            const secondaryMelodySynthFn = getSynthForRole(secondaryMelodySynth, lofiMelodySynth);
            addPartEvents(song.secondaryMelody, secondaryMelodySynthFn, 'melody');
        }
        addPartEvents(song.pianoLH, bassSynthFn, 'pianoLH'); 
        addPartEvents(song.pianoRH, chordSynthFn, 'pianoRH');
        if (song.counterMelody && song.palette?.counterMelodySound) {
            const counterMelodySynth = this.instruments.getInstrument(song.palette.counterMelodySound, 'Midground', 'counterMelody', mixing.counterMelody);
            const counterMelodySynthFn = getSynthForRole(counterMelodySynth, lofiChordSynth);
            addPartEvents(song.counterMelody, counterMelodySynthFn, 'pianoRH'); 
        }
        if (song.drums) {
            addPartEvents(song.drums, drumSynthFn, 'drums');
        }

        if (options?.withCountIn) {
            const totalBeats = countInBeats + Math.ceil(maxOnset);
            for (let i = 0; i < totalBeats; i++) {
                const startTick = globalMidiScheduler.beatsToTicks(i);
                const activeSynth: any = drumSynthFn(i - countInBeats);
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

        globalMidiScheduler.loadTrack(allEvents, song.bpm);
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
