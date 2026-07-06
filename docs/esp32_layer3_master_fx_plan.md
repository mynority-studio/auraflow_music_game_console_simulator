# ESP32 Layer 3 — Master FX Routing & Hardware-Acceptance Plan

> **状态:文档 / 固件准备,不是实现。** 用户拍板(2026-07-06):Layer 1+2 软件 MIDI 契约已收(全绿);Layer 3 以
> **ESP32 / I2S / WAV capture 为最终事实**,不在浏览器"脑补验收"。本文件画清硬件验收地图,等 ESP32 真实输出再开工。
> **不改 SF2 二进制 · 不改 firmware · 不声称硬件已完成。** ESP32 target = `copych/ESP32_SF2_Sampler_Synthesizer`(`SF2Sampler/`)。

## 0. 两个模式(必须显式区分)

| 模式 | 角色 | 真源 |
|---|---|---|
| **Browser preview**(SpessaSynth) | 相对平衡参考(哪个轨太响/太干的相对判断) | ❌ **不是** FX 绝对湿度真源 |
| **ESP32 render**(copych + I2S/WAV) | **最终湿度 + master 真源** | ✅ FX 行为、湿度、master peak 以此为准 |

理由(B/C 验证已证,`docs/generated/mix_reverb_bc_verification_facts.md`):两 synth 的 send 组合数学**不同** ——
copych = `zoneSend * channelSend`(乘法);SpessaSynth = SF2 default modulator(CC91 加性调制 reverbEffectsSend)。
→ 同一 (SF2, CC91) 两边**绝对 wet 不同**,只相对平衡近似。**delay(CC95)浏览器 SpessaSynth 无 delay bus = inert**,只有 ESP32 可听。

## 1. copych synth 当前 FX routing(grounded,`SF2Sampler/`)

```text
voice dry output (voice.cpp: volL/volR = volume_scaler * modVolume * modExpression * velocityVolume * panL/R)
  -> channel.dryL / dryR 累加(synth.cpp:renderLRBlock ~L426-493)
  -> chorus send bus  (voice.chorusAmount = zone.chorusSend * channel.chorusSend, CC93)
  -> delay  send bus  (channel.delaySend, CC95)
  -> reverb send bus  (voice.reverbAmount = zone.reverbSend * channel.reverbSend, CC91)
  -> 各 global FX 处理(FxChorus / FxDelay / FxReverb,Freeverb-like)
  -> sum dry + FX returns -> outL/outR (synth.cpp ~L525-549)
  -> I2S DAC(44100Hz stereo 16-bit PCM)
```

**每-voice send = zone.send × channel.send(乘法)**。CC72(release)= `state.releaseModifier`(64-centered,knob_tbl[val]×4.8072,1.0@64)
→ `ampEnv.setReleaseTime(zone.releaseTime * releaseModifier)`(乘 zone release)。

## 2. AuraFlow MIDI contract → copych CC 映射(全 case grounded)

| CC | AuraFlow 语义 | copych 处理(synth.cpp case) | 备注 |
|---|---|---|---|
| **CC7** | 音量 volume(RoleMix/TrackMix) | `case 7: Channel Volume` → volume_scaler | 有效响度真源 |
| **CC10** | 声像 pan | `case 10: Pan` → v.updatePan() | |
| **CC11** | 表情 expression(静态/气声包络) | `case 11: Expression` → modExpression | wind/sax breath |
| **CC64** | 延音踏板(comp harmonic-change) | `case 64: Sustain Pedal` → release sustained voices | **只 comp;lead 永不 blanket** |
| **CC72** | release time(EP lead tail 主机制) | `case 72: Release time modifier(64-centered)` | 82>64 → 更长 release ring |
| **CC91** | reverb send | `case 91: reverbSend = fval` | × zone.reverbSend |
| **CC93** | chorus send | `case 93: chorusSend = fval` | × zone.chorusSend |
| **CC95** | delay send(极克制:rnb/DX7 lead·lofi lead+comp) | `case 95: delaySend = fval` | 浏览器 inert,ESP32 可听 |

