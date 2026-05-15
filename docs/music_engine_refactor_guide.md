# AuraFlow Tap! 音乐引擎重构指导文档

> **读者** — 接手生成引擎重构的工程师
> **目的** — 在不读完所有源码的前提下，一次性建立完整的"项目—架构—接口—约束—边界"心智模型，能直接落手写代码
> **状态** — Phase 2.C/D baseline 已实装：Stage 1 + 2(BPM) + 3(HarmonyCore) + 完整音频回放链路。Stage 4/5（指挥+旋律）+ Bass/Drums Idiom + StructureEngine 完整版仍待写。详见 §3。
> **不要读完所有源码再开始** — 本文件 + `.claude/rules/music_generation_pipeline_rule.md` + `.claude/rules/music_domain_knowledge.md` 是你的最高约束。其它 docs/ 是辅助。
> **不要改本文档之外的"已保留模块"接口形状** — 任何接口扩展先发起讨论再动。

---

## 0. TL;DR — 你接手时看到的东西

1. **整个项目能跑、能编译、`npm run lint` 零错误**。点开浏览器进 AuraBar / AuraJam，能点界面，**能听到和弦织体**（Phase 2.C/D baseline）。和弦是真正的 Markov 推演 + 4-voice Voice Leading 结果，三风格（Pop / Jazz / NeoSoul）各有独立的字典 + 起始权重 + 声部 base score 表。
2. 仍然没有 **旋律 / 鼓 / 贝斯**。Stage 4 / Stage 5 暂未实装；ArrangedTrack 上 melody / drums / pianoLH 都是空数组。runPipeline 的 PRNG 消耗目前只到 stateC（HarmonyCore 之前），没有 stateD。
3. 你的任务：**按本文档 §2 的五阶段管道契约 + §5 的接口签名 + §6 的硬约束，把 Stage 2 完整版 / Stage 4 / Stage 5 / Orchestrator / Bass+Drums Idiom 写出来**。最终目标：
   - 在 Web 上能听到完整的曲子（与历史版本同等水准甚至更好）
   - 同 seed 在 Web 和未来 ESP32 C 端**逐字节一致**（黄金种子验证）
4. 你**不需要**改 App 层（`/src/apps/`）、音频层（`/src/core/audio/`）、HAL（`/src/core/hal/`）、UI（`/src/components/`）。音频层在 Phase 2.D 已经真实接好，等你把 pianoLH / melody / drums 喂进 ArrangedTrack 即可发声。
5. 参考架构在 `docs/ALL_SOURCE_CODE.md`（5227 行，旧版完整源码导出）+ `docs/ImproVisor_Core_Export.md`（Impro-Visor 三件套 primitives 的参考实现）。**不要照搬旧字符串风格枚举、不要带回 Math.random**；本仓库已经做过架构升级（数值枚举、PRNG 单例、显式 MusicContext、flat array 转移矩阵），那些升级都要保留。

---

## 1. 项目背景

### 1.1 产品定位

**AuraFlow Tap! Ver.7.6** — Web 端音乐工作站模拟器，5×3 触觉打击垫 + 程序化算法编曲。最终目标是把生成管道 1:1 翻译到 **ESP32-S3 纯 C 固件**，Web 版充当算法的"参考实现 + 调试沙盘"。

### 1.2 双平台分工

| 层 | Web 实现 | ESP32 移植 |
|---|---|---|
| 生成管道 `/src/core/generation/` | TS 纯类/函数 | C 函数 + struct（**1:1 翻译目标**） |
| PRNG `/src/core/utils/PRNG.ts` | LCG 单例 | C uint32 LCG（**逐位一致**） |
| HAL 接口 `/src/core/hal/` | DOM + Web Audio + React state | I2S DAC + SPI LED + I2C 触控 |
| 音频层 `/src/core/audio/` | SpessaSynth + Web Audio | TinySoundFont + I2S DMA |
| UI / App `/src/components/` `/src/apps/` | React 19 | **不移植**（ESP32 端有 LVGL 自己实现） |

**关键决策**：算法变更先在 TS 验证，再用 `/sync-to-c` 同步到 C。Web 是算法主战场。

### 1.3 技术栈一览

```
React 19 + TS 5.8 + Vite 6
Tailwind 4
SpessaSynth (SF2 web 合成器, WorkletSynthesizer)  ← 公共音色 public/GM128_3MB.sf2 (3MB GM 128 乐器)
motion / framer-motion
Google Gemini (@google/genai)  ← 目前未直接驱动生成逻辑
```

- 路径别名：`@/` → 项目根。例如 `import x from '@/src/core/...'`。
- `experimentalDecorators: true`，`target: ES2022`。
- 无测试框架。"测试" = 黄金种子 + 听感 + `npm run lint`（仅 tsc --noEmit）+ `scripts/test-harmony-core.ts` 脱机验证。

### 1.4 仓库根目录

```
/CLAUDE.md                          架构与规则速查（你已经被 Claude Code 自动加载，可读）
/.claude/rules/                     最高约束（管道规则 + 乐理知识）
/.claude/commands/                  项目级 slash command（/dev /save /tag 等）
/docs/                              本文件 + ESP32 移植 + 审计标准 + 历史架构源码 + ImproVisor 移植参考
/scripts/                           prng-verify.ts / test-harmony-core.ts 等验证脚本
/public/GM128_3MB.sf2               音色库（不要替换）
/src/                               源码
```

---

## 2. 整体架构

### 2.1 顶层分层

```
┌──────────────────────────────────────────────────────────────────┐
│                       UI（React，平台专用）                        │
│  src/App.tsx · src/main.tsx · src/system/AuraSystem.tsx           │
│  src/components/{PipelineMonitor,VolumeController,...}            │
│  src/core/hardware/{LedMatrix,TapArea}                            │
└─────────────────────────┬────────────────────────────────────────┘
                          │
┌─────────────────────────▼────────────────────────────────────────┐
│                  App 状态机（纯 TS 类，非 React Hook）              │
│  src/apps/AuraBar/EndlessRadioManager.ts    ← 无限电台（+ Jam）   │
│  src/apps/AuraRadio/EndlessRadioManager.ts  ← 新版无限电台（精简）│
│  src/apps/AuraJam/JamSessionManager.ts      ← 即兴 + Motif 录制   │
└─────┬───────────────────┬───────────────────┬────────────────────┘
      │                   │                   │
      ▼                   ▼                   ▼
┌─────────────┐   ┌──────────────┐   ┌─────────────────────────────────┐
│ HAL         │   │ 音频层 ✅     │   │ 生成管道 ★ 仍在重构 ★            │
│ /src/core/  │   │ /src/core/   │   │ /src/core/generation/           │
│  hal/       │   │  audio/      │   │  pipeline/index.ts      ✅(部分) │
│             │   │              │   │  pipeline/HarmonyCore.ts ✅     │
│ ILedMatrix  │   │ AudioEngine ✅│   │  primitives/             ✅     │
│ ITouchPad   │   │ Playback    ✅│   │   WeightedPitchSelector         │
│ IAudioOut   │   │ MidiSched   ✅│   │   PCFGGrammarEngine             │
│ ISystemTimer│   │ SynthMgr    ✅│   │   FractalStructureEngine        │
│             │   │              │   │  config/styles/         ✅       │
│             │   │              │   │   ModernPop/ChillJazz/NeoSoul    │
│             │   │              │   │   _SharedHarmony/_ChillJazzHarm  │
│             │   │              │   │  MelodyEngine.ts (兼容 stub)     │
└─────────────┘   └──────┬───────┘   └──────────┬──────────────────────┘
                         │                       │
                         └─────────┬─────────────┘
                                   ▼
                            PRNGManager 单例
                          /src/core/utils/PRNG.ts
```

### 2.2 一次完整生成 + 播放的数据流（当前 Phase 2.D 实装）

```
用户点 Play
  │
  ▼
EndlessRadioManager.triggerGeneration()
  │  ├─ seed = (Date.now() ^ rand) >>> 0
  │  ├─ PRNGManager.setSeed(seed)
  │  └─ PRNGManager.recordSnapshot('A')
  │
  ▼
runPipeline({ allowedStyleIds, forcedBand })             ★ Phase 2.C 实装
  │   stateB（snapshot）
  │   Stage 1  selectStyle    PRNG ×1   → styleId
  │   Stage 2  BPM            PRNG ×1   → bpm；其余暂硬编码（Major / C key / 4 sections）
  │   stateC（snapshot）
  │   Stage 3  HarmonyCore    PRNG ~×80 → chords[] + 4-voice voicings[]（相对空间）
  │   Stage 4  (skip — 等指挥层重构)
  │   Stage 5  (skip — 旋律不在 baseline)
  ▼
AudioEngine.playSong(track, styleId, context, melodyEngine)
  │   ├─ expandVoicingsToNoteData(track) → pianoRH NoteData[]（K-2 在此加 keyOffset，转 ABSOLUTE）
  │   ├─ 装 ArrangedTrack（pianoRH 唯一非空轨；pianoLH/melody/drums 为 []）
  │   └─ await PlaybackEngine.loadSong(arranged) → play()
  ▼
PlaybackEngine.loadSong(arranged)
  │   ├─ pianoRH 渲染到 channel 4，programChange = 0（Grand Piano）
  │   ├─ pianoLH 若非空渲染到 channel 5，programChange = 33（Electric Bass）
  │   └─ globalMidiScheduler.loadTrack(events, bpm)
  ▼
MidiScheduler （5ms setInterval / tickLoop）
  │   currentTick = (performance.now() - startWallTime) / 1000 * (bpm/60) * 480
  │   按 tick 派发 noteOn/Off + programChange + cc + visual 给：
  │   ① spessaSynth → 出声音（SF2 合成）
  │   └─ ② visualListener → LedMatrix
  ▼
扬声器 + LED 同步
```

