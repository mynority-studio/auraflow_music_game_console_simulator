# melodygenerative 乐理 KB 移植计划

本文档用于指导 Claude 将 `../melodygenerative` 中可复用的乐理系统移植到当前 `newEngine` 的 Knowledge Base。范围限定为纯乐理规则、可查询知识表、伴奏织体描述与宽阔钢琴排列法；明确排除 Impro-Visor 移植资产与模板库。

## 目标

把 `melodygenerative` 里已经沉淀的乐理知识整理成结构清晰、可查阅、可调用的 KB 模块，使 `newEngine` 的生成、审计、resolver、render 层都能通过稳定 API 消费这些知识。

核心要求：

- 数据与规则进入 `src/core/generation/newEngine/knowledge/`。
- render 层只消费 KB 的 profile/rule id 和查询结果，不直接内嵌大表。
- audit/resolver 层使用同一套音程、调性稳定度、和弦内角色、倾向音解决规则。
- 不移植 Impro-Visor 模板、lick、grammar、brick、style file 资产。

## 必须排除

以下内容不要移植进 KB，除非之后另开任务明确要求：

- `../melodygenerative/src/lib/improvisor/**`
- `../melodygenerative/src/lib/improvisorSlopes.ts`
- `../melodygenerative/src/lib/improvisorVocab.ts`
- `../melodygenerative/scripts/import-impro-visor*.ts`
- `BrickDictionary`、`BuiltinGrammar`、`EnrichedGrammar`、`SlopeAdapter`、`GrammarRuntime`
- `LickGen`、`RoadMap`、`ChordPart`、`GuideTonePlanner`、`NoteChooser`、`StyleRenderer`
- `styleDictionary.ts` 里的 progression pools、motif pools、legacy `primaryTextures`
- `_legacyTexturesAsPool()` 生成出的旧模板织体

注意：`musicTheory.ts` 中部分 scale/chord 名称可能来自 Impro-Visor 兼容词汇，但如果内容只是音阶音程集合、和弦音程集合、别名归一化，可以作为纯乐理数据迁入；不要迁入对应的 vocab/lick/template 绑定。

## 推荐目标结构

优先扩展现有 `knowledge` 目录，不要另起一套平行系统。建议文件树：

```text
src/core/generation/newEngine/knowledge/
  scales.ts                  # 保留现有兼容导出，扩展为完整 ScaleLibrary
  chords.ts                  # 保留现有兼容导出，扩展为完整 ChordLibrary
  intervalAesthetics.ts      # 调内音程审美、K-K 稳定度/张力度
  scaleGravity.ts            # Lerdahl scale gravity
  chordIntervalRoles.ts      # 和弦内音程角色、avoid/tension/altered tension
  melodyChordSemantics.ts    # note-in-chord 查询与旋律语义判断
  tendencyRules.ts           # 倾向音与解决规则
  voicingStyles.ts           # shell/rootless/cluster/full/blues 等排列策略
  voicingPlacement.ts        # placeVoicing/applyArrangement 的纯规则部分
  widePianoVoicings.ts       # 宽阔钢琴 lane、role、spread mode、选择规则
  textureProfiles.ts         # 现代/lofi 伴奏织体 profile，不含 legacy 模板
  basslineRules.ts           # bass anchor/pattern 规则
  harmonicCoherence.ts       # 可选：和声一致性审计规则
  voiceLeadingLedger.ts      # 可选：声部进行 obligation/score/report
```

所有新模块必须从 `knowledge/index.ts` 统一导出。现有模块名如 `scales.ts`、`chords.ts`、`voicings.ts` 已存在时，优先保持兼容 API，再增加 richer API。

## 源文件到目标模块映射

