# AuraFlow Tap! — 测试工程师集成手册

> 面向 QA / 测试工程师的端到端说明：UI 交互、组件耦合、音频管道、音乐生成引擎拓扑，以及每一处可观察的输入/输出。
> 配套源码：`src/`、`public/GM128_3MB.sf2`、`.claude/rules/music_generation_pipeline_rule.md`。
> 阅读顺序建议：§0 启动 → §1 文件树 → §2 系统拓扑 → §3 UI → §4 音频 → §5 生成引擎 → §6 调试入口 → §7 测试场景。

---

## 0. 启动与运行环境

| 项 | 值 |
|---|---|
| Node | 任意 LTS（推荐 ≥18） |
| 端口 | `3000`（Vite dev server，`0.0.0.0` 绑定） |
| 入口 HTML | `index.html` → `src/main.tsx` → `src/App.tsx` |
| 必备资源 | `public/GM128_3MB.sf2`（SoundFont，3 MB GM128 全套音色） |
| 环境变量 | `.env.local` 中 `GEMINI_API_KEY`（当前业务路径未真正调用，缺失不影响生成与播放） |
| 浏览器 | Chrome / Edge / Safari 最新版（必须支持 `AudioWorklet`） |
| 启动命令 | `npm install` → `npm run dev` |
| 类型检查 | `npm run lint`（`tsc --noEmit`，无运行时测试框架） |

**首次音频触发**：`AudioContext.resume()` 需用户手势。任何 pad 触摸/键盘按键/旋转选单确认都会调 `startAudioContext()`，第一次会异步加载 SF2 并注册 AudioWorklet processor。SF2 加载失败时 `spessaSynth = null`，播放静音但 UI 不报错。

---

## 1. 文件树状图（仅保留参与运行/生成/播放/UI 的关键文件）