> **注意**：目前**只有和弦织体能听到**（钢琴轨）。旋律 / 鼓 / 贝斯 / 混音 CC / 伪侧链全部未实装。

### 2.3 五阶段管道拓扑（核心 — 不可变）

```
              ┌────────────────────────────────────────────────────┐
              │                  PRNGManager                       │
              │       setSeed · next · getState · setState         │
              │       recordSnapshot('A'/'B'/'B2'/'C'/'D')         │
              └──┬───────┬───────┬───────┬───────┬─────────────────┘
                 ▼       ▼       ▼       ▼       ▼
              ┌─────┐┌─────┐┌─────┐┌─────┐┌────────────┐
              │Stg 1││Stg 2││Stg 3││Stg 4││ Stage 5    │
              │style││basic││harm ││cond ││ instrument │
              │mood ││param││+251 ││plan ││ layering   │──► GeneratedTrack
              └─────┘└─────┘└─────┘└─────┘└────────────┘    + MusicContext
                                                  │
                                                  ▼
                                       ┌────────────────────┐
                                       │ Orchestrator       │──► ArrangedTrack
                                       │ (consumes plan)    │
                                       └────────────────────┘
                                                  │
                              ════════════════════▼════════════════
                              ║ 平台层（不属于管道规范）           ║
                              ║ PlaybackEngine → MidiScheduler    ║
                              ║ → SpessaSynth → 音频输出           ║
                              ══════════════════════════════════════
```

**严格线性、五阶段不可变**。新增功能在阶段内部加，不允许加第六阶段，不允许跨阶段调用。

---

## 3. 当前代码状态盘点

### 3.1 已实装（不要随意改接口形状）

| 文件 | 状态 | 备注 |
|---|---|---|
| `src/core/generation/types.ts` | ✅ 全部数据契约 + 数值枚举 | `GeneratedChord` 加了 `voicing?: number[]`（RELATIVE 空间） |
| `src/core/generation/config/StyleFlags.ts` | ✅ StyleId 数值枚举 | ModernPop=0 / ChillJazz=1 / NeoSoul=2 |
| `src/core/generation/config/styles/` | ✅ **3 风格的和声配置三件套** | 见 §7 |
| `src/core/generation/config/styles/index.ts` | ✅ barrel + `getStyleHarmonyBundle(styleId)` | 返回 `{ matrix, sectionStartWeights, voiceLeading, bpmRange }` |
| `src/core/generation/config/styles/_SharedHarmony.ts` | ✅ Pop / NeoSoul 共用 10 项字典 | flat 10×10 转移矩阵 |
| `src/core/generation/config/styles/_ChillJazzHarmony.ts` | ✅ ChillJazz 专属 11 项字典 | 含 ii-V-I + 次属 + bII7（TT sub）+ bVImaj7（modal interchange）|
| `src/core/generation/config/styles/ModernPop.ts` | ✅ matrix + section start weights + VoiceLeadingConfig | commonTone=2.5 / leap=0.8 / parallel=0.3 |
| `src/core/generation/config/styles/ChillJazz.ts` | ✅ 同上 | commonTone=3.0 / leap=1.0（不惩罚）/ parallel=0.7（modal 宽松）|
| `src/core/generation/config/styles/NeoSoul.ts` | ✅ 共用 Pop 字典 + Soul 风味 voicing | Color column 整体抬高 |
| `src/core/generation/pipeline/index.ts` | ✅ runPipeline Phase 2.C baseline | Stage 1+2(BPM)+3；Stage 4/5 待写 |
| `src/core/generation/pipeline/HarmonyCore.ts` | ✅ Markov + 4-voice VL | Voice Role × Chord Tone 二维 base score 表 + PC diversity + 倾向音解决 + 平行 5/8 惩罚 + 大跳惩罚 + bass octave 分区 |
| `src/core/generation/primitives/WeightedPitchSelector.ts` | ✅ Impro-Visor `VoicingGenerator` 移植 | 一维加权 pitch 选择器；HarmonyCore 直接消费 |
| `src/core/generation/primitives/PCFGGrammarEngine.ts` | ✅ Impro-Visor `Grammar` 移植 | 栈式 PCFG 推导器；Stage 5 旋律生成将消费 |
| `src/core/generation/primitives/FractalStructureEngine.ts` | ✅ Impro-Visor `Fractal` 移植 | L-System 时间结构切割器；Stage 2 完整版的 StructureEngine 将消费 |
| `src/core/utils/PRNG.ts` | ✅ LCG 单例 + recordSnapshot | 别动 |
| `src/core/utils/TrackSerializer.ts` | ✅ NoteData ↔ Float32Array 扁平内存 | C 翻译参考 |
| `src/core/audio/AudioEngine.ts` | ✅ playSong 真实实装 | `expandVoicingsToNoteData()` 是 K-2 的实际转换点（RELATIVE→ABSOLUTE）|
| `src/core/audio/PlaybackEngine.ts` | ✅ loadSong 最小实装 | pianoRH→ch4(GM 0), pianoLH→ch5(GM 33)；混音 CC 未注入 |
| `src/core/audio/MidiScheduler.ts` | ✅ tick 调度真实实装 | 5ms setInterval + performance.now() 驱动 currentTick |
| `src/core/audio/SynthManager.ts` | ✅ WorkletSynthesizer 加载 SF2 | 单 promise 串行，多次 startAudioContext() 只触发一次真初始化 |
| `src/apps/AuraBar/EndlessRadioManager.ts` | ✅ 仍调旧 `MelodyEngine.generateFullSong(styleId)` + `AudioEngine.playSong()` |  |
| `src/apps/AuraRadio/EndlessRadioManager.ts` | ✅ 直接调 `runPipeline({ allowedStyleIds })` |  |
| `src/apps/AuraJam/{JamSessionManager,MotifRecorder,...}` | ✅ Motif 录制 + 质量分析 + AABB 扩展 |  |
| `src/components/PipelineMonitor.tsx` | ✅ Q+H 调试面板 | 直接调 `runPipeline + AudioEngine.playSong` |
| `src/core/hal/{IHardware,WebSimulatorHAL}.ts` | ✅ HAL 抽象 + Web 实现 |  |
| `src/core/hardware/{LedMatrix,TapArea}.tsx` | ✅ 5×3 网格 React 组件 |  |
| `src/system/{SystemAudio,AuraSystem}.tsx` | ✅ 系统菜单专用音色（Vibraphone on Ch15）|  |
| `scripts/test-harmony-core.ts` | ✅ HarmonyCore 脱机听感/视觉验收 | `npx tsx scripts/test-harmony-core.ts` |

### 3.2 仍是 STUB / 待重构

| 文件 | 历史职责 | 当前占位行为 | 你要做的 |
|---|---|---|---|
| `src/core/generation/MelodyEngine.ts` | 旧管道入口 | 薄包装转发到 runPipeline | **保留兼容签名** — 直到 AuraBar 完全切到 runPipeline 之前不能删 |
| `src/core/generation/GlobalContext.ts` | 全局可变上下文 | 空 setter / 默认值 | 仅给 App 层用，生成管道内**禁止**读（S-2 / K-5）|
| `src/core/generation/utils/SongComparisonLogger.ts` | 黄金种子日志格式化 | 返回一行 stub 字符串 | Phase 6 黄金种子时补回 |
| `src/core/generation/idioms/MusicianRegistry.ts` | 4 Persona + assembleActiveIdiom | 空池、空 idiom | Phase 4（Stage 4 / ConductorPlan）|
| `src/core/generation/config/StyleRegistry.ts` | 完整 StyleConfig | 最小骨架 | Phase 2.6 — 补 rhythm.drumPatterns 等 |
| `src/core/generation/pipeline/index.ts` Stage 2 完整版 | timeSig/tonality/keyOffset 完整抽取 | 暂硬编码 4/4 / Major / C | 接入 FractalStructureEngine 做段落骨架 |
| `src/core/generation/pipeline/index.ts` Stage 4 | ConductorPlanner | 跳过 | 招募 5 槽位 + silent/focus/support 决策 |
| `src/core/generation/pipeline/index.ts` Stage 5 | layerInstruments | 跳过 | 调 PCFGGrammarEngine（旋律）+ FractalStructureEngine（节奏微切）|
| `src/core/generation/Orchestrator.ts` | 编配 + 多轨渲染 | **不存在** — 目前由 AudioEngine.expandVoicingsToNoteData 临时顶班 | Phase 2.6 — 写真 Orchestrator + Bass / Drums / Texture Idiom |
| `src/core/generation/MidiConverter.ts` | ArrangedTrack → MidiEvent[] | **不存在** — 目前由 PlaybackEngine.renderNotesToEvents 临时顶班 | Phase 2.6 — 接入 CC7/CC10/CC91/CC11 |

### 3.3 历史最近 5 个 commit（提供时间线）

```
4fdbc2a refactor(core): 删除生成引擎+播放混音，全量替换为占位符等待重构   ← Phase 2.0 起点
6234c9d feat(monitor): Q+H 面板加 BandSelection + CLAUDE.md 同步参考架构
e69417f feat(generation): 移植参考架构 3 风格 + 4 Persona + InstrumentRegistry
ffe4259 refactor(generation): 拆除 Mood / ConductorPlan / Viterbi / 层级动机系统
8d266c8 chore(generation): pre-migration baseline (半移植态归档)
```

