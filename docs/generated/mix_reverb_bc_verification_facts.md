# Mix/Reverb Plan — B/C 只读验证事实报告(2026-07-06)

> `claude_three_layer_mix_reverb_execution_plan.md` 的 B(DX7 tail / CC72)+ C(Aura25 SF2 zone sends)前置只读验证。
> **只读,未改任何代码/SF2。** 目的:用事实支撑用户拍板的 B/C,再开始 Layer 1/2 实现。

## #1 浏览器 SpessaSynth 是否响应 CC72(release time)?

**是。** `spessasynth_core@4.2.8`:
- `midiControllers.releaseTime = 72`(controller enum)。
- `setResetValue(midiControllers.releaseTime, 64)` —— **64-centered**(64=中性,>64 更长)。
- generator `reverbEffectsSend` def 0 / max 1000;CC72 → voice `overrideReleaseVolEnv`(注释 `// Cc n (release time) to volEnv release`)。
- voice 用 `voice.overrideReleaseVolEnv || modulatedGenerators[releaseVolEnv]` → **CC72 覆盖 volEnv release**。

## #2 copych ESP32 synth 是否响应 CC72?

**是。** `SF2Sampler/synth.cpp` + `voice.cpp`:
```cpp
// synth.cpp
case 72: // Release time modifier (64-centered)
    state.releaseModifier = knob_tbl[val] * 4.8072f; // 1.0 at val=64
// voice.cpp
ampEnv.setReleaseTime(zone.releaseTime * chan->releaseModifier);  // CC72 【乘】zone release
```
- **64-centered**(与 SpessaSynth 同惯例,val=64→1.0 中性)。
- 机制:CC72 → `releaseModifier` → **乘 zone.releaseTime**(缩放,非覆盖)。

**→ 两 synth 都响应 CC72、都 64-centered。** 差异:SpessaSynth = 覆盖 volEnv release;copych = 乘 zone release。都能延长尾音,但**依赖 SF2 zone 本身有非零 release**(copych 乘法:zone release=0 → CC72 无效)。

## #3 Aura25_GM128.sf2 每 zone 的 reverb/chorus send 是否一致?

**不一致。** 16 instruments / 181 instrument-zones(IGEN generator,单位 0.1%):
| generator | 分布 | 判断 |
|---|---|---|
| **reverbSend(16)** | `70`×124 · `31`×14 · `300`×7 · `39`×5 · `30`×2 · `50`×1 · **ABSENT**×28 | ❌ 从 30 到 **300**(10×)+ 28 缺省 |
| **chorusSend(15)** | **ABSENT**×173 · `125`×8 | ❌ 绝大多数缺省,少数 12.5% |

= 计划 Task 3.3 担心的**隐藏 mix 行为**属实:zone send 差 10×,同一 CC91 在不同 program 上产生差 10× 的 reverb。

## #4 两 synth 是否都是 `zoneSend * channelSend`?

**否 —— 模型不同。**
- **copych ESP32:乘法** `reverbAmount = zone.reverbSend * chan->reverbSend`(`voice.cpp:105-106`,chorus 同)。
- **SpessaSynth:SF2 default modulator** —— CC91(`reverbDepth:91`)是 modulator source,**调制** `reverbEffectsSend` generator(SF2 规范加性,generator 是 base send + CC91 调制),不是纯 zone×channel 乘法。

**→ 同一 (SF2, CC91) 在浏览器 vs ESP32 产生【不同】reverb** —— 组合数学不一样(copych 乘 · SpessaSynth 加性调制)。计划 Done Criteria"浏览器和 ESP32 共享同一 MIDI mix 契约"在【绝对 wet 量】上不成立,只在【相对平衡】上近似。

---

## 结论(映射用户拍板)

**B(DX7 tail)**:✅ **CC72 两 synth 都支持、64-centered**,可作**可选增强**(拍板优先级第 3)。但:
- copych 是乘 zone release → **DX7 zone 若 release≈0,CC72 无效** → 印证拍板"主方案=note gate/duration shaping,CC72 只增强"。
- 主力仍应 **note 时值/gate 塑形**(synth-无关,确定生效)+ light pedal(role/style 允许时);CC72 作 optional enhancement 且需先确认 DX7 zone release 非零。

**C(SF2 zone sends)**:两个"一致性"问题**都不一致** ——
1. SF2 zone sends 本身不一致(reverb 30-300+absent);
2. 两 synth 组合模型不同(copych 乘 · SpessaSynth 加性调制)。
- → 按拍板"**不一致→先代码补偿 + 文档,不直接动 SF2**"。**不归一化二进制。** 代码补偿方向(Layer 2/3 文档化):TrackMix 的 CC91/93 作为**相对**控制,承认浏览器≠ESP32 绝对 wet;若要 program 间一致,需在 mix 层按 program 的 zone-send 反向补偿(复杂,列为后续,不进第一版)。

## 下一步(按拍板)

事实已备。可开始实现 **Layer 1(instrumental tail)+ Layer 2(song space profile 扩展 gmMixProfile + TrackMix delay/CC95)+ audit/test**;ESP32 真实 I2S/WAV 验收后置(拍板 E);SF2 不动(拍板 C)。
