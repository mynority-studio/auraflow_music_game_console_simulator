import { PlaybackEngine, VisualEvent } from './PlaybackEngine';
import { GeneratedTrack, MusicContext } from '../generation/types';
import { StyleId } from '../generation/config/StyleFlags';
import { Orchestrator } from '../generation/arrangement/Orchestrator'; 
import { MelodyEngine } from '../generation/MelodyEngine'; // 引入新的流水线总管
import { globalMidiScheduler } from './MidiScheduler';
import { spessaSynth, isSpessaSynthReady, getAudioContext, startAudioContext } from './SynthManager';

export { spessaSynth, isSpessaSynthReady, getAudioContext, startAudioContext };

class AudioEngineSystem {
    private playback: PlaybackEngine | null = null;
    private generator: MelodyEngine | null = null;
    private visualsMode: 'all' | 'gameplay-only' = 'all';

    private visualListeners: Set<any> = new Set();
    private rawVisualListeners: Set<any> = new Set();

    public init() {
        if (!this.playback) {
            this.playback = new PlaybackEngine();
            // Forward events from PlaybackEngine to our listeners, respecting visualsMode
            this.playback.addVisualListener((event: VisualEvent) => {
                this.rawVisualListeners.forEach(l => l(event));
                if (this.visualsMode === 'gameplay-only' && event.source === 'playback') return;
                this.visualListeners.forEach(l => l(event));
            });
            // console.log(`[AudioEngine] 极智音频总线 V2 初始化完成。`);
        }
    }

    public async playSong(initialTrack: GeneratedTrack, styleId: StyleId, context: MusicContext, generator: MelodyEngine, options?: { withCountIn?: boolean, loopStart?: number, loopEnd?: number }) {
        if (!this.playback) this.init();
        this.generator = generator;
        
        // 调用 V2 编曲大脑
        const arrangedSong = Orchestrator.arrange(initialTrack, styleId, context);
        
        await this.playback!.loadSong(arrangedSong, options);
        this.playback!.play();
    }

    public stop() { 
        if (this.playback) this.playback.stop(); 
        this.generator = null;
    }
    public addVisualListener(listener: any) { this.visualListeners.add(listener); }
    public removeVisualListener(listener: any) { this.visualListeners.delete(listener); }
    
    public addRawVisualListener(listener: any) { this.rawVisualListeners.add(listener); }
    public removeRawVisualListener(listener: any) { this.rawVisualListeners.delete(listener); }
    
    public setVisualsMode(mode: 'all' | 'gameplay-only') {
        this.visualsMode = mode;
    }

    public setDrumDucking(enabled: boolean) {
        if (this.playback) {
            this.playback.setDrumDucking(enabled);
        }
    }

    public emitVisualEvent(event: VisualEvent) { 
        if (!this.playback) this.init(); 
        this.rawVisualListeners.forEach(l => l(event));
        if (this.visualsMode === 'gameplay-only' && event.source === 'playback') return;
        this.visualListeners.forEach(l => l(event));
    }

    public getMixerState() {
        if (!this.playback) this.init();
        return this.playback!.getMixerState();
    }

    public getDuration() {
        if (!this.playback) return 0;
        return this.playback.getDuration();
    }

    public setMixerParam(category: string, param: string, value: number) {
        if (!this.playback) this.init();
        this.playback!.setMixerParam(category, param, value);
    }

    public setFocusTrack(trackType: 'RHYTHM' | 'MELODY' | 'ATMOSPHERE' | 'NONE') {
        if (!this.playback) this.init();
        this.playback!.setFocusTrack(trackType);
    }

    // --- Jam Mode Methods ---
    public muteChannel(channel: number, mute: boolean) {
        globalMidiScheduler.muteChannel(channel, mute);
    }

    public isChannelMuted(channel: number): boolean {
        return globalMidiScheduler.isChannelMuted(channel);
    }

    public injectMidiEvent(ev: any) {
        globalMidiScheduler.injectEvent(ev);
    }

    public getChannelEvents(channel: number) {
        return globalMidiScheduler.getChannelEvents(channel);
    }

    public replaceChannelEvents(channel: number, startTick: number, newEvents: any[]) {
        globalMidiScheduler.replaceChannelEvents(channel, startTick, newEvents);
    }

    public playNote(channel: number, note: number, velocity: number = 100, durationMs: number = 200) {
        if (!spessaSynth) return;
        spessaSynth.noteOn(channel, note, velocity);
        setTimeout(() => {
            if (spessaSynth) spessaSynth.noteOff(channel, note);
        }, durationMs);
    }

    public getCurrentTick() {
        return globalMidiScheduler.getCurrentTick();
    }

    public getBpm() {
        return globalMidiScheduler.getBpm();
    }

    public getPpq() {
        return globalMidiScheduler.ppq;
    }
}

export const AudioEngine = new AudioEngineSystem();