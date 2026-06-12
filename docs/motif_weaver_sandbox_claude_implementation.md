# Motif Weaver Sandbox Implementation Brief

面向 Claude 的开发任务说明。目标是在当前引擎项目里新增一个完全独立的旋律沙盒:按 `Q+R` 打开,先支持 MIDI 设备输入与用户 motif 录制,再参考 Impro-Visor 的 Theme Weaver / Memorize Motifs 思路实现“motif 续写 + 段落重现”。第一期只做旋律,不改主链路、不改 newEngine 生产路径、不改和声/伴奏/鼓/Bass。

## 0. 总目标

新增一个开发沙盒面板:

- 快捷键:按住 `Q+R` 打开/切换,`Esc` 关闭。
- 入口:左侧 `DevDock` 新增 “Motif 沙盒” 项,和现有 `Q+N` newEngine、`Q+H` Pipeline 并列。
- MIDI:浏览器 Web MIDI 设备枚举、选择输入设备、监听 `noteon/noteoff`。
- 录制:允许用户录入 4 秒以内的 motif,记录 pitch/onset/duration/velocity。
- 分析:把 motif 转成 relative representation:scale degree、rhythm cell、contour、accent map。
- 续写:生成一条完整 lead melody,明确包含用户 motif,并在 `VERSE1`、`VERSE2` 同样出现。
- 风格:优先 POP/LOFI/RNB grammar 或黄金种子思想,避免默认 jazz 化。
- 播放:只播放/预览 lead melody 即可。伴奏、和声、鼓、Bass 暂不变。

第一期验收的最小效果:插上 MIDI 键盘,打开 `Q+R`,录一段 motif,点击生成,面板能显示原始 motif、VERSE1/VERSE2 quote 位置、续写后的 lead 音符列表,并能播放 lead-only 结果。

## 0.1 可行性审计结论

结论:可行。当前项目已经具备三块关键基础:

- Dev panel 通道已存在:`Q+N`/`Q+H` 的模式可以直接扩展到 `Q+R`。
- Web MIDI 类型在当前 TypeScript `lib.dom.d.ts` 中已存在,不需要额外安装类型包。
- lead-only preview 可以复用现有 `MusicalIR`、`Timebase`、`globalMidiScheduler` 播放链。

需要注意的落地约束:

- 播放层当前使用全局 `globalMidiScheduler`,所以 Motif 沙盒和 NewEnginePanel **不支持同时播放**。本期“不冲突”定义为:不改生产链路、不改 newEngine 状态、互相播放前可安全 stop/replace。
- `createTimebase` 不接收 `bpm`;bpm 是播放参数。构造 Timebase 时只传 `meter/ppq/tempoMap`。
- `MusicalIR.NoteIR` 使用 branded `midi()/beats()/ticks()` 构造器,不要裸塞 number。
- `exact quote` 指 normalized motif 的原样复现。raw MIDI 保留在 UI/debug 中,生成用 normalized motif。

## 1. 强边界

必须遵守:

- 不修改 `generateSong` 行为。
- 不修改 `renderMgMelody` 生产结果。
- 不修改现有 `newEngine` 测试 oracle。
- 不把 sandbox 逻辑接入 `AuraJam` 或 `AuraBar` 主 App。
- 不改 `src/core/generation/newEngine/render/__mgOracle__` 文件。
- 不引入 Java/Impro-Visor 运行时依赖。只参考算法思想,clean-room TypeScript 实现。
- 不新增 Web MIDI npm 包。用浏览器原生 `navigator.requestMIDIAccess`。
- 不调用 `generateSong` / `traceGeneration` 来生成本沙盒旋律。Motif 沙盒只生成 lead-only result。

可以复用:

- 中立音频播放层:可以用 `playMusicalIR` 播放 lead-only `MusicalIR`,也可以写一个 sandbox-local lead preview helper。注意它们共享 `globalMidiScheduler`,播放互斥。
- 基础类型:可以复用 `NoteData`、newEngine `Timebase`、`MusicalIR`、`TrackIR`。
- 当前 grammar/brick 资产:可读 `POP_ENRICHED_GRAMMAR`、`LOFI_ENRICHED_GRAMMAR`、`RNB_ENRICHED_GRAMMAR`,但第一期也可以先实现轻量 motif grammar,不必接完整 MG 链。

