# AuraFlow 核心架构与 ESP32-S3 移植指南

## 版本信息
- **当前版本:** 1.34.0
- **最后更新:** 2026-04-02
- **更新日志:**
  - `v1.34.0`: **生成管道 Rule 全面合规 — S-2/T-3/D-4/T-4 违规清零。**
    1. **S-2 GlobalContext 解耦（完成）**: 移除了 `/src/core/generation/` 中所有 `GlobalContext` 的导入、读取和写入。上下文现在通过 `MusicContext` 返回值、`TextureRenderContext` 参数、`BassIdiomContext` 字段和方法参数链显式传递。从 MelodyEngine、ToplineEngine 和 Orchestrator 中移除了 `initializeNewEra()` 和 `updateCurrentSlice()` 调用。
    2. **Bass Idiom S-2 合规**: 向 `BassIdiomContext` 添加了 `beatsPerBar`、`activeSection`、`keyOffset`、`grooveDNA`。将 `isGrooveHit`/`isLayeringHit`/`isInterleavingHit` 提取为 `BaseBassIdiom` 上的纯静态方法，替代 GlobalContext 单例调用。
    3. **HarmonyCore S-2 合规**: 向 `generateHarmonyTimeline`、`generateDynamicProgression`、`generateFromFunction` 和 `applyStyleSpices` 添加了 `tonality` 和 `keyOffset` 参数。替换了内部 14 处 `GlobalContext.currentTonality`/`currentKeyOffset` 读取。
    4. **T-3 `any` 类型消除**: 在 `types.ts` 中定义了 `IdiomPreferences` 和 `RuntimeIdiomPreferences` 接口。替换了所有 Performance Idioms、Bass/Drum Idiom 上下文和 `InstrumentIdiom` 调度器中约 30 处 `idiomPreferences?: any`。
    5. **D-4 浮点 Epsilon 合规**: 将 drum/bass/piano/vocal/transition idioms 中约 22 处浮点 `===` 比较替换为 `Math.abs(x - target) < 1e-6`。
    6. **T-4 类型断言清理**: 移除了已类型化 `idiomPreferences` 上的冗余 `as` 强转，将 `passingType as any` 收窄为具体联合类型并附加安全注释。
  - `v1.33.0`: **全局冲刺回顾与次世代打磨。**
    1. **动机发展（方案 A）**: 在 `ToplineEngine.ts` 中添加了高级动机变换（`_split`、`_merge`、`_shift`），使旋律更加人性化和令人印象深刻。
    2. **经过和弦与声部规避（方案 B）**: 在 `TextureMapper.ts` 中添加了 `truncateToChordEnd`，严格防止 Bass、CounterMelody 和 ChordTexture 音符越过经过和弦边界，消除纵向冲突。
    3. **动态鼓过门（方案 C）**: 升级 `TransitionEngine.ts` 使用 `energyDelta` 动态缩放过门复杂度和密度（例如，对于巨大能量跳跃使用 32 分音符线性过门）。
  - `v1.32.3`: **关键 Bug 修复：反转的关系小调逻辑与双重降号。**
    1. **反转的关系小调逻辑**: 修复了 `HarmonyCore.generateHarmonyTimeline` 中 `isRelativeMinor` 计算反向的 Bug（小调进行时为 true，大调进行时为 false）。这导致小调中的大调进行未被移调到关系大调，而小调进行被错误移调。将变量重命名为 `isMinorProgression` 和 `isRelativeMajorProgression` 以明确意图，并修复了布尔逻辑。
    2. **双重降号变音记号**: 修复了 `HarmonyCore.parseRomanNumeral` 中小调中显式变音记号如 `bVI` 被双重降号的 Bug（例如 C 小调中 `bVI` 变成了 G 大调而非 Ab 大调）。现在仅在没有显式变音记号（`rootOffset === 0`）时，才对小调中的 III、VI 和 VII 进行自然降号。
  - `v1.32.2`: **关键 Bug 修复：双重移调与小调根音计算。**
    1. **双重移调修复**: 撤销了 `v1.32.1` 中向 `HarmonyCore.getSafeScalePitches` 传递 `GlobalContext.currentKeyOffset` 的更改。生成引擎（`ToplineEngine`、`TextureMapper` 等）设计为相对于 C 生成音高，`Orchestrator` 在管道末尾全局应用 `keyOffset`。向 `getSafeScalePitches` 传递 `keyOffset` 导致音阶被移调两次，产生严重走音（例如生成 D 大调而非 Db 大调）。
    2. **小调根音修复**: 修复了 `HarmonyCore.parseRomanNumeral` 中 `tonality === 'Minor'` 时 `root += 3` 被错误应用于所有和弦的关键 Bug。这导致小调中的和弦相对于关系大调生成（例如 C 小调中 `i` 变成了 Eb 小调）。修正逻辑为自然降号 `III`、`VI` 和 `VII`，确保 `i` 正确映射到根音 0。
  - `v1.32.1`: **Bug 修复：音阶冲突、网格塌陷和和弦垫音泄漏。**
    1. **大调/小调音阶冲突修复**: 修复了 `HarmonyCore.getSafeScalePitches` 未接收 `GlobalContext.currentKeyOffset` 的关键 Bug，导致旋律引擎默认使用 C 大调/小调音阶，忽略实际歌曲调号。在 `ToplineEngine`、`Orchestrator`、`TextureMapper`、`GlobalReviewer` 和各 Idioms 的所有 `getSafeScalePitches` 调用中传递了 `GlobalContext.currentKeyOffset`。
    2. **网格塌陷修复**: 修复了未量化的浮点时长和起始点导致节奏不稳定（"醉酒机器人"效果）的问题。在 `PlaybackEngine.ts` 中生成 MIDI 事件前，对 `onset` 和 `duration` 添加了强制网格对齐（`Math.round(val / 0.25) * 0.25`）。
    3. **Verse_2 和弦垫音泄漏修复**: 移除了 `Orchestrator.ts` 中"动态 F-M-B 角色交换"逻辑，该逻辑在 `Verse_2` 和 `Break` 段落中错误地将和弦音符交换到旋律轨道，导致旋律乐器演奏块状和弦而非单音线条。
  - `v1.32.0`: **动态乐句结构生成（情绪驱动）。**
    1. **情绪整合**: 在 `MoodFlags.ts` 中向 `MoodConfig` 添加了 `phraseActionBias`，根据所选情绪定义 [重复、变化、对比] 的概率（例如 Euphoric 高度重复，Melancholic 有更多对比）。
    2. **ToplineEngine 更新**: 在 `ToplineEngine.ts` 中用动态生成系统替换了硬编码的乐句 `FORMS`。乐句标签（A、B、A_prime、C 等）现在根据情绪的 `phraseActionBias` 概率性生成。
    3. **解决逻辑**: 更新了 `isAnswer` 逻辑以处理动态生成的乐句标签，并实现了智能解决机制，在连续未解决乐句时强制产生强解决。
  - `v1.31.0`: **情感偏向自适应引擎（情绪 + 风格）。**
    1. **情绪整合**: 引入 `MoodId` 和 `MoodConfig`，将 BPM、密度和能量上限从刚性 `StyleConfig` 中解耦。
    2. **MelodyEngine 更新**: `MelodyEngine` 现在应用 `Mood` 乘数动态计算最终 BPM，并偏向调式选择（例如 Melancholic 偏好小调）。
    3. **StructureEngine 更新**: `StructureEngine` 现在向生成的段落应用 `Mood` 能量上限和密度乘数。
    4. **动态 Idiom 路由**: `TextureMapper` 现在根据*实际*生成的 BPM 和能量等级选择 Idioms（Bass、Drums、Piano、CounterMelody），而非严格遵循风格的默认偏好。这允许"慢速/忧伤 EDM"或"快速/激进 Ballad"而不产生矛盾的 idiom 选择。
  - `v1.30.5`: **修复未定义变量与 Linter 错误。**
    1. **TextureMapper 修复**: 在传递给 `BassIdiomContext` 之前，使用 `StyleId` 定义了缺失的 `isCinematic` 和 `isBallad` 变量。
    2. **VocalHarmony 修复**: 在 `types.ts` 的 `idiomPreferences` 中添加了 `vocalStyle`，并更新 `TextureMapper.ts` 中的 `generateVocalHarmony` 使用它替代已移除的 `stringStyle`。
    3. **PlaybackEngine 修复**: 更新了 `InteractivePlaybackEngine`、`LiveLoopingEngine` 和 `PlaybackEngine`，直接使用 `styleId` 确定混音风格，替换过时的 `drumStyle` 字符串比较并移除对不存在的 `StyleId` 的引用。
  - `v1.30.4`: **Idiom 重构（基于特征的命名）。**
    1. **重命名**: 将基于流派的 idioms 重命名为基于特征的 idioms（例如 `PopBassIdiom` -> `SteadyBassIdiom`、`FunkDrumIdiom` -> `SyncopatedDrumIdiom`、`PopCounterMelodyIdiom` -> `SustainedCounterMelodyIdiom`、`JazzCounterMelodyIdiom` -> `MelodicCounterMelodyIdiom`）。
    2. **注册表更新**: 更新了 `CounterMelodyIdiomRegistry`、`BassIdiomRegistry`、`DrumIdiomRegistry` 和 `PianoIdiomRegistry` 使用新的基于特征的名称，并移除硬编码的回退逻辑，改为依赖动态注册。
    3. **风格配置**: 更新了所有风格配置文件（`PopStyles.ts`、`CinematicStyles.ts`、`ElectronicStyles.ts`、`BalladStyles.ts`、`RockStyles.ts`、`LofiStyles.ts`）使用基于特征的 idiom 偏好（例如 `counterMelodyStyle: 'sustained'`）。
    4. **逻辑更新**: 更新了 `TextureMapper.ts`、`EnsembleDrafter.ts`、`GrammarRegistry.ts` 和 `HarmonyCore.ts`，使用 `StyleId` 而非 idiom 名称来确定风格特定逻辑（例如 `isEDM`、`isCinematic`）。
  - `v1.30.3`: **修复构建错误与清理未使用风格。**
    1. **DynamicChoirIdiom**: 创建了缺失的 `DynamicChoirIdiom.ts` 以解决 `VocalHarmonyIdiomRegistry.ts` 中的 Vite 构建错误。
    2. **StyleId 清理**: 从 `Orchestrator.ts` 和 `StructureEngine.ts` 中移除了对未定义 `StyleId`（`SmoothJazz`、`NeoSoul`、`BossaNova`、`IndieRock`、`PostRock`）的引用。
    3. **配置清理**: 从 `ElectronicStyles.ts` 和 `LofiStyles.ts` 中移除了无效的 `humanizeAmount` 属性。
    4. **上下文清理**: 从 `PopBassIdiom.ts` 的 `BassIdiomContext` 使用中移除了未使用的 `melodyNotes` 属性。
  - `v1.30.2`: **回退旋律与跨界功能。**
    1. **回退旋律轮廓与解决**: 从 `ToplineEngine.ts` 中移除了 `range` 增强、`Global Resolution Logic` 和 `Linearity Rule for Complex Chords`。
    2. **回退织体分配与融合凝聚**: 从 `types.ts`、`GlobalContext.ts`、`StructureEngine.ts`、`TextureMapper.ts` 和所有 idiom 文件中移除了 `TextureAllocation`、`GrooveMask` 和 `FusionProfile`。
  - `v1.30.1`: **旋律生成精细化（轮廓与解决）。**
    1. **轮廓增强**: 增大了 `ToplineEngine.ts` 中的 `range` 参数，允许更鲜明和富有表现力的旋律形态（上行、下行、拱形、碗形等）。改进了 `Static` 和 `Wandering` 轮廓的逻辑，使其在数学上更合理、音乐上更悦耳。
    2. **全局解决逻辑**: 在 `ToplineEngine.ts` 中为乐句结尾（`isAnswer`）实现了全局解决检查。如果当前和弦紧张或非自然音（例如 Dark Pop 中），旋律现在优先解决到全局主音的稳定音（1、3、5），前提是它们与当前和弦兼容，而非盲目解决到局部和弦根音。
    3. **复杂和弦的线性规则**: 在 `ToplineEngine.ts` 中添加了特定规则，在复杂和弦（例如 Minor9、Add9、HalfDiminished）上强制级进运动（自然音阶级进）。这防止旋律在怪异的和弦延伸音之间跳跃，保持平滑、独立的旋律线条以锚定和声。
  - `v1.30.0`: **织体分配与融合凝聚（音乐融合精细化）。**
    1. **织体分配整合**: 在 `types.ts` 中添加了 `TextureAllocation` 接口，管理不同音乐元素（贝斯、和弦、鼓、旋律）的密度。将其整合到 `SectionMetadata` 和 `GlobalContext` 中。
    2. **Idiom 中的密度控制**: 更新了 `TextureMapper.ts`，将 `textureAllocation` 乘数应用于贝斯、鼓和钢琴生成的 `grooveDensity`。这允许对每个乐器组的节奏活跃度和复杂度进行段落级别的动态控制。
    3. **融合凝聚**: 精细化了 `TextureMapper.ts` 和 `StructureEngine.ts` 中的融合逻辑，确保当 `fusionProfile` 激活时，所选融合风格一致地应用于指定的乐器角色（例如节奏组 vs. 和声组），防止混乱的独立 idiom 选择，维持统一的音乐输出。修复了融合配置生成中与 `StyleId` 枚举使用相关的 TypeScript 错误。
  - `v1.29.0`: **律动参数整合（音乐融合精细化）。**
    1. **上下文更新**: 向 `PianoIdiomContext`、`DrumIdiomContext` 和 `BassIdiomContext` 添加了 `grooveDensity` 和 `grooveSyncopation`，允许 idioms 响应全局律动参数。
    2. **Idiom 适配**: 更新了所有 Piano、Drum 和 Bass idioms（例如 `PopPianoIdiom`、`FunkDrumIdiom`、`ReggaeBassIdiom`）以利用这些参数进行概率性音符放置、切分、过门生成和力度调整，增强音乐性并减少重复模式。
    3. **TextureMapper 精细化**: 更新了 `TextureMapper.ts`，将 `GlobalContext` 的律动参数传递给 idiom 上下文。精细化了融合逻辑，排除某些"合并"或"别名" idioms 以获得更连贯的跨流派融合。
    4. **StyleGrammar 增强**: 向 `StyleGrammar.melodyRules` 添加了 `tailResolution`、`preferredScales`、`repetitionProbability`、`maxLeap`、`maxTensionPerPhrase` 和 `pitchWeights`，允许更细致、风格特定的旋律生成。更新了 `EDMGrammar`、`FolkGrammar`、`JazzGrammar` 和 `RockGrammar` 以反映这些变更。
  - `v1.28.2`: **调试模式：移除所有音效。** 彻底移除了所有特殊音频效果以简化音频管道并专注于核心 MIDI 生成。从 `AudioMixer.ts` 和 `PlaybackEngine.ts` 中移除了 `applyEDMIntroSweep` 和 `triggerEDMDropEnding`。从 `AudioMixer.ts` 中移除了整个 Lo-Fi DSP 链（`lofiBitcrusher`、`lofiBandpass`、`lofiGainComp`）。从 `PlaybackEngine.ts` 中移除了磁带抖动（LFO Pitch Bend）逻辑和反镲截取。从 `StructureEngine.ts`、`ToplineEngine.ts` 和 `types.ts` 中移除了 `lofiEffect` 标志。
  - `v1.28.1`: **调试模式：禁用 Intro 段落。** 临时禁用了 `StructureEngine.ts` 中所有"Intro"段落的生成，以便更快地调试和测试核心歌曲段落（Verse、Chorus 等）。歌曲结构现在直接从第一个活跃段落（例如 Verse_1 或 Chorus_1）在第 0 拍开始。
  - `v1.28.0`: **冲刺 2：渐慢与四小节交换。**
    1. **渐慢（非线性速度减速）**: 升级 `MidiScheduler.ts` 使用 `requestAnimationFrame` 实现平滑、无抖动的时序。添加了 `TempoCurve` 支持以动态插值 BPM。在 `Orchestrator.ts` 中实现了对适当风格（Ballad、Jazz、NeoSoul 等）在 Outro 最后 2 小节应用指数速度曲线（减速 40%）的逻辑。
    2. **四小节交换（呼应）**: 在 `Orchestrator.ts` 中引入了"呼应状态机"。对于 Jazz 和 Blues 风格，在 `Solo_Bridge` 段落期间，旋律自动被分割为 4 小节块，在主旋律和副旋律乐器之间交替（例如电钢琴和萨克斯），模拟现场即兴演奏。
  - `v1.27.0`: **Outro 生成大修。** 基于"重建蓝图"实现了高级 outro 生成逻辑。
    1. **主题回声（动机碎片化）**: 在 `ToplineEngine.ts` 中添加了 `generateFadingEchoOutro`，从副歌钩子中提取核心动机并将其碎片化（随机丢弃音符、延迟起始以产生自由节奏感、延长时值），并线性降低力度以模拟渐远的记忆。
    2. **Jazz/R&B 标志性结尾**: 在 `HarmonyCore.ts` 中添加了 `injectJazzSignatureEnding`，为 Jazz/R&B 风格在 outro 末尾强制使用 `maj9#11` 和弦声位。在 `PlaybackEngine.ts` 中整合了 MIDI CC 64（延音踏板）以创造浪漫、缭绕的音色。
    3. **EDM/Synthwave 标志性结尾**: 在 `AudioMixer.ts` 中添加了 `triggerEDMDropEnding` 并在 `PlaybackEngine.ts` 中为 EDM 风格触发。使用 Web Audio API 生成短白噪声缓冲区，配合低通滤波器（指数频率下降）和增益包络以模拟大规模声音衰减。
  - `v1.26.0`: **Intro 生成大修。** 基于"重建蓝图"实现了 intro 生成逻辑的全面改造。
    1. **声学三角**: 在 `Orchestrator.ts` 中用状态机替换了随机"裸独奏"逻辑，根据风格和能量等级强制和声支撑（旋律 + 和弦 + 贝斯）。
    2. **主题预示**: 在 `ToplineEngine.ts` 中添加了 `extractForeshadowingIntro`，提取并简化主副歌钩子，将其用作 intro 旋律以创造主题连贯性。以 60% 的概率整合到 `Orchestrator.ts` 中。
    3. **标志性 Riff 生成器**: 在 `TextureMapper.ts` 中添加了 `generateSignatureRiff`，为特定风格（Eurodance、Trance、Synthwave、PopRock、IndieRock）在 intro 期间创建抓耳的切分五声音阶 riff。
    4. **EDM 滤波器扫频**: 在 `AudioMixer.ts` 中实现了基于 Web Audio API 的低通滤波器扫频（`applyEDMIntroSweep`），并在 `PlaybackEngine.ts` 中为 EDM 风格的 intro 段落触发，以最小 CPU 开销模拟经典上升效果。
  - `v1.25.0`: **Lo-Fi 美学与 DSP 链实现。** 为 ESP32-S3 实现了"缺陷即特征"方法。添加了 `StyleId.Lofi` 和 `LofiHipHopStyle` 配置。在 `PlaybackEngine.ts` 和 `MidiScheduler.ts` 中通过 LFO 驱动的 MIDI Pitch Bend 事件实现了"磁带抖动与颤动"，避免了繁重的 DSP 音高移位。在 `DrumIdiom.ts` 中实现了"Dilla 律动"，带有微时序偏移和力度随机化。在 `AudioMixer.ts` 中使用原生 Web Audio 节点（`WaveShaperNode` 用于 bitcrushing、`BiquadFilterNode` 用于电话 EQ）添加了高度优化的 Lo-Fi 总线，以 O(1) CPU 开销模拟复古采样器劣化。
  - `v1.24.0`: **100% Idiom 提取完成。** 将 `TextureMapper.ts` 中剩余的硬编码生成逻辑（`generateCounterMelody`、`generateRiff`、`generateVocalHarmony`）提取到各自专用的 idiom 注册表（`CounterMelodyIdiomRegistry`、`RiffIdiomRegistry`、`VocalHarmonyIdiomRegistry`）。`TextureMapper.ts` 现在是纯委托器，仅作为时间网格和和弦提供者。所有风格特定逻辑完全封装在单独的 idiom 类中（例如 `PopCounterMelodyIdiom`、`GospelVocalHarmonyIdiom`），实现了对开闭原则的完全遵循并最大化了 C++ 可移植性。
  - `v1.23.0`: **Piano Idiom 解耦。** 将所有钢琴伴奏和织体生成逻辑从 `TextureMapper.ts` 提取到专用的 `PianoIdiomRegistry` 和独立的 `IPianoIdiom` 实现（例如 `PopPianoIdiom`、`BossaPianoIdiom`、`FunkPianoIdiom`、`ReggaePianoIdiom`、`ElectronicPianoIdiom`）。`TextureMapper.generateChordTexture` 现在将音符生成的繁重工作委托给基于当前风格注册的 idiom。这移除了大量 `if/else` 块，显著提升了代码可维护性、可测试性和对开闭原则的遵循，进一步为独立节奏风格的 C++ 移植铺平了道路。
  - `v1.22.0`: **语法委托（旋律与和声规则）。** 从 `ToplineEngine.ts` 和 `GlobalReviewer.ts` 中移除了硬编码的旋律规则。引擎现在动态读取 `StyleConfig.melody` 中的 `maxJumpInterval`、`chromaticPassingProbability` 和 `leapResolutionThreshold`。这确保旋律生成（例如半音包围、最大跳进音程）和全局审查（例如跳进解决强制）严格遵循特定风格的语法，提升了风格准确性和 C++ 配置可移植性。
  - `v1.21.0`: **Drum Idiom 解耦。** 将所有鼓生成逻辑从 `TextureMapper.ts` 提取到专用的 `DrumIdiomRegistry` 和独立的 `IDrumIdiom` 实现（例如 `PopDrumIdiom`、`EurodanceDrumIdiom`、`JazzDrumIdiom` 等）。`TextureMapper.generateDrumGroove` 现在纯粹作为委托器，将标准化的 `DrumIdiomContext` 传递给注册的 idiom。这消除了大量 `if/else` 块，显著提升了代码可维护性、可测试性和对开闭原则的遵循，为独立节奏风格的 C++ 移植铺平了道路。
  - `v1.20.0`: **风格纯净性重构。** 彻底消除了代码库中的 `StyleFlags` 和 `StyleFlagTable`，实现纯数据驱动方法。风格特定逻辑（idioms、混音偏好、和声规则）现在完全外部化到 `StyleConfig` 对象（例如 `idiomPreferences.drumStyle`、`mixingPreferences.requireSidechain`）。这确保核心引擎（`TextureMapper`、`TransitionEngine`、`Orchestrator`、`PlaybackEngine`、`HarmonyCore`）对特定流派无感知，仅依赖配置参数。修复了 `MixingConfig` 中缺失的属性并更新了 `InstrumentManager` 以接受可选的混音参数。这通过用结构化配置数据替换硬编码位掩码检查，显著提升了扩展性和 C++ 可移植性。
  - `v1.19.3`: 精细化了 Eurodance 和 EDM 律动生成。在 `TextureMapper.ts` 中，通过将循环步长从 `0.5` 改为 `0.25` 提升了贝斯线量化精度。实现了流派特定的贝斯 idioms：Eurodance 的"Gallop"节奏和"严格反拍贝斯"、Trance 的"滚动 16 分音符"、Synthwave 的"驱动 8/16 分音符"。为这些流派绕过了 `isRiffDriven` 和 `isBassSolo` 逻辑以确保严格的模式遵循。为 EDM 风格禁用了半音贝斯接近和随机持续音以保持根音稳定性。在 `Orchestrator.ts` 中使用 `StyleFlags.STRICT_GRID` 强制严格量化。在 `PlaybackEngine.ts` 中为具有 `StyleFlags.REQUIRE_SIDECHAIN` 的风格实现了"假侧链"效果，使用由底鼓触发的 MIDI CC 11（表情）自动化，压低贝斯、和弦和副旋律轨道以模拟经典 EDM"泵浦"效果。
  - `v1.19.2`: 精细化了旋律生成引擎（`ToplineEngine.ts`），强制严格节奏量化（`validDurations = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0]`），消除了破坏网格的任意数学运算。修复了 `legatoDuration` 以尊重量化时值。调整了 `SingerPersona.ts` 使用干净的 `0.25` 时值作为装饰音替代 `0.08`。在 `Orchestrator.ts` 中全局强制 `melody.pan = 0` 以居中主旋律，并为 Pop 风格优先选择 `Acoustic_Guitar_Nylon` 或 `Electric_Piano_1` 而非 `Alto_Sax`。在 `TextureMapper.ts` 中为 `Pad` 和 `Sustained` 织体强制全音符时值，并通过在主旋律活跃时降低 pad 力度实现了"假侧链"效果。
  - `v1.19.1`: 增强了 `PlaybackEngine.ts` 中的控制台日志，包含贝斯轨道（`pianoLH`）并显示每个音符的时值及音高（例如 `C4(0.5)`）。这改善了生成编配的调试和可视化。
  - `v1.19.0`: 实现了面向 ESP32-S3 优化的"芯片级算法混音规则"。在 `Orchestrator.ts` 中添加了频率区域隔离以防止低频浑浊（Bass E1-B2、PianoRH/CounterMelody >= C3）。在 `PlaybackEngine.ts` 中使用 MIDI CC 11（表情）自动化为 EDM/Pop 底鼓实现了假侧链。添加了基于段落 `energyLevel`（1-8）的动态声像（CC 10）和混响（CC 91）映射，创建"舞台灯光自动化系统"。在所有 7 个乐器角色中基于优先级层（T0-T4）强制执行静态增益分级（CC 7）。在 `AudioMixer.ts` 中配置了总线 DSP（HPF、Peaking EQ、High Shelf、压缩器）作为混音的"粘合剂"。
  - `v1.18.0`: 重构了整个代码库中的 PRNG 使用。将所有 `globalPRNG` 替换为 `PRNGManager` 以强制严格的确定性行为和快照能力（`getState`/`setState`）。这满足了 C++ 可移植性的 PRNG 约束。更新了 `AURA_ARCHITECTURE.md` 以包含核心开发系统指令。
  - `v1.17.0`: 全面重构，将基于字符串的风格标识符替换为整个代码库中的 `StyleId` 枚举。在 `StyleFlags.ts` 中引入了 `StyleFlags` 和 `StyleFlagTable` 用于高效的、基于位掩码的风格分类和能力检查。更新了所有核心生成模块（`Orchestrator`、`TextureMapper`、`HarmonyCore`、`EnsembleDrafter`、`TransitionEngine`）和音频引擎（`InteractivePlaybackEngine`、`LiveLoopingEngine`、`PlaybackEngine`）以使用 `StyleId` 和基于标志的逻辑，消除了容易出错的 `.includes()` 字符串比较，显著提升了类型安全性和 C++ 可移植性。
  - `v1.16.0`: 全面改造了 `ToplineEngine.ts` 中的旋律生成引擎。实现了基于语法的节奏生成（Pick-up、Body、Tail）通过 `StyleGrammar`。添加了微变异算子（Split、Merge、Shift）用于动机变化。整合了 5 个高级旋律原则："9 度即新根音"（PitchWeights）、Meyer 跳进规则与音程惩罚、切分移位（先现音）、五声音阶间隙和音域管理（黄金分割高潮点）。添加了安全保障：不协和预算（maxTensionPerPhrase）和尾部解决。
  - `v1.15.3`: 基于能量等级和 grooveRatio 精细化了鼓律动（低能量时过滤 Crash/Toms，将 Ride/OHH 降级为 CHH，高能量时将 CHH 升级为 Ride/OHH）。为 PianoIdiom 添加了 Bossa Nova（切分和弦）和 EDM（断奏和弦）伴奏风格。为 SynthIdiom 添加了 Pluck 风格（断奏与延迟）。
  - `v1.15.2`: 扩展了乐器 Idioms（P1）。为 PianoIdiom 添加了风格化伴奏（Jazz 装饰音/幽灵和弦、Pop 琶音填充）。为 Synth/Pad/Lead/Arp 创建了 SynthIdiom，具有特定技法（琶音器、滑音/颤音、Pad 渐强/释放）。为 GuitarIdiom 在低能量段落或显式琶音风格中添加了琶音逻辑。
  - `v1.15.1`: 修复了 `ToplineEngine.ts` 中的关键音高钳位 Bug（例如 A8、C#17），将 `if` 语句替换为 `while` 循环以确保音高严格落在乐器安全音域内，防止八度溢出。验证了 `Orchestrator.ts` 中 `chordKeyOffset` 的应用以防止双重移位。
  - `v1.15.0`: 实现了分层风格感知编配系统。添加了 P0 通用基础（低频保护、旋律键音规避、主律动网格）。添加了 P1 风格特定扩展（Orchestrator 中的风格感知编配动态、Bass 乐器 Idiom 引擎）。添加了 P2 律动比率控制器，根据风格和能量动态调整乐器存在感和织体。实现了 P2 声乐和声模块，生成风格特定的声乐和声（Pop/Ballad、R&B/Gospel）。
  - `v1.14.0`: 解决了复杂流派（Jazz、Neo-Soul、R&B）中的系统性和声问题。重构了 `applyStyleSpices` 以尊重功能和声（例如限制 `VI7` 仅出现在 `ii` 之前，`m7b5` 仅在适当音级上）。修复了 `generateHarmonyTimeline` 中的"悬挂经过和弦"，通过严格验证下一段的起始和弦后再插入减和弦或副属和弦经过和弦。引入了 4/8 小节循环末尾的"回转"逻辑（例如 `ii-V`、变格终止）以打破机械重复。为 Jazz/Soul 用固定的、风格适当的进行（例如 Tadd Dameron 回转、扩展 `ii-V-I`）替换了随机 Outro 生成。
  - `v1.13.0`: 修复了关键的和声不稳定性和"Outro 灾难"问题。在 `HarmonyCore.ts` 中强制执行严格的调式检查以防止不正确的大调/小调和弦修饰（例如小调中 `i` 到 `Iadd9`）。为经过和弦（`vii°`、`III7`）实现了"前瞻"目标导向逻辑以确保正确解决。添加了终止式感知以在 Chorus 段落末尾强制 `V7` 或 `Vsus4`。为 EDM 流派（Trance、Eurodance、Synthwave）建立了严格的风格隔离，禁用重新和声化和经过和弦以保持流派纯净性。
  - `v1.12.0`: 向 `ElectronicStyles.ts` 添加了 Eurodance、Trance 和 Synthwave 风格。更新了 `TextureMapper.ts` 以支持 EDM 特定的鼓（四拍底鼓、反拍踩镲、滚动踩镲）和贝斯（反拍、滚动、驱动 8 分音符）模式。精细化了 `ToplineEngine.ts` 以支持 EDM 特定的旋律生成和切分解决。
  - `v1.11.0`: 验证并完成了风格精细化的第 1、2、3 阶段。在 `TextureMapper.ts` 中为直拍节奏和三和弦添加了 `isRock` 和 `isPop` 围栏。在 `HarmonyCore.ts` 中实现了 `getSmoothVoicing` 用于最近转位声部进行。添加了 `Melodic_Minor` 调式、Jazz 无根音声位，以及 `TextureMapper.ts` 中专用的 Jazz Swing 鼓模式。
  - `v1.10.0`: 精细化了生成管道中（`ToplineEngine.ts`、`TextureMapper.ts`、`Orchestrator.ts`）的调号偏移逻辑，正确处理段落级 `localKeyOffset` 和全局 `currentKeyOffset` 而不产生双重移位。添加了 `Bossa_Nova` 和 `Jazz` 风格及正确配置。
  - `v1.9.1`: 精细化了 Aura Bar 布局，使用 ResizeObserver 在所有屏幕尺寸上实现完全比例响应式缩放。
  - `v1.9.0`: 将"Aura Radio"重构为"Aura Bar"，采用新的卡片式轮播 UI。在应用组件内直接实现了统一手势控制（左右滑动、双击、三击）。更新了 `EndlessRadioManager` 以根据所选 bar 的配置（`BarData.ts`）接受特定的 `allowedStyleIds`，确保主题性音乐生成。
  - `v1.8.1`: 精细化了 `ToplineEngine.ts` 以改善无声乐时的旋律生成。区分了 `isVocal`、`isInstrumental`、`isLead` 和 `isSolo` 逻辑，确保器乐主旋律具有适当的旋律复杂度和乐句感。根据乐器角色调整了乐句形式、音符密度、换气/休止概率和装饰音概率，防止重复或过于简单的器乐旋律。
  - `v1.8.0`: 实现了和声色彩增强第 1 阶段。在 `HarmonyCore.ts` 中引入了调式互换（从平行小/大调借用和弦）和副属和弦（V/V、V/vi）。增强了 `applyStyleSpices` 以为 Jazz、J-Pop 和 EDM 添加风格特定的和弦延伸（maj9、m9、9、add9）。更新了 `MusicTheoryRules.ts` 以支持解析和替换这些高级和弦结构。
  - `v1.7.2`: 引入了 R&B Phonetic Rhythm 和 R&B Riffs 机制，增强了 SingerPersona 的 R&B 演唱风格。修复了 SingerPersona.ts 中的语法错误。
  - `v1.7.0`: 使用高级旋律生成技术增强了 `ToplineEngine.ts`。实现了"引爆器"机制，通过追踪 `maxPitchBeforeChorus` 为副歌创造爆发性效果。在 `generateMotifRhythm` 中添加了基于能量等级的"态度与起始位置"逻辑。在 `transformMotif` 中引入了"Switcheroo"变换并将其整合到高级动机发展形式中。
  - `v1.6.0`: 实现了高级 Neo-Soul 音乐特性。使用五声音阶移位和动态旋律简化增强了 `ToplineEngine.ts`。在 `TextureMapper.ts` 中为 Neo-Soul 和 R&B 风格添加了 `Octave_Melody_Bass` 织体逻辑。更新了 `HarmonyCore.ts` 和 `MusicTheoryRules.ts` 以支持 Neo-Soul 特定的声位和重新和声化技术。
  - `v1.5.0`: 将声乐乐器从 `Solo_Vox`（085）更改为 `Marimba`（012）。向系统指令添加了强制代码验证和临时文件清理规则。
  - `v1.4.0`: 彻底移除了 `Meowsynth.sf2` 及所有相关依赖。将所有音频合成统一为使用单个标准 SoundFont（`GM128_3MB.sf2`）。在所有生成和编配逻辑中将 `Meowsynth_Vocal` 乐器替换为 `Solo_Vox`（GM 程序 85）。验证了 1:1 音色一致性和正确的 MIDI 通道分配。
  - `v1.3.0`: 彻底从 `package.json` 和源代码中移除了所有 `Tone.js` 依赖。重构了 `LedMatrix` 和 `WebSimulatorHAL` 以使用原生 Web Audio API 和 `spessasynth_lib`。通过强制执行严格的 MIDI 驱动混音和调度，确保了与 ESP32-S3 的 1:1 音色一致性。
  - `v1.2.0`: 根除了 Tone.js 依赖。引入了 `MidiScheduler` 以模拟 ESP32 FreeRTOS 定时器任务。所有音频混音和播放现在严格通过 `spessasynth_lib`（SF2）的 MIDI 驱动。
  - `v1.1.0`: 添加了全面的 AI 辅助移植指南，详述了组件耦合、SPI/I2S 映射、内存优化（TrackSerializer）和"黄金种子"验证方法。
  - `v1.0.1`: 将所有 `Math.random()` 替换为 `globalPRNG.next()` 以实现确定性生成。将 `EndlessRadioManager` 重构为纯 TS 类以与 React hooks 解耦。
  - `v1.0.0`: 初始架构文档，定义了 HAL 接口、PRNG 和 C++ 移植指南。

