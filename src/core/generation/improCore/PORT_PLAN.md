# ImproCore — Impro-Visor 移植计划(活文档)

> 目标:在 `generate/improCore/` 下**忠实、完整复刻** Impro-Visor(Harvey Mudd, Java 1.8)的
> solo 即兴 + comping 伴奏能力,作为**独立沙盒**(Q+I 调出),完全不走 AuraFlow 主系统,
> 只在发声时复用 spessasynth。**先完整复刻,后对接 engine。**
>
> 策略:**全新从 Java 重写**(git 历史里删掉的旧 TS 端口 + 原 Java 源都仅作参照/oracle)。

## 决策锁定(2026-05-30)
- 忠实完整复刻,不做最小子集。"完整" = 复刻**音乐行为**完整,不照搬 Swing GUI / MIDI 文件导出 / undo。
- 全新重写引擎;**保留**已 fuzz 验证的语法数据层(`data/polylist.ts` + `data/sexpr-reader.ts` + 85 个 `.grammar` 源)。
- MVP = solo + comping 都要。
- 独立沙盒,Q+I 调出,输出仅经 `globalMidiScheduler` → spessasynth。

## 硬事实(已核实)
- **slot 分辨率**:`BEAT=120` slots/拍,`WHOLE=480` slots(4/4 一小节)。源:`Impro-Visor/src/imp/Constants.java`。
- **发声换算**:MidiScheduler PPQ=480 ticks/四分音符;Impro-Visor QUARTER=120 slots → **ticks = slots × 4**。
- **grammar 源**:85 个 `.grammar` 都在 `data/grammars/`,忠实引擎可直接 parse → Polylist → run(照 Java `loadGrammar` 路径)。
- **comping 数据**:当年随引擎删了,但原 Java repo 还在 → `Impro-Visor/styles/`(145 .sty)、`Impro-Visor/vocab/My.voc`(和弦词汇)。需搬运。

## 目录结构
```
improCore/
  data/        (保留:grammar ROM + polylist + sexpr-reader + 85 .grammar)
  engine/      (新:重写的 Impro-Visor 引擎)
    constants.ts   ✅ Phase 0   (BEAT/WHOLE/CMIDI/OCTAVE/slot↔tick)
    pitch.ts       ✅ Phase 1   (PitchClass line-of-fifths + 移调表 + NoteSymbol)
    duration.ts    ✅ Phase 1   (Duration.getDuration:时值串→slots)
    vocab.ts       ✅ Phase 1   (ChordForm + parseVocab + getChordForm,纯逻辑可测)
    vocab-rom.ts   ✅ Phase 1   (唯一 `?raw` 触点:注入 My.voc)
    chord.ts       ✅ Phase 1   (ChordSymbol 名字解析 + Chord 实现层)
    index.ts       ✅ Phase 1   (副作用初始化 vocab + 统一导出)
    vocab/My.voc   ✅ Phase 1   (Impro-Visor 官方词汇,9148 行)
    terminals.ts   ✅ Phase 2   (值模型 numberize + Terminals 谓词/getDuration/truncate)
    grammar.ts     ✅ Phase 2   (Grammar.java 展开引擎:栈推导+findRule轮盘+evaluate+wrapper)
    chordpart.ts   ✅ Phase 3   (最小 ChordPart:getCurrentChord(slot))
    lickgen.ts     ✅ Phase 3   (LickGen+NoteChooser:抽象→具体音;chooseNote/pickValidNote/makeRelativeNote)
    grammar-rom.ts ✅ Phase 3   (app 侧 glob 85 .grammar → getGrammar(name))
    style.ts       ✅ Phase 4   (.sty 解析:bass/chord/drum pattern + 音域/swing)
    comp.ts        ✅ Phase 4   (渲染 walking bass + chord 击 + drums;pattern 平铺填 bar)
    style-rom.ts   ✅ Phase 4   (app 侧 glob 145 .sty → getStyle(name))
    styles/*.sty   ✅ Phase 4   (Impro-Visor 官方 145 style)
    voicing.ts     ✅ Phase 5   (VoicingGenerator:加权随机 voicing + voice leading + 去小九度)
    expectancy.ts  ✅ Phase 6   (Expectancy.java:Margulis 期待评分 + scoreMelody + pickBest 择优)
    swing.ts       ✅ 打磨       (摇摆节奏 warp:Style.swing/comp-swing)
    transform.ts   ✅ 打磨       (变换装饰:DSL guard/target 求值 + 保时值安全阀)
    transform-rom.ts ✅ 打磨     (glob 6 .transform → getTransform)
    transforms/*.transform ✅    (6 个真实风格,大文件已删省 git)
    (vocab.ts +parseScales/getScalePCs + ChordForm.getFirstScalePCs — Phase 6 SCALE 约束)
    (voicing.ts +双手支持 / comp.ts +奇数拍兜底 — 打磨)
    __harness__/phase1-chord.ts    ✅  (26 项对照)
    __harness__/phase2-grammar.ts  ✅  (确定性 + 全 85 grammar 鲁棒性扫描)
    __harness__/phase3-lickgen.ts  ✅  (确定性 scaleDegree + chord-tone 约束 + 全链路)
    __harness__/phase4-comp.ts     ✅  (解析+渲染 + 全 145 style 鲁棒性)
    __harness__/phase5-voicing.ts  ✅  (rootless/无m9/voice-leading 动量 + 全 145 style)
    __harness__/phase6-scale.ts    ✅  (音阶解析/移调 + S吸附音阶 + Expectancy择优)
    __harness__/phase7-polish.ts   ✅  (swing / 双手 voicing / 奇数拍兜底)
    __harness__/phase8-transform.ts ✅ (transpose-diatonic 确定性 + 真实 transform 应用 + 保时值)
  sandbox/     (新:Q+I 独立 UI + 发声出口)
    ImproCorePanel.tsx  ✅ Phase 0
    audioOut.ts         ✅ Phase 0
    index.ts            ✅ Phase 0
  PORT_PLAN.md (本文件)
```

