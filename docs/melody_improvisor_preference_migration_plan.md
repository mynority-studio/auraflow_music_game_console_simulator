# 旋律 Grammar / Slope / Preference 移植方案

本文档用于指导将 `../melodygenerative` 中新增的旋律生成部分移植到当前 `newEngine`。范围只包含已经加入 style / macro preference 的旋律织体、旋律生成手法、Impro-Visor 引入的 grammar / slope 抽象模板，以及排比、落点解决感相关逻辑。

目标不是把旧工程的 melody pipeline 原封搬进来，而是按当前 newEngine 分层落位：

- KB 层保存旋律模板、grammar、slope、style preference、token 语义、选择规则。
- render 层解释 KB 资产，并结合 `ArrangementPlan` / `HarmonicPlan` / `MotifStore` 生成 lead `NoteIR`。
- 现有管道仍保持 `Arrangement -> Harmony -> Instrumentation -> Prepass -> Render -> Auditor`。
- 生成结果尽量与 `melodygenerative` 的 Impro-Visor-style melody pipeline 一致。

## 当前源系统结论

`melodygenerative` 的旋律主链已经从旧 literal lick pool 转为：

```text
ChordPart
  -> RoadMap
  -> Grammar expansion
  -> LickGen token realization
  -> StyleRenderer
  -> NoteEvent[]
```

关键文件：

```text
../melodygenerative/src/lib/styleDictionary.ts
../melodygenerative/src/lib/improvisor/GrammarTypes.ts
../melodygenerative/src/lib/improvisor/GrammarRuntime.ts
../melodygenerative/src/lib/improvisor/SlopeAdapter.ts
../melodygenerative/src/lib/improvisor/LofiGrammarTags.ts
../melodygenerative/src/lib/improvisor/RoadMap.ts
../melodygenerative/src/lib/improvisor/BrickParser.ts
../melodygenerative/src/lib/improvisor/GuideTonePlanner.ts
../melodygenerative/src/lib/improvisor/LickGen.ts
../melodygenerative/src/lib/improvisor/NoteChooser.ts
../melodygenerative/src/lib/improvisor/StyleRenderer.ts
../melodygenerative/src/lib/improvisor/generateImprovisorMelody.ts
../melodygenerative/src/lib/improvisorSlopes.ts
```

不要迁移为主入口：

```text
generateImprovisorMelody()
```

它可以作为行为参考，但当前 newEngine 不应新增一条绕过 `MotifStore` / `AnchorPlan` / `HarmonicPlan` 的并行 melody pipeline。

## 移植边界

### 放入 KB 层

目标目录：

```text
src/core/generation/newEngine/knowledge/
```

建议新增：

```text
melodyGrammarTypes.ts
melodyGrammarRules.ts
melodySlopeProfiles.ts
melodyStylePreferences.ts
melodyBrickPatterns.ts
melodyResolutionRules.ts
melodicTextureProfiles.ts
```

KB 保存：

- Abstract melody token 类型。
- Grammar rule 结构。
- 从 Impro-Visor slope 转换出的抽象 grammar rule。
- POP / LOFI / RNB / JAZZ 的 style-safe slope 子集。
- LOFI tag、POP tag、RNB tag、JAZZ tag 与权重 multiplier。
- soft-parallel favorite rule。
- fill scale palette。
- tension resolution / scale gravity strictness / floating color policy。
- motif repetition / pair / phrase role preference。
- RoadMap brick family / pattern metadata。
- cadence / landing / guide-tone binding policy。

KB 不做：

- 不读取当前 `HarmonicPlan` 做生成。
- 不产 `NoteIR`。
- 不改 `MotifStore`。
- 不直接调用 render。

### 放入 render 层

目标目录：

```text
src/core/generation/newEngine/render/
```

建议新增：

```text
melodyBrickPlanner.ts
melodyGrammarExpander.ts
melodyTokenRealizer.ts
melodyGuideTonePlanner.ts
melodyStyleFeel.ts
melodyPreferenceSelector.ts
```

render 负责：

- 从 `HarmonicPlan` 构造 melody chord blocks。
- 构造 RoadMap-like `MelodyBrickPlan`。
- 按 style / section / phrase / skeletonRole 选择 grammar profile。
- 展开 grammar 为 abstract tokens。
- 按当前 chord context 实化 token 为 `NoteIR`。
- 执行 approach-pair、slope constraint、guide-tone binding。
- 执行 style feel：swing、push、articulation、velocity accent。
- 接入现有 `MotifStore` / `MelodyAnchorPlan`，保留排比和 hook 复现。

