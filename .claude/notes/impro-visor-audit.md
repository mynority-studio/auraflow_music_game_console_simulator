# Impro-Visor 审计报告 — 钢琴伴奏 + 乐理约束

> 审计日期:2026-05-25
> 目标项目:`/Users/mynority/vibe_coding/Impro-Visor`(v10.2,Java 1.8,Harvey Mudd College)
> 审计范围:钢琴伴奏 + 乐理约束两条主线
> 视角:激进 — 给具体可搬运模块 + AF2 落位 + 翻译草图
> 对照基线:AF2 当前 8 层架构(见 `.claude/rules/architecture.md`)

---

## 0. 一句话总结

Impro-Visor 是一个 **15+ 年学术血统的爵士即兴辅助工具**,核心是 **Lisp 风 PCFG grammar + 26 行 lookup-table 的 NoteChooser + Polylist 数据**。它有 5 个高价值机制 AF2 没有(分手 / AVS / Approach tone / Margulis Expectancy / Slope 约束),3 个 AF2 已经做得更好(VoicingSmoother 比它的随机采样确定性高,chord-texture 24 family 比 Pattern DSL 表达力强,plugin 元数据比它的 static 全局变量干净),还有 2 个跟我们设计哲学冲突不建议搬(NoteChooser 的非确定性随机采样违反 D-5 PRNG 协议,heavy mutation 违反 plugin 协议)。

**Top 5 必搬**(按价值排序):
1. **HandManager 双手分区**(LH/RH split + spread cap)— AF2 完全缺失,直接抄
2. **Margulis Expectancy 模型**(stability×proximity×mobility + direction)— AF2 melody 没有"期待感"建模,加进 MelodyGen 或独立 plugin
3. **Slope 约束**((slope MIN MAX C8 L8 ...) 闭区间 contour gate)— AF2 PhraseContour 是 bias,没硬约束
4. **Approach tone 系统**(±1 semitone 进入 chord tone)— AF2 PassingToneSelector 当前是 50% gate + diatonic,缺少 "强约束 approach into target"
5. **AutomaticVoicingSettings(.fv 参数化体系)**— AF2 voicing 全硬编码,把 23 个 voicing 参数(LH/RH bound/spread/notes/min-interval/prev-voicing-multiplier/half-step-multiplier/...) 抽 config 化能 unlock 用户调音

---

## 1. Impro-Visor 项目全景(15 秒上下文)

### 1.1 数据流总图

```
.sty 文件(Lisp DSL,148 个 style)
   │
   ▼
Style.java(parser + 状态机)
   │
   ├─→ bass-pattern pool(weighted)
   ├─→ chord-pattern pool(weighted)
   ├─→ drum-pattern pool(weighted)
   └─→ AutomaticVoicingSettings(.fv 23 参数)
   │
   ▼
SectionInfo(多段 style 编排)
   │
   ▼
Style.render() — 每 section 抽一个 pattern
   │
   ├─→ ChordPattern.findVoicing()
   │     │
   │     ▼
   │     VoicingGenerator.calculate()  ← 钢琴伴奏 voicing 决策
   │     ├─ HandManager.repositionHands()
   │     ├─ weighted-random 采样 LH / RH MIDI
   │     └─ phase 4 后处理(voiceAll + invertM9th)
   │
   ├─→ BassPattern.render()
   │     └─ rule DSL: X4(root) / C4(chord tone) / S4(scale tone) / =4(hold)
   │
   └─→ DrumPattern.render() — per-drum X/R 序列

主旋律是另一条独立线:
.grammar 文件(Lisp PCFG)
   │
   ▼
Grammar.run() — 从 start symbol P 一次性展开(无回溯)
   │
   ▼
Polylist terminals: C8 L4 (slope -3 2 C8 L8) X16 R8 (BRICK 960)
   │
   ▼
LickGen.chooseNote()  ← 主旋律单音决策
   │
   ├─ slope constraint → 闭区间 [low, high]
   ├─ getNoteTypes() → 每 MIDI pitch 分类 CHORD/COLOR/RANDOM
   └─ NoteChooser.getNote() — 28 行 lookup table 概率采样
```

### 1.2 关键术语

| 术语 | 含义 |
|---|---|
| `.sty` 文件 | 风格定义文件(Lisp S-expression),148 个 |
| `.fv` 文件 | Auto-Voicing Preset(23 参数 voicing 配置),5 个预设(Closed-High/Low/Quartal/Shell/Open) |
| `.grammar` 文件 | 风格化 PCFG grammar(per artist),200+ 个 |
| `.voc` 文件 | Chord vocabulary(per-chord 列出 spell/color/priority/approach/avoid/scales) |
| Polylist | 自家 Lisp cons cell 实现(`first()` / `rest()`)|
| spell | chord tones(C major = [C, E, G]) |
| color | extension/approach tones(C major = [A, B, D, F#]) |
| priority | chord 内 voicing 优先级(root → 3 → 7 → 5 类似排) |
| approach | per-pitch 的 chromatic approach 集合 |
| brick | 命名 chord progression 单位(ii-V-I / Cadence / Sad-Cadence) |
| chord-tone-weight 等 | grammar parameter,影响 note-pick 概率分布 |

---

## 2. 钢琴伴奏子系统(深度审计)

### 2.1 文件清单 + 一句话职责

| 文件 | 行 | 职责 |
|---|---|---|
| `src/imp/style/Style.java` | ~500 | .sty 解析 + pattern pool + 含 VoicingGenerator / HandManager 引用 |
| `src/imp/style/SectionInfo.java` | ~960 | 多 section 编排 + 每 section 指派 style 渲染 |
| `src/imp/style/SectionRecord.java` | thin | (styleName, slotIndex, isPhrase) 三元组 |
| `src/imp/style/stylePatterns/Pattern.java` | 113 | 基类(weight + style + errorMessage) |
| `src/imp/style/stylePatterns/ChordPattern.java` | **1431** | Pattern DSL 解析 + findVoicing 派发 + ChordPatternVoiced 装配 |
| `src/imp/style/stylePatterns/ChordPatternVoiced.java` | 77 | LinkedList<Polylist>(duration, voicing-MIDI-list)thin data 类 |
| `src/imp/style/stylePatterns/BassPattern.java` | ~100+ | Bass rule DSL(X/B/C/S/A/R/U/D + 1-12) |
| `src/imp/style/stylePatterns/DrumPattern.java` | ~100+ | per-drum X/R/V 序列 + weight |
| `src/imp/style/stylePatterns/RepresentativeChordRules.java` | — | 自动从训练数据抽 chord pattern 的 representative 规则 |
| `src/imp/style/stylePatterns/Interpolant.java` | ~100+ | per-section chord interpolation(在两个 chord 之间插过渡 chord) |
| `src/imp/style/stylePatterns/Substitution.java` | ~100+ | chord substitution(V→ii-V / 等)|
| `src/imp/voicing/VoicingGenerator.java` | **677** | **CROWN JEWEL** — weighted random voicing 采样 |
| `src/imp/voicing/HandManager.java` | 210 | LH/RH 分手(bound + spread + min/max-notes + preferred-motion) |
| `src/imp/voicing/AutomaticVoicingSettings.java` | ~100+ | 23 voicing 参数容器 + .fv 加载 |
| `src/imp/voicing/VoicingDistanceCalculator.java` | thin | average leap 距离评估 |
| `src/imp/voicing/AVPFileCreator.java` | thin | .fv 文件写入 |

### 2.2 子系统数据流图(详细)

```
Style.render(sequence, time, chords, start, end)
   │
   │  per section loop
   ▼
   Style.selectChordPattern() — weighted random from chordPatterns pool
   │     totalWeight = Σ weight
   │     pick = random(0, totalWeight)
   │     return first pattern where cumWeight >= pick
   │
   ▼
   ChordPattern.applyRules(chord, duration)
   │
   │  对每个 X(strike) 元素调:
   ▼
   ChordPattern.findVoicing(chord, lastChord, style)
   │
   ├─[voicing-type == "custom"]→ 走 VoicingGenerator
   │     │
   │     ├─ chord1 = Chord(chord.name)
   │     ├─ spelling = chord1.getSpell()       // [C,E,G,Bb]
   │     ├─ priority = chord1.getPriority()    // 排好序的 chord tones
   │     ├─ color    = chord1.getColor()       // [D,F#,A,etc]
   │     ├─ handMan.repositionHands()          // 随机 LH/RH 区间
   │     ├─ vgen.setColor(color)
   │     ├─ vgen.setPriority(priority)
   │     ├─ vgen.setPreviousVoicing(lastVoicing)  // static 全局 ← 反模式
   │     ├─ vgen.calculate()                   // 核心算法
   │     └─ voicing[] = vgen.getChord()
   │
   └─[else]→ 走 ChordForm 静态 vocabulary(Closed/Open/Shell)
         filterByAverageLeap(lastChord, voicings, low, high)
         random_pick(voicings)
```

### 2.3 CROWN JEWEL 1:VoicingGenerator.calculate()

**文件**:`src/imp/voicing/VoicingGenerator.java:78-230`

**算法本质**:不是 optimization,是**权重动态收缩的加权随机采样**。

**伪代码**:

```python
allMidiValues = [0] * 128  # 128-MIDI 权重表

# Phase 1: 初始化权重(priority 高 chord tone 权重大,color 中等)
for c in color:
    setupNote(c, leftColorPriority * 10)    # 所有 octave 都加
    setupNote(c, rightColorPriority * 10, lowerRightBound)
for p_idx, p in enumerate(priority):
    weight = maxPriority * 10 - p_idx * 10 * priorityMultiplier
    setupNote(p, weight)

# Phase 2: 上一个 voicing 的 voice-leading boost
if previousVoicing:
    for n in previousVoicing:
        allMidiValues[n]   *= previousVoicingMultiplier   # 完全相同 → 强 boost
        allMidiValues[n±1] *= halfStepAwayMultiplier      # ±1 半音 → 中 boost
        allMidiValues[n±2] *= fullStepAwayMultiplier      # ±2 半音 → 弱 boost

# Phase 3: 迭代采样 LH + RH(交替)
for i in range(max(numLeft, numRight)):
    if leftHand.size() < numLeft:
        candidates = build_weighted_list(allMidiValues, LH_range)
        pick = weighted_random_pick(candidates)
        leftHand.add(pick)
        # 拔掉已选 + 抑制临近
        allMidiValues[pick] = 0
        allMidiValues[pick±1] *= halfStepReducer    # 反向:压制临近半音
        allMidiValues[pick±2] *= fullStepReducer
        multiplyNotes(pick, repeatMultiplier)        # 压制 octave 重复
        # min-interval 强制
        for j in range(leftMinInterval):
            allMidiValues[pick±j] = 0
    if rightHand.size() < numRight:
        ... # 对称逻辑

# Phase 4: 后处理
if voiceAll:    # 强制每个 chord tone 至少出现一次
    ...
if invertM9th:  # 检测 LH-RH 之间小 9 度(13 semitones),swap 成 M7(12)
    for (lh, rh) in zip(LH, RH):
        if rh - lh == 13:
            lh += 1; rh -= 1
```

**权重公式**:

```
weight(n) =
    + (10 × colorPriority)                            if n ∈ color
    + (maxPriority × 10 − p × 10 × priorityMultiplier) if n = priority[p]
    × previousVoicingMultiplier                       if n ∈ previousVoicing
    × halfStepAwayMultiplier                          if |n − any_prev| == 1
    × fullStepAwayMultiplier                          if |n − any_prev| == 2
    × halfStepReducer                                 if |n − any_picked_this_hand| == 1
    × fullStepReducer                                 if |n − any_picked_this_hand| == 2
    × repeatMultiplier                                if n mod 12 ∈ {picked_this_hand mod 12}
```

**关键洞察**:这是**非确定性**算法,违反 AF2 的 D-5 PRNG 协议。

### 2.4 CROWN JEWEL 2:HandManager 分手

**文件**:`src/imp/voicing/HandManager.java:61-141`

**问题**:钢琴 voicing 应该 LH(低)+ RH(高)分开放,各 2-4 音,各有 spread 上限(防止跨手 stretch 超 1 个 octave)。

**算法**:

```python
def repositionHands(prevLH, prevRH, prefMotion, prefMotionRange):
    numLeftNotes  = random(LH_min_notes, LH_max_notes)   # 通常 2-3
    numRightNotes = random(RH_min_notes, RH_max_notes)   # 通常 3-4

    # voice-leading bias: prefMotion ∈ {-1, 0, +1}
    if prefMotion != 0:
        shift = random(-prefMotionRange, +prefMotionRange) * prefMotion
        leftHandLowest = clamp(prevLowest + shift,
                               LH_lower_limit,
                               LH_upper_limit - LH_spread)

    upperLeftBound  = leftHandLowest + LH_spread     # 通常 spread = 12 半音
    upperRightBound = rightHandLowest + RH_spread

    # 输出给 VoicingGenerator:
    #   numNotesLeft / numNotesRight + [lowerLeftBound, upperLeftBound]
```

**反模式提示**:Java 用 `Random()` 每次新种子,违反 AF2 deterministic PRNG。搬到 AF2 必须改成 PRNG seed。

### 2.5 Pattern DSL 速查表

**ChordPattern**:

| 符号 | 含义 | 例 |
|---|---|---|
| `X` | strike(用当前 chord 的 voicing) | `X4` = 一拍 strike |
| `R` | rest | `R8` = 半拍休止 |
| `V` | volume control | `V100` = 设 MIDI velocity 100 |
| `(X p d)` | strike + 指定 chord 度数 | `(X 3 8)` = 半拍弹 chord 3 度 |
| 后缀 `4` | 一拍(quarter) | `X4` |
| 后缀 `8` | 半拍(eighth) | `X8` |
| 后缀 `8/3` | 三连音 | `X8/3` |
| `+` | tie(连音) | `X4+8` = 1.5 拍 strike |

**BassPattern**:

| 符号 | 含义 |
|---|---|
| `X` | root |
| `1-12` | 半音 interval above root |
| `B` | bass 音(最低 chord tone) |
| `C` | 任意 chord tone |
| `S` | 任意 scale tone |
| `A` | 任意 chromatic |
| `R` | rest |
| `=` | hold previous |
| `U` / `D` | up / down modifier |

**DrumPattern**:`(drum DrumName X1)`,X = hit,R = rest,V = velocity。

**SectionInfo 多段编排**:`ArrayList<SectionRecord>` 存 `(styleName, slotIndex, isPhrase)`,render 时按 slot 顺序拼接,每段用不同 style。

### 2.6 与 AF2 现状对照

| Impro-Visor 机制 | AF2 现状 | 评分 |
|---|---|---|
| **VoicingGenerator weighted random** | AF2 `VoicingSmoother`(R+S2 post-pass,inversion candidates + phrase-arc cost,deterministic argmin) | **AF2 ⬆** — 确定性 + 评分 cost 函数更可控 |
| **HandManager LH/RH split** | **AF2 没有** — PianoIdiom 当 voicing 是单一区间 | **AF2 ⬇⬇⬇ 必搬** |
| **AutomaticVoicingSettings(23 参数)** | AF2 voicing 全硬编码 | **AF2 ⬇⬇ 应搬**(config 化) |
| **Pattern DSL(X4 R8 weighted)** | AF2 `chord-texture/families/` 24 family + AccompGen `STYLE_TEXTURE_POOL` | **AF2 ⬆⬆** — 24 family 表达力远超 X/R DSL |
| **SectionInfo per-section style** | AF2 SectionType + per-style table | **AF2 ⬆** — 同概念但 type-safe |
| **Interpolant 过渡 chord 插入** | AF2 Arranger 4 Planner(Borrow/Picardy/MinorBorrow/Tonicization) | **AF2 ⬆⬆** — 同方向但远更系统 |
| **Substitution chord 替换** | 同上 | **AF2 ⬆⬆** |
| **invert-9th post-process** | **AF2 没有** — voicing 内部不检测小 9 度撞音 | **AF2 ⬇ 可加**(VoicingSmoother 加一项 detector) |
| **voice-all forced inclusion** | AF2 `assembleVoicing` per-mgStyle FULL/ROOTLESS/CLUSTER/BLUES/SHELL | **AF2 ⬆** |

### 2.7 翻译草图:HandManager → AF2

**目标位置**:`src/core/generation/af2-engine/plugins/composer/HandPartitioner.ts`(新 plugin)

**协议**:在 `assembleVoicing` 之后、`placeVoicingMidi` 之前,把 voicing pcs[] 分成 LH(2-3 pc)+ RH(3-4 pc)+ 写入 ChordDef 的 `lhPcs` / `rhPcs` 字段(IR 加可选字段)。

**伪 TS**:

```typescript
// plugins/composer/HandPartitioner.ts
export interface HandPartitionConfig {
  lhMinNotes: number;        // 默认 2
  lhMaxNotes: number;        // 默认 3
  rhMinNotes: number;        // 默认 3
  rhMaxNotes: number;        // 默认 4
  lhRangeLo: number;         // MIDI,默认 36
  lhRangeHi: number;         // 默认 55
  rhRangeLo: number;         // 默认 56
  rhRangeHi: number;         // 默认 84
  lhSpread: number;          // semitones 上限,默认 12
  rhSpread: number;          // 默认 12
  prefMotion: -1 | 0 | 1;   // -1 下行 / 0 不动 / +1 上行 bias
  prefMotionRange: number;   // 默认 2
}

export const HandPartitioner: ComposerPluginMeta = {
  name: 'HandPartitioner',
  version: 'v0.1',
  prngConsumption: 'zero',   // 用 hash gate,不动主 stream
  description: 'partition voicing pcs into LH/RH with spread cap',
};

export function partitionHands(
  pcs: number[],              // assembleVoicing 输出的 pc 池
  prevLhMidi: number[],       // 上一 chord 的 LH MIDI(voice leading)
  prevRhMidi: number[],
  chordCtx: ChordCtx,
  seedHash: number,           // section.startBeat | chord.idx,deterministic
  config: HandPartitionConfig,
): { lhMidi: number[], rhMidi: number[] } {
  // 1. determine numLH / numRH from hash gate(不消耗主 PRNG)
  const numLH = config.lhMinNotes +
                ((seedHash >> 4) & 0xff) % (config.lhMaxNotes - config.lhMinNotes + 1);
  const numRH = config.rhMinNotes +
                ((seedHash >> 12) & 0xff) % (config.rhMaxNotes - config.rhMinNotes + 1);

  // 2. compute LH anchor from prev + prefMotion bias
  const lhAnchor = clamp(
    avgMidi(prevLhMidi) + config.prefMotion * (1 + ((seedHash >> 20) & 3)),
    config.lhRangeLo,
    config.lhRangeHi - config.lhSpread,
  );

  // 3. assign pcs:lower pcs → LH(以 lhAnchor 为基础找最近 octave 落点)
  //    higher pcs → RH(以 rhAnchor 为基础)
  //    用 placeVoicingMidi 同款 nearest-MIDI 策略(单点搬运,易)
  ...

  return { lhMidi, rhMidi };
}
```

**难度**:中等。需要 IR 加 `lhPcs/rhPcs` 字段(D-5 数据契约可选字段)+ MidiConverter 分通道(或单通道但 velocity 略分 — 看是否要 LH/RH 独立 velocity 曲线)+ PianoIdiom 消费分手结果。

---

## 3. 乐理约束子系统(深度审计)

### 3.1 文件清单 + 一句话职责

| 文件 | 行 | 职责 |
|---|---|---|
| `src/imp/lickgen/LickGen.java` | **3668** | 主旋律 orchestrator + chooseNote + slope 处理 + grammar 集成 |
| `src/imp/lickgen/Grammar.java` | 1272 | Lisp PCFG 引擎(weighted rule expansion,no backtracking) |
| `src/imp/lickgen/NoteChooser.java` | 207 | **CROWN JEWEL** — 28 行 lookup table 概率采样 |
| `src/imp/lickgen/Terminals.java` | 275 | 解析 Polylist terminal(`C8`/`L4`/`(slope ...)`/`(X 5 8)`/`(BRICK 960)`) |
| `src/imp/lickgen/Tension.java` | 442 | Longuet-Higgins 1984 syncopation 计算(基本未集成) |
| `src/imp/lickgen/Expectancy.java` | 402 | **CROWN JEWEL** — Margulis 旋律期待感模型(stability×proximity×mobility + direction) |
| `src/imp/lickgen/Generator.java` | 453 | 薄 adapter(LickGen + Grammar 初始化) |
| `src/imp/data/ChordForm.java` | 1117 | per-chord-type 表(spell/color/priority/approach/avoid/scales) |
| `src/imp/data/Chord.java` | ~500 | per-chord-instance(ChordForm 引用 + 节奏值) |
| `src/imp/data/advice/Advisor.java` | ~1000 | per-chord vocab lookup DB(UI hinting 用,不参与生成) |
| `src/imp/roadmap/brickdictionary/Brick.java` | 412 | 命名 chord progression 单位(Cadence / ii-V-I / Sad-Cadence) |
| `src/imp/roadmap/cykparser/CYKParser.java` | ~400 | bottom-up PCFG 解析 chord progression 成 brick(只影响 UI 不影响生成) |

### 3.2 子系统数据流图

```
.grammar 文件(Lisp PCFG,per artist 如 BillEvans/Bach/Bergonzi)
   │
   ▼
Grammar.run(startSlot, numSlots)
   │
   │  stack-based 一次性 weighted 展开(无回溯)
   ▼
   terminals: Polylist
            = ( C8 L4 (slope -3 2 C8 L8) X16 R8 (BRICK 960) ... )
   │
   ▼
LickGen.chooseNote(pos, low, high, chord, type, ...)
   │
   ├─ if (slope MIN MAX terms) → 处理:
   │     第一音 newPitch = oldPitch + random(MIN, MAX)
   │     之后每音 next = prev + random(MIN, MAX)
   │     special:approach tone(A) 强制 ±1 进入 target
   │
   ├─ getNoteTypes(low, high, chord):
   │     for pitch in [low, high]:
   │         if pc(pitch) in chord.spell: noteTypes[pitch] = CHORD
   │         elif pc(pitch) in chord.color: noteTypes[pitch] = COLOR
   │         else: noteTypes[pitch] = RANDOM
   │
   └─ NoteChooser.getNote(...)
         │
         ▼
         identifier = (requestedType, haveChord, haveColor, haveRandom)
         probabilities = TABLE[identifier]   ← 28 行 hardcoded table
         //  e.g. (0, 1, 0, 1) → [100, 0, 0, 0]  // 要 chord 且有,100% chord
         //  e.g. (1, 0, 1, 1) → [0, 90, 10, 0]  // 要 color 但只有 random,90% color 0% scale 10% random
         selectedType = weighted_random_pick(probabilities)
         availablePitches = filter(noteTypes, == selectedType)
         return uniform_random(availablePitches)
```

### 3.3 CROWN JEWEL 1:NoteChooser 28 行 lookup table

**文件**:`src/imp/lickgen/NoteChooser.java:61-93`

**机制**:把"要求 type + 候选可用性"映射成"四个 type 的概率分布"。28 行(4 type × 7 availability mask)硬编码:

```
// 格式:(type, haveChord, haveColor, haveRandom, P_chord, P_color, P_random, P_scale)
(0, 1, 1, 1, 100,   0,   0,   0)  // 要 chord,3 类都有 → 必出 chord
(0, 1, 0, 1, 100,   0,   0,   0)  // 要 chord,只有 chord + random → 必出 chord
(0, 0, 1, 1,   0,  90,  10,   0)  // 要 chord,只有 color + random → 90% color, 10% random
(0, 0, 0, 1,   0,   0, 100,   0)  // 要 chord,只有 random → 必出 random
(1, 1, 1, 1,   0, 100,   0,   0)  // 要 color,3 类都有 → 必出 color
(1, 0, 1, 1,   0,  90,  10,   0)  // 要 color,有 color + random → 90% color
(1, 0, 0, 1,   0,   0, 100,   0)  // 要 color,只有 random → 100% random
(2, 1, 1, 1,  20,  30,  50,   0)  // 要 random,3 类都有 → 20/30/50 混合
...
```

**关键洞察**:不是"严格满足约束",而是"约束失败时降级"。这给 AF2 一个思路:**当目标 type 候选为零时怎么 fallback**。

### 3.4 CROWN JEWEL 2:Slope 约束

**文件**:`src/imp/lickgen/LickGen.java:1982-2174`

**语法**:`(slope MIN MAX terminal1 terminal2 ...)`

**语义**:对 slope 块内每个 terminal,音高必须落在 `[prevPitch + MIN, prevPitch + MAX]`(闭区间)。

```python
# 例:(slope 3 5 C8 L8 C8)
oldPitch = 70  # Bb
# C8 → low=73, high=75, type=CHORD
#       chooseNote in [73,75] 找 CHORD → 假设落 76(扩展)
oldPitch = 76
# L8 → low=79, high=81, type=COLOR
#       chooseNote in [79,81] 找 COLOR
oldPitch = 80
# C8 → low=83, high=85, type=CHORD
...
```

**语义升级版**:Approach tone(A)在 slope 内特殊处理 — 自动从 ±1 半音进入下个 target:

```python
# (slope -1 2 A8 C8)
approachPitch = chooseNote([oldPitch-1, oldPitch+2], APPROACH, ...)
targetPitch   = chooseNote([oldPitch-1, oldPitch+2], CHORD, ...)
# 强制 approachPitch 与 targetPitch 差 ±1
if approachPitch + 1 == targetPitch: pass
elif approachPitch - 1 == targetPitch: pass
else:
    # 按 slope 方向决定:MIN > 0 → 下方进入,MAX < 0 → 上方进入
    if MIN > 0: approachPitch = targetPitch - 1
    elif MAX < 0: approachPitch = targetPitch + 1
```

### 3.5 CROWN JEWEL 3:Margulis Expectancy 模型

**文件**:`src/imp/lickgen/Expectancy.java:95-289`

**公式**(Margulis 2005,《A Model of Melodic Expectation》):

```
E(pitch | prev, prevPrev, chord) =
    stability(pitch, chord)
  × proximity(pitch, prev)
  × mobility(pitch, prev)
  + direction(pitch, prev, prevPrev)
```

**各项**:

```python
def stability(pitch, chord):
    if chord.isRoot(pitch):    return 6
    if chord.isChordTone(pitch): return 5
    if chord.isColorTone(pitch): return 4
    return 1

def proximity(pitch, prev):
    d = abs(pitch - prev)
    # 表:d=0→24, 1→36, 2→32, 3→25, 4→20, 5→14, 6→10, 7→6, 8→4, 9→2, 10→1, 11→0.5, 12→0.25, 13+→0.01
    return PROXIMITY_TABLE[min(d, 14)]

def mobility(pitch, prev):
    return 0.67 if pitch == prev else 1.0

def direction(pitch, prev, prevPrev):
    interval = abs(prev - prevPrev)
    dir_sign = sign(prev - prevPrev)
    if interval <= 4:
        # 小跳后倾向继续同方向
        if (pitch > prev) == (dir_sign > 0):
            return DIRECTION_TABLE_SMALL[interval]  # [6, 20, 12, 6]
        return 0
    else:
        # 大跳后倾向反向
        if (pitch > prev) != (dir_sign > 0):
            return DIRECTION_TABLE_LARGE[interval - 5]  # [6, 12, 25, 36, 52, 75]
        return 0
```

**集成现状**:Impro-Visor 默认参数 `expectancy-multiplier = 0`,所以这个模型**实际不工作**。但代码完整 + 理论稳固,是 **AF2 melody 引入"期待感"建模的最佳起点**。

### 3.6 CROWN JEWEL 4:Tension(Longuet-Higgins 1984 syncopation)

**文件**:`src/imp/lickgen/Tension.java:340-401`

**公式**:

```python
def syncopation(onsets[], measures):
    # onsets[i] = 1 if note starts at slot i
    # weights[] = 每个 slot 的 metric strength(下拍权重高)
    # 标准 4/4:[0, -5, -4, -5, -3, -5, -4, -5, -2, -5, -4, -5, -3, -5, -4, -5, ...]
    weights = generate_metric_weights(measures)

    synco = 0
    for i, onset in enumerate(onsets):
        if onset == 0:
            # 找最近 prev onset 位置
            nPos = i - 1
            while onsets[nPos] == 0: nPos -= 1
            # 如果空 slot 比 prev onset 权重还高(更强 metric 位)→ syncopation
            syncoValue = weights[i] - weights[nPos]
            if syncoValue > 0:
                synco += syncoValue
    return synco
```

**用途**:衡量节奏切分程度(数字越大越切分)。Impro-Visor 默认 syncopation-constant = 0.7,**理论激活但实际效用低**(因为 expectancy-multiplier = 0)。

### 3.7 Grammar PCFG 展开机制

**文件**:`src/imp/lickgen/Grammar.java:154-300`

**算法**(无回溯一次性):

```python
def run(startSlots):
    stack = [(P, startSlots)]
    terminals = []

    while stack and remainingSlots > 0:
        top = stack.pop()
        if is_terminal(top):
            terminals.append(top)
            remainingSlots -= duration(top)
        else:
            # 找所有 head == top 的 rule
            matchingRules = find_rules(top)
            rule = weighted_pick(matchingRules)  # 按 rule.weight 加权
            stack.extend(reversed(rule.expansion))

    return terminals
```

**例**:`(rule (P Y) ((BRICK 1920) (P (- Y 1920))) 10.0)` 表示:
- P 展开成 `BRICK 1920` + `P` 余下 slots,权重 10
- 与权重 1 的 `(BRICK 960)` 规则竞争,10 倍偏好

### 3.8 Note Category 系统

**核心表**:per chord type(CM/Cm7/C7/Cmaj7/Caug 等)在 `.voc` 文件 + ChordForm.java 维护:

```lisp
; CM 在 vocab/My.voc:
(chord-type
    (name CM)
    (spell c e g)
    (color a b d f#)         ; extension / approach
    (priority c e b g d a f#) ; voicing 优先级
    (approach (c b c# d) (e eb f) (g f# g# a) (b a# c) )
    (scales (c major) (c lydian))
    (avoid )
)
```

**Pitch → category 分类**(LickGen.java:checkNote + classifyNote):

| Category | 简码 | 数值 | 含义 |
|---|---|---|---|
| CHORD | C | 1001 | pc ∈ chord.spell |
| COLOR | L | 1003 | pc ∈ chord.color |
| SCALE | S | 1002 | pc ∈ first scale |
| APPROACH | A | 1004 | ±1 半音进入 chord tone |
| RANDOM | X | 1005 | 非以上 |
| BASS | — | 1006 | chord root |
| GOAL | — | 1007 | 3rd/7th 加权(weighted toward chord 内重要音) |
| OUTSIDE | Y | 1008 | grammar 内部,不实参与 pick |
| EXPECTANCY | — | 1009 | grammar 内部,未实装 |

### 3.9 与 AF2 现状对照

| Impro-Visor 机制 | AF2 现状 | 评分 |
|---|---|---|
| **Lisp PCFG grammar** | AF2 melody 是 chord-tone cycle + 6 plugin(no grammar) | **保留 AF2** — grammar 学术性强但调音不直观;AF2 plugin 系统更可解释 |
| **NoteChooser 28 行 lookup table** | AF2 用 deterministic `[root, 5, 3, 7]` cycle + PassingToneSelector(50% gate) | **AF2 ⬆** — 确定性 + 灵活;但 NoteChooser 的"约束失败 fallback"思路可借鉴 |
| **Slope 约束(闭区间 contour gate)** | AF2 PhraseContourShaper 是 bias(softer),没硬约束 | **AF2 ⬇⬇ 应加** — slope = 硬约束,bias = 软,两者互补 |
| **Approach tone 系统** | AF2 PassingToneSelector(chromatic passing 50% gate) | **AF2 ⬇ 应增强** — approach 更具体(±1 强制进入 target) |
| **Margulis Expectancy** | **AF2 完全没有"期待感"建模** | **AF2 ⬇⬇⬇ 强烈建议加** — 这是经过认知科学验证的模型 |
| **Longuet-Higgins Tension** | **AF2 完全没有 syncopation 量化** | **AF2 ⬇⬇ 可加** — 用作 score 给 plugin 调参 |
| **ChordForm 5 字段 vocab(spell/color/priority/approach/avoid/scales)** | AF2 `chord-types.ts` 有 intervals;`music-theory/voicing.ts` 有 spell;**没有 color/approach/avoid/scales 数据** | **AF2 ⬇ 应扩展 ChordForm** — 把这个 5 字段表搬过来,所有 melody/voicing plugin 都能用 |
| **Goal-note(3rd/7th 优先)** | AF2 chord-tone cycle 是 `[root, 5, 3, 7]`(顺序固定) | **AF2 ⬆** — cycle 更确定;但 Goal 的"按重要度 weighted random"思路可作为 plugin variant |
| **CYK Brick parser** | AF2 没有(不影响生成) | **跳过** — 只是 roadmap 显示 |
| **Advisor 静态 DB** | AF2 plugin 元数据 | **保留 AF2** — plugin 元数据干净 |

---

## 4. AF2 移植落位 — 完整 punch list

按价值 × 难度排序。每项:目标位置 + 价值 + 难度 + 跨同步影响。

### 4.1 Tier S(必搬,改动小价值大)

#### S1. ChordForm 5 字段 vocab(spell/color/priority/approach/avoid/scales)

- **目标位置**:`src/core/generation/af2-engine/music-theory/chord-types.ts` 扩展 + 新建 `chord-vocab.ts`
- **价值**:所有 melody / voicing / accomp plugin 都能直接 query "这个 pc 对这个 chord 是 chord/color/approach/avoid"。彻底告别"chord tone hardcoded for major 7"
- **难度**:中等 — 数据量大(~30 chord types),但翻译机械
- **影响**:可选字段加 IR + 所有 melody plugin 改为查表(而不是 hardcode 3/5/7 度)
- **跨同步**:Composer assembleVoicing / MelodyGen chord-tone cycle / PassingToneSelector / AccompGen ChordTextureEngine
- **数据来源**:`/Users/mynority/vibe_coding/Impro-Visor/vocab/My.voc`(直接 parse 转 JSON)
- **TS 草图**:

```typescript
// music-theory/chord-vocab.ts
export interface ChordVocab {
  spell: number[];      // pc 0-11 of chord tones
  color: number[];      // pc of extension/color tones
  priority: number[];   // pc ordered by voicing importance (e.g., [root, 3, 7, 5, ...])
  approach: number[][]; // per chord tone:approach pc list
  avoid: number[];      // pc to never use
  scales: string[];     // ['C major', 'C lydian', ...]
}

export const CHORD_VOCAB: Record<ChordTypeKey, ChordVocab> = {
  CM: {
    spell: [0, 4, 7],
    color: [9, 11, 2, 6],     // A, B, D, F#
    priority: [0, 4, 11, 7, 2, 9, 6],
    approach: [[0, 11, 1, 2], [4, 3, 5], [7, 6, 8, 9], [11, 10, 0]],
    avoid: [],
    scales: ['major', 'lydian'],
  },
  // ... 30 entry
};
```

#### S2. HandManager 双手分区

- **目标位置**:`plugins/composer/HandPartitioner.ts`(新 plugin)
- **价值**:钢琴 voicing 终于真的像钢琴弹的(2-3 LH + 3-4 RH + spread cap)
- **难度**:中等 — IR 加 `lhPcs/rhPcs` 字段 + MidiConverter 可能要分通道
- **影响**:Composer 主循环 + assembleVoicing + placeVoicingMidi + PianoIdiom + IR
- **跨同步**:§12 关联组 #2(MusicianPlanInput) + #5(per-mgStyle 默认 hand config)
- **算法见 §2.4**

#### S3. AutomaticVoicingSettings(23 voicing 参数化)

- **目标位置**:`plugins/composer/types.ts` 加 `VoicingConfig`;每 mgStyle 默认值放 `Af2Composer.ts`
- **价值**:把硬编码的 voicing 行为(spread / prev-voicing influence / min interval / half-step boost / etc)全 config 化
- **难度**:简单 — 数据结构 + per-mgStyle table
- **影响**:VoicingSmoother 内部消费这些 config

### 4.2 Tier A(强烈建议,新算法价值大)

#### A1. Margulis Expectancy 模型

- **目标位置**:`plugins/melody/MargulisExpectancyShaper.ts`(新 plugin)
- **价值**:给 melody 加"认知期待感" — 大跳后倾向反向 + 小跳后倾向继续 + chord tone 比 color 比 random 稳定度递减
- **难度**:中等 — 4 个常量 table + 4 个函数,~150 行 TS
- **影响**:在 MelodyGen 主循环内插入(可作为 PassingToneSelector / RhythmPatternPicker 之后)
- **算法见 §3.5**
- **TS 草图**:

```typescript
// plugins/melody/MargulisExpectancyShaper.ts
const PROXIMITY_TABLE = [24, 36, 32, 25, 20, 14, 10, 6, 4, 2, 1, 0.5, 0.25, 0.01];
const DIRECTION_SMALL = [6, 20, 12, 6];
const DIRECTION_LARGE = [6, 12, 25, 36, 52, 75];

export function expectancyScore(
  pitch: number,
  prevPitch: number,
  prevPrevPitch: number,
  chord: ChordCtx,
  vocab: ChordVocab,
): number {
  const stab = stability(pitch, chord, vocab);
  const prox = PROXIMITY_TABLE[Math.min(Math.abs(pitch - prevPitch), 13)];
  const mob  = pitch === prevPitch ? 0.67 : 1.0;
  const dir  = direction(pitch, prevPitch, prevPrevPitch);
  return stab * prox * mob + dir;
}

// 用法:在 MelodyGen.placeNearAnchor 内,从候选 pitch 池里 argmax(expectancyScore)
//      或加权采样(zero PRNG 用 hash gate 决定 reduction factor)
```

#### A2. Slope 约束 plugin

- **目标位置**:`plugins/melody/SlopeContourGate.ts`(新 plugin,在 PhraseContourShaper 之后)
- **价值**:把 PhraseContour 从 bias 升级成硬约束 — per-section 指定 contour 段落严格按 [MIN, MAX] 走
- **难度**:简单 — 每个 melody slot 已知 prevPitch,clamp 到 `[prev+min, prev+max]` 范围
- **影响**:加 plugin,SectionType → slope-spec 表(per Verse/Chorus/Bridge 不同 contour)

#### A3. Approach Tone 强化

- **目标位置**:`plugins/melody/ApproachToneTargeter.ts`(替换或增强 PassingToneSelector)
- **价值**:在 chord 变换点的前一拍 / 半拍,强制选 ±1 半音进入下一 chord 的 root/3/5
- **难度**:中等 — 需要看 next chord 的 chord tones,反向工程出 approach pitch
- **影响**:per-mgStyle gate(JAZZ 高 / POP 低)
- **算法见 §3.4 special case**

### 4.3 Tier B(可加,但价值有限)

#### B1. invert-9th 撞音 detector

- **目标位置**:`plugins/composer/VoicingSmoother.ts` 内加一项后处理
- **价值**:检测 LH-RH 之间小 9 度(13 semitones)→ 自动 swap 成 M7(12)
- **难度**:trivial — 几行 if
- **影响**:VoicingSmoother 局部改

#### B2. Longuet-Higgins Tension 量化

- **目标位置**:`plugins/reconciler/SyncopationAnalyzer.ts`(可选 4 th plugin)
- **价值**:量化每个 musician 的 syncopation 程度,反馈给 persona 调参(persona.syncopationAssault 校准用)
- **难度**:中等 — 标准公式,但需 metric weight table

#### B3. Pattern Weight 选择(if needed)

- **目标位置**:已经有 — Af2AccompGen.pickTextureType 已是 weighted phrase-lock
- **价值**:0(已实现)
- **行动**:无

### 4.4 Tier C(跳过,不适合 AF2)

| 项 | 跳过原因 |
|---|---|
| **VoicingGenerator weighted random** | 违反 AF2 D-5 PRNG 协议(非确定性),AF2 VoicingSmoother 的 cost-argmin 更适合 |
| **NoteChooser 28 行 table** | AF2 chord-tone cycle 更确定 + plugin chain 更可解释 |
| **Grammar PCFG** | AF2 plugin 化 已经过这个阶段(memo:`pcfg_grammar_removed.md`) |
| **Polylist Lisp data** | 用 TS 原生 array + ChordVocab JSON 即可 |
| **CYK Brick parser** | 只影响 UI roadmap 显示,不影响 melody/accomp 生成 |
| **Advisor static DB** | AF2 plugin 元数据更干净 |
| **Pattern DSL(X4 R8 weighted)** | 已被 chord-texture 24 family 超越 |

---

## 5. 工作流建议(if 真要落地)

### Phase 1:数据基础(1-2 天)

1. 写脚本把 `/vocab/My.voc` parse 转成 `chord-vocab.ts` JSON
2. AF2 `chord-types.ts` 扩展 ChordVocab 接口 + 验证 30 chord types 都覆盖
3. lint + 跑 4 mgStyle 1 seed 确认没破

### Phase 2:HandManager(2-3 天)

1. IR 加可选 `lhPcs/rhPcs` 字段(D-5 可选)
2. 写 `HandPartitioner` plugin(zero PRNG,用 chord.idx hash gate)
3. PianoIdiom 消费 + MidiConverter(单通道,LH velocity 略低)
4. 听感对账 4 mgStyle × 2 seed

### Phase 3:Margulis Expectancy(3-5 天)

1. 写 `MargulisExpectancyShaper` plugin(zero PRNG)
2. 加 4 const table + 4 helper
3. 接入 MelodyGen `placeNearAnchor` 候选打分
4. 听感 — 这是最容易出现"明显变好"或"明显变怪"的改动,需要小心调 weight

### Phase 4:Slope + Approach(2-3 天)

1. `SlopeContourGate` + per-SectionType slope-spec 表
2. `ApproachToneTargeter` 替换 PassingToneSelector(或并存,per-mgStyle 选)
3. 听感重点 verify chord 变换点的进入感

### Phase 5:扫尾(1 天)

1. AVS 23 参数 config 化
2. invert-9th detector 加到 VoicingSmoother
3. 更新 `.claude/rules/architecture.md` 增加 §17 "Impro-Visor 启发清单 + 落位"

**总工期**:10-15 天 vs Impro-Visor 原 25 天 — 因为 AF2 已有架构骨架。

---

## 6. 学术血统 + 推荐阅读

| 论文 / 书 | Impro-Visor 用到的部分 | AF2 价值 |
|---|---|---|
| Margulis, E. H. (2005). *A Model of Melodic Expectation*. Music Perception | Expectancy.java 整个模型 | ⬆⬆ 直接搬 |
| Longuet-Higgins, H. C., & Lee, C. S. (1984). *The Rhythmic Interpretation of Monophonic Music*. Music Perception | Tension.java syncopation | ⬆ 可搬 |
| Thomassen, M. T. (1982). *Melodic Accent: Experiments and a Tentative Model*. JASA | Tension.java melodic accent | ⬆ |
| Narmour, E. (1990). *The Analysis and Cognition of Basic Melodic Structures* | Expectancy 间接(direction 部分) | — |
| Cocke / Younger / Kasami(教科书 CYK 算法) | CYKParser.java | 不用 |
| Robert M. Keller — Harvey Mudd CS,主导 Impro-Visor 15+ 年 | — | 整套设计哲学 |

---

## 7. 一句话再总结

> Impro-Visor 给 AF2 的 5 个礼物:**ChordVocab 5 字段表 / 双手分区 / Margulis 期待感 / Slope 硬约束 / Approach 强进入**。其他大多被 AF2 plugin 架构 + chord-texture 24 family + VoicingSmoother cost-argmin 超越了。学术血统值得读,代码工程性别学(heavy mutation + static globals + Lisp polylist)。