## 阶段表
| Phase | 内容 | 验收 | 状态 |
|---|---|---|---|
| **0** | Sandbox 接线:Q+I 面板 + 和弦输入 + 写死占位音符走 spessasynth + 钉死 Constants | Q+I 调出,Play 出声 | ✅ **完成** |
| **1** | 地基层:PitchClass/NoteSymbol/Duration/ChordForm/ChordSymbol/Chord + My.voc;面板改播真实和弦音 | "Amaj7"→[69,73,76,80] 等 26 项对照全过;浏览器里听到和弦 | ✅ **完成** |
| **2** | Grammar 引擎(Grammar.java + Terminals.java):读 .grammar → 加权随机推导 → 抽象旋律 token 流 | 确定性 mini 精确 + 全 85 grammar×5 跑无非法token/无抛错/不超时长 | ✅ **完成** |
| **3** | LickGen(LickGen.java + NoteChooser.java):抽象→具体音高;面板接 grammar 选择 + 生成 Solo | 确定性 scaleDegree([60,64,67]) + chord-tone 约束 + 全链路;浏览器里听到 solo | ✅ **完成** |
| **4** | Style 系统(Style.java + stylePatterns):145 .sty → walking bass + chord 击 + drums;面板"▶ 全部"四轨 | 解析+渲染 + 全 145 style 鲁棒;**solo+comping MVP 达成** | ✅ **完成** |
| **5** | Voicing(VoicingGenerator.java):加权随机 voicing + voice leading + 去小九度,替换 comp.ts close voicing | rootless/无m9/voice-leading 动量 + 全 145 style;伴奏更有钢琴味 | ✅ **完成** |
| **6** | 增强面:SCALE 音阶约束(S 吸附和弦音阶)+ Expectancy 择优(生成 4 条选最平滑) | 音阶解析/移调 + S吸附 + 期待评分;65 项全回归绿 | ✅ **完成** |

**Phase 0-6 + 全部打磨完成 = Impro-Visor 忠实移植结束。** 83 项 harness 全绿。
打磨四项均已落地:**swing**(Style 比值 warp)、**双手 voicing**(LH/RH 交替)、**奇数拍兜底**(填不下取最短 pattern + 裁到 bar)、**Transform 装饰**(DSL guard/target 求值 + 保时值安全阀,6 真实风格)。
已知简化(各文件头注):GOAL_PROB=0(IV 本就关)/ triadic 休止 / 无 trading / transpose-chromatic 等罕见 DSL 函数未覆盖(对应 sub 不触发)。
| 6 | 增强面:Expectancy/Tension 择优 + Transform 装饰 | 补齐 Impro-Visor 完整面 | ⬜ |
| 横切 | 面板随阶段长控件:grammar 选择 / tempo / bar / 乐器 / solo\|comping 开关 | — | 进行中 |

## 保真策略
每个模块配对照 harness:同输入,原 Java(或 git 历史旧 TS)当 oracle,逐项 diff。延续仓内 fuzz 传统。

## Java 源参照(`~/vibe_coding/Impro-Visor/src/imp/`)
- Grammar 引擎:`lickgen/Grammar.java` · `lickgen/Terminals.java`
- 抽象→具体:`lickgen/LickGen.java`(3668)· `lickgen/NoteConverter.java`
- 打分:`lickgen/Expectancy.java` · `lickgen/Tension.java`
- 装饰:`lickgen/transformations/Transform.java` · `TrendDetector.java`
- voicing:`voicing/VoicingGenerator.java` · `voicing/HandManager.java` · `guidetone/GuideLineGenerator.java`
- 数据模型:`data/{Note,Chord,ChordForm,ChordPart,MelodyPart,NoteSymbol,PitchClass,Part}.java`
- style:`style/Style.java` · `style/SectionInfo.java` · `style/stylePatterns/`
- 和弦词汇:`vocab/My.voc`
