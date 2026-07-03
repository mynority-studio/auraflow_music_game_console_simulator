# Q+T 用户接管沙盒节奏吸附与两八度铺键任务清单

Owner: Codex / Claude implementation task  
Scope: `Q+T 用户接管沙盒` only  
Date: 2026-07-02

## 0. 目标

让 Q+T 用户接管从“音高安全”升级到“音高安全 + 节奏可听”。

本任务只处理用户接管沙盒输入层:

1. 用户按下 3x5 TAP AREA 后,`noteOn` 触发点吸附到当前音乐 bar 内的 16 分位或 32 分位。
2. 3x5 安全音铺键不再从 C3-C5 线性低到高铺 15 个音,改为以当前和弦根音的高音区八度为中心,放在 3x5 中心键,两侧都向下方两八度内展开。

## 1. 硬边界

本任务不允许改 Q+H / Q+N 主生成链路。

允许修改:

- `src/core/generation/leadTakeoverSandbox/**`
- Q+T 沙盒专用测试
- 必要的 Q+T 沙盒文档

原则上不要修改:

- `src/core/generation/musicGeneration/**`
- `src/core/generation/newEngine/**`
- `src/components/PipelineMonitor.tsx`
- `src/core/audio/AudioEngine.ts`
- `src/core/audio/MidiScheduler.ts`

例外:

- 如果发现 Q+T 沙盒已有消费适配层需要小接口,只能在 `leadTakeoverSandbox/qhTakeoverConsumer.ts` 内做最小封装,不要把主链路 API 改成服务 Q+T。
- 为了让吸附点真正贴近 audio clock,允许在 `AudioEngine` 增加通用的 `getAudioTime` / `noteOnAt` / `noteOffAt` 辅助方法,但不改 Q+H 生成和播放主链路。
- 为了让 Q+T 对齐主歌 groove,允许在 `musicGeneration` 的 `uiSnapshot` 增加只读 `grooveContract` 投影字段;不得改 newEngine 的选择/渲染/播放算法。

## 2. 当前上下文

当前 Q+T 相关文件:

- `src/core/generation/leadTakeoverSandbox/harmonicNoteMap.ts`
  - 当前职责:根据 Q+H 当前和弦、局部音阶和 KB 张力表生成 15 个安全 pad。
  - 当前问题:低到高从 C3-C5 铺开,实际演奏跨度偏宽,横跨接近或超过用户感知上的 3 个八度空间。
- `src/core/generation/leadTakeoverSandbox/leadTakeoverController.ts`
  - 当前职责:把 pad `noteOn/noteOff` 转成接管动作,并控制 lead handoff / mute / release。
  - 当前问题:输入触发点按用户真实按下时间直接发声,没有节奏扶正。
- `src/core/generation/leadTakeoverSandbox/qhTakeoverConsumer.ts`
  - 当前职责:消费 Q+T action,用 Q+H 当前 `MusicGenerationResult` 的 lead 音色设置发出用户接管音。
  - 当前约束:不要回到“每次按键向 scheduler 注入大量 MIDI 事件”的实现,避免资源持续上涨。
  - 当前 timing 策略:真实 AudioEngine 走 audio-clock lookahead 排程;没有 audio-clock 能力的测试/降级 target 才退回完整 `setTimeout`。
- `src/core/generation/leadTakeoverSandbox/LeadTakeoverSandboxPanel.tsx`
  - 当前职责:显示 Q+T 调试面板、实时 beat、pad map、状态和动作日志。
  - 当前输入策略:通过 `takeoverInputBus` 消费 TapArea 原始 down/up,不再等待 React `activeKeys` diff 后才触发发声。

## 3. 节奏吸附合同

### 3.1 新增纯逻辑模块

建议新增:

- `src/core/generation/leadTakeoverSandbox/rhythmQuantizer.ts`
- `src/core/generation/leadTakeoverSandbox/rhythmQuantizer.test.ts`

建议类型:

```ts
export type TakeoverQuantizeGrid = '16th' | '32nd';

export interface TakeoverQuantizeOptions {
  beat: number;
  bpm: number;
  timeSignature: [number, number];
  grid: TakeoverQuantizeGrid;
  lateGraceMs?: number;
}

export interface TakeoverQuantizeResult {
  sourceBeat: number;
  targetBeat: number;
  delayMs: number;
  gridStepBeats: number;
  barStartBeat: number;
  barEndBeat: number;
}
```

### 3.2 默认策略

默认 grid: `16th`