## 2. 参考路径

### 当前项目

- `src/components/devPanels.ts`  
  DevDock 面板通道。当前只有 `pipeline | newengine`,需要新增一个 panel id。

- `src/components/DevDock.tsx`  
  左侧开发面板入口。新增 panel meta 后应自动出现,但 `openMap` 初值也要补。

- `src/App.tsx`  
  当前挂载了 `DevDock`、`PipelineMonitor`、`NewEnginePanel`。需要挂载新的 `MotifWeaverSandboxPanel`。

- `src/core/generation/newEngine/sandbox/NewEnginePanel.tsx`  
  `Q+N` 面板参考。复用其快捷键监听、`useDevPanelChannel`、关闭行为、UI 密度。

- `src/apps/AuraJam/MotifRecorder.ts`  
  可参考录制事件到 `NoteData[]` 的转换,但不要直接把 AuraJam recorder 当作新 sandbox 依赖。

- `src/apps/AuraJam/MotifPreprocessor.ts`  
  可参考质量分析、量化、scale snap、motif 扩展思想。第一期建议抽一套 sandbox-local cleaner/analyzer,避免耦合 AuraJam。

- `src/core/generation/newEngine/render/mgLeadRenderer.ts`  
  当前生产 lead 链路:RoadMap bricks -> grammar -> scheduled tokens -> realize。沙盒不要改它,但可以借鉴“按 brick 选择 grammar”的思路。

- `src/core/generation/newEngine/knowledge/melodyStyleGrammarProfiles.ts`  
  POP/LOFI/RNB/JAZZ grammar 入口。非 jazz 默认优先 POP/LOFI/RNB。

- `src/core/generation/newEngine/render/__mgOracle__/_index.json`  
  23 个黄金种子 oracle 概览。POP/LOFI/RNB 共 19 个,可作为后续风格校验样本,第一期不要改。

### Impro-Visor

- `/Users/mynority/vibe_coding/Impro-Visor/src/imp/themeWeaver/Theme.java`  
  `Theme` = 用户主题/motif 的容器。

- `/Users/mynority/vibe_coding/Impro-Visor/src/imp/themeWeaver/ThemeUse.java`  
  `ThemeUse` = theme 使用概率和变形概率。

- `/Users/mynority/vibe_coding/Impro-Visor/src/imp/themeWeaver/ThemeWeaver.java`  
  关键参考:
  - `generateThemeWovenSolo`
  - `currentSelectionJButtonActionPerformed`
  - `myGenerateSolo`
  - `adjustTheme`
  - `connectSections`

- `/Users/mynority/vibe_coding/Impro-Visor/src/imp/trading/tradingResponseModes/MemorizeMotifsTRM.java`  
  关键参考:
  - 用户输入 melody -> motif data point
  - abstract melody / exact melody / relative pitch
  - motif grammar 生成回应

- `/Users/mynority/vibe_coding/Impro-Visor/src/imp/trading/TradingResponseInfo.java`  
  关键参考:
  - `chopResponse`
  - `genMotifSolo`
  - `generateFromMotifGrammar`

## 3. 推荐新增目录

推荐放在独立目录,避免误以为它是 newEngine 生产链:

```text
src/core/generation/motifSandbox/
  index.ts
  ui/MotifWeaverSandboxPanel.tsx
  midi/webMidi.ts
  capture/MidiMotifRecorder.ts
  model/types.ts
  model/scale.ts
  model/motifAnalysis.ts
  model/motifTransform.ts
  model/motifWeaver.ts
  model/leadOnlyIr.ts
  model/jazzinessAudit.ts
  model/motifWeaver.test.ts
  midi/webMidi.test.ts
```

若团队更喜欢把所有调试 UI 放进 `newEngine/sandbox`,也可以只把 UI panel 放在那里,但 algorithm/model 仍建议独立在 `src/core/generation/motifSandbox`。

## 4. 数据模型建议

新增 `model/types.ts`:

