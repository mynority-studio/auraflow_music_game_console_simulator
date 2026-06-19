# Q+R Motif 录入抢拍宽容窗口 Directive

Date: 2026-06-19

## 背景

当前 Q+R hidden-grid 录制是 1 小节 count-in:

```text
click: beat 0, 1, 2, 3
captureStart: beat 4
```

用户听到第 4 下提示音后马上弹,很容易把第一个音弹在 `captureStartMs` 之前。现在 `capturedToGridNotes()` 只接受 `onsetMs >= captureStartMs`,所以这个首音会被当作数拍期音符过滤掉。后面的 analyzer 即使已经“不吞同格音”,也收不到这个首音。

用户选择本方案:只做数据层 pre-capture grace window,不加第 5 下 GO/downbeat click。

## 目标

- 不改变 4 拍提示音 UI/听感,不新增第 5 下 click。
- 允许用户在 `captureStartMs` 前最多 1 拍内抢进,首音仍进入 motif。
- 默认 Q+R 仍然“不允许空拍开始”:被宽容接住的早进首音进入 analyzer 后要切头到 motif beat 0。
- `allowPickup=true` 分支也不能产生负 onset,也不能吞早进首音。
- 更早的 count-in 乱弹仍然被过滤,不能整段 count-in 都进 motif。

## 拍板参数

默认:

```ts
preCaptureGraceBeats = 1.0
```

理由:用户“听到第 4 下提示音后马上弹”,实际可能早于真正 downbeat 接近一整拍。0.25~0.5 beat 不一定能救住这个真实 UX。

允许后续调参,但第一版不要低于 `0.75 beat`。

## 当前问题位置

### 1. Capture filter 太硬

文件:

- [src/core/generation/motifSandbox/capture/hiddenGridClock.ts](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/motifSandbox/capture/hiddenGridClock.ts)

当前:

```ts
export function isWithinCapture(ms, ctx) {
  return ms >= ctx.captureStartMs - 1e-6 && ms < ctx.captureEndMs - 1e-6;
}

export function capturedToGridNotes(captured, ctx) {
  return captured
    .filter((c) => isWithinCapture(c.onsetMs, ctx))
    .map(...);
}
```

问题:

- `captureStartMs - 1ms` 都会被过滤。
- 录制器其实从 count-in 第 0 拍就开始收了,首音存在于 raw captured 里,只是转换 grid 前被丢掉。

### 2. Analyzer 也会过滤负拍

文件:

- [src/core/generation/motifSandbox/model/motifAnalysis.ts](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/motifSandbox/model/motifAnalysis.ts)

当前入口过滤:

```ts
gridNotes.filter((n) => n.quantizedOnsetBeat >= -1e-6 && n.quantizedOnsetBeat < windowBeats - 1e-6)
```

问题:

- 即使 `capturedToGridNotes()` 放进了 `captureStartMs` 前的 note,它会变成负 `onsetBeat` / 负 `quantizedOnsetBeat`,然后在 analyzer 入口又被丢掉。
- 所以必须 filter 和 analyzer 两层一起改。

## 设计方案

### A. Context 增加 preCaptureGraceBeats

在 `HiddenGridCaptureContext` 增加:

```ts
preCaptureGraceBeats: number;
```

在 `createHiddenGridContext()` 增加可选参数:

```ts
preCaptureGraceBeats?: number;
```

默认值:

```ts
const preCaptureGraceBeats = opts.preCaptureGraceBeats ?? 1.0;
```

注意:

- `captureStartMs` 不变。
- `captureEndMs` 不变。
- click schedule 不变。
- recorder start/maxMs 不必因为 grace 改动,因为 recorder 已经从 count-in 第 0 拍开始。

### B. 保留 strict isWithinCapture,新增 grace helper

不要直接改变 `isWithinCapture()` 的语义,因为它在测试和语义上表示严格 capture window。

新增:

```ts
export function isWithinCaptureWithGrace(ms: number, ctx: HiddenGridCaptureContext): boolean {
  const graceMs = msPerBeat(ctx) * ctx.preCaptureGraceBeats;
  return ms >= ctx.captureStartMs - graceMs - 1e-6
    && ms < ctx.captureEndMs - 1e-6;
}
```

修改 `capturedToGridNotes()` 使用 `isWithinCaptureWithGrace()`。

这样:

- count-in 很早的音仍被过滤。
- `captureStartMs - 0.8 beat` 的首音会进入 grid。
- `mapRawNoteToGrid()` 不需要特殊处理,它自然会产生负 `onsetBeat`。

### C. Analyzer 接受 grace 范围内的负拍

在 `analyzeHiddenGridMotif()` 中,入口 filter 改为:

```ts
const grace = ctx.preCaptureGraceBeats ?? 0;
let g = gridNotes.filter((n) =>
  n.quantizedOnsetBeat >= -grace - 1e-6
  && n.quantizedOnsetBeat < windowBeats - 1e-6
);
```

注意:

- 用 `quantizedOnsetBeat` 做窗口过滤可以接受,但不能用它做旋律合并 key。
- 后续仍按 raw `onsetBeat` 排序。
- 如果第一音是 `-0.75 beat`,默认 `allowPickup=false` 路径会用 `raw0 = g[0].onsetBeat`,然后 `fitMotifToBricks()` 切头到 0。

### D. 默认 allowPickup=false 行为

默认路径保持:

```text
早进首音 raw onset = -0.75
analyzer raw0 = -0.75
normalized motif first onsetBeat = 0
```

这正符合“不允许空拍开始”:用户早进一点,系统把它当作 motif 的第一个音,而不是丢掉。

`timing.leadingRestBeats` 现在可能为负数。请更新注释/显示语义:

```text
leadingRestBeats > 0: 用户晚进
leadingRestBeats = 0: 正好开始
leadingRestBeats < 0: 用户抢进,被 grace 接住
```

不要求本期新增字段,但注释不要继续只说“晚进量”。

### E. allowPickup=true 行为

`allowPickup=true` 是保留前导休止,但早进 note 不应成为负 onset。

要求:

- grace 内早进 note 不能被丢。
- motif note onset 不允许为负。
- 如果多个早进/开头音量化撞位,继续使用“撞位前推到下一个空 16 分格”的逻辑,不能吞音。

推荐行为:

```text
early note at -0.75 beat -> onsetBeat 0
next note at -0.50 beat -> onsetBeat 0.25
note at captureStart + 0.00 -> onsetBeat 0.50 或后续空格
```

也就是说,`allowPickup=true` 对“晚进”保留休止,对“早进”不保留负时间,而是从 0 开始安全排布。

## 任务拆分

### Phase 1: Context + capture filter

文件:

- [src/core/generation/motifSandbox/capture/hiddenGridClock.ts](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/motifSandbox/capture/hiddenGridClock.ts)
- [src/core/generation/motifSandbox/capture/hiddenGridClock.test.ts](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/motifSandbox/capture/hiddenGridClock.test.ts)

任务:

1. `HiddenGridCaptureContext` 增加 `preCaptureGraceBeats`。
2. `createHiddenGridContext()` 增加参数并默认 `1.0`。
3. 新增 `isWithinCaptureWithGrace()`。
4. `capturedToGridNotes()` 改用 grace helper。
5. 保持 `isWithinCapture()` strict 语义不变。

测试:

```text
ctx.preCaptureGraceBeats 默认 = 1.0
isWithinCapture(captureStart - 0.5 beat) === false
isWithinCaptureWithGrace(captureStart - 0.5 beat) === true
capturedToGridNotes 包含 captureStart - 0.5 beat 的 note
capturedToGridNotes 排除 captureStart - 1.25 beat 的 note
capturedToGridNotes 排除 captureEnd 后的 note
```

### Phase 2: Analyzer 接受 grace 内负拍

文件:

- [src/core/generation/motifSandbox/model/motifAnalysis.ts](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/motifSandbox/model/motifAnalysis.ts)
- [src/core/generation/motifSandbox/model/motifHiddenGrid.test.ts](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/motifSandbox/model/motifHiddenGrid.test.ts)