```
auraflow_music_game_console_simulator/
├─ index.html                          Vite 入口
├─ src/
│  ├─ main.tsx                         React 挂载根
│  ├─ App.tsx                          顶层布局：屏幕 + 5×3 触控垫 + LED 矩阵
│  │
│  ├─ system/
│  │  ├─ AuraSystem.tsx                系统菜单（APP 选择/滑动手势/琶音预览）
│  │  └─ SystemAudio.ts                系统级音效（菜单确认、kick 反馈）
│  │
│  ├─ apps/
│  │  ├─ AppRegistry.tsx               APP 注册表（AuraBar / AuraJam）
│  │  ├─ AuraBar/
│  │  │  ├─ index.tsx                  Bar UI：7 家酒吧轮播、播放/Jam 状态机
│  │  │  ├─ BarData.ts                 7 家酒吧 × 风格池映射
│  │  │  └─ EndlessRadioManager.ts     无尽电台：风格池抽风格 → 调引擎 → 调度
│  │  ├─ AuraJam/
│  │  │  ├─ index.tsx                  Jam UI：音阶视图/录音/播放/Jam 模式
│  │  │  ├─ JamSessionManager.ts       Jam 状态机（SCALE_VIEW…JAMMING_*）
│  │  │  ├─ ScaleEngine.ts             随机 key×tonality → 14-note pad 映射
│  │  │  ├─ MotifRecorder.ts           动机录制 → NoteData[] (假定 BPM 120)
│  │  │  └─ MotifPreprocessor.ts       动机质量分析 + 角色分类
│  │  └─ AuraRadio/                    (旧 APP，目前 AppRegistry 未注册)
│  │     ├─ index.tsx
│  │     └─ EndlessRadioManager.ts
│  │
│  ├─ components/
│  │  ├─ PipelineMonitor.tsx           Q+H 调试面板：Seed Lab + 段落/和弦/乐器实时
│  │  ├─ VolumeController.tsx          Q+E 混音器：音量/EQ/混响/压缩/LoFi 开关
│  │  ├─ PixelIcon.tsx / PixelGrids.ts 像素图标
│  │
│  ├─ core/
│  │  ├─ hal/
│  │  │  ├─ IHardware.ts               HAL 接口：ILedMatrix/ITouchPad/IAudioOut/ISystemTimer
│  │  │  └─ WebSimulatorHAL.ts         Web 端 stub 实现（实播仍走 AudioEngine 直连）
│  │  ├─ hardware/
│  │  │  ├─ LedMatrix.tsx              15×9 LED 扩散场（粒子/触控轨迹/FN 呼吸）
│  │  │  └─ TapArea.tsx                5×3 触控网格：键盘 + 鼠标 + 多点触摸
│  │  ├─ audio/
│  │  │  ├─ AudioEngine.ts             单例：playSong / mute / visual 事件分发
│  │  │  ├─ PlaybackEngine.ts          ArrangedTrack → MidiConverter → scheduler
│  │  │  ├─ MidiConverter.ts           ArrangedTrack → MidiEvent[]（CC + noteOn/Off）
│  │  │  ├─ MidiScheduler.ts           5ms tick 轮询；派发到 SpessaSynth + 视觉
│  │  │  └─ SynthManager.ts            SpessaSynth WorkletSynthesizer 生命周期
│  │  ├─ generation/                    ★ 纯生成管道（必须 100% 平台无关）
│  │  │  ├─ types.ts                   全部数据契约 + Tonality/ChordQuality/SectionType 枚举
│  │  │  ├─ MelodyEngine.ts            生成入口 stub → 转发 runPipeline
│  │  │  ├─ GlobalContext.ts           兼容老接口的少量全局态（生成不依赖）
│  │  │  ├─ pipeline/
│  │  │  │  ├─ index.ts                runPipeline:Stage1选风格→Stage2参数→Stage3HarmonyCore→Stage5层叠
│  │  │  │  ├─ HarmonyCore.ts          和弦进行 + Voice Leading（共同音/倾向音/平行5/8 度）
│  │  │  │  ├─ MacroProgressionEngine.ts 代数推演 T-S-D 马尔可夫 + 4 变异门
│  │  │  │  ├─ Stage5Layering.ts       Bass / Accomp / Drums / Lead 四轨织体
│  │  │  │  ├─ ToplineEngine.ts        Lead 旋律 pitch 实例化 + 智能踏板 Pass 3
│  │  │  │  └─ Orchestrator.ts         RELATIVE → ABSOLUTE 唯一加 keyOffset 处
│  │  │  ├─ primitives/                Stage5 子算法（无风格知识）
│  │  │  │  ├─ WeightedPitchSelector.ts 权重 pitch 抽样核心
│  │  │  │  ├─ RhythmMutator.ts         Comping 节奏 grid 生成
│  │  │  │  ├─ TextureMapper.ts         voicing × grid → NoteData[]
│  │  │  │  ├─ FractalStructureEngine.ts 段落分块（树深度 3）
│  │  │  │  ├─ PCFGGrammarEngine.ts     Lead 抽象 terminal 展开
│  │  │  │  ├─ BassIdiom.ts             Bass 渲染（Layer 1：root anchor + 长和弦补击）
│  │  │  │  ├─ DrumIdiom.ts             16-step 鼓机（gate PRNG 无条件 ×3/step）
│  │  │  │  ├─ TopologyMutator.ts       倒影/逆行/侧滑动机变异
│  │  │  │  └─ SyncopationEvaluator.ts  切分度评估
│  │  │  ├─ config/
│  │  │  │  ├─ StyleFlags.ts            StyleId 枚举（ModernPop/ChillJazz/NeoSoul）
│  │  │  │  ├─ StyleRegistry.ts         StyleId → StyleConfig 注册表
│  │  │  │  └─ styles/{ModernPop,ChillJazz,NeoSoul}.ts 各风格 harmony/Stage5 bundle
│  │  │  └─ idioms/MusicianRegistry.ts  Persona/Musician 池（当前 stub 池为空）
│  │  ├─ utils/
│  │  │  ├─ PRNG.ts                    LCG（a=1664525,c=1013904223）+ 快照 A/B/C/D
│  │  │  └─ TrackSerializer.ts         扁平内存 dump（C 移植用）
│  │  └─ storage/SongStorage.ts        stub（未启用持久化）
│  └─ vite-env.d.ts
│
├─ public/
│  ├─ GM128_3MB.sf2                    SoundFont (必备！)
│  └─ assets/barImg/*.png              7 家酒吧封面
│
├─ scripts/                             离线工具（QA 通常不直接用）
│  ├─ prng-verify.ts                   黄金种子 PRNG 一致性验证
│  ├─ test-{harmony-core,phase4,phase5,stage5,texture}.ts
│  ├─ compile-grammars.mjs             Impro-Visor 语法离线编译
│  └─ export-workspace.js              全代码导出
│
├─ docs/
│  ├─ esp32_porting.md                 ESP32 移植细节
│  ├─ todo_plan.md                     TS→C 路线图
│  └─ framework_alignment.md
└─ .claude/rules/
   ├─ music_generation_pipeline_rule.md ★ 管道最高约束（44 条规则）
   └─ music_domain_knowledge.md         音乐领域知识
```

---

## 2. 系统拓扑（一图速览）

