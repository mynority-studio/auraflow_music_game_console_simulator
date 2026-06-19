# Q+R Motif 输入不吞音修复 Directive

Date: 2026-06-19

## 背景

Q+R motif 输入链路目前有两类可复现吞音:

1. Hidden-grid 分析层会把多个音先量化到同一 16 分格,然后按量化位取最高音,导致用户真实首音或中间经过音被合并掉。
2. MIDI noteOff/noteOn 与 render 层同 pitch 重触发没有完整保护,会出现同 tick 同 pitch 两个 noteOn,短音的 noteOff 把长音提前关掉。

本任务只修复 Q+R motif 输入、Q+R preview render、以及 Q+R 走 A 接入 Q+N 时的 lead 导出安全闸。不要改和声模板、RoadMap、motif brick 分类、New Engine 默认生成链的音乐决策。

## 硬性目标

- 用户弹出的旋律音符不能因为“量化后落在同一格”而被合并或吞掉。
- 同 pitch 的 noteOff/noteOn、快速重复、重触发不能覆盖旧音,也不能在播放时被旧 noteOff 误关。
- 用户 motif 的第一个真实音必须保留为 normalized motif 的第一个音,默认不允许空拍开始,切头后 onsetBeat 必须为 0。
- quote slot 中用户 motif 的每个 quote 音都必须完整存在,尤其是第一个音。
- Q+R lead-only preview 与 Q+R -> Q+N full arrangement 两条路径都必须无同通道同 pitch 重叠。

## 已知复现

### 1. Hidden-grid 首音被同格合并

输入:

```text
raw: 60@0.13, 64@0.18, 67@0.50, 69@0.75
grid: 60 -> q0.25, 64 -> q0.25
current normalized motif: 64@0, 67@0.25, 69@1
expected normalized motif: 第一个音仍是 60@0, 64 也必须保留在后续唯一 onset
```

根因:

- [src/core/generation/motifSandbox/model/motifAnalysis.ts](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/motifSandbox/model/motifAnalysis.ts:270) 先按 `quantizedOnsetBeat` 做 `Map`,同量化位只保留最高音。
- 这一步发生在 `fitMotifToBricks()` 前,导致后续“撞位前推不丢音”的逻辑没有机会工作。

### 2. Recorder 同 pitch re-noteOn 覆盖旧音

输入:

```text
noteOn 60 @ 0ms
noteOn 60 @ 80ms
noteOff 60 @ 160ms
current captured: 60@80ms duration80ms
expected captured: 60@0ms duration80ms, 60@80ms duration80ms
```

根因:

- [src/core/generation/motifSandbox/capture/MidiMotifRecorder.ts](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/motifSandbox/capture/MidiMotifRecorder.ts:21) 用 `Map<midi, openNote>` 保存 active note。
- [src/core/generation/motifSandbox/capture/MidiMotifRecorder.ts](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/motifSandbox/capture/MidiMotifRecorder.ts:45) 同 pitch 新 noteOn 直接 `set`,覆盖旧 onset。

### 3. Render 层同 tick 同 pitch 重触发

标准样例可复现:

```text
generateSampleCaptured(96, C, major, variant=1)
style=pop, seed=2

lead around beat48:
77@48 duration 0.125 develop
77@48 duration 0.9   connect
```

Q+R preview IR 结果:

```text
77@tick23040 duration14
77@tick23040 duration432
```

短音 noteOff 会把长音提前关掉。

根因:

- [src/core/generation/motifSandbox/model/motifWeaver.ts](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/motifSandbox/model/motifWeaver.ts:475) 最终统一吸 1/16 网格后,前一 slot 尾音可能被推到下一 slot 起点。
- [src/core/generation/motifSandbox/model/leadOnlyIr.ts](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/motifSandbox/model/leadOnlyIr.ts:57) 对同 start 同 pitch 的处理会把前一个音裁成极短 note,但该 noteOff 仍会关掉后一个同 pitch。
- [src/core/generation/newEngine/generation/generateSongFromMotif.ts](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/newEngine/generation/generateSongFromMotif.ts:107) Q+N 走 A 直接把 Q+R lead beat 转 tick,没有同 pitch overlap 清洗。