render 不做：

- 不保存大模板表。
- 不改变和声。
- 不选择 chord progression。

## 只迁移的内容

本轮只移植“有 preference 的旋律资产和手法”。

### 必迁

从 `SlopeAdapter.ts` 迁移：

- `slopeNoteToToken`
- `flatTokenToToken`
- `brickTypeToFamilies`
- `slopeRuleToGrammarRule`
- `lofiStableSlopeRulesToGrammarRules`
- `softParallelFavoriteSlopeRulesToGrammarRules`
- `popStableSlopeRulesToGrammarRules`
- `rnbSoulSlopeRulesToGrammarRules`
- `jazzSlopeRulesToGrammarRules`

从 `LofiGrammarTags.ts` 迁移：

- `LofiGrammarTag`
- `extractLofiSlopeFeatures`
- `tagImprovisorSlopeRule`
- `lofiSlopeWeightMultiplier`
- LOFI avoid / prefer tags

从 `GrammarTypes.ts` / `GrammarRuntime.ts` 迁移：

- `AbstractMelodyToken`
- `GrammarRule`
- `Grammar`
- `makeGrammar`
- weighted expansion
- rule conditions by brick family / brick name / duration

从 `LickGen.ts` 迁移：

- per-token chord query
- `A` approach token locks immediate next playable token
- `SlopeEnter` / `SlopeExit`
- slope constraint `[prev + dirMin, prev + dirMax]`
- `pushOrMergeRepeat`
- brick duration clipping
- no chord-boundary clipping
- guide-tone binding for structural tokens

从 `GuideTonePlanner.ts` 迁移：

- per-chord guide-tone anchors
- long chord splits into two guide-tone points
- 3rd/7th priority
- nearest-register materialization

从 `StyleRenderer.ts` 迁移：

- swing
- push
- accent
- articulation duration scaling
- style feel presets

从 `styleDictionary.ts` 迁移：

- `MotifContextRules`
- `MotifDef`
- `defineMotif` 的 author-friendly motif token semantics
- `MotifPool` starts / flows / ends
- `MACRO_FILL_SCALES`
- `tensionResolutionStrategy`
- `motifRepeatStrategy`
- `returnRule`
- `tensionResolutionStrictness`
- `gravityStrictness`
- `allowFloatingColor`
- `allowBluesHangTone`

### 不迁或暂不迁

- 旧 literal lick pool。
- 已删除的 `LICK_METADATA_BY_NOTES` / `POOL_BY_BRICK` / `SHARED_LICK_POOL` 路径。
- 旧 pre-Impro-Visor motif picker。
- `generateImprovisorMelody()` 作为新的顶层入口。
- `musicEngine.ts` 中与旧 monolithic engine 强绑定的 melody path。
- 没有 style preference 的 raw 全量模板直接进 render。

## 目标消费链

建议的 newEngine 消费链：

```text
ArrangementPlan.phrases / motifBindings
  + HarmonicPlan.chordTimeline
  + InstrumentationPlan.melodyReservationPlan
  + KB melody style preferences
        |
        v
render/motifAnchorPrepass
  生成 MotifStore + MelodyAnchorPlan
        |
        v
render/melodyBrickPlanner
  HarmonicPlan -> MelodyBrickPlan
        |
        v
render/melodyPreferenceSelector
  style + phrase role + skeletonRole -> GrammarProfile
        |
        v
render/melodyGrammarExpander
  KB GrammarRule -> AbstractMelodyToken[]
        |
        v
render/melodyTokenRealizer
  token + chord context + guide-tone + contract gate -> NoteIR
        |
        v
render/melodyStyleFeel
  swing / push / articulation / velocity
        |
        v
lead TrackIR
```

## KB 到 render 的消费链接

| KB 模块 | render 消费方 | 用途 |
| --- | --- | --- |
| `melodyGrammarTypes.ts` | `melodyGrammarExpander.ts`, `melodyTokenRealizer.ts` | token / grammar 基础类型 |
| `melodySlopeProfiles.ts` | `melodyPreferenceSelector.ts` | POP/LOFI/RNB/JAZZ slope 子集与权重 |
| `melodyGrammarRules.ts` | `melodyGrammarExpander.ts` | weighted grammar expansion |
| `melodyBrickPatterns.ts` | `melodyBrickPlanner.ts` | chord sequence -> brick family/name |
| `melodyStylePreferences.ts` | `melodyPreferenceSelector.ts`, `melodyStyleFeel.ts` | style-specific preference / strictness / feel |
| `melodyResolutionRules.ts` | `melodyTokenRealizer.ts`, `melodyGuideTonePlanner.ts` | 落点、解决、guide-tone binding |
| `guideTonePolicies.ts` | `melodyGuideTonePlanner.ts` | guide tone 3/7 和 voice-leading |
| `scaleGravity.ts` / `melodyChordSemantics.ts` | `melodyTokenRealizer.ts` | 张力解决、合同 gate、avoid 处理 |