```
键盘 / 鼠标 / 触摸
       │
       ▼
┌──────────────────┐
│ TapArea (5×3)    │  KEYBOARD_MAP: q w e r t / a s d f g / z x c v b → (c, r)
└────────┬─────────┘  特殊键 (4, 0) = FN
         │ activeKeys: Set<"key-c-r">
         ▼
┌──────────────────┐     双向广播
│ App.tsx          │ ──────────► LedMatrix (15×9 视觉)
│ deviceState:     │ ◄────────── VolumeController (Q+E)
│   SYSTEM_MENU    │ ◄────────── PipelineMonitor (Q+H)
│   app-aura-bar   │
│   app-aura-jam   │
└────────┬─────────┘
         │ activeKeys 透传
         ▼
┌─────────────────────────────────────┐
│ AuraSystem | AuraBar | AuraJam      │  应用状态机 + 手势识别
└────────┬────────────────────────────┘
         │ trigger
         ▼
┌─────────────────────────────────────┐
│ EndlessRadioManager / JamSession    │  ① setSeed(timestamp)
│                                     │  ② runPipeline / MelodyEngine.generateFullSong
│                                     │  ③ AudioEngine.playSong
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ Generation Pipeline (5 stages)      │  Stage1 风格 → Stage2 参数
│   RELATIVE pitch space              │  Stage3 HarmonyCore → Stage5 四轨织体
└────────┬────────────────────────────┘
         │ GeneratedTrack + MusicContext
         ▼
┌─────────────────────────────────────┐
│ Orchestrator.arrange                │  K-2 唯一加 keyOffset 处
└────────┬────────────────────────────┘   RELATIVE → ABSOLUTE
         │ ArrangedTrack
         ▼
┌─────────────────────────────────────┐
│ PlaybackEngine.loadSong             │  内部调 MidiConverter.convert
└────────┬────────────────────────────┘
         │ MidiEvent[]
         ▼
┌─────────────────────────────────────┐
│ MidiScheduler (5 ms tick)           │  按 ticks 派发到 SpessaSynth
└────┬───────────────────────┬────────┘
     │ MIDI                  │ visual
     ▼                       ▼
SpessaSynth (SF2)        AudioEngine visualListener
     │                       │
     ▼                       ▼
   扬声器                  LedMatrix 粒子 / Q+H 面板
```

---

## 3. UI 操作逻辑

### 3.1 输入抽象（`src/core/hardware/TapArea.tsx`）

- 真实物理：3 行 × 5 列 = 15 颗压力垫；坐标 `(c, r)`，`c ∈ [0,4]`，`r ∈ [0,2]`。
- 键盘映射（开发态最常用）：
  - 顶行 r=0：`Q W E R T` → c=0..4
  - 中行 r=1：`A S D F G`
  - 底行 r=2：`Z X C V B`
- 鼠标：单击/拖拽（按住进入相邻 pad 自动注册 down/up）。
- 多点触摸：`onTouchMove` 跟踪每根手指的 pad ID，跨 pad 移动会自动 noteOff/noteOn。
- 上抛事件：`onKeyDown(c, r) / onKeyUp(c, r)`，App.tsx 维护 `activeKeys: Set<"key-c-r">`。
- **FN 键固定为 `(4, 0)`**（顶行最右）。

### 3.2 LED 矩阵（`src/core/hardware/LedMatrix.tsx`）

- 15 × 9 = 135 灯，每颗用 CSS 变量 `--touch-intensity` + `--touch-hue` 双 buffer 扩散更新（60 fps）。
- 三种输入源：
  1. **触控**：当前 `activeKeys` 注入能量场，形成"流体拖尾"。
  2. **音频可视化事件** (`VisualEvent`)：由 `AudioEngine.emitVisualEvent` 或 MidiScheduler 派发；类型枚举：
     `melody / pianoLH / pianoRH / drums / bass / counterMelody / confirm / custom_particle / fn_key_active`。
  3. **FN 激活态**：右上 3×3 区块七彩呼吸；由 `AuraBar` 在 `appState !== IDLE/GENERATING` 时打开。

### 3.3 三大手势（在 AuraSystem / AuraBar / AuraJam 中实现）

| 手势 | 检测窗口 | 判定 | 触发回调 |
|---|---|---|---|
| 单击 | 短按 < 1200 ms | `noteOn` → `noteOff` | 听音 / 加入旋律 |
| 双击 | 同一 pad、间隔 < 300 ms | `tapCount=2` | 确认 / 进 Bar / 下一首 |
| 三击 | 同一 pad、间隔 < 300 ms | `tapCount=3` | 退出 / 停止 |
| 滑动 | 任意 pad、500 ms 内 `|Δc| ≥ 1` | 速度 > 15 → 移 2 格，否则 1 格 | 切换菜单/轮播项 |
| 长按 | 同一 pad ≥ 1200 ms（系统琶音）/ 500 ms（FN+Q/W 进 Jam） | timeout 触发 | 进 Jam / 系统琶音 |