## 设计原则

### A. 不按量化格合并旋律音

Hidden-grid 中 `quantizedOnsetBeat` 只能用于节拍权重、诊断、UI 显示,不能作为旋律音身份的合并 key。

正确顺序:

1. 按 raw `onsetBeat` 排序。
2. 只在“真同时按下”的情况下做单旋律化。
3. 把所有保留下来的 raw notes 交给 `fitMotifToBricks()`。
4. `fitMotifToBricks()` 负责把撞到同一网格的旋律音按顺序推到下一个空网格。

真同时按下的判定必须比 16 分/32 分旋律间隔更严格。建议阈值继续使用或收紧 `CHORD_EPS`,但绝不能用 quantized onset 作为 chord 判定。

### B. 同 pitch re-noteOn 是重触发,不是覆盖

Recorder 收到同 pitch noteOn 且该 pitch 已 open 时:

1. 先把旧 open note commit 到当前 noteOn 时间。
2. 再打开新的 note。
3. 如果旧 note 时值过短,也要保留到最小时值策略里,不能静默丢。

收到 noteOff 时,关闭该 pitch 当前最新的 open note。若后续要支持极端重叠同 pitch,可把 `Map<midi, openNote>` 改为 `Map<midi, openNote[]>`,但本期最低要求是“新 noteOn 不覆盖旧 note”。

### C. Lead 是单声部:同 pitch 同 tick 必须合并或裁剪到安全

在任何 MIDI 事件导出前,lead 轨必须满足:

- 不存在同 pitch 同 startTick 的两个 note。
- 不存在同 pitch overlap。
- 同 pitch 连续重复时,前一个 noteOff 必须早于后一个 noteOn。
- 如果两个同 pitch 音同 start,合并为一个 note,不要保留短 noteOff。

同 start 同 pitch 合并策略:

1. pitch/start 相同:保留一个 note。
2. duration 取较长者。
3. velocity 取较大者。
4. occurrenceKind 优先级: `quote > develop > connect`。
5. 如果其中一个是 quote,最终音必须仍被视为 quote,保证用户 motif 审计不误报。

不同 start 同 pitch overlap 策略:

1. 前音 duration 裁到 `nextStart - gap`。
2. beat-domain gap 建议 `0.01 beat`; tick-domain gap 建议 `1 tick`。
3. 如果裁剪后小于最小时值,非 quote 可丢弃;quote 不可静默丢,应保留并裁到最小安全时值或把后音后推一个最小 tick。

### D. Q+R preview 与 Q+N 走 A 共用安全闸

不要只在 `buildLeadOnlyIr()` 里修。Q+N 走 A 的 `motifLeadToTrackIR()` 也会消费 Q+R lead,必须同样无 overlap。

建议新增一个共享工具:

```text
src/core/generation/motifSandbox/model/leadSanitizer.ts
```

提供两层函数:

```ts
sanitizeMotifLeadNotes(notes: readonly MotifNote[], opts): MotifNote[]
sanitizeLeadNoteIR(notes: readonly NoteIR[], opts): NoteIR[]
```

调用点:

- `generateMotifWeave()` 生成 `finalLead` 后先 sanitize,再 audit。
- `buildLeadOnlyIr()` / `buildSandboxIr()` 在 `toNoteIR()` 前或后再做 tick-domain sanitize。
- `generateSongFromMotif.motifLeadToTrackIR()` 在返回 `TrackIR` 前做 tick-domain sanitize。

tick-domain sanitize 是最终保险,即使上游漏了,也不能让同 pitch overlap 进入 `musicalIRToMidiEvents()`。

## 分阶段任务

### Phase 1: Recorder 不覆盖同 pitch note

文件:

- [src/core/generation/motifSandbox/capture/MidiMotifRecorder.ts](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/motifSandbox/capture/MidiMotifRecorder.ts)
- [src/core/generation/motifSandbox/midi/webMidi.test.ts](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/motifSandbox/midi/webMidi.test.ts)

任务:

1. 修改 `noteOn(midi, velocity)`:
   - 如果 `open.has(midi)`,先用当前 elapsed time commit 旧 note。
   - 再写入新的 open note。
2. 保持 `noteOff(midi)` 关闭当前 open note。
3. 保持 stop 时补全未关音符。

新增测试:

```text
noteOn 60 @0
noteOn 60 @80
noteOff 60 @160
expect notes:
  60 onset0 duration>=60/80
  60 onset80 duration>=60/80
```

验收:

- 同 pitch 重触发至少输出两个 captured notes。
- 不破坏现有 noteOn/noteOff、未关音符 stop、超时停止测试。

### Phase 2: Hidden-grid 不按 quantized onset 合并

文件:

- [src/core/generation/motifSandbox/model/motifAnalysis.ts](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/motifSandbox/model/motifAnalysis.ts)
- [src/core/generation/motifSandbox/model/motifHiddenGrid.test.ts](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/motifSandbox/model/motifHiddenGrid.test.ts)

任务:

1. 删除或绕过 `analyzeHiddenGridMotif()` 里按 `quantizedOnsetBeat` 的 `Map` 合并。
2. 使用 raw `onsetBeat` 排序后的 notes 进入 `fitMotifToBricks()`。
3. 真同时按下的单旋律化只保留在 `fitMotifToBricks()` 的 raw onset `CHORD_EPS` 判定里。
4. `firstBeat`/`leadingRestBeats` 的诊断可继续用最早 note 的 `quantizedOnsetBeat`,但不能影响保音。

新增测试:

```text
case: first-second-same-grid
raw 60@0.13, 64@0.18, 67@0.50, 69@0.75
expect motif.notes[0].midi === 60
expect motif.notes.length === 4
expect motif.notes onsets strictly increasing
expect motif.notes[0].onsetBeat === 0
```

```text
case: dense 32nd-ish
raw 8 个音落在 0..0.875 beat,部分 quantizedOnsetBeat 相同
expect 不因 quantizedOnsetBeat 相同而丢音
expect output onsets unique and increasing
```

验收:

- 禁止出现 `Map` 以 `quantizedOnsetBeat` 为 key 做旋律合并。
- 首音被切头到 0,但音高必须来自用户真实第一音。
- 标准 hidden-grid 测试仍通过。

### Phase 3: Q+R finalLead 单声部安全闸

文件:

- [src/core/generation/motifSandbox/model/motifWeaver.ts](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/motifSandbox/model/motifWeaver.ts)
- 新增 `src/core/generation/motifSandbox/model/leadSanitizer.ts`
- [src/core/generation/motifSandbox/model/motifWeaver.test.ts](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/motifSandbox/model/motifWeaver.test.ts)

任务:

1. 在 `smoothAndResolve(...).map(onset snap).sort(...)` 之后调用 `sanitizeMotifLeadNotes()`。
2. 先 coalesce 同 onsetBeat + same midi。
3. 再消解同 pitch overlap。
4. quote 音优先保留,不得因为 connect/develop overlap 而吞掉 quote。
5. audit 使用 sanitize 后的 lead。

新增测试:

```text
generateSampleCaptured(96, 0, major, 1)
style=pop, seed=2
expect finalLead 不存在 same midi + same onsetBeat
expect buildLeadOnlyIr(finalLead).leadTrack 不存在 same pitch overlap
```

再加 quote 回归:

```text
for style in pop/lofi/rnb/jazz
for seed 1..100
for variant 0..3
  quote slot 中 ref motif 每个音都存在 occurrenceKind=quote
  lead 无 same pitch overlap
```

验收:

- `strict quote` 不丢第一个用户音。
- 同 tick 同 pitch 重触发为 0。
- 不显著改变 lead 数量:允许合并真正重复音,但不能批量删除正常旋律音。