- `16th` = `0.25` beat,当前 Q+T live 默认值,节奏扶正更强
- `32nd` = `0.125` beat,可切回,手感更跟手但节奏修正更弱

beat 语义沿用当前 Q+H 播放层:1 beat = 四分音符。

计算步骤:

1. `beatsPerBar = numerator * (4 / denominator)`
2. `barStartBeat = floor(beat / beatsPerBar) * beatsPerBar`
3. `barEndBeat = barStartBeat + beatsPerBar`
4. 计算当前 bar 内最近的未来 grid 点:
   - `localBeat = beat - barStartBeat`
   - `targetLocal = ceil((localBeat - epsilon) / gridStepBeats) * gridStepBeats`
   - `targetBeat = barStartBeat + targetLocal`
5. 如果目标落在当前 bar 末尾,允许 `targetBeat === barEndBeat`,这等价于下一小节 downbeat。

重要:不要尝试把声音播放到已经过去的 grid。实时演奏不能倒放。  
如果需要更跟手,可以加入 `lateGraceMs`,例如 20-35ms:用户刚刚晚于 grid 一点点时可立即触发,但默认第一版建议未来吸附,行为最稳定、测试最容易锁。

### 3.3 pitch 解析时间

用户按下 pad 后,音高必须按 `targetBeat` 对应的和弦/局部音阶解析,不是按原始 `sourceBeat`。

原因:

- 如果用户在 bar 末尾按下,`noteOn` 可能被吸到下一小节 downbeat。
- 此时实际发声点已经属于下一和弦,继续使用上一和弦的 pad map 会在换和弦处产生错位。

`leadTakeoverController.noteOn(padIndex, beat)` 应改为:

1. 用 `rhythmQuantizer` 得到 `targetBeat`
2. 用 `buildTakeoverPadMap(snapshot, targetBeat)` 取 pad 音高
3. 返回带有 timing metadata 的 `lead-note-on`

### 3.4 Action 合同

建议扩展 `LeadTakeoverAction`:

```ts
export type LeadTakeoverAction =
  | {
      type: 'lead-note-on';
      channel: number;
      midi: number;
      velocity: number;
      timing?: {
        sourceBeat: number;
        targetBeat: number;
        delayMs: number;
        grid: TakeoverQuantizeGrid;
      };
    }
  | {
      type: 'lead-note-off';
      channel: number;
      midi: number;
      timing?: {
        sourceBeat: number;
        targetBeat: number;
        delayMs: number;
        grid: TakeoverQuantizeGrid;
      };
    }
  | { type: 'lead-mute'; channel: number; muted: boolean }
  | { type: 'panic'; channel: number };
```

兼容要求:

- 没有 `timing` 的 action 必须保持当前立即发声语义,保证旧测试/monitor 模式不崩。
- Q+T live 模式下 consumer 看到 `delayMs > 0` 时用 sandbox-local timer 延迟触发实时 `noteOn`。
- 不要把这些延迟音符塞回 `globalMidiScheduler` 的主曲事件数组。

### 3.5 noteOff / 短按处理

当前版本同时量化 `noteOn` 和 `noteOff`。

必须处理短按:

- `noteOn` 吸附到未来 16 分位。
- `noteOff` 也吸附到未来 16 分位。
- 如果用户快速抬手导致 `noteOff.targetBeat <= noteOn.targetBeat`,则把 `noteOff.targetBeat` 推到 `noteOn.targetBeat + gridStepBeats`。
- 这样每个用户弹奏音至少形成一个完整 16 分音符时值。
- timer 必须在 `resetLeadTakeoverRuntimeState()`、关闭 Q+T、换歌、panic 时清理。

### 3.6 Handoff 语义

接管判断仍以用户真实输入开始为准:

- `firstInputBeat` 使用 `sourceBeat`
- `lastInputBeat` 建议使用 `sourceBeat`
- `muteAtBeat = firstInputBeat + handoffBars * beatsPerBar`

理由:用户开始接管的意图发生在按键时,不是延迟发声点。

但 pad 音高和实际 `noteOn` 发声必须使用 `targetBeat`。

### 3.7 GrooveContract 对齐

Q+T 的量化目标点不是纯机械 16 分格,必须消费主链路 `uiSnapshot.grooveContract`:

- 先计算基础 16 分目标点 `baseTargetBeat`。
- 如果 `baseTargetBeat` 是八分反拍,按 `melodySwingRatio` 把 0.50 位置推到 contract 指定比例,例如 swing=0.67 时 `1.50 -> 1.67`。
- 再叠加 lead melody pocket:
  - 整拍用 `melodyStrongPocketMs`。
  - 非整拍用 `melodyWeakPocketMs`。
  - live 输入采用区间中点,保持确定性。
- 如果负 pocket 会把声音排到用户输入之前,夹到 `sourceBeat`,避免实时倒放。
- action timing 记录 `baseTargetBeat` / `grooveOffsetMs` / `grooveContractId`,供 Q+T panel 监控。

当前 section-level contract 与全曲 contract 大多相同;沙盒保留 `grooveContractBySection` 入口,找不到时回退全曲 contract。

## 4. 两八度中心铺键合同

### 4.1 中心键

3x5 TAP AREA index 仍为 row-major:

```text
0   1   2   3   4
5   6   7   8   9
10  11  12  13  14
```

中心键固定为:

- `TAKEOVER_CENTER_PAD_INDEX = 7`
- 坐标: `col=2,row=1`

### 4.2 根音锚点

当前和弦根音是核心位置。

根音锚点建议:

```ts
const TAKEOVER_ROOT_CENTER_BASE_MIDI = 60; // C4
const anchorRootMidi = firstMidiAtOrAbove(rootPc, TAKEOVER_ROOT_CENTER_BASE_MIDI) + 12;
```

例子:

- Cmaj7: `C4 + 12 = C5`,中心键 index 7 = C5
- Dmaj7: `D4 + 12 = D5`,中心键 index 7 = D5
- G7: `G4 + 12 = G5`,中心键 index 7 = G5

### 4.3 音域窗口

总音域限制为以中心高音根音向下 2 个八度:

```ts
lowMidi = anchorRootMidi - 24;
highMidi = anchorRootMidi;
```

任何 pad 的 midi 都必须满足:

```ts
lowMidi <= midi <= highMidi
max(midi) - min(midi) <= 24
```

不要为了凑满 15 个键扩出这个窗口。

### 4.4 排列方向

中心 index 7 是高音区根音,两边都向下展开:

- 左侧 index 0..6:从低到高,靠近 index 7 越高
- 中心 index 7:当前和弦根音高音锚点
- 右侧 index 8..14:从高到低,离开 index 7 越低
- index 6/7/8 在 3x5 中部形成高音区域

布局结果:

```text
左侧下行回填: index 0..6
高音中心根音: index 7
右侧下行回填: index 8..14
```

例子:如果当前根音是 C,最终安全选音结果是 `C D E F G`,中心根音先定位到 `C5`:

```text
F3 G3 C4 D4 E4
F4 G4 C5 G4 F4
E4 D4 C4 G3 F3
```

从中心往左上读是 `C5 G4 F4 E4 D4 C4 G3 F3`;从中心往右下读也是同一条下行链路。

### 4.5 安全音优先级

音高候选来源仍使用当前 Q+T 的沙盒逻辑:

1. 当前和弦内音:稳定音,最高优先级
2. KB `tensionTableForChordType` 标记 acceptable 的局部音阶张力
3. 可接受的 approach target
4. fallback pentatonic

禁止:

- 为了填满 15 键强行加入明确 avoid tone。
- 为了填满 15 键把音域扩大到 2 个八度之外。
- 把这套铺键规则写进 Q+N 主生成或主旋律 render。

如果 2 个八度内安全候选不足 15 个:

- 优先重复稳定和弦内音或根音,仍放在不同 pad 上。
- 重复音必须标记为 `classRole: 'fallback'` 或新增 `duplicate` 标记,供 UI monitor 看出来。
- 不允许因此引入 avoid tone。

### 4.6 建议实现函数

在 `harmonicNoteMap.ts` 中替换或新增:

```ts
function buildCenteredTwoOctaveCells(
  pcs: readonly number[],
  roles: {
    chordPcs: ReadonlySet<number>;
    scalePcs: ReadonlySet<number>;
    approachPcs: ReadonlySet<number>;
    rootPc: number;
  },
): TakeoverPadCell[]
```

建议步骤:

1. 算 `anchorRootMidi`
2. 生成 `[lowMidi, highMidi]` 内所有允许 midi
3. 强制 index 7 = `anchorRootMidi`
4. 从 anchor 下方的两八度窗口按靠近 anchor 的顺序取 7 个候选,形成 side stack
5. 左侧填 `sideStack.reverse()`,右侧填 `sideStack`,让中心向左上/右下两头都是同一条下行链路
6. 候选仍只来自当前和弦内音与 KB 允许的局部音阶张力
7. index 0..6 按 midi 升序靠近中心,index 8..14 按 midi 降序离开中心。