**AuraFlow 发的 8 个 CC copych 全支持。** 发射点 = `src/core/audio/musicalIrToMidi.ts::pushMixCC`(CC7/10/91/93/11/95)+ gestureExpression(CC72/64)。

## 3. SongSpaceProfile → ESP32 FxReverb/FxChorus/FxDelay 参数映射

真源 = `knowledge/gmMixProfile.ts::SongSpaceProfile`(器配-owned,`songSpaceProfile(style,world,hasPad)` 确定性)。
ESP32 firmware 侧照此把每首歌的 song space 一次性 set 进 global FX(不随音符变;随歌变):

| SongSpaceProfile 字段 | copych setter(fx_*.h,grounded) | 单位/范围 |
|---|---|---|
| `reverbTime` | `FxReverb::setTime(v)` | 0..1(默认 0.8) |
| `reverbLevel` | `FxReverb::setLevel(v)` | 0..1(默认 1.0) |
| `predelayMs` | `FxReverb::setPreDelayTime(ms)` | ms |
| `damping` | `FxReverb::setDamping(d)` | 0..1(默认 0.6) |
| `chorusLfoHz` | `FxChorus::setLfoFreq(hz)` | Hz |
| `chorusDepth` | `FxChorus::setDepth(d)` | ~0.002 量级 |
| `chorusBaseDelay` | `FxChorus::setBaseDelay(d)` | |
| `delayMode` | `FxDelay::setMode() + setDelayTime(DelayTimeDiv, bpm)` | off/eighth/dotted-eighth/quarter |
| `delayFeedback` | `FxDelay::setFeedback(v)` | 0..1 |

**当前 6 空间参数值**(gmMixProfile SONG_SPACE_PROFILES)是**初始估值**,必须经 §6 真实 capture 校准。firmware 侧建议加一个 `applySongSpace(const SongSpaceProfile&)`,从 MIDI SysEx 或编译期表接收。

## 4. SF2 zoneSend × channelSend 补偿策略(方案,先不实现)

**问题**(已证):Aura25_GM128.sf2 的 zone reverbSend 不一致(181 zones:30/31/39/50/70/300 + 28 absent;chorusSend 多数 absent + 125×8)。
因 copych 乘法 `zone×channel`,同一 CC91 在不同 program 上产生**差 10× 的 reverb** = 隐藏 mix 行为。

**补偿方案(等 firmware ready 再实现 + 用真实 capture 校准)**:

```text
// 目标:让 CC91/93 成为跨 program 一致的相对控制(TrackMix 是单一真源)
normalizedZoneSend = 每 program 的代表 zone reverbSend / REFERENCE_SEND   // REFERENCE_SEND 建议 = 众数 70
effectiveSend = clamp(targetSend / normalizedZoneSend, 0.0, 1.0)
// firmware 侧:发给 channel.reverbSend 的值 = effectiveSend * targetSend(或等价查表)
```

**约束**:
- **不改 SF2 二进制**(拍板 C):补偿在 **code/firmware 侧**,SF2 保持原样。
- REFERENCE_SEND + 每 program normalizedZoneSend 需从 SF2 实际 dump(§附录 A 已有分布)+ 真实 capture 双向校准。
- 若某 program zone send = absent(0),copych 乘法 → 该 program **CC91 无效**(乘 0)。这些 program(28 zones)需 firmware 侧给一个 default zone send(如 70)或在补偿表里特判。**先记录,capture 时确认哪些 program 受影响。**
- 浏览器侧**不做**此补偿(SpessaSynth 加性模型不同;浏览器只作相对参考)。

## 5. Master headroom / limiter / softclip 设计

copych `renderLRBlock` 末:`outL[i] = dryL[i]`(dry + FX returns 求和,float),再写 I2S 16-bit PCM。
**风险**:多轨 dry + reverb/chorus/delay returns 求和后 float 可能 > 1.0 → int16 转换**硬 clip**(爆音)。