```ts
export type SandboxStyle = 'pop' | 'lofi' | 'rnb' | 'jazz';
export type SandboxSectionId = 'verse1' | 'verse2';

export interface CapturedMidiNote {
  midi: number;
  velocity: number;      // 0..127
  onsetMs: number;
  durationMs: number;
}

export interface MotifNote {
  midi: number;
  onsetBeat: number;
  durationBeat: number;
  velocity: number;      // 0..1
  scaleDegree: number;   // 1..7
  octave: number;
  accent: number;        // 0..1
}

export interface UserMotif {
  id: string;
  keyPc: number;
  mode: 'major' | 'minor';
  bpm: number;
  notes: MotifNote[];
  lengthBeats: number;
  contour: number[];
  rhythmCell: number[];
  createdAt: number;
}

export interface MotifOccurrence {
  motifId: string;
  sectionId: SandboxSectionId;
  startBeat: number;
  kind: 'quote' | 'variation';
  transform: 'identity' | 'transpose' | 'invert' | 'retrograde' | 'rhythmDivide' | 'tailAnswer';
}

export interface MotifWeaverResult {
  motif: UserMotif;
  occurrences: MotifOccurrence[];
  lead: MotifNote[];
  audit: {
    motifQuotedInVerse1: boolean;
    motifQuotedInVerse2: boolean;
    maxLeap: number;
    chromaticRatio: number;
    jazzinessScore: number;
  };
}
```

## 5. 实现阶段清单

### Phase 1: UI 壳和 Q+R 面板

- [ ] 在 `src/components/devPanels.ts` 增加 `DevPanelId = 'pipeline' | 'newengine' | 'motif'`。
- [ ] 在 `DEV_PANELS` 增加 “Motif 沙盒”,combo=`Q+R`,icon 可用 `Music2` 或 `Piano`。
- [ ] 在 `src/components/DevDock.tsx` 的 `openMap` 初值补 `{ motif: false }`。
- [ ] 新建 `MotifWeaverSandboxPanel.tsx`。
- [ ] 在 panel 内使用 `useDevPanelChannel('motif', open, setOpen)`。
- [ ] 实现和 `NewEnginePanel` 同风格的快捷键监听:
  - 按住 `q+r` 打开。
  - 打开后 `Esc` 关闭。
  - 输入框聚焦时不触发。
- [ ] 在 `src/App.tsx` 挂载 `<MotifWeaverSandboxPanel />`。
- [ ] UI 第一版包含:
  - MIDI 支持状态
  - 设备选择
  - 录制按钮
  - 当前录制秒数 / note count
  - key/mode/style/bpm 控件
  - 生成按钮
  - 播放按钮
  - 结果 readout

验收:

- [ ] Q+R 能打开面板。
- [ ] DevDock 点击能打开/关闭,高亮同步。
- [ ] Q+N/Q+H 不受影响。

### Phase 2: Web MIDI 设备识别和输入

新增 `midi/webMidi.ts`:

- [ ] 定义 `MidiDeviceInfo`。
- [ ] 实现 `requestMidiAccess(): Promise<MidiAccessState>`。
- [ ] 枚举 `access.inputs`。
- [ ] 监听 `statechange`,设备插拔时刷新。
- [ ] 支持选择单个 input。
- [ ] 解析 `MIDIMessageEvent.data`:
  - `const status = data[0] & 0xf0`
  - `const channel = data[0] & 0x0f`
  - `status === 0x90 && velocity > 0` => note on
  - `status === 0x80` 或 `status === 0x90 && velocity === 0` => note off
  - 忽略 clock/CC/pitch bend 第一版
- [ ] 面板显示最近输入 note。

边界:

- 浏览器不支持 Web MIDI 时显示“当前浏览器不支持 Web MIDI”。
- 未授权时显示“点击启用 MIDI”。
- 没设备时显示“未检测到 MIDI 输入设备”。
- Web MIDI 需要 secure context;localhost 通常可用。

验收:

- [ ] 插入 MIDI 键盘能看到设备名。
- [ ] 选择设备后按键能看到 note on/off。
- [ ] 拔插设备不会崩。

### Phase 3: 4 秒 motif 录制器

新增 `capture/MidiMotifRecorder.ts`:

- [ ] `start({ bpm, maxMs: 4000 })` 清空状态并记 `performance.now()`。
- [ ] `noteOn(midi, velocity)` 记录 open note。
- [ ] `noteOff(midi)` 关闭最近同 pitch open note。
- [ ] 超过 4 秒自动 stop,或 UI 手动 stop。
- [ ] `stop()` 返回 `CapturedMidiNote[]`。
- [ ] 未关闭音符在 stop 时补 duration。
- [ ] 最小时值 clamp,例如 `durationMs >= 60`。
- [ ] raw capture 可保留重叠音;第一期生成前必须 `normalizeToMonophonic`:
  - 同一 1/16 onset bucket 内优先取最高音。
  - 若同 pitch 重复,保留较早 onset 和较长 duration。
  - UI/debug 仍显示 raw note count 和 normalized note count。

验收:

- [ ] 录制 4 秒内音符,stop 后得到 onset/duration/velocity。
- [ ] 长按音符 stop 时能补结束时间。
- [ ] 快速重复同 pitch 不丢 note。

### Phase 4: Motif 分析与清洗

新增 `model/scale.ts`、`model/motifAnalysis.ts`:

- [ ] 随机或手选 key/mode:
  - keyPc:0..11
  - mode:`major | minor`
  - 大调使用 Ionian `[0,2,4,5,7,9,11]`
  - 小调使用 Aeolian `[0,2,3,5,7,8,10]`
- [ ] 将 captured notes 转 beat:
  - `beat = ms / (60000 / bpm)`
- [ ] 量化 onset/duration 到 1/16 grid:0.25 beat。
- [ ] 限制 motif 长度:
  - 输入最多 4 秒。
  - 输出 motif length 向上补齐到 1/2/4/8 beats,最多 8 beats。
- [ ] 音高吸附到当前 scale。
- [ ] 保存 raw 与 normalized 两份:
  - raw:用户真实 MIDI 输入,只用于 UI/debug。
  - normalized:量化、单旋律化、scale snap 后的生成输入。
- [ ] 计算 scaleDegree、octave。
- [ ] 计算 contour:
  - 相邻音 pitch delta 的符号或 scale degree delta。
- [ ] 计算 rhythmCell:
  - onset difference + duration pattern。
- [ ] 计算 accent:
  - velocity 权重
  - 强拍/长音加权
  - phrase 首尾加权
- [ ] 质量门:
  - 少于 2 个音:不给生成,提示重新录。
  - 超过 24 个音:提示太密,可自动简化或只取前 16。

验收:

- [ ] 输入 C major 内外音,输出都在 C Ionian 内。
- [ ] rhythm/onset 稳定量化。
- [ ] 结果可 JSON stringify 显示。

### Phase 5: Motif 变形工具

新增 `model/motifTransform.ts`:

参考 Impro-Visor `ThemeWeaver.adjustTheme`,实现 TypeScript clean-room 版本:

- [ ] `identity(motif)`
- [ ] `transposeDiatonic(motif, steps)`
- [ ] `invertAroundDegree(motif, pivotDegree)`
- [ ] `retrogradePitchOnly(motif)` 或 `retrogradeFull(motif)` 二选一,第一期建议 pitch-only。
- [ ] `rhythmDivide(motif)` 将最长音一分为二,第二个音可上邻接。
- [ ] `barLineShift(motif, shiftBeats)` 第一版可只用于 variation,不要用于 quote。
- [ ] `fitRange(notes, lowMidi, highMidi)`。
- [ ] `snapToScale(notes, keyPc, mode)`。

规则:

- `VERSE1`、`VERSE2` 的 quote 必须用 normalized motif 的 `identity`,不变形。
- 变形只用于后半句续写/answer。
- 默认不使用 chromatic side-slip,避免 jazz 化。

验收:

- [ ] identity 输出与用户 motif 的 pitch/rhythm 等价。
- [ ] invert/transpose 后仍在 scale 内。
- [ ] duration/onset 不重叠、不倒退。

### Phase 6: Motif Weaver 旋律生成

新增 `model/motifWeaver.ts`:

目标生成 16 小节 lead-only melody:

```text
verse1: 8 bars
  bar 1: user motif exact quote
  bar 1-4: answer/development
  bar 5-8: continuation/cadence

verse2: 8 bars
  bar 1: same user motif exact quote
  bar 1-4: related answer
  bar 5-8: more developed continuation
```

任务:

- [ ] 输入 `UserMotif + style + keyPc + mode + bpm + seed`。
- [ ] 随机必须确定性:
  - 生成阶段不要用 `Math.random()`。
  - 可以复用 `createRandomContext(seed)` 或实现 sandbox-local seeded RNG。
- [ ] 固定或可配置 form: `verse1(8 bars) + verse2(8 bars)`。
- [ ] 在 beat 0 插入 motif quote。
- [ ] 在 beat 32 插入同一个 motif quote。
- [ ] 生成后半句:
  - phrase A answer:motif tail + sequence up/down
  - phrase B continuation:target tonic/mediant/dominant
  - verse2 answer 可以使用同一 contour,但末尾不同。
- [ ] 保证 quote notes 标记 `motifName` 或 occurrence metadata。
- [ ] 实现 `connectSections(prev, next)`:
  - 若边界跳进 > 7 半音,对 next 的第一个发展音做八度调整或选择更近的 scale tone。
  - 不改 quote 内部音。
- [ ] 实现 `jazzinessAudit`:
  - chromaticRatio 第一版应为 0。
  - 连续 0.25 beat 音符比例过高则警告。
  - 大跳过多则警告。

非 jazz 策略:

- POP:更多级进、重复、稳定节奏。
- LOFI:更多留白、长音、少量邻接。
- RNB:允许更多 syncopation,但仍不默认 altered/chromatic。
- JAZZ:只有用户选 jazz 时才允许更密节奏和 chromatic approach。

验收:

- [ ] 生成结果中 beat 0..motifLength 与用户 motif 等价。
- [ ] beat 32..32+motifLength 与用户 motif 等价。
- [ ] 生成总长度 64 beats。
- [ ] 所有 pitch 在 scale 内。
- [ ] jazzinessScore 在 POP/LOFI/RNB 下低于阈值,例如 `< 0.35`。

### Phase 7: Lead-only 播放

新增 `model/leadOnlyIr.ts`:

- [ ] 把 `MotifWeaverResult.lead` 转成 `MusicalIR`:
  - `tracks:[{ role:'lead', notes, program }]`
  - 默认 program:
    - pop:80 或 0/4 可配置
    - lofi:4/12
    - rnb:4/5
    - jazz:65/66 或 0
  - `durationTicks = timebase.beatToTick(beats(64))`;第一期是 64 beats,4/4 下 16 bars。
- [ ] 使用 `createTimebase({ meter: { numerator: 4, denominator: 4 }, tempoMap: [{ atBeat: beats(0), bpm }] })` 生成 Timebase。注意 `bpm` 不在 createTimebase 顶层参数里。
- [ ] 构造 `NoteIR` 时必须使用 branded 构造器:
  - `pitch: midi(Math.round(note.midi))`
  - `startTick: timebase.beatToTick(beats(note.onsetBeat))`
  - `durationTicks: timebase.beatToTick(beats(note.durationBeat))`
- [ ] 最终 IR 用 `freezeMusicalIR({ tracks, timebase, durationTicks })`。
- [ ] 面板点击播放时调用 `playMusicalIR(ir, bpm, style)`。
- [ ] 停止按钮调用 `stopNewEngine()` 或更名封装 `stopSandboxPlayback()`。命名上建议封装一层,避免 UI 文案出现 newEngine。

注意:

- 即使复用 `playMusicalIR`,这只是 sandbox 播放出口,不代表接入 newEngine 主生成。
- 如果 `playMusicalIR` 对 lead-only 有默认 mix/program 问题,在 sandbox 内补 track mix。
- 共享 `globalMidiScheduler` 表示同一时间只能有一个沙盒/面板在播放;这是本期可接受限制,但要在实现中先 stop 再 load 新 track。

验收:

- [ ] 生成后可以播放 lead。
- [ ] Stop 能停止。
- [ ] Motif 沙盒播放停止后,NewEnginePanel 仍可正常生成/播放。二者不要求同时播放。

### Phase 8: 测试

至少加以下测试:

- [ ] `motifAnalysis.test.ts`
  - quantize
  - snap to major/minor scale
  - scale degree conversion
  - 4 秒限制/长度补齐

- [ ] `motifTransform.test.ts`
  - identity keeps motif
  - transpose/invert stays in scale
  - fitRange avoids out-of-range

