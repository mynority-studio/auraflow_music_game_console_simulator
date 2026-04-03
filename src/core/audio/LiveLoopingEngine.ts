import { ArrangedTrack, SectionMetadata } from '../generation/types';
import { AudioMixer } from './AudioMixer';
import { InstrumentRegistry } from './Instruments';
import { VisualEvent, VisualEventListener } from './PlaybackEngine';
import { AudioEngine } from './AudioEngine';
import { spessaSynth, startAudioContext } from './SynthManager';
import { globalMidiScheduler, MidiEvent } from './MidiScheduler';

import { InstrumentId, InstrumentIdName } from "../generation/config/InstrumentFlags";

export class LiveLoopingEngine {
    private mixer: AudioMixer;
    private instruments: InstrumentRegistry;
    private visualListeners: VisualEventListener[] = [];
    private isStopped: boolean = false;

    // Synths (now SpessaSynthWrappers)
    private kickSynth: any = null;
    private snareSynth: any = null;
    private hihatSynth: any = null;
    private extraDrumSynth: any = null;
    private bassSynth: any = null;
    private chordSynth: any = null;
    private melodySynth: any = null;
    private counterMelodySynth: any = null;
    private userMotifSynth: any = null;
    private fillSynth: any = null;

    // State
    private song: ArrangedTrack | null = null;
    private currentSectionIndex: number = 0;
    private energyLevel: number = 0; // 0-100

    constructor() {
        this.mixer = new AudioMixer();
        this.instruments = new InstrumentRegistry(this.mixer);
        
        globalMidiScheduler.addVisualListener((data: any) => {
            if (data && data.type) {
                this.emitVisualEvent(data as VisualEvent);
            }
        });
    }

    public async initExploreMode() {
        if (!this.userMotifSynth) {
            this.userMotifSynth = this.instruments.getInstrument('System_Aura', 'Foreground');
        }
        if (!this.fillSynth) {
            this.fillSynth = this.instruments.getInstrument('System_Aura', 'Foreground');
        }
    }

    public addVisualListener(listener: VisualEventListener) { this.visualListeners.push(listener); }
    public removeVisualListener(listener: VisualEventListener) { this.visualListeners = this.visualListeners.filter(l => l !== listener); }
    public emitVisualEvent(event: VisualEvent) { 
        this.visualListeners.forEach(l => l(event)); 
        AudioEngine.emitVisualEvent(event);
    }

    public getMixer() { return this.mixer; }

    public async loadSong(song: ArrangedTrack) {
        this.isStopped = false;
        this.song = song;
        await startAudioContext();
        
        if (spessaSynth) {
            this.mixer.connectSpessaSynth(spessaSynth);
        }
        
        // 🌟 0. Set Mix Style based on song.mixStyle
        this.mixer.setMixStyle(song.mixStyle || 'default');

        const selectedProfile = 'Recording_Studio';
        await this.mixer.applyMasteringProfile(selectedProfile);

        this.melodySynth = this.instruments.getInstrument('System_Aura', 'Foreground');
        this.chordSynth = this.instruments.getInstrumentById(song.palette?.chordSound ?? InstrumentId.Warm_EP, 'Midground');
        this.bassSynth = this.instruments.getInstrumentById(song.palette?.bassSound ?? InstrumentId.Electric_Bass_Finger, 'Rhythm');

        const drumSoundId = song.palette?.drumSound ?? InstrumentId.Standard_DrumKit;
        this.kickSynth = this.instruments.getInstrumentById(drumSoundId, 'Rhythm', 'kick');
        this.snareSynth = this.instruments.getInstrumentById(drumSoundId, 'Rhythm', 'snare');
        this.hihatSynth = this.instruments.getInstrumentById(drumSoundId, 'Rhythm', 'hihats');
        this.extraDrumSynth = this.instruments.getInstrumentById(drumSoundId, 'Rhythm', 'extraDrums'); 
        
        if (song.palette?.counterMelodySound !== undefined && song.palette?.counterMelodySound !== null) {
            this.counterMelodySynth = this.instruments.getInstrumentById(song.palette.counterMelodySound, 'Midground');
        }

        this.userMotifSynth = this.instruments.getInstrument('System_Aura', 'Foreground');
        this.fillSynth = this.instruments.getInstrument('System_Aura', 'Foreground');

        if (this.isStopped) return;

        globalMidiScheduler.stop();
        globalMidiScheduler.clear();

        this.setupTracks(song);
        this.setEnergy(0); 
        
        if (this.song.sections && this.song.sections.length > 0) {
            const lastSection = this.song.sections[this.song.sections.length - 1];
            globalMidiScheduler.loop = true;
            globalMidiScheduler.loopStartTicks = 0;
            globalMidiScheduler.loopEndTicks = globalMidiScheduler.beatsToTicks(lastSection.endBeat);
            this.currentSectionIndex = 0;
        }
    }