| 源文件 | 移植内容 | 目标模块 | 备注 |
| --- | --- | --- | --- |
| `src/lib/musicTheory.ts` | `SCALE_TYPES`、scale aliases、scale interval sets | `knowledge/scales.ts` | 扩展 current major/minor，不破坏现有调用 |
| `src/lib/musicTheory.ts` | `CHORD_TYPES`、`CHORD_TYPE_ALIASES`、`normalizeChordType` | `knowledge/chords.ts` | 新增宽 chord type；保留 narrow `ChordQuality` 兼容层 |
| `src/lib/musicTheory.ts` | `INTERVAL_AESTHETICS_MAJOR/MINOR`、`INTERVAL_AESTHETICS`、K-K stability/tension | `knowledge/intervalAesthetics.ts` | 若当前已有 `keyProfiles.ts`，整合而不是重复 |
| `src/lib/musicTheory.ts` | `SCALE_GRAVITY`、`computeLerdahlScaleGravity`、`getScaleGravity` | `knowledge/scaleGravity.ts` | 对外返回 readonly record/array，避免公开可变 Map |
| `src/lib/musicTheory.ts` | `CHORD_VOICING_AESTHETICS`、`getChordVoicingAesthetics` | `knowledge/chordIntervalRoles.ts` | 这是和弦内角色表，不只是 voicing |
| `src/lib/musicTheory.ts` | `TENDENCY_TABLE`、`getMelodyTendency`、`resolveChordScenario` | `knowledge/tendencyRules.ts` | 供 auditor/resolver/render 共用 |
| `src/lib/musicTheory.ts` | `getMelodyChordSemantics`、`evaluateNoteInChordContext` | `knowledge/melodyChordSemantics.ts` | 移除其中对 `improvisorVocab` 的依赖 |
| `src/lib/musicTheory.ts` | `assembleVoicing`、`placeVoicingMidi`、`applyArrangement`、style presets | `knowledge/voicingStyles.ts` + `knowledge/voicingPlacement.ts` | 只放规则和候选计算，不负责写 MIDI event |
| `src/lib/widePianoVoicing.ts` | lane/role/zone/spread mode、`buildWidePianoVoicing`、`buildInnerMotion` | `knowledge/widePianoVoicings.ts` | `renderWidePianoVoicing` 的 event emission 放 render 层 |
| `src/lib/styleDictionary.ts` | modern/lofi `TextureProfile`、`phraseCellRole`、`pickTextureForBar` | `knowledge/textureProfiles.ts` | 只迁 explicit modern/lofi profile，不迁 legacy |
| `src/lib/basslineRules.ts` | bass anchor rules、pattern rules、rule picker | `knowledge/basslineRules.ts` | render 层消费 pattern 结果 |
| `src/lib/harmonicCoherence.ts` | resolution ledger、coherence policies、score/evaluate functions | `knowledge/harmonicCoherence.ts` | 审计层第二阶段迁移 |
| `src/lib/voiceLeadingLedger.ts` | voice-leading obligation、resolution report、score/evaluate | `knowledge/voiceLeadingLedger.ts` | 审计层第二阶段迁移 |

## 分类方案

### 1. 音阶类型 ScaleLibrary

迁移 `SCALE_TYPES` 的 interval definitions 和必要别名。建议按 family 分类：

- diatonic modes: Ionian、Dorian、Phrygian、Lydian、Mixolydian、Aeolian、Locrian
- minor variants: Harmonic Minor、Melodic Minor
- pentatonic/blues: Major Pentatonic、Minor Pentatonic、Blues、Major Blues、Composite Blues、Country Blues
- jazz/symmetric: Altered、Half-Whole Diminished、Whole-Half Diminished、Whole Tone、Lydian Dominant
- bebop: Bebop Dominant、Bebop Major、Bebop Dorian、Bebop Melodic Minor
- color/world/additional: Phrygian Dominant、Mixolydian b6、Lydian #9、Harmonic Major、Chromatic、Augmented、In-Sen、Double Harmonic Major、Mixolydian Pentatonic、Lydian Pentatonic、Locrian Pentatonic、Minor Six Pentatonic

建议 API：

