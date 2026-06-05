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

let _startPromise: Promise<void> | null = null;

export const getAudioContext = (): AudioContext => {
    const w = window as unknown as { globalAudioContext?: AudioContext };
    if (!w.globalAudioContext) {
        const Ctor =
            (window as unknown as { AudioContext: typeof AudioContext }).AudioContext ??
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        w.globalAudioContext = new Ctor();
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
        synth.connect(headroom);
        headroom.connect(glue);
        glue.connect(makeup);
        makeup.connect(limiter);
        limiter.connect(ctx.destination);

        spessaSynth = synth;
        isSpessaSynthReady = true;
    })();
    return _startPromise;
};
