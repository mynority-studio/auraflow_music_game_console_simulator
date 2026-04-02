# AuraFlow 核心架构与 ESP32-S3 移植指南

## 版本信息
- **当前版本:** 1.33.0
- **最后更新:** 2026-04-02
- **更新日志:**
  - `v1.33.0`: **全局冲刺回顾与次世代打磨。**
    1. **动机开发 (方案 A)**: 在 `ToplineEngine.ts` 中添加了高级动机变换 (`_split`, `_merge`, `_shift`)，使旋律更具人性化且更易记。
    2. **经过音与音部避让 (方案 B)**: 在 `TextureMapper.ts` 中增加了 `truncateToChordEnd`，严格防止贝斯、副旋律和和弦音符渗入经过音和弦，消除纵向冲突。
    3. **动态鼓花 (方案 C)**: 升级了 `TransitionEngine.ts`，使用 `energyDelta` 动态缩放填补的复杂性和密度（例如：在大能量跳跃时使用 32 分音符线性填补）。
  - `v1.32.3`: **关键 Bug 修复：反转的相对小调逻辑与双重降号。**
    1. **反转的相对小调逻辑**: 修复了 `HarmonyCore.generateHarmonyTimeline` 中的一个 Bug，即 `isRelativeMinor` 的计算逻辑反了（在大调进行中为 true，在小调中为 false）。这导致小调调性中的大调进行未被移至相对大调，而小调进行却被错误移植。将变量重命名为 `isMinorProgression` 和 `isRelativeMajorProgression` 以明确意图并修正了布尔逻辑。
    2. **音符双重降号**: 修复了 `HarmonyCore.parseRomanNumeral` 中的一个 Bug，即小调中显式降号（如 `bVI`）被双重降号（例如 C 小调中的 `bVI` 变成了 G 大调而非 Ab 大调）。现在仅在没有显式变音记号 (`rootOffset === 0`) 时才应用小调中 III、VI 和 VII 的自然降号。
  - `v1.32.2`: **关键 Bug 修复：双重调性偏移与小调根音计算。**
    1. **双重调性偏移修复**: 撤销了 `v1.32.1` 中向 `HarmonyCore.getSafeScalePitches` 传递 `GlobalContext.currentKeyOffset` 的更改。生成引擎（`ToplineEngine`, `TextureMapper` 等）设计为相对于 C 生成音高，并在流水线末端由 `Orchestrator` 全局应用 `keyOffset`。向 `getSafeScalePitches` 传递 `keyOffset` 会导致音阶被平移两次，造成严重的跑调旋律（例如在 Db 大调中却按 D 大调生成）。
    2. **小调根音修复**: 修复了 `HarmonyCore.parseRomanNumeral` 中的一个严重 Bug，即当 `tonality === 'Minor'` 时，所有和弦都被错误地应用了 `root += 3`。这导致小调中的和弦是相对于其相对大调生成的（例如 C 小调中的 `i` 变成了 Eb 小调）。修正了逻辑，使小调中的 `III`、`VI` 和 `VII` 自然降号，确保 `i` 正确映射到根音 0。
  - `v1.32.1`: **Bug 修复：音阶冲突、网格塌陷与和弦铺底泄露。**
    1. **主/小调音阶冲突修复**: 修复了 `HarmonyCore.getSafeScalePitches` 未接收到 `GlobalContext.currentKeyOffset` 的严重 Bug，导致旋律引擎无论歌曲调性如何都默认使用 C 大/小调音阶。现已将 `GlobalContext.currentKeyOffset` 传递给所有相关引擎。
    2. **网格塌陷修复**: 修复了未量化的浮点时长和起始值导致节奏不稳定的问题（“机器人醉酒”效应）。在 `PlaybackEngine.ts` 生成 MIDI 事件之前，对 `onset` 和 `duration` 添加了强制网格对齐（`Math.round(val / 0.25) * 0.25`）。
    3. **Verse_2 和弦铺底泄露修复**: 移除了 `Orchestrator.ts` 中错误的“动态 F-M-B 角色切换”逻辑，该逻辑曾将和弦音符错误地交换到 `Verse_2` 和 `Break` 段落的旋律轨道，导致旋律乐器演奏块状和弦而非单音线条。
  - `v1.32.0`: **动态乐句结构生成（情绪驱动）。**
    1. **情绪集成**: 在 `MoodFlags.ts` 的 `MoodConfig` 中添加了 `phraseActionBias`，用于根据所选情绪定义乐句生成的概率（重复、变化、对比）。
    2. **ToplineEngine 更新**: 用动态生成系统替换了硬编码的乐句 `FORMS`。乐句标签（A, B, A_prime, C 等）现在根据情绪的偏好概率生成。
    3. **解决逻辑**: 更新了 `isAnswer` 逻辑以处理动态生成的乐句标签，并实现了当存在连续未解决乐句时强制强解决的智能机制。
  - `v1.31.0`: **情绪偏好自适应引擎（情绪 + 风格）。**
    1. **情绪集成**: 引入了 `MoodId` 和 `MoodConfig`，将 BPM、密度和能量上限与死板的 `StyleConfig` 解耦。
    2. **旋律引擎更新**: `MelodyEngine` 现在应用情绪乘数动态计算最终 BPM，并偏向调性选择（如忧郁情绪偏向小调）。
    3. **结构引擎更新**: `StructureEngine` 现在针对生成的段落应用情绪能量上限和密度乘数。
    4. **动态织体路由**: `TextureMapper` 现在基于*实际*生成的 BPM 和能量等级选择织体（Bass, Drums, Piano, CounterMelody），而非仅仅遵循风格默认设定。
  - `v1.30.5`: **修复未定义变量与 Linter 错误。**
    1. **TextureMapper 修复**: 在传递给 `BassIdiomContext` 之前，使用 `StyleId` 定义了缺失的 `isCinematic` 和 `isBallad` 变量。
    2. **人声和声修复**: 在 `types.ts` 的 `idiomPreferences` 中添加了 `vocalStyle`，并更新了 `TextureMapper.ts` 中的 `generateVocalHarmony` 以使用它，替换了已移除的 `stringStyle`。
    3. **播放引擎修复**: 更新了 `InteractivePlaybackEngine`、`LiveLoopingEngine` 和 `PlaybackEngine`，直接使用 `styleId` 来确定混音风格，替换了过时的 `drumStyle` 字符串比较，并移除了对不存在的 `StyleId` 的引用。
  - `v1.30.4`: **织体重构（基于特征命名）。**
    1. **重命名**: 将基于流派的织体更名为基于特征的命名（例如：`PopBassIdiom` -> `SteadyBassIdiom`）。
    2. **注册表更新**: 更新了副旋律、贝斯、鼓和钢琴织体注册表，以使用新的基于特征的名称，并移除了硬编码的回退逻辑。
    3. **风格配置**: 更新了所有风格配置文件以使用基于特征的织体偏好。
    4. **逻辑更新**: 更新了核心算法模块，使用 `StyleId` 代替织体名称来确定风格特定逻辑。
  - `v1.30.3`: **修复构建错误并清理未使用风格。**
  - `v1.30.2`: **回退旋律与交叉特征。**
  - `v1.30.1`: **旋律生成精细化（轮廓与解决）。**
    1. **轮廓增强**: 增加了 `ToplineEngine.ts` 中的 `range` 参数，允许更多样化的旋律形状。
    2. **全局解决逻辑**: 在乐句结尾实现了全局解决检查。
    3. **复杂和弦的线性规则**: 为复杂和弦添加了特定规则，执行级进运动。
  - `v1.30.0`: **织体分配与融合凝聚力（音乐融合精细化）。**
  - `v1.29.0`: **律动参数集成（音乐融合精细化）。** 
  - `v1.28.2`: **调试模式：移除所有音效。** 为了简化音频流水线，彻底移除了所有特殊音源效果。
  - `v1.28.1`: **调试模式：禁用前奏段落。** 暂时禁用了所有前奏段落生成，以便更快地调试和测试核心歌曲部分。
  - `v1.28.0`: **Sprint 2: 渐慢 (Ritardando) 与 乐句对答 (Trading Fours)。** 
  - `v1.27.0`: **尾奏生成大修。** 基于“重构蓝图”实现了高级尾奏生成逻辑。
  - `v1.26.0`: **前奏生成大修。** 基于“重构蓝图”实现了全面且系统的前奏生成逻辑。
  - `v1.25.0`: **Lo-Fi 美学与 DSP 链实现。** 针对 ESP32-S3 实现了“缺陷即特色”的方案。
  - `v1.24.0`: **100% 织体提取完成。** 实现了织体逻辑与核心引擎的完全解耦。
  - `v1.23.0`: **钢琴织体解耦。** 
  - `v1.22.0`: **语法委派（旋律与和声规则）。** 
  - `v1.21.0`: **鼓织体解耦。** 
  - `v1.20.0`: **风格纯净度重构。** 彻底消除了代码库中的 `StyleFlags` 字符串依赖，实现纯数据驱动。
  - `v1.19.3`: 优化了 Eurodance 和 EDM 律动生成。
  - `v1.19.2`: 精细化旋律生成引擎，强制执行严格的节奏量化。
  - `v1.19.1`: 增强了 `PlaybackEngine.ts` 中的控制台日志。
  - `v1.19.0`: 为 ESP32-S3 优化实现了“芯片级算法混音规则”。
  - `v1.18.0`: 重构了全代码库的 PRNG 使用，确保 C++ 移植的确定性。
  - `v1.17.0`: 全面重构，使用 `StyleId` 枚举替换字符串标识符。
  - `v1.16.0`: 大修旋律生成引擎，引入基于语法的节奏生成。
  - `v1.15.3`: 基于能量等级精细化鼓律动。
  - `v1.15.2`: 扩展了乐器织体 (P1)。
  - `v1.15.1`: 修复了旋律引擎中的音高锁定 Bug。
  - `v1.15.0`: 实现了分层风格感知编配系统。
  - `v1.14.0`: 解决了复杂流派中的系统性和声问题。
  - `v1.13.0`: 修复了关键的和声不稳定性。
  - `v1.12.0`: 添加了 Eurodance、Trance 和 Synthwave 风格。
  - `v1.11.0`: 完成了风格精细化的第一阶段验证。
  - `v1.10.0`: 精细化了生成流水线中的调性偏移逻辑。
  - `v1.9.1`: 精细化 Aura Bar 布局。
  - `v1.9.0`: 将 “Aura Radio” 重构为 “Aura Bar”，采用新的卡片式 UI。
  - `v1.8.1`: 优化了无声乐时的旋律生成。
  - `v1.8.0`: 实现了和声色彩增强的第一阶段。
  - `v1.7.2`: 引入了 R&B Phonetic Rhythm 和 R&B Riffs 机制，增强了 SingerPersona 的 R&B 演唱风格。修复了 SingerPersona.ts 中的语法错误。
  - `v1.7.0`: 增强旋律生成技术。
  - `v1.6.0`: 实现了高级 Neo-Soul 音乐特性。
  - `v1.5.0`: 将人声乐器从 `Solo_Vox` (085) 更改为 `Marimba` (012)。
  - `v1.4.0`: 彻底移除 `Meowsynth.sf2` 及其相关依赖。
  - `v1.3.0`: 彻底移除所有 `Tone.js` 依赖。
  - `v1.2.0`: 消除 Tone.js 依赖，引入 `MidiScheduler` 模拟 FreeRTOS 任务。
  - `v1.1.0`: 增加了全面的 AI 辅助移植指南。
  - `v1.0.1`: 使用 `globalPRNG.next()` 替换所有 `Math.random()` 以实现确定性生成。
  - `v1.0.0`: 初始架构文档，定义了 HAL 接口、PRNG 和 C++ 移植指南。