- [ ] `motifWeaver.test.ts`
  - verse1/verse2 exact quote
  - deterministic same seed
  - different seed gives different continuation but same quote
  - all notes sorted and non-negative duration
  - non-jazz style chromaticRatio = 0

- [ ] `webMidi.test.ts`
  - parse note on
  - parse note off
  - velocity-zero noteon treated as noteoff

Commands:

```bash
npm run lint
npm run test -- motifSandbox
npm run test
```

## 6. 第一版算法伪代码

```ts
function generateMotifWeave(input: MotifWeaverInput): MotifWeaverResult {
  const motif = analyzeAndNormalize(input.capturedNotes, input.keyPc, input.mode, input.bpm);
  const lead: MotifNote[] = [];
  const occurrences: MotifOccurrence[] = [];

  pasteQuote(lead, motif, 0, 'verse1');
  occurrences.push({ motifId: motif.id, sectionId: 'verse1', startBeat: 0, kind: 'quote', transform: 'identity' });

  fillAnswer(lead, motif, { startBeat: motif.lengthBeats, endBeat: 16, style: input.style, verse: 1 });
  fillContinuation(lead, motif, { startBeat: 16, endBeat: 32, cadenceTarget: 1 });

  pasteQuote(lead, motif, 32, 'verse2');
  occurrences.push({ motifId: motif.id, sectionId: 'verse2', startBeat: 32, kind: 'quote', transform: 'identity' });

  fillAnswer(lead, motif, { startBeat: 32 + motif.lengthBeats, endBeat: 48, style: input.style, verse: 2 });
  fillContinuation(lead, motif, { startBeat: 48, endBeat: 64, cadenceTarget: 1, strongerEnding: true });

  const connected = connectSectionsWithoutTouchingQuotes(lead, occurrences);
  const audit = auditMotifWeave(connected, motif, occurrences);
  return { motif, occurrences, lead: connected, audit };
}
```

## 7. UI 信息结构

面板建议分 4 个区块:

1. MIDI
   - Enable MIDI
   - device select
   - input status
   - last note

2. Capture
   - Record / Stop
   - elapsed `0.0s / 4.0s`
   - captured note count
   - clear

3. Generate
   - style:POP/LOFI/RNB/JAZZ
   - key:C..B
   - mode:major/minor
   - bpm
   - seed
   - Generate Lead
   - Play / Stop

4. Analysis
   - motif length
   - contour
   - rhythm cell
   - verse1 quote yes/no
   - verse2 quote yes/no
   - jazziness score
   - first 16 notes list

避免在 UI 写大段教程文字。状态和按钮标签简洁即可。

## 8. 与 Impro-Visor 的映射

| Impro-Visor | 本项目 sandbox |
| --- | --- |
| `Theme` | `UserMotif` |
| `ThemeUse` | `MotifOccurrence` + transform policy |
| `currentSelectionJButtonActionPerformed` | Web MIDI capture -> normalized motif |
| `myGenerateSolo` | `generateMotifWeave` |
| `adjustTheme` | `motifTransform.ts` |
| `connectSections` | `connectSectionsWithoutTouchingQuotes` |
| `MemorizeMotifsTRM.getDataPointForUser` | `motifAnalysis.ts` relative representation |
| `genMotifSolo` | lead-only grammar/continuation |

关键差异:

- Impro-Visor 是 jazz solo 工具,本 sandbox 默认不是 jazz。
- Impro-Visor 依赖现有 chord progression,本期先不做和声生成。
- Impro-Visor 的 motif 插入是概率化,本期 VERSE1/VERSE2 是强制 exact quote。
- Impro-Visor 可 side-slip/chromatic,本期默认禁用,只在 `style='jazz'` 时开放。

## 9. 验收清单

最终 PR/实现完成前逐项确认:

- [ ] `Q+R` 打开 Motif 沙盒。
- [ ] DevDock 有 Motif 沙盒入口。
- [ ] Web MIDI 可授权、枚举设备、选择输入。
- [ ] noteon/noteoff 能被录制。
- [ ] 录制自动限制 4 秒。
- [ ] 录制结果能转成 normalized motif。
- [ ] 生成结果包含 `verse1` exact quote。
- [ ] 生成结果包含 `verse2` exact quote。
- [ ] POP/LOFI/RNB 默认不产生 chromatic pitch。
- [ ] lead-only 可以播放和停止。
- [ ] `npm run lint` 通过。
- [ ] 新增测试通过。
- [ ] 现有 newEngine 相关测试不因 sandbox 改动失败。

