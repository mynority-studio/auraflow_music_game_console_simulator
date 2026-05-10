// ============================================================
// 🚧 STUB — SpessaSynth 生命周期占位
// ============================================================
//
// 历史功能：
//   - getAudioContext()：单例创建/复用 Web Audio AudioContext
//   - startAudioContext()：恢复 ctx + 初始化 SpessaSynth WorkletSynthesizer + 加载 GM128 SF2
//   - 暴露 spessaSynth 实例 + isSpessaSynthReady 标志，给上层乐器/混音使用
//
// 重构期占位行为：
//   - getAudioContext() 仍返回真实 AudioContext（消费方 .state / .resume() 调用不会崩）
//   - startAudioContext() 仅 resume()，不再加载 SF2 / 初始化 SpessaSynth
//   - spessaSynth = null：SystemAudio.ts 的 `if (!spessaSynth) return;` 守卫使所有
//     UI 反馈音效自然降级为静音
//   - isSpessaSynthReady = false
//
// 重构方向：
//   新音频引擎决定是否继续使用 SpessaSynth（也可直接 Web Audio 合成 / WebMIDI）。
//   保持 getAudioContext / startAudioContext 入口签名不变即可。
// ============================================================

export const spessaSynth: any = null;
export const isSpessaSynthReady = false;

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
};