---

## AuraRadio 核心开发系统指南

### 🎯 角色定义
你是一名顶级的 C++/TypeScript 嵌入式固件工程师，同时也是生成式音乐算法专家。你的核心任务是开发并维护 AuraRadio 的音乐生成引擎。

你必须深刻理解：当前的 TypeScript/Web 版本代码仅是针对物理硬件 (ESP32-S3) 的高保真模拟和预研环境。`/src/core/generation/` 目录下的所有代码必须最终能够 1:1 无缝、无损地翻译为 C/C++ 代码，运行在资源受限的微控制器上。

### 🛑 核心约束

#### 1. 内存与 C++ 移植性
- **禁止动态特性**: 严禁使用高度动态的 JavaScript 特性（如动态添加对象属性、反射、`eval`、动态字符串键查找）。
- **扁平数据结构**: 生成引擎输出的所有数据必须是纯数据 (Plain Data)，能够直接映射到 C++ `struct`（例如：`NoteData` 必须是一个包含 `pitch`、`onset`、`duration`、`velocity` 的扁平结构）。
- **零 GC 意识**: 在生成循环中（如遍历节拍、生成音符），严禁频繁使用会产生大量临时对象的语法，如 `new Object()`、`.map()`、`.filter()`。应尽可能复用数组或使用原始数据类型。
- **环境隔离**: `/src/core/generation/` 目录严禁导入任何 React 依赖（`useState`, `useEffect`）、DOM API（`window`, `document`）或 Web Audio API（`Tone.js`）。