```ts
getScaleType(id: ScaleTypeId): ScaleTypeDefinition
listScaleTypes(filter?: { family?: ScaleFamily; source?: "core" | "extended" }): readonly ScaleTypeDefinition[]
getScalePitchClasses(rootPc: PitchClass, scaleType: ScaleTypeId): readonly PitchClass[]
```

### 2. 和弦类型 ChordLibrary

迁移 `CHORD_TYPES`、`CHORD_TYPE_ALIASES`、`normalizeChordType`。当前 `newEngine` 的 `ChordQuality` 很窄，建议保留它用于 harmonic plan 兼容，同时新增更宽的 `ChordTypeId`。

必须覆盖的和弦类型包括：

- triads: `maj`、`min`、`dim`、`aug`、`sus2`、`sus4`、`5`
- sevenths: `maj7`、`m7`、`7`、`m7b5`、`dim7`、`mMaj9`
- extensions: `add9`、`m9`、`maj9`、`9`、`11`、`13`、`maj13`、`m11`、`m13`
- sixth colors: `6`、`6/9`、`m6/9`
- sus colors: `7sus4`、`9sus4`、`13sus4`、`m7sus4`
- altered dominants: `7b9`、`7#9`、`7b13`、`7#5`、`7b5`、`7alt`、`13b9`、`7#11`、`9#5`、`9#11`、`13#11`、`7#9#11`
- color voicings: `maj7#11`、`maj9#11`、`quartal`、`madd9`

建议 API：

```ts
normalizeChordType(input: string): ChordTypeId | undefined
getChordType(id: ChordTypeId): ChordTypeDefinition
getChordPitchClasses(rootPc: PitchClass, chordType: ChordTypeId): readonly PitchClass[]
getChordIdentityRoles(chordType: ChordTypeId): readonly ChordRole[]
```

### 3. 音程关系与调性稳定度

迁移 `INTERVAL_AESTHETICS_MAJOR/MINOR`、`KK_STABILITY_*`、`KK_TENSION_*`、`kkTensionMajor/minor`、`selectIntervalAesthetics`、`modeToKeyFamily`。

这部分是 Global Music Knowledge Base 的核心查询能力，不应散落在 melody/render/audit 各处。

建议每个 scale degree/pc interval 提供：

- scale degree label
- tonal stability
- tension level
- melodic tendency
- color description
- suitable contexts
- avoid/resolution hints

建议 API：

```ts
getIntervalAesthetic(intervalPc: number, keyFamily: "major" | "minor"): IntervalAesthetic
getKeyStability(intervalPc: number, keyFamily: "major" | "minor"): number
getKeyTension(intervalPc: number, keyFamily: "major" | "minor"): number
```

### 4. 音阶重力 ScaleGravity

迁移 `SCALE_GRAVITY`、`computeLerdahlScaleGravity`、`getScaleGravity`。

用途：

- melody candidate scoring
- resolver 判断是否需要回落到稳定音
- auditor 解释 warning/fail 的理论原因

建议 API：

```ts
getScaleGravityProfile(scaleType: ScaleTypeId): ScaleGravityProfile
rankStableDegrees(scaleType: ScaleTypeId): readonly ScaleDegree[]
```

### 5. 和弦内角色与倾向音规则

迁移：

- `CHORD_VOICING_AESTHETICS`
- `getChordVoicingAesthetics`
- `TENDENCY_TABLE`
- `getMelodyTendency`
- `resolveChordScenario`
- `isAvoidNote`
- `classifyNoteRole`

按以下概念分类：

- chord tone
- available tension
- altered tension
- avoid note
- tendency tone
- required/soft resolution
- preferred register
- bass eligibility

建议 API：

```ts
classifyChordInterval(chordFamily: ChordFamily, intervalPc: number): ChordIntervalRole
getTendencyRule(args: TendencyQuery): TendencyRule | undefined
isBassEligible(chordFamily: ChordFamily, intervalPc: number): boolean
preferredRegisterForChordInterval(chordFamily: ChordFamily, intervalPc: number): RegisterBand
```

