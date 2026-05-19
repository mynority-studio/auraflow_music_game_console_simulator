# 变更日志

> **当前版本:** 1.36.0 | **最后更新:** 2026-05-19

- `v1.36.0`: **钢琴织体重构 + Band UI 解封 (The Pianist Update)**。
  1. **A3a 钢琴左手壳和弦 (M7_ShellWithComping)**: 有 Bass 乐手时，钢琴 LH 不再 Tacit 整段静音；改弹 guide tone shell（3+7 / 3+7+9 / root+3+7 三变体按 chordIdx×barInPhrase×colorBias 确定性切换）。新增 `LHTexture.ShellVoicing` + `renderLHShellVoicing` / `applyRhListenToLhShell`。
  2. **A2 右手 Rootless / Quartal / 9-11-13 延伸**: 新模块 `primitives/RootlessVoicer.ts`。Recipe 加 `voicingMode?: 'tertian'|'rootless'|'quartal'`；rootless 删 root + 按 colorBias 阶梯加 9/11/13，含 Minor 9th avoid filter + Dom7 用 #11（Lydian Dominant）。NeoSoulVamp / Funk16Stab 默认 `rootless`。
  3. **A1 BassIdiom Chord-Scale Walking**: BassIdiom 从 87 行扩到 282 行，接入 `BassWalkPatterns` 字母语法 8 规则（B/5/3/A/N/=/C/S）。`MusicianPersona.walkPatternId` 新字段；frank_bass=HalfNote / maya_slap_bass=LatinTumbao。voice leading 就近原则跨和弦保持连贯。
  4. **A3b 跨 chord Diatonic Approach**: Walking `A` 规则从固定 chromatic -1 半音升级为 `CHORD_SCALE_INTERVALS` 内最近 1~2 半音 diatonic neighbor。例：Dm7→G7 现在用 F 代替 F#。
  5. **Stage5Layering Bass/Drums roster-aware (C2)**: roster.bass / roster.drums 为 null（UI ⊘ Empty）时彻底跳过对应 Idiom 渲染，不再回退 `bundle.personas[ROLE_BASS]`。
  6. **MusicianCard topology 解封 (C1)**: alex_piano / marcus_neosoul_piano 补 lickPool + topologyConfig，Lead Lick 拼接路径的 invert/reverse/expand/sideSlip 算法变换从此真正可触发。
  7. **B1+B2 Band UI 三态 + Instrument 下拉**: BandSelection dropdown 现有 🎲 Default / ⊘ Empty / 乐手 三选项。每个 slot 下方新增 Instr. 下拉，基于 active musician 的 instrumentRef 推出同家族 GM 选项（钢琴 14 / 贝斯 8 / 鼓 6 kit / Pad 8）。
  8. **B3 ArrangedTrack 动态 GM Program**: 新文件 `data/GMSoundMap.ts`。`ArrangedTrack.gmProgramOverrides` 字段，由 `PipelineRunOptions.forcedGmPrograms` 透传，MidiConverter 用 override 覆盖文件级 `GM_PROGRAM_*` 默认。仅显式选择时填充 → 保 V5.x lead vs comping 音色对比零回归。

- `v1.35.0`: **算法引擎全面解封与技术债清零 (The Musicality Update)**。
  1. **旋律引力模型**: ToplineEngine 引入局部目标音打分，产生强烈的线条感。
  2. **拓扑封印解除**: 恢复 Persona 变异概率，新增 `BarLineShift` 算子实现醉酒律动。
  3. **乐句模板池**: MacroProgressionEngine 支持预置罗马数字骨架，提升长线结构美。
  4. **Ghost Rendering 拼接**: 在高潮段落支持直接拼接大师 Lick，严格保证 0 PRNG 污染。
  5. **鼓组与拍号解封**: 移除 16-Step/4/4 硬编码；支持 Crash 与 Tom 鼓动态过门。
  6. **技术债清零**: 引入连续反拍强制收敛、Kick-Bass 律动锁定对齐、CC11 伪侧链，以及能量断崖自动缓冲。全量验证黄金种子。

<details>
<summary>v1.34.0 — v1.30.0（点击展开）</summary>

- `v1.34.0`: **生成管道 Rule 全面合规 — S-2/T-3/D-4/T-4 违规清零。**
  1. **S-2 GlobalContext 解耦（完成）**: 移除了 `/src/core/generation/` 中所有 `GlobalContext` 的导入、读取和写入。上下文现在通过 `MusicContext` 返回值、`TextureRenderContext` 参数、`BassIdiomContext` 字段和方法参数链显式传递。从 MelodyEngine、ToplineEngine 和 Orchestrator 中移除了 `initializeNewEra()` 和 `updateCurrentSlice()` 调用。
  2. **Bass Idiom S-2 合规**: 向 `BassIdiomContext` 添加了 `beatsPerBar`、`activeSection`、`keyOffset`、`grooveDNA`。将 `isGrooveHit`/`isLayeringHit`/`isInterleavingHit` 提取为 `BaseBassIdiom` 上的纯静态方法，替代 GlobalContext 单例调用。
  3. **HarmonyCore S-2 合规**: 向 `generateHarmonyTimeline`、`generateDynamicProgression`、`generateFromFunction` 和 `applyStyleSpices` 添加了 `tonality` 和 `keyOffset` 参数。替换了内部 14 处 `GlobalContext.currentTonality`/`currentKeyOffset` 读取。
  4. **T-3 `any` 类型消除**: 在 `types.ts` 中定义了 `IdiomPreferences` 和 `RuntimeIdiomPreferences` 接口。替换了所有 Performance Idioms、Bass/Drum Idiom 上下文和 `InstrumentIdiom` 调度器中约 30 处 `idiomPreferences?: any`。
  5. **D-4 浮点 Epsilon 合规**: 将 drum/bass/piano/vocal/transition idioms 中约 22 处浮点 `===` 比较替换为 `Math.abs(x - target) < 1e-6`。
  6. **T-4 类型断言清理**: 移除了已类型化 `idiomPreferences` 上的冗余 `as` 强转，将 `passingType as any` 收窄为具体联合类型并附加安全注释。