工作树当前 dirty：types.ts 加了 `voicing` 字段；audio 4 件套全部从 stub 转实装；pipeline/index.ts 实装 Phase 2.C；新增 HarmonyCore + 3 个 primitives + config/styles/ 目录。

---

## 4. 数据契约

### 4.1 时间单位约定

| 位置 | 单位 | 类型 |
|---|---|---|
| 生成管道内 | **拍 (beat)** | `number` (double) |
| MidiEvent 内 | **tick** (PPQ=480) | `number` (integer) |
| C 端 | **tick** (4 ticks/beat 简化版) | `uint16_t` |

**转换**：`tick = Math.round(beat * 480)`（在 PlaybackEngine.renderNotesToEvents 内做）。生成管道**不传播 tick**。

### 4.2 核心类型（全在 `types.ts`，不要重复定义）

```typescript
// 单个音符 — 8B C struct 友好
interface NoteData {
    pitch: number;        // MIDI 0~127 — 相对空间或绝对空间（见 §6 K-1）
    onset: number;        // 起始拍位（拍）
    duration: number;     // 时长（拍）
    velocity: number;     // 0.0~1.0
    isGraceNote?: boolean;
    pitchBend?: number;
    pitchBendDuration?: number;
    fadeOutDuration?: number;
    isUserMotif?: boolean;
}

interface GeneratedChord {
    numeral: string;       // 罗马数字 'I'/'vi'/'V7'
    root: number;          // 0~11，相对于调式主音（I=0, ii=2, V=7）
    quality: ChordQuality; // 数值枚举 17 种
    startBeat: number;
    endBeat: number;
    keyOffset?: number;    // 调号偏移；只在 applyOffset 等价点（目前是 AudioEngine.expandVoicingsToNoteData）消费
    extensions?: string[];
    isSignatureEnding?: boolean;
    bassOverride?: number;
    /** ★ HarmonyCore 输出的声部分布 — RELATIVE 升序 MIDI，长度 = voiceCount */
    voicing?: number[];
}

interface SectionMetadata {
    name: string;             // 'Verse_1' / 'Chorus_Main'，仅显示
    startBeat: number;
    endBeat: number;
    energyLevel: number;      // 1~10
    grooveDNA?: number[];     // 该段律动指纹
    sectionType?: SectionType;
    endingType?: 'hard_stop' | 'fade_out';
    localKeyOffset?: number;
    grooveRatio?: { foundation: number; comping: number; color: number };
}
```

### 4.3 数值枚举（替代字符串子串匹配）

```typescript
enum Tonality {
    Major=0, Minor=1, Major_Pentatonic=2, Minor_Pentatonic=3,
    Blues=4, Dorian=5, Mixolydian=6, Melodic_Minor=7, Lydian=8,
    Harmonic_Minor=9, Phrygian=10
}
SCALE_INTERVALS[tonality] → number[]    // 已建好查找表

enum ChordQuality {
    Major=0, Minor=1, Diminished=2, Diminished7=3, Augmented=4,
    Dominant7=5, Minor7=6, Major7=7, HalfDiminished=8,
    Sus4=9, Dominant7Sus4=10, Add9=11, Minor9=12, Major9=13,
    Dominant9=14, Minor11=15, Dominant13=16
}
CHORD_INTERVALS[quality] → number[]      // 和弦音程查找表
CQ_IS_MINOR / CQ_IS_MAJOR / CQ_IS_DOM / CQ_IS_DIM  // 位掩码分类

enum SectionType {
    Intro=0, Verse=1, PreChorus=2, Chorus=3, Bridge=4,
    Outro=5, Break=6, Breakdown=7, BuildUp=8, Drop=9,
    PreOutro=10, Solo_Bridge=11
}

enum StyleId { ModernPop=0, ChillJazz=1, NeoSoul=2 }
StyleIdName[StyleId.ModernPop] → 'Modern Pop'
```

### 4.4 管道输入/输出

```typescript
// runPipeline 入参
interface PipelineRunOptions {
    allowedStyleIds?: StyleId[];                          // 风格白名单（不指定则 3 选 1）
    forcedStyleId?: StyleId;                              // 强制风格
    forcedBand?: Partial<Record<RoleType, string|null>>;  // PipelineMonitor BandSelection 注入（Stage 4 实装后消费）
    generation?: GenerationOptions;                       // motif 等
}

interface GenerationOptions {
    styleId?: StyleId;
    seed?: number;
    length?: 'short' | 'medium' | 'long';
    userMotifRoot?: number;                  // 0~11
    processedUserMotif?: NoteData[];
    motifRole?: 'Foreground' | 'Middleground' | 'Background';
    detectedTimeSignature?: [number, number];
    detectedTonality?: Tonality;
}

// runPipeline 返回值
interface GeneratedTrack {
    chords: GeneratedChord[];               // 每个 chord 携带 voicing 字段
    vocal?: NoteData[];
    melody: NoteData[];
    counterMelody?: NoteData[];
    drums?: NoteData[];
    bpm: number;
    key: string;                            // 'C' / 'Db' / ...
    keyOffset: number;                      // 0~11
    tonality: Tonality;
    timeSignature: [number, number];
    sections: SectionMetadata[];
    blockIndex: number;
    absoluteStartBeat: number;
    hasIntro: boolean;
    preSelectedPalette?: EnsembleDraft;
    globalRiff?: NoteData[];
    processedUserMotif?: NoteData[];
    motifRole?: 'Foreground' | 'Middleground' | 'Background';
}

interface MusicContext {
    keyOffset: number;
    tonality: Tonality;
    bpm: number;
    timeSignature: [number, number];
    grooveDNA: number[];
    ensemble?: EnsembleDraft;
    style?: StyleConfig;
    band?: Musician[];                      // 5 槽位实际就位的乐手
}
```

### 4.5 Orchestrator 输出（Phase 2.6 加入）

```typescript
interface ArrangedTrack {
    bpm: number;
    key: string;
    absoluteStartBeat: number;
    timeSignature?: [number, number];
    styleId?: StyleId;

    // 多轨（绝对 pitch，已 applyOffset）
    vocal?: NoteData[];
    melody: NoteData[];
    secondaryMelody?: NoteData[];
    pianoLH: NoteData[];          // 贝斯轨
    pianoRH: NoteData[];          // 和弦/织体轨
    drums?: NoteData[];
    counterMelody?: NoteData[];
    userMotif?: NoteData[];

    palette?: EnsembleDraft;
    sections?: SectionMetadata[];
    globalRiff?: NoteData[];
    chords?: GeneratedChord[];
    tempoCurves?: TempoCurve[];
    introFilterSweep?: boolean;
}
```

> 目前 ArrangedTrack 由 `AudioEngine.playSong` 临时拼装（仅填 pianoRH = 和弦 voicing 展开）。等 Orchestrator 上线后，这段拼装代码会移走。

### 4.6 平台层终点

```typescript
interface MidiEvent {
    ticks: number;                                      // PPQ=480
    type: 'noteOn'|'noteOff'|'cc'|'programChange'|'pitchBend'|'visual';
    channel: number;                                    // 0~15
    data1: number;                                      // note / cc num / program
    data2: number;                                      // velocity / cc val
    visualData?: any;                                   // visual 事件专用 payload
}
```

---

## 5. 模块接口规范

### 5.1 PRNGManager（已实现，**不要改**）

`/src/core/utils/PRNG.ts`

```typescript
class PRNG {
    setSeed(seed: number): void;
    next(): number;                                // [0, 1)
    nextInt(min: number, max: number): number;
    nextFloat(min: number, max: number): number;
    getState(): number;                             // 用于快照
    setState(state: number): void;                  // 用于回放
    recordSnapshot(key: 'A'|'B'|'C'|'D'): void;     // 在关键节点调
    getSnapshot(key): number | undefined;
    getInitialSeed(): number;
}
export const PRNGManager = new PRNG(0);             // 单例
```

LCG 参数：`state = state * 1664525 + 1013904223 mod 2^32`。
C 端必须用 `uint64_t` 中间运算，结果取低 32 位，与 TS 逐位一致。

### 5.2 runPipeline — 五阶段统一入口（Phase 2.C baseline 实装版）

`/src/core/generation/pipeline/index.ts`

```typescript
export function runPipeline(
    options?: PipelineRunOptions
): { track: GeneratedTrack; context: MusicContext };
```

**当前实装**（Phase 2.C）：

```typescript
export function runPipeline(opt = {}) {
    PRNGManager.recordSnapshot('B');

    // Stage 1：选风格（PRNG ×1）
    const pool = opt.forcedStyleId !== undefined
        ? [opt.forcedStyleId]
        : (opt.allowedStyleIds?.length ? opt.allowedStyleIds
                                       : [ModernPop, ChillJazz, NeoSoul]);
    const styleId = pool[Math.floor(PRNGManager.next() * pool.length)];
    const style   = getStyleConfig(styleId);
    const bundle  = getStyleHarmonyBundle(styleId);

    // Stage 2：BPM（PRNG ×1；tonality / keyOffset / sections 暂硬编码）
    const tonality   = Tonality.Major;
    const keyOffset  = 0;
    const [lo, hi]   = bundle.bpmRange;
    const bpm        = Math.floor(PRNGManager.nextFloat(lo, hi + 0.999));
    const sections   = /* Intro/Verse/Chorus/Outro 各 16 拍 */;

    PRNGManager.recordSnapshot('C');

    // Stage 3：HarmonyCore（PRNG ~×80）
    const harmony = HarmonyCore.generate({
        sections, tonality,
        chordTransitions: bundle.matrix,
        sectionStartWeights: bundle.sectionStartWeights,
        voiceLeadingConfig: bundle.voiceLeading,
        chordsPerSection: 4,
    });
    // voicings 平行索引嵌回 chord.voicing
    for (let i = 0; i < harmony.chords.length; i++) {
        harmony.chords[i].voicing = harmony.voicings[i];
        harmony.chords[i].keyOffset = keyOffset;
    }

    return { track: { chords, melody: [], ... }, context: { ... } };
}
```