#### 2. 绝对确定性与 PRNG 约束
- **严禁原生随机**: 全局范围内严禁使用 `Math.random()`。
- **统一随机源**: 所有随机数必须且只能通过 `PRNGManager.next()` 获取。
- **状态快照支持**: 任何生成阶段的入口点必须支持通过 `PRNGManager.getState()` 捕获快照，并能通过 `PRNGManager.setState()` 还原，以确保单模块的独立测试和可复现性。**相同种子 + 相同输入 = 绝对一致的输出。**

#### 3. 状态管理与数据流
- **严禁全局可变状态**: 严禁模块读写全局单例（如写入旧的 `GlobalContext`）。
- **显式上下文传递**: 音乐上下文必须通过 `MusicContext` 结构体显式传递。生成引擎输出 `MusicContext`，编配引擎作为参数接收 `MusicContext`。
- **优先使用枚举与位掩码**: 风格 ID 必须使用 `StyleId` (Enum)。风格类别匹配严禁使用字符串 `.includes()`，必须使用 `StyleFlags` 进行按位与 (AND) 运算，以确保 C++ 中极快的查表速度。

### ⚙️ 四模块流水线接口契约

整个生成流水线必须严格遵循此单向数据流。严禁越权、严禁反向、严禁跳步：

#### 模块 1: PRNGManager (随机数管理)
- **职责**: 维护 LCG 状态，为全流水线提供唯一的随机数序列。
- **接口**: `setSeed(seed: number)`, `next(): number`, `getState(): number`, `setState(state: number)`

#### 模块 2: MelodyEngine (生成引擎)
- **职责**: 决定宏观结构、和声进行及主/副旋律 (Topline)。
- **接口**: `generateFullSong(styleId: StyleId, options?: GenerationOptions): { track: GeneratedTrack, context: MusicContext }`
- **约束**: 同步执行，纯数据输出。内部按固定顺序消耗 PRNG。

#### 模块 3: Orchestrator (编配引擎)
- **职责**: 将单行旋律展开为 7 个特定音轨（人声、主旋律、副旋律、钢琴左手、钢琴右手、鼓、副旋律织体），并应用乐器织体 (Idioms)。
- **接口**: `arrange(track: GeneratedTrack, styleId: StyleId, context: MusicContext): ArrangedTrack`
- **约束**: 同步执行。只读 `MusicContext`，不修改原始 `GeneratedTrack`，输出完整的 `ArrangedTrack`。

#### 模块 4: PlaybackEngine (MIDI 转换层)
- **职责**: 将音符数据转换为底层 MIDI 事件序列。
- **接口**: `convert(arranged: ArrangedTrack, styleId: StyleId): MidiEvent[]`
- **约束**: 纯数据映射，不消耗 PRNG。输出的 `MidiEvent[]` 是生成流水线的绝对终点。

### 📝 强制文档记录规则

每当你修改以下任何内容时：
- 核心算法逻辑（如旋律生成、和声推导、律动算法）
- 接口签名（参数类型、返回值结构）
- 架构流水线流程（流水线顺序、模块职责）
- 数据结构（新增/修改/删除 Structs/Interfaces）

你 **必须** 在 **同一个对话轮次** 内主动编辑并更新根目录下的 `AURA_ARCHITECTURE.md` 文件：
1. 找到 `## Version Info -> Update Log`。
2. 更新版本号（遵循语义化版本：重大重构 -> Minor，Bug 修复 -> Patch）。
3. 详细记录本次改动的内容、涉及的模块以及对 C++ 移植的影响。
4. 若修改了接口或数据流，必须同步更新文档中的 ASCII 流程图或接口表。

### 🛠️ 执行标准

- **少说多做**: 少解释，多写代码。直接使用工具修改文件。
- **严格遵循现有接口**: 增加新功能时，优先复用 `types.ts` 中的现有结构。若必须新增，需考虑：“该结构在 C++ 中会占用多少内存？是否可序列化？”。
- **清理残留代码 (Ghost Code)**: 在重构过程中，应主动发现并删除未使用的旧变量、未引用的文件以及多余的 `console.log`。保持代码库极致简洁。
- **语言**: 所有交流必须严格使用中文。

---

## 1. 架构概览
AuraFlow 的设计严格遵循 **核心逻辑 (音乐引擎)** 与 **平台层 (Web/ESP32)** 的分离。
模拟器使用 React 和 WebAudio (SpessaSynth)，但核心引擎必须保持平台无关性，以便 1:1 翻译为 C/C++ 运行于 ESP32-S3。

### 目录结构
- `/src/core/generation/`: 纯音乐理论与生成算法。**(必须是 100% 可移植的 C++ 逻辑)**
- `/src/core/hal/`: 硬件抽象层。定义 I/O 接口。
- `/src/core/audio/`: Web 端特定的音频实现 (SpessaSynth + MidiScheduler)。**(在 ESP32 中将被 I2S/合成器替换)**
- `/src/apps/`: 应用状态机。**(应为纯 TS 类，而非 React hooks)**
- `/src/components/`: 模拟器的 React UI 组件。**(在 ESP32 中忽略)**

---

## 2. 音乐生成流水线
流水线严格遵循顺序逻辑且由数据驱动。它**不直接**播放音频，而是生成 `GeneratedTrack` 数据结构。

1. **输入与种子**: 用户交互触发生成，并附带特定的 PRNG 种子。
2. **结构引擎 (`StructureEngine.ts`)**: 决定段落（前奏、主歌、副歌）及其长度。
3. **和声引擎 (`HarmonicEngine.ts`)**: 基于调性与风格生成和弦进行。
4. **律动与主旋律 (`ToplineEngine.ts`)**: 生成节奏指纹与旋律音符。
5. **编排 (`Orchestrator.ts`)**: 将音符分配给特定乐器（钢琴、鼓、倍司）。
6. **输出**: 返回包含纯音符数据 (`pitch`, `onset`, `duration`, `velocity`) 的 `ArrangedTrack`。

---

## 3. 硬件抽象层 (HAL) 映射
移植到 ESP32-S3 时，`/src/core/hal/IHardware.ts` 中的 TypeScript 接口直接映射到 ESP-IDF 驱动：

| TS 接口 | 模拟器实现 | ESP32-S3 实现 (C/C++) |
| :--- | :--- | :--- |
| `ILedMatrix` | React 状态 + CSS 网格 | **SPI / RMT** (WS2812B / APA102 驱动) |
| `ITouchPad` | DOM `onPointerDown` | **I2C** (如 CST816S) 或原生触摸板 |
| `IAudioOut` | SpessaSynth (SF2) + MidiScheduler | **I2S** (如 MAX98357A) + FluidSynth/TinySoundFont |
| `ISystemTimer` | `setTimeout` / `performance.now()` | `vTaskDelay()` / `esp_timer_get_time()` |