- `v1.33.0`: **全局冲刺回顾与次世代打磨。**
  1. 动机发展：`ToplineEngine.ts` 添加高级动机变换（`_split`、`_merge`、`_shift`）。
  2. 经过和弦与声部规避：`TextureMapper.ts` 添加 `truncateToChordEnd`。
  3. 动态鼓过门：`TransitionEngine.ts` 使用 `energyDelta` 动态缩放过门复杂度。
- `v1.32.3`: **关键 Bug 修复：反转的关系小调逻辑与双重降号。**
- `v1.32.2`: **关键 Bug 修复：双重移调与小调根音计算。**
- `v1.32.1`: **Bug 修复：音阶冲突、网格塌陷和和弦垫音泄漏。**
- `v1.32.0`: **动态乐句结构生成（情绪驱动）。** MoodConfig.phraseActionBias 驱动乐句标签概率性生成。
- `v1.31.0`: **情感偏向自适应引擎。** 引入 MoodId/MoodConfig 解耦 BPM/密度/能量上限。动态 Idiom 路由。
- `v1.30.5`: 修复未定义变量与 Linter 错误。
- `v1.30.4`: **Idiom 重构（基于特征的命名）。** PopBassIdiom→SteadyBassIdiom 等。
- `v1.30.3`: 修复构建错误与清理未使用风格。
- `v1.30.2`: 回退旋律与跨界功能。
- `v1.30.1`: 旋律生成精细化（轮廓与解决）。
- `v1.30.0`: 织体分配与融合凝聚。

</details>

<details>
<summary>v1.29.0 — v1.20.0</summary>

- `v1.29.0`: 律动参数整合（grooveDensity/grooveSyncopation 注入 Idiom 上下文）。
- `v1.28.2`: 调试模式：移除所有音效。
- `v1.28.1`: 调试模式：禁用 Intro 段落。
- `v1.28.0`: Ritardando 渐慢算法 + Trading Fours 呼应状态机。
- `v1.27.0`: Outro 生成大修（主题回声、Jazz 签名结尾、EDM Drop 结尾）。
- `v1.26.0`: Intro 生成大修（声学三角、主题伏笔、签名 Riff、EDM 滤波扫频）。
- `v1.25.0`: Lo-Fi 美学与 DSP 链。
- `v1.24.0`: 100% Idiom 提取完成（CounterMelody/Riff/VocalHarmony）。
- `v1.23.0`: Piano Idiom 解耦。
- `v1.22.0`: Grammar 委托（旋律与和声规则外部化到 StyleConfig）。
- `v1.21.0`: Drum Idiom 解耦。
- `v1.20.0`: 风格纯净化重构（消除 StyleFlags，纯数据驱动）。

</details>

<details>
<summary>v1.19.0 — v1.0.0</summary>

- `v1.19.3`: 精细化 Eurodance/EDM 律动生成。
- `v1.19.2`: 精细化旋律引擎（严格节奏量化）。
- `v1.19.1`: 增强 PlaybackEngine 控制台日志。
- `v1.19.0`: "芯片级算法混音规则"（Zone Isolation、Fake Sidechain、Dynamic Panning）。
- `v1.18.0`: PRNG 统一重构（globalPRNG → PRNGManager）。
- `v1.17.0`: StyleId 枚举化 + StyleFlags 位掩码全面替换字符串。
- `v1.16.0`: 旋律引擎大修（Grammar-Based 节奏、微突变算子、5 大旋律原则）。
- `v1.15.3`: 鼓律动精细化 + Bossa Nova/EDM 钢琴伴奏 + Pluck 合成器。
- `v1.15.2`: 扩展乐器惯用法（Jazz Piano、Synth Arp/Pad、Guitar Arpeggio）。
- `v1.15.1`: 修复音高钳位 Bug（A8/C#17 溢出）。
- `v1.15.0`: 分层风格感知编配系统。
- `v1.14.0`: 系统性和声问题修复（Jazz/Neo-Soul 悬挂经过和弦、Turnaround）。
- `v1.13.0`: 和声不稳定性修复（调性校验、Cadence 感知、EDM 风格隔离）。
- `v1.12.0`: 新增 Eurodance/Trance/Synthwave 风格。
- `v1.11.0`: 风格精细化 Phase 1-3（Rock/Pop 围栏、Jazz Swing 鼓、平滑声部进行）。
- `v1.10.0`: 调号偏移逻辑精细化 + Bossa Nova/Jazz 风格。
- `v1.9.x`: Aura Bar 卡片轮播 UI + 响应式布局。
- `v1.8.x`: 器乐旋律精细化 + 和声色彩增强（Modal Interchange、Secondary Dominants）。
- `v1.7.x`: ToplineEngine 高级技法（Detonator、Switcheroo、R&B Phonetic Rhythm）。
- `v1.6.0`: Neo-Soul 特性（五声音阶移位、八度旋律贝斯）。
- `v1.5.0`: 声乐乐器更换（Solo_Vox → Marimba）。
- `v1.4.0`: 移除 Meowsynth.sf2，统一 GM128 音色。
- `v1.3.0`: 完全移除 Tone.js。
- `v1.2.0`: 引入 MidiScheduler（模拟 FreeRTOS 定时器）。
- `v1.1.0`: AI 辅助移植指南。
- `v1.0.1`: Math.random() → globalPRNG.next()。
- `v1.0.0`: 初始架构文档。

</details>