## 与现有 newEngine 的对齐方式

当前 newEngine 已有：

```text
render/motifAnchorPrepass.ts
render/MotifStore.ts
render/melodyRenderer.ts
knowledge/grammarLibrary.ts
knowledge/motifShapes.ts
knowledge/guideTonePolicies.ts
knowledge/scaleGravity.ts
render/harmonicContract.ts
```

现状：

- `motifAnchorPrepass` 已有 repeatGroup / common safe tone / empty-global downgrade。
- `melodyRenderer` 已有 hook vs connector 分流。
- `grammarLibrary` 现在只是 clean-room 变体算子，不是 Impro-Visor-style grammar。
- hook 句目前用 `developBar(baseDev, grammarName, bar)` 做简单 development。
- connector 句已用 guide-tone line。

迁移后：

- `grammarLibrary.ts` 保留现有 clean-room 变体能力。
- 新增 `melodyGrammarRules.ts` 作为 Impro-Visor-style abstract grammar 数据。
- `melodyRenderer.ts` 不再只用 `developBar`，而是根据 `SkeletonSource` 选择：
  - `grammar`: 使用 preference grammar / slope tokens。
  - `guidetone`: 使用 guide-tone sparse line。
  - `hybrid`: grammar head + guide-tone tail。
- 强排比仍由 `MotifStore.referenceBindingId` 和 `effectiveRestatementStrength` 控制。
- 落点解决由 `melodyResolutionRules` + existing contract gate 控制。

## 排比与落点解决感

你在 `melodygenerative` 中新增的排比、落点解决感，在 newEngine 应拆成两层：

### 排比层

由现有结构继续承载：

- `ArrangementPlan.repeatGroup`
- `MotifBinding.motifId`
- `MotifStore.referenceBindingId`
- `MelodyAnchorEntry.effectiveRestatementStrength`
- `commonSafeToneSet`

新增消费：

- grammar profile 选择必须 deterministic。
- 同 `motifId` / 同 repeatGroup 的 hook head 应复现同一 grammar head 或同一 anchor token。
- tail 可以按 phrase function / cadence target 重新生成。
- 如果 global safe tone 为空，继续降级排比，不硬锁错误音。

### 落点解决层

由 token realization 执行：

- 强拍 / 长音 / phrase end 优先绑定 guide-tone。
- cadence phrase 末音必须落 stable / contract / target guide tone。
- POP 使用更强 `gravityStrictness` 和 immediate resolution。
- LOFI 允许 color hold / soft cadence / unresolved suspension。
- JAZZ / RNB 允许 chromatic approach 和 delayed resolution。
- `A` token 必须按 immediate next playable target 解决，不能跨 rest / marker 乱找目标。
- `SlopeEnter` / `SlopeExit` 只约束组内旋律线，不泄漏到下一 brick。

## 数据模型建议

### Melody Grammar Token

迁移 `GrammarTypes.ts`：

```ts
type MelodyToken =
  | { kind: 'C'; duration: number }
  | { kind: 'S'; duration: number }
  | { kind: 'L'; duration: number }
  | { kind: 'A'; duration: number }
  | { kind: 'R'; duration: number }
  | { kind: 'X'; degree?: number | string; duration: number }
  | { kind: 'H'; duration: number }
  | { kind: 'G'; duration: number }
  | { kind: 'B'; duration: number }
  | { kind: 'SlopeEnter'; dirMin: number; dirMax: number; duration: 0 }
  | { kind: 'SlopeExit'; duration: 0 };
```

保留语义：

- `C`: current chord tone
- `S`: current chord-scale tone
- `L`: color tone
- `A`: approach next target
- `R`: rest
- `X`: explicit degree
- `H`: helpful color
- `G`: guide-tone goal
- `B`: bass/root emphasis

### Melody Grammar Rule