---

## 4. C/C++ 移植开发标准 (关键)

为确保 TS 代码能轻松翻译为 ESP32-S3 的 C/C++，`/src/core/` 下的所有后续开发必须遵守以下规则：

1. **核心逻辑禁用 React**: 永远不要在 `/src/core/` 内部使用 `useState`、`useEffect` 或 JSX。核心逻辑必须是纯 TS 类或函数。
2. **确定性随机**: 严禁使用 `Math.random()`。务持使用 `/src/core/utils/PRNG.ts` 中的 `PRNGManager.next()`。这确保了 Web 和 ESP32 上相同种子产生相同的歌曲。
3. **内存管理 (避免 GC)**: 
   - 避免在紧密循环中创建对象（例如 `new Object()`、`.map()`、`.filter()`）。
   - 尽可能优先使用预分配数组或类型化数组 (`Uint8Array`, `Float32Array`)。
   - 在 C++ 中，这些将映射为静态数组或内存池，以防止 ESP32 上的堆碎片和 OOM 崩溃。
4. **纯数据结构**: 生成引擎的输出必须是纯数据（可 JSON 序列化）。最终的 `ArrangedTrack` 对象中不得包含函数或类实例。
5. **禁用 Tone.js**: 所有音频调度必须使用 `MidiScheduler`。所有混音必须使用 MIDI CC 消息（CC 7 对应音量，CC 10 对应全景，CC 91 对应混响）。

---

## 5. AI 辅助移植指南 (面向固件工程师与 Claude/AI)

如果你是负责将此代码库移植到 ESP32-S3 的 AI 助手或固件工程师，请仔细阅读本节以了解系统的边界和耦合。

### 5.1 代码隔离：保留 vs 替换
- **不要触动 (1:1 移植到 C++)**: `/src/core/generation/` 和 `/src/core/utils/PRNG.ts` 下的所有内容。这是纯算法逻辑。直接将 TS 类翻译为 C++ 类。根据上下文，TS 的 `number` 转为 `float` 或 `uint8_t`。
- **替换 (硬件相关)**: `/src/core/hal/` 和 `/src/core/audio/` 下的所有内容。你必须编写实现 HAL 接口和 MIDI 调度器的 C++ 类。
  - `ILedMatrix` -> 使用 ESP-IDF **SPI 主机**驱动或 **RMT** 外设驱动 WS2812/APA102 LED。
  - `ITouchPad` -> 使用 ESP-IDF **I2C** 驱动从触摸控制器（如 CST816S）读取数据。
  - `MidiScheduler` -> 使用 FreeRTOS 任务定时器 (`vTaskDelay`) 实现，读取 MIDI 事件队列并推送到 SF2 引擎。

### 5.2 组件耦合与数据流 (连接方式)
为防止各乐器“自顾自地演奏”（导致音符冲突、节奏不同步），架构强制执行严格的 **自顶向下、共享上下文的数据流**：
1. **风格与配置 (`StyleRegistry`)**: 定义全局规则（BPM 范围、允许的和弦、乐器）。
2. **宏观结构 (`StructureEngine`)**: 将歌曲划分为不同段落（前奏、主歌、副歌）。
3. **全局和声 (`HarmonyCore`)**: 为每个段落生成单一、统一的和弦进行。**关键点**：所有乐器（主旋律、贝斯、伴奏和弦）必须引用这个完全相同的 `HarmonyState`。它们不生成自己的和弦。
4. **全局律动 (`GrooveEngine`)**: 生成统一的节奏网格（切分音、摇摆感）。
5. **编配 (`OrchestratorSync`)**: 充当调度员。它获取全局和声与全局律动，并将它们传递给特定的 **织体 (Idioms)**。
6. **织体 (`PianoIdiom`, `BassIdiom`, `StringIdiom`)**: 这些是具体乐器的渲染器。它们接收共享的 `HarmonyState` 并将其转换为特定乐器的 `NoteData`（例如，BassIdiom 仅演奏共享和弦的根音/五音；PianoIdiom 演奏块状和弦）。这保证了音乐的凝聚力。

### 5.3 内存管理与 C++ 结构体映射
JavaScript 使用垃圾回收 (GC)。如果音频循环中动态分配对象，ESP32-S3 将会崩溃 (OOM)。
- **TS `NoteData`** 必须翻译为紧凑的 C 结构体：
  ```cpp
  struct NoteData {
      uint8_t pitch;       // 0-127 MIDI 音符
      uint8_t velocity;    // 0-127
      float onset;         // 节拍位置
      float duration;      // 节拍长度
  };
  ```
- **避免 `std::vector` 重新分配**: 为音符预分配数组（例如 `NoteData trackBuffer[1024]`）。参考 `/src/core/utils/TrackSerializer.ts` 了解如何在 TS 中使用 `Float32Array` 模拟这种扁平内存布局。

### 5.4 验证策略 (“黄金种子”测试)
如何证明你的 C++ 移植版本与当前的 Web 模拟器 1:1 准确？
1. **固定种子**: 在 Web 模拟器中，硬编码 `PRNGManager.setSeed(12345)`。
2. **生成并导出**: 运行生成流水线，并将生成的 `ArrangedTrack` 序列化为 JSON 文件（或使用 `TrackSerializer` 获取二进制缓冲区）。
3. **运行 C++ 移植版本**: 在 ESP32（或 PC C++ 测试构建）中，用 `12345` 初始化你的移植版 PRNG。运行移植后的生成流水线。
4. **对比**: 生成的 C++ 结构体必须与 Web 模拟器的输出在字节级一致。如果任何音符的 `onset` 或 `pitch` 不同，说明你的 C++ 移植存在逻辑错误（通常是浮点精度问题、不同的数组排序算法，或遗漏了某处 `PRNG.next()` 调用）。

---

## 6. 接口使用说明与调用逻辑

### 6.1 HAL 接口 (`/src/core/hal/IHardware.ts`)
这些接口定义了操作系统逻辑与物理硬件之间的边界。
- **`IAudioOut`**: 
  - *Web*: 由 `AudioEngine` 处理 (SpessaSynth + Web Audio API)。
  - *ESP32*: 必须使用 I2S DMA 实现。`playNote` 和 `stopNote` 方法应将 MIDI 事件推送到 ESP32 上运行的 FluidSynth/TinySoundFont 引擎。
