# Claude 和声循环移植提示词

下面这段可以直接粘给 Claude。目标是从 `../melodygenerative` 移植和声进行模板、和声生成、借用和弦、离调/tonicization、和弦实化/填写逻辑到当前 `newEngine`。请严格保持边界：模板与查询数据进 KB，算法与 HarmonicPlan 生成进 HARMONY 层，不污染主管道。

## 给 Claude 的提示词

你现在要做一个 loop 式移植任务：从 `../melodygenerative` 参考并移植和声系统到当前项目 `src/core/generation/newEngine`。

### 总目标

把 `melodygenerative` 中的和声进行模板、风格化和声词典、借用和弦、离调/tonicization、动态 TSD 和弦类型选择、和弦实化逻辑，迁入当前 `newEngine`。

必须遵守架构边界：

1. **KB 层只放模板、规则表、候选池、权重、policy、查询函数。**
2. **HARMONY 层只做选择、展开、借用、离调、和弦实化、冻结 HarmonicPlan。**
3. **主生成管道不能散落模板数组、style if-else 大表、旧工程 ChordSkeletonSlot 直接逻辑。**
4. **render 层不决定和声，只消费 HarmonicPlan 和 KB voicing/texture 查询结果。**
5. **不要迁移 Impro-Visor 的 grammar/lick/brick/template 体系。**

### 关键边界

#### 应进入 KB 的内容

目标目录：

```text
src/core/generation/newEngine/knowledge/
```

可新增或扩展：

```text
progressions.ts
harmonicStyleProfiles.ts
dynamicTsdDictionary.ts
borrowPolicies.ts
tonicizationPolicies.ts
chordRenderingPolicies.ts
```

KB 负责保存：

- progression prototypes
- progression slot schema
- style/mode/section/function metadata
- style transform policy
- weighted selection data
- dynamic TSD dictionary
- borrow rule metadata
- borrow probabilities and max caps
- tonicization probabilities, caps, placement weights
- V/X、ii/X chord type tables
- style-specific harmonic rhythm preferences
- POP / LOFI / RNB / JAZZ 的和声语言限制

KB 可以提供查询函数：

```ts
listProgressionPrototypes(filter)
pickProgressionPrototype(args)
fitProgressionToBars(args)
getDynamicTsdRules(style, func)
getBorrowPolicy(style)
getTonicizationPolicy(style)
getChordRenderingPolicy(style)
```

KB 不得：

- 写 HarmonicPlan
- 修改 ArrangementPlan
- 直接生成 MIDI/NoteIR
- 在主 pipeline 中隐藏随机推进

#### 应进入 HARMONY 层的内容

目标目录：

```text
src/core/generation/newEngine/harmony/
```

可新增：

```text
progressionSelector.ts
progressionRealizer.ts
dynamicHarmonyDecorator.ts
borrowedChordPlanner.ts
tonicizationPlanner.ts
chordRealizer.ts
harmonyChoiceOptimizer.ts
```

HARMONY 负责：

- 从 KB 选择 progression prototype
- 根据 ArrangementPlan 展开 section / phrase / bars
- 对同 repeatGroup 保持同一 prototype 或同一 progression identity
- 应用 dynamic TSD chord-type decoration
- 应用 borrowed chord planner
- 应用 tonicization planner
- 计算 localTonalCenterPc / forcedScale / borrowedSource / mustResolve
- 计算 roman / rootPc / quality / durationBeats / function
- 组装并 deepFreeze `HarmonicPlan`
- 候选多次生成后用 coherence 评分择优

HARMONY 不得：

- 内联大 progression 模板
- 内联 style dictionary 大表
- 生成最终伴奏 NoteIR
- 把 Impro-Visor brick/grammar/lick 带进来

#### render 层边界

render 层可以：

- 根据 HarmonicPlan 渲染 bass/comp/pad/drum/melody
- 调用 KB voicing placement / texture profile
- 根据 chord span 的 metadata 做安全让位

render 层不得：

- 改 chord progression
- 插入 secondary dominant
- 改 borrowed chord
- 改 section key
- 从 progression prototype 里重新取和弦

## 源文件参考

重点参考这些文件：

