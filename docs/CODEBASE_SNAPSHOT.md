# AuraFlow Tap! — 代码库快照（涌现式音乐性重构）

> **生成时间**：2026-05-07（战役一：动机引擎 Motif Engine + 战役二：伴奏织体升维 Arrangement Ascension + 战役三：去模板化与风格矩阵裂变 Style Diversification + 战役四：纯化标品 + ACG 双键盘宇宙）
> **目的**：记录新生成引擎 Phase 1~6 的代码状态。在 V7.6 Idiom 数据驱动基线之上，本轮新增「涌现式音乐性（Emergent Musicality）」重构 —— 废除"一小节一换"和弦模板，引入 (1) 和声节奏分裂（`'vi,IV'` 子小节解析）(2) 抢拍 Anticipation（高能段非段首 30% 提前 0.5 拍）(3) 基于张力曲线的 Viterbi 智能重配（动态候选池 + tensionMultiplier + 半音平滑 + bVI→V 黄金进行，让 1-6-b6-5 神级编配自发涌现）。Bass register 锁定改为 K-2 转换后 per-note octave fold（[28, 43] G2 甜区）。
> **范围**：`src/`、`scripts/`、根目录配置文件
> **不包含**：`node_modules/`、`dist/`、`public/` 静态资源、`docs/` 旧设计文档
>
> **重构进度**：
> - ✅ Phase 1 — 双钢琴基础管线贯通（HarmonyCore 4 和弦循环 + 单音旋律 + 柱式伴奏）
> - ✅ Phase 2 — 节奏-轮廓-引力旋律引擎（ToplineEngine + RhythmCells + MusicTheory.snapToPool）
> - ✅ Phase 3 — 织体与平滑声部连接（TextureMapper Pad/Arpeggio/Comping + getSmoothVoicing）
> - ✅ Phase 4 — 全乐队 + 风格化和声 + 鼓组（HarmonyCore 用 StyleConfig 池 + GrooveEngine + Orchestrator 抽乐器）
> - ✅ Phase 5 — Mood 系统接通 / 副旋律 / ConductorPlanner / StructureEngine / Viterbi 双阶段和声
> - ✅ V7.6 Idiom 重构 — InstrumentIdiom 契约 + IdiomRegistry + 汽配前置；ToplineEngine 剥离呼吸常量、TextureMapper 剥离 isGuitar/isSynth 判断、Orchestrator 移除 pickInst 抽卡
> - ✅ 涌现式音乐性重构 — HarmonyCore 子小节分裂 + 抢拍；ViterbiChordSelector 动态候选池 + 张力门 + 半音平滑/bVI→V 黄金进行；pipeline 按段独立 reharmonize 传 tensionMultiplier；Orchestrator bass per-note fold 到 [28, 43]；MusicTheory.parseNumeral 单一严格正则修复 IVadd9 回退 bug
> - ✅ 反浑浊开放排列 — `MusicTheory.getSmoothVoicing` 第二阶段：和弦音 ≥4 时扫描相邻二度对，凡距离 ≤2 半音即把上方音拔高八度并重新排序，迭代上限 5 次。专治 Viterbi 引入 maj9/m11/13 后挤压在同八度内的"音簇浑浊"听感
> - ✅ Idiom Lead/Comping 拆分 — `InstrumentIdiom` 拆为 `LeadIdiom`（呼吸 + humanizeVelocity / legatoRatio / graceNoteProbability）+ `CompingIdiom`（strumDelay / compingPattern / compingDuration / allowDrop2）；ToplineEngine 注入"行云流水"后处理：踏板连奏 + 力度抖动 + 大跳 32 分倚音；TextureMapper 属性访问改 `.comping.X`；4 个预设 Idiom（Piano/VocalWind/Guitar/SynthPulse）按拆分重写，钢琴主奏满血（humanize 0.1 / legato 1.1 / graceNote 0.35），合成器保持机械感
> - ✅ 跨调一致性修复（本轮）— 解决 Viterbi 借调和弦（bII / V7 等）下主旋律仍死咬自然小调与伴奏小二度撞击的"调跑"问题。三处修：(1) ToplineEngine 弱拍吸附池改为 `chordPcs ∪ scalePcs`（chord 优先），借调段旋律跟着色彩音走；(2) grace note 后处理同样使用 chord∪scale 池；(3) TextureMapper energy 5~6 段 bass 五度按 `chord.quality` 取真五度（dim +6 / aug +8），消除 iidim 上的 dim 五度毛刺。诊断 seed 20107772 验证：melody chord-tone 命中率 83.4% → 86.2%，pianoLH 99% → 100%
> - ✅ **战役一：动机引擎重构（2026-05-07）** — 彻底废除 ToplineEngine 的 random walk「儿歌感」算法。新管线：(1) 缓存 `chordPools` 一次性预算所有和弦的 chordPcs / weakBeatPool；(2) `generateMotif()` 生成 8 拍 (2 小节) 母题 — 起手式 ∈ {0, 4, 7}（主/三/五），contour 演化 15% 大跳（4-7 半音）/ 45% 级进（1-2 半音）/ 40% 同音反复；(3) **每 16 拍构成一个 Phrase，A-A' 模进结构**：A 段原样、A' 段整体平移 -3..+3 半音制造推拉感；(4) 节奏池扩展到 9 个 cell，新增两个休止起句变体 `[-0.5, 0.5, 0.5, 0.5, 2.0]` 与 `[-1.0, 1.0, 1.0, 1.0]`；(5) 钢琴 `octaveDoubling: true` + 后处理在 velocity ≥ 0.75 且非倚音时叠下方八度（×0.8），实现高能段加厚；(6) TextureMapper Layer 3 切分 stab 按 barIndex 轮换 `compingPatterns`，4 种乐器 idiom 全部收紧到关键 Pattern。
> - ✅ **战役二：伴奏织体升维与低音线条（2026-05-07）** — 消除伴奏「初中生块状感」，引入 Slash Chords + Waterfall Arpeggio + Bass Walkdown。新管线：(1) `GeneratedChord.bassOverride?: number` 新字段（0~11 相对 pc），`CompingIdiom.textureType?: 'block'|'arpeggio'|'mixed'`；(2) `MusicTheory.parseNumeral` 正则升级 `(?:\/([b#]?)(罗马))?` 捕获斜杠后低音，输出 `{root, quality, bassOverride?}`，自动按调式适配（小调下 `/III=3` `/VI=8` `/VII=10`）；(3) chorusPool 头部插入黄金下行卡农 `[I, V/VII, vi, I/V, IV, I/III, ii7, V7]`（周杰伦/林俊杰常用）；(4) HarmonyCore 写入 `bassOverride`、ViterbiChordSelector 同根音时透传 `bassOverride` 防斜杠意图被吞；(5) TextureMapper Layer 2 改读 `bassOverride` 决定根音并强制折叠到低八度；末尾注入 Bass Passing Note — 当下一根音 1~4 半音以内时，前 0.5 拍打入半音/全音桥梁（≥3 半音差走全音、否则半音），含已有 bass 时长切割避让；(6) Layer 3 按 `textureType` + 能量切换：`useArpeggio = arpeggio || (mixed && energy<=6)` 触发跨双八度 Waterfall `[根, 五, 高八度根, 高八度三]` 浪涌折返 `[0,1,2,3,2,1]`，根音加重 `+0.15`，能量≥5 切到 16 分滚奏（`step=0.25`）；(7) Idiom 配置：Piano/Guitar = `mixed`、VocalWind/SynthPulse = `block`。
> - ✅ **战役三：去模板化与风格矩阵裂变（2026-05-07）** — 解决琶音模板化死循环、钢琴标品锁死、缺乏高级和声排列三大病灶。(1) `CompingIdiom` 新增 `arpeggioPatterns?: (number \| null)[][]`（带休止符 null 的琶音音型轨迹）+ `textureProbabilities?: { block, arpeggio, comping }`（织体倾向概率）；(2) IdiomRegistry：PianoIdiom 注入 3 套带呼吸的 arpPattern + 概率 `(0.2/0.5/0.3)`、GuitarIdiom 注入经典指弹 + 留白模式 + 概率 `(0.2/0.6/0.2)`；(3) TextureMapper 引入 **Rootless Voicing**：≥4 音的高级和弦（七和弦及以上）丢弃根音让贝斯独占低频，对 maj7/m7/dom7/m9/maj9 自动加 9 音染色；Layer 3 解固为 PRNG 概率抉择 `block/arpeggio/comping`，能量≥7 强制切分（防"飘"），琶音从 `arpeggioPatterns` 池中按 `floor(startBeat/4) % len` 取，null 索引 = 不弹音留白；(4) StyleFlags 新增 `IndieAcoustic=18` + `RnBPop=19` 两种基因；(5) StyleRegistry 注册 `IndieAcousticStyle`（强制木吉他 + IVadd9 / IVmaj7 / Vsus4 / 允许无鼓 / Room_DrumKit）+ `RnBPopStyle`（笼罩感 EP + ii9 / V13 / Imaj9 + 拖拍 0.12 + Slap_Bass + TR808）；(6) pipeline.runPipeline 替换写死 ensemble 为 **智能编制抽卡 (Ensemble Drafter)** —— `pickInst()` 从风格池中 PRNG 抽乐器、防主奏与伴奏撞车（最多重抽 5 次）、`useDrums/useBass` 服从 `allowDrumless/allowBassless` 概率门、`secondaryMelodySound` 走 String/Pad/Choir 池、`counterMelodySound` 服从 `counterMelodyProbability`；(7) 收音机 RADIO_STYLE_POOL 扩展为 5 风格池（ModernPop / IndieAcoustic / RnBPop / Synthwave / LofiChill）。
> - ✅ **战役四：纯化标品 + ACG 双键盘宇宙（2026-05-07）** — 三段连续重构合并落地。**(A) 标品基线收缩**：撤回战役三引入的 `IndieAcoustic` / `RnBPop` enum 与 styles 配置；TextureMapper Layer 3 弃 PRNG 织体抖动、改"**乐句级一致性 (Phrase-Level Continuity)**"——每 16 拍预算一次 `phraseTextures[phraseIdx] ∈ {block, arpeggio, comping}`，能量≥7 强制切分、能量≤3 强制留白，琶音/切分模式按 `phraseIdx % len` 锁定，整段乐句手法统一；ToplineEngine `generateMotif` contour 概率改 10% 大跳（3~5 半音）/ 30% 级进 / **60% 同音反复**，强化人声"咬字停留感"。**(B) ACG 双键盘宇宙**：新增 `AcgPianoIdiom`（80% 琶音 / `graceNoteProbability: 0.65` 大跳装饰音 / 16 分绵密流动）；新增 `StyleId.AcgLightMusic = 20` 与 `AcgStyle`（80~140 BPM / 王道(IVmaj7-V-iii-vi) + 小室 + 丸谷 + 史诗(bVI-bVII-I) 进行 / `chromaticApproachProbability: 0.3` / `leapResolutionThreshold: 4` / `allowDrumless + allowBassless`）；`getIdiomForInstrument(name, styleId)` 新签名，styleId === 20 时所有 piano-named 乐器自动升级到 AcgPianoIdiom，pipeline + Orchestrator 调用点透传 `style.id`；pipeline 替换为"**智能动态编制 (Ensemble Drafter)**"——`isQuietMood = mood.energyCap[1] <= 5`，`noDrums = allowDrumless && (isQuietMood || rand<0.3)`，`noBass = noDrums && allowBassless && rand<0.8`，独奏模式下强制 `chordInst = melodyInst` 且 `bassSound = chordInst`（左手钢琴接管低音频段），单钢琴独奏自然涌现；`secondaryMelodySound + counterMelodySound = null` 强制关闭无用铺底，`EnsembleDraft.secondaryMelodySound` 类型放宽为 `string | null`。**(C) 唯一风格收敛**：完全删除 `ModernPop` / `Synthwave` / `LofiChill` enum 与全部别名（`Default` / `DarkSynthPop` / `LoFiChill`），删除 `DefaultStyle` 并把所有字段内联到自包含的 `AcgStyle`（无 spread）；旧 shim `DefaultStyleConfig` / `DarkSynthPopStyleConfig` / `LoFiChillStyleConfig` 收敛为单一 `AcgStyleConfig`；`BarData.ts` 全部 7 个 bar 的 styleIds 缩为 `[AcgLightMusic]`；`SeedController.RADIO_STYLE_POOL` / `AuraRadio.allStyleIds` / `AuraBar.allStyleIds` / `AuraJam.allStyleIds` / `pipeline.styleId` fallback / `AuraRadio.selectedStyleId` fallback / `scripts/diag_seed.ts` 全部改 `StyleId.AcgLightMusic`；`PlaybackEngine` `DefaultStyleConfig` 引用改 `AcgStyleConfig`。**保留** Acoustic/Electric/Acg 三件 Idiom，但因 ACG 是唯一注册风格、`styleId === 20` 分支恒为真，所有 piano-named 乐器现在会被路由到 AcgPianoIdiom；EP-named (`ep`/`electric`/`warm`/`lofi`) 仍走 ElectricPianoIdiom。`tsc --noEmit` 通过、全仓零残留旧 StyleId / 旧 shim 引用。
> - ⏳ Phase 6+ — Conductor silentInstruments 硬约束消费、CadentialBridge 251 注入、SongComparisonLogger 完整恢复（当前唯一注册风格为 ACG，多风格扩展待规划）

---

## 0. 项目元数据

- **产品**：AuraFlow Tap! Ver.7.6 — 基于 Web 的硬件音乐工作站模拟器
- **最终目标**：1:1 移植到 ESP32-S3 纯 C 固件
- **技术栈**：React 19 + TypeScript 5.8 + Vite 6 + Tailwind 4 + SpessaSynth + Motion + Google Gemini API
- **音色库**：`public/GM128_3MB.sf2`（128 GM 乐器，3MB）
- **目标硬件**：ESP32-S3-N8R8/N16R8（512KB SRAM + 8MB PSRAM）+ I2S DAC + FreeRTOS

---

## 1. 文件树（V7.6 Idiom 重构 + 战役四 ACG 收敛 / 56 个源文件）

```
auraflow_music_game_console_simulator/
├── index.html                                 ← Vite 入口 HTML
├── package.json                               ← 依赖与脚本
├── tsconfig.json                              ← TS 配置（path alias @/ → 项目根）
├── vite.config.ts                             ← Vite + Tailwind + basicSsl + COOP/COEP 头
├── metadata.json                              ← AI Studio 元数据
├── docs/                                      ← 设计文档（保留）
│   ├── CODEBASE_SNAPSHOT.md                   ← 本文件
│   ├── esp32_porting.md
│   ├── framework_alignment.md
│   ├── music_engine_audit_standard.md
│   ├── SONG_COMPARISON_LOG_SPEC.md
│   ├── todo_plan.md
│   └── audits/                                ← 历史审计记录
├── scripts/
│   ├── prng-verify.ts                         ← PRNG 跨平台验证（10000 步对比 C 实现）
│   ├── diag_seed.ts                           ← seed 调性诊断（chord-tone hit / out-of-scale 报告，npx tsx scripts/diag_seed.ts <seed>）
│   └── json2c.py                              ← golden-seed JSON → C 头文件转换器（孤儿，等新生成器恢复）
└── src/
    ├── main.tsx                               ← React 入口
    ├── index.css                              ← Tailwind 全局样式 + VT323 字体
    ├── vite-env.d.ts                          ← Vite 类型声明
    ├── App.tsx                                ← 顶层布局（设备外观、按键、屏幕、LED）
    │
    ├── apps/                                  ← 应用层（设备菜单子应用）
    │   ├── AppRegistry.tsx                    ← 应用注册表
    │   ├── AuraBar/                           ← 酒吧巡游模式
    │   │   ├── BarData.ts                     ← 7 种酒吧场景；战役四：所有 styleIds 收敛为 [AcgLightMusic]
    │   │   ├── EndlessRadioManager.ts         ← Bar 模式状态机 + Jam 录制 + 鼓机循环重制；战役四：allStyleIds + fallback 改 ACG
    │   │   └── index.tsx                      ← Bar UI（卡片轮播 + Jam 模式触发）
    │   ├── AuraJam/                           ← 个人创作模式（用户 motif 录制）
    │   │   ├── JamSessionManager.ts           ← Jam 状态机（Scale/Record/Generate/Play/Jam）；战役四：allStyleIds + fallback 改 ACG
    │   │   ├── MotifPreprocessor.ts           ← 用户 motif 质量评估 + 清洗 + A-A-A'-A'' 变奏扩展
    │   │   ├── MotifRecorder.ts               ← 实时录音 → NoteData[]
    │   │   ├── ScaleEngine.ts                 ← 14 音音阶板生成（C-pentatonic 等）
    │   │   └── index.tsx                      ← Jam UI
    │   └── AuraRadio/                         ← 无尽电台模式
    │       ├── EndlessRadioManager.ts         ← Radio 状态机（用 dynamic import runPipeline）；战役四：allStyleIds + selectedStyleId fallback 改 ACG
    │       └── index.tsx                      ← Radio UI（咖啡杯 + 蒸汽动画）
    │
    ├── components/                            ← UI 组件
    │   ├── PipelineMonitor.tsx                ← 实时五阶段管道可视化（Q+H 切换）
    │   ├── PixelGrids.ts                      ← 像素图标位图（radio/euclid/synth/cocktail/...）
    │   ├── PixelIcon.tsx                      ← 通用像素 SVG 渲染器
    │   ├── SeedController.tsx                 ← Seed Lab（Q+S 切换，固定 seed 重放歌曲）；战役四：RADIO_STYLE_POOL = [AcgLightMusic]
    │   └── VolumeController.tsx               ← Marshall 风格混音器（Q+E 切换）
    │
    ├── core/
    │   ├── GlobalContext.ts                   ← generation/GlobalContext 的 re-export 兼容层
    │   ├── audio/                             ← 音频管线（Web 专用，ESP32 由 I2S/FluidSynth 替代）
    │   │   ├── AudioEngine.ts                 ← 单例总调度（playSong / 通道管理 / Jam 注入）
    │   │   ├── AudioMixer.ts                  ← Master DSP 链（HPF/LPF/Shelf/PeakEQ/Comp/磁带饱和）
    │   │   ├── Instruments.ts                 ← SpessaSynth 包装器 + GM 通道路由
    │   │   ├── MidiScheduler.ts               ← 5ms 定时器 + Web Worker 后台播放（模拟 FreeRTOS）
    │   │   ├── PlaybackEngine.ts              ← ArrangedTrack → MidiEvent[] + CC 自动化（侧链/呼吸/亮度）；战役四：DefaultStyleConfig → AcgStyleConfig
    │   │   └── SynthManager.ts                ← SpessaSynth + AudioContext 异步初始化
    │   ├── hal/                               ← 硬件抽象层（ESP32 移植锚点）
    │   │   ├── IHardware.ts                   ← ILedMatrix/ITouchPad/IAudioOut/ISystemTimer 接口
    │   │   └── WebSimulatorHAL.ts             ← Web 实现
    │   ├── hardware/                          ← Web 模拟器 UI（ESP32 移植时丢弃）
    │   │   ├── LedMatrix.tsx                  ← 15×9 LED 流体扩散动画
    │   │   └── TapArea.tsx                    ← 5×3 触摸区 + 键盘映射
    │   ├── storage/
    │   │   └── SongStorage.ts                 ← 占位（暂未实现持久化）
    │   ├── utils/
    │   │   ├── PRNG.ts                        ← LCG 确定性 PRNG（含快照系统 A/B/C/D）
    │   │   └── TrackSerializer.ts             ← NoteData[] → Float32Array 扁平化（C 移植预演）
    │   │
    │   └── generation/                        ← ✅ Phase 1~5 + V7.6 Idiom 重构 — 真实生成引擎
    │       ├── types.ts                       ← 类型契约（LeadIdiom + CompingIdiom）；战役二：bassOverride + textureType；战役三：CompingIdiom.arpeggioPatterns? + textureProbabilities?；战役四：EnsembleDraft.secondaryMelodySound 放宽为 string \| null
    │       ├── GlobalContext.ts               ← 单例（兼容保留，新管道内部已脱钩）
    │       ├── MelodyEngine.ts                ← ✅ 转发到 runPipeline 的薄封装（兼容 AuraBar 调用）
    │       ├── theory/
    │       │   └── MusicTheory.ts             ← ✅ 纯工具：snap 系 + getSmoothVoicing 反浑浊开放排列；战役二：parseNumeral 升级支持 Slash Chords（`V/VII` `I/V` 等），输出 bassOverride 并按调式适配
    │       ├── harmony/
    │       │   ├── HarmonyCore.ts             ← ✅ 子小节分裂 + 抢拍 Anticipation；战役二：透传 parsed.bassOverride 到 GeneratedChord
    │       │   └── ViterbiChordSelector.ts    ← ✅ 涌现式重配：动态候选池 + tensionMultiplier 张力门；战役二：同根音时透传 orig.bassOverride 防斜杠意图被吞
    │       ├── idioms/                        ← 🌟 乐器语汇 — 本轮拆分为 lead + comping 两层独立子配置
    │       │   └── IdiomRegistry.ts           ← ✅ 战役一收紧 4 idiom Pattern；战役二：textureType 字段；战役三：Piano/Guitar 注入 arpeggioPatterns 池（含 null 留白）+ textureProbabilities 概率分布；**战役四**：删除 Vocal/Guitar/Synth 全部杂项 idiom，仅保留 `AcousticPianoIdiom` / `ElectricPianoIdiom` / `AcgPianoIdiom`；`getIdiomForInstrument(name, styleId)` 新签名，styleId === 20 时所有 piano-named 升级 ACG
    │       ├── melody/
    │       │   ├── RhythmCells.ts             ← ✅ 战役一扩展：9 cell（含 3-3-2 切分 + 三种休止起句变体），喂养 A-A' 母题
    │       │   └── ToplineEngine.ts           ← ✅ **战役一：A-A' 动机模进引擎**（彻底废 random walk）；后处理保留 legato/humanize/grace/octaveDoubling；战役四：generateMotif contour 概率改 10% 大跳 / 30% 级进 / **60% 同音反复**（人声"咬字"感）
    │       ├── composing/
    │       │   ├── GrooveEngine.ts            ← ✅ 鼓组生成（GM Drum Map，mood 调制密度/技巧/力度）
    │       │   └── StructureEngine.ts         ← ✅ Phase 5 — 段落 form 抽取 + mood.energyCap 钳制
    │       ├── arrangement/
    │       │   ├── TextureMapper.ts           ← ✅ 战役二：Slash Bass + Waterfall Arpeggio + Bass Walkdown；**战役三：Rootless Voicing + 织体概率解固**；**战役四：乐句级一致性 (Phrase-Level Continuity)** — 每 16 拍预算一种 phraseTextures ∈ {block, arpeggio, comping}，能量≥7 强制切分 / ≤3 强制留白；琶音/切分模式按 `phraseIdx % len` 锁定，整段乐句手法统一；默认 idiom 改 `AcousticPianoIdiom`
    │       │   └── Orchestrator.ts            ← ✅ K-2 唯一 keyOffset 应用点；bass per-note octave fold 到 [28, 43]（E1~G2 甜区）；战役四：getIdiomForInstrument 调用透传 styleId
    │       ├── pipeline/
    │       │   ├── index.ts                   ← ✅ runPipeline()：**战役四智能动态编制**：`isQuietMood = mood.energyCap[1] <= 5` + `noDrums = allowDrumless && (isQuietMood \|\| rand<0.3)` + `noBass = noDrums && allowBassless && rand<0.8`；独奏模式强制 `chordInst = melodyInst = bassSound`，单钢琴独奏自然涌现；secondaryMelodySound + counterMelodySound 强制 null；按段独立 reharmonize + Pitch Correction Pass
    │       │   └── ConductorPlanner.ts        ← ✅ Phase 5 — 段落级 silent/support/focus 配器计划
    │       ├── utils/
    │       │   └── SongComparisonLogger.ts    ← 🚧 buildComparisonLog() 仍是单行占位（待恢复完整统计）
    │       └── config/                        ← 数据配置（与算法解耦）
    │           ├── StyleFlags.ts              ← StyleId enum + StyleIdName；**战役四：仅保留 `AcgLightMusic = 20`**，删除 ModernPop/Synthwave/LofiChill 与全部别名
    │           ├── MoodFlags.ts               ← MoodId enum + MoodRegistry（bpmMultiplier / tonalityBias / energyCap / 密度倍率）
    │           ├── InstrumentFlags.ts         ← InstrumentId enum + Profiles + GM 桥接（V7.6 后生成管道不再使用，仅平台层 PlaybackEngine 引用）
    │           ├── StyleRegistry.ts           ← 兼容适配层（re-export from styles/）；战役四：导出单一 `AcgStyleConfig`（替代旧 DefaultStyleConfig / DarkSynthPopStyleConfig / LoFiChillStyleConfig）
    │           └── styles/
    │               └── StyleRegistry.ts       ← **战役四：唯一注册 `AcgStyle`** — 删除 DefaultStyle / IndieAcousticStyle / RnBPopStyle，AcgStyle 改为自包含 StyleConfig（无 spread）；80~140 BPM / 王道-小室-丸谷-史诗进行 / `allowDrumless + allowBassless`
    │
    └── system/
        ├── AuraSystem.tsx                     ← 系统菜单 UI（应用切换器 + 长按琶音）
        └── SystemAudio.ts                     ← 系统级专属音色（独占 MIDI ch15 / ch9，不被 App 污染）
```

---

## 2. 生成引擎实现概览（Phase 1~5 + V7.6 Idiom 重构）

### 2.1 数据流（端到端）

```
EndlessRadioManager.triggerGeneration()
  ├─ PRNGManager.setSeed(seed) + recordSnapshot('A')
  └─ MelodyEngine.generateFullSong(styleId)
        ↓ (薄封装，转发到 runPipeline)
     runPipeline({ forcedStyleId, forcedMoodId? })
        ├─ recordSnapshot('B')
        ├─ 抽 mood (MoodId 6 选 1) → 影响 BPM 乘数 / tonalityBias / energyCap / 密度倍率
        ├─ 抽 BPM (style.bpmRange × mood.bpmMultiplier) / Tonality (mood.tonalityBias 优先 → tonalityPool 兜底) / KeyOffset (0~11)
        ├─ StructureEngine.generateStructure(bpm, style, mood)
        │     └─ 抽 form 模板 → 段落序列（Intro/Verse/Chorus/Bridge/Outro）+ mood.energyCap 钳制
        ├─ 🌟 战役四智能动态编制 (Dynamic Ensemble Drafter)：纯键盘生态 + 单钢琴独奏涌现
        │     └─ isQuietMood = mood.energyCap[1] <= 5；noDrums = allowDrumless && (isQuietMood || rand<0.3)
        │     └─ noBass = noDrums && allowBassless && rand<0.8 → 独奏模式：chordInst = melodyInst，bassSound = chordInst
        │     └─ secondaryMelodySound + counterMelodySound 强制 null（不再走 String/Pad/Choir 池）
        │     └─ getIdiomForInstrument(ensemble.melodySound, style.id)      → melodyIdiom（styleId === 20 时 piano-named 升级 ACG）
        │     └─ getIdiomForInstrument(ensemble.counterMelodySound, style.id) → counterMelodyIdiom（current null，调用为占位）
        ├─ HarmonyCore.generateHarmonyTimeline(sections, style, tonality, keyOffset)
        │     └─ 每段从 chorusPool / versePool / preChorusPool 抽进行 → parseNumeral(numeral, tonality)（小调级数适配）
        │     └─ chord 上挂 keyOffset 字段供 UI 显示（PipelineMonitor / AuraBar / AuraJam）
        ├─ ToplineEngine.generateMelody(basicChords, tonality, mood, melodyIdiom)
        │     └─ A-A' 模进结构：每 16 拍生成 8 拍 motif，A 段原样 + A' 段 ±3 半音平移
        │     └─ 战役四 contour 概率：10% 大跳 (3~5) / 30% 级进 (1~2) / **60% 同音反复**（"咬字"感）
        │     └─ 强拍吸 chordPcs / 弱拍吸 chord∪scale 池；needsBreathing 已不在 Acoustic/Electric/Acg idiom 上配置（始终跳过）
        ├─ ViterbiChordSelector.reharmonize(basicChords, melody, tonality)  ← style.useViterbiHarmony=true 时启用
        │     └─ 旋律驱动重配和声：T/S/D 转移矩阵 + 主调候选池 → 反向贴合旋律
        ├─ ToplineEngine.generateCounterMelody(finalChords, tonality, mood, counterMelodyIdiom)
        │     └─ 副旋律：与主旋律避撞 + 长音 Pad 风格
        ├─ GrooveEngine.generateDrums(sections, mood)
        │     └─ 按 energyLevel + mood 分级：留白/Brush/Standard/Chorus 切分
        └─ ConductorPlanner.plan(sections)
              └─ 段落级配器计划：focusInstrument / supportInstruments / silentInstruments / rhythmCenter / fillWindows
   → { track: GeneratedTrack, context: MusicContext }
        track 含 finalChords + melody + counterMelody + drums + sections + preSelectedPalette
        context 含 conductorPlan + style + moodId + 🌟 ensemble（前置敲定的编制）

AudioEngine.playSong(track, styleId, context)
  └─ Orchestrator.arrange(track, styleId, context)
        ├─ 🌟 V7.6 palette 直读 context.ensemble（无 pickInst 抽卡），缺失则兜底标品
        ├─ 战役四：chordIdiom = getIdiomForInstrument(palette.chordSound, styleId)（透传 styleId 启用 ACG 路由）
        ├─ TextureMapper.generateAccompaniment(chords, sections, chordIdiom) → 相对空间 pianoLH / pianoRH / sustainedPad
        │     └─ MusicTheory.getSmoothVoicing 平滑声部连接 → Rootless Voicing（≥4 音和弦丢根音让贝斯独占低频）
        │     └─ **战役四 Phrase-Level 织体一致性**：每 16 拍预算一种 phraseTextures ∈ {block, arpeggio, comping}
        │           - 能量≥7 强制 comping，能量≤3 强制 block，否则按 idiom.textureProbabilities 抽
        │           - 琶音模式按 `phraseIdx % arpPool.length` 锁定，整段乐句 pattern 一致
        │           - 切分模式按 `phraseIdx % patterns.length` 锁定（不再每 4 拍重抽）
        │     └─ Drop-2 / strumDelay / compingDuration 仍由 idiom 字段驱动
        ├─ K-2 唯一应用点：melody/counterMelody/pianoRH/pianoLH/secondaryMelody 全部 + keyOffset → 绝对 MIDI
        ├─ ConductorPlan.silentInstruments 物理消音（按段落过滤掉对应轨的音符）
        └─ drums 透传（GM 鼓键位是绝对物理音，永不加 keyOffset）
   → ArrangedTrack（含 bass register 锁定 — 中位数 ±12 平移到 [28, 47]）
   → PlaybackEngine.loadSong → MidiScheduler → SpessaSynth → 扬声器
        注：PlaybackEngine 不再做转调或音域钳制 —— ArrangedTrack 即放即用
```

### 2.2 模块清单与职责

| 模块 | 文件 | 输入 | 输出 | PRNG |
|------|------|------|------|------|
| MusicTheory | `theory/MusicTheory.ts` | tonality / chord quality / pitch | 音阶池 / 和弦音程 / 吸附后 pitch / 平滑 voicing / 解析罗马数字（含 sus4/add9/9/11/13/aug/dim/m9/maj9/m11 + 小调级数适配） | 不消耗 |
| StructureEngine | `composing/StructureEngine.ts` | bpm + style + mood | SectionMetadata[] (intro/verse/chorus/...) | ×N（form + 长度） |
| 🌟 IdiomRegistry | `idioms/IdiomRegistry.ts` | instrumentName + styleId | InstrumentIdiom（仅 Acoustic/Electric/Acg 三件钢琴；styleId === 20 时 piano-named 升级 AcgPianoIdiom） | 不消耗 |
| HarmonyCore | `harmony/HarmonyCore.ts` | sections + style + tonality + keyOffset | GeneratedChord[]（相对 root + quality + chord.keyOffset 给 UI） | ×N（每段抽 1） |
| RhythmCells | `melody/RhythmCells.ts` | — | BASIC_RHYTHM_CELLS（按密度档分组：sparse/normal/dense） | 不消耗 |
| ToplineEngine | `melody/ToplineEngine.ts` | chords + tonality + mood + idiom | { melody, counterMelody }（相对 pitch；A-A' 模进 + 60% 同音反复 contour） | ×M（cell + contour + velocity） |
| ViterbiChordSelector | `harmony/ViterbiChordSelector.ts` | basicChords + melody + tonality | finalChords[]（旋律驱动重配 — 候选池 = 静态默认池 ∪ 骨架 numeral 唯一对，防 bVII/bIII 等借调被吞噬） | 不消耗（DP 确定性） |
| GrooveEngine | `composing/GrooveEngine.ts` | sections + mood | NoteData[]（GM 鼓键位绝对，mood 调制密度/技巧） | ×K（hihat velocity） |
| ConductorPlanner | `pipeline/ConductorPlanner.ts` | sections | ConductorPlan（focus / support / silent / rhythm / fill） | ×L |
| TextureMapper | `arrangement/TextureMapper.ts` | chords + sections + chordIdiom | { bass, rhythmComping, sustainedPad }（相对空间，乐句级织体一致性） | ×J（每 16 拍预算一次 textureType） |
| Orchestrator | `arrangement/Orchestrator.ts` | track + styleId + context | ArrangedTrack（绝对 MIDI，含 counterMelody/secondaryMelody + pianoLH 寄存器锁定到 [28, 47]） | 不消耗（V7.6 后无抽卡） |

### 2.3 Pitch Space 契约（K-1 ~ K-7）

| 阶段 | Pitch Space |
|------|------------|
| HarmonyCore 输出 chord.root | RELATIVE (0~11) — `chord.keyOffset` 仅供 UI 显示 |
| ToplineEngine 输出 melody.pitch / counterMelody.pitch | RELATIVE（参考主音 0） |
| TextureMapper 输出 pianoLH/RH.pitch | RELATIVE（pianoLH 已含 -24 八度偏移） |
| ViterbiChordSelector 输入 melody.pitch | RELATIVE（与 ToplineEngine 同空间） |
| GrooveEngine 输出 drums.pitch | ABSOLUTE-DRUM（GM Drum Map 物理键位） |
| Orchestrator → ArrangedTrack | ABSOLUTE-MIDI（除 drums 外全部 + keyOffset + 锚点八度） |
| PlaybackEngine | ABSOLUTE-MIDI 透传（不再做转调或音域钳制） |

**唯一相对→绝对转换点**：`Orchestrator.arrange()`。
- melody: `+ keyOffset + 72` (C5)
- counterMelody: `+ keyOffset + 60` (C4)
- pianoRH: `+ keyOffset + 60` (C4 居中)
- pianoLH: `+ keyOffset + 60`（已含 -24，落到 C2 区）
- drums: 直接透传

### 2.4 公开 API 签名（保持兼容）

```typescript
// MelodyEngine.ts — 薄封装，AuraBar 等老调用方零修改
class MelodyEngine {
    generateFullSong(
        styleIdOrOptions?: StyleId | GenerationOptions,
        legacyOptions?: GenerationOptions,
    ): { track: GeneratedTrack; context: MusicContext };
}

// pipeline/index.ts — 新管道入口（AuraRadio 通过 dynamic import 直连）
function runPipeline(options?: PipelineRunOptions): {
    track: GeneratedTrack;       // 含 melody + counterMelody + finalChords + drums + preSelectedPalette
    context: MusicContext;       // 含 moodId + style + conductorPlan + ensemble
};

// arrangement/Orchestrator.ts — 平台层调用，K-2 转换；V7.6 后不再消耗 PRNG
class Orchestrator {
    static arrange(
        track: GeneratedTrack,
        styleId: StyleId,
        context: MusicContext,    // 必须含 context.ensemble，缺失则兜底标品
    ): ArrangedTrack;
}

// melody/ToplineEngine.ts — V7.6 新增 idiom 参数
class ToplineEngine {
    static generateMelody(
        chords: GeneratedChord[],
        tonality: Tonality,
        mood?: MoodConfig,
        idiom?: InstrumentIdiom,    // 🌟 V7.6：idiom.needsBreathing 决定是否换气
    ): NoteData[];
    static generateCounterMelody(
        chords: GeneratedChord[],
        _tonality: Tonality,
        mood?: MoodConfig,
        _idiom?: InstrumentIdiom,   // 🌟 V7.6：占位，后续按副旋律 idiom 扩展
    ): NoteData[];
}

// arrangement/TextureMapper.ts — V7.6 chordSound 改为 chordIdiom
class TextureMapper {
    static generateAccompaniment(
        chords: GeneratedChord[],
        sections: SectionMetadata[],
        chordIdiom?: InstrumentIdiom,   // 默认 AcousticPianoIdiom；驱动 Drop-2/扫弦/切分
    ): { bass: NoteData[]; rhythmComping: NoteData[]; sustainedPad: NoteData[] };
}

// idioms/IdiomRegistry.ts — V7.6 新增；战役四签名升级 + 收敛
function getIdiomForInstrument(
    instrumentName?: string | null,
    styleId?: number,    // styleId === 20（AcgLightMusic）时所有 piano-named 升级 AcgPianoIdiom
): InstrumentIdiom;
// 已导出常量：AcousticPianoIdiom / ElectricPianoIdiom / AcgPianoIdiom（Vocal/Guitar/Synth 已删除）
```

### 2.5 类型变更（types.ts）

战役四增量：
- `EnsembleDraft.secondaryMelodySound?: string | null` — 类型放宽允许显式 `null`，配合 pipeline 强制关闭"无用铺底"
- `StyleId` enum 唯一值：`AcgLightMusic = 20`（删除 ModernPop / Synthwave / LofiChill 与全部别名）

V7.6 Idiom 重构增量：
- 🌟 新增 `InstrumentIdiom` 接口 —— 乐器物理约束契约：
  - 旋律侧：`needsBreathing` / `breathPhraseLength` / `breathTriggerBeat` / `breathProbability`
  - 伴奏侧：`strumDelay` / `compingPattern` / `compingDuration` / `allowDrop2`
- `MusicContext.ensemble?: EnsembleDraft` —— pipeline 前置敲定的编制透传到 Orchestrator（字段先前已存在，本次开始消费）

Phase 5 历史增量：
- `GeneratedTrack.counterMelody?: NoteData[]` — 副旋律输出，由 Orchestrator 透传到 ArrangedTrack.counterMelody

其他所有 interface / enum / 查找表 / 位掩码保持不变（Phase 4 已添加 `drums?` 字段）。

### 2.6 已知冷点 / 后续 Phase 切入点

- 🌟 **风格生态收敛为单一 ACG**（战役四）— `StyleRegistry` 当前只注册 `AcgLightMusic`；`getIdiomForInstrument` 的 `styleId === 20` 分支恒为真，所有 piano-named 乐器都会被路由升级到 `AcgPianoIdiom`，`AcousticPianoIdiom` 仅在 `instrumentName` 为空时作为兜底；后续若多风格扩展需重新规划 ACG 路由开关
- **ConductorPlan 仅消费了 silentInstruments** — Orchestrator 已物理消音 silent 角色，但 `focusInstrument / supportInstruments / rhythmCenter / fillWindows / counterpointPairs` 还未做差异化处理（如焦点乐器加 velocity boost / 节奏重心驱动击点偏移）
- **PlaybackEngine 仍硬编码 bass 乐器**（line 278-279 用 isAcoustic 检测覆盖 `palette.bassSound`）—— 影响 Orchestrator 抽到的 Acoustic_Bass / Synth_Bass_1 不生效，需在 PlaybackEngine 加分支
- **SongComparisonLogger 仍是单行占位** — 需恢复完整 STRUCTURE / MELODY STATS / HARMONY 输出
- **离调桥接 (CadentialBridge)** — `context.cadentialBridges` 未生成，251 注入未实现
- **Mood 系统覆盖面** — 已贯通 BPM / tonality / energy / 密度乘数 / 鼓 ghost notes / 旋律 / 织体决策（战役四 noDrums 闸门），但 TextureMapper 织体偏好（如 Chill 偏 Pad / Energetic 偏 Comping）仍可按 mood 进一步精化
- **黄金种子需重录** — V7.6 后 Orchestrator 不再消耗 PRNG；战役四又改了 pipeline ensemble 抽卡序列（noDrums/noBass 两次额外 PRNG 消耗），stateB 之后的消耗序列已变；按 §5 ACVE 验证义务，旧 golden seed 全部需要重新录制
- **GlobalContext 兼容残留** — 生成管道内部已脱钩，AuraBar/AuraJam 还在读 currentKeyOffset，可与 K-5 完全隔离

### 2.7 ESP32 移植契约（K-1~K-7 Pitch Space + L-1~L-8 链路约束）

详见 `.claude/rules/music_generation_pipeline_rule.md`（最高约束文档）。重点：
- **生成管道内 pitch 必须为相对空间**（主音=0），仅 `Orchestrator.arrange()` 是相对→绝对的唯一转换点
- **禁止 Math.random()**，统一用 `PRNGManager.next()`（LCG: state = state*1664525 + 1013904223 mod 2^32）
- **禁止浮点 ===**，必须 `Math.abs(a-b) < 1e-6`
- **禁止 Map/Set**，用排序数组 + 线性扫描
- **生成函数同步**，禁 async/Promise
- **鼓组永不加 keyOffset**（K-2 例外：drums.pitch 是 GM 物理键位）

---

## 3. 全量代码 Dump（按层级）

> 以下章节以代码栅栏形式给出每个文件的全量内容。Stub 文件已用 `🚧 STUB` 标注。


---

## 第一部分：根目录配置


### `package.json`

```json
{
  "name": "react-example",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite --port=3000 --host=0.0.0.0",
    "build": "vite build",
    "preview": "vite preview",
    "clean": "rm -rf dist",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@google/genai": "^1.29.0",
    "@tailwindcss/vite": "^4.1.14",
    "@vitejs/plugin-react": "^5.0.4",
    "better-sqlite3": "^12.4.1",
    "dotenv": "^17.2.3",
    "express": "^4.21.2",
    "framer-motion": "^12.38.0",
    "lucide-react": "^0.546.0",
    "motion": "^12.23.24",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "spessasynth_core": "^4.2.5",
    "spessasynth_lib": "^4.2.7",
    "vite": "^6.2.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.14.0",
    "@vitejs/plugin-basic-ssl": "^2.3.0",
    "autoprefixer": "^10.4.21",
    "tailwindcss": "^4.1.14",
    "tsx": "^4.21.0",
    "typescript": "~5.8.2",
    "vite": "^6.2.0"
  }
}
```

### `tsconfig.json`

> Path alias `@/` 映射到项目根（不是 `/src/`）— 故有些文件 import 写成 `@/src/core/...`。

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "experimentalDecorators": true,
    "useDefineForClassFields": false,
    "module": "ESNext",
    "lib": [
      "ES2022",
      "DOM",
      "DOM.Iterable"
    ],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "isolatedModules": true,
    "moduleDetection": "force",
    "allowJs": true,
    "jsx": "react-jsx",
    "paths": {
      "@/*": [
        "./*"
      ]
    },
    "allowImportingTsExtensions": true,
    "noEmit": true
  }
}
```

### `vite.config.ts`

> Vite 6 + Tailwind 4 + basic-ssl（HTTPS 自签证书）+ COOP/COEP 头（SpessaSynth AudioWorklet 必需）。

```ts
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), basicSsl()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // SharedArrayBuffer（SpessaSynth AudioWorklet 依赖）在非 localhost 源需要跨域隔离头
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
    },
  };
});
```

### `index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Google AI Studio App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>

```

### `metadata.json`

```json
{
  "name": "Remix: AuraFlow Tap! Ver.7.6 MAX",
  "description": "AuraFlow Tap! 是一款运行于 Web 端的高精度硬件音乐工作站模拟器，旨在将“直观的物理触觉交互”与“硬核程序化音乐生成（Procedural Music Generation）”完美融合。它不仅是一个支持多点触控的 5x3 阵列控制器，更是一个内嵌了高级音乐算法逻辑（如欧几里得律动、马尔可夫旋律链、和声专家系统）的生成式音乐底层载体。无需依赖黑盒 AI，每一次指尖的敲击，都是在实时调用严谨的乐理与数学规则，演算出充满灵感与律动的音乐动机。",
  "requestFramePermissions": []
}```

### `src/index.css`

```css
@import url('https://fonts.googleapis.com/css2?family=VT323&display=swap');
@import "tailwindcss";

/* Disable image dragging globally */
img {
  -webkit-user-drag: none;
  -khtml-user-drag: none;
  -moz-user-drag: none;
  -o-user-drag: none;
  user-drag: none;
}

#screen {
  font-family: 'VT323', monospace;
  text-transform: uppercase;
}

@keyframes breatheIn {
  0% { opacity: 0; transform: scale(0.95); }
  100% { opacity: 1; transform: scale(1); }
}

@keyframes breatheOut {
  0% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(1.05); }
}

@keyframes breatheContinuous {
  0%, 100% { opacity: 0.7; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.03); }
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.aura-breathe {
  animation: breatheContinuous 4s ease-in-out infinite;
}

.qna-entering {
  animation: breatheIn 3s ease-out forwards;
}

.qna-idle {
  opacity: 1;
  transform: scale(1);
}

.qna-exiting {
  animation: breatheOut 1.5s ease-in forwards;
}

.qna-hidden {
  opacity: 0;
}
```

### `src/vite-env.d.ts`

```ts
/// <reference types="vite/client" />

declare module '*?url' {
  const src: string
  export default src
}
```

---

## 第二部分：入口与系统层


### `src/main.tsx`

```tsx
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

### `src/App.tsx`

> 顶层布局：设备外观（图片）+ 屏幕（嵌套 AuraSystem 或当前 App）+ LED 矩阵 + 触控区。HOME 按钮回系统菜单。

```tsx
import React, { useState, useCallback } from 'react';
import { LedMatrix } from './core/hardware/LedMatrix';
import { TapArea } from './core/hardware/TapArea';
import { AuraSystem } from './system/AuraSystem';
import { APPS } from './apps/AppRegistry';
import { AudioEngine } from './core/audio/AudioEngine';
import { startAudioContext } from './core/audio/SynthManager';
import { VolumeController } from './components/VolumeController';
import { SeedController } from './components/SeedController';
import { PipelineMonitor } from './components/PipelineMonitor';

export default function App() {
  const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set());
  const [deviceState, setDeviceState] = useState<string>('SYSTEM_MENU');

  const handleKeyDown = useCallback((c: number, r: number) => {
    startAudioContext();
    setActiveKeys(prev => new Set(prev).add(`key-${c}-${r}`));
  }, []);

  const handleKeyUp = useCallback((c: number, r: number) => {
    setActiveKeys(prev => {
      const next = new Set(prev);
      next.delete(`key-${c}-${r}`);
      return next;
    });
  }, []);

  const handleAppSelect = useCallback((appId: string) => {
    setDeviceState(appId);
  }, []);

  const ActiveApp = APPS.find(app => app.id === deviceState)?.component;

  return (
    <div className="min-h-screen bg-black flex items-center justify-center overflow-hidden">
      <VolumeController />
      <SeedController />
      <PipelineMonitor />
      {/* Device Container */}
      <div 
        className="relative w-full max-w-[70vh] translate-y-[5vh]"
        style={{ aspectRatio: '1537 / 1410' }}
      >
        {/* Layer 1: Device Base (Z-index: 1) */}
        <div 
          className="absolute inset-0 z-10"
          style={{
            backgroundImage: 'url(https://auraflow-studio-hk.oss-cn-hongkong.aliyuncs.com/simulator/img/1QyK-bv3TC2OZRiAxhUvfzzxaR6RYIFEB.png)',
            backgroundSize: '100% 100%',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat'
          }}
        />

        {/* Tap Area Image */}
        <img 
          src="https://auraflow-studio-hk.oss-cn-hongkong.aliyuncs.com/simulator/img/%E5%8E%8B%E5%8A%9B%E5%9E%AB.png"
          alt="Silicone Tap Area"
          className="absolute z-20 pointer-events-none opacity-85 mix-blend-screen"
          style={{
            left: 'calc(17 / 1537 * 100%)',
            top: 'calc(388 / 1410 * 100%)',
            width: 'calc(1503 / 1537 * 100%)',
          }}
        />

        {/* Screen */}
        <div 
          id="screen"
          className="absolute z-30 bg-[#111] overflow-hidden flex items-center justify-center rounded-sm"
          style={{
            left: 'calc(363 / 1537 * 100%)',
            top: 'calc(66 / 1410 * 100%)',
            width: 'calc(811 / 1537 * 100%)',
            height: 'calc(269 / 1410 * 100%)',
            containerType: 'size'
          }}
        >
          {deviceState === 'SYSTEM_MENU' ? (
            <AuraSystem activeKeys={activeKeys} onAppSelect={handleAppSelect} />
          ) : (
            <div className="w-full h-full animate-[fadeIn_0.5s_ease-out]">
              {ActiveApp ? <ActiveApp activeKeys={activeKeys} onExit={() => setDeviceState('SYSTEM_MENU')} /> : null}
            </div>
          )}
        </div>

        {/* LeftKnob: Circular Home Button */}
        <div 
          className="absolute z-30 cursor-pointer rounded-full"
          style={{
            left: 'calc(97 / 1537 * 100%)',
            top: 'calc(118 / 1410 * 100%)',
            width: 'calc(164 / 1537 * 100%)',
            height: 'calc(164 / 1410 * 100%)',
            touchAction: 'manipulation'
          }}
          onPointerDown={() => {
            AudioEngine.stop();
            setDeviceState('SYSTEM_MENU');
          }}
        />

        {/* Layer 2: LED Matrix (Z-index: 35) */}
        <div 
          className="absolute z-35 mix-blend-screen pointer-events-none"
          style={{
            left: 'calc(102 / 1537 * 100%)',
            top: 'calc(442 / 1410 * 100%)',
            width: 'calc(1333 / 1537 * 100%)',
            height: 'calc(780 / 1410 * 100%)',
          }}
        >
          <LedMatrix activeKeys={activeKeys} appMode={deviceState} />
        </div>

        {/* Interactive Grid Overlay (Z-index: 4) */}
        <div 
          id="tap-area-container"
          className="absolute z-40"
          style={{
            left: 'calc(90 / 1537 * 100%)',
            top: 'calc(427 / 1410 * 100%)',
            width: 'calc(1358 / 1537 * 100%)',
            height: 'calc(811 / 1410 * 100%)',
          }}
        >
          <TapArea onKeyDown={handleKeyDown} onKeyUp={handleKeyUp} />
        </div>
      </div>
    </div>
  );
}
```

### `src/system/AuraSystem.tsx`

> 系统菜单（应用切换器）。支持滑动切换、双击进入、长按琶音。

```tsx
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { AudioEngine } from '../core/audio/AudioEngine';
import { startAudioContext } from '../core/audio/SynthManager';
import { systemLeadSynth, systemAudio } from './SystemAudio';
import { APPS } from '../apps/AppRegistry';

interface AuraSystemProps {
  activeKeys: Set<string>;
  onAppSelect: (appId: string) => void;
}

export function AuraSystem({ activeKeys, onAppSelect }: AuraSystemProps) {
  const [menuIndex, setMenuIndex] = useState(0);
  const menuIndexRef = useRef(0);
  useEffect(() => { menuIndexRef.current = menuIndex; }, [menuIndex]);
  const [isExiting, setIsExiting] = useState(false);

  // Swipe and Tap State Refs
  const swipeState = useRef({
    path: [] as {c: number, r: number, time: number}[],
    lastActionTime: 0
  });
  const tapTimeout = useRef<NodeJS.Timeout | null>(null);
  const tapCount = useRef(0);
  const lastTapKey = useRef<{c: number, r: number} | null>(null);

  // Long Press Arpeggiator Refs
  const longPressTimeouts = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const isArpMode = useRef(false);
  const arpNoteQueue = useRef<number[]>([]);
  const arpModeGraceTimeout = useRef<NodeJS.Timeout | null>(null);
  const arpInterval = useRef<NodeJS.Timeout | null>(null);
  const arpGraceTimeout = useRef<NodeJS.Timeout | null>(null);
  const arpIndex = useRef(0);

  const activeKeysRef = useRef<Set<string>>(activeKeys);
  const prevActiveKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    activeKeysRef.current = activeKeys;
  }, [activeKeys]);

  // --- LIFECYCLE CLEANUP (防止内存泄漏与声音残留) ---
  useEffect(() => {
    return () => {
      // 当退出系统菜单（进入 App）时，必须清理所有正在运行的系统级琶音和定时器
      if (arpInterval.current) {
        clearInterval(arpInterval.current);
        arpInterval.current = null;
      }
      longPressTimeouts.current.forEach(timeout => clearTimeout(timeout));
      longPressTimeouts.current.clear();
      if (arpModeGraceTimeout.current) clearTimeout(arpModeGraceTimeout.current);
      if (arpGraceTimeout.current) clearTimeout(arpGraceTimeout.current);
      if (tapTimeout.current) clearTimeout(tapTimeout.current);
    };
  }, []);

  const updateArpeggiator = useCallback(() => {
    const uniqueNotes = Array.from(new Set(arpNoteQueue.current)).sort((a: number, b: number) => a - b);

    if (uniqueNotes.length > 0) {
      if (arpGraceTimeout.current) {
        clearTimeout(arpGraceTimeout.current);
        arpGraceTimeout.current = null;
      }

      if (!arpInterval.current) {
        // Start a simple interval-based arpeggiator
        arpIndex.current = 0;
        arpInterval.current = setInterval(() => {
            if (arpNoteQueue.current.length === 0) return;
            const notes = Array.from(new Set<number>(arpNoteQueue.current)).sort((a, b) => a - b);
            const note = notes[arpIndex.current % notes.length];
            if (note !== undefined && !isNaN(note as number)) {
                systemLeadSynth.triggerAttackRelease(note as number, '16n', 0, 0.5);
            }
            arpIndex.current++;
        }, 125); // ~16th note at 120bpm
      }
    } else {
      // Grace period
      if (!arpGraceTimeout.current && arpInterval.current) {
        arpGraceTimeout.current = setTimeout(() => {
          if (arpInterval.current) {
            clearInterval(arpInterval.current);
            arpInterval.current = null;
          }
        }, 100);
      }
    }
  }, []);

  const triggerSoulFlourish = useCallback((midiNotes: number[]) => {
    midiNotes.forEach((midi, index) => {
      if (midi !== undefined && !isNaN(midi)) {
        systemLeadSynth.triggerAttackRelease(midi, '8n', index * 0.06, 0.5);
      }
    });
  }, []);

  // Detect key down and key up from activeKeys changes
  useEffect(() => {
    const current = activeKeys;
    const prev = prevActiveKeysRef.current;

    const added = Array.from<string>(current).filter(k => !prev.has(k));
    const removed = Array.from<string>(prev).filter(k => !current.has(k));

    added.forEach(keyId => {
      const parts = keyId.split('-');
      if (parts.length === 3) {
        const c = parseInt(parts[1]);
        const r = parseInt(parts[2]);

        startAudioContext();

        if (arpModeGraceTimeout.current) {
          clearTimeout(arpModeGraceTimeout.current);
          arpModeGraceTimeout.current = null;
        }

        if (isArpMode.current) {
          // We are dragging while Arp is active!
          const pentatonic = [60, 62, 64, 67, 69]; // C4, D4, E4, G4, A4
          const pitch = pentatonic[c] !== undefined ? pentatonic[c] + (2 - r) * 12 : 60;
          
          if (!isNaN(pitch)) {
            arpNoteQueue.current.push(pitch);
            if (arpNoteQueue.current.length > 8) {
              arpNoteQueue.current.shift();
            }
            updateArpeggiator();
          }
          return;
        }

        // 2.1 单次点击 (Ethereal Touch Sound)
        const pentatonic = [60, 62, 64, 67, 69]; // C4, D4, E4, G4, A4
        const pitch = pentatonic[c] !== undefined ? pentatonic[c] + (2 - r) * 12 : 60;
        if (!isNaN(pitch)) {
          systemLeadSynth.triggerAttackRelease(pitch, '8n', 0, 0.15);
        }

        // 2.4 长按琶音 (Long Press Arpeggiator)
        const timeout = setTimeout(() => {
          isArpMode.current = true;
          
          const basePitch = 48 + c * 4 + (2 - r) * 7;
          const isMajor = Math.random() > 0.5;
          const intervals = (Math.random() > 0.5) 
            ? (isMajor ? [0, 4, 7] : [0, 3, 7]) 
            : (isMajor ? [0, 2, 4, 7, 9] : [0, 3, 5, 7, 10]);
          const notes = intervals.map(i => basePitch + i);
          
          arpNoteQueue.current = [...notes];
          updateArpeggiator();
        }, 1200);
        longPressTimeouts.current.set(keyId, timeout);

        const now = performance.now();

        // --- Swipe Detection ---
        if (now - swipeState.current.lastActionTime > 400) {
          swipeState.current.path = [];
        }
        swipeState.current.path.push({c, r, time: now});
        swipeState.current.lastActionTime = now;

        // Keep only recent path items to prevent dt from growing indefinitely
        swipeState.current.path = swipeState.current.path.filter(p => now - p.time < 500);

        const path = swipeState.current.path;
        if (path.length >= 2) {
          const first = path[0];
          const last = path[path.length - 1];
          const dt = last.time - first.time;
          const dc = last.c - first.c;
          
          if (Math.abs(dc) >= 1 && dt < 500) {
            const safeDt = Math.max(dt, 10);
            const speed = Math.abs(dc) / (safeDt / 1000);
            const moveAmount = speed > 15 ? 2 : 1;

            const prevIdx = menuIndexRef.current;
            let newIdx = prevIdx;
            if (dc < 0) { // Swipe left -> Next item
              triggerSoulFlourish([72, 76, 79]); // C5, E5, G5
              newIdx = Math.min(APPS.length - 1, prevIdx + moveAmount);
            } else { // Swipe right -> Previous item
              triggerSoulFlourish([79, 76, 72]); // G5, E5, C5
              newIdx = Math.max(0, prevIdx - moveAmount);
            }
            setMenuIndex(newIdx);
            swipeState.current.path = [];
          }
        }

        // --- Multi-tap Detection ---
        if (lastTapKey.current && lastTapKey.current.c === c && lastTapKey.current.r === r) {
          tapCount.current += 1;
        } else {
          tapCount.current = 1;
          lastTapKey.current = {c, r};
        }

        if (tapTimeout.current) clearTimeout(tapTimeout.current);

        if (tapCount.current === 3) {
          // Triple tap -> Cancel/Return
          tapCount.current = 0;
          lastTapKey.current = null;
          // console.log('Triple tap: Cancel/Return');
          systemAudio.triggerKick(0, 0.8);
          systemLeadSynth.triggerAttackRelease(["G3", "Bb3", "D4"], '2n', 0, 0.5);
        } else {
          tapTimeout.current = setTimeout(() => {
            if (tapCount.current === 2) {
              // Double tap -> Confirm
              const currentIndex = menuIndexRef.current;
              const selectedApp = APPS[currentIndex];
              // console.log(`Selected app: ${selectedApp.name}, id: ${selectedApp.id}`);
              systemAudio.triggerKick(0, 1);
              systemLeadSynth.triggerAttackRelease(["C4", "E4", "G4", "C5"], '8n', 0, 0.6);
              AudioEngine.emitVisualEvent({ type: 'confirm', midiNote: 60, velocity: 127 });
              setIsExiting(true);
              setTimeout(() => {
                onAppSelect(selectedApp.id);
              }, 500);
            }
            tapCount.current = 0;
            lastTapKey.current = null;
          }, 300);
        }
      }
    });

    removed.forEach(keyId => {
      const isLastKey = current.size === 0 && prev.has(keyId);

      if (isLastKey) {
        swipeState.current.path = [];
      }

      if (isArpMode.current) {
        if (isLastKey) {
          arpModeGraceTimeout.current = setTimeout(() => {
            if (activeKeysRef.current.size === 0) {
              isArpMode.current = false;
              arpNoteQueue.current = [];
              updateArpeggiator();
            }
          }, 50);
        }
        return;
      }

      const timeout = longPressTimeouts.current.get(keyId);
      if (timeout) {
        clearTimeout(timeout);
        longPressTimeouts.current.delete(keyId);
      }
    });

    prevActiveKeysRef.current = new Set(current);
  }, [activeKeys, triggerSoulFlourish, updateArpeggiator, onAppSelect]);

  return (
    <div className={`@container w-full h-full flex items-center justify-center relative transition-all duration-500 ${isExiting ? 'scale-50 opacity-0' : 'scale-100 opacity-100'}`}>
      <div 
        className="flex transition-transform duration-300 ease-out h-full items-center absolute left-0"
        style={{
          transform: `translateX(calc(50cqw - ${menuIndex * 30 + 15}cqw))`
        }}
      >
        {APPS.map((app, idx) => {
          const isSelected = idx === menuIndex;
          return (
            <div 
              key={app.id}
              className={`flex flex-col items-center justify-center transition-all duration-300 ${isSelected ? 'opacity-100 scale-125' : 'opacity-40 scale-75'}`}
              style={{ width: '30cqw' }}
            >
              <div 
                style={{ 
                  width: '12cqh', 
                  height: '12cqh', 
                  marginBottom: '2cqh', 
                  color: isSelected ? '#34d399' : '#52525b',
                  filter: isSelected ? 'drop-shadow(0 0 1cqw rgba(52,211,153,0.8))' : 'none'
                }}
              >
                {app.icon}
              </div>
              <div 
                className={`tracking-widest ${isSelected ? 'text-emerald-400 drop-shadow-[0_0_1cqw_rgba(52,211,153,0.8)]' : 'text-zinc-600'}`} 
                style={{ fontSize: '6cqh' }}
              >
                {app.name}
              </div>
            </div>
          );
        })}
      </div>
      
      <div className="absolute bottom-[10cqh] flex gap-[2cqw]">
        {APPS.map((_, idx) => (
          <div 
            key={idx} 
            className={`transition-colors duration-300 ${idx === menuIndex ? 'bg-emerald-400 shadow-[0_0_1cqw_rgba(52,211,153,0.8)]' : 'bg-zinc-700'}`}
            style={{ width: '2cqw', height: '2cqw' }}
          />
        ))}
      </div>
    </div>
  );
}
```

### `src/system/SystemAudio.ts`

> 系统专属音色（独占 MIDI ch15 Vibraphone + ch9 Drum）。锁死，不被 App 修改。

```ts
import { spessaSynth } from '../core/audio/SynthManager';

// ==========================================
// SYSTEM MENU EXCLUSIVE AUDIO ENGINE
// ==========================================
// 这个文件锁定了 AuraSystem 的专属音色和效果器。
// 无论其他 App 如何修改 core/audio/AudioEngine.ts，
// 系统菜单的声音永远保持最初的空灵感和交互反馈。

// MIDI Channel 15 for System Lead Synth
const LEAD_CHANNEL = 15;
// MIDI Channel 9 for Drums (Standard MIDI Drum Channel)
const DRUM_CHANNEL = 9;

// Helper to convert note name to MIDI number
function noteToMidi(note: string | number): number {
    if (typeof note === 'number') return note;
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const match = note.match(/^([A-G]#?)(-?\d+)$/);
    if (!match) return 60;
    const n = notes.indexOf(match[1]);
    const oct = parseInt(match[2], 10);
    return (oct + 1) * 12 + n;
}

// Convert duration strings to seconds (approximate for UI sounds)
function durationToSeconds(dur: string | number): number {
    if (typeof dur === 'number') return dur;
    if (dur === '16n') return 0.125;
    if (dur === '8n') return 0.25;
    if (dur === '4n') return 0.5;
    if (dur === '2n') return 1.0;
    if (dur === '32n') return 0.0625;
    return 0.5;
}

let isInitialized = false;

function initSystemAudio() {
    if (!spessaSynth || isInitialized) return;
    
    // Setup Lead Synth on Channel 15
    spessaSynth.programChange(LEAD_CHANNEL, 11); // Vibraphone (ethereal)
    spessaSynth.controllerChange(LEAD_CHANNEL, 7, 100); // Volume
    spessaSynth.controllerChange(LEAD_CHANNEL, 91, 127); // Reverb max
    spessaSynth.controllerChange(LEAD_CHANNEL, 93, 64); // Chorus
    
    // Setup Drums on Channel 9
    spessaSynth.controllerChange(DRUM_CHANNEL, 7, 100); // Volume
    spessaSynth.controllerChange(DRUM_CHANNEL, 91, 64); // Reverb
    
    isInitialized = true;
}

export const systemLeadSynth = {
    triggerAttackRelease: (notes: string | number | (string | number)[], duration: string | number, timeDelaySeconds: number = 0, velocity: number = 0.5) => {
        if (!spessaSynth) return;
        initSystemAudio();
        
        const noteArray = Array.isArray(notes) ? notes : [notes];
        const durSecs = durationToSeconds(duration);
        const velMidi = Math.floor(velocity * 127);
        
        setTimeout(() => {
            noteArray.forEach(note => {
                const midiNote = noteToMidi(note);
                if (spessaSynth) {
                    spessaSynth.noteOn(LEAD_CHANNEL, midiNote, velMidi);
                    setTimeout(() => {
                        if (spessaSynth) spessaSynth.noteOff(LEAD_CHANNEL, midiNote);
                    }, durSecs * 1000);
                }
            });
        }, timeDelaySeconds * 1000);
    }
};

export const systemAudio = {
    triggerKick: (timeDelaySeconds: number = 0, velocity: number = 1) => {
        if (!spessaSynth) return;
        initSystemAudio();
        const velMidi = Math.floor(velocity * 127);
        setTimeout(() => {
            if (spessaSynth) {
                spessaSynth.noteOn(DRUM_CHANNEL, 36, velMidi); // Bass Drum 1
                setTimeout(() => { if (spessaSynth) spessaSynth.noteOff(DRUM_CHANNEL, 36); }, 100);
            }
        }, timeDelaySeconds * 1000);
    },
    triggerSnare: (timeDelaySeconds: number = 0, velocity: number = 1) => {
        if (!spessaSynth) return;
        initSystemAudio();
        const velMidi = Math.floor(velocity * 127);
        setTimeout(() => {
            if (spessaSynth) {
                spessaSynth.noteOn(DRUM_CHANNEL, 38, velMidi); // Acoustic Snare
                setTimeout(() => { if (spessaSynth) spessaSynth.noteOff(DRUM_CHANNEL, 38); }, 100);
            }
        }, timeDelaySeconds * 1000);
    },
    triggerHiHat: (timeDelaySeconds: number = 0, velocity: number = 1) => {
        if (!spessaSynth) return;
        initSystemAudio();
        const velMidi = Math.floor(velocity * 127);
        setTimeout(() => {
            if (spessaSynth) {
                spessaSynth.noteOn(DRUM_CHANNEL, 42, velMidi); // Closed Hi-Hat
                setTimeout(() => { if (spessaSynth) spessaSynth.noteOff(DRUM_CHANNEL, 42); }, 100);
            }
        }, timeDelaySeconds * 1000);
    },
    triggerTom: (timeDelaySeconds: number = 0, velocity: number = 1) => {
        if (!spessaSynth) return;
        initSystemAudio();
        const velMidi = Math.floor(velocity * 127);
        setTimeout(() => {
            if (spessaSynth) {
                spessaSynth.noteOn(DRUM_CHANNEL, 45, velMidi); // Low Tom
                setTimeout(() => { if (spessaSynth) spessaSynth.noteOff(DRUM_CHANNEL, 45); }, 100);
            }
        }, timeDelaySeconds * 1000);
    },
    triggerCrash: (timeDelaySeconds: number = 0, velocity: number = 1) => {
        if (!spessaSynth) return;
        initSystemAudio();
        const velMidi = Math.floor(velocity * 127);
        setTimeout(() => {
            if (spessaSynth) {
                spessaSynth.noteOn(DRUM_CHANNEL, 49, velMidi); // Crash Cymbal 1
                setTimeout(() => { if (spessaSynth) spessaSynth.noteOff(DRUM_CHANNEL, 49); }, 100);
            }
        }, timeDelaySeconds * 1000);
    }
};
```

---

## 第三部分：硬件抽象层（HAL）


### `src/core/hal/IHardware.ts`

> ESP32 移植锚点：ILedMatrix → SPI/RMT，ITouchPad → I2C MPR121/CST816S，IAudioOut → I2S DAC，ISystemTimer → FreeRTOS xTaskGetTickCount。

```ts
/**
 * Hardware Abstraction Layer (HAL) Interfaces
 * 
 * These interfaces define the boundary between the core logic and the physical hardware.
 * In the web simulator, these are implemented using React/DOM/WebAudio.
 * On the ESP32-S3, these will be implemented using C++/FreeRTOS drivers (SPI, I2C, I2S).
 */

export interface ILedMatrix {
    /** ESP32: Maps to SPI/RMT driver for WS2812/APA102 */
    setPixel(x: number, y: number, r: number, g: number, b: number): void;
    update(): void;
    clear(): void;
}

export interface ITouchPad {
    /** ESP32: Maps to I2C driver (e.g., MPR121, CST816S) or native Touch peripheral */
    getTouchState(padIndex: number): boolean;
    onPadDown(callback: (padIndex: number) => void): void;
    onPadUp(callback: (padIndex: number) => void): void;
}

export interface IAudioOut {
    /** ESP32: Maps to I2S driver (e.g., MAX98357A, PCM5102) + Software Synth (FluidSynth/TinySoundFont) */
    playNote(pitch: number, velocity: number, durationMs: number, instrumentId: number): void;
    stopNote(pitch: number, instrumentId: number): void;
    setVolume(level: number): void;
}

export interface ISystemTimer {
    /** ESP32: Maps to xTaskGetTickCount() or esp_timer_get_time() */
    getTicksMs(): number;
    delay(ms: number): Promise<void>;
}
```

### `src/core/hal/WebSimulatorHAL.ts`

```ts
import { ILedMatrix, ITouchPad, IAudioOut, ISystemTimer } from './IHardware';

/**
 * Web Simulator implementation of the Hardware Abstraction Layer (HAL).
 * 
 * In the web browser, this class wraps DOM APIs, React state dispatchers, 
 * and Web Audio API to simulate the physical hardware.
 * 
 * On the ESP32-S3, this file will be completely ignored and replaced by 
 * C++ drivers (e.g., EspI2sAudioOut, EspSpiLedMatrix).
 */
export class WebSimulatorHAL implements ILedMatrix, ITouchPad, IAudioOut, ISystemTimer {
    
    // --- ILedMatrix Implementation (Simulated via React State/DOM) ---
    public setPixel(x: number, y: number, r: number, g: number, b: number): void {
        // In a real implementation, this would dispatch to a React Context or directly manipulate a Canvas pixel
        // console.log(`[WebHAL] setPixel(${x}, ${y}) -> rgb(${r},${g},${b})`);
    }

    public update(): void {
        // Trigger React render or Canvas draw
    }

    public clear(): void {
        // Clear virtual LED buffer
    }

    // --- ITouchPad Implementation (Simulated via DOM Pointer Events) ---
    private touchStates: boolean[] = new Array(15).fill(false);
    private padDownCallbacks: ((padIndex: number) => void)[] = [];
    private padUpCallbacks: ((padIndex: number) => void)[] = [];

    public getTouchState(padIndex: number): boolean {
        return this.touchStates[padIndex] || false;
    }

    public onPadDown(callback: (padIndex: number) => void): void {
        this.padDownCallbacks.push(callback);
    }

    public onPadUp(callback: (padIndex: number) => void): void {
        this.padUpCallbacks.push(callback);
    }

    // Internal method to be called by React components when clicked
    public simulatePadDown(padIndex: number) {
        this.touchStates[padIndex] = true;
        this.padDownCallbacks.forEach(cb => cb(padIndex));
    }

    public simulatePadUp(padIndex: number) {
        this.touchStates[padIndex] = false;
        this.padUpCallbacks.forEach(cb => cb(padIndex));
    }

    // --- IAudioOut Implementation (Simulated via Web Audio API / SpessaSynth) ---
    public playNote(pitch: number, velocity: number, durationMs: number, instrumentId: number): void {
        // In the simulator, AudioEngine currently handles SpessaSynth directly.
        // Future refactor: Move SpessaSynth logic here to fully decouple AudioEngine.
        // console.log(`[WebHAL] playNote: pitch=${pitch}, vel=${velocity}, dur=${durationMs}ms`);
    }

    public stopNote(pitch: number, instrumentId: number): void {
        // Stop note
    }

    public setVolume(level: number): void {
        // Set master volume
    }

    // --- ISystemTimer Implementation (Simulated via Browser APIs) ---
    public getTicksMs(): number {
        return performance.now();
    }

    public async delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export const webHAL = new WebSimulatorHAL();
```

### `src/core/hardware/LedMatrix.tsx`

> Web 模拟器：15×9 LED 流体扩散动画（双缓冲 Float32Array + 邻域扩散 + 触摸轨迹 + 音乐粒子）。

```tsx
import React, { useEffect, useRef } from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import { VisualEvent } from '../audio/PlaybackEngine';

interface LedMatrixProps {
  activeKeys: Set<string>;
  appMode?: string;
}

interface Particle {
  x: number;
  y: number;
  hue: number;
  energy: number;
  spread: number;
  targetX: number;
  targetY: number;
  speed: number;
  active: boolean;
}

interface Ripple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  speed: number;
  hue: number;
  thickness: number;
  active: boolean;
}

export function LedMatrix({ activeKeys, appMode }: LedMatrixProps) {
  // Touch Trail Refs
  const activeKeysRef = useRef<Set<string>>(activeKeys);
  const appModeRef = useRef<string | undefined>(appMode);
  const intensitiesA = useRef(new Float32Array(135));
  const intensitiesB = useRef(new Float32Array(135));
  const huesA = useRef(new Float32Array(135));
  const huesB = useRef(new Float32Array(135));
  const isA = useRef(true);
  const ledRefs = useRef<(HTMLDivElement | null)[]>([]);
  const lastTouchPos = useRef({ x: 7, y: 4 });
  const particlesRef = useRef<Particle[]>([]);
  const ripplesRef = useRef<Ripple[]>([]);
  const hitColorsRef = useRef<Map<string, number>>(new Map());
  const isFnKeyActiveRef = useRef(false);

  useEffect(() => {
    activeKeysRef.current = activeKeys;
    
    // Clean up hit colors for released keys
    for (const key of hitColorsRef.current.keys()) {
      if (!activeKeys.has(key)) {
        hitColorsRef.current.delete(key);
      }
    }
  }, [activeKeys]);

  useEffect(() => {
    appModeRef.current = appMode;
  }, [appMode]);

  useEffect(() => {
    const handleVisualEvent = (event: VisualEvent) => {
      const { type, midiNote, velocity } = event;
      
      if (type === 'custom_particle') {
        const cx = event.col !== undefined ? event.col * 3 + 1 : 7;
        const cy = event.row !== undefined ? event.row * 3 + 1 : 4;
        let hue = event.hue ?? 180;

        particlesRef.current.push({
          x: cx, y: cy, hue, energy: event.energy ?? 2.0, spread: event.spread ?? 3.0, targetX: -1, targetY: -1, speed: 0,
          active: true
        });
        return;
      }

      if (type === 'fn_key_active') {
        isFnKeyActiveRef.current = !!event.active;
        return;
      }

      if (type === 'confirm') {
        const cx = event.col !== undefined ? event.col * 3 + 1 : 7;
        const cy = event.row !== undefined ? event.row * 3 + 1 : 4;
        let hue = event.hue ?? 180;
        
        if (event.col !== undefined && event.row !== undefined) {
          const padId = `key-${event.col}-${event.row}`;
          hitColorsRef.current.set(padId, hue);
        }
        return;
      }

      const hue = (midiNote * 12) % 360;
      
      let x = 0, y = 0, energy = 0, spread = 0;
      let targetX = -1, targetY = -1, speed = 0;

      if (type === 'pianoLH' || type === 'pianoRH') {
        // Edges
        x = Math.random() > 0.5 ? Math.floor(Math.random() * 4) : 11 + Math.floor(Math.random() * 4);
        y = 1 + Math.floor(Math.random() * 7);
        energy = velocity * 0.70; // Increased for breathing (+20%)
        spread = 7.2; // Increased spread (+20%)
        
        if (Math.random() > 0.5) {
          // Move inward
          targetX = x < 7 ? x + 3 + Math.random() * 3 : x - 3 - Math.random() * 3;
          targetY = y + (Math.random() * 4 - 2);
          speed = 0.02 + Math.random() * 0.03; // Slower
        }
      } else if (type === 'melody') {
        // Center
        x = 3 + Math.floor(Math.random() * 9);
        y = 1 + Math.floor(Math.random() * 7);
        energy = velocity * 1.03; // Increased (+20%)
        spread = 3.6; // Increased spread (+20%)
        
        if (Math.random() > 0.5) {
          // Move outward
          targetX = x < 7 ? x - 2 - Math.random() * 2 : x + 2 + Math.random() * 2;
          targetY = y + (Math.random() * 4 - 2);
          speed = 0.04 + Math.random() * 0.04; // Slower
        }
      } else if (type === 'drums') {
        // Background wash
        x = Math.floor(Math.random() * 15);
        y = Math.floor(Math.random() * 9);
        energy = velocity * 0.35; // Increased (+20%)
        spread = 10.2; // Increased spread for a wash effect (+20%)
        
        // Slow drift
        targetX = x + (Math.random() * 4 - 2);
        targetY = y + (Math.random() * 4 - 2);
        speed = 0.01 + Math.random() * 0.01; // Extremely slow
      }

      particlesRef.current.push({
        x, y, hue, energy, spread, targetX, targetY, speed,
        active: true
      });
    };

    AudioEngine.addVisualListener(handleVisualEvent);
    return () => AudioEngine.removeVisualListener(handleVisualEvent);
  }, []);

  useEffect(() => {
    let rafId: number;
    const loop = () => {
      const time = performance.now() * 0.001;
      let needsUpdate = false;
      
      const currentIntensities = isA.current ? intensitiesA.current : intensitiesB.current;
      const nextIntensities = isA.current ? intensitiesB.current : intensitiesA.current;
      const currentHues = isA.current ? huesA.current : huesB.current;
      const nextHues = isA.current ? huesB.current : huesA.current;

      // 0. Update Center of Mass
      if (activeKeysRef.current.size > 0) {
        let sumX = 0, sumY = 0, count = 0;
        activeKeysRef.current.forEach(keyId => {
          const parts = keyId.split('-');
          if (parts.length === 3) {
            sumX += parseInt(parts[1]) * 3 + 1;
            sumY += parseInt(parts[2]) * 3 + 1;
            count++;
          }
        });
        if (count > 0) {
          lastTouchPos.current.x += (sumX / count - lastTouchPos.current.x) * 0.3;
          lastTouchPos.current.y += (sumY / count - lastTouchPos.current.y) * 0.3;
        }
      }

      const mixHue = (h1: number, h2: number, w1: number, w2: number) => {
        if (w1 < 0.001) return h2;
        if (w2 < 0.001) return h1;
        let diff = h2 - h1;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        const weight = w2 / (w1 + w2);
        let res = h1 + diff * weight;
        if (res < 0) res += 360;
        return res % 360;
      };

      // 1. Diffusion and Decay
      for (let y = 0; y < 9; y++) {
        for (let x = 0; x < 15; x++) {
          const idx = y * 15 + x;
          let val = currentIntensities[idx];
          let hue = currentHues[idx];

          if (appModeRef.current === 'custom_clear') {
            // Fast clear for custom modes to keep visuals crisp
            val *= 0.5;
            if (val < 0.05) val = 0;
            else needsUpdate = true;
          } else {
            // Diffusion
            let neighborSum = 0;
            let neighbors = 0;
            let neighborHueSumX = 0;
            let neighborHueSumY = 0;

            const addNeighbor = (nIdx: number) => {
              const nVal = currentIntensities[nIdx];
              neighborSum += nVal;
              neighbors++;
              if (nVal > 0.01) {
                const nHue = currentHues[nIdx];
                neighborHueSumX += Math.cos(nHue * Math.PI / 180) * nVal;
                neighborHueSumY += Math.sin(nHue * Math.PI / 180) * nVal;
              }
            };

            if (x > 0) addNeighbor(idx - 1);
            if (x < 14) addNeighbor(idx + 1);
            if (y > 0) addNeighbor(idx - 15);
            if (y < 8) addNeighbor(idx + 15);

            const avgNeighborVal = neighbors > 0 ? neighborSum / neighbors : 0;
            
            // Blend current with neighbors
            val = val * 0.65 + avgNeighborVal * 0.35;

            if (avgNeighborVal > 0.01) {
              const avgNeighborHue = (Math.atan2(neighborHueSumY, neighborHueSumX) * 180 / Math.PI + 360) % 360;
              hue = mixHue(hue, avgNeighborHue, val * 0.65, avgNeighborVal * 0.35);
            }

            // Distance from last touch center
            const dx = x - lastTouchPos.current.x;
            const dy = y - lastTouchPos.current.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Organic smoke decay
            const noise = Math.sin(x * 0.8 + time * 2) * Math.cos(y * 0.8 - time * 1.5);
            const distFactor = Math.pow(Math.max(0, Math.min(1, dist / 12)), 1.5);
            
            // Base decay: 0.96 to 0.98 for slightly longer breathing feel
            const decayBase = 0.96 - (distFactor * 0.015);
            const decay = decayBase + noise * 0.005;

            val *= decay;
            if (val < 0.005) val = 0;
            else needsUpdate = true;
          }

          nextIntensities[idx] = val;
          nextHues[idx] = hue;
        }
      }

      // 2. Inject energy from active keys
      if (activeKeysRef.current.size > 0) {
        const defaultTouchHue = (time * 40) % 360;
        activeKeysRef.current.forEach(keyId => {
          const parts = keyId.split('-');
          if (parts.length === 3) {
            const keyC = parseInt(parts[1]);
            const keyR = parseInt(parts[2]);
            const cx = keyC * 3 + 1;
            const cy = keyR * 3 + 1;

            if (appModeRef.current === 'custom_pad_lit') {
              // In custom modes, just light up the 3x3 block
              let hue = hitColorsRef.current.get(keyId) ?? 180;
              
              for (let y = cy - 1; y <= cy + 1; y++) {
                for (let x = cx - 1; x <= cx + 1; x++) {
                  if (x >= 0 && x < 15 && y >= 0 && y < 9) {
                    const idx = y * 15 + x;
                    const currentE = nextIntensities[idx];
                    nextIntensities[idx] = Math.min(1.5, currentE + 1.5); // Brighter when touched
                    nextHues[idx] = mixHue(nextHues[idx], hue, currentE, 1.5);
                    needsUpdate = true;
                  }
                }
              }
            } else {
              // Default fluid touch trail
              for (let y = 0; y < 9; y++) {
                for (let x = 0; x < 15; x++) {
                  const dx = x - cx;
                  const dy = y - cy;
                  const distSq = dx * dx + dy * dy;

                  const angle = Math.atan2(dy, dx);
                  const shapeNoise = Math.sin(angle * 4 + time * 8) * 2.0;
                  const effectiveDistSq = distSq + shapeNoise;

                  if (effectiveDistSq < 7.2) {
                    const energy = Math.exp(-Math.max(0, effectiveDistSq) / 3.1) * 0.86;
                    const idx = y * 15 + x;
                    const currentE = nextIntensities[idx];
                    nextIntensities[idx] = Math.min(1.44, currentE + energy);
                    nextHues[idx] = mixHue(nextHues[idx], defaultTouchHue, currentE, energy);
                    needsUpdate = true;
                  }
                }
              }
            }
          }
        });
      }

      // 3. Process Particles (Music Events)
      const activeParticles = [];
      for (const p of particlesRef.current) {
        if (!p.active) continue;

        // Inject energy at current position
        for (let y = 0; y < 9; y++) {
          for (let x = 0; x < 15; x++) {
            const dx = x - p.x;
            const dy = y - p.y;
            const distSq = dx * dx + dy * dy;

            if (distSq < p.spread * 2) {
              const energy = Math.exp(-distSq / (p.spread / 2)) * p.energy;
              const idx = y * 15 + x;
              const currentE = nextIntensities[idx];
              nextIntensities[idx] = Math.min(2.0, currentE + energy);
              nextHues[idx] = mixHue(nextHues[idx], p.hue, currentE, energy);
              needsUpdate = true;
            }
          }
        }

        // Move particle
        if (p.targetX !== -1 && p.targetY !== -1) {
          const dx = p.targetX - p.x;
          const dy = p.targetY - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          if (dist < 0.5) {
            // Reached target, do a final burst and die
            p.energy *= 1.5;
            p.targetX = -1; // Stop moving
            p.active = false;
          } else {
            p.x += (dx / dist) * p.speed;
            p.y += (dy / dist) * p.speed;
            p.energy *= 0.95; // Fade out while moving
            if (p.energy < 0.05) p.active = false;
          }
        } else {
          p.active = false; // Static burst dies immediately
        }

        if (p.active) activeParticles.push(p);
      }
      particlesRef.current = activeParticles;

      // 3.5 Process Ripples
      const activeRipples = [];
      for (const r of ripplesRef.current) {
        if (!r.active) continue;

        for (let y = 0; y < 9; y++) {
          for (let x = 0; x < 15; x++) {
            const dx = x - r.x;
            const dy = y - r.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            const distToRing = Math.abs(dist - r.radius);
            
            if (distToRing < r.thickness) {
              // Sharper crest: energy drops quickly as it moves away from the exact ring radius
              const ringEnergy = Math.exp(-(distToRing * distToRing) / 0.5);
              // Fade out as the ripple expands
              const fadeOut = Math.max(0, 1 - (r.radius / r.maxRadius));
              const energy = ringEnergy * fadeOut * 4.0; // High energy for bright crest
              
              if (energy > 0.05) {
                const idx = y * 15 + x;
                const currentE = nextIntensities[idx];
                nextIntensities[idx] = Math.min(4.0, currentE + energy);
                nextHues[idx] = mixHue(nextHues[idx], r.hue, currentE, energy);
                needsUpdate = true;
              }
            }
          }
        }

        r.radius += r.speed;
        if (r.radius >= r.maxRadius) {
          r.active = false;
        } else {
          activeRipples.push(r);
        }
      }
      ripplesRef.current = activeRipples;

      // 4. Render Function Key (Top Right: c=4, r=0 -> x:12-14, y:0-2)
      if (isFnKeyActiveRef.current) {
        const breathe = 0.5 + 0.5 * Math.sin(time * 4); // Fast breathing
        const hue = (time * 60) % 360; // Rainbow cycle
        for (let dy = 0; dy < 3; dy++) {
          for (let dx = 0; dx < 3; dx++) {
            const idx = dy * 15 + (12 + dx);
            nextIntensities[idx] = Math.max(nextIntensities[idx], 0.3 + breathe * 0.7);
            nextHues[idx] = hue;
          }
        }
        needsUpdate = true;
      }

      // 5. Apply to DOM
      if (needsUpdate) {
        for (let i = 0; i < 135; i++) {
          const el = ledRefs.current[i];
          if (el) {
            const intensity = nextIntensities[i];
            if (intensity > 0.005 || el.style.getPropertyValue('--touch-intensity') !== '0') {
              el.style.setProperty('--touch-intensity', intensity > 0.005 ? intensity.toFixed(3) : '0');
              
              if (intensity > 0.005) {
                el.style.setProperty('--touch-hue', nextHues[i].toFixed(1));
              }
            }
          }
        }
      }

      isA.current = !isA.current;
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const leds = [];
  const ledW = 46;
  const ledH = 46;
  const containerW = 1333;
  const containerH = 780;
  const gapX = (containerW - 15 * ledW) / 14;
  const gapY = (containerH - 9 * ledH) / 8;

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 15; c++) {
      const ledIndex = r * 15 + c;
      
      let opacity = 0.07; // Slightly increased background glow (+20%)
      let rgb = { r: 6, g: 182, b: 212 }; // Default Cyan
      let duration = '500ms';
      let timing = 'ease-in';
      let extraClasses = '';

      const colorStr = `${rgb.r},${rgb.g},${rgb.b}`;

      leds.push(
        <div
          key={`led-${c}-${r}`}
          className={`absolute pointer-events-none mix-blend-screen ${extraClasses}`}
          style={{
            left: `calc(${c * (ledW + gapX)} / 1333 * 100%)`,
            top: `calc(${r * (ledH + gapY)} / 780 * 100%)`,
            width: `calc(${ledW} / 1333 * 100%)`,
            height: `calc(${ledH} / 780 * 100%)`,
          }}
        >
          {/* Base Layer */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              opacity: opacity,
              transition: `opacity ${duration} ${timing}`,
              background: `radial-gradient(circle, rgba(255,255,255,0.9) 0%, rgba(${colorStr},0.8) 40%, transparent 70%)`,
              filter: 'blur(1px)',
              boxShadow: `0 0 12px 2.4px rgba(${colorStr},0.6)`
            }}
          />
          {/* Touch Trail Layer */}
          <div
            ref={el => ledRefs.current[ledIndex] = el}
            className="absolute inset-0 rounded-full will-change-transform will-change-opacity"
            style={{
              opacity: 'calc(var(--touch-intensity, 0) * 0.72)',
              transform: 'scale(calc(1 + var(--touch-intensity, 0) * 0.084))',
              background: `radial-gradient(circle, hsla(var(--touch-hue, 180), 100%, 80%, 0.96) 0%, hsla(var(--touch-hue, 180), 100%, 50%, 0.48) 40%, transparent 70%)`,
              filter: 'blur(1px)',
              boxShadow: `0 0 calc(7.2px * var(--touch-intensity, 0)) calc(0.84px * var(--touch-intensity, 0)) hsla(var(--touch-hue, 180), 100%, 50%, 0.36)`
            }}
          />
        </div>
      );
    }
  }

  return <>{leds}</>;
}
```

### `src/core/hardware/TapArea.tsx`

> 5×3 触摸区，键盘映射 z/x/c/v/b · a/s/d/f/g · q/w/e/r/t。t 是 FN 功能键。

```tsx
import React, { useEffect } from 'react';

const KEYBOARD_MAP: Record<string, {c: number, r: number}> = {
  // Bottom Row (r=2)
  'z': { c: 0, r: 2 }, 'x': { c: 1, r: 2 }, 'c': { c: 2, r: 2 }, 'v': { c: 3, r: 2 }, 'b': { c: 4, r: 2 },
  // Middle Row (r=1)
  'a': { c: 0, r: 1 }, 's': { c: 1, r: 1 }, 'd': { c: 2, r: 1 }, 'f': { c: 3, r: 1 }, 'g': { c: 4, r: 1 },
  // Top Row (r=0)
  'q': { c: 0, r: 0 }, 'w': { c: 1, r: 0 }, 'e': { c: 2, r: 0 }, 'r': { c: 3, r: 0 }, 't': { c: 4, r: 0 },
};

interface TapAreaProps {
  onKeyDown: (c: number, r: number) => void;
  onKeyUp: (c: number, r: number) => void;
}

export function TapArea({ onKeyDown, onKeyUp }: TapAreaProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const mapped = KEYBOARD_MAP[key];
      if (mapped && !e.repeat) {
        onKeyDown(mapped.c, mapped.r);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const mapped = KEYBOARD_MAP[key];
      if (mapped) {
        onKeyUp(mapped.c, mapped.r);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [onKeyDown, onKeyUp]);

  const handlePointerDown = (e: React.PointerEvent, c: number, r: number) => {
    if (e.pointerType !== 'touch') {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      onKeyDown(c, r);
    }
  };

  const handlePointerUp = (e: React.PointerEvent, c: number, r: number) => {
    if (e.pointerType !== 'touch') {
      onKeyUp(c, r);
    }
  };

  const handlePointerEnter = (e: React.PointerEvent, c: number, r: number) => {
    if (e.pointerType !== 'touch' && e.buttons > 0) {
      onKeyDown(c, r);
    }
  };

  const handlePointerLeave = (e: React.PointerEvent, c: number, r: number) => {
    if (e.pointerType !== 'touch') {
      onKeyUp(c, r);
    }
  };

  const activeTouchesRefs = React.useRef<Map<number, string>>(new Map());

  const getPadFromPoint = (clientX: number, clientY: number): { c: number, r: number } | null => {
    const el = document.elementFromPoint(clientX, clientY);
    if (el && el.id && el.id.startsWith('key-')) {
      const parts = el.id.split('-');
      if (parts.length === 3) {
        return { c: parseInt(parts[1], 10), r: parseInt(parts[2], 10) };
      }
    }
    return null;
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    // We don't preventDefault here to allow AudioContext to resume on first tap
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const pad = getPadFromPoint(touch.clientX, touch.clientY);
      if (pad) {
        const keyId = `${pad.c}-${pad.r}`;
        activeTouchesRefs.current.set(touch.identifier, keyId);
        onKeyDown(pad.c, pad.r);
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    // e.preventDefault(); // Removed to avoid passive event listener errors. touch-action: none handles scrolling.
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const pad = getPadFromPoint(touch.clientX, touch.clientY);
      const currentKeyId = pad ? `${pad.c}-${pad.r}` : null;
      const previousKeyId = activeTouchesRefs.current.get(touch.identifier);

      if (currentKeyId !== previousKeyId) {
        if (previousKeyId) {
          const [pc, pr] = previousKeyId.split('-').map(Number);
          onKeyUp(pc, pr);
        }
        if (currentKeyId && pad) {
          activeTouchesRefs.current.set(touch.identifier, currentKeyId);
          onKeyDown(pad.c, pad.r);
        } else {
          activeTouchesRefs.current.delete(touch.identifier);
        }
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    // e.preventDefault(); // Removed to avoid passive event listener errors.
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const previousKeyId = activeTouchesRefs.current.get(touch.identifier);
      if (previousKeyId) {
        const [pc, pr] = previousKeyId.split('-').map(Number);
        onKeyUp(pc, pr);
        activeTouchesRefs.current.delete(touch.identifier);
      }
    }
  };

  const keys = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 5; c++) {
      keys.push(
        <div
          key={`key-${c}-${r}`}
          id={`key-${c}-${r}`}
          className="w-full h-full touch-none cursor-pointer select-none outline-none"
          style={{ WebkitTapHighlightColor: 'transparent' }}
          onPointerDown={(e) => handlePointerDown(e, c, r)}
          onPointerUp={(e) => handlePointerUp(e, c, r)}
          onPointerEnter={(e) => handlePointerEnter(e, c, r)}
          onPointerLeave={(e) => handlePointerLeave(e, c, r)}
          onPointerCancel={(e) => handlePointerUp(e, c, r)}
          onContextMenu={(e) => e.preventDefault()}
          onDragStart={(e) => e.preventDefault()}
        />
      );
    }
  }

  return (
    <div 
      className="absolute inset-0 z-50"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <div className="w-full h-full grid" style={{
        gridTemplateColumns: 'repeat(5, 1fr)',
        gridTemplateRows: 'repeat(3, 1fr)',
        gap: 'calc(8.25 / 1358 * 100%) calc(8 / 811 * 100%)'
      }}>
        {keys}
      </div>
    </div>
  );
}
```

---

## 第四部分：核心工具层


### `src/core/utils/PRNG.ts`

> 确定性 LCG。核心约束：禁止使用 Math.random()。Snapshot A/B/C/D 用于 ACVE 验证。

```ts
/**
 * Deterministic Pseudo-Random Number Generator (PRNG)
 *
 * Essential for C/C++ porting to ensure that the same seed produces the exact same
 * musical output on both the Web Simulator and the ESP32-S3 hardware.
 * Replaces Math.random() in core generation logic.
 *
 * Snapshot mechanism (ACVE §5.1):
 *   - 'A' captured at setSeed() / 播放入口
 *   - 'B' captured at MelodyEngine.generateFullSong() 入口
 *   - 'C' captured at Orchestrator.arrange() 入口
 *   - 'D' captured at MidiConverter.convert() 入口
 *
 * 这些 snapshot 用于隔离验证修改是否影响 PRNG 消耗序列。
 * 开发者可在测试中调用 PRNGManager.getSnapshot('B') 拿到当时的 state，
 * 配合 setState() 即可在不重跑整曲的前提下重放某一阶段。
 */
export type PRNGSnapshotKey = 'A' | 'B' | 'C' | 'D';

class PRNG {
    private state: number;
    private lastSeed: number = 0;
    private snapshots: { A?: number; B?: number; C?: number; D?: number } = {};

    constructor(seed: number) {
        this.state = seed;
        this.lastSeed = seed >>> 0;
    }

    // LCG (Linear Congruential Generator) - Fast and C-friendly
    public next(): number {
        this.state = (this.state * 1664525 + 1013904223) % 4294967296;
        return this.state / 4294967296;
    }

    public nextInt(min: number, max: number): number {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }

    public nextFloat(min: number, max: number): number {
        return this.next() * (max - min) + min;
    }

    public setSeed(seed: number): void {
        this.state = seed;
        this.lastSeed = seed >>> 0;
        // 新 seed = 新一轮生成，清空所有 snapshot
        this.snapshots = {};
    }

    public getInitialSeed(): number {
        return this.lastSeed;
    }

    public getState(): number {
        return this.state;
    }

    public setState(state: number): void {
        this.state = state;
    }

    /**
     * 在管道关键节点记录当前 state。
     * key 必须是 'A'/'B'/'C'/'D' 之一，对应 ACVE §5.1 的四个快照点。
     * 重复调用同一 key 会覆盖之前的快照。
     */
    public recordSnapshot(key: PRNGSnapshotKey): void {
        this.snapshots[key] = this.state;
    }

    /**
     * 读取已记录的快照。返回 undefined 表示该快照点尚未被触发。
     */
    public getSnapshot(key: PRNGSnapshotKey): number | undefined {
        return this.snapshots[key];
    }

    /**
     * 一次性返回所有快照（便于序列化/对比）。
     */
    public getAllSnapshots(): { A?: number; B?: number; C?: number; D?: number } {
        return { ...this.snapshots };
    }
}

// D-2 合规：使用固定初始种子，播放入口处由调用方显式 setSeed() 覆盖
export const PRNGManager = new PRNG(0);

```

### `src/core/utils/TrackSerializer.ts`

> NoteData[] → Float32Array 扁平化（C struct 移植预演）。

```ts
import { NoteData } from '../generation/types';

/**
 * TrackSerializer (Memory Optimization & C++ Interop)
 * 
 * In JavaScript, arrays of objects (NoteData[]) cause Garbage Collection (GC) overhead
 * and memory fragmentation. On an ESP32-S3, this leads to Out-Of-Memory (OOM) crashes.
 * 
 * This utility demonstrates how to serialize dynamic JS objects into flat, 
 * pre-allocated TypedArrays (Float32Array). This mimics how data MUST be 
 * structured in C++ (arrays of structs) for the ESP32 port.
 */
export class TrackSerializer {
    // C++ Struct Mapping:
    // struct NoteData { float pitch; float onset; float duration; float velocity; };
    // Stride = 4 floats per note
    public static readonly STRIDE = 4;

    /**
     * Converts an array of NoteData objects into a flat Float32Array.
     * This is zero-GC friendly and can be sent directly to a C++ WebAssembly module
     * or used as a reference for ESP32 memory layout.
     */
    public static serializeNotesToBuffer(notes: NoteData[]): Float32Array {
        const buffer = new Float32Array(notes.length * this.STRIDE);
        
        for (let i = 0; i < notes.length; i++) {
            const note = notes[i];
            const offset = i * this.STRIDE;
            
            buffer[offset + 0] = note.pitch;
            buffer[offset + 1] = note.onset;
            buffer[offset + 2] = note.duration;
            buffer[offset + 3] = note.velocity;
        }
        
        return buffer;
    }

    /**
     * Deserializes a flat Float32Array back into JS objects (for simulator playback).
     */
    public static deserializeBufferToNotes(buffer: Float32Array): NoteData[] {
        const notes: NoteData[] = [];
        const noteCount = buffer.length / this.STRIDE;
        
        for (let i = 0; i < noteCount; i++) {
            const offset = i * this.STRIDE;
            notes.push({
                pitch: buffer[offset + 0],
                onset: buffer[offset + 1],
                duration: buffer[offset + 2],
                velocity: buffer[offset + 3]
            });
        }
        
        return notes;
    }
}
```

### `src/core/storage/SongStorage.ts`

> 占位（暂未实现）。

```ts
export interface SongData {
  id: string;
  name: string;
  style: string;
  createdAt: number;
  trackData?: any;
}

export function saveSong(song: Omit<SongData, 'id' | 'createdAt'>): void {
  // console.log('Saving song:', song);
  // In a real app, this would save to local storage or a backend database
}

export function loadSongs(): SongData[] {
  return [];
}
```

### `src/core/GlobalContext.ts`

> Re-export 兼容层。

```ts
// Re-export from generation module for backward compatibility
export { GlobalContext } from './generation/GlobalContext';
```

---

## 第五部分：音频管线


### `src/core/audio/SynthManager.ts`

> SpessaSynth 异步初始化 + AudioContext 单例 + GM128_3MB.sf2 预取。

```ts
import { WorkletSynthesizer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import { globalMidiScheduler } from './MidiScheduler';

export let spessaSynth: WorkletSynthesizer | null = null;
export let isSpessaSynthReady = false;

// Global AudioContext singleton
export const getAudioContext = (): AudioContext => {
    if (!(window as any).globalAudioContext) {
        (window as any).globalAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return (window as any).globalAudioContext as AudioContext;
};

let initPromise: Promise<void> | null = null;
let gm128Buffer: ArrayBuffer | null = null;

// Pre-fetch soundfonts immediately
fetch('/GM128_3MB.sf2')
    .then(r => r.arrayBuffer())
    .then(b => gm128Buffer = b)
    .catch(e => console.warn("Failed to prefetch GM128", e));

export const startAudioContext = async () => {
  const ctx = getAudioContext();
  if (ctx.state !== 'running') await ctx.resume();
  
  if (isSpessaSynthReady) return initPromise;
  
  if (!initPromise) {
      initPromise = (async () => {
          try {
              // console.log("[AudioEngine] Initializing SpessaSynth with native context");
              await ctx.audioWorklet.addModule(processorUrl);
              spessaSynth = new WorkletSynthesizer(ctx);
              
              // Note: AudioMixer will connect spessaSynth to its master bus later.
              // For now, connect directly to destination as a fallback if mixer isn't ready.
              try {
                  spessaSynth.connect(ctx.destination);
              } catch (e) {
                  console.warn("[AudioEngine] Could not connect spessaSynth to ctx.destination directly:", e);
              }
              
              // Initialize MidiScheduler
              globalMidiScheduler.init(spessaSynth);
              
              // Fetch and load GM128 soundfont
              if (!gm128Buffer) {
                  const response = await fetch('/GM128_3MB.sf2');
                  gm128Buffer = await response.arrayBuffer();
              }
              await spessaSynth.soundBankManager.addSoundBank(gm128Buffer, "main");
              
              await spessaSynth.isReady;
              
              isSpessaSynthReady = true;
              // console.log("[AudioEngine] SpessaSynth initialized and GM128 loaded.");
          } catch (e) {
              console.error("[AudioEngine] Failed to initialize SpessaSynth:", e);
              initPromise = null; // Allow retrying on failure
          }
      })();
  }
  
  return initPromise;
};
```

### `src/core/audio/MidiScheduler.ts`

> 5ms Web Worker 定时器（模拟 FreeRTOS）。loadTrack/start/stop/loop/inject/replace。

```ts
import { WorkletSynthesizer } from 'spessasynth_lib';
import { TempoCurve } from '../generation/types';

export interface MidiEvent {
    ticks: number; // Time in ticks (e.g., 480 PPQ)
    type: 'noteOn' | 'noteOff' | 'cc' | 'programChange' | 'pitchBend' | 'visual';
    channel: number;
    data1: number;
    data2: number;
    visualData?: any; // For visual events
}

/**
 * Custom MIDI Scheduler
 * 
 * This scheduler mimics the behavior of a FreeRTOS hardware timer on the ESP32.
 * Instead of relying on Web Audio's sample-accurate look-ahead,
 * it wakes up periodically and dispatches MIDI events that are due.
 * 
 * This guarantees that the timing logic and event dispatching in the Web Simulator
 * is architecturally identical to how the C++ firmware will push bytes to the I2S/Synth task.
 */
export class MidiScheduler {
    private synth: WorkletSynthesizer | null = null;
    private events: MidiEvent[] = [];
    private eventIndex: number = 0;
    
    public isPlaying: boolean = false;
    private currentTick: number = 0;
    private lastTimeMs: number = 0;
    
    private baseBpm: number = 120;
    private currentBpm: number = 120;
    public readonly ppq: number = 480; // Pulses Per Quarter note (Standard MIDI resolution)
    
    private timerId: number | null = null;
    private timerWorker: Worker | null = null;
    private tempoCurves: TempoCurve[] = [];

    constructor() {
        // Initialize Web Worker for background tab playback
        const workerCode = `
            let timerId = null;
            let interval = 16; // ~60fps
            
            self.onmessage = function(e) {
                if (e.data === 'start') {
                    if (timerId !== null) clearInterval(timerId);
                    timerId = setInterval(function() {
                        postMessage('tick');
                    }, interval);
                } else if (e.data === 'stop') {
                    if (timerId !== null) {
                        clearInterval(timerId);
                        timerId = null;
                    }
                } else if (e.data.interval) {
                    interval = e.data.interval;
                    if (timerId !== null) {
                        clearInterval(timerId);
                        timerId = setInterval(function() {
                            postMessage('tick');
                        }, interval);
                    }
                }
            };
        `;
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        this.timerWorker = new Worker(URL.createObjectURL(blob));
        this.timerWorker.onmessage = (e) => {
            if (e.data === 'tick' && this.isPlaying) {
                this.tickLoop(performance.now());
            }
        };
    }

    // Looping
    public loop: boolean = false;
    public loopStartTicks: number = 0;
    public loopEndTicks: number = 0;

    // Callbacks
    private visualListeners: ((data: any) => void)[] = [];
    private endListeners: (() => void)[] = [];

    // Muted channels
    private mutedChannels: Set<number> = new Set();

    public init(synth: WorkletSynthesizer) {
        this.synth = synth;
    }

    public muteChannel(channel: number, mute: boolean) {
        if (mute) {
            this.mutedChannels.add(channel);
            if (this.synth) {
                this.synth.controllerChange(channel, 123, 0); // All Notes Off
                this.synth.controllerChange(channel, 120, 0); // All Sound Off
            }
        } else {
            this.mutedChannels.delete(channel);
        }
    }

    public isChannelMuted(channel: number): boolean {
        return this.mutedChannels.has(channel);
    }

    public injectEvent(ev: MidiEvent) {
        // Insert event into the sorted events array
        const index = this.events.findIndex(e => e.ticks > ev.ticks);
        if (index === -1) {
            this.events.push(ev);
        } else {
            this.events.splice(index, 0, ev);
            // If the injected event is in the past (before currentTick), increment eventIndex
            // so we don't play it. If it's in the future, we want to play it, so don't increment
            // if it was inserted at or after eventIndex.
            // Actually, if ev.ticks < this.currentTick, it's in the past.
            if (ev.ticks < this.currentTick) {
                this.eventIndex++;
            }
        }
    }

    public getChannelEvents(channel: number): MidiEvent[] {
        return this.events.filter(e => e.channel === channel);
    }

    public replaceChannelEvents(channel: number, startTick: number, newEvents: MidiEvent[], endTick?: number) {
        // Remove all events for this channel from startTick onwards (or up to endTick)
        this.events = this.events.filter(e => {
            if (e.channel !== channel) return true;
            if (e.ticks < startTick) return true;
            if (endTick !== undefined && e.ticks >= endTick) return true;
            return false;
        });
        
        // Add new events
        this.events.push(...newEvents);
        
        // Re-sort events
        this.events.sort((a, b) => a.ticks - b.ticks);
        
        // Recalculate eventIndex
        this.eventIndex = 0;
        while (this.eventIndex < this.events.length && this.events[this.eventIndex].ticks < this.currentTick) {
            this.eventIndex++;
        }
    }

    public addVisualListener(listener: (data: any) => void) {
        this.visualListeners.push(listener);
    }

    public removeVisualListener(listener: (data: any) => void) {
        this.visualListeners = this.visualListeners.filter(l => l !== listener);
    }

    public onTrackEnd(listener: () => void) {
        this.endListeners.push(listener);
    }

    /**
     * Loads a sequence of MIDI events and resets the playhead.
     */
    public loadTrack(events: MidiEvent[], bpm: number, tempoCurves?: TempoCurve[]) {
        // Ensure events are strictly sorted by time
        this.events = events.sort((a, b) => a.ticks - b.ticks);
        this.baseBpm = bpm;
        this.currentBpm = bpm;
        this.tempoCurves = tempoCurves || [];
        this.eventIndex = 0;
        this.currentTick = 0;
        this.mutedChannels.clear();
    }

    public setBpm(bpm: number) {
        this.baseBpm = bpm;
        this.currentBpm = bpm;
    }

    public getBpm(): number {
        return this.currentBpm;
    }

    public setPosition(ticks: number) {
        this.currentTick = ticks;
        // Find the correct event index
        this.eventIndex = 0;
        while (this.eventIndex < this.events.length && this.events[this.eventIndex].ticks < this.currentTick) {
            this.eventIndex++;
        }
    }

    public getCurrentTick(): number {
        return this.currentTick;
    }

    public start() {
        if (!this.synth || this.isPlaying) return;
        this.isPlaying = true;
        this.lastTimeMs = performance.now();
        if (this.timerWorker) {
            this.timerWorker.postMessage('start');
        } else {
            this.timerId = requestAnimationFrame(this.tickLoop);
        }
    }

    public stop() {
        this.isPlaying = false;
        if (this.timerWorker) {
            this.timerWorker.postMessage('stop');
        } else if (this.timerId !== null) {
            cancelAnimationFrame(this.timerId);
            this.timerId = null;
        }
        this.currentTick = 0;
        this.eventIndex = 0;
        this.panic();
    }

    public pause() {
        this.isPlaying = false;
        if (this.timerWorker) {
            this.timerWorker.postMessage('stop');
        } else if (this.timerId !== null) {
            cancelAnimationFrame(this.timerId);
            this.timerId = null;
        }
        // Silence all currently playing notes, but keep the playhead position
        this.panic();
    }

    public clear() {
        this.stop();
        this.events = [];
        this.tempoCurves = [];
        this.visualListeners = [];
        this.endListeners = [];
        this.mutedChannels.clear();
    }

    /**
     * Sends "All Notes Off" and "All Sound Off" to all 16 MIDI channels.
     */
    public panic() {
        if (!this.synth) return;
        for (let i = 0; i < 16; i++) {
            this.synth.controllerChange(i, 123, 0); // All Notes Off
            this.synth.controllerChange(i, 120, 0); // All Sound Off
        }
    }

    private updateBpm() {
        let newBpm = this.baseBpm;
        for (const curve of this.tempoCurves) {
            if (this.currentTick >= curve.startTick && this.currentTick <= curve.endTick) {
                const progress = (this.currentTick - curve.startTick) / (curve.endTick - curve.startTick);
                if (curve.curveType === 'linear') {
                    newBpm = curve.startBpm + (curve.endBpm - curve.startBpm) * progress;
                } else if (curve.curveType === 'exponential') {
                    // Exponential interpolation
                    newBpm = curve.startBpm * Math.pow(curve.endBpm / curve.startBpm, progress);
                }
                break; // Apply the first matching curve
            } else if (this.currentTick > curve.endTick) {
                // If we passed the curve, hold the endBpm (assuming curves are sequential)
                newBpm = curve.endBpm;
            }
        }
        this.currentBpm = newBpm;
    }

    /**
     * The core timing loop. Mimics a hardware timer interrupt.
     */
    private tickLoop = (now: number) => {
        if (!this.isPlaying) return;

        const deltaMs = now - this.lastTimeMs;
        this.lastTimeMs = now;

        // Update BPM based on tempo curves
        this.updateBpm();

        // Calculate how many ticks passed based on current BPM
        // 1 beat = 60000 / BPM ms
        // 1 tick = (60000 / BPM) / PPQ ms
        const msPerTick = (60000 / this.currentBpm) / this.ppq;
        const deltaTicks = deltaMs / msPerTick;
        
        this.currentTick += deltaTicks;

        // Check for loop
        if (this.loop && this.loopEndTicks > 0 && this.currentTick >= this.loopEndTicks) {
            this.currentTick = this.loopStartTicks + (this.currentTick - this.loopEndTicks);
            // Reset event index to loop start
            this.eventIndex = 0;
            while (this.eventIndex < this.events.length && this.events[this.eventIndex].ticks < this.currentTick) {
                this.eventIndex++;
            }
        }

        // Process all events that are due (or overdue)
        while (this.eventIndex < this.events.length) {
            const ev = this.events[this.eventIndex];
            if (ev.ticks <= this.currentTick) {
                this.dispatchEvent(ev);
                this.eventIndex++;
            } else {
                // Next event is in the future, break the loop
                break;
            }
        }

        // Schedule next wake-up if there are more events, or if looping
        if (this.eventIndex < this.events.length || this.loop) {
            if (!this.timerWorker) {
                this.timerId = requestAnimationFrame(this.tickLoop);
            }
        } else {
            this.isPlaying = false; // Track finished
            if (this.timerWorker) {
                this.timerWorker.postMessage('stop');
            }
            this.endListeners.forEach(l => l());
        }
    }

    private dispatchEvent(ev: MidiEvent) {
        if (!this.synth) return;
        
        // Skip note events for muted channels
        if (this.mutedChannels.has(ev.channel) && (ev.type === 'noteOn' || ev.type === 'noteOff')) {
            return;
        }

        switch (ev.type) {
            case 'noteOn':
                this.synth.noteOn(ev.channel, ev.data1, ev.data2);
                break;
            case 'noteOff':
                this.synth.noteOff(ev.channel, ev.data1);
                break;
            case 'cc':
                if (ev.data1 === 0 || ev.data1 === 32) {
                    console.log(`[MidiScheduler] CC ${ev.data1} (Bank) on ch ${ev.channel} = ${ev.data2}`);
                }
                this.synth.controllerChange(ev.channel, ev.data1 as any, ev.data2);
                break;
            case 'programChange':
                console.log(`[MidiScheduler] Program Change on ch ${ev.channel} = ${ev.data1}`);
                this.synth.programChange(ev.channel, ev.data1);
                break;
            case 'pitchBend':
                this.synth.pitchWheel(ev.channel, ev.data1);
                break;
            case 'visual':
                this.visualListeners.forEach(l => l(ev.visualData));
                break;
        }
    }

    /**
     * Helper to convert beats (from ArrangedTrack) to MIDI ticks.
     */
    public beatsToTicks(beats: number): number {
        return Math.round(beats * this.ppq);
    }
}

export const globalMidiScheduler = new MidiScheduler();
```

### `src/core/audio/Instruments.ts`

> SpessaSynthWrapper：每个 InstrumentId 共享一个 MIDI 通道（小乐队编制原则）。

```ts
import { AudioMixer } from "./AudioMixer";
import { spessaSynth } from "./SynthManager";

// ==========================================
// 📄 文件路径: /src/core/audio/Instruments.ts
// 🌟 V3.0 SpessaSynth GM128 Integration
// ==========================================

const GM_MAPPING: Record<string, number> = {
  // Lead
  Acoustic_Grand: 0,
  Electric_Piano_1: 4,
  Lead_2_Sawtooth: 81,
  Violin: 40,
  Viola: 41,
  Cello: 42,
  Contrabass: 43,
  Flute: 73,
  Alto_Sax: 65,
  Tenor_Sax: 66,
  Harmonica: 22,
  
  // Chord
  Acoustic_Guitar_Nylon: 24,
  Acoustic_Guitar_Steel: 25,
  Electric_Guitar_Clean: 27,
  String_Ensemble_1: 48,
  Synth_Strings_1: 50,
  
  // Pad & Choir
  Pad_1_NewAge: 88,
  Pad_2_Warm: 89,
  Choir_Aahs: 52,
  Voice_Oohs: 53,
  Solo_Vox: 85, // GM128 Solo Vox
  Meowsynth: 0, // Custom bank 100
  
  // Arp / Decoration
  Vibraphone: 11,
  Marimba: 12,
  Pizzicato_Strings: 45,
  Reverse_Cymbal: 119, // 🌟 P2: Reverse Cymbal
  
  // Bass
  Acoustic_Bass: 32,
  Electric_Bass_Finger: 33,
  Electric_Bass_Pick: 34,
  Fretless_Bass: 35,
  Synth_Bass_1: 38,
  Synth_Bass_2: 39,
  
  // Drums
  Standard_DrumKit: 0,
  Electronic_DrumKit: 24,
  TR808_DrumKit: 25,
  Orchestral_DrumKit: 48,
  
  System_Aura: 81,
};

// Helper to convert note name to MIDI number (e.g. "C4" -> 60)
function noteToMidi(note: string): number {
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const match = note.match(/^([A-G]#?)(\d+)$/);
    if (match) {
        const n = match[1];
        const octave = parseInt(match[2], 10);
        const index = notes.indexOf(n);
        if (index !== -1) {
            return (octave + 1) * 12 + index;
        }
    }
    return 60; // Default to C4 if parsing fails
}

class SpessaSynthWrapper {
    constructor(
        public channel: number,
        public program: number,
        public isDrum: boolean,
        public bank: number = 0
    ) {
        this.loaded = true;
        if (spessaSynth) {
            spessaSynth.controllerChange(this.channel, 0, this.bank);
            spessaSynth.controllerChange(this.channel, 32, 0);
            spessaSynth.programChange(this.channel, this.program);
        } else {
            console.warn(`[SpessaSynthWrapper] spessaSynth is null during constructor for ch=${this.channel}`);
        }
    }
    
    public loaded = true;

    public triggerAttackRelease(freq: number | string, duration: number, time: number, velocity: number = 1, pitchBend?: number, pitchBendDuration?: number, fadeOutDuration?: number) {
        if (!spessaSynth) {
            console.warn("[SpessaSynthWrapper] spessaSynth is null");
            return;
        }
        
        let midiNote = 60;
        if (typeof freq === 'number') {
            midiNote = Math.round(freq);
        } else {
            midiNote = noteToMidi(freq);
        }
        
        let vel = Math.max(0, Math.min(127, Math.round(velocity * 127)));
        
        // Reduce velocity for Lead Sawtooth (program 81) to make it less harsh
        if (this.program === 81) {
            vel = Math.round(vel * 0.6);
        }
        
        // Reset expression (CC 11) to max before playing
        spessaSynth.controllerChange(this.channel, 11, 127, { time });
        
        // If there's a pitch bend, set the range and start value
        if (pitchBend !== undefined && pitchBendDuration !== undefined) {
            // Set pitch bend range to max of 12 or abs(pitchBend)
            const range = Math.max(12, Math.ceil(Math.abs(pitchBend)));
            spessaSynth.pitchWheelRange(this.channel, range, { time });
            
            // Start at center (8192)
            spessaSynth.pitchWheel(this.channel, 8192, { time });
            spessaSynth.noteOn(this.channel, midiNote, vel, { time });
            
            // Animate pitch wheel at the end of the note
            const steps = 20;
            const stepTime = pitchBendDuration / steps;
            const targetValue = 8192 + Math.round((pitchBend / range) * 8192);
            
            // Delay the start of the pitch bend so it finishes right as the note ends
            const bendDelay = Math.max(0, duration - pitchBendDuration);
            
            for (let i = 1; i <= steps; i++) {
                const currentValue = 8192 + Math.round(((targetValue - 8192) * i) / steps);
                spessaSynth.pitchWheel(this.channel, currentValue, { time: time + bendDelay + (stepTime * i) });
            }
            
            // Reset pitch wheel after note off
            spessaSynth.pitchWheel(this.channel, 8192, { time: time + duration + 0.05 });
        } else {
            spessaSynth.pitchWheel(this.channel, 8192, { time });
            spessaSynth.noteOn(this.channel, midiNote, vel, { time });
        }
        
        // Fade out using Expression (CC 11) if requested
        if (fadeOutDuration !== undefined && fadeOutDuration > 0) {
            const fadeSteps = 20;
            const fadeStepTime = fadeOutDuration / fadeSteps;
            const fadeDelay = Math.max(0, duration - fadeOutDuration);
            
            for (let i = 1; i <= fadeSteps; i++) {
                // Fade from 127 down to 0
                const currentValue = Math.max(0, Math.round(127 * (1 - (i / fadeSteps))));
                spessaSynth.controllerChange(this.channel, 11, currentValue, { time: time + fadeDelay + (fadeStepTime * i) });
            }
        }

        // Note off
        spessaSynth.noteOff(this.channel, midiNote, { time: time + duration });
    }
    
    public dispose() {
        // No-op for SpessaSynth wrapper
    }
}

export class InstrumentRegistry {
  private mixer: AudioMixer;
  private synths: Map<string, SpessaSynthWrapper> = new Map();
  private nextChannel: number = 0;

  constructor(mixer: AudioMixer) {
    this.mixer = mixer;
  }

  public getInstrument(id: string, role: "Foreground" | "Midground" | "Background" | "Rhythm", trackId: string = "default", mixingConfig?: { pan?: number, reverb?: number, volume?: number, delay?: number, chorus?: number }): any {
    let configId = GM_MAPPING[id] !== undefined ? id : "Acoustic_Grand";
    if (id === "System_Aura") {
      configId = "System_Aura";
    } else if (GM_MAPPING[id] === undefined) {
      if (id.includes("Drum") || id.includes("Kit")) configId = "Standard_DrumKit";
      else if (id.includes("Bass") && id.includes("Synth")) configId = "Synth_Bass_1";
      else if (id.includes("Bass")) configId = "Electric_Bass_Finger";
      else if (id.includes("Sax")) configId = "Alto_Sax";
      else if (id.includes("Choir") || id.includes("Voice") || id.includes("Aah") || id.includes("Ooh")) configId = "Voice_Oohs";
      else if (id.includes("Pad")) configId = "Pad_1_NewAge";
      else if (id.includes("Synth") || id.includes("Lead")) configId = "Lead_2_Sawtooth";
      else if (id.includes("Guitar") && id.includes("Clean")) configId = "Electric_Guitar_Clean";
      else if (id.includes("Guitar") && id.includes("Nylon")) configId = "Acoustic_Guitar_Nylon";
      else if (id.includes("Guitar")) configId = "Acoustic_Guitar_Steel";
      else if (id.includes("String")) configId = "String_Ensemble_1";
      else if (id.includes("Piano") && id.includes("Electric")) configId = "Electric_Piano_1";
      else configId = "Acoustic_Grand";
    }

    // 🌟 同一 InstrumentId 共用 MIDI 通道（小乐队编制原则）
    // melody + chord 都是 Acoustic_Grand → 同一通道 → 一把钢琴，无音量叠加
    const instanceId = configId;

    if (!this.synths.has(instanceId)) {
      const isDrum = configId.includes("Drum") || configId.includes("Kit");
      let channel = 0;
      
      if (isDrum) {
          channel = 9;
      } else {
          channel = this.nextChannel % 16;
          if (channel === 9) {
              this.nextChannel++;
              channel = this.nextChannel % 16;
          }
          this.nextChannel++;
      }

      let program = GM_MAPPING[configId] || 0;
      let bank = 0;

      // If the user selected Meowsynth, but we don't have the sf2, fallback to Solo_Vox (85)
      if (configId === 'Meowsynth') {
          program = 85; // Solo_Vox
          bank = 0;
      }

      const synth = new SpessaSynthWrapper(channel, program, isDrum, bank);
      
      if (spessaSynth) {
          // Apply mixing config via MIDI CC
          let vol = 100;
          let pan = 64;
          let reverb = 0;
          let chorus = 0;
          
          if (mixingConfig) {
              // Convert volume (dB) to MIDI CC 7 (0-127)
              // Map 0 dB to 80 to allow headroom for positive dB values
              vol = Math.max(0, Math.min(127, Math.round(80 * Math.pow(10, (mixingConfig.volume || 0) / 20))));
              
              // Convert pan (-1 to 1) to MIDI CC 10 (0-127)
              if (mixingConfig.pan !== undefined && (mixingConfig.pan !== 0 || role === 'Foreground')) {
                  pan = Math.max(0, Math.min(127, Math.round((mixingConfig.pan + 1) * 63.5)));
              }
              
              reverb = Math.max(0, Math.min(127, Math.round((mixingConfig.reverb || 0) * 127)));
              chorus = Math.max(0, Math.min(127, Math.round(mixingConfig.chorus || 0)));
          }
          
          if (configId === "Lead_2_Sawtooth") {
              vol = Math.round(vol * 0.25); // Reduce volume significantly for Lead Sawtooth (was 0.5, now 0.25)
          }
          
          spessaSynth.controllerChange(channel, 7, vol); // Volume
          spessaSynth.controllerChange(channel, 10, pan); // Pan
          spessaSynth.controllerChange(channel, 91, reverb); // Reverb
          spessaSynth.controllerChange(channel, 93, chorus); // Chorus
      }

      this.synths.set(instanceId, synth);
      return synth;
    }

    return this.synths.get(instanceId)!;
  }
}
```

### `src/core/audio/AudioMixer.ts`

> Master DSP 链：HPF→LowShelf→PeakEQ→HighShelf→LPF→WaveShaper→Compressor→MakeupGain。Vinyl_Warmth / Retro_Gadget / Modern_HiFi 三套母带预设。

```ts
import { WorkletSynthesizer } from 'spessasynth_lib';
import { getAudioContext } from './SynthManager';

export class AudioMixer {
    public masterBus: GainNode;
    public hpf: BiquadFilterNode;
    public lowShelf: BiquadFilterNode;
    public peakingEq: BiquadFilterNode;
    public highShelf: BiquadFilterNode;
    public lpf: BiquadFilterNode;
    public masterCompressor: DynamicsCompressorNode;
    public makeupGain: GainNode;
    public currentStyle: string = 'default';
    public waveshaper: WaveShaperNode; // 磁带饱和模拟

    // Intermediate node for native Web Audio API
    private spessaSynthBridge: GainNode;

    private channelStrips: Map<string, { channel: any }> = new Map();

    constructor() {
        const nativeCtx = getAudioContext();
        
        // 增加总增益并加入压缩器和限制器，防止爆音，平滑动态
        this.makeupGain = nativeCtx.createGain();
        this.makeupGain.gain.value = 2.5; // +8dB approx
        
        // 🌟 Master DSP — 3D Panoramic Clean Tone
        // 1. HPF: 清除次声波
        this.hpf = nativeCtx.createBiquadFilter();
        this.hpf.type = 'highpass';
        this.hpf.frequency.value = 35;
        this.hpf.Q.value = 0.7;

        // 2. Low Shelf: bypass（不再提升低频，避免浑浊）
        this.lowShelf = nativeCtx.createBiquadFilter();
        this.lowShelf.type = 'lowshelf';
        this.lowShelf.frequency.value = 200;
        this.lowShelf.gain.value = 0; // 原 +1.5dB 是浑浊元凶，归零

        // 3. Peaking EQ: 铲除 250Hz 浑浊区（给旋律让空间）
        this.peakingEq = nativeCtx.createBiquadFilter();
        this.peakingEq.type = 'peaking';
        this.peakingEq.frequency.value = 250;
        this.peakingEq.Q.value = 1.2;
        this.peakingEq.gain.value = -4.0;

        // 4. High Shelf: 温柔高频
        this.highShelf = nativeCtx.createBiquadFilter();
        this.highShelf.type = 'highshelf';
        this.highShelf.frequency.value = 6000;
        this.highShelf.gain.value = -1.5;

        // 5. LPF: 切掉 11kHz 以上数码感
        this.lpf = nativeCtx.createBiquadFilter();
        this.lpf.type = 'lowpass';
        this.lpf.frequency.value = 11000;
        this.lpf.Q.value = 0.7;

        // 6. WaveShaper: 磁带饱和模拟（默认 bypass = 线性曲线）
        this.waveshaper = nativeCtx.createWaveShaper();
        this.waveshaper.curve = this.makeLinearCurve();
        this.waveshaper.oversample = '2x';

        // 2. DynamicsCompressorNode (Master Glue 胶水压缩)
        this.masterCompressor = nativeCtx.createDynamicsCompressor();
        this.masterCompressor.threshold.value = -22;
        this.masterCompressor.knee.value = 10;
        this.masterCompressor.ratio.value = 2.5;
        this.masterCompressor.attack.value = 0.03; // 30ms
        this.masterCompressor.release.value = 0.15; // 150ms
        
        this.masterBus = nativeCtx.createGain();
        this.masterBus.gain.value = 0.316; // -10dB approx
        
        this.spessaSynthBridge = nativeCtx.createGain();

        // Default Connection (Clean)
        this.connectCleanChain(nativeCtx);
    }

    private connectCleanChain(nativeCtx: AudioContext) {
        this.spessaSynthBridge.disconnect();
        this.masterBus.disconnect();
        this.hpf.disconnect();
        this.lowShelf.disconnect();
        this.peakingEq.disconnect();
        this.highShelf.disconnect();
        this.lpf.disconnect();
        this.waveshaper.disconnect();
        this.masterCompressor.disconnect();
        this.makeupGain.disconnect();

        // Chain: SpessaSynth → MasterBus → HPF → LowShelf → PeakingEQ → HighShelf → LPF → WaveShaper → Compressor → MakeupGain → Output
        this.spessaSynthBridge.connect(this.masterBus);
        this.masterBus.connect(this.hpf);
        this.hpf.connect(this.lowShelf);
        this.lowShelf.connect(this.peakingEq);
        this.peakingEq.connect(this.highShelf);
        this.highShelf.connect(this.lpf);
        this.lpf.connect(this.waveshaper);
        this.waveshaper.connect(this.masterCompressor);
        this.masterCompressor.connect(this.makeupGain);
        this.makeupGain.connect(nativeCtx.destination);
    }

    public connectSpessaSynth(synth: WorkletSynthesizer) {
        try {
            synth.connect(this.spessaSynthBridge);
        } catch (e) {
            console.warn("[AudioMixer] Failed to connect spessaSynth to spessaSynthBridge, trying native destination", e);
            try {
                const ctx = getAudioContext();
                synth.connect(ctx.destination);
            } catch (err) {
                console.error("[AudioMixer] Failed to connect spessaSynth to native destination", err);
            }
        }
    }

    public async applyMasteringProfile(profileId: string) {
        const nativeCtx = getAudioContext();

        if (profileId === 'Vinyl_Warmth') {
            // 🌟 Lo-Fi Vinyl 质感：模拟老式磁带/收音机
            this.lpf.frequency.value = 6500;          // 激进低通（磁带高频衰减）
            this.lpf.Q.value = 0.5;                   // 平缓滚降
            this.highShelf.frequency.value = 4000;     // 更低频率开始衰减
            this.highShelf.gain.value = -4.0;          // 强力削高频
            this.lowShelf.gain.value = 3.0;            // 加厚低频温暖感
            this.peakingEq.frequency.value = 800;      // 提升中低频（收音机特征）
            this.peakingEq.gain.value = 1.5;           // 轻微 boost
            this.peakingEq.Q.value = 0.8;
            this.hpf.frequency.value = 80;             // 提高 HPF（模拟小喇叭无极低频）
            this.waveshaper.curve = this.makeTapeSaturationCurve(0.4); // 轻微磁带饱和
            this.masterCompressor.threshold.value = -20;
            this.masterCompressor.ratio.value = 3.0;   // 更重压缩（磁带压缩感）
            this.makeupGain.gain.value = 3.5;          // 稍降增益（Lo-fi 不需要太响）
        } else if (profileId === 'Retro_Gadget') {
            // 🌟 Retro Gadget：温暖复古但清晰
            this.lpf.frequency.value = 10000;
            this.lpf.Q.value = 0.7;
            this.highShelf.frequency.value = 6000;
            this.highShelf.gain.value = -2.0;
            this.lowShelf.gain.value = 0;
            this.peakingEq.frequency.value = 250;
            this.peakingEq.gain.value = -4.0;
            this.peakingEq.Q.value = 1.2;
            this.hpf.frequency.value = 35;
            this.waveshaper.curve = this.makeLinearCurve();
            this.masterCompressor.threshold.value = -22;
            this.masterCompressor.knee.value = 10;
            this.masterCompressor.ratio.value = 2.5;
            this.makeupGain.gain.value = 2.5;
        } else {
            // Modern_HiFi / Default
            this.lpf.frequency.value = 11000;
            this.lpf.Q.value = 0.7;
            this.highShelf.frequency.value = 6000;
            this.highShelf.gain.value = -1.5;
            this.lowShelf.gain.value = 0;
            this.peakingEq.frequency.value = 250;
            this.peakingEq.gain.value = -4.0;
            this.peakingEq.Q.value = 1.2;
            this.hpf.frequency.value = 35;
            this.waveshaper.curve = this.makeLinearCurve();
            this.masterCompressor.threshold.value = -22;
            this.masterCompressor.knee.value = 10;
            this.masterCompressor.ratio.value = 2.5;
            this.makeupGain.gain.value = 2.5;
        }

        // 重新连接信号链
        this.connectCleanChain(nativeCtx);
    }

    /** 线性曲线（bypass，无失真） */
    private makeLinearCurve(): Float32Array {
        const samples = 256;
        const curve = new Float32Array(samples);
        for (let i = 0; i < samples; i++) {
            curve[i] = (i * 2) / samples - 1;
        }
        return curve;
    }

    /** 磁带饱和曲线（soft clipping）— amount: 0=无, 1=强 */
    private makeTapeSaturationCurve(amount: number): Float32Array {
        const samples = 256;
        const curve = new Float32Array(samples);
        for (let i = 0; i < samples; i++) {
            const x = (i * 2) / samples - 1;
            // 双曲正切软削波：amount 控制饱和程度
            curve[i] = Math.tanh(x * (1 + amount * 3));
        }
        return curve;
    }

    public routeInstrument(id: string, instrument: any, role: 'Foreground'|'Midground'|'Background'|'Rhythm', mixingConfig?: { pan: number, reverb: number, volume: number, delay?: number }) {
        // With SpessaSynth, routing is handled via MIDI CC messages in Instruments.ts
        // We don't need to create separate Web Audio API channels here.
    }

    private getStripByTrackId(trackId: string) {
        return undefined;
    }

    public setMixStyle(style: string) {
        this.currentStyle = style;
        // No-op since we removed style buses
    }

    public getMixerState() {
        return {
            volumes: {
                master: this.masterBus.gain.value,
                melody: 0,
                pianoLH: 7,
                pianoRH: 2
            },
            eq: {
                melody: { low: 0, mid: 0, high: 0 },
                piano: { low: 0, mid: 0, high: 0 }
            },
            effects: {
                reverbWet: 0,
                reverbRoomSize: 0,
                hallWet: 0,
                hallSize: 0,
                filterFreq: 20000,
                compThreshold: 0,
                compRatio: 1
            },
            system: {
                hardwareLofi: 0
            }
        };
    }

    public setMixerParam(category: string, param: string, value: number) {
        if (category === 'volumes') {
            if (param === 'master') this.masterBus.gain.value = value;
        }
    }

    public setFocusTrack(trackType: 'RHYTHM' | 'MELODY' | 'ATMOSPHERE' | 'NONE') {
        // No-op, handled via MIDI CC in the future if needed
    }

    public toggleHardwareLofiMode(enabled: boolean) {
        // No-op
    }

    public randomizeLofiNoise() {
        // No-op
    }

    public stopSoftwareCrackle() {
        // No-op
    }

    public stopAllNoise() {
        // No-op
    }

    public triggerSidechainDucking(time: number, duckDepth: number) {
        // No-op
    }
}```

### `src/core/audio/PlaybackEngine.ts`

> ArrangedTrack → MidiEvent[]（CC7 渐入、CC10 Pan、CC91 Reverb、CC93 Chorus、CC74 亮度、CC11 呼吸/侧链、CC64 延音踏板）。

```ts
// ==========================================
// 📄 文件路径: /src/core/audio/PlaybackEngine.ts
// 🌟 V3.0 纯 MIDI 调度版
// ==========================================
import { ArrangedTrack } from '../generation/types';
import { AudioMixer } from './AudioMixer';
import { InstrumentRegistry } from './Instruments';
import { spessaSynth, startAudioContext } from './SynthManager';
import { globalMidiScheduler, MidiEvent } from './MidiScheduler';
import { PRNGManager } from '../utils/PRNG';

export interface VisualEvent { type: 'melody' | 'pianoLH' | 'pianoRH' | 'drums' | 'bass' | 'counterMelody' | 'confirm' | 'custom_particle' | 'fn_key_active'; midiNote?: number; velocity?: number; col?: number; row?: number; hue?: number; energy?: number; spread?: number; source?: 'playback' | 'gameplay'; time?: number; onset?: number; isUserMotif?: boolean; active?: boolean; }
export type VisualEventListener = (event: VisualEvent) => void;

import { StyleId } from '../generation/config/StyleFlags';
import { StyleRegistry, AcgStyleConfig } from '../generation/config/StyleRegistry';
import { getStyleConfig } from '../generation/config/styles/StyleRegistry';
import { InstrumentProfiles, getInstrumentIdByName } from '../generation/config/InstrumentFlags';

export type PartName = 'vocal' | 'melody' | 'chord' | 'bass' | 'drums' | 'secondaryMelody' | 'counterMelody';

export class PlaybackEngine {
    private mixer: AudioMixer;
    private instruments: InstrumentRegistry;
    private visualListeners: VisualEventListener[] =[];
    private isStopped: boolean = false;
    private totalDurationSeconds: number = 0;
    private drumDucking: boolean = false;
    // 🌟 SeedController 支持：记录当前歌曲每个声部使用的 MIDI channel
    // channel 由 InstrumentRegistry 动态分配（nextChannel++），每次 loadSong 可能变化
    private partChannels: Partial<Record<PartName, number>> = {};

    constructor() {
        this.mixer = new AudioMixer();
        this.instruments = new InstrumentRegistry(this.mixer);
        
        // Forward visual events from MidiScheduler
        globalMidiScheduler.addVisualListener((data: any) => {
            this.emitVisualEvent(data as VisualEvent);
        });
    }

    public setDrumDucking(enabled: boolean) {
        this.drumDucking = enabled;
    }

    // 🌟 SeedController 支持：返回当前歌曲各声部的 MIDI channel
    public getPartChannels(): Partial<Record<PartName, number>> {
        return { ...this.partChannels };
    }

    public getPartChannel(partName: PartName): number | null {
        return this.partChannels[partName] ?? null;
    }

    public addVisualListener(listener: VisualEventListener) { this.visualListeners.push(listener); }
    public removeVisualListener(listener: VisualEventListener) { this.visualListeners = this.visualListeners.filter(l => l !== listener); }
    public emitVisualEvent(event: VisualEvent) { this.visualListeners.forEach(l => l(event)); }

    public getMixerState() {
        return this.mixer.getMixerState();
    }

    public setMixerParam(category: string, param: string, value: number) {
        this.mixer.setMixerParam(category, param, value);
    }

    /**
     * 🌟 SONG COMPARISON LOG (跨系统 A/B 对比专用)
     * 固定字段 + 固定格式,便于与其他音乐生成系统 diff
     * 详见 SONG_COMPARISON_LOG_SPEC.md
     */
    private printComparisonSummary(song: ArrangedTrack): void {
        if (!song.sections || !song.chords) return;

        const sections = song.sections;
        const chords = song.chords;
        const timeSigArr = song.timeSignature || [4, 4];
        const beatsPerBar = timeSigArr[0];
        const totalBeats = sections.length > 0 ? sections[sections.length - 1].endBeat : 0;

        const trackCount = (track?: { length: number }) => track ? track.length : 0;
        const tracks = {
            melody: trackCount(song.melody),
            chord: trackCount(song.pianoRH),
            bass: trackCount(song.pianoLH),
            drums: trackCount(song.drums),
            counter: trackCount(song.counterMelody),
            secondary: trackCount(song.secondaryMelody),
            vocal: trackCount(song.vocal),
        };

        // 预先计算每段 stats
        const sectionStats = sections.map(sec => {
            const secMel = (song.melody || []).filter(
                n => n.onset >= sec.startBeat - 1e-6 && n.onset < sec.endBeat - 1e-6
            );
            const beats = sec.endBeat - sec.startBeat;
            const bars = beats / beatsPerBar;

            let pitchMin = 999, pitchMax = -1;
            for (let i = 0; i < secMel.length; i++) {
                if (secMel[i].pitch < pitchMin) pitchMin = secMel[i].pitch;
                if (secMel[i].pitch > pitchMax) pitchMax = secMel[i].pitch;
            }
            if (pitchMin === 999) { pitchMin = 0; pitchMax = 0; }

            // 级进 ≤2 半音, 跳跃 ≥5 半音(其中 3-4 为"中跳"不计入两类)
            let stepCount = 0, leapCount = 0, total = 0;
            for (let i = 1; i < secMel.length; i++) {
                const iv = Math.abs(secMel[i].pitch - secMel[i - 1].pitch);
                total++;
                if (iv <= 2) stepCount++;
                else if (iv >= 5) leapCount++;
            }
            const stepPct = total > 0 ? Math.round(100 * stepCount / total) : 0;
            const leapPct = total > 0 ? Math.round(100 * leapCount / total) : 0;
            const density = beats > 0 ? (secMel.length / beats) : 0;

            return {
                name: sec.name,
                bars: Number(bars.toFixed(1)),
                beats: Number(beats.toFixed(1)),
                energy: sec.energyLevel,
                count: secMel.length,
                pitchMin,
                pitchMax,
                density: Number(density.toFixed(2)),
                stepPct,
                leapPct,
            };
        });

        // Harmony per section
        const harmony = sections.map(sec => {
            const secChords = chords.filter(
                c => c.startBeat >= sec.startBeat - 1e-6 && c.startBeat < sec.endBeat - 1e-6
            );
            return { name: sec.name, numerals: secChords.map(c => c.numeral).join(' ') };
        });

        const pad = (s: string, n: number) => s.length >= n ? s : s + ' '.repeat(n - s.length);

        console.log('');
        console.log('╔══════════════════════════════════════════════════════════╗');
        console.log('║ 🎵 SONG COMPARISON LOG — AuraFlow                        ║');
        console.log('╚══════════════════════════════════════════════════════════╝');
        console.log(`META: key=${song.key} tempo=${song.bpm} timeSig=${timeSigArr.join('/')} beats=${totalBeats}`);
        console.log(`TRACKS: melody=${tracks.melody} chord=${tracks.chord} bass=${tracks.bass} drums=${tracks.drums} counter=${tracks.counter} secondary=${tracks.secondary} vocal=${tracks.vocal}`);
        console.log('');
        console.log('STRUCTURE (name, bars, beats, energy)');
        for (const s of sectionStats) {
            console.log(`  ${pad(s.name, 16)} bars=${String(s.bars).padStart(4)}  beats=${String(s.beats).padStart(5)}  E=${s.energy}`);
        }
        console.log('');
        console.log('MELODY STATS (name, count, midi_range, density_n_per_beat, step%/leap%)');
        for (const s of sectionStats) {
            console.log(
                `  ${pad(s.name, 16)} count=${String(s.count).padStart(3)}  range=${s.pitchMin}-${s.pitchMax}  dens=${s.density.toFixed(2)}  step=${s.stepPct}%/leap=${s.leapPct}%`
            );
        }
        console.log('');
        console.log('HARMONY (name, chord progression)');
        for (const h of harmony) {
            console.log(`  ${pad(h.name, 16)} ${h.numerals}`);
        }
        console.log('══════════════════════════════════════════════════════════');
    }

    public setFocusTrack(trackType: 'RHYTHM' | 'MELODY' | 'ATMOSPHERE' | 'NONE') {
        this.mixer.setFocusTrack(trackType);
    }

    public async loadSong(song: ArrangedTrack, options?: { withCountIn?: boolean, loopStart?: number, loopEnd?: number }) {
        // 🌟 ACVE §5.1 — 入口快照点 D（MIDI 转换/调度入口，generation pipeline 已结束）
        PRNGManager.recordSnapshot('D');
        this.isStopped = false;
        await startAudioContext();
        
        // --- 打印歌曲元数据 ---
        console.log("========================================");
        console.log("🎵 歌曲生成完毕，开始播放 🎵");
        const actualStyle = getStyleConfig(song.styleId as any);
        console.log(`Style: ${actualStyle.name} (ID: ${song.styleId})`);
        console.log(`BPM: ${song.bpm}`);
        console.log(`Key: ${song.key}`);
        console.log(`Time Signature: ${song.timeSignature ? song.timeSignature.join('/') : '4/4'}`);
        
        console.log("--- 使用的乐器 ---");
        const mixing = song.palette?.mixing || {};
        const printInstrument = (role: string, sound?: string | null, mix?: any) => {
            if (sound) {
                const pan = mix?.pan !== undefined ? mix.pan : 0;
                const panStr = pan === 0 ? 'Center' : (pan < 0 ? `Left ${Math.abs(pan)}` : `Right ${pan}`);
                console.log(`- ${role}: ${sound} (Pan: ${panStr})`);
            }
        };
        printInstrument('Vocal', song.palette?.vocalSound, mixing.vocal);
        printInstrument('Melody', song.palette?.melodySound, mixing.melody);
        printInstrument('Secondary Melody', song.palette?.secondaryMelodySound, mixing.secondaryMelody);
        printInstrument('Chord', song.palette?.chordSound, mixing.chord);
        printInstrument('Bass', song.palette?.bassSound, mixing.bass);
        printInstrument('Drums', song.palette?.drumSound, mixing.drums);
        printInstrument('Counter Melody', song.palette?.counterMelodySound, mixing.counterMelody);

        console.log("--- 全曲和弦与旋律进行 ---");
        if (song.sections && song.chords) {
            const noteToMidiStr = (midi: number): string => {
                const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
                const octave = Math.floor(midi / 12) - 1;
                const note = notes[midi % 12];
                return `${note}${octave}`;
            };

            song.sections.forEach(sec => {
                const sectionChords = song.chords?.filter(c => c.startBeat >= sec.startBeat && c.startBeat < sec.endBeat);
                if (!sectionChords || sectionChords.length === 0) return;

                let chordStr = `[${sec.name}]: | `;
                for (const chord of sectionChords) {
                    chordStr += `${chord.numeral} --- | `;
                }
                console.log(chordStr);

                const printTrackNotes = (trackNotes: any[] | undefined, prefix: string) => {
                    if (!trackNotes || trackNotes.length === 0) return;
                    
                    const secNotes = trackNotes.filter(n => n.onset >= sec.startBeat && n.onset < sec.endBeat);
                    if (secNotes.length === 0) return;

                    let noteStr = `${prefix}_${sec.name}: | `;
                    for (const chord of sectionChords) {
                        const chordNotes = secNotes.filter(n => n.onset >= chord.startBeat && n.onset < chord.endBeat);
                        if (chordNotes.length > 0) {
                            noteStr += chordNotes.map(n => `${noteToMidiStr(n.pitch)}(${Number(n.duration.toFixed(2))})`).join('-') + ' | ';
                        } else {
                            noteStr += '--- | ';
                        }
                    }
                    console.log(noteStr);
                };

                printTrackNotes(song.melody, 'melody');
                printTrackNotes(song.secondaryMelody, 'secondaryMelody');
                printTrackNotes(song.counterMelody, 'counterMelody');
                printTrackNotes(song.pianoLH, 'bass');
            });
        }
        console.log("========================================");

        // 🌟 SONG COMPARISON LOG — 供跨系统 A/B 对比(固定字段,便于 diff)
        this.printComparisonSummary(song);
        // ----------------------

        if (spessaSynth) {
            this.mixer.connectSpessaSynth(spessaSynth);
        }
        
        // 🌟 0. Set Mix Style based on song styleId
        if (song.styleId !== undefined) {
            this.mixer.setMixStyle('default');
        } else {
            this.mixer.setMixStyle('default');
        }

        // 🌟 1. 抽卡聘请总调音师 (Mastering)
        const styleConfig = song.styleId !== undefined ? (StyleRegistry[song.styleId as StyleId] || AcgStyleConfig) : AcgStyleConfig;
        const selectedProfile = styleConfig.masteringProfileId || 'Retro_Gadget';
        await this.mixer.applyMasteringProfile(selectedProfile);

        // 🌟 2. 获取采样器 (100% Soundfont)
        
        const vocalSynth = song.palette?.vocalSound ? this.instruments.getInstrument(song.palette.vocalSound, 'Foreground', 'vocal', mixing.vocal) : null;
        const melodySynth = this.instruments.getInstrument(song.palette?.melodySound || 'Acoustic_Grand', song.palette?.vocalSound ? 'Midground' : 'Foreground', 'melody', mixing.melody);
        const chordSynth = this.instruments.getInstrument(song.palette?.chordSound || 'Warm_EP', 'Midground', 'chord', mixing.chord);

        // 🌟 3. 独立 Bass 采样器：根据流派选择电贝斯或原声贝斯
        const isAcoustic = !!(song.palette?.chordSound && (song.palette.chordSound.includes('Acoustic') || song.palette.chordSound.includes('Jazz')));
        const bassSynth = this.instruments.getInstrument(isAcoustic ? 'Acoustic_Bass' : 'Electric_Bass', 'Rhythm', 'bass', mixing.bass);
        const drumSynth = this.instruments.getInstrument(song.palette?.drumSound || 'Standard_DrumKit', 'Rhythm', 'drums', mixing.drums);

        // 🌟 SeedController 支持：重置 partChannels 并记录本曲分配的 channel
        // secondaryMelody / counterMelody 在后面 addPartEvents 时按需创建，这里先置空
        this.partChannels = {};
        if (vocalSynth) this.partChannels.vocal = vocalSynth.channel;
        this.partChannels.melody = melodySynth.channel;
        this.partChannels.chord = chordSynth.channel;
        this.partChannels.bass = bassSynth.channel;
        this.partChannels.drums = drumSynth.channel;
        if (song.secondaryMelody && song.palette?.secondaryMelodySound) {
            const secSyn = this.instruments.getInstrument(song.palette.secondaryMelodySound, 'Foreground', 'secondaryMelody', mixing.secondaryMelody);
            this.partChannels.secondaryMelody = secSyn.channel;
        }
        if (song.counterMelody && song.palette?.counterMelodySound) {
            const cmSyn = this.instruments.getInstrument(song.palette.counterMelodySound, 'Midground', 'counterMelody', mixing.counterMelody);
            this.partChannels.counterMelody = cmSyn.channel;
        }

        if (this.isStopped) return;

        globalMidiScheduler.stop();
        
        const secPerBeat = 60 / song.bpm;
        
        let maxOnset = 0;
        const updateMaxOnset = (notes?: any[]) => {
            if (notes) {
                notes.forEach(n => {
                    const end = n.onset + (n.duration || 0.5);
                    if (end > maxOnset) maxOnset = end;
                });
            }
        };
        
        updateMaxOnset(song.vocal);
        updateMaxOnset(song.melody);
        updateMaxOnset(song.secondaryMelody);
        updateMaxOnset(song.pianoLH);
        updateMaxOnset(song.pianoRH);
        updateMaxOnset(song.drums);
        updateMaxOnset(song.counterMelody);
        updateMaxOnset(song.userMotif);
        
        const countInBeats = options?.withCountIn ? 4 : 0;
        this.totalDurationSeconds = (maxOnset + countInBeats) * secPerBeat;

        if (options?.loopStart !== undefined && options?.loopEnd !== undefined) {
            globalMidiScheduler.loop = true;
            globalMidiScheduler.loopStartTicks = globalMidiScheduler.beatsToTicks(options.loopStart + countInBeats);
            globalMidiScheduler.loopEndTicks = globalMidiScheduler.beatsToTicks(options.loopEnd + countInBeats);
        } else {
            globalMidiScheduler.loop = false;
        }

        let allEvents: MidiEvent[] = [];

        const scheduleSynthInit = (synth: any) => {
            if (!synth) return;
            const activeSynth = typeof synth === 'function' ? synth(0) : synth;
            if (activeSynth) {
                allEvents.push({
                    ticks: 0,
                    type: 'cc',
                    channel: activeSynth.channel,
                    data1: 0, // Bank Select MSB
                    data2: activeSynth.bank || 0
                });
                allEvents.push({
                    ticks: 0,
                    type: 'cc',
                    channel: activeSynth.channel,
                    data1: 32, // Bank Select LSB
                    data2: 0
                });
                allEvents.push({
                    ticks: 0,
                    type: 'programChange',
                    channel: activeSynth.channel,
                    data1: activeSynth.program || 0,
                    data2: 0
                });

                // 🌟 CC74 亮度控制：高频刺耳乐器降低 Brightness（免费 LPF）
                // GM Program: 40=Violin, 48=StringEnsemble, 56=Trumpet, 61=Brass, 71=Clarinet, 73=Flute
                const prog = activeSynth.program || 0;
                const isHarshTimbre = prog === 40 || prog === 48 || prog === 49 || prog === 56 || prog === 61 || prog === 71 || prog === 73;
                allEvents.push({
                    ticks: 0,
                    type: 'cc',
                    channel: activeSynth.channel,
                    data1: 74, // Brightness / Filter Cutoff
                    data2: isHarshTimbre ? 50 : 64 // 刺耳音色压低到 50，其他保持默认 64
                });
            }
        };

        // Phase 5+: Orchestrator 已在 K-2 转换中应用 keyOffset 并完成 bass 寄存器锁定。
        // PlaybackEngine 不再做转调或音域钳制 — ArrangedTrack 是即放即用的绝对 MIDI。

        const addPartEvents = (notes: any[], synth: any, eventType: VisualEvent['type']) => {
            if (!notes) return;
            notes.forEach(n => {
                // Onset 吸附 16 分音符网格，Duration 保留原始精度（避免截断尾音）
                let rawOnset = Number(n.onset);
                let rawDuration = Number(n.duration);
                let onset = Math.round(rawOnset / 0.25) * 0.25;
                let dur = Math.max(0.1, rawDuration); // 不量化时值，保留连贯感

                if (isNaN(dur) || dur <= 0) dur = 0.5;

                if (eventType === 'drums' && this.drumDucking) {
                    const duckedPitches = [35, 36, 38, 40, 41, 43, 45, 47, 48, 49, 50, 52, 53, 55, 57];
                    if (duckedPitches.includes(n.pitch)) return;
                }

                const activeSynth = typeof synth === 'function' ? synth(onset) : synth;
                let channel = activeSynth.channel;
                let pitch = n.pitch;

                if (pitch !== undefined && !isNaN(pitch)) {
                    const startTick = globalMidiScheduler.beatsToTicks(onset + countInBeats);
                    const durationTicks = globalMidiScheduler.beatsToTicks(dur);
                    const vel = Math.max(0, Math.min(127, Math.round((n.velocity || 1) * 127)));

                    // Note On
                    allEvents.push({
                        ticks: startTick,
                        type: 'noteOn',
                        channel: channel,
                        data1: pitch,
                        data2: vel
                    });

                    // Visual Event
                    allEvents.push({
                        ticks: startTick,
                        type: 'visual',
                        channel: channel,
                        data1: 0,
                        data2: 0,
                        visualData: { type: eventType, midiNote: pitch, velocity: vel, source: 'playback', onset: onset, isUserMotif: n.isUserMotif }
                    });

                    // Note Off
                    allEvents.push({
                        ticks: startTick + durationTicks,
                        type: 'noteOff',
                        channel: channel,
                        data1: pitch,
                        data2: 0
                    });
                }
            });
        };

        const vocalSynthFn = vocalSynth ? () => vocalSynth : null;
        const melodySynthFn = () => melodySynth;
        const chordSynthFn = () => chordSynth;
        const drumSynthFn = () => drumSynth;
        const bassSynthFn = () => bassSynth;

        scheduleSynthInit(vocalSynthFn);
        scheduleSynthInit(melodySynthFn);
        scheduleSynthInit(chordSynthFn);
        scheduleSynthInit(drumSynthFn);
        scheduleSynthInit(bassSynthFn);
        if (song.secondaryMelody && song.palette?.secondaryMelodySound) {
            scheduleSynthInit(() => this.instruments.getInstrument(song.palette!.secondaryMelodySound, 'Foreground', 'secondaryMelody', mixing.secondaryMelody));
        }
        if (song.counterMelody && song.palette?.counterMelodySound) {
            scheduleSynthInit(() => this.instruments.getInstrument(song.palette!.counterMelodySound, 'Midground', 'counterMelody', mixing.counterMelody));
        }

        // 🌟 Luis's Dynamic Panning & Reverb + Gain Staging
        if (song.sections) {
            song.sections.forEach((sec, index) => {
                const startTick = globalMidiScheduler.beatsToTicks(sec.startBeat + countInBeats);
                const energyLevel = sec.energyLevel || 4; // 1-8
                const spread = (energyLevel - 1) / 7.0;

                const applyCC = (synthFn: any, mixConfig: any, energyLevel: number, isDrums: boolean = false) => {
                    if (!synthFn || !mixConfig) return;
                    const channel = synthFn(sec.startBeat).channel;

                    const basePan = mixConfig.pan !== undefined ? Math.max(0, Math.min(127, Math.round((mixConfig.pan + 1) * 63.5))) : 64;
                    const baseReverb = mixConfig.reverb !== undefined ? Math.max(0, Math.min(127, Math.round(mixConfig.reverb * 127))) : 0;
                    const baseVol = mixConfig.volume !== undefined ? Math.max(0, Math.min(115, Math.round(80 * Math.pow(10, mixConfig.volume / 20)))) : 80;

                    const pan = Math.round(64 + (basePan - 64) * spread);
                    const reverb = Math.min(127, Math.round(baseReverb * (0.5 + 0.5 * spread)));
                    const vol = Math.min(115, Math.round(baseVol * (0.8 + 0.2 * spread)));

                    // 🌟 CC7 渐入曲线：非鼓组段落开头 1 拍从 60%→100% 渐变
                    if (!isDrums && index > 0) {
                        for (let step = 0; step < 4; step++) {
                            const progress = (step + 1) / 4;
                            const fadeVol = Math.round(vol * (0.6 + 0.4 * progress));
                            allEvents.push({ ticks: startTick + Math.round(step * globalMidiScheduler.beatsToTicks(0.25)), type: 'cc', channel, data1: 7, data2: fadeVol });
                        }
                    } else {
                        allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 7, data2: vol });
                    }

                    allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 10, data2: pan });
                    allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 91, data2: reverb });

                    if (mixConfig.chorus !== undefined) {
                        allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 93, data2: mixConfig.chorus });
                    }
                };

                applyCC(vocalSynthFn, mixing.vocal, energyLevel);
                applyCC(melodySynthFn, mixing.melody, energyLevel);
                applyCC(drumSynthFn, mixing.drums, energyLevel, true);
                applyCC(bassSynthFn, mixing.bass, energyLevel);
                applyCC(chordSynthFn, mixing.chord, energyLevel);

                if (song.secondaryMelody && song.palette?.secondaryMelodySound) {
                    const secondaryMelodySynth = this.instruments.getInstrument(song.palette.secondaryMelodySound, 'Foreground', 'secondaryMelody', mixing.secondaryMelody);
                    const secondaryMelodySynthFn = () => secondaryMelodySynth;
                    applyCC(secondaryMelodySynthFn, mixing.secondaryMelody, energyLevel);
                }

                if (song.counterMelody && song.palette?.counterMelodySound) {
                    const counterMelodySynth = this.instruments.getInstrument(song.palette.counterMelodySound, 'Midground', 'counterMelody', mixing.counterMelody);
                    const counterMelodySynthFn = () => counterMelodySynth;
                    applyCC(counterMelodySynthFn, mixing.counterMelody, energyLevel);
                }
            });
        }

        if (song.vocal && vocalSynthFn) {
            addPartEvents(song.vocal, vocalSynthFn, 'melody'); // Use 'melody' visual type for now
        }
        addPartEvents(song.melody, melodySynthFn, 'melody');
        if (song.secondaryMelody && song.palette?.secondaryMelodySound) {
            const secondaryMelodySynth = this.instruments.getInstrument(song.palette.secondaryMelodySound, 'Foreground', 'secondaryMelody', mixing.secondaryMelody);
            const secondaryMelodySynthFn = () => secondaryMelodySynth;
            addPartEvents(song.secondaryMelody, secondaryMelodySynthFn, 'melody');
        }
        addPartEvents(song.pianoLH, bassSynthFn, 'pianoLH'); 
        addPartEvents(song.pianoRH, chordSynthFn, 'pianoRH');
        if (song.counterMelody && song.palette?.counterMelodySound) {
            const counterMelodySynth = this.instruments.getInstrument(song.palette.counterMelodySound, 'Midground', 'counterMelody', mixing.counterMelody);
            const counterMelodySynthFn = () => counterMelodySynth;
            addPartEvents(song.counterMelody, counterMelodySynthFn, 'pianoRH'); 
        }
        if (song.drums) {
            addPartEvents(song.drums, drumSynthFn, 'drums');
        }

        // 🌟 CC11 表情呼吸曲线：Sustained/Pad 乐器的背景长音自动生成呼吸包络
        // 仅对 counterMelody 和 secondaryMelody 应用（主旋律不加，避免"断气"）
        const addCC11Swell = (partNotes: any[] | undefined, synthFn: any, instrumentName: string | null | undefined) => {
            if (!partNotes || !synthFn || !instrumentName) return;
            const instId = getInstrumentIdByName(instrumentName);
            const profile = InstrumentProfiles[instId];
            if (!profile.needsCC11) return;
            const activeSynth = typeof synthFn === 'function' ? synthFn(0) : synthFn;
            const channel = activeSynth.channel;
            for (let ni = 0; ni < partNotes.length; ni++) {
                const note = partNotes[ni];
                if (note.duration >= 1.0) {
                    const startTick = globalMidiScheduler.beatsToTicks(note.onset + countInBeats);
                    const endTick = globalMidiScheduler.beatsToTicks(note.onset + note.duration + countInBeats);
                    const midTick = Math.round(startTick + (endTick - startTick) * 0.4);
                    allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 11, data2: 40 });
                    allEvents.push({ ticks: midTick, type: 'cc', channel, data1: 11, data2: 90 });
                    allEvents.push({ ticks: Math.max(startTick + 1, endTick - 120), type: 'cc', channel, data1: 11, data2: 30 });
                }
            }
        };
        if (song.counterMelody && song.palette?.counterMelodySound) {
            const cmSynth = this.instruments.getInstrument(song.palette.counterMelodySound, 'Midground', 'counterMelody', mixing.counterMelody);
            addCC11Swell(song.counterMelody, () => cmSynth, song.palette.counterMelodySound);
        }
        if (song.secondaryMelody && song.palette?.secondaryMelodySound) {
            const secSynth = this.instruments.getInstrument(song.palette.secondaryMelodySound, 'Foreground', 'secondaryMelody', mixing.secondaryMelody);
            addCC11Swell(song.secondaryMelody, () => secSynth, song.palette.secondaryMelodySound);
        }

        // 🌟 提案三：标志性结尾 (Jazz/R&B Signature Ending - CC64 Sustain)
        if (song.chords) {
            song.chords.forEach(chord => {
                if (chord.isSignatureEnding) {
                    const startTick = globalMidiScheduler.beatsToTicks(chord.startBeat + countInBeats);
                    const endTick = globalMidiScheduler.beatsToTicks(chord.endBeat + countInBeats);
                    
                    // 为所有和声乐器 (PianoRH, PianoLH, CounterMelody) 发送 CC64 延音踏板踩下
                    const sustainChannels = new Set<number>();
                    if (chordSynthFn) sustainChannels.add(chordSynthFn().channel);
                    if (bassSynthFn) sustainChannels.add(bassSynthFn().channel);
                    if (song.counterMelody && song.palette?.counterMelodySound) {
                        const cmSynth = this.instruments.getInstrument(song.palette.counterMelodySound, 'Midground', 'counterMelody');
                        sustainChannels.add(cmSynth.channel);
                    }

                    sustainChannels.forEach(channel => {
                        // 踩下踏板 (127)
                        allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 64, data2: 127 });
                        // 松开踏板 (0)
                        allEvents.push({ ticks: endTick, type: 'cc', channel, data1: 64, data2: 0 });
                    });
                    
                    console.log(`[PlaybackEngine] Applied CC64 Sustain for Signature Ending at beat ${chord.startBeat}`);
                }
            });
        }

        // 🌟 Luis's Fake Sidechain (CC 11) — PR #8 启用
        // 仅注入 Bass + Chord;counterMelody 走 addCC11Swell 自己的呼吸包络,不被 sidechain 覆盖
        // StyleConfig.mixing.mixingPreferences.requireSidechain === false 可关闭(Ballad/Classical 风格)
        const sidechainEnabled = styleConfig.orchestration?.mixingPreferences?.requireSidechain !== false;
        if (sidechainEnabled && song.drums) {
            const beatsPerMs = song.bpm / 60 / 1000;
            song.drums.forEach(n => {
                const isKick = n.pitch === 35 || n.pitch === 36;
                if (isKick && n.velocity > 0.7) {
                    const startTick = globalMidiScheduler.beatsToTicks(n.onset + countInBeats);

                    const injectSidechain = (channel: number) => {
                        allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 11, data2: 40 });
                        const tick30 = startTick + globalMidiScheduler.beatsToTicks(30 * beatsPerMs);
                        allEvents.push({ ticks: tick30, type: 'cc', channel, data1: 11, data2: 65 });
                        const tick80 = startTick + globalMidiScheduler.beatsToTicks(80 * beatsPerMs);
                        allEvents.push({ ticks: tick80, type: 'cc', channel, data1: 11, data2: 100 });
                        const tick150 = startTick + globalMidiScheduler.beatsToTicks(150 * beatsPerMs);
                        allEvents.push({ ticks: tick150, type: 'cc', channel, data1: 11, data2: 127 });
                    };

                    injectSidechain(bassSynthFn().channel);
                    injectSidechain(chordSynthFn().channel);
                }
            });
        }

        if (options?.withCountIn) {
            const totalBeats = countInBeats + Math.ceil(maxOnset);
            for (let i = 0; i < totalBeats; i++) {
                const startTick = globalMidiScheduler.beatsToTicks(i);
                const activeSynth: any = drumSynthFn();
                const channel = activeSynth.channel;
                const vel = i < countInBeats ? 127 : 76;
                
                allEvents.push({
                    ticks: startTick,
                    type: 'noteOn',
                    channel: channel,
                    data1: 42, // Closed hi-hat
                    data2: vel
                });
                allEvents.push({
                    ticks: startTick + globalMidiScheduler.beatsToTicks(0.1),
                    type: 'noteOff',
                    channel: channel,
                    data1: 42,
                    data2: 0
                });
            }
        }

        // 🌟 ST-3: Intro Filter Build-up — CC74 (Brightness/Cutoff) 低通涌动
        // 在 Intro 期间注入 CC74 从 20 �� 127 的渐变曲线，让声音从"闷"逐渐变"亮"
        if (song.introFilterSweep && song.sections) {
            const introSec = song.sections.find(s => s.name && s.name.startsWith('Intro'));
            if (introSec) {
                const countInBeats = options?.withCountIn ? (song.timeSignature?.[0] || 4) : 0;
                const introStartTick = globalMidiScheduler.beatsToTicks(introSec.startBeat + countInBeats);
                const introEndTick = globalMidiScheduler.beatsToTicks(introSec.endBeat + countInBeats);
                const steps = 16; // 16 步 CC 自动化，足够��滑
                const ccStart = 20;  // 极度低通
                const ccEnd = 127;   // 全开

                for (let s = 0; s <= steps; s++) {
                    const tick = introStartTick + Math.floor((introEndTick - introStartTick) * s / steps);
                    const value = Math.round(ccStart + (ccEnd - ccStart) * (s / steps));
                    // 对所有非鼓通道（0-8, 10-15）注入 CC74，跳过 GM 鼓通道 9
                    for (let ch = 0; ch < 16; ch++) {
                        if (ch === 9) continue;
                        allEvents.push({ ticks: tick, type: 'cc', channel: ch, data1: 74, data2: value });
                    }
                }

                // Intro 结束后确��� CC74 恢复到默认值 127（防止影��后续段落）
                for (let ch = 0; ch < 16; ch++) {
                    if (ch === 9) continue;
                    allEvents.push({ ticks: introEndTick + 1, type: 'cc', channel: ch, data1: 74, data2: 127 });
                }
            }
        }

        globalMidiScheduler.loadTrack(allEvents, song.bpm, song.tempoCurves);
    }

    public async appendSongChunk(song: ArrangedTrack) {
        // Append logic can be implemented by adding to globalMidiScheduler events
        // For now, this is a placeholder as the architecture shifts to full generation
        console.warn("[PlaybackEngine] appendSongChunk is not fully supported in MidiScheduler yet.");
    }

    public setNextBlockTrigger(triggerBeat: number, callback: () => void) {
        if (this.isStopped) return;
        // Add a visual event that triggers the callback
        const triggerTick = globalMidiScheduler.beatsToTicks(triggerBeat);
        // We can't easily inject a callback into MidiEvent, but we can use visualData
        // However, a simpler way is to just use setTimeout based on current time and BPM
        // Or add a custom event type to MidiScheduler.
        // For now, let's just use a timeout
        const msPerBeat = 60000 / globalMidiScheduler.getBpm();
        const currentBeat = globalMidiScheduler.getCurrentTick() / globalMidiScheduler.ppq;
        const beatsToWait = triggerBeat - currentBeat;
        if (beatsToWait > 0) {
            setTimeout(callback, beatsToWait * msPerBeat);
        } else {
            callback();
        }
    }

    public play() { 
        if (!this.isStopped) globalMidiScheduler.start(); 
    }

    public getDuration(): number {
        return this.totalDurationSeconds;
    }

    public stop() { 
        this.isStopped = true; 
        globalMidiScheduler.stop();
    }
}
```

### `src/core/audio/AudioEngine.ts`

> 顶层单例：playSong / 通道管理 / Jam 模式注入。

```ts
import { PlaybackEngine, VisualEvent, PartName } from './PlaybackEngine';
import { GeneratedTrack, MusicContext, ArrangedTrack } from '../generation/types';
import { StyleId } from '../generation/config/StyleFlags';
import { Orchestrator } from '../generation/arrangement/Orchestrator';
import { MelodyEngine } from '../generation/MelodyEngine'; // 引入新的流水线总管
import { globalMidiScheduler } from './MidiScheduler';
import { spessaSynth, isSpessaSynthReady, getAudioContext, startAudioContext } from './SynthManager';

export { spessaSynth, isSpessaSynthReady, getAudioContext, startAudioContext };

class AudioEngineSystem {
    private playback: PlaybackEngine | null = null;
    private generator: MelodyEngine | null = null;
    private visualsMode: 'all' | 'gameplay-only' = 'all';
    private currentArrangedTrack: ArrangedTrack | null = null;
    private currentContext: MusicContext | null = null;

    private visualListeners: Set<any> = new Set();
    private rawVisualListeners: Set<any> = new Set();

    public init() {
        if (!this.playback) {
            this.playback = new PlaybackEngine();
            // Forward events from PlaybackEngine to our listeners, respecting visualsMode
            this.playback.addVisualListener((event: VisualEvent) => {
                this.rawVisualListeners.forEach(l => l(event));
                if (this.visualsMode === 'gameplay-only' && event.source === 'playback') return;
                this.visualListeners.forEach(l => l(event));
            });
            // console.log(`[AudioEngine] 极智音频总线 V2 初始化完成。`);
        }
    }

    public async playSong(initialTrack: GeneratedTrack, styleId: StyleId, context: MusicContext, generator: MelodyEngine, options?: { withCountIn?: boolean, loopStart?: number, loopEnd?: number }) {
        if (!this.playback) this.init();
        this.generator = generator;

        // 调用 V2 编曲大脑
        const arrangedSong = Orchestrator.arrange(initialTrack, styleId, context);
        this.currentArrangedTrack = arrangedSong;
        this.currentContext = context;

        await this.playback!.loadSong(arrangedSong, options);
        this.playback!.play();
    }

    public stop() {
        if (this.playback) this.playback.stop();
        this.generator = null;
        this.currentArrangedTrack = null;
        this.currentContext = null;
    }

    public getCurrentArrangedTrack(): ArrangedTrack | null {
        return this.currentArrangedTrack;
    }

    public getCurrentContext(): MusicContext | null {
        return this.currentContext;
    }

    // 当前播放位置（拍）。未播放时返回 0。
    public getCurrentBeat(): number {
        const tick = globalMidiScheduler.getCurrentTick();
        const ppq = globalMidiScheduler.ppq;
        if (!ppq || ppq <= 0) return 0;
        return tick / ppq;
    }
    public addVisualListener(listener: any) { this.visualListeners.add(listener); }
    public removeVisualListener(listener: any) { this.visualListeners.delete(listener); }
    
    public addRawVisualListener(listener: any) { this.rawVisualListeners.add(listener); }
    public removeRawVisualListener(listener: any) { this.rawVisualListeners.delete(listener); }
    
    public setVisualsMode(mode: 'all' | 'gameplay-only') {
        this.visualsMode = mode;
    }

    public setDrumDucking(enabled: boolean) {
        if (this.playback) {
            this.playback.setDrumDucking(enabled);
        }
    }

    public emitVisualEvent(event: VisualEvent) { 
        if (!this.playback) this.init(); 
        this.rawVisualListeners.forEach(l => l(event));
        if (this.visualsMode === 'gameplay-only' && event.source === 'playback') return;
        this.visualListeners.forEach(l => l(event));
    }

    public getMixerState() {
        if (!this.playback) this.init();
        return this.playback!.getMixerState();
    }

    public getDuration() {
        if (!this.playback) return 0;
        return this.playback.getDuration();
    }

    public setMixerParam(category: string, param: string, value: number) {
        if (!this.playback) this.init();
        this.playback!.setMixerParam(category, param, value);
    }

    public setFocusTrack(trackType: 'RHYTHM' | 'MELODY' | 'ATMOSPHERE' | 'NONE') {
        if (!this.playback) this.init();
        this.playback!.setFocusTrack(trackType);
    }

    // --- Jam Mode Methods ---
    public muteChannel(channel: number, mute: boolean) {
        globalMidiScheduler.muteChannel(channel, mute);
    }

    public isChannelMuted(channel: number): boolean {
        return globalMidiScheduler.isChannelMuted(channel);
    }

    // --- SeedController 支持 ---
    public getPartChannels(): Partial<Record<PartName, number>> {
        if (!this.playback) return {};
        return this.playback.getPartChannels();
    }

    public setPartMute(partName: PartName, mute: boolean) {
        if (!this.playback) return;
        const channel = this.playback.getPartChannel(partName);
        if (channel !== null) {
            globalMidiScheduler.muteChannel(channel, mute);
        }
    }

    public isPartMuted(partName: PartName): boolean {
        if (!this.playback) return false;
        const channel = this.playback.getPartChannel(partName);
        if (channel === null) return false;
        return globalMidiScheduler.isChannelMuted(channel);
    }

    public injectMidiEvent(ev: any) {
        globalMidiScheduler.injectEvent(ev);
    }

    public getChannelEvents(channel: number) {
        return globalMidiScheduler.getChannelEvents(channel);
    }

    public replaceChannelEvents(channel: number, startTick: number, newEvents: any[], endTick?: number) {
        globalMidiScheduler.replaceChannelEvents(channel, startTick, newEvents, endTick);
    }

    public playNote(channel: number, note: number, velocity: number = 100, durationMs: number = 200) {
        if (!spessaSynth) return;
        spessaSynth.noteOn(channel, note, velocity);
        setTimeout(() => {
            if (spessaSynth) spessaSynth.noteOff(channel, note);
        }, durationMs);
    }

    public noteOn(channel: number, note: number, velocity: number = 100) {
        if (!spessaSynth) return;
        spessaSynth.noteOn(channel, note, velocity);
    }

    public noteOff(channel: number, note: number) {
        if (!spessaSynth) return;
        spessaSynth.noteOff(channel, note);
    }

    public pitchBend(channel: number, value: number) {
        if (!spessaSynth) return;
        spessaSynth.pitchWheel(channel, value);
    }

    public getCurrentTick() {
        return globalMidiScheduler.getCurrentTick();
    }

    public getBpm() {
        return globalMidiScheduler.getBpm();
    }

    public getPpq() {
        return globalMidiScheduler.ppq;
    }
}

export const AudioEngine = new AudioEngineSystem();```

---

## 第六部分：UI 组件


### `src/components/PixelGrids.ts`

> 像素图标位图字典。

```ts
export const GRIDS = {
  radio: [
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0],
    [0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0],
    [0,0,1,1,1,1,1,1,1,1,1,1,0,0,0,0],
    [0,1,0,0,0,0,0,0,0,0,0,0,1,0,0,0],
    [0,1,0,1,1,1,1,1,1,1,1,0,1,0,0,0],
    [0,1,0,1,0,0,0,0,0,0,1,0,1,0,0,0],
    [0,1,0,1,1,1,1,1,1,1,1,0,1,0,0,0],
    [0,1,0,0,0,0,0,0,0,0,0,0,1,0,0,0],
    [0,1,0,0,1,1,0,0,1,1,0,0,1,0,0,0],
    [0,1,0,0,1,1,0,0,1,1,0,0,1,0,0,0],
    [0,1,0,0,0,0,0,0,0,0,0,0,1,0,0,0],
    [0,0,1,1,1,1,1,1,1,1,1,1,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  ],
  euclid: [
    [0,0,0,0,0,1,1,1,1,0,0,0,0,0],
    [0,0,0,1,1,0,0,0,0,1,1,0,0,0],
    [0,0,1,0,0,0,0,0,0,0,0,1,0,0],
    [0,1,0,0,0,1,0,0,1,0,0,0,1,0],
    [0,1,0,0,0,0,0,0,0,0,0,0,1,0],
    [1,0,0,1,0,0,0,0,0,0,1,0,0,1],
    [1,0,0,0,0,0,1,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [0,1,0,0,0,0,0,0,0,0,0,0,1,0],
    [0,1,0,0,1,0,0,0,0,1,0,0,1,0],
    [0,0,1,0,0,0,0,0,0,0,0,1,0,0],
    [0,0,0,1,1,0,0,0,0,1,1,0,0,0],
    [0,0,0,0,0,1,1,1,1,0,0,0,0,0],
  ],
  synth: [
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],
    [0,1,0,0,0,0,0,0,0,0,0,0,0,0,1,0],
    [0,1,0,1,1,0,1,1,0,1,1,0,1,1,1,0],
    [0,1,0,1,1,0,1,1,0,1,1,0,1,1,1,0],
    [0,1,0,1,1,0,1,1,0,1,1,0,1,1,1,0],
    [0,1,0,0,0,0,0,0,0,0,0,0,0,0,1,0],
    [0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  ],
  cocktail: [
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0],
    [0,0,0,1,0,0,0,0,0,0,0,0,1,0,0,0],
    [0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0],
    [0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,0],
    [0,0,0,0,0,0,1,1,1,1,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0],
    [0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  ],
  coffee: [
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,1,0,0,1,0,0,1,0,0,0,0,0],
    [0,0,0,0,0,1,0,0,1,0,0,1,0,0,0,0],
    [0,0,0,0,1,0,0,1,0,0,1,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,1,1,1,1,1,1,1,1,1,1,0,0,0,0],
    [0,0,1,0,0,0,0,0,0,0,0,1,1,1,0,0],
    [0,0,1,0,0,0,0,0,0,0,0,1,0,0,1,0],
    [0,0,1,0,0,0,0,0,0,0,0,1,0,0,1,0],
    [0,0,0,1,0,0,0,0,0,0,1,0,1,1,0,0],
    [0,0,0,0,1,1,1,1,1,1,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  ],
  book: [
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,1,1,1,1,0,0,1,1,1,1,0,0,0],
    [0,0,1,0,0,0,0,1,1,0,0,0,0,1,0,0],
    [0,0,1,0,0,0,0,1,1,0,0,0,0,1,0,0],
    [0,0,1,0,0,0,0,1,1,0,0,0,0,1,0,0],
    [0,0,1,0,0,0,0,1,1,0,0,0,0,1,0,0],
    [0,0,1,0,0,0,0,1,1,0,0,0,0,1,0,0],
    [0,0,1,0,0,0,0,1,1,0,0,0,0,1,0,0],
    [0,0,0,1,1,1,1,0,0,1,1,1,1,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  ],
  seaside: [
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,1,1,1,1,0,0,0,0,0,0],
    [0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,0],
    [0,0,0,0,0,0,1,1,1,1,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [0,0,1,1,0,0,1,1,0,0,1,1,0,0,1,1],
    [0,1,1,0,0,1,1,0,0,1,1,0,0,1,1,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  ],
  city: [
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0],
    [0,0,0,1,1,0,0,1,1,0,0,0,0,0,0,0],
    [0,0,0,1,1,0,0,1,1,0,1,1,1,0,0,0],
    [0,1,1,1,1,0,0,1,1,0,1,1,1,0,0,0],
    [0,1,1,1,1,1,1,1,1,0,1,1,1,0,0,0],
    [0,1,0,1,1,0,1,1,1,1,1,0,1,1,1,0],
    [0,1,0,1,1,0,1,1,1,0,1,0,1,0,1,0],
    [0,1,0,1,1,0,1,1,1,0,1,0,1,0,1,0],
    [0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  ],
  auratap: [
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,1,1,1,0,0,0,0,0,0,0],
    [0,0,0,0,0,1,1,0,1,1,0,0,0,0,0,0],
    [0,0,0,0,1,1,0,0,0,1,1,0,0,0,0,0],
    [0,0,0,1,1,0,0,1,0,0,1,1,0,0,0,0],
    [0,0,1,1,0,0,1,1,1,0,0,1,1,0,0,0],
    [0,0,0,1,1,0,0,1,0,0,1,1,0,0,0,0],
    [0,0,0,0,1,1,0,0,0,1,1,0,0,0,0,0],
    [0,0,0,0,0,1,1,0,1,1,0,0,0,0,0,0],
    [0,0,0,0,0,0,1,1,1,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  ],
  aurabeat: [
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],
    [0,1,0,0,0,0,0,0,0,0,0,0,0,0,1,0],
    [0,1,0,1,1,0,1,1,0,1,1,0,1,1,1,0],
    [0,1,0,1,1,0,1,1,0,1,1,0,1,1,1,0],
    [0,1,0,0,0,0,0,0,0,0,0,0,0,0,1,0],
    [0,1,0,1,1,0,1,1,0,1,1,0,1,1,1,0],
    [0,1,0,1,1,0,1,1,0,1,1,0,1,1,1,0],
    [0,1,0,0,0,0,0,0,0,0,0,0,0,0,1,0],
    [0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  ]
};
```

### `src/components/PixelIcon.tsx`

```tsx
import React from 'react';

export const PixelIcon = ({ grid, color = 'currentColor', className = '' }: { grid: number[][], color?: string, className?: string }) => {
  const height = grid.length;
  const width = grid[0].length;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className} style={{ width: '100%', height: '100%', imageRendering: 'pixelated' }}>
      {grid.map((row, y) => row.map((cell, x) => cell ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={color} /> : null))}
    </svg>
  );
};
```

### `src/components/PipelineMonitor.tsx`

> Q+H 切换。实时五阶段管道可视化（Stage 1 Meta / Stage 2 Harmony / Stage 3 Structure / Stage 4 Conductor / Stage 5 Ensemble）。本轮新增可拖拽 header + `resize: both`，与 SeedController/VolumeController 行为对齐。

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { motion, useDragControls } from 'motion/react';
import { Activity, X } from 'lucide-react';
import { AudioEngine } from '../core/audio/AudioEngine';
import { PRNGManager } from '../core/utils/PRNG';
import {
    ArrangedTrack,
    GeneratedChord,
    MusicContext,
    SectionMetadata,
    TonalityName,
    Tonality,
    InstrumentRole,
    ConductorSectionPlan,
} from '../core/generation/types';
import { MoodRegistry } from '../core/generation/config/MoodFlags';
import { StyleIdName } from '../core/generation/config/StyleFlags';

const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

const QUALITY_SUFFIX: Record<string, string> = {
    Major: '', Minor: 'm', Diminished: 'dim', Diminished7: 'dim7', Augmented: 'aug',
    Dominant7: '7', Minor7: 'm7', Major7: 'maj7', HalfDiminished: 'm7b5',
    Sus4: 'sus4', Dominant7Sus4: '7sus4', Add9: 'add9',
    Minor9: 'm9', Major9: 'maj9', Dominant9: '9', Minor11: 'm11', Dominant13: '13',
};

function chordToAbsoluteName(chord: GeneratedChord): string {
    const offset = chord.keyOffset ?? 0;
    const absRoot = ((chord.root + offset) % 12 + 12) % 12;
    return KEY_NAMES[absRoot] + (QUALITY_SUFFIX[chord.quality] ?? '');
}

function tonalityToHumanScale(tonality: Tonality | undefined): string {
    if (tonality === undefined) return '—';
    const raw = TonalityName[tonality] ?? 'Unknown';
    return raw.replace(/_/g, ' ');
}

function tonalityToShortMode(tonality: Tonality | undefined): string {
    if (tonality === undefined) return '';
    if (tonality === Tonality.Major || tonality === Tonality.Major_Pentatonic) return 'Major';
    return 'Minor';
}

interface FrameSnapshot {
    arranged: ArrangedTrack | null;
    context: MusicContext | null;
    beat: number;
    seed: number;
}

export const PipelineMonitor: React.FC = () => {
    const [isVisible, setIsVisible] = useState(true);
    const [frame, setFrame] = useState<FrameSnapshot>({
        arranged: null, context: null, beat: 0, seed: 0,
    });
    const rafRef = useRef<number | null>(null);
    const dragControls = useDragControls();

    useEffect(() => {
        const keysPressed = new Set<string>();
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.repeat) return;
            keysPressed.add(e.key.toLowerCase());
            if (keysPressed.has('q') && keysPressed.has('h')) setIsVisible((v) => !v);
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            keysPressed.delete(e.key.toLowerCase());
        };
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, []);

    useEffect(() => {
        if (!isVisible) return;
        const tick = () => {
            const arranged = AudioEngine.getCurrentArrangedTrack();
            const context = AudioEngine.getCurrentContext();
            const beat = AudioEngine.getCurrentBeat();
            const seed = PRNGManager.getInitialSeed();
            setFrame((prev) => {
                if (prev.arranged === arranged
                    && prev.context === context
                    && Math.abs(prev.beat - beat) < 0.01
                    && prev.seed === seed) {
                    return prev;
                }
                return { arranged, context, beat, seed };
            });
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => {
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        };
    }, [isVisible]);

    if (!isVisible) return null;

    const { arranged, context, beat, seed } = frame;

    const sections: SectionMetadata[] = arranged?.sections ?? [];
    const chords: GeneratedChord[] = arranged?.chords ?? [];

    let currentSectionIdx = -1;
    for (let i = 0; i < sections.length; i++) {
        if (beat + 1e-6 >= sections[i].startBeat && beat < sections[i].endBeat - 1e-6) {
            currentSectionIdx = i; break;
        }
    }
    const currentSection = currentSectionIdx >= 0 ? sections[currentSectionIdx] : null;

    let currentChordIdx = -1;
    for (let i = 0; i < chords.length; i++) {
        if (beat + 1e-6 >= chords[i].startBeat && beat < chords[i].endBeat - 1e-6) {
            currentChordIdx = i; break;
        }
    }

    const conductorPlanForCurrent = context?.conductorPlan?.sections.find(
        s => currentSection
            && s.sectionName === currentSection.name
            && Math.abs(s.startBeat - currentSection.startBeat) < 1e-6,
    ) ?? null;

    return (
        <motion.div
            drag
            dragControls={dragControls}
            dragListener={false}
            dragMomentum={false}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed z-50 top-4 right-4 flex flex-col bg-zinc-950/90 backdrop-blur-md rounded-2xl border border-zinc-800 shadow-[0_8px_30px_rgba(0,0,0,0.6)] overflow-hidden"
            style={{
                width: 640,
                height: 'min(92vh, 760px)',
                minWidth: 420,
                minHeight: 320,
                resize: 'both',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
        >
            {/* Header (Draggable) */}
            <div
                className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/80 cursor-grab active:cursor-grabbing bg-gradient-to-b from-zinc-900/80 to-transparent shrink-0"
                onPointerDown={(e) => dragControls.start(e)}
            >
                <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-zinc-400" />
                    <h3 className="text-zinc-300 font-bold tracking-widest text-xs uppercase">
                        Pipeline Monitor
                    </h3>
                </div>
                <button
                    onClick={() => setIsVisible(false)}
                    className="text-zinc-500 hover:text-white transition-colors"
                    title="Q+H 切换"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* 双栏内容区（按 header 之外的剩余空间分配） */}
            <div className="flex flex-1 min-h-0 overflow-hidden">
                {/* 左栏：Stage 01-02 */}
                <div className="w-1/2 overflow-y-auto custom-pipeline-scroll border-r border-zinc-800/60">
                    <Stage1MetaForm
                        bpm={arranged?.bpm}
                        keyName={arranged?.key}
                        tonality={context?.tonality}
                        seed={seed}
                        moodName={context?.moodId !== undefined ? MoodRegistry[context.moodId]?.name : undefined}
                        styleName={context?.style ? StyleIdName[context.style.id] : undefined}
                        trajectory={context?.trajectoryProfile}
                    />
                    <Stage2Harmony
                        chords={chords}
                        currentSection={currentSection}
                        currentChordIdx={currentChordIdx}
                    />
                </div>

                {/* 右栏：Stage 03-05 */}
                <div className="w-1/2 overflow-y-auto custom-pipeline-scroll">
                    <Stage3Structure
                        sections={sections}
                        currentSectionIdx={currentSectionIdx}
                        beatsPerBar={arranged?.timeSignature?.[0]}
                    />
                    <Stage4Conductor
                        plan={conductorPlanForCurrent}
                        globalRhythm={context?.conductorPlan?.globalRhythmProfile}
                    />
                    <Stage5Ensemble
                        palette={arranged?.palette}
                        plan={conductorPlanForCurrent}
                    />
                </div>
            </div>

            {/* 右下 resize 提示 */}
            <div className="absolute bottom-1 right-1 w-3 h-3 cursor-se-resize opacity-30 pointer-events-none text-zinc-400">
                <svg viewBox="0 0 10 10" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 10V8H10V10H8ZM5 10V8H7V10H5ZM8 7V5H10V7H8ZM2 10V8H4V10H2ZM5 7V5H7V7H5ZM8 4V2H10V4H8Z" />
                </svg>
            </div>

            <style dangerouslySetInnerHTML={{ __html: `
                .custom-pipeline-scroll::-webkit-scrollbar { width: 4px; }
                .custom-pipeline-scroll::-webkit-scrollbar-track { background: rgba(0,0,0,0.3); }
                .custom-pipeline-scroll::-webkit-scrollbar-thumb { background: rgba(82,82,91,0.5); border-radius: 2px; }
                .custom-pipeline-scroll::-webkit-scrollbar-thumb:hover { background: rgba(161,161,170,0.6); }
            `}} />
        </motion.div>
    );
};

const StageBadge: React.FC<{ label: string; color: string }> = ({ label, color }) => (
    <div
        className="inline-block px-2 py-0.5 rounded border text-[10px] font-bold tracking-widest uppercase"
        style={{ borderColor: color, color }}
    >
        {label}
    </div>
);

const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="text-[9px] uppercase tracking-widest text-zinc-500 mb-1">{children}</div>
);

interface Stage1Props {
    bpm: number | undefined;
    keyName: string | undefined;
    tonality: Tonality | undefined;
    seed: number;
    moodName: string | undefined;
    styleName: string | undefined;
    trajectory: { sync: string; path: string } | undefined;
}

const Stage1MetaForm: React.FC<Stage1Props> = ({ bpm, keyName, tonality, seed, moodName, styleName, trajectory }) => {
    const tonicLabel = keyName ?? '—';
    const modeLabel = tonalityToShortMode(tonality);
    return (
        <section className="px-4 pt-4 pb-3 border-b border-zinc-800/60">
            <StageBadge label="Stage 01: Meta & Form" color="rgb(45, 212, 191)" />
            <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="bg-black/40 rounded-lg p-3 border border-zinc-800 relative overflow-hidden">
                    <div className="absolute inset-0 flex justify-around items-stretch opacity-20 pointer-events-none">
                        {Array.from({ length: 8 }).map((_, i) => (
                            <div key={i} className="w-px bg-emerald-500/40" />
                        ))}
                    </div>
                    <div className="relative text-center">
                        <span className="text-[10px] text-zinc-500 mr-1">BPM:</span>
                        <span className="text-emerald-300 text-2xl font-bold">{bpm ?? '—'}</span>
                    </div>
                </div>
                <div className="bg-black/40 rounded-lg p-3 border border-zinc-800 text-center">
                    <div className="text-[9px] uppercase tracking-widest text-zinc-500">Key</div>
                    <div className="text-white text-lg font-bold mt-1">
                        {tonicLabel} {modeLabel}
                    </div>
                </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                    <FieldLabel>Seed</FieldLabel>
                    <div className="text-white text-xs break-all">{seed || '—'}</div>
                </div>
                <div>
                    <FieldLabel>Emotion</FieldLabel>
                    <div className="text-amber-400 text-sm font-bold uppercase">{moodName ?? '—'}</div>
                </div>
            </div>

            <div className="mt-3">
                <FieldLabel>Style Profile</FieldLabel>
                <div className="text-cyan-400 text-sm font-bold uppercase tracking-wide">{styleName ?? '—'}</div>
            </div>

            <div className="mt-3">
                <FieldLabel>Melody Scale</FieldLabel>
                <div className="text-white text-sm">{tonalityToHumanScale(tonality)}</div>
            </div>

            <div className="mt-3">
                <FieldLabel>Trajectory & Rhythm</FieldLabel>
                <div className="text-amber-400 text-xs leading-relaxed">
                    <div>Sync: {trajectory?.sync ?? '—'}</div>
                    <div>Path: {trajectory?.path ?? '—'}</div>
                </div>
            </div>
        </section>
    );
};

interface Stage2Props {
    chords: GeneratedChord[];
    currentSection: SectionMetadata | null;
    currentChordIdx: number;
}

const Stage2Harmony: React.FC<Stage2Props> = ({ chords, currentSection, currentChordIdx }) => {
    let windowChords: { chord: GeneratedChord; idx: number }[] = [];
    if (currentSection) {
        for (let i = 0; i < chords.length; i++) {
            const c = chords[i];
            if (c.startBeat + 1e-6 >= currentSection.startBeat
                && c.startBeat < currentSection.endBeat - 1e-6) {
                windowChords.push({ chord: c, idx: i });
            }
        }
    }
    if (windowChords.length === 0 && chords.length > 0) {
        windowChords = chords.slice(0, 4).map((c, i) => ({ chord: c, idx: i }));
    }

    return (
        <section className="px-4 pt-4 pb-3 border-b border-zinc-800/60">
            <StageBadge label="Stage 02: Harmony" color="rgb(251, 146, 60)" />
            <div className="mt-3 flex flex-wrap gap-2">
                {windowChords.length === 0 ? (
                    <div className="text-zinc-600 text-xs">— 无和声 —</div>
                ) : (
                    windowChords.map(({ chord, idx }) => {
                        const isCurrent = idx === currentChordIdx;
                        return (
                            <div
                                key={idx}
                                title={chord.numeral}
                                className={
                                    'px-3 py-2 rounded-lg border text-base font-bold ' +
                                    (isCurrent
                                        ? 'border-emerald-400 text-white bg-black/60 ring-1 ring-emerald-400/40'
                                        : 'border-zinc-700 text-zinc-300 bg-black/30')
                                }
                            >
                                {chordToAbsoluteName(chord)}
                            </div>
                        );
                    })
                )}
            </div>
        </section>
    );
};

interface Stage3Props {
    sections: SectionMetadata[];
    currentSectionIdx: number;
    beatsPerBar: number | undefined;
}

const Stage3Structure: React.FC<Stage3Props> = ({ sections, currentSectionIdx, beatsPerBar }) => (
    <section className="px-4 pt-4 pb-3 border-b border-zinc-800/60">
        <StageBadge label="Stage 03: Structure" color="rgb(34, 211, 238)" />
        <div className="mt-3 space-y-1">
            {sections.length === 0 ? (
                <div className="text-zinc-600 text-xs">— 无段落 —</div>
            ) : (
                sections.map((s, i) => {
                    const isCurrent = i === currentSectionIdx;
                    const bars = beatsPerBar ? Math.round((s.endBeat - s.startBeat) / beatsPerBar) : 0;
                    return (
                        <div
                            key={i}
                            className={
                                'flex items-center gap-2 px-2 py-1 rounded text-[11px] ' +
                                (isCurrent ? 'bg-cyan-500/15 border border-cyan-400/40' : 'border border-transparent')
                            }
                        >
                            <span className={isCurrent ? 'text-cyan-300 font-bold' : 'text-zinc-400'}>
                                {s.name}
                            </span>
                            <span className="flex-1 text-zinc-600 text-[10px]">{bars}b</span>
                            <EnergyBar level={s.energyLevel} active={isCurrent} />
                        </div>
                    );
                })
            )}
        </div>
    </section>
);

const EnergyBar: React.FC<{ level: number; active: boolean }> = ({ level, active }) => {
    const pct = Math.max(0, Math.min(10, level)) * 10;
    return (
        <div className="w-12 h-1 bg-zinc-800 rounded overflow-hidden">
            <div
                className={'h-full ' + (active ? 'bg-cyan-400' : 'bg-zinc-600')}
                style={{ width: `${pct}%` }}
            />
        </div>
    );
};

interface Stage4Props {
    plan: ConductorSectionPlan | null;
    globalRhythm: string | undefined;
}

const Stage4Conductor: React.FC<Stage4Props> = ({ plan, globalRhythm }) => {
    if (!plan) {
        return (
            <section className="px-4 pt-4 pb-3 border-b border-zinc-800/60">
                <StageBadge label="Stage 04: Conductor" color="rgb(168, 85, 247)" />
                <div className="mt-3 text-zinc-600 text-xs">— 无指挥计划 —</div>
            </section>
        );
    }
    return (
        <section className="px-4 pt-4 pb-3 border-b border-zinc-800/60">
            <StageBadge label="Stage 04: Conductor" color="rgb(168, 85, 247)" />
            <div className="mt-3 space-y-2 text-[11px]">
                <RoleRow label="Focus" roles={[plan.focusInstrument]} color="text-purple-300" />
                <RoleRow label="Support" roles={plan.supportInstruments} color="text-zinc-300" />
                <RoleRow label="Silent" roles={plan.silentInstruments} color="text-zinc-600" />
                <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                        <div className="text-[9px] uppercase tracking-widest text-zinc-500">Rhythm</div>
                        <div className="text-purple-300 text-xs">{plan.rhythmCenter}</div>
                    </div>
                    <div>
                        <div className="text-[9px] uppercase tracking-widest text-zinc-500">Global</div>
                        <div className="text-purple-300 text-xs">{globalRhythm ?? '—'}</div>
                    </div>
                </div>
                {plan.fillWindows.length > 0 && (
                    <div>
                        <div className="text-[9px] uppercase tracking-widest text-zinc-500">Fill @</div>
                        <div className="text-amber-400 text-xs">{plan.fillWindows.map(b => b.toFixed(1)).join(', ')}</div>
                    </div>
                )}
            </div>
        </section>
    );
};

const RoleRow: React.FC<{ label: string; roles: InstrumentRole[]; color: string }> = ({ label, roles, color }) => (
    <div className="flex items-baseline gap-2">
        <span className="text-[9px] uppercase tracking-widest text-zinc-500 w-14">{label}</span>
        <div className="flex flex-wrap gap-1">
            {roles.length === 0
                ? <span className="text-zinc-700 text-[11px]">—</span>
                : roles.map((r, i) => <span key={i} className={`text-[11px] ${color}`}>{r}</span>)}
        </div>
    </div>
);

interface Stage5Props {
    palette: ArrangedTrack['palette'] | undefined;
    plan: ConductorSectionPlan | null;
}

const ROLE_TO_PALETTE_KEY: Record<InstrumentRole, keyof NonNullable<ArrangedTrack['palette']>> = {
    melody: 'melodySound',
    vocal: 'vocalSound',
    chord: 'chordSound',
    bass: 'bassSound',
    drums: 'drumSound',
    counter: 'counterMelodySound',
    secondary: 'secondaryMelodySound',
};

const ALL_ROLES: InstrumentRole[] = ['melody', 'vocal', 'chord', 'bass', 'drums', 'counter', 'secondary'];

const Stage5Ensemble: React.FC<Stage5Props> = ({ palette, plan }) => {
    if (!palette) {
        return (
            <section className="px-4 pt-4 pb-4">
                <StageBadge label="Stage 05: Ensemble" color="rgb(244, 63, 94)" />
                <div className="mt-3 text-zinc-600 text-xs">— 未编制 —</div>
            </section>
        );
    }
    return (
        <section className="px-4 pt-4 pb-4">
            <StageBadge label="Stage 05: Ensemble" color="rgb(244, 63, 94)" />
            <div className="mt-3 space-y-1">
                {ALL_ROLES.map((role) => {
                    const key = ROLE_TO_PALETTE_KEY[role];
                    const sound = palette[key];
                    if (!sound) return null;
                    let status: 'focus' | 'support' | 'silent' | 'idle' = 'idle';
                    if (plan) {
                        if (plan.focusInstrument === role) status = 'focus';
                        else if (plan.supportInstruments.indexOf(role) >= 0) status = 'support';
                        else if (plan.silentInstruments.indexOf(role) >= 0) status = 'silent';
                    }
                    return (
                        <div
                            key={role}
                            className={
                                'flex items-center gap-2 px-2 py-1 rounded text-[11px] ' +
                                (status === 'focus' ? 'bg-rose-500/15 border border-rose-400/50'
                                    : status === 'silent' ? 'opacity-40 border border-transparent'
                                        : 'border border-transparent')
                            }
                        >
                            <span className={
                                'w-14 text-[9px] uppercase tracking-widest ' +
                                (status === 'focus' ? 'text-rose-300 font-bold' : 'text-zinc-500')
                            }>{role}</span>
                            <span className={
                                'flex-1 text-xs truncate ' +
                                (status === 'silent' ? 'text-zinc-600 line-through' : 'text-zinc-300')
                            }>{String(sound)}</span>
                            {status === 'focus' && <span className="text-[9px] text-rose-400">●</span>}
                            {status === 'support' && <span className="text-[9px] text-zinc-500">○</span>}
                        </div>
                    );
                })}
            </div>
        </section>
    );
};
```

### `src/components/SeedController.tsx`

> Q+S 切换。固定 seed 重放歌曲（复现 EndlessRadioManager 的 PRNG 消耗顺序）+ 7 声部 mute 控制。

```tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, useDragControls } from 'motion/react';
import { Sprout, Play, Square, Volume2, VolumeX, X, Dice5 } from 'lucide-react';
import { AudioEngine, startAudioContext } from '../core/audio/AudioEngine';
import { PartName } from '../core/audio/PlaybackEngine';
import { PRNGManager } from '../core/utils/PRNG';
import { MelodyEngine } from '../core/generation/MelodyEngine';
import { StyleId } from '../core/generation/config/StyleFlags';
import { globalMidiScheduler } from '../core/audio/MidiScheduler';

// 🌟 声部清单（顺序即 UI 显示顺序）
const PARTS: { name: PartName; label: string }[] = [
    { name: 'vocal',          label: 'Vocal' },
    { name: 'melody',         label: 'Melody' },
    { name: 'secondaryMelody', label: 'Second.' },
    { name: 'counterMelody',  label: 'Counter' },
    { name: 'chord',          label: 'Chord' },
    { name: 'bass',           label: 'Bass' },
    { name: 'drums',          label: 'Drums' },
];

// 复现 EndlessRadioManager 的 style 选择逻辑，让 seed 能 100% 复现 Radio 的任意歌曲
const RADIO_STYLE_POOL: StyleId[] = [StyleId.AcgLightMusic];

type PlayState = 'IDLE' | 'GENERATING' | 'PLAYING';

export const SeedController: React.FC = () => {
    const [isVisible, setIsVisible] = useState(false);
    const [seedInput, setSeedInput] = useState('42');
    const [currentSeed, setCurrentSeed] = useState<number | null>(null);
    const [playState, setPlayState] = useState<PlayState>('IDLE');
    const [mutedParts, setMutedParts] = useState<Set<PartName>>(new Set());
    const dragControls = useDragControls();
    // 用 ref 存 playState 供 onTrackEnd 回调（避免闭包陈旧）
    const playStateRef = useRef<PlayState>('IDLE');
    playStateRef.current = playState;
    // 当前要循环的 seed（避免用户输入新 seed 后还循环旧的）
    const activeSeedRef = useRef<number | null>(null);

    // Q+S 快捷键
    useEffect(() => {
        const keysPressed = new Set<string>();
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.repeat) return;
            // 在输入框里按键不触发快捷键
            const target = e.target as HTMLElement;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
            keysPressed.add(e.key.toLowerCase());
            if (keysPressed.has('q') && keysPressed.has('s')) {
                setIsVisible(prev => !prev);
            }
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            keysPressed.delete(e.key.toLowerCase());
        };
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, []);

    // 重新应用 mute 状态 —— 新歌曲 load 后 channel 可能变，需要重新 mute
    const reapplyMutes = useCallback(() => {
        for (const { name } of PARTS) {
            AudioEngine.setPartMute(name, mutedParts.has(name));
        }
    }, [mutedParts]);

    // 用指定 seed 生成并播放
    const playSeed = useCallback(async (seed: number) => {
        await startAudioContext();
        AudioEngine.stop();
        activeSeedRef.current = seed;
        setPlayState('GENERATING');
        setCurrentSeed(seed);

        // 让 UI 先渲染一次
        await new Promise(resolve => setTimeout(resolve, 50));

        // 复现 EndlessRadioManager.triggerGeneration 的 PRNG 消耗顺序
        PRNGManager.setSeed(seed);
        PRNGManager.recordSnapshot('A');
        const styleId = RADIO_STYLE_POOL[Math.floor(PRNGManager.next() * RADIO_STYLE_POOL.length)];

        const melodyEngine = new MelodyEngine();
        const { track, context } = melodyEngine.generateFullSong(styleId);

        // 检查 seed 是否被抢占（用户在生成中途又点了其他 seed）
        if (activeSeedRef.current !== seed) return;

        await AudioEngine.playSong(track, styleId, context, melodyEngine);
        setPlayState('PLAYING');

        // 应用 mute 状态到新分配的 channel
        reapplyMutes();

        // 监听播放结束 → 同 seed 循环
        globalMidiScheduler.onTrackEnd(() => {
            if (activeSeedRef.current === seed && playStateRef.current === 'PLAYING') {
                // 递归复用同一 seed
                playSeed(seed);
            }
        });
    }, [reapplyMutes]);

    const handlePlay = useCallback(async () => {
        const seed = parseInt(seedInput, 10);
        if (isNaN(seed) || seed < 0) return;
        await playSeed(seed >>> 0);
    }, [seedInput, playSeed]);

    const handleStop = useCallback(() => {
        activeSeedRef.current = null;
        AudioEngine.stop();
        setPlayState('IDLE');
    }, []);

    const handleRandom = useCallback(() => {
        const newSeed = (Date.now() ^ Math.floor(Math.random() * 1000000)) >>> 0;
        setSeedInput(String(newSeed));
    }, []);

    const togglePartMute = useCallback((partName: PartName) => {
        setMutedParts(prev => {
            const next = new Set(prev);
            const muted = !next.has(partName);
            if (muted) next.add(partName);
            else next.delete(partName);
            // 立即应用到当前播放的 channel
            AudioEngine.setPartMute(partName, muted);
            return next;
        });
    }, []);

    if (!isVisible) return null;

    return (
        <motion.div
            drag
            dragControls={dragControls}
            dragListener={false}
            dragMomentum={false}
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed z-50 top-20 left-5 flex flex-col"
            style={{ width: 260 }}
        >
            <div className="flex flex-col bg-zinc-900/95 backdrop-blur-2xl rounded-2xl border border-emerald-500/30 shadow-[0_20px_50px_rgba(0,0,0,0.6)] overflow-hidden">

                {/* Header (Draggable) */}
                <div
                    className="flex items-center justify-between px-4 py-3 border-b border-emerald-500/20 cursor-grab active:cursor-grabbing bg-gradient-to-b from-zinc-800/60 to-transparent"
                    onPointerDown={(e) => dragControls.start(e)}
                >
                    <div className="flex items-center gap-2">
                        <Sprout className="w-4 h-4 text-emerald-400" />
                        <h3 className="text-emerald-400 font-bold tracking-widest text-xs uppercase">
                            Seed Lab
                        </h3>
                    </div>
                    <button
                        onClick={() => setIsVisible(false)}
                        className="text-zinc-400 hover:text-white transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-4 flex flex-col gap-4">

                    {/* Seed Input + Random */}
                    <div>
                        <label className="text-[10px] text-emerald-400/70 uppercase tracking-wider font-bold mb-1.5 block">
                            Seed
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={seedInput}
                                onChange={(e) => setSeedInput(e.target.value.replace(/[^0-9]/g, ''))}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handlePlay();
                                }}
                                placeholder="e.g. 2332053069"
                                className="flex-1 bg-black/50 border border-emerald-500/20 rounded px-2 py-1.5 text-xs font-mono text-emerald-300 placeholder-zinc-600 focus:outline-none focus:border-emerald-400/60"
                            />
                            <button
                                onClick={handleRandom}
                                title="Random seed"
                                className="px-2 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-white/5 rounded text-zinc-300 transition-colors"
                            >
                                <Dice5 className="w-3.5 h-3.5" />
                            </button>
                        </div>
                        {currentSeed !== null && (
                            <div className="mt-1.5 text-[10px] text-zinc-500 font-mono">
                                now playing: <span className="text-emerald-300">{currentSeed}</span>
                            </div>
                        )}
                    </div>

                    {/* Play / Stop */}
                    <div className="flex gap-2">
                        <button
                            onClick={handlePlay}
                            disabled={playState === 'GENERATING'}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded text-xs font-bold uppercase tracking-wider transition-all ${
                                playState === 'GENERATING'
                                    ? 'bg-zinc-700 text-zinc-500 cursor-wait'
                                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_4px_12px_rgba(16,185,129,0.3)]'
                            }`}
                        >
                            <Play className="w-3.5 h-3.5" />
                            {playState === 'GENERATING' ? 'Gen...' : 'Play'}
                        </button>
                        <button
                            onClick={handleStop}
                            disabled={playState === 'IDLE'}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded text-xs font-bold uppercase tracking-wider transition-all ${
                                playState === 'IDLE'
                                    ? 'bg-zinc-800/50 text-zinc-600 cursor-not-allowed'
                                    : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-white/10'
                            }`}
                        >
                            <Square className="w-3.5 h-3.5" />
                            Stop
                        </button>
                    </div>

                    {/* Play State Indicator */}
                    <div className="flex items-center gap-2 text-[10px] font-mono">
                        <div className={`w-1.5 h-1.5 rounded-full ${
                            playState === 'PLAYING' ? 'bg-emerald-400 animate-pulse' :
                            playState === 'GENERATING' ? 'bg-yellow-400 animate-pulse' :
                            'bg-zinc-600'
                        }`} />
                        <span className="text-zinc-500 uppercase tracking-wider">{playState}</span>
                        {playState === 'PLAYING' && (
                            <span className="text-zinc-600 ml-auto">↻ loop</span>
                        )}
                    </div>

                    {/* Mute Grid */}
                    <div>
                        <label className="text-[10px] text-emerald-400/70 uppercase tracking-wider font-bold mb-1.5 block">
                            Focus Mute
                        </label>
                        <div className="grid grid-cols-2 gap-1.5">
                            {PARTS.map(({ name, label }) => {
                                const isMuted = mutedParts.has(name);
                                return (
                                    <button
                                        key={name}
                                        onClick={() => togglePartMute(name)}
                                        className={`flex items-center justify-between px-2 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider transition-all ${
                                            isMuted
                                                ? 'bg-red-900/40 border border-red-500/50 text-red-300'
                                                : 'bg-zinc-800 border border-white/5 text-zinc-300 hover:bg-zinc-700'
                                        }`}
                                    >
                                        <span>{label}</span>
                                        {isMuted
                                            ? <VolumeX className="w-3 h-3" />
                                            : <Volume2 className="w-3 h-3" />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Tip */}
                    <div className="text-[9px] text-zinc-600 leading-snug border-t border-white/5 pt-2">
                        Q+S 切换 · 拖拽标题栏移动 · Enter 直接播放
                    </div>
                </div>
            </div>
        </motion.div>
    );
};
```

### `src/components/VolumeController.tsx`

> Q+E 切换。Marshall 风格混音器（Master + Melody/Piano EQ + Master FX + Lo-Fi 模式）。

```tsx
import React, { useState, useEffect } from 'react';
import { motion, useDragControls } from 'motion/react';
import { AudioEngine } from '../core/audio/AudioEngine';
import { Settings2, X, Music, Piano, Volume2, SlidersHorizontal } from 'lucide-react';

export const VolumeController: React.FC = () => {
    const [isVisible, setIsVisible] = useState(false);
    const dragControls = useDragControls();
    const [state, setState] = useState({
        volumes: { master: 14, melody: 0, pianoLH: 7, pianoRH: 2 },
        eq: {
            melody: { low: 0, mid: 2, high: 1 },
            piano: { low: 2, mid: -3, high: -6 }
        },
        effects: {
            reverbWet: 0.35, reverbRoomSize: 0.8,
            hallWet: 0.15, hallSize: 2.4,
            filterFreq: 3500, compThreshold: -18, compRatio: 3
        },
        system: {
            hardwareLofi: 0
        }
    });

    // Handle Q+E shortcut
    useEffect(() => {
        const keysPressed = new Set<string>();

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.repeat) return;
            keysPressed.add(e.key.toLowerCase());
            if (keysPressed.has('q') && keysPressed.has('e')) {
                setIsVisible(prev => !prev);
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            keysPressed.delete(e.key.toLowerCase());
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, []);

    // Load initial state when visible
    useEffect(() => {
        if (isVisible) {
            try {
                const currentState = AudioEngine.getMixerState();
                if (currentState) {
                    setState(currentState as any);
                }
            } catch (e) {
                console.warn("AudioEngine not fully initialized yet.");
            }
        }
    }, [isVisible]);

    const handleParamChange = (category: string, param: string, value: number) => {
        setState(prev => {
            const next = { ...prev };
            if (category === 'volumes') (next as any).volumes[param] = value;
            else if (category === 'eq') {
                const [inst, band] = param.split('.');
                (next as any).eq[inst][band] = value;
            }
            else if (category === 'effects') (next as any).effects[param] = value;
            else if (category === 'system') (next as any).system[param] = value;
            return next;
        });
        AudioEngine.setMixerParam(category, param, value);
    };

    if (!isVisible) return null;

    return (
        <motion.div
            drag
            dragControls={dragControls}
            dragListener={false}
            dragMomentum={false}
            initial={{ opacity: 0, scale: 0.9, y: 50 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 50 }}
            className="fixed z-50 top-20 right-20 flex flex-col"
            style={{ resize: 'both', overflow: 'hidden', minWidth: '480px', minHeight: '400px' }}
        >
            {/* Marshall + Apple Aesthetic Container */}
            <div className="flex-1 flex flex-col bg-zinc-900/90 backdrop-blur-2xl rounded-3xl border border-yellow-600/30 shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden relative">
                
                {/* Subtle Leather/Noise Texture Overlay */}
                <div className="absolute inset-0 opacity-[0.03] pointer-events-none" 
                     style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E")' }}>
                </div>

                {/* Header (Draggable Area) */}
                <div 
                    className="flex items-center justify-between px-5 py-4 border-b border-yellow-600/20 cursor-grab active:cursor-grabbing bg-gradient-to-b from-zinc-800/50 to-transparent"
                    onPointerDown={(e) => dragControls.start(e)}
                >
                    <div className="flex items-center gap-2">
                        <Settings2 className="w-5 h-5 text-yellow-500" />
                        <h3 className="text-yellow-500 font-medium tracking-widest text-sm uppercase" style={{ fontFamily: 'Impact, sans-serif', letterSpacing: '0.15em' }}>
                            Marshall <span className="text-zinc-400 text-xs font-sans tracking-normal capitalize">Mixer</span>
                        </h3>
                    </div>
                    <button onClick={() => setIsVisible(false)} className="text-zinc-400 hover:text-white transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Scrollable Content Area */}
                <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-8 custom-scrollbar">
                    
                    {/* Volumes Section */}
                    <section>
                        <div className="flex items-center gap-2 mb-4 text-yellow-500/80">
                            <Volume2 className="w-4 h-4" />
                            <h4 className="text-xs font-bold uppercase tracking-widest">Volumes</h4>
                            <div className="flex-1 h-px bg-yellow-500/10 ml-2"></div>
                        </div>
                        <div className="flex justify-around items-end h-48">
                            <VerticalSlider label="Master" icon={<Volume2 className="w-4 h-4" />} value={state.volumes.master} onChange={(v) => handleParamChange('volumes', 'master', v)} min={-60} max={30} />
                            <VerticalSlider label="Melody" icon={<Music className="w-4 h-4" />} value={state.volumes.melody} onChange={(v) => handleParamChange('volumes', 'melody', v)} min={-60} max={10} />
                            <VerticalSlider label="Piano LH" icon={<Piano className="w-4 h-4" />} value={state.volumes.pianoLH} onChange={(v) => handleParamChange('volumes', 'pianoLH', v)} min={-60} max={10} />
                            <VerticalSlider label="Piano RH" icon={<Piano className="w-4 h-4" />} value={state.volumes.pianoRH} onChange={(v) => handleParamChange('volumes', 'pianoRH', v)} min={-60} max={10} />
                        </div>
                    </section>

                    {/* EQ Section */}
                    <section>
                        <div className="flex items-center gap-2 mb-4 text-yellow-500/80">
                            <SlidersHorizontal className="w-4 h-4" />
                            <h4 className="text-xs font-bold uppercase tracking-widest">Equalizer</h4>
                            <div className="flex-1 h-px bg-yellow-500/10 ml-2"></div>
                        </div>
                        <div className="grid grid-cols-2 gap-6">
                            <div className="bg-black/20 p-4 rounded-xl border border-white/5">
                                <div className="text-[10px] text-zinc-400 uppercase tracking-wider text-center mb-4">Melody EQ</div>
                                <div className="flex justify-around">
                                    <Knob label="Low" value={state.eq.melody.low} min={-20} max={20} onChange={(v) => handleParamChange('eq', 'melody.low', v)} />
                                    <Knob label="Mid" value={state.eq.melody.mid} min={-20} max={20} onChange={(v) => handleParamChange('eq', 'melody.mid', v)} />
                                    <Knob label="High" value={state.eq.melody.high} min={-20} max={20} onChange={(v) => handleParamChange('eq', 'melody.high', v)} />
                                </div>
                            </div>
                            <div className="bg-black/20 p-4 rounded-xl border border-white/5">
                                <div className="text-[10px] text-zinc-400 uppercase tracking-wider text-center mb-4">Piano EQ</div>
                                <div className="flex justify-around">
                                    <Knob label="Low" value={state.eq.piano.low} min={-20} max={20} onChange={(v) => handleParamChange('eq', 'piano.low', v)} />
                                    <Knob label="Mid" value={state.eq.piano.mid} min={-20} max={20} onChange={(v) => handleParamChange('eq', 'piano.mid', v)} />
                                    <Knob label="High" value={state.eq.piano.high} min={-20} max={20} onChange={(v) => handleParamChange('eq', 'piano.high', v)} />
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Master FX Section */}
                    <section>
                        <div className="flex items-center gap-2 mb-4 text-yellow-500/80">
                            <Settings2 className="w-4 h-4" />
                            <h4 className="text-xs font-bold uppercase tracking-widest">Master FX</h4>
                            <div className="flex-1 h-px bg-yellow-500/10 ml-2"></div>
                        </div>
                        <div className="bg-black/20 p-4 rounded-xl border border-white/5 grid grid-cols-4 gap-y-6">
                            <Knob label="Rev Wet" value={state.effects.reverbWet} min={0} max={1} step={0.01} onChange={(v) => handleParamChange('effects', 'reverbWet', v)} />
                            <Knob label="Rev Size" value={state.effects.reverbRoomSize} min={0.1} max={1} step={0.01} onChange={(v) => handleParamChange('effects', 'reverbRoomSize', v)} />
                            <Knob label="Hall Wet" value={state.effects.hallWet} min={0} max={1} step={0.01} onChange={(v) => handleParamChange('effects', 'hallWet', v)} />
                            <Knob label="Hall Size" value={state.effects.hallSize} min={0.1} max={5} step={0.1} onChange={(v) => handleParamChange('effects', 'hallSize', v)} />
                            
                            <Knob label="Filter" value={state.effects.filterFreq} min={200} max={20000} step={100} onChange={(v) => handleParamChange('effects', 'filterFreq', v)} />
                            <Knob label="Cmp Thr" value={state.effects.compThreshold} min={-60} max={0} step={1} onChange={(v) => handleParamChange('effects', 'compThreshold', v)} />
                            <Knob label="Cmp Rat" value={state.effects.compRatio} min={1} max={20} step={0.5} onChange={(v) => handleParamChange('effects', 'compRatio', v)} />
                        </div>
                    </section>

                    {/* Hardware Simulation Section */}
                    <section>
                        <div className="flex items-center gap-2 mb-4 text-yellow-500/80">
                            <Settings2 className="w-4 h-4" />
                            <h4 className="text-xs font-bold uppercase tracking-widest">Hardware Sim</h4>
                            <div className="flex-1 h-px bg-yellow-500/10 ml-2"></div>
                        </div>
                        <div className="bg-black/20 p-4 rounded-xl border border-white/5 flex items-center justify-between">
                            <div>
                                <div className="text-sm font-bold text-zinc-300">ESP32-S3 Lo-Fi Mode</div>
                                <div className="text-[10px] text-zinc-500 mt-1">Simulates 16kHz sample rate & 8-bit depth</div>
                            </div>
                            <button 
                                onClick={() => handleParamChange('system', 'hardwareLofi', state.system.hardwareLofi === 1 ? 0 : 1)}
                                className={`w-12 h-6 rounded-full transition-colors relative ${state.system.hardwareLofi === 1 ? 'bg-yellow-600' : 'bg-zinc-700'}`}
                            >
                                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${state.system.hardwareLofi === 1 ? 'left-7' : 'left-1'}`} />
                            </button>
                        </div>
                    </section>
                </div>
                
                {/* Resize Handle Indicator */}
                <div className="absolute bottom-1 right-1 w-3 h-3 cursor-se-resize opacity-30">
                    <svg viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M8 10V8H10V10H8ZM5 10V8H7V10H5ZM8 7V5H10V7H8ZM2 10V8H4V10H2ZM5 7V5H7V7H5ZM8 4V2H10V4H8Z" fill="currentColor"/>
                    </svg>
                </div>
            </div>
            <style dangerouslySetInnerHTML={{__html: `
                .custom-scrollbar::-webkit-scrollbar { width: 6px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); border-radius: 4px; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(234,179,8,0.3); border-radius: 4px; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(234,179,8,0.5); }
            `}} />
        </motion.div>
    );
};

interface VerticalSliderProps {
    label: string;
    icon: React.ReactNode;
    value: number;
    min: number;
    max: number;
    onChange: (val: number) => void;
}

const VerticalSlider: React.FC<VerticalSliderProps> = ({ label, icon, value, min, max, onChange }) => {
    const percentage = ((value - min) / (max - min)) * 100;

    return (
        <div className="flex flex-col items-center gap-4 h-full w-16">
            <div className="text-xs font-mono text-yellow-500/80 bg-black/40 px-2 py-1 rounded border border-yellow-600/20 shadow-inner">
                {value > -50 ? `${value > 0 ? '+' : ''}${value.toFixed(1)}` : '-∞'}
            </div>
            <div className="relative flex-1 w-8 flex justify-center py-2">
                <div className="absolute inset-y-0 w-1.5 bg-black/60 rounded-full shadow-inner border border-white/5"></div>
                <div 
                    className="absolute bottom-0 w-1.5 bg-gradient-to-t from-yellow-700 to-yellow-400 rounded-full shadow-[0_0_10px_rgba(234,179,8,0.3)]"
                    style={{ height: `${percentage}%` }}
                ></div>
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={0.5}
                    value={value}
                    onChange={(e) => onChange(parseFloat(e.target.value))}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    style={{ writingMode: 'vertical-lr', direction: 'rtl', appearance: 'slider-vertical' }}
                />
                <div 
                    className="absolute w-8 h-4 bg-gradient-to-b from-zinc-300 to-zinc-500 rounded-sm shadow-md border border-zinc-600 pointer-events-none flex items-center justify-center"
                    style={{ bottom: `calc(${percentage}% - 8px)` }}
                >
                    <div className="w-6 h-0.5 bg-black/50 rounded-full"></div>
                </div>
            </div>
            <div className="flex flex-col items-center gap-1 mt-2">
                <div className="text-zinc-500">{icon}</div>
                <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider text-center leading-tight">
                    {label.split(' ').map((word, i) => <React.Fragment key={i}>{word}<br/></React.Fragment>)}
                </span>
            </div>
        </div>
    );
};

const Knob: React.FC<{ label: string, value: number, min: number, max: number, step?: number, onChange: (v: number) => void }> = ({ label, value, min, max, step = 1, onChange }) => {
    const handlePointerDown = (e: React.PointerEvent) => {
        e.preventDefault();
        const startY = e.clientY;
        const startVal = value;
        
        const handlePointerMove = (moveEvent: PointerEvent) => {
            const deltaY = startY - moveEvent.clientY;
            const range = max - min;
            // 150px drag = full range
            let newVal = startVal + (deltaY / 150) * range;
            newVal = Math.max(min, Math.min(max, newVal));
            newVal = Math.round(newVal / step) * step;
            onChange(newVal);
        };
        
        const handlePointerUp = () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
        
        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
    };

    const percentage = (value - min) / (max - min);
    const rotation = -135 + (percentage * 270);

    return (
        <div className="flex flex-col items-center gap-2">
            <div 
                className="w-10 h-10 rounded-full bg-gradient-to-br from-zinc-700 to-zinc-900 border-2 border-zinc-800 shadow-[0_5px_10px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.2)] relative cursor-ns-resize flex items-center justify-center"
                onPointerDown={handlePointerDown}
            >
                <div 
                    className="absolute w-full h-full"
                    style={{ transform: `rotate(${rotation}deg)` }}
                >
                    <div className="mx-auto mt-1 w-1 h-2.5 bg-yellow-500 rounded-full shadow-[0_0_5px_rgba(234,179,8,0.5)]"></div>
                </div>
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-zinc-600 to-zinc-800 border border-zinc-900/50"></div>
            </div>
            <div className="text-center">
                <div className="text-[9px] text-zinc-400 uppercase tracking-wider">{label}</div>
                <div className="text-[10px] font-mono text-yellow-500/80">{value.toFixed(step < 1 ? 2 : 0)}</div>
            </div>
        </div>
    );
};
```

---

## 第七部分：应用层


### `src/apps/AppRegistry.tsx`

```tsx
import React from 'react';
import { AuraBar } from './AuraBar';
import { AuraJam } from './AuraJam';
import { PixelIcon } from '../components/PixelIcon';
import { GRIDS } from '../components/PixelGrids';

export interface AppManifest {
  id: string;
  name: string;
  icon: React.ReactNode;
  component: React.ComponentType<any>;
}

export const APPS: AppManifest[] = [
  {
    id: 'app-aura-bar',
    name: 'Aura Bar',
    icon: <PixelIcon grid={GRIDS.radio} color="currentColor" />,
    component: AuraBar,
  },
  {
    id: 'app-aura-jam',
    name: 'Aura Jam',
    icon: <PixelIcon grid={GRIDS.euclid} color="currentColor" />,
    component: AuraJam,
  }
];
```

### `src/apps/AuraBar/BarData.ts`

> 7 种酒吧场景；战役四：所有 styleIds 收敛为 `[AcgLightMusic]`（旧的 Default / DarkSynthPop / LoFiChill 已删除）。

```ts
import { StyleId } from '../../core/generation/config/StyleFlags';

export interface BarConfig {
  id: string;
  name: string;
  imagePath: string;
  styleIds: StyleId[];
}

export const ALL_BARS: BarConfig[] = [
  {
    id: 'edm-bar',
    name: 'EDM CLUB',
    imagePath: '/assets/barImg/EDMBar.png',
    styleIds: [StyleId.AcgLightMusic],
  },
  {
    id: 'jazz-bar',
    name: 'JAZZ CAFE',
    imagePath: '/assets/barImg/JazzBar.png',
    styleIds: [StyleId.AcgLightMusic],
  },
  {
    id: 'lounge-bar',
    name: 'LOUNGE BAR',
    imagePath: '/assets/barImg/LoungeBar.png',
    styleIds: [StyleId.AcgLightMusic],
  },
  {
    id: 'pop-bar',
    name: 'POP STAGE',
    imagePath: '/assets/barImg/PopBar.png',
    styleIds: [StyleId.AcgLightMusic],
  },
  {
    id: 'rap-bar',
    name: 'HIPHOP CLUB',
    imagePath: '/assets/barImg/RapBar.png',
    styleIds: [StyleId.AcgLightMusic],
  },
  {
    id: 'retro-bar',
    name: 'RETRO ARCADE',
    imagePath: '/assets/barImg/RetroBar.png',
    styleIds: [StyleId.AcgLightMusic],
  },
  {
    id: 'rock-bar',
    name: 'ROCK TAVERN',
    imagePath: '/assets/barImg/RockBar.png',
    styleIds: [StyleId.AcgLightMusic],
  }
];
```

### `src/apps/AuraBar/EndlessRadioManager.ts`

> Bar 模式状态机：IDLE→GENERATING→PLAYING + Jam 模式（PREPARING_JAM/JAMMING_DRUMS/JAMMING_MELODY）。包含用户鼓 pattern 的循环重制 + 段落能量自适应力度调整。

```ts
import { AudioEngine } from '../../core/audio/AudioEngine';
import { StyleId } from '../../core/generation/config/StyleFlags';
import { AcgStyleConfig } from '../../core/generation/config/StyleRegistry';
import { GlobalContext } from '../../core/generation/GlobalContext';
import { MelodyEngine } from '../../core/generation/MelodyEngine';
// removed
import { GeneratedTrack, StyleConfig, MusicContext } from '../../core/generation/types';
import { PRNGManager } from '../../core/utils/PRNG';
import { globalMidiScheduler } from '../../core/audio/MidiScheduler';

export type AppState = 'IDLE' | 'GENERATING' | 'PLAYING' | 'PREPARING_JAM' | 'JAMMING_DRUMS' | 'JAMMING_MELODY';

export class EndlessRadioManager {
  private state: AppState = 'IDLE';
  private history: { track: GeneratedTrack, context: MusicContext, style: StyleConfig }[] = [];
  private historyIndex: number = -1;
  private generationId: number = 0;
  
  public currentTrack?: GeneratedTrack;
  public currentStyle?: StyleConfig;

  private stateChangeCallback?: (state: AppState) => void;
  public onStyleChange?: (styleName: string) => void;

  private allowedStyleIds: StyleId[] = [];

  // --- Jam Mode Recording State ---
  public userDrumPattern: { note: number, velocity: number, tick: number }[] = [];
  public jamStartTick: number = 0;
  public jamLengthTicks: number = 0;
  private originalDrumEvents: any[] = [];

  constructor(allowedStyleIds?: StyleId[]) {
    if (allowedStyleIds && allowedStyleIds.length > 0) {
      this.allowedStyleIds = allowedStyleIds;
    }
  }

  public setAllowedStyles(styleIds: StyleId[]) {
    this.allowedStyleIds = styleIds;
  }

  public onStateChange(callback: (state: AppState) => void) {
    this.stateChangeCallback = callback;
  }

  private setState(newState: AppState) {
    this.state = newState;
    if (this.stateChangeCallback) {
      this.stateChangeCallback(this.state);
    }
  }

  public getState(): AppState {
    return this.state;
  }

  public start = () => {
    if (this.state === 'IDLE') {
      this.triggerGeneration();
    }
  }

  private jamCheckInterval: any = null;

  public getCurrentChord(): any {
    if (!this.currentTrack || !this.currentTrack.chords) return null;
    const currentTick = AudioEngine.getCurrentTick();
    const ppq = AudioEngine.getPpq();
    const currentBeat = currentTick / ppq;
    for (const chord of this.currentTrack.chords) {
        if (currentBeat >= chord.startBeat && currentBeat < chord.endBeat) {
            return chord;
        }
    }
    return null;
  }

  public stopPlayback = () => {
    this.generationId += 1;
    if (this.jamCheckInterval) {
        clearInterval(this.jamCheckInterval);
        this.jamCheckInterval = null;
    }
    AudioEngine.muteChannel(9, false);
    AudioEngine.muteChannel(0, false);
    AudioEngine.stop();
    this.setState('IDLE');
  }

  public stop = () => {
    this.stopPlayback();
  }

  public prepareJam(type: 'drums' | 'melody') {
    if (this.state !== 'PLAYING' || !this.currentTrack || !this.currentStyle) return;
    
    this.setState('PREPARING_JAM');

    if (type === 'drums') {
        this.userDrumPattern = [];
        this.jamStartTick = 0;
        this.jamLengthTicks = 0;
        this.originalDrumEvents = AudioEngine.getChannelEvents(9);
    }

    const currentTick = AudioEngine.getCurrentTick();
    const ppq = AudioEngine.getPpq();
    const timeSignature = GlobalContext.currentTimeSignature || [4, 4];
    const beatsPerMeasure = timeSignature[0];
    const ticksPerMeasure = timeSignature[0] * (ppq * 4 / timeSignature[1]);

    // Calculate the start of the NEXT measure
    const currentMeasure = Math.floor(currentTick / ticksPerMeasure);
    const nextMeasureStartTick = (currentMeasure + 1) * ticksPerMeasure;
    
    // The count-in happens during the next measure
    const countInMeasureStartTick = nextMeasureStartTick;
    const jamStartTick = countInMeasureStartTick + ticksPerMeasure;

    if (type === 'drums' || type === 'melody') {
        this.jamStartTick = jamStartTick;
        
        // Increase drum channel volume to max
        AudioEngine.injectMidiEvent({ ticks: currentTick, type: 'controlChange', channel: 9, data1: 7, data2: 127 });
        
        // 1. Inject Count-in events (4 Crashes + Drum Fill)
        const ticksPerBeat = ppq * 4 / timeSignature[1];
        const fillEvents: any[] = [];
        
        for (let i = 0; i < beatsPerMeasure; i++) {
            const tick = countInMeasureStartTick + i * ticksPerBeat;
            // 4 Crashes on the beat
            fillEvents.push({ ticks: tick, type: 'noteOn', channel: 9, data1: 49, data2: 127 }); // Crash
            fillEvents.push({ ticks: tick + ppq/2, type: 'noteOff', channel: 9, data1: 49, data2: 0 });
            fillEvents.push({ ticks: tick, type: 'noteOn', channel: 9, data1: 36, data2: 100 }); // Kick
            fillEvents.push({ ticks: tick + ppq/2, type: 'noteOff', channel: 9, data1: 36, data2: 0 });
            
            // Drum fill on the last beat (e.g., 4th beat)
            if (i === beatsPerMeasure - 1) {
                // 16th note snare roll
                for (let j = 0; j < 4; j++) {
                    const subTick = tick + j * (ticksPerBeat / 4);
                    fillEvents.push({ ticks: subTick, type: 'noteOn', channel: 9, data1: 38, data2: 100 + j * 8 }); // Crescendo snare
                    fillEvents.push({ ticks: subTick + (ticksPerBeat / 8), type: 'noteOff', channel: 9, data1: 38, data2: 0 });
                }
            }
        }
        
        // Replace system drums during the count-in measure
        AudioEngine.replaceChannelEvents(9, countInMeasureStartTick, fillEvents, jamStartTick);

        if (type === 'drums') {
            // 2. Generate Closed Hi-Hat (42) events from jamStartTick to the end of the song
            const lastSection = this.currentTrack.sections[this.currentTrack.sections.length - 1];
            const totalTicks = lastSection ? lastSection.endBeat * ppq : 0;
            const hihatEvents: any[] = [];
            
            for (let tick = jamStartTick; tick < totalTicks; tick += ppq / 2) { // 8th notes
                hihatEvents.push({ ticks: tick, type: 'noteOn', channel: 9, data1: 42, data2: 70 });
                hihatEvents.push({ ticks: tick + ppq/4, type: 'noteOff', channel: 9, data1: 42, data2: 0 });
                hihatEvents.push({ 
                    ticks: tick, 
                    type: 'visual', 
                    channel: 9, 
                    data1: 42, 
                    data2: 70,
                    visualData: { type: 'drums', midiNote: 42, velocity: 70, source: 'system' }
                });
            }

            // Replace system drums with hi-hats from jamStartTick
            AudioEngine.replaceChannelEvents(9, jamStartTick, hihatEvents);
        }
    }

    if (this.jamCheckInterval) {
        clearInterval(this.jamCheckInterval);
    }

    // Schedule the transition to JAM state
    this.jamCheckInterval = setInterval(() => {
        if (this.state !== 'PREPARING_JAM' && this.state !== 'JAMMING_DRUMS' && this.state !== 'JAMMING_MELODY') {
            clearInterval(this.jamCheckInterval);
            this.jamCheckInterval = null;
            return;
        }
        
        const currentTick = AudioEngine.getCurrentTick();

        if (currentTick >= jamStartTick && this.state === 'PREPARING_JAM') {
            if (type === 'drums') {
                this.setState('JAMMING_DRUMS');
            } else {
                // Mute melody channels (assuming channel 0 for lead, maybe others)
                // For now, let's mute channel 0
                AudioEngine.muteChannel(0, true); 
                this.setState('JAMMING_MELODY');
            }
        }
    }, 50); // Check frequently
  }

  public exitJam() {
    console.log(`[Jam Mode] exitJam called. Current state: ${this.state}`);
    if (this.state === 'JAMMING_DRUMS' || this.state === 'JAMMING_MELODY' || this.state === 'PREPARING_JAM') {
        if (this.jamCheckInterval) {
            clearInterval(this.jamCheckInterval);
            this.jamCheckInterval = null;
        }
        
        AudioEngine.muteChannel(9, false);
        AudioEngine.muteChannel(0, false);
        
        // Restore drum channel volume to normal
        AudioEngine.injectMidiEvent({ ticks: AudioEngine.getCurrentTick(), type: 'controlChange', channel: 9, data1: 7, data2: 100 });
        
        if (this.state === 'PREPARING_JAM' && this.originalDrumEvents) {
            console.log(`[Jam Mode] Exited during preparation. Resuming original drums.`);
            const originalEventsToRestore = this.originalDrumEvents.filter(e => e.ticks >= this.jamStartTick);
            AudioEngine.replaceChannelEvents(9, this.jamStartTick, originalEventsToRestore);
        }
        
        // Calculate jam length based on current tick
        if (this.state === 'JAMMING_DRUMS' && this.jamStartTick > 0) {
            try {
                const currentTick = AudioEngine.getCurrentTick();
                const ppq = AudioEngine.getPpq();
                const timeSignature = GlobalContext.currentTimeSignature || [4, 4];
                const ticksPerMeasure = timeSignature[0] * (ppq * 4 / timeSignature[1]);
                
                // Round to the nearest measure to avoid empty measures if user is slightly late
                const elapsedTicks = currentTick - this.jamStartTick;
                const measures = Math.max(1, Math.round(elapsedTicks / ticksPerMeasure));
                this.jamLengthTicks = measures * ticksPerMeasure;
                
                console.log(`[Jam Mode] Recorded ${this.userDrumPattern.length} notes over ${measures} measures.`);
                
                // Apply the recorded drum loop with dynamic adaptation
                this.applyUserDrumLoop();
            } catch (e) {
                console.error(`[Jam Mode] Error applying user drum loop:`, e);
            }
        }
        
        this.setState('PLAYING');
    }
  }

  private applyUserDrumLoop() {
      if (!this.currentTrack || !this.currentStyle) return;

      const currentTick = AudioEngine.getCurrentTick();

      if (this.userDrumPattern.length === 0) {
          console.log(`[Jam Mode] No drum notes recorded. Resuming original drums.`);
          const originalEventsToRestore = this.originalDrumEvents.filter(e => e.ticks >= this.jamStartTick);
          AudioEngine.replaceChannelEvents(9, this.jamStartTick, originalEventsToRestore);
          return;
      }

      // Filter out any notes that were played after the calculated loop length
      const validPattern = this.userDrumPattern.filter(hit => hit.tick < this.jamLengthTicks);
      if (validPattern.length === 0) {
          console.log(`[Jam Mode] No valid drum notes within the loop length. Resuming original drums.`);
          const originalEventsToRestore = this.originalDrumEvents.filter(e => e.ticks >= this.jamStartTick);
          AudioEngine.replaceChannelEvents(9, this.jamStartTick, originalEventsToRestore);
          return;
      }

      const ppq = AudioEngine.getPpq();
      const lastSection = this.currentTrack.sections[this.currentTrack.sections.length - 1];
      const totalTicks = lastSection ? lastSection.endBeat * ppq : 0;

      console.log(`[Jam Mode] applyUserDrumLoop: currentTick=${currentTick}, jamStartTick=${this.jamStartTick}, jamLengthTicks=${this.jamLengthTicks}, totalTicks=${totalTicks}, validPatternLength=${validPattern.length}`);

      // Align loop start to the nearest measure boundary to ensure it stays in sync
      const timeSignature = GlobalContext.currentTimeSignature || [4, 4];
      
      // We start generating the loop from jamStartTick to ensure the pattern aligns perfectly
      // with the musical grid.
      const loopStartTick = this.jamStartTick;

      const newDrumEvents: any[] = [];

      // Loop the pattern until the end of the song
      for (let tick = loopStartTick; tick < totalTicks; tick += this.jamLengthTicks) {
          const currentBeat = tick / ppq;
          
          // Find the current section to apply dynamic adaptation
          const section = this.currentTrack.sections.find(s => currentBeat >= s.startBeat && currentBeat < s.endBeat) || this.currentTrack.sections[0];
          
          const isBuild = section.name.toLowerCase().includes('build');

          // 1. Add crash at the start of high energy sections
          for (const s of this.currentTrack.sections) {
              const isChorusSection = s.energyLevel >= 0.8 || s.name.toLowerCase().includes('chorus');
              if (isChorusSection) {
                  const sectionStartTick = s.startBeat * ppq;
                  if (sectionStartTick >= tick && sectionStartTick < tick + this.jamLengthTicks) {
                      newDrumEvents.push({ ticks: sectionStartTick, type: 'noteOn', channel: 9, data1: 49, data2: 120 });
                      newDrumEvents.push({ ticks: sectionStartTick + ppq/2, type: 'noteOff', channel: 9, data1: 49, data2: 0 });
                      newDrumEvents.push({ 
                          ticks: sectionStartTick, 
                          type: 'visual', 
                          channel: 9, 
                          data1: 49, 
                          data2: 120,
                          visualData: { type: 'drums', midiNote: 49, velocity: 120, source: 'system' }
                      });
                  }
              }
          }

          // 2. Loop the user's recorded pattern
          for (const hit of validPattern) {
              const hitTick = tick + hit.tick;
              if (hitTick >= totalTicks) continue;

              const hitBeat = hitTick / ppq;
              const hitSection = this.currentTrack.sections.find(s => hitBeat >= s.startBeat && hitBeat < s.endBeat) || this.currentTrack.sections[0];
              const hitIsBreakdown = hitSection.energyLevel < 0.5;
              const hitIsChorus = hitSection.energyLevel >= 0.8 || hitSection.name.toLowerCase().includes('chorus');
              const hitIsBuild = hitSection.name.toLowerCase().includes('build');

              let note = hit.note;
              let velocity = hit.velocity;
              let shouldPlay = true;

              // --- Algorithmic Dynamic Adaptation ---
              if (hitIsBreakdown) {
                  // Breakdown: Soften kicks and snares, keep hi-hats
                  if (note === 36) velocity = Math.floor(velocity * 0.6); // Softer kick instead of removing
                  if (note === 38) { 
                      note = 37; // Snare -> Side stick
                      velocity = Math.floor(velocity * 0.7); 
                  } 
              } else if (hitIsBuild) {
                  // Build-up: Increase velocity
                  velocity = Math.min(127, velocity + 20);
              } else if (hitIsChorus) {
                  // Chorus: Maximize velocity for impact
                  velocity = Math.min(127, velocity + 10);
              }

              if (shouldPlay) {
                  newDrumEvents.push({ ticks: hitTick, type: 'noteOn', channel: 9, data1: note, data2: velocity });
                  newDrumEvents.push({ ticks: hitTick + ppq/4, type: 'noteOff', channel: 9, data1: note, data2: 0 });
                  newDrumEvents.push({ 
                      ticks: hitTick, 
                      type: 'visual', 
                      channel: 9, 
                      data1: note, 
                      data2: velocity,
                      visualData: { type: 'drums', midiNote: note, velocity: velocity, source: 'system' }
                  });
              }
          }

          // 3. Add Snare Roll for Build-up at the end of the loop
          if (isBuild) {
              // Add 16th note snares for the last beat of the loop
              const lastBeatTick = tick + this.jamLengthTicks - ppq;
              for (let i = 0; i < 4; i++) {
                  const rollTick = lastBeatTick + (i * ppq / 4);
                  if (rollTick < totalTicks) {
                      const rollVel = 80 + i * 10;
                      newDrumEvents.push({ ticks: rollTick, type: 'noteOn', channel: 9, data1: 38, data2: rollVel });
                      newDrumEvents.push({ ticks: rollTick + ppq/8, type: 'noteOff', channel: 9, data1: 38, data2: 0 });
                      newDrumEvents.push({ 
                          ticks: rollTick, 
                          type: 'visual', 
                          channel: 9, 
                          data1: 38, 
                          data2: rollVel,
                          visualData: { type: 'drums', midiNote: 38, velocity: rollVel, source: 'system' }
                      });
                  }
              }
          }
      }

      // Replace all future drum events with the adapted user loop
      console.log(`[Jam Mode] Generated ${newDrumEvents.length} new drum events. First few:`, newDrumEvents.slice(0, 5));
      AudioEngine.replaceChannelEvents(9, this.jamStartTick, newDrumEvents);
      console.log(`[Jam Mode] Applied user drum loop from tick ${loopStartTick} to end of track with dynamic adaptation.`);
  }

  public recordUserDrum(note: number, velocity: number) {
      if (this.state !== 'JAMMING_DRUMS' || this.jamStartTick === 0) return;
      
      const currentTick = AudioEngine.getCurrentTick();
      const ppq = AudioEngine.getPpq();
      const gridSize = ppq / 4; // 16th note quantization
      
      // Quantize to nearest grid point
      const quantizedTick = Math.round(currentTick / gridSize) * gridSize;
      const relativeTick = quantizedTick - this.jamStartTick;
      
      // Only record if it's not negative (before jam started)
      if (relativeTick >= 0) {
          this.userDrumPattern.push({ note, velocity, tick: relativeTick });
      }
  }

  private async playTrack(track: GeneratedTrack, context: MusicContext, style: StyleConfig, genId: number) {
    const melodyEngine = new MelodyEngine();
    
    this.currentTrack = track;
    this.currentStyle = style;

    if (this.onStyleChange) {
      this.onStyleChange(style.name);
    }

    await AudioEngine.playSong(track, style.id, context, melodyEngine);
    
    if (genId !== this.generationId) return;
    
    this.setState('PLAYING');

    // Schedule next song using MidiScheduler's onTrackEnd
    globalMidiScheduler.onTrackEnd(() => {
      if (genId === this.generationId) {
        this.playNext();
      }
    });
  }

  public triggerGeneration = async () => {
    const currentGenId = ++this.generationId;
    
    AudioEngine.stop();
    this.setState('GENERATING');

    try {
      // Simulate slight delay for UI to catch up
      await new Promise(resolve => setTimeout(resolve, 100));
      if (currentGenId !== this.generationId) return;

      // §1.4 step 0: 每次生成前重新播种
      // Date.now() 提供毫秒级种子，Math.random()*1e6 补充额外熵（防止浏览器降低 Date 精度）
      const seed = (Date.now() ^ Math.floor(Math.random() * 1000000)) >>> 0;
      PRNGManager.setSeed(seed);
      // ACVE §5.1 — 入口快照点 A
      PRNGManager.recordSnapshot('A');
      console.log(`[Radio] New seed: ${seed}`);

      const melodyEngine = new MelodyEngine();
      // 从所有已注册的风格中随机选择（PRNG 驱动，确定性）
      const allStyleIds = [StyleId.AcgLightMusic];
      const pool = (this.allowedStyleIds && this.allowedStyleIds.length > 0) ? this.allowedStyleIds : allStyleIds;
      const randomStyleId = pool[Math.floor(PRNGManager.next() * pool.length)];
      
      const rawTrack = melodyEngine.generateFullSong(randomStyleId);
      
      // We need to get the actual style config used by the engine
      // Since MelodyEngine doesn't return the style config directly, we'll import StyleRegistry
      const { StyleRegistry } = await import('../../core/generation/config/StyleRegistry');
      const randomStyle = StyleRegistry[randomStyleId] || AcgStyleConfig;
      
      if (currentGenId !== this.generationId) return;

      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push({ track: rawTrack.track, context: rawTrack.context, style: randomStyle });
      this.historyIndex++;

      await this.playTrack(rawTrack.track, rawTrack.context, randomStyle, currentGenId);

    } catch (error) {
      console.error("Generation failed:", error);
      if (currentGenId === this.generationId) {
        this.setState('IDLE');
      }
    }
  }

  public playNext = async () => {
    if (this.historyIndex < this.history.length - 1) {
      const currentGenId = ++this.generationId;
      AudioEngine.stop();
      this.setState('GENERATING');
      
      this.historyIndex++;
      const { track, context, style } = this.history[this.historyIndex];
      
      await this.playTrack(track, context, style, currentGenId);
    } else {
      this.triggerGeneration();
    }
  }

  public playPrevious = async () => {
    if (this.historyIndex > 0) {
      const currentGenId = ++this.generationId;
      AudioEngine.stop();
      this.setState('GENERATING'); 
      
      this.historyIndex--;
      const { track, context, style } = this.history[this.historyIndex];
      
      await this.playTrack(track, context, style, currentGenId);
    }
  }
}
```

### `src/apps/AuraBar/index.tsx`

> Bar UI：滑动选择酒吧 → 双击进入 → 长按 Q/W 触发鼓/旋律 Jam 模式。

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AudioEngine } from '../../core/audio/AudioEngine';
import { getAudioContext } from '../../core/audio/SynthManager';
import { systemAudio } from '../../system/SystemAudio'; 
import { EndlessRadioManager, AppState } from './EndlessRadioManager';
import { ALL_BARS, BarConfig } from './BarData';
import { PRNGManager } from '../../core/utils/PRNG';
// Old types: chord.quality is a string ('Minor', 'Diminished', etc.), tonality is a string

interface AuraBarProps {
  activeKeys: Set<string>;
  onExit?: () => void;
}

export function AuraBar({ activeKeys, onExit }: AuraBarProps) {
  const managerRef = useRef<EndlessRadioManager | null>(null);
  const [appState, setAppState] = useState<AppState>('IDLE');
  const [bars, setBars] = useState<BarConfig[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedIndexRef = useRef(0);
  const [currentStyleName, setCurrentStyleName] = useState<string>('');

  const tapTimeout = useRef<NodeJS.Timeout | null>(null);
  const tapCount = useRef(0);
  const lastTapKey = useRef<{c: number, r: number} | null>(null);
  
  const longPressTimeout = useRef<NodeJS.Timeout | null>(null);
  
  const swipeState = useRef({
    path: [] as {c: number, r: number, time: number}[],
    lastActionTime: 0
  });

  const activeKeysRef = useRef<Set<string>>(activeKeys);
  const prevActiveKeysRef = useRef<Set<string>>(new Set());

  // Jam Mode State
  const arpStateRef = useRef({
    intervalId: null as NodeJS.Timeout | null,
    heldIndices: new Map<string, number>(),
    lastPlayedNote: -1,
    step: 0,
    centerIdx: -1,
    patternIdx: 0
  });

  // Initialize Bars
  useEffect(() => {
    // Randomly select 1~7 bars
    const numBars = Math.floor(PRNGManager.next() * 7) + 1;
    const shuffled = [...ALL_BARS].sort(() => PRNGManager.next() - 0.5);
    const selected = shuffled.slice(0, numBars);
    
    // Sort alphabetically by name
    selected.sort((a, b) => a.name.localeCompare(b.name));
    setBars(selected);
  }, []);

  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  useEffect(() => {
    const manager = new EndlessRadioManager();
    manager.onStateChange((newState) => {
      setAppState(newState);
    });
    manager.onStyleChange = (styleName) => {
      setCurrentStyleName(styleName);
    };
    managerRef.current = manager;

    return () => {
      manager.stopPlayback();
    };
  }, []);

  useEffect(() => {
    activeKeysRef.current = activeKeys;
  }, [activeKeys]);

  useEffect(() => {
    return () => {
      if (managerRef.current) {
        managerRef.current.stopPlayback();
      }
      if (tapTimeout.current) clearTimeout(tapTimeout.current);
    };
  }, []);

  useEffect(() => {
    const isPlaying = appState !== 'IDLE' && appState !== 'GENERATING';
    AudioEngine.emitVisualEvent({ type: 'fn_key_active', active: isPlaying } as any);
    return () => {
      AudioEngine.emitVisualEvent({ type: 'fn_key_active', active: false } as any);
    };
  }, [appState]);

  // --- Jam Mode Helpers ---
  const DRUM_MAP: Record<string, number> = {
    '0-2': 38, '1-2': 38, '2-2': 42, '3-2': 36, '4-2': 36, // Bottom row: Snare, Snare, Closed Hat, Kick, Kick
    '0-1': 41, '1-1': 45, '2-1': 48, '3-1': 46, '4-1': 49, // Middle row: Low Tom, Mid Tom, High Tom, Open Hat, Crash
    '0-0': 39, '1-0': 37, '2-0': 54, '3-0': 56,            // Top row: Clap, Rimshot, Tambourine, Cowbell (4-0 is Function)
  };

  const getJamMelodyNotes = (chord: any, tonality: string, keyOffset: number) => {
    // We need 14 notes. To ensure it always sounds good (safe jamming),
    // we use the Pentatonic scale of the current chord or key.
    // Major Pentatonic: 1, 2, 3, 5, 6 (intervals: 0, 2, 4, 7, 9)
    // Minor Pentatonic: 1, b3, 4, 5, b7 (intervals: 0, 3, 5, 7, 10)
    
    let scalePcs = [0, 2, 4, 7, 9]; // Default C Major Pentatonic
    let rootPc = 0;
    
    if (chord) {
        const chordKeyOffset = chord.keyOffset !== undefined ? chord.keyOffset : keyOffset;
        rootPc = ((chord.root + chordKeyOffset) % 12 + 12) % 12;
        const q = chord.quality as string;
        if (q === 'Minor' || q === 'Diminished' || q === 'Minor7' || q === 'HalfDiminished' || q === 'Diminished7' || q === 'Minor9' || q === 'Minor11') {
            scalePcs = [0, 3, 5, 7, 10].map(i => (rootPc + i) % 12); // Minor Pentatonic
        } else {
            scalePcs = [0, 2, 4, 7, 9].map(i => (rootPc + i) % 12); // Major Pentatonic
        }
    } else {
        rootPc = (keyOffset % 12 + 12) % 12;
        if (tonality === 'Minor') {
            scalePcs = [0, 3, 5, 7, 10].map(i => (rootPc + i) % 12); // Minor Pentatonic
        } else {
            scalePcs = [0, 2, 4, 7, 9].map(i => (rootPc + i) % 12); // Major Pentatonic
        }
    }

    scalePcs.sort((a, b) => a - b);
    
    // Find the root in the sorted scale
    let rootIdx = scalePcs.indexOf(rootPc);
    if (rootIdx === -1) rootIdx = 0;

    // Build 14 notes starting from rootPc around MIDI 60
    const notes = [];
    let currentOctave = 5; // Start around C4 (60)
    let currentIdx = rootIdx;
    
    // We want the lowest note to be the root.
    let baseNote = rootPc + 12 * currentOctave;
    if (baseNote < 55) baseNote += 12;
    if (baseNote > 67) baseNote -= 12;
    
    // Re-calculate octave based on baseNote
    currentOctave = Math.floor(baseNote / 12);

    for (let i = 0; i < 14; i++) {
        notes.push(scalePcs[currentIdx] + 12 * currentOctave);
        currentIdx++;
        if (currentIdx >= scalePcs.length) {
            currentIdx = 0;
            currentOctave++;
        }
    }
    return notes;
  };

  // Handle Input (Swipe & Tap)
  useEffect(() => {
    const current = activeKeys;
    const prev = prevActiveKeysRef.current;

    const added = Array.from<string>(current).filter(k => !prev.has(k));
    const removed = Array.from<string>(prev).filter(k => !current.has(k));

    // Handle Jam Mode Note Off and Long Press Cancel
    removed.forEach(keyId => {
        const parts = keyId.split('-');
        if (parts.length === 3) {
            const c = parseInt(parts[1]);
            const r = parseInt(parts[2]);
            
            // Cancel long press if key released early
            if (current.has('key-4-0') || prev.has('key-4-0')) {
                if ((c === 0 && r === 0) || (c === 1 && r === 0) || (c === 4 && r === 0)) {
                    if (longPressTimeout.current) {
                        clearTimeout(longPressTimeout.current);
                        longPressTimeout.current = null;
                    }
                }
            }

            if (appState === 'JAMMING_MELODY') {
                arpStateRef.current.heldIndices.delete(keyId);
                if (arpStateRef.current.heldIndices.size === 0) {
                    if (arpStateRef.current.intervalId) {
                        clearInterval(arpStateRef.current.intervalId);
                        arpStateRef.current.intervalId = null;
                    }
                    if (arpStateRef.current.lastPlayedNote !== -1) {
                        AudioEngine.noteOff(0, arpStateRef.current.lastPlayedNote);
                        arpStateRef.current.lastPlayedNote = -1;
                    }
                } else {
                    // Update centerIdx to the last held key
                    const lastKey = Array.from(arpStateRef.current.heldIndices.keys()).pop();
                    if (lastKey) {
                        arpStateRef.current.centerIdx = arpStateRef.current.heldIndices.get(lastKey)!;
                    }
                }
            }
        }
    });

    added.forEach(keyId => {
      const parts = keyId.split('-');
      if (parts.length === 3) {
        const c = parseInt(parts[1]);
        const r = parseInt(parts[2]);
        const now = performance.now();

        const ctx = getAudioContext();
        if (ctx.state !== 'running') {
          ctx.resume();
        }

        const isFnPressed = current.has('key-4-0');
        const isJamming = appState === 'JAMMING_DRUMS' || appState === 'JAMMING_MELODY' || appState === 'PREPARING_JAM';

        // --- Function Key Itself ---
        if (c === 4 && r === 0) {
            if (isJamming) {
                managerRef.current?.exitJam();
            }
            return; // Skip other interactions for the function key itself
        }

        // --- Jam Mode Trigger (Long Press) ---
        if (isFnPressed) {
            if (c === 0 && r === 0) {
                if (longPressTimeout.current) clearTimeout(longPressTimeout.current);
                longPressTimeout.current = setTimeout(() => {
                    if (appState === 'PLAYING') {
                        managerRef.current?.prepareJam('drums');
                    } else if (appState === 'JAMMING_DRUMS' || appState === 'JAMMING_MELODY') {
                        managerRef.current?.exitJam();
                    }
                }, 500); // 500ms long press
            } else if (c === 1 && r === 0) {
                if (longPressTimeout.current) clearTimeout(longPressTimeout.current);
                longPressTimeout.current = setTimeout(() => {
                    if (appState === 'PLAYING') {
                        managerRef.current?.prepareJam('melody');
                    } else if (appState === 'JAMMING_DRUMS' || appState === 'JAMMING_MELODY') {
                        managerRef.current?.exitJam();
                    }
                }, 500); // 500ms long press
            }
            return; // Skip other interactions when FN is held
        }

        // --- Jam Mode Playback ---
        if (appState === 'JAMMING_DRUMS') {
            const note = DRUM_MAP[`${c}-${r}`];
            if (note) {
                AudioEngine.playNote(9, note, 127, 100); // Max velocity for louder drums
                AudioEngine.emitVisualEvent({ type: 'drums', midiNote: note, velocity: 127, source: 'gameplay' });
                managerRef.current?.recordUserDrum(note, 127);
            }
            return; // Skip other interactions unconditionally
        } else if (appState === 'JAMMING_MELODY') {
            const track = managerRef.current?.currentTrack;
            if (track) {
                let idx = -1;
                if (r === 2) idx = c;
                else if (r === 1) idx = 5 + c;
                else if (r === 0 && c < 4) idx = 10 + c;

                if (idx !== -1) {
                    arpStateRef.current.heldIndices.set(keyId, idx);
                    arpStateRef.current.centerIdx = idx;

                    const chord = managerRef.current?.getCurrentChord();
                    const notes = getJamMelodyNotes(chord, track.tonality, track.keyOffset);
                    const note = notes[idx];

                    if (arpStateRef.current.lastPlayedNote !== -1) {
                        AudioEngine.noteOff(0, arpStateRef.current.lastPlayedNote);
                    }
                    if (note) {
                        AudioEngine.noteOn(0, note, 100);
                        AudioEngine.emitVisualEvent({ type: 'melody', midiNote: note, velocity: 100, source: 'gameplay' });
                        arpStateRef.current.lastPlayedNote = note;
                        arpStateRef.current.step = 1;
                    }

                    if (!arpStateRef.current.intervalId) {
                        arpStateRef.current.intervalId = setInterval(() => {
                            const state = arpStateRef.current;
                            if (state.heldIndices.size === 0) return;

                            const track = managerRef.current?.currentTrack;
                            if (!track) return;

                            const chord = managerRef.current?.getCurrentChord();
                            const notes = getJamMelodyNotes(chord, track.tonality, track.keyOffset);

                            // Dynamic Arpeggio Patterns
                            const patterns = [
                                [0, 1, 2, 3, 2, 1, 0, -1, -2, -1], // Smooth up and down
                                [0, 2, 1, 3, 2, 0, -1, -2, -1, 1], // Broken chord
                                [0, -1, -2, -3, -2, -1, 0, 1, 2, 1], // Down and up
                                [0, 1, 0, 2, 0, -1, 0, -2]         // Pedal point
                            ];
                            
                            // Randomly switch pattern every few steps to make it "dynamic"
                            if (state.step % 8 === 0) {
                                state.patternIdx = Math.floor(Math.random() * patterns.length);
                            }
                            const activePattern = patterns[state.patternIdx || 0];
                            const offset = activePattern[state.step % activePattern.length];
                            
                            let targetIdx = state.centerIdx + offset;
                            
                            // Clamp to available notes
                            targetIdx = Math.max(0, Math.min(13, targetIdx));
                            
                            const arpNote = notes[targetIdx];

                            if (state.lastPlayedNote !== -1) {
                                AudioEngine.noteOff(0, state.lastPlayedNote);
                            }
                            
                            if (arpNote) {
                                const vel = 80 + Math.floor(Math.random() * 30);
                                AudioEngine.noteOn(0, arpNote, vel);
                                AudioEngine.emitVisualEvent({ type: 'melody', midiNote: arpNote, velocity: vel, source: 'gameplay' });
                                state.lastPlayedNote = arpNote;
                            }
                            
                            state.step++;
                        }, 180); // 180ms per note (slower)
                    }
                }
            }
            return; // Skip other interactions unconditionally
        }

        if (appState === 'PREPARING_JAM') {
            return; // Skip other interactions while preparing
        }

        // --- Swipe Detection ---
        let swiped = false;
        if (appState === 'IDLE') {
            if (now - swipeState.current.lastActionTime > 400) {
              swipeState.current.path = [];
            }
            swipeState.current.path.push({c, r, time: now});
            swipeState.current.lastActionTime = now;
            swipeState.current.path = swipeState.current.path.filter(p => now - p.time < 500);

            const path = swipeState.current.path;
            if (path.length >= 2) {
              const first = path[0];
              const last = path[path.length - 1];
              const dt = last.time - first.time;
              const dc = last.c - first.c;
              
              if (Math.abs(dc) >= 1 && dt < 500) {
                const safeDt = Math.max(dt, 10);
                const speed = Math.abs(dc) / (safeDt / 1000);
                const moveAmount = speed > 15 ? 2 : 1;

                const prevIdx = selectedIndexRef.current;
                let newIdx = prevIdx;
                if (dc < 0) { // Swipe left -> Next item
                  newIdx = Math.min(bars.length - 1, prevIdx + moveAmount);
                  systemAudio.triggerKick(0, 0.5); // subtle feedback
                } else { // Swipe right -> Previous item
                  newIdx = Math.max(0, prevIdx - moveAmount);
                  systemAudio.triggerKick(0, 0.5);
                }
                
                if (newIdx !== prevIdx) {
                  setSelectedIndex(newIdx);
                }
                swipeState.current.path = [];
                swiped = true;
              }
            }
        } else {
            // Clear swipe path if not IDLE
            swipeState.current.path = [];
        }

        // --- Tap Detection ---
        const isFunctionKey = c === 4 && r === 0;
        
        if (!swiped && !isFunctionKey && !isFnPressed) {
          if (lastTapKey.current && lastTapKey.current.c === c && lastTapKey.current.r === r) {
            tapCount.current += 1;
          } else {
            tapCount.current = 1;
            lastTapKey.current = { c, r };
          }

          if (tapTimeout.current) clearTimeout(tapTimeout.current);
          
          tapTimeout.current = setTimeout(() => {
            const count = tapCount.current;
            tapCount.current = 0;
            lastTapKey.current = null;

            systemAudio.triggerKick(0, 1);
            AudioEngine.emitVisualEvent({ type: 'confirm', midiNote: 60, velocity: 127 });

            if (count === 2) {
              // Double Tap
              if (appState === 'IDLE') {
                // Enter Bar
                const selectedBar = bars[selectedIndexRef.current];
                if (selectedBar && managerRef.current) {
                  managerRef.current.setAllowedStyles(selectedBar.styleIds);
                  managerRef.current.triggerGeneration();
                }
              } else {
                // Next Song
                managerRef.current?.playNext();
              }
            } else if (count >= 3) {
              // Triple Tap
              if (appState === 'IDLE') {
                // Exit App
                managerRef.current?.stopPlayback();
                if (onExit) onExit();
              } else {
                // Exit Bar (Return to IDLE)
                managerRef.current?.stopPlayback();
              }
            }
          }, 300);
        }
      }
    });

    prevActiveKeysRef.current = new Set(current);
  }, [activeKeys, appState, bars, onExit]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ w: 811, h: 269 });

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        setDim({
          w: entries[0].contentRect.width,
          h: entries[0].contentRect.height
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Layout Constants (Responsive)
  const SCREEN_W = dim.w;
  const SCREEN_H = dim.h;
  const CARD_W = SCREEN_W * (458 / 811);
  const CARD_H = SCREEN_H * (200 / 269);
  const LEFT_MARGIN = SCREEN_W * 0.10; // 10%
  const SPACING = SCREEN_W * 0.15; // 15%
  
  // Image Width calculation:
  // Adjusted to give more space to the text content on the right
  const IMG_W = SCREEN_W * (200 / 811);
  const IMG_H = SCREEN_H * (174 / 269);

  const tapAreaContainer = document.getElementById('tap-area-container');

  // Cleanup arp interval when appState changes
  useEffect(() => {
    if (appState !== 'JAMMING_MELODY') {
      if (arpStateRef.current.intervalId) {
        clearInterval(arpStateRef.current.intervalId);
        arpStateRef.current.intervalId = null;
      }
      if (arpStateRef.current.lastPlayedNote !== -1) {
        AudioEngine.noteOff(0, arpStateRef.current.lastPlayedNote);
        arpStateRef.current.lastPlayedNote = -1;
      }
      arpStateRef.current.heldIndices.clear();
    }
  }, [appState]);

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-[#0A0A0A] text-white select-none font-sans">
      {/* Scanlines Effect */}
      <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.25)_50%)] bg-[length:100%_4px] z-50" />

      {/* Jam Mode Overlay */}
      <AnimatePresence>
        {(appState === 'PREPARING_JAM' || appState === 'JAMMING_DRUMS' || appState === 'JAMMING_MELODY') && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 pointer-events-none z-40 flex items-center justify-center"
          >
            <div className="absolute inset-0 border-4 border-red-500/50 rounded-lg animate-pulse" />
            <div className="absolute top-4 bg-red-500 text-white px-4 py-1 rounded-full text-xs font-bold tracking-widest uppercase shadow-[0_0_15px_rgba(239,68,68,0.5)]">
              {appState === 'PREPARING_JAM' ? 'GET READY...' : 
               appState === 'JAMMING_DRUMS' ? 'DRUM SOLO' : 'MELODY SOLO'}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Carousel Container */}
      <AnimatePresence>
        {appState !== 'JAMMING_DRUMS' && appState !== 'JAMMING_MELODY' && appState !== 'PREPARING_JAM' && (
          <motion.div 
            className="absolute top-0 left-0 h-full flex items-center w-max"
            initial={{ opacity: 1 }}
            animate={{ x: -selectedIndex * (CARD_W + SPACING), opacity: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            style={{ paddingLeft: LEFT_MARGIN }}
          >
            {bars.map((bar, index) => {
              const isActive = index === selectedIndex;
              const isPlaying = isActive && appState !== 'IDLE';

              return (
                <motion.div
                  key={bar.id}
                  className="relative flex items-center overflow-hidden shrink-0"
                  style={{ 
                    width: CARD_W, 
                    height: CARD_H, 
                    marginRight: SPACING,
                    backgroundColor: isActive ? 'rgba(20, 20, 20, 0.8)' : 'transparent',
                    border: isActive ? '1px solid rgba(255,255,255,0.1)' : 'none',
                    borderRadius: SCREEN_H * (16 / 269)
                  }}
                  animate={{ 
                    opacity: isActive ? 1 : 0.6,
                    scale: isActive ? 1 : 0.95,
                    filter: isActive ? 'brightness(1)' : 'brightness(0.75)'
                  }}
                  transition={{ duration: 0.3 }}
                >
                  {/* Left Image */}
                  <div 
                    className="absolute left-0 flex items-center justify-start"
                    style={{ width: IMG_W, height: CARD_H, paddingLeft: SCREEN_W * (16 / 811) }}
                  >
                    <img 
                      src={bar.imagePath} 
                      alt={bar.name}
                      style={{ width: IMG_W - (SCREEN_W * (16 / 811)), height: IMG_H, objectFit: 'contain', objectPosition: 'left center' }}
                      className="drop-shadow-2xl"
                      referrerPolicy="no-referrer"
                    />
                  </div>

                  {/* Right Content */}
                  <div 
                    className="absolute flex flex-col justify-center"
                    style={{ 
                      left: IMG_W, 
                      width: CARD_W - IMG_W, 
                      height: CARD_H, 
                      paddingLeft: SCREEN_W * (16 / 811), 
                      paddingRight: SCREEN_W * (16 / 811) 
                    }}
                  >
                    <div 
                      className="uppercase tracking-widest text-yellow-400 mb-1 font-bold bg-yellow-400/20 w-max rounded-sm"
                      style={{ 
                        fontSize: SCREEN_H * (10 / 269),
                        padding: `${SCREEN_H * (2 / 269)}px ${SCREEN_W * (8 / 811)}px`
                      }}
                    >
                      {isPlaying ? 'Live Now' : 'Just Opened'}
                    </div>
                    <h2 
                      className="font-black tracking-wider uppercase leading-tight mb-2 whitespace-nowrap"
                      style={{ fontSize: SCREEN_H * (24 / 269) }}
                    >
                      {bar.name}
                    </h2>
                    
                    <div className="flex flex-col gap-1">
                      <span 
                        className="text-gray-400 uppercase tracking-widest whitespace-nowrap"
                        style={{ fontSize: SCREEN_H * (12 / 269) }}
                      >
                        Now Live:
                      </span>
                      <span 
                        className={`font-bold uppercase tracking-wider whitespace-nowrap truncate ${isPlaying ? 'text-red-500 animate-pulse' : 'text-gray-600'}`}
                        style={{ fontSize: SCREEN_H * (14 / 269) }}
                      >
                        {isPlaying ? currentStyleName : '---'}
                      </span>
                    </div>

                    {/* Equalizer Animation when playing */}
                    {isPlaying && (
                      <div 
                        className="absolute flex items-end gap-1"
                        style={{ 
                          bottom: SCREEN_H * (16 / 269), 
                          right: SCREEN_W * (16 / 811),
                          height: SCREEN_H * (16 / 269)
                        }}
                      >
                        {[1, 2, 3, 4].map((i) => (
                          <motion.div
                            key={i}
                            className="bg-red-500 rounded-t-sm"
                            style={{ width: SCREEN_W * (4 / 811) }}
                            animate={{ height: ['20%', '100%', '40%', '80%', '20%'] }}
                            transition={{ duration: 0.5 + i * 0.1, repeat: Infinity, ease: 'linear' }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Generating Overlay */}
      <AnimatePresence>
        {appState === 'GENERATING' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-40"
          >
            <div 
              className="text-cyan-400 font-bold tracking-widest animate-pulse"
              style={{ fontSize: SCREEN_H * (20 / 269) }}
            >
              ENTERING BAR...
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Light Show Overlay */}
      <AnimatePresence>
        {(appState === 'JAMMING_DRUMS' || appState === 'JAMMING_MELODY') && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 pointer-events-none z-40 flex items-center justify-center"
          >
            <div className="absolute inset-0 bg-gradient-to-t from-cyan-900/40 to-transparent mix-blend-screen" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(6,182,212,0.3)_0%,transparent_70%)]" />
            
            {/* Dynamic Light Beams */}
            <motion.div 
              className="absolute inset-0"
              animate={{ 
                background: [
                  'conic-gradient(from 0deg at 50% 50%, rgba(6,182,212,0) 0%, rgba(6,182,212,0.2) 10%, rgba(6,182,212,0) 20%)',
                  'conic-gradient(from 360deg at 50% 50%, rgba(6,182,212,0) 0%, rgba(6,182,212,0.2) 10%, rgba(6,182,212,0) 20%)'
                ]
              }}
              transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

### `src/apps/AuraJam/ScaleEngine.ts`

> 14 音音阶板：随机调号 + 调式（9 种），生成 14 个升序 MIDI 音。

```ts
import { Tonality, TonalityName, SCALE_INTERVALS } from '@/src/core/generation/types';

export interface ScaleState {
    key: number;          // 0-11 (pitch class)
    tonality: Tonality;
    noteMap: number[];    // 14 MIDI notes, ascending
    keyName: string;      // 显示用 ("C", "Db", ...)
    tonalityName: string; // 显示用 ("Major", "Blues", ...)
}

const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

const ALL_TONALITIES = [
    Tonality.Major, Tonality.Minor, Tonality.Major_Pentatonic,
    Tonality.Minor_Pentatonic, Tonality.Blues, Tonality.Dorian,
    Tonality.Mixolydian, Tonality.Melodic_Minor, Tonality.Lydian
];

function generateScaleNotes(key: number, tonality: Tonality): number[] {
    const intervals = SCALE_INTERVALS[tonality];
    const notes: number[] = [];
    // 起始八度：C3 附近，确保音域在 C3~C5 左右（MIDI 48~72）
    let octave = Math.floor((key + 48) / 12);
    let scaleIdx = 0;
    for (let i = 0; i < 14; i++) {
        notes.push(intervals[scaleIdx] + octave * 12 + key);
        scaleIdx++;
        if (scaleIdx >= intervals.length) {
            scaleIdx = 0;
            octave++;
        }
    }
    return notes;
}

export class ScaleEngine {
    private state: ScaleState;

    constructor() {
        // 初始就随机，不要每次都是 C Major
        this.state = ScaleEngine.generate(0, Tonality.Major);
        this.refresh(() => Math.random());
    }

    /** 随机刷新音阶（需外部先 seed PRNG 或用 Math.random） */
    refresh(randFn: () => number): ScaleState {
        const key = Math.floor(randFn() * 12);
        const tonality = ALL_TONALITIES[Math.floor(randFn() * ALL_TONALITIES.length)];
        this.state = ScaleEngine.generate(key, tonality);
        return this.state;
    }

    getState(): ScaleState {
        return this.state;
    }

    noteAt(padIndex: number): number {
        return this.state.noteMap[padIndex] ?? 60;
    }

    /** (c, r) → pad 索引（0-13），FN 键返回 -1 */
    static padIndex(c: number, r: number): number {
        if (c === 4 && r === 0) return -1; // FN key
        if (r === 2) return c;             // 底行 0-4
        if (r === 1) return 5 + c;         // 中行 5-9
        if (r === 0 && c < 4) return 10 + c; // 顶行 10-13
        return -1;
    }

    private static generate(key: number, tonality: Tonality): ScaleState {
        return {
            key,
            tonality,
            noteMap: generateScaleNotes(key, tonality),
            keyName: KEY_NAMES[key % 12],
            tonalityName: TonalityName[tonality] || 'Major'
        };
    }
}
```

### `src/apps/AuraJam/MotifRecorder.ts`

> 实时按键录音 → NoteData[]（假设 BPM 120）。

```ts
import { NoteData } from '@/src/core/generation/types';

interface RecordingEvent {
    padIndex: number;
    midiNote: number;
    velocity: number;
    onsetMs: number;
    releaseMs: number;
}

export class MotifRecorder {
    private events: RecordingEvent[] = [];
    private openNotes: RecordingEvent[] = []; // P-1: 用数组代替 Map
    private startTime: number = 0;
    private assumedBpm: number = 120;

    start(): void {
        this.events = [];
        this.openNotes = [];
        this.startTime = performance.now();
    }

    noteOn(padIndex: number, midiNote: number, velocity: number): void {
        const event: RecordingEvent = {
            padIndex,
            midiNote,
            velocity,
            onsetMs: performance.now() - this.startTime,
            releaseMs: 0
        };
        this.openNotes.push(event);
        this.events.push(event);
    }

    noteOff(padIndex: number): void {
        const now = performance.now() - this.startTime;
        for (let i = this.openNotes.length - 1; i >= 0; i--) {
            if (this.openNotes[i].padIndex === padIndex) {
                this.openNotes[i].releaseMs = now;
                this.openNotes.splice(i, 1);
                break;
            }
        }
    }

    /** 停止录制，关闭所有未结束的音符，返回 NoteData[] */
    stop(): NoteData[] {
        const now = performance.now() - this.startTime;
        for (let i = 0; i < this.openNotes.length; i++) {
            this.openNotes[i].releaseMs = now;
        }
        this.openNotes = [];
        return this.toNoteData();
    }

    getEventCount(): number {
        return this.events.length;
    }

    getElapsedMs(): number {
        if (this.startTime === 0) return 0;
        return performance.now() - this.startTime;
    }

    private toNoteData(): NoteData[] {
        const msPerBeat = 60000 / this.assumedBpm;
        const result: NoteData[] = [];
        for (let i = 0; i < this.events.length; i++) {
            const e = this.events[i];
            result.push({
                pitch: e.midiNote,
                onset: e.onsetMs / msPerBeat,
                duration: Math.max(0.125, (e.releaseMs - e.onsetMs) / msPerBeat),
                velocity: e.velocity / 127,
                isUserMotif: true
            });
        }
        return result;
    }
}
```

### `src/apps/AuraJam/MotifPreprocessor.ts`

> 用户 motif 4 阶段处理：质量分析 → 调内吸附清洗 → A-A-A'-A'' 变奏扩展 → 角色门控（Foreground/Middleground/Background）。

```ts
import { NoteData, Tonality, SCALE_INTERVALS } from '@/src/core/generation/types';

type MotifRole = 'Foreground' | 'Middleground' | 'Background';

export interface MotifAnalysis {
    qualityScore: number;       // 0-1
    intervalProfile: 'stepwise' | 'jumpy' | 'static' | 'mixed';
    rhythmRegularity: number;   // 0-1
    suggestedRole: MotifRole;
    noteCount: number;
}

export interface PreprocessedMotif {
    motif: NoteData[] | null;   // null = 质量太低，不传 motif
    role: MotifRole;
    analysis: MotifAnalysis;
}

// ================================================================
// 阶段 1：质量分析
// ================================================================

function analyzeMotif(notes: NoteData[]): MotifAnalysis {
    const n = notes.length;

    if (n < 2) {
        return { qualityScore: 0.1, intervalProfile: 'static', rhythmRegularity: 0, suggestedRole: 'Background', noteCount: n };
    }

    // 1. 音程分析
    const intervals: number[] = [];
    let bigJumps = 0;
    let ups = 0;
    let downs = 0;
    let sames = 0;
    for (let i = 1; i < n; i++) {
        const interval = notes[i].pitch - notes[i - 1].pitch;
        intervals.push(interval);
        const abs = Math.abs(interval);
        if (abs > 7) bigJumps++;
        if (interval > 0) ups++;
        else if (interval < 0) downs++;
        else sames++;
    }

    const bigJumpRatio = bigJumps / intervals.length;
    const intervalScore = Math.max(0, 1.0 - bigJumpRatio * 2.5); // 大跳越多越扣分

    // 2. 节奏规律性（能否量化到 16th grid）
    const gridSize = 0.25;
    let totalDeviation = 0;
    for (let i = 0; i < n; i++) {
        const quantized = Math.round(notes[i].onset / gridSize) * gridSize;
        totalDeviation += Math.abs(notes[i].onset - quantized);
    }
    const avgDeviation = totalDeviation / n;
    const rhythmRegularity = Math.max(0, 1.0 - avgDeviation * 8); // 偏差越大越不规律

    // 3. 音域跨度
    let minPitch = 127;
    let maxPitch = 0;
    for (let i = 0; i < n; i++) {
        if (notes[i].pitch < minPitch) minPitch = notes[i].pitch;
        if (notes[i].pitch > maxPitch) maxPitch = notes[i].pitch;
    }
    const range = maxPitch - minPitch;
    const rangeScore = range <= 14 ? 1.0 : Math.max(0, 1.0 - (range - 14) * 0.08);

    // 4. 音符数量
    let countScore = 1.0;
    if (n < 3) countScore = 0.4;
    else if (n > 16) countScore = 0.5;
    else if (n >= 3 && n <= 12) countScore = 1.0;
    else countScore = 0.7;

    // 5. 方向变化（有起伏比纯单向好）
    const hasUps = ups > 0;
    const hasDowns = downs > 0;
    const directionScore = (hasUps && hasDowns) ? 1.0 : (sames > intervals.length * 0.5 ? 0.3 : 0.5);

    // 综合评分
    const qualityScore = intervalScore * 0.3 + rhythmRegularity * 0.25 + rangeScore * 0.2 + countScore * 0.15 + directionScore * 0.1;

    // 音程轮廓分类
    let intervalProfile: 'stepwise' | 'jumpy' | 'static' | 'mixed' = 'mixed';
    if (sames > intervals.length * 0.6) intervalProfile = 'static';
    else if (bigJumpRatio > 0.4) intervalProfile = 'jumpy';
    else if (bigJumpRatio < 0.15) intervalProfile = 'stepwise';

    // 角色推断
    let suggestedRole: MotifRole = 'Foreground';
    if (n <= 4 && sames >= intervals.length * 0.3) suggestedRole = 'Background';
    else if (n > 12) suggestedRole = 'Middleground';

    return { qualityScore, intervalProfile, rhythmRegularity, suggestedRole, noteCount: n };
}

// ================================================================
// 阶段 2：清洗
// ================================================================

function snapToScale(pitch: number, scalePcs: number[]): number {
    const pc = ((pitch % 12) + 12) % 12;
    const octave = Math.floor(pitch / 12);
    let bestDist = 99;
    let bestPc = pc;
    for (let i = 0; i < scalePcs.length; i++) {
        const dist = Math.min(Math.abs(pc - scalePcs[i]), 12 - Math.abs(pc - scalePcs[i]));
        if (dist < bestDist) { bestDist = dist; bestPc = scalePcs[i]; }
    }
    // 选择最近的八度
    const candidates = [bestPc + octave * 12, bestPc + (octave - 1) * 12, bestPc + (octave + 1) * 12];
    let best = candidates[0];
    let bestAbsDist = Math.abs(candidates[0] - pitch);
    for (let i = 1; i < candidates.length; i++) {
        const d = Math.abs(candidates[i] - pitch);
        if (d < bestAbsDist) { best = candidates[i]; bestAbsDist = d; }
    }
    return best;
}

function cleanMotif(notes: NoteData[], tonality: Tonality): NoteData[] {
    const intervals = SCALE_INTERVALS[tonality] || SCALE_INTERVALS[Tonality.Major];
    const scalePcs = intervals.map(i => i % 12);
    const gridSize = 0.25;

    const cleaned: NoteData[] = [];
    for (let i = 0; i < notes.length; i++) {
        const n = notes[i];

        // 节奏量化
        const quantizedOnset = Math.round(n.onset / gridSize) * gridSize;

        // 音高吸附到音阶
        let pitch = snapToScale(n.pitch, scalePcs);

        // 去除异常音（与前后音间距都 > 12 半音）
        if (i > 0 && i < notes.length - 1) {
            const prevPitch = cleaned[cleaned.length - 1].pitch;
            const nextPitch = snapToScale(notes[i + 1].pitch, scalePcs);
            if (Math.abs(pitch - prevPitch) > 12 && Math.abs(pitch - nextPitch) > 12) {
                pitch = snapToScale(prevPitch, scalePcs);
            }
        }

        // 时值归一化
        const duration = Math.max(0.125, Math.min(4.0, n.duration));

        cleaned.push({
            pitch,
            onset: quantizedOnset,
            duration,
            velocity: n.velocity,
            isUserMotif: true
        });
    }

    return cleaned;
}

// ================================================================
// 阶段 3：变奏扩展（A - A - A' - A'' 结构）
// 保留 75% 原始音符，让用户能清晰听到自己的 motif
// ================================================================

function expandMotif(cleaned: NoteData[], tonality: Tonality, beatsPerBar: number): NoteData[] {
    if (cleaned.length === 0) return [];

    const intervals = SCALE_INTERVALS[tonality] || SCALE_INTERVALS[Tonality.Major];
    const scalePcs = intervals.map(i => i % 12);

    // 计算 motif 原始长度，向上补齐到 beatsPerBar 的倍数
    let maxOnset = 0;
    for (let i = 0; i < cleaned.length; i++) {
        const end = cleaned[i].onset + cleaned[i].duration;
        if (end > maxOnset) maxOnset = end;
    }
    const motifLength = Math.max(beatsPerBar, Math.ceil(maxOnset / beatsPerBar) * beatsPerBar);

    // 如果 motif 太长（> 8 拍），截取前 2 小节
    const maxLength = beatsPerBar * 2;
    let core = cleaned;
    if (motifLength > maxLength) {
        core = cleaned.filter(n => n.onset < maxLength);
        if (core.length === 0) core = [cleaned[0]];
    }
    const coreLength = Math.min(motifLength, maxLength);

    const result: NoteData[] = [];

    // A: 原始 motif（第 1 遍，完全保留）
    for (let i = 0; i < core.length; i++) {
        result.push({ ...core[i] });
    }

    // A: 原始 motif（第 2 遍，完全重复 — 强化记忆点）
    for (let i = 0; i < core.length; i++) {
        result.push({ ...core[i], onset: core[i].onset + coreLength });
    }

    // A': 微调变奏 — 仅最后一个音做调内位移
    for (let i = 0; i < core.length; i++) {
        const note = { ...core[i], onset: core[i].onset + coreLength * 2 };
        if (i === core.length - 1) {
            note.pitch = shiftDiatonic(note.pitch, scalePcs, 1);
        }
        result.push(note);
    }

    // A'': 回归高潮 — 原始 motif + 最高音延长增强
    let highestIdx = 0;
    let highestPitch = -1;
    for (let i = 0; i < core.length; i++) {
        if (core[i].pitch > highestPitch) { highestPitch = core[i].pitch; highestIdx = i; }
    }
    for (let i = 0; i < core.length; i++) {
        const note = { ...core[i], onset: core[i].onset + coreLength * 3, isUserMotif: true };
        if (i === highestIdx) {
            note.duration = Math.min(4.0, note.duration * 1.5);
            note.velocity = Math.min(1.0, note.velocity * 1.2);
        }
        result.push(note);
    }

    return result;
}

function shiftDiatonic(pitch: number, scalePcs: number[], direction: number): number {
    const pc = ((pitch % 12) + 12) % 12;
    const octave = Math.floor(pitch / 12);
    // 找到当前 pc 在音阶中的位置
    let idx = -1;
    let minDist = 99;
    for (let i = 0; i < scalePcs.length; i++) {
        const d = Math.min(Math.abs(pc - scalePcs[i]), 12 - Math.abs(pc - scalePcs[i]));
        if (d < minDist) { minDist = d; idx = i; }
    }
    // 移动一个度
    let newIdx = idx + direction;
    let newOctave = octave;
    if (newIdx >= scalePcs.length) { newIdx = 0; newOctave++; }
    if (newIdx < 0) { newIdx = scalePcs.length - 1; newOctave--; }
    return scalePcs[newIdx] + newOctave * 12;
}

// ================================================================
// 阶段 4：质量门控 + 公开 API
// ================================================================

export function preprocessMotif(
    raw: NoteData[],
    tonality: Tonality
): PreprocessedMotif {
    if (raw.length === 0) {
        return {
            motif: null,
            role: 'Foreground',
            analysis: { qualityScore: 0, intervalProfile: 'static', rhythmRegularity: 0, suggestedRole: 'Foreground', noteCount: 0 }
        };
    }

    const analysis = analyzeMotif(raw);

    const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    console.log(`[MotifPreprocessor] Raw input: ${raw.length} notes, quality: ${analysis.qualityScore.toFixed(2)}, profile: ${analysis.intervalProfile}`);
    console.log(`[MotifPreprocessor] Raw pitches: ${raw.map(n => NOTE_NAMES[((n.pitch % 12) + 12) % 12] + Math.floor(n.pitch / 12)).join(', ')}`);
    console.log(`[MotifPreprocessor] Raw onsets: ${raw.map(n => n.onset.toFixed(2)).join(', ')}`);

    // 质量太低：不传 motif，回退到正常随机生成
    if (analysis.qualityScore < 0.25) {
        console.log(`[MotifPreprocessor] Quality too low, falling back to random generation`);
        return { motif: null, role: analysis.suggestedRole, analysis };
    }

    // 清洗
    const cleaned = cleanMotif(raw, tonality);
    console.log(`[MotifPreprocessor] After cleaning: ${cleaned.length} notes`);
    console.log(`[MotifPreprocessor] Cleaned pitches: ${cleaned.map(n => NOTE_NAMES[((n.pitch % 12) + 12) % 12] + Math.floor(n.pitch / 12)).join(', ')}`);

    // 变奏扩展
    const beatsPerBar = 4; // 默认 4/4
    const expanded = expandMotif(cleaned, tonality, beatsPerBar);
    console.log(`[MotifPreprocessor] After expansion: ${expanded.length} notes (${cleaned.length} × 4 sections)`);

    // 角色决定
    let role = analysis.suggestedRole;
    if (analysis.qualityScore < 0.5) role = 'Background';

    console.log(`[MotifPreprocessor] Quality: ${analysis.qualityScore.toFixed(2)}, Role: ${role}, Notes: ${raw.length}→${expanded.length}, Profile: ${analysis.intervalProfile}`);

    return { motif: expanded, role, analysis };
}
```

### `src/apps/AuraJam/JamSessionManager.ts`

> Jam 状态机：SCALE_VIEW→RECORDING→GENERATING→PLAYING→（JAM 模式）。

```ts
import { AudioEngine } from '../../core/audio/AudioEngine';
import { StyleId } from '../../core/generation/config/StyleFlags';
import { AcgStyleConfig } from '../../core/generation/config/StyleRegistry';
import { GlobalContext } from '../../core/generation/GlobalContext';
import { MelodyEngine } from '../../core/generation/MelodyEngine';
import { GeneratedTrack, StyleConfig, MusicContext, NoteData } from '../../core/generation/types';
import { PRNGManager } from '../../core/utils/PRNG';
import { globalMidiScheduler } from '../../core/audio/MidiScheduler';
import { ScaleEngine, ScaleState } from './ScaleEngine';
import { MotifRecorder } from './MotifRecorder';
import { preprocessMotif } from './MotifPreprocessor';

export type JamAppState =
    | 'SCALE_VIEW'
    | 'RECORDING'
    | 'GENERATING'
    | 'PLAYING'
    | 'PREPARING_JAM'
    | 'JAMMING_DRUMS'
    | 'JAMMING_MELODY';

export class JamSessionManager {
    private state: JamAppState = 'SCALE_VIEW';
    private stateChangeCallback?: (state: JamAppState) => void;
    private generationId: number = 0;

    public currentTrack?: GeneratedTrack;
    public currentStyle?: StyleConfig;

    private scaleEngine: ScaleEngine;
    private recorder: MotifRecorder;

    // --- Jam Mode State (from EndlessRadioManager) ---
    public userDrumPattern: { note: number; velocity: number; tick: number }[] = [];
    public jamStartTick: number = 0;
    public jamLengthTicks: number = 0;
    private originalDrumEvents: any[] = [];
    private jamCheckInterval: any = null;

    constructor() {
        this.scaleEngine = new ScaleEngine();
        this.recorder = new MotifRecorder();
    }

    public onStateChange(callback: (state: JamAppState) => void) {
        this.stateChangeCallback = callback;
    }

    private setState(newState: JamAppState) {
        this.state = newState;
        if (this.stateChangeCallback) {
            this.stateChangeCallback(this.state);
        }
    }

    public getState(): JamAppState {
        return this.state;
    }

    public getScaleState(): ScaleState {
        return this.scaleEngine.getState();
    }

    // ================================================================
    // Scale View
    // ================================================================

    public refreshScale(): ScaleState {
        return this.scaleEngine.refresh(() => Math.random());
    }

    // ================================================================
    // Recording
    // ================================================================

    public startRecording(): void {
        this.recorder.start();
        this.setState('RECORDING');
    }

    public stopRecordingAndGenerate(): void {
        const motifNotes = this.recorder.stop();
        console.log(`[AuraJam] Recording stopped: ${motifNotes.length} notes captured`);
        if (motifNotes.length === 0) {
            console.log(`[AuraJam] No notes recorded, returning to SCALE_VIEW`);
            this.setState('SCALE_VIEW');
            return;
        }
        this.triggerGeneration(motifNotes);
    }

    public cancelRecording(): void {
        this.recorder.stop();
        this.setState('SCALE_VIEW');
    }

    public recordNoteOn(padIndex: number, midiNote: number, velocity: number): void {
        if (this.state !== 'RECORDING') return;
        this.recorder.noteOn(padIndex, midiNote, velocity);
    }

    public recordNoteOff(padIndex: number): void {
        if (this.state !== 'RECORDING') return;
        this.recorder.noteOff(padIndex);
    }

    public getRecordingInfo(): { eventCount: number; elapsedMs: number } {
        return {
            eventCount: this.recorder.getEventCount(),
            elapsedMs: this.recorder.getElapsedMs()
        };
    }

    // ================================================================
    // Generation + Playback
    // ================================================================

    private async triggerGeneration(motifNotes: NoteData[]): Promise<void> {
        const currentGenId = ++this.generationId;
        AudioEngine.stop();
        this.setState('GENERATING');

        try {
            await new Promise(resolve => setTimeout(resolve, 100));
            if (currentGenId !== this.generationId) return;

            const seed = (Date.now() ^ Math.floor(Math.random() * 1000000)) >>> 0;
            PRNGManager.setSeed(seed);
            // ACVE §5.1 — 入口快照点 A
            PRNGManager.recordSnapshot('A');

            const scaleState = this.scaleEngine.getState();
            const melodyEngine = new MelodyEngine();

            // 🌟 关键：用户录制的是绝对 MIDI 音高（如 Bb3=58），
            // 但生成管道在 C-相对空间工作，最后 Orchestrator.applyOffset 会加 keyOffset。
            // 所以必须先减去 keyOffset 转为 C-相对音高，否则会被 double-offset。
            const keyOffset = scaleState.key;
            const cRelativeMotif: NoteData[] = [];
            for (let i = 0; i < motifNotes.length; i++) {
                cRelativeMotif.push({
                    ...motifNotes[i],
                    pitch: motifNotes[i].pitch - keyOffset
                });
            }

            // 🌟 Motif 智能预处理：质量分析 + 清洗 + 变奏扩展
            const { motif: processedMotif, role: motifRole } = preprocessMotif(cRelativeMotif, scaleState.tonality);

            // Style 随机选一个
            const allStyleIds = [StyleId.AcgLightMusic];
            const randomStyleId = allStyleIds[Math.floor(PRNGManager.next() * allStyleIds.length)];

            const rawTrack = melodyEngine.generateFullSong(randomStyleId, {
                processedUserMotif: processedMotif || undefined,
                motifRole,
                userMotifRoot: scaleState.key,
                detectedTonality: scaleState.tonality
            });

            const { StyleRegistry } = await import('../../core/generation/config/StyleRegistry');
            const style = StyleRegistry[randomStyleId] || AcgStyleConfig;

            if (currentGenId !== this.generationId) return;

            this.currentTrack = rawTrack.track;
            this.currentStyle = style;

            await AudioEngine.playSong(rawTrack.track, style.id, rawTrack.context, melodyEngine);

            if (currentGenId !== this.generationId) return;
            this.setState('PLAYING');

            globalMidiScheduler.onTrackEnd(() => {
                if (currentGenId === this.generationId) {
                    this.stopPlayback();
                }
            });
        } catch (error) {
            console.error('[AuraJam] Generation failed:', error);
            if (currentGenId === this.generationId) {
                this.setState('SCALE_VIEW');
            }
        }
    }

    public stopPlayback(): void {
        this.generationId++;
        if (this.jamCheckInterval) {
            clearInterval(this.jamCheckInterval);
            this.jamCheckInterval = null;
        }
        AudioEngine.muteChannel(9, false);
        AudioEngine.muteChannel(0, false);
        AudioEngine.stop();
        this.setState('SCALE_VIEW');
    }

    // ================================================================
    // Jam Mode (adapted from EndlessRadioManager)
    // ================================================================

    public getCurrentChord(): any {
        if (!this.currentTrack || !this.currentTrack.chords) return null;
        const currentTick = AudioEngine.getCurrentTick();
        const ppq = AudioEngine.getPpq();
        const currentBeat = currentTick / ppq;
        for (const chord of this.currentTrack.chords) {
            if (currentBeat >= chord.startBeat && currentBeat < chord.endBeat) {
                return chord;
            }
        }
        return null;
    }

    public prepareJam(type: 'drums' | 'melody') {
        if (this.state !== 'PLAYING' || !this.currentTrack || !this.currentStyle) return;

        this.setState('PREPARING_JAM');

        if (type === 'drums') {
            this.userDrumPattern = [];
            this.jamStartTick = 0;
            this.jamLengthTicks = 0;
            this.originalDrumEvents = AudioEngine.getChannelEvents(9);
        }

        const currentTick = AudioEngine.getCurrentTick();
        const ppq = AudioEngine.getPpq();
        const timeSignature = GlobalContext.currentTimeSignature || [4, 4];
        const ticksPerMeasure = timeSignature[0] * (ppq * 4 / timeSignature[1]);

        const currentMeasure = Math.floor(currentTick / ticksPerMeasure);
        const nextMeasureStartTick = (currentMeasure + 1) * ticksPerMeasure;
        const countInMeasureStartTick = nextMeasureStartTick;
        const jamStartTick = countInMeasureStartTick + ticksPerMeasure;

        this.jamStartTick = jamStartTick;

        AudioEngine.injectMidiEvent({ ticks: currentTick, type: 'controlChange', channel: 9, data1: 7, data2: 127 });

        // Count-in: Crash + Kick + Snare roll
        const beatsPerMeasure = timeSignature[0];
        const ticksPerBeat = ppq * 4 / timeSignature[1];
        const fillEvents: any[] = [];

        for (let i = 0; i < beatsPerMeasure; i++) {
            const tick = countInMeasureStartTick + i * ticksPerBeat;
            fillEvents.push({ ticks: tick, type: 'noteOn', channel: 9, data1: 49, data2: 127 });
            fillEvents.push({ ticks: tick + ppq / 2, type: 'noteOff', channel: 9, data1: 49, data2: 0 });
            fillEvents.push({ ticks: tick, type: 'noteOn', channel: 9, data1: 36, data2: 100 });
            fillEvents.push({ ticks: tick + ppq / 2, type: 'noteOff', channel: 9, data1: 36, data2: 0 });

            if (i === beatsPerMeasure - 1) {
                for (let j = 0; j < 4; j++) {
                    const subTick = tick + j * (ticksPerBeat / 4);
                    fillEvents.push({ ticks: subTick, type: 'noteOn', channel: 9, data1: 38, data2: 100 + j * 8 });
                    fillEvents.push({ ticks: subTick + (ticksPerBeat / 8), type: 'noteOff', channel: 9, data1: 38, data2: 0 });
                }
            }
        }

        AudioEngine.replaceChannelEvents(9, countInMeasureStartTick, fillEvents, jamStartTick);

        if (type === 'drums') {
            const lastSection = this.currentTrack.sections[this.currentTrack.sections.length - 1];
            const totalTicks = lastSection ? lastSection.endBeat * ppq : 0;
            const hihatEvents: any[] = [];

            for (let tick = jamStartTick; tick < totalTicks; tick += ppq / 2) {
                hihatEvents.push({ ticks: tick, type: 'noteOn', channel: 9, data1: 42, data2: 70 });
                hihatEvents.push({ ticks: tick + ppq / 4, type: 'noteOff', channel: 9, data1: 42, data2: 0 });
                hihatEvents.push({
                    ticks: tick, type: 'visual', channel: 9, data1: 42, data2: 70,
                    visualData: { type: 'drums', midiNote: 42, velocity: 70, source: 'system' }
                });
            }

            AudioEngine.replaceChannelEvents(9, jamStartTick, hihatEvents);
        }

        if (this.jamCheckInterval) {
            clearInterval(this.jamCheckInterval);
        }

        this.jamCheckInterval = setInterval(() => {
            if (this.state !== 'PREPARING_JAM' && this.state !== 'JAMMING_DRUMS' && this.state !== 'JAMMING_MELODY') {
                clearInterval(this.jamCheckInterval);
                this.jamCheckInterval = null;
                return;
            }
            const ct = AudioEngine.getCurrentTick();
            if (ct >= jamStartTick && this.state === 'PREPARING_JAM') {
                if (type === 'drums') {
                    this.setState('JAMMING_DRUMS');
                } else {
                    AudioEngine.muteChannel(0, true);
                    this.setState('JAMMING_MELODY');
                }
            }
        }, 50);
    }

    public exitJam() {
        if (this.state === 'JAMMING_DRUMS' || this.state === 'JAMMING_MELODY' || this.state === 'PREPARING_JAM') {
            if (this.jamCheckInterval) {
                clearInterval(this.jamCheckInterval);
                this.jamCheckInterval = null;
            }

            AudioEngine.muteChannel(9, false);
            AudioEngine.muteChannel(0, false);
            AudioEngine.injectMidiEvent({ ticks: AudioEngine.getCurrentTick(), type: 'controlChange', channel: 9, data1: 7, data2: 100 });

            if (this.state === 'PREPARING_JAM' && this.originalDrumEvents) {
                const restore = this.originalDrumEvents.filter((e: any) => e.ticks >= this.jamStartTick);
                AudioEngine.replaceChannelEvents(9, this.jamStartTick, restore);
            }

            if (this.state === 'JAMMING_DRUMS' && this.jamStartTick > 0) {
                try {
                    const currentTick = AudioEngine.getCurrentTick();
                    const ppq = AudioEngine.getPpq();
                    const timeSignature = GlobalContext.currentTimeSignature || [4, 4];
                    const ticksPerMeasure = timeSignature[0] * (ppq * 4 / timeSignature[1]);
                    const elapsedTicks = currentTick - this.jamStartTick;
                    const measures = Math.max(1, Math.round(elapsedTicks / ticksPerMeasure));
                    this.jamLengthTicks = measures * ticksPerMeasure;
                    this.applyUserDrumLoop();
                } catch (e) {
                    console.error('[AuraJam] Error applying user drum loop:', e);
                }
            }

            this.setState('PLAYING');
        }
    }

    public recordUserDrum(note: number, velocity: number) {
        if (this.state !== 'JAMMING_DRUMS' || this.jamStartTick === 0) return;
        const currentTick = AudioEngine.getCurrentTick();
        const ppq = AudioEngine.getPpq();
        const gridSize = ppq / 4;
        const quantizedTick = Math.round(currentTick / gridSize) * gridSize;
        const relativeTick = quantizedTick - this.jamStartTick;
        if (relativeTick >= 0) {
            this.userDrumPattern.push({ note, velocity, tick: relativeTick });
        }
    }

    private applyUserDrumLoop() {
        if (!this.currentTrack || !this.currentStyle) return;

        if (this.userDrumPattern.length === 0) {
            const restore = this.originalDrumEvents.filter((e: any) => e.ticks >= this.jamStartTick);
            AudioEngine.replaceChannelEvents(9, this.jamStartTick, restore);
            return;
        }

        const validPattern = this.userDrumPattern.filter(hit => hit.tick < this.jamLengthTicks);
        if (validPattern.length === 0) {
            const restore = this.originalDrumEvents.filter((e: any) => e.ticks >= this.jamStartTick);
            AudioEngine.replaceChannelEvents(9, this.jamStartTick, restore);
            return;
        }

        const ppq = AudioEngine.getPpq();
        const lastSection = this.currentTrack.sections[this.currentTrack.sections.length - 1];
        const totalTicks = lastSection ? lastSection.endBeat * ppq : 0;
        const loopStartTick = this.jamStartTick;
        const newDrumEvents: any[] = [];

        for (let tick = loopStartTick; tick < totalTicks; tick += this.jamLengthTicks) {
            // Crash at chorus starts
            for (const s of this.currentTrack.sections) {
                const isChorus = s.energyLevel >= 8 || s.name.toLowerCase().includes('chorus');
                if (isChorus) {
                    const sTick = s.startBeat * ppq;
                    if (sTick >= tick && sTick < tick + this.jamLengthTicks) {
                        newDrumEvents.push({ ticks: sTick, type: 'noteOn', channel: 9, data1: 49, data2: 120 });
                        newDrumEvents.push({ ticks: sTick + ppq / 2, type: 'noteOff', channel: 9, data1: 49, data2: 0 });
                        newDrumEvents.push({
                            ticks: sTick, type: 'visual', channel: 9, data1: 49, data2: 120,
                            visualData: { type: 'drums', midiNote: 49, velocity: 120, source: 'system' }
                        });
                    }
                }
            }

            for (const hit of validPattern) {
                const hitTick = tick + hit.tick;
                if (hitTick >= totalTicks) continue;

                const hitBeat = hitTick / ppq;
                const hitSection = this.currentTrack.sections.find(s => hitBeat >= s.startBeat && hitBeat < s.endBeat) || this.currentTrack.sections[0];
                const hitIsBreakdown = hitSection.energyLevel < 5;
                const hitIsChorus = hitSection.energyLevel >= 8 || hitSection.name.toLowerCase().includes('chorus');
                const hitIsBuild = hitSection.name.toLowerCase().includes('build');

                let note = hit.note;
                let velocity = hit.velocity;

                if (hitIsBreakdown) {
                    if (note === 36) velocity = Math.floor(velocity * 0.6);
                    if (note === 38) { note = 37; velocity = Math.floor(velocity * 0.7); }
                } else if (hitIsBuild) {
                    velocity = Math.min(127, velocity + 20);
                } else if (hitIsChorus) {
                    velocity = Math.min(127, velocity + 10);
                }

                newDrumEvents.push({ ticks: hitTick, type: 'noteOn', channel: 9, data1: note, data2: velocity });
                newDrumEvents.push({ ticks: hitTick + ppq / 4, type: 'noteOff', channel: 9, data1: note, data2: 0 });
                newDrumEvents.push({
                    ticks: hitTick, type: 'visual', channel: 9, data1: note, data2: velocity,
                    visualData: { type: 'drums', midiNote: note, velocity, source: 'system' }
                });
            }

            // Build-up snare roll
            const currentBeat = tick / ppq;
            const section = this.currentTrack.sections.find(s => currentBeat >= s.startBeat && currentBeat < s.endBeat);
            if (section && section.name.toLowerCase().includes('build')) {
                const lastBeatTick = tick + this.jamLengthTicks - ppq;
                for (let i = 0; i < 4; i++) {
                    const rollTick = lastBeatTick + (i * ppq / 4);
                    if (rollTick < totalTicks) {
                        const rollVel = 80 + i * 10;
                        newDrumEvents.push({ ticks: rollTick, type: 'noteOn', channel: 9, data1: 38, data2: rollVel });
                        newDrumEvents.push({ ticks: rollTick + ppq / 8, type: 'noteOff', channel: 9, data1: 38, data2: 0 });
                        newDrumEvents.push({
                            ticks: rollTick, type: 'visual', channel: 9, data1: 38, data2: rollVel,
                            visualData: { type: 'drums', midiNote: 38, velocity: rollVel, source: 'system' }
                        });
                    }
                }
            }
        }

        AudioEngine.replaceChannelEvents(9, this.jamStartTick, newDrumEvents);
    }
}
```

### `src/apps/AuraJam/index.tsx`

```tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AudioEngine, getAudioContext } from '../../core/audio/AudioEngine';
import { JamSessionManager, JamAppState } from './JamSessionManager';
import { ScaleEngine, ScaleState } from './ScaleEngine';

// --- Drum Map (same as AuraBar) ---
const DRUM_MAP: Record<string, number> = {
    '0-2': 38, '1-2': 38, '2-2': 42, '3-2': 36, '4-2': 36,
    '0-1': 41, '1-1': 45, '2-1': 48, '3-1': 46, '4-1': 49,
    '0-0': 39, '1-0': 37, '2-0': 54, '3-0': 56,
};

// --- Jam Melody Notes (from AuraBar) ---
function getJamMelodyNotes(chord: any, tonality: any, keyOffset: number): number[] {
    let scalePcs = [0, 2, 4, 7, 9];
    let rootPc = 0;

    if (chord) {
        const chordKeyOffset = chord.keyOffset !== undefined ? chord.keyOffset : keyOffset;
        rootPc = ((chord.root + chordKeyOffset) % 12 + 12) % 12;
        const q = chord.quality as string;
        if (q === 'Minor' || q === 'Diminished' || q === 'Minor7' || q === 'HalfDiminished' || q === 'Diminished7' || q === 'Minor9' || q === 'Minor11') {
            scalePcs = [0, 3, 5, 7, 10].map(i => (rootPc + i) % 12);
        } else {
            scalePcs = [0, 2, 4, 7, 9].map(i => (rootPc + i) % 12);
        }
    } else {
        rootPc = (keyOffset % 12 + 12) % 12;
        scalePcs = [0, 2, 4, 7, 9].map(i => (rootPc + i) % 12);
    }

    scalePcs.sort((a, b) => a - b);
    let rootIdx = scalePcs.indexOf(rootPc);
    if (rootIdx === -1) rootIdx = 0;

    const notes: number[] = [];
    let currentOctave = 5;
    let currentIdx = rootIdx;
    let baseNote = rootPc + 12 * currentOctave;
    if (baseNote < 55) baseNote += 12;
    if (baseNote > 67) baseNote -= 12;
    currentOctave = Math.floor(baseNote / 12);

    for (let i = 0; i < 14; i++) {
        notes.push(scalePcs[currentIdx] + 12 * currentOctave);
        currentIdx++;
        if (currentIdx >= scalePcs.length) { currentIdx = 0; currentOctave++; }
    }
    return notes;
}

interface AuraJamProps {
    activeKeys: Set<string>;
    onExit?: () => void;
}

export function AuraJam({ activeKeys, onExit }: AuraJamProps) {
    const managerRef = useRef<JamSessionManager | null>(null);
    const [appState, setAppState] = useState<JamAppState>('SCALE_VIEW');
    const [scaleState, setScaleState] = useState<ScaleState | null>(null);
    const [recordingInfo, setRecordingInfo] = useState({ eventCount: 0, elapsedMs: 0 });

    const prevActiveKeysRef = useRef<Set<string>>(new Set());
    const fnTapCount = useRef(0);
    const fnTapTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Arp state (same as AuraBar)
    const arpStateRef = useRef({
        heldIndices: new Map<string, number>(),
        centerIdx: 0,
        step: 0,
        patternIdx: 0,
        intervalId: null as ReturnType<typeof setInterval> | null,
        lastPlayedNote: -1
    });

    // Initialize
    useEffect(() => {
        const mgr = new JamSessionManager();
        mgr.onStateChange(setAppState);
        managerRef.current = mgr;
        setScaleState(mgr.getScaleState());
        return () => {
            mgr.stopPlayback();
            if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        };
    }, []);

    // Recording timer update
    useEffect(() => {
        if (appState === 'RECORDING') {
            recordingTimerRef.current = setInterval(() => {
                if (managerRef.current) {
                    setRecordingInfo(managerRef.current.getRecordingInfo());
                }
            }, 100);
        } else {
            if (recordingTimerRef.current) {
                clearInterval(recordingTimerRef.current);
                recordingTimerRef.current = null;
            }
        }
    }, [appState]);

    // --- Input Handling ---
    useEffect(() => {
        const current = activeKeys;
        const prev = prevActiveKeysRef.current;
        const added = Array.from<string>(current).filter(k => !prev.has(k));
        const removed = Array.from<string>(prev).filter(k => !current.has(k));

        // --- Key Up ---
        removed.forEach(keyId => {
            const parts = keyId.split('-');
            if (parts.length !== 3) return;
            const c = parseInt(parts[1]);
            const r = parseInt(parts[2]);

            // Cancel long press
            if (current.has('key-4-0') || prev.has('key-4-0')) {
                if ((c === 0 && r === 0) || (c === 1 && r === 0) || (c === 4 && r === 0)) {
                    if (longPressTimeout.current) {
                        clearTimeout(longPressTimeout.current);
                        longPressTimeout.current = null;
                    }
                }
            }

            // Recording noteOff
            if (appState === 'RECORDING') {
                const idx = ScaleEngine.padIndex(c, r);
                if (idx >= 0 && scaleState) {
                    const note = scaleState.noteMap[idx];
                    AudioEngine.noteOff(0, note);
                    managerRef.current?.recordNoteOff(idx);
                }
            }

            // Jam melody noteOff
            if (appState === 'JAMMING_MELODY') {
                arpStateRef.current.heldIndices.delete(keyId);
                if (arpStateRef.current.heldIndices.size === 0) {
                    if (arpStateRef.current.intervalId) {
                        clearInterval(arpStateRef.current.intervalId);
                        arpStateRef.current.intervalId = null;
                    }
                    if (arpStateRef.current.lastPlayedNote !== -1) {
                        AudioEngine.noteOff(0, arpStateRef.current.lastPlayedNote);
                        arpStateRef.current.lastPlayedNote = -1;
                    }
                } else {
                    const lastKey = Array.from(arpStateRef.current.heldIndices.keys()).pop();
                    if (lastKey) {
                        arpStateRef.current.centerIdx = arpStateRef.current.heldIndices.get(lastKey)!;
                    }
                }
            }
        });

        // --- Key Down ---
        added.forEach(keyId => {
            const parts = keyId.split('-');
            if (parts.length !== 3) return;
            const c = parseInt(parts[1]);
            const r = parseInt(parts[2]);

            const ctx = getAudioContext();
            if (ctx.state !== 'running') ctx.resume();

            const isFnPressed = current.has('key-4-0');
            const isJamming = appState === 'JAMMING_DRUMS' || appState === 'JAMMING_MELODY' || appState === 'PREPARING_JAM';

            // --- FN Key ---
            if (c === 4 && r === 0) {
                if (isJamming) {
                    managerRef.current?.exitJam();
                    return;
                }

                fnTapCount.current++;
                if (fnTapTimeout.current) clearTimeout(fnTapTimeout.current);
                fnTapTimeout.current = setTimeout(() => {
                    const count = fnTapCount.current;
                    fnTapCount.current = 0;

                    if (count === 1) {
                        if (appState === 'SCALE_VIEW') {
                            const newScale = managerRef.current?.refreshScale();
                            if (newScale) setScaleState(newScale);
                        }
                    } else if (count === 2) {
                        if (appState === 'SCALE_VIEW') {
                            managerRef.current?.startRecording();
                        } else if (appState === 'RECORDING') {
                            managerRef.current?.stopRecordingAndGenerate();
                        }
                    } else if (count >= 3) {
                        if (appState === 'RECORDING') {
                            managerRef.current?.cancelRecording();
                        } else if (appState === 'PLAYING') {
                            managerRef.current?.stopPlayback();
                        } else if (appState === 'SCALE_VIEW') {
                            onExit?.();
                        }
                    }
                }, 300);
                return;
            }

            // --- FN + combo for Jam ---
            if (isFnPressed) {
                if (c === 0 && r === 0 && appState === 'PLAYING') {
                    if (longPressTimeout.current) clearTimeout(longPressTimeout.current);
                    longPressTimeout.current = setTimeout(() => managerRef.current?.prepareJam('drums'), 500);
                } else if (c === 1 && r === 0 && appState === 'PLAYING') {
                    if (longPressTimeout.current) clearTimeout(longPressTimeout.current);
                    longPressTimeout.current = setTimeout(() => managerRef.current?.prepareJam('melody'), 500);
                }
                return;
            }

            // --- SCALE_VIEW: audition notes ---
            if (appState === 'SCALE_VIEW' && scaleState) {
                const idx = ScaleEngine.padIndex(c, r);
                if (idx >= 0) {
                    const note = scaleState.noteMap[idx];
                    AudioEngine.playNote(0, note, 100, 300);
                }
                return;
            }

            // --- RECORDING: play + record ---
            if (appState === 'RECORDING' && scaleState) {
                const idx = ScaleEngine.padIndex(c, r);
                if (idx >= 0) {
                    const note = scaleState.noteMap[idx];
                    AudioEngine.noteOn(0, note, 100);
                    managerRef.current?.recordNoteOn(idx, note, 100);
                }
                return;
            }

            // --- JAMMING_DRUMS ---
            if (appState === 'JAMMING_DRUMS') {
                const note = DRUM_MAP[`${c}-${r}`];
                if (note) {
                    AudioEngine.playNote(9, note, 127, 100);
                    AudioEngine.emitVisualEvent({ type: 'drums', midiNote: note, velocity: 127, source: 'gameplay' });
                    managerRef.current?.recordUserDrum(note, 127);
                }
                return;
            }

            // --- JAMMING_MELODY ---
            if (appState === 'JAMMING_MELODY') {
                const track = managerRef.current?.currentTrack;
                if (track) {
                    let idx = -1;
                    if (r === 2) idx = c;
                    else if (r === 1) idx = 5 + c;
                    else if (r === 0 && c < 4) idx = 10 + c;

                    if (idx !== -1) {
                        arpStateRef.current.heldIndices.set(keyId, idx);
                        arpStateRef.current.centerIdx = idx;

                        const chord = managerRef.current?.getCurrentChord();
                        const notes = getJamMelodyNotes(chord, track.tonality, track.keyOffset);
                        const note = notes[idx];

                        if (arpStateRef.current.lastPlayedNote !== -1) {
                            AudioEngine.noteOff(0, arpStateRef.current.lastPlayedNote);
                        }
                        if (note) {
                            AudioEngine.noteOn(0, note, 100);
                            AudioEngine.emitVisualEvent({ type: 'melody', midiNote: note, velocity: 100, source: 'gameplay' });
                            arpStateRef.current.lastPlayedNote = note;
                            arpStateRef.current.step = 1;
                        }

                        if (!arpStateRef.current.intervalId) {
                            arpStateRef.current.intervalId = setInterval(() => {
                                const state = arpStateRef.current;
                                if (state.heldIndices.size === 0) return;
                                const t = managerRef.current?.currentTrack;
                                if (!t) return;
                                const ch = managerRef.current?.getCurrentChord();
                                const ns = getJamMelodyNotes(ch, t.tonality, t.keyOffset);
                                const patterns = [
                                    [0, 1, 2, 3, 2, 1, 0, -1, -2, -1],
                                    [0, 2, 1, 3, 2, 0, -1, -2, -1, 1],
                                    [0, -1, -2, -3, -2, -1, 0, 1, 2, 1],
                                    [0, 1, 0, 2, 0, -1, 0, -2]
                                ];
                                if (state.step % 8 === 0) {
                                    state.patternIdx = Math.floor(Math.random() * patterns.length);
                                }
                                const activePattern = patterns[state.patternIdx || 0];
                                const offset = activePattern[state.step % activePattern.length];
                                let targetIdx = Math.max(0, Math.min(13, state.centerIdx + offset));
                                const arpNote = ns[targetIdx];
                                if (state.lastPlayedNote !== -1) AudioEngine.noteOff(0, state.lastPlayedNote);
                                if (arpNote) {
                                    const vel = 80 + Math.floor(Math.random() * 30);
                                    AudioEngine.noteOn(0, arpNote, vel);
                                    AudioEngine.emitVisualEvent({ type: 'melody', midiNote: arpNote, velocity: vel, source: 'gameplay' });
                                    state.lastPlayedNote = arpNote;
                                }
                                state.step++;
                            }, 180);
                        }
                    }
                }
                return;
            }

            if (appState === 'PREPARING_JAM') return;
        });

        prevActiveKeysRef.current = new Set(current);
    }, [activeKeys, appState, scaleState, onExit]);

    // --- Render ---
    const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

    return (
        <div className="w-full h-full relative overflow-hidden bg-[#0A0A0A] text-white font-mono">
            {/* Scanlines */}
            <div className="absolute inset-0 pointer-events-none opacity-10"
                style={{ backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)' }} />

            {/* Header */}
            <div className="absolute top-2 left-3 right-3 flex items-center justify-between">
                <div className="text-[10px] text-amber-400/80 tracking-widest uppercase">
                    Aura Jam
                </div>
                <div className="text-[9px] text-white/40">
                    {appState === 'SCALE_VIEW' && 'FN:Refresh  2×FN:Record  3×FN:Exit'}
                    {appState === 'RECORDING' && '2×FN:Generate  3×FN:Cancel'}
                    {appState === 'GENERATING' && 'Generating...'}
                    {appState === 'PLAYING' && 'FN+Q:Drums  FN+W:Melody  3×FN:Stop'}
                    {(appState === 'JAMMING_DRUMS' || appState === 'JAMMING_MELODY') && 'FN:Exit Jam'}
                    {appState === 'PREPARING_JAM' && 'Count-in...'}
                </div>
            </div>

            {/* Scale Info (SCALE_VIEW / RECORDING) */}
            {(appState === 'SCALE_VIEW' || appState === 'RECORDING') && scaleState && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
                    <div className="text-3xl font-bold text-amber-300" style={{ textShadow: '0 0 20px rgba(245,158,11,0.5)' }}>
                        {scaleState.keyName}
                    </div>
                    <div className="text-sm text-amber-200/60 mt-1">
                        {scaleState.tonalityName.replace(/_/g, ' ')}
                    </div>
                    {scaleState.noteMap.length > 0 && (
                        <div className="text-[9px] text-white/30 mt-2 tracking-wider">
                            {scaleState.noteMap.map(n => NOTE_NAMES[n % 12]).join(' ')}
                        </div>
                    )}
                </div>
            )}

            {/* Recording Indicator */}
            {appState === 'RECORDING' && (
                <div className="absolute inset-0 pointer-events-none border-2 border-red-500/60 animate-pulse rounded" />
            )}
            {appState === 'RECORDING' && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-center">
                    <div className="text-red-400 text-xs animate-pulse">
                        REC {Math.floor(recordingInfo.elapsedMs / 1000)}s
                        <span className="text-white/50 ml-2">{recordingInfo.eventCount} notes</span>
                    </div>
                </div>
            )}

            {/* Generating Overlay */}
            {appState === 'GENERATING' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                    <div className="text-center">
                        <div className="text-amber-400 text-lg animate-pulse">Generating</div>
                        <div className="text-white/40 text-xs mt-1">Building your song from motif...</div>
                    </div>
                </div>
            )}

            {/* Playing State */}
            {appState === 'PLAYING' && managerRef.current?.currentTrack && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
                    <div className="text-2xl font-bold text-green-400" style={{ textShadow: '0 0 20px rgba(34,197,94,0.4)' }}>
                        Playing
                    </div>
                    <div className="text-xs text-white/50 mt-1">
                        {managerRef.current.currentTrack.key} | {managerRef.current.currentTrack.bpm} BPM
                    </div>
                </div>
            )}

            {/* Jam Mode Indicator */}
            {appState === 'PREPARING_JAM' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <div className="text-yellow-400 text-xl animate-bounce">Count-in...</div>
                </div>
            )}
            {appState === 'JAMMING_DRUMS' && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
                    <div className="text-2xl font-bold text-orange-400" style={{ textShadow: '0 0 20px rgba(251,146,60,0.5)' }}>
                        DRUM JAM
                    </div>
                </div>
            )}
            {appState === 'JAMMING_MELODY' && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
                    <div className="text-2xl font-bold text-cyan-400" style={{ textShadow: '0 0 20px rgba(34,211,238,0.5)' }}>
                        MELODY JAM
                    </div>
                </div>
            )}
        </div>
    );
}
```

### `src/apps/AuraRadio/EndlessRadioManager.ts`

> Radio 状态机（精简版，无 Jam）。直接走 dynamic import('../../core/generation/pipeline').runPipeline()。

```ts
import { AudioEngine } from '../../core/audio/AudioEngine';
import { MelodyEngine } from '../../core/generation/MelodyEngine';
import { StyleId } from '../../core/generation/config/StyleFlags';
import { AcgStyleConfig } from '../../core/generation/config/StyleRegistry';
import { GeneratedTrack, StyleConfig, MusicContext } from '../../core/generation/types';
import { PRNGManager } from '../../core/utils/PRNG';
import { globalMidiScheduler } from '../../core/audio/MidiScheduler';
import { buildComparisonLog } from '../../core/generation/utils/SongComparisonLogger';

const COMPARISON_LOG_KEY = 'AF_COMPARISON_LOG';
const COMPARISON_SEED_KEY = 'AF_COMPARISON_SEED';
const COMPARISON_GOLDEN_SEED = 12345;

function isComparisonLogEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(COMPARISON_LOG_KEY) === '1';
  } catch {
    return false;
  }
}

function getComparisonSeed(): number {
  try {
    const stored = localStorage.getItem(COMPARISON_SEED_KEY);
    if (stored) {
      const n = parseInt(stored, 10);
      if (Number.isFinite(n)) return n >>> 0;
    }
  } catch {}
  return COMPARISON_GOLDEN_SEED;
}

export type AppState = 'IDLE' | 'GENERATING' | 'PLAYING';

export class EndlessRadioManager {
  private state: AppState = 'IDLE';
  private history: { track: GeneratedTrack, context: MusicContext, style: StyleConfig }[] = [];
  private historyIndex: number = -1;
  private generationId: number = 0;
  
  private stateChangeCallback?: (state: AppState) => void;
  public onStyleChange?: (styleName: string) => void;

  private allowedStyleIds: StyleId[] = [];

  constructor(allowedStyleIds?: StyleId[]) {
    if (allowedStyleIds && allowedStyleIds.length > 0) {
      this.allowedStyleIds = allowedStyleIds;
    }
  }

  public setAllowedStyles(styleIds: StyleId[]) {
    this.allowedStyleIds = styleIds;
  }

  public onStateChange(callback: (state: AppState) => void) {
    this.stateChangeCallback = callback;
  }

  private setState(newState: AppState) {
    this.state = newState;
    if (this.stateChangeCallback) {
      this.stateChangeCallback(this.state);
    }
  }

  public getState(): AppState {
    return this.state;
  }

  public start = () => {
    if (this.state === 'IDLE') {
      this.triggerGeneration();
    } else if (this.state === 'PLAYING') {
      // Already playing, maybe resume if paused?
      // Currently AudioEngine.playSong handles it.
    }
  }

  public stopPlayback = () => {
    this.generationId += 1;
    AudioEngine.stop();
    this.setState('IDLE');
  }

  public stop = () => {
    this.stopPlayback();
  }

  private async playTrack(track: GeneratedTrack, context: MusicContext, style: StyleConfig, genId: number) {
    const melodyEngine = new MelodyEngine();
    
    if (this.onStyleChange) {
      this.onStyleChange(style.name);
    }

    await AudioEngine.playSong(track, style.id, context, melodyEngine);
    
    if (genId !== this.generationId) return;
    
    this.setState('PLAYING');

    // Schedule next song using MidiScheduler's onTrackEnd
    globalMidiScheduler.onTrackEnd(() => {
      if (genId === this.generationId) {
        this.playNext();
      }
    });
  }

  public triggerGeneration = async () => {
    const currentGenId = ++this.generationId;
    
    AudioEngine.stop();
    this.setState('GENERATING');

    try {
      // Simulate slight delay for UI to catch up
      await new Promise(resolve => setTimeout(resolve, 100));
      if (currentGenId !== this.generationId) return;

      // §1.4 step 0: 每次生成前重新播种
      const comparisonMode = isComparisonLogEnabled();
      const seed = comparisonMode
        ? getComparisonSeed()
        : (Date.now() ^ Math.floor(Math.random() * 1000000)) >>> 0;
      PRNGManager.setSeed(seed);
      // ACVE §5.1 — 入口快照点 A（setSeed 之后、step 1 PRNG 消耗之前）
      PRNGManager.recordSnapshot('A');
      console.log(`[Radio] New seed: ${seed}${comparisonMode ? ' (comparison-log mode)' : ''}`);

      // 🌟 新管道：Stage 1 在内部抽风格+情绪，EndlessRadioManager 只传 allowedStyleIds 约束
      const { runPipeline } = await import('../../core/generation/pipeline');
      const allStyleIds: StyleId[] = [StyleId.AcgLightMusic];
      const pool = (this.allowedStyleIds && this.allowedStyleIds.length > 0) ? this.allowedStyleIds : allStyleIds;
      const rawTrack = runPipeline({ allowedStyleIds: pool });

      const selectedStyleId = rawTrack.context.style?.id ?? StyleId.AcgLightMusic;
      const { StyleRegistry } = await import('../../core/generation/config/StyleRegistry');
      const randomStyle = StyleRegistry[selectedStyleId] || AcgStyleConfig;

      if (comparisonMode) {
        console.log(buildComparisonLog({
          seed,
          styleName: randomStyle.name,
          track: rawTrack.track,
        }));
      }
      
      if (currentGenId !== this.generationId) return;

      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push({ track: rawTrack.track, context: rawTrack.context, style: randomStyle });
      this.historyIndex++;

      await this.playTrack(rawTrack.track, rawTrack.context, randomStyle, currentGenId);

    } catch (error) {
      console.error("Generation failed:", error);
      if (currentGenId === this.generationId) {
        this.setState('IDLE');
      }
    }
  }

  public playNext = async () => {
    if (this.historyIndex < this.history.length - 1) {
      const currentGenId = ++this.generationId;
      AudioEngine.stop();
      this.setState('GENERATING');
      
      this.historyIndex++;
      const { track, context, style } = this.history[this.historyIndex];
      
      await this.playTrack(track, context, style, currentGenId);
    } else {
      this.triggerGeneration();
    }
  }

  public playPrevious = async () => {
    if (this.historyIndex > 0) {
      const currentGenId = ++this.generationId;
      AudioEngine.stop();
      this.setState('GENERATING'); 
      
      this.historyIndex--;
      const { track, context, style } = this.history[this.historyIndex];
      
      await this.playTrack(track, context, style, currentGenId);
    }
  }
}
```

### `src/apps/AuraRadio/index.tsx`

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { AudioEngine } from '../../core/audio/AudioEngine';
import { getAudioContext } from '../../core/audio/SynthManager';
import { systemAudio } from '../../system/SystemAudio'; 
import { EndlessRadioManager, AppState } from './EndlessRadioManager';

interface AuraRadioProps {
  activeKeys: Set<string>;
  onExit?: () => void;
}

export function AuraRadio({ activeKeys, onExit }: AuraRadioProps) {
  const managerRef = useRef<EndlessRadioManager | null>(null);
  const [appState, setAppState] = useState<AppState>('IDLE');

  const tapTimeout = useRef<NodeJS.Timeout | null>(null);
  const tapCount = useRef(0);
  const activeKeysRef = useRef<Set<string>>(activeKeys);
  const prevActiveKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const manager = new EndlessRadioManager();
    manager.onStateChange((newState) => {
      setAppState(newState);
    });
    managerRef.current = manager;

    return () => {
      manager.stopPlayback();
    };
  }, []);

  useEffect(() => {
    activeKeysRef.current = activeKeys;
  }, [activeKeys]);

  // 组件卸载时停止音乐
  useEffect(() => {
    return () => {
      if (managerRef.current) {
        managerRef.current.stopPlayback();
      }
      if (tapTimeout.current) clearTimeout(tapTimeout.current);
    };
  }, []);

  // 监听按键输入
  useEffect(() => {
    const current = activeKeys;
    const prev = prevActiveKeysRef.current;

    const added = Array.from<string>(current).filter(k => !prev.has(k));

    added.forEach(keyId => {
      const parts = keyId.split('-');
      if (parts.length === 3) {
        const ctx = getAudioContext();
        if (ctx.state !== 'running') {
          ctx.resume();
        }

        tapCount.current += 1;
        if (tapTimeout.current) clearTimeout(tapTimeout.current);
        
        tapTimeout.current = setTimeout(() => {
          const count = tapCount.current;
          tapCount.current = 0;

          systemAudio.triggerKick(0, 1);
          AudioEngine.emitVisualEvent({ type: 'confirm', midiNote: 60, velocity: 127 });

          if (appState === 'IDLE') {
            if (count === 2) {
              managerRef.current?.triggerGeneration();
            }
          } else if (appState === 'PLAYING' || appState === 'GENERATING') {
            if (count === 1) {
              managerRef.current?.playNext();
            } else if (count === 2) {
              managerRef.current?.playPrevious();
            } else if (count >= 3) {
              managerRef.current?.stopPlayback();
            }
          }
        }, 300);
      }
    });

    prevActiveKeysRef.current = new Set(current);
  }, [activeKeys, appState]);

  return (
    <div className="w-full h-full flex items-center justify-center relative overflow-hidden bg-black text-white select-none">
      {/* Scanlines Effect */}
      <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.25)_50%)] bg-[length:100%_4px] z-50" />

      {appState === 'IDLE' && (
        <div className="text-[8cqh] text-cyan-400 drop-shadow-[0_0_1cqw_rgba(34,211,238,0.8)] animate-pulse z-10">
          DOUBLE TAP TO START RADIO
        </div>
      )}

      {appState === 'GENERATING' && (
        <div className="text-[10cqh] text-yellow-400 drop-shadow-[0_0_2cqw_rgba(250,204,21,0.8)] animate-pulse z-10">
          COMPOSING DNA...
        </div>
      )}

      {appState === 'PLAYING' && (
        <div className="w-full h-full flex flex-row items-center justify-center relative z-10 gap-[6cqw]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.2)_0%,rgba(0,0,0,0.8)_100%)] pointer-events-none" />
          
          <style>
            {`
              @keyframes steamUp {
                0% { transform: translateY(0px) scale(1); opacity: 0.8; }
                50% { transform: translateY(-4px) scale(1.1); opacity: 0.4; }
                100% { transform: translateY(-8px) scale(1.2); opacity: 0; }
              }
              .steam-1 { animation: steamUp 2s infinite linear; }
              .steam-2 { animation: steamUp 2s infinite linear 1s; }
              .steam-3 { animation: steamUp 2s infinite linear 0.5s; }
            `}
          </style>

          {/* Pixel Art Coffee Cup */}
          <svg viewBox="0 0 24 24" className="w-[20cqh] h-[20cqh] text-emerald-400 drop-shadow-[0_0_1cqw_rgba(52,211,153,0.8)] z-10" fill="currentColor" style={{ shapeRendering: 'crispEdges' }}>
            {/* Cup Body */}
            <rect x="6" y="10" width="10" height="8" />
            <rect x="7" y="18" width="8" height="1" />
            <rect x="8" y="19" width="6" height="1" />
            {/* Handle */}
            <rect x="16" y="11" width="2" height="1" />
            <rect x="17" y="12" width="1" height="4" />
            <rect x="16" y="16" width="2" height="1" />
            
            {/* Steam 1 */}
            <g className="steam-1">
              <rect x="8" y="6" width="2" height="2" opacity="0.8" />
              <rect x="7" y="4" width="2" height="2" opacity="0.5" />
            </g>
            {/* Steam 2 */}
            <g className="steam-2">
              <rect x="12" y="7" width="2" height="2" opacity="0.8" />
              <rect x="13" y="5" width="2" height="2" opacity="0.5" />
            </g>
            {/* Steam 3 */}
            <g className="steam-3">
              <rect x="10" y="4" width="2" height="2" opacity="0.6" />
              <rect x="9" y="2" width="2" height="2" opacity="0.3" />
            </g>
          </svg>

          {/* Text */}
          <div className="text-[10cqh] text-emerald-400 drop-shadow-[0_0_2cqw_rgba(52,211,153,0.8)] font-mono tracking-widest z-10 animate-pulse" style={{ animationDuration: '3s' }}>
            NOW ENJOY
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## 第八部分：Generation 引擎（Phase 4 实现）


### `src/core/generation/types.ts`

> ✅ 类型契约 — 战役二补完：`GeneratedChord.bassOverride?: number`（0~11 相对 pc，承载 Slash Chords 的指定低音）；`CompingIdiom.textureType?: 'block' \| 'arpeggio' \| 'mixed'`。战役三补完：`CompingIdiom.arpeggioPatterns?: (number \| null)[][]`（带休止符 null 的琶音音型轨迹）+ `textureProbabilities?: { block, arpeggio, comping }`（织体倾向概率分布）。

```ts
export type ChordProgression = string[];

/**
 * C++ Porting Guide:
 * This interface maps directly to a C struct to avoid heap fragmentation:
 * struct NoteData {
 *   uint8_t pitch;       // 0-127
 *   uint8_t velocity;    // 0-127 (mapped from 0.0-1.0 float if needed)
 *   float onset;         // Beat position
 *   float duration;      // Beat length
 *   // Optional flags can be packed into a bitfield (uint8_t flags)
 * };
 */
import { MoodId } from './config/MoodFlags';
import { StyleId } from './config/StyleFlags';

export interface NoteData { pitch: number; onset: number; duration: number; velocity: number; isGraceNote?: boolean; pitchBend?: number; pitchBendDuration?: number; fadeOutDuration?: number; isUserMotif?: boolean; }
export interface GeneratedChord { numeral: string; root: number; quality: 'Major' | 'Minor' | 'Diminished' | 'Diminished7' | 'Augmented' | 'Dominant7' | 'Minor7' | 'Major7' | 'HalfDiminished' | 'Sus4' | 'Dominant7Sus4' | 'Add9' | 'Minor9' | 'Major9' | 'Dominant9' | 'Minor11' | 'Dominant13'; startBeat: number; endBeat: number; keyOffset?: number; extensions?: string[]; isSignatureEnding?: boolean; bassOverride?: number; }

// --- Phase 1 & 2: Decoupled Foundation & Macro Brain ---
export interface RhythmCell {
    durations: number[]; // e.g., [0.5, 0.5] for two 8th notes
    weight: number;      // Probability weight
    tags: string[];      // e.g., 'syncopated', 'straight', 'triplet'
}

export interface GrooveBankDef {
    name: string;               // 律动库名称（仅用于调试）
    cells: RhythmCell[];        // 节奏单元池
    syncopationWeight: number;  // 该律动库的特征切分率（影响全曲切分倾向）
}

export interface HarmonyState {
    baseProgression: string[];
    complexityProb: number;
    harmonicRhythm: number;
}

export interface GrooveState {
    density: number;
    syncopationProb: number;
    swing: number;
    feel?: "half-time" | "normal" | "double-time";
}

export interface TrackBehavior {
    [key: string]: number | boolean | string;
}

export interface TrackState {
    id: string;
    instrument: string;
    role: string;
    activeEnergyThreshold: number;
    behavior: TrackBehavior;
}

export interface SectionState {
    id: string;
    type: string;
    lengthBars: number;
    phraseTemplate: string; // Deprecated, use phraseActions instead
    phraseActions?: PhraseAction[]; // e.g., [Repeat, Vary, Contrast]
    energyLevel: number;
    harmony: HarmonyState;
    groove: GrooveState;
    tracks: TrackState[];
    startBeat: number;
    endBeat: number;
}

export enum PhraseAction {
    Repeat = 0,
    Vary = 1,
    Contrast = 2
}

export interface MotifTemplate {
    pickupType: number; // 0: none, 1: 8th note, 2: quarter note
    bodyDensity: number; // 0.0 to 1.0
    tailLength: number; // in beats, e.g., 1.0, 2.0
    rhythmOffsets: number[]; // the actual generated rhythm
    contour: 'Ascending' | 'Descending' | 'Arch' | 'Bowl' | 'Static' | 'Wandering';
    noteCount: number;
    phraseLengthBeats: number;
}

export interface MacroStructure {
    structure: string[]; 
    energyCurve: number[]; 
}
// -------------------------------------------------------

export interface DSPNodeConfig {
    type: BiquadFilterType; // 'highpass', 'lowpass', 'peaking', 'highshelf'
    frequency: number;
    Q: number;
    gain?: number;
}

export interface MasteringProfile {
    id: string;
    nodes: DSPNodeConfig[];
    masterCompressor: { threshold: number, ratio: number, attack: number, release: number };
    makeupGain: number;
}

export interface InstrumentBehavior {
    pitchRange: [number, number]; // e.g., [60, 84] (C4 to C6)
    velocityRange: [number, number]; // e.g., [90, 115] (明亮) vs [40, 70] (暗淡)
}

// 🌟 段落模板：单个段落的纯数据描述
export interface SectionTemplate {
    name: string;       // 段落显示名 (e.g., "Verse_1", "Chorus_Main")
    bars: number;       // 小节数
    energy: number;     // 原始能量值 1-10（会被 mood.energyCap 进一步约束）
}

// ============================================================
// 🌟 层级动机系统（Hierarchical Motif System）
// ============================================================
//
// 三层结构：
//   PhraseGroup（大乐句容器，4/8/16 小节）
//     └── SubMotifSlot（子动机槽，1-2 小节，可重复/变奏）
//           └── NoteData（音符）
//
// 这取代了原本"phrase = motif = 2 小节"的扁平模型，让旋律有"完整句子"的容器感。

/**
 * 句式终止类型 — 决定 PhraseGroup 末尾应该是问句还是答句
 */
export enum CadenceType {
    Open = 0,    // 半终止：落在 V/2/7 度（导音、属音、上主音），听感"未完成"
    Closed = 1,  // 全终止：落在 I/3 度（主音、中音），听感"完成"
}

/**
 * SubMotif 在 PhraseGroup 内的角色，决定它与其它 sub-motif 的关系
 */
export type SubMotifRole = 'statement' | 'repeat' | 'vary' | 'contrast' | 'resolve' | 'climax';

/**
 * 子动机槽位 — PhraseGroup 内的一个 1-2 小节生成单元
 *
 * label 决定动机复用：相同 label 共享同一份 motif 模板，
 * 不同的 role 会触发不同的变奏（vary 用 _prime/_seq/_inv，contrast 是新动机等）
 */
export interface SubMotifSlot {
    label: string;          // 'M' | 'M_prime' | 'N' | 'M_resolve' 等
    role: SubMotifRole;
    lengthBars: number;     // 子动机长度（小节数），通常 1 或 2
    isPeak?: boolean;       // 是否是 hook 峰值位（仅 Chorus group 设置）
    pitchShift?: number;    // 相对 group 中心的半音偏移（用于 sequence）
}

/**
 * Hook 主动架构计划 — 让副歌的"那个高音"被有意放置和重复轰击
 */
export interface HookPlan {
    peakSlotIndex: number;     // 哪个 sub-motif 是峰值位
    targetPitchClass?: number; // 跨副歌共享的同一峰值音 pitch class（0-11），可选
    climbCurve: 'gradual' | 'steep' | 'plateau';  // 峰值前的爬升路径
    reinforceCount: number;    // 峰值在 group 内被重复砸的次数（>=1）
}

/**
 * 大乐句容器 — 4/8/16 小节，作为旋律生成的最小完整单元
 */
export interface PhraseGroup {
    startBeat: number;
    lengthBeats: number;        // 总长度（拍）= lengthBars × beatsPerBar
    subMotifs: SubMotifSlot[];  // 子动机槽位序列
    cadenceType: CadenceType;
    hookPlan?: HookPlan;        // 仅 Chorus PhraseGroup 设置
    formLabel?: string;         // 'AABA' | 'ABAB' | 'ABAC' | 'longform' 等，用于调试
}

/**
 * 风格层乐句长度配置 — 决定每个段落使用的 PhraseGroup 长度
 */
export interface PhraseLengthProfile {
    name: string;                                    // 'pop' | 'ballad' | 'dance' 等
    /** 各段落类型偏好的 group 长度（小节数 + 权重） */
    perSection: {
        verse?: { bars: number, weight: number }[];
        preChorus?: { bars: number, weight: number }[];
        chorus?: { bars: number, weight: number }[];
        bridge?: { bars: number, weight: number }[];
        intro?: { bars: number, weight: number }[];
        outro?: { bars: number, weight: number }[];
        default?: { bars: number, weight: number }[];
    };
    /** 子动机长度池（一般 1 或 2 小节） */
    subMotifBarsPool: { bars: number, weight: number }[];
}

// 🌟 结构模板：整曲段落序列的纯数据描述
// 取代 StructureEngine 中硬编码的 () => {...} 闭包
export interface StructureTemplate {
    id: string;                       // 模板标识，便于调试 (e.g., "standard-pop", "chorus-first")
    introBarsMultiplier?: number;     // 前奏小节数 = introBarsMultiplier × style.global.introBarsHighBpm（或 lowBpm）
    introBaseEnergy?: number;         // 前奏起始能量
    sections: SectionTemplate[];      // intro 之后的段落序列
}

export interface StyleConfig {
    id: StyleId; name: string; description?: string;
    /**
     * 🌟 PR #2: 启用双阶段 Viterbi 和声管线（影子骨架 → 骨架旋律 → Viterbi 选和弦）。
     * - undefined / false: 使用旧的 HarmonyEngine.generateHarmonyTimeline + reharmonize
     * - true: 使用新的 HarmonyPipeline，跳过 reharmonize（Viterbi 已含其功能）
     * 默认为 undefined，仅在显式 opt-in 的风格上启用，保证未迁移风格零回归。
     */
    useViterbiHarmony?: boolean;
    global: {
        bpmRange: [number, number];
        timeSignaturePool: Array<{ signature:[number, number], weight: number }>;
        tonalityPool: Array<{ tonality: Tonality, weight: number }>;
        // 🌟 结构模板池：StructureEngine 从中等概率选取
        structureTemplates?: StructureTemplate[];
        // 🌟 BPM 驱动的前奏长度配置
        introBarsLowBpm?: number;       // 慢曲（bpm < introBarsBpmThreshold）使用的前奏小节数，默认 8
        introBarsHighBpm?: number;      // 快曲使用的前奏小节数，默认 4
        introBarsBpmThreshold?: number; // 慢/快曲分界 BPM，默认 90
        outroBars?: number;             // 尾奏小节数，默认 4
    };
    harmony: { chorusPool: ChordProgression[]; versePool: ChordProgression[]; preChorusPool: ChordProgression[]; };
    harmonyRules?: {
        maxDissonanceTolerance?: number;
        passingChords?: Array<'SecondaryDominant' | 'Diminished7' | 'TritoneSub' | 'Chromatic' | 'DescendingDiminished' | 'SharpFourHalfDim'>;
        allowTritoneSub?: boolean;
        reharmProbability?: number;
        melodyDrivenReharmProbability?: number; // 🌟 新增：旋律引导的和声替换概率
        borrowedChords?: Array<'ModalMixture' | 'Neapolitan' | 'SecondaryDominant' | 'TritoneSubstitution'>;
        voicingStyle?: 'standard' | 'neo-soul' | 'jazz' | 'jpop' | 'edm' | 'pop-rock';
        globalProgressionProbability?: number; // 🌟 新增：全曲共用一套和弦的概率
        genreBendingProbability?: number; // 🌟 新增：段落发生风格突变的概率
        genreBendingOverrides?: StyleId[]; // 🌟 新增：段落发生风格突变时的备选曲风
        preferJPopProgressions?: boolean; // 🌟 新增：是否偏好 J-Pop 和声进行
        sectionTransitionPassingProb?: number; // 🌟 HC-2：段落交界经过和弦概率（默认 0.45）
        maxBorrowedChords?: number;            // 🌟 HC-5：全曲借调和弦上限（默认 2，作为"高光时刻"不滥用）
        extensionProbability?: number;         // 和弦扩展着色概率。0.4=Pop, 0.6=EDM, 0.8=JPop, 1.0=Jazz/Neo-Soul
    };
    rhythm: { densityBase: [number, number]; syncopationWeight: number; restProbability: number; disruptionProbability: number; humanize: number; swingRatio?: number; swingSubdivision?: 0.5 | 0.25; strictGrid?: boolean; grooveTemplate?: RhythmCell[]; approachNoteProb?: number; grooveBankPool?: GrooveBankDef[]; chordAnticipation?: number; };
    melody: { 
        stepwiseRatio: number; 
        maxJumpInterval: number; 
        tensionTolerance: number; 
        mutationProbability: number; 
        mutationPool: Array<'inversion' | 'augmentation' | 'truncation' | 'retrograde' | 'diminution'>; 
        pentatonicPreference?: number;
        extensionPreference?: number;
        chromaticPassingProbability?: number;
        chromaticApproachProbability?: number;   // 强拍半音趋近概率（默认 0.15）
        passingToneChainProbability?: number;    // 大音程经过音填充概率（默认 0.12）
        harmonicGravityStrength?: number;        // 和弦功能引力强度 0-1（默认 0.3）
        leapResolutionThreshold?: number; // 🌟 新增：多大的音程被视为大跳并需要反向解决
        hookLeapChance?: number; // 🌟 d1 实验：downbeat 主动触发 hook leap 的概率（0~1，默认 0.4）— AuraRadio 移植
        syncopationResolution?: 'strict' | 'loose';
        inflectionProbability?: number;
        pentatonicShiftProbability?: number;
        anchorProbability?: number; // 🌟 新增：同音反复的概率
        riffDrivenProbability?: number; // 🌟 新增：段落由 Riff 驱动的概率
        sectionalRegisterProfile?: {
            verse: [number, number]; // e.g., [60, 72] (C4 to C5)
            preChorus: [number, number];
            chorus: [number, number];
            solo: [number, number];
        };
        breathingRoomProbability?: number; // 🌟 新增：强制休止符/呼吸空间的概率
        callAndResponseProbability?: number; // 🌟 新增：使用呼应手法的概率
        // 🌟 层级动机系统：PhraseGroup 长度配置
        phraseLengthProfile?: PhraseLengthProfile;
        motifRecipes?: {
            pickup: number[][];
            body: number[][];
            tail: number[][];
        };
        // --- 旋律技法插槽 (Vocal Techniques Slot) ---
        laidBackTimingMax?: number;       // 拖拍最大偏移量（拍）。0=精准，0.12=重度拖拍(R&B)，负值=抢拍(Punk)
        extensionTargeting?: boolean;     // 靶向延伸音(9/11)。true=R&B/Neo-Soul，false=流行/摇滚
        melismaProbability?: number;      // 转音瀑布触发概率。0=禁止，0.35=R&B高频
        sequenceFreezeRhythm?: boolean;   // vary/resolve 变奏时冻结节奏DNA仅做音程模进
        chordMelodyProbability?: number;  // ChordMelody 织体触发概率。0=不使用，0.7=Lo-fi/Neo-Soul
    };
    contrast: { versePitchOffset: number; verseDensityMultiplier: number; chorusPitchOffset?: number; };
    modulation: { probability: number; targetSection: 'Ending_Verse' | 'Final_Chorus' | 'Chorus'; intervalPool: number[]; };
    orchestration: { 
        melodyInstruments: string[]; 
        chordInstruments: string[]; 
        bassInstruments: string[];
        drumInstruments: string[];
        counterMelodyInstruments: string[];
        texturePool: Array<'Block' | 'Arpeggio' | 'Pulsing' | 'WalkingBass' | 'Guitar_Strum' | 'Rhythmic' | 'Pad' | 'Riff' | 'Octave_Melody_Bass' | 'String_Ostinato' | 'Water_Arpeggio' | 'ChordMelody'>;
        drumProbability?: number; // 🌟 新增：鼓组出场率，彻底解耦
        counterMelodyProbability?: number; // 副旋律出场率
        fillStyle?: 'micro' | 'standard' | 'heavy' | 'electronic'; // 🌟 新增：加花风格
        vocalProbability?: number; // 🌟 新增：主唱出场率
        outroRingOutProbability?: number; // 🌟 新增：尾奏使用 BigRingOut 的概率
        allowTradingFours?: boolean; // 🌟 新增：是否允许乐器对话 (Trading Fours)
        allowIntroRiffs?: boolean; // 🌟 新增：是否允许前奏 Riff
        allowRitardando?: boolean; // 🌟 新增：是否允许结尾渐慢
        allowDrumless?: boolean; // 🌟 新增：是否允许无鼓编制
        allowBassless?: boolean; // 🌟 新增：是否允许无贝斯编制
        grooveRatio?: { foundation: number; comping: number; color: number; }; // 🌟 新增：律动比例控制器
        idiomPreferences?: {
            counterMelodyStyle?: 'sustained' | 'melodic' | 'rhythmic' | 'arpeggiated';
            pianoStyle?: 'block-chord' | 'arpeggiated' | 'rhythmic' | 'sparse';
            drumStyle?: 'steady' | 'syncopated' | 'sparse' | 'high-energy' | 'acoustic-swing';
            bassStyle?: 'steady' | 'syncopated' | 'melodic' | 'sparse' | 'riff-driven';
            riffStyle?: 'melodic' | 'rhythmic' | 'arpeggiated' | 'chordal' | 'default';
            vocalStyle?: 'pop' | 'ballad' | 'neosoul' | 'rnb' | 'gospel' | 'choir';
        };
        mixingPreferences?: {
            requireSidechain?: boolean;
            melody?: MixingConfig;
            secondaryMelody?: MixingConfig;
            vocal?: MixingConfig;
            chord?: MixingConfig;
            bass?: MixingConfig;
            drums?: MixingConfig;
            counterMelody?: MixingConfig;
            chorusDepth?: number;
        };
        instrumentBehaviors?: {
            melody?: InstrumentBehavior;
            chord?: InstrumentBehavior;
            bass?: InstrumentBehavior;
            counterMelody?: InstrumentBehavior;
            secondaryMelody?: InstrumentBehavior;
        };
    };
    performance: { allowedPersonas: string[]; };
    masteringProfileId?: string;
}

// ============================================================
// PR #2: 双阶段和声管线 — Phase 1 影子骨架数据契约
// ============================================================

/**
 * 影子骨架的功能枚举：T(主) / S(下属) / D(属)
 * 对应 ViterbiChordSelector.HarmonicFunction，但放在 types.ts 让 SkeletonMelody 等模块能 import 而不用反向依赖 harmony/。
 */
export enum ShadowFunction {
    Tonic = 0,
    Subdominant = 1,
    Dominant = 2,
}

/**
 * 影子骨架的单个槽位 —— Phase 1 输出，Phase 2 消费。
 * Pitch Space: RELATIVE（suggestedRootPc 是主调相对 0~11）
 *
 * 槽位粒度：每小节一个（PR #2 最小可听版的妥协）。
 * 未来 PR #3 会引入动态粒度（Chorus 每拍、Verse 半小节）。
 */
export interface ShadowSlot {
    function: ShadowFunction;
    suggestedRootPc: number;     // 0~11，主调相对
    startBeat: number;           // 全曲绝对拍位
    endBeat: number;             // 全曲绝对拍位
    isStrong: boolean;           // 是否落在小节强拍（Beat 1），用于 Phase 2 选音
}



export interface SectionMetadata {
    name: string;      
    startBeat: number;
    endBeat: number;
    energyLevel: number; 
    grooveDNA?: number[]; // 🌟 这个极为重要：每一段将拥有自己独立的 Groove
    endingType?: 'hard_stop' | 'fade_out'; // 🌟 决定结尾的收尾方式
    localKeyOffset?: number; // 🌟 局部转调偏移量 (Local Key Offset)
    
    // 🌟 P2: 律动比例控制器 (Groove Ratio Controller)
    grooveRatio?: {
        foundation: number; // Bass & Kick
        comping: number;    // Piano & Guitar
        color: number;      // Synth & Strings
    };

    // --- Phase 1 & 2: Decoupled Foundation & Macro Brain ---
    sectionType?: SectionType; // 🌟 数值枚举，逐步替代 name.includes() 字符串匹配
    type?: string;
    lengthBars?: number;
    phraseTemplate?: string; // e.g., "A-A-B-A'"
    harmony?: HarmonyState;
    groove?: GrooveState;
    tracks?: TrackState[];

    // --- Narrative Mood Arc: 段落级情绪覆盖 ---
    moodOverride?: MoodId; // 不设时使用全曲 mood，设置后本段落独立调制密度/力度/鼓色彩等

    // --- Phase 3 & 4: Genre-Bending & Riff-Driven ---
    localStyleOverride?: StyleId; // 局部风格覆盖 (Option B)
    isRiffDriven?: boolean;      // 是否由 Riff 驱动 (Option A)
}

export interface MixingConfig {
    pan?: number; // -1 (left) to 1 (right)
    reverb?: number; // 0 to 1 (send level)
    volume?: number; // dB offset (e.g., -6 to +6)
    delay?: number; // 0 to 1 (send level)
    chorus?: number; // 0 to 127 (MIDI CC 93)
}

export interface EnsembleDraft {
    vocalSound?: string;
    melodySound: string;
    secondaryMelodySound?: string | null;
    chordSound: string | null;
    bassSound: string | null;
    drumSound: string | null;
    counterMelodySound: string | null;
    filterSweep?: string;
    mixing?: {
        vocal?: MixingConfig;
        melody?: MixingConfig;
        secondaryMelody?: MixingConfig;
        chord?: MixingConfig;
        bass?: MixingConfig;
        drums?: MixingConfig;
        counterMelody?: MixingConfig;
    };
}

// --- 乐器语汇约束 (Instrument Idiom) ---
// 抽离乐器的物理/演奏限制为纯数据，让生成引擎通过查表而非 if/switch 写死偏见。
// 同一乐器在主奏(Lead)与伴奏(Comping)时演奏法完全不同，因此拆成两个子接口。
//
// LeadIdiom — 旋律层：呼吸换气 + 拟人化（力度抖动 / 踏板感连奏 / 倚音）
//   驱动 ToplineEngine：管乐/人声 needsBreathing；钢琴 humanizeVelocity + legatoRatio + graceNoteProbability
// CompingIdiom — 伴奏层：扫弦延迟 / 切分 pattern / Drop-2 开放排列
//   驱动 TextureMapper 的 voicing 排列与切分律动。
export interface LeadIdiom {
    // 呼吸约束（管乐/人声）
    needsBreathing: boolean;
    breathPhraseLength?: number;
    breathTriggerBeat?: number;
    breathProbability?: number;
    // 拟人化与演奏技法（钢琴/吉他）
    humanizeVelocity?: number;     // 力度随机微调幅度（如 0.05 / 0.1）
    legatoRatio?: number;          // 连奏延音比例，模拟踏板（>1 延长，<1 断开）
    graceNoteProbability?: number; // 大跳时插入倚音（装饰音）的概率
    octaveDoubling?: boolean;      // 允许主奏在重音/高能段开启下方八度叠置
}

export interface CompingIdiom {
    strumDelay: number;
    compingPatterns: number[][];   // Pattern 池：TextureMapper 按小节索引轮换，消除机械重复
    arpeggioPatterns?: (number | null)[][]; // 支持带休止符(null)的琶音音型轨迹
    compingDuration: number;
    allowDrop2: boolean;
    textureType?: 'block' | 'arpeggio' | 'mixed';
    textureProbabilities?: { block: number, arpeggio: number, comping: number };
}

export interface InstrumentIdiom {
    id: string;
    lead: LeadIdiom;
    comping: CompingIdiom;
}

export interface GeneratedTrack {
    chords: GeneratedChord[]; vocal?: NoteData[]; melody: NoteData[]; counterMelody?: NoteData[]; drums?: NoteData[]; bpm: number; key: string;
    keyOffset: number; tonality: Tonality; timeSignature: [number, number]; sections: SectionMetadata[];
    blockIndex: number; absoluteStartBeat: number; hasIntro: boolean;
    preSelectedPalette?: EnsembleDraft;
    globalRiff?: NoteData[]; // 全局核心 Riff (Option A)
    processedUserMotif?: NoteData[];
    motifRole?: 'Foreground' | 'Middleground' | 'Background';
}

// 🌟 五阶段管道新增：乐队指挥计划与离调桥接
export type InstrumentRole =
    | 'melody'
    | 'vocal'
    | 'chord'
    | 'bass'
    | 'drums'
    | 'counter'
    | 'secondary';

export type RhythmCenter = 'downbeat' | 'backbeat' | 'syncopated';
export type GlobalRhythmProfile =
    | 'four-on-floor'
    | 'half-time'
    | 'shuffle'
    | 'ballad'
    | 'syncopated';

export interface ConductorSectionPlan {
    sectionName: string;
    startBeat: number;
    endBeat: number;
    focusInstrument: InstrumentRole;
    supportInstruments: InstrumentRole[];
    silentInstruments: InstrumentRole[];
    rhythmCenter: RhythmCenter;
    counterpointPairs: Array<[InstrumentRole, InstrumentRole]>;
    fillWindows: number[];
}

export interface ConductorPlan {
    sections: ConductorSectionPlan[];
    globalRhythmProfile: GlobalRhythmProfile;
}

export interface CadentialBridge {
    beat: number;
    targetNumeral: string;
    bridgeType: 'ii-V-I' | 'bVII-IV' | 'secondary-dom' | 'tritone-sub';
}

// Stage 1 输出的"轨迹与节奏"高层风格化描述（UI 可视化用）
export interface TrajectoryProfile {
    sync: string;   // 节奏密度风格："Fast Triplet Bursts" / "Steady Eighths" / ...
    path: string;   // 旋律走向风格："Monotone Triplets" / "Lyrical Arch" / ...
}

export interface MusicContext {
    keyOffset: number;
    tonality: Tonality;
    bpm: number;
    timeSignature: [number, number];
    grooveDNA: number[];
    moodId?: MoodId;
    ensemble?: EnsembleDraft;
    style?: StyleConfig;
    conductorPlan?: ConductorPlan;
    cadentialBridges?: CadentialBridge[];
    trajectoryProfile?: TrajectoryProfile;
}

export interface GenerationOptions {
    styleId?: StyleId;
    moodId?: MoodId;
    seed?: number;
    length?: 'short' | 'medium' | 'long';
    userMotifRoot?: number;
    processedUserMotif?: any[];
    motifRole?: 'Foreground' | 'Middleground' | 'Background';
    detectedTimeSignature?: [number, number];
    detectedTonality?: Tonality;
}
export interface TempoCurve {
    startTick: number;
    endTick: number;
    startBpm: number;
    endBpm: number;
    curveType: 'linear' | 'exponential';
}

export interface ArrangedTrack { 
    bpm: number; key: string; absoluteStartBeat: number; timeSignature?: [number, number];
    styleId?: StyleId;
    vocal?: NoteData[]; melody: NoteData[]; secondaryMelody?: NoteData[]; pianoLH: NoteData[]; pianoRH: NoteData[]; drums?: NoteData[]; counterMelody?: NoteData[]; userMotif?: NoteData[];
    palette?: EnsembleDraft; 
    sections?: SectionMetadata[];
    globalRiff?: NoteData[]; // 全局核心 Riff (Option A)
    chords?: GeneratedChord[]; // 全曲和弦进行
    tempoCurves?: TempoCurve[]; // 渐慢/渐快曲线
    introFilterSweep?: boolean; // 🌟 ST-3: Intro 低通涌动标记，PlaybackEngine 读取后注入 CC74 渐变
}

// ============================================================
// 数值枚举 & 查找表（Phase 1 cherry-pick：类型安全基础设施）
// 当前阶段仅添加定义，不修改现有代码的类型签名。
// Phase 4 将逐步把 string 类型迁移到这些枚举。
// ============================================================

// --- Tonality 数值枚举 ---
// Harmonic_Minor / Phrygian：DarkSynth / Metal / Flamenco / Neoclassical 常用调式扩展。
export enum Tonality {
    Major = 0, Minor = 1, Major_Pentatonic = 2, Minor_Pentatonic = 3,
    Blues = 4, Dorian = 5, Mixolydian = 6, Melodic_Minor = 7, Lydian = 8,
    Harmonic_Minor = 9, Phrygian = 10
}

export const TonalityName: string[] = [];
TonalityName[Tonality.Major] = 'Major';
TonalityName[Tonality.Minor] = 'Minor';
TonalityName[Tonality.Major_Pentatonic] = 'Major_Pentatonic';
TonalityName[Tonality.Minor_Pentatonic] = 'Minor_Pentatonic';
TonalityName[Tonality.Blues] = 'Blues';
TonalityName[Tonality.Dorian] = 'Dorian';
TonalityName[Tonality.Mixolydian] = 'Mixolydian';
TonalityName[Tonality.Melodic_Minor] = 'Melodic_Minor';
TonalityName[Tonality.Lydian] = 'Lydian';
TonalityName[Tonality.Harmonic_Minor] = 'Harmonic_Minor';
TonalityName[Tonality.Phrygian] = 'Phrygian';

/** 音阶音程查找表：SCALE_INTERVALS[tonality] → number[] (半音间隔) */
export const SCALE_INTERVALS: number[][] = [];
SCALE_INTERVALS[Tonality.Major]            = [0, 2, 4, 5, 7, 9, 11];
SCALE_INTERVALS[Tonality.Minor]            = [0, 2, 3, 5, 7, 8, 10];
SCALE_INTERVALS[Tonality.Major_Pentatonic] = [0, 2, 4, 7, 9];
SCALE_INTERVALS[Tonality.Minor_Pentatonic] = [0, 3, 5, 7, 10];
SCALE_INTERVALS[Tonality.Blues]            = [0, 3, 5, 6, 7, 10];
SCALE_INTERVALS[Tonality.Dorian]           = [0, 2, 3, 5, 7, 9, 10];
SCALE_INTERVALS[Tonality.Mixolydian]       = [0, 2, 4, 5, 7, 9, 10];
SCALE_INTERVALS[Tonality.Melodic_Minor]    = [0, 2, 3, 5, 7, 9, 11];
SCALE_INTERVALS[Tonality.Lydian]           = [0, 2, 4, 6, 7, 9, 11];
SCALE_INTERVALS[Tonality.Harmonic_Minor]   = [0, 2, 3, 5, 7, 8, 11];
SCALE_INTERVALS[Tonality.Phrygian]         = [0, 1, 3, 5, 7, 8, 10];

// --- ChordQuality 数值枚举 ---
export enum ChordQuality {
    Major = 0, Minor = 1, Diminished = 2, Diminished7 = 3, Augmented = 4,
    Dominant7 = 5, Minor7 = 6, Major7 = 7, HalfDiminished = 8,
    Sus4 = 9, Dominant7Sus4 = 10, Add9 = 11, Minor9 = 12, Major9 = 13,
    Dominant9 = 14, Minor11 = 15, Dominant13 = 16
}

export const ChordQualityName: string[] = [];
ChordQualityName[ChordQuality.Major] = 'Major';
ChordQualityName[ChordQuality.Minor] = 'Minor';
ChordQualityName[ChordQuality.Diminished] = 'Diminished';
ChordQualityName[ChordQuality.Diminished7] = 'Diminished7';
ChordQualityName[ChordQuality.Augmented] = 'Augmented';
ChordQualityName[ChordQuality.Dominant7] = 'Dominant7';
ChordQualityName[ChordQuality.Minor7] = 'Minor7';
ChordQualityName[ChordQuality.Major7] = 'Major7';
ChordQualityName[ChordQuality.HalfDiminished] = 'HalfDiminished';
ChordQualityName[ChordQuality.Sus4] = 'Sus4';
ChordQualityName[ChordQuality.Dominant7Sus4] = 'Dominant7Sus4';
ChordQualityName[ChordQuality.Add9] = 'Add9';
ChordQualityName[ChordQuality.Minor9] = 'Minor9';
ChordQualityName[ChordQuality.Major9] = 'Major9';
ChordQualityName[ChordQuality.Dominant9] = 'Dominant9';
ChordQualityName[ChordQuality.Minor11] = 'Minor11';
ChordQualityName[ChordQuality.Dominant13] = 'Dominant13';

/** 和弦音程查找表：CHORD_INTERVALS[quality] → number[] */
export const CHORD_INTERVALS: number[][] = [];
CHORD_INTERVALS[ChordQuality.Major]          = [0, 4, 7];
CHORD_INTERVALS[ChordQuality.Minor]          = [0, 3, 7];
CHORD_INTERVALS[ChordQuality.Diminished]     = [0, 3, 6];
CHORD_INTERVALS[ChordQuality.Diminished7]    = [0, 3, 6, 9];
CHORD_INTERVALS[ChordQuality.Augmented]      = [0, 4, 8];
CHORD_INTERVALS[ChordQuality.Dominant7]      = [0, 4, 7, 10];
CHORD_INTERVALS[ChordQuality.Minor7]         = [0, 3, 7, 10];
CHORD_INTERVALS[ChordQuality.Major7]         = [0, 4, 7, 11];
CHORD_INTERVALS[ChordQuality.HalfDiminished] = [0, 3, 6, 10];
CHORD_INTERVALS[ChordQuality.Sus4]           = [0, 5, 7];
CHORD_INTERVALS[ChordQuality.Dominant7Sus4]  = [0, 5, 7, 10];
CHORD_INTERVALS[ChordQuality.Add9]           = [0, 2, 4, 7];
CHORD_INTERVALS[ChordQuality.Minor9]         = [0, 3, 7, 10, 14];
CHORD_INTERVALS[ChordQuality.Major9]         = [0, 4, 7, 11, 14];
CHORD_INTERVALS[ChordQuality.Dominant9]      = [0, 4, 7, 10, 14];
CHORD_INTERVALS[ChordQuality.Minor11]        = [0, 3, 7, 10, 14, 17];
CHORD_INTERVALS[ChordQuality.Dominant13]     = [0, 4, 7, 10, 14, 21];

/** 位掩码：快速分类检查 */
export const CQ_IS_MINOR = (1 << ChordQuality.Minor) | (1 << ChordQuality.Minor7) | (1 << ChordQuality.Minor9) | (1 << ChordQuality.Minor11);
export const CQ_IS_MAJOR = (1 << ChordQuality.Major) | (1 << ChordQuality.Major7) | (1 << ChordQuality.Major9);
export const CQ_IS_DOM   = (1 << ChordQuality.Dominant7) | (1 << ChordQuality.Dominant7Sus4) | (1 << ChordQuality.Dominant9) | (1 << ChordQuality.Dominant13);
export const CQ_IS_DIM   = (1 << ChordQuality.Diminished) | (1 << ChordQuality.Diminished7) | (1 << ChordQuality.HalfDiminished);

// --- SectionType 数值枚举 ---
export enum SectionType {
    Intro = 0, Verse = 1, PreChorus = 2, Chorus = 3, Bridge = 4,
    Outro = 5, Break = 6, Breakdown = 7, BuildUp = 8, Drop = 9,
    PreOutro = 10, Solo_Bridge = 11
}

// 数值枚举 → 字符串名映射，仅供需要 hashmap key 的旧代码使用
// 新代码应直接用 SectionType.X 数值比较
export const SectionTypeName: Record<SectionType, string> = {
    [SectionType.Intro]: 'Intro',
    [SectionType.Verse]: 'Verse',
    [SectionType.PreChorus]: 'PreChorus',
    [SectionType.Chorus]: 'Chorus',
    [SectionType.Bridge]: 'Bridge',
    [SectionType.Outro]: 'Outro',
    [SectionType.Break]: 'Break',
    [SectionType.Breakdown]: 'Breakdown',
    [SectionType.BuildUp]: 'BuildUp',
    [SectionType.Drop]: 'Drop',
    [SectionType.PreOutro]: 'PreOutro',
    [SectionType.Solo_Bridge]: 'Solo_Bridge',
};
```

### `src/core/generation/config/StyleFlags.ts`

> ✅ 战役四：唯一注册风格收敛 — 删除 `ModernPop` / `Synthwave` / `LofiChill` 与全部别名（`Default` / `DarkSynthPop` / `LoFiChill`），仅保留 `AcgLightMusic = 20`。所有旧 StyleId 引用已在全仓清理。

```ts
export enum StyleId {
    AcgLightMusic = 20,
}

export const StyleIdName: Record<StyleId, string> = {
    [StyleId.AcgLightMusic]: '二次元轻音乐 (ACG Light Music)',
};
```

### `src/core/generation/config/MoodFlags.ts`

```ts
import { Tonality } from '../types';

export enum MoodId {
    Neutral = 0,
    Chill = 1,
    Melancholic = 2,
    Energetic = 3,
    Aggressive = 4,
    Euphoric = 5
}

export interface MoodConfig {
    id: MoodId;
    name: string;
    bpmMultiplier: [number, number]; // e.g., [0.7, 0.85] for Chill
    tonalityBias?: { tonality: Tonality, weight: number }[]; // Overrides style if present
    energyCap: [number, number]; // [minEnergy, maxEnergy] for the whole song
    densityMultiplier: number;
    phraseActionBias: [number, number, number]; // [Repeat, Vary, Contrast] weights
}

export const MoodRegistry: Record<MoodId, MoodConfig> = {
    [MoodId.Neutral]: { 
        id: MoodId.Neutral, 
        name: 'Neutral', 
        bpmMultiplier: [0.9, 1.1], 
        energyCap: [2, 8], 
        densityMultiplier: 1.0,
        phraseActionBias: [0.4, 0.3, 0.3]
    },
    [MoodId.Chill]: { 
        id: MoodId.Chill, 
        name: 'Chill', 
        bpmMultiplier: [0.7, 0.85], 
        energyCap: [1, 4], 
        densityMultiplier: 0.6,
        phraseActionBias: [0.5, 0.3, 0.2]
    },
    [MoodId.Melancholic]: { 
        id: MoodId.Melancholic, 
        name: 'Melancholic', 
        bpmMultiplier: [0.6, 0.8], 
        tonalityBias: [{tonality: Tonality.Minor, weight: 0.9}, {tonality: Tonality.Major, weight: 0.1}], 
        energyCap: [1, 5], 
        densityMultiplier: 0.7,
        phraseActionBias: [0.2, 0.3, 0.5] // More wandering/contrast
    },
    [MoodId.Energetic]: { 
        id: MoodId.Energetic, 
        name: 'Energetic', 
        bpmMultiplier: [1.1, 1.3], 
        energyCap: [4, 8], 
        densityMultiplier: 1.2,
        phraseActionBias: [0.5, 0.3, 0.2]
    },
    [MoodId.Aggressive]: { 
        id: MoodId.Aggressive, 
        name: 'Aggressive', 
        bpmMultiplier: [1.2, 1.5], 
        tonalityBias: [{tonality: Tonality.Minor, weight: 0.8}, {tonality: Tonality.Major, weight: 0.2}], 
        energyCap: [5, 8], 
        densityMultiplier: 1.3,
        phraseActionBias: [0.3, 0.4, 0.3]
    },
    [MoodId.Euphoric]: { 
        id: MoodId.Euphoric, 
        name: 'Euphoric', 
        bpmMultiplier: [1.1, 1.25], 
        tonalityBias: [{tonality: Tonality.Major, weight: 0.9}, {tonality: Tonality.Minor, weight: 0.1}], 
        energyCap: [4, 8], 
        densityMultiplier: 1.1,
        phraseActionBias: [0.6, 0.2, 0.2] // Highly repetitive/catchy
    }
};
```

### `src/core/generation/config/InstrumentFlags.ts`

> 60 种 InstrumentId + AcousticEnvelope 包络分类 + GM Program 桥接。

```ts
// T-1 合规：禁止字符串子串匹配做乐器路由，改用枚举查表
export const enum InstrumentFamily {
    Drums   = 0,
    String  = 1,
    Wind    = 2,
    Guitar  = 3,
    Bass    = 4,
    Synth   = 5,
    Piano   = 6,
    Voice   = 7,
    Unknown = 8,
}

/** T-1 合规：从 InstrumentId 枚举直接查表获取 InstrumentFamily */
export function resolveInstrumentFamily(id: InstrumentId): InstrumentFamily {
    const family = InstrumentIdFamily[id];
    return family !== undefined ? family : InstrumentFamily.Unknown;
}

// T-1 合规：InstrumentId 数值枚举，替代乐器名称字符串
export enum InstrumentId {
    // Piano / Keys
    Acoustic_Grand = 0,
    Electric_Piano_1 = 1,
    Electric_Piano_2 = 2,
    Warm_EP = 3,
    Lofi_Piano = 4,
    Rock_Organ = 5,
    // Strings
    Violin = 6,
    Cello = 7,
    Contrabass = 8,
    String_Ensemble = 9,
    String_Ensemble_2 = 10,
    Tremolo_Strings = 11,
    Pizzicato_Strings = 12,
    // Wind
    Flute = 13,
    Oboe = 14,
    Clarinet = 15,
    Alto_Sax = 16,
    Tenor_Sax = 17,
    Muted_Trumpet = 18,
    Recorder = 19,
    Ocarina = 20,
    // Guitar
    Acoustic_Guitar_Nylon = 21,
    Acoustic_Guitar_Steel = 22,
    Acoustic_Guitar_Chord = 23,
    Clean_Guitar = 24,
    Electric_Guitar_Clean = 25,
    Overdriven_Guitar = 26,
    Distortion_Guitar = 27,
    Harmonica = 28,
    // Bass
    Acoustic_Bass = 29,
    Electric_Bass_Finger = 30,
    Electric_Bass_Pick = 31,
    Fretless_Bass = 32,
    Synth_Bass_1 = 33,
    Synth_Bass_2 = 34,
    Slap_Bass_1 = 35,
    // Synth / Pad / Lead
    Lead_1_Square = 36,
    Lead_2_Sawtooth = 37,
    Synth_Calliope = 38,
    Synth_Brass_1 = 39,
    Synth_Lead = 40,
    Pad_1_NewAge = 41,
    Pad_2_Warm = 42,
    Pad_3_Polysynth = 43,
    Synth_Strings_1 = 44,
    // Voice / Percussion
    Choir_Aahs = 45,
    Voice_Oohs = 46,
    Solo_Vox = 47,
    Marimba = 48,
    Vibraphone = 49,
    // Drums
    Standard_DrumKit = 50,
    Electronic_DrumKit = 51,
    TR808_DrumKit = 52,
    Orchestral_DrumKit = 53,
    Room_DrumKit = 54,
    // Special
    Reverse_Cymbal = 55,
    Music_Box = 56,
    Glockenspiel = 57,
    Orchestral_Harp = 58,
    System_Aura = 59,
}

// 翻译枚举：InstrumentId -> 显示名（用于日志和音频层桥接）
export const InstrumentIdName: string[] = [];
InstrumentIdName[InstrumentId.Acoustic_Grand] = 'Acoustic_Grand';
InstrumentIdName[InstrumentId.Electric_Piano_1] = 'Electric_Piano_1';
InstrumentIdName[InstrumentId.Electric_Piano_2] = 'Electric_Piano_2';
InstrumentIdName[InstrumentId.Warm_EP] = 'Warm_EP';
InstrumentIdName[InstrumentId.Lofi_Piano] = 'Lofi_Piano';
InstrumentIdName[InstrumentId.Rock_Organ] = 'Rock_Organ';
InstrumentIdName[InstrumentId.Violin] = 'Violin';
InstrumentIdName[InstrumentId.Cello] = 'Cello';
InstrumentIdName[InstrumentId.Contrabass] = 'Contrabass';
InstrumentIdName[InstrumentId.String_Ensemble] = 'String_Ensemble';
InstrumentIdName[InstrumentId.String_Ensemble_2] = 'String_Ensemble_2';
InstrumentIdName[InstrumentId.Tremolo_Strings] = 'Tremolo_Strings';
InstrumentIdName[InstrumentId.Pizzicato_Strings] = 'Pizzicato_Strings';
InstrumentIdName[InstrumentId.Flute] = 'Flute';
InstrumentIdName[InstrumentId.Oboe] = 'Oboe';
InstrumentIdName[InstrumentId.Clarinet] = 'Clarinet';
InstrumentIdName[InstrumentId.Alto_Sax] = 'Alto_Sax';
InstrumentIdName[InstrumentId.Tenor_Sax] = 'Tenor_Sax';
InstrumentIdName[InstrumentId.Muted_Trumpet] = 'Muted_Trumpet';
InstrumentIdName[InstrumentId.Recorder] = 'Recorder';
InstrumentIdName[InstrumentId.Ocarina] = 'Ocarina';
InstrumentIdName[InstrumentId.Acoustic_Guitar_Nylon] = 'Acoustic_Guitar_Nylon';
InstrumentIdName[InstrumentId.Acoustic_Guitar_Steel] = 'Acoustic_Guitar_Steel';
InstrumentIdName[InstrumentId.Acoustic_Guitar_Chord] = 'Acoustic_Guitar_Chord';
InstrumentIdName[InstrumentId.Clean_Guitar] = 'Clean_Guitar';
InstrumentIdName[InstrumentId.Electric_Guitar_Clean] = 'Electric_Guitar_Clean';
InstrumentIdName[InstrumentId.Overdriven_Guitar] = 'Overdriven_Guitar';
InstrumentIdName[InstrumentId.Distortion_Guitar] = 'Distortion_Guitar';
InstrumentIdName[InstrumentId.Harmonica] = 'Harmonica';
InstrumentIdName[InstrumentId.Acoustic_Bass] = 'Acoustic_Bass';
InstrumentIdName[InstrumentId.Electric_Bass_Finger] = 'Electric_Bass_Finger';
InstrumentIdName[InstrumentId.Electric_Bass_Pick] = 'Electric_Bass_Pick';
InstrumentIdName[InstrumentId.Fretless_Bass] = 'Fretless_Bass';
InstrumentIdName[InstrumentId.Synth_Bass_1] = 'Synth_Bass_1';
InstrumentIdName[InstrumentId.Synth_Bass_2] = 'Synth_Bass_2';
InstrumentIdName[InstrumentId.Slap_Bass_1] = 'Slap_Bass_1';
InstrumentIdName[InstrumentId.Lead_1_Square] = 'Lead_1_square';
InstrumentIdName[InstrumentId.Lead_2_Sawtooth] = 'Lead_2_Sawtooth';
InstrumentIdName[InstrumentId.Synth_Calliope] = 'Synth_Calliope';
InstrumentIdName[InstrumentId.Synth_Brass_1] = 'Synth_Brass_1';
InstrumentIdName[InstrumentId.Synth_Lead] = 'Synth_Lead';
InstrumentIdName[InstrumentId.Pad_1_NewAge] = 'Pad_1_NewAge';
InstrumentIdName[InstrumentId.Pad_2_Warm] = 'Pad_2_warm';
InstrumentIdName[InstrumentId.Pad_3_Polysynth] = 'Pad_3_Polysynth';
InstrumentIdName[InstrumentId.Synth_Strings_1] = 'Synth_Strings_1';
InstrumentIdName[InstrumentId.Choir_Aahs] = 'Choir_Aahs';
InstrumentIdName[InstrumentId.Voice_Oohs] = 'Voice_Oohs';
InstrumentIdName[InstrumentId.Solo_Vox] = 'Solo_Vox';
InstrumentIdName[InstrumentId.Marimba] = 'Marimba';
InstrumentIdName[InstrumentId.Vibraphone] = 'Vibraphone';
InstrumentIdName[InstrumentId.Standard_DrumKit] = 'Standard_DrumKit';
InstrumentIdName[InstrumentId.Electronic_DrumKit] = 'Electronic_Drum';
InstrumentIdName[InstrumentId.TR808_DrumKit] = 'TR808_DrumKit';
InstrumentIdName[InstrumentId.Orchestral_DrumKit] = 'Orchestral_DrumKit';
InstrumentIdName[InstrumentId.Room_DrumKit] = 'Room_DrumKit';
InstrumentIdName[InstrumentId.Reverse_Cymbal] = 'Reverse_Cymbal';
InstrumentIdName[InstrumentId.Music_Box] = 'Music_Box';
InstrumentIdName[InstrumentId.Glockenspiel] = 'Glockenspiel';
InstrumentIdName[InstrumentId.Orchestral_Harp] = 'Orchestral_Harp';
InstrumentIdName[InstrumentId.System_Aura] = 'System_Aura';

// InstrumentId -> GM Program Number（音频层 MIDI 桥接）
export const InstrumentGMProgram: number[] = [];
InstrumentGMProgram[InstrumentId.Acoustic_Grand] = 0;
InstrumentGMProgram[InstrumentId.Electric_Piano_1] = 4;
InstrumentGMProgram[InstrumentId.Electric_Piano_2] = 5;
InstrumentGMProgram[InstrumentId.Warm_EP] = 4;
InstrumentGMProgram[InstrumentId.Lofi_Piano] = 4;
InstrumentGMProgram[InstrumentId.Rock_Organ] = 0;
InstrumentGMProgram[InstrumentId.Violin] = 40;
InstrumentGMProgram[InstrumentId.Cello] = 42;
InstrumentGMProgram[InstrumentId.Contrabass] = 43;
InstrumentGMProgram[InstrumentId.String_Ensemble] = 48;
InstrumentGMProgram[InstrumentId.String_Ensemble_2] = 48;
InstrumentGMProgram[InstrumentId.Tremolo_Strings] = 44;
InstrumentGMProgram[InstrumentId.Pizzicato_Strings] = 45;
InstrumentGMProgram[InstrumentId.Flute] = 73;
InstrumentGMProgram[InstrumentId.Oboe] = 68;
InstrumentGMProgram[InstrumentId.Clarinet] = 71;
InstrumentGMProgram[InstrumentId.Alto_Sax] = 65;
InstrumentGMProgram[InstrumentId.Tenor_Sax] = 66;
InstrumentGMProgram[InstrumentId.Muted_Trumpet] = 59;
InstrumentGMProgram[InstrumentId.Recorder] = 74;
InstrumentGMProgram[InstrumentId.Ocarina] = 79;
InstrumentGMProgram[InstrumentId.Acoustic_Guitar_Nylon] = 24;
InstrumentGMProgram[InstrumentId.Acoustic_Guitar_Steel] = 25;
InstrumentGMProgram[InstrumentId.Acoustic_Guitar_Chord] = 24;
InstrumentGMProgram[InstrumentId.Clean_Guitar] = 27;
InstrumentGMProgram[InstrumentId.Electric_Guitar_Clean] = 27;
InstrumentGMProgram[InstrumentId.Overdriven_Guitar] = 29;
InstrumentGMProgram[InstrumentId.Distortion_Guitar] = 30;
InstrumentGMProgram[InstrumentId.Harmonica] = 22;
InstrumentGMProgram[InstrumentId.Acoustic_Bass] = 32;
InstrumentGMProgram[InstrumentId.Electric_Bass_Finger] = 33;
InstrumentGMProgram[InstrumentId.Electric_Bass_Pick] = 34;
InstrumentGMProgram[InstrumentId.Fretless_Bass] = 35;
InstrumentGMProgram[InstrumentId.Synth_Bass_1] = 38;
InstrumentGMProgram[InstrumentId.Synth_Bass_2] = 39;
InstrumentGMProgram[InstrumentId.Slap_Bass_1] = 36;
InstrumentGMProgram[InstrumentId.Lead_1_Square] = 80;
InstrumentGMProgram[InstrumentId.Lead_2_Sawtooth] = 81;
InstrumentGMProgram[InstrumentId.Synth_Calliope] = 82;
InstrumentGMProgram[InstrumentId.Synth_Brass_1] = 62;
InstrumentGMProgram[InstrumentId.Synth_Lead] = 81;
InstrumentGMProgram[InstrumentId.Pad_1_NewAge] = 88;
InstrumentGMProgram[InstrumentId.Pad_2_Warm] = 89;
InstrumentGMProgram[InstrumentId.Pad_3_Polysynth] = 90;
InstrumentGMProgram[InstrumentId.Synth_Strings_1] = 50;
InstrumentGMProgram[InstrumentId.Choir_Aahs] = 52;
InstrumentGMProgram[InstrumentId.Voice_Oohs] = 53;
InstrumentGMProgram[InstrumentId.Solo_Vox] = 85;
InstrumentGMProgram[InstrumentId.Marimba] = 12;
InstrumentGMProgram[InstrumentId.Vibraphone] = 11;
InstrumentGMProgram[InstrumentId.Standard_DrumKit] = 0;
InstrumentGMProgram[InstrumentId.Electronic_DrumKit] = 24;
InstrumentGMProgram[InstrumentId.TR808_DrumKit] = 25;
InstrumentGMProgram[InstrumentId.Orchestral_DrumKit] = 48;
InstrumentGMProgram[InstrumentId.Room_DrumKit] = 0;
InstrumentGMProgram[InstrumentId.Reverse_Cymbal] = 119;
InstrumentGMProgram[InstrumentId.Music_Box] = 10;
InstrumentGMProgram[InstrumentId.Glockenspiel] = 9;
InstrumentGMProgram[InstrumentId.Orchestral_Harp] = 46;
InstrumentGMProgram[InstrumentId.System_Aura] = 81;

// InstrumentId -> InstrumentFamily（替代 INSTRUMENT_FAMILY_TABLE Record）
export const InstrumentIdFamily: InstrumentFamily[] = [];
// Piano / Keys
InstrumentIdFamily[InstrumentId.Acoustic_Grand] = InstrumentFamily.Piano;
InstrumentIdFamily[InstrumentId.Electric_Piano_1] = InstrumentFamily.Piano;
InstrumentIdFamily[InstrumentId.Electric_Piano_2] = InstrumentFamily.Piano;
InstrumentIdFamily[InstrumentId.Warm_EP] = InstrumentFamily.Piano;
InstrumentIdFamily[InstrumentId.Lofi_Piano] = InstrumentFamily.Piano;
InstrumentIdFamily[InstrumentId.Rock_Organ] = InstrumentFamily.Piano;
// Strings
InstrumentIdFamily[InstrumentId.Violin] = InstrumentFamily.String;
InstrumentIdFamily[InstrumentId.Cello] = InstrumentFamily.String;
InstrumentIdFamily[InstrumentId.Contrabass] = InstrumentFamily.String;
InstrumentIdFamily[InstrumentId.String_Ensemble] = InstrumentFamily.String;
InstrumentIdFamily[InstrumentId.String_Ensemble_2] = InstrumentFamily.String;
InstrumentIdFamily[InstrumentId.Tremolo_Strings] = InstrumentFamily.String;
InstrumentIdFamily[InstrumentId.Pizzicato_Strings] = InstrumentFamily.String;
// Wind
InstrumentIdFamily[InstrumentId.Flute] = InstrumentFamily.Wind;
InstrumentIdFamily[InstrumentId.Oboe] = InstrumentFamily.Wind;
InstrumentIdFamily[InstrumentId.Clarinet] = InstrumentFamily.Wind;
InstrumentIdFamily[InstrumentId.Alto_Sax] = InstrumentFamily.Wind;
InstrumentIdFamily[InstrumentId.Tenor_Sax] = InstrumentFamily.Wind;
InstrumentIdFamily[InstrumentId.Muted_Trumpet] = InstrumentFamily.Wind;
InstrumentIdFamily[InstrumentId.Recorder] = InstrumentFamily.Wind;
InstrumentIdFamily[InstrumentId.Ocarina] = InstrumentFamily.Wind;
// Guitar
InstrumentIdFamily[InstrumentId.Acoustic_Guitar_Nylon] = InstrumentFamily.Guitar;
InstrumentIdFamily[InstrumentId.Acoustic_Guitar_Steel] = InstrumentFamily.Guitar;
InstrumentIdFamily[InstrumentId.Acoustic_Guitar_Chord] = InstrumentFamily.Guitar;
InstrumentIdFamily[InstrumentId.Clean_Guitar] = InstrumentFamily.Guitar;
InstrumentIdFamily[InstrumentId.Electric_Guitar_Clean] = InstrumentFamily.Guitar;
InstrumentIdFamily[InstrumentId.Overdriven_Guitar] = InstrumentFamily.Guitar;
InstrumentIdFamily[InstrumentId.Distortion_Guitar] = InstrumentFamily.Guitar;
InstrumentIdFamily[InstrumentId.Harmonica] = InstrumentFamily.Guitar;
// Bass
InstrumentIdFamily[InstrumentId.Acoustic_Bass] = InstrumentFamily.Bass;
InstrumentIdFamily[InstrumentId.Electric_Bass_Finger] = InstrumentFamily.Bass;
InstrumentIdFamily[InstrumentId.Electric_Bass_Pick] = InstrumentFamily.Bass;
InstrumentIdFamily[InstrumentId.Fretless_Bass] = InstrumentFamily.Bass;
InstrumentIdFamily[InstrumentId.Synth_Bass_1] = InstrumentFamily.Bass;
InstrumentIdFamily[InstrumentId.Synth_Bass_2] = InstrumentFamily.Bass;
InstrumentIdFamily[InstrumentId.Slap_Bass_1] = InstrumentFamily.Bass;
// Synth / Pad / Lead
InstrumentIdFamily[InstrumentId.Lead_1_Square] = InstrumentFamily.Synth;
InstrumentIdFamily[InstrumentId.Lead_2_Sawtooth] = InstrumentFamily.Synth;
InstrumentIdFamily[InstrumentId.Synth_Calliope] = InstrumentFamily.Synth;
InstrumentIdFamily[InstrumentId.Synth_Brass_1] = InstrumentFamily.Synth;
InstrumentIdFamily[InstrumentId.Synth_Lead] = InstrumentFamily.Synth;
InstrumentIdFamily[InstrumentId.Pad_1_NewAge] = InstrumentFamily.Synth;
InstrumentIdFamily[InstrumentId.Pad_2_Warm] = InstrumentFamily.Synth;
InstrumentIdFamily[InstrumentId.Pad_3_Polysynth] = InstrumentFamily.Synth;
InstrumentIdFamily[InstrumentId.Synth_Strings_1] = InstrumentFamily.Synth;
// Voice / Percussion
InstrumentIdFamily[InstrumentId.Choir_Aahs] = InstrumentFamily.Voice;
InstrumentIdFamily[InstrumentId.Voice_Oohs] = InstrumentFamily.Voice;
InstrumentIdFamily[InstrumentId.Solo_Vox] = InstrumentFamily.Voice;
InstrumentIdFamily[InstrumentId.Marimba] = InstrumentFamily.Voice;
InstrumentIdFamily[InstrumentId.Vibraphone] = InstrumentFamily.Voice;
// Drums
InstrumentIdFamily[InstrumentId.Standard_DrumKit] = InstrumentFamily.Drums;
InstrumentIdFamily[InstrumentId.Electronic_DrumKit] = InstrumentFamily.Drums;
InstrumentIdFamily[InstrumentId.TR808_DrumKit] = InstrumentFamily.Drums;
InstrumentIdFamily[InstrumentId.Orchestral_DrumKit] = InstrumentFamily.Drums;
InstrumentIdFamily[InstrumentId.Room_DrumKit] = InstrumentFamily.Drums;
// Special
InstrumentIdFamily[InstrumentId.Reverse_Cymbal] = InstrumentFamily.Synth;
InstrumentIdFamily[InstrumentId.Music_Box] = InstrumentFamily.Piano;
InstrumentIdFamily[InstrumentId.Glockenspiel] = InstrumentFamily.Piano;
InstrumentIdFamily[InstrumentId.Orchestral_Harp] = InstrumentFamily.String;
InstrumentIdFamily[InstrumentId.System_Aura] = InstrumentFamily.Synth;

// InstrumentId 位掩码分类标志（用于快速批量分类检查）
export const IF_IS_PIANO   = (1 << InstrumentId.Acoustic_Grand) | (1 << InstrumentId.Electric_Piano_1) | (1 << InstrumentId.Electric_Piano_2) | (1 << InstrumentId.Warm_EP) | (1 << InstrumentId.Lofi_Piano);
export const IF_IS_GUITAR  = (1 << InstrumentId.Acoustic_Guitar_Nylon) | (1 << InstrumentId.Acoustic_Guitar_Steel) | (1 << InstrumentId.Acoustic_Guitar_Chord) | (1 << InstrumentId.Clean_Guitar) | (1 << InstrumentId.Electric_Guitar_Clean) | (1 << InstrumentId.Overdriven_Guitar) | (1 << InstrumentId.Distortion_Guitar);
export const IF_IS_SYNTH   = (1 << InstrumentId.Lead_1_Square) | (1 << InstrumentId.Lead_2_Sawtooth) | (1 << InstrumentId.Synth_Calliope) | (1 << InstrumentId.Synth_Brass_1) | (1 << InstrumentId.Synth_Lead);
export const IF_IS_PAD     = (1 << InstrumentId.Pad_1_NewAge) | (1 << InstrumentId.Pad_2_Warm) | (1 << InstrumentId.Pad_3_Polysynth) | (1 << InstrumentId.Synth_Strings_1);
export const IF_IS_STRING  = (1 << InstrumentId.String_Ensemble) | (1 << InstrumentId.String_Ensemble_2) | (1 << InstrumentId.Tremolo_Strings) | (1 << InstrumentId.Pizzicato_Strings) | (1 << InstrumentId.Violin) | (1 << InstrumentId.Cello) | (1 << InstrumentId.Contrabass);
export const IF_IS_VOICE   = (1 << InstrumentId.Voice_Oohs) | (1 << InstrumentId.Choir_Aahs) | (1 << InstrumentId.Solo_Vox);
export const IF_IS_DRUM    = (1 << InstrumentId.Standard_DrumKit) | (1 << InstrumentId.Electronic_DrumKit) | (1 << InstrumentId.TR808_DrumKit) | (1 << InstrumentId.Orchestral_DrumKit) | (1 << InstrumentId.Room_DrumKit);

/** T-1 合规：判断 InstrumentId 是否属于「钢琴/键盘」家族 */
export function isPianoFamily(id: InstrumentId): boolean {
    return InstrumentIdFamily[id] === InstrumentFamily.Piano;
}

/** T-1 合规：判断 InstrumentId 是否属于「吉他」家族 */
export function isGuitarFamily(id: InstrumentId): boolean {
    return InstrumentIdFamily[id] === InstrumentFamily.Guitar;
}

/** T-1 合规：判断 InstrumentId 是否属于 Pad/Synth/String/Voice（铺底音色） */
export function isPadLikeInstrument(id: InstrumentId): boolean {
    const fam = InstrumentIdFamily[id];
    return fam === InstrumentFamily.Synth || fam === InstrumentFamily.String || fam === InstrumentFamily.Voice;
}

/** T-1 合规：判断 InstrumentId 是否属于鼓组 */
export function isDrumInstrument(id: InstrumentId): boolean {
    return InstrumentIdFamily[id] === InstrumentFamily.Drums;
}

// ============================================================
// 🌟 声学包络分类 (Acoustic Envelope) — 配器规划系统
// ============================================================
export const enum AcousticEnvelope {
    Plucked   = 0, // 衰减打击类：钢琴/吉他/马林巴
    Sustained = 1, // 持续呼吸类：弦乐/管乐
    Pad       = 2, // 合成氛围类：Pad/Choir
    Bass      = 3, // 低频独占类：贝斯
}

export interface InstrumentProfile {
    envelope: AcousticEnvelope;
    safeRange: [number, number];
    maxVelocity: number;
    needsCC11: boolean;
}

export const InstrumentProfiles: InstrumentProfile[] = [
    /* 0  Acoustic_Grand    */ { envelope: AcousticEnvelope.Plucked, safeRange: [48, 84], maxVelocity: 100, needsCC11: false },
    /* 1  Electric_Piano_1  */ { envelope: AcousticEnvelope.Plucked, safeRange: [48, 79], maxVelocity: 90,  needsCC11: false },
    /* 2  Electric_Piano_2  */ { envelope: AcousticEnvelope.Plucked, safeRange: [48, 79], maxVelocity: 90,  needsCC11: false },
    /* 3  Warm_EP           */ { envelope: AcousticEnvelope.Plucked, safeRange: [48, 79], maxVelocity: 85,  needsCC11: false },
    /* 4  Lofi_Piano        */ { envelope: AcousticEnvelope.Plucked, safeRange: [48, 79], maxVelocity: 80,  needsCC11: false },
    /* 5  Rock_Organ        */ { envelope: AcousticEnvelope.Plucked, safeRange: [48, 84], maxVelocity: 95,  needsCC11: false },
    /* 6  Violin            */ { envelope: AcousticEnvelope.Sustained, safeRange: [55, 84], maxVelocity: 80, needsCC11: true },
    /* 7  Cello             */ { envelope: AcousticEnvelope.Sustained, safeRange: [36, 65], maxVelocity: 85, needsCC11: true },
    /* 8  Contrabass        */ { envelope: AcousticEnvelope.Sustained, safeRange: [28, 55], maxVelocity: 85, needsCC11: true },
    /* 9  String_Ensemble   */ { envelope: AcousticEnvelope.Pad,       safeRange: [48, 72], maxVelocity: 75, needsCC11: true },
    /* 10 String_Ensemble_2 */ { envelope: AcousticEnvelope.Pad,       safeRange: [48, 72], maxVelocity: 75, needsCC11: true },
    /* 11 Tremolo_Strings   */ { envelope: AcousticEnvelope.Sustained, safeRange: [48, 79], maxVelocity: 80, needsCC11: true },
    /* 12 Pizzicato_Strings */ { envelope: AcousticEnvelope.Plucked,   safeRange: [48, 79], maxVelocity: 95, needsCC11: false },
    /* 13 Flute             */ { envelope: AcousticEnvelope.Sustained, safeRange: [60, 84], maxVelocity: 85, needsCC11: true },
    /* 14 Oboe              */ { envelope: AcousticEnvelope.Sustained, safeRange: [58, 79], maxVelocity: 80, needsCC11: true },
    /* 15 Clarinet          */ { envelope: AcousticEnvelope.Sustained, safeRange: [50, 79], maxVelocity: 85, needsCC11: true },
    /* 16 Alto_Sax          */ { envelope: AcousticEnvelope.Sustained, safeRange: [55, 76], maxVelocity: 90, needsCC11: true },
    /* 17 Tenor_Sax         */ { envelope: AcousticEnvelope.Sustained, safeRange: [44, 72], maxVelocity: 90, needsCC11: true },
    /* 18 Muted_Trumpet     */ { envelope: AcousticEnvelope.Sustained, safeRange: [52, 79], maxVelocity: 85, needsCC11: true },
    /* 19 Recorder          */ { envelope: AcousticEnvelope.Sustained, safeRange: [60, 84], maxVelocity: 80, needsCC11: true },
    /* 20 Ocarina           */ { envelope: AcousticEnvelope.Sustained, safeRange: [60, 84], maxVelocity: 80, needsCC11: true },
    /* 21 Acoustic_Guitar_Nylon */ { envelope: AcousticEnvelope.Plucked, safeRange: [40, 76], maxVelocity: 95,  needsCC11: false },
    /* 22 Acoustic_Guitar_Steel */ { envelope: AcousticEnvelope.Plucked, safeRange: [40, 76], maxVelocity: 100, needsCC11: false },
    /* 23 Acoustic_Guitar_Chord */ { envelope: AcousticEnvelope.Plucked, safeRange: [40, 76], maxVelocity: 100, needsCC11: false },
    /* 24 Clean_Guitar          */ { envelope: AcousticEnvelope.Plucked, safeRange: [40, 79], maxVelocity: 95,  needsCC11: false },
    /* 25 Electric_Guitar_Clean */ { envelope: AcousticEnvelope.Plucked, safeRange: [40, 79], maxVelocity: 100, needsCC11: false },
    /* 26 Overdriven_Guitar     */ { envelope: AcousticEnvelope.Plucked, safeRange: [40, 79], maxVelocity: 110, needsCC11: false },
    /* 27 Distortion_Guitar     */ { envelope: AcousticEnvelope.Plucked, safeRange: [40, 79], maxVelocity: 115, needsCC11: false },
    /* 28 Harmonica              */ { envelope: AcousticEnvelope.Sustained, safeRange: [60, 79], maxVelocity: 85, needsCC11: true },
    /* 29 Acoustic_Bass      */ { envelope: AcousticEnvelope.Bass, safeRange: [28, 43], maxVelocity: 110, needsCC11: false },
    /* 30 Electric_Bass_Finger */ { envelope: AcousticEnvelope.Bass, safeRange: [28, 43], maxVelocity: 115, needsCC11: false },
    /* 31 Electric_Bass_Pick */ { envelope: AcousticEnvelope.Bass, safeRange: [28, 43], maxVelocity: 115, needsCC11: false },
    /* 32 Fretless_Bass      */ { envelope: AcousticEnvelope.Bass, safeRange: [28, 43], maxVelocity: 100, needsCC11: false },
    /* 33 Synth_Bass_1       */ { envelope: AcousticEnvelope.Bass, safeRange: [24, 43], maxVelocity: 100, needsCC11: false },
    /* 34 Synth_Bass_2       */ { envelope: AcousticEnvelope.Bass, safeRange: [24, 43], maxVelocity: 100, needsCC11: false },
    /* 35 Slap_Bass_1        */ { envelope: AcousticEnvelope.Bass, safeRange: [28, 43], maxVelocity: 110, needsCC11: false },
    /* 36 Lead_1_Square      */ { envelope: AcousticEnvelope.Plucked,   safeRange: [48, 84], maxVelocity: 100, needsCC11: false },
    /* 37 Lead_2_Sawtooth    */ { envelope: AcousticEnvelope.Plucked,   safeRange: [48, 84], maxVelocity: 100, needsCC11: false },
    /* 38 Synth_Calliope     */ { envelope: AcousticEnvelope.Sustained, safeRange: [48, 79], maxVelocity: 85,  needsCC11: true },
    /* 39 Synth_Brass_1      */ { envelope: AcousticEnvelope.Sustained, safeRange: [36, 79], maxVelocity: 90,  needsCC11: false },
    /* 40 Synth_Lead         */ { envelope: AcousticEnvelope.Plucked,   safeRange: [48, 84], maxVelocity: 100, needsCC11: false },
    /* 41 Pad_1_NewAge       */ { envelope: AcousticEnvelope.Pad, safeRange: [48, 72], maxVelocity: 70, needsCC11: true },
    /* 42 Pad_2_Warm         */ { envelope: AcousticEnvelope.Pad, safeRange: [48, 72], maxVelocity: 70, needsCC11: true },
    /* 43 Pad_3_Polysynth    */ { envelope: AcousticEnvelope.Pad, safeRange: [48, 72], maxVelocity: 75, needsCC11: true },
    /* 44 Synth_Strings_1    */ { envelope: AcousticEnvelope.Pad, safeRange: [48, 72], maxVelocity: 70, needsCC11: true },
    /* 45 Choir_Aahs   */ { envelope: AcousticEnvelope.Pad,     safeRange: [48, 72], maxVelocity: 75, needsCC11: true },
    /* 46 Voice_Oohs   */ { envelope: AcousticEnvelope.Pad,     safeRange: [48, 72], maxVelocity: 70, needsCC11: true },
    /* 47 Solo_Vox     */ { envelope: AcousticEnvelope.Pad,     safeRange: [48, 72], maxVelocity: 75, needsCC11: true },
    /* 48 Marimba      */ { envelope: AcousticEnvelope.Plucked, safeRange: [48, 76], maxVelocity: 105, needsCC11: false },
    /* 49 Vibraphone   */ { envelope: AcousticEnvelope.Plucked, safeRange: [60, 84], maxVelocity: 95,  needsCC11: false },
    /* 50-54 Drums     */ { envelope: AcousticEnvelope.Plucked, safeRange: [35, 81], maxVelocity: 127, needsCC11: false },
    { envelope: AcousticEnvelope.Plucked, safeRange: [35, 81], maxVelocity: 127, needsCC11: false },
    { envelope: AcousticEnvelope.Plucked, safeRange: [35, 81], maxVelocity: 127, needsCC11: false },
    { envelope: AcousticEnvelope.Plucked, safeRange: [35, 81], maxVelocity: 127, needsCC11: false },
    { envelope: AcousticEnvelope.Plucked, safeRange: [35, 81], maxVelocity: 127, needsCC11: false },
    /* 55 Reverse_Cymbal  */ { envelope: AcousticEnvelope.Plucked, safeRange: [48, 84], maxVelocity: 100, needsCC11: false },
    /* 56 Music_Box       */ { envelope: AcousticEnvelope.Plucked, safeRange: [72, 96], maxVelocity: 85,  needsCC11: false },
    /* 57 Glockenspiel    */ { envelope: AcousticEnvelope.Plucked, safeRange: [72, 96], maxVelocity: 90,  needsCC11: false },
    /* 58 Orchestral_Harp */ { envelope: AcousticEnvelope.Plucked, safeRange: [36, 84], maxVelocity: 95,  needsCC11: false },
    /* 59 System_Aura     */ { envelope: AcousticEnvelope.Pad,     safeRange: [48, 72], maxVelocity: 70,  needsCC11: false },
];

export function getInstrumentIdByName(name: string): InstrumentId {
    for (let id = 0; id < 60; id++) {
        if (InstrumentId[id] === name) return id as InstrumentId;
    }
    return InstrumentId.Acoustic_Grand;
}
```

### `src/core/generation/config/StyleRegistry.ts`

> 兼容适配层（re-export from styles/）；战役四：旧 `DefaultStyleConfig` / `DarkSynthPopStyleConfig` / `LoFiChillStyleConfig` 收敛为单一 `AcgStyleConfig`。所有消费方（PlaybackEngine / AuraBar / AuraJam / AuraRadio）已迁移到新名。

```ts
/**
 * 兼容适配层 — 将旧版 App 层 import 路径映射到新版 styles/ 子目录。
 * App 层代码 import { StyleRegistry } from 'config/StyleRegistry' 不需要修改。
 */
export { StyleRegistry, getAllAvailableStyles, getStyleConfig } from './styles/StyleRegistry';

import { getStyleConfig } from './styles/StyleRegistry';
import { StyleId } from './StyleFlags';

// 当前唯一注册风格，作为缺省/兜底配置
export const AcgStyleConfig = getStyleConfig(StyleId.AcgLightMusic);
```

### `src/core/generation/config/styles/StyleRegistry.ts`

> 战役四：唯一注册风格 `AcgStyle` — 删除 DefaultStyle / IndieAcousticStyle / RnBPopStyle，AcgStyle 改为自包含 StyleConfig（无 spread）。80~140 BPM / 王道-小室-丸谷-史诗进行 / `chromaticApproachProbability: 0.3` / `leapResolutionThreshold: 4` / `allowDrumless + allowBassless` 让动态编制器抽出独奏/全编两态。`getStyleConfig` 兜底也指向 `AcgStyle`。

```ts
import { StyleConfig } from '../../types';
import { Tonality } from '../../types';
import { StyleId } from '../StyleFlags';

// 🌟 ACG 轻音乐 — 当前唯一注册风格（包含春日、史诗、落日的基因）
const AcgStyle: StyleConfig = {
    id: StyleId.AcgLightMusic,
    name: '二次元轻音乐 (ACG Light Music)',
    // Viterbi 双阶段和声管线（影子骨架 → 骨架旋律 → Viterbi 选和弦）
    useViterbiHarmony: true,
    global: {
        bpmRange: [80, 140],
        timeSignaturePool: [{ signature: [4, 4] as [number, number], weight: 1.0 }],
        tonalityPool: [
            { tonality: Tonality.Major, weight: 0.30 },
            { tonality: Tonality.Minor, weight: 0.25 },
            { tonality: Tonality.Dorian, weight: 0.15 },
            { tonality: Tonality.Mixolydian, weight: 0.15 },
            { tonality: Tonality.Major_Pentatonic, weight: 0.08 },
            { tonality: Tonality.Minor_Pentatonic, weight: 0.07 },
        ],
    },
    harmony: {
        chorusPool: [
            ['IVmaj7', 'V', 'iii', 'vi'],                   // 王道进行
            ['vi', 'IVmaj7', 'I', 'V'],                     // 小室进行
            ['IVmaj7', 'III7', 'vi', 'I7'],                 // 丸谷进行
            ['bVI', 'bVII', 'I', 'I']                       // 史诗进行
        ],
        versePool: [
            ['I', 'V/VII', 'vi', 'I/V'],
            ['IVmaj7', 'I', 'IVmaj7', 'I'],
            ['vi', 'IV', 'I', 'V']
        ],
        preChorusPool: [
            ['ii7', 'V7', 'iii', 'vi'],
            ['IVmaj7', 'v', 'vi', 'I7']
        ],
    },
    harmonyRules: {
        maxDissonanceTolerance: 0.5,
        reharmProbability: 0.2,
        passingChords: ['SecondaryDominant', 'Diminished7'],
        voicingStyle: 'standard',
        allowTritoneSub: true,
        extensionProbability: 0.5,
        borrowedChords: ['ModalMixture', 'SecondaryDominant'],
        sectionTransitionPassingProb: 0.5,
    },
    rhythm: {
        densityBase: [0.4, 0.6],
        syncopationWeight: 0.2,
        restProbability: 0.15,
        disruptionProbability: 0.05,
        humanize: 0.01,
        swingRatio: 0.5,
        strictGrid: false,
        chordAnticipation: 0,
    },
    melody: {
        stepwiseRatio: 0.7,
        maxJumpInterval: 7,
        tensionTolerance: 0.5,
        mutationProbability: 0.3,
        mutationPool: ['inversion', 'retrograde'],
        leapResolutionThreshold: 4,
        breathingRoomProbability: 0.2,
        anchorProbability: 0.5,
        pentatonicPreference: 0.3,
        pentatonicShiftProbability: 0,
        chromaticPassingProbability: 0,
        chromaticApproachProbability: 0.3,        // 更多半音趋近
        passingToneChainProbability: 0.12,
        harmonicGravityStrength: 0.3,
        inflectionProbability: 0.15,
        laidBackTimingMax: 0,
        extensionTargeting: false,
        melismaProbability: 0,
        sequenceFreezeRhythm: false,
        chordMelodyProbability: 0,
        phraseLengthProfile: {
            name: 'pop',
            perSection: {
                verse:     [{ bars: 4, weight: 0.6 }, { bars: 8, weight: 0.4 }],
                preChorus: [{ bars: 4, weight: 0.7 }, { bars: 8, weight: 0.3 }],
                chorus:    [{ bars: 8, weight: 0.7 }, { bars: 4, weight: 0.3 }],
                bridge:    [{ bars: 8, weight: 0.6 }, { bars: 4, weight: 0.4 }],
                intro:     [{ bars: 4, weight: 1.0 }],
                outro:     [{ bars: 4, weight: 0.6 }, { bars: 8, weight: 0.4 }],
                default:   [{ bars: 4, weight: 1.0 }],
            },
            subMotifBarsPool: [
                { bars: 2, weight: 0.7 },
                { bars: 1, weight: 0.3 },
            ],
        },
    },
    contrast: {
        versePitchOffset: 0,
        verseDensityMultiplier: 1.0,
        chorusPitchOffset: 5,
    },
    orchestration: {
        allowDrumless: true,
        allowBassless: true,
        melodyInstruments: ['Acoustic_Grand'],
        chordInstruments: ['Acoustic_Grand'],
        bassInstruments: ['Acoustic_Bass', 'Synth_Bass_1'],
        drumInstruments: ['Standard_DrumKit', 'Room_DrumKit'],
        counterMelodyInstruments: [],
        texturePool: ['Block'],
        counterMelodyProbability: 0.0,
        vocalProbability: 0,
        allowTradingFours: false,
        mixingPreferences: {
            vocal:           { pan: 0,    reverb: 0.43, volume: 3 },
            melody:          { pan: 0,    reverb: 0.43, volume: 0 },
            secondaryMelody: { pan: 0.4,  reverb: 0.59, volume: -3, chorus: 40 },
            counterMelody:   { pan: -0.4, reverb: 0.59, volume: -4, chorus: 40 },
            chord:           { pan: 0.7,  reverb: 0.8,  volume: -4, chorus: 80 },
            drums:           { pan: 0,    reverb: 0.08, volume: 1 },
            bass:            { pan: 0,    reverb: 0,    volume: -2 },
        },
    },
    modulation: {
        probability: 0,
        targetSection: 'Chorus',
        intervalPool: [5, 7],
    },
    performance: {
        allowedPersonas: ['neutral'],
    },
};

export const StyleRegistry: Record<number, StyleConfig> = {
    [StyleId.AcgLightMusic]: AcgStyle,
};

export function getStyleConfig(styleId: StyleId): StyleConfig {
    return StyleRegistry[styleId] || AcgStyle;
}

export function getAllAvailableStyles(): StyleConfig[] {
    return Object.values(StyleRegistry);
}
```

### `src/core/generation/GlobalContext.ts`

> 🚧 STUB

```ts
// ============================================================
// 🚧 STUB — 全局生成上下文占位
// ============================================================
//
// 历史功能：
//   原 GlobalContextManager 是生成管道运行时的全局可变单例，
//   存储当前 BPM / 调式 / 调号 / 时间签名 / 当前段落 / 当前和弦 / GrooveDNA 等运行时状态。
//   阶段间通过它读写共享状态。
//
// 重构期占位行为：
//   保留单例公开 API（属性 + 方法签名），全部赋默认值或返回 no-op。
//   App 层（EndlessRadioManager / JamSessionManager）仅消费 currentTimeSignature，
//   保持其默认 [4, 4] 即可让 Jam 模式的拍量算法正常工作。
//
// 重构方向：
//   新引擎应优先消除对全局可变单例的依赖（生成管道纯函数化），
//   仅在需要给 App 层暴露"当前播放上下文"时保留这一层薄包装。
// ============================================================

import { GeneratedChord, SectionMetadata, StyleConfig, Tonality } from './types';
import { MoodId } from './config/MoodFlags';

class GlobalContextManager {
    public currentStyle: StyleConfig | null = null;
    public currentBPM: number = 120;
    public currentTimeSignature: [number, number] = [4, 4];
    public currentTonality: Tonality = Tonality.Major;
    public currentKeyOffset: number = 0;
    public globalAbsoluteBeat: number = 0;
    public currentMoodId?: MoodId;

    private currentGrooveDNA: number[] = [];
    private activeSection: SectionMetadata | null = null;
    private activeChord: GeneratedChord | null = null;

    public initializeNewEra(
        style: StyleConfig,
        bpm: number,
        keyOffset: number,
        tonality: Tonality,
        timeSignature: [number, number],
        moodId?: MoodId,
    ) {
        this.currentStyle = style;
        this.currentBPM = bpm;
        this.currentKeyOffset = keyOffset;
        this.currentTonality = tonality;
        this.currentTimeSignature = timeSignature;
        this.currentMoodId = moodId;
    }

    public updateCurrentSlice(section: SectionMetadata, chord: GeneratedChord, grooveDNA: number[]) {
        this.activeSection = section;
        this.activeChord = chord;
        this.currentGrooveDNA = grooveDNA;
    }

    public isGrooveHit(_absoluteBeat: number): boolean { return false; }
    public isLayeringHit(_absoluteBeat: number): boolean { return false; }
    public isInterleavingHit(_absoluteBeat: number): boolean { return false; }

    public getCurrentEnergyLevel(): number {
        return this.activeSection ? this.activeSection.energyLevel : 5;
    }
    public getCurrentChord(): GeneratedChord | null { return this.activeChord; }
    public getActiveSection(): SectionMetadata | null { return this.activeSection; }

    public reset() {
        this.currentStyle = null;
        this.currentBPM = 120;
        this.currentTimeSignature = [4, 4];
        this.currentTonality = Tonality.Major;
        this.currentKeyOffset = 0;
        this.globalAbsoluteBeat = 0;
        this.currentGrooveDNA = [];
        this.activeSection = null;
        this.activeChord = null;
    }
}

export const GlobalContext = new GlobalContextManager();
```

### `src/core/generation/theory/MusicTheory.ts`

> ✅ 涌现式音乐性重构 + 反浑浊开放排列 + 战役二 Slash Chords — `parseNumeral` 正则末尾追加 `(?:\/([b#]?)(罗马))?` 捕获斜杠后低音，输出新增可选 `bassOverride` 字段（0~11 相对 pc，按调式自动适配：小调 `/III=3` `/VI=8` `/VII=10`）。`getSmoothVoicing` 第二阶段反浑浊：和弦音 ≥4 时扫描相邻二度对并把上方音拔高八度，迭代上限 5 次。

```ts
// ============================================================
// MusicTheory — 纯工具类（无状态、无 PRNG、无 IO）
// ============================================================
// Pitch Space: RELATIVE（所有输入/输出都在相对音高空间，主音 = 0）
// 仅做查表与最近邻吸附，不做 keyOffset 转换。
// ============================================================

import { Tonality, ChordQuality, SCALE_INTERVALS, CHORD_INTERVALS } from '../types';

// ★ 严格扩展后缀正则：覆盖 maj9/maj7/m11/m9/m7/m7b5/dim7/dim/aug/add9/7sus4/sus4/13/11/9/7/m/ø/+
//   长串优先（maj9 在 maj7 之前），避免 'IVadd9' 被部分截走 → 回退 root=0 的致命 bug。
const NUMERAL_REGEX =
    /^([b#]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(maj9|maj7|m7b5|m11|m9|m7|dim7|dim|aug|add9|7sus4|sus4|13|11|9|7|ø|\+|m)?(?:\/([b#]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i))?$/;

export class MusicTheory {
    /**
     * 获取相对音阶数组（半音偏移，相对主音）。
     * Pitch Space: RELATIVE
     */
    public static getScalePitches(tonality: Tonality): number[] {
        return SCALE_INTERVALS[tonality];
    }

    /**
     * 获取和弦相对音程（相对根音的半音偏移）。
     * Pitch Space: RELATIVE
     */
    public static getChordTones(quality: ChordQuality): number[] {
        return CHORD_INTERVALS[quality];
    }

    /**
     * 将给定的相对音高就近吸附到 tonality 音阶内。
     * 输入与输出都是相对音高（保留 octave，仅修正 pitch class）。
     * Pitch Space: RELATIVE → RELATIVE
     */
    public static snapToScale(pitch: number, tonality: Tonality): number {
        const scale = SCALE_INTERVALS[tonality];
        const octave = Math.floor(pitch / 12);
        const pc = pitch - octave * 12; // 0~11

        let bestNote = scale[0];
        let bestDist = Math.abs(pc - scale[0]);
        for (let i = 1; i < scale.length; i++) {
            const d = Math.abs(pc - scale[i]);
            if (d < bestDist) {
                bestDist = d;
                bestNote = scale[i];
            }
        }
        return octave * 12 + bestNote;
    }

    /**
     * 将给定的相对音高就近吸附到任意 pitch class 池内（环形音程距离）。
     * 与 snapToScale 的区别：
     *   - 池可以是任意 0~11 集合（如和弦音、五声音阶等）
     *   - 三个候选八度中选与原 pitch 绝对距离最小者，避免被强行拉到远八度
     * Pitch Space: RELATIVE → RELATIVE
     */
    public static snapToPool(pitch: number, poolPcs: number[]): number {
        if (poolPcs.length === 0) return pitch;

        const pc = ((pitch % 12) + 12) % 12;
        const octave = Math.floor(pitch / 12);

        // 1) 环形距离找最近 pc
        let bestPc = poolPcs[0];
        let firstDiff = Math.abs(pc - poolPcs[0]);
        let bestDist = Math.min(firstDiff, 12 - firstDiff);
        for (let i = 1; i < poolPcs.length; i++) {
            const diff = Math.abs(pc - poolPcs[i]);
            const d = Math.min(diff, 12 - diff);
            if (d < bestDist) {
                bestDist = d;
                bestPc = poolPcs[i];
            }
        }

        // 2) 三个候选八度中选与原 pitch 绝对距离最近的
        const cand0 = bestPc + (octave - 1) * 12;
        const cand1 = bestPc + octave * 12;
        const cand2 = bestPc + (octave + 1) * 12;

        let best = cand0;
        let bestAbs = Math.abs(pitch - cand0);

        const d1 = Math.abs(pitch - cand1);
        if (d1 < bestAbs) { bestAbs = d1; best = cand1; }

        const d2 = Math.abs(pitch - cand2);
        if (d2 < bestAbs) { bestAbs = d2; best = cand2; }

        return best;
    }

    /**
     * 平滑声部连接 + 反浑浊开放排列（Anti-Mud Open Voicing）。
     *
     * 第一阶段（声部平滑）：
     * - 第一个和弦（无 prevVoicing）：每个 pc 就近吸到 targetCenter 附近
     * - 后续和弦：每个 pc 就近吸到 prevVoicing 的平均高度附近
     *
     * 第二阶段（反浑浊，仅 chordPcs.length >= 4 时启用）：
     * - 排序后扫描相邻音对，凡距离 <= 2 半音（大/小二度）即把上方音拔高八度
     * - 拔高后立刻重新排序再扫，直到无相邻二度对或迭代上限 5
     * - 解决 Viterbi 引入 maj9 / m11 / 13 后挤压在同八度内的"音簇浑浊"问题
     *
     * Pitch Space: RELATIVE → RELATIVE
     */
    public static getSmoothVoicing(
        chordPcs: number[],
        prevVoicing: number[],
        targetCenter: number
    ): number[] {
        const result: number[] = [];
        let center = targetCenter;

        if (prevVoicing && prevVoicing.length > 0) {
            let sum = 0;
            for (let i = 0; i < prevVoicing.length; i++) sum += prevVoicing[i];
            center = sum / prevVoicing.length;
        }

        // 1) 初步就近吸附
        for (let i = 0; i < chordPcs.length; i++) {
            result.push(this.snapToPool(center, [chordPcs[i]]));
        }
        result.sort((a, b) => a - b);

        // 2) 反浑浊开放排列（七和弦及以上，强行拆解二度音簇让扩展音上八度）
        if (result.length >= 4) {
            let hasCluster = true;
            let iterations = 0;
            while (hasCluster && iterations < 5) {
                hasCluster = false;
                for (let i = 1; i < result.length; i++) {
                    if (result[i] - result[i - 1] <= 2) {
                        result[i] += 12;
                        hasCluster = true;
                        break;  // 打断，重新排序后再次从头扫描
                    }
                }
                if (hasCluster) result.sort((a, b) => a - b);
                iterations++;
            }
        }

        return result;
    }

    /**
     * Drop-2 开放排列：将升序 voicing 的次高音降一个八度，拉开和声空间防浑浊。
     * 三和弦（<4 音）原样返回。
     * Pitch Space: RELATIVE → RELATIVE
     */
    public static getDrop2Voicing(voicing: number[]): number[] {
        if (voicing.length < 4) return voicing;
        const result = [...voicing];
        result.sort((a, b) => a - b);
        const dropIdx = result.length - 2;
        result[dropIdx] -= 12;
        result.sort((a, b) => a - b);
        return result;
    }

    /**
     * 解析罗马数字和弦记号到 { root, quality }。
     *
     * 输入示例：'I' / 'vi' / 'V7' / 'IVmaj7' / 'iim7' / 'bVII' /
     *           'Vsus4' / 'Iadd9' / 'V9' / 'iim11' / 'IVaug' / 'viiø'。
     *
     * 解析规则（一次正则切分，杜绝 replace 残留导致的回退到 root=0）：
     *   1) `^([b#]?)(罗马字符)(扩展后缀?)$` —— 罗马串长串优先（VII>VI>V，III>II>I）
     *   2) 罗马字符大小写决定基础三和弦（大写=Major / 小写=Minor）
     *   3) 小调 tonality 下做自然小调级数适配（仅当无升降前缀时）
     *   4) 扩展后缀按"长串优先"严格枚举：maj9 / maj7 / m11 / m9 / m7b5 / m7 / dim7 / dim / aug / add9 / 7sus4 / sus4 / 13 / 11 / 9 / 7 / ø / + / m
     *
     * 解析失败（非法记号）回退 { root: 0, quality: Major } 并依赖上层日志记录。
     *
     * Pitch Space: RELATIVE
     */
    public static parseNumeral(numeral: string, tonality?: Tonality): { root: number; quality: ChordQuality; bassOverride?: number } {
        const m = numeral.match(NUMERAL_REGEX);
        if (!m) return { root: 0, quality: ChordQuality.Major };

        const accidental = m[1] ?? '';
        const roman = m[2];
        const suffix = (m[3] ?? '').toLowerCase();
        const upperRoman = roman.toUpperCase();
        const isMinorStr = roman === roman.toLowerCase();

        // 罗马 → root（半音偏移）
        let root = 0;
        if (upperRoman === 'I')        root = 0;
        else if (upperRoman === 'II')  root = 2;
        else if (upperRoman === 'III') root = 4;
        else if (upperRoman === 'IV')  root = 5;
        else if (upperRoman === 'V')   root = 7;
        else if (upperRoman === 'VI')  root = 9;
        else if (upperRoman === 'VII') root = 11;

        let offset = 0;
        if (accidental === 'b') offset = -1;
        else if (accidental === '#') offset = 1;
        let targetRoot = (root + offset + 12) % 12;

        // 基础 quality：大小写决定
        let quality = isMinorStr ? ChordQuality.Minor : ChordQuality.Major;

        // 小调适配（仅 natural diatonic，无升降前缀时）
        const isMinorTonality =
            tonality !== undefined &&
            (tonality === Tonality.Minor ||
                tonality === Tonality.Minor_Pentatonic ||
                tonality === Tonality.Melodic_Minor ||
                tonality === Tonality.Harmonic_Minor ||
                tonality === Tonality.Phrygian ||
                tonality === Tonality.Dorian ||
                tonality === Tonality.Blues);
        if (isMinorTonality && accidental === '') {
            if (upperRoman === 'I')        { quality = ChordQuality.Minor; }
            else if (upperRoman === 'II')  { quality = ChordQuality.Diminished; }
            else if (upperRoman === 'III') { targetRoot = 3; quality = ChordQuality.Major; }
            else if (upperRoman === 'IV')  { quality = ChordQuality.Minor; }
            else if (upperRoman === 'V')   { quality = ChordQuality.Minor; }
            else if (upperRoman === 'VI')  { targetRoot = 8; quality = ChordQuality.Major; }
            else if (upperRoman === 'VII') { targetRoot = 10; quality = ChordQuality.Major; }
        }

        // 扩展后缀：长串优先匹配（maj9 比 maj7 长，必须先匹配）
        if (suffix.length > 0) {
            if (suffix === 'ø' || suffix === 'm7b5') quality = ChordQuality.HalfDiminished;
            else if (suffix === 'dim7') quality = ChordQuality.Diminished7;
            else if (suffix === 'dim')  quality = ChordQuality.Diminished;
            else if (suffix === 'aug' || suffix === '+') quality = ChordQuality.Augmented;
            else if (suffix === 'maj9') quality = ChordQuality.Major9;
            else if (suffix === 'maj7') quality = ChordQuality.Major7;
            else if (suffix === 'm11')  quality = ChordQuality.Minor11;
            else if (suffix === 'm9')   quality = ChordQuality.Minor9;
            else if (suffix === 'm7')   quality = ChordQuality.Minor7;
            else if (suffix === 'm')    quality = ChordQuality.Minor;
            else if (suffix === 'add9') quality = ChordQuality.Add9;
            else if (suffix === '7sus4') quality = ChordQuality.Dominant7Sus4;
            else if (suffix === 'sus4') quality = ChordQuality.Sus4;
            else if (suffix === '13')   quality = ChordQuality.Dominant13;
            else if (suffix === '11')   quality = ChordQuality.Minor11;
            else if (suffix === '9') {
                quality = isMinorStr ? ChordQuality.Minor9 : ChordQuality.Dominant9;
            }
            else if (suffix === '7') {
                if (quality === ChordQuality.Major) quality = ChordQuality.Dominant7;
                else if (quality === ChordQuality.Minor) quality = ChordQuality.Minor7;
                else if (quality === ChordQuality.Diminished) quality = ChordQuality.Diminished7;
            }
        }

        let bassOverride: number | undefined = undefined;
        if (m[5]) {
            const bassAcc = m[4] ?? '';
            const bassRoman = m[5].toUpperCase();
            let bRoot = 0;
            if (bassRoman === 'I')        bRoot = 0;
            else if (bassRoman === 'II')  bRoot = 2;
            else if (bassRoman === 'III') bRoot = 4;
            else if (bassRoman === 'IV')  bRoot = 5;
            else if (bassRoman === 'V')   bRoot = 7;
            else if (bassRoman === 'VI')  bRoot = 9;
            else if (bassRoman === 'VII') bRoot = 11;

            let bOffset = 0;
            if (bassAcc === 'b') bOffset = -1;
            else if (bassAcc === '#') bOffset = 1;

            if (isMinorTonality && bassAcc === '') {
                if (bassRoman === 'III') bRoot = 3;
                else if (bassRoman === 'VI') bRoot = 8;
                else if (bassRoman === 'VII') bRoot = 10;
            }
            bassOverride = (bRoot + bOffset + 12) % 12;
        }

        return { root: targetRoot, quality, ...(bassOverride !== undefined ? { bassOverride } : {}) };
    }
}
```

### `src/core/generation/harmony/HarmonyCore.ts`

> ✅ 涌现式音乐性重构 — 废除 `CHORD_DURATION_BEATS=4`：(1) 子小节解析 `'vi,IV'` → 各 2 拍、`'i,bVII,VI,V'` → 各 1 拍；(2) 抢拍 (Anticipation)：energyLevel>=6 段、非段首和弦 30% 概率提前 0.5 拍切入，并回写前一和弦 `endBeat` 让节拍咬合；安全闸门保证前一和弦残留 ≥ 0.5 拍，否则撤销。

```ts
// ============================================================
// HarmonyCore — 节奏骨架分裂 + 抢拍 (Anticipation)
// ============================================================
// Pitch Space: RELATIVE（chord.root 是 0~11，相对调式主音的半音偏移）
//
// 重构要点（vs 老版"一小节一换"）：
//   1) 子小节解析：'vi,IV' → 两个时长各 2 拍的和弦平分一小节
//      'i,bVII,VI,V' → 四个时长各 1 拍的和弦平分一小节
//   2) 抢拍 (Anticipation)：高能段（energyLevel >= 6）非段首和弦
//      30% 概率提前 0.5 拍切入（八分音符切分），并修正前一和弦的 endBeat
//      让节拍咬合无缝（不能让前一和弦短到 < 0.5 拍，否则撤销抢拍）
//   3) 段落 → pool 映射：Chorus → chorusPool / PreChorus → preChorusPool / 其它 → versePool
//
// PRNG 消耗（按和弦推进）：
//   - 每段开头：×1（pool 内选进行）
//   - 每个非段首和弦（高能段）：×1（抢拍判定）
// ============================================================

import { GeneratedChord, SectionMetadata, StyleConfig, Tonality, ChordQualityName } from '../types';
import { PRNGManager } from '../../utils/PRNG';
import { MusicTheory } from '../theory/MusicTheory';

const BEAT_EPS = 0.001;
const BAR_BEATS = 4;                  // 每小节默认 4 拍（4/4 假设，与现有管线一致）
const ANTICIPATION_BEAT = 0.5;        // 八分音符切分提前量
const ANTICIPATION_PROB = 0.30;       // 高能段触发抢拍的概率
const HIGH_ENERGY_THRESHOLD = 6;      // 启用抢拍的能量阈值
const MIN_PREV_CHORD_AFTER_ANTICIPATE = 0.5;  // 抢拍后前一和弦最短残留时长（避免 1/16 碎片）

export class HarmonyCore {
    public static generateHarmonyTimeline(
        sections: SectionMetadata[],
        style: StyleConfig,
        tonality: Tonality,
        keyOffset: number
    ): GeneratedChord[] {
        const chords: GeneratedChord[] = [];

        for (let s = 0; s < sections.length; s++) {
            const sec = sections[s];

            let pool = style.harmony.versePool;
            if (sec.name === 'Chorus') pool = style.harmony.chorusPool;
            else if (sec.name === 'PreChorus') pool = style.harmony.preChorusPool;

            const progStr = pool[PRNGManager.nextInt(0, pool.length - 1)];
            const isHighEnergy = sec.energyLevel >= HIGH_ENERGY_THRESHOLD;

            let b = sec.startBeat;
            let progIdx = 0;
            let isFirstChordInSection = true;

            while (b < sec.endBeat - BEAT_EPS) {
                const slot = progStr[progIdx % progStr.length];

                // ★ 子小节解析：逗号分隔 → 平分 BAR_BEATS
                const tokens = slot.indexOf(',') >= 0 ? slot.split(',') : [slot];
                const subBeats = BAR_BEATS / tokens.length;

                for (let k = 0; k < tokens.length && b < sec.endBeat - BEAT_EPS; k++) {
                    const numeral = tokens[k].trim();
                    const parsed = MusicTheory.parseNumeral(numeral, tonality);

                    let endBeat = b + subBeats;
                    if (endBeat > sec.endBeat) endBeat = sec.endBeat;
                    let startBeat = b;

                    // ★ 抢拍：高能段 + 非段首 + 30% 概率
                    if (isHighEnergy && !isFirstChordInSection) {
                        if (PRNGManager.nextFloat(0, 1) < ANTICIPATION_PROB) {
                            const candidateStart = b - ANTICIPATION_BEAT;
                            // 安全闸门：抢拍后前一和弦残留时长必须 >= 0.5 拍
                            if (chords.length > 0) {
                                const prev = chords[chords.length - 1];
                                if (candidateStart - prev.startBeat >= MIN_PREV_CHORD_AFTER_ANTICIPATE - BEAT_EPS) {
                                    prev.endBeat = candidateStart;
                                    startBeat = candidateStart;
                                }
                            }
                        }
                    }

                    chords.push({
                        numeral,
                        root: parsed.root,
                        quality: ChordQualityName[parsed.quality] as GeneratedChord['quality'],
                        startBeat,
                        endBeat,
                        keyOffset,
                        ...(parsed.bassOverride !== undefined ? { bassOverride: parsed.bassOverride } : {}),
                    });

                    // 推进游标到原 grid 边界（不抢拍即正常推进；抢拍只改 startBeat 不改 grid）
                    b = endBeat;
                    isFirstChordInSection = false;
                }

                progIdx++;
            }
        }

        return chords;
    }
}
```

### `src/core/generation/harmony/ViterbiChordSelector.ts`

> ✅ 涌现式音乐性重构 — 砍掉硬编码 MAJOR/MINOR_CANDIDATES 常量；`buildCandidates()` 动态合并：顺阶 ∪ 5 借调色彩（bVI/bIII/iv/bII/bVII）∪ 骨架保底（`(root<<5)|quality` 整数去重，无 Map/Set）。新增 `tensionMultiplier`（0~1）：离调惩罚 `-10×(1-tension)`、半音平滑 `+6`、bVI→V 黄金 `+5`。让 1-6-b6-5 这类神级编配自发涌现。DP 仍是 `Float32Array` + `Int32Array` 扁平矩阵，零对象分配。

```ts
// ============================================================
// ViterbiChordSelector — 张力驱动的 HMM + Viterbi 智能重配
// ============================================================
// Pitch Space: RELATIVE（candidates 的 root 全部 0~11，相对调式主音）
//
// 算法概览：
//   - 输入  basicChords (HarmonyCore 骨架) + melody + tonality + tensionMultiplier
//   - 状态  N 个候选和弦（动态构建：顺阶 ∪ 借调色彩 ∪ 骨架保底）
//   - 时间  T 个槽位（与 basicChords 一一对应，保留时间结构）
//   - DP    V[t][i] = 到第 t 步选第 i 个候选的最佳累计分
//           ptr[t][i] = 选 i 时的最优前驱 prev
//   - 终止  全曲末尾给主音和弦 (root=0) 额外 +10 分以倾向收束
//
// 评分维度：
//   emission(cand, slice)     — 旋律音落入候选和弦音得 +5×duration，落外 -3×duration
//   transition(prev, curr)    — 环形距离 + 张力门 + 半音平滑 + bVI→V 黄金奖励
//
// tensionMultiplier (0.0 ~ 1.0)：
//   - 0.0 → 离调被强烈惩罚 (-10)，乖乖弹原调
//   - 1.0 → 离调零惩罚，开始秀操作（神级编配 1-6-b6-5 自发涌现）
//   - 由 runPipeline 按段落传入：第一段 Chorus = 0.2，Final Chorus / Bridge = 1.0
//
// C++ 移植：DP 矩阵全部用 Float32Array (V) 和 Int32Array (ptr) 扁平化，
//   索引 t*N + i，零内部对象分配，零 GC 压力。
// ============================================================

import { GeneratedChord, NoteData, Tonality, ChordQuality, ChordQualityName, SCALE_INTERVALS } from '../types';
import { MusicTheory } from '../theory/MusicTheory';

interface ChordCandidate {
    numeral: string;
    root: number;
    quality: ChordQuality;
}

const BEAT_EPS = 0.001;
const NEG_INF = -999999;

// 评分权重（emission / 末态）
const EMIT_IN_CHORD = 5.0;
const EMIT_OUT_OF_CHORD = 3.0;
const INIT_TONIC_BONUS = 5.0;
const INIT_MATCH_BONUS = 5.0;
const SKELETON_MATCH_BONUS = 4.0;
const FINAL_TONIC_BONUS = 10.0;

// 评分权重（transition：基础环形距离）
const TRANS_FOURTH = 8.0;
const TRANS_FIFTH = 4.0;
const TRANS_SECOND = 2.0;
const TRANS_THIRD = 1.0;
const TRANS_TRITONE_PENALTY = 5.0;
const TRANS_REPEAT_PENALTY = 4.0;
const TRANS_V7_TO_I_BONUS = 5.0;

// 评分权重（transition：高级法则）
const BORROWED_PENALTY_MAX = 10.0;   // 离调最大惩罚（tension=0 时全额扣）
const CHROMATIC_SMOOTH_BONUS = 6.0;  // 半音平滑（vi→bVI→V 类）
const BVI_TO_V_BONUS = 5.0;          // bVI(8) → V(7) 黄金进行

export class ViterbiChordSelector {
    /**
     * @param basicChords        HarmonyCore 骨架（已含 startBeat / endBeat / keyOffset）
     * @param melody             已生成的旋律（相对空间 pitch）
     * @param tonality           调式
     * @param tensionMultiplier  张力乘数 0~1（默认 0.5 — 中等张力，向后兼容旧调用）
     */
    public static reharmonize(
        basicChords: GeneratedChord[],
        melody: NoteData[],
        tonality: Tonality,
        tensionMultiplier: number = 0.5,
    ): GeneratedChord[] {
        const tension = tensionMultiplier < 0 ? 0 : tensionMultiplier > 1 ? 1 : tensionMultiplier;

        const candidates = this.buildCandidates(tonality, basicChords);
        const diatonicMask = this.buildDiatonicMask(tonality);

        const T = basicChords.length;
        const N = candidates.length;
        if (T === 0) return [];

        // 扁平 DP 矩阵：dp[t * N + i] / ptr[t * N + i]
        const dp = new Float32Array(T * N);
        const ptr = new Int32Array(T * N);

        // 预切片：每个时间槽内的旋律音，避免内层重复扫描全曲
        const melodySlices: NoteData[][] = [];
        for (let t = 0; t < T; t++) {
            const c = basicChords[t];
            const slice: NoteData[] = [];
            for (let i = 0; i < melody.length; i++) {
                const n = melody[i];
                if (n.onset >= c.startBeat - BEAT_EPS && n.onset < c.endBeat - BEAT_EPS) {
                    slice.push(n);
                }
            }
            melodySlices.push(slice);
        }

        // t=0 初始化：emission + 主音 / 骨架匹配奖励
        for (let i = 0; i < N; i++) {
            const em = this.getEmissionScore(candidates[i], melodySlices[0]);
            let trans = 0;
            if (candidates[i].root === 0) trans += INIT_TONIC_BONUS;
            if (candidates[i].root === basicChords[0].root) trans += INIT_MATCH_BONUS;
            dp[i] = em + trans;
            ptr[i] = -1;
        }

        // t=1..T-1 转移
        for (let t = 1; t < T; t++) {
            const slice = melodySlices[t];
            const origChord = basicChords[t];

            for (let currIdx = 0; currIdx < N; currIdx++) {
                const curr = candidates[currIdx];
                const em = this.getEmissionScore(curr, slice);
                let maxVal = NEG_INF;
                let bestPrev = 0;

                for (let prevIdx = 0; prevIdx < N; prevIdx++) {
                    const prev = candidates[prevIdx];
                    let trans = this.getTransitionScore(prev, curr, diatonicMask, tension);

                    // 骨架匹配：与 HarmonyCore 原推荐根音一致额外加分（保留风格池倾向）
                    if (curr.root === origChord.root) trans += SKELETON_MATCH_BONUS;
                    // 末态收束：最后一拍倾向主音
                    if (t === T - 1 && curr.root === 0) trans += FINAL_TONIC_BONUS;

                    const val = dp[(t - 1) * N + prevIdx] + trans + em;
                    if (val > maxVal) {
                        maxVal = val;
                        bestPrev = prevIdx;
                    }
                }
                dp[t * N + currIdx] = maxVal;
                ptr[t * N + currIdx] = bestPrev;
            }
        }

        // 末态选择：argmax + 主音奖励
        let bestLast = 0;
        let maxV = NEG_INF;
        for (let i = 0; i < N; i++) {
            let score = dp[(T - 1) * N + i];
            if (candidates[i].root === 0) score += FINAL_TONIC_BONUS;
            if (score > maxV) {
                maxV = score;
                bestLast = i;
            }
        }

        // 回溯 path
        const path: number[] = [];
        let currState = bestLast;
        for (let t = T - 1; t >= 0; t--) {
            path.push(currState);
            currState = ptr[t * N + currState];
        }
        path.reverse();

        // 装配输出（保持原 startBeat / endBeat / keyOffset，含抢拍后的非整拍切分）
        const finalChords: GeneratedChord[] = [];
        for (let t = 0; t < T; t++) {
            const cand = candidates[path[t]];
            const orig = basicChords[t];
            // 保留原始 slash-chord bassOverride（仅当 Viterbi 维持了同根音的和弦时）
            const preserveBass = orig.bassOverride !== undefined && cand.root === orig.root;
            finalChords.push({
                numeral: cand.numeral,
                root: cand.root,
                quality: ChordQualityName[cand.quality] as GeneratedChord['quality'],
                startBeat: orig.startBeat,
                endBeat: orig.endBeat,
                keyOffset: orig.keyOffset,
                ...(preserveBass ? { bassOverride: orig.bassOverride } : {}),
            });
        }
        return finalChords;
    }

    // --------------------------------------------------------
    // 候选池构建：顺阶 ∪ 借调 ∪ 骨架保底
    // --------------------------------------------------------
    /**
     * 用 (root << 5 | quality) 做唯一性比较——root 0~11 占 4 bit、quality 0~16 占 5 bit，
     * 单 int 编码 (root, quality) 对，避免 Map/Set（rule P-1）。
     * 总数控制在 25-30 个内（性能上限），实际通常 ~20。
     */
    private static buildCandidates(
        tonality: Tonality,
        basicChords: GeneratedChord[],
    ): ChordCandidate[] {
        const isMinor =
            tonality === Tonality.Minor ||
            tonality === Tonality.Minor_Pentatonic ||
            tonality === Tonality.Dorian ||
            tonality === Tonality.Melodic_Minor ||
            tonality === Tonality.Harmonic_Minor ||
            tonality === Tonality.Phrygian ||
            tonality === Tonality.Blues;

        const merged: ChordCandidate[] = [];
        const seen: number[] = [];

        const add = (cand: ChordCandidate) => {
            const key = (cand.root << 5) | cand.quality;
            for (let i = 0; i < seen.length; i++) {
                if (seen[i] === key) return;
            }
            merged.push(cand);
            seen.push(key);
        };

        // 1) 顺阶和弦（提取自当前 tonality）
        if (isMinor) {
            add({ numeral: 'i',      root: 0,  quality: ChordQuality.Minor });
            add({ numeral: 'iidim',  root: 2,  quality: ChordQuality.Diminished });
            add({ numeral: 'III',    root: 3,  quality: ChordQuality.Major });
            add({ numeral: 'iv',     root: 5,  quality: ChordQuality.Minor });
            add({ numeral: 'v',      root: 7,  quality: ChordQuality.Minor });
            add({ numeral: 'V',      root: 7,  quality: ChordQuality.Major });        // 和声小调 V
            add({ numeral: 'V7',     root: 7,  quality: ChordQuality.Dominant7 });    // 和声小调 V7
            add({ numeral: 'VI',     root: 8,  quality: ChordQuality.Major });
            add({ numeral: 'VII',    root: 10, quality: ChordQuality.Major });
            // 七和弦色彩
            add({ numeral: 'i7',     root: 0,  quality: ChordQuality.Minor7 });
            add({ numeral: 'iv7',    root: 5,  quality: ChordQuality.Minor7 });
            add({ numeral: 'VImaj7', root: 8,  quality: ChordQuality.Major7 });
        } else {
            add({ numeral: 'I',      root: 0,  quality: ChordQuality.Major });
            add({ numeral: 'ii',     root: 2,  quality: ChordQuality.Minor });
            add({ numeral: 'iii',    root: 4,  quality: ChordQuality.Minor });
            add({ numeral: 'IV',     root: 5,  quality: ChordQuality.Major });
            add({ numeral: 'V',      root: 7,  quality: ChordQuality.Major });
            add({ numeral: 'vi',     root: 9,  quality: ChordQuality.Minor });
            add({ numeral: 'viidim', root: 11, quality: ChordQuality.Diminished });
            // 七和弦色彩
            add({ numeral: 'Imaj7',  root: 0,  quality: ChordQuality.Major7 });
            add({ numeral: 'ii7',    root: 2,  quality: ChordQuality.Minor7 });
            add({ numeral: 'IVmaj7', root: 5,  quality: ChordQuality.Major7 });
            add({ numeral: 'V7',     root: 7,  quality: ChordQuality.Dominant7 });
            add({ numeral: 'vi7',    root: 9,  quality: ChordQuality.Minor7 });
        }

        // 2) 常见借调/离调色彩和弦（无视 tonality 一律开放，由 tension gate 控制使用）
        add({ numeral: 'bVI',  root: 8,  quality: ChordQuality.Major });    // 平行小调借（神级 1-6-b6-5 关键和弦）
        add({ numeral: 'bIII', root: 3,  quality: ChordQuality.Major });    // 平行小调借
        add({ numeral: 'iv',   root: 5,  quality: ChordQuality.Minor });    // modal mixture（大调借小四）
        add({ numeral: 'bII',  root: 1,  quality: ChordQuality.Major });    // Neapolitan
        add({ numeral: 'bVII', root: 10, quality: ChordQuality.Major });    // Mixolydian

        // 3) 骨架保底：风格池里出现的所有 (root, quality) 唯一对一定能选回来
        for (let i = 0; i < basicChords.length; i++) {
            const ch = basicChords[i];
            const qEnum = ChordQuality[ch.quality as keyof typeof ChordQuality];
            if (qEnum === undefined) continue;
            add({ numeral: ch.numeral, root: ch.root, quality: qEnum });
        }

        return merged;
    }

    /**
     * 当前调式的 pitch class 位掩码（bit i 设位 = i 是顺阶音）。
     * 用于 transition 中判断 curr.root 是否为离调和弦根（O(1) 位运算）。
     */
    private static buildDiatonicMask(tonality: Tonality): number {
        const intervals = SCALE_INTERVALS[tonality];
        let mask = 0;
        for (let i = 0; i < intervals.length; i++) {
            mask |= (1 << intervals[i]);
        }
        return mask | 0;
    }

    /**
     * 发射分：旋律音落入候选和弦音得 +5×duration，落外 -3×duration。
     * 没有旋律音时返回 0（不影响候选偏好）。
     */
    private static getEmissionScore(cand: ChordCandidate, notes: NoteData[]): number {
        if (notes.length === 0) return 0;

        const intervals = MusicTheory.getChordTones(cand.quality);
        const chordPcs: number[] = [];
        for (let i = 0; i < intervals.length; i++) {
            chordPcs.push(((cand.root + intervals[i]) % 12 + 12) % 12);
        }

        let score = 0;
        for (let i = 0; i < notes.length; i++) {
            const note = notes[i];
            const pc = ((Math.round(note.pitch) % 12) + 12) % 12;

            let inChord = false;
            for (let j = 0; j < chordPcs.length; j++) {
                if (chordPcs[j] === pc) {
                    inChord = true;
                    break;
                }
            }

            if (inChord) score += note.duration * EMIT_IN_CHORD;
            else score -= note.duration * EMIT_OUT_OF_CHORD;
        }
        return score;
    }

    /**
     * 转移分：基础环形距离 + 张力门 + 半音平滑 + 黄金进行。
     *
     * 1. 环形距离（保留旧逻辑）
     *    diff 5  上四度 / V→I 类         +8
     *    diff 7  上五度                   +4
     *    diff 2/10 二度                   +2
     *    diff 3/4/8/9 三度                +1
     *    diff 6  三全音                   -5
     *    diff 0 同质量 (停滞)             -4
     *    prev=Dom7 + diff 5 (V7→I 解决)   +5
     *
     * 2. 离调惩罚 (Tension Gate)
     *    curr.root ∉ diatonic           -10 × (1 - tension)
     *    tension=0 → 全额惩罚（乖乖弹原调）
     *    tension=1 → 零惩罚（开始秀操作）
     *
     * 3. 半音平滑 (Chromatic Bass Descent)
     *    diff 1 或 11                    +6
     *    （vi → bVI → V 这种声部下行串联会被算法主动选中）
     *
     * 4. 功能替代 (bVI → V 黄金进行)
     *    prev.root=8 ∧ curr.root=7       +5
     *    （平滑下属替代，进入 V 解决）
     */
    private static getTransitionScore(
        prev: ChordCandidate,
        curr: ChordCandidate,
        diatonicMask: number,
        tensionMultiplier: number,
    ): number {
        let score = 0;
        const diff = ((curr.root - prev.root) % 12 + 12) % 12;

        // 1. 基础环形距离打分
        if (diff === 5) score += TRANS_FOURTH;
        else if (diff === 7) score += TRANS_FIFTH;
        else if (diff === 2 || diff === 10) score += TRANS_SECOND;
        else if (diff === 3 || diff === 4 || diff === 8 || diff === 9) score += TRANS_THIRD;
        else if (diff === 6) score -= TRANS_TRITONE_PENALTY;

        if (diff === 0 && curr.quality === prev.quality) score -= TRANS_REPEAT_PENALTY;

        if (prev.quality === ChordQuality.Dominant7 && diff === 5) score += TRANS_V7_TO_I_BONUS;

        // 2. 离调惩罚受张力乘数控制（Tension Gate）
        const isCurrBorrowed = (diatonicMask & (1 << curr.root)) === 0;
        if (isCurrBorrowed) {
            score -= BORROWED_PENALTY_MAX * (1.0 - tensionMultiplier);
        }

        // 3. 半音平滑法则（vi → bVI → V 串联自发涌现）
        if (diff === 1 || diff === 11) {
            score += CHROMATIC_SMOOTH_BONUS;
        }

        // 4. 功能替代法则：bVI(8) → V(7) 黄金进行
        if (prev.root === 8 && curr.root === 7) {
            score += BVI_TO_V_BONUS;
        }

        return score;
    }
}
```

### `src/core/generation/idioms/IdiomRegistry.ts`

> ✅ **战役四：纯化为三件钢琴 idiom** — 删除 Vocal/Wind/Guitar/Synth 全部杂项 idiom；仅保留 `AcousticPianoIdiom`（连绵琶音 0.6/0.2/0.2，octaveDoubling）/ `ElectricPianoIdiom`（切分律动 0.3/0.1/0.6，graceNote 0.2）/ `AcgPianoIdiom`（80% 华丽 16 分流动，graceNote 0.65 大跳装饰，legatoRatio 1.15）。`getIdiomForInstrument(name, styleId)` 新签名：`styleId === 20`（AcgLightMusic）时所有 piano-named 升级 ACG；EP-named (`ep` / `electric` / `warm` / `lofi`) 走 ElectricPianoIdiom；其余兜底 AcousticPianoIdiom。当前 ACG 是唯一注册风格 → piano-named 永远走 ACG，AcousticPianoIdiom 仅在 `instrumentName` 为空时作为兜底。

```ts
import { InstrumentIdiom } from '../types';

// 标准流行大钢琴 - 偏好连绵琶音与铺陈
export const AcousticPianoIdiom: InstrumentIdiom = {
    id: 'acoustic_piano',
    lead: { needsBreathing: false, humanizeVelocity: 0.1, legatoRatio: 1.1, graceNoteProbability: 0.35, octaveDoubling: true },
    comping: {
        strumDelay: 0.01,
        compingPatterns: [[0, 1.5, 2.5], [0, 2.0], [0.5, 1.5, 2.5, 3.5]],
        arpeggioPatterns: [
            [0, 1, 2, 3, null, 2, 1, null],
            [0, null, 1, 2, 3, 2, 1, null],
            [0, 1, 2, 3, 0, 1, 2, 3]
        ],
        compingDuration: 0.4,
        allowDrop2: true,
        textureType: 'mixed',
        textureProbabilities: { block: 0.2, arpeggio: 0.6, comping: 0.2 },
    },
};

// 电钢琴 (EP) - 偏好短促切分律动
export const ElectricPianoIdiom: InstrumentIdiom = {
    id: 'electric_piano',
    lead: { needsBreathing: false, humanizeVelocity: 0.15, legatoRatio: 0.9, graceNoteProbability: 0.2, octaveDoubling: false },
    comping: {
        strumDelay: 0.0,
        compingPatterns: [[0.5, 1.5, 2.5, 3.5], [0, 0.5, 2.0, 2.5], [0, 1.5, 2.5]],
        arpeggioPatterns: [[0, 1, 2, 1, null, null, null, null]],
        compingDuration: 0.3,
        allowDrop2: true,
        textureType: 'mixed',
        textureProbabilities: { block: 0.3, arpeggio: 0.1, comping: 0.6 },
    },
};

// 🌟 ACG 华丽钢琴 - 极宽的琶音音域，快速的 16 分音符流动，高频八度叠置
export const AcgPianoIdiom: InstrumentIdiom = {
    id: 'acg_piano',
    lead: {
        needsBreathing: false,
        humanizeVelocity: 0.1,
        legatoRatio: 1.15,
        graceNoteProbability: 0.65, // 日系钢琴极爱使用大跳装饰音
        octaveDoubling: true,
    },
    comping: {
        strumDelay: 0.0,
        compingPatterns: [[0, 0.5, 1.5, 2.5, 3.0], [0, 1.5, 2.5]], // 更有动感的日系切分
        arpeggioPatterns: [
            [0, 1, 2, 3, 2, 1, 0, 1], // 绵密的 16 分音符流动
            [0, 1, 2, null, 3, 2, 1, null],
            [0, 2, 3, 1, 2, 3, 1, 2]  // 错位琶音
        ],
        compingDuration: 0.5,
        allowDrop2: true,
        textureType: 'mixed',
        textureProbabilities: { block: 0.05, arpeggio: 0.8, comping: 0.15 }, // 80% 的时间在跑华丽琶音
    },
};

// 路由：只认钢琴变体。通过传入 styleId 判断是否启用 ACG 属性。
export function getIdiomForInstrument(instrumentName?: string | null, styleId?: number): InstrumentIdiom {
    if (!instrumentName) return AcousticPianoIdiom;
    const name = instrumentName.toLowerCase();

    // 🌟 如果当前是 ACG Style (ID=20)，所有原声钢琴一律升级为华丽 ACG 钢琴
    if (styleId === 20 && (name.includes('acoustic') || name.includes('grand') || name.includes('piano'))) {
        if (!name.includes('electric') && !name.includes('ep')) return AcgPianoIdiom;
    }

    if (name.includes('ep') || name.includes('electric') || name.includes('warm') || name.includes('lofi')) {
        return ElectricPianoIdiom;
    }

    return AcousticPianoIdiom;
}
```

### `src/core/generation/melody/RhythmCells.ts`

> ✅ 战役一对齐 — 节奏池扩展为 9 个 cell，新增 `[-0.5, 0.5, 0.5, 0.5, 2.0]`（弱拍起跳长尾）与 `[-1.0, 1.0, 1.0, 1.0]`（休止一拍起手），让 A-A' 动机有更多现代流行起句变体。

```ts
// ============================================================
// RhythmCells — 基础节奏切片池（含休止符）
// ============================================================
// 每个 cell 是一组连续音符的时长（单位：拍 beat）。
// 当前所有 cell 总长度都为 4 拍（一小节）。
//
// 约定：负数代表休止符切片（abs(value) 是占用拍长，但不发声）。
// 引入休止可消灭"儿歌感"——让旋律有呼吸停顿，符合现代流行 Phrase 习惯。
// ============================================================

export const BASIC_RHYTHM_CELLS: number[][] = [
    [1.0, 1.0, 1.0, 1.0],
    [0.5, 0.5, 1.0, 2.0],
    [1.5, 0.5, 1.0, 1.0],
    [0.75, 0.75, 0.5, 2.0],               // 3-3-2 拉丁切分
    [-0.5, 0.5, 1.0, 2.0],                // 弱拍起唱（半拍休止）
    [-0.5, 0.5, 0.5, 0.5, 2.0],
    [0.25, 0.25, 0.5, 1.0, 2.0],
    [0.75, 0.25, 1.0, 2.0],
    [-1.0, 1.0, 1.0, 1.0],                // 休止一拍起手
];
```

### `src/core/generation/melody/ToplineEngine.ts`

> ✅ 战役一：动机引擎重构 — 彻底废除 random walk。主旋律改用 **A-A' 动机模进 (Motif & Sequence)**：每 16 拍一个大乐句，先生成 8 拍核心母题（流行起手式 0/4/7 + 15% 大跳 / 45% 级进 / 40% 同音反复 contour），第二段整体平移 -3..+3 半音形成模进推拉感。和弦音池预缓存（chord∪scale，chord 优先），强拍吸 chordPcs / 弱拍吸 weakBeatPool。后处理仍含 legato / humanize / graceNote / **octaveDoubling**（velocity≥0.75 且非倚音时下方八度叠置）。

```ts
// ============================================================
// ToplineEngine — 节奏-轮廓-引力 + 情绪密度 + Idiom 驱动的物理约束
// ============================================================
// Pitch Space: RELATIVE
//   输入  chord.root / chord.quality 都是相对调式空间（root 0~11）
//   输出  NoteData.pitch 全部相对值，keyOffset 由 Orchestrator 应用
//
// 数据驱动改造（V7.6 + Lead/Comping 拆分 + 拟人化）：
//   - mood 注入：density = mood.densityMultiplier（Chill 0.6 / Energetic 1.2 等）
//   - 呼吸感由 idiom.lead.needsBreathing/breath* 数据驱动
//     （needsBreathing 的 idiom 触发 8 拍换气，键盘类跳过）
//   - 密度休止：density<1 时按 (1-density) 概率随机休止
//   - 高密度分裂：density>1.1 且时值≥1 拍时 40% 概率把 1 个音符分裂为 2 个
//   - 拟人化后处理（return 前）：legatoRatio 延音 / humanizeVelocity 力度抖动 / graceNoteProbability 大跳倚音
// ============================================================

import { NoteData, GeneratedChord, Tonality, ChordQuality, InstrumentIdiom } from '../types';
import { MoodConfig } from '../config/MoodFlags';
import { PRNGManager } from '../../utils/PRNG';
import { MusicTheory } from '../theory/MusicTheory';
import { BASIC_RHYTHM_CELLS } from './RhythmCells';

const PITCH_HIGH = 14;
const PITCH_LOW = -7;
const STRONG_BEAT_EPS = 0.05;
const NOTE_END_EPS = 0.001;
const MIN_DUR = 0.05;
const ARTICULATION_RATIO = 0.85;

// 密度分裂参数
const SPLIT_DENSITY_THRESHOLD = 1.1;
const SPLIT_MIN_DUR = 1.0;
const SPLIT_PROB = 0.4;

// CounterMelody 密度过滤
const COUNTER_REST_PROB = 0.4;

export class ToplineEngine {
    public static generateMelody(
        chords: GeneratedChord[],
        tonality: Tonality,
        mood?: MoodConfig,
        idiom?: InstrumentIdiom,
    ): NoteData[] {
        const melody: NoteData[] = [];
        if (chords.length === 0) return melody;

        const scalePcs = MusicTheory.getScalePitches(tonality);
        const density = mood ? mood.densityMultiplier : 1.0;

        // 缓存和弦音池，避免内层循环重复计算
        const chordPools = chords.map(chord => {
            const qualityEnum = ChordQuality[chord.quality as keyof typeof ChordQuality];
            const chordIntervals = MusicTheory.getChordTones(qualityEnum);
            const chordPcs = chordIntervals.map(iv => ((chord.root + iv) % 12 + 12) % 12);
            const weakBeatPool = [...chordPcs];
            for (let j = 0; j < scalePcs.length; j++) {
                if (!weakBeatPool.includes(scalePcs[j])) weakBeatPool.push(scalePcs[j]);
            }
            return { chord, chordPcs, weakBeatPool };
        });

        const totalBeats = chords[chords.length - 1].endBeat;

        // 内部函数：生成 8 拍 (2小节) 的动机 (Motif)
        const generateMotif = () => {
            const notes: { offset: number; rawDur: number; contourDelta: number }[] = [];
            let offset = 0;
            // 流行起手式：主音、三度或五度
            let currentContour = [0, 4, 7][PRNGManager.nextInt(0, 2)];

            for (let bar = 0; bar < 2; bar++) {
                const cellIdx = PRNGManager.nextInt(0, BASIC_RHYTHM_CELLS.length - 1);
                const cell = BASIC_RHYTHM_CELLS[cellIdx];
                for (let i = 0; i < cell.length; i++) {
                    if (offset >= 8.0 - NOTE_END_EPS) break;
                    notes.push({ offset, rawDur: cell[i], contourDelta: currentContour });

                    if (cell[i] > 0) {
                        const move = PRNGManager.nextFloat(0, 1);
                        // 🌟 核心修改：大幅提高同音反复概率 (0.60)，模拟流行人声咬字
                        // 10% 大跳 (3~5半音)
                        // 30% 级进 (1~2半音)
                        // 60% 同音反复
                        if (move < 0.10) {
                            currentContour += PRNGManager.nextInt(3, 5) * (PRNGManager.nextFloat(0,1) > 0.5 ? 1 : -1);
                        } else if (move < 0.40) {
                            currentContour += PRNGManager.nextInt(1, 2) * (PRNGManager.nextFloat(0,1) > 0.5 ? 1 : -1);
                        }
                        // > 0.40 的情况 currentContour 不变

                        if (currentContour > 12) currentContour -= 12;
                        if (currentContour < -12) currentContour += 12;
                    }
                    offset += Math.abs(cell[i]);
                }
            }
            return notes;
        };

        // 每 16 拍一个大乐句 (Phrase)，采用 A-A' 模进结构
        for (let phraseStart = 0; phraseStart < totalBeats - NOTE_END_EPS; phraseStart += 16) {
            const motifA = generateMotif(); // 生成核心母题

            for (let pass = 0; pass < 2; pass++) {
                const passStartBeat = phraseStart + pass * 8;
                if (passStartBeat >= totalBeats - NOTE_END_EPS) break;

                // A' 段模进：整体音高平移，创造推拉感
                const sequenceShift = pass === 1 ? PRNGManager.nextInt(-3, 3) : 0;

                for (let i = 0; i < motifA.length; i++) {
                    const mn = motifA[i];
                    const onset = passStartBeat + mn.offset;
                    if (onset >= totalBeats - NOTE_END_EPS) continue;

                    let ctx = chordPools[0];
                    for (let c = 0; c < chordPools.length; c++) {
                        if (onset >= chordPools[c].chord.startBeat - NOTE_END_EPS && onset < chordPools[c].chord.endBeat - NOTE_END_EPS) {
                            ctx = chordPools[c];
                            break;
                        }
                    }

                    const rawDur = mn.rawDur;
                    const isRest = rawDur < 0;
                    let actualDur = Math.abs(rawDur);

                    if (onset + actualDur > ctx.chord.endBeat) actualDur = ctx.chord.endBeat - onset;
                    if (actualDur < MIN_DUR) continue;

                    // 休止符或密度跳过
                    if (isRest) continue;
                    if (density < 1.0 && PRNGManager.nextFloat(0, 1) < (1.0 - density)) continue;

                    // Idiom 呼吸约束
                    const leadIdiom = idiom?.lead;
                    if (leadIdiom?.needsBreathing && leadIdiom.breathPhraseLength && leadIdiom.breathTriggerBeat) {
                        const beatInPhrase = onset % leadIdiom.breathPhraseLength;
                        if (beatInPhrase >= leadIdiom.breathTriggerBeat && PRNGManager.nextFloat(0, 1) < (leadIdiom.breathProbability ?? 0.8)) {
                            continue;
                        }
                    }

                    // 密度高频分裂
                    let numNotes = 1;
                    let noteDur = actualDur;
                    if (density > SPLIT_DENSITY_THRESHOLD && actualDur >= SPLIT_MIN_DUR && PRNGManager.nextFloat(0, 1) < SPLIT_PROB) {
                        numNotes = 2;
                        noteDur = actualDur / 2;
                    }

                    for (let n = 0; n < numNotes; n++) {
                        // 目标音高 = 和弦根音 + 模进偏移 + 相对轮廓
                        let targetPitch = ctx.chord.root + sequenceShift + mn.contourDelta;
                        if (n > 0) targetPitch += PRNGManager.nextInt(-2, 2);

                        while (targetPitch > PITCH_HIGH) targetPitch -= 12;
                        while (targetPitch < PITCH_LOW) targetPitch += 12;

                        const subOnset = onset + n * noteDur;
                        const isStrongBeat = Math.abs(subOnset - Math.round(subOnset)) < STRONG_BEAT_EPS;
                        const finalPitch = MusicTheory.snapToPool(targetPitch, isStrongBeat ? ctx.chordPcs : ctx.weakBeatPool);
                        const vel = isStrongBeat ? PRNGManager.nextFloat(0.7, 0.9) : PRNGManager.nextFloat(0.5, 0.7);

                        melody.push({
                            pitch: finalPitch,
                            onset: subOnset,
                            duration: noteDur * ARTICULATION_RATIO,
                            velocity: vel,
                        });
                    }
                }
            }
        }

        // ============================================================
        // Idiom.lead 渲染后处理：注入"行云流水"的演奏灵魂
        // ============================================================
        const finalMelody: NoteData[] = [];
        const leadIdiom = idiom?.lead;

        for (let i = 0; i < melody.length; i++) {
            const note = { ...melody[i] };

            if (leadIdiom) {
                if (leadIdiom.legatoRatio && leadIdiom.legatoRatio !== 1.0) note.duration *= leadIdiom.legatoRatio;

                if (leadIdiom.humanizeVelocity && leadIdiom.humanizeVelocity > 0) {
                    const noise = PRNGManager.nextFloat(-leadIdiom.humanizeVelocity, leadIdiom.humanizeVelocity);
                    note.velocity = Math.max(0.1, Math.min(1.0, note.velocity + noise));
                }

                if (i > 0 && leadIdiom.graceNoteProbability && PRNGManager.nextFloat(0, 1) < leadIdiom.graceNoteProbability) {
                    const prevNote = melody[i - 1];
                    const pitchDiff = note.pitch - prevNote.pitch;
                    if (Math.abs(pitchDiff) >= 3) {
                        const direction = pitchDiff > 0 ? -1 : 1;
                        const candidatePitch = note.pitch + direction * 2;
                        const graceOnset = note.onset - 0.125;
                        if (graceOnset >= 0) {
                            finalMelody.push({
                                pitch: MusicTheory.snapToScale(candidatePitch, tonality),
                                onset: graceOnset,
                                duration: 0.125,
                                velocity: note.velocity * 0.6,
                                isGraceNote: true,
                            });
                        }
                    }
                }
            }
            finalMelody.push(note);

            // 4. Octave Doubling（高潮加厚）
            if (leadIdiom?.octaveDoubling && note.velocity >= 0.75 && !note.isGraceNote) {
                finalMelody.push({
                    ...note,
                    pitch: note.pitch - 12,
                    velocity: note.velocity * 0.8,
                });
            }
        }

        return finalMelody;
    }

    /**
     * 副旋律生成器 — 稀疏长音、低音区运动、就近吸到当前和弦音。
     *
     * 设计目标：
     *   - 故意放在主旋律下方（起点 -5），形成对位高低差
     *   - 节奏稀疏（每 2~4 拍一个音），不与 melody 抢前景
     *   - 力度弱（0.4~0.6），融入背景
     *   - 仅吸和弦音池（非完整音阶），保证和声纯净
     *   - 低密度时 40% 跳过当前音符，进一步稀疏化
     *
     * 输出仍是相对空间，由 Orchestrator 应用 keyOffset。
     */
    public static generateCounterMelody(
        chords: GeneratedChord[],
        _tonality: Tonality,
        mood?: MoodConfig,
        _idiom?: InstrumentIdiom,
    ): NoteData[] {
        const counter: NoteData[] = [];
        let currentPitch = -5;
        const density = mood ? mood.densityMultiplier : 1.0;

        for (let ci = 0; ci < chords.length; ci++) {
            const chord = chords[ci];
            const qualityEnum = ChordQuality[chord.quality as keyof typeof ChordQuality];
            const chordIntervals = MusicTheory.getChordTones(qualityEnum);

            const chordPcs: number[] = [];
            for (let j = 0; j < chordIntervals.length; j++) {
                const raw = chord.root + chordIntervals[j];
                chordPcs.push(((raw % 12) + 12) % 12);
            }

            let currentBeat = chord.startBeat;
            while (currentBeat < chord.endBeat - NOTE_END_EPS) {
                const dur = PRNGManager.nextFloat(0, 1) > 0.5 ? 2.0 : 4.0;
                let actualDur = dur;
                if (currentBeat + actualDur > chord.endBeat) {
                    actualDur = chord.endBeat - currentBeat;
                }
                if (actualDur < MIN_DUR) {
                    currentBeat += actualDur;
                    continue;
                }

                // 密度过滤：低密度 40% 跳过当前音
                if (density < 1.0 && PRNGManager.nextFloat(0, 1) < COUNTER_REST_PROB) {
                    currentBeat += actualDur;
                    continue;
                }

                currentPitch += PRNGManager.nextInt(-1, 1) * 2;
                if (currentPitch > 5) currentPitch -= 12;
                if (currentPitch < -12) currentPitch += 12;

                currentPitch = MusicTheory.snapToPool(currentPitch, chordPcs);

                counter.push({
                    pitch: currentPitch,
                    onset: currentBeat,
                    duration: actualDur * 0.95,
                    velocity: PRNGManager.nextFloat(0.4, 0.6),
                });

                currentBeat += actualDur;
            }
        }

        return counter;
    }
}
```

### `src/core/generation/composing/GrooveEngine.ts`

> ✅ Phase 6 — 段落能量驱动 + mood 调制 + 加花（drum fill） + 16 分鬼音的鼓组（GM Drum Map 绝对键位，永不加 keyOffset）。

```ts
// ============================================================
// GrooveEngine — Phase 6 段落能量驱动鼓组（含加花 + 鬼音）
// ============================================================
// Pitch Space: ABSOLUTE-DRUM（GM Drum Map 物理键位，永不加 keyOffset）
//   36 = Kick, 37 = Side Stick, 38 = Snare,
//   42 = Closed HiHat, 46 = Open HiHat, 49 = Crash
//
// Phase 6 改造：
//   - 步长由 0.5 改为 0.25（16 分网格，支持加花和鬼音）
//   - 加花 (Drum Fill)：当下一段能量更高时，本段最后 1 小节后半段
//     做 16 分军鼓滚奏 + 4 分底鼓铺底，velocity 渐强（0.5 → 1.0）
//   - 鬼音 (Ghost Notes)：energy>=6 且 density>1.1 时，
//     在 16 分缝隙位置（"a of 1" / "e of 2" / "a of 3" / "e of 4"）
//     25% 概率打弱军鼓，flank 主军鼓
//   - 闭/开镲 hi-hat 概率门由 density 控制（Chill 0.6 间歇打、Energetic 1.2 always 打）
// ============================================================

import { NoteData, SectionMetadata } from '../types';
import { MoodConfig } from '../config/MoodFlags';
import { PRNGManager } from '../../utils/PRNG';

const BEAT_EPS = 0.001;
const GRID_EPS = 0.01;
const HIT_DUR = 0.25;
const CRASH_DUR = 1.0;
const GHOST_DUR = 0.125;

const FILL_LAST_BAR_BEATS = 4;     // 最后 1 小节
const FILL_START_BEAT = 2.0;       // 后半段（最后 2 拍）
const FILL_VEL_BASE = 0.5;
const FILL_VEL_RANGE = 0.5;

const GHOST_ENERGY_THRESHOLD = 6;
const GHOST_DENSITY_THRESHOLD = 1.1;
const GHOST_PROB = 0.25;

export class GrooveEngine {
    public static generateDrums(sections: SectionMetadata[], mood?: MoodConfig): NoteData[] {
        const drums: NoteData[] = [];
        const density = mood ? mood.densityMultiplier : 1.0;

        for (let si = 0; si < sections.length; si++) {
            const sec = sections[si];
            const e = sec.energyLevel;
            if (e <= 3) continue;

            const nextSec = sections[si + 1];
            const isBuildingUp = !!(nextSec && nextSec.energyLevel > sec.energyLevel);

            for (let b = sec.startBeat; b < sec.endBeat - BEAT_EPS; b += 0.25) {
                const bInBar = (b - sec.startBeat) % 4;
                const isDownbeat = Math.abs(bInBar - 0) < GRID_EPS;
                const isBeat3 = Math.abs(bInBar - 2) < GRID_EPS;
                const isBackbeat =
                    Math.abs(bInBar - 1) < GRID_EPS || Math.abs(bInBar - 3) < GRID_EPS;
                const is8th = Math.abs((b * 2) % 1) < GRID_EPS;
                const is16thGhost =
                    Math.abs(bInBar - 0.75) < GRID_EPS ||
                    Math.abs(bInBar - 1.25) < GRID_EPS ||
                    Math.abs(bInBar - 2.75) < GRID_EPS ||
                    Math.abs(bInBar - 3.25) < GRID_EPS;

                const isLastBar = b >= sec.endBeat - FILL_LAST_BAR_BEATS;

                // 加花 (Drum Fill)：building-up 段落的最后 1 小节后半段
                if (isBuildingUp && isLastBar) {
                    const fillBeat = b - (sec.endBeat - FILL_LAST_BAR_BEATS);
                    if (fillBeat >= FILL_START_BEAT) {
                        const swellVel =
                            FILL_VEL_BASE +
                            ((fillBeat - FILL_START_BEAT) / FILL_START_BEAT) * FILL_VEL_RANGE;
                        drums.push({ pitch: 38, onset: b, duration: HIT_DUR, velocity: swellVel });
                        if (
                            isDownbeat || isBeat3 ||
                            Math.abs(bInBar - 1) < GRID_EPS ||
                            Math.abs(bInBar - 3) < GRID_EPS
                        ) {
                            drums.push({ pitch: 36, onset: b, duration: HIT_DUR, velocity: 0.8 });
                        }
                        continue;
                    }
                }

                // 跳过非 8 分且非鬼音 16 分的网格点
                if (!is8th && !is16thGhost) continue;

                // 常规律动：仅 8 分网格触发主体击
                if (is8th) {
                    if (e <= 4) {
                        if (isDownbeat) {
                            drums.push({ pitch: 36, onset: b, duration: HIT_DUR, velocity: 0.5 });
                        }
                        if (isBackbeat) {
                            drums.push({ pitch: 37, onset: b, duration: HIT_DUR, velocity: 0.6 });
                        }
                    } else if (e <= 7) {
                        if (isDownbeat || isBeat3) {
                            drums.push({ pitch: 36, onset: b, duration: HIT_DUR, velocity: 0.8 });
                        }
                        if (isBackbeat) {
                            drums.push({ pitch: 38, onset: b, duration: HIT_DUR, velocity: 0.8 });
                        }
                        if (PRNGManager.nextFloat(0, 1) < density) {
                            drums.push({
                                pitch: 42,
                                onset: b,
                                duration: HIT_DUR,
                                velocity: PRNGManager.nextFloat(0.5, 0.7),
                            });
                        }
                    } else {
                        if (isDownbeat && Math.abs(b - sec.startBeat) < GRID_EPS) {
                            drums.push({
                                pitch: 49, onset: b, duration: CRASH_DUR, velocity: 0.95,
                            });
                        }
                        if (
                            isDownbeat || isBeat3 ||
                            Math.abs(bInBar - 2.5) < GRID_EPS
                        ) {
                            drums.push({ pitch: 36, onset: b, duration: HIT_DUR, velocity: 0.9 });
                        }
                        if (isBackbeat) {
                            drums.push({ pitch: 38, onset: b, duration: HIT_DUR, velocity: 0.95 });
                        }
                        if (PRNGManager.nextFloat(0, 1) < density) {
                            drums.push({
                                pitch: 46,
                                onset: b,
                                duration: HIT_DUR,
                                velocity: PRNGManager.nextFloat(0.6, 0.8),
                            });
                        }
                    }
                }

                // 鬼音：高能 + 高密度才出现
                if (
                    e >= GHOST_ENERGY_THRESHOLD &&
                    density > GHOST_DENSITY_THRESHOLD &&
                    is16thGhost &&
                    PRNGManager.nextFloat(0, 1) < GHOST_PROB
                ) {
                    drums.push({
                        pitch: 38,
                        onset: b,
                        duration: GHOST_DUR,
                        velocity: PRNGManager.nextFloat(0.3, 0.5),
                    });
                }
            }
        }

        return drums;
    }
}
```

### `src/core/generation/composing/StructureEngine.ts`

> 🚧 Phase 6 — 多段式曲式生成：从 3 种典型流行曲式中抽取 → 按 SECTION_CONFIG 装配 SectionMetadata[] → mood.energyCap 钳制能量。

```ts
// ============================================================
// StructureEngine — Phase 6 多段式曲式生成
// ============================================================
// 从 3 种典型流行曲式中随机抽取，按 SECTION_CONFIG 的小节数 + 基准能量
// 装配 SectionMetadata[]，能量再用 mood.energyCap 钳制（Chill 压扁 Chorus、
// Aggressive 抬高 Intro 等）。
//
// 当前 3 种 form：
//   1) Intro → Verse → Chorus → Verse → Chorus → Outro          (24 bars / 96 beats)
//   2) Intro → Verse → PreChorus → Chorus → Verse → Chorus → Outro   (32 bars / 128 beats)
//   3) Intro → Verse → PreChorus → Chorus → Bridge → Chorus → Outro  (32 bars / 128 beats)
// ============================================================

import { SectionMetadata, StyleConfig } from '../types';
import { MoodConfig } from '../config/MoodFlags';
import { PRNGManager } from '../../utils/PRNG';

const FORMS: string[][] = [
    ['Intro', 'Verse', 'Chorus', 'Verse', 'Chorus', 'Outro'],
    ['Intro', 'Verse', 'PreChorus', 'Chorus', 'Verse', 'Chorus', 'Outro'],
    ['Intro', 'Verse', 'PreChorus', 'Chorus', 'Bridge', 'Chorus', 'Outro'],
];

interface SectionConfig {
    bars: number;
    baseEnergy: number;
}

const SECTION_CONFIG: Record<string, SectionConfig> = {
    'Intro':     { bars: 4, baseEnergy: 3 },
    'Verse':     { bars: 8, baseEnergy: 5 },
    'PreChorus': { bars: 4, baseEnergy: 6 },
    'Chorus':    { bars: 8, baseEnergy: 8 },
    'Bridge':    { bars: 4, baseEnergy: 7 },
    'Outro':     { bars: 4, baseEnergy: 4 },
};

const BEATS_PER_BAR = 4;

export class StructureEngine {
    public static generateStructure(
        _bpm: number,
        _style: StyleConfig,
        mood: MoodConfig
    ): SectionMetadata[] {
        const selectedForm = FORMS[PRNGManager.nextInt(0, FORMS.length - 1)];

        const sections: SectionMetadata[] = [];
        let currentBeat = 0;

        for (let i = 0; i < selectedForm.length; i++) {
            const name = selectedForm[i];
            const c = SECTION_CONFIG[name];
            const beats = c.bars * BEATS_PER_BAR;

            let e = c.baseEnergy;
            e = Math.max(mood.energyCap[0], Math.min(mood.energyCap[1], e));

            sections.push({
                name,
                startBeat: currentBeat,
                endBeat: currentBeat + beats,
                energyLevel: e,
            });
            currentBeat += beats;
        }

        return sections;
    }
}
```

### `src/core/generation/MelodyEngine.ts`

> ✅ Phase 1 — 转发到 runPipeline 的薄封装。AuraBar 等老调用方零修改即可接入新管线。

```ts
// ============================================================
// MelodyEngine — 转发到 runPipeline 的薄封装
// ============================================================
// 历史 API：generateFullSong(styleId | options) → { track, context }
// 当前 Phase 1 MVP：内部直接调用 runPipeline，让旧调用方（AuraBar 等）零改动接入新管线。
// 后续如需恢复 Stage 1~5 各自的入口，可在此扩展。
// ============================================================

import { GeneratedTrack, MusicContext, GenerationOptions } from './types';
import { StyleId } from './config/StyleFlags';
import { runPipeline } from './pipeline';

export class MelodyEngine {
    public generateFullSong(
        styleIdOrOptions?: StyleId | GenerationOptions,
        legacyOptions: GenerationOptions = {},
    ): { track: GeneratedTrack; context: MusicContext } {
        const forcedStyleId =
            typeof styleIdOrOptions === 'number' ? (styleIdOrOptions as StyleId) : undefined;
        const generation =
            typeof styleIdOrOptions === 'object' && styleIdOrOptions !== null
                ? (styleIdOrOptions as GenerationOptions)
                : legacyOptions;

        return runPipeline({ forcedStyleId, generation });
    }
}
```

### `src/core/generation/arrangement/TextureMapper.ts`

> ✅ 战役二：Slash Bass + Waterfall Arpeggio + Bass Walkdown；**战役三：Rootless Voicing + 织体概率解固** — pcs 构建阶段对 ≥4 音和弦丢弃根音（`intervals[j] === 0` skip）让贝斯独占低频，对 maj7/m7/dom7/m9/maj9 自动加 9 音染色；Layer 3 改为 PRNG 概率抉择 `block/arpeggio/comping` 三档（mixed + textureProbabilities 时），能量 ≥7 强制切分；琶音从 `arpeggioPatterns` 池中按 `floor(startBeat/4) % len` 取，null 索引 = 不弹音留白；comping 分支 `compingPatterns` 改为 PRNG 随机抽取 idx（消除"小节几→Pattern 几"的硬绑定）。

```ts
// ============================================================
// TextureMapper — 三维频段解耦 + Idiom 驱动的伴奏织体生成器
// ============================================================
// Pitch Space: RELATIVE
//   输入：GeneratedChord（root 0~11 相对调式）+ SectionMetadata + chordIdiom
//   输出：bass / rhythmComping / sustainedPad 三层独立相对音高音轨
//   绝对 MIDI 由 Orchestrator.applyOffset() 统一施加 keyOffset（K-2）
//
// 织体维度：
//   sustainedPad     呼吸铺底层（Glue）   能量>=5 + idiom.comping.allowDrop2 自动 Drop-2 开放排列
//   bass             低频地基层           energy <=4 长音 / 5~6 根五交替 / >=7 八度跃动
//   rhythmComping    律动驱动层           扫弦延迟 / 切分 pattern / comping duration 全部走 Idiom
//
// 数据驱动改造（V7.6 + Lead/Comping 拆分）：
//   原本通过 InstrumentIdFamily 查表识别 isGuitar/isSynth 的脏代码已移除，
//   改为消费 chordIdiom.comping.{strumDelay, compingPatterns, compingDuration, allowDrop2}，
//   使得本模块对乐器名彻底无感。.lead 字段不归本模块管。
//   compingPatterns 是 Pattern 池，按小节索引轮换以消除机械重复感。
// ============================================================

import { NoteData, GeneratedChord, SectionMetadata, ChordQuality, InstrumentIdiom } from '../types';
import { MusicTheory } from '../theory/MusicTheory';
import { AcousticPianoIdiom } from '../idioms/IdiomRegistry';
import { PRNGManager } from '../../utils/PRNG';

const VOICING_TARGET_CENTER = 0;
const BASS_OCTAVE_OFFSET = -24;
const BEAT_EPS = 0.001;
const DOWNBEAT_EPS = 0.01;

export class TextureMapper {
    public static generateAccompaniment(
        chords: GeneratedChord[],
        sections: SectionMetadata[],
        chordIdiom: InstrumentIdiom = AcousticPianoIdiom,
    ): { bass: NoteData[]; rhythmComping: NoteData[]; sustainedPad: NoteData[] } {
        const bass: NoteData[] = [];
        const rhythmComping: NoteData[] = [];
        const sustainedPad: NoteData[] = [];
        let currentVoicing: number[] = [];

        // 🌟 按乐句 (Phrase，每 16 拍) 预先决定织体，打破死循环
        const phraseTextures: Record<number, string> = {};
        for (let i = 0; i < chords.length; i++) {
            const chord = chords[i];
            const phraseIdx = Math.floor(chord.startBeat / 16);
            if (!phraseTextures[phraseIdx]) {
                // 查找该乐句起点所在的段落能量
                let energy = 5;
                for (let s = 0; s < sections.length; s++) {
                    if (chord.startBeat >= sections[s].startBeat - BEAT_EPS && chord.startBeat < sections[s].endBeat - BEAT_EPS) {
                        energy = sections[s].energyLevel; break;
                    }
                }

                let tex = 'block';
                if (energy >= 7) {
                    tex = 'comping'; // 高能段落强制切分
                } else if (energy <= 3) {
                    tex = 'block';   // 极低能段强制留白
                } else {
                    const texType = chordIdiom.comping.textureType || 'block';
                    if (texType === 'mixed' && chordIdiom.comping.textureProbabilities) {
                        const roll = PRNGManager.nextFloat(0, 1);
                        const w = chordIdiom.comping.textureProbabilities;
                        if (roll < w.block) tex = 'block';
                        else if (roll < w.block + w.arpeggio) tex = 'arpeggio';
                        else tex = 'comping';
                    } else {
                        tex = texType;
                    }
                }
                phraseTextures[phraseIdx] = tex;
            }
        }

        for (let ci = 0; ci < chords.length; ci++) {
            const chord = chords[ci];

            // 1) 查找当前和弦所在段落的能量
            let energy = 5;
            for (let i = 0; i < sections.length; i++) {
                const s = sections[i];
                if (
                    chord.startBeat >= s.startBeat - BEAT_EPS &&
                    chord.startBeat < s.endBeat - BEAT_EPS
                ) {
                    energy = s.energyLevel;
                    break;
                }
            }

            // 2) 解析 quality 字符串到 enum，算 chord pitch class 集
            const qEnum = ChordQuality[chord.quality as keyof typeof ChordQuality];
            const intervals = MusicTheory.getChordTones(qEnum);
            const pcs: number[] = [];

            // 大师级无根音排列 (Rootless Voicing)：≥4 音的高级和弦丢弃根音让贝斯独占低频，加 9 音染色
            const isAdvancedChord = intervals.length >= 4;
            for (let j = 0; j < intervals.length; j++) {
                if (isAdvancedChord && intervals[j] === 0) continue; // 剔除根音，让给贝斯
                pcs.push(((chord.root + intervals[j]) % 12 + 12) % 12);
            }
            if (isAdvancedChord && (qEnum === ChordQuality.Major7 || qEnum === ChordQuality.Minor7 || qEnum === ChordQuality.Dominant7 || qEnum === ChordQuality.Minor9 || qEnum === ChordQuality.Major9)) {
                const ninthPc = ((chord.root + 2) % 12 + 12) % 12;
                if (!pcs.includes(ninthPc)) pcs.push(ninthPc); // 加入 9 音增加高级色彩
            }
            if (pcs.length === 0) pcs.push(chord.root); // 兜底

            // 3) 平滑声部连接 + 能量>=5 且 Idiom 允许时启动 Drop-2
            const rawVoicing = MusicTheory.getSmoothVoicing(pcs, currentVoicing, VOICING_TARGET_CENTER);
            currentVoicing = (energy >= 5 && chordIdiom.comping.allowDrop2) ? MusicTheory.getDrop2Voicing(rawVoicing) : rawVoicing;

            const chordDur = chord.endBeat - chord.startBeat;

            // --- Layer 1: Sustained Pad（铺底胶水层）---
            for (let i = 0; i < currentVoicing.length; i++) {
                sustainedPad.push({ pitch: currentVoicing[i], onset: chord.startBeat, duration: chordDur, velocity: 0.35 });
            }

            // --- Layer 2: Bass（低频地基层，保留之前的 Walkdown 逻辑）---
            const actualBassPc = chord.bassOverride !== undefined ? chord.bassOverride : chord.root;
            let bassPitch = actualBassPc + BASS_OCTAVE_OFFSET;
            if (chord.bassOverride !== undefined && actualBassPc > chord.root) bassPitch -= 12;

            const nextChord = ci < chords.length - 1 ? chords[ci + 1] : null;
            let nextBassPitch = bassPitch;
            if (nextChord) {
                const nBPc = nextChord.bassOverride !== undefined ? nextChord.bassOverride : nextChord.root;
                nextBassPitch = nBPc + BASS_OCTAVE_OFFSET;
                if (nextChord.bassOverride !== undefined && nBPc > nextChord.root) nextBassPitch -= 12;
            }

            if (energy <= 4) {
                bass.push({ pitch: bassPitch, onset: chord.startBeat, duration: chordDur, velocity: 0.7 });
            } else if (energy <= 6) {
                let fifthSemitones = 7;
                if (qEnum === ChordQuality.Diminished || qEnum === ChordQuality.Diminished7 || qEnum === ChordQuality.HalfDiminished) fifthSemitones = 6;
                else if (qEnum === ChordQuality.Augmented) fifthSemitones = 8;
                const bassFifth = chord.root + fifthSemitones + BASS_OCTAVE_OFFSET;
                for (let b = chord.startBeat; b < chord.endBeat - BEAT_EPS; b += 2.0) {
                    const isBeat1 = Math.abs((b - chord.startBeat) % 4) < DOWNBEAT_EPS;
                    let dur = 1.8;
                    if (b + dur > chord.endBeat) dur = chord.endBeat - b;
                    bass.push({ pitch: isBeat1 ? bassPitch : bassFifth, onset: b, duration: dur, velocity: 0.75 });
                }
            } else {
                for (let b = chord.startBeat; b < chord.endBeat - BEAT_EPS; b += 0.5) {
                    const isDownbeat = Math.abs((b * 2) % 2) < DOWNBEAT_EPS;
                    bass.push({ pitch: isDownbeat ? bassPitch : bassPitch + 12, onset: b, duration: 0.4, velocity: isDownbeat ? 0.85 : 0.65 });
                }
            }

            if (nextChord && energy >= 4 && chordDur >= 2.0) {
                let shortestDiff = nextBassPitch - bassPitch;
                while (shortestDiff > 6) shortestDiff -= 12;
                while (shortestDiff < -6) shortestDiff += 12;
                if (Math.abs(shortestDiff) <= 4 && Math.abs(shortestDiff) > 0) {
                    const passingOnset = chord.endBeat - 0.5;
                    let conflict = false;
                    for (let i = 0; i < bass.length; i++) {
                        if (Math.abs(bass[i].onset - passingOnset) < 0.1) {
                            bass[i].duration = passingOnset - bass[i].onset;
                            if (bass[i].duration < 0.05) conflict = true;
                        } else if (bass[i].onset < passingOnset && bass[i].onset + bass[i].duration > passingOnset) {
                            bass[i].duration = passingOnset - bass[i].onset - 0.05;
                        }
                    }
                    if (!conflict) {
                        const direction = shortestDiff > 0 ? 1 : -1;
                        const passingPitch = bassPitch + direction * (Math.abs(shortestDiff) >= 3 ? 2 : 1);
                        bass.push({ pitch: passingPitch, onset: passingOnset, duration: 0.5, velocity: 0.65 });
                    }
                }
            }

            // --- Layer 3: Rhythm Comping（乐句级一致性）---
            const phraseIdx = Math.floor(chord.startBeat / 16);
            const secTex = phraseTextures[phraseIdx] || 'block';

            const playArpeggio = secTex === 'arpeggio';
            const playComping = secTex === 'comping';

            if (playArpeggio && chordIdiom.comping.arpeggioPatterns) {
                // 流水琶音：每个乐句锁定一种 Pattern
                const root = chord.root;
                let third = chord.root + 4;
                if (qEnum === ChordQuality.Minor || qEnum === ChordQuality.Minor7 || qEnum === ChordQuality.Minor9 || qEnum === ChordQuality.HalfDiminished || qEnum === ChordQuality.Diminished || qEnum === ChordQuality.Minor11) third = chord.root + 3;
                let fifth = chord.root + 7;
                if (qEnum === ChordQuality.Diminished || qEnum === ChordQuality.HalfDiminished || qEnum === ChordQuality.Diminished7) fifth = chord.root + 6;
                else if (qEnum === ChordQuality.Augmented) fifth = chord.root + 8;

                const widePitches = [root, fifth, root + 12, third + 12];
                const arpPool = chordIdiom.comping.arpeggioPatterns;
                const flowPattern = arpPool[phraseIdx % arpPool.length]; // 乐句级锁定

                let arpIdx = 0;
                const step = energy >= 6 ? 0.25 : 0.5;
                for (let b = chord.startBeat; b < chord.endBeat - BEAT_EPS; b += step) {
                    const pIdx = flowPattern[arpIdx % flowPattern.length];
                    if (pIdx !== null && widePitches[pIdx] !== undefined) {
                        rhythmComping.push({
                            pitch: widePitches[pIdx],
                            onset: b,
                            duration: step * 1.5,
                            velocity: 0.55 + (pIdx === 0 ? 0.15 : 0.0),
                        });
                    }
                    arpIdx++;
                }
            } else if (playComping) {
                // 节奏切分：每个乐句锁定一种 Pattern
                const patterns = chordIdiom.comping.compingPatterns;
                const compDur = chordIdiom.comping.compingDuration;
                const currentPattern = patterns[phraseIdx % patterns.length]; // 乐句级锁定

                const barStart = Math.floor(chord.startBeat / 4) * 4;
                for (let b = barStart; b < chord.endBeat - BEAT_EPS; b += 4.0) {
                    for (let r = 0; r < currentPattern.length; r++) {
                        const hitOnset = b + currentPattern[r];
                        if (hitOnset >= chord.startBeat - BEAT_EPS && hitOnset < chord.endBeat - BEAT_EPS) {
                            for (let i = 0; i < currentVoicing.length; i++) {
                                const stagger = i * chordIdiom.comping.strumDelay;
                                rhythmComping.push({ pitch: currentVoicing[i], onset: hitOnset + stagger, duration: compDur, velocity: 0.75 });
                            }
                        }
                    }
                }
            } else {
                // 柱式留白
                for (let i = 0; i < currentVoicing.length; i++) {
                    const stagger = i * chordIdiom.comping.strumDelay;
                    rhythmComping.push({ pitch: currentVoicing[i], onset: chord.startBeat + stagger, duration: chordDur - stagger, velocity: 0.5 });
                }
            }
        }

        return { bass, rhythmComping, sustainedPad };
    }
}
```

### `src/core/generation/arrangement/Orchestrator.ts`

> ✅ 涌现式音乐性重构 — Bass register 锁定改为 K-2 转换后 **per-note octave fold**，窗口收紧到 [BASS_REGISTER_MIN, MAX] = [28, 43]（E1~G2 Acoustic_Bass 甜区）。删除原整轨 ±12 平移 + `medianPitch` 辅助方法。K-5 例外条款合规（keyOffset 仅用于 clamp，非 pitch 计算）。已知副作用：高能段 root↔root+12 八度跃动会被压回 octave 内同音重复。

```ts
// ============================================================
// Orchestrator — 编曲器（K-2 转换 + ConductorPlan 物理消音）
// ============================================================
// Pitch Space: RELATIVE → ABSOLUTE（K-2 唯一转换点）
//
// 数据驱动改造（V7.6）：
//   - 编制（palette）由 pipeline 前置决定，写入 context.ensemble
//     Orchestrator 不再持有 pickInst 抽卡权，仅作为 readonly 消费方
//   - chordIdiom 由 getIdiomForInstrument(palette.chordSound) 派生，传入 TextureMapper
//   - 应用 context.conductorPlan：按段落 silentInstruments 物理过滤掉对应音符
//
// 鼓组 K-2 例外：drums.pitch 是 GM 物理键位，绝不加 keyOffset。
// ============================================================

import { StyleId } from '../config/StyleFlags';
import {
    ArrangedTrack,
    GeneratedTrack,
    MusicContext,
    EnsembleDraft,
    NoteData,
} from '../types';
import { TextureMapper } from './TextureMapper';
import { getIdiomForInstrument } from '../idioms/IdiomRegistry';

const ACCOMP_OCTAVE = 60;   // C4 锚点（pianoLH 已含 -24 → C2/36；pianoRH / counter 居 60/C4）
const MELODY_OCTAVE = 72;   // C5 锚点
const SECTION_EPS = 0.001;

// Bass 物理音域钳制窗口 — E1(28) ~ G2(43)，Acoustic_Bass 的核心甜区。
// K-2 转换点（相对→绝对）后逐音 fold octave 到窗口内，保证 ESP32 端 GM bass 永不跑超。
// 副作用：高能段的 root↔root+12 八度跃动会被压成同 octave 内的同音重复，由上游
// （TextureMapper 的 energy>=7 分支）权衡后接受。
const BASS_REGISTER_MIN = 28;
const BASS_REGISTER_MAX = 43;

export class Orchestrator {
    public static arrange(track: GeneratedTrack, styleId: StyleId, context: MusicContext): ArrangedTrack {
        // 1) Palette：直接读取前置生成的编制，兜底使用默认标品
        const palette: EnsembleDraft = context.ensemble ?? {
            melodySound: 'Acoustic_Grand',
            chordSound: 'Acoustic_Grand',
            bassSound: 'Acoustic_Bass',
            drumSound: 'Standard_DrumKit',
            secondaryMelodySound: 'Pad_1_NewAge',
            counterMelodySound: null,
        };

        const chordIdiom = getIdiomForInstrument(palette.chordSound, styleId);

        // 2) 织体三层（相对空间），通过 chordIdiom 驱动伴奏物理约束
        const { bass: relLH, rhythmComping: relRH, sustainedPad: relPad } =
            TextureMapper.generateAccompaniment(track.chords, track.sections, chordIdiom);

        // 3) 应用 keyOffset → 绝对 MIDI
        let melody: NoteData[] = track.melody.map(n => ({
            ...n,
            pitch: n.pitch + track.keyOffset + MELODY_OCTAVE,
        }));
        let pianoRH: NoteData[] = relRH.map(n => ({
            ...n,
            pitch: n.pitch + track.keyOffset + ACCOMP_OCTAVE,
        }));
        // K-2 转换点 + per-note 物理音域 fold：
        //   绝对 pitch = 相对 pitch + keyOffset + ACCOMP_OCTAVE，落入 [28, 43] 后输出。
        //   K-5 例外条款明确允许 keyOffset 用于"音域限制（clamp to range）"，此处合规。
        let pianoLH: NoteData[] = relLH.map(n => {
            let absPitch = n.pitch + track.keyOffset + ACCOMP_OCTAVE;
            while (absPitch > BASS_REGISTER_MAX) absPitch -= 12;
            while (absPitch < BASS_REGISTER_MIN) absPitch += 12;
            return { ...n, pitch: absPitch };
        });
        let secondaryMelody: NoteData[] = relPad.map(n => ({
            ...n,
            pitch: n.pitch + track.keyOffset + ACCOMP_OCTAVE,
        }));
        let counterMelody: NoteData[] = track.counterMelody
            ? track.counterMelody.map(n => ({
                ...n,
                pitch: n.pitch + track.keyOffset + ACCOMP_OCTAVE,
            }))
            : [];

        // 4) 鼓组绝对音高特权：直接透传
        let drums: NoteData[] = track.drums ? track.drums.map(n => ({ ...n })) : [];

        // 5) ConductorPlan 物理消音：按 silentInstruments 在该段落内过滤音符
        if (context.conductorPlan) {
            const plan = context.conductorPlan;
            for (let i = 0; i < plan.sections.length; i++) {
                const planSec = plan.sections[i];
                const filterSilence = (notes: NoteData[]): NoteData[] =>
                    notes.filter(
                        n => !(n.onset >= planSec.startBeat - SECTION_EPS &&
                               n.onset < planSec.endBeat - SECTION_EPS),
                    );
                if (planSec.silentInstruments.indexOf('melody') >= 0) melody = filterSilence(melody);
                if (planSec.silentInstruments.indexOf('counter') >= 0) counterMelody = filterSilence(counterMelody);
                if (planSec.silentInstruments.indexOf('drums') >= 0) drums = filterSilence(drums);
                if (planSec.silentInstruments.indexOf('bass') >= 0) pianoLH = filterSilence(pianoLH);
                if (planSec.silentInstruments.indexOf('chord') >= 0) pianoRH = filterSilence(pianoRH);
                if (planSec.silentInstruments.indexOf('secondary') >= 0) secondaryMelody = filterSilence(secondaryMelody);
            }
        }

        return {
            bpm: track.bpm,
            key: track.key,
            absoluteStartBeat: track.absoluteStartBeat,
            timeSignature: track.timeSignature,
            styleId,
            melody,
            pianoLH,
            pianoRH,
            drums,
            secondaryMelody,
            counterMelody,
            chords: track.chords,
            sections: track.sections,
            palette,
        };
    }

}
```

### `src/core/generation/pipeline/index.ts`

> ✅ 五阶段管道入口 — 涌现音乐性补完：在 `counterMelody` 之前插入 **Pitch Correction Pass**（仅 Viterbi 风格生效）：melody 与 finalChord 检测小二度摩擦，强拍/撞音时强制 snapToPool 到新和弦音池。修复 ToplineEngine 基于 basicChords / Viterbi 改和弦后的撞音悖论。

```ts
// ============================================================
// runPipeline — Phase 5 入口（Mood 系统 + Conductor + 副旋律 + 调性适配）
// ============================================================
// Pitch Space: RELATIVE（chord.root / melody.pitch / counterMelody.pitch 都是相对空间，
// Orchestrator.arrange() 是 keyOffset 唯一应用点；鼓组是绝对 GM 键位，永不加偏移）
//
// Phase 5 新增：
//   - Mood 系统：抽 mood → 调制 BPM、tonality 偏好、energy cap
//   - HarmonyCore 接收 tonality + keyOffset：小调适配 + chord.keyOffset 给 UI
//   - ToplineEngine.generateCounterMelody：副旋律
//   - ConductorPlanner.plan：段落级 silent/support 配器计划
// ============================================================

import {
    GeneratedTrack,
    MusicContext,
    GenerationOptions,
    SectionMetadata,
    NoteData,
    GeneratedChord,
    Tonality,
    EnsembleDraft,
    ChordQuality,
} from '../types';
import { StyleId } from '../config/StyleFlags';
import { MoodId, MoodRegistry } from '../config/MoodFlags';
import { getStyleConfig } from '../config/styles/StyleRegistry';
import { PRNGManager } from '../../utils/PRNG';
import { HarmonyCore } from '../harmony/HarmonyCore';
import { ViterbiChordSelector } from '../harmony/ViterbiChordSelector';
import { ToplineEngine } from '../melody/ToplineEngine';
import { GrooveEngine } from '../composing/GrooveEngine';
import { StructureEngine } from '../composing/StructureEngine';
import { ConductorPlanner } from './ConductorPlanner';
import { getIdiomForInstrument } from '../idioms/IdiomRegistry';
import { MusicTheory } from '../theory/MusicTheory';

export interface PipelineRunOptions {
    allowedStyleIds?: StyleId[];
    forcedStyleId?: StyleId;
    forcedMoodId?: MoodId;
    generation?: GenerationOptions;
}

const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export function runPipeline(options: PipelineRunOptions = {}): { track: GeneratedTrack; context: MusicContext } {
    PRNGManager.recordSnapshot('B');

    const styleId = options.forcedStyleId ?? options.allowedStyleIds?.[0] ?? StyleId.AcgLightMusic;
    const style = getStyleConfig(styleId);

    // --- Mood：抽情绪 ---
    const moodIds: MoodId[] = [
        MoodId.Neutral, MoodId.Chill, MoodId.Melancholic,
        MoodId.Energetic, MoodId.Aggressive, MoodId.Euphoric,
    ];
    const moodId = options.forcedMoodId ?? moodIds[PRNGManager.nextInt(0, moodIds.length - 1)];
    const mood = MoodRegistry[moodId];

    // --- BPM：风格基准 × mood 乘数 ---
    let bpm = PRNGManager.nextInt(style.global.bpmRange[0], style.global.bpmRange[1]);
    bpm = Math.round(bpm * PRNGManager.nextFloat(mood.bpmMultiplier[0], mood.bpmMultiplier[1]));

    // --- Tonality：mood 偏好 > style 兜底 ---
    let tonality: Tonality = Tonality.Major;
    if (mood.tonalityBias && mood.tonalityBias.length > 0) {
        tonality = mood.tonalityBias[PRNGManager.nextInt(0, mood.tonalityBias.length - 1)].tonality;
    } else {
        const tonalityPool = style.global.tonalityPool;
        tonality = tonalityPool[PRNGManager.nextInt(0, tonalityPool.length - 1)].tonality;
    }

    const keyOffset = PRNGManager.nextInt(0, 11);
    const key = KEY_NAMES[keyOffset];

    // --- Sections：StructureEngine 抽 form + mood.energyCap 钳制能量 ---
    const sections: SectionMetadata[] = StructureEngine.generateStructure(bpm, style, mood);

    // --- 🌟 汽配前置：智能动态编制 (Ensemble Drafter - 纯键盘生态) ---
    const orch = style.orchestration;
    const pianoPool = ['Acoustic_Grand', 'Electric_Piano_1', 'Electric_Piano_2', 'Warm_EP', 'Lofi_Piano'];
    const pickInst = (pool: string[]): string => pool && pool.length > 0 ? pool[PRNGManager.nextInt(0, pool.length - 1)] : 'Acoustic_Grand';

    // 动态交响逻辑：
    // 如果允许无鼓，且情绪较弱（energyCap[1] <= 5）或随机命中，则砍掉鼓组
    const isQuietMood = mood.energyCap[1] <= 5;
    const noDrums = orch.allowDrumless && (isQuietMood || PRNGManager.nextFloat(0, 1) < 0.3);

    // 如果无鼓，极大概率砍掉独立贝斯，让左手(chordInst)全权接管贝斯频段 -> 诞生纯钢琴独奏！
    const noBass = noDrums && orch.allowBassless && PRNGManager.nextFloat(0, 1) < 0.8;

    // 从风格定义的池子里抽，如果没定义就用 pianoPool 兜底
    let melodyInst = pickInst(orch.melodyInstruments.length > 0 ? orch.melodyInstruments : pianoPool);
    let chordInst = pickInst(orch.chordInstruments.length > 0 ? orch.chordInstruments : pianoPool);

    // 防撞车：如果是乐队模式，且主副抽到了一样的音色，尽量错开以拉开层次
    if (!noBass && melodyInst === chordInst && orch.melodyInstruments.length > 1) {
        let attempts = 0;
        while (melodyInst === chordInst && attempts < 5) {
            melodyInst = pickInst(orch.melodyInstruments);
            attempts++;
        }
    }

    // 💡 神来之笔：如果是独奏模式 (noBass)，我们强制让主伴奏使用同一音色，融为一体
    if (noBass) {
        chordInst = melodyInst;
    }

    const ensemble: EnsembleDraft = {
        melodySound: melodyInst,
        chordSound: chordInst,
        // 若无贝斯，伴奏钢琴完全接管物理低音轨
        bassSound: noBass ? chordInst : pickInst(orch.bassInstruments.length > 0 ? orch.bassInstruments : ['Acoustic_Bass']),
        drumSound: noDrums ? null : pickInst(orch.drumInstruments.length > 0 ? orch.drumInstruments : ['Standard_DrumKit']),
        secondaryMelodySound: null, // 强制关闭所有无用铺底
        counterMelodySound: null,
    };

    const melodyIdiom = getIdiomForInstrument(ensemble.melodySound, style.id);
    const counterMelodyIdiom = getIdiomForInstrument(ensemble.counterMelodySound, style.id);

    // --- Phase 7 双阶段和声 ---
    // 1) 骨架：HarmonyCore 用 StyleConfig 罗马数字池产出基本进行
    const basicChords: GeneratedChord[] = HarmonyCore.generateHarmonyTimeline(sections, style, tonality, keyOffset);

    // 2) 主旋律：基于骨架生成（先于 Viterbi，让 Viterbi 反向贴合旋律）
    const melody: NoteData[] = ToplineEngine.generateMelody(basicChords, tonality, mood, melodyIdiom);

    // 3) Viterbi 重配和声：style.useViterbiHarmony 开启时启用，否则保留骨架
    //    按段独立调用 reharmonize，每段传入自己的 tensionMultiplier：
    //    - 第一段 Chorus：tension=0.2（含蓄铺陈）
    //    - 末段 Chorus / Bridge：tension=1.0（开始秀操作，bVI/bIII/半音平滑全开）
    //    - 其他段：tension=0.5（中等张力）
    let finalChords: GeneratedChord[] = basicChords;
    if (style.useViterbiHarmony) {
        finalChords = reharmonizePerSection(basicChords, melody, tonality, sections);
    }

    // 3.5) 跨调一致性二次修正 (Pitch Correction Pass)
    //   原因：melody 基于 basicChords 生成；Viterbi 之后部分和弦根/quality 改变，
    //   原本与 basicChord 协和的弱拍/强拍音对新色彩可能产生小二度撞击。
    //   策略：对每个 melody 音符，找到所在 finalChord，计算其 chord pcs；
    //         若发生小二度摩擦或落在强拍，强制吸到新 chord 池中。
    //   Pitch Space: RELATIVE — note.pitch 与 chord.root 同处相对空间（K-1）
    if (style.useViterbiHarmony) {
        for (let i = 0; i < melody.length; i++) {
            const note = melody[i];
            let chord: GeneratedChord | null = null;
            for (let c = 0; c < finalChords.length; c++) {
                const fc = finalChords[c];
                if (note.onset >= fc.startBeat - 0.001 && note.onset < fc.endBeat - 0.001) {
                    chord = fc;
                    break;
                }
            }
            if (chord) {
                const qualityEnum = ChordQuality[chord.quality as keyof typeof ChordQuality];
                const intervals = MusicTheory.getChordTones(qualityEnum);
                const chordPcs: number[] = [];
                for (let j = 0; j < intervals.length; j++) {
                    chordPcs.push(((chord.root + intervals[j]) % 12 + 12) % 12);
                }

                // 检测小二度摩擦
                const pc = ((Math.round(note.pitch) % 12) + 12) % 12;
                let hasClash = false;
                for (let j = 0; j < chordPcs.length; j++) {
                    const absDiff = Math.abs(pc - chordPcs[j]);
                    const diff = Math.min(absDiff, 12 - absDiff);
                    if (diff === 1) { hasClash = true; break; }
                }

                // 强拍或发生撞音时，强行吸附到新和弦的音池中
                const isStrongBeat = Math.abs(note.onset - Math.round(note.onset)) < 0.05;
                if (isStrongBeat || hasClash) {
                    note.pitch = MusicTheory.snapToPool(note.pitch, chordPcs);
                }
            }
        }
    }

    // 4) 副旋律 / 鼓 / 指挥都基于 finalChords，保证织体与新和声协和
    const counterMelody: NoteData[] = ToplineEngine.generateCounterMelody(finalChords, tonality, mood, counterMelodyIdiom);
    const drums: NoteData[] = GrooveEngine.generateDrums(sections, mood);
    const conductorPlan = ConductorPlanner.plan(sections);

    const track: GeneratedTrack = {
        chords: finalChords,
        melody,
        counterMelody,
        drums,
        sections,
        bpm,
        key,
        keyOffset,
        tonality,
        timeSignature: [4, 4],
        blockIndex: 0,
        absoluteStartBeat: 0,
        hasIntro: true,
        preSelectedPalette: ensemble,
    };

    const context: MusicContext = {
        keyOffset,
        tonality,
        bpm,
        timeSignature: [4, 4],
        grooveDNA: [],
        moodId,
        style,
        conductorPlan,
        ensemble,
    };

    return { track, context };
}

// --------------------------------------------------------
// 按段独立 Viterbi 重配（Phase 3 张力门入口）
// --------------------------------------------------------
// 每段独立调用 reharmonize 而非全曲一次性，原因：
//   - tensionMultiplier 是**段落级**调制（首副歌=0.2 vs 末副歌=1.0）
//   - Viterbi 不消耗 PRNG（纯函数），分段调用不破坏全管线确定性序列
//   - reharmonize 内部按 chord.startBeat 切旋律，传入全曲 melody 安全
//
// 注意：sections 必须覆盖所有 basicChords 的时间轴；不在任何 sec 内的 chord 会丢失。
// 这是与 StructureEngine 的契约 —— 段间不能有时间间隙。
const SEC_EPS = 0.001;

function computeSectionTension(
    sec: SectionMetadata,
    sectionIdx: number,
    firstChorusIdx: number,
    lastChorusIdx: number,
    chorusCount: number,
): number {
    if (sec.name === 'Bridge') return 1.0;
    if (sec.name === 'Chorus') {
        // 末副歌（且总共有 ≥2 段 Chorus）→ tension=1.0
        if (chorusCount >= 2 && sectionIdx === lastChorusIdx) return 1.0;
        // 第一段 Chorus → tension=0.2
        if (sectionIdx === firstChorusIdx) return 0.2;
    }
    return 0.5;
}

function reharmonizePerSection(
    basicChords: GeneratedChord[],
    melody: NoteData[],
    tonality: Tonality,
    sections: SectionMetadata[],
): GeneratedChord[] {
    let firstChorusIdx = -1;
    let lastChorusIdx = -1;
    let chorusCount = 0;
    for (let i = 0; i < sections.length; i++) {
        if (sections[i].name === 'Chorus') {
            if (firstChorusIdx === -1) firstChorusIdx = i;
            lastChorusIdx = i;
            chorusCount++;
        }
    }

    const result: GeneratedChord[] = [];
    for (let s = 0; s < sections.length; s++) {
        const sec = sections[s];

        const secChords: GeneratedChord[] = [];
        for (let c = 0; c < basicChords.length; c++) {
            const ch = basicChords[c];
            if (ch.startBeat >= sec.startBeat - SEC_EPS && ch.startBeat < sec.endBeat - SEC_EPS) {
                secChords.push(ch);
            }
        }
        if (secChords.length === 0) continue;

        const tension = computeSectionTension(sec, s, firstChorusIdx, lastChorusIdx, chorusCount);
        const reharm = ViterbiChordSelector.reharmonize(secChords, melody, tonality, tension);
        for (let i = 0; i < reharm.length; i++) result.push(reharm[i]);
    }
    return result;
}
```

### `src/core/generation/pipeline/ConductorPlanner.ts`

> 🚧 Phase 5 — 段落级智能配器避让：按 energyLevel 决定每段 focus / support / silent。Orchestrator 物理消音 silent 角色。

```ts
// ============================================================
// ConductorPlanner — 段落级智能配器避让
// ============================================================
// 基于段落 energyLevel 决定每段的 focus / support / silent 乐器：
//
//   energyLevel <= 3   静谧段落（Intro / Outro 极弱）
//     → silent: drums, bass, counter, secondary
//     → 只剩 melody + chord 维持极简织体
//
//   energyLevel <= 5   中等段落（Verse / Outro）
//     → silent: counter, secondary
//     → 主旋律 + 鼓 + 贝斯 + 和弦，counter 不出场
//
//   energyLevel >= 6   高能段落（Chorus）
//     → support 加入 counter, drums
//     → 全员上阵，counter 与 melody 形成对位
//
// Orchestrator 读取 silentInstruments 做物理消音（按段落过滤音符 onset）。
// ============================================================

import { SectionMetadata, ConductorPlan, InstrumentRole, ConductorSectionPlan } from '../types';

const ENERGY_LOW = 3;
const ENERGY_MID = 5;

export class ConductorPlanner {
    public static plan(sections: SectionMetadata[]): ConductorPlan {
        const planSections: ConductorSectionPlan[] = [];

        for (let i = 0; i < sections.length; i++) {
            const sec = sections[i];
            const silent: InstrumentRole[] = [];
            const support: InstrumentRole[] = ['bass', 'chord'];
            const focus: InstrumentRole = 'melody';

            if (sec.energyLevel <= ENERGY_LOW) {
                silent.push('drums', 'bass', 'counter', 'secondary');
            } else if (sec.energyLevel <= ENERGY_MID) {
                silent.push('counter', 'secondary');
            } else {
                support.push('counter', 'drums');
            }

            planSections.push({
                sectionName: sec.name,
                startBeat: sec.startBeat,
                endBeat: sec.endBeat,
                focusInstrument: focus,
                supportInstruments: support,
                silentInstruments: silent,
                rhythmCenter: 'downbeat',
                counterpointPairs: [],
                fillWindows: [],
            });
        }

        return {
            sections: planSections,
            globalRhythmProfile: 'four-on-floor',
        };
    }
}
```

### `src/core/generation/utils/SongComparisonLogger.ts`

> 🚧 STUB — buildComparisonLog() 返回单行占位（原版做完整 STRUCTURE/MELODY STATS/HARMONY 表格输出）。

```ts
// ============================================================
// 🚧 STUB — 跨系统对比日志器占位
// ============================================================
//
// 历史功能：
//   buildComparisonLog() 用于把生成结果序列化成固定格式的 ASCII 日志，
//   便于与 C 移植版 / 其他算法系统做 A/B 比对（SONG_COMPARISON_LOG_SPEC.md）。
//   报告结构：META / TRACKS / STRUCTURE / MELODY STATS / HARMONY。
//
// 重构期占位行为：
//   返回单行占位字符串。AuraRadio 在 comparisonMode 下会 console.log 这一行。
//
// 重构方向：
//   新引擎产出有效 GeneratedTrack 后，恢复完整统计逻辑（参考 git 历史里旧版实现）。
// ============================================================

import { GeneratedTrack } from '../types';

export interface ComparisonLogInput {
    seed: number;
    styleName: string;
    track: GeneratedTrack;
    engineName?: string;
}

export function buildComparisonLog(input: ComparisonLogInput): string {
    const engineName = input.engineName ?? 'AuraFlow';
    return `[${engineName}] seed=${input.seed} style=${input.styleName} (stub: full comparison log disabled during refactor)`;
}
```

---

## 第九部分：脚本工具


### `scripts/prng-verify.ts`

> PRNG 跨平台验证：seed=12345 跑 10000 步 + nextInt/nextFloat 各 100 次。输出 prng-verify-output.json，与 C 移植版逐字节比对。

```ts
/**
 * Phase 1.3 — PRNG 验证数据录制
 *
 * seed=12345 跑 10000 步，输出每步 state + next() 返回值。
 * 另外录制 nextInt / nextFloat 派生方法的验证数据。
 * 用于 C 侧逐步比对。
 *
 * 运行：npx tsx scripts/prng-verify.ts
 */
import { writeFileSync } from 'node:fs';
import { PRNGManager } from '../src/core/utils/PRNG';

const SEED = 12345;
const STEPS = 10000;

function run() {
    // Part 1: next() 序列 — 10000 步
    PRNGManager.setSeed(SEED);
    const states: number[] = [];
    const values: number[] = [];

    for (let i = 0; i < STEPS; i++) {
        const val = PRNGManager.next();
        const state = PRNGManager.getState();
        states.push(state);
        values.push(val);
    }

    // Part 2: nextInt 验证（100 次）
    PRNGManager.setSeed(SEED);
    const nextIntResults: { min: number; max: number; result: number; state: number }[] = [];
    const intTestCases = [
        { min: 0, max: 10 },
        { min: 1, max: 100 },
        { min: -5, max: 5 },
        { min: 0, max: 1 },
        { min: 60, max: 84 },
    ];
    for (let i = 0; i < 100; i++) {
        const tc = intTestCases[i % intTestCases.length];
        const result = PRNGManager.nextInt(tc.min, tc.max);
        nextIntResults.push({ ...tc, result, state: PRNGManager.getState() });
    }

    // Part 3: nextFloat 验证（100 次）
    PRNGManager.setSeed(SEED);
    const nextFloatResults: { min: number; max: number; result: number; state: number }[] = [];
    const floatTestCases = [
        { min: 0.0, max: 1.0 },
        { min: -1.0, max: 1.0 },
        { min: 0.5, max: 0.9 },
        { min: 60.0, max: 200.0 },
        { min: 0.0, max: 0.01 },
    ];
    for (let i = 0; i < 100; i++) {
        const tc = floatTestCases[i % floatTestCases.length];
        const result = PRNGManager.nextFloat(tc.min, tc.max);
        nextFloatResults.push({ ...tc, result, state: PRNGManager.getState() });
    }

    const output = {
        seed: SEED,
        steps: STEPS,
        prngAlgorithm: 'LCG: state = (state * 1664525 + 1013904223) % 4294967296',
        sequence: {
            description: 'state[i] and value[i] are AFTER the i-th call to next()',
            first20States: states.slice(0, 20),
            first20Values: values.slice(0, 20),
            last5States: states.slice(-5),
            last5Values: values.slice(-5),
            state_at_1000: states[999],
            state_at_5000: states[4999],
            state_at_10000: states[9999],
        },
        nextInt: {
            description: 'PRNG reset to same seed, 100 calls to nextInt with varying ranges',
            first10: nextIntResults.slice(0, 10),
        },
        nextFloat: {
            description: 'PRNG reset to same seed, 100 calls to nextFloat with varying ranges',
            first10: nextFloatResults.slice(0, 10),
        },
        // Full state dump for C comparison (compact: one state per line)
        fullStates: states,
    };

    const outPath = new URL('./prng-verify-output.json', import.meta.url).pathname;
    writeFileSync(outPath, JSON.stringify(output, null, 2));

    // Print summary
    console.log(`PRNG Verification Data — seed=${SEED}, ${STEPS} steps`);
    console.log('='.repeat(50));
    console.log(`State after step 1:     ${states[0]}`);
    console.log(`State after step 1000:  ${states[999]}`);
    console.log(`State after step 5000:  ${states[4999]}`);
    console.log(`State after step 10000: ${states[9999]}`);
    console.log(`\nFirst 5 values: ${values.slice(0, 5).map(v => v.toFixed(10)).join(', ')}`);
    console.log(`\nOutput: ${outPath}`);
}

run();
```

### `scripts/diag_seed.ts`

> ✅ 跨调一致性诊断（本轮新增）— `npx tsx scripts/diag_seed.ts <seed>` 一次跑完整管线，按轨道报告 pitch class 分布、调外比例、和弦内命中率，定位 borrowed-chord 段的旋律撞调问题。生成 seed 20107772 验证报告即用此脚本。

```ts
// 诊断 seed 的调性一致性
// 用法：npx tsx scripts/diag_seed.ts [seed]
// 检查每条轨道在绝对空间下的 pitch class 是否落在 (scale + keyOffset) 内
// 以及每个旋律音是否与同时间和弦协和

import { PRNGManager } from '../src/core/utils/PRNG';
import { runPipeline } from '../src/core/generation/pipeline';
import { Orchestrator } from '../src/core/generation/arrangement/Orchestrator';
import { SCALE_INTERVALS, CHORD_INTERVALS, ChordQuality, TonalityName, NoteData, GeneratedChord } from '../src/core/generation/types';
import { StyleId } from '../src/core/generation/config/StyleFlags';

const SEED = Number(process.argv[2] ?? 20107772);
PRNGManager.setSeed(SEED);
PRNGManager.next();  // 模拟 App 层 step 1 的 ×1 PRNG 消耗

const { track, context } = runPipeline();
const arranged = Orchestrator.arrange(track, StyleId.AcgLightMusic, context);

const keyOffset = track.keyOffset;
const tonality = track.tonality;
const scaleIntervals = SCALE_INTERVALS[tonality];
const scaleSet = new Set<number>();
for (const iv of scaleIntervals) scaleSet.add((iv + keyOffset + 12) % 12);

console.log('='.repeat(70));
console.log(`SEED ${SEED}`);
console.log(`bpm=${track.bpm}  key=${track.key}  keyOffset=${keyOffset}  tonality=${TonalityName[tonality]}`);
console.log(`scale (abs pcs): ${[...scaleSet].sort((a, b) => a - b).join(',')}`);
console.log(`useViterbiHarmony=${context.style?.useViterbiHarmony}`);
console.log('='.repeat(70));

function pitchClass(p: number): number {
    return ((Math.round(p) % 12) + 12) % 12;
}

function diagTrack(name: string, notes: NoteData[]) {
    if (!notes || notes.length === 0) {
        console.log(`${name.padEnd(18)} empty`);
        return;
    }
    let outOfScale = 0;
    const pcCount: Record<number, number> = {};
    for (const n of notes) {
        const pc = pitchClass(n.pitch);
        pcCount[pc] = (pcCount[pc] ?? 0) + 1;
        if (!scaleSet.has(pc)) outOfScale++;
    }
    const distrib = Object.entries(pcCount)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([pc, cnt]) => `${pc}:${cnt}${scaleSet.has(Number(pc)) ? '' : '*'}`)
        .join(' ');
    console.log(`${name.padEnd(18)} N=${notes.length}  out-of-scale=${outOfScale}  pc distrib: ${distrib}`);
}

console.log('--- Per-track pitch class scan (* = out-of-scale) ---');
diagTrack('melody', arranged.melody);
diagTrack('pianoRH', arranged.pianoRH);
diagTrack('pianoLH', arranged.pianoLH);
diagTrack('counterMelody', arranged.counterMelody ?? []);
diagTrack('secondaryMelody', arranged.secondaryMelody ?? []);

const chords = arranged.chords ?? [];
console.log('\n--- Chord progression (first 16, abs pcs) ---');
for (let i = 0; i < Math.min(chords.length, 16); i++) {
    const c = chords[i];
    const qEnum = ChordQuality[c.quality as keyof typeof ChordQuality];
    const intervals = CHORD_INTERVALS[qEnum];
    const absPcs: number[] = [];
    for (const iv of intervals) absPcs.push(((c.root + iv + (c.keyOffset ?? keyOffset)) % 12 + 12) % 12);
    console.log(`  [${i.toString().padStart(2)}] ${c.numeral.padEnd(8)} root=${c.root.toString().padStart(2)} keyOff=${c.keyOffset ?? keyOffset} chord-pcs(abs)=${absPcs.sort((a,b)=>a-b).join(',')}  beats[${c.startBeat.toFixed(2)}, ${c.endBeat.toFixed(2)})`);
}

function chordPcsAt(beat: number, chs: GeneratedChord[]): { pcs: Set<number>; numeral: string } | null {
    for (const c of chs) {
        if (beat >= c.startBeat - 0.001 && beat < c.endBeat - 0.001) {
            const qEnum = ChordQuality[c.quality as keyof typeof ChordQuality];
            const intervals = CHORD_INTERVALS[qEnum];
            const set = new Set<number>();
            for (const iv of intervals) set.add(((c.root + iv + (c.keyOffset ?? keyOffset)) % 12 + 12) % 12);
            return { pcs: set, numeral: c.numeral };
        }
    }
    return null;
}

function chordHarmonyRate(name: string, notes: NoteData[]): void {
    if (!notes || notes.length === 0) return;
    let inChord = 0, total = 0, inScale = 0;
    const violations: string[] = [];
    for (const n of notes) {
        const info = chordPcsAt(n.onset, chords);
        if (!info) continue;
        total++;
        const pc = pitchClass(n.pitch);
        if (info.pcs.has(pc)) inChord++;
        if (scaleSet.has(pc)) inScale++;
        else if (violations.length < 6) {
            violations.push(`onset=${n.onset.toFixed(2)} pitch=${n.pitch} pc=${pc} chord=${info.numeral} chord-pcs=[${[...info.pcs].sort((a,b)=>a-b).join(',')}]`);
        }
    }
    console.log(`${name.padEnd(18)} chord-tone ${inChord}/${total} (${(100*inChord/total).toFixed(1)}%) | in-scale ${inScale}/${total} (${(100*inScale/total).toFixed(1)}%)`);
    if (violations.length > 0) {
        console.log(`  out-of-scale samples:`);
        for (const v of violations) console.log(`    ${v}`);
    }
}

console.log('\n--- Chord-tone & scale-tone hit rate ---');
chordHarmonyRate('melody', arranged.melody);
chordHarmonyRate('pianoRH', arranged.pianoRH);
chordHarmonyRate('pianoLH', arranged.pianoLH);
chordHarmonyRate('counterMelody', arranged.counterMelody ?? []);
chordHarmonyRate('secondaryMelody', arranged.secondaryMelody ?? []);

const chordKeyOffsets = new Set<number>();
for (const c of chords) chordKeyOffsets.add(c.keyOffset ?? -1);
console.log(`\n--- keyOffset consistency ---`);
console.log(`track.keyOffset = ${track.keyOffset}`);
console.log(`chord.keyOffset values seen: ${[...chordKeyOffsets].join(',')}`);
console.log(`(should be a single value matching track.keyOffset)`);

// Sanity check: melody 第一个音 vs pianoLH 第一个音的 pitch class 是否落入同一调
const m0 = arranged.melody[0];
const lh0 = arranged.pianoLH[0];
console.log(`\nFirst-note sanity: melody[0].pitch=${m0?.pitch} (pc=${m0 ? pitchClass(m0.pitch) : '-'})  vs  pianoLH[0].pitch=${lh0?.pitch} (pc=${lh0 ? pitchClass(lh0.pitch) : '-'})`);
```

### `scripts/json2c.py`

> 孤儿脚本：原依赖 golden-seed.ts 的输出。等新生成器恢复 golden-seed 后可启用。

```python
#!/usr/bin/env python3
"""
Phase 4.2 — Golden Seed JSON → C 头文件转换工具

读取 golden-seed-output.json，输出 C 可 #include 的验证数据。
用法：python3 scripts/json2c.py [input.json] [output.h]

默认：scripts/golden-seed-output.json → scripts/golden_seed_data.h
"""

import json
import sys
from pathlib import Path

def main():
    script_dir = Path(__file__).parent
    input_path = Path(sys.argv[1]) if len(sys.argv) > 1 else script_dir / "golden-seed-output.json"
    output_path = Path(sys.argv[2]) if len(sys.argv) > 2 else script_dir / "golden_seed_data.h"

    with open(input_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    seeds = data["seeds"]
    ppq = data["ppq"]
    style_count = data["styleCount"]

    lines = []
    lines.append("/**")
    lines.append(" * Auto-generated by scripts/json2c.py")
    lines.append(f" * Source: {input_path.name}")
    lines.append(f" * Generated: {data['generatedAt']}")
    lines.append(f" * PRNG: {data['prngAlgorithm']}")
    lines.append(" *")
    lines.append(" * DO NOT EDIT — regenerate with: python3 scripts/json2c.py")
    lines.append(" */")
    lines.append("")
    lines.append("#ifndef GOLDEN_SEED_DATA_H")
    lines.append("#define GOLDEN_SEED_DATA_H")
    lines.append("")
    lines.append("#include <stdint.h>")
    lines.append("")

    # Constants
    lines.append(f"#define GOLDEN_SEED_COUNT       {len(seeds)}")
    lines.append(f"#define GOLDEN_PPQ              {ppq}")
    lines.append(f"#define GOLDEN_STYLE_COUNT      {style_count}")
    lines.append("")

    # Available style IDs
    style_ids = [s["id"] for s in data["availableStyles"]]
    lines.append(f"static const uint8_t GOLDEN_STYLE_IDS[{len(style_ids)}] = {{")
    lines.append(f"    {', '.join(str(s) for s in style_ids)}")
    lines.append("};")
    lines.append("")

    # PRNG snapshot struct
    lines.append("typedef struct {")
    lines.append("    uint32_t seed;")
    lines.append("    uint32_t stateA;          /* after setSeed */")
    lines.append("    uint8_t  selectedStyleId;")
    lines.append("    uint32_t stateB;          /* after style selection */")
    lines.append("    uint32_t stateC;          /* after generateFullSong */")
    lines.append("    uint32_t stateD;          /* after arrange */")
    lines.append("} GoldenPRNGSnapshot;")
    lines.append("")

    # PRNG snapshots array
    lines.append(f"static const GoldenPRNGSnapshot GOLDEN_PRNG[{len(seeds)}] = {{")
    for i, s in enumerate(seeds):
        comma = "," if i < len(seeds) - 1 else ""
        lines.append(f"    {{ /* seed={s['seed']} */")
        lines.append(f"        .seed = {s['seed']}u,")
        lines.append(f"        .stateA = {s['stateA']}u,")
        lines.append(f"        .selectedStyleId = {s['selectedStyleId']},")
        lines.append(f"        .stateB = {s['stateB']}u,")
        lines.append(f"        .stateC = {s['stateC']}u,")
        lines.append(f"        .stateD = {s['stateD']}u")
        lines.append(f"    }}{comma}")
    lines.append("};")
    lines.append("")

    # Track metadata struct
    lines.append("typedef struct {")
    lines.append("    uint32_t seed;")
    lines.append("    uint16_t bpm;")
    lines.append("    uint8_t  keyOffset;       /* 0~11 */")
    lines.append("    uint8_t  tonality;")
    lines.append("    uint8_t  timeSigNum;")
    lines.append("    uint8_t  timeSigDen;")
    lines.append("    uint16_t sectionCount;")
    lines.append("    uint16_t melodyNoteCount;")
    lines.append("    uint16_t chordCount;")
    lines.append("} GoldenTrackMeta;")
    lines.append("")

    lines.append(f"static const GoldenTrackMeta GOLDEN_TRACK[{len(seeds)}] = {{")
    for i, s in enumerate(seeds):
        t = s["track"]
        comma = "," if i < len(seeds) - 1 else ""
        lines.append(f"    {{ /* seed={s['seed']} */")
        lines.append(f"        .seed = {s['seed']}u,")
        lines.append(f"        .bpm = {t['bpm']},")
        lines.append(f"        .keyOffset = {t['keyOffset']},")
        lines.append(f"        .tonality = {t['tonality']},")
        lines.append(f"        .timeSigNum = {t['timeSignature'][0]},")
        lines.append(f"        .timeSigDen = {t['timeSignature'][1]},")
        lines.append(f"        .sectionCount = {t['sectionCount']},")
        lines.append(f"        .melodyNoteCount = {t['melodyNoteCount']},")
        lines.append(f"        .chordCount = {t['chordCount']}")
        lines.append(f"    }}{comma}")
    lines.append("};")
    lines.append("")

    # Arranged track counts struct
    lines.append("typedef struct {")
    lines.append("    uint32_t seed;")
    lines.append("    uint16_t melodyCount;")
    lines.append("    uint16_t pianoLHCount;")
    lines.append("    uint16_t pianoRHCount;")
    lines.append("    uint16_t drumsCount;")
    lines.append("    uint16_t secondaryMelodyCount;")
    lines.append("    uint16_t counterMelodyCount;")
    lines.append("    uint16_t vocalCount;")
    lines.append("} GoldenArrangedCounts;")
    lines.append("")

    lines.append(f"static const GoldenArrangedCounts GOLDEN_ARRANGED[{len(seeds)}] = {{")
    for i, s in enumerate(seeds):
        a = s["arranged"]
        comma = "," if i < len(seeds) - 1 else ""
        lines.append(f"    {{ /* seed={s['seed']} */")
        lines.append(f"        .seed = {s['seed']}u,")
        lines.append(f"        .melodyCount = {a['melodyNoteCount']},")
        lines.append(f"        .pianoLHCount = {a['pianoLHNoteCount']},")
        lines.append(f"        .pianoRHCount = {a['pianoRHNoteCount']},")
        lines.append(f"        .drumsCount = {a['drumsNoteCount']},")
        lines.append(f"        .secondaryMelodyCount = {a['secondaryMelodyNoteCount']},")
        lines.append(f"        .counterMelodyCount = {a['counterMelodyNoteCount']},")
        lines.append(f"        .vocalCount = {a['vocalNoteCount']}")
        lines.append(f"    }}{comma}")
    lines.append("};")
    lines.append("")

    # MIDI event summary struct
    lines.append("typedef struct {")
    lines.append("    uint32_t seed;")
    lines.append("    uint32_t totalCount;")
    lines.append("    uint32_t noteOnCount;")
    lines.append("    uint32_t noteOffCount;")
    lines.append("    uint32_t ccCount;")
    lines.append("    const char *sha256;       /* hex string */")
    lines.append("} GoldenMidiSummary;")
    lines.append("")

    # SHA-256 string literals
    for s in seeds:
        lines.append(f'static const char GOLDEN_SHA256_SEED_{s["seed"]}[] = "{s["midiEvents"]["sha256"]}";')
    lines.append("")

    lines.append(f"static const GoldenMidiSummary GOLDEN_MIDI[{len(seeds)}] = {{")
    for i, s in enumerate(seeds):
        m = s["midiEvents"]
        comma = "," if i < len(seeds) - 1 else ""
        lines.append(f"    {{ /* seed={s['seed']} */")
        lines.append(f"        .seed = {s['seed']}u,")
        lines.append(f"        .totalCount = {m['totalCount']}u,")
        lines.append(f"        .noteOnCount = {m['noteOnCount']}u,")
        lines.append(f"        .noteOffCount = {m['noteOffCount']}u,")
        lines.append(f"        .ccCount = {m['ccCount']}u,")
        lines.append(f"        .sha256 = GOLDEN_SHA256_SEED_{s['seed']}")
        lines.append(f"    }}{comma}")
    lines.append("};")
    lines.append("")

    # First 10 MIDI events per seed (for spot-checking)
    lines.append("typedef struct {")
    lines.append("    int32_t  ticks;")
    lines.append("    uint8_t  type;            /* 0=noteOn,1=noteOff,2=cc,3=programChange,4=pitchBend,5=visual */")
    lines.append("    uint8_t  channel;")
    lines.append("    uint8_t  data1;")
    lines.append("    uint8_t  data2;")
    lines.append("} GoldenMidiEvent;")
    lines.append("")

    type_map = {
        "noteOn": 0, "noteOff": 1, "cc": 2,
        "programChange": 3, "pitchBend": 4, "visual": 5
    }

    for s in seeds:
        seed = s["seed"]
        events = s["midiEvents"]["first10Events"]
        lines.append(f"static const GoldenMidiEvent GOLDEN_FIRST10_SEED_{seed}[{len(events)}] = {{")
        for j, e in enumerate(events):
            comma = "," if j < len(events) - 1 else ""
            t = type_map.get(e["type"], 5)
            lines.append(f"    {{ {e['ticks']}, {t}, {e['channel']}, {e['data1']}, {e['data2']} }}{comma}")
        lines.append("};")
        lines.append("")

    lines.append("#endif /* GOLDEN_SEED_DATA_H */")
    lines.append("")

    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"Generated: {output_path}")
    print(f"  {len(seeds)} seeds, {sum(1 for l in lines if l.strip())} non-empty lines")


if __name__ == "__main__":
    main()
```

---

## 附录：删除/重建清单

### Phase 1~5 + V7.6 已重建/新增的文件（10 个）

```
src/core/generation/theory/MusicTheory.ts                ← Phase 1~5（snapToScale/Pool, getSmoothVoicing, getDrop2Voicing, parseNumeral 含小调适配）
src/core/generation/harmony/HarmonyCore.ts               ← Phase 5（generateHarmonyTimeline 接 tonality + keyOffset）
src/core/generation/harmony/ViterbiChordSelector.ts      ← Phase 7（旋律驱动的 HMM + Viterbi 双阶段和声重配）
src/core/generation/idioms/IdiomRegistry.ts              ← 🌟 V7.6 新增（InstrumentIdiom 注册表 + getIdiomForInstrument 路由）
src/core/generation/melody/RhythmCells.ts                ← Phase 2（6 种基础节奏切片）
src/core/generation/melody/ToplineEngine.ts              ← Phase 6 + V7.6（含 generateCounterMelody + idiom 驱动呼吸 + 密度分裂）
src/core/generation/composing/GrooveEngine.ts            ← Phase 6（mood 调制 + 加花 + 16 分鬼音）
src/core/generation/composing/StructureEngine.ts         ← Phase 6（3 种 form 抽取 + mood.energyCap 钳制能量）
src/core/generation/arrangement/TextureMapper.ts         ← Phase 8 + V7.6（bass / rhythmComping / sustainedPad 三层 + chordIdiom 数据驱动）
src/core/generation/arrangement/Orchestrator.ts          ← V7.6（剥夺抽卡权，改读 context.ensemble + 派生 chordIdiom）
src/core/generation/pipeline/index.ts                    ← V7.6（汽配前置：sections 后立即敲定 ensemble + 派生 idiom 透传）
src/core/generation/pipeline/ConductorPlanner.ts         ← Phase 5（按 energyLevel 决定段落 silent/support/focus）
```

注：以上文件名（除 `ConductorPlanner.ts` 与 V7.6 新增的 `IdiomRegistry.ts`）与旧引擎重名，但实现是从零写的极简版，不是旧代码恢复。

### 仍未重建的文件（旧引擎清单，等待后续 Phase 决策）

```
src/core/generation/composing/MusicTheoryRules.ts
src/core/generation/harmony/{CandidatePool,ChordMask,ChordNumeral,ChordScoreTable,HarmonyPipeline,ShadowSkeletonGenerator,SkeletonMelodyGenerator}.ts
src/core/generation/pipeline/{CadentialBridger,Stage1_StyleAndMood,Stage2_BasicParams,Stage3_HarmonicEngine,Stage4_ConductorPlanner,Stage5_InstrumentLayering,types}.ts
src/core/generation/review/GlobalReviewer.ts
src/core/generation/state/SongState.ts
src/core/generation/utils/{BeatMath,Dedup}.ts
src/core/generation/arrangement/{EnsembleDrafter,MotifLooper,TransitionEngine}.ts
src/core/generation/config/EnergyThresholds.ts
```

→ 现有实现已能跑出有意义的音乐 + 双阶段和声 + Mood + Conductor 物理消音；这些更复杂模块（CadentialBridger 251 注入、五阶段拓扑、GlobalReviewer 全局审查等）会按需在后续 Phase 选择性重建。

### 已物理删除的 5 个测试脚本（仍未恢复）

```
scripts/array-stats.ts                ← 200 seed 数组长度分布统计
scripts/golden-seed.ts                ← 黄金种子 ACVE 验证数据生成器
scripts/test_harmony_pipeline.ts      ← 双阶段和声管道测试
scripts/test_viterbi.ts               ← Viterbi 选和弦测试
scripts/array-stats-output.json
```

### 同步修改
- `package.json` 移除 `golden-seed` / `array-stats` 两个 npm script（未恢复）
- `types.ts` Phase 4 追加 `GeneratedTrack.drums?: NoteData[]`；Phase 5 进一步追加 `GeneratedTrack.counterMelody?: NoteData[]`；🌟 V7.6 追加 `InstrumentIdiom` 接口（仅追加，向后兼容）；战役四：`EnsembleDraft.secondaryMelodySound` 类型放宽为 `string | null`
- `audio/PlaybackEngine.ts` Phase 5+ 把 `transposeOffset` 恒定为 0（K-2 在 Orchestrator 一次性应用，PlaybackEngine 不再二次转调；chord.keyOffset 字段保留供 UI 显示）；战役四：`DefaultStyleConfig` 引用改 `AcgStyleConfig`
- 🌟 V7.6 后 `Orchestrator` 不再消耗 PRNG（去掉 5 次 `pickInst` 抽卡），**stateD 之后的 PRNG 消耗序列已变** —— 旧 golden seed 全部需要按 §5 ACVE 验证义务重新录制
- 🌟 战役四：`StyleId` enum 仅保留 `AcgLightMusic = 20`；`StyleRegistry` 仅注册 `AcgStyle`（自包含，无 spread）；旧 shim 三件 (`DefaultStyleConfig` / `DarkSynthPopStyleConfig` / `LoFiChillStyleConfig`) → 单一 `AcgStyleConfig`；`BarData.ts` / `SeedController.RADIO_STYLE_POOL` / 三个 App Manager 的 `allStyleIds` 全部缩为 `[AcgLightMusic]`；pipeline `noDrums/noBass` 概率门 + 独奏融合 → ensemble 抽卡序列已变，**全部 golden seed 需重新录制**
