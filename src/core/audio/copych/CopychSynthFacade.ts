// ============================================================
// CopychSynthFacade — copych WASM 主线程 facade（M1 批2）
// ------------------------------------------------------------
// 暴露 Copych WASM 合成器消费面（SynthLike），
// 让 MidiScheduler/AudioEngine/SystemAudio/sandbox audioOut 共用同一设备口径。
// 事件经 AudioWorkletNode.port 投递到 copych_processor（public/copych/），
// {time} 选项原生透传为 when（不靠 try/catch 降级）。
//
// panic()（计划修订2）：processor 端先清 pending 队列再调 C 层硬静音
// （CC64=0→soundOff→delay resetLine，镜像设备 hard_silence）。
// ============================================================

/** 全仓合成器消费面。 */
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

export const COPYCH_FX_BOOT: CopychFxState = {
    reverb: { time: 0.45, level: 0.7, predelayMs: 10, damping: 0.7 },   // fx_reverb.h init() 手调默认
    chorus: { lfoHz: 0.5, depthS: 0.002, baseDelayS: 0.03 },            // fx_chorus.h init() 默认
    delay: { seconds: 0.25, feedback: 0.1, enabled: false },            // fx_delay.h reset()（cap/4=0.25s；song_enabled=false 待 per-song 开启）
};

let _fxState: CopychFxState = COPYCH_FX_BOOT;
const _fxListeners = new Set<() => void>();

/* ---- 设备后链（听感排查批2）状态镜像 ----
 * 固件输出后链（style master lift→校准 gain×1.8→Copych soft/hard clip→mono 折叠→EQ 6 段→终级饱和→16bit）
 * 的 web 复刻（DSP 在 public/copych/device_postchain.mjs，参数同源锚见彼处头注释）。
 * SF2 直出调平期默认临时 bypass，copych raw synth 直接出声；state=processor 回报的实际生效态。
 * gain/clip/mono/final clamp 在任何 ctx 采样率都生效；6 段小喇叭 EQ 仅 24k 有效，
 * 非 24k 时 reason 会提示 EQ bypass，UI 以 state 为准防分叉。
 * meters=链输出电平；用户主音量改走 masterLift，仍在保护链之前。 */
export interface CopychPostChainCfg {
    enabled: boolean;    /* SF2 直出调平期允许 false，全链 bypass */
    gain: boolean;      /* off ≡ 板上 ne gain 100 */
    eq: boolean;        /* off ≡ 板上 ne eq off */
    softclip: boolean;  /* off ≡ 板上 ne clip hard */
    quantize: boolean;  /* off=纯 float 链（非设备路径，仅诊断） */
    masterLift: number; /* 风格/用户级总线增益：进保护链之前，不在后链之后补响 */
}
export interface CopychPostChainState {
    active: boolean;
    srOk: boolean;
    cfg: CopychPostChainCfg;
    reason: string | null;
}
export interface CopychPostChainMeters {
    prePeak: number; preRms: number; postPeak: number; postRms: number;
    prePeakDb: number; preRmsDb: number; postPeakDb: number; postRmsDb: number;
    headroomDb: number; crestDb: number;
    softKnee: number; hardClip: number; samples: number;
    softKneeRate: number; hardClipRate: number;
    driveState: 'very-quiet' | 'quiet' | 'healthy' | 'soft-knee' | 'overdriven' | 'hard-clipping';
}

export const COPYCH_DEVICE_POSTCHAIN_PRESET: CopychPostChainCfg = {
    enabled: false,
    gain: false,
    eq: false,
    softclip: false,
    quantize: false,
    masterLift: 1,
};
export const COPYCH_MASTER_LIFT_MIN = 0.05;
export const COPYCH_MASTER_LIFT_MAX = 4;
export const COPYCH_DEFAULT_MASTER_LIFT = 1;

const POSTCHAIN_BOOT: CopychPostChainState = {
    active: false,
    srOk: true,
    cfg: COPYCH_DEVICE_POSTCHAIN_PRESET,
    reason: null,
};

let _pcState: CopychPostChainState = POSTCHAIN_BOOT;
let _pcMeters: CopychPostChainMeters | null = null;
const _pcListeners = new Set<() => void>();

export const getCopychPostChainState = (): CopychPostChainState => _pcState;
export const getCopychPostChainMeters = (): CopychPostChainMeters | null => _pcMeters;
export const subscribeCopychPostChain = (listener: () => void): (() => void) => {
    _pcListeners.add(listener);
    return () => { _pcListeners.delete(listener); };
};
const notifyPostChain = (): void => {
    _pcListeners.forEach(l => { try { l(); } catch { /* ignore */ } });
};

export const getCopychFxState = (): CopychFxState => _fxState;
export const subscribeCopychFxState = (listener: () => void): (() => void) => {
    _fxListeners.add(listener);
    return () => { _fxListeners.delete(listener); };
};
const notifyFxState = (): void => {
    _fxListeners.forEach(l => { try { l(); } catch { /* ignore */ } });
};

/** addModule 缓存 per-ctx（同一 ctx 只 addModule 一次；切采样率会重建 ctx）。 */
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
    private readonly ctxSampleRate: number;
    private _ready = false;

    constructor(ctx: AudioContext) {
        this.ctxSampleRate = ctx.sampleRate;
        this.node = new AudioWorkletNode(ctx, PROCESSOR_NAME, {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2],
        });
    }

    /** fetch 好的 SF2 ArrayBuffer → transfer 进 worklet 初始化（采样率=ctx.sampleRate，worklet 侧 sampleRate 全局）。 */
    public init(sf2: ArrayBuffer): Promise<void> {
        /* 设备后链常驻监听（state 回报 + 电平表）——synth 重建后回固件镜像预设。 */
        this.node.port.addEventListener('message', (e: MessageEvent) => {
            const d = e.data;
            if (d?.type === 'postchain-state') {
                _pcState = { active: !!d.active, srOk: !!d.srOk, cfg: d.cfg, reason: d.reason ?? null };
                notifyPostChain();
            } else if (d?.type === 'postchain-meters') {
                _pcMeters = d.m;
                notifyPostChain();
            }
        });
        return new Promise<void>((resolve, reject) => {
            const onMsg = (e: MessageEvent) => {
                const d = e.data;
                if (d?.type === 'ready') {
                    this.node.port.removeEventListener('message', onMsg);
                    this._ready = true;
                    _fxState = COPYCH_FX_BOOT;   // synth 重建 → FX 回 boot 默认
                    notifyFxState();             // 顶栏 FX 显示同步复位（否则停在上一首参数至下次 setSongSpace）
                    _pcState = {
                        ...POSTCHAIN_BOOT,
                        srOk: this.ctxSampleRate === 24000,
                        reason: this.ctxSampleRate === 24000 ? null : 'eq bypassed: sampleRate!=24000',
                    };
                    _pcMeters = null;
                    this.setDevicePostChain(COPYCH_DEVICE_POSTCHAIN_PRESET);
                    notifyPostChain();
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

    /** 设备后链配置（局部合并；实际生效态以 processor 回报的 postchain-state 为准）。 */
    public setDevicePostChain(cfg: Partial<CopychPostChainCfg>): void {
        this.node.port.postMessage({ type: 'postchain', cfg });
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
    /** pitch wheel 入参 14-bit(center=8192)。 */
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