### 6. 统一旋律-和弦语义查询

迁移 `evaluateNoteInChordContext`，但必须移除 `getMelodyChordSemantics` 中对 `improvisorVocab` 的 lazy require。可以保留 `vocabFamily` 字段为 optional，但不得从 Impro-Visor 词库计算。

该查询应成为 melody renderer、auditor、resolver 的共同入口。

建议 API：

```ts
evaluateNoteInChordContext(args: {
  notePc: PitchClass;
  chordRootPc: PitchClass;
  chordType: ChordTypeId;
  keyRootPc: PitchClass;
  scaleType: ScaleTypeId;
  nextChord?: ChordRef;
  localTonalCenterPc?: PitchClass;
  mode?: "tonal" | "modal";
}): MelodyChordEvaluation
```

返回结果至少包含：

- note role
- chord tension level
- key tension level
- stability
- avoid note flag
- resolution target candidates
- warning/fail severity hint
- human-readable reason code

### 7. 普通 voicing 与排列法

迁移 `assembleVoicing`、`placeVoicingMidi`、`applyArrangement`、`resolveClash`、`preferredRegisterFor`、`isBassEligibleFor`、`STYLE_SHELL`、`STYLE_ROOTLESS`、`STYLE_CLUSTER`、`STYLE_FULL`、`STYLE_BLUES`、`PIANO_LIL_THRESHOLDS`。

分类：

- voicing style preference: shell/rootless/cluster/full/blues
- arrangement mode: close/drop2/drop3/spread
- identity tone preservation
- clash resolution
- register preference
- placement scoring
- voice-leading penalty
- muddy low interval guard

建议 API：

```ts
assembleVoicingRecipe(args: VoicingRecipeQuery): VoicingRecipe
placeVoicing(args: VoicingPlacementQuery): PlacedVoicing
applyArrangementMode(args: ArrangementQuery): PlacedVoicing
```

注意：KB 可以返回 placed MIDI notes，但不要在 KB 中创建具体 DAW/MIDI event。

### 8. 宽阔钢琴排列法 Wide Piano Voicing

迁移 `widePianoVoicing.ts` 中的纯规则：

- `PianoVoiceLane`
- `VoiceRole`
- `SpreadMode`
- `WidePianoOptions`
- `PIANO_ZONES`
- `buildWidePianoVoicing`
- `buildInnerMotion`
- `attachWidePianoVoicings`

不要把 `renderWidePianoVoicing` 的 event 写入逻辑放进 KB；它应迁入 render 层，消费 KB 输出的 `WidePianoVoicing`。

建议 KB 分类：

- lane zones:
  - bass: 36-52
  - low_outer: 50-61
  - inner_low: 62-66
  - inner_mid: 65-70
  - inner_high: 68-72
  - upper_outer: 73-79
- spread modes:
  - close
  - half_wide
  - wide
  - drop2_wide
- role placement:
  - root/third/fifth/seventh/ninth/eleventh/thirteenth/sixth/color/doubling
- safety:
  - muddy interval check
  - span compression
  - melody collision avoidance belongs in render integration

建议 API：

```ts
buildWidePianoVoicing(args: WidePianoVoicingQuery): WidePianoVoicing
buildWidePianoInnerMotion(args: InnerMotionQuery): readonly InnerMotionEvent[]
selectWidePianoSpreadMode(args: PhraseAndHarmonyContext): SpreadMode
```

### 9. 伴奏织体 TextureLibrary

只迁 `styleDictionary.ts` 中 explicit modern/lofi `TextureProfile`，不要迁 `_legacyTexturesAsPool()`。

可迁 profile：

