/**
 * SynthManager — Copych WASM 合成器生命周期（ESP32 设备口径）
 *
 * 启动流程：
 *   1. getAudioContext() 单例
 *   2. startAudioContext() → ctx.resume() → register Copych worklet
 *      → fetch selected SF2 → CopychSynthFacade.init → connect device mirror chain
 *
 * 单 promise 串行：多次 startAudioContext() 只触发一次真正初始化。
 * 失败时 activeSynth 保持 null — 上层 `if (!activeSynth) return;` 守卫降级静音。
 *
 * `export let` 提供 live binding — 消费方 `import { activeSynth }` 会自动看到更新后的实例。
 */

import { AURA25_SF2_BANK_ID, AURA25_SF2_SIZE_LABEL, AURA25_SF2_URL } from '../sound/Aura25Palette';
import { CopychSynthFacade, ensureCopychWorkletModule, type SynthLike } from './copych/CopychSynthFacade';
import {
    getChannelModePref, getSampleRatePref, setChannelModePref, setSampleRatePref,
    type ChannelModePref, type SampleRatePref,
} from './audioOutputPrefs';
import { playbackMasterLiftForStyle } from './masteringProfile';

export const SOUND_FONT_BANKS = [
    {
        id: AURA25_SF2_BANK_ID,
        label: 'Aura25 24k Micro',
        sizeLabel: AURA25_SF2_SIZE_LABEL,
        url: AURA25_SF2_URL,
        bankManagerId: AURA25_SF2_BANK_ID,
        hint: '14 presets · 24kHz runtime palette with Room/TR-808/Brush drums',
    },
] as const;

export type SoundFontBank = typeof SOUND_FONT_BANKS[number];
export type SoundFontBankId = SoundFontBank['id'];

const SOUND_FONT_STORAGE_KEY = 'auraflow.soundFontBankId';
const DEFAULT_SOUND_FONT_BANK_ID: SoundFontBankId = SOUND_FONT_BANKS[0].id;

const isSoundFontBankId = (value: string | null): value is SoundFontBankId =>
    !!value && SOUND_FONT_BANKS.some(bank => bank.id === value);

const resolveSoundFontBank = (id: SoundFontBankId): SoundFontBank =>
    SOUND_FONT_BANKS.find(bank => bank.id === id) ?? SOUND_FONT_BANKS[0];

const readInitialSoundFontBankId = (): SoundFontBankId => {
    if (typeof window === 'undefined') return DEFAULT_SOUND_FONT_BANK_ID;
    try {
        const stored = window.localStorage.getItem(SOUND_FONT_STORAGE_KEY);
        return isSoundFontBankId(stored) ? stored : DEFAULT_SOUND_FONT_BANK_ID;
    } catch {
        return DEFAULT_SOUND_FONT_BANK_ID;
    }
};

// ES module live binding — 初始化后这两个变量被赋值，所有 import 端自动可见。
export let activeSynth: SynthLike | null = null;
export let isSynthReady = false;

// M1 批2（计划修订6）：synth 实例重建/断开时通知订阅方清缓存（SystemAudio.isInitialized /
// sandbox auditionProgram）——防 bank/采样率切换后残留旧初始化状态。注册方在各自模块
// 顶层 subscribe（它们本就 import 本模块，反向 import 会成环，故用注册表）。
const _synthResetListeners = new Set<() => void>();
export const subscribeSynthReset = (listener: () => void): (() => void) => {
    _synthResetListeners.add(listener);
    return () => { _synthResetListeners.delete(listener); };
};
const notifySynthReset = (): void => {
    _synthResetListeners.forEach(l => { try { l(); } catch { /* ignore */ } });
};

let _selectedSoundFontBankId: SoundFontBankId = readInitialSoundFontBankId();
let _loadedSoundFontBankId: SoundFontBankId | null = null;
let _soundFontStateListeners = new Set<() => void>();

export const getSelectedSoundFontBank = (): SoundFontBank =>
    resolveSoundFontBank(_selectedSoundFontBankId);

export const getLoadedSoundFontBank = (): SoundFontBank | null =>
    _loadedSoundFontBankId ? resolveSoundFontBank(_loadedSoundFontBankId) : null;

export const subscribeSoundFontBank = (listener: () => void): (() => void) => {
    _soundFontStateListeners.add(listener);
    return () => { _soundFontStateListeners.delete(listener); };
};