```text
../melodygenerative/src/lib/styleDictionary.ts
../melodygenerative/src/lib/dynamicHarmony.ts
../melodygenerative/src/lib/borrowedChordPlanner.ts
../melodygenerative/src/lib/tonicizationPlanner.ts
../melodygenerative/src/lib/musicEngine.ts
../melodygenerative/src/lib/musicTheory.ts
../melodygenerative/src/lib/harmonicCoherence.ts
../melodygenerative/src/lib/voiceLeadingLedger.ts
```

不要参考或不要移植：

```text
../melodygenerative/src/lib/improvisor/**
../melodygenerative/src/lib/improvisorSlopes.ts
../melodygenerative/src/lib/improvisorVocab.ts
BrickDictionary / GrammarRuntime / LickGen / NoteChooser / RoadMap
```

## 迁移对象拆分

### 1. 和声进行模板

源：

```text
styleDictionary.ts
SECTION 2 — PROGRESSION POOL
_MODERN_PROGRESSION_PROTOTYPES
LOFI prototypes
pickProgression
fitTo16Bars
```

移入：

```text
knowledge/progressions.ts
```

必须保留字段：

- id
- style
- mode
- sectionRoles
- lengthBars
- slots
- weight
- subStyles
- energy
- density
- cadence
- emotionTags
- transformPolicy

slot 字段至少包括：

- roman
- chordType
- rootOffset
- scaleDegree
- beats
- bassRole
- lockType
- borrowedSource
- borrowedFrom
- mustResolve
- forcedScale
- localTonalCenterPc
- tonicizationPlacement
- analysisKeyPc
- localRoman

注意：

- `ChordSkeletonSlot` 不要照搬命名到主 HARMONY，可以在 KB 内改名为 `ProgressionSlot`.
- `rootOffset` 是相对 key 的半音，不是 pitch class 本身。
- LOFI prototypes 应保留 `transformPolicy.allowTonicization=false`、`allowBorrowed=false` 的精神。
- 不要把 `_legacyProgressionsAsPool()` 自动展开进第一轮，先迁 modern + LOFI explicit prototypes。

### 2. 动态 TSD 和声字典

源：

```text
dynamicHarmony.ts
DYNAMIC_TSD_DICTIONARY
analyzeTargetQuality
```

数据移入：

```text
knowledge/dynamicTsdDictionary.ts
```

算法移入：

```text
harmony/dynamicHarmonyDecorator.ts
```

要实现：

- `getDynamicTsdRules(style, func)`
- `analyzeResolutionTarget(currFunc, nextFunc, nextRoman, nextChordType)`
- `decorateChordType(slot, nextSlot, styleProfile, rng)`

风格要求：

- POP: clean triad / add9 / sus，避免 11/13/altered 常态化。
- LOFI: 9sus4 / 13sus4 / maj9 / m9 / m11，弱化强 V-I。
- RNB/JAZZ: 允许更丰富 altered / 13 / tritone sub。

### 3. 借用和弦 Modal Interchange

源：

```text
borrowedChordPlanner.ts
STYLE_BORROW_PROB
STYLE_MAX_BORROWS_PER_SONG
RULE_A1 / A2 / B / C / D / E / F / G
planBorrowedChords
```

policy 数据移入：

```text
knowledge/borrowPolicies.ts
```

算法移入：

```text
harmony/borrowedChordPlanner.ts
```

必须实现的音乐语义：

- Borrowed Chord = 同主音平行调式借用，不改变全曲调中心。
- Tonicization = 临时主音，需要 localTonalCenterPc / forcedScale。
- 二者不能混淆。
- 借用规则必须有 per-song cap。
- borrowSource 要有 single-source lock：同一首歌尽量只从 Aeolian / Mixolydian / Phrygian / Dorian 中一个来源借。
- LOFI 默认不跑外部随机 borrow planner，除非 progression prototype 自带 borrowed metadata。

优先迁移规则：

- A1: IV -> iv -> T
- A2: iv -> bVII7 -> I backdoor
- B: vi -> bVI -> V chromatic dominant-prefix
- C: ii -> V -> bVI -> bVII -> I cadential chain

后续再迁：

- D / E / F / G 扩展规则

### 4. 离调 / Tonicization

源：

```text
tonicizationPlanner.ts
STYLE_TONICIZE_PROB
STYLE_TONICIZE_MAX_PER_SONG
STYLE_PLACEMENT_WEIGHTS
TARGET_MULT
V_TYPE_BY_SOURCE_TARGET
II_TYPE_BY_SOURCE_TARGET
planTonicization
```

policy 数据移入：