---

## AuraRadio 核心开发系统指令

### 🎯 角色定义
你是一名顶级 C++/TypeScript 嵌入式固件工程师和生成式音乐算法专家。你的核心使命是开发和维护 AuraRadio 的音乐生成引擎。

你必须深刻理解：当前 TypeScript/Web 代码仅仅是物理硬件（ESP32-S3）的高保真模拟和预研环境。`/src/core/generation/` 目录下的所有代码最终必须 1:1 无缝无损地翻译为 C/C++ 代码，以运行在资源受限的微控制器上。

### 🛑 关键约束

#### 1. 内存与 C++ 可移植性
- **禁止动态特性**: 严格禁止使用高度动态的 JavaScript 特性（例如动态添加对象属性、反射、`eval`、动态字符串键查找）。
- **扁平数据结构**: 生成引擎输出的所有数据必须是纯数据，能够直接映射到 C++ `struct`（例如 `NoteData` 必须是包含 `pitch`、`onset`、`duration`、`velocity` 的扁平结构）。
- **零 GC 意识**: 在生成循环中（例如遍历拍位、生成音符），严格禁止频繁使用会生成大量临时对象的语法，如 `new Object()`、`.map()`、`.filter()`。尽可能复用数组或使用原始数据类型。
- **环境隔离**: `/src/core/generation/` 目录严格禁止导入任何 React 依赖（`useState`、`useEffect`）、DOM API（`window`、`document`）或 Web Audio API（`Tone.js`）。