- **`ILedMatrix`**:
  - *Web*: 通过 React 状态模拟 (`LedMatrix.tsx`)。
  - *ESP32*: 使用 SPI 或 RMT 实现。`setPixel` 方法写入帧缓冲区，`update` 通过 DMA 将缓冲区刷新到 LED。
- **`ITouchPad`**:
  - *Web*: 通过 DOM 指针事件模拟。
  - *ESP32*: 使用 I2C 从触摸控制器读取。`getTouchState` 读取当前寄存器，而 `onPadDown`/`onPadUp` 应由映射到 FreeRTOS 队列的硬件中断 (ISR) 触发。
- **`ISystemTimer`**:
  - *Web*: 使用 `performance.now()` 和 `setTimeout`。
  - *ESP32*: 使用 `esp_timer_get_time()` 实现微秒级精度，使用 `vTaskDelay()` 处理阻塞延迟。

### 6.2 音频调用逻辑 (MIDI 流水线)
1. **事件生成**: `PlaybackEngine` 或 `LiveLoopingEngine` 读取 `ArrangedTrack` 数据并将其转换为 `MidiEvent` 对象。
2. **调度**: 这些事件被推送到 `globalMidiScheduler` (`MidiScheduler.ts`)。
3. **执行**: 调度器使用预读循环（模拟 FreeRTOS 定时器任务）。当一个事件的时间到达时，它会调用 `spessaSynth` 实例上的相应方法（如 `noteOn`, `noteOff`, `controllerChange`）。
4. **混音**: 所有混音（音量、全景、混响）都是通过在音符播放前或期间向特定 MIDI 通道发送 MIDI 控制变更 (CC) 消息完成的。不使用 Web Audio API 的 GainNodes 进行单轨混音。

---

## 7. AuraRadio 核心接口约束框架

> 本文档定义 AuraRadio 生成管道的四模块接口边界、数据结构与行为约束。
> 用途：指导需求改动评审、C++ 移植设计、测试用例编写。
> 数据类型与当前源码（`types.ts`、`GlobalContext.ts`、`PRNG.ts`、`MidiScheduler.ts`）一致。

### 7.1 管道总览

#### 7.1.1 四模块与数据流

```text
┌──────────────────────────────────────────────────────────────────────┐
│                        AuraRadio 无限电台                              │
│                                                                      │
│  ┌────────────────┐   ┌──────────────────────┐                       │
│  │  PRNGManager   │   │ 风格查表（静态只读）    │                       │
│  │ setSeed/next   │   │ ·StyleId (enum)      │                       │
│  │ getState/      │   │ ·StyleFlagTable      │                       │
│  │ setState       │   │ ·StyleConfigTable    │                       │
│  └──┬─────────┬───┘   └────┬─────────┬───────┘                       │
│     │         │             │         │                               │
│     ▼         ▼             ▼         ▼                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │
│  │  生成引擎     │  │  编配引擎     │  │ MIDI 转换层   │                │
│  │  MelodyEngine├─►│  Orchestrator├─►│ PlaybackEngine│                │
│  │              │  │              │  │  .convert()   │                │
│  └──────────────┘  └──────────────┘  └──────┬───────┘                │
│   GeneratedTrack    ArrangedTrack           │                        │
│   + MusicContext                            │ MidiEvent[]            │
│                                             │ ← 生成管道终点          │
│  ╔══════════════════════════════════════════╧═══════════════╗        │
│  ║              【平台层 — 不属于生成管道】                    ║        │
│  ║  MidiScheduler → 合成器 → 音频输出 → onTrackEnd → 循环   ║        │
│  ╚═════════════════════════════════════════════════════════╝        │
└──────────────────────────────────────────────────────────────────────┘
```

#### 7.1.2 黑盒接口输入输出图

以下是四个黑盒模块的完整输入、输出和数据流。此图定义了模块间的不可变边界——无论各黑盒内部如何改动，输入数据、输出数据和流向不变。

```text
                    显式输入                     隐式输入
                 ┌───────────┐    ┌────────┐   ┌──────────────┐
                 │  styleId  │    │options? │   │ PRNGManager  │
                 │(StyleId   │    │·motif   │   │ .next()      │
                 │  enum)    │    │·tonality│   │ .getState()  │
                 └─────┬─────┘    │·timeSig │   │ .setState()  │
                       │          └────┬────┘   │              │
                       │               │        └──────┬───────┘
                       │               │               │
                       ▼               ▼               ▼
                    ┌────────────────────────────────────────┐
                    │                                        │
                    │ MelodyEngine.generateFullSong(styleId) │
                    │          【生成引擎黑盒】                │
                    │                                        │
                    │ 内部查表: StyleConfigTable[styleId]     │
                    │         StyleFlagTable[styleId]        │
                    │                                        │
                    │   同步 · 纯数据 · 确定性                │
                    │                                        │
                    └───────┬────────────────┬───────────────┘
                            │                │
                            ▼                ▼
                    ┌──────────────────────────┐  ┌──────────────┐
                    │      GeneratedTrack       │  │ MusicContext  │
                    │ ·vocal, melody, chords    │  │ ·keyOffset   │
                    │ ·sections                 │  │ ·tonality    │
                    │ ·bpm, key, keyOffset      │  │ ·bpm         │
                    │ ·tonality, timeSignature  │  │ ·timeSignature│
                    │ ·blockIndex               │  │ ·grooveDNA   │
                    │ ·absoluteStartBeat        │  │ ·singerPersona│
                    │ ·hasIntro                 │  └──────┬───────┘
                    │ ·preSelectedPalette       │         │
                    │ ·globalRiff               │         │
                    │ ·processedUserMotif       │         │
                    │ ·motifRole                │         │
                    └────────────┬─────────────┘         │
                                 │                       │
                                 │  styleId              │
                                 ▼  (透传)               ▼
                    ┌────────────────────────────────────────┐
                    │                                        │
                    │ Orchestrator.arrange(track, styleId,   │
                    │                      context)          │
                    │          【编配引擎黑盒】                │
                    │                                        │
                    │ 内部查表: StyleConfigTable[styleId]     │
                    │         StyleFlagTable[styleId]        │
                    │ 读取 context: keyOffset, tonality, ... │
                    │                                        │
                    │   单旋律 → 7 轨 · Idiom 渲染           │
                    │   人性化处理 · 消耗 PRNG                │
                    │                                        │
                    └──────────────┬─────────────────────────┘
                                  │
                                  ▼
                    ┌────────────────────────────────────┐
                    │        ArrangedTrack               │
                    │  ·vocal           : NoteData[]?    │
                    │  ·melody          : NoteData[]     │
                    │  ·secondaryMelody : NoteData[]?    │
                    │  ·pianoLH         : NoteData[]     │
                    │  ·pianoRH         : NoteData[]     │
                    │  ·drums           : NoteData[]?    │
                    │  ·counterMelody   : NoteData[]?    │
                    │  ·palette         : EnsembleDraft  │
                    │  ·sections        : SectionMeta[]? │
                    │  ·bpm, key, absStartBeat           │
                    │  ·timeSignature, styleId           │
                    │  ·globalRiff, userMotif            │
                    └──────────────┬─────────────────────┘
                                  │
                                  │  styleId (透传)
                                  │
                                  ▼
                    ┌────────────────────────────────────────┐
                    │                                        │
                    │  PlaybackEngine.convert(arranged)      │
                    │          【MIDI 转换层】                 │
                    │                                        │
                    │ 内部查表: StyleFlagTable[styleId]       │
                    │          （混音风格 → MIDI CC）          │
                    │                                        │
                    │   NoteData → MidiEvent[]               │
                    │   (noteOn/noteOff/CC + channel + time) │
                    │                                        │
                    └──────────────┬─────────────────────────┘
                                  │
                                  │  MidiEvent[] ← 生成管道终点（测试断言点）
                                  │
                    ╔═════════════╧═══════════════════════════╗
                    ║          【平台层 — 不属于生成管道】       ║
                    ║                                         ║
                    ║  MidiScheduler（5ms 轮询）               ║
                    ║       ↓                                 ║
                    ║  合成器（SpessaSynth / FluidSynth）      ║
                    ║       ↓                                 ║
                    ║  音频输出（扬声器）                       ║
                    ║       ↓                                 ║
                    ║  onTrackEnd → playNext() → 循环回顶部    ║
                    ╚═════════════════════════════════════════╝
```

