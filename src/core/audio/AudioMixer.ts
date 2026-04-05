import { WorkletSynthesizer } from 'spessasynth_lib';
import { getAudioContext } from './SynthManager';

export class AudioMixer {
    public masterBus: GainNode;
    public hpf: BiquadFilterNode;
    public lowShelf: BiquadFilterNode;
    public peakingEq: BiquadFilterNode;
    public highShelf: BiquadFilterNode;
    public lpf: BiquadFilterNode;
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
        
        // 🌟 Master DSP — Warm Lo-Fi Tone
        // 1. HPF: 清除超低频隆隆声
        this.hpf = nativeCtx.createBiquadFilter();
        this.hpf.type = 'highpass';
        this.hpf.frequency.value = 35;
        this.hpf.Q.value = 0.7;

        // 2. Low Shelf: 增加低频温暖感 (+1.5dB @ 200Hz)
        this.lowShelf = nativeCtx.createBiquadFilter();
        this.lowShelf.type = 'lowshelf';
        this.lowShelf.frequency.value = 200;
        this.lowShelf.gain.value = 1.5;

        // 3. Peaking EQ: 削减 300Hz 浑浊
        this.peakingEq = nativeCtx.createBiquadFilter();
        this.peakingEq.type = 'peaking';
        this.peakingEq.frequency.value = 300;
        this.peakingEq.Q.value = 1.5;
        this.peakingEq.gain.value = -3.0;

        // 4. High Shelf: 削减高频亮度（温暖化，原 +2.5 改为 -1.5）
        this.highShelf = nativeCtx.createBiquadFilter();
        this.highShelf.type = 'highshelf';
        this.highShelf.frequency.value = 6500;
        this.highShelf.gain.value = -1.5;

        // 5. LPF: 切掉 12kHz 以上的刺耳空气感
        this.lpf = nativeCtx.createBiquadFilter();
        this.lpf.type = 'lowpass';
        this.lpf.frequency.value = 12000;
        this.lpf.Q.value = 0.7;

        // 2. DynamicsCompressorNode (Master Glue 胶水压缩)
        this.masterCompressor = nativeCtx.createDynamicsCompressor();
        this.masterCompressor.threshold.value = -24; // -18 to -24
        this.masterCompressor.knee.value = 12;
        this.masterCompressor.ratio.value = 2.5;
        this.masterCompressor.attack.value = 0.03; // 30ms
        this.masterCompressor.release.value = 0.15; // 150ms
        
        this.masterBus = nativeCtx.createGain();
        this.masterBus.gain.value = 0.316; // -10dB approx
        
        this.spessaSynthBridge = nativeCtx.createGain();

        // Default Connection (Clean)
        this.connectCleanChain(nativeCtx);
    }

    private connectCleanChain(nativeCtx: AudioContext) {
        this.spessaSynthBridge.disconnect();
        this.masterBus.disconnect();
        this.hpf.disconnect();
        this.lowShelf.disconnect();
        this.peakingEq.disconnect();
        this.highShelf.disconnect();
        this.lpf.disconnect();
        this.masterCompressor.disconnect();
        this.makeupGain.disconnect();

        // Chain: SpessaSynth → MasterBus → HPF → LowShelf → PeakingEQ → HighShelf → LPF → Compressor → MakeupGain → Output
        this.spessaSynthBridge.connect(this.masterBus);
        this.masterBus.connect(this.hpf);
        this.hpf.connect(this.lowShelf);
        this.lowShelf.connect(this.peakingEq);
        this.peakingEq.connect(this.highShelf);
        this.highShelf.connect(this.lpf);
        this.lpf.connect(this.masterCompressor);
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