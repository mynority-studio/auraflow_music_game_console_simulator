# AuraFlow Tap! Ver.7.6 — 项目全面评估报告（历史快照）

> ⚠️ **过期快照（2026-04-17 PRE-V3.5）** — 本评估写于 2026-04-17 上午，基线 commit `e00e929`（PR#12 僵尸代码清理）。当时代码 HEAD 尚未合入 V3.5 RichIdioms（`050b682`）与 idiom systems 文档增强（`8604c5c`）。
>
> 关键已失效结论（详见 `docs/audits/current_state.md` V1.2 基线，原 audit_standard §12，V1.3 已剥离）：
> - §3.3 "缺鼓组 Kick/Snare/HiHat 模式分离" — V3.5 已实装 6 种 DrumIdiom + DrumIdiomRouter
> - §3.4 "Pad / Pulsing 实现不完整" — V3.5 PianoIdiomRouter 5 策略已覆盖
> - §3.5 "平行五八度硬检测缺失" — PR#11 `GlobalReviewer.reviewParallelMotion` 已实装
> - §3.6 "伪侧链实现不完整" — PR#8 已唤醒，默认启用
> - §5 优先级表 P0/P1/P3 多项已完成（鼓组模式分离 / 平行禁忌等）
> - 文件行数与 `file:line` 引用因 V3.5 大量改动而漂移（ToplineEngine 2,644→2,960、Orchestrator 1,293→1,377、`/generation/` 总行数 9,472→~12,001）
>
> 本文件**仅作历史快照保留**，不再随代码维护。新评估以 `docs/audits/current_state.md` 与 memory `project_v35_richidioms_status.md` 为准。

---