#### 7.1.3 四个模块职责

| # | 模块 | 类 | 输入 | 输出 | PRNG |
|---|------|---|------|------|------|
| 1 | PRNGManager | （新增包装层） | seed | 随机数序列 | — |
| 2 | 生成引擎 | `MelodyEngine` | styleId + options | GeneratedTrack + MusicContext | 消耗 N 次 |
| 3 | 编配引擎 | `Orchestrator` | track + styleId + context | ArrangedTrack | 消耗 M 次 |
| 4 | MIDI 转换层 | `PlaybackEngine.convert` | ArrangedTrack + styleId | MidiEvent[] | 不消耗 |

**风格查表系统**（StyleId enum + StyleFlagTable + StyleConfigTable）是共享的静态只读数据层，程序启动时固定，不作为独立模块。

#### 7.1.4 完整执行周期

**第 0 步 — 初始化**
- AuraRadio 调用 `PRNGManager.setSeed(seed)`，LCG 状态归零，序列从此确定

**第 1 步 — 选风格**
- AuraRadio 调用 `PRNGManager.next()` → 从 14 个 StyleId 中选一个

**第 2 步 — 生成曲目**
- AuraRadio 调用 `MelodyEngine.generateFullSong(styleId, options)`
- 内部按固定顺序执行：决策 BPM/调性/拍号 → StructureEngine → HarmonyEngine → EnsembleDrafter → SingerPersona → ToplineEngine → reharmonize
- 返回 `{ track: GeneratedTrack, context: MusicContext }`

**第 3 步 — 存历史**
- AuraRadio 将 `(track, styleId, context)` 存入历史栈

**第 4 步 — 编配**
- 调用 `Orchestrator.arrange(track, styleId, context)`
- 内部：查表 → 读 context → 逐段落展开为 7 轨 → Idiom 渲染 → 人性化
- 返回 `ArrangedTrack`

**第 5 步 — MIDI 转换**
- 调用 `PlaybackEngine.convert(arranged, styleId)`
- 内部：7 轨 NoteData → MidiEvent[]（noteOn/noteOff/CC + 通道 + 时间戳）
- 返回 `MidiEvent[]` — **生成管道到此结束**

**第 6 步 — 平台层播放**（不属于生成管道）
- MidiScheduler 加载 MidiEvent[]，5ms 轮询驱动合成器输出音频

**第 7 步 — 循环**
- onTrackEnd → playNext()：历史有下一首 → 跳到第 4 步；末尾 → 跳到第 1 步

---

### 7.2 PRNGManager 接口

贯穿全管道的随机数供给模块。内部维护一个 LCG（线性同余生成器），所有需要随机数的模块统一从这里取数。

**工作原理**:
PRNGManager 内部只有一个整数 `state`，这就是它的全部状态。
seed 决定起点，之后每次 `next()` 不可逆地往前走一步。整条序列是一条**单向链**，完全由 seed 唯一确定。不管谁调用 `next()`，只要调用顺序一样，出来的数就一样。

**实际消费顺序**（单次生成周期）:

```text
setSeed(seed)
  │
  ├─ AuraRadio 选风格            → next() ×1      ← 从 14 个 StyleId 中选一个
  │
  ├─ 生成引擎内部                 → next() ×N 次
  │   ├─ StructureEngine         → next() ×若干
  │   ├─ HarmonyEngine           → next() ×若干
  │   ├─ EnsembleDrafter         → next() ×若干
  │   ├─ ToplineEngine           → next() ×若干
  │   │   ├─ GrooveEngine        → next() ×若干
  │   │   ├─ RhythmCells         → next() ×若干
  │   │   └─ SingerPersona.apply → next() ×若干
  │   └─ reharmonize             → next() ×0      ← 纯 Viterbi DP，不消耗
  │
  ├─ 编配引擎内部                 → next() ×M 次
  │   ├─ Orchestrator 自身        → next() ×若干   ← 乐器选择 + 编排决策
  │   ├─ TextureMapper           → next() ×若干   ← 贝斯/和弦织体/鼓/副旋律
  │   ├─ TransitionEngine        → next() ×若干   ← 段落过渡
  │   ├─ InstrumentIdiom         → next() ×若干
  │   └─ humanize                → next() ×若干
  │
  └─ MIDI 转换层                  → next() ×0      ← 纯数据转换，不消耗随机数
```

**接口**:

```typescript
PRNGManager.setSeed(seed: number): void       // 设置 state = seed，序列从头开始
PRNGManager.next(): number                    // 算下一个 state，返回 0~1
PRNGManager.nextInt(min, max): number         // next() 基础上映射到整数范围
PRNGManager.nextFloat(min, max): number       // next() 基础上映射到浮点范围
PRNGManager.getState(): number                // 读取当前 state（用于快照）
PRNGManager.setState(state: number): void     // 恢复到指定 state（用于复现）
```