**Layer 3 master 保护设计(firmware 侧,待实现)**:
```text
sum = dry + reverbReturn + chorusReturn + delayReturn
sum *= MASTER_HEADROOM        // 预留 headroom,建议起始 0.7~0.8(留 ~2-3 dB)
sum = softclip(sum)           // 软削波:sum = tanh(sum) 或 fast_shape 多项式,过阈值软压不硬切
out16 = clamp(sum * 32767, -32768, 32767)   // 兜底硬 clamp(softclip 后基本不触发)
```
**验收不变量**:final int16 输出**不经过 limiter/softclip 不可能 clip**;synth 不 bypass master 保护。
MASTER_HEADROOM + softclip 曲线**必须经 §6 真实 capture 的 peak 测量校准**(不同 style/seed 的多轨叠加峰值不同)。

## 6. I2S / WAV capture 验收流程(最终真源)

```text
1. firmware:接受 AuraFlow MIDI(CC7/10/11/64/72/91/93/95 + programChange + note)+ 每首 applySongSpace()。
2. 固定 seed/style 生成 → 导出 AuraFlow MIDI(现有 musicalIrToMidi 产的事件序列)。
3. ESP32 播放 → I2S 抓 WAV(或 SD/串口 dump PCM),44100/16-bit stereo。
4. 分析 WAV:
   - master peak(dBFS)—— 不得 clip(< 0 dBFS,留 headroom)。
   - 逐轨相对 wet(用单轨 solo capture 对照)。
   - DX7 lead tail:CC72 是否产生可听 release ring(且不糊 legato)。
   - delay(CC95):rnb/lofi lead 是否有点状 delay(dotted-eighth/dusty),不铺满。
   - "一个空间":全轨听起来同一个 room,不是几个房间。
5. 校准回写:SongSpaceProfile 参数 · SF2 zone 补偿表 · MASTER_HEADROOM/softclip —— 据 capture 调,再迭代。
```

## 7. 测试 seed 列表(capture 用)

```text
pop:  seed 1, 4, 11
rnb:  seed 3, 7, 11
lofi: seed 1, 7, 42
jazz: seed 0, 7
acg:  seed 0, 7
```
重点 capture(软件侧已知命中,`docs/generated/dx7_tail_report.md`):
- **EP lead CC72 tail**:lofi 1 / lofi 7 / lofi 42 / rnb 7(lead program=5)。
- **EP comp pedal**:pop 1 / rnb 3。
- **delay CC95**:lofi 1/7(lead+comp)· rnb 7(lead)。
- **master peak**:全 seed(尤 chorus 全员的 pop/rnb 满编段)。

## Done Criteria(Layer 3,硬件阶段)

- [ ] firmware 接受并测试 CC7/10/11/64/72/91/93/95。
- [ ] `applySongSpace()` 把 SongSpaceProfile set 进 FxReverb/FxChorus/FxDelay。
- [ ] SF2 zone 补偿表(code 侧,不改二进制)+ capture 校准。
- [ ] master headroom + limiter/softclip:final int16 不可能 clip。
- [ ] §7 seed 的 WAV capture:master 不 clip · DX7 tail 可听不糊 · delay 点状 · 一个空间。
- [ ] 浏览器 = 相对平衡参考;ESP32 = 最终湿度/master 真源(两模式文档化)。

## 附录 A:Aura25_GM128.sf2 zone send 实测分布(只读,来自 B/C 验证)

- reverbSend(IGEN gen16,181 zones):`70`×124 · `31`×14 · `300`×7 · `39`×5 · `30`×2 · `50`×1 · absent×28。
- chorusSend(IGEN gen15):absent×173 · `125`×8。
- → 补偿表 REFERENCE_SEND 建议 70(众数);300 那 7 个 zone 是重点(会比 CC91 名义值响 ~4.3×)。