```text
knowledge/tonicizationPolicies.ts
```

算法移入：

```text
harmony/tonicizationPlanner.ts
```

必须实现：

- placement:
  - light
  - approach
  - iiv_split
  - full_2bar
- target quality:
  - major target -> Mixolydian V/X
  - minor target -> Phrygian Dominant / altered V/X
- localTonalCenterPc
- forcedScale
- tonicizationPlacement
- mustResolve
- secondary_ii_v / secondary_dominant borrowedSource

风格限制：

- POP: light / approach 为主，full_2bar 禁止或概率为 0。
- JAZZ: iiv_split / full_2bar 可用。
- RNB: 中间。
- LOFI: 默认禁用复杂 tonicization。

### 5. 和弦实化 / 填写

源：

```text
musicEngine.ts
realizeProgression / parsedChords construction
display chord symbol upgrade
localTonalCenterPc derivation
forcedScale honor
borrowedFrom detect/propagate
bassRole / bassPattern / arrangementMode metadata
```

目标：

```text
harmony/chordRealizer.ts
harmony/progressionRealizer.ts
```

这里的“和弦渲染/填写”指 Harmony 层把 progression slot 实化成 HarmonicPlan chord span，不是最终 MIDI 事件渲染。

必须输出到 HarmonicPlan 或扩展 ChordSpan 的字段：

- id
- roman
- rootPc
- chordType / quality
- startBeat
- durationBeats
- sectionId
- function
- borrowedSource
- borrowedFrom
- mustResolve
- forcedScale
- localTonalCenterPc
- tonicizationPlacement
- bassRole
- arrangementMode

如果当前 `ChordSpan.quality` 仍是 narrow `ChordQuality`，需要逐步扩展：

- 保留兼容字段 `quality`
- 新增 `chordType: ChordTypeId`
- tension / chordScale / voicing 以后优先读 `chordType`
- 旧测试继续通过

### 6. 和声候选择优

源：

```text
harmonicCoherence.ts
voiceLeadingLedger.ts
musicEngine.ts candidate selection comments
```

当前 newEngine 已经有 `evaluateHarmony` 的初步接入。继续完善：

- 每次生成 N 个候选 progression realization
- 借用/离调/动态装饰全部在候选内部完成
- 用 coherence score 选最高
- 同 seed 必须 deterministic
- 同 repeatGroup 必须保持同 progression identity

## Loop 执行方式

不要一次性大改。按 loop 做，每一轮只完成一个可测试闭环。

### Loop 模板

每一轮都按这个顺序：

1. 阅读源文件对应片段，确认只迁当前 loop 需要的部分。
2. 写或扩展 KB 数据模块。
3. 写或扩展 HARMONY 消费模块。
4. 接入 `buildHarmonicPlanFromArrangement`，但保持旧 API 兼容。
5. 添加测试。
6. 跑相关测试。
7. 检查边界：
   - KB 无 HARMONY import
   - HARMONY 可以 import KB
   - render 不 import progression templates
   - 无 Impro-Visor import
8. 若本轮通过，再进入下一轮。

### Loop 1: Progression Prototype KB

从这里开始：

```text
../melodygenerative/src/lib/styleDictionary.ts
SECTION 2 — PROGRESSION POOL
```

实现：

- `knowledge/progressions.ts` 扩展为 prototype registry。
- 迁 modern POP / RNB / JAZZ / BLUES / LOFI explicit prototypes。
- 提供 `listProgressionPrototypes`、`pickProgressionPrototype`、`fitProgressionToBars`。
- 旧 `pickProgressionDegrees` 保留兼容。

测试：

- POP major 能选到 `pop_canon_8` / `pop_4536251_8` 等。
- LOFI major 能选到 maj9/m9/13sus4 类 prototype。
- `fitProgressionToBars(8->16)` 长度正确。
- `transformPolicy` 在 LOFI 中禁用 tonicization / borrowed planner。

### Loop 2: Progression Realizer

实现：

- `harmony/progressionSelector.ts`
- `harmony/progressionRealizer.ts`

把 prototype slot 转为 resolved chord：

- rootPc = sectionKey + rootOffset
- durationBeats = slot.beats ?? beatsPerBar
- function = roman/TSD 推导
- chordType 保留
- sectionId 保留
- borrowed metadata 保留

接入：

- `buildResolvedProgression` 优先使用 prototype registry。
- fallback 到旧 degree picker。

