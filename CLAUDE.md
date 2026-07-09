# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## copych WASM 后端硬约束（public/copych/，M1 落地 2026-07-09）

> 背景：`?synth=copych` feature flag 下，模拟器用 copych WASM（AuraFlow 设备同款合成引擎）
> 替代 SpessaSynth 出声。加载链：`src/core/audio/synthBackend.ts`（判据）→
> `SynthManager.loadSelectedSynth` copych 分支 → `src/core/audio/copych/CopychSynthFacade.ts`
> → `public/copych/copych_processor.js`（AudioWorklet）→ `public/copych/copych_synth.mjs`（WASM）。
>
> **合成器源码可改**：引擎 C++ 源在固件主仓 checkout 的
> `../components/synth/auraflow_synth/`（本仓是其 submodule，路径相对本仓根）——
> 在 simulator 语境下修改合成器代码是**允许且正确的路径**（那里是唯一真源）；
> 约束只落在下面的 vendored 产物纪律上。改核标准流程：改
> `../components/synth/auraflow_synth/src/synth/` 或 `ports/wasm/` → 跑
> `ports/wasm/build.sh` 重建 → 拷贝 `copych_synth.mjs` 到 `public/copych/` →
> 更新 PROVENANCE.md → 在 auraflow_synth 仓 commit 源码改动（勿只 commit 产物）。
> ⚠️ 别忘了同一份核也编进设备固件——核改动默认双端生效，设备侧影响要一并评估
> （host/node 冒烟与 FNV 基线在 auraflow_synth 仓，见其 README）。

1. **`public/copych/copych_synth.mjs` 是 vendored 构建产物**（emscripten SINGLE_FILE，
   wasm 二进制 base64 内嵌）——**禁止手改**（改引擎请改上述源码后重建）。唯一重生成
   途径：auraflow_synth 仓 `ports/wasm/build.sh`（emcc 版本口径见 PROVENANCE）构建 →
   拷贝至此 → **同步更新 `public/copych/PROVENANCE.md`**（源 commit + sha256）。实测
   sha256 与 PROVENANCE 记录不一致 = 违规状态，先修账再动别的。
2. **emcc 版本升级** → auraflow_synth 仓 `ports/wasm/node_smoke.mjs` 的 FNV 渲染基线
   必须重锁（不同编译器浮点代码生成不同），PROVENANCE 同步记录新口径。
3. **`public/copych/copych_processor.js` 是纯 JS AudioWorklet processor**（public 原样
   服务，不走 TS/vite 打包管线——与 spessasynth min.js 同款资产方式）。其 port 消息协议
   （init/ev/panic/space）与 `CopychSynthFacade.ts` 是一对合同——改任一侧必须同步另一侧。
4. **C ABI 变更**（auraflow_synth 仓 `ports/wasm/copych_wasm.cpp` 的 `copych_wasm_*`
   exports）→ 三处联动：processor 调用点 + facade + 重建并重 vendor 产物（规则 1 流程）。
5. **后端判据单一入口** = `src/core/audio/synthBackend.ts` 的 `isCopychBackend()`：
   CC95 三入口分流（`MidiScheduler.loadTrack` echo 展开 / `MidiScheduler.dispatchEvent` /
   `AudioEngine.controllerChange`）与 panic 分支都必须经它，**禁止散落 if**。
   **默认后端 = copych**（2026-07-09 用户拍板：模拟器定位=设备镜像参考，默认即设备之声）；
   切换走顶部导航合成器菜单（`SoundFontSelector.tsx` → `AudioEngine.setSynthBackend`）或
   URL `?synth=copych|spessa`（最高优先，命中即持久化 localStorage）。切换会停播放并重建
   合成器实例（echo 展开随后端变，在播曲目不可热迁移）。⚠️ 非浏览器环境（vitest node）
   判据也落默认 copych——测试里依赖 spessa 路径行为（echo 展开等）必须显式
   `vi.mock('./synthBackend')` 钉后端，勿依赖环境默认。
6. **panic 合同**：copych 后端的 stop/panic 必须走 `facade.panic()`（processor 先清
   pending 事件队列 → C 层逐通道 CC64=0 → soundOff 硬杀 → delay resetLine，镜像设备
   hard_silence）。**不要退回 CC123 路径**——copych 的 allNotesOff 遇 sustain 踩下会
   跳杀 voice → stop 后挂音（设备端修过的同款回归）。
7. **定位约束（2026-07-09 用户拍板）**：copych WASM = **嵌入式的镜像参考**，用于在浏览器
   评估设备端真实表现（同引擎/同 SF2/同 mono 口径/**同 24 kHz 渲染率**——copych 后端的
   AudioContext 建成 24000Hz，24k SF2 样本 1:1 零重采样；切后端会关旧 ctx 重建，worklet
   addModule 缓存 per-ctx）——**不做 web 音质优化分叉**。与
   spessa 的听感差距（mono 无声场、精简 FX、标定差）是记录在案的预期，不是要修的 bug；
   任何"让 copych 更好听"的改动必须先回设备侧对齐口径，不得 web 侧单方面调。
8. **许可**：copych 产物按 GPL-3.0-only 分发（含上游 copych MIT 部分），权威文本见
   auraflow_synth 仓 LICENSE/NOTICE；PROVENANCE.md 中的许可行不得删除。
