/**
 * SynthManager — SpessaSynth WorkletSynthesizer 生命周期（Phase 2.D 实装版）
 *
 * 启动流程：
 *   1. getAudioContext() 单例
 *   2. startAudioContext() → ctx.resume() → registerPlaybackWorklet → new WorkletSynthesizer
 *      → fetch selected SF2 → soundBankManager.addSoundBank → await isReady
 *      → synth.connect(ctx.destination)
 *
 * 单 promise 串行：多次 startAudioContext() 只触发一次真正初始化。
 * 失败时 spessaSynth 保持 null — 上层 `if (!spessaSynth) return;` 守卫降级静音。
 *
 * `export let` 提供 live binding — 消费方 `import { spessaSynth }` 会自动看到更新后的实例。
 */

import { WorkletSynthesizer } from 'spessasynth_lib';
import { AURA25_SF2_BANK_ID, AURA25_SF2_SIZE_LABEL, AURA25_SF2_URL } from '../sound/Aura25Palette';
// Vite `?url` 后缀 — node_modules 内的 worklet processor 作为静态资源 emit，返回 URL 字符串
// 这是 WorkletSynthesizer 构造前必须 addModule 注册的处理器代码
import workletProcessorURL from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';

export const SOUND_FONT_BANKS = [
    {
        id: AURA25_SF2_BANK_ID,
        label: 'Aura25 24k Micro',
        sizeLabel: AURA25_SF2_SIZE_LABEL,
        url: AURA25_SF2_URL,
        bankManagerId: AURA25_SF2_BANK_ID,
        hint: '11 presets · 24kHz VHQ runtime palette with GeneralUser folk guitar',
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

// ES module live binding — 初始化后这两个变量被赋值，所有 import 端自动可见
export let spessaSynth: WorkletSynthesizer | null = null;
export let isSpessaSynthReady = false;

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

// ★ 双母带:成品播放走【压缩母带】(响而受控),Q+R MIDI 录入/试听走【零延迟软削波母带】
//   (省掉两级压缩器的 ~12ms lookahead → 现场弹更跟手)。synth 同一时刻只接一条,模式切换时换接。
let _compMasterIn: AudioNode | null = null;   // 压缩母带入口(成品)
let _scMasterIn: AudioNode | null = null;     // 软削波母带入口(试听,零延迟)
let _masterNodes: AudioNode[] = [];
let _masterMode: 'comp' | 'softclip' = 'comp';

/** 软饱和曲线(tanh,归一化到 ±1)—— 当场磨圆过冲,零 lookahead。 */
const softClipCurve = (): Float32Array => {
    const n = 1024, c = new Float32Array(n), k = 1.6, norm = Math.tanh(k);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * k) / norm; }
    return c;
};

/** 切换 synth 母带:low=true → 零延迟软削波(Q+R 试听/录入);low=false → 压缩母带(成品播放)。
 *  仅在模式真正变化时换接(不在每个音上 disconnect → 无 glitch)。 */
export const setSandboxAuditionMaster = (low: boolean): void => {
    const target: 'comp' | 'softclip' = low ? 'softclip' : 'comp';
    if (target === _masterMode || !spessaSynth || !_compMasterIn || !_scMasterIn) return;
    try { spessaSynth.disconnect(); } catch { /* ignore */ }
    spessaSynth.connect(low ? _scMasterIn : _compMasterIn);
    _masterMode = target;
};

let _startPromise: Promise<void> | null = null;
let _workletModulePromise: Promise<void> | null = null;

export const getAudioContext = (): AudioContext => {
    const w = window as unknown as { globalAudioContext?: AudioContext };
    if (!w.globalAudioContext) {
        const Ctor =
            (window as unknown as { AudioContext: typeof AudioContext }).AudioContext ??
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        w.globalAudioContext = new Ctor({ latencyHint: 'interactive' }); // 实时试听/弹奏:最低输出延迟
    }
    return w.globalAudioContext;
};

const ensureWorkletModule = async (ctx: AudioContext): Promise<void> => {
    if (!_workletModulePromise) {
        // 注册 AudioWorklet 处理器（spessasynth-worklet-processor）— WorkletSynthesizer
        // 构造时会 new AudioWorkletNode，要求此 processor 已 addModule。
        _workletModulePromise = ctx.audioWorklet.addModule(workletProcessorURL);
    }
    await _workletModulePromise;
};

