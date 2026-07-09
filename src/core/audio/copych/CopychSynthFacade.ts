// ============================================================
// CopychSynthFacade — copych WASM 后端主线程 facade（M1 批2）
// ------------------------------------------------------------
// 暴露与 SpessaSynth WorkletSynthesizer 结构兼容的消费面（SynthLike），
// 让 MidiScheduler/AudioEngine/SystemAudio/sandbox audioOut 的调用点零改动。
// 事件经 AudioWorkletNode.port 投递到 copych_processor（public/copych/），
// {time} 选项原生透传为 when（不靠 try/catch 降级）。
//
// panic()（计划修订2）：processor 端先清 pending 队列再调 C 层硬静音
// （CC64=0→soundOff→delay resetLine，镜像设备 hard_silence）。
// ============================================================

/** 全仓 spessaSynth 消费面（结构化类型；WorkletSynthesizer 天然满足）。 */
export interface SynthLike {
    noteOn(channel: number, note: number, velocity: number, options?: { time?: number }): void;
    noteOff(channel: number, note: number, options?: { time?: number }): void;
    programChange(channel: number, program: number): void;
    controllerChange(channel: number, controller: number, value: number): void;
    connect(node: AudioNode): void;
    disconnect(): void;
}

export interface CopychSongSpace {
    reverb: { time: number; level: number; predelayMs: number; damping: number };
    chorus: { lfoHz: number; depthS: number; baseDelayS: number };
    delay: { seconds: number; feedback: number; enabled: boolean };
}

const PROCESSOR_URL = '/copych/copych_processor.js';
const PROCESSOR_NAME = 'copych-processor';

/** addModule 缓存 per-ctx（同一 ctx 只 addModule 一次；切后端会重建 ctx——采样率随后端变）。 */
const _modulePromiseByCtx = new WeakMap<AudioContext, Promise<void>>();
export const ensureCopychWorkletModule = (ctx: AudioContext): Promise<void> => {
    let p = _modulePromiseByCtx.get(ctx);
    if (!p) {
        p = ctx.audioWorklet.addModule(PROCESSOR_URL);
        _modulePromiseByCtx.set(ctx, p);
    }
    return p;
};

export class CopychSynthFacade implements SynthLike {
    private readonly node: AudioWorkletNode;
    private _ready = false;

    constructor(ctx: AudioContext) {
        this.node = new AudioWorkletNode(ctx, PROCESSOR_NAME, {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2],
        });
    }

    /** fetch 好的 SF2 ArrayBuffer → transfer 进 worklet 初始化（采样率=ctx.sampleRate，worklet 侧 sampleRate 全局）。 */
    public init(sf2: ArrayBuffer): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const onMsg = (e: MessageEvent) => {
                const d = e.data;
                if (d?.type === 'ready') {
                    this.node.port.removeEventListener('message', onMsg);
                    this._ready = true;
                    resolve();
                } else if (d?.type === 'error') {
                    this.node.port.removeEventListener('message', onMsg);
                    reject(new Error(d.msg ?? 'copych init failed'));
                }
            };
            this.node.port.addEventListener('message', onMsg);
            this.node.port.start();
            this.node.port.postMessage({ type: 'init', sf2 }, [sf2]);
        });
    }

    public get isReady(): boolean { return this._ready; }

    private post(kind: 'on' | 'off' | 'cc' | 'prog' | 'bend', ch: number, a: number, b = 0, when = 0): void {
        this.node.port.postMessage({ type: 'ev', kind, ch, a, b, when });
    }

    public noteOn(channel: number, note: number, velocity: number, options?: { time?: number }): void {
        this.post('on', channel, note, velocity, options?.time ?? 0);
    }
    public noteOff(channel: number, note: number, options?: { time?: number }): void {
        this.post('off', channel, note, 0, options?.time ?? 0);
    }
    public programChange(channel: number, program: number): void {
        this.post('prog', channel, program);
    }
    public controllerChange(channel: number, controller: number, value: number): void {
        this.post('cc', channel, controller, value);
    }
    /** 与 spessa pitchWheel 调用形状对齐（MidiScheduler: pitchWheel(ch, data1)）；入参 14-bit。 */
    public pitchWheel(channel: number, value14: number): void {
        this.post('bend', channel, value14);
    }

    /** panic：processor 清 pending 队列 + C 层硬静音（详见文件头）。 */
    public panic(): void {
        this.node.port.postMessage({ type: 'panic' });
    }

    /** per-song 空间参数（SONG_SPACE_PROFILES → FxReverb/FxChorus/FxDelay，镜像设备 AR_CMD_SONG_*）。 */
    public setSongSpace(space: CopychSongSpace): void {
        this.node.port.postMessage({ type: 'space', ...space });
    }

    public connect(node: AudioNode): void { this.node.connect(node); }
    public disconnect(): void { try { this.node.disconnect(); } catch { /* ignore */ } }
}