**待实装顺序**（务必保持，否则 PRNG 消耗序列对不齐）：

1. Stage 2 完整版：timeSig → tonality → keyOffset → 完整 sections（接 FractalStructureEngine）→ 此前的 BPM 调用顺序保持不变
2. Stage 4 `planConductor` — 在 stateC 后、HarmonyCore 之前**或**之后插入；要重新录制 stateD
3. Stage 5 `layerInstruments` — 在 stateD 后

### 5.3 Stage 1 — selectStyle（当前 PRNG ×1，Mood 系统已移除）

Mood 系统已被 commit ffe4259 拆除。当前 Stage 1 仅消耗 1 次 PRNG 选 styleId。若未来重新引入 Mood，在 Stage 1 出口再加 1 次 PRNG，须同步调整下游 stateB2 / stateC 的相对位置。

### 5.4 Stage 2 — resolveBasicParams（部分实装：仅 BPM）

```typescript
// 完整版签名（待实装）：
function resolveBasicParams(
    s1: { styleId, style },
    opt?: { forcedTimeSignature?, forcedTonality?, forcedKeyOffset? }
): {
    styleId, style,
    timeSignature: [number, number],
    tonality: Tonality,
    keyOffset: number,
    keyName: string,
    bpm: number,
    sections: SectionMetadata[]
};
```

- **顺序固定**：timeSig → tonality → keyOffset → bpm → sections
- 目前只抽 bpm（PRNG×1）；其余暂硬编码（4/4, Major, C, 固定 4 段 64 拍）
- sections 完整版用 `FractalStructureEngine.expand(totalBeats, fractalConfig, iters)` 切骨架 + 给每段贴 SectionType + energyLevel

### 5.5 Stage 3 — HarmonyCore（**已实装**）

```typescript
// src/core/generation/pipeline/HarmonyCore.ts
export class HarmonyCore {
    public static generate(input: HarmonyCoreInput): HarmonyResult;
}

export interface HarmonyCoreInput {
    sections: SectionMetadata[];
    tonality: Tonality;
    chordTransitions: ChordTransitionMatrix;        // 风格注入
    sectionStartWeights: SectionStartWeights;       // 风格注入
    voiceLeadingConfig: VoiceLeadingConfig;         // 风格注入
    chordsPerSection?: number;                       // 默认 4
}

export interface HarmonyResult {
    chords: GeneratedChord[];
    voicings: number[][];   // 平行索引，RELATIVE MIDI 升序，长度 = voiceCount
}

export interface ChordTransitionMatrix {
    numerals: string[];
    roots: number[];                  // 0~11
    qualities: ChordQuality[];
    transitions: number[];            // flat N×N 矩阵
}

export interface SectionStartWeights {
    bySectionType: number[][];        // 按 SectionType 数值索引
    default: number[];                // 兜底
}

export interface VoiceLeadingConfig {
    voiceCount: number;
    commonToneMultiplier: number;      // 共同音保留乘数（>1 加权）
    halfStepMultiplier: number;        // 半音步奖励
    wholeStepMultiplier: number;       // 全音步奖励
    leapPenalty: number;               // 大跳惩罚（<1 抑制；Jazz 取 1.0 = 不惩罚）
    leapThreshold: number;             // 大跳半音阈值（典型 4）
    tendencyToneResolutionBoost: number; // 倾向音解决目标 boost（跨风格统一 4.0）
    parallelFifthPenalty: number;      // 平行 5/8 度惩罚（Pop 0.3 / Jazz 0.7）
    /** flat 3×5 矩阵：voiceRoleScoreTable[voiceRole * 5 + chordToneRole] */
    voiceRoleScoreTable: number[];     // 长度必须 = 15
    pcDiversityFirstRepMultiplier: number;   // 第 1 次 PC 重复乘数（典型 0.5）
    pcDiversitySecondRepMultiplier: number;  // 第 2+ 次 PC 重复乘数（典型 0 = silence）
    voiceRangeLo: number;              // 相对空间下界（C3=48 典型）
    voiceRangeHi: number;              // 相对空间上界（C5=72 典型）
}
```

**HarmonyCore 关键算法点**（要看代码请直接 cat `src/core/generation/pipeline/HarmonyCore.ts`）：

1. **Markov 推演** — 每段先按 `sectionStartWeights.bySectionType[type]` 抽起始和弦，然后按 `transitions[curIdx * N + nextIdx]` 走 chord-1 次 PRNG。
2. **Voice Role × Chord Tone 二维分类** — Bass / Inner / Top × Root / Third / Fifth / Seventh / Color = 3×5 = 15 个 base score 槽位。这是 Phase 2.5 修复"漏风的壳"的核心。
3. **Bass voice 完整 octave 分区** — voice 0 在 `[rangeLo, rangeLo+11]` 抽，任何 root PC 都至少有 1 个候选，配合 base score 1000 强锚根音。
4. **Inner + Top 均分剩余区间** — `[rangeLo+12, rangeHi]` 按 (voiceCount-1) 均分子区间，互不重叠 → 防止 voice crossing 天然成立。
5. **倾向音 vs 稳定音二分类**：
   - 倾向音（V7 的 3rd / b7 等）只 `applyMultiplier` 到**解决目标 pitch class**，强制方向性。
   - 稳定音走 `applyProximityMultipliers` — 共同音 + 半音 / 全音步对称奖励。
6. **平行 5/8 度后扫描** — 抽第 v 个 voice 前，扫候选 pitch，若与已抽到的 j-th voice 构成"上一和弦同间距 + 同方向"运动且间距 ∈ {0, 7}，候选 ×parallelFifthPenalty。
7. **PC diversity 惩罚** — 同和弦内 PC 计数：count=1 ×0.5；count≥2 ×0（绝对禁忌）。防止"3 个 C + 1 个 G"。
8. **每 voice 单次 PRNG**（D-5 友好）— 无论候选多少，pickWeighted 内部双扫描不构造扁平 pool。

**接口外部不变要求**：HarmonyCore 是 Stage 3 的内部，Stage 2 / Stage 4 不直接消费它的输出（消费的是 chord.voicing 字段已嵌入的 `chord[]`）。

### 5.6 Stage 4 — planConductor（**待实装**）

```typescript
function planConductor(
    s3: Stage3Output
): Stage3Output & { ensemble: EnsembleDraft; conductorPlan: ConductorPlan };

interface ConductorPlan {
    sections: Array<{
        sectionIdx: number;
        focusInstruments: InstrumentRole[];     // 主推
        supportInstruments: InstrumentRole[];   // 配角
        silentInstruments: InstrumentRole[];    // 硬约束：本段静音
        rhythmCenter: 'drums' | 'bass' | 'piano';
        counterpointPairs?: [InstrumentRole, InstrumentRole][];
        fillWindows?: Array<{ startBeat: number; endBeat: number; role: InstrumentRole }>;
    }>;
}
```

- **PRNG ×10**（EnsembleDrafter 招募 5 槽位 + 微操偏好）
- 决策维度：`SectionType × StyleId`
- **forcedBand 注入点**：PipelineMonitor 的 BandSelection 在这里覆盖 PRNG 抽出的槽位
- 实装时同步在入口加 `recordSnapshot('D')`

### 5.7 Stage 5 — layerInstruments（**待实装**）

```typescript
function layerInstruments(
    s4: Stage4Output,
    options?: GenerationOptions
): { track: GeneratedTrack; context: MusicContext };
```

- 调 ToplineEngine 生成 melody / vocal — 推荐用 `PCFGGrammarEngine.expand(targetBeats, grammarConfig)` 拿 TerminalSymbol[]，再用 HarmonyCore 提供的 chord pool 把 pitchOffset 染成具体 pitch（相对空间）
- 调 GlobalReviewer 检查 avoid notes / 旋律连贯性
- **静音硬约束**：Stage 4 的 `silentInstruments` 覆盖一切能量阈值
- 输出 MusicContext 携带 `conductorPlan` 供 Orchestrator 消费

### 5.8 Orchestrator（**待实装** — 目前由 AudioEngine 临时顶班）

```typescript
class Orchestrator {
    static arrange(
        track: GeneratedTrack,
        styleId: StyleId,
        context: MusicContext
    ): ArrangedTrack;
}
```

- **同步函数**，PRNG ×M
- 消费 `context.conductorPlan.silentInstruments` 为硬约束
- **K-2 唯一转换点**：把 chord.voicing 与所有 NoteData 的相对 pitch 加 keyOffset 转 ABSOLUTE
  - 目前这步由 `AudioEngine.expandVoicingsToNoteData` 临时做（行 49~69），Orchestrator 上线后要把这段移过去