> **评估日期**：2026-04-17（V3.5 合并前）
> **评估范围**：工程实现、技术架构、乐理实现、C/ESP32 移植性
> **代码基线**：`e00e929` (PR#12 僵尸代码清理)
> **核心对象**：`/src/core/generation/`（32 个 TS 文件，9,472 行）

---

## 目录

1. [工程实现评估](#1-工程实现评估)
2. [技术架构评估](#2-技术架构评估)
3. [乐理实现评估](#3-乐理实现评估)
4. [C/ESP32 移植性评估](#4-cesp32-移植性评估)
5. [综合改进优先级](#5-综合改进优先级)

---

## 1. 工程实现评估

**约束合规度：~85%（34/40 硬约束合格）**

### 1.1 合格项

| 约束 | 检查结果 | 证据 |
|------|---------|------|
| **D-1 禁止 Math.random()** | ✅ 合格 | `core/generation/` 内 0 处调用，仅平台层（UI/种子生成）使用 |
| **K-2 applyOffset 唯一性** | ✅ 合格 | `Orchestrator.ts:940-941` 是唯一的 keyOffset 加法点，全管道 11 处 keyOffset 引用均合规 |
| **S-5 禁止 React/Web API** | ✅ 合格 | `core/generation/` 零 React import、零 DOM 操作、无反向依赖 |
| **P-1 禁止 Map/Set** | ✅ 合格 | MotifMap（ToplineEngine.ts:23-57）是自定义 C 兼容结构（数组+线性扫描），非原生 Map |
| **L-6 确定性** | ✅ 合格 | ACVE 四点快照已实装，PRNG 消耗序列可验证 |
| **S-4 纯数据输出** | ✅ 合格 | ArrangedTrack/GeneratedTrack 均可 JSON 序列化 |

### 1.2 违规项

#### T-1 字符串分类（8+4 处）— 高优先级

段落分类使用 `sectionName.includes()` 而非 `SectionType` 枚举：

```typescript
// ToplineEngine.ts — 8 处违规示例
L757:  if (sectionName.includes('Verse'))      { ... }
L780:  } else if (sectionName.includes('PreChorus')) { ... }
L1498: if (sectionName.includes('Chorus') && maxPitchBeforeChorus > 0) { ... }
L1950: const isEmotionalCore = sectionName.includes('Intro') || sectionName.includes('Chorus') || sectionName.includes('Outro');
```

乐器分类同样使用字符串匹配：

```typescript
// ToplineEngine.ts — 4 处
L814:  const isVocal = instrumentName.includes('Voice') || instrumentName.includes('Choir');
L2255: if (instrumentName.includes('Lofi_Piano') || instrumentName.includes('Warm_EP')) { ... }
// Orchestrator.ts
L327:  const isPad = palette.counterMelodySound?.includes('Pad');
```

**影响**：脆性（乐器名变更导致逻辑失效）、C 移植困难（strstr 开销高）。已有 `SectionType` 枚举（types.ts:386）和 `InstrumentId` 枚举可替代。

#### C-1/D-4 浮点 === 比较（2 处）— 高优先级

```typescript
// TransitionEngine.ts:243 — 浮点取模直接 ===
if (beat % step === 0) { ... }
// 应改为: if (isOnGrid(beat, step)) { ... }

// ToplineEngine.ts:1611 — 浮点字面量直接 ===
} else if (duration === 0.5 && PRNGManager.next() > 0.8) { ... }
// 应改为: } else if (Math.abs(duration - 0.5) < 1e-6 && ...) { ... }
```

**影响**：JS 中侥幸通过，C float 累加后必定失配。BeatMath 工具库已存在（`isOnGrid()`、`beatEquals()`），应直接使用。

#### S-2 GlobalContext 管道内读取（~15 处）— 中优先级

HarmonyCore 和 ToplineEngine 内部读取 `GlobalContext.currentTonality`、`currentTimeSignature`、`currentMoodId` 等属性：

```typescript
// HarmonyCore.ts — 多处
L511: const isMinorKey = GlobalContext.currentTonality === Tonality.Minor;
L679: const tonality = GlobalContext.currentTonality;

// ToplineEngine.ts — 多处
L403: const beatsPerBar = GlobalContext.currentTimeSignature[0];
L1290: const moodId = GlobalContext.currentMoodId || MoodId.Neutral;
```

**缓解因素**：读取的都是静态样式属性（生成期间不变），不影响确定性。K-5（禁读 `currentKeyOffset`）已严格遵守。但违反 S-2 字面要求，应通过 MusicContext 参数传递消除。

#### T-3 `any` 类型（4 处）— 中优先级

```typescript
Orchestrator.ts:317   let texture: any = "Block";        // 应为 string
Orchestrator.ts:951   const tempoCurves: any[] = [];     // 应为 TempoCurve[]
MelodyEngine.ts:120   let vocal: any[] | undefined;      // 应为 NoteData[] | undefined
GrooveEngine.ts:37    userMotif?: any[]                  // 应为 NoteData[]
```

#### S-7 错误处理不完整 — 低优先级

已有 7 处 throw（ChordScoreTable 校验、Viterbi 容量限制、MelodyEngine 风格验证），但：
- 未定义 Error 子类（如 `StyleConfigError`、`HarmonyError`）
- 缺少前置验证（空和弦数组、无效参数范围）
- 管道入口未统一 try-catch

### 1.3 代码规模与复杂度

| 排名 | 文件 | 行数 | 复杂度 | C 移植评分 |
|------|------|------|--------|-----------|
| 1 | ToplineEngine.ts | 2,644 | 极高（单函数 850 行，Cyclomatic ~80-100） | 6/10 |
| 2 | Orchestrator.ts | 1,293 | 高（线性流程但依赖链多） | 7/10 |
| 3 | HarmonyCore.ts | 1,149 | 中高（纯算法，最适合 C 翻译） | 8/10 |

### 1.4 模块边界

- `core/generation/` 零 React、零 Web API、零 `core/audio` 反向依赖
- 单向依赖拓扑：App → MelodyEngine → 内部管道 → MidiConverter → Scheduler
- 符合 Rule L-1"线性拓扑，禁止跨层调用"

---

## 2. 技术架构评估

**综合评分：8.0/10**

### 2.1 PRNG 确定性（7.5/10）

**实现**：`src/core/utils/PRNG.ts`（83 行）

| 指标 | 值 | 评价 |
|------|-----|------|
| LCG 参数 | a=1664525, c=1013904223, m=2^32 | 标准 Numerical Recipes |
| 周期 | 2^32 (~4.3B) | 音乐生成适足（单曲 <100K 调用） |
| 状态管理 | getState/setState + 四点快照（A/B/C/D） | 优秀，支持模块级隔离验证 |

**精度隐患**：`this.state / 4294967296` 将 uint32 转 float64，低 20 位有效精度丢失。对音高影响 <1 cent（不可感知），但严格逐位比对时需注意 C 侧 `float` vs `double` 差异。

### 2.2 MIDI 调度（8.0/10）

**实现**：`src/core/audio/MidiScheduler.ts`（375 行）

- **双轨制**：Worker + `setInterval`（后台标签页）/ `requestAnimationFrame`（前台）
- **事件队列**：加载时 `sort()` O(n log n)，实时注入 `findIndex + splice` O(n)，轮询执行 O(k)
- **无缝衔接**：`onTrackEnd` 回调 + generationId 防竞态

**缺陷**：
- 无 jitter 补偿，浮点 `deltaTicks = deltaMs / msPerTick` 累积误差，长曲可达 ±10ms
- 建议 C 侧使用整数时钟：`ticks += (uint64_t)deltaMs * ppq * bpm / 60000`

### 2.3 音频引擎（9.0/10）

**实现**：AudioEngine.ts + SynthManager.ts + AudioMixer.ts + PlaybackEngine.ts

- SpessaSynth AudioWorklet 集成完整，SF2 预加载减少启动延迟
- AudioContext 单例 + 用户交互恢复（遵循浏览器沙箱）
- Program Change 符合 GM 规范：CC0 (Bank MSB) + CC32 (Bank LSB) + PC

**混音链路**（AudioMixer.ts）：

```
SpessaSynth → HPF(35Hz) → PeakingEQ(-4dB@250Hz) → HighShelf(-1.5dB@6kHz)
→ LPF(11kHz) → WaveShaper(磁带饱和) → Compressor(-22dB, 2.5:1)
→ MakeupGain(+8dB) → Destination
```

风格预设（Vinyl_Warmth: 6.5kHz LPF + 磁带饱和；Retro_Gadget: 默认温暖复古）。

### 2.4 HAL 抽象（6.5/10）

**接口设计**（`src/core/hal/IHardware.ts`）：

| 接口 | ESP32 映射性 | 问题 |
|------|-------------|------|
| ILedMatrix | ✅ SPI/RMT WS2812 直接映射 | — |
| ITouchPad | ✅ I2C MPR121/CST816S | 回调模式需 FreeRTOS task |
| IAudioOut | ⚠️ 过于高层 | 只有 `playNote`，缺 noteOn/Off/CC 细粒度 |
| ISystemTimer | ✅ xTaskGetTickCount() | — |

**WebSimulatorHAL 实现度 ~60%**：音频方法全空（由 SpessaSynth 外部驱动绕过 HAL），LED 方法空实现。

### 2.5 状态管理（7.0/10）

- EndlessRadioManager：generationId 防竞态 ✅，生成过程同步（无 Worker 中断风险）✅
- **Jam 模式风险**：50ms `setInterval` 轮询 + 浮点 `currentTick` 比较，精度 ±25ms，无超时保护（内存泄漏风险）
- **生成阻塞 UI**：`generateFullSong()` 同步执行 100-500ms，需 Web Worker 解耦

### 2.6 构建与依赖（8.0/10）

核心依赖精简：React 19 + SpessaSynth 4.2 + Vite 6 + TypeScript 5.8。`framer-motion`（~60KB）仅用于 UI 动画，C 移植时可删除。SharedArrayBuffer 跨域隔离头配置正确。

---

## 3. 乐理实现评估

**综合评级：有专业框架，细节有瑕疵**

### 3.1 和声系统 — 有瑕疵

#### Viterbi 动态规划（亮点）

ViterbiChordSelector.ts 实现了多维评分的全局最优和弦选择：

| 评分维度 | 权重 | 说明 |
|---------|------|------|
| topVoice（旋律骨架贴合） | ×3 | 骨架音是否符合和弦色彩 |
| voiceLeading（共同音） | ×2 | 相邻和弦共同音数量（cap=3 防自循环） |
| functional（功能约束） | ×8 | 影子骨架的 T/S/D 一致性 |
| lookAhead 1/2（前瞻） | ×1 | 避免跳到不兼容和弦 |
| complexity（复杂度税） | -1/扩展音 | 控制和弦复杂度 |

**问题**：
1. `W_FUNCTIONAL=8` 权重过高，压制色彩变化，导致"卡在 I-IV-V-vi"经典进行
2. 缺少转位（Inversion）概念，voice leading 仅在 root pitch class 层面计算
3. 共同音上限 cap=3 是治标不治本（应由 repeat penalty 解决）

#### 和弦候选池（28 个候选）

```
自然三和弦（6）：I, ii, iii, IV, V, vi
七和弦扩展（6）：Imaj7, ii7, iii7, IVmaj7, V7, vi7
高级色彩（4）：Imaj9, Cadd9, vi9, ii9
副属（4）：V/V, V/vi, V/ii, V/iii（+2 bonus）
借调（4）：bIII, bVI, bVII, iv（+3 bonus）
减和弦（1）：viidim7
Sus和弦（2）：Vsus4, Isus4
```

**缺失**：
- 三全音替代（Tritone Substitution）
- Neapolitan（bII7）
- V/IV（Secondary Subdominant）
- 副属加权 +2 过低，在 Viterbi 中易被自然和弦挤出

#### Reharmonize 机制

HarmonyCore.ts:962-1149 实现了替换候选池 + 借调约束 + 旋律贴合度评分。

**问题**：
- 借调惩罚 -3 过于保守（现代流行 bVI→IV 进行会被压制）
- 旋律适配仅看 pitch class 是否在和弦内，忽视"哪个音是稳定音"
- 转移评分仅看根音跳跃度，忽视功能连贯性（T→S→D→T）

#### ChordScoreTable（17×12 矩阵）

整体正确，但：
- m7b5 的 b5 评分 -3 过低（作为定义音不应被压制）
- Sus4 的大三度 -3 过于绝对（Lydian 语境下 #11 合法）
- 缺少 Avoid Note 的上下文感知

### 3.2 旋律生成 — 有瑕疵

#### 动机模板系统（亮点）

ToplineEngine 实现了完整的动机变换体系：
- `MotifTemplate`：rhythmOffsets + relativePitches + contour（6 种轮廓）
- 变换操作：Inversion / Retrograde / Augmentation / Switcheroo / Split
- 乐句规划：PhraseGroupPlanner 预计划全曲骨架（AABA/ABAB'/longform）

#### 问题

1. **缺音程跳进规则**：无"跳跃 >8 半音必须反向解决"的约束，可能生成不自然的大跳未解决旋律
2. **乐句终止过于刚性**：GlobalReviewer 一律强制回和弦音，缺"开放乐句"概念（Verse 尾停在 V 上制造推动力）
3. **轮廓过于离散**：仅 6 种（Ascending/Descending/Arch/Bowl/Static/Wandering），缺混合轮廓

### 3.3 节奏/律动 — 有瑕疵

#### GrooveDNA 密度算法

```typescript
// 权重金字塔
Downbeat: 1.0（强拍）
Offbeat:  0.6 + syncopationProb × 0.4（8分反拍）
16分音符: 0.05 + syncopationProb × 0.1（极低）
```

切分收敛 cap：连续 ≤2 个非 downbeat 音符。

#### 问题

1. **缺鼓组模式分离**：Kick/Snare/HiHat 共用单一指纹，真实鼓手逻辑需分层（Kick 强拍+半拍、Snare 2/4 拍、HiHat 持续）
2. **缺 Ghost Note / Flam / Fill**：无鼓组细节装饰
3. **无 Swing/Shuffle timing**：所有音符量化到 0.25 拍 grid，缺 triplet feel
4. **互补权重过极端**：base hit 0.1 vs 非 hit 0.9，导致旋律被迫躲开强拍

### 3.4 编配织体 — 有瑕疵

#### Bass Line

| Pattern | 支持 | 质量 |
|---------|------|------|
| 根音走行 | ✅ | 良好 |
| 五音替代 | ✅ | 中等（hash-based） |
| 经过音/趋近音 | ✅ | 有限（仅 approach note） |
| Walking Bass | ❌ | — |
| Pedal Point | ❌ | — |

**问题**：Bass 音域管理无"下跳限制 > 上跳放松"法则（实际下跳 >7 半音比上跳更刺耳）。

#### 织体切换

框架支持 Block/Arpeggio/Pad/Riff/Pulsing 等类型，但 Pad 和 Pulsing 实现不完整。

#### 能量映射

mixing 参数通过 `EnsembleDraft.mixing` 分配（CC7 volume / CC10 pan / CC91 reverb），有 Vocal 缺失时的 Melody 提升逻辑（+2dB，建议 +3~4dB）。

### 3.5 对位与冲突检测 — 有瑕疵

#### 已实现

- 乐句终止检查：长音非和弦音强制 snap（GlobalReviewer.ts:100-128）
- 强拍冲突修复：小九度检测 + 半音下移
- voicing 选择时的平行运动 soft penalty

#### 缺失

- **平行五八度硬检测**：仅 voicing 候选评分中有 soft penalty，无全局硬规则
- **音域碰撞检测**：仅有"目标音区偏离"的 soft penalty，无声部间合理音域检查
- **和声-旋律一致性**：强制 snap 可能产生"调外避音"（-1 半音后未验证是否在安全音阶内）

### 3.6 混音参数 — 有瑕疵

- CC7/CC10/CC91 框架存在于 MidiConverter
- 伪侧链（CC11 自动化）有设计文档但实现不完整
- 频段隔离依赖 AudioMixer DSP 链（Web Audio BiquadFilter），非 MIDI 层控制
- volume 字段（0-10 范围）到 CC7（0-127）的 mapping 代码未找到

### 3.7 音乐学总评

| 维度 | 适合风格 | 不适合风格 |
|------|---------|-----------|
| 和声 | Pop / EDM（规则严格） | Jazz / R&B（需色彩替代灵活性） |
| 旋律 | 流行歌曲（动机驱动） | 即兴/变奏密集型 |
| 节奏 | 四四拍直拍 | Swing / Shuffle / 复合拍 |
| 编配 | 基础 Band 编制 | 管弦乐 / 电子音乐细节 |

系统能生成"正确但保守"的音乐。Viterbi 和声是最大差异化优势，值得继续深化。

---

## 4. C/ESP32 移植性评估

**整体移植评分：7.6/10（Good with Challenges）**

**目标平台**：ESP32-S3-N8R8（512KB SRAM + 8MB PSRAM），FreeRTOS，TinySoundFont，I2S DAC

### 4.1 移植进度

核心生成管道的 C 翻译已完成（Phase 1-4），剩余是硬件驱动和集成测试：

| 阶段 | 完成度 | 关键产出 |
|------|--------|---------|
| P1 PRNG | ✅ 100% | `ar4_prng.c/h`，3132 测试逐位精确 |
| P2 类型映射 | ✅ 100% | `ar4_types.h`（307 行），8 种 struct |
| P3 逐模块翻译 | ✅ 100% | 风格系统、MelodyEngine、Orchestrator、MidiConverter |
| P4 端到端验证 | ✅ 100% | 4 黄金种子，67 测试通过 |
| P5 平台层集成 | ⚠️ 80% | `ar4_bridge.c/h` 完成，待板测 |

### 4.2 JS 语言特性移植障碍

#### 数组高阶方法（18 处）— 移植难度 Medium

| 文件 | 模式 | 处数 |
|------|------|------|
| RhythmCells.ts | `.filter()`, `.map()` | 3 |
| HarmonyCore.ts | `.map()`, `.sort()` | 4 |
| GlobalReviewer.ts | `.find()`, `.map()` | 4 |
| ToplineEngine.ts | `.findIndex()`, `...spread` | 2 |
| GrooveEngine.ts | `.reduce()` | 4 |
| Orchestrator.ts | `.push(...src)` | 1 |

翻译策略：全部改为手写 `for` 循环 + 预分配 buffer。工时 2-3 天。

#### 字符串操作（13 处）— 移植难度 Medium-Hard

| 文件 | 问题 | 难度 |
|------|------|------|
| **MusicTheoryRules.ts:8-17** | 正则链 `.replace(/maj9\|m7b5\|dim7.../g, '')` | Hard |
| GlobalReviewer.ts:46-72 | 7 处 `.includes()` | Medium |
| HarmonyCore.ts:47-48 | `.substring()`, `.endsWith()` | Easy |
| StructureEngine.ts:36-49 | `.startsWith()` | Easy（可用 enum 替代） |

MusicTheoryRules 正则是最大瓶颈（ESP32 不适合跑 ~50KB 正则库），建议手写 `strstr` 链 + 最长匹配（~500B）。工时 3-5 天。

#### 闭包（3 处，已驯化）

- MotifMap：自定义类（struct array + 线性扫描），直译 C 无障碍
- ViterbiChordSelector `scoreStep`：闭包捕获的全是常量，C 中转 `#define`
- GrooveEngine 权重选择：纯数值累加

#### 好消息

- `?.` 和 `??` 在 `core/generation/` 中 0 处使用
- 解构赋值仅 5 处且在初始化路径
- 无递归、无 async、无高阶函数作为参数

### 4.3 内存模型

#### 运行时内存预算

```
┌─ SRAM（512KB）───────────────────────────────┐
│ FreeRTOS kernel + stacks     100 KB          │
│ 全局常量表（types/config）     35 KB          │
│ Viterbi DP 预分配表            2.5 KB         │
│ 活跃生成 buffer              100 KB          │
│ 剩余可用                    ~275 KB  ✅       │
└──────────────────────────────────────────────┘

┌─ PSRAM（8MB）────────────────────────────────┐
│ StyleRegistry（11 风格）      200-275 KB      │
│ MidiEvent buffer（28K events） 169 KB         │
│ SF2 音色库 (GM128)              3 MB          │
│ 其他预分配                    300 KB          │
│ 剩余可用                    ~4.2 MB  ✅       │
└──────────────────────────────────────────────┘
```

内存充足，无 OOM 风险。

#### 常量表（Flash/PROGMEM）

| 表 | 大小 | 存储位置 |
|----|------|---------|
| SCORE_TABLE[17][12] | 204B | Flash |
| SCALE_INTERVALS[9][7] | 63B | Flash |
| CHORD_INTERVALS[17][6] | 102B | Flash |
| RhythmCells（5 pool × 8 cells） | 640B | Flash |
| InstrumentFlags（60 乐器） | 2-3KB | Flash |
| **StyleRegistry** | **200-275KB** | **PSRAM** |
| **总计** | **~30-40KB**（不含 StyleRegistry） | — |

#### 动态分配热点

| 文件 | 模式 | 最大容量 | C 策略 |
|------|------|---------|--------|
| Orchestrator.ts | `lhNotes[]/rhNotes[]/drumNotes[]` | ~1000 notes/曲 | 预分配 `NoteData buf[1024]` |
| GrooveEngine.ts | `possibleSteps[]` 对象数组 | 128 步 | 栈分配 `struct[128]` = 1KB |
| HarmonyCore.ts | `candidates[][]` voicing | 48 候选 | 栈分配 |
| ViterbiChordSelector.ts | DP/PATH 表 | 32×40 = 2.56KB | 已全局预分配 ✅ |
| ToplineEngine.ts | `sectionMelody.push(...phrase)` | ~400 notes | 循环 push 替代 spread |

#### 栈深度

| 函数链 | 最深嵌套 | 栈需求 | 风险 |
|--------|---------|--------|------|
| generateFullSong → HarmonyPipeline → Viterbi | 3 层，无递归 | ~2KB | 安全 |
| ToplineEngine → generateSectionMelody | 2 层 for 循环 | ~400B | 安全 |
| Orchestrator → TextureMapper | 2 层 | ~1KB | 安全 |

FreeRTOS 任务栈建议：4KB/任务，足够覆盖最深调用链。

### 4.4 PRNG 精度

| 维度 | TS 侧 | C 侧 | 一致性 |
|------|-------|-------|--------|
| 状态变量 | `number`（float64） | `uint32_t` | ✅ Phase 1 已验证 |
| 乘法 | 自动 BigInt 语义 | 需 `uint64_t` 临时 | ✅ 已实现 |
| 返回值 | `double` | 应保持 `double` | ⚠️ 若用 `float` 则低 8 位丢失 |

建议：C 侧 PRNG 返回值保持 `double`，仅在下游消费处降级为 `float`。

### 4.5 模块依赖图与移植顺序

```
Layer 0（叶子，可独立移植）
  types, BeatMath, Dedup, InstrumentFlags, MoodFlags,
  ChordScoreTable, RhythmCells, EnergyThresholds

Layer 1（依赖 Layer 0）
  MusicTheoryRules ⚠️正则, ChordMask, CandidatePool

Layer 2（依赖 Layer 0-1）
  HarmonyCore, GrooveEngine, ViterbiChordSelector, StructureEngine

Layer 3（依赖 Layer 0-2）
  HarmonyPipeline, ToplineEngine ⚠️最复杂, EnsembleDrafter

Layer 4（依赖 Layer 0-3）
  TextureMapper, TransitionEngine, MotifLooper, GlobalReviewer

Layer 5（顶层）
  Orchestrator, MelodyEngine
```

无循环依赖，DAG 结构良好。紧耦合模块组（必须一起移植）：
1. HarmonyCore + MusicTheoryRules
2. Viterbi 管线四件套（ViterbiChordSelector + CandidatePool + ChordMask + ChordScoreTable）
3. ToplineEngine + GrooveEngine + GlobalContext

### 4.6 HAL 实现差距

| HAL 接口 | C 侧状态 | 差距 |
|----------|---------|------|
| IAudioOut (playNote/stop) | ✅ `ar4_bridge.c` 完成 | — |
| IAudioOut (noteOn/Off/CC) | ❌ 接口过粗 | 需补充细粒度 MIDI 控制 |
| ILedMatrix | ❌ 未实现 | 需 SPI/RMT WS2812 驱动 |
| ITouchPad | ❌ 未实现 | 需 I2C CST816S/MPR121 驱动 |
| ISystemTimer | ⚠️ 部分 | 需封装 `esp_timer_get_time()` |

### 4.7 TrackSerializer 完整度

| 数据类型 | 序列化覆盖 | C struct 大小 |
|----------|-----------|--------------|
| NoteData[] | ✅ Float32Array, 16B/note | `float[4]` |
| GeneratedChord[] | ❌ 未覆盖 | 需 `{ uint16 start/end, uint8 root/quality/keyOffset }` = 7B |
| SectionMetadata[] | ❌ 未覆盖 | 需 `{ uint16 start/end, uint8 energy/type }` = 6B |
| ArrangedTrack | ❌ 未覆盖 | 需 header + 各轨 buffer + count |
| EnsembleDraft | ❌ 未覆盖 | 需 `{ uint8 sounds[7], MixingConfig mix[7] }` |

关键问题：`GeneratedChord.numeral` 是 string，C 中应替换为 `(root, quality)` 二元组。

### 4.8 FreeRTOS 任务模型建议

```
Task A: Generation（Normal, 4KB Stack）
  StructureEngine → HarmonyPipeline → ToplineEngine
  Duration: 500-2000ms/song
  Output: GeneratedTrack → queue → Task B

Task B: Orchestration（Normal, 4KB Stack）
  Orchestrator → TextureMapper → GlobalReviewer
  Duration: 300-500ms
  Output: ArrangedTrack → queue → Task C

Task C: MIDI Playback（High Priority, 2KB Stack）
  MidiScheduler tick loop（5ms period）
  TinySoundFont → I2S DMA（4×32KB ping-pong in PSRAM）

Task D: UI/Input（Low Priority, 2KB Stack）
  LED Matrix refresh + Touch pad polling（30-60 fps）
```

无缝衔接策略：当前曲播放到 ~80% 时启动下一首预生成（双缓冲）。

### 4.9 移植风险矩阵

| 风险 | 严重性 | 概率 | 缓解方案 |
|------|--------|------|---------|
| MusicTheoryRules 正则无法移植 | 高 | 低 | 手写 strstr 链状态机 |
| StyleRegistry 超 SRAM | 高 | 中 | 放入 PSRAM/Flash PROGMEM |
| float vs double PRNG 不一致 | 高 | 低 | C 侧已用 double |
| ToplineEngine 2644 行翻译错误 | 中 | 中 | 黄金种子 + 分模块快照验证 |
| LED/Touch 驱动延期 | 中 | 中 | 先用串口调试，后补驱动 |
| 长曲浮点 beat 累积漂移 | 低 | 低 | 每 8 小节重新对齐 |

### 4.10 剩余工时

| 任务 | 工时 | 状态 |
|------|------|------|
| 核心生成管道 C 翻译 | ~38 人天 | ✅ 已完成 |
| 平台层桥接 | ~5 人天 | ⚠️ 80% |
| LED Matrix 驱动 | 1-2 人天 | ❌ 未开始 |
| Touch Pad 驱动 | 1 人天 | ❌ 未开始 |
| IAudioOut HAL 细化 | 1 人天 | ❌ 需补充 |
| TrackSerializer 补全 | 0.5 人天 | ❌ 需覆盖 Chord/Section |
| 硬件板测 + 听感验证 | 2-3 人天 | ❌ 待硬件 |
| **剩余总计** | **~8-12 人天** | 2 周内可首次硬件出声 |

---

## 5. 综合改进优先级

### P0 — 阻断性问题

| 项目 | 类别 | 工时 |
|------|------|------|
| 修复 2 处浮点 `===`（TransitionEngine:243, ToplineEngine:1611） | 工程 | 1h |
| 8 处 `sectionName.includes()` → SectionType enum | 工程 | 4h |
| 4 处乐器名字符串匹配 → InstrumentId enum | 工程 | 2h |

### P1 — 高优先级

| 项目 | 类别 | 工时 |
|------|------|------|
| 4 处 `any` → 具体类型 | 工程 | 1h |
| Viterbi 权重按风格可配置（W_FUNCTIONAL 从硬编码 → StyleConfig） | 乐理 | 8h |
| 鼓组 Kick/Snare/HiHat 模式分离 | 乐理 | 16h |
| LED Matrix HAL 驱动 | 移植 | 8-16h |
| Touch Pad HAL 驱动 | 移植 | 6-8h |

### P2 — 中优先级

| 项目 | 类别 | 工时 |
|------|------|------|
| 旋律音程跳进规则 + 开放/闭合乐句终止 | 乐理 | 8h |
| GlobalContext 读取迁移到 MusicContext 参数传递 | 工程 | 16h |
| IAudioOut HAL 细化（noteOn/Off/CC） | 移植 | 8h |
| TrackSerializer 补全（Chord/Section/Ensemble） | 移植 | 4h |
| 借调惩罚降低（-3 → -1.5）+ 副属权重提升（+2 → +4） | 乐理 | 4h |
| 硬件板测 + 听感验证 | 移植 | 16-24h |

### P3 — 低优先级

| 项目 | 类别 | 工时 |
|------|------|------|
| Walking Bass / Pedal Point 织体 | 乐理 | 12h |
| 平行五八度硬检测 | 乐理 | 4h |
| Error 子类定义 + 统一 catch | 工程 | 4h |
| Swing/Shuffle timing | 乐理 | 8h |
| Jam 模式竞态修复（改用 MidiScheduler 事件触发） | 技术 | 4h |
| 生成过程 Web Worker 解耦 | 技术 | 8h |

---

*报告结束。*