**行为约束**:
- v1 实现与当前 `PRNGManager` 行为完全一致，黄金种子测试零差异
- `getState()`/`setState()` 是新增能力，当前代码已实现
- 当前源码中 `PRNGManager` 默认使用 `Date.now()` 初始化，黄金种子测试需在入口处显式调用 `PRNGManager.setSeed(固定值)`
- 纯确定性，不依赖任何外部状态
- C++ 侧对应 `struct PRNGManager { uint32_t state; }` + `uint8_t protocolVersion`

---

### 7.3 生成引擎接口

```typescript
MelodyEngine.generateFullSong(styleId: StyleId, options?: GenerationOptions)
  → { track: GeneratedTrack, context: MusicContext }
```

同步调用，返回纯数据，不触发音频。

#### 7.3.1 显式输入

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `styleId` | `StyleId`（enum） | 是 | 风格枚举值，索引 `StyleConfigTable` 和 `StyleFlagTable` |
| `options.userMotifRoot` | `KeyId`（enum） | 否 | 调号枚举（0=C, 1=Db, ..., 11=B），直接锁定全曲调号。不传则由内部 PRNG 生成 |
| `options.processedUserMotif` | `NoteData[]` | 否 | 用户动机音符序列，由上层意图识别模块给出。不传则全部由 PRNG 生成 |
| `options.motifRole` | `MotifRole`（enum） | 否 | 动机角色枚举，决定 processedUserMotif 在编配中的层级。默认 `Foreground` |
| `options.detectedTimeSignature` | `[int, int]` | 否 | 拍号，如 `[4, 4]`。传入则直接使用，不传则由 PRNG 随机抽取 |
| `options.detectedTonality` | `TonalityId`（enum） | 否 | 调式枚举。`0`=随机抽取，非 0 直接作为调式引用 |

#### 7.3.2 隐式输入

| 名称 | 说明 |
|------|------|
| `PRNGManager` | 入口自动记录状态快照（`getState()`），内部各子模块依次调用 `next()` 消耗随机数 |
| `StyleConfigTable[styleId]` | 内部查表得到，定义 BPM 范围、和弦池、旋律约束、乐器候选等规则边界 |
| `StyleFlagTable[styleId]` | 内部查表得到，风格分类标签位掩码（25 flag） |

#### 7.3.3 输出：GeneratedTrack & MusicContext

- **GeneratedTrack**: `chords`, `melody`, `vocal`, `bpm`, `key`, `keyOffset`, `tonality`, `timeSignature`, `sections`, `blockIndex`, `absoluteStartBeat`, `hasIntro`, `preSelectedPalette`, `globalRiff`, `processedUserMotif`, `motifRole`
- **MusicContext**: `keyOffset`, `tonality`, `bpm`, `timeSignature`, `grooveDNA`, `singerPersona`

#### 7.3.4 行为约束

1. **确定性**：相同 PRNG 状态 + 相同输入 = 相同输出
2. **纯数据**：不触发音频、不访问硬件、不产生副作用
3. **PRNG 消耗**：每次调用消耗若干 `next()`，状态不可逆前进
4. **无全局写入**：音乐上下文通过返回值 `context` 显式输出，不写入 `GlobalContext` 等全局单例
5. **快照支持**：入口处 `PRNGManager.getState()` 自动快照，支持独立复现本阶段输出

---

### 7.4 编配引擎接口

```typescript
Orchestrator.arrange(
  track: GeneratedTrack,
  styleId: StyleId,
  context: MusicContext
): ArrangedTrack
```

**输入**: `track` (GeneratedTrack), `styleId` (StyleId), `context` (MusicContext)
**输出**: 七轨分离的 `ArrangedTrack`（vocal / melody / secondaryMelody / pianoLH / pianoRH / drums / counterMelody），含乐器编制、混音参数，以及透传的元数据。

**行为约束**:
- 同步调用，返回纯数据
- 入口自动记录 `PRNGManager.getState()` 快照，内部调用 `next()` 消耗随机数
- 同一 `GeneratedTrack` + 同一 `MusicContext` + 同一 PRNG 状态 = 同一输出
- **不读写任何全局状态**：所有音乐上下文从 `context` 参数读取，不访问全局单例
- 编配引擎内部逐段落遍历时的段落级状态通过局部变量管理并显式传参给 TextureMapper / Idiom，不纳入 MusicContext

---

### 7.5 MIDI 转换层接口

生成管道的末端。将编配引擎输出的 `ArrangedTrack` 转换为 `MidiEvent[]` 序列，这是整个生成管道的最终确定性输出。

```typescript
PlaybackEngine.convert(arranged: ArrangedTrack, styleId: StyleId): MidiEvent[]
```

**输入**: `ArrangedTrack` + `StyleId`
**输出**: `MidiEvent[]`——时间排序的 MIDI 指令序列（noteOn/noteOff/CC + 通道 + 时间戳）

**行为约束**:
- 同步调用，纯数据转换，不涉及音频硬件
- 同一 `ArrangedTrack` + 同一 `StyleId` = 同一 `MidiEvent[]`（确定性）
- 不消耗 PRNG，不读写 MusicContext

---

### 7.6 数据结构定义

> 管道中流转的核心数据结构，字段类型与当前源码一致。

- **NoteData**: `pitch`, `onset`, `duration`, `velocity`, `isGraceNote`, `pitchBend`, `pitchBendDuration`, `fadeOutDuration`, `isUserMotif`
- **GeneratedChord**: `numeral`, `root`, `quality`, `startBeat`, `endBeat`
- **SectionMetadata**: `name`, `startBeat`, `endBeat`, `energyLevel`, `grooveDNA`, `lofiEffect`, `endingType`, `type`, `lengthBars`, `phraseTemplate`, `harmony`, `groove`, `tracks`, `localStyleOverride`, `isRiffDriven`
- **EnsembleDraft**: `melodySound`, `vocalSound`, `secondaryMelodySound`, `chordSound`, `bassSound`, `drumSound`, `counterMelodySound`, `filterSweep`, `mixing`
- **MixingConfig**: `pan`, `reverb`, `volume`, `delay`
- **SingerPersonaConfig**: `id`, `name`, `traits`
- **ArrangedTrack**: `bpm`, `key`, `absoluteStartBeat`, `timeSignature`, `styleId`, `vocal`, `melody`, `secondaryMelody`, `pianoLH`, `pianoRH`, `drums`, `counterMelody`, `userMotif`, `palette`, `sections`, `globalRiff`
- **MidiEvent**: `ticks`, `type`, `channel`, `data1`, `data2`, `visualData`

---

### 7.7 与当前源码的差异