- `lyrical_felt_sparse` / `Lyrical_Felt_Piano_Sparse`
- `lyrical_10th_broken` / `Lyrical_10th_Broken`
- `ambient_pad_breath` / `Ambient_Pad_Breath`
- `ambient_reverse_swell` / `Ambient_Reverse_Swell`
- `soft_guitar_pluck` / `Soft_Guitar_Pluck_8ths`
- `piano_question_answer` / `Piano_Question_Answer`
- `low_pedal_wash` / `Low_Pedal_Color_Wash`
- `halftime_emotional_pulse` / `HalfTime_Emotional_Pulse`
- `lofi_piano_oneshot_space` / `Piano_Lofi_OneShot_Space`
- `lofi_late_chord_answer` / `Piano_Lofi_Late_Chord_Answer`
- `lofi_emo_broken_10th` / `Piano_Emo_Broken_10th`
- `lofi_ambient_sustain_wash` / `Piano_Ambient_Sustain_Wash`
- `lofi_halftime_soft_pulse` / `Piano_HalfTime_Soft_Pulse`
- `lofi_dusty_chops` / `Piano_Lofi_Dusty_Chops`
- `lofi_tape_wobble_arp_sparse` / `Piano_Lofi_Tape_Wobble_Arp`
- `lofi_common_tone_soft_roll` / `Piano_CommonTone_Soft_Roll`
- `wide_color_motion_lofi_pop` / `Piano_Wide_Color_Motion`

迁移字段：

- id
- textureCase
- styles/subStyles
- mood
- phraseRoles
- densityRange
- energyRange
- avoidOnDominantChain
- preferOnCadence
- maxRepeatBars
- partPolicy
- timing
- preferOnLoopBack

建议 API：

```ts
phraseCellRole(barIndex: number, totalBars: number): PhraseCellRole
pickTextureForBar(args: TextureSelectionQuery): TextureProfile
listTextureProfiles(filter?: TextureProfileFilter): readonly TextureProfile[]
```

render 层再实现每个 `textureCase` 的事件生成。可参考 `musicEngine.ts` 中对应 switch case，但不要把旧 legacy case 一起带入。

### 10. BasslineRules

迁移 `basslineRules.ts`：

- anchor rules:
  - `stepwise_descent`
  - `root_lock`
  - `octave_alternate`
  - `fifth_drop`
  - `walking_bass`
  - `boogie_root_fifth`
- pattern rules:
  - `boogie_pattern`
  - `stride_pattern`
  - `dilla_pocket`
- helpers:
  - `resolveBassAnchorPc`
  - `clampPcToBassMidi`
  - `pickBasslineRule`

建议 API：

```ts
pickBasslineRule(args: BasslineRuleQuery): BasslineRule
resolveBassAnchor(args: BassAnchorQuery): BassAnchor
getBassPattern(args: BassPatternQuery): BassPattern
```

## 审计层第二阶段

以下两个模块不是模板，建议作为第二阶段迁移到 KB/audit 共享层：

### HarmonicCoherence

源：`../melodygenerative/src/lib/harmonicCoherence.ts`

可迁内容：

- `COHERENCE_POLICIES`
- `buildResolutionLedger`
- `scoreChordIdentity`
- `scoreGuideTones`
- `scoreTendencyResolution`
- `scoreTargetStability`
- `scoreBassMotion`
- `scoreLocalColorRoles`
- `collectIssues`
- `evaluateHarmony`

目标用途：

- `GenerationController` 读取 audit report 时，能把 warning/fail 归因到具体乐理规则。
- resolver 可以优先修复 tendency、guide tone、bass motion、target stability 问题。

### VoiceLeadingLedger

源：`../melodygenerative/src/lib/voiceLeadingLedger.ts`

可迁内容：

- `VoiceLeadingRole`
- `VoiceLeadingObligation`
- `VoiceLeadingResolution`
- `VoiceLeadingReport`
- `buildVoiceLeadingLedger`
- `scoreVoiceLeading`
- `evaluateVoiceLeading`

目标用途：

- render 层 retry budget 不只看是否出音，还看 obligation 是否解决。
- audit report 可以表达未解决的 3rd/7th、altered tension、bass tendency 等问题。

## 实施阶段

### Phase 0: 边界与测试基线