## 5. UI monitor 要求

Q+T 面板只做监控,不要变成主链路 UI。

建议显示:

- 当前 grid: `16th` / `32nd`
- 当前 quantize target:
  - source beat
  - target beat
  - delay ms
- 中心根音:
  - `center root C5`
  - `span <= 24st`

面板开关可以先用内部常量,不一定第一版做复杂 UI 控件。  
如果加 UI 控件,只放在 Q+T panel 内,不要接 PipelineMonitor 或主 DevDock 状态。

## 6. 文件级任务

### Phase 1: 节奏吸附纯逻辑

任务:

- [ ] 新增 `rhythmQuantizer.ts`
- [ ] 实现 `beatsPerBarOf` 复用或移动,避免重复逻辑发散
- [ ] 实现 `quantizeTakeoverBeat(...)`
- [ ] 支持 `16th` 和 `32nd`
- [ ] 处理 bar boundary
- [ ] 写 `rhythmQuantizer.test.ts`

验收:

- [ ] 4/4 中 `beat=1.01,grid=32nd` 吸到 `1.125` 或按 late grace 规则立即
- [ ] 4/4 中 `beat=1.01,grid=16th` 吸到 `1.25`
- [ ] 4/4 中 `beat=3.99,grid=16th` 吸到 `4.0`
- [ ] 3/4、6/8 不使用硬编码 4 beat bar
- [ ] delayMs 随 bpm 正确变化

### Phase 2: Controller 接入 timing metadata

任务:

- [ ] 扩展 `LeadTakeoverConfig`
  - `quantizeGrid: '16th' | '32nd'`
  - `quantizeEnabled: boolean`
  - `lateGraceMs`
- [ ] 扩展 `LeadTakeoverAction.lead-note-on.timing`
- [ ] `noteOn(padIndex, beat)` 内部先量化,再用 `targetBeat` 构建 pad map
- [ ] `firstInputBeat/lastInputBeat/muteAtBeat` 保持 source beat 语义
- [ ] 更新 `leadTakeoverController.test.ts`

验收:

- [ ] 三个用户输入仍能触发 pending handoff
- [ ] handoff 时间仍从真实用户输入开始计算
- [ ] action 返回 `timing.targetBeat`
- [ ] bar 边界输入使用下一 grid 的和弦/音阶解析

### Phase 3: Consumer 延迟发声与 timer 清理

任务:

- [ ] `qhTakeoverConsumer.ts` 消费 `timing.delayMs`
- [ ] `delayMs > 0` 时用 sandbox-local timer + audio-clock lookahead 排实时 `noteOn`
- [ ] `lead-note-off.timing.delayMs > 0` 时用 sandbox-local timer + audio-clock lookahead 排实时 `noteOff`
- [ ] 不把用户接管 noteOn 放入 `globalMidiScheduler` 主曲事件数组
- [ ] `noteOff` 能处理 pending noteOn,并保证至少完整一个 grid 时值
- [ ] reset/close/song change/panic 清理所有 pending timers
- [ ] 更新 `qhTakeoverConsumer.test.ts`

验收:

- [ ] fake timers 下,没有 audio-clock 能力时,`delayMs` 到达前不触发 `target.noteOn`
- [ ] 有 audio-clock 能力时,在 target 前约 25ms 把精确 audio time 交给 `target.noteOnAt` / `target.noteOffAt`
- [ ] noteOff 早于 noteOn target 时延后到 noteOn target 后一个 grid
- [ ] reset 后 pending note 不再发声
- [ ] 重复快速弹奏不会向 scheduler 追加 noteOn/noteOff 事件

### Phase 4: 两八度中心铺键

任务:

- [ ] 在 `harmonicNoteMap.ts` 增加中心铺键 builder
- [ ] 替换当前 `buildAscendingCells` 的产品路径,或保留为 fallback/debug
- [ ] index 7 强制放 `anchorRootMidi`
- [ ] 所有 cells 限制在 `[anchorRootMidi - 24, anchorRootMidi]`
- [ ] 候选不足时重复稳定 chord tone,不引入 avoid tone
- [ ] 更新 `harmonicNoteMap.test.ts`

验收:

- [ ] Cmaj7 / C Ionian: index 7 是 C5
- [ ] Dmaj7: index 7 是 D5,下边界不低于 D3
- [ ] G7: index 7 是 G5
- [ ] 任意 chord 的 `max(midi)-min(midi) <= 24`
- [ ] 左侧 index 0..6 低到高靠近中心,右侧 index 8..14 从中心向外降低
- [ ] 借用和弦/离调和弦仍用当前 local scale 与 chord type
- [ ] 明确 avoid tone 不因填格被塞入

### Phase 5: Q+T Panel 监控

任务:

- [ ] Q+T panel 显示 quantize grid
- [ ] Q+T panel 显示最近一次 source beat / target beat / delayMs
- [ ] Q+T panel 显示中心根音和两八度 span
- [ ] UI 仅限 Q+T panel

验收:

- [ ] 打开 Q+T 后能看到当前 map 的中心根音
- [ ] 按键后日志能看到 quantized target
- [ ] 关闭 Q+T 后无 pending timer 残留

### Phase 6: GrooveContract 接入

任务:

- [x] `MusicGenerationUiSnapshot` 增加只读 `grooveContract` / `grooveContractBySection`
- [x] `qhTakeoverConsumer` 把 groove 投影带入 `TakeoverMusicSnapshot`
- [x] `rhythmQuantizer` 在基础 16 分目标点上叠加 melody swing + strong/weak pocket
- [x] `LeadTakeoverController` 的 noteOn/noteOff 均消费 grooved target
- [x] Q+T panel 显示 groove id 与 pocket offset

验收:

- [x] swing contract 下八分反拍从 `x.50` 推到 `x.melodySwingRatio`
- [x] weak pocket 会影响非整拍 16 分目标
- [x] noteOff 仍保证完整 16 分时值
- [x] 没有 grooveContract 时保持旧直格行为

## 7. 性能要求

本任务必须避免复发 2026-07-02 前后的接管演奏资源上涨问题。

必须满足:

- 用户接管音符不通过 `globalMidiScheduler.injectEvent` 高频追加。
- 不在每个 noteOn 重复发送整套 program/CC setup。
- 不使用 `requestAnimationFrame` 每帧 set React state 来追踪接管输入。
- 所有 `setTimeout` / `setInterval` 都有 reset/cleanup。
- 单次按键最多创建必要的 pending noteOn/noteOff timer,并在 reset/close/song change/panic 时清理。

建议测试:

- 快速触发 100 次 `lead-note-on/off`,consumer 的 fake target `events.length` 不随实时路径增长。
- reset 后 pending timers 不再触发。

## 8. 不做事项

本任务不要做:

- 不改 Q+H 生成 UI。
- 不改 Q+N `generateSong` / newEngine 生成和渲染算法;只允许 `MusicGenerationService` 边界暴露只读 groove 投影。
- 不改主 lead render 规则。
- 不把用户接管写回生成出来的 `MusicalIR`。
- 不保存用户演奏为新的 lead 轨。
- 不做多声部接管选择器。
- 不恢复 TAP AREA 双击/三击菜单手势。

## 9. 验收命令

建议执行:

```bash
npm test -- src/core/generation/leadTakeoverSandbox
npm test -- src/core/audio/MidiScheduler.test.ts src/core/hardware/TapArea.test.ts src/core/hardware/menuGestureGuards.test.ts
npm run lint -- --pretty false
npm run build
```

验收标准:

- Q+T 用户输入 noteOn/noteOff 有 16th target beat,短按也形成完整 16 分时值。
- Q+T live 输入通过 TapArea direct bus 进入控制器,不依赖 React activeKeys diff 触发发声。
- Q+T live 发声在 AudioEngine 上走 audio-clock lookahead 排程。
- Q+T 用户输入发声不造成 scheduler 事件数组持续增长。
- Q+T 用户输入的 16 分吸附会叠加主歌 `grooveContract` 的 melody swing 和 lead pocket。
- 3x5 map 中心键永远是当前和弦根音上移一个八度。
- 3x5 map 总跨度不超过 2 个八度。
- Q+H 主生成与播放链路无改动、无回归。

## 10. 推荐实现顺序

1. `rhythmQuantizer.ts` 纯函数与测试。
2. `LeadTakeoverAction` timing metadata 与 controller 测试。
3. `qhTakeoverConsumer` delayed realtime noteOn 与 timer cleanup。
4. `harmonicNoteMap` 两八度中心铺键与测试。
5. Q+T panel debug 信息。
6. 全量 Q+T 定向测试、lint、build。