#### 2. 绝对确定性与 PRNG 约束
- **禁止原生随机**: 全局严格禁止使用 `Math.random()`。
- **统一随机源**: 所有随机数必须且只能通过 `PRNGManager.next()` 获取。
- **状态快照支持**: 任何生成阶段的入口点必须支持通过 `PRNGManager.getState()` 捕获快照并通过 `PRNGManager.setState()` 恢复，以确保单模块的独立测试和可复现性。**相同种子 + 相同输入 = 完全相同的输出。**

#### 3. 状态管理与数据流
- **禁止全局可变状态**: 严格禁止模块读写全局单例（如向旧 `GlobalContext` 写入）。
- **显式上下文传递**: 音乐上下文必须通过 `MusicContext` 结构体显式传递。生成引擎输出 `MusicContext`，编配引擎接收 `MusicContext` 作为参数。
- **优先使用枚举与位掩码**: 风格 ID 必须使用 `StyleId`（枚举）。风格分类匹配严格禁止使用字符串 `.includes()`；必须使用 `StyleFlags` 进行按位与操作，确保 C++ 中的极速查表。

### ⚙️ 四模块管道接口契约

整个生成管道必须严格遵循此单向数据流。不可越级、不可逆向、不可跳步：

#### 模块 1: PRNGManager（随机数管理）
- **职责**: 维护 LCG 状态，为整个管道提供唯一的随机数序列。
- **接口**: `setSeed(seed: number)`、`next(): number`、`getState(): number`、`setState(state: number)`

