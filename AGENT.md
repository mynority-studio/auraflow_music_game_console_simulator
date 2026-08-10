# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Dream 5504 EK MIDI 输出硬约束

当前项目已经放弃浏览器内置合成器和本地 SF2 渲染路线。浏览器只负责生成编曲、渲染 MIDI 事件、通过 Web MIDI 下发到 Dream 5504 EK 开发板；发声、音色、最终 FX 和硬件输出由 5504/SAM 板卡负责。

1. **唯一正式发声链路**：`AudioEngine` → `globalMidiScheduler` → `Dream5504MidiOutput` → Web MIDI 输出设备。不要恢复 WebAudio、AudioWorklet、WASM sampler、SpessaSynth、Copych 或本地 SF2 fallback。
2. **未连接硬件时静音并提示**：播放生成曲、上传 MIDI、试听乐器都必须通过 `Dream5504MidiOutput.requireReady(...)` 或等价状态检查。未连接时不做浏览器兜底发声。
3. **Q+M 是控制面板，不是调度归属层**：MIDI 输出设备选择、开关、panic、端口刷新走 `Dream5504MidiOutput` 单例；UI 组件只订阅状态和调用方法，不直接注册 scheduler listener。
4. **音色目标是 GMBK5X128 / GM128**：Program Change 保持 GM 0-127；variation 用 CC0(Bank Select MSB)；鼓组在 ch10 只发 Program Change，不发 bank。完整列表来自 `components/samvs/.../GMBK5X128_Midi.tsv` 和 `src/core/sound/GMBK5X128Catalog.ts`。
5. **器配层仍是音乐算法真源**：instrument world、gesture/expression、groove contract、mix/spaceProfile 都在生成/器配层决定；render 和 AudioEngine 只消费这些合同，不再根据浏览器合成器状态二次推导。
6. **混音审计是硬件共享 FX 代理模型**：`renderMixAudit` 里的 hardware reverb/drive 指标只用于约束 MIDI CC、空间、总线比例，避免小喇叭目标被糊烂；它不是浏览器后处理链。
7. **Dream 子仓**：`components/samvs` 是当前硬件资料和音色表来源。不要再引入旧 `components/synth/auraflow_synth` 子仓或 `public/copych` 产物。

验证时至少跑：

```bash
pnpm exec tsc --noEmit
pnpm test -- --run
```
