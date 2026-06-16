# Q+R Motif Sandbox: Grid Alignment And Structural Tone Directive

## 背景

Q+R 当前 hidden-grid 路径能把用户 MIDI 输入量化到隐形节拍网格，并生成 motif、brick、和声模板、RoadMap、续写、伴奏。

现在要修正一个音乐语义问题：

- 默认不允许用户 motif/brick 以空拍开始。
- 首个有效音应该成为 brick 的 `beat 0`。
- 和声定位、重拍定位、伴奏击点应主要使用骨干结构音。
- 非骨干音可粗略理解为经过音，只做弱影响或不参与和声定位。

这个任务只改 Q+R motifSandbox，不接入 Q+N 器配模块，不改 New Engine 主生产链。

## 目标

1. Hidden-grid 分析后，默认切掉首音前空拍。
2. 重新基于“切头后的 motif 相位”计算节拍位置、重拍权重、结构音分。
3. 明确结构音和经过音的边界。
4. 和声模板选择只由结构音主导，经过音低权重或忽略。
5. 伴奏/低音的重拍支撑只跟随结构音，不盲跟所有音。
6. 保留 raw timing 诊断信息，方便 UI 显示用户是否晚进。

## 当前问题

### Free fallback 路径

`analyzeAndNormalize()` 目前已经用第一颗音的 `onsetMs` 作为 `t0`，所以第一颗音天然对齐到 `beat 0`。

这条路径符合“禁止空拍开始”。

### Hidden-grid 路径

`mapRawNoteToGrid()` 当前以 `captureStartMs` 作为绝对 beat 0。

如果用户数拍后晚进半拍，第一颗音会成为：

```text
onsetBeat = 0.5
quantizedOnsetBeat = 0.5
```

然后 `analyzeHiddenGridMotif()` 直接把它写进 `MotifNote.onsetBeat`。

这会导致：

- motif 每次 quote 都晚半拍进入。
- brick head 不在 beat 0。
- metricalWeight 按错误相位计算。
- 结构音/经过音判断被整体错相。
- 和声模板选择与伴奏重拍定位会感觉“不对拍”。

## 设计原则

### 两层时间信息

需要区分两种时间：

1. Raw grid time
   - 相对于隐形时钟捕获窗。
   - 用于诊断用户是否晚进、量化误差、UI 显示。

2. Motif-local time
   - 相对于用户 brick 自身。
   - 第一颗有效音必须是 `beat 0`。
   - 生成、brick 分析、和声定位、伴奏对拍都使用这一层。

不要丢 raw 信息，但 normalized motif 必须走 motif-local time。

## 具体任务

### Phase 1: Hidden-grid 切头重对齐

在 `analyzeHiddenGridMotif()` 中完成：

1. 过滤捕获窗外音。
2. 单旋律化。
3. 找到第一颗有效音：

```ts
const firstBeat = g[0].quantizedOnsetBeat;
```

4. 生成 motif note 时使用：

```ts
localOnsetBeat = quantizedOnsetBeat - firstBeat;
```

5. 所有 `MotifNote.onsetBeat` 必须基于 `localOnsetBeat`。
6. `localOnsetBeat` 不允许小于 0。
7. `lengthBeats` 应基于切头后的 `localLastEnd` 计算：

```ts
localLastEnd = max(localOnsetBeat + quantizedDurationBeat)
lengthBeats = ceil(localLastEnd / beatsPerBar) * beatsPerBar
```

8. 最小长度仍是 1 bar，最大长度仍是 `captureBars * beatsPerBar`。

### Phase 2: 保留诊断字段

`MotifTimingAnalysis.leadingRestBeats` 不应删除。

但语义改成：

```text
用户首音相对 hidden-grid captureStart 的晚进量。
```

也就是说：

- `timing.leadingRestBeats = firstBeat`
- `motif.notes[0].onsetBeat = 0`

UI 可以继续显示 `leadingRestBeats`，但它只是诊断，不参与生成。

### Phase 3: 重算节拍权重

切头后，结构音分必须基于 `localOnsetBeat` 的小节内位置计算，而不是原始 hidden-grid 位置。

对于每个音：

```ts
localBeatInBar = ((localOnsetBeat % 4) + 4) % 4;
localMetricalWeight = metricalWeight(localBeatInBar);
```

然后把 `localMetricalWeight` 传入 `scoreNote()`。

不要继续使用 `GridCapturedNote.metricalWeight` 作为 normalized motif 的结构分依据，因为它是旧相位的权重。

### Phase 4: 明确结构音/经过音规则

当前 `scoreNote()` 已经有：

```ts
structuralToneScore =
  0.35 * metricalWeight
+ 0.25 * duration
+ 0.20 * velocity
+ 0.15 * edge
+ 0.05 * turn
```

这个方向可以保留。

但需要在下游建立统一阈值：

