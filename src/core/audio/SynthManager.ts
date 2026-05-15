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

        synth.connect(ctx.destination);

        spessaSynth = synth;
        isSpessaSynthReady = true;
    })();
    return _startPromise;
};