const notifySoundFontState = (): void => {
    _soundFontStateListeners.forEach(listener => {
        try { listener(); } catch { /* ignore */ }
    });
};

// Copych-only 输出链：Copych synth+FX -> style master lift -> device_postchain -> output。
let _channelModeNode: GainNode | null = null; // 输出末端声道模式（stereo 直通 / mono 强制下混）
let _masterNodes: AudioNode[] = [];
let _playbackMasterLift = playbackMasterLiftForStyle(undefined);

const applyPlaybackMasterLift = (): void => {
    const synth = activeSynth;
    if (synth instanceof CopychSynthFacade) synth.setDevicePostChain({ masterLift: _playbackMasterLift });
};

/** 风格级 master lift:只改总线输入,不改各轨 CC7/velocity。它进 Copych 设备保护链之前,确保最终 clamp 仍是最后一道。 */
export const setPlaybackMasterStyle = (style: string | undefined): void => {
    _playbackMasterLift = playbackMasterLiftForStyle(style);
    applyPlaybackMasterLift();
};

/** Copych-only 后不再切第二套母带；保留 API 兼容 Q+R 调用点。 */
export const setSandboxAuditionMaster = (_low: boolean): void => {
    // Copych-only: device mirror chain is the only output path.
};

let _startPromise: Promise<void> | null = null;

export const getAudioContext = (): AudioContext => {
    const w = window as unknown as { globalAudioContext?: AudioContext };
    if (!w.globalAudioContext) {
        const Ctor =
            (window as unknown as { AudioContext: typeof AudioContext }).AudioContext ??
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        // 采样率：锁定 24000=设备口径，24k SF2 样本 1:1 零重采样。
        // 采样率是 ctx 固有属性——切换须关旧 ctx 建新。
        w.globalAudioContext = new Ctor({
            latencyHint: 'interactive', // 实时试听/弹奏:最低输出延迟
            sampleRate: getSampleRatePref(),
        });
    }
    return w.globalAudioContext;
};

/** 关闭并清空全局 AudioContext（换采样率用；下一次 getAudioContext 按设备口径重建）。 */
const closeGlobalAudioContext = async (): Promise<void> => {
    const w = window as unknown as { globalAudioContext?: AudioContext };
    const ctx = w.globalAudioContext;
    if (!ctx) return;
    w.globalAudioContext = undefined;
    try { await ctx.close(); } catch { /* ignore */ }
};

/** 设备后链配置通路（听感排查批2）：达到当前 Copych facade；未就绪时 no-op
 *  （实际生效态经 facade 的 postchain-state 订阅回报，UI 以其为准）。 */
export const setCopychDevicePostChain = (cfg: Partial<import('./copych/CopychSynthFacade').CopychPostChainCfg>): void => {
    const synth = activeSynth;
    if (synth instanceof CopychSynthFacade) synth.setDevicePostChain(cfg);
};

const disconnectCurrentSynth = (): void => {
    const synth = activeSynth;
    if (synth) {
        try { (synth as CopychSynthFacade).panic?.(); } catch { /* ignore */ }   // 清 pending 队列 + C 层硬静音
        try { synth.disconnect(); } catch { /* ignore */ }
    }
    _masterNodes.forEach(node => {
        try { node.disconnect(); } catch { /* ignore */ }
    });
    _masterNodes = [];
    activeSynth = null;
    isSynthReady = false;
    _loadedSoundFontBankId = null;
    notifySynthReset();   // M1 批2：清订阅方缓存（SystemAudio/audioOut）
    notifySoundFontState();
};

const createMasterChannelModeNode = (ctx: AudioContext): GainNode => {
    const channelMode = ctx.createGain();
    channelMode.gain.value = 1.0;
    _channelModeNode = channelMode;
    applyChannelModeToNode();
    channelMode.connect(ctx.destination);
    return channelMode;
};

const connectMasterBuses = (ctx: AudioContext, synth: SynthLike): void => {
    // Copych 已在 AudioWorklet 内镜像固件输出后链：
    // synth+FX → 风格 master lift → device_postchain(gain/clip/mono/EQ/16bit) → 输出。
    // 这里保持透明，不再叠浏览器 compressor/limiter，否则就不是设备口径。
    const channelMode = createMasterChannelModeNode(ctx);
    const unityOut = ctx.createGain();
    unityOut.gain.value = 1.0;
    unityOut.connect(channelMode);
    synth.connect(unityOut);
    _masterNodes = [unityOut, channelMode];
};