```ts
interface MelodyGrammarRule {
  lhs: string;
  weight: number;
  metadata?: {
    sourceRuleId?: string;
    sourceBrickType?: string;
    lofiTags?: string[];
    styleTags?: string[];
    preferenceTags?: string[];
  };
  conditions?: {
    brickFamily?: string[];
    brickName?: string[];
    minDuration?: number;
    maxDuration?: number;
    sectionRole?: string[];
    phraseRole?: string[];
    skeletonRole?: string[];
  };
  rhs: Array<string | MelodyToken>;
}
```

### Melody Grammar Profile

```ts
interface MelodyGrammarProfile {
  id: string;
  style: 'POP' | 'LOFI' | 'RNB' | 'JAZZ';
  rules: MelodyGrammarRule[];
  fallbackRules: MelodyGrammarRule[];
  weightPolicy: {
    preferTags: Record<string, number>;
    avoidTags: Record<string, number>;
  };
  densityPolicy: {
    minTokenDuration: number;
    maxAudibleDensity: number;
    allowTriplets: boolean;
    allowChromaticRatio: number;
  };
}
```

## Style Preference 迁移

### LOFI

来源：

- `LofiGrammarTags.ts`
- `lofiStableSlopeRulesToGrammarRules`
- `LOFI_GRAVITY_STRICTNESS = 0.25`
- `allowFloatingColor = true`
- LOFI fill scales

保留偏好：

- `lofi_star_crawl`
- `lofi_crawl_hold`
- `lofi_hold_answer`
- `lofi_color_suspension`
- `lofi_rest_space`
- `lofi_short_crawl`
- `lofi_color_hold`
- `lofi_soft_cadence`
- `lofi_parallel_answer`
- `lofi_chromatic_neighbor`
- `lofi_vamp_friendly`

抑制：

- `lofi_avoid_busy`
- `lofi_avoid_large_leap`
- dense bebop / continuous 16th motion

### POP

来源：

- `popStableSlopeRulesToGrammarRules`
- `popSlopeTags`
- `POP_GRAVITY_STRICTNESS = 0.85`
- POP fill scales

保留偏好：

- `pop_no_chromatic`
- `pop_contract_first`
- `pop_clear_landing`
- `pop_phrase_space`
- `pop_functional_shape`

限制：

- 禁用 dense chromatic line。
- 禁用 triplet-heavy / bebop-heavy slope。
- 优先 half-beat grid、clear landing、contract tones。

### RNB

来源：

- `rnbSoulSlopeRulesToGrammarRules`
- `rnbSlopeTags`
- RNB fill scales

保留偏好：

- `rnb_color_forward`
- `rnb_vocal_hold`
- `rnb_melisma_crawl`
- `rnb_chromatic_grace`
- `rnb_soul_cadence`

限制：

- 不使用过密 bebop。
- 允许适量 chromatic grace。
- 保留 vocal hold 和 color-forward 特性。

### JAZZ

来源：

- `jazzSlopeRulesToGrammarRules`
- `jazzSlopeTags`
- JAZZ fill scales

保留偏好：

- `jazz_bebop`
- `jazz_chromatic_line`
- `jazz_functional_harmony`
- `jazz_motivic_cells`
- `jazz_phrase_landing`

限制：

- JAZZ 可以保留完整 imported slope vocabulary。
- 但仍通过 metadata 和 weight 做 functional/cadence/context 选择，不应随机乱铺。

## 迁移循环

### Loop 1: KB Token / Grammar 类型

新增：

```text
knowledge/melodyGrammarTypes.ts
```

迁移：

- `AbstractMelodyToken`
- `GrammarRule`
- `Grammar`
- `makeGrammar`

测试：

- 所有 token kind 可被类型识别。
- `makeGrammar` 按 lhs 建索引。
- KB 模块不 import render / harmony。

### Loop 2: Preference Slope Profiles

新增：

```text
knowledge/melodySlopeProfiles.ts
knowledge/melodyStylePreferences.ts
```

迁移：

- LOFI tag extraction / multiplier。
- POP stable filter / tags / multiplier。
- RNB stable filter / tags / multiplier。
- JAZZ tags / multiplier。
- soft-parallel favorite rule metadata。

注意：

- 不要在 render 层放 `IMPROVISOR_SLOPES`。
- 如果全量 `improvisorSlopes.ts` 太大，先离线生成 preference-filtered subset 常量。
- subset 应携带 `sourceRuleId`，方便 parity 测试和审计。

测试：