#### 模块 2: MelodyEngine（生成引擎）
- **职责**: 确定宏观结构、和声进行和主/副旋律（Topline）。
- **接口**: `generateFullSong(styleId: StyleId, options?: GenerationOptions): { track: GeneratedTrack, context: MusicContext }`
- **约束**: 同步执行，纯数据输出。内部以固定顺序消耗 PRNG。

#### 模块 3: Orchestrator（编配引擎）
- **职责**: 将单线旋律展开为 7 个具体乐器轨道（Vocal、Melody、SecMelody、PianoLH、PianoRH、Drums、CounterMelody），应用乐器惯用法。
- **接口**: `arrange(track: GeneratedTrack, styleId: StyleId, context: MusicContext): ArrangedTrack`
- **约束**: 同步执行。只读 `MusicContext`，不修改原始 `GeneratedTrack`，输出完整的 `ArrangedTrack`。

#### 模块 4: PlaybackEngine（MIDI 转换层）
- **职责**: 将音符数据转换为底层 MIDI 事件序列。
- **接口**: `convert(arranged: ArrangedTrack, styleId: StyleId): MidiEvent[]`
- **约束**: 纯数据映射，不消耗 PRNG。输出的 `MidiEvent[]` 是生成管道的绝对终点。

### 📝 强制文档更新规则

每当你修改以下任何内容时：
- 核心算法逻辑（例如旋律生成、和声推导、律动算法）
- 接口签名（参数类型、返回值结构）
- 架构管道流程（管道顺序、模块职责）
- 数据结构（结构体/接口的添加/修改/删除）

你**必须**在**同一对话轮次内**主动编辑和更新根目录下的 `AURA_ARCHITECTURE.md` 文件：
1. 找到 `## 版本信息 -> 更新日志`。
2. 递增版本号（遵循语义化版本：重大重构 -> Minor，Bug 修复 -> Patch）。
3. 详述本次变更内容、涉及的模块以及对 C++ 移植的影响。
4. 如果修改了接口或数据流，必须同步更新文档中的 ASCII 流程图或接口表。

### 🛠️ 执行标准

- **行动胜于言辞**: 少解释，多写代码。直接使用工具修改文件。
- **严格遵循现有接口**: 添加新功能时，优先复用 `types.ts` 中的现有结构。如果必须添加新结构，思考："这个结构在 C++ 中会消耗多少内存？能否序列化？"
- **清理幽灵代码**: 重构时，主动查找并删除未使用的废弃变量、未引用的文件和冗余的 `console.log`。保持代码库极度整洁。
- **语言**: 所有沟通必须严格使用中文。

---

## 1. 架构概述
AuraFlow 采用**核心逻辑（音乐引擎）**与**平台层（Web/ESP32）**严格分离的设计。
模拟器使用 React 和 WebAssembly（SpessaSynth），但核心引擎必须保持平台无关性，以允许 1:1 翻译为 C/C++ 运行在 ESP32-S3 上。

### 目录结构
- `/src/core/generation/`: 纯音乐理论与生成算法。**（必须是 100% 可移植的 C++ 逻辑）**
- `/src/core/hal/`: 硬件抽象层。定义 I/O 接口。
- `/src/core/audio/`: Web 专用音频实现（SpessaSynth + MidiScheduler）。**（ESP32 上将被 I2S/Synth 替代）**
- `/src/apps/`: 应用状态机。**（应为纯 TS 类，非 React hooks）**
- `/src/components/`: 模拟器的 React UI 组件。**（ESP32 移植时忽略）**

---

## 2. 音乐生成管道
管道严格按顺序执行且数据驱动。它不播放音频；它生成 `GeneratedTrack` 数据结构。

1. **输入与种子**: 用户交互以特定 PRNG 种子触发生成。
2. **结构引擎 (`StructureEngine.ts`)**: 确定段落（Intro、Verse、Chorus）及长度。
3. **和声引擎 (`HarmonicEngine.ts`)**: 基于调式和风格生成和弦进行。
4. **律动与旋律 (`ToplineEngine.ts`)**: 生成节奏指纹和旋律音符。
5. **编配 (`Orchestrator.ts`)**: 将音符分配给具体乐器（Piano、Drums、Bass）。
6. **输出**: 返回包含纯音符数据（`pitch`、`onset`、`duration`、`velocity`）的 `ArrangedTrack`。

---

## 3. 硬件抽象层（HAL）映射
移植到 ESP32-S3 时，`/src/core/hal/IHardware.ts` 中的 TypeScript 接口直接映射到 ESP-IDF 驱动：

| TS 接口 | 模拟器实现 | ESP32-S3 实现 (C/C++) |
| :--- | :--- | :--- |
| `ILedMatrix` | React State + CSS Grid | **SPI / RMT** (WS2812B / APA102 驱动) |
| `ITouchPad` | DOM `onPointerDown` | **I2C** (例如 CST816S) 或原生 Touch Pad |
| `IAudioOut` | SpessaSynth (SF2) + MidiScheduler | **I2S** (例如 MAX98357A) + FluidSynth/TinySoundFont |
| `ISystemTimer` | `setTimeout` / `performance.now()` | `vTaskDelay()` / `esp_timer_get_time()` |

---

## 4. C/C++ 移植开发标准（关键）

为确保 TS 代码可以轻松翻译为 ESP32-S3 的 C/C++，`/src/core/` 中所有未来开发**必须**遵守以下规则：

1. **核心禁止 React**: 永远不要在 `/src/core/` 内使用 `useState`、`useEffect` 或 JSX。核心逻辑必须是纯 TS 类或函数。
2. **确定性随机**: 永远不要使用 `Math.random()`。始终使用 `/src/core/utils/PRNG.ts` 中的 `PRNGManager.next()`。这确保相同种子在 Web 和 ESP32 上产生相同的歌曲。
3. **内存管理（避免 GC）**:
   - 避免在紧密循环中创建对象（例如 `new Object()`、`.map()`、`.filter()`）。
   - 尽可能使用预分配数组或 TypedArray（`Uint8Array`、`Float32Array`）。
   - 在 C++ 中，这些将映射到静态数组或内存池，以防止 ESP32 上的堆碎片和 OOM 崩溃。
4. **纯数据结构**: 生成引擎的输出必须是纯数据（可 JSON 序列化）。最终的 `ArrangedTrack` 对象中不可有函数或类实例。
5. **禁止 Tone.js**: 所有音频调度必须使用 `MidiScheduler`。所有混音必须使用 MIDI CC 消息（CC 7 用于音量、CC 10 用于声像、CC 91 用于混响）。

---

## 5. AI 辅助移植指南（面向固件工程师与 Claude/AI）

如果你是 AI 助手或负责将此代码库移植到 ESP32-S3 的固件工程师，请仔细阅读本节以了解系统的边界和耦合关系。

### 5.1 代码分离：保留与替换
- **不要修改（1:1 移植到 C++）**: `/src/core/generation/` 和 `/src/core/utils/PRNG.ts` 中的所有内容。这是纯算法逻辑。将 TS 类直接翻译为 C++ 类。TS 的 `number` 根据上下文变为 `float` 或 `uint8_t`。
- **替换（硬件特定）**: `/src/core/hal/` 和 `/src/core/audio/` 中的所有内容。你必须编写实现 HAL 接口和 MIDI Scheduler 的 C++ 类。
  - `ILedMatrix` -> 使用 ESP-IDF **SPI Master** 驱动或 **RMT** 外设驱动 WS2812/APA102 LED 来实现。
  - `ITouchPad` -> 使用 ESP-IDF **I2C** 驱动从触摸控制器（例如 CST816S）读取来实现。
  - `MidiScheduler` -> 使用 FreeRTOS 定时器任务（`vTaskDelay`）实现，读取 MIDI 事件队列并推送到 SF2 引擎。

### 5.2 组件耦合与数据流（如何连接）
为防止乐器"各自为政"（音符冲突、节奏不同步），架构强制执行严格的**自顶向下、共享上下文数据流**：
1. **风格与配置 (`StyleRegistry`)**: 定义全局规则（BPM 范围、允许的和弦、乐器）。
2. **宏观结构 (`StructureEngine`)**: 将歌曲分为段落（Intro、Verse、Chorus）。
3. **全局和声 (`HarmonyCore`)**: 为每个段落生成单一、统一的和弦进行。**关键**: 所有乐器（主旋律、贝斯、伴奏和弦）**必须**引用完全相同的 `HarmonyState`。它们不可自行生成和弦。
4. **全局律动 (`GrooveEngine`)**: 生成统一的节奏网格（切分、摇摆）。
5. **编配 (`Orchestrator`)**: 充当调度器。它接收全局和声和全局律动，并将其传递给特定的 **Idioms**。
6. **Idioms (`PianoIdiom`、`BassIdiom`、`StringIdiom`)**: 这些是乐器特定的渲染器。它们接收共享的 `HarmonyState` 并将其翻译为乐器特定的 `NoteData`（例如 BassIdiom 只演奏共享和弦的根音/五音；PianoIdiom 演奏块状和弦）。这保证了音乐的凝聚性。

### 5.3 内存管理与 C++ 结构体映射
JavaScript 使用垃圾回收。ESP32-S3 在音频循环中动态分配对象会崩溃（OOM）。
- **TS `NoteData`** 必须翻译为紧凑的 C 结构体：
  ```cpp
  struct NoteData {
      uint8_t pitch;       // 0-127 MIDI 音符
      uint8_t velocity;    // 0-127
      float onset;         // 拍位位置
      float duration;      // 拍长
  };
  ```
- **避免 `std::vector` 重新分配**: 为音符预分配数组（例如 `NoteData trackBuffer[1024]`）。参见 `/src/core/utils/TrackSerializer.ts` 了解我们如何在 TS 中使用 `Float32Array` 模拟这种扁平内存布局。

### 5.4 验证策略（"黄金种子"测试）
如何证明你的 C++ 移植与此 Web 模拟器 1:1 准确？
1. **固定种子**: 在 Web 模拟器中硬编码 `PRNGManager.setSeed(12345)`。
2. **生成与导出**: 运行生成管道并将结果 `ArrangedTrack` 序列化为 JSON 文件（或使用 `TrackSerializer` 获取二进制缓冲区）。
3. **运行 C++ 移植**: 在 ESP32（或 PC C++ 测试构建）上，用 `12345` 初始化移植的 PRNG。运行移植的生成管道。
4. **比较**: 结果 C++ 结构体**必须**与 Web 模拟器的输出逐字节匹配。如果任何一个音符的 `onset` 或 `pitch` 不同，你的 C++ 移植就有逻辑错误（通常是浮点精度问题、不同的数组排序算法或遗漏的 `PRNG.next()` 调用）。

---

## 6. 接口使用说明与调用逻辑

### 6.1 HAL 接口 (`/src/core/hal/IHardware.ts`)
这些接口定义了操作系统逻辑与物理硬件之间的边界。
- **`IAudioOut`**:
  - *Web*: 由 `AudioEngine` 处理（SpessaSynth + Web Audio API）。
  - *ESP32*: 必须使用 I2S DMA 实现。`playNote` 和 `stopNote` 方法应将 MIDI 事件推送到运行在 ESP32 上的 FluidSynth/TinySoundFont 引擎。
- **`ILedMatrix`**:
  - *Web*: 通过 React 状态模拟（`LedMatrix.tsx`）。
  - *ESP32*: 使用 SPI 或 RMT 实现。`setPixel` 方法写入帧缓冲区，`update` 通过 DMA 将缓冲区刷新到 LED。
- **`ITouchPad`**:
  - *Web*: 通过 DOM 指针事件模拟。
  - *ESP32*: 使用 I2C 从触摸控制器读取。`getTouchState` 读取当前寄存器，而 `onPadDown`/`onPadUp` 应由映射到 FreeRTOS 队列的硬件中断（ISR）触发。
- **`ISystemTimer`**:
  - *Web*: 使用 `performance.now()` 和 `setTimeout`。
  - *ESP32*: 使用 `esp_timer_get_time()` 获取微秒精度，使用 `vTaskDelay()` 进行阻塞延迟。

### 6.2 音频调用逻辑（MIDI 管道）
1. **事件生成**: `PlaybackEngine` 或 `LiveLoopingEngine` 读取 `ArrangedTrack` 数据并将其转换为 `MidiEvent` 对象。
2. **调度**: 这些事件被推送到 `globalMidiScheduler`（`MidiScheduler.ts`）。
3. **执行**: 调度器使用前瞻循环（模拟 FreeRTOS 定时器任务）。当事件时间到达时，它调用 `spessaSynth` 实例上的相应方法（例如 `noteOn`、`noteOff`、`controllerChange`）。
4. **混音**: 所有混音（音量、声像、混响）通过在音符播放之前或期间向特定 MIDI 通道发送 MIDI Control Change（CC）消息完成。不使用 Web Audio API GainNode 进行分轨混音。

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

> 本文档描述的是**目标接口设计**。以下列出与当前源码实现的具体差异。
> 
> **v1.34.0 更新**：生成管道核心部分（`/src/core/generation/`）的 GlobalContext 解耦已 100% 完成。
> 标记 ✅ 的项表示源码已与框架对齐。

| 项 | 当前源码 | 本框架 | 状态 |
|---|---|---|---|
| **基础设施** | | | |
| styleId 类型 | `StyleId`（enum 数值） | `StyleId`（enum 数值） | ✅ 已对齐 |
| 风格分类方式 | `StyleFlagTable[styleId]` 位掩码查表 | `StyleFlagTable[styleId]` 位掩码查表 | ✅ 已对齐 |
| 风格配置查询 | `getStyleConfig(id: string)` 哈希表查找 | `StyleConfigTable[styleId]` 静态数组直接寻址 | 待迁移 |
| PRNG 管理 | `PRNGManager` 模块 | `PRNGManager` 模块 | ✅ 已对齐 |
| 音乐上下文传递 | `MusicContext` 显式传递（生成管道内零 GlobalContext） | `MusicContext` 结构体，显式传递 | ✅ 已对齐 |
| idiomPreferences 类型 | `IdiomPreferences` / `RuntimeIdiomPreferences` 接口 | 类型化接口 | ✅ 已对齐 |
| 浮点比较 | `Math.abs(x - y) < 1e-6` epsilon 容差 | epsilon 容差 | ✅ 已对齐 |
| **生成引擎** | | | |
| 生成引擎参数签名 | `generateFullSong(styleId: StyleId)` | `generateFullSong(styleId: StyleId)` | ✅ 已对齐 |
| 生成引擎返回值 | `{ track: GeneratedTrack, context: MusicContext }` | `{ track: GeneratedTrack, context: MusicContext }` | ✅ 已对齐 |
| HarmonyCore 参数 | `generateHarmonyTimeline(sections, style, timeSig, tonality, keyOffset)` | tonality/keyOffset 显式传递 | ✅ 已对齐 |
| **编配引擎** | | | |
| 编配引擎参数 | `arrange(track, styleId: StyleId, context: MusicContext)` | `arrange(track, styleId: StyleId, context: MusicContext)` | ✅ 已对齐 |
| TextureMapper 上下文 | `TextureRenderContext` 显式注入（零 GlobalContext fallback） | 显式参数传递 | ✅ 已对齐 |
| Bass Idiom 上下文 | `BassIdiomContext` 含 beatsPerBar/activeSection/keyOffset/grooveDNA | 显式参数传递 | ✅ 已对齐 |
| Groove 判定函数 | `BaseBassIdiom.isGrooveHit()` 等纯静态方法 | 纯函数，无全局状态 | ✅ 已对齐 |
| **播放引擎** | | | |
| 生成管道终点 | `AudioEngine.playSong()` 内调用 `Orchestrator.arrange()` + `PlaybackEngine.loadSong()` | 独立 `PlaybackEngine.convert()` 纯函数输出 `MidiEvent[]` | 待迁移 |
| **外围（平台层，不受 Pipeline Rule 管辖）** | | | |
| 播放引擎参数 | `playSong(track, style: StyleConfig, ...)` | `playSong(track, styleId: StyleId, context: MusicContext, ...)` | 待迁移 |
| 历史栈存储 | `{ track: GeneratedTrack, style: StyleConfig }` | `{ track: GeneratedTrack, styleId: StyleId, context: MusicContext }` | 待迁移 |
| GlobalContext 平台层使用 | `/src/core/audio/`、`/src/apps/`、`/src/components/` 仍引用 | 不受 Pipeline Rule 管辖 | N/A |

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

**结论：全部 7 项替换零差异可行。其中生成管道核心项已于 v1.34.0 完成实施。**
- StyleId enum 替换 string：✅ 已实施
- GlobalContext → MusicContext 显式传递：✅ 已实施（v1.34.0，生成管道内零 GlobalContext）
- globalPRNG → PRNGManager：✅ 已实施
- userMotifRoot 类型 enum 化：✅ 零差异
- detectedTonality enum 化：✅ 零差异
- motifExpertise 删除：✅ 零差异
- 返回值 { track, context }：✅ 已实施