/** 声道模式套用到末端节点（mono=explicit 1ch 强制下混 / stereo=直通）。 */
const applyChannelModeToNode = (): void => {
    if (!_channelModeNode) return;
    if (getChannelModePref() === 'mono') {
        _channelModeNode.channelCount = 1;
        _channelModeNode.channelCountMode = 'explicit';
    } else {
        _channelModeNode.channelCountMode = 'max';
        _channelModeNode.channelCount = 2;
    }
};

/** 切输出声道模式：运行期即时生效（仅改末端节点下混行为，不重建管线）。 */
export const setChannelMode = (mode: ChannelModePref): void => {
    if (getChannelModePref() === mode) return;
    setChannelModePref(mode);
    applyChannelModeToNode();
    notifySoundFontState();
};

/** 重建 24k 输出采样率上下文：采样率是 ctx 固有属性 → 关旧 ctx 建新 + 重建合成器。 */
export const setAudioSampleRate = (pref: SampleRatePref, forceReload = false): Promise<void> => enqueueRebuild(async () => {
    if (getSampleRatePref() === pref && !forceReload) return;
    const shouldReloadNow = forceReload || !!_startPromise || !!activeSynth || isSynthReady;
    setSampleRatePref(pref);
    notifySoundFontState();
    if (!shouldReloadNow) {
        await closeGlobalAudioContext();   // 清可能存在的旧率 ctx
        notifySoundFontState();            // close 后再通知：防徽标残显旧率
        return;
    }
    if (_startPromise) { try { await _startPromise; } catch { /* 旧加载失败也继续重建 */ } }
    disconnectCurrentSynth();
    await closeGlobalAudioContext();
    await startAudioContext();
});

const loadSelectedSynth = async (ctx: AudioContext): Promise<void> => {
    const bank = getSelectedSoundFontBank();
    disconnectCurrentSynth();

    await ensureCopychWorkletModule(ctx);
    const facade = new CopychSynthFacade(ctx);
    const response = await fetch(bank.url);
    if (!response.ok) {
        facade.disconnect();
        throw new Error(`SynthManager: SF2 fetch failed (${bank.url}, status ${response.status})`);
    }
    const buffer = await response.arrayBuffer();
    await facade.init(buffer);   // transfer 进 worklet，采样率=ctx.sampleRate（运行期注入）

    if (_selectedSoundFontBankId !== bank.id) {
        facade.disconnect();
        return loadSelectedSynth(ctx);
    }

    connectMasterBuses(ctx, facade);
    activeSynth = facade;
    isSynthReady = true;
    applyPlaybackMasterLift();
    _loadedSoundFontBankId = bank.id;
    notifySoundFontState();
};

export const startAudioContext = async (): Promise<void> => {
    const ctx = getAudioContext();
    if (ctx.state !== 'running') {
        try { await ctx.resume(); } catch { /* ignore */ }
    }
    if (activeSynth && isSynthReady && _loadedSoundFontBankId === _selectedSoundFontBankId) return;
    if (_startPromise) return _startPromise;
    const startPromise = (async () => {
        try {
            await loadSelectedSynth(ctx);
        } finally {
            if (_startPromise === startPromise) _startPromise = null;
        }
    })();
    _startPromise = startPromise;
    return startPromise;
};

/* ★重建串行链：采样率切换走「persist→disconnect→close ctx→start」重建流程，
 * 共享此 promise 链防交错重建。前序任务失败不阻断后序（catch 吞掉只为续链，
 * 任务自身错误仍向调用方抛出）。 */
let _rebuildChain: Promise<void> = Promise.resolve();
const enqueueRebuild = <T,>(task: () => Promise<T>): Promise<T> => {
    const run = _rebuildChain.then(task, task);
    _rebuildChain = run.then(() => undefined, () => undefined);
    return run;
};

export const setSelectedSoundFontBank = async (id: SoundFontBankId): Promise<void> => {
    const next = resolveSoundFontBank(id);
    if (next.id === _selectedSoundFontBankId && _loadedSoundFontBankId === next.id) return;

    const shouldReloadNow = !!_startPromise || !!activeSynth || isSynthReady;
    _selectedSoundFontBankId = next.id;
    try { window.localStorage.setItem(SOUND_FONT_STORAGE_KEY, next.id); } catch { /* ignore */ }
    notifySoundFontState();

    if (shouldReloadNow) {
        await startAudioContext();
    }
};