- 输出多轨：vocal / melody / secondaryMelody / pianoLH（贝斯）/ pianoRH（和弦）/ drums / counterMelody
- 调 TextureMapper：把 chords + voicing + grooveDNA + idiom 渲染成 NoteData（block / arpeggio / comping）
- 调 BassIdiom：walking / steady / syncopated 贝斯线（物理音域 fold [28, 47]）
- 调 DrumIdiom：按 `style.rhythm.drumPatterns` 数据驱动生成鼓

### 5.9 MidiConverter（**待实装** — 目前由 PlaybackEngine 临时顶班）

```typescript
class MidiConverter {
    static convert(
        song: ArrangedTrack,
        channelMap?: ChannelMap,
        options?: { countInBeats?: number; drumDucking?: boolean }
    ): MidiEvent[];
}

const DEFAULT_CHANNEL_MAP = {
    vocal: 0,
    melody: 1,
    secondaryMelody: 2,
    counterMelody: 3,
    pianoRH: 4,       // 和弦
    pianoLH: 5,       // 贝斯
    drums: 9,         // GM 鼓固定 ch9
    userMotif: 6,
};
```

- **同步函数，不消耗 PRNG**
- 输出按 ticks 排序的 MidiEvent[]
- 注入 CC7（音量）/ CC10（声像）/ CC91（混响）/ CC11（伪侧链）
- 调用方是平台层（PlaybackEngine.loadSong）
- 目前 PlaybackEngine 内的 `renderNotesToEvents` 是简化版（无 CC），MidiConverter 上线后从 PlaybackEngine 抽离

### 5.10 Primitives 三件套（**已实装**）

参考 `docs/ImproVisor_Core_Export.md` 看 Java 原型，TS 移植已严格保留语义。

#### WeightedPitchSelector（`primitives/WeightedPitchSelector.ts`）

一维加权 pitch 打分 + 抽样选择器。等价 Impro-Visor 的 `VoicingGenerator`。

```typescript
class WeightedPitchSelector {
    constructor(cfg: {
        pitchSpaceSize: number;           // 12 = RELATIVE pc / 128 = ABSOLUTE / 任意正整数也合法
        previousVoicingMultiplier?: number;
        halfStepAwayMultiplier?: number;
        fullStepAwayMultiplier?: number;
        halfStepReducer?: number;
        fullStepReducer?: number;
        repeatMultiplier?: number;
    });

    reset(): void;
    setBase(pitch, score): void;
    setBaseAllOctaves(pitchClass, score): void;
    applyProximityMultipliers(centerPitch): void;     // 对称辐射（共同音 + ±1 + ±2 半音）
    applyProximityReducers(centerPitch): void;        // 选中后压制邻居
    applyRepeatMultiplier(pitch): void;               // 同 PC 跨八度
    silence(pitch): void;
    applyMultiplier(pitch, multiplier): void;         // 单点不对称（解决目标 boost / parallel 5 惩罚）
    pickWeighted(lo?, hi?): number;                   // PRNG ×1 抽样
    selectTopN(n, lo?, hi?): number[];                // 确定性 top-N（D-3：score 降序 → pitch 升序破 tie）
    getScore(pitch): number;
    getSize(): number;
}
```

HarmonyCore 在 voice leading 阶段直接消费。Stage 5 旋律生成也会消费（pitch 选择按上下文得分）。

#### PCFGGrammarEngine（`primitives/PCFGGrammarEngine.ts`）

概率上下文无关文法栈式推导器。等价 Impro-Visor 的 `Grammar.outerFill / findRule`。

```typescript
class PCFGGrammarEngine {
    static expand(targetBeats: number, config: GrammarConfig): TerminalSymbol[];
}

interface TerminalSymbol {
    type: 'terminal';
    duration: number;            // 拍
    pitchOffset: number;         // RELATIVE — caller-defined baseline 之上的半音偏移
    isRest: boolean;
}

interface NonTerminalSymbol { type: 'nonterminal'; name: string; }
type GrammarSymbol = TerminalSymbol | NonTerminalSymbol;

interface GrammarRule {
    lhs: string;
    rhs: GrammarSymbol[];
    weight: number;
}

interface GrammarConfig {
    startSymbol: string;
    rules: GrammarRule[];
    maxExpansions?: number;      // 默认 10000，防左递归 / 高分叉失控
}
```

终止条件：栈空 / budget < ε / 达到 maxExpansions / terminal duration 超剩余 budget。
PRNG 消耗：每次 non-terminal 展开 1 次。
Stage 5 旋律生成将用它拿出"按拍组织好的 pitchOffset 序列"，再交给 HarmonyCore 的 chord context 染成具体 pitch。

#### FractalStructureEngine（`primitives/FractalStructureEngine.ts`）

L-System 时间结构切割器。等价 Impro-Visor 的 `Fractal.splitSolo / determineNewNotes`。

```typescript
class FractalStructureEngine {
    static expand(totalBeats: number, config: FractalConfig, numIterations: number): FractalBlock[];
}

interface FractalBlock {
    startBeat: number;
    duration: number;
    depth: number;          // L-System 递归深度
    isRest: boolean;
}

interface FractalConfig {
    /** 索引 0~5 对齐 whole/half/quarter/eighth/sixteenth/default — length 必须 6 */
    dividingProbabilities: number[];
    restProbabilities: number[];
    tripletProbability: number;         // 0~1 — 三连音 vs 二分
    minSubdivisionBeats: number;        // 递归终止下界
}
```

PRNG 消耗：每个未达终止条件的 block 每次 iter 消耗 2~3 次。
Stage 2 完整版 StructureEngine 将用它切段落骨架；Stage 5 也可用它做"节奏微切"。

---

## 6. 硬约束（必读 — 违反一条等于代码废）

> 完整版见 `.claude/rules/music_generation_pipeline_rule.md`。下面是你**最容易踩坑**的核心条款。

### 6.1 确定性（D-1 ~ D-5）

| ID | 约束 |
|---|---|
| D-1 | **禁止 `Math.random()`**，统一 `PRNGManager.next()` |
| D-2 | 禁止 `Date.now()` / `performance.now()` 进入生成逻辑 |
| D-3 | `Array.sort()` 必须提供完全确定的比较函数，同 onset 用 pitch 二排序 |
| D-4 | 浮点比较禁止 `===`，必须用 epsilon (`Math.abs(a - b) < 1e-6`) |
| D-5 | 模块入口调 `recordSnapshot()`，代码改动必须通过快照隔离验证 |

### 6.2 可移植性（P-1 ~ P-5，C 翻译友好）

| ID | 约束 |
|---|---|
| P-1 | **禁止 `Map` / `Set` / `WeakMap`**（C 无对应），去重用排序数组 + 线性扫描 |
| P-2 | 禁止依赖 `Object.keys()` 遍历顺序做逻辑判断 |
| P-3 | 整数除法显式 `Math.floor()` / `Math.trunc()` |
| P-4 | 位运算结果 `\| 0` 或 `>>> 0` 保底 |
| P-5 | 禁止隐式类型转换做逻辑判断（`if (velocity)` 当 velocity=0 时为 false 是 bug） |

### 6.3 类型纪律（T-1 ~ T-6）

| ID | 约束 |
|---|---|
| T-1 | **禁止 string 子串匹配做风格/段落分类**（`style.id.includes('jazz')` 是禁止的）。和弦罗马数字 `numeral` 允许 string |
| T-2 | 分类用 enum，多状态用位掩码（参考 `CQ_IS_MAJOR`） |
| T-3 | 生成管道禁止 `any` |
| T-4 | 每处 `as` 强转必须附注释说明安全性 |
| T-5 | 可选字段用 `null` 或哨兵 `0xFF`，禁止依赖 `undefined` |

### 6.4 纯净性（S-1 ~ S-7）

| ID | 约束 |
|---|---|
| S-1 | 除 PRNGManager 外，禁止共享可变全局变量 |
| S-2 | **MusicContext 必须显式传参，禁止读 `GlobalContext`** |
| S-3 | 生成管道**全同步**，禁止 `async`/`await`/`Promise` |
| S-4 | 输出必须可 JSON 序列化，禁止函数 / 类实例 / 循环引用进入 ArrangedTrack |
| S-5 | `/src/core/generation/` 禁止 import React / DOM / Web API |
| S-6 | 禁止闭包捕获外部可变变量 |
| S-7 | 非法输入抛 Error 子类带上下文，外部调用方 catch |

### 6.5 Pitch Space 契约（K-1 ~ K-7，最容易踩坑）

| ID | 约束 |
|---|---|
| K-1 | 管道内只有两种 pitch 空间：**相对空间**（C=60 中心，主音=0，chord.root I=0/ii=2/V=7）和 **绝对空间**（已加 keyOffset，可送 MIDI）。没有第三种 |
| K-2 | **K-2 唯一转换点**：把 keyOffset 加到 pitch 的位置在管道中只能有一个。**目前由 `AudioEngine.expandVoicingsToNoteData` 临时承担**（行 49~69）；Orchestrator 上线后转移到 `Orchestrator.applyOffset()`。HarmonyCore / WeightedPitchSelector / 所有 primitive / TextureMapper / ToplineEngine 全部输出相对 pitch |
| K-3 | HarmonyCore 所有公开函数 + voicings 字段输入输出均相对空间 |
| K-4 | 禁止 `targetCenter - keyOffset` 这种"你减我加"预补偿。要调音域改 targetCenter 本身 |
| K-5 | 生成管道内**禁止读** `GlobalContext.currentKeyOffset` 用于 pitch 计算 |
| K-6 | GlobalReviewer 接收绝对空间，与 HarmonyCore 返回的相对 pitch class 比较必须 `% 12` 桥接 |
| K-7 | 新函数返回 pitch 必须注释空间：`// Pitch Space: RELATIVE` 或 `ABSOLUTE` — primitives 三件套已全部标注 |