> 本文档描述的是**目标接口设计**。以下列出与当前源码实现的具体差异。所有差异项均为非破坏性机械替换，不改变算法逻辑和 PRNG 消耗顺序。

| 项 | 当前源码 | 本框架 | 涉及文件 |
|---|---|---|---|
| **基础设施** | | | |
| styleId 类型 | `string`（如 `'modern_pop'`） | `StyleId`（enum 数值） | `types.ts`、所有接口签名 |
| 风格分类方式 | `style.id.includes('house')` 子串匹配 | `StyleFlagTable[styleId]` 位掩码查表 | `Orchestrator.ts`、`TextureMapper.ts` 等 |
| 风格配置查询 | `getStyleConfig(id: string)` 哈希表查找 | `StyleConfigTable[styleId]` 静态数组直接寻址 | `StyleRegistry.ts` |
| PRNG 管理 | `PRNGManager` 模块，支持 `next()`、`getState()`/`setState()` | `PRNGManager` 模块，支持 `next()`、`getState()`/`setState()` | `PRNG.ts` |
| 音乐上下文传递 | `GlobalContext` 全局可变单例 | `MusicContext` 结构体，显式传递 | `GlobalContext.ts`、`MelodyEngine.ts`、`Orchestrator.ts` |
| **生成引擎** | | | |
| 生成引擎参数签名 | `generateFullSong(styleId: string)` | `generateFullSong(styleId: StyleId)` | `MelodyEngine.ts` |
| 生成引擎返回值 | `GeneratedTrack` | `{ track: GeneratedTrack, context: MusicContext }` | `MelodyEngine.ts` |
| userMotifRoot | `number?` | `KeyId?`（enum，可选） | `MelodyEngine.ts` |
| motifRole | `string` union | `MotifRole`（enum） | `types.ts`、`MelodyEngine.ts` |
| motifExpertise | `string?` | 删除 | `MelodyEngine.ts`、`types.ts` |
| detectedTonality | `'Major' \| 'Minor'` | `TonalityId`（enum，0=随机） | `MelodyEngine.ts` |
| **编配引擎** | | | |
| 编配引擎参数 | `arrange(track, style: StyleConfig)` | `arrange(track, styleId: StyleId, context: MusicContext)` | `Orchestrator.ts` |
| **播放引擎** | | | |
| 生成管道终点 | `AudioEngine.playSong()` 内调用 `Orchestrator.arrange()` + `PlaybackEngine.loadSong()` | 独立 `PlaybackEngine.convert()` 纯函数输出 `MidiEvent[]` | `PlaybackEngine.ts`、`AudioEngine.ts` |
| 播放引擎参数 | `playSong(track, style: StyleConfig, ...)` | `playSong(track, styleId: StyleId, context: MusicContext, ...)` | `AudioEngine.ts` |
| playSong generator 参数 | `playSong(track, style, generator: MelodyEngine, options?)` | `playSong(track, styleId, context, options?)`（移除 generator） | `AudioEngine.ts` |
| **外围** | | | |
| StyleConfig 查表次数 | EndlessRadioManager 查一次 + MelodyEngine 内部再查一次（冗余） | 各组件内部按需查一次 | `EndlessRadioManager.ts`、`AudioEngine.ts` |
| 历史栈存储 | `{ track: GeneratedTrack, style: StyleConfig }` | `{ track: GeneratedTrack, styleId: StyleId, context: MusicContext }` | `EndlessRadioManager.ts` |
| 风格显示名称 | `style.name` 从 StyleConfig 对象读取 | `StyleIdName[styleId]` 独立数组 | UI 层 |

---

### 7.8 接口设计约束

1. **PRNG 由 `PRNGManager` 统一管理**：统一通过 `PRNGManager.next()` 获取随机数，模块管理种子、状态快照（`getState()`/`setState()`）、协议版本。
2. **`StyleId` 为 enum 类型**：废弃 `style.id` 字符串。所有接口只传 `StyleId`（enum 数值），各组件内部按需查 `StyleConfigTable[styleId]` 和 `StyleFlagTable[styleId]`。
3. **风格分类走 `StyleFlagTable` 位掩码**：废弃所有 `style.id.includes()` 子串匹配。flag 分配按代码中实际的分支命中路径确定，确保替换前后每个风格命中的 if 分支完全一致。
4. **接口参数统一**：`generateFullSong(styleId)`、`arrange(track, styleId, context)`、`playSong(track, styleId, context, ...)` 全部只收 `StyleId`，消除 StyleConfig 对象的冗余传递。
5. **`MusicContext` 显式传递**：废弃 `GlobalContext` 全局可变单例。生成引擎通过返回值 `MusicContext` 显式输出，编配引擎通过参数显式接收。各黑盒不读写任何全局状态。
6. **阶段入口自动快照**：`generateFullSong()` 和 `arrange()` 入口处自动记录 `PRNGManager.getState()`，支持独立复现任一阶段的输出。
7. **`StyleId`、`StyleFlagTable`、`StyleIdName` 集中定义**：统一在一处（如 `StyleFlags.ts`），禁止散落。
8. **生成管道终点为 `MidiEvent[]`**：整个生成管道的最终确定性输出为 `MidiEvent[]`，不涉及音频。MIDI 之后的调度与合成属于平台层，不纳入测试范围。

---

### 7.9 复核结论

#### 7.9.1 可测试性复核
验证四个黑盒（PRNGManager、生成引擎、编配引擎、MIDI 转换层）是否可通过 `getState()`/`setState()` 测试钩子独立测试。

**结论：框架设计可测试，当前源码未实现。**
按本框架实施后，四个黑盒均可独立测试：
- **PRNGManager**：`setSeed()` + 调用序列 → 验证输出数列
- **生成引擎**：`setState(stateA)` + styleId + options → 验证 GeneratedTrack + MusicContext
- **编配引擎**：`setState(stateC)` + 预录 track/styleId/context → 验证 ArrangedTrack
- **MIDI 转换层**：预录 ArrangedTrack + styleId → 验证 MidiEvent[]（不消耗 PRNG，无需快照）

#### 7.9.2 机械替换兼容性复核
验证本框架的所有接口变更在完整机械替换后是否保证生成效果零差异。

**结论：全部 7 项替换零差异可行。**
- StyleId enum 替换 string：✅ 零差异
- GlobalContext → MusicContext 显式传递：✅ 零差异
- globalPRNG → PRNGManager：✅ 零差异
- userMotifRoot 类型 enum 化：✅ 零差异
- detectedTonality enum 化：✅ 零差异
- motifExpertise 删除：✅ 零差异
- 返回值 { track, context }：✅ 零差异