### 3.4 三个应用各自的状态机

#### AuraSystem（系统菜单 `deviceState = 'SYSTEM_MENU'`）
状态简单：左右滑动切 APP（双击进入）。三击 = `G3-Bb3-D4` 报警和弦（取消）。长按 1.2s 触发**系统琶音模式**：5 度五声音阶上下行 16 分。

#### AuraBar（`src/apps/AuraBar/index.tsx`）
状态机：
```
IDLE ──双击──► GENERATING ──pipeline 完成──► PLAYING
   ▲                                           │
   └──三击──────────────────────────────────────┘
                                               │
                                  FN + (Q/W) 长按 500 ms
                                               │
                                               ▼
                                       PREPARING_JAM
                                               │ count-in 1 小节 (Crash + Kick + 16分军鼓滚奏)
                                               ▼
                              JAMMING_DRUMS  /  JAMMING_MELODY
                                               │
                                          再按 FN 退出 → PLAYING
```
- 启动时：PRNG 随机决定显示 1~7 家酒吧。
- IDLE 滑动选 bar；双击 → `EndlessRadioManager.setAllowedStyles(bar.styleIds)` + `triggerGeneration()`。
- PLAYING 期间双击 = 下一首；三击 = 停止回 IDLE。
- JAMMING_DRUMS：15 颗 pad 映射为 GM 鼓组（见 `DRUM_MAP`），录制 16 分量化 pattern，退 Jam 时整段 loop 直到曲终，并按 section.energy 动态调整 velocity。
- JAMMING_MELODY：14 颗 pad（除 FN）= 当前和弦相关的五声音阶 14 个音；按住自动展开琶音 pattern（180 ms 步进，四种 pattern 随机切换）。

#### AuraJam（`src/apps/AuraJam/index.tsx`）
状态机：
```
SCALE_VIEW ──FN 单击刷新音阶
       │
       │ FN 双击
       ▼
   RECORDING ──FN 双击──► GENERATING ──► PLAYING
       │  3×FN 取消         │              │
       └──────► SCALE_VIEW◄─┘              │
                                           │ FN+Q/W 500ms
                                           ▼
                                    PREPARING_JAM → JAMMING_*
                                           │ FN → 退 Jam
                                           ▼
                                       PLAYING
```
- SCALE_VIEW：14 颗 pad = `ScaleEngine` 抽到的 key×tonality 的 14 个音阶音，单击试听（音色固定 GM Acoustic Grand）。
- RECORDING：边弹边录，`MotifRecorder` 假设 BPM=120 把毫秒转拍，noteOn/noteOff 配对成 `NoteData[]`。
- GENERATING：用户动机减去 `keyOffset` 转 C-relative → `MotifPreprocessor` 质量分析 + 角色判定 → `MelodyEngine.generateFullSong(随机 StyleId, { processedUserMotif, motifRole, userMotifRoot, detectedTonality })`。
- 三击 FN 在 SCALE_VIEW 时 = 退出 APP；PLAYING 时 = 停止。
- Jam 子状态与 AuraBar 完全等价（统一交互词典）。

### 3.5 全局浮层（任意状态可调）

| 浮层 | 唤出 | 文件 | 用途 |
|---|---|---|---|
| Pipeline Monitor | `Q + H` 同时按下 | `src/components/PipelineMonitor.tsx` | Seed Lab + 段落/和弦/乐器实时监控 + BandSelection 强制乐手 + 单轨 Mute |
| Volume Controller | `Q + E` 同时按下 | `src/components/VolumeController.tsx` | Master / Melody / Piano LH / RH 推子 + EQ + 混响 + 压缩 + LoFi 开关 |

⚠️ 当前 Mixer 的 EQ/混响/压缩参数只写入 `mixerState` 对象，**未真正接入信号链**（`PlaybackEngine.setMixerParam` 是 stub）；Volume 推子同理。只有 `AudioEngine.muteChannel` 与 `setPartMute` 是真生效的（走 `MidiScheduler.muteChannel`）。

---

## 4. 音频管道（信号流 + 组件接口）

### 4.1 信号流