### 6.6 C 可移植性（C-1 ~ C-4）

| ID | 约束 |
|---|---|
| C-1 | 两个浮点变量直接 `===` 必死。`beat === chord.startBeat` 写 `Math.abs(beat - chord.startBeat) < 1e-6` |
| C-2 | `for (let beat=start; beat<end; beat+=0.25)` 累加 100+ 次必失配，循环内比较必用 epsilon |
| C-3 | 热循环内 `.push()` 可（C 翻译为 `buf[count++]`），但禁止 `.map()` / `.filter()` / `[...spread]` |
| C-4 | 输出数组无上界必须文档化最大长度（`// max ~300 notes for 3-min song`） |

### 6.7 乐理类硬约束（来自 `music_domain_knowledge.md`）

- **频段隔离**：Bass MIDI 28-47，PianoRH/CounterMelody ≥ 48，Melody C4-G6 (48-79)
- **增益级联（CC7）**：Vocal(118) > Melody(118) > Drums(108) > Bass(98) > Chord(85) > CounterMelody(60)
- **伪侧链**：Kick 触发时向 Bass/Chord/CounterMelody 注入 CC11 自动化（40→65→100→127，150ms 恢复）
- **强拍**：1/3 拍上 90%+ 必须是和弦内音（1/3/5/7），弱拍允许 Tension (9/11/13)
- **禁止半音 crash**：旋律与 Bass 根音 m2/M7 距离同时发声

---

## 7. 风格系统（**已实装移植版**）

### 7.1 文件组织

```
src/core/generation/config/
├── StyleFlags.ts                  ✅ StyleId 数值枚举
├── StyleRegistry.ts               🚧 最小骨架 StyleConfig（待补 rhythm 等）
└── styles/
    ├── index.ts                   ✅ getStyleHarmonyBundle(styleId) 入口
    ├── _SharedHarmony.ts          ✅ Pop / NeoSoul 共用字典 (10 项)
    ├── _ChillJazzHarmony.ts       ✅ Jazz 专属字典 (11 项)
    ├── ModernPop.ts               ✅ bundle: matrix + start weights + VL config
    ├── ChillJazz.ts               ✅ 同上
    └── NeoSoul.ts                 ✅ 同上（共用 Pop 字典）
```

### 7.2 三个风格的核心参数

| StyleId | 显示名 | BPM | commonTone | leapPenalty | parallelFifth | Top Color base | 备注 |
|---|---|---|---|---|---|---|---|
| ModernPop (0) | Modern Pop | 88-128 | 2.5 | 0.8 | 0.3 | 40 | block chord 风味 |
| ChillJazz (1) | Chill Jazz | 70-105 | 3.0 | 1.0 | 0.7 | 60 | 内声部黏死 + modal 允许平行 + 高 color |
| NeoSoul (2) | Neo-Soul | 78-100 | 2.8 | 0.7 | 0.3 | 50 | 共用 Pop 字典 + 色彩偏好 |

### 7.3 Pop / NeoSoul 字典（共用 _SharedHarmony，10 项）

```
0: I       1: Imaj7   2: ii7     3: iii7    4: IV
5: V       6: V7      7: vi      8: vi7     9: V7/vi
```

转移矩阵 10×10 flat，权重直觉：5=非常常见，3=常见，1=偶尔，0=省略。详见 `_SharedHarmony.ts` 第 66~104 行的 POP_EDGES。

### 7.4 Jazz 字典（_ChillJazzHarmony，11 项）

```
 0: Imaj7   1: ii7     2: iii7    3: IVmaj7   4: V7
 5: vi7     6: viiø7   7: V7/ii   8: V7/V     9: bII7   10: bVImaj7
```

亮点：ii7→V7=6（最重权重）、V7→Imaj7=5、bII7（TT sub）→Imaj7=5、V7/ii (A7)→ii7=5。

### 7.5 Section Start Weights

每段（Intro/Verse/PreChorus/Chorus/Bridge/Outro）有独立的起始和弦概率向量。例：

- Pop Chorus: `[I=4, Imaj7=3, IV=3, V=2]` — 大三和弦主导
- Jazz Chorus: `[Imaj7=4, IVmaj7=2]` — 极简但极重 Imaj7
- NeoSoul Verse: `[Imaj7=4, vi7=3, ii7=1]` — 完全避开裸 I

未在 `bySectionType` 中定义的段落类型走 `default` 兜底。

### 7.6 Persona / Idiom 系统（**待实装**）

参考架构 4 乐手卡牌（Alex / Dave / Marcus / Nina）+ MusicianRegistry.assembleActiveIdiom 在 `idioms/MusicianRegistry.ts` 目前是 stub。等 Stage 4 ConductorPlan 写完之后再接入。届时 PipelineMonitor BandSelection 面板可手选乐手强制 forcedBand 注入。

---

## 8. App 层调用接口（**不要改**）

### 8.1 AuraBar `EndlessRadioManager`（兼容旧入口）

```typescript
const melodyEngine = new MelodyEngine();
const rawTrack = melodyEngine.generateFullSong(styleId);  // 返回 { track, context }
await AudioEngine.playSong(rawTrack.track, styleId, rawTrack.context, melodyEngine);
```

`MelodyEngine.generateFullSong` 内部就是 `runPipeline({ forcedStyleId })` 的薄包装。

### 8.2 AuraRadio `EndlessRadioManager`（新版精简入口）

```typescript
PRNGManager.setSeed(seed);
PRNGManager.recordSnapshot('A');
const { runPipeline } = await import('../../core/generation/pipeline');
const rawTrack = runPipeline({ allowedStyleIds: pool });
await AudioEngine.playSong(rawTrack.track, styleId, rawTrack.context, melodyEngine);
```

### 8.3 AuraJam `JamSessionManager`

```typescript
const { motif, role } = preprocessMotif(cRelativeMotif, scaleState.tonality);
const rawTrack = melodyEngine.generateFullSong(randomStyleId, {
    processedUserMotif: motif,
    motifRole: role,
    userMotifRoot: scaleState.key,
    detectedTonality: scaleState.tonality,
});
await AudioEngine.playSong(rawTrack.track, style.id, rawTrack.context, melodyEngine);
```

**用户 motif 是 C-相对空间**（已减 keyOffset）。Stage 5 接 motif 时**禁止再减一次 offset**（K-2 唯一转换点已在 Orchestrator/AudioEngine，双偏移 = bug）。

### 8.4 PipelineMonitor（Q+H 调试面板）

```typescript
PRNGManager.setSeed(seed);
PRNGManager.recordSnapshot('A');
const hasLead = !!(sel[RoleType.AccompInst] ?? sel[RoleType.MainInst] ?? sel[RoleType.Vocal]);
const styleId = hasLead
    ? StyleId.ModernPop   // 占位，Stage 4 会按 leadMusician.styleId 决定
    : RADIO_STYLE_POOL[Math.floor(PRNGManager.next() * RADIO_STYLE_POOL.length)];
const { track, context } = runPipeline({
    allowedStyleIds: hasLead ? undefined : [styleId],
    forcedBand: sel,
});
```

**Lead 在场则全曲定调**（Stage 4 实装时落地）：看 forcedBand 是否有 vocal / mainInst / accompInst，有则 `styleId = leadMusician.styleId`，**跳过 PRNG 抽 styleId**（但**仍要消耗 1 次 PRNG** 以保 ACVE 序列对齐——见 §9.2）。

---

## 9. 平台层调用接口（**已实装**，不要改）

### 9.1 AudioEngine（`src/core/audio/AudioEngine.ts`）

```typescript
class AudioEngineSystem {
    init(): void;
    playSong(track, styleId, context, generator, options?): Promise<void>;
    stop(): void;

    getCurrentArrangedTrack(): ArrangedTrack | null;
    getCurrentContext(): MusicContext | null;
    getCurrentBeat(): number;
    getCurrentTick(): number;
    getBpm(): number;
    getPpq(): number;

    addVisualListener(listener): void;
    setVisualsMode('all' | 'gameplay-only'): void;
    emitVisualEvent(event): void;

    muteChannel(channel, mute): void;
    setPartMute(partName, mute): void;
    isPartMuted(partName): boolean;
    getPartChannels(): Partial<Record<PartName, number>>;

    injectMidiEvent(ev): void;
    getChannelEvents(channel): MidiEvent[];
    replaceChannelEvents(channel, startTick, newEvents, endTick?): void;

    // 实时演奏 — 目前是 no-op（Phase 2.6 加回）
    playNote / noteOn / noteOff / pitchBend

    getMixerState() / setMixerParam(category, param, value)
}
```

**playSong 内部**（当前临时版本）：
```typescript
async playSong(track, styleId, context, generator) {
    if (!this.playback) this.init();
    await startAudioContext();                          // 首次用户手势后加载 SF2
    const pianoRH = expandVoicingsToNoteData(track);    // K-2 RELATIVE→ABSOLUTE
    const arranged: ArrangedTrack = {
        bpm: track.bpm, key: track.key, ...,
        pianoLH: [], pianoRH,                            // 仅和弦轨；其他暂空
        melody: track.melody ?? [], drums: track.drums,
    };
    await this.playback.loadSong(arranged);
    this.playback.play();
}
```