- LOFI subset 不含 `lofi_avoid_busy` / `lofi_avoid_large_leap` 高风险规则。
- POP subset 无 16th/triplet-heavy bebop。
- RNB subset 含 vocal hold / color-forward 标签。
- JAZZ profile 可保留 bebop 标签。
- soft-parallel favorite rule 权重明显高于普通规则。

### Loop 3: Melody Brick Plan

新增：

```text
knowledge/melodyBrickPatterns.ts
render/melodyBrickPlanner.ts
```

参考：

- `RoadMap.ts`
- `BrickParser.ts`
- 必要时参考 `BrickDictionary.ts`，但不要把完整旧 brick runtime 原封塞进 render。

目标：

- 从 `HarmonicPlan.chordTimeline` 构造 `MelodyChordBlock[]`。
- 识别 cadence / turnaround / dominant / borrowed / dropback / unknown 等 family。
- 输出 `MelodyBrickPlan`。

测试：

- `ii - V - I` 识别为 cadence / launcher 类。
- `V/X -> X` 识别为 dominant approach。
- `iv -> bVII -> I` 识别为 backdoor / borrowed cadence。
- 未识别片段 fallback 为 Unknown，不崩。

### Loop 4: Grammar Expansion

新增：

```text
render/melodyGrammarExpander.ts
```

迁移：

- weighted rule pick
- condition gate
- per-brick expansion
- fallback tokens

测试：

- 同 seed deterministic。
- 条件不满足的 rule 不触发。
- duration window 生效。
- empty expansion 使用 fallback。

### Loop 5: Token Realization

新增：

```text
render/melodyTokenRealizer.ts
```

参考：

- `LickGen.ts`
- `NoteChooser.ts`
- `PitchClassSets.ts`

目标：

- 每个 token 按当前 beat 查询当前 chord span。
- `C/S/L/H/G/B/X/A/R` 按语义产出 pitch 或 rest。
- `A` approach 只绑定 immediate next playable target。
- `SlopeEnter/Exit` 控制 active slope。
- repeated pitch merge。
- token clip 到 brick end，不在 chord boundary 截断。
- 强拍 / 长音 / phrase end 经 existing `harmonicContract` gate。

测试：

- `A` token 后跟 target 时生成半音 approach。
- `A` 后隔 rest / marker 不跨越绑定。
- slope constraint 限制每个后续音。
- SlopeExit 关闭约束，不泄漏到下一 brick。
- repeated adjacent same pitch 合并成一颗长音。
- strong beat 非合同音被 snap。
- weak passing tone 可放行。

### Loop 6: GuideTone / Landing

新增：

```text
render/melodyGuideTonePlanner.ts
knowledge/melodyResolutionRules.ts
```

迁移：

- `GuideTonePlanner.ts`
- structural token binding
- cadence landing policy

接入：

- `G` token 强制 guide-tone。
- chord entrance / strong beat / long tone 可绑定 guide-tone。
- cadence phrase 末端使用 `cadenceTarget` 决定落点。
- POP stricter；LOFI softer；RNB/JAZZ allow delay。

测试：

- 长和弦生成两个 guide-tone points。
- cadence 末音落 stable / guide tone。
- POP cadence 不悬挂 avoid。
- LOFI color hold 不被过度强制解决。

### Loop 7: Style Feel

新增：

```text
render/melodyStyleFeel.ts
```

迁移：

- `StyleRenderer.ts`
- `feelForStyle`

注意：

- 只改 time / duration / velocity。
- 不改 pitch。
- 与全局 `applySwing` 不要双重 swing。需要明确：如果 melodyStyleFeel 已 swing，renderCoordinator 的全局 swing 对 lead 要跳过或改成只执行一次。

测试：

- JAZZ offbeat swing。
- POP straight。
- RNB legato。
- push 只影响 strong-beat note。
- pitch 不变。

### Loop 8: 接入 MelodyRenderer

修改：

```text
render/melodyRenderer.ts
render/motifAnchorPrepass.ts
```

接入策略：

- 保留现有 connector guide-tone 分支。
- hook / grammar phrase 使用新 grammar profile。
- strong restatement 的 head 继续从 reference binding 拷贝。
- tail 使用 grammar token realization，但必须服从当前 phrase cadence / contract gate。
- 可先用 feature flag：

```ts
melodyPipeline: 'legacy-shape' | 'preference-grammar'
```

测试：

- 默认仍可跑旧测试。
- 开启 `preference-grammar` 后 lead 非空。
- 同 seed deterministic。
- 同 repeatGroup hook head 一致。
- collision/auditor 不恶化。