```
AudioEngine.playSong(track, styleId, context, melodyEngine)
   │
   ├─ startAudioContext()          ※ 用户手势触发，加载 SF2 + AudioWorklet
   ├─ Orchestrator.arrange(track, styleId, context)
   │     │ K-2：melody/accompaniment/bass 全部 + keyOffset
   │     ▼  drums 跳过（GM Drum Map）
   │  ArrangedTrack { melody, pianoRH(=accomp), pianoLH(=bass), drums, ... }
   │
   ├─ PlaybackEngine.loadSong(arranged)
   │     │
   │     ▼
   │  MidiConverter.convert(arranged)
   │     │  四轨遍历 → 每轨 tick 0 写 4 个 setup 事件（programChange + CC7/CC10/CC91）
   │     │           每个 NoteData 拆 (noteOn @ round(onset×480), noteOff @ round(end×480))
   │     │  最后稳定排序：ticks ASC → priority (programChange < cc < noteOff < noteOn < pitchBend < visual)
   │     ▼
   │  MidiEvent[]
   │
   ├─ globalMidiScheduler.loadTrack(events, bpm)
   └─ playback.play() → scheduler.start()
        │
        ▼
   setInterval(tickLoop, 5 ms)
        │ currentTick = startTick + elapsed × bpm / 60 × ppq
        │ while events[i].ticks ≤ currentTick: dispatch
        │
        ├─ noteOn/noteOff/cc/programChange/pitchBend → spessaSynth.*
        ├─ visual events → visualListeners → AudioEngine 转发 → LedMatrix / Q+H 面板
        └─ 全部 fire 完毕 → 200 ms trailing silence → onTrackEnd callbacks → stop()
```

### 4.2 通道映射（`MidiConverter.ts` / `PlaybackEngine.ts`）

| Part | Channel | GM Program | Mix CC7/Pan/Reverb |
|---|---|---|---|
| melody (Lead) | 1 | 1 (Bright Acoustic) | 122 / 74 / 70 |
| pianoRH (Comping) | 4 | 0 (Acoustic Grand) | 102 / 64 / 50 |
| pianoLH (Bass) | 5 | 33 (Electric Bass) | 57 / 64 / 0 |
| drums | 9 | 0 (GM 鼓固定) | 102 / 64 / 25 |
| vocal | 0 | — | (当前未渲染) |
| counterMelody / secondaryMelody / userMotif | 3 / 2 / 6 | — | (当前未渲染) |

### 4.3 关键 API（测试用，单例 `AudioEngine`）

| 方法 | 作用 | 触发点 |
|---|---|---|
| `playSong(track, styleId, ctx, gen)` | 一次完整播放（arrange → load → play） | EndlessRadioManager / JamSession / PipelineMonitor |
| `stop()` | 停止调度 + 清当前 arranged | 三击退出 / Home 圆按 |
| `getCurrentArrangedTrack()` / `getCurrentContext()` | 监控面板拉数据 | PipelineMonitor RAF |
| `getCurrentBeat() / getCurrentTick() / getBpm() / getPpq()` | 实时位置 | PipelineMonitor + Jam mode 对齐 |
| `muteChannel(ch, mute) / setPartMute(name, mute)` | 单轨静音 | Q+H 面板 / Jam mute 主旋律 |
| `injectMidiEvent(ev) / replaceChannelEvents(ch, start, evs, end?)` | 运行时编辑事件流 | Jam mode count-in / 用户鼓 loop 注入 |
| `emitVisualEvent({ type, midiNote, velocity, ... })` | 直接喷视觉粒子 | 用户按 pad 时产生 gameplay 视觉 |
| `addVisualListener(fn) / addRawVisualListener(fn)` | 订阅视觉事件 | LedMatrix |

### 4.4 HAL 现状（`src/core/hal/`）

接口定义齐备（`ILedMatrix / ITouchPad / IAudioOut / ISystemTimer`），但 Web 端 `WebSimulatorHAL` 是占位 stub —— 真实播放仍由 `AudioEngine` 直连 SpessaSynth；触控由 `TapArea` 直接走 React 事件。HAL 仅作为 ESP32 端 C 实现的接口锚点存在。

---

## 5. 音乐生成引擎管道

### 5.1 五阶段拓扑（实现：`src/core/generation/pipeline/index.ts:runPipeline`）

```
PRNGManager.setSeed(seed)
   │  snapshot 'A'（外部播放入口记录）
   ▼
runPipeline({ allowedStyleIds?, forcedStyleId?, forcedBand?, generation? })
   │  snapshot 'B'
   ├─ Stage 1  selectStyle               PRNG ×1  从风格池抽一个 StyleId
   ├─ Stage 2  resolveBasicParams        PRNG ×1  BPM 在 bundle.bpmRange 区间；tonality=Major, keyOffset=0 (当前固定)
   │           sections = [Intro(0-16), Verse(16-32), Chorus(32-48), Outro(48-64)] 占位骨架
   │  snapshot 'C'
   ├─ Stage 3  HarmonyCore.generate      PRNG ~80
   │           ├─ MacroProgressionEngine：T-S-D 3×3 马尔可夫 + 4 变异门
   │           │   (secondaryDominant / tritoneSub / modalInterchange / tensionExtension)
   │           └─ Voice Leading：voiceRoleScoreTable + 共同音/倾向音/平行5/8 度/PC diversity/m9 filter
   │           输出：chords[].voicing 平行索引嵌入 (RELATIVE)
   │  snapshot 'D'
   └─ Stage 5  layerInstruments
                Bass    → BassIdiom.render          ConductorMask 决定段落是否出声
                Accomp  → RhythmMutator + TextureMapper（voicing.slice(1) 去 bass）
                Drums   → DrumIdiom.render          GM Drum Map (Kick=36/Snare=38/Hihat=42)
                Lead    → FractalStructureEngine (深度 3) + PCFGGrammarEngine → ToplineEngine

   返回 { track: GeneratedTrack, context: MusicContext }
```

