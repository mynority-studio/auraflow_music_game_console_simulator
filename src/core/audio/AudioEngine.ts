import { PlaybackEngine, VisualEvent } from './PlaybackEngine';
import { GeneratedTrack, StyleConfig } from '../generation/types';
import { Orchestrator } from '../generation/arrangement/Orchestrator'; 
import { getAllAvailableStyles, getStyleConfig } from '../generation/config/styles/StyleRegistry';
import { MelodyEngine } from '../generation/MelodyEngine'; // 引入新的流水线总管
import { WorkletSynthesizer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import { globalMidiScheduler } from './MidiScheduler';

export let spessaSynth: WorkletSynthesizer | null = null;
export let isSpessaSynthReady = false;

// Global AudioContext singleton
export const getAudioContext = (): AudioContext => {
    if (!(window as any).globalAudioContext) {
        (window as any).globalAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return (window as any).globalAudioContext as AudioContext;
};

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

    public async playSong(initialTrack: GeneratedTrack, style: StyleConfig, generator: MelodyEngine, options?: { withCountIn?: boolean, loopStart?: number, loopEnd?: number }) {
        if (!this.playback) this.init();
        this.generator = generator;
        
        // 调用 V2 编曲大脑
        const arrangedSong = Orchestrator.arrange(initialTrack, style);
        
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
}

export const AudioEngine = new AudioEngineSystem();

let initPromise: Promise<void> | null = null;
let gm128Buffer: ArrayBuffer | null = null;

// Pre-fetch soundfonts immediately
fetch('/GM128_3MB.sf2')
    .then(r => r.arrayBuffer())
    .then(b => gm128Buffer = b)
    .catch(e => console.warn("Failed to prefetch GM128", e));

export const startAudioContext = async () => {
  const ctx = getAudioContext();
  if (ctx.state !== 'running') await ctx.resume();
  
  if (isSpessaSynthReady) return initPromise;
  
  if (!initPromise) {
      initPromise = (async () => {
          try {
              // console.log("[AudioEngine] Initializing SpessaSynth with native context");
              await ctx.audioWorklet.addModule(processorUrl);
              spessaSynth = new WorkletSynthesizer(ctx);
              
              // Note: AudioMixer will connect spessaSynth to its master bus later.
              // For now, connect directly to destination as a fallback if mixer isn't ready.
              try {
                  spessaSynth.connect(ctx.destination);
              } catch (e) {
                  console.warn("[AudioEngine] Could not connect spessaSynth to ctx.destination directly:", e);
              }
              
              // Initialize MidiScheduler
              globalMidiScheduler.init(spessaSynth);
              
              // Fetch and load GM128 soundfont
              if (!gm128Buffer) {
                  const response = await fetch('/GM128_3MB.sf2');
                  gm128Buffer = await response.arrayBuffer();
              }
              await spessaSynth.soundBankManager.addSoundBank(gm128Buffer, "main");
              
              await spessaSynth.isReady;
              
              isSpessaSynthReady = true;
              // console.log("[AudioEngine] SpessaSynth initialized and GM128 loaded.");
          } catch (e) {
              console.error("[AudioEngine] Failed to initialize SpessaSynth:", e);
              initPromise = null; // Allow retrying on failure
          }
      })();
  }
  
  return initPromise;
};