任务:

1. analyzer 入口 filter 允许 `quantizedOnsetBeat >= -ctx.preCaptureGraceBeats`。
2. 默认 `allowPickup=false` 继续用 raw first note 切头。
3. `allowPickup=true` 不产生负 onset,不吞早进音。
4. 更新 `leadingRestBeats` 注释,说明它是 signed entry offset。

测试:

```text
case default align:
raw notes:
  60 at captureStart - 0.75 beat
  64 at captureStart + 0.00 beat
  67 at captureStart + 0.50 beat
expect:
  motif.notes[0].midi === 60
  motif.notes[0].onsetBeat === 0
  motif.notes.length === 3
  timing.leadingRestBeats < 0
```

```text
case too early:
raw notes:
  60 at captureStart - 1.25 beat
  64 at captureStart + 0.00 beat
expect:
  motif first midi === 64
  60 excluded
```

```text
case allowPickup=true:
raw notes:
  60 at captureStart - 0.75 beat
  64 at captureStart - 0.50 beat
  67 at captureStart + 0.00 beat
expect:
  all 3 notes kept
  all onsetBeat >= 0
  onsets strictly increasing
  first midi === 60
```

### Phase 3: UI 状态文案轻微更新

文件:

- [src/core/generation/motifSandbox/ui/MotifWeaverSandboxPanel.tsx](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/motifSandbox/ui/MotifWeaverSandboxPanel.tsx)

任务:

不新增 GO click,只把状态提示改得更不误导。

当前:

```text
听完 4 下开始弹
```

建议:

```text
听完 4 下进;稍早抢进也会保留
```

或:

```text
第 4 下后准备进;抢早 1 拍内会保留
```

注意:

- 不要增加可见教程大段文字。
- 不要改变现有按钮布局。
- 不要增加第 5 下 click。

## 必跑测试

```bash
npx vitest run \
  src/core/generation/motifSandbox/capture/hiddenGridClock.test.ts \
  src/core/generation/motifSandbox/model/motifHiddenGrid.test.ts \
  src/core/generation/motifSandbox/model/motifWeaver.test.ts \
  src/core/generation/motifSandbox/model/leadOnlyIr.test.ts \
  src/core/generation/motifSandbox/midi/webMidi.test.ts
```

```bash
npm run lint
```

建议再跑:

```bash
npm test
npm run build
```

## 手工验收脚本思路

构造 context:

```ts
const ctx = createHiddenGridContext({
  seed: 7,
  keyPc: 0,
  scaleMode: 'major',
  tonality: 'major',
  style: 'pop',
  startMs: 1000,
  desiredBars: 4,
});
```

构造 notes:

```text
60 at captureStart - 0.75 beat
64 at captureStart + 0.00 beat
67 at captureStart + 0.50 beat
```

验收:

```text
capturedToGridNotes count = 3
analyzeHiddenGridMotif default:
  first midi = 60
  first onset = 0
  no negative onset
  no non-increasing onset
```

再构造:

```text
60 at captureStart - 1.25 beat
64 at captureStart + 0.00 beat
```

验收:

```text
capturedToGridNotes count = 1
first midi = 64
```

## 非目标

- 不加第 5 下 GO click。
- 不改变 BPM 随机范围。
- 不改变 motif brick / harmony / RoadMap / weaver 音乐逻辑。
- 不改变 Q+N 生成链。
- 不重新设计 allowPickup UI。

## 完成定义

任务完成必须满足:

1. `captureStartMs` 前 1 beat 内的第一个用户音不会被过滤。
2. `captureStartMs` 前超过 grace 的 count-in 音仍被过滤。
3. 默认 align-first 路径中,早进首音成为 motif 第一个音且 onsetBeat=0。
4. `allowPickup=true` 路径中,早进音不会被吞,且没有负 onset。
5. 原先“同格不吞音 / noteOff-on 不吞音”的测试仍全部通过。