Orchestrator 上线后这段 K-2 转换 + ArrangedTrack 拼装会从 AudioEngine 抽离到 Orchestrator.arrange。

### 9.2 PlaybackEngine（`src/core/audio/PlaybackEngine.ts`）

```typescript
type PartName = 'vocal' | 'melody' | 'chord' | 'bass' | 'drums' | 'secondaryMelody' | 'counterMelody';

class PlaybackEngine {
    loadSong(song: ArrangedTrack, options?): Promise<void>;
    play(): void;
    stop(): void;
    getDuration(): number;

    addVisualListener(listener): void;
    getPartChannels(): Partial<Record<PartName, number>>;
    getPartChannel(partName): number | null;
    getMixerState(): MixerStateStub;
    setMixerParam(category, param, value): void;
    setDrumDucking(enabled): void;
}
```

**当前 loadSong 实装范围**（最小可听 baseline）：
1. pianoRH → channel 4 + programChange = 0（Grand Piano）
2. pianoLH 非空时 → channel 5 + programChange = 33（Electric Bass）
3. 其它轨暂不渲染
4. **未注入** CC7/CC10/CC91 / sidechain / count-in / loopStart-End
5. `globalMidiScheduler.loadTrack(events, song.bpm)`

完整版（Phase 2.6+ 待加）：
- mastering profile + InstrumentRegistry 通道
- 渲染 vocal/melody/secondary/drums/counterMelody 7 轨
- CC7 per-section 渐入 + spread 衰减
- Kick → Bass/Chord sidechain CC11 包络
- CC11 呼吸包络（counterMelody/secondaryMelody 长音）
- CC74 Intro 低通涌动 / CC64 延音
- Count-in 4 拍 + 循环 loopStart/loopEnd

### 9.3 MidiScheduler（`src/core/audio/MidiScheduler.ts`）

```typescript
class MidiScheduler {
    readonly ppq: number = 480;
    loadTrack(events: MidiEvent[], bpm: number, tempoCurves?: TempoCurve[]): void;
    start(): void; stop(): void; pause(): void; clear(): void; panic(): void;

    muteChannel(channel, mute): void;
    isChannelMuted(channel): boolean;

    injectEvent(ev): void;
    getChannelEvents(channel): MidiEvent[];
    replaceChannelEvents(channel, startTick, newEvents, endTick?): void;

    addVisualListener(listener): void;
    onTrackEnd(listener): void;

    setBpm / getBpm / setPosition / getCurrentTick
    beatsToTicks(beats): number;
}
export const globalMidiScheduler = new MidiScheduler();
```

**实装要点**（已实装）：
- PPQ=480 固定（C 端简化为 `tick = beat * 4`，验证允许 ±1 tick 误差）
- 5ms `setInterval` 主线程驱动；`performance.now()` 累加为 currentTick
- 排序：tick 升序；同 tick 时 noteOff 优先于 noteOn（避免新 note 被立刻关掉）
- 派发：`noteOn/Off/programChange/cc/pitchBend → spessaSynth.*`；visual → visualListeners
- 曲终：last event 之后 `setTimeout(200ms)` → fire `onTrackEnd` listeners → 自动 stop
- panic：所有 16 通道发 CC123 (All Notes Off)

**注意**：背景标签页时 setInterval 会被节流（Web Worker tick 优化待 Phase 2.6 加）。当前仅主线程稳定。

### 9.4 SynthManager（`src/core/audio/SynthManager.ts`）

```typescript
export let spessaSynth: WorkletSynthesizer | null;       // ES module live binding
export let isSpessaSynthReady: boolean;
export const getAudioContext: () => AudioContext;
export const startAudioContext: () => Promise<void>;
```

**加载顺序**（已实装）：
1. `getAudioContext()` 单例创建 AudioContext
2. `startAudioContext()`：
   - `ctx.resume()`（必须在用户手势后调用）
   - `ctx.audioWorklet.addModule(workletProcessorURL)` — Vite `?url` 把 worklet processor 作静态资源 emit
   - `new WorkletSynthesizer(ctx)` + `await synth.isReady`
   - `fetch('/GM128_3MB.sf2')` → `synth.soundBankManager.addSoundBank(buffer, 'gm128', 0)`
   - `synth.connect(ctx.destination)`
   - `spessaSynth = synth; isSpessaSynthReady = true`
3. 单 promise 串行：多次 `startAudioContext()` 只触发一次真初始化

失败时 `spessaSynth` 保持 null — 调用方需 `if (!spessaSynth) return;` 守卫降级静音。

### 9.5 通道映射约定（**不要改**）

| Channel | Part |
|---|---|
| 0 | vocal |
| 1 | melody |
| 2 | secondaryMelody |
| 3 | counterMelody |
| 4 | pianoRH（和弦） |
| 5 | pianoLH（贝斯） |
| 9 | **drums（GM 鼓固定）** |
| 6 | userMotif |
| 15 | **SystemAudio Lead（UI 反馈，专用）** |

JamSessionManager / EndlessRadioManager 直接操作 ch9（鼓）/ ch0（旋律） — 改 channel 编号会破坏它们。

---

## 10. PRNG 快照点（ACVE §5.1）

在重构时务必在这五个点调 `recordSnapshot()`，便于全管道确定性验证：

```
PRNGManager.setSeed(seed)
  ├─ stateA  ← App 层 setSeed 之后立即记录（EndlessRadioManager / PipelineMonitor 已经在做）
  ├─ runPipeline() 进入
  │   ├─ stateB   ← Stage 1 入口        ✅ 已记录
  │   ├─ Stage 1 消耗 ×1（style；Mood 移除）
  │   ├─ (stateB2 ← Stage 2 入口        ⏳ 等 Stage 2 完整版加)
  │   ├─ Stage 2~3 消耗 ×~80
  │   ├─ stateC   ← Stage 4 入口        ✅ 已记录（HarmonyCore 之前）
  │   ├─ Stage 4~5 消耗 ×M               ⏳ 未实装
  │   └─ stateD   ← Stage 5 入口        ⏳ 等 Stage 4 加入后加
  └─ Orchestrator.arrange() 消耗 ×J     ⏳ 未实装
```

> 注：当前实装中 stateC 记录在"HarmonyCore 入口"（即 Stage 3 之前），与文档原"Stage 4 入口"位置略有偏差，是因为 Stage 4 暂跳过。Stage 4 上线时要决定 stateC 的最终归位（建议保留在 Stage 4 入口，Stage 3 内部再加 stateC' 子快照）。

**验证义务**（每次修改生成代码后）：
1. **PRNG 消耗一致性**：同 seed 下各快照 state 值不变（除非你**有意**改了消耗次数，那么所有下游快照重新录制）
2. **输出等效性**：同 seed + 同输入 → ArrangedTrack 逐字段匹配
3. **模块隔离**：`setState(recorded_stateC)` + 预录输入 → 复现 HarmonyCore 输出

跑 `npx tsx scripts/test-harmony-core.ts` 看 HarmonyCore 三风格 seed=12345 的预期输出（罗马数字 / voicing / unique PC 桶 / bass root 命中率）。

---

## 11. 重构推进路线（建议顺序）

> 一步一步来，每步都能跑通 + 听感验证，不要一次性写完五个阶段。

### ✅ Step 1 — Stage 2 BPM + Stage 3 HarmonyCore + AudioEngine 临时端到端（**已完成**）

- runPipeline Phase 2.C：Stage 1（选风格）+ Stage 2（BPM only）+ Stage 3（HarmonyCore 完整推演 + voicing）
- HarmonyCore 完整实装：Markov + Voice Role × Chord Tone 二维 base score + PC diversity + 倾向音解决 + 平行 5/8 + 大跳 + Bass octave 分区
- 3 风格 config/styles 配置（matrix + start weights + VL）
- 3 个 Impro-Visor 移植 primitives
- AudioEngine.expandVoicingsToNoteData 临时做 K-2 转换
- PlaybackEngine + MidiScheduler + SynthManager 全实装最小可听版

### 🚧 Step 2 — Stage 2 完整版（timeSig / tonality / keyOffset / sections）

- 实现 `resolveBasicParams` 完整签名（§5.4）
- 用 FractalStructureEngine 切骨架 → 给每段贴 SectionType + energyLevel + grooveDNA
- 加 stateB2 快照（Stage 2 入口）
- 同步把 StyleRegistry 的 3 风格 `global.{timeSignaturePool, tonalityPool, structureTemplates}` 填充

**验收**：PipelineMonitor Stage 1 Meta 显示真实 BPM/Key/Tonality（不再固定 C）；Stage 3 段落能量条非均匀。

### 🚧 Step 3 — Orchestrator + Bass + Drums + Texture

- 实现 `Orchestrator.arrange()` — 接管 K-2 转换、ArrangedTrack 拼装
- BassIdiom：根音 + 五度辅助 + WalkingBass（Jazz）+ 物理音域 fold [28, 47]
- 和弦织体 TextureMapper：Block / Arpeggio / Comping（消费 chord.voicing 而非重算）
- DrumPattern 数据驱动（`style.rhythm.drumPatterns` 按能量段查表）
- PlaybackEngine 加 CC7/CC10/CC91 注入 + sidechain CC11

**验收**：浏览器能听到鼓+贝斯+钢琴，Q+H 面板能看到 Ensemble 槽位填满，能 Mute 单轨。