## 10. 推荐提交拆分

1. `docs`:本说明落地。
2. `devpanel`:新增 Q+R panel 壳与 DevDock 入口。
3. `midi`:Web MIDI access + parser + recorder。
4. `motif`:analysis/transform/weaver pure model + tests。
5. `preview`:lead-only IR + playback + UI readout。

## 11. 后续非本期

这些不要在第一期做:

- 不做自动和声推导。
- 不做 Bass/Drum/Comp 编曲。
- 不把用户 motif 接入 `generateSong` request。
- 不做 .mid 导出,除非 lead-only preview 已稳定。
- 不做音频转 MIDI。
- 不做复杂 polyphonic motif 分析。
- 不做 Claude/LLM melody generation。

第一期只要把“用户 MIDI motif -> 识别 -> VERSE1/VERSE2 重现 -> 旋律续写 -> lead preview”跑通。

## 12. 拍板决策

以下是实现前的最终产品/工程决策,Claude 按这里执行。

### 12.1 示例 motif 注入

同意加。必须做一个“注入示例 motif”调试按钮。

要求:

- 示例按钮要生成 `CapturedMidiNote[]` raw 输入,然后走完整 `analyze -> normalize -> weave -> preview` 链路。
- 不要直接构造最终 `UserMotif`,否则会绕过 recorder/analyzer 的关键路径。
- 至少提供一个 C major / pop-friendly 的短 motif。
- 可选再提供一个 minor / rnb-ish syncopated motif,但不要扩大第一期范围。
- 这个按钮用于无 MIDI 硬件环境、自动化测试和早期听感验证。

### 12.2 续写深度

同意先做轻量版。

第一期只需要:

- exact quote
- sequence up/down
- answer phrase
- simple cadence target
- boundary smoothing
- deterministic seeded variation

不要一开始接完整 MG 链,也不要堆复杂 motif grammar。目标是先跑通“能听的闭环”,再按听感迭代。

### 12.3 Exact Quote 与音阶吸附

第一期 `exact quote` 指 normalized motif 的原样复现,不是 raw MIDI 的逐音原样复现。

默认规则:

- POP/LOFI/RNB:输入音会被 snap 到当前 key/mode 音阶内,`chromaticRatio = 0`。
- JAZZ:后续可开放 chromatic / blue note,但第一期仍可先保守实现。
- UI/debug 要同时显示 raw notes 与 normalized notes,避免用户以为系统“偷偷弹错”。

也就是说,如果用户在非 jazz 模式弹了蓝调音/半音,第一期把它吸到调内是预期行为。

### 12.4 Key/Mode 来源

第一期默认手选 key/mode。

允许加一个可选自动档,但不能阻塞主流程:

- 默认 UI:用户手选 key + major/minor。
- 可选按钮:`Estimate Key` / `从 motif 估调`。
- 自动估调只作为建议值写回 UI,不要静默覆盖用户选择。
- 第一版估调可以很简单:遍历 12 个 root × major/minor,用 raw pitch class 命中率 + 末音/长音/重音加权打分。

如果时间紧,先做手选,key estimation 放后续。

### 12.5 Lead 预览音色

不要用 GM80 作为 pop 默认。

第一期预览默认:

- pop:GM0 Acoustic Grand Piano 或 GM4 Electric Piano 1,优先 GM4。
- lofi:GM4 Electric Piano 1。
- rnb:GM4 或 GM5 Electric Piano 2。
- jazz:GM0 Acoustic Grand Piano。

原因:沙盒需要听 motif 和续写关系,暖一点、少刺耳更适合判断旋律。GM80 方波 lead 先不用。

### 12.6 实施顺序微调

同意把“能听”提前。

推荐顺序:

1. Q+R panel 壳。
2. 示例 motif 注入。
3. analyzer / weaver / lead preview 闭环。
4. 测试 pure logic。
5. Web MIDI 设备枚举与 recorder 接入。

这样无 MIDI 硬件时也能验证音乐核心,不会被浏览器授权或设备枚举卡住。
