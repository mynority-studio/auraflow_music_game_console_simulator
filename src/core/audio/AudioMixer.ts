import { WorkletSynthesizer } from 'spessasynth_lib';
import { getAudioContext } from './AudioEngine';

export class AudioMixer {
    public masterBus: GainNode;
    public masterCompressor: DynamicsCompressorNode;
    public makeupGain: GainNode;
    public currentStyle: string = 'default';
    
    // Intermediate node for native Web Audio API
    private spessaSynthBridge: GainNode;

    private channelStrips: Map<string, { channel: any }> = new Map();

    constructor() {
        const nativeCtx = getAudioContext();
        
        // 增加总增益并加入压缩器和限制器，防止爆音，平滑动态
        this.makeupGain = nativeCtx.createGain();
        this.makeupGain.gain.value = 4.0; // +12dB approx
        
        this.masterCompressor = nativeCtx.createDynamicsCompressor();
        this.masterCompressor.threshold.value = -24;
        this.masterCompressor.ratio.value = 4;
        this.masterCompressor.attack.value = 0.005;
        this.masterCompressor.release.value = 0.1;
        
        this.masterBus = nativeCtx.createGain();
        this.masterBus.gain.value = 0.316; // -10dB approx
        
        this.spessaSynthBridge = nativeCtx.createGain();
        
        // Connect the chain
        this.spessaSynthBridge.connect(this.masterBus);
        this.masterBus.connect(this.masterCompressor);
        this.masterCompressor.connect(this.makeupGain);
        this.makeupGain.connect(nativeCtx.destination);
    }

    public connectSpessaSynth(synth: WorkletSynthesizer) {
        try {
            synth.connect(this.spessaSynthBridge);
        } catch (e) {
            console.warn("[AudioMixer] Failed to connect spessaSynth to spessaSynthBridge, trying native destination", e);
            try {
                const ctx = getAudioContext();
                synth.connect(ctx.destination);
            } catch (err) {
                console.error("[AudioMixer] Failed to connect spessaSynth to native destination", err);
            }
        }
    }

    public async applyMasteringProfile(profileId: string) {
        // No-op
    }

    public routeInstrument(id: string, instrument: any, role: 'Foreground'|'Midground'|'Background'|'Rhythm', mixingConfig?: { pan: number, reverb: number, volume: number, delay?: number }) {
        // With SpessaSynth, routing is handled via MIDI CC messages in Instruments.ts
        // We don't need to create separate Web Audio API channels here.
    }

    private getStripByTrackId(trackId: string) {
        return undefined;
    }

    public setMixStyle(style: string) {
        this.currentStyle = style;
        // No-op since we removed style buses
    }

    public getMixerState() {
        return {
            volumes: {
                master: this.masterBus.gain.value,
                melody: 0,
                pianoLH: 7,
                pianoRH: 2
            },
            eq: {
                melody: { low: 0, mid: 0, high: 0 },
                piano: { low: 0, mid: 0, high: 0 }
            },
            effects: {
                reverbWet: 0,
                reverbRoomSize: 0,
                hallWet: 0,
                hallSize: 0,
                filterFreq: 20000,
                compThreshold: 0,
                compRatio: 1
            },
            system: {
                hardwareLofi: 0
            }
        };
    }

    public setMixerParam(category: string, param: string, value: number) {
        if (category === 'volumes') {
            if (param === 'master') this.masterBus.gain.value = value;
        }
    }

    public setFocusTrack(trackType: 'RHYTHM' | 'MELODY' | 'ATMOSPHERE' | 'NONE') {
        // No-op, handled via MIDI CC in the future if needed
    }

    public toggleHardwareLofiMode(enabled: boolean) {
        // No-op
    }

    public randomizeLofiNoise() {
        // No-op
    }

    public stopSoftwareCrackle() {
        // No-op
    }

    public stopAllNoise() {
        // No-op
    }

    public triggerSidechainDucking(time: number, duckDepth: number) {
        // No-op
    }
}