### 5.2 ConductorMask（段落 → 角色启停）

`Stage5Layering.ts` 内置（与风格无关，纯音乐物理）：

| SectionType | Bass | Accomp | Drums | Lead |
|---|---|---|---|---|
| Intro / Outro / PreOutro | ✅ | ✅ | ❌ | ❌ |
| Verse / PreChorus / Chorus / Bridge / Drop / Solo_Bridge | ✅ | ✅ | ✅ | ✅ |
| BuildUp | ✅ | ✅ | ✅ | ❌ |
| Break / Breakdown | ✅ | ❌ | ✅ | ❌ |

### 5.3 Pitch Space 三空间（K-1 / K-2 / K-8）

| 空间 | 出现位置 | 范围 |
|---|---|---|
| **RELATIVE** | HarmonyCore / Stage5 melody/accomp/bass / chord.voicing | 主音 = 0；MIDI 中心 60 |
| **ABSOLUTE** | Orchestrator 之后（ArrangedTrack / MidiConverter / SpessaSynth） | 加了 `keyOffset` 的真实 MIDI 音高，clamp [0,127] |
| **GM Drum Map** | Stage5 drums → Channel 9 全程透传 | 物理键位 {36,38,42,...}，**禁止**经 Orchestrator |

**唯一转换点**：`Orchestrator.arrange()` → `applyKeyOffset()`。任何其他地方加 keyOffset 都是 bug。

### 5.4 关键数据契约（`src/core/generation/types.ts`）

```ts
NoteData      = { pitch, onset, duration, velocity, ...flags? }
GeneratedChord= { numeral, root(0-11 相对), quality(ChordQuality 枚举), startBeat, endBeat, keyOffset?, voicing?: number[] }
SectionMetadata = { name, sectionType: SectionType, startBeat, endBeat, energyLevel(1-10), grooveDNA? }
GeneratedTrack = { chords, melody, accompaniment, bass, drums, sections, bpm, key, keyOffset, tonality, timeSignature, ... }
MusicContext   = { keyOffset, tonality, bpm, timeSignature, grooveDNA, style?, band? }
ArrangedTrack  = { bpm, key, melody, pianoRH, pianoLH, drums, sections, chords, ... }
MidiEvent      = { ticks(PPQ=480), type: noteOn|noteOff|cc|programChange|pitchBend|visual, channel, data1, data2, visualData? }
```

### 5.5 确定性铁律（影响测试可复现性）

| 规则 | 说明 |
|---|---|
| **PRNG 单例** | 所有随机性走 `PRNGManager`，禁用 `Math.random()`（部分老 UI 代码仍混用，QA 关注复现性时以 `PipelineMonitor` 输入种子为准） |
| **LCG 公式** | `state = (state × 1664525 + 1013904223) % 2³²`；C 端可逐字节复算 |
| **快照点** | A=setSeed 后；B=runPipeline 入口；C=HarmonyCore 前；D=Stage5 前 |
| **同步管道** | 生成全程 `runPipeline` 无 async/Promise；播放才进入异步 |
| **浮点比较 ε ≤ 1e-6** | 拍位、duration、velocity 全部 epsilon 容差 |
| **稳定排序** | 同 tick 内：programChange < cc < noteOff < noteOn < pitchBend < visual |

---

## 6. 调试入口（QA 必备）

### 6.1 Pipeline Monitor（Q+H）

- **Seed Lab**
  - 文本框输入任意 uint32 seed → `Play` 跑 `runPipeline({ forcedBand })` 并循环播放（曲终自动重播同 seed）
  - `Random` 用 `Date.now() ^ PRNG×1e6` 重新填种子
  - `Stop` 调 `AudioEngine.stop()` 回 IDLE
- **BandSelection**：5 个下拉对应 RoleType（Vocal/MainInst/AccompInst/Bass/Drums），不选 = PRNG 抽（当前 stub MUSICIAN_POOL 为空，所有下拉只有 "🎲 Random"）。
- **实时帧**（RAF 60 fps）：
  - Stage 01 Meta：BPM / Key / Tonality / StyleName / Seed
  - Stage 02 Harmony：当前播放位置所在 chord（root + quality 转人类记号）
  - Stage 03 Structure：段落能量条 + 当前 sectionIdx
  - Stage 04 Ensemble：花名册（band[] 名字 + 乐器音色） + **单轨 Mute** 按钮（直接驱动 `setPartMute`）