### Loop 9: MG Parity / Regression

新增测试：

```text
src/core/generation/newEngine/render/melodyGrammarParity.test.ts
src/core/generation/newEngine/knowledge/melodySlopeProfiles.test.ts
src/core/generation/newEngine/render/melodyTokenRealizer.test.ts
```

用例：

- 从 MG 固定 seed / chord progression 取 token-level snapshot。
- newEngine 对同一 HarmonicPlan 生成相同或等价 token family。
- 不要求 MIDI 逐 tick 完全一致，除非 style feel 和 chord plan 完全一致。
- 至少断言：
  - token kind sequence
  - phrase landing pc
  - guide-tone binding count
  - slope constraint count
  - approach-resolution pair count
  - style tag profile 命中

## 验收标准

### 分层验收

- `knowledge/*melody*` 不 import render / harmony runtime。
- `render/*melody*` 可以 import KB / HarmonicPlan / ArrangementPlan / MotifStore。
- `harmony` 不 import melody grammar。
- `render` 不包含大 slope raw data。
- 没有新增绕过 `renderSongFull` 的独立 melody generation 入口。

### 音乐行为验收

- POP: clear landing、contract-first、低 chromatic。
- LOFI: crawl-hold、rest-space、color suspension、弱解决。
- RNB: vocal hold、melisma crawl、color-forward。
- JAZZ: bebop / chromatic line / functional cadence 可出现。
- hook phrase 有排比。
- connector phrase 有 guide-tone motion。
- cadence phrase 有可听落点。
- style feel 只改 timing / velocity，不改 pitch。

### 架构验收

必须通过：

```bash
npm test -- src/core/generation/newEngine/knowledge/melodySlopeProfiles.test.ts
npm test -- src/core/generation/newEngine/render/melodyGrammarExpander.test.ts
npm test -- src/core/generation/newEngine/render/melodyTokenRealizer.test.ts
npm test -- src/core/generation/newEngine/render/melodyGuideTonePlanner.test.ts
npm test -- src/core/generation/newEngine/render/melodyRenderer.test.ts
npm test -- src/core/generation/newEngine/render/renderSongFull.test.ts
```

并检查：

```bash
rg "generateImprovisorMelody\\(" src/core/generation/newEngine
rg "IMPROVISOR_SLOPES" src/core/generation/newEngine/render
rg "improvisorVocab|improvisorSlopes" src/core/generation/newEngine/render
```

期望：

- 不直接调用 `generateImprovisorMelody()`。
- render 不直接 import raw slope data。
- 如果需要使用 raw slope data，只能通过 KB 的 preference-filtered export。

## 终止条件

当以下条件满足时，本轮迁移停止：

1. POP / LOFI / RNB / JAZZ 都有 preference-filtered melody grammar profile。
2. render 能从 `HarmonicPlan` 生成 `MelodyBrickPlan`。
3. grammar expansion 能按 style / brick / duration 选 rule。
4. token realizer 支持 `C/S/L/A/R/X/H/G/B/SlopeEnter/SlopeExit`。
5. guide-tone binding 与 cadence landing 生效。
6. 现有 repeatGroup 排比仍有效。
7. lead 输出通过 harmonic contract / auditor。
8. newEngine 没有新增旧 pipeline 入口。
9. 测试覆盖上述 POP / LOFI / RNB / JAZZ 样例。

## 给 Claude 的执行提示

请按 loop 迁移，不要一次性搬完整旧 pipeline。

第一轮从 KB 开始：

```text
../melodygenerative/src/lib/improvisor/GrammarTypes.ts
../melodygenerative/src/lib/improvisor/SlopeAdapter.ts
../melodygenerative/src/lib/improvisor/LofiGrammarTags.ts
```

先产出：

```text
knowledge/melodyGrammarTypes.ts
knowledge/melodySlopeProfiles.ts
knowledge/melodyStylePreferences.ts
```

然后再做 render 消费：

```text
render/melodyBrickPlanner.ts
render/melodyGrammarExpander.ts
render/melodyTokenRealizer.ts
```

最后接入：

```text
render/melodyRenderer.ts
```

实现时请保持原则：

- 模板数据进 KB。
- 选择/展开/实化在 render。
- 排比继续走 `MotifStore`。
- 落点解决继续受 `HarmonicPlan` / `harmonicContract` / `scaleGravity` 约束。
- 不要绕过 current newEngine pipeline。