const disconnectCurrentSynth = (): void => {
    const synth = spessaSynth;
    if (synth) {
        for (let ch = 0; ch < 16; ch++) {
            try { (synth as any).controllerChange?.(ch, 123, 0); } catch { /* ignore */ }
        }
        try { synth.disconnect(); } catch { /* ignore */ }
    }
    _masterNodes.forEach(node => {
        try { node.disconnect(); } catch { /* ignore */ }
    });
    _masterNodes = [];
    spessaSynth = null;
    isSpessaSynthReady = false;
    _loadedSoundFontBankId = null;
    _compMasterIn = null;
    _scMasterIn = null;
    _masterMode = 'comp';
    notifySoundFontState();
};

const connectMasterBuses = (ctx: AudioContext, synth: WorkletSynthesizer): void => {
    // ★ 母带总线(全局,POP 母带思路:响而受控,全局维持平衡——不靠拉单轨)。
    //   原来 synth 裸连 destination → 全 band 进来时浮点总和 >1.0 撞 DAC = 削波/刺耳。
    //   链:留余量(gain staging,-6dB 思路)→ SSL-式 glue 压缩(evens 动态、糊住跳变)
    //       → makeup(补回响度)→ brickwall limiter(-1.5dB 接住爆顶,绝不削波)。
    //   参考制作人 master-bus:contained-then-loud(峰值在总线收住,再统一响度)。
    const headroom = ctx.createGain();
    headroom.gain.value = 0.6; // 全局留余量,给母带链工作空间(不碰各轨相对平衡)
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -16; glue.knee.value = 12; glue.ratio.value = 2.5; glue.attack.value = 0.012; glue.release.value = 0.25;
    const makeup = ctx.createGain();
    makeup.gain.value = 1.5; // 补回响度(POP:响)
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1.5; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.06;
    headroom.connect(glue);
    glue.connect(makeup);
    makeup.connect(limiter);
    limiter.connect(ctx.destination);

    // ★ 平行【零延迟软削波母带】(Q+R 试听用):入口 gain → WaveShaper(oversample none = 零 lookahead)
    //   → makeup → destination。不含压缩器 → 省 ~12ms。成品播放仍走上面的压缩母带。
    const scIn = ctx.createGain();
    scIn.gain.value = 0.85;
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClipCurve();
    shaper.oversample = 'none'; // ★ 零延迟(2x/4x 会引入重采样延迟)
    const scMakeup = ctx.createGain();
    scMakeup.gain.value = 1.05;
    scIn.connect(shaper);
    shaper.connect(scMakeup);
    scMakeup.connect(ctx.destination);

    // 默认接压缩母带(成品/全局安全);Q+R 试听时再切到软削波。
    synth.connect(headroom);
    _compMasterIn = headroom;
    _scMasterIn = scIn;
    _masterNodes = [headroom, glue, makeup, limiter, scIn, shaper, scMakeup];
    _masterMode = 'comp';
};

const loadSelectedSynth = async (ctx: AudioContext): Promise<void> => {
    const bank = getSelectedSoundFontBank();
    disconnectCurrentSynth();

    await ensureWorkletModule(ctx);

    const synth = new WorkletSynthesizer(ctx);
    await synth.isReady;

    const response = await fetch(bank.url);
    if (!response.ok) {
        try { synth.disconnect(); } catch { /* ignore */ }
        throw new Error(`SynthManager: SF2 fetch failed (${bank.url}, status ${response.status})`);
    }
    const buffer = await response.arrayBuffer();
    await synth.soundBankManager.addSoundBank(buffer, bank.bankManagerId, 0);

    if (_selectedSoundFontBankId !== bank.id) {
        try { synth.disconnect(); } catch { /* ignore */ }
        return loadSelectedSynth(ctx);
    }

    connectMasterBuses(ctx, synth);
    spessaSynth = synth;
    isSpessaSynthReady = true;
    _loadedSoundFontBankId = bank.id;
    notifySoundFontState();
};

export const startAudioContext = async (): Promise<void> => {
    const ctx = getAudioContext();
    if (ctx.state !== 'running') {
        try { await ctx.resume(); } catch { /* ignore */ }
    }
    if (spessaSynth && isSpessaSynthReady && _loadedSoundFontBankId === _selectedSoundFontBankId) return;
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

export const setSelectedSoundFontBank = async (id: SoundFontBankId): Promise<void> => {
    const next = resolveSoundFontBank(id);
    if (next.id === _selectedSoundFontBankId && _loadedSoundFontBankId === next.id) return;

    const shouldReloadNow = !!_startPromise || !!spessaSynth || isSpessaSynthReady;
    _selectedSoundFontBankId = next.id;
    try { window.localStorage.setItem(SOUND_FONT_STORAGE_KEY, next.id); } catch { /* ignore */ }
    notifySoundFontState();

    if (shouldReloadNow) {
        await startAudioContext();
    }
};