- 拖动条：浮窗自身可拖、可 resize（右下 resize handle）。

### 6.2 Volume Controller（Q+E）

- Master / Melody / Piano LH / RH 推子；Melody/Piano EQ 三段；Master FX（Reverb wet/size、Hall wet/size、Filter、Compressor Threshold/Ratio）；ESP32-S3 LoFi 模式开关。
- ⚠️ **当前仅有 UI 状态**，未连入信号链（详见 §3.5 提示）。

### 6.3 控制台 Log 提示

- `[Radio] New seed: 12345` —— `EndlessRadioManager.triggerGeneration` 打印每首种子
- `[AuraJam] Recording stopped: N notes captured`
- `[Jam Mode] Recorded N notes over M measures.` —— 退出 JAMMING_DRUMS 时
- `[Jam Mode] Generated K new drum events. First few: [...]`
- 生成失败：`Generation failed:` + 异常对象

---

## 7. 推荐测试场景（建议覆盖矩阵）

### 7.1 启动与音频初始化

| # | 步骤 | 期望 |
|---|---|---|
| S1 | 首次打开 → 立即按 `Q` | 无声（AudioContext 未 resume），不报错 |
| S2 | 任意点击屏幕 / 触控 | SF2 异步加载完成后开始能听到声音；DevTools Network 应看到 `/GM128_3MB.sf2` 200 |
| S3 | 拒绝音频权限 / 阻断 SF2 | `spessaSynth` 保持 null，UI 仍可交互，调度器静默 |

### 7.2 系统菜单 (AuraSystem)

| # | 步骤 | 期望 |
|---|---|---|
| M1 | 左右滑动 5 个 pad | 菜单项切换，伴随升降三音"Soul Flourish" |
| M2 | 双击任意 pad | 触发 confirm 视觉 + 退出动画 → 进入选中 APP |
| M3 | 三击 | 取消音效（G3-Bb3-D4），不进入 APP |
| M4 | 长按 1.2s | 系统琶音模式启动，松手 100ms 内停止 |

### 7.3 AuraBar 主流程

| # | 步骤 | 期望 |
|---|---|---|
| B1 | 进入 AuraBar | 显示 1~7 家随机酒吧；列表按名字字母序 |
| B2 | 滑动选 bar → 双击 | GENERATING overlay → 1~2 秒内进入 PLAYING；Q+H 面板看到 styleId 来自 bar.styleIds 池 |
| B3 | PLAYING 期间双击 | 当前曲终止，立即生成下一首（PRNG 重新播种 → 新 BPM/和弦） |
| B4 | 三击 | 停止回 IDLE，音频与视觉立即停 |
| B5 | FN 长按 Q (500ms) | count-in 1 小节后进入 JAMMING_DRUMS；红色边框闪烁；FN 键 LED 七彩呼吸 |
| B6 | JAMMING_DRUMS 弹任意 pad | 触发 GM 鼓声 + 蓝色波浪视觉；动作被量化到 16 分 |
| B7 | 再按 FN | 进入 PLAYING；之后的鼓轨被你录的 pattern loop 替代，并按 section.energy 自动调强度 |
| B8 | FN 长按 W → JAMMING_MELODY | 原 melody 轨被 mute（ch0）；14 pad 演奏当前和弦的五声音阶 |
| B9 | JAMMING_MELODY 按住任意 pad | 自动展开琶音 pattern（180ms 步进，pattern 每 8 步随机换） |

### 7.4 AuraJam 录制流程

| # | 步骤 | 期望 |
|---|---|---|
| J1 | 进入 AuraJam | 居中显示 keyName + tonalityName + 14 个音名；单击任意 pad 听音 |
| J2 | FN 单击 | 音阶刷新（key+tonality 重新随机） |
| J3 | FN 双击进 RECORDING → 弹奏数音 → FN 双击结束 | GENERATING → PLAYING；MotifPreprocessor 把动机注入 ToplineEngine |
| J4 | RECORDING 中三击 FN | 取消录音回 SCALE_VIEW |
| J5 | PLAYING 中 FN+Q / FN+W 长按 | 与 AuraBar B5~B9 行为完全一致 |

### 7.5 调试面板