1. 在迁移 PR 开头添加 exclusion 注释或测试，确保新 KB 不 import `improvisor`。
2. 记录当前 `newEngine` 所有 knowledge 导出与调用点。
3. 先跑现有测试，确认基线。

验收：

- `rg "improvisor|Impro" src/core/generation/newEngine/knowledge` 没有命中。
- 现有测试通过，或记录原本失败项。

### Phase 1: 纯数据表迁移

先迁移无副作用、无 render 依赖的数据：

1. scale types
2. chord types + aliases
3. interval aesthetics
4. scale gravity
5. chord interval roles
6. tendency rules

验收：

- 每个模块有 `list/get/normalize/classify` 查询函数。
- 数据结构是 readonly/frozen 或不可变导出。
- `knowledge/index.ts` 导出全部新模块。

### Phase 2: 统一语义查询

迁移 `evaluateNoteInChordContext`，重写其依赖为 newEngine KB 内部模块。

验收：

- 不依赖 Impro-Visor vocab。
- 返回 stable reason code，便于 audit report 使用。
- melody/audit/resolver 至少有一个调用点切换到这个 API。

### Phase 3: voicing 与宽阔排列

迁移普通 voicing 和 wide piano voicing 的规则部分。

验收：

- `buildWidePianoVoicing` 能独立返回 lane/role/note 结构。
- render 层只负责把 voicing 结构转为事件。
- drop2/drop3/spread/drop2_wide 有最小快照测试。

### Phase 4: 伴奏织体与 bassline

迁移 modern/lofi texture profiles 与 bassline rules。

验收：

- `pickTextureForBar` 能按 style、phrase role、density、energy、cadence、dominant chain 筛选。
- legacy template profile 不进入 `TEXTURE_POOL`。
- bassline rule 能输出 anchor/pattern，而不是直接写事件。

### Phase 5: audit/resolver 集成

迁移 harmonic coherence 与 voice-leading ledger，或至少先接入其评分概念。

验收：

- audit report 中包含 rule id、severity、location、suggested fix。
- `GenerationController` 可以基于 audit severity 决定 warning/fail/retry。
- render retry budget 不再只看局部渲染失败，也看乐理 obligation 是否可修复。

## 推荐测试

至少增加以下测试：

- scale/chord lookup snapshot：所有 scale/chord id 可 normalize 并返回 pitch classes。
- interval semantics：major/minor 中 1、3、4、7 的 stability/tension 符合表定义。
- chord interval role：maj/dom7/min/m7b5/sus 的 avoid/tension 分类稳定。
- `evaluateNoteInChordContext`：avoid note、available tension、altered tension、resolution target 可复现。
- wide voicing：zone 不越界，低区不产生 muddy minor 2/minor 9 cluster。
- texture selection：不会选出 legacy profile；dominant chain/cadence/repeat filters 生效。
- bassline rules：walking/root_lock/boogie 在固定上下文中输出稳定。
- no Impro-Visor dependency：knowledge 目录和新测试目录不 import improvisor。

## Claude 执行提示

实现时请按以下顺序提交，避免一次性大迁移难以审计：

1. `scales.ts` + `chords.ts` 扩展，保持旧 API 兼容。
2. `intervalAesthetics.ts` + `scaleGravity.ts` + `chordIntervalRoles.ts`。
3. `tendencyRules.ts` + `melodyChordSemantics.ts`。
4. `voicingStyles.ts` + `voicingPlacement.ts`。
5. `widePianoVoicings.ts`，render 层单独接入。
6. `textureProfiles.ts` + `basslineRules.ts`。
7. `harmonicCoherence.ts` + `voiceLeadingLedger.ts`。
8. 最后接 `GenerationController`、auditor、resolver、render retry budget。

每个阶段完成后都要更新 `knowledge/index.ts`，并添加对应测试。若发现源代码函数内部引用了 Impro-Visor 模块，必须重写依赖或删除该字段，不允许把 Impro-Visor 依赖带入 newEngine KB。
