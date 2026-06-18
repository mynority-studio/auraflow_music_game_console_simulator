/**
 * SynthManager — SpessaSynth WorkletSynthesizer 生命周期（Phase 2.D 实装版）
 *
 * 启动流程：
 *   1. getAudioContext() 单例
 *   2. startAudioContext() → ctx.resume() → registerPlaybackWorklet → new WorkletSynthesizer
 *      → fetch /GM128_3MB.sf2 → soundBankManager.addSoundBank → await isReady
 *      → synth.connect(ctx.destination)
 *
 * 单 promise 串行：多次 startAudioContext() 只触发一次真正初始化。
 * 失败时 spessaSynth 保持 null — 上层 `if (!spessaSynth) return;` 守卫降级静音。
 *
 * `export let` 提供 live binding — 消费方 `import { spessaSynth }` 会自动看到更新后的实例。
 */

import { WorkletSynthesizer } from 'spessasynth_lib';
// Vite `?url` 后缀 — node_modules 内的 worklet processor 作为静态资源 emit，返回 URL 字符串
// 这是 WorkletSynthesizer 构造前必须 addModule 注册的处理器代码
import workletProcessorURL from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';

const SF2_URL = '/GM128_3MB.sf2';
const SF2_BANK_ID = 'gm128';

// ES module live binding — 初始化后这两个变量被赋值，所有 import 端自动可见
export let spessaSynth: WorkletSynthesizer | null = null;
export let isSpessaSynthReady = false;

// ★ 双母带:成品播放走【压缩母带】(响而受控),Q+R MIDI 录入/试听走【零延迟软削波母带】
//   (省掉两级压缩器的 ~12ms lookahead → 现场弹更跟手)。synth 同一时刻只接一条,模式切换时换接。
let _compMasterIn: AudioNode | null = null;   // 压缩母带入口(成品)
let _scMasterIn: AudioNode | null = null;     // 软削波母带入口(试听,零延迟)
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

export const startAudioContext = async (): Promise<void> => {
    const ctx = getAudioContext();
    if (ctx.state !== 'running') {
        try { await ctx.resume(); } catch { /* ignore */ }
    }
    if (_startPromise) return _startPromise;
    _startPromise = (async () => {
        // 注册 AudioWorklet 处理器（spessasynth-worklet-processor）— WorkletSynthesizer
        // 构造时会 new AudioWorkletNode，要求此 processor 已 addModule
        await ctx.audioWorklet.addModule(workletProcessorURL);

        const synth = new WorkletSynthesizer(ctx);
        await synth.isReady;

        const response = await fetch(SF2_URL);
        if (!response.ok) {
            throw new Error(`SynthManager: SF2 fetch failed (${SF2_URL}, status ${response.status})`);
        }
        const buffer = await response.arrayBuffer();
        await synth.soundBankManager.addSoundBank(buffer, SF2_BANK_ID, 0);

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
        _masterMode = 'comp';

        spessaSynth = synth;
        isSpessaSynthReady = true;
    })();
    return _startPromise;
};