| # | 步骤 | 期望 |
|---|---|---|
| P1 | Q+H 唤出 Monitor → 输 seed `42` → Play | 当前曲被替换为 seed=42 的曲；BPM/Key/Sections 显示一致 |
| P2 | 同 seed 连按 Play 两次 | 两次播放的 BPM/和弦序列/段落能量**完全一致**（确定性） |
| P3 | 在 Monitor 中单轨 Mute Bass | 调度器立即停止 channel 5；其他轨继续 |
| P4 | Q+E 唤出 Mixer → 拖各推子 | UI 数值变化；当前**实际声音不变**（已知 stub）；mute 例外 |
| P5 | Random 按钮 | 输入框 seed 立即变；Play 后听到全新曲 |

### 7.6 边界 & 异常

| # | 场景 | 期望 |
|---|---|---|
| E1 | 在 GENERATING 期间快速三击 | 当前 generationId 失效 → 不进 PLAYING，直接停 |
| E2 | Jam 模式中切回 SYSTEM_MENU (Home 圆按) | `AudioEngine.stop()` 立即静音；状态回 SYSTEM_MENU |
| E3 | 频繁切换 APP | 不应有残留音符 / 调度器进程；MidiScheduler.panic() 应被触发 |
| E4 | 极小种子 (0, 1) | 仍能正常生成；Stage1 抽风格、Stage2 抽 BPM 不报错 |
| E5 | 极大种子 (2^32-1) | LCG 仍工作（state mod 2^32），生成完整曲目 |
| E6 | AuraJam 录 0 个音直接结束 | 直接回 SCALE_VIEW，不进入 GENERATING |
| E7 | 用户动机超出音域 | 内部 clamp 到 [0,127]；不出现负 MIDI 值 |
| E8 | 切换浏览器标签 → 切回 | setInterval 在后台被节流到 1Hz，回前台后追上；可能听到短暂"加速"补偿（已知限制） |

### 7.7 可观察输出汇总（QA 取证用）

| 指标 | 取数方式 |
|---|---|
| 当前种子 | Q+H 面板 Seed Lab 或 console `[Radio] New seed:` |
| BPM / Key / Tonality | Q+H Stage 01 Meta |
| 当前和弦 | Q+H Stage 02 Harmony（与 `AudioEngine.getCurrentBeat()` 同步） |
| 当前段落 / 能量 | Q+H Stage 03 Structure |
| Mute 状态 | Q+H Stage 04 Ensemble Mute 按钮高亮 |
| 实际 channel/program/CC | `AudioEngine.getChannelEvents(ch)` 在 console 调用 |
| 视觉事件 | `AudioEngine.addRawVisualListener(console.log)` |
| MIDI tick / beat | `AudioEngine.getCurrentTick()` / `getCurrentBeat()` |

---

## 8. 常见误解 & 已知限制

1. **`Math.random()` 仍存在于 UI 层**（AuraBar 选 bar 数量、Jam mode pattern 切换、LED 粒子分布）。这些不影响"生成种子→生成结果"的确定性，但意味着每次进 AuraBar 看到的酒吧数和顺序会变。
2. **Mixer 推子未真生效**（已在 §3.5 / §6.2 提示）。
3. **VolumeController 与 PipelineMonitor 同时按出**：两个浮窗可同时存在，互不影响。
4. **HAL stub**：`WebSimulatorHAL.playNote` 不会真的发声，Web 端音频走 `AudioEngine` 直连。
5. **Stage 2 当前固定 `tonality=Major, keyOffset=0`**（C 大调）。所以同一 styleId 同一 seed 下，所有曲都是 C 大调；只有 BPM 因 seed 不同而变。Tonality 多样化是后续 phase 工作。
6. **MusicianPool 当前为空 stub**：Q+H BandSelection 下拉里只有 "Random"；`band` 字段在 context 中可能是 undefined。
7. **SF2 资源 3 MB**：弱网首加载慢；建议在 HTTP 缓存命中后再测播放延迟。
8. **AuraRadio APP 存在但未注册**（`AppRegistry.tsx` 只列 AuraBar / AuraJam）。
9. **Tempo Curve / Vocal / SecondaryMelody / CounterMelody 当前未渲染**（`MidiConverter` 只渲染 melody/pianoRH/pianoLH/drums 四轨）。

---

## 9. 一键回归参考

```bash
# 启动
npm install && npm run dev
# → 打开 http://localhost:3000

# 在浏览器：
1) Q+H 打开 Monitor
2) 输入 seed=12345 → Play → 记录 BPM / 段落顺序 / 第一段第一拍和弦
3) Stop → 再次输入 seed=12345 → Play → 三项必须 100% 一致（确定性 smoke test）

# 类型检查
npm run lint
```

如需更深层契约说明，参考 `.claude/rules/music_generation_pipeline_rule.md`（44 条硬约束，含 PRNG 消耗序列）和 `CLAUDE.md`（项目架构总览）。