    public playHitSound() {
        // Removed, use playFeedback instead
    }

    private setupTracks(song: ArrangedTrack) {
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

        const kickPitches = [36, 35]; 
        const snarePitches = [38, 40, 37, 39]; 
        const hihatPitches = [42, 44, 46]; 
        
        const kickDrums = song.drums?.filter(n => kickPitches.includes(n.pitch)) || [];
        const snareDrums = song.drums?.filter(n => snarePitches.includes(n.pitch)) || [];
        const hihatDrums = song.drums?.filter(n => hihatPitches.includes(n.pitch)) || [];
        const extraDrums = song.drums?.filter(n => !kickPitches.includes(n.pitch) && !snarePitches.includes(n.pitch) && !hihatPitches.includes(n.pitch)) || [];

        addEventsForTrack(kickDrums, this.kickSynth, 'drums');
        addEventsForTrack(snareDrums, this.snareSynth, 'drums');
        addEventsForTrack(hihatDrums, this.hihatSynth, 'drums');
        addEventsForTrack(extraDrums, this.extraDrumSynth, 'drums');
        
        addEventsForTrack(song.pianoLH, this.bassSynth, 'bass');
        addEventsForTrack(song.pianoRH, this.chordSynth, 'pianoRH');
        addEventsForTrack(song.melody, this.melodySynth, 'melody');
        
        if (song.secondaryMelody) addEventsForTrack(song.secondaryMelody, this.melodySynth, 'melody');
        if (song.counterMelody) addEventsForTrack(song.counterMelody, this.counterMelodySynth, 'counterMelody');
        if (song.userMotif) addEventsForTrack(song.userMotif, this.userMotifSynth, 'melody');

        globalMidiScheduler.loadTrack(allEvents, song.bpm, song.tempoCurves);
    }

    public setEnergy(energy: number) {
        this.energyLevel = Math.max(0, Math.min(100, energy));
    }

    public getCurrentSectionIndex(): number {
        if (!this.song || !this.song.sections || this.song.sections.length === 0) return 0;
        
        const currentTick = globalMidiScheduler.getCurrentTick();
        const currentBeat = currentTick / globalMidiScheduler.ppq;
        
        for (let i = 0; i < this.song.sections.length; i++) {
            const section = this.song.sections[i];
            if (currentBeat >= section.startBeat && currentBeat < section.endBeat) {
                this.currentSectionIndex = i;
                return i;
            }
        }
        
        return this.currentSectionIndex;
    }

    public setSectionByType(type: 'intro' | 'verse' | 'prechorus' | 'chorus' | 'outro') {
        if (!this.song || !this.song.sections) return;
        
        const index = this.song.sections.findIndex(s => s.name.toLowerCase().includes(type));
        if (index !== -1) {
            this.setSection(index);
        } else {
            if (type === 'verse') this.setSection(1);
            else if (type === 'prechorus') this.setSection(2);
            else if (type === 'chorus') this.setSection(3);
        }
    }