### 🚧 Step 4 — Stage 5 ToplineEngine + 旋律

- 实现 `ToplineEngine.generate(chords, sections, grooveDNA, style)`：
  - 用 PCFGGrammarEngine 拿 TerminalSymbol[]（pitchOffset 序列）
  - chord context 染色：强拍落和弦内音 90%+，弱拍允许 9/11/13
  - 用 WeightedPitchSelector 做 Avoid Notes 过滤
- GlobalReviewer 检查（避免半音 crash 等）

**验收**：旋律出现，强拍和弦内音 + 弱拍 tension 合理，无半音 crash。

### 🚧 Step 5 — Stage 4 ConductorPlan + Persona 招募

- 实现 `EnsembleDrafter.draft(sections, style, prng, forcedBand)`：抽 5 槽位 Persona
- 实现 `ConductorPlanner.plan(sections, ensemble, style)`：每段决定 focus/support/silent/rhythmCenter
- `MusicianRegistry.assembleActiveIdiom(musician, slot)`：Persona → LeadIdiom + CompingIdiom 派生
- Orchestrator 消费 `conductorPlan.silentInstruments` 硬约束
- 加 stateD 快照

**验收**：Q+H 面板 BandSelection 选 Marcus 当 Lead → 出 EPiano 大量切分；选 Nina → 出钢琴轻触 jazz comping；不选则随机。

### 🚧 Step 6 — 黄金种子验证 + ESP32 同步

- 恢复 `SongComparisonLogger` 完整统计
- 跑 `npm run golden-seed` 录制 4 个 seed（12345 / 99999 / 42 / 7777777）的快照
- 用 `python3 scripts/json2c.py` 生成 C 头文件
- 跑 C 侧 `tests/test_ar4_e2e.c` 验证 PRNG 逐位精确 + pitch 逐个匹配 + tick ±1 容差

---

## 12. 验证与调试

### 12.1 Q+H 调试面板

在 Web 上按 **Q+H** 唤出 PipelineMonitor：

- **Seed Lab**：手动输入种子 → Play → 复现任意一首歌
- **BandSelection**：5 个 RoleType 下拉（Vocal/MainInst/AccompInst/Bass/Drums），可手选乐手强制 forcedBand 注入（Stage 4 上线后真正生效；目前是占位 UI）；不选则 PRNG 抽
- **Stage 01 Meta**：BPM/Key/Tonality/StyleName
- **Stage 02 Harmony**：滚动显示窗口和弦（含 voicing PC names）
- **Stage 03 Structure**：段落能量条
- **Stage 04 Ensemble**：乐手花名册 + 单轨 Mute 按钮（Stage 4 上线后生效）

每写完一个 Stage 都来这里看一眼。

### 12.2 HarmonyCore 脱机测试

```bash
npx tsx scripts/test-harmony-core.ts
```

固定 seed=12345，三风格各跑 4 段 × 4 和弦 = 16 chord，打印：
- 罗马数字 numeral + (root, quality)
- voicing：4 voices 升序，按相对空间 MIDI 转 pitch class 名
- sanity check：voicings 升序 / 在 voiceRange 内 / unique PC 桶 / sparse voicing 数 / bass root 命中率

修改 HarmonyCore 或 StyleConfig 后必跑。

### 12.3 比对日志模式

`localStorage.setItem('AF_COMPARISON_LOG', '1')` + 可选 `AF_COMPARISON_SEED` 后刷新页面。AuraRadio 会用固定 seed 12345 生成并 console.log 完整比对日志（META / TRACKS / STRUCTURE / MELODY STATS / HARMONY）。SongComparisonLogger 完整实装在 Phase 6。

### 12.4 命令

```bash
npm install            # 装依赖
npm run dev            # 启动开发服务器 :3000
npm run lint           # tsc --noEmit 类型检查
npm run build          # 生产构建
```

项目级 slash command：
- `/dev` — 启前端 + 杀 3000 端口 + 后台挂起
- `/save [msg]` — git add + commit + pull + push 一条龙
- `/tag <ver> <desc>` — 给当前 HEAD 打 annotated tag
- `/goto [tag]` / `/home` / `/reset-to <tag>` — git 历史导航三件套

### 12.5 黄金种子

固定 seed=12345，跑完整管道，序列化输出，与 C 端逐字节比对。允许：
- PRNG state：`uint32_t` 逐位精确
- pitch：逐个匹配
- 时间：`beat × 4 ≈ tick`（±1 tick 舍入）

---

## 13. 常见陷阱（你大概率会踩）

1. **`Math.random()` 漏网** — 任何随机决策都走 PRNGManager。CI 没有自动 lint，自己审。
2. **遗漏 PRNG 消耗** — Lead 在场时跳过抽 styleId，但 `recordSnapshot('B')` 之后必须**仍消耗 1 次 PRNG**，否则下游 stateC/D 全错位。
3. **Pitch Space 混用** — HarmonyCore 输出的 voicing 是 RELATIVE。**唯一 K-2 转换点**目前在 `AudioEngine.expandVoicingsToNoteData`，将来转移到 `Orchestrator.applyOffset()`。HarmonyCore / primitives / TextureMapper / ToplineEngine 全部禁止在返回 pitch 中包含 keyOffset。
4. **段落键大小写** — `style.harmony.major` 用小写键（`'verse'`），段落 name 用 `'Verse_1'`。HarmonyCore 用 `section.sectionType`（数值枚举）而非 name 字符串匹配，已合规 T-1。
5. **数组并行写入** — 多轨 NoteData[] 排序时务必稳定（onset → pitch 二级 key）。
6. **闭包捕获循环变量** — `for (let i = 0; ...)` 内 push 函数引用 `i` 是禁止的（S-6）。
7. **`section.name.includes('Chorus')`** — 禁用！用 `section.sectionType === SectionType.Chorus`（T-1）。AuraJam Jam 模式有遗留 includes，那是平台层 jam logic，不在管道内。
8. **MidiConverter 消耗 PRNG** — 禁止！只生成管道前四阶段可消耗，Orchestrator 也消耗，MidiConverter 必须确定性纯转换（D-5）。
9. **Primitive 误用** — WeightedPitchSelector 的 `pitchSpaceSize` 决定空间含义（12 = RELATIVE pc / 128 = ABSOLUTE / 任意正整数）。HarmonyCore 用的是 `cfg.voiceRangeHi + 1`（小区间相对空间）；旋律 / Orchestrator 用时按需选 128。
10. **`reset()` vs `new`** — HarmonyCore 复用单个 selector，每个 voice 抽样前 `selector.reset()` + 重新 seed。**不要**每 voice 都 `new WeightedPitchSelector()`，那是浪费。
11. **K-2 转换点搬迁时** — 把 `AudioEngine.expandVoicingsToNoteData` 的 `+ keyOffset` 行（行 61）搬到 `Orchestrator.applyOffset()`时，确保 AudioEngine 里这个临时函数被**整体删除**而不是留着，否则会出现"双重偏移"bug。

---

## 14. 还有这些资源可用

| 文件 | 用途 |
|---|---|
| `.claude/rules/music_generation_pipeline_rule.md` | 最高约束完整版 — 必读 |
| `.claude/rules/music_domain_knowledge.md` | 乐理 + 编曲规则 — 修生成逻辑时自动加载 |
| `docs/ALL_SOURCE_CODE.md` | 5227 行参考架构源码（旧版完整 dump）— **数据契约层不照抄，模块组织可参考** |
| `docs/ImproVisor_Core_Export.md` | **Impro-Visor 三件套 primitives 的 Java 原型参考**（VoicingGenerator / Grammar / Fractal） |
| `docs/esp32_porting.md` | ESP32 移植细节 + HAL 映射 + 预分配 buffer 大小 |
| `docs/music_engine_audit_standard.md` | 十维审计标准（PR 合并前自查清单） |
| `docs/SONG_COMPARISON_LOG_SPEC.md` | 黄金种子比对日志的输出格式规范 |
| `docs/todo_plan.md` | C 端移植 Phase 0-6 进度 |
| `docs/framework_alignment.md` | 框架对齐状态（旧/新接口对照） |
| `docs/audits/2026-04-15_pr7_baseline_audit.md` | 一次完整审计的样板（你重构完后照样做一次） |
| `CHANGELOG.md` | 版本变更记录 |
| `scripts/test-harmony-core.ts` | HarmonyCore 脱机听感/视觉验收 |

**有事先翻这些文档，再翻 git log，最后才打开历史源码 dump。**

---

## 15. 给工程师的最后一句话

这个项目把"做音乐"和"做嵌入式音乐"硬塞到了同一份算法里。你写的每一行 TS 代码，将来都要变成 C，跑在 ESP32 的 512KB SRAM 里。**所以请假装你在写 C：用数组不用 Map，用 enum 不用字符串，用 epsilon 不用 ===，用 PRNG 不用 Math.random。**

当前已经把和声引擎落地，三风格能听到完整的 4-voice block voicing。剩下的工作是把 Stage 2 完整版、Stage 4/5、Orchestrator、Bass+Drums Idiom 写出来，把和声以外的元素加回去。primitives 三件套是你的乐高积木 — 旋律用 PCFGGrammarEngine，节奏切骨架用 FractalStructureEngine，pitch 选择全部走 WeightedPitchSelector，不要重写它们。

有歧义优先看 Pipeline Rule，再看 ALL_SOURCE_CODE.md 看参考架构是怎么写的，最后看 git log 看上一版做了什么决策。

祝重构愉快。