测试：

- prototype 中 `borrowedSource` 会进入 HarmonicPlan。
- `beats=2` 的 split chord 会生成半小节 chord span。
- 同 repeatGroup 的 verse1/verse2 prototype id 相同。

### Loop 3: Dynamic TSD Decoration

实现：

- `knowledge/dynamicTsdDictionary.ts`
- `harmony/dynamicHarmonyDecorator.ts`

接入到 prototype realizer 的 slot 装饰阶段：

- 如果 slot.lockType=true，不改 chordType。
- 如果 lockType=false 或无类型，按 style/function/next target 选 chord type。
- tritone substitution 只在 policy 允许时触发。

测试：

- POP D->MajorTarget 不产生 13/7alt。
- LOFI D->MajorTarget 倾向 9sus4/13sus4。
- JAZZ D->MinorTarget 可以产生 7b9/7alt。
- lockType=true 的 authored chord type 不被覆盖。

### Loop 4: Borrowed Chord Planner

实现：

- `knowledge/borrowPolicies.ts`
- `harmony/borrowedChordPlanner.ts`

接入顺序：

```text
prototype selection
-> dynamic decoration
-> borrowed chord planner
-> tonicization planner
-> chord realizer
```

注意：如果 prototype.transformPolicy.allowBorrowed=false，不跑 borrowed planner。

测试：

- POP: IV before I 可变 iv，并标记 modal_interchange。
- POP/RNB: IV before I 可拆成 iv + bVII7 backdoor。
- 借用次数不超过 style cap。
- LOFI: planner 不随机插入 borrow；但 prototype 自带 borrow metadata 要保留。
- borrowed chord 不改变 global key，不设置 localTonalCenterPc 为新 key。

### Loop 5: Tonicization Planner

实现：

- `knowledge/tonicizationPolicies.ts`
- `harmony/tonicizationPlanner.ts`

接入：

- 如果 transformPolicy.allowTonicization=false，不跑。
- POP 禁止 full_2bar。
- JAZZ 允许 iiv_split/full_2bar。
- 生成的 V/X、ii/X 必须设置 localTonalCenterPc、forcedScale、mustResolve。

测试：

- POP: light/approach V/vi 能生成，full_2bar 不生成。
- JAZZ: ii/V + V/V 可以 split。
- minor target 使用 Phrygian Dominant 或 7b9。
- target 是 diminished / borrowed / home I 时不 tonicize。
- localTonalCenterPc 是目标 chord pc，不是 global key pc。

### Loop 6: Chord Realizer / HarmonicPlan 扩展

实现：

- `harmony/chordRealizer.ts`
- 扩展 `HarmonicPlan.ts` / `ChordSpan`

建议：

```ts
interface ChordSpan {
  quality: ChordQuality;      // compatibility
  chordType?: ChordTypeId;    // new authoritative extended type
  borrowedSource?: BorrowedSource;
  borrowedFrom?: string;
  mustResolve?: boolean;
  forcedScale?: ScaleTypeId;
  localTonalCenterPc?: PitchClass;
  tonicizationPlacement?: TonicizationPlacement;
  bassRole?: BassRole;
  arrangementMode?: ArrangementMode;
}
```

测试：

- maj9/m9/13sus4 等 extended chord type 能进 HarmonicPlan。
- old `quality` 调用仍然不炸。
- chordScaleMap 对 secondary dominant 使用 localTonalCenter / forcedScale。
- borrowed chord 的 borrowedChordMap 与 span metadata 一致。

### Loop 7: Chord Rendering Policy / Voicing Consumption

实现：

- `knowledge/chordRenderingPolicies.ts`
- HARMONY 输出 arrangementMode / bassRole / voicing intent。

注意：

- 最终 NoteIR 渲染仍属于 render。
- HARMONY 只输出 chord-level intent。
- voicing MIDI placement 可继续由 `knowledge/voicingStyles.ts`、`voicingPlacement.ts`、`widePianoVoicings.ts` 提供。

测试：

- POP chord intent 倾向 clean/open/low-density。
- LOFI chord intent 倾向 rootless/color/soft-cluster/wide。
- cadence phrase 可以偏 close。
- bridge 可以偏 spread/drop3。

### Loop 8: Candidate Optimization

完善：

- 多候选 harmony realization
- coherence scoring
- voice-leading scoring
- deterministic seed

测试：