    public setSection(index: number) {
        if (!this.song || !this.song.sections || this.song.sections.length === 0) return;
        
        this.currentSectionIndex = Math.max(0, Math.min(index, this.song.sections.length - 1));
        const section = this.song.sections[this.currentSectionIndex];
        
        const loopStart = globalMidiScheduler.beatsToTicks(section.startBeat);
        const loopEnd = globalMidiScheduler.beatsToTicks(section.endBeat);

        globalMidiScheduler.loop = true;
        globalMidiScheduler.loopStartTicks = loopStart;
        globalMidiScheduler.loopEndTicks = loopEnd;

        // If we are currently playing and outside the new loop, jump to it
        if (globalMidiScheduler.isPlaying) {
            const currentTick = globalMidiScheduler.getCurrentTick();
            if (currentTick < loopStart || currentTick > loopEnd) {
                globalMidiScheduler.setPosition(loopStart);
            }
        }
    }

    public nextSection() {
        if (!this.song || !this.song.sections) return;
        this.setSection((this.currentSectionIndex + 1) % this.song.sections.length);
    }

    public triggerFill(pitch: number = 60) {
        if (this.fillSynth && pitch !== undefined && !isNaN(pitch)) {
            // Quantize to the next 16th note
            const currentTick = globalMidiScheduler.getCurrentTick();
            const ticksPer16th = globalMidiScheduler.ppq / 4;
            const next16thTick = Math.ceil(currentTick / ticksPer16th) * ticksPer16th;
            
            // We can't easily schedule a single note into the running scheduler without adding to its events array.
            // For now, just trigger immediately or use setTimeout based on time diff.
            // Since it's a fill, immediate is usually fine for UI feedback.
            this.fillSynth.triggerAttackRelease(pitch, 0.25, 0, 0.8);
            this.emitVisualEvent({ type: 'melody', midiNote: pitch, velocity: 100, onset: next16thTick / globalMidiScheduler.ppq, source: 'playback' });
        }
    }

    public triggerUserMotif(pitch: number = 60) {
        if (this.userMotifSynth && pitch !== undefined && !isNaN(pitch)) {
            this.userMotifSynth.triggerAttackRelease(pitch, 0.25, 0, 0.9);
        }
    }

    public playFeedback(instrument: string, pitch: number, time?: number) {
        if (pitch === undefined || isNaN(pitch)) return;
        
        if (instrument === 'drums') {
            const kickPitches = [36, 35];
            const snarePitches = [38, 40, 37, 39];
            const hihatPitches = [42, 44, 46];
            
            let synthToUse = this.extraDrumSynth;
            if (kickPitches.includes(pitch)) synthToUse = this.kickSynth;
            else if (snarePitches.includes(pitch)) synthToUse = this.snareSynth;
            else if (hihatPitches.includes(pitch)) synthToUse = this.hihatSynth;

            if (synthToUse) {
                synthToUse.triggerAttackRelease(pitch, 0.25, 0, 1.0);
            }
        } else if (instrument === 'melody' && this.userMotifSynth) {
            this.userMotifSynth.triggerAttackRelease(pitch, 0.25, 0, 1.0);
        }
    }

    public play() { 
        if (!this.isStopped && !globalMidiScheduler.isPlaying) {
            if (!globalMidiScheduler.loop && this.song?.sections?.length) {
                const lastSection = this.song.sections[this.song.sections.length - 1];
                globalMidiScheduler.loopStartTicks = 0;
                globalMidiScheduler.loopEndTicks = globalMidiScheduler.beatsToTicks(lastSection.endBeat);
                globalMidiScheduler.loop = true;
            }
            globalMidiScheduler.start(); 
        }
    }

    public stop() { 
        this.isStopped = true; 
        globalMidiScheduler.stop(); 
        globalMidiScheduler.loop = false;
    }
}
