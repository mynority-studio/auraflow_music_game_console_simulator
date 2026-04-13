import { ArrangedTrack } from '../generation/types';
import { AudioMixer } from './AudioMixer';
import { InstrumentRegistry } from './Instruments';
import { VisualEvent, VisualEventListener } from './PlaybackEngine';
import { spessaSynth, startAudioContext } from './SynthManager';
import { globalMidiScheduler, MidiEvent } from './MidiScheduler';

// removed

import { StyleId } from "../generation/config/StyleFlags";

export class InteractivePlaybackEngine {
    private mixer: AudioMixer;
    private instruments: InstrumentRegistry;
    private visualListeners: VisualEventListener[] = [];
    private isStopped: boolean = false;

    // 保存引用以便手动触发
    private drumSynth: any = null;
    private leadSynth: any = null;

    constructor() {
        this.mixer = new AudioMixer();
        this.instruments = new InstrumentRegistry(this.mixer);
        
        globalMidiScheduler.addVisualListener((data: any) => {
            if (data && data.type) {
                this.emitVisualEvent(data as VisualEvent);
            }
        });
    }

    public addVisualListener(listener: VisualEventListener) { this.visualListeners.push(listener); }
    public removeVisualListener(listener: VisualEventListener) { this.visualListeners = this.visualListeners.filter(l => l !== listener); }
    public emitVisualEvent(event: VisualEvent) { this.visualListeners.forEach(l => l(event)); }

    public getMixer() { return this.mixer; }

    public async loadSong(song: ArrangedTrack) {
        this.isStopped = false;
        await startAudioContext();
        
        if (spessaSynth) {
            this.mixer.connectSpessaSynth(spessaSynth);
        } else {
            console.warn("[InteractivePlaybackEngine] spessaSynth is null during loadSong!");
        }
        
        // 🌟 0. Set Mix Style based on song styleId
        if (song.styleId !== undefined) {
            this.mixer.setMixStyle('default');
        } else {
            this.mixer.setMixStyle('default');
        }

        const selectedProfile = 'Recording_Studio';
        await this.mixer.applyMasteringProfile(selectedProfile);

        this.leadSynth = this.instruments.getInstrument(song.palette?.leadSound || 'Acoustic_Grand', 'Foreground');
        const accompSynth = this.instruments.getInstrument(song.palette?.accompSound || 'Warm_EP', 'Midground');
        const bassSynth = this.instruments.getInstrument(song.palette?.bassSound || 'Electric_Bass', 'Rhythm');
        this.drumSynth = this.instruments.getInstrument(song.palette?.drumSound || 'Standard_DrumKit', 'Rhythm'); 

        if (this.isStopped) return;

        globalMidiScheduler.stop();
        globalMidiScheduler.clear();

        const allEvents: MidiEvent[] = [];

        const addEventsForTrack = (notes: any[], synth: any, eventType: VisualEvent['type']) => {
            if (!synth || !notes) return;
            const channel = synth.channel;
            
            notes.forEach(n => {
                let dur = Number(n.duration);
                if (isNaN(dur) || dur <= 0) dur = 0.5; 
                
                const startTick = globalMidiScheduler.beatsToTicks(n.onset);
                const durationTicks = globalMidiScheduler.beatsToTicks(dur);
                const velocity = Math.floor((n.velocity || 0.8) * 127);
                const pitch = Math.floor(n.pitch);

                if (!isNaN(pitch)) {
                    allEvents.push({
                        type: 'noteOn',
                        ticks: startTick,
                        channel,
                        data1: pitch,
                        data2: velocity
                    });
                    allEvents.push({
                        type: 'noteOff',
                        ticks: startTick + durationTicks,
                        channel,
                        data1: pitch,
                        data2: 0
                    });
                    allEvents.push({
                        type: 'visual',
                        ticks: startTick,
                        channel: 0,
                        data1: 0,
                        data2: 0,
                        visualData: { type: eventType, midiNote: pitch, velocity, onset: n.onset, source: 'playback' }
                    });
                }
            });
        };

        // 🌟 法则一：绝对律动保护 - 基础鼓点自动播放，不断节拍
        const autoDrums = song.drums || [];

        addEventsForTrack(song.lead, this.leadSynth, 'lead');
        addEventsForTrack(song.bass, bassSynth, 'bass');
        addEventsForTrack(song.accomp, accompSynth, 'accomp');
        if (song.pad && song.palette?.padSound) {
            const padSynth = this.instruments.getInstrument(song.palette.padSound, 'Midground');
            addEventsForTrack(song.pad, padSynth, 'pad');
        }
        if (autoDrums.length > 0) {
            addEventsForTrack(autoDrums, this.drumSynth, 'drums');
        }

        globalMidiScheduler.loadTrack(allEvents, song.bpm, song.tempoCurves);
    }

    // 🌟 法则一：输入量子化反馈音效
    public playHitSound() {
        if (this.drumSynth) {
            // 使用 Tambourine (54) 或 Cowbell (56) 作为击打反馈音效
            this.drumSynth.triggerAttackRelease(54, 0.1, 0, 0.8);
        }
    }

    // 手动触发交互音符
    public triggerInteractiveNote(instrument: 'drums' | 'lead', pitch: number, duration: number, velocity: number, time?: number) {
        const synth = instrument === 'drums' ? this.drumSynth : this.leadSynth;
        if (synth && pitch !== undefined && !isNaN(pitch)) {
            synth.triggerAttackRelease(pitch, duration, 0, velocity);
            this.emitVisualEvent({ type: instrument, midiNote: pitch, velocity: velocity * 127 });
        }
    }

    public play() { 
        if (!this.isStopped && !globalMidiScheduler.isPlaying) {
            globalMidiScheduler.start(); 
        }
    }

    public stop() { 
        this.isStopped = true; 
        globalMidiScheduler.stop(); 
    }
}