### Phase 4: Q+R preview IR 与 Q+N 走 A tick-domain 兜底

文件:

- [src/core/generation/motifSandbox/model/leadOnlyIr.ts](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/motifSandbox/model/leadOnlyIr.ts)
- [src/core/generation/newEngine/generation/generateSongFromMotif.ts](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/newEngine/generation/generateSongFromMotif.ts)
- [src/core/generation/motifSandbox/model/leadOnlyIr.test.ts](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/motifSandbox/model/leadOnlyIr.test.ts)
- [src/core/generation/newEngine/generation/generateSongFromMotif.test.ts](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/newEngine/generation/generateSongFromMotif.test.ts)

任务:

1. 在 `buildLeadNotes()` 中对 `toNoteIR()` 结果调用 `sanitizeLeadNoteIR()`。
2. 在 `motifLeadToTrackIR()` 返回前调用 `sanitizeLeadNoteIR()`。
3. `sanitizeLeadNoteIR()` 必须先合并同 pitch + same startTick,再裁剪同 pitch overlap。
4. 合并时不能制造 0 duration note。

新增测试:

```text
lead:
  77 startBeat 48 duration 0.125
  77 startBeat 48 duration 0.9
expect IR only one 77@sameTick
expect duration is long one
```

```text
Q+N走A:
use Q+R pop seed=2 variant=1 result -> buildMotifSongOverride -> generateSongFromMotif
expect final lead track no same pitch overlap
```

验收:

- Q+R preview 无同 pitch overlap。
- Q+R -> Q+N full arrangement 无同 pitch overlap。
- jazz 16th run grid-owner tests 仍通过。

## 必跑命令

```bash
npx vitest run \
  src/core/generation/motifSandbox/midi/webMidi.test.ts \
  src/core/generation/motifSandbox/model/motifHiddenGrid.test.ts \
  src/core/generation/motifSandbox/model/motifWeaver.test.ts \
  src/core/generation/motifSandbox/model/leadOnlyIr.test.ts \
  src/core/generation/newEngine/generation/generateSongFromMotif.test.ts \
  src/core/generation/newEngine/render/leadGridTiming.test.ts \
  src/core/generation/newEngine/render/leadArticulation.test.ts
```

```bash
npm run lint
```

## 手工/脚本验收用例

### Hidden-grid 首音保留

```text
raw: 60@0.13, 64@0.18, 67@0.50, 69@0.75
expected:
  normalizedCount = 4
  motif.notes[0].midi = 60
  motif.notes[0].onsetBeat = 0
  onsets strictly increasing
```

### Recorder 同 pitch 重触发

```text
noteOn 60 @0
noteOn 60 @80
noteOff 60 @160
expected captured length = 2
```

### Render 同 tick 同 pitch

```text
style=pop, seed=2, variant=1
expected:
  Q+R buildLeadOnlyIr lead track samePitchOverlapCount = 0
  Q+N generateSongFromMotif override lead track samePitchOverlapCount = 0
```

### Fuzz 下限

建议临时跑 1000+ 组 hidden-grid randomized scale notes:

- analyzer 不因 quantized onset 相同而丢音。
- firstChanged 必须为 0,除非第一音被 tonality snap 改音高。
- weaveQuoteMiss 必须为 0。
- IR samePitchOverlap 必须为 0。

## 非目标

- 不改变 motif brick 分类逻辑。
- 不改变和声模板选择。
- 不改变 RoadMap slot planner。
- 不重新设计 swing / jazz 16 分 run。
- 不接入新的器配逻辑。

## 完成定义

任务完成时必须同时满足:

1. 用户真实第一音不会因为量化同格消失。
2. 快速相邻音不会因为落同一 16 分格被合并。
3. 同 pitch noteOff/on 不会覆盖旧音。
4. Q+R preview MIDI 不存在同 pitch overlap。
5. Q+R 走 A 到 Q+N 的 lead track 不存在同 pitch overlap。
6. 现有 Q+R motif quote、hidden-grid、jazz fast-run 测试全部通过。
