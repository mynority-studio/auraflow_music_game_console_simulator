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

/* ---- copych FX 状态镜像（顶部栏效果器行显示用）----
 * 参数都是 JS 侧下发（wasm 无 getter），此处记录单一真源：boot 默认=固件 fx 头文件
 * 手调值（fx_reverb/fx_chorus init、fx_delay reset），per-song 值=setSongSpace 下发。
 * facade init（synth 重建）复位到 boot 默认。 */
export type CopychFxState = CopychSongSpace;

const COPYCH_FX_BOOT: CopychFxState = {
    reverb: { time: 0.45, level: 0.7, predelayMs: 10, damping: 0.7 },   // fx_reverb.h init() 手调默认
    chorus: { lfoHz: 0.5, depthS: 0.002, baseDelayS: 0.03 },            // fx_chorus.h init() 默认
    delay: { seconds: 0.25, feedback: 0.1, enabled: false },            // fx_delay.h reset()（cap/4=0.25s；song_enabled=false 待 per-song 开启）
};

let _fxState: CopychFxState = COPYCH_FX_BOOT;
const _fxListeners = new Set<() => void>();

export const getCopychFxState = (): CopychFxState => _fxState;
export const subscribeCopychFxState = (listener: () => void): (() => void) => {
    _fxListeners.add(listener);
    return () => { _fxListeners.delete(listener); };
};
const notifyFxState = (): void => {
    _fxListeners.forEach(l => { try { l(); } catch { /* ignore */ } });
};

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
                    _fxState = COPYCH_FX_BOOT;   // synth 重建 → FX 回 boot 默认
                    notifyFxState();
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
        _fxState = space;   // 镜像记录（顶部栏效果器行显示）
        notifyFxState();
    }

    public connect(node: AudioNode): void { this.node.connect(node); }
    public disconnect(): void { try { this.node.disconnect(); } catch { /* ignore */ } }
}