```ts
STRUCTURAL_TONE_MIN = 0.58
```

语义：

- `structuralToneScore >= 0.58`：骨干结构音。
- `structuralToneScore < 0.58`：默认视为经过音/装饰音。

边界规则：

- head 和 tail 可以保留为结构候选，但如果分数低，也不要让它们强行支配全部和声。
- 长音、重拍音、转折峰谷音更容易成为结构音。
- 弱拍短音即使 velocity 高，也不应强行成为和声定位核心。

### Phase 5: Brick 分析只让结构音主导

`analyzeUserMelodicBrick()` 目前会把 quote 内所有音都转成 `structuralTones`，只是每个音有 weight。

需要改成两层：

1. `allTones`
   - 所有音，保留用于 contour/rhythm/debug。

2. `structuralTones`
   - 只包含 `structuralToneScore >= STRUCTURAL_TONE_MIN` 的音。

如果过滤后结构音太少：

- 至少保留 head。
- 至少保留 tail。
- 再按 `toneWeight` 从高到低补到 2 个。

这样避免只有一个音时 cadence/head/tail 逻辑失效。

### Phase 6: 和声模板选择只看结构音

`scoreProgressionAgainstMelodicBrick()` 应只读取 `brick.structuralTones`。

经过音不应该因为不是和弦音而重罚模板。

规则：

- 结构音落在真实和弦音：加分。
- 结构音多数锚点撞和弦：扣分。
- 经过音撞和弦：不扣或极轻扣。

推荐第一版：

```text
结构音：现有权重正常参与
经过音：不参与 structuralToneSupport
```

不要让经过音影响 `strongNonChordPenalty`。

### Phase 7: 伴奏和低音只跟结构音对齐

`buildAccompaniment()` 当前用：

```ts
Math.max(n.accent, n.structuralToneScore ?? 0) >= SUPPORT_MIN
```

这可能导致响亮弱拍经过音触发 comp/bass。

应改为：

```ts
(n.structuralToneScore ?? 0) >= STRUCTURAL_TONE_MIN
```

如果需要保留力度重音，可作为二级条件：

```ts
structuralToneScore >= 0.58
|| (accent >= 0.82 && durationBeat >= 0.5 && onGridStrongEnough)
```

但第一版建议只用 `structuralToneScore`，更符合“骨干结构音定位重拍”。

### Phase 8: UI/debug 显示

Analysis 区建议显示：

- `leadingRestBeats`
- `首音已对齐 beat0`
- `结构音数量 / 总音数`
- 前几个结构音：

```text
结构音: 60@0.00 64@2.00 67@3.00
```

不要把这些说明做成大段教学文案，只做调试行即可。

## 测试要求

### 1. Hidden-grid 不允许空拍开始

输入第一颗音在 `0.5 beat`：

期望：

```ts
timing.leadingRestBeats === 0.5
motif.notes[0].onsetBeat === 0
motif.notes[1].onsetBeat === 0.5
```

旧测试“迟到首音保留前导休止”需要改名。

### 2. 重拍权重按切头后相位计算

输入：

```text
raw: 0.5, 1.5, 2.5
local: 0, 1, 2
```

期望：

- 第一音使用 downbeat 权重 1.0。
- 第三音使用 beat3 权重 0.75。

### 3. 弱拍短音不主导和声

构造 motif：

```text
C @ 0.0, duration 1.5, velocity low
D @ 0.75, duration 0.25, velocity high
G @ 2.0, duration 1.0
```

期望：

- C/G 是结构音。
- D 是经过音或低权重音。
- 和声 scorer 不因为 D 非和弦音重罚。

### 4. 伴奏只跟结构音

构造 lead：

```text
结构音 @ 0.0
经过音 @ 1.25
结构音 @ 2.0
```

期望：

- comp/bass 击点包含 0/2。
- 不因为 1.25 的经过音额外打重拍。

### 5. 旧主链保持

仍需通过：

```bash
npm run test -- motifSandbox
npm run lint
```

## 非目标

本任务不要做：

- 不接 Q+N 器配模块。
- 不改 `generateSong` 主链。
- 不接 `renderMgMelody`。
- 不重新设计整套节拍器。
- 不支持 pickup 作为默认行为。

Pickup 可以作为未来高级选项：

```ts
allowPickup: boolean
```

但默认必须是：

```ts
allowPickup = false
```

## 验收标准

1. Hidden-grid motif 第一颗 note 永远 `onsetBeat === 0`。
2. `leadingRestBeats` 仍能报告用户晚进量。
3. 结构音用于 brick 分类、和声模板选择、伴奏/低音对拍。
4. 经过音不主导和声，不触发重拍伴奏。
5. Q+R 生成后 motif 在 0/16/32/48 出现时不再整体晚进。
6. 所有 motifSandbox 测试和 TypeScript 检查通过。

