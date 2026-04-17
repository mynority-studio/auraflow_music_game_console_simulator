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
    public waveshaper: WaveShaperNode; // 磁带饱和模拟

    // Intermediate node for native Web Audio API
    private spessaSynthBridge: GainNode;

    private channelStrips: Map<string, { channel: any }> = new Map();

    constructor() {
        const nativeCtx = getAudioContext();
        
        // 增加总增益并加入压缩器和限制器，防止爆音，平滑动态
        this.makeupGain = nativeCtx.createGain();
        this.makeupGain.gain.value = 2.5; // +8dB approx
        
        // 🌟 Master DSP — 3D Panoramic Clean Tone
        // 1. HPF: 清除次声波
        this.hpf = nativeCtx.createBiquadFilter();
        this.hpf.type = 'highpass';
        this.hpf.frequency.value = 35;
        this.hpf.Q.value = 0.7;

        // 2. Low Shelf: 🌟 F-Bass-Mix 补贝斯厚度（200Hz 以下 +2dB，让 sub bass 有重量感）
        this.lowShelf = nativeCtx.createBiquadFilter();
        this.lowShelf.type = 'lowshelf';
        this.lowShelf.frequency.value = 200;
        this.lowShelf.gain.value = 2.0;

        // 3. Peaking EQ: 🌟 F-Bass-Mix 频率从 250→350Hz（避开贝斯肉感）, gain -4→-2.5dB（不要这么狠）
        this.peakingEq = nativeCtx.createBiquadFilter();
        this.peakingEq.type = 'peaking';
        this.peakingEq.frequency.value = 350;
        this.peakingEq.Q.value = 1.2;
        this.peakingEq.gain.value = -2.5;

        // 4. High Shelf: 温柔高频
        this.highShelf = nativeCtx.createBiquadFilter();
        this.highShelf.type = 'highshelf';
        this.highShelf.frequency.value = 6000;
        this.highShelf.gain.value = -1.5;

        // 5. LPF: 切掉 11kHz 以上数码感
        this.lpf = nativeCtx.createBiquadFilter();
        this.lpf.type = 'lowpass';
        this.lpf.frequency.value = 11000;
        this.lpf.Q.value = 0.7;

        // 6. WaveShaper: 磁带饱和模拟（默认 bypass = 线性曲线）
        this.waveshaper = nativeCtx.createWaveShaper();
        this.waveshaper.curve = this.makeLinearCurve();
        this.waveshaper.oversample = '2x';

        // 2. DynamicsCompressorNode (Master Glue 胶水压缩)
        this.masterCompressor = nativeCtx.createDynamicsCompressor();
        this.masterCompressor.threshold.value = -22;
        this.masterCompressor.knee.value = 10;
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
        this.waveshaper.disconnect();
        this.masterCompressor.disconnect();
        this.makeupGain.disconnect();

        // Chain: SpessaSynth → MasterBus → HPF → LowShelf → PeakingEQ → HighShelf → LPF → WaveShaper → Compressor → MakeupGain → Output
        this.spessaSynthBridge.connect(this.masterBus);
        this.masterBus.connect(this.hpf);
        this.hpf.connect(this.lowShelf);
        this.lowShelf.connect(this.peakingEq);
        this.peakingEq.connect(this.highShelf);
        this.highShelf.connect(this.lpf);
        this.lpf.connect(this.waveshaper);
        this.waveshaper.connect(this.masterCompressor);
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
        const nativeCtx = getAudioContext();

        if (profileId === 'Vinyl_Warmth') {
            // 🌟 Lo-Fi Vinyl 质感：模拟老式磁带/收音机
            this.lpf.frequency.value = 6500;          // 激进低通（磁带高频衰减）
            this.lpf.Q.value = 0.5;                   // 平缓滚降
            this.highShelf.frequency.value = 4000;     // 更低频率开始衰减
            this.highShelf.gain.value = -4.0;          // 强力削高频
            this.lowShelf.gain.value = 3.0;            // 加厚低频温暖感
            this.peakingEq.frequency.value = 800;      // 提升中低频（收音机特征）
            this.peakingEq.gain.value = 1.5;           // 轻微 boost
            this.peakingEq.Q.value = 0.8;
            this.hpf.frequency.value = 80;             // 提高 HPF（模拟小喇叭无极低频）
            this.waveshaper.curve = this.makeTapeSaturationCurve(0.4); // 轻微磁带饱和
            this.masterCompressor.threshold.value = -20;
            this.masterCompressor.ratio.value = 3.0;   // 更重压缩（磁带压缩感）
            this.makeupGain.gain.value = 3.5;          // 稍降增益（Lo-fi 不需要太响）
        } else if (profileId === 'Retro_Gadget') {
            // 🌟 Retro Gadget：温暖复古但清晰
            this.lpf.frequency.value = 10000;
            this.lpf.Q.value = 0.7;
            this.highShelf.frequency.value = 6000;
            this.highShelf.gain.value = -2.0;
            this.lowShelf.gain.value = 0;
            this.peakingEq.frequency.value = 250;
            this.peakingEq.gain.value = -4.0;
            this.peakingEq.Q.value = 1.2;
            this.hpf.frequency.value = 35;
            this.waveshaper.curve = this.makeLinearCurve();
            this.masterCompressor.threshold.value = -22;
            this.masterCompressor.knee.value = 10;
            this.masterCompressor.ratio.value = 2.5;
            this.makeupGain.gain.value = 2.5;
        } else {
            // Modern_HiFi / Default
            this.lpf.frequency.value = 11000;
            this.lpf.Q.value = 0.7;
            this.highShelf.frequency.value = 6000;
            this.highShelf.gain.value = -1.5;
            this.lowShelf.gain.value = 0;
            this.peakingEq.frequency.value = 250;
            this.peakingEq.gain.value = -4.0;
            this.peakingEq.Q.value = 1.2;
            this.hpf.frequency.value = 35;
            this.waveshaper.curve = this.makeLinearCurve();
            this.masterCompressor.threshold.value = -22;
            this.masterCompressor.knee.value = 10;
            this.masterCompressor.ratio.value = 2.5;
            this.makeupGain.gain.value = 2.5;
        }

        // 重新连接信号链
        this.connectCleanChain(nativeCtx);
    }

    /** 线性曲线（bypass，无失真） */
    private makeLinearCurve(): Float32Array {
        const samples = 256;
        const curve = new Float32Array(samples);
        for (let i = 0; i < samples; i++) {
            curve[i] = (i * 2) / samples - 1;
        }
        return curve;
    }

    /** 磁带饱和曲线（soft clipping）— amount: 0=无, 1=强 */
    private makeTapeSaturationCurve(amount: number): Float32Array {
        const samples = 256;
        const curve = new Float32Array(samples);
        for (let i = 0; i < samples; i++) {
            const x = (i * 2) / samples - 1;
            // 双曲正切软削波：amount 控制饱和程度
            curve[i] = Math.tanh(x * (1 + amount * 3));
        }
        return curve;
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