- 同 seed 输出完全一致。
- 不同 seed 有 progression variety。
- 候选择优不会降低 coherence score。
- repeatGroup 的 progression identity 不破。

## 终止条件

当以下条件全部满足时，停止 loop，不再继续扩散：

1. `knowledge/progressions.ts` 已有 modern + LOFI explicit prototypes。
2. `knowledge/dynamicTsdDictionary.ts` 已有 POP / LOFI / RNB / JAZZ / BLUES 字典。
3. `knowledge/borrowPolicies.ts` 和 `harmony/borrowedChordPlanner.ts` 已接入。
4. `knowledge/tonicizationPolicies.ts` 和 `harmony/tonicizationPlanner.ts` 已接入。
5. HARMONY 层可以从 prototype 生成包含 extended chord type 的 HarmonicPlan。
6. LOFI 不会被外部随机 borrow/tonicization planner 污染，但 prototype 自带色彩保留。
7. POP 不会被 11/13/7alt 常态污染，除非明确 prototype 或 policy 允许。
8. render 层没有 progression template 或 tonicization algorithm。
9. `rg "improvisor|Impro" src/core/generation/newEngine/knowledge src/core/generation/newEngine/harmony` 没有新增依赖。
10. 下面测试组全部通过：

```bash
npm test -- src/core/generation/newEngine/knowledge/progressions.test.ts
npm test -- src/core/generation/newEngine/knowledge/dynamicTsdDictionary.test.ts
npm test -- src/core/generation/newEngine/harmony/harmonyFromArrangement.test.ts
npm test -- src/core/generation/newEngine/harmony/borrowedChord.test.ts
npm test -- src/core/generation/newEngine/harmony/secondaryDominant.test.ts
npm test -- src/core/generation/newEngine/harmony/modulation.test.ts
npm test -- src/core/generation/newEngine/harmony/chordScaleIntegration.test.ts
npm test -- src/core/generation/newEngine/harmony/harmonyChoiceOptimization.test.ts
npm test -- src/core/generation/newEngine/render/renderSongFull.test.ts
```

如果项目测试命令不是 `npm test --`，先查看 `package.json`，使用项目现有测试命令。

## 必须覆盖的用例

### POP 用例

1. `I - V - vi - IV` clean pop progression，不产生 11/13/7alt。
2. `IV - V - iii - vi - ii - V - I` 支持锁定 chord type。
3. `IV -> iv -> I` borrowed iv，global key 不变。
4. `iv -> bVII7 -> I` backdoor cadence，bVII7 effective function 为 D。
5. `V/vi -> vi` 设置 localTonalCenterPc 为 vi 的根音。
6. pre-chorus 或 build section 可使用更强 dominant preparation。

### LOFI 用例

1. `Imaj9 - vi m9 - ii m9 - V13sus4` 能进入 HarmonicPlan。
2. LOFI prototype 的 `transformPolicy.allowTonicization=false` 生效。
3. LOFI 不被随机插入 full ii-V。
4. LOFI dominant 使用 9sus4/13sus4，弱化强 V-I。
5. LOFI borrowed metadata 如果来自 prototype，需要保留。
6. LOFI chord type 不被 narrow `ChordQuality` 截断。

### RNB / JAZZ 用例

1. RNB backdoor `iv - bVII13 - Imaj9`。
2. JAZZ `ii - V - I` 可用 13/7b9/7alt。
3. JAZZ full_2bar tonicization 可触发但受 cap 限制。
4. tritone substitution 只在 allowed policy 下触发。

### 结构与不变量用例

1. 同 repeatGroup 的 verse1/verse2 使用同一 progression prototype。
2. section 长度与 chord durations 总和一致。
3. split chord beats 合计等于原 bar。
4. HarmonicPlan deepFreeze。
5. 同 seed deterministic。
6. render 层只消费 HarmonicPlan，不改变和声。

## 最后提醒

本任务不是把 `melodygenerative` 的旧 engine 搬过来。它是把旧工程里成熟的音乐知识和和声算法，按当前 newEngine 的分层重新落位：

- 模板和 policy 是 KB。
- 生成、借用、离调、实化是 HARMONY。
- 声音事件是 render。
- 审计是 audit/knowledge 共享规则。

每轮只做一个闭环，测试通过再继续。不要为了快而把模板数组写进 `harmonyEngine.ts`，也不要让 render 层重新发明和